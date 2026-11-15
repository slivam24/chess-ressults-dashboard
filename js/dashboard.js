// Dashboard: vlevo a vpravo los aktuálního kola dvou turnajů z chess-results.com.
//
// chess-results nepovoluje čtení z cizích stránek (CORS). Data proto jdou dvěma cestami:
//   živě:    přes vlastního prostředníka (Cloudflare Worker, cloudflare-worker.js) každých 30 s,
//            pro jakýkoli turnaj zadaný na stránce,
//   GitHub:  bez prostředníka los stahuje úloha .github/workflows/dashboard.yml do větve
//            dashboard-data (jen turnaje ze scripts/dashboard.json, zhruba po 10 minutách).
// Turnaj bez dat se ukáže přímo jako stránka chess-results (obnovuje se každých 30 s).
//
// Parametry adresy:
//   ?vlevo=1516901&vpravo=1507857   turnaje (číslo nebo odkaz)
//   ?proxy=<adresa Workeru>         prostředník pro živé načítání (zapamatuje se v prohlížeči)
//   ?tema=svetle                    světlý vzhled
//   ?start=ne                       bez úvodního tlačítka celé obrazovky
//   ?zobrazeni=poradi               místo losu pořadí (přepíná se i tlačítkem nebo klávesou P)
//   ?data=<adresa>                  jiný zdroj dat z GitHubu (pro vývoj)

import { parseTournamentInput, publicUrl, loadTournament } from './pairings.js';

const REPO = 'slivam24/chess-ressults-dashboard';
const REFRESH_MS = 30_000;
const STALE_MIN = 25;
const IDLE_MS = 4000;
const SCROLL_PX_S = 28;
const SCROLL_PAUSE_MS = 5000;

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

if (/^(svetle|světlé|light)$/i.test(params.get('tema') || '')) document.documentElement.dataset.theme = 'light';

function repoSlug() {
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname);
  const first = location.pathname.split('/').filter(Boolean)[0];
  return m && first && !first.endsWith('.html') ? `${m[1]}/${first}` : REPO;
}
const SLUG = repoSlug();
const DATA_URL = params.get('data') || `https://raw.githubusercontent.com/${SLUG}/dashboard-data/dashboard.json`;
const WORKFLOW_URL = `https://github.com/${SLUG}/actions/workflows/dashboard.yml`;

// paměť prohlížeče: jen pohodlí (poslední turnaje, adresa prostředníka), bez ní vše funguje dál
const store = {
  get(k) {
    try {
      return localStorage.getItem(`dashboard.${k}`) || '';
    } catch {
      return '';
    }
  },
  set(k, v) {
    try {
      if (v) localStorage.setItem(`dashboard.${k}`, String(v));
      else localStorage.removeItem(`dashboard.${k}`);
    } catch {
      /* soukromé okno apod. */
    }
  },
};

let cfg = {}; // scripts/dashboard.json z webu: výchozí turnaje a prostředník
let data = null; // los z GitHubu
let lastJson = '';
let lastOk = null;
let lastError = null;
const live = {}; // los načtený živě, podle čísla turnaje
let liveOk = null;
let liveError = null;

if (params.get('proxy') != null) store.set('proxy', params.get('proxy').trim());
const proxyUrl = () => store.get('proxy') || cfg.proxy || '';

// zobrazení: los, nebo pořadí; velikost písma: násobek automatické velikosti
const VIEWS = { los: 'los', poradi: 'poradi', 'pořadí': 'poradi' };
let view = VIEWS[(params.get('zobrazeni') || '').toLowerCase()] || store.get('view') || 'los';
let zoom = Math.min(3, Math.max(0.4, Number(store.get('zoom')) || 1));
const ZOOM_STEP = 1.15;

const pick = (key) =>
  parseTournamentInput(params.get(key) || '') ||
  parseTournamentInput(store.get(key)) ||
  parseTournamentInput(String(cfg[key] ?? '')) ||
  data?.[key] ||
  null;
