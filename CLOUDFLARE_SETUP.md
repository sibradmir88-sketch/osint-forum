# Бесплатный красивый домен через Cloudflare Workers

## За 2 минуты в браузере

---

### Шаг 1. Создай аккаунт Cloudflare

1. Открой https://dash.cloudflare.com/sign-up
2. Введи почту, придумай пароль
3. Подтверди почту (придёт письмо)
4. Выбери **Free** план

**Работает в России без VPN.** Cloudflare не заблокирован.

---

### Шаг 2. Создай Worker

1. Зайди в **Workers & Pages** (левое меню)
2. Нажми **Create Application** → **Create Worker**
3. Введи имя: **`osint-forum`**

   > После этого сайт будет доступен по адресу:  
   > `https://osint-forum.workers.dev`

4. В редакторе кода **удали всё** и вставь код из файла:

👉 **Файл `worker.js`** в папке проекта (я его уже написал)

Или скопируй отсюда:

```js
const UPSTREAM = 'https://osint-forum-production.up.railway.app';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const targetUrl = UPSTREAM + url.pathname + url.search;

    const headers = new Headers(request.headers);
    headers.set('Host', new URL(UPSTREAM).host);

    const init = {
      method: request.method,
      headers,
      redirect: 'follow',
    };

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      init.body = request.body;
    }

    try {
      const response = await fetch(targetUrl, init);
      const respHeaders = new Headers(response.headers);
      respHeaders.set('Access-Control-Allow-Origin', '*');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
      });
    } catch (err) {
      return new Response('Сервер временно недоступен', {
        status: 502,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  },
};
```

5. Нажми **Save and Deploy** (синенькая кнопка)

---

### ✅ Готово!

Твой форум теперь доступен по адресу:

👉 **https://osint-forum.workers.dev**

Коротко, красиво, HTTPS, работает в России.

---

### Если форум не открывается

1. Убедись, что Railway не уснул:
   - Зайди в https://railway.app → Project → **Settings**
   - Включи **Always On** (бесплатно даёт ~$5 кредита, хватает)
   - Или просто открой `https://osint-forum-production.up.railway.app` вручную — Railway проснётся

2. Если Worker выдаёт 502 — подожди 10 секунд и обнови страницу

---

### Как удалить, если передумаешь

Cloudflare → Workers & Pages → Нажать на **osint-forum** → Три точки **Delete**
