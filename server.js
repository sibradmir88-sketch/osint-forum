// ═══════════════════════════════════════════════════════════════
// OSINT Forum — Production Server (bulletproof edition)
// ═══════════════════════════════════════════════════════════════

console.log("=== OSINT Forum starting ===");
console.log("CWD:", process.cwd());
console.log("PORT:", process.env.PORT);
console.log("NODE_ENV:", process.env.NODE_ENV);

// ── Global crash handlers (never die) ──────────────────────────
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message, err.stack);
  // Don't exit — keep serving
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
  // Don't exit — keep serving
});

require("dotenv").config();
const express       = require('express');
const session       = require('express-session');
const Database      = require('better-sqlite3');
const path          = require('path');
const fs = require('fs');
const crypto        = require('crypto');
const { exec } = require('child_process');

// ── Database path (use Railway volume if available) ────────────
const DB_PATH = fs.existsSync('/data') ? '/data/forum.db' : 'forum.db';
console.log("DB_PATH:", DB_PATH);

// Fix permissions if needed (Railway volume may have restrictive perms)
try {
  if (fs.existsSync(DB_PATH)) {
    fs.chmodSync(DB_PATH, 0o666);
  }
  if (fs.existsSync('/data')) {
    fs.chmodSync('/data', 0o777);
  }
} catch (e) {
  console.log('Permission fix (non-fatal):', e.message);
}

let db;
try {
  db = new Database(DB_PATH);
} catch (err) {
  console.error('FATAL: Cannot open database at', DB_PATH, err.message);
  process.exit(1);
}

// Async backup to Google Drive after write operations
function backupDb() {
  try {
    const backupPath = '/tmp/forum-writebackup.db';
    try {
      db.backup(backupPath);
    } catch (e) {
      try { db.exec(`VACUUM INTO '${backupPath}'`); } catch(e2) { console.error('Backup VACUUM failed:', e2.message); return; }
    }
    // Non-blocking rclone — never crash the app
    exec(`rclone copyto "${backupPath}" gdrive:osint-forum-backup/latest.db`, { timeout: 30000 }, (err) => {
      if (err) console.error('Backup warning (non-fatal):', err.message);
    });
  } catch (e) {
    console.error('Backup error (non-fatal):', e.message);
  }
}

// ── Session table ────────────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  sid      TEXT PRIMARY KEY,
  data     TEXT NOT NULL,
  expired  TEXT NOT NULL
)`);

// ── SQLite session store (persists across restarts) ──────
const util = require('util');
function SQLiteStore() {
  session.Store.call(this);
}
util.inherits(SQLiteStore, session.Store);
SQLiteStore.prototype.get = function(sid, cb) {
  try {
    const row = db.prepare("SELECT data FROM sessions WHERE sid=? AND expired>datetime('now')").get(sid);
    cb(null, row ? JSON.parse(row.data) : null);
  } catch(e) { cb(e); }
};
SQLiteStore.prototype.set = function(sid, session, cb) {
  try {
    const maxAge = session.cookie?.maxAge || 7*24*3600*1000;
    const expired = new Date(Date.now() + maxAge).toISOString();
    db.prepare("INSERT OR REPLACE INTO sessions (sid, data, expired) VALUES (?,?,?)").run(sid, JSON.stringify(session), expired);
    cb(null);
  } catch(e) { cb(e); }
};
SQLiteStore.prototype.destroy = function(sid, cb) {
  try {
    db.prepare("DELETE FROM sessions WHERE sid=?").run(sid);
    cb(null);
  } catch(e) { cb(e); }
};
SQLiteStore.prototype.touch = function(sid, session, cb) {
  try {
    const maxAge = session.cookie?.maxAge || 7*24*3600*1000;
    const expired = new Date(Date.now() + maxAge).toISOString();
    db.prepare("UPDATE sessions SET expired=? WHERE sid=?").run(expired, sid);
    cb(null);
  } catch(e) { cb(e); }
};

const app  = express();
const PORT = process.env.PORT || 3000;

// ── DuckDNS auto-updater ────────────────────────────────────────
const DUCKDNS_DOMAIN = process.env.DUCKDNS_DOMAIN || '';
const DUCKDNS_TOKEN  = process.env.DUCKDNS_TOKEN  || '';
if (DUCKDNS_DOMAIN && DUCKDNS_TOKEN) {
  const https = require('https');
  function updateDuckDns() {
    const url = `https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=&verbose=true`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log(`[DuckDNS] ${DUCKDNS_DOMAIN}.duckdns.org → ${data.trim()}`);
      });
    }).on('error', (err) => {
      console.error('[DuckDNS] Update error:', err.message);
    });
  }
  updateDuckDns();
  setInterval(updateDuckDns, 5 * 60 * 1000);
  console.log(`[DuckDNS] Auto-updater started for ${DUCKDNS_DOMAIN}.duckdns.org`);
}

const CONFIG = {
  sessionSecret : process.env.SESSION_SECRET || 'CHANGE_ME_SECRET_32chars_min',
};
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT    NOT NULL UNIQUE,
    email      TEXT,
    nickname   TEXT,
    avatar     TEXT    DEFAULT '',
    avatar_img TEXT    DEFAULT '',
    provider   TEXT    NOT NULL DEFAULT 'email',
    provider_id TEXT,
    password_hash TEXT,
    verified   INTEGER NOT NULL DEFAULT 0,
    active_tags TEXT   NOT NULL DEFAULT '["BEGINNER"]',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

try { db.exec("ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN active_tags TEXT NOT NULL DEFAULT '[\"BEGINNER\"]'"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN avatar_img TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN nickname TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN provider_id TEXT"); } catch(e) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_usernames (
    username   TEXT    PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS threads (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT    NOT NULL DEFAULT 'paste',
    topic      TEXT    NOT NULL,
    text       TEXT    NOT NULL,
    author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    anonymous  INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS replies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id  INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    text       TEXT    NOT NULL,
    author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    anonymous  INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS section_posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    section    TEXT    NOT NULL,
    text       TEXT    NOT NULL,
    author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS section_replies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER NOT NULL REFERENCES section_posts(id) ON DELETE CASCADE,
    text       TEXT    NOT NULL,
    author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS moderators (
    username   TEXT    PRIMARY KEY,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS chief_moderators (
    username   TEXT    PRIMARY KEY,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS deputy_chief_moderators (
    username   TEXT    PRIMARY KEY,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS owners (
    username   TEXT    PRIMARY KEY,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS complaints (
    id           TEXT    PRIMARY KEY,
    post_idx     INTEGER DEFAULT 0,
    post_topic   TEXT    DEFAULT '',
    target_author TEXT   DEFAULT '',
    reason       TEXT    DEFAULT '',
    details      TEXT    DEFAULT '',
    status       TEXT    DEFAULT 'new',
    source       TEXT    DEFAULT 'forum',
    section      TEXT    DEFAULT '',
    created_by   TEXT    DEFAULT '',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS banned_users (
    username   TEXT    PRIMARY KEY,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS muted_users (
    username   TEXT    PRIMARY KEY,
    expires_at TEXT,
    reason     TEXT    DEFAULT '',
    muted_by   TEXT    DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS post_reactions (
    post_key   TEXT    NOT NULL,
    username   TEXT    NOT NULL,
    reaction   TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (post_key, username, reaction)
  );
  CREATE TABLE IF NOT EXISTS post_views (
    post_key   TEXT    NOT NULL,
    username   TEXT    NOT NULL,
    count      INTEGER DEFAULT 1,
    PRIMARY KEY (post_key, username)
  );
`);

