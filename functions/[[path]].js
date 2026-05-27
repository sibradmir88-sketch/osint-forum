// ═══════════════════════════════════════════════════════════════
// Cloudflare Pages Function — Catch-all reverse proxy
// Любой запрос к Pages проксируется на Railway (Express + SQLite)
// ═══════════════════════════════════════════════════════════════

const UPSTREAM = 'https://osint-forum-production.up.railway.app';

export async function onRequest(context) {
  const { request } = context;
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
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Сервер временно недоступен. Обновите страницу через 10 секунд.',
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
}
