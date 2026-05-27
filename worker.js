// ═══════════════════════════════════════════════════════════════
// Cloudflare Worker — Reverse Proxy для OSINT Forum
// Деплой: https://dash.cloudflare.com → Workers & Pages → Create
// После деплоя сайт будет доступен по адресу:
//   https://osint-forum.workers.dev
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

    // Body для POST/PUT/PATCH
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

      // Копируем ответ
      const respHeaders = new Headers(response.headers);
      respHeaders.set('Access-Control-Allow-Origin', '*');
      respHeaders.set('X-Robots-Tag', 'all');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Сервер временно недоступен. Попробуйте позже.' }),
        {
          status: 502,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }
  },
};