// Add missing user columns
try { db.exec("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN avatar_color TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN avatar_emoji TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'dark'"); } catch(e) {}

// Thread status & pin columns
try { db.exec("ALTER TABLE threads ADD COLUMN status TEXT NOT NULL DEFAULT 'new'"); } catch(e) {}
try { db.exec("ALTER TABLE threads ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE section_posts ADD COLUMN status TEXT NOT NULL DEFAULT 'new'"); } catch(e) {}
try { db.exec("ALTER TABLE section_posts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0"); } catch(e) {}

// Server-side rate limit table
db.exec(`
  CREATE TABLE IF NOT EXISTS rate_limits (
    username   TEXT    NOT NULL,
    action     TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);
try { db.exec("CREATE INDEX IF NOT EXISTS idx_rate_limits ON rate_limits(username, action, created_at)"); } catch(e) {}
try { db.exec("ALTER TABLE complaints ADD COLUMN source TEXT DEFAULT 'forum'"); } catch(e) {}
try { db.exec("ALTER TABLE complaints ADD COLUMN section TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE muted_users ADD COLUMN reason TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE muted_users ADD COLUMN muted_by TEXT DEFAULT ''"); } catch(e) {}

['illuminatov', 'detailing'].forEach(u => {
  db.prepare("INSERT OR IGNORE INTO admin_usernames (username) VALUES (?)").run(u);
});

function isAdmin(username) {
  if (!username) return false;
  return !!db.prepare("SELECT username FROM admin_usernames WHERE username=?").get(username.toLowerCase());
}
function isModerator(username) {
  if (!username) return false;
  return !!db.prepare("SELECT username FROM moderators WHERE username=?").get(username.toLowerCase());
}
function isOwner(username) {
  if (!username) return false;
  return !!db.prepare("SELECT username FROM owners WHERE username=?").get(username.toLowerCase());
}
function isChiefModerator(username) {
  if (!username) return false;
  return !!db.prepare("SELECT username FROM chief_moderators WHERE username=?").get(username.toLowerCase());
}
function isDeputyChiefModerator(username) {
  if (!username) return false;
  return !!db.prepare("SELECT username FROM deputy_chief_moderators WHERE username=?").get(username.toLowerCase());
}
function isStaff(username) {
  return isOwner(username) || isAdmin(username) || isChiefModerator(username) || isDeputyChiefModerator(username) || isModerator(username);
}
function isStaffWithBan(username) {
  return isOwner(username) || isAdmin(username) || isChiefModerator(username) || isDeputyChiefModerator(username);
}
function isBanned(username) {
  if (!username) return false;
  return !!db.prepare("SELECT username FROM banned_users WHERE username=?").get(username.toLowerCase());
}
function isMuted(username) {
  if (!username) return false;
  const row = db.prepare("SELECT expires_at FROM muted_users WHERE username=? AND (expires_at IS NULL OR expires_at > datetime('now'))").get(username.toLowerCase());
  return !!row;
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + 'osint_salt_42').digest('hex');
}

function safeUser(u) {
  if (!u) return null;
   return { id: u.id, username: u.username, nickname: u.nickname || u.username,
            avatar: u.avatar, avatar_img: u.avatar_img,
            avatar_color: u.avatar_color || '', avatar_emoji: u.avatar_emoji || '',
            provider: u.provider,
            active_tags: JSON.parse(u.active_tags || '["BEGINNER"]'),
            theme: u.theme || 'dark',
           is_banned: isBanned(u.username),
           is_admin: isAdmin(u.username),
           is_moderator: isModerator(u.username),
           is_owner: isOwner(u.username) };
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
  secret           : CONFIG.sessionSecret,
  store            : new SQLiteStore(),
  resave           : false,
  saveUninitialized: false,
  cookie           : { maxAge: 7 * 24 * 3600 * 1000, sameSite: 'lax' },
}));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  req.user = req.session?.user || null;
  if (req.user && isBanned(req.user.username)) {
    req.user = null;
    delete req.session.user;
    req.session.save(() => {});
    if (req.path.startsWith('/api/')) {
      return res.json({ ok: false, error: 'Ваш аккаунт заблокирован.', banned: true });
    }
  }
  next();
});

function loginUser(req, res, user) {
  req.session.user = user;
  req.session.save(err => {
    if (err) return res.json({ ok: false, error: 'Ошибка сессии.' });
    res.json({ ok: true, user: safeUser(user) });
  });
}

app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || username.length < 3) return res.json({ ok: false, error: 'Имя пользователя: минимум 3 символа.' });
  if (!email || !/\S+@\S+\.\S+/.test(email)) return res.json({ ok: false, error: 'Введите корректный email.' });
  if (!password || password.length < 6) return res.json({ ok: false, error: 'Пароль: минимум 6 символов.' });

  if (db.prepare('SELECT id FROM users WHERE username=?').get(username.toLowerCase()))
    return res.json({ ok: false, error: 'Это имя пользователя уже занято.' });
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase()))
    return res.json({ ok: false, error: 'Этот email уже зарегистрирован.' });

  const info = db.prepare(
    `INSERT INTO users (username, email, nickname, avatar, provider, password_hash, active_tags)
     VALUES (?,?,?,?,?,?,?)`
  ).run(username.toLowerCase(), email.toLowerCase(), username,
        username[0].toUpperCase(), 'email', hashPassword(password), '["BEGINNER"]');

  const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  backupDb();
  loginUser(req, res, user);
});

app.post('/api/auth/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.json({ ok: false, error: 'Заполните все поля.' });

  const user = db.prepare('SELECT * FROM users WHERE username=? OR email=?')
                 .get(login.toLowerCase(), login.toLowerCase());
  if (!user) return res.json({ ok: false, error: 'Пользователь не найден.' });
  if (isBanned(user.username)) return res.json({ ok: false, error: 'Ваш аккаунт заблокирован.', banned: true });
  if (user.password_hash !== hashPassword(password))
    return res.json({ ok: false, error: 'Неверный пароль.' });

  loginUser(req, res, user);
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (req.user && isBanned(req.user.username)) {
    req.user = null;
    delete req.session.user;
    req.session.save(() => {});
    return res.json({ user: null, banned: true });
  }
  res.json({ user: safeUser(req.user) });
});

// Cross-device sync: returns all role lists and user tags
app.get('/api/sync/init', (req, res) => {
  const admins = db.prepare('SELECT username FROM admin_usernames').all().map(r => r.username);
  const moderators = db.prepare('SELECT username FROM moderators').all().map(r => r.username);
  const chiefModerators = db.prepare('SELECT username FROM chief_moderators').all().map(r => r.username);
  const deputyChiefModerators = db.prepare('SELECT username FROM deputy_chief_moderators').all().map(r => r.username);
  const owners = db.prepare('SELECT username FROM owners').all().map(r => r.username);
  const userRows = db.prepare('SELECT username, active_tags FROM users').all();
  const userTags = {};
  userRows.forEach(u => { userTags[u.username] = JSON.parse(u.active_tags || '["BEGINNER"]'); });
  res.json({ ok: true, admins, moderators, chiefModerators, deputyChiefModerators, owners, userTags });
});

// Full sync: returns EVERYTHING the frontend needs — no localStorage required
app.get('/api/sync/full', (req, res) => {
  // Запрещаем кеширование, чтобы Cloudflare не отдавал устаревшие данные
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const admins = db.prepare('SELECT username FROM admin_usernames').all().map(r => r.username);
  const moderators = db.prepare('SELECT username FROM moderators').all().map(r => r.username);
  const chiefModerators = db.prepare('SELECT username FROM chief_moderators').all().map(r => r.username);
  const deputyChiefModerators = db.prepare('SELECT username FROM deputy_chief_moderators').all().map(r => r.username);
  const owners = db.prepare('SELECT username FROM owners').all().map(r => r.username);
  const complaints = db.prepare('SELECT * FROM complaints ORDER BY created_at DESC LIMIT 500').all();
  const banned = db.prepare('SELECT username FROM banned_users').all().map(r => r.username);
  const muted = db.prepare('SELECT username, expires_at, reason, muted_by, created_at FROM muted_users').all();
  const users = db.prepare("SELECT username, nickname, avatar, avatar_img, active_tags, bio, avatar_color, avatar_emoji, created_at FROM users").all();
  const reactions = db.prepare('SELECT post_key, username, reaction FROM post_reactions').all();
  const views = db.prepare('SELECT post_key, SUM(count) as count FROM post_views GROUP BY post_key').all();
  const threads = db.prepare(`
    SELECT t.*, u.username, u.nickname, u.avatar, u.avatar_img,
           (SELECT COUNT(*) FROM replies r WHERE r.thread_id=t.id) AS reply_count
    FROM threads t LEFT JOIN users u ON t.author_id = u.id
    ORDER BY t.pinned DESC, t.created_at DESC LIMIT 200
  `).all();
  const threadsWithReplies = threads.map(t => {
    const replies = db.prepare(`
      SELECT r.*, u.username, u.nickname, u.avatar, u.avatar_img
      FROM replies r LEFT JOIN users u ON r.author_id=u.id
      WHERE r.thread_id=? ORDER BY r.created_at ASC
    `).all(t.id);
    return { ...t, replies };
  });
  const sectionPosts = db.prepare(`
    SELECT sp.*, u.username, u.nickname, u.avatar, u.avatar_img
    FROM section_posts sp LEFT JOIN users u ON sp.author_id=u.id
    ORDER BY sp.pinned DESC, sp.created_at DESC LIMIT 200
  `).all();
  const sectionsWithReplies = sectionPosts.map(sp => {
    const replies = db.prepare(`
      SELECT sr.*, u.username, u.nickname, u.avatar, u.avatar_img
      FROM section_replies sr LEFT JOIN users u ON sr.author_id=u.id
      WHERE sr.post_id=? ORDER BY sr.created_at ASC
    `).all(sp.id);
    return { ...sp, replies };
  });
  res.json({ ok: true, admins, moderators, chiefModerators, deputyChiefModerators, owners, complaints, banned, muted, users, reactions, views, threads: threadsWithReplies, sections: sectionsWithReplies });
});

app.get('/api/threads', (req, res) => {
  const { sort = 'newest', search = '' } = req.query;
  const orderMap = { newest: 't.created_at DESC', oldest: 't.created_at ASC', popular: 'reply_count DESC' };
  const order = orderMap[sort] || orderMap.newest;
  const like = `%${search}%`;
  const rows = db.prepare(`
    SELECT t.*, u.username, u.nickname, u.avatar, u.avatar_img,
           (SELECT COUNT(*) FROM replies r WHERE r.thread_id=t.id) AS reply_count
    FROM threads t LEFT JOIN users u ON t.author_id = u.id
    WHERE t.topic LIKE ? ORDER BY t.pinned DESC, ${order}
  `).all(like);
  const threadsWithReplies = rows.map(t => {
    const replies = db.prepare(`
      SELECT r.*, u.username, u.nickname, u.avatar, u.avatar_img
      FROM replies r LEFT JOIN users u ON r.author_id=u.id
      WHERE r.thread_id=? ORDER BY r.created_at ASC
    `).all(t.id);
    return { ...t, replies };
  });
  res.json({ ok: true, threads: threadsWithReplies });
});

app.post('/api/threads', (req, res) => {
  const { type, topic, text, anonymous } = req.body;
  if (!topic?.trim() || !text?.trim())
    return res.json({ ok: false, error: 'Заполните тему и текст.' });
  if (req.user && isMuted(req.user.username))
    return res.json({ ok: false, error: 'Вы не можете писать, пока находитесь в муте.' });
  const author_id = req.user?.id || null;
  const info = db.prepare(
    `INSERT INTO threads (type, topic, text, author_id, anonymous) VALUES (?,?,?,?,?)`
  ).run(type || 'paste', topic.trim(), text.trim(), author_id, anonymous ? 1 : 0);
  backupDb();
  res.json({ ok: true, thread: db.prepare('SELECT * FROM threads WHERE id=?').get(info.lastInsertRowid) });
});

app.post('/api/threads/:id/replies', (req, res) => {
  const { text, anonymous } = req.body;
  if (!text?.trim()) return res.json({ ok: false, error: 'Пустой ответ.' });
  if (req.user && isMuted(req.user.username))
    return res.json({ ok: false, error: 'Вы не можете писать, пока находитесь в муте.' });
  if (!db.prepare('SELECT id FROM threads WHERE id=?').get(req.params.id))
    return res.json({ ok: false, error: 'Тема не найдена.' });
  const info = db.prepare(
    `INSERT INTO replies (thread_id, text, author_id, anonymous) VALUES (?,?,?,?)`
  ).run(req.params.id, text.trim(), req.user?.id || null, anonymous ? 1 : 0);
  backupDb();
  res.json({ ok: true, id: info.lastInsertRowid });
});

// ── Delete thread ────────────────────────────────────────────────
app.delete('/api/threads/:id', (req, res) => {
  if (!req.user) return res.json({ ok: false, error: 'Не авторизован.' });
  const thread = db.prepare('SELECT * FROM threads WHERE id=?').get(req.params.id);
  if (!thread) return res.json({ ok: false, error: 'Тема не найдена.' });
  const canDelete = isStaff(req.user.username) || (thread.author_id === req.user.id);
  if (!canDelete) return res.json({ ok: false, error: 'Нет прав.' });
  db.prepare('DELETE FROM threads WHERE id=?').run(req.params.id);
  backupDb();
  res.json({ ok: true });
});

// ── Delete thread reply ──────────────────────────────────────────
app.delete('/api/threads/:id/replies/:replyId', (req, res) => {
  if (!req.user) return res.json({ ok: false, error: 'Не авторизован.' });
  const reply = db.prepare('SELECT * FROM replies WHERE id=?').get(req.params.replyId);
  if (!reply) return res.json({ ok: false, error: 'Ответ не найден.' });
  const canDelete = isStaff(req.user.username) || (reply.author_id === req.user.id);
  if (!canDelete) return res.json({ ok: false, error: 'Нет прав.' });
  db.prepare('DELETE FROM replies WHERE id=?').run(req.params.replyId);
  backupDb();
  res.json({ ok: true });
});

// ── Pin / Unpin thread ───────────────────────────────────────────
app.patch('/api/threads/:id/pin', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  const thread = db.prepare('SELECT * FROM threads WHERE id=?').get(req.params.id);
  if (!thread) return res.json({ ok: false, error: 'Тема не найдена.' });
  const newVal = thread.pinned ? 0 : 1;
  db.prepare('UPDATE threads SET pinned=? WHERE id=?').run(newVal, req.params.id);
  backupDb();
  res.json({ ok: true, pinned: !!newVal });
});

// ── Set thread status ────────────────────────────────────────────
app.patch('/api/threads/:id/status', (req, res) => {
  if (!req.user) return res.json({ ok: false, error: 'Не авторизован.' });
  if (!isStaff(req.user.username))
    return res.json({ ok: false, error: 'Нет доступа.' });
  const { status } = req.body;
  if (!['new', 'read', 'pending'].includes(status))
    return res.json({ ok: false, error: 'Некорректный статус.' });
  db.prepare('UPDATE threads SET status=? WHERE id=?').run(status, req.params.id);
  backupDb();
  res.json({ ok: true });
});

app.get('/api/sections/:section', (req, res) => {
  const { section } = req.params;
  const posts = db.prepare(`
    SELECT sp.*, u.username, u.nickname, u.avatar, u.avatar_img
    FROM section_posts sp LEFT JOIN users u ON sp.author_id=u.id
    WHERE sp.section=? ORDER BY sp.created_at DESC LIMIT 50
  `).all(section);
  const withReplies = posts.map(p => {
    const replies = db.prepare(`
      SELECT sr.*, u.username, u.nickname, u.avatar, u.avatar_img
      FROM section_replies sr LEFT JOIN users u ON sr.author_id=u.id
      WHERE sr.post_id=? ORDER BY sr.created_at ASC
    `).all(p.id);
    return { ...p, replies };
  });
  res.json({ ok: true, posts: withReplies });
});

app.post('/api/sections/:section', (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.json({ ok: false, error: 'Пустое сообщение.' });
  if (req.user && isMuted(req.user.username))
    return res.json({ ok: false, error: 'Вы не можете писать, пока находитесь в муте.' });
  const info = db.prepare(
    `INSERT INTO section_posts (section, text, author_id) VALUES (?,?,?)`
  ).run(req.params.section, text.trim(), req.user?.id || null);
  backupDb();
  res.json({ ok: true, id: info.lastInsertRowid });
});

// ── Theme preference (server-side, no localStorage) ─────────────
app.get('/api/user/theme', (req, res) => {
  if (!req.user) return res.json({ ok: true, theme: 'dark' });
  const u = db.prepare('SELECT theme FROM users WHERE id=?').get(req.user.id);
  res.json({ ok: true, theme: u?.theme || 'dark' });
});

app.patch('/api/user/theme', (req, res) => {
  if (!req.user) return res.json({ ok: false, error: 'Не авторизован.' });
  const { theme } = req.body;
  if (theme !== 'dark' && theme !== 'light') return res.json({ ok: false, error: 'Некорректная тема.' });
  db.prepare('UPDATE users SET theme=? WHERE id=?').run(theme, req.user.id);
  res.json({ ok: true });
});

app.post('/api/sections/:section/:postId/replies', (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.json({ ok: false, error: 'Пустой ответ.' });
  if (req.user && isMuted(req.user.username))
    return res.json({ ok: false, error: 'Вы не можете писать, пока находитесь в муте.' });
  db.prepare(
    `INSERT INTO section_replies (post_id, text, author_id) VALUES (?,?,?)`
  ).run(req.params.postId, text.trim(), req.user?.id || null);
  backupDb();
  res.json({ ok: true });
});

app.delete('/api/sections/:section/:postId', (req, res) => {
  const post = db.prepare('SELECT * FROM section_posts WHERE id=?').get(req.params.postId);
  if (!post) return res.json({ ok: false, error: 'Пост не найден.' });
  if (!req.user) return res.json({ ok: false, error: 'Не авторизован.' });
  const canDelete = isStaff(req.user.username) || (post.author_id === req.user.id);
  if (!canDelete) return res.json({ ok: false, error: 'Нет прав.' });
  db.prepare('DELETE FROM section_posts WHERE id=?').run(req.params.postId);
  backupDb();
  res.json({ ok: true });
});

app.delete('/api/sections/:section/:postId/replies/:replyId', (req, res) => {
  const reply = db.prepare('SELECT * FROM section_replies WHERE id=?').get(req.params.replyId);
  if (!reply) return res.json({ ok: false, error: 'Ответ не найден.' });
  if (!req.user) return res.json({ ok: false, error: 'Не авторизован.' });
  const canDelete = isStaff(req.user.username) || (reply.author_id === req.user.id);
  if (!canDelete) return res.json({ ok: false, error: 'Нет прав.' });
  db.prepare('DELETE FROM section_replies WHERE id=?').run(req.params.replyId);
  backupDb();
  res.json({ ok: true });
});

app.get('/api/users/:username', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(req.params.username.toLowerCase());
  if (!user) return res.json({ ok: false, error: 'Пользователь не найден.' });
  res.json({ ok: true, user: safeUser(user) });
});

app.patch('/api/users/me', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  if (!req.user) return res.json({ ok: false, error: 'Не авторизован.' });
  const { nickname, avatar, active_tags, bio, avatar_color, avatar_emoji, avatar_img } = req.body;
  console.log('PATCH /api/users/me for user', req.user.username, 'id=', req.user.id, 'body:', JSON.stringify({nickname, avatar_color, avatar_emoji, avatar_img: avatar_img ? avatar_img.slice(0,40)+'...' : undefined}));
  const existing = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!existing) return res.json({ ok: false, error: 'Пользователь не найден.' });
  console.log('  existing: avatar_color=' + existing.avatar_color + ' avatar_emoji=' + existing.avatar_emoji + ' avatar_img=' + (existing.avatar_img ? existing.avatar_img.slice(0,40) : 'none'));
  db.prepare(`UPDATE users SET nickname=?, avatar=?, active_tags=?, bio=?, avatar_color=?, avatar_emoji=?, avatar_img=? WHERE id=?`)
    .run(
      nickname || existing.nickname,
      avatar || existing.avatar,
      active_tags ? JSON.stringify(active_tags) : existing.active_tags,
      bio !== undefined ? bio : (existing.bio || ''),
      avatar_color !== undefined ? avatar_color : (existing.avatar_color || ''),
      avatar_emoji !== undefined ? avatar_emoji : (existing.avatar_emoji || ''),
      avatar_img !== undefined ? avatar_img : (existing.avatar_img || ''),
      req.user.id
    );
  const after = db.prepare('SELECT avatar_color, avatar_emoji, avatar_img FROM users WHERE id=?').get(req.user.id);
  console.log('  after update: avatar_color=' + after.avatar_color + ' avatar_emoji=' + after.avatar_emoji + ' avatar_img=' + (after.avatar_img ? after.avatar_img.slice(0,40) : 'none'));
  backupDb();
  res.json({ ok: true });
});

// ── Debug: check user profile in DB ──────────────────────────
app.get('/api/debug/profile', (req, res) => {
  if (!req.user) return res.json({ ok: false, error: 'Не авторизован.' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ ok: true, user });
});

// ── Complaints CRUD ──────────────────────────────────────────
app.post('/api/complaints', (req, res) => {
  if (!req.user) return res.json({ ok: false, error: 'Не авторизован.' });
  const { post_idx, post_topic, target_author, reason, details, source, section } = req.body;
  if (!reason) return res.json({ ok: false, error: 'Укажите причину.' });
  const id = 'c_' + Math.random().toString(36).slice(2, 10);
  db.prepare(`INSERT INTO complaints (id, post_idx, post_topic, target_author, reason, details, source, section, created_by)
               VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, post_idx || 0, post_topic || '', target_author || '', reason, details || '', source || 'forum', section || '', req.user.username);
  backupDb();
  res.json({ ok: true, id });
});