const chosen = () => ({ vlevo: pick('vlevo'), vpravo: pick('vpravo') });
const tour = (tnr) => {
  const l = live[tnr];
  const g = data?.tournaments?.[tnr];
  if (l?.pairings || l?.matches) return l;
  return g && (g.pairings || g.matches) ? { ...g, error: l?.error || g.error } : l || g;
};

// ---------- pomocné ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmtPts = (p) => (p == null ? '' : `${Math.floor(p) || (p % 1 ? '' : '0')}${p % 1 ? '½' : ''}`);

const DAYS = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return `${DAYS[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`;
}
const hhmm = (d) => d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });

/** Kdo vyhrál: 1 bílý / domácí, -1 černý / hosté, 0 remíza nebo nehráno. */
function winner(result) {
  const m = /^\s*([\d½K+\-]+)\s*[–:-]\s*([\d½K+\-]+)\s*$/.exec(result || '');
  if (!m) return 0;
  const val = (s) => (s.startsWith('+') ? 1 : s.startsWith('-') ? 0 : parseFloat(s.replace('½', '.5').replace(/^\./, '0.').replace('K', '')) || 0);
  const a = val(m[1]);
  const b = val(m[2]);
  return a > b ? 1 : a < b ? -1 : 0;
}

// ---------- vykreslení ----------

function headHtml(t, tnr, standings = false) {
  const parts = [];
  if (standings) {
    const after = t?.standings?.after ?? (t?.kind === 'team' && t.matches?.some((m) => m.result) ? t.round : null);
    parts.push(`<span class="round">Pořadí${after ? ` po ${after}. kole` : ''}</span>`);
    if (t?.rounds) parts.push(`${t.rounds} kol`);
  } else {
    if (t?.round) parts.push(`<span class="round">${t.round}. kolo${t.rounds ? ` z ${t.rounds}` : ''}</span>`);
    if (t?.date) parts.push(`${fmtDate(t.date)}${t.time ? ` ${t.time}` : ''}`);
  }
  const flag = t?.error ? `<span class="flag" title="${esc(t.error)}">⚠ poslední stažení selhalo</span>` : '';
  return `<div class="head">
    <h1 class="title">${esc(t?.title || `Turnaj ${tnr}`)}</h1>
    <div class="sub">${parts.join(' · ')}${flag}</div>
  </div>`;
}

function playerHtml(p, side) {
  if (!p || p.bye) return `<span class="bye">volno</span>`;
  const ttl = p.title ? `<span class="ttl">${esc(p.title)}</span>` : '';
  const metaParts = [p.rating, p.points != null ? `${fmtPts(p.points)} b.` : ''].filter(Boolean);
  const meta = metaParts.length ? `<span class="meta">${esc(metaParts.join(' · '))}</span>` : '';
  const piece = `<span class="piece ${side}" aria-hidden="true"></span>`;
  // kolečko barvy drží u jména, aby se při zalomení neoctlo samo na řádku
  const words = esc(p.name).split(' ');
  const line =
    side === 'w'
      ? `<span class="nb">${piece}${ttl}<span class="name">${words[0]}</span></span> <span class="name">${words.slice(1).join(' ')}</span>`
      : `${ttl}<span class="name">${words.slice(0, -1).join(' ')}</span> <span class="nb"><span class="name">${words.at(-1)}</span>${piece}</span>`;
  return `<div class="pc"><span class="line">${line}</span>${meta}</div>`;
}

function individualTable(t) {
  const rows = t.pairings
    .map((g) => {
      const w = winner(g.result);
      return `<tr>
        <td class="bd">${esc(g.board)}</td>
        <td class="pl${w === 1 ? ' win' : ''}">${playerHtml(g.white, 'w')}</td>
        <td class="res${g.result ? '' : ' empty'}">${esc(g.result || '–')}</td>
        <td class="pl right${w === -1 ? ' win' : ''}">${playerHtml(g.black, 'b')}</td>
      </tr>`;
    })
    .join('');
  return `<table class="pairs"><tbody>${rows}</tbody></table>`;
}

