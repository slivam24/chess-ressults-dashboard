// Prostředník (CORS proxy) pro dashboard, běží zdarma jako Cloudflare Worker.
//
// chess-results.com nedovoluje stránce z jiného webu číst svůj obsah. Tenhle Worker stránku
// turnaje stáhne a pošle ji dál s hlavičkou Access-Control-Allow-Origin, takže ji dashboard
// může načítat přímo, každých 30 sekund a pro jakýkoli turnaj.
//
// Pustí jen stránky turnajů na chess-results.com (tnrČÍSLO.aspx), nic jiného.
// Použití: https://<tvůj-worker>.workers.dev/?url=https://chess-results.com/tnr1529674.aspx?lan=5&art=2
//
// Nasazení: viz README, oddíl „Živé načítání každých 30 sekund“.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const reply = (body, status, extra = {}) =>
  new Response(body, { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', ...extra } });

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return reply('Jen GET.', 405);

    const raw = new URL(request.url).searchParams.get('url');
    if (!raw) return reply('Prostředník pro dashboard běží. Chybí parametr ?url=', 200);

    let target;
    try {
      target = new URL(raw);
    } catch {
      return reply('Neplatná adresa.', 400);
    }
    const okHost = /^(?:[a-z0-9-]+\.)?chess-results\.com$/i.test(target.hostname);
    const okPath = /^\/tnr\d{1,9}\.aspx$/i.test(target.pathname);
    if (target.protocol !== 'https:' || !okHost || !okPath) {
      return reply('Povolené jsou jen stránky turnajů na chess-results.com.', 403);
    }

    try {
      const res = await fetch(target.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; chess-ressults-dashboard)',
          'Accept-Language': 'cs,en;q=0.7',
        },
        redirect: 'follow',
        // krátká mezipaměť: víc obrazovek se stejným turnajem nezatěžuje chess-results
        cf: { cacheTtl: 15, cacheEverything: true },
      });
      return new Response(await res.text(), {
        status: res.status,
        headers: { ...CORS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=10' },
      });
    } catch (e) {
      return reply(`chess-results neodpověděl: ${e.message}`, 502);
    }
  },
};