app.get('/api/complaints', (req, res) => {
  if (!req.user) return res.json({ ok: false, error: 'Не авторизован.' });
  if (!isStaff(req.user.username))
    return res.json({ ok: false, error: 'Нет доступа.' });
  const complaints = db.prepare('SELECT * FROM complaints ORDER BY created_at DESC LIMIT 500').all();
  res.json({ ok: true, complaints });
});

app.patch('/api/complaints/:id', (req, res) => {
  if (!req.user) return res.json({ ok: false, error: 'Не авторизован.' });
  if (!isStaff(req.user.username))
    return res.json({ ok: false, error: 'Нет доступа.' });
  const { status } = req.body;
  db.prepare('UPDATE complaints SET status=? WHERE id=?').run(status || 'new', req.params.id);
  backupDb();
  res.json({ ok: true });
});

app.delete('/api/complaints/:id', (req, res) => {
  if (!req.user) return res.json({ ok: false, error: 'Не авторизован.' });
  if (!isStaff(req.user.username))
    return res.json({ ok: false, error: 'Нет доступа.' });
  db.prepare('DELETE FROM complaints WHERE id=?').run(req.params.id);
  backupDb();
  res.json({ ok: true });
});

// ── Ban / Unban ──────────────────────────────────────────────
app.post('/api/admin/bans', (req, res) => {
  if (!req.user || !isStaffWithBan(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  const { username } = req.body;
  if (!username) return res.json({ ok: false, error: 'Укажите username.' });
  const clean = username.toLowerCase().replace(/^@/, '');
  db.prepare('INSERT OR IGNORE INTO banned_users (username) VALUES (?)').run(clean);
  backupDb();
  res.json({ ok: true });
});

app.delete('/api/admin/bans/:username', (req, res) => {
  if (!req.user || !isStaffWithBan(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  const clean = req.params.username.toLowerCase();
  db.prepare('DELETE FROM banned_users WHERE username=?').run(clean);
  backupDb();
  res.json({ ok: true });
});

// ── Mute / Unmute ────────────────────────────────────────────
app.get('/api/admin/mutes', (req, res) => {
  if (!req.user || !isStaff(req.user.username))
    return res.json({ ok: false, error: 'Нет доступа.' });
  const mutes = db.prepare('SELECT * FROM muted_users ORDER BY created_at DESC').all();
  res.json({ ok: true, mutes });
});

app.post('/api/admin/mutes', (req, res) => {
  if (!req.user || !isStaff(req.user.username))
    return res.json({ ok: false, error: 'Нет доступа.' });
  const { username, expires_at, reason } = req.body;
  if (!username) return res.json({ ok: false, error: 'Укажите username.' });
  const clean = username.toLowerCase().replace(/^@/, '');
  db.prepare('INSERT OR IGNORE INTO muted_users (username, expires_at, reason, muted_by) VALUES (?,?,?,?)')
    .run(clean, expires_at || null, reason || '', req.user.username);
  backupDb();
  res.json({ ok: true });
});

app.delete('/api/admin/mutes/:username', (req, res) => {
  if (!req.user || !isStaff(req.user.username))
    return res.json({ ok: false, error: 'Нет доступа.' });
  const clean = req.params.username.toLowerCase();
  db.prepare('DELETE FROM muted_users WHERE username=?').run(clean);
  backupDb();
  res.json({ ok: true });
});

// ── Reactions ────────────────────────────────────────────────
app.post('/api/reactions', (req, res) => {
  if (!req.user) return res.json({ ok: false, error: 'Не авторизован.' });
  const { post_key, reaction } = req.body;
  if (!post_key || !reaction) return res.json({ ok: false, error: 'Неверные параметры.' });
  const existing = db.prepare('SELECT * FROM post_reactions WHERE post_key=? AND username=? AND reaction=?')
    .get(post_key, req.user.username, reaction);
  if (existing) {
    db.prepare('DELETE FROM post_reactions WHERE post_key=? AND username=? AND reaction=?')
      .run(post_key, req.user.username, reaction);
  } else {
    db.prepare('INSERT INTO post_reactions (post_key, username, reaction) VALUES (?,?,?)')
      .run(post_key, req.user.username, reaction);
  }
  backupDb();
  res.json({ ok: true });
});

// ── Views ────────────────────────────────────────────────────
app.post('/api/views', (req, res) => {
  const { post_key } = req.body;
  if (!post_key) return res.json({ ok: false, error: 'Неверные параметры.' });
  // Для авторизованных — username (INSERT OR IGNORE гарантирует 1 просмотр на пользователя)
  // Для анонимов — IP + User-Agent (стабильный идентификатор; обновление страницы не даёт +1)
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const ua = (req.headers['user-agent'] || '').slice(0, 64);
  const viewerId = req.user?.username || ('anon_' + ip + '_' + ua);
  db.prepare('INSERT OR IGNORE INTO post_views (post_key, username, count) VALUES (?,?,1)')
    .run(post_key, viewerId);
  backupDb();
  res.json({ ok: true });
});

app.get('/api/admin/admins', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  res.json({ ok: true, admins: db.prepare('SELECT username FROM admin_usernames').all().map(r => r.username) });
});

app.post('/api/admin/admins', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  const { username } = req.body;
  if (!username) return res.json({ ok: false, error: 'Укажите username.' });
  const clean = username.toLowerCase().replace(/^@/, '');
  db.prepare('INSERT OR IGNORE INTO admin_usernames (username) VALUES (?)').run(clean);
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(clean);
  if (user) {
    let tags = JSON.parse(user.active_tags || '["BEGINNER"]');
    if (!tags.includes('ADMIN')) tags.push('ADMIN');
    db.prepare('UPDATE users SET active_tags=? WHERE username=?').run(JSON.stringify(tags), clean);
  }
  backupDb();
  res.json({ ok: true });
});

app.delete('/api/admin/admins/:username', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  const clean = req.params.username.toLowerCase();
  db.prepare('DELETE FROM admin_usernames WHERE username=?').run(clean);
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(clean);
  if (user) {
    let tags = JSON.parse(user.active_tags || '["BEGINNER"]').filter(t => t !== 'ADMIN');
    db.prepare('UPDATE users SET active_tags=? WHERE username=?').run(JSON.stringify(tags), clean);
  }
  backupDb();
  res.json({ ok: true });
});

app.get('/api/admin/users', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  const users = db.prepare('SELECT id,username,nickname,avatar,verified,active_tags,created_at,provider FROM users ORDER BY created_at DESC').all();
  const stats = { threads: db.prepare('SELECT COUNT(*) as c FROM threads').get().c,
                  replies: db.prepare('SELECT COUNT(*) as c FROM replies').get().c,
                  sectionPosts: db.prepare('SELECT COUNT(*) as c FROM section_posts').get().c };
  res.json({ ok: true, users, stats });
});