function teamTable(t) {
  const rows = t.matches
    .map((m) => {
      const w = winner(m.result);
      return `<tr>
        <td class="bd">${esc(m.board)}</td>
        <td class="pl${w === 1 ? ' win' : ''}"><div class="pc"><span class="line"><span class="name">${esc(m.home.name)}</span></span></div></td>
        <td class="res${m.result ? '' : ' empty'}">${esc(m.result || '–')}</td>
        <td class="pl right${w === -1 ? ' win' : ''}"><div class="pc"><span class="line"><span class="name">${esc(m.away.name)}</span></span></div></td>
      </tr>`;
    })
    .join('');
  return `<table class="pairs team"><tbody>${rows}</tbody></table>`;
}

function standingsTable(t) {
  const st = t.standings;
  const cols = st.columns.map((c, i) => `<th class="num${i === 0 ? ' main' : ''}">${esc(c)}</th>`).join('');
  const rows = st.rows
    .map((r, i) => {
      const same = i > 0 && st.rows[i - 1].rank === r.rank;
      const ttl = r.title ? `<span class="ttl">${esc(r.title)}</span>` : '';
      const meta = r.rating ? `<span class="meta">${r.rating}</span>` : '';
      const vals = r.values.map((v, j) => `<td class="num${j === 0 ? ' main' : ''}">${esc(v)}</td>`).join('');
      return `<tr${r.rank <= 3 && !same ? ` class="top${r.rank}"` : ''}>
        <td class="bd">${same ? '' : esc(r.rank ?? '')}</td>
        <td class="pl"><div class="pc"><span class="line">${ttl}<span class="name">${esc(r.name)}</span></span>${meta}</div></td>
        ${vals}
      </tr>`;
    })
    .join('');
  const colgroup = `<colgroup><col class="c-bd"><col>${st.columns.map(() => '<col class="c-num">').join('')}</colgroup>`;
  return `<table class="pairs stand">${colgroup}<thead><tr><th></th><th></th>${cols}</tr></thead><tbody>${rows}</tbody></table>`;
}

function frameHtml(tnr, why) {
  const how = proxyUrl()
    ? ''
    : ` Přehledné zobrazení: zadej turnaj v <a href="${WORKFLOW_URL}" target="_blank" rel="noopener">Actions → Dashboard → Run workflow</a>,
      nebo zapni živé načítání (⚙ Turnaje).`;
  return `<div class="frame-wrap">
    <div class="frame-note">${why} Zobrazuji přímo stránku chess-results, obnovuje se každých 30 s.${how}</div>
    <iframe src="${esc(publicUrl(tnr))}" title="chess-results.com, turnaj ${tnr}" referrerpolicy="no-referrer"></iframe>
  </div>`;
}

const panelState = new WeakMap();

function renderPanel(el, tnr) {
  const t = tnr ? tour(tnr) : null;
  let html;
  let table = false;
  if (!tnr) {
    html = `<div class="empty-state"><strong>Není vybraný turnaj</strong>
      <span>Klikni na ⚙ Turnaje a zadej číslo nebo odkaz z chess-results.com.</span></div>`;
  } else if (view === 'poradi' && t?.standings?.rows?.length) {
    html = `${headHtml(t, tnr, true)}<div class="body"><div class="scroller">${standingsTable(t)}</div></div>`;
    table = true;
  } else if (view === 'poradi' && (t?.pairings || t?.matches)) {
    const why = t.standingsError
      ? `Pořadí se nepodařilo načíst (${esc(t.standingsError)}).`
      : t.standings === null
        ? 'Pořadí zatím není zveřejněné.'
        : proxyUrl()
          ? 'Načítám pořadí…'
          : 'Pořadí se načte při dalším stažení přes GitHub (do 10 minut).';
    html = `${headHtml(t, tnr, true)}<div class="empty-state"><span>${why}</span></div>`;
  } else if (t?.pairings?.length || t?.matches?.length) {
    html = `${headHtml(t, tnr)}<div class="body"><div class="scroller">${t.kind === 'team' ? teamTable(t) : individualTable(t)}</div></div>`;
    table = true;
  } else if (!data && !liveOk && !liveError) {
    html = `<div class="empty-state"><span>Načítám los…</span></div>`;
  } else if (t?.error) {
    html = headHtml(t, tnr) + frameHtml(tnr, `Los se nepodařilo stáhnout (${esc(t.error)}).`);
  } else {
    html = frameHtml(tnr, proxyUrl() ? 'Načítám los…' : 'Tento turnaj se zatím nestahuje.');
  }
  const prev = panelState.get(el);
  if (prev?.html === html) return;
  el.innerHTML = html;
  panelState.set(el, { html, table });
  if (table) {
    fit(el);
    document.fonts?.ready.then(() => fit(el));
  }
}

