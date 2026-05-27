// ═══════════════════════════════════════════════════════════════
// Cloudflare Pages _worker.js — Reverse Proxy для OSINT Forum
// Все запросы проксируются на Railway (Express + SQLite)
// ═══════════════════════════════════════════════════════════════

const UPSTREAM = 'https://osint-forum-production.up.railway.app';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const targetUrl = UPSTREAM + url.pathname + url.search;

    // Копируем заголовки
    const headers = new Headers(request.headers);
    headers.set('Host', new URL(UPSTREAM).host);
    headers.set('X-Forwarded-Host', url.hostname);
    headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
    headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') || '');

    // Формируем запрос к Railway
    const init = {
      method: request.method,
      headers,
      redirect: 'follow',
    };

    // Тело запроса для POST/PUT/PATCH/DELETE
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    try {
      const response = await fetch(targetUrl, init);

      // Возвращаем ответ как есть
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (err) {
      // Если Railway недоступен — показываем понятную ошибку
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Сервер временно недоступен. Railway, возможно, проснулся? Обновите страницу через 10 секунд.',
        }),
        {
          status: 502,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          },
        }
      );
    }
  },
};