app.get('/api/admin/db-export', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  res.download(DB_PATH);
});

app.post('/api/admin/db-import', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  res.json({ ok: false, error: 'Используй прямой SCP/SFTP для замены forum.db.' });
});

// ── Moderator management ──────────────────────────────────────
app.get('/api/admin/moderators', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  res.json({ ok: true, moderators: db.prepare('SELECT username FROM moderators').all().map(r => r.username) });
});

app.post('/api/admin/moderators', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  const { username } = req.body;
  if (!username) return res.json({ ok: false, error: 'Укажите username.' });
  const clean = username.toLowerCase().replace(/^@/, '');
  db.prepare('INSERT OR IGNORE INTO moderators (username) VALUES (?)').run(clean);
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(clean);
  if (user) {
    let tags = JSON.parse(user.active_tags || '["BEGINNER"]');
    if (!tags.includes('MODERATOR')) tags.push('MODERATOR');
    db.prepare('UPDATE users SET active_tags=? WHERE username=?').run(JSON.stringify(tags), clean);
  }
  backupDb();
  res.json({ ok: true });
});

app.delete('/api/admin/moderators/:username', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  const clean = req.params.username.toLowerCase();
  db.prepare('DELETE FROM moderators WHERE username=?').run(clean);
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(clean);
  if (user) {
    let tags = JSON.parse(user.active_tags || '["BEGINNER"]').filter(t => t !== 'MODERATOR');
    db.prepare('UPDATE users SET active_tags=? WHERE username=?').run(JSON.stringify(tags), clean);
  }
  backupDb();
  res.json({ ok: true });
});