function render() {
  const { vlevo, vpravo } = chosen();
  renderPanel($('panelL'), vlevo);
  renderPanel($('panelR'), vpravo);
  renderStatus();
}

const hhmmss = (d) => d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function renderStatus() {
  const s = [];
  if (proxyUrl()) {
    if (liveOk) s.push(`Živě z chess-results · obnoveno v ${hhmmss(liveOk)}`);
    if (liveError) s.push(`<span class="bad">⚠ ${esc(liveError)}</span>`);
    if (liveOk && Date.now() - liveOk > 3 * REFRESH_MS) s.push('<span class="warn">⚠ los se delší dobu neobnovil</span>');
    $('status').innerHTML = s.join(' · ') || 'Načítám los…';
    return;
  }
  if (data?.generated) {
    const gen = new Date(data.generated);
    const age = Math.round((Date.now() - gen) / 60000);
    const txt = `Los stažen přes GitHub v ${hhmm(gen)}`;
    s.push(age > STALE_MIN ? `<span class="warn">⚠ ${txt} (před ${age} min)</span>` : txt);
  }
  if (lastError) s.push(`<span class="bad">⚠ nelze načíst data${lastOk ? `, naposledy v ${hhmm(lastOk)}` : ''}</span>`);
  $('status').innerHTML = s.join(' · ');
}

// ---------- přizpůsobení velikosti ----------

/**
 * Největší písmo, při kterém se los vejde na výšku a nic nepřetéká do strany.
 * Zkouší tři rozložení: vše na řádku; rating a body pod jménem; k tomu zalomená dlouhá jména.
 * Bohatší rozložení vyhraje, jen když dovolí znatelně větší písmo.
 */
