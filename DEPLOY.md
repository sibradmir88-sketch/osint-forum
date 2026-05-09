# 🚀 OSINT Forum — Деплой и настройка

## ✅ Что было добавлено

### 1. Система тегов (13 тегов)
| Тег | Как получить | Цвет |
|-----|-------------|------|
| 🔰 BEGINNER | Автоматически при регистрации | Синий |
| ⚡ OSINT'ER | После первого поста на форуме | Фиолетовый (мигает) |
| 👑 ADMIN | Только через админ-панель | Красный (мигает) |
| 🌍 GEOINT'ER | Свободный выбор в профиле | Зелёный |
| 💻 CSINT'ER | Свободный выбор | Синий |
| 🕵️ HUMINT'ER | Свободный выбор | Розовый |
| 📡 SIGINT'ER | Свободный выбор | Жёлтый |
| 🛰️ IMINT'ER | Свободный выбор | Голубой |
| ⚗️ MASINT'ER | Свободный выбор | Сиреневый |
| 🔓 CYBINT'ER | Свободный выбор (мигает) | Зелёный неон |
| ⚙️ TECHINT'ER | Свободный выбор | Золотой |
| 💰 FININT'ER | Свободный выбор | Циан |
| 📱 SOCMINT'ER | Свободный выбор | Розово-малиновый |

- Теги отображаются рядом с никнеймом везде на сайте
- Можно выбрать несколько тегов одновременно
- Выбор тегов — в настройках профиля

### 2. Админ-панель
- Доступ только у юзернеймов из списка администраторов
- Предустановлены: **@illuminatov** и **@detailing**
- Панель показывает статистику, список пользователей, управление админами
- Ссылка "⚡ Админ" в навбаре появляется только у администраторов

### 3. SQL база данных (SQLite)
- Файл `forum.db` — полноценная SQL база, не localStorage
- Хранит всех пользователей, посты, теги, администраторов
- Работает через бэкенд `server.js` (Node.js + Express)

### 4. OAuth (уже готов в коде!)
- Google OAuth и VK OAuth уже написаны
- Нужно только вставить ключи (см. ниже)

---

## 🛠️ Запуск локально

```bash
cd osint-forum
npm install
node server.js
# Открой http://localhost:3000
```

---

## ☁️ Бесплатный хостинг — Railway.app (рекомендую)

**Railway** — лучший вариант: бесплатный план, Node.js, SQLite, почти 24/7.

### Шаги:
1. Зарегистрируйся на [railway.app](https://railway.app)
2. Создай проект → "Deploy from GitHub repo"
3. Загрузи папку `osint-forum` на GitHub (приватный репозиторий)
4. Подключи репозиторий к Railway
5. В настройках Railway → Variables добавь:
   ```
   SESSION_SECRET=какой_то_длинный_секрет_32символа
   BASE_URL=https://твой-проект.up.railway.app
   PORT=3000
   ```
6. Railway автоматически запустит `node server.js`
7. Твой сайт будет доступен по адресу `https://твой-проект.up.railway.app`

### Домен
- Бесплатно: `osintforum.up.railway.app`
- Платно: `osintforum.ru` (~150 руб/год на reg.ru) → подключается в настройках Railway

---

## 🔑 OAuth — Google

1. Перейди на [console.cloud.google.com](https://console.cloud.google.com)
2. Создай проект → APIs & Services → Credentials
3. Create OAuth 2.0 Client ID (Web application)
4. Authorized redirect URI: `https://твой-домен/auth/google/callback`
5. Скопируй Client ID и Client Secret
6. В Railway Variables добавь:
   ```
   GOOGLE_CLIENT_ID=твой_client_id
   GOOGLE_CLIENT_SECRET=твой_client_secret
   ```

---

## 🔑 OAuth — VK

1. Перейди на [vk.com/dev](https://vk.com/dev)
2. Создай приложение (Сайт)
3. Базовый домен: твой домен
4. Redirect URL: `https://твой-домен/auth/vk/callback`
5. Скопируй ID приложения и защищённый ключ
6. В Railway Variables добавь:
   ```
   VK_APP_ID=12345678
   VK_APP_SECRET=твой_секрет
   ```

---

## 🗃️ База данных — где хранится

- Локально: файл `forum.db` в папке проекта
- На Railway: файл живёт на сервере (сбрасывается при передеплое!)
- **Для постоянного хранения на Railway** → подключи Railway PostgreSQL (бесплатно):
  - Dashboard → New → Database → PostgreSQL
  - Или используй **PlanetScale** (бесплатный MySQL/PostgreSQL)

### Альтернатива — Supabase (бесплатная PostgreSQL навсегда)
1. [supabase.com](https://supabase.com) → New project
2. Получи `DATABASE_URL`
3. Замени `better-sqlite3` на `pg` (потребует небольшой рефактор server.js)

---

## 📁 Структура проекта

```
osint-forum/
├── server.js          ← бэкенд (Node.js + Express + SQLite)
├── forum.db           ← база данных SQLite
├── package.json
├── .env               ← секреты (не заливай на GitHub!)
├── .env.example       ← шаблон для секретов
├── public/
│   └── index.html     ← весь фронтенд (SPA)
└── DEPLOY.md          ← этот файл
```

---

## ❗ ВАЖНО — безопасность

- Никогда не заливай `.env` на GitHub!
- Добавь `.env` в `.gitignore`
- Используй переменные окружения Railway для секретов
