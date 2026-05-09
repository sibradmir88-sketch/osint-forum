# OSINT Forum v2.0 — Setup Guide

## Что изменилось
- ✅ Все данные хранятся в SQLite базе (файл `forum.db`)
- ✅ Форум, вопросы и аккаунты доступны со ВСЕХ устройств
- ✅ Полная кросс-девайс синхронизация тегов (ADMIN, MODERATOR, OWNER)
- ✅ Авто-бэкап базы данных на Google Drive
- ✅ Оптимизация под мобильные устройства

---

## Railway Deployment

### 1. Подключи репозиторий к Railway

Создай новый проект в Railway, подключи GitHub репозиторий.

### 2. Настрой Volume (ОБЯЗАТЕЛЬНО)

В Railway создай Volume:
- **Mount path**: `/data`
- Это сохранит `forum.db` между редеплоями

### 3. Переменные окружения

В Railway -> Variables добавь:

```
SESSION_SECRET=любая_случайная_строка_32+_символа
PORT=3000
```

### 4. Деплой

Railway автоматически соберёт Dockerfile и запустит контейнер.

---

## Google Drive Backup (локально)

На своей машине (не на Railway):

```bash
# Установить rclone (один раз)
curl https://rclone.org/install.sh | sudo bash

# Настроить Google Drive
rclone config

# Создать папку для бэкапов
rclone mkdir gdrive:osint-forum-backup

# Запустить бэкап
bash backup-db.sh
```

---

## Файлы проекта

```
osint-forum/
├── server.js          ← Express сервер + SQLite
├── package.json
├── .env               ← Твои секреты (не публикуй!)
├── .env.example       ← Пример конфига
├── Dockerfile         ← Сборка для Railway
├── backup-db.sh       ← Бэкап на Google Drive
├── restore-db.sh      ← Восстановление с Google Drive
├── forum.db           ← SQLite база (создаётся автоматически)
└── public/
    └── index.html     ← Фронтенд (SPA)
```