const LAYOUTS = ['', 'stack', 'stack wrap'];
function fit(panel) {
  const body = panel.querySelector('.body');
  const table = panel.querySelector('table.pairs');
  if (!body || !table) return;
  const scroller = body.querySelector('.scroller');
  stopScroll(panel);
  scroller.style.transform = '';
  const H = body.clientHeight;
  let lineLimit = true;
  const noOverflow = () => {
    for (const n of table.querySelectorAll('.pl, .res, .num')) if (n.scrollWidth > n.clientWidth) return false;
    // scrollWidth se zaokrouhluje na celé pixely, takže o kousek delší jméno by prošlo se zkrácením;
    // proto se měří skutečná šířka textu uvnitř řádku jména
    for (const n of table.querySelectorAll('.line')) {
      const r = n.getBoundingClientRect();
      for (const k of n.querySelectorAll('.name, .piece, .ttl')) {
        const kr = k.getBoundingClientRect();
        if (kr.right > r.right + 0.01 || kr.left < r.left - 0.01) return false;
      }
    }
    if (lineLimit && table.classList.contains('wrap')) {
      // nejvýš dva řádky na jméno
      const max = parseFloat(table.style.fontSize) * 1.15 * 2 + 2;
      for (const n of table.querySelectorAll('.line')) if (n.offsetHeight > max) return false;
    }
    return true;
  };
  const best = (heightOnly) => {
    let lo = 0;
    let hi = Math.min(80, Math.max(14, H / 4));
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      table.style.fontSize = `${mid}px`;
      if (table.offsetHeight <= H && (heightOnly || noOverflow())) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const setLayout = (l) => {
    table.classList.remove('stack', 'wrap');
    if (l) table.classList.add(...l.split(' '));
  };
  let pick = { layout: '', size: 0 };
  for (const l of LAYOUTS) {
    setLayout(l);
    const size = best(false);
    // bohatší rozložení musí dovolit znatelně větší písmo, zalomení ještě o něco víc
    if (size > pick.size * (l.includes('wrap') ? 1.3 : 1.15)) pick = { layout: l, size };
  }
  const MIN = 16;
  if (pick.size < MIN) {
    // hodně šachovnic: raději čitelné písmo s posouváním, zkrácená jména nevadí tolik
    setLayout('');
    const size = best(true);
    pick = { layout: '', size: Math.max(MIN, size) };
  }
  setLayout(pick.layout);
  table.style.fontSize = `${pick.size}px`;
  if (zoom !== 1) {
    // ruční velikost: násobek automatické; při zvětšení se hledá rozložení, kde se jména nezkracují,
    // a co se nevejde na výšku, se posouvá
    const size = Math.min(200, Math.max(8, pick.size * zoom));
    table.style.fontSize = `${size}px`;
    const order = zoom > 1 ? [pick.layout, ...LAYOUTS.filter((l) => l !== pick.layout)] : [pick.layout];
    const ok = order.find((l) => {
      setLayout(l);
      return noOverflow();
    });
    if (ok != null) setLayout(ok);
    else {
      // ani se zalomením se nevejde: tak velké písmo, aby se nelámala slova (víc řádků nevadí)
      setLayout('stack wrap');
      lineLimit = false;
      let lo = Math.min(pick.size, size);
      let hi = size;
      for (let i = 0; i < 9; i++) {
        const mid = (lo + hi) / 2;
        table.style.fontSize = `${mid}px`;
        if (noOverflow()) lo = mid;
        else hi = mid;
      }
      lineLimit = true;
      table.style.fontSize = `${lo}px`;
    }
  }
  if (table.offsetHeight > H + 2) startScroll(panel, scroller, table.offsetHeight - H);
}

function refitAll() {
  for (const p of [$('panelL'), $('panelR')]) if (panelState.get(p)?.table) fit(p);
}

function setZoom(z) {
  zoom = Math.min(3, Math.max(0.4, Math.round(z * 100) / 100));
  store.set('zoom', zoom === 1 ? '' : zoom);
  refitAll();
  flash(zoom === 1 ? 'Velikost: automaticky' : `Velikost: ${Math.round(zoom * 100)} %`);
}

function setView(v) {
  view = v;
  store.set('view', v === 'los' ? '' : v);
  $('btnLos').classList.toggle('on', v === 'los');
  $('btnPoradi').classList.toggle('on', v === 'poradi');
  render();
  load();
}

let flashTimer;
function flash(msg) {
  const el = $('flash');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (el.hidden = true), 1500);
}

const scrolls = new WeakMap();
function stopScroll(panel) {
  const s = scrolls.get(panel);
  if (s) cancelAnimationFrame(s.raf);
  scrolls.delete(panel);
}
function startScroll(panel, scroller, distance) {
  const s = { raf: 0 };
  scrolls.set(panel, s);
  const travel = (distance / SCROLL_PX_S) * 1000;
  const cycle = SCROLL_PAUSE_MS + travel + SCROLL_PAUSE_MS + 600;
  const t0 = performance.now();
  const step = (now) => {
    const t = (now - t0) % cycle;
    let y;
    if (t < SCROLL_PAUSE_MS) y = 0;
    else if (t < SCROLL_PAUSE_MS + travel) y = ((t - SCROLL_PAUSE_MS) / travel) * distance;
    else if (t < cycle - 600) y = distance;
    else y = distance * (1 - (t - (cycle - 600)) / 600);
    scroller.style.transform = `translateY(${-y}px)`;
    s.raf = requestAnimationFrame(step);
  };
  s.raf = requestAnimationFrame(step);
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    refitAll();
  }, 150);
});