// ── Owner management ──────────────────────────────────────────
app.get('/api/admin/owners', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  res.json({ ok: true, owners: db.prepare('SELECT username FROM owners').all().map(r => r.username) });
});

app.post('/api/admin/owners', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  const { username } = req.body;
  if (!username) return res.json({ ok: false, error: 'Укажите username.' });
  const clean = username.toLowerCase().replace(/^@/, '');
  db.prepare('INSERT OR IGNORE INTO owners (username) VALUES (?)').run(clean);
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(clean);
  if (user) {
    let tags = JSON.parse(user.active_tags || '["BEGINNER"]');
    if (!tags.includes('OWNER')) tags.push('OWNER');
    db.prepare('UPDATE users SET active_tags=? WHERE username=?').run(JSON.stringify(tags), clean);
  }
  backupDb();
  res.json({ ok: true });
});

app.delete('/api/admin/owners/:username', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  const clean = req.params.username.toLowerCase();
  db.prepare('DELETE FROM owners WHERE username=?').run(clean);
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(clean);
  if (user) {
    let tags = JSON.parse(user.active_tags || '["BEGINNER"]').filter(t => t !== 'OWNER');
    db.prepare('UPDATE users SET active_tags=? WHERE username=?').run(JSON.stringify(tags), clean);
  }
  backupDb();
  res.json({ ok: true });
});

