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

---

## 🌐 Настройка бесплатного домена DuckDNS

### Шаг 1: Регистрация
1. Зайди на [duckdns.org](https://duckdns.org)
2. Войди через GitHub / Twitter / Google
3. В разделе **domains** введи желаемое имя (например `osintforum`) и нажми **add domain**
4. Скопируй **token** (длинная строка)

### Шаг 2: Настройка на сервере
Добавь в Railway **Variables**:
```
DUCKDNS_DOMAIN=osintforum
DUCKDNS_TOKEN=твой_токен_с_duckdns
BASE_URL=https://osintforum.duckdns.org
```

Или в `.env` локально (для теста):
```
DUCKDNS_DOMAIN=osintforum
DUCKDNS_TOKEN=токен
```

### Шаг 3: Как это работает
Сервер автоматически:
- Обновляет DuckDNS A-запись каждые 5 минут
- Подставляет твой DuckDNS-адрес как BASE_URL
- При редеплое Railway IP может меняться — DuckDNS сам подхватит новый IP

### Шаг 4: HTTPS
DuckDNS поддерживает Let's Encrypt! После настройки сервер получит SSL-сертификат. Сайт будет доступен по `https://osintforum.duckdns.org`

### Шаг 5: (Опционально) Свой домен
Если захочешь купить настоящий домен (например `osintforum.ru` ~150 руб/год):
1. Купи домен на reg.ru / nic.ru
2. В настройках DNS добавь CNAME запись: `@` → `osint-forum-production.up.railway.app`
3. В Railway Dashboard → Settings → Domains добавь свой домен
4. Railway сам выдаст SSL-сертификат
