# 🚀 OSINT Forum — Production Deployment (24/7, Бесплатно)

## 📦 Быстрый старт на Railway (бесплатно, 24/7)

### Шаг 1: Подготовка репозитория
```bash
cd /home/radmir/osint-forum

# Убедись, что .env НЕ попадёт в git
echo ".env" >> .gitignore
echo "forum.db" >> .gitignore

# Сделай коммит
git add .
git commit -m "Production-ready: crash handlers, health check, Dockerfile"
git push
```

### Шаг 2: Деплой на Railway

1. Зайди на [Railway.app](https://railway.app) → GitHub login
2. Нажми **New Project** → **Deploy from GitHub repo**
3. Выбери `sibradmir88-sketch/osint-forum`
4. После деплоя перейди в **Settings** → **Domains**:
   - Добавь кастомный домен: **osintforum.net**
   - Если домена пока нет, Railway даст бесплатный `*.up.railway.app`
5. Перейди в **Settings** → **Volumes**:
   - Нажми **Add Volume**
   - Mount path: `/data`
   - Размер: 1 GB (бесплатно)
6. Перейди в **Variables** → добавь:
   ```
   SESSION_SECRET=osint_forum_sup3r_s3cr3t_k3y_2024_xyz_42!
   NODE_ENV=production
   PORT=3000
   ```

### Шаг 3: Проверка

Открой `https://osintforum.net/health` — должен ответить:
```json
{ "status": "ok", "uptime": 123, "db": "connected" }
```

## 🔥 Как работает защита от крашей

### 1. Обработка глобальных ошибок (`server.js`)
```js
process.on('uncaughtException', (err) => {
  console.error(err);
  // НЕ завершаем процесс — продолжаем работать
});
process.on('unhandledRejection', (reason) => {
  console.error(reason);
  // НЕ завершаем процесс — продолжаем работать
});
```

### 2. Health check endpoint
Railway每隔30s проверяет `/health`. Если ответ не 200 — Railway перезапускает контейнер.

### 3. Graceful shutdown
При SIGTERM/SIGINT (рестарт, деплой) — БД корректно закрывается перед выходом.

### 4. Docker + tini
- Используется `tini` как init-процесс (правильно обрабатывает сигналы)
- `HEALTHCHECK` в Dockerfile

### 5. Volume для БД
База данных хранится на постоянном Volume (`/data/forum.db`), а не в контейнере.
При редеплое данные НЕ теряются.

## 🗄️ Всё в SQL, никакого localStorage

- Все пользователи, посты, теги, реакции, просмотры — в SQLite
- Сессии хранятся в SQLite (не в памяти)
- Тема оформления — на сервере (в БД)
- При входе с любого устройства — все данные синхронизируются

## 🌐 Поддержка всех устройств

- iOS Safari — корректная работа
- Android Chrome — корректная работа
- iPad — планшетная верстка
- Windows/macOS/Linux — десктоп

## 📊 Мониторинг (бесплатно)

- **Railway Dashboard** — логи, метрики, статус
- **Health check** — `/health` endpoint
- **UptimeRobot** (uptimerobot.com) — бесплатный мониторинг 24/7

## 🛠 Локальный запуск

```bash
cd /home/radmir/osint-forum
npm install
node server.js
# Открой http://localhost:3000
```

## 🔄 Обновление

```bash
cd /home/radmir/osint-forum
git add .
git commit -m "fix: что-то починил"
git push
# Railway автоматически передеплоит
```

## 🆘 Если что-то пошло не так

1. Проверь логи в Railway Dashboard → **Deployments** → **View Logs**
2. Проверь `/health` endpoint
3. Убедись, что Volume примонтирован (`/data`)
4. Если БД повреждена — восстанови из бекапа
5. Если ничего не помогло — удали Volume и создай новый