// ── Chief Moderator management ──────────────────────────────────
app.get('/api/admin/chief-moderators', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  res.json({ ok: true, chiefModerators: db.prepare('SELECT username FROM chief_moderators').all().map(r => r.username) });
});

app.post('/api/admin/chief-moderators', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  const { username } = req.body;
  if (!username) return res.json({ ok: false, error: 'Укажите username.' });
  const clean = username.toLowerCase().replace(/^@/, '');
  db.prepare('INSERT OR IGNORE INTO chief_moderators (username) VALUES (?)').run(clean);
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(clean);
  if (user) {
    let tags = JSON.parse(user.active_tags || '["BEGINNER"]');
    if (!tags.includes('CHIEF_MODERATOR')) tags.push('CHIEF_MODERATOR');
    db.prepare('UPDATE users SET active_tags=? WHERE username=?').run(JSON.stringify(tags), clean);
  }
  backupDb();
  res.json({ ok: true });
});

app.delete('/api/admin/chief-moderators/:username', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  const clean = req.params.username.toLowerCase();
  db.prepare('DELETE FROM chief_moderators WHERE username=?').run(clean);
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(clean);
  if (user) {
    let tags = JSON.parse(user.active_tags || '["BEGINNER"]').filter(t => t !== 'CHIEF_MODERATOR');
    db.prepare('UPDATE users SET active_tags=? WHERE username=?').run(JSON.stringify(tags), clean);
  }
  backupDb();
  res.json({ ok: true });
});

