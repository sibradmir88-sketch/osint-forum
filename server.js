console.log("=== OSINT Forum starting ===");
console.log("CWD:", process.cwd());
console.log("PORT:", process.env.PORT);
console.log("NODE_ENV:", process.env.NODE_ENV);

require("dotenv").config();
const express       = require('express');
const session       = require('express-session');
const Database      = require('better-sqlite3');
const path          = require('path');
const crypto        = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
  sessionSecret : process.env.SESSION_SECRET || 'CHANGE_ME_SECRET_32chars_min',
};

const db = new Database('forum.db');
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

['illuminatov', 'detailing'].forEach(u => {
  db.prepare("INSERT OR IGNORE INTO admin_usernames (username) VALUES (?)").run(u);
});

function isAdmin(username) {
  if (!username) return false;
  return !!db.prepare("SELECT username FROM admin_usernames WHERE username=?").get(username.toLowerCase());
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + 'osint_salt_42').digest('hex');
}

function safeUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, nickname: u.nickname || u.username,
           avatar: u.avatar, avatar_img: u.avatar_img, provider: u.provider,
           active_tags: JSON.parse(u.active_tags || '["BEGINNER"]'),
           is_admin: isAdmin(u.username) };
}

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret           : CONFIG.sessionSecret,
  resave           : false,
  saveUninitialized: false,
  cookie           : { maxAge: 7 * 24 * 3600 * 1000, sameSite: 'lax' },
}));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  req.user = req.session?.user || null;
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
  loginUser(req, res, user);
});

app.post('/api/auth/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.json({ ok: false, error: 'Заполните все поля.' });

  const user = db.prepare('SELECT * FROM users WHERE username=? OR email=?')
                 .get(login.toLowerCase(), login.toLowerCase());
  if (!user) return res.json({ ok: false, error: 'Пользователь не найден.' });
  if (user.password_hash !== hashPassword(password))
    return res.json({ ok: false, error: 'Неверный пароль.' });

  loginUser(req, res, user);
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: safeUser(req.user) });
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
    WHERE t.topic LIKE ? ORDER BY ${order}
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
  const author_id = req.user?.id || null;
  const info = db.prepare(
    `INSERT INTO threads (type, topic, text, author_id, anonymous) VALUES (?,?,?,?,?)`
  ).run(type || 'paste', topic.trim(), text.trim(), author_id, anonymous ? 1 : 0);
  res.json({ ok: true, thread: db.prepare('SELECT * FROM threads WHERE id=?').get(info.lastInsertRowid) });
});

app.post('/api/threads/:id/replies', (req, res) => {
  const { text, anonymous } = req.body;
  if (!text?.trim()) return res.json({ ok: false, error: 'Пустой ответ.' });
  if (!db.prepare('SELECT id FROM threads WHERE id=?').get(req.params.id))
    return res.json({ ok: false, error: 'Тема не найдена.' });
  db.prepare(
    `INSERT INTO replies (thread_id, text, author_id, anonymous) VALUES (?,?,?,?)`
  ).run(req.params.id, text.trim(), req.user?.id || null, anonymous ? 1 : 0);
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
  const info = db.prepare(
    `INSERT INTO section_posts (section, text, author_id) VALUES (?,?,?)`
  ).run(req.params.section, text.trim(), req.user?.id || null);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.post('/api/sections/:section/:postId/replies', (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.json({ ok: false, error: 'Пустой ответ.' });
  db.prepare(
    `INSERT INTO section_replies (post_id, text, author_id) VALUES (?,?,?)`
  ).run(req.params.postId, text.trim(), req.user?.id || null);
  res.json({ ok: true });
});

app.delete('/api/sections/:section/:postId', (req, res) => {
  const post = db.prepare('SELECT * FROM section_posts WHERE id=?').get(req.params.postId);
  if (!post) return res.json({ ok: false, error: 'Пост не найден.' });
  if (post.author_id !== req.user?.id) return res.json({ ok: false, error: 'Только автор может удалить.' });
  db.prepare('DELETE FROM section_posts WHERE id=?').run(req.params.postId);
  res.json({ ok: true });
});

app.delete('/api/sections/:section/:postId/replies/:replyId', (req, res) => {
  const reply = db.prepare('SELECT * FROM section_replies WHERE id=?').get(req.params.replyId);
  if (!reply) return res.json({ ok: false, error: 'Ответ не найден.' });
  if (reply.author_id !== req.user?.id) return res.json({ ok: false, error: 'Только автор может удалить.' });
  db.prepare('DELETE FROM section_replies WHERE id=?').run(req.params.replyId);
  res.json({ ok: true });
});

app.get('/api/users/:username', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(req.params.username.toLowerCase());
  if (!user) return res.json({ ok: false, error: 'Пользователь не найден.' });
  res.json({ ok: true, user: safeUser(user) });
});

app.patch('/api/users/me', (req, res) => {
  if (!req.user) return res.json({ ok: false, error: 'Не авторизован.' });
  const { nickname, avatar, active_tags } = req.body;
  db.prepare('UPDATE users SET nickname=?, avatar=?, active_tags=? WHERE id=?')
    .run(nickname || req.user.nickname, avatar || req.user.avatar,
         active_tags ? JSON.stringify(active_tags) : (req.user.active_tags || '["BEGINNER"]'), req.user.id);
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
  res.download('forum.db');
});

app.post('/api/admin/db-import', (req, res) => {
  if (!req.user || !isAdmin(req.user.username)) return res.json({ ok: false, error: 'Нет доступа.' });
  res.json({ ok: false, error: 'Используй прямой SCP/SFTP для замены forum.db.' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OSINT Forum запущен на порту ${PORT}`);
  console.log(`Локально: http://localhost:${PORT}`);
});
console.log("=== Server module loaded ===");