// ---------- data ----------

async function loadGithub() {
  try {
    const sep = DATA_URL.includes('?') ? '&' : '?';
    const res = await fetch(`${DATA_URL}${sep}t=${Math.floor(Date.now() / 30000)}`, { cache: 'no-store' });
    if (res.status === 404) throw new Error('data zatím nejsou (úloha Dashboard ještě neběžela)');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    lastOk = new Date();
    lastError = null;
    if (text !== lastJson) {
      lastJson = text;
      data = JSON.parse(text);
    }
  } catch (e) {
    lastError = e.message;
    if (!data) data = { tournaments: {} };
  }
}

const parser = new DOMParser();
async function getDoc(url) {
  const proxy = proxyUrl();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`${proxy}${proxy.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}`, {
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`prostředník vrátil HTTP ${res.status}`);
    return parser.parseFromString(await res.text(), 'text/html');
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'chess-results neodpověděl do 20 s' : e.message === 'Failed to fetch' ? 'prostředník nedostupný (zkontroluj adresu a internet)' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

async function loadLive() {
  const ids = [...new Set(Object.values(chosen()).filter(Boolean))];
  let err = null;
  for (const tnr of ids) {
    try {
      live[tnr] = { ...(await loadTournament(tnr, getDoc, { standings: view === 'poradi' })), fetched: new Date().toISOString() };
    } catch (e) {
      err = `turnaj ${tnr}: ${e.message}`;
      live[tnr] = live[tnr]?.pairings || live[tnr]?.matches ? { ...live[tnr], error: e.message } : { tnr, error: e.message };
    }
  }
  if (err) liveError = err;
  else {
    liveError = null;
    liveOk = new Date();
  }
}

let loading = null;
function load() {
  // jedno načítání naráz; pomalý chess-results nesmí vrstvit požadavky
  loading ??= (async () => {
    try {
      if (proxyUrl()) {
        await loadLive();
        // GitHub jen jako záloha, když živé načítání nejde
        if (liveError && !data) await loadGithub();
      } else {
        await loadGithub();
      }
      render();
    } finally {
      loading = null;
    }
  })();
  return loading;
}

// vložené stránky chess-results (turnaj bez dat) se obnovují stejně často
function refreshFrames() {
  for (const f of document.querySelectorAll('.frame-wrap iframe')) f.src = f.src;
}

// ---------- hodiny, celá obrazovka, nečinnost ----------

function tick() {
  $('clock').textContent = hhmm(new Date());
}
setInterval(tick, 1000);
tick();
setInterval(renderStatus, 30_000);

const isFull = () => !!document.fullscreenElement;
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {
    /* zařízení to nepovolí, nevadí */
  }
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && keepAwake());

async function toggleFull() {
  try {
    if (isFull()) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    /* prohlížeč celou obrazovku nepovolil */
  }
  $('start').hidden = true;
  keepAwake();
}
document.addEventListener('fullscreenchange', () => {
  $('btnFull').textContent = isFull() ? '✕ Zavřít celou obrazovku' : '⛶ Celá obrazovka';
});

$('btnFull').addEventListener('click', toggleFull);
$('btnStart').addEventListener('click', toggleFull);
$('btnStay').addEventListener('click', () => {
  $('start').hidden = true;
  keepAwake();
});
// celá obrazovka se dá zapnout jen po kliknutí, proto úvodní nabídka (kromě ?start=ne)
if (!/^(ne|no|0)$/i.test(params.get('start') || '') && document.fullscreenEnabled) $('start').hidden = false;