// ── Deputy Chief Moderator management ───────────────────────────
app.get('/api/admin/deputy-chief-moderators', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  res.json({ ok: true, deputyChiefModerators: db.prepare('SELECT username FROM deputy_chief_moderators').all().map(r => r.username) });
});

app.post('/api/admin/deputy-chief-moderators', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  const { username } = req.body;
  if (!username) return res.json({ ok: false, error: 'Укажите username.' });
  const clean = username.toLowerCase().replace(/^@/, '');
  db.prepare('INSERT OR IGNORE INTO deputy_chief_moderators (username) VALUES (?)').run(clean);
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(clean);
  if (user) {
    let tags = JSON.parse(user.active_tags || '["BEGINNER"]');
    if (!tags.includes('DEPUTY_CHIEF_MODERATOR')) tags.push('DEPUTY_CHIEF_MODERATOR');
    db.prepare('UPDATE users SET active_tags=? WHERE username=?').run(JSON.stringify(tags), clean);
  }
  backupDb();
  res.json({ ok: true });
});

app.delete('/api/admin/deputy-chief-moderators/:username', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  const clean = req.params.username.toLowerCase();
  db.prepare('DELETE FROM deputy_chief_moderators WHERE username=?').run(clean);
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(clean);
  if (user) {
    let tags = JSON.parse(user.active_tags || '["BEGINNER"]').filter(t => t !== 'DEPUTY_CHIEF_MODERATOR');
    db.prepare('UPDATE users SET active_tags=? WHERE username=?').run(JSON.stringify(tags), clean);
  }
  backupDb();
  res.json({ ok: true });
});

