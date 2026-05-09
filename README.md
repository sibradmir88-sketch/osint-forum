# OSINT Forum v2.0 — Setup Guide

## Что изменилось
- ✅ Все данные хранятся в SQLite базе (файл `db/forum.db`)
- ✅ Форум, вопросы и аккаунты доступны со ВСЕХ устройств
- ✅ Вход через Google и ВКонтакте (настоящий OAuth)
- ✅ Оптимизация под мобильные устройства

---

## Шаг 1 — Установить зависимости

```bash
npm install
```

---

## Шаг 2 — Создать .env файл

```bash
cp .env.example .env
```

Открой `.env` и заполни:

```
SESSION_SECRET=любая_случайная_строка_32+_символа
BASE_URL=https://твой-ngrok-url.ngrok-free.app
```

---

## Шаг 3 — Получить ключи OAuth (опционально)

### Google OAuth
1. Зайди на https://console.cloud.google.com
2. Создай новый проект
3. APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
4. Application type: Web application
5. Authorized redirect URIs добавь: `https://ТВО_НГРОК.ngrok-free.app/auth/google/callback`
6. Скопируй Client ID и Client Secret в `.env`

### VK OAuth
1. Зайди на https://vk.com/dev → Мои приложения → Создать
2. Тип: Веб-сайт
3. Адрес сайта: `https://ТВО_НГРОК.ngrok-free.app`
4. В настройках → скопируй ID приложения и Защищённый ключ в `.env`

> Если не добавлять ключи — форум работает, просто без кнопок Google/VK.

---

## Шаг 4 — Запустить

```bash
# Запуск сервера
node server.js

# В другом терминале — запуск ngrok
ngrok http 3000
```

После запуска ngrok — скопируй URL (типа `https://abc123.ngrok-free.app`)
и обнови `BASE_URL` в `.env`, затем перезапусти сервер.

---

## Важно: каждый раз когда меняется ngrok URL

1. Обнови `BASE_URL` в `.env`
2. Обнови Redirect URI в Google Console и VK
3. Перезапусти `node server.js`

---

## Файлы проекта

```
osint-forum/
├── server.js          ← Express сервер, OAuth, API
├── package.json
├── .env               ← Твои секреты (не публикуй!)
├── .env.example       ← Пример конфига
├── db/
│   └── forum.db       ← SQLite база (создаётся автоматически)
└── public/
    └── index.html     ← Фронтенд
```