let idleTimer;
function active() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!$('settings').open) document.body.classList.add('idle');
  }, IDLE_MS);
}
['mousemove', 'mousedown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, active, { passive: true }));
active();

document.addEventListener('keydown', (e) => {
  if ($('settings').open || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'f' || e.key === 'F') toggleFull();
  if (e.key === 's' || e.key === 'S') openSettings();
  if (e.key === 'p' || e.key === 'P') setView(view === 'poradi' ? 'los' : 'poradi');
  if (e.key === 'l' || e.key === 'L') setView('los');
  if (e.key === '+' || e.key === '=') setZoom(zoom * ZOOM_STEP);
  if (e.key === '-' || e.key === '_') setZoom(zoom / ZOOM_STEP);
  if (e.key === '0') setZoom(1);
});

$('btnLos').addEventListener('click', () => setView('los'));
$('btnPoradi').addEventListener('click', () => setView('poradi'));
$('btnZoomIn').addEventListener('click', () => setZoom(zoom * ZOOM_STEP));
$('btnZoomOut').addEventListener('click', () => setZoom(zoom / ZOOM_STEP));
$('btnZoomAuto').addEventListener('click', () => setZoom(1));
$('btnLos').classList.toggle('on', view === 'los');
$('btnPoradi').classList.toggle('on', view === 'poradi');

// ---------- nastavení ----------

function openSettings() {
  const c = chosen();
  $('inL').value = c.vlevo || '';
  $('inR').value = c.vpravo || '';
  $('settingsErr').textContent = '';
  $('inProxy').value = store.get('proxy') || '';
  $('inProxy').placeholder = cfg.proxy ? `výchozí: ${cfg.proxy}` : 'https://neco.workers.dev';
  $('settingsNote').innerHTML = proxyUrl()
    ? 'Živé načítání je zapnuté: los se načítá přímo z chess-results každých 30 sekund, pro jakýkoli turnaj.'
    : `Bez prostředníka se přehledně ukazují jen turnaje, které stahuje úloha na GitHubu
      (<a href="${WORKFLOW_URL}" target="_blank" rel="noopener">Actions → Dashboard → Run workflow</a>, asi po 10 minutách).
      Ostatní se ukážou jako stránka chess-results. Jak prostředníka zřídit, je v README repozitáře.`;
  $('settings').showModal();
}

$('btnSettings').addEventListener('click', openSettings);
$('btnCancel').addEventListener('click', () => $('settings').close());
$('btnDefault').addEventListener('click', () => {
  params.delete('vlevo');
  params.delete('vpravo');
  store.set('vlevo', '');
  store.set('vpravo', '');
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  $('settings').close();
  render();
  load();
});
$('settingsForm').addEventListener('submit', (e) => {
  const l = $('inL').value.trim();
  const r = $('inR').value.trim();
  const nl = l ? parseTournamentInput(l) : null;
  const nr = r ? parseTournamentInput(r) : null;
  if ((l && !nl) || (r && !nr)) {
    e.preventDefault();
    $('settingsErr').textContent = 'Zadej číslo turnaje nebo odkaz na stránku turnaje na chess-results.com.';
    return;
  }
  const proxy = $('inProxy').value.trim();
  if (proxy && !/^https:\/\/[^\s/]+/i.test(proxy)) {
    e.preventDefault();
    $('settingsErr').textContent = 'Adresa prostředníka musí začínat https://';
    return;
  }
  store.set('proxy', proxy);
  params.delete('proxy');
  nl ? params.set('vlevo', nl) : params.delete('vlevo');
  nr ? params.set('vpravo', nr) : params.delete('vpravo');
  store.set('vlevo', nl);
  store.set('vpravo', nr);
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  render();
  load();
});

async function init() {
  try {
    const res = await fetch(`scripts/dashboard.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) cfg = await res.json();
  } catch {
    /* bez výchozího nastavení to jde taky */
  }
  // turnaje z adresy si prohlížeč zapamatuje, příště stačí otevřít stránku bez parametrů
  for (const k of ['vlevo', 'vpravo']) {
    const n = parseTournamentInput(params.get(k) || '');
    if (n) store.set(k, n);
  }
  if (params.has('proxy')) {
    params.delete('proxy');
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  }
  render();
  await load();
  setInterval(load, REFRESH_MS);
  setInterval(refreshFrames, REFRESH_MS);
}
init();