// ── Pin / Status for section posts ──────────────────────────────
app.patch('/api/sections/:section/:postId/pin', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  const post = db.prepare('SELECT * FROM section_posts WHERE id=?').get(req.params.postId);
  if (!post) return res.json({ ok: false, error: 'Пост не найден.' });
  const newVal = post.pinned ? 0 : 1;
  db.prepare('UPDATE section_posts SET pinned=? WHERE id=?').run(newVal, req.params.postId);
  backupDb();
  res.json({ ok: true, pinned: !!newVal });
});

app.patch('/api/sections/:section/:postId/status', (req, res) => {
  if (!req.user || !isStaff(req.user.username))
    return res.json({ ok: false, error: 'Нет доступа.' });
  const { status } = req.body;
  if (!['new', 'read', 'pending'].includes(status))
    return res.json({ ok: false, error: 'Некорректный статус.' });
  db.prepare('UPDATE section_posts SET status=? WHERE id=?').run(status, req.params.postId);
  backupDb();
  res.json({ ok: true });
});

// ── Server-side rate limiting ────────────────────────────────────
const RATE_LIMIT = { maxPerHour: 8, cooldownMs: 30000 };
app.post('/api/check-rate', (req, res) => {
  const { action } = req.body;
  if (!action) return res.json({ ok: false });
  const username = req.user?.username || 'anon_' + (req.ip || '0');
  const now = new Date().toISOString();
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const cooldownAgo = new Date(Date.now() - RATE_LIMIT.cooldownMs).toISOString();
  const recent = db.prepare(
    "SELECT COUNT(*) as c FROM rate_limits WHERE username=? AND action=? AND created_at>?"
  ).get(username, action, hourAgo);
  if (recent.c >= RATE_LIMIT.maxPerHour) {
    return res.json({ ok: false, error: 'Превышен лимит. Попробуйте через час.' });
  }
  const lastAction = db.prepare(
    "SELECT created_at FROM rate_limits WHERE username=? AND action=? AND created_at>? ORDER BY created_at DESC LIMIT 1"
  ).get(username, action, cooldownAgo);
  if (lastAction) {
    const elapsed = Date.now() - new Date(lastAction.created_at).getTime();
    const wait = Math.ceil((RATE_LIMIT.cooldownMs - elapsed) / 1000);
    return res.json({ ok: false, error: `Подождите ${wait} сек.`, wait });
  }
  db.prepare("INSERT INTO rate_limits (username, action) VALUES (?,?)").run(username, action);
  // Clean old entries
  db.prepare("DELETE FROM rate_limits WHERE created_at<?").run(hourAgo);
  res.json({ ok: true });
});

// ── Manual backup trigger ─────────────────────────────────────
app.post('/api/admin/backup', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  backupDb();
  res.json({ ok: true, message: 'Backup started to Google Drive' });
});

// ── Health check endpoint (for Railway load balancer) ────────────
app.get('/health', (req, res) => {
  try {
    // Quick DB check
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', uptime: process.uptime(), db: 'connected' });
  } catch (e) {
    res.status(503).json({ status: 'error', message: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Graceful shutdown ───────────────────────────────────────────
function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  db.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Start server ────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`OSINT Forum запущен на порту ${PORT}`);
  console.log(`Локально: http://localhost:${PORT}`);
  // Periodic backup every 5 minutes
  setInterval(backupDb, 5 * 60 * 1000);
});

// Server-level error handling
server.on('error', (err) => {
  console.error('Server error:', err.message);
});

console.log("=== Server module loaded ===");
