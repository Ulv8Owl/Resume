// Симулятор Charles Proxy: телефон (приложение «Лавка зелий», Настройки, Браузер) и окно Charles 4.6.
// Трафик телефона идёт через модель прокси: Access Control → Block List → SSL Proxying → Map Remote → Rewrite →
// No Caching → Breakpoint (запрос) → Map Local / сервер → Throttling → Rewrite → Breakpoint (ответ).
(function () {
  'use strict';

  const Core = window.Core;
  const esc = (v) => Core.esc(v == null ? '' : String(v));

  const CH_IP = '192.168.1.10';
  const CH_PORT = '8888';
  const PHONE_IP = '192.168.1.23';
  const INTRUDER_IP = '192.168.1.57';
  const API = 'api.potions.shop';
  const STG = 'staging-api.potions.shop';
  const CDN = 'cdn.potions.shop';
  const ANL = 'analytics.potions.shop';
  const GSTATIC = 'connectivitycheck.gstatic.com';
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjd9.Qk3x9';
  const USER = { id: 7, name: 'Мира Тестова', email: 'mira@potions.shop', password: 'elixir123' };
  const UA = 'PotionShop/3.4.1 (Android 14; Pixel 7)';
  const APP_TIMEOUT = 6000;
  const DATE = 'Sun, 11 Oct 2026 10:24:31 GMT';
  const STATUS_TEXT = { 200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };

  const PRODUCTS = [
    { id: 1, slug: 'healing', icon: '🧪', name: 'Зелье лечения', en: 'Healing Potion', price: 45, stock: 12, rating: 4.8, desc: 'Восстанавливает 50 HP за 3 секунды.' },
    { id: 2, slug: 'mana', icon: '💧', name: 'Эликсир маны', en: 'Mana Elixir', price: 120, stock: 5, rating: 4.6, desc: 'Полностью восполняет ману. Не смешивать с огнём.' },
    { id: 3, slug: 'invis', icon: '👻', name: 'Настой невидимости', en: 'Invisibility Draught', price: 300, stock: 2, rating: 4.2, desc: 'Невидимость на 60 секунд. Тень остаётся.' },
    { id: 4, slug: 'dragon', icon: '🐉', name: 'Драконья кровь', en: 'Dragon Blood', price: 990, stock: 3, rating: 4.9, desc: 'Сопротивление огню на час.' },
    { id: 5, slug: 'pollen', icon: '✨', name: 'Пыльца феи', en: 'Fairy Dust', price: 15, stock: 40, rating: 4.4, desc: 'Позволяет парить над землёй. Недолго.' },
  ];
  const OLD_PRICES = { 1: 40, 2: 110, 3: 280, 4: 950, 5: 12 };
  const ORDERS = [
    { order_id: 5009, user_id: 3, customer: 'Борин Каменный', address: 'Тёмный лес, 13', total: 990, status: 'delivered', items: [{ product_id: 4, qty: 1, price: 990 }] },
    { order_id: 5011, user_id: 7, customer: 'Мира Тестова', address: 'Башня магов, 7', total: 165, status: 'delivered', items: [{ product_id: 1, qty: 1, price: 45 }, { product_id: 2, qty: 1, price: 120 }] },
    { order_id: 5012, user_id: 7, customer: 'Мира Тестова', address: 'Башня магов, 7', total: 45, status: 'shipped', items: [{ product_id: 1, qty: 1, price: 45 }] },
  ];
  const NOISE = [
    { host: 'firebase-settings.crashlytics.com', method: 'GET', path: '/spi/v2/platforms/android/gmp/1:4471:android:9f2/settings' },
    { host: 'graph.facebook.com', method: 'POST', path: '/v19.0/1484/activities' },
    { host: 'play.googleapis.com', method: 'POST', path: '/log/batch' },
    { host: 'app-measurement.com', method: 'POST', path: '/a' },
  ];
  const pj = (o) => JSON.stringify(o, null, 2);
  // «Локальные файлы» на ноутбуке тестировщика для Map Local.
  const FILES = {
    'catalog-empty.json': { about: 'каталог без товаров', body: pj({ page: 1, total: 0, items: [] }) },
    'catalog-huge-price.json': { about: 'огромная, нулевая и отрицательная цена', body: pj({ page: 1, total: 3, items: [
      { id: 1, name: 'Зелье лечения', price: 99999999, image: `https://${CDN}/img/healing.png` },
      { id: 2, name: 'Эликсир маны', price: 0, image: `https://${CDN}/img/mana.png` },
      { id: 3, name: 'Настой невидимости', price: -300, image: `https://${CDN}/img/invis.png` }] }) },
    'catalog-unicode.json': { about: 'эмодзи, диакритика, арабский, теги, длинное имя', body: pj({ page: 1, total: 4, items: [
      { id: 1, name: 'Зелье 🧪 «Ægir» ünïcödé', price: 45, image: `https://${CDN}/img/healing.png` },
      { id: 2, name: 'إكسير المانا', price: 120, image: `https://${CDN}/img/mana.png` },
      { id: 3, name: '<b>Жирное</b> <i>зелье</i>', price: 300, image: `https://${CDN}/img/invis.png` },
      { id: 4, name: 'Очень-очень-длинное-название-зелья-которое-не-помещается-ни-в-одну-строку-интерфейса', price: 990, image: `https://${CDN}/img/dragon.png` }] }) },
    'catalog-broken.json': { about: 'обрезанный, невалидный JSON', body: '{\n  "page": 1,\n  "items": [\n    { "id": 1, "name": "Зелье ле' },
    'orders-sample.json': { about: 'валидный список заказов', body: pj({ items: [
      { order_id: 5011, total: 165, status: 'delivered' }, { order_id: 5012, total: 45, status: 'shipped' }] }) },
    'profile-empty.json': { about: 'пустой файл (0 байт)', body: '' },
  };
  const THROTTLE = {
    '56 kbps Modem': { down: 56, up: 48, util: 95, rtt: 200 },
    '256 kbps ISDN/DSL': { down: 256, up: 64, util: 95, rtt: 40 },
    '512 kbps ISDN/DSL': { down: 512, up: 128, util: 95, rtt: 40 },
    '2 Mbps ADSL': { down: 2048, up: 512, util: 95, rtt: 30 },
    '3G': { down: 1024, up: 128, util: 100, rtt: 400 },
    '4G': { down: 10240, up: 5120, util: 100, rtt: 120 },
    '100 Mbps Fibre': { down: 102400, up: 102400, util: 100, rtt: 5 },
  };
  const REWRITE_TYPES = [['add-header', 'Add Header'], ['modify-header', 'Modify Header'], ['remove-header', 'Remove Header'], ['host', 'Host'], ['path', 'Path'], ['add-query', 'Add Query Param'], ['modify-query', 'Modify Query Param'], ['remove-query', 'Remove Query Param'], ['status', 'Response Status'], ['body', 'Body']];
  const CERT_PEM = '-----BEGIN CERTIFICATE-----\nMIIFRzCCBC+gAwIBAgIGAZJ3c2hhcmxlczANBgkqhkiG9w0BAQsFADCBoTEsMCoG\nA1UEAwwjQ2hhcmxlcyBQcm94eSBDQSAoMTEgT2N0IDIwMjYsIG1pcmEpMSUwIwYD\n…\n-----END CERTIFICATE-----';

  // ---------- утилиты ----------
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const reEsc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // Маска как в Charles: * — любая последовательность символов.
  function glob(pat, v) {
    pat = String(pat == null ? '' : pat).trim();
    if (!pat || pat === '*') return true;
    return new RegExp('^' + pat.split('*').map(reEsc).join('.*') + '$', 'i').test(String(v || ''));
  }
  const hget = (hs, n) => { const h = (hs || []).find(([k]) => k.toLowerCase() === n.toLowerCase()); return h ? h[1] : undefined; };
  const hdel = (hs, n) => hs.filter(([k]) => k.toLowerCase() !== n.toLowerCase());
  const parseJson = (s) => { if (s == null || s === '') return undefined; try { return JSON.parse(s); } catch (e) { return undefined; } };
  const rid = () => Math.random().toString(16).slice(2, 10);
  const bytes = (s) => new TextEncoder().encode(s || '').length;
  function qsParse(q) {
    return (q || '').split('&').filter(Boolean).map((p) => {
      const i = p.indexOf('=');
      const dec = (x) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch (e) { return x; } };
      return i < 0 ? [dec(p), ''] : [dec(p.slice(0, i)), dec(p.slice(i + 1))];
    });
  }
  const qsBuild = (pairs) => pairs.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  const fullUrl = (r) => `${r.scheme}://${r.host}${r.path}${r.query ? '?' + r.query : ''}`;
  const lowerObj = (hs) => Object.fromEntries((hs || []).map(([k, v]) => [k.toLowerCase(), v]));
  const headersText = (hs) => (hs || []).map(([k, v]) => `${k}: ${v}`).join('\n');
  function parseHeaders(text) {
    return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const i = l.indexOf(':');
      return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }).filter(([k]) => k);
  }
  const prettyBody = (b) => { const j = parseJson(b); return j === undefined ? (b || '') : pj(j); };
  const fmtSize = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

  // ---------- проверки уровней по состоянию Charles ----------
  const bpActive = (st) => st.bpOn && st.bps.some((b) => b.on);
  const mapLocalActive = (st) => st.mapLocal.on && st.mapLocal.rules.some((r) => r.on);
  const mapRemoteActive = (st) => st.mapRemote.on && st.mapRemote.rules.some((r) => r.on);
  const rewriteActive = (st) => st.rewrite.on && st.rewrite.sets.some((s) => s.on && s.rules.some((r) => r.on));
  const blockActive = (st) => st.block.on && st.block.locs.some((l) => l.on);
  const toolsClean = (st) => !bpActive(st) && !mapLocalActive(st) && !mapRemoteActive(st) && !rewriteActive(st) && !blockActive(st) && !st.throttle.on && !st.noCache.on;
  const proxyOk = (st) => st.phone.proxyMode === 'manual' && st.phone.proxyHost.trim() === CH_IP && String(st.phone.proxyPort).trim() === CH_PORT;
  function rewriteGives401(st) {
    return st.rewrite.on && st.rewrite.sets.some((s) => s.on && glob(s.host, API) && glob(s.path, '/v2/cart') && s.rules.some((r) => r.on && (
      (r.type === 'status' && String(r.newValue).trim() === '401' && (!r.matchValue || String(r.matchValue).trim() === '200')) ||
      (r.where === 'req' && (r.type === 'remove-header' || r.type === 'modify-header') && String(r.matchName).trim().toLowerCase() === 'authorization'))));
  }

  // ---------- сервер «Лавки зелий» ----------
  function createServer(bugs, seedCart) {
    const products = clone(PRODUCTS);
    const orders = clone(ORDERS);
    let cart = seedCart.map(([id, qty]) => ({ product_id: id, qty }));
    let nextOrder = 5013;
    const json = (status, obj, extra) => ({ status, headers: [['Content-Type', 'application/json; charset=utf-8']].concat(extra || []), body: obj === undefined ? '' : pj(obj) });
    const nostore = [['Cache-Control', 'no-store']];
    const pub = (o) => ({ order_id: o.order_id, total: o.total, status: o.status, items: o.items });
    const authed = (req) => hget(req.headers, 'Authorization') === 'Bearer ' + TOKEN;

    function cartView() {
      const items = cart.map((c) => {
        const p = products.find((x) => x.id === c.product_id) || { name: '?', price: 0 };
        return { product_id: c.product_id, name: p.name, qty: c.qty, price: p.price, subtotal: p.price * c.qty };
      });
      // Баг сервера (ур. 7): total считается без учёта количества.
      const total = bugs.cartTotalWrong ? items.reduce((s, i) => s + i.price, 0) : items.reduce((s, i) => s + i.subtotal, 0);
      return { items, total, currency: 'coins' };
    }

    function api(req) {
      const env = req.host === STG ? 'staging' : 'prod';
      const m = req.method.toUpperCase();
      const seg = req.path.split('/').filter(Boolean);
      const q = Object.fromEntries(qsParse(req.query));
      const body = parseJson(req.body);
      const [v, r1, r2, r3] = seg;
      const auth = hget(req.headers, 'Authorization');
      if (v !== 'v2') return json(404, { error: 'not_found' });
      if (r1 === 'auth' && r2 === 'login') {
        if (m !== 'POST') return json(405, { error: 'method_not_allowed' });
        if (!body || !body.email || !body.password) return json(400, { error: 'email and password are required' });
        if (body.email !== USER.email || body.password !== USER.password) return json(401, { error: 'invalid_credentials' });
        return json(200, { token: TOKEN, token_type: 'Bearer', expires_in: 3600, user: { id: USER.id, name: USER.name } }, nostore);
      }
      // Публичные ручки, но протухший/чужой токен всё равно отвергается.
      if (auth && !authed(req) && (r1 === 'catalog' || r1 === 'products')) return json(401, { error: 'invalid_token' }, [['WWW-Authenticate', 'Bearer error="invalid_token"']]);
      if (r1 === 'catalog' && !r2) {
        if (m !== 'GET') return json(405, { error: 'method_not_allowed' });
        const en = q.lang === 'en';
        const items = products.map((x) => ({ id: x.id, name: en ? x.en : x.name, price: x.price, image: `https://${CDN}/img/${x.slug}.png`, rating: x.rating }));
        const etag = bugs.staleEtag ? '"v41"' : '"v42"';
        const extra = [['Cache-Control', 'private, max-age=0, must-revalidate'], ['ETag', etag], ['Vary', 'Accept-Language']];
        if (hget(req.headers, 'If-None-Match') === etag) return { status: 304, headers: extra, body: '' };
        return json(200, { page: Number(q.page) || 1, total: items.length, lang: en ? 'en' : 'ru', items }, extra);
      }
      if (r1 === 'products' && r2 !== undefined && !r3) {
        if (m !== 'GET') return json(405, { error: 'method_not_allowed' });
        if (!/^\d+$/.test(r2)) return json(400, { error: 'id must be an integer' });
        const id = Number(r2);
        if (bugs.product500 && id === 4) return json(500, { error: 'internal_error', message: 'NullPointerException at ProductMapper.rating(ProductMapper.java:57)' });
        const x = products.find((p) => p.id === id);
        if (!x) return json(404, { error: 'product_not_found' });
        return json(200, { id: x.id, name: x.name, price: x.price, stock: x.stock, rating: x.rating, description: x.desc }, [['Cache-Control', 'private, max-age=0']]);
      }
      const prot = ['cart', 'orders', 'profile', 'promo'].includes(r1);
      const ordersOpen = bugs.ordersNoAuth && r1 === 'orders' && !r2 && m === 'GET';
      if (prot && !authed(req) && !ordersOpen) return json(401, { error: 'unauthorized' }, [['WWW-Authenticate', 'Bearer error="invalid_token"']]);
      if (r1 === 'cart' && !r2 && m === 'GET') return json(200, cartView(), nostore);
      if (r1 === 'cart' && r2 === 'items' && m === 'POST') {
        if (!body) return json(400, { error: 'malformed_json' });
        const x = products.find((p) => p.id === body.product_id);
        if (!x) return json(404, { error: 'product_not_found' });
        if (typeof body.qty !== 'number' || !Number.isInteger(body.qty)) return json(422, { error: 'validation_error', field: 'qty', message: 'must be an integer' });
        // Баг сервера (ур. 8): нет проверки qty >= 1.
        if (!bugs.qtyNoValidation && body.qty < 1) return json(422, { error: 'validation_error', field: 'qty', message: 'must be >= 1' });
        const line = cart.find((c) => c.product_id === x.id);
        if (line) line.qty += body.qty; else cart.push({ product_id: x.id, qty: body.qty });
        return json(201, cartView(), nostore);
      }
      if (r1 === 'promo' && m === 'POST') {
        if (body && String(body.code || '').trim().toUpperCase() === 'WIZARD10') return json(200, { code: 'WIZARD10', discount_pct: 10 });
        return json(404, { error: 'promo_not_found' });
      }
      if (r1 === 'orders' && !r2 && m === 'POST') {
        if (!body || !Array.isArray(body.items) || !body.items.length) return json(422, { error: 'validation_error', message: 'items are required' });
        // Баги безопасности: цена берётся из запроса клиента, Idempotency-Key игнорируется.
        let total = body.items.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);
        if (body.promo === 'WIZARD10') total = Math.round(total * 0.9);
        const o = { order_id: nextOrder++, user_id: USER.id, customer: USER.name, address: body.address || '', total, status: 'created',
          items: body.items.map((i) => ({ product_id: i.product_id, qty: i.qty, price: i.price })) };
        orders.push(o);
        cart = [];
        return json(201, pub(o), [['Location', `/v2/orders/${o.order_id}`]].concat(nostore));
      }
      if (r1 === 'orders' && !r2 && m === 'GET') {
        if (bugs.orders500) return json(500, { error: 'internal_error', message: 'HikariPool-1 - Connection is not available, request timed out after 30000ms' });
        return json(200, { items: orders.filter((o) => o.user_id === USER.id).map((o) => ({ order_id: o.order_id, total: o.total, status: o.status })) }, nostore);
      }
      if (r1 === 'orders' && r2 && m === 'GET') {
        // IDOR: владельца заказа сервер не проверяет.
        const o = orders.find((x) => String(x.order_id) === r2);
        if (!o) return json(404, { error: 'order_not_found' });
        return json(200, Object.assign(pub(o), { user_id: o.user_id, customer: o.customer, address: o.address }), nostore);
      }
      if (r1 === 'profile' && !r2 && m === 'GET') {
        return json(200, { id: USER.id, name: USER.name, email: USER.email, balance: env === 'prod' && bugs.balanceNull ? null : 1250, tier: 'Gold' }, nostore);
      }
      return json(404, { error: `no route for ${m} ${req.path}` });
    }

    function handle(req) {
      const h = req.host;
      let res;
      if (h === API || h === STG) {
        res = api(req);
        res.headers = [['Server', 'nginx/1.25.3'], ['Date', DATE]].concat(res.headers, [['X-Request-Id', rid()]], h === STG ? [['X-Env', 'staging']] : []);
        return res;
      }
      if (h === CDN) {
        const mm = req.path.match(/^\/img\/([\w-]+)\.png$/);
        if (!mm) return { status: 404, headers: [['Content-Type', 'text/plain'], ['Date', DATE]], body: 'Not Found' };
        return { status: 200, headers: [['Content-Type', 'image/png'], ['Cache-Control', 'public, max-age=31536000'], ['Date', DATE], ['Server', 'cloudflare']], body: '', binary: `[PNG image 64×64 · ${mm[1]}.png]`, size: 4200 };
      }
      if (h === ANL) return { status: 204, headers: [['Date', DATE], ['Server', 'nginx']], body: '' };
      if (h === GSTATIC) return { status: 204, headers: [['Date', DATE], ['Content-Length', '0']], body: '' };
      if (h === 'chls.pro') return { status: 200, headers: [['Content-Type', 'text/html']], body: '<h1>Charles Web Proxy</h1><p>Эта страница работает только через Charles. Настройте на устройстве HTTP-прокси Charles и откройте chls.pro/ssl снова.</p>' };
      if (NOISE.some((n) => n.host === h)) return { status: 200, headers: [['Content-Type', 'application/json'], ['Date', DATE]], body: '{}' };
      return { error: 'dns' };
    }
    return { handle };
  }

  const DEFAULTS = { proxy: true, cert: true, allowed: true, ssl: [], loggedIn: true, screen: 'app', cart: [], bugs: {}, noise: false, intruder: false, etagCache: false };
  let GEN = 0;

  function buildSim(el, ctx, level) {
    const gen = ++GEN;
    const alive = () => gen === GEN;
    const emit = (ev) => { if (alive()) ctx.emit(ev); };
    const wait = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
    const S = Object.assign({}, DEFAULTS, level.setup || {});
    const bugs = S.bugs || {};
    const server = createServer(bugs, S.cart);
    const st = ctx.state;
    Object.assign(st, {
      recording: true,
      sslOn: true,
      sslLocs: S.ssl.map((h) => ({ on: true, host: h, port: '443' })),
      acl: { allowed: new Set(S.allowed ? [PHONE_IP] : []), denied: new Set() },
      bpOn: false, bps: [],
      throttle: Object.assign({ on: false, preset: '3G' }, THROTTLE['3G']),
      noCache: { on: false, only: false, locs: [] },
      block: { on: false, action: '403', locs: [] },
      mapRemote: { on: false, rules: [] },
      mapLocal: { on: false, rules: [] },
      rewrite: { on: false, sets: [] },
      focus: new Set(),
      phone: { proxyMode: S.proxy ? 'manual' : 'none', proxyHost: S.proxy ? CH_IP : '', proxyPort: S.proxy ? CH_PORT : '', certDownloaded: S.cert, certInstalled: S.cert, wrongCert: false },
    });

    // ---------- состояние Charles ----------
    let entries = [];
    let seqNo = 0;
    let selected = null;
    let view = 'sequence';
    let filter = '';
    let focusedOnly = false;
    let detailTab = 'overview';
    let reqPane = 'headers';
    let resPane = 'text';
    let lastPaneKey = '';
    const expanded = new Set([`https://${API}`]);
    let otherOpen = false;
    const bpQueue = [];
    let composeDraft = null;
    let editorKey = '';
    let ctxEntry = null;
    const promptQueue = [];
    const accessWait = {};
    let intruderShown = false;
    const t0 = Date.now();

    el.innerHTML = `
      <div class="charles-wrap">
        <div class="phone" aria-label="Телефон тестировщика">
          <div class="phone-notch"></div>
          <div class="phone-screen">
            <div class="ph-status"><span>10:24</span><span class="ph-icons"></span></div>
            <div class="ph-body"></div>
            <div class="ph-nav"><button type="button" data-act="back" aria-label="Назад">◁</button><button type="button" data-act="home" aria-label="Домой">○</button><button type="button" data-act="recent" aria-label="Недавние">▢</button></div>
          </div>
        </div>
        <div class="charles">
          <div class="ch-title">Charles 4.6.7 — Session 1 *</div>
          <div class="ch-menubar" role="menubar">
            ${['File', 'Edit', 'View', 'Proxy', 'Tools', 'Help'].map((m) => `<button type="button" data-menu="${m.toLowerCase()}">${m}</button>`).join('')}
          </div>
          <div class="ch-toolbar">
            <button type="button" data-cmd="clear" title="Clear the current Session">🧹<span>Clear</span></button>
            <button type="button" data-cmd="record" class="ch-tb-rec" title="Start/Stop Recording">●<span>Record</span></button>
            <button type="button" data-cmd="throttle" class="ch-tb-thr" title="Start/Stop Throttling">🐢<span>Throttle</span></button>
            <button type="button" data-cmd="breakpoints" class="ch-tb-bp" title="Enable/Disable Breakpoints">⬣<span>Breakpoints</span></button>
            <i class="ch-sep"></i>
            <button type="button" data-cmd="compose" title="Compose (edit and send the selected request)">✎<span>Compose</span></button>
            <button type="button" data-cmd="repeat" title="Repeat the selected request">↻<span>Repeat</span></button>
            <button type="button" data-menu="tools" title="Tools">🔧<span>Tools</span></button>
            <button type="button" data-menu="proxy" title="Settings">⚙<span>Proxy</span></button>
          </div>
          <div class="ch-viewtabs"><button type="button" data-cmd="view-structure">Structure</button><button type="button" data-cmd="view-sequence">Sequence</button></div>
          <div class="ch-list"></div>
          <div class="ch-filterbar"><label>Filter: <input class="ch-filter" type="search" aria-label="Filter" spellcheck="false"></label><label class="ch-chk"><input type="checkbox" class="ch-focused"> Focused</label></div>
          <div class="ch-editor" hidden></div>
          <div class="ch-detail"></div>
          <div class="ch-statusbar"></div>
          <div class="ch-dropdown" hidden></div>
          <div class="ch-dlg-layer" hidden></div>
          <div class="ch-prompt-layer" hidden></div>
          <div class="ch-toast" hidden></div>
        </div>
      </div>`;
    const $ = (s) => el.querySelector(s);
    const chEl = $('.charles');

    // ================= СЕТЬ =================
    const cloneReq = (r) => ({ scheme: r.scheme, host: r.host, method: r.method, path: r.path, query: r.query || '', headers: r.headers.map((h) => h.slice()), body: r.body || '' });
    const cloneRes = (r) => Object.assign({}, r, { headers: (r.headers || []).map((h) => h.slice()) });
    const clock = () => { const d = new Date(Date.UTC(2026, 9, 11, 10, 24, 31) + (Date.now() - t0)); return d.toISOString().slice(11, 19); };
    const sslMatch = (host) => st.sslOn && st.sslLocs.some((l) => l.on && glob(l.host, host) && (!l.port || l.port === '*' || String(l.port) === '443'));
    const activeRule = (tool, f) => (tool.on ? tool.rules.find((r) => r.on && f(r)) : null);
    const bpMatch = (host, path) => (st.bpOn ? st.bps.find((b) => b.on && (b.req || b.res) && glob(b.host, host) && glob(b.path, path)) : null);
    const noCacheMatch = (host, path) => st.noCache.on && (!st.noCache.only || st.noCache.locs.some((l) => l.on && glob(l.host, host) && glob(l.path, path)));
    const blockMatch = (host, path) => st.block.on && st.block.locs.some((l) => l.on && glob(l.host, host) && (path === null ? (!l.path || l.path === '*') : glob(l.path, path)));

    function resSize(res) { return res.size || (bytes(res.body) + bytes(headersText(res.headers)) + 20); }
    function delay(req, res, proxied) {
      let ms = 40 + Math.round(Math.random() * 110);
      const t = st.throttle;
      const throttled = !!(proxied && t.on);
      if (throttled) {
        const reqB = bytes(req.body) + bytes(headersText(req.headers)) + 40;
        ms += Number(t.rtt) + ((reqB * 8) / Math.max(1, t.up) + (resSize(res) * 8) / Math.max(1, t.down)) * (100 / Math.max(1, t.util));
      }
      return { ms: Math.round(ms), throttled };
    }

    // req: { scheme, host, method, path, query, headers: [[k, v]], body }; opts.source: app | browser | os | compose | repeat
    function send(req0, opts) {
      opts = opts || {};
      const fromPhone = ['app', 'browser', 'os'].includes(opts.source);
      return new Promise((resolve) => {
        let settled = false;
        const done = (r) => { if (!settled) { settled = true; resolve(r); } };
        if (fromPhone && st.phone.proxyMode !== 'manual') {
          // Прокси не настроен: телефон ходит в сеть напрямую, Charles ничего не видит.
          const res = server.handle(cloneReq(req0));
          if (res.error) { wait(300).then(() => done({ error: res.error })); return; }
          wait(delay(req0, res, false).ms).then(() => done(res));
          return;
        }
        if (fromPhone && !proxyOk(st)) { wait(1200).then(() => done({ error: 'no-connection' })); return; }
        const go = () => runProxy(req0, opts, done, fromPhone);
        if (!fromPhone) go();
        else access(PHONE_IP).then((ok) => (ok ? go() : done({ error: 'refused' })));
      });
    }

    async function runProxy(req0, opts, done, fromPhone) {
      let req = cloneReq(req0);
      const e = {
        id: ++seqNo, source: opts.source, clientIp: fromPhone ? PHONE_IP : '127.0.0.1',
        scheme: req.scheme, host: req.host, method: req.method, path: req.path, query: req.query,
        req, res: null, tunnel: false, failed: '', notes: [], info: opts.source === 'repeat' ? 'Repeat' : opts.source === 'compose' ? 'Compose' : '',
        duration: 0, pending: true, start: clock(), flags: {},
      };
      const fl = e.flags;
      if (st.recording) { entries.push(e); renderList(); }
      if (opts.onEntry) opts.onEntry(e);

      if (req.host === 'chls.pro') {
        // Сертификат Charles раздаёт сам себе, без обращения в интернет.
        const res = { status: 200, headers: [['Content-Type', 'application/x-x509-ca-cert'], ['Content-Disposition', 'attachment; filename=charles-proxy-ssl-proxying-certificate.pem']], body: CERT_PEM };
        e.notes.push('Charles Root Certificate');
        await wait(120);
        finish(e, res); done(res);
        return;
      }
      const https = req.scheme === 'https';
      const sslHit = https && sslMatch(req.host);
      const decrypt = !https || !fromPhone || sslHit;
      if (blockMatch(req.host, decrypt ? req.path : null)) {
        fl.blocked = true;
        await wait(60);
        if (st.block.action === 'drop' || !decrypt) {
          e.info = 'Blocked';
          fail(e, 'Blocked by Block List: connection dropped', 'dropped'); done({ error: 'dropped' });
          return;
        }
        const res = { status: 403, headers: [['Content-Type', 'text/html'], ['Server', 'Charles']], body: '<html><body><h1>Blocked</h1><p>Blocked by Charles Block List</p></body></html>' };
        e.info = 'Blocked'; e.notes.push('Blocked by Block List (403)');
        finish(e, res); done(res);
        return;
      }
      if (fromPhone && sslHit && !st.phone.certInstalled) {
        await wait(150);
        e.tunnel = true; fl.sslFail = true; e.info = 'SSL handshake failed';
        fail(e, 'SSL handshake with client failed: An unknown issue occurred processing the certificate (certificate_unknown). Remote host terminated the handshake.', 'ssl');
        done({ error: 'ssl' });
        return;
      }
      if (!decrypt) {
        // Без SSL Proxying Charles видит только туннель CONNECT host:443.
        e.tunnel = true;
        const res = server.handle(req);
        if (res.error) { await wait(200); fail(e, 'UnknownHostException: ' + req.host, res.error); done({ error: res.error }); return; }
        const d = delay(req, res, true);
        fl.throttled = d.throttled;
        if (opts.timeout && d.ms > opts.timeout) setTimeout(() => done({ error: 'timeout' }), opts.timeout);
        await wait(d.ms);
        e.duration = d.ms;
        finish(e, res); done(res);
        return;
      }
      const oh = req.host;
      const op = req.path;
      const mr = activeRule(st.mapRemote, (r) => r.toHost && glob(r.fromHost, oh) && glob(r.fromPath, op));
      if (mr) {
        req.host = mr.toHost.trim();
        if (mr.toPath && mr.toPath.trim() && mr.toPath.trim() !== '*') req.path = mr.toPath.trim();
        fl.mapRemote = req.host;
        e.notes.push(`Map Remote → ${fullUrl(req)}`);
        e.info = e.info || 'Map Remote';
      }
      if (rewrite(req, null, oh, op)) { fl.rewritten = true; e.notes.push('Rewrite (request)'); }
      if (noCacheMatch(oh, op)) {
        fl.noCaching = true;
        req.headers = hdel(hdel(req.headers, 'If-None-Match'), 'If-Modified-Since');
        req.headers.push(['Pragma', 'no-cache'], ['Cache-Control', 'no-cache']);
        e.notes.push('No Caching');
      }
      e.req = req;
      const bp = bpMatch(oh, op);
      if (bp && bp.req) {
        const r = await breakpoint(e, 'req', req);
        if (r.action === 'abort') { fail(e, 'Aborted by Breakpoint', 'aborted'); done({ error: 'aborted' }); return; }
        fl.bpReq = true;
        if (r.edited) {
          req = r.obj; fl.reqEdited = true; e.req = req;
          e.method = req.method; e.path = req.path; e.query = req.query;
          if (!fl.mapRemote) e.host = req.host;
          e.notes.push('Request edited in Breakpoint');
        }
      }
      let res;
      const ml = activeRule(st.mapLocal, (r) => r.file && FILES[r.file] && glob(r.host, oh) && glob(r.path, op));
      if (ml) {
        const body = FILES[ml.file].body;
        res = { status: 200, headers: [['Content-Type', 'application/json'], ['Content-Length', String(bytes(body))]], body };
        fl.mapLocal = ml.file;
        e.notes.push(`Map Local → ~/qa/mocks/${ml.file}`);
        e.info = 'Map Local';
      } else res = server.handle(req);
      if (res.error) { await wait(200); fail(e, 'UnknownHostException: ' + req.host, res.error); done({ error: res.error }); return; }
      const d = delay(req, res, true);
      fl.throttled = d.throttled;
      if (opts.timeout && d.ms > opts.timeout) setTimeout(() => done({ error: 'timeout' }), opts.timeout);
      await wait(d.ms);
      e.duration = d.ms;
      res = cloneRes(res);
      if (rewrite(req, res, oh, op)) { fl.rewritten = true; e.notes.push('Rewrite (response)'); }
      if (fl.noCaching) {
        ['Expires', 'Last-Modified', 'ETag', 'Cache-Control'].forEach((h) => { res.headers = hdel(res.headers, h); });
        res.headers.push(['Cache-Control', 'no-cache'], ['Expires', '0']);
      }
      if (bp && bp.res) {
        const r = await breakpoint(e, 'res', res);
        if (r.action === 'abort') { fail(e, 'Aborted by Breakpoint', 'aborted'); done({ error: 'aborted' }); return; }
        fl.bpRes = true;
        if (r.edited) { res = r.obj; fl.resEdited = true; e.notes.push('Response edited in Breakpoint'); }
      }
      if (fl.rewritten && !e.info) e.info = 'Rewrite';
      if (fl.throttled) e.notes.push(`Throttled (${st.throttle.preset})`);
      finish(e, res); done(res);
    }

    function finish(e, res) {
      e.res = res; e.status = res.status; e.pending = false;
      if (e.flags.bpReq || e.flags.bpRes) e.info = e.info === 'Breakpoint' || !e.info ? 'Breakpoint' : e.info;
      afterEntry(e);
      emitResponse(e, null);
    }
    function fail(e, msg, code) {
      e.failed = msg; e.status = 'Failed'; e.pending = false;
      afterEntry(e);
      emitResponse(e, code || 'failed');
    }
    function afterEntry(e) {
      if (!alive()) return;
      renderList();
      if (selected === e.id) renderDetail();
    }
    function emitResponse(e, error) {
      const fl = e.flags;
      emit({
        type: 'response', id: e.id, source: e.source, host: e.host, sentHost: e.req.host, scheme: e.scheme, method: e.req.method, path: e.path,
        status: typeof e.status === 'number' ? e.status : 0, error, ssl: !e.tunnel && !e.failed, tunnel: e.tunnel, sslFail: !!fl.sslFail,
        blocked: !!fl.blocked, viaBreakpoint: !!(fl.bpReq || fl.bpRes), edited: !!(fl.reqEdited || fl.resEdited), reqEdited: !!fl.reqEdited, resEdited: !!fl.resEdited,
        mapLocal: fl.mapLocal || null, mapRemote: fl.mapRemote || null, rewritten: !!fl.rewritten, noCaching: !!fl.noCaching,
        throttled: !!fl.throttled, throttlePreset: fl.throttled ? st.throttle.preset : null, duration: e.duration,
        reqHeaders: lowerObj(e.req.headers), reqJson: parseJson(e.req.body), json: e.res ? parseJson(e.res.body) : undefined,
        empty: !e.res || !e.res.body, reqId: e.res ? hget(e.res.headers, 'X-Request-Id') || null : null,
      });
    }

    // Правила Rewrite: header/body — в своей фазе, host/path/query — в запросе, status — в ответе.
    function rewrite(req, res, oh, op) {
      if (!st.rewrite.on) return false;
      let hit = false;
      st.rewrite.sets.forEach((set) => {
        if (!set.on || !glob(set.host, oh) || !glob(set.path, op)) return;
        set.rules.forEach((r) => {
          if (!r.on) return;
          const mn = String(r.matchName || '').trim();
          const mv = String(r.matchValue || '');
          const nn = String(r.newName || '').trim();
          const nv = String(r.newValue || '');
          const headerRule = ['add-header', 'modify-header', 'remove-header', 'body'].includes(r.type);
          if (headerRule && (res ? r.where !== 'res' : r.where !== 'req')) return;
          const tgt = res || req;
          if (r.type === 'add-header' && nn) { tgt.headers.push([nn, nv]); hit = true; }
          if (r.type === 'modify-header' && mn) {
            tgt.headers = tgt.headers.map(([k, v]) => {
              if (k.toLowerCase() !== mn.toLowerCase() || (mv && !v.includes(mv))) return [k, v];
              hit = true;
              return [nn || k, mv ? v.split(mv).join(nv) : nv];
            });
          }
          if (r.type === 'remove-header' && mn) {
            const n = tgt.headers.length;
            tgt.headers = tgt.headers.filter(([k, v]) => !(k.toLowerCase() === mn.toLowerCase() && (!mv || v.includes(mv))));
            if (tgt.headers.length !== n) hit = true;
          }
          if (r.type === 'body') {
            if (mv && tgt.body.includes(mv)) { tgt.body = tgt.body.split(mv).join(nv); hit = true; } else if (!mv && nv) { tgt.body = nv; hit = true; }
          }
          if (res) {
            if (r.type === 'status' && /^\d{3}$/.test(nv.trim()) && (!mv.trim() || String(res.status) === mv.trim())) { res.status = Number(nv.trim()); hit = true; }
            return;
          }
          if (r.type === 'host' && nv.trim() && (!mv.trim() || req.host === mv.trim())) { req.host = nv.trim(); hit = true; }
          if (r.type === 'path' && mv && req.path.includes(mv)) { req.path = req.path.split(mv).join(nv); hit = true; }
          const pairs = qsParse(req.query);
          if (r.type === 'add-query' && nn) { pairs.push([nn, nv]); req.query = qsBuild(pairs); hit = true; }
          if (r.type === 'modify-query' && mn && pairs.some(([k]) => k === mn)) {
            req.query = qsBuild(pairs.map(([k, v]) => (k === mn && (!mv || v === mv) ? [nn || k, nv] : [k, v]))); hit = true;
          }
          if (r.type === 'remove-query' && mn && pairs.some(([k]) => k === mn)) { req.query = qsBuild(pairs.filter(([k]) => k !== mn)); hit = true; }
        });
      });
      return hit;
    }

    // ---------- Access Control ----------
    function access(ip) {
      if (st.acl.allowed.has(ip)) return Promise.resolve(true);
      if (st.acl.denied.has(ip)) return Promise.resolve(false);
      return new Promise((resolve) => {
        (accessWait[ip] = accessWait[ip] || []).push(resolve);
        if (!promptQueue.includes(ip)) promptQueue.push(ip);
        showPrompt();
      });
    }
    function showPrompt() {
      if (!alive()) return;
      const layer = $('.ch-prompt-layer');
      const ip = promptQueue[0];
      if (!ip) { layer.hidden = true; layer.innerHTML = ''; return; }
      if (layer.dataset.ip === ip && !layer.hidden) return;
      layer.dataset.ip = ip;
      layer.hidden = false;
      layer.innerHTML = `<div class="ch-dlg ch-prompt" role="alertdialog" aria-label="Access Control">
        <div class="ch-dlg-title">Charles — Access Control</div>
        <div class="ch-dlg-body"><p class="ch-prompt-ico">⚠️</p><p>A connection attempt to Charles has been made from the host <b>${ip}</b>.</p>
        <p>If you are not expecting this connection, it may be a potential attack. Allow this host to connect to Charles?</p></div>
        <div class="ch-dlg-btns"><button type="button" class="btn" data-acl="deny">Deny</button><button type="button" class="btn primary" data-acl="allow">Allow</button></div></div>`;
      layer.querySelectorAll('[data-acl]').forEach((b) => b.addEventListener('click', () => decide(ip, b.dataset.acl === 'allow')));
    }
    function decide(ip, allow) {
      promptQueue.splice(promptQueue.indexOf(ip), 1);
      $('.ch-prompt-layer').dataset.ip = '';
      (allow ? st.acl.allowed : st.acl.denied).add(ip);
      (allow ? st.acl.denied : st.acl.allowed).delete(ip);
      (accessWait[ip] || []).forEach((r) => r(allow));
      delete accessWait[ip];
      emit({ type: 'access', ip, allow });
      if (allow && ip === PHONE_IP && S.intruder && !intruderShown) {
        intruderShown = true;
        setTimeout(() => { if (alive()) access(INTRUDER_IP); }, 1200);
      }
      showPrompt();
    }

    // ---------- Breakpoints и Compose ----------
    function breakpoint(e, phase, obj) {
      return new Promise((resolve) => {
        bpQueue.push({ e, phase, obj, resolve });
        e.info = 'Breakpoint';
        renderList();
        renderEditor();
        emit({ type: 'bp-hit', phase, path: e.path, method: e.method });
      });
    }
    function readEditor(kind, orig) {
      const box = $('.ch-editor');
      const val = (k) => { const x = box.querySelector(`[data-ed="${k}"]`); return x ? x.value : ''; };
      if (kind === 'res') {
        const status = Number(val('status'));
        if (!Number.isInteger(status) || status < 100 || status > 599) return { err: 'Status должен быть числом 100–599' };
        const obj = { status, headers: parseHeaders(val('headers')), body: val('body') };
        const edited = !orig || status !== orig.status || headersText(obj.headers) !== headersText(orig.headers) || obj.body !== orig.body;
        return { obj, edited };
      }
      let u;
      try { u = new URL(val('url').trim()); } catch (er) { return { err: 'Некорректный URL' }; }
      const obj = { scheme: u.protocol.replace(':', ''), host: u.hostname, method: val('method').toUpperCase(), path: u.pathname, query: u.search.replace(/^\?/, ''), headers: parseHeaders(val('headers')), body: val('body') };
      const edited = !orig || fullUrl(obj) !== fullUrl(orig) || obj.method !== orig.method || headersText(obj.headers) !== headersText(orig.headers) || obj.body !== orig.body;
      return { obj, edited };
    }
    function bpResolve(action) {
      const b = bpQueue[0];
      if (!b) return;
      let obj = b.obj;
      let edited = false;
      if (action === 'exec') {
        const p = readEditor(b.phase, b.obj);
        if (p.err) { toast(p.err); return; }
        obj = p.obj; edited = p.edited;
      }
      bpQueue.shift();
      b.e.info = '';
      emit({ type: 'bp-action', action, phase: b.phase, path: b.e.path, edited });
      b.resolve({ action, obj, edited });
      renderEditor();
      renderList();
    }
    function openCompose(e) {
      const r = e ? e.req : { scheme: 'https', host: API, method: 'GET', path: '/v2/catalog', query: '', headers: [['User-Agent', UA], ['Accept', 'application/json']], body: '' };
      composeDraft = cloneReq(r);
      editorKey = '';
      renderEditor();
      emit({ type: 'compose-open', path: r.path });
    }
    function composeExec() {
      const p = readEditor('req', null);
      if (p.err) { toast(p.err); return; }
      composeDraft = null;
      editorKey = '';
      renderEditor();
      emit({ type: 'compose', method: p.obj.method, path: p.obj.path });
      send(p.obj, { source: 'compose', onEntry: (e) => { select(e.id, true); } });
    }

    function renderEditor() {
      if (!alive()) return;
      const box = $('.ch-editor');
      const b = bpQueue[0];
      let key;
      let html;
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
      const reqForm = (r) => `
        <div class="ch-ed-grid">
          <label class="ch-ed-m">Method<select data-ed="method">${methods.map((m) => `<option ${m === r.method ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
          <label class="ch-ed-u">URL<input data-ed="url" value="${esc(fullUrl(r))}" spellcheck="false"></label>
          <label class="ch-ed-w">Headers<textarea data-ed="headers" rows="5" spellcheck="false">${esc(headersText(r.headers))}</textarea></label>
          <label class="ch-ed-w">Body<textarea data-ed="body" rows="6" spellcheck="false">${esc(r.body)}</textarea></label>
        </div>`;
      if (b) {
        key = `bp${b.e.id}${b.phase}`;
        const more = bpQueue.length > 1 ? ` <small>(+${bpQueue.length - 1} в очереди)</small>` : '';
        if (b.phase === 'req') {
          html = `<div class="ch-ed-head">⏸ Breakpoint · <b>Edit Request</b> · ${esc(b.e.method)} ${esc(fullUrl(b.obj))}${more}</div>${reqForm(b.obj)}`;
        } else {
          html = `<div class="ch-ed-head">⏸ Breakpoint · <b>Edit Response</b> · ${esc(b.e.method)} ${esc(fullUrl(b.e.req))}${more}</div>
            <div class="ch-ed-grid">
              <label class="ch-ed-m">Status<input data-ed="status" type="number" min="100" max="599" value="${b.obj.status}"></label>
              <label class="ch-ed-w">Headers<textarea data-ed="headers" rows="5" spellcheck="false">${esc(headersText(b.obj.headers))}</textarea></label>
              <label class="ch-ed-w">Body<textarea data-ed="body" rows="8" spellcheck="false">${esc(b.obj.body)}</textarea></label>
            </div>`;
        }
        html += '<div class="ch-ed-actions"><button type="button" class="btn" data-cmd="bp-cancel" title="Продолжить без изменений">Cancel</button><button type="button" class="btn" data-cmd="bp-abort" title="Оборвать запрос">Abort</button><button type="button" class="btn primary" data-cmd="bp-exec">Execute</button></div>';
      } else if (composeDraft) {
        key = 'compose';
        html = `<div class="ch-ed-head">✎ <b>Compose</b> · Edit Request</div>${reqForm(composeDraft)}
          <div class="ch-ed-actions"><button type="button" class="btn" data-cmd="compose-close">Close</button><button type="button" class="btn primary" data-cmd="compose-exec">Execute</button></div>`;
      }
      renderToolbar();
      if (!key) { box.hidden = true; box.innerHTML = ''; editorKey = ''; return; }
      if (key === editorKey) {
        const small = box.querySelector('.ch-ed-head small');
        if (small) small.textContent = bpQueue.length > 1 ? `(+${bpQueue.length - 1} в очереди)` : '';
        return;
      }
      editorKey = key;
      box.hidden = false;
      box.innerHTML = html;
    }

    // ================= ОКНО CHARLES =================
    const cur = () => entries.find((x) => x.id === selected) || null;
    const urlOf = (e) => (e.tunnel ? `https://${e.host}:443` : `${e.scheme}://${e.host}${e.path}${e.query ? '?' + e.query : ''}`);
    function entryInfo(e) {
      return { id: e.id, host: e.host, path: e.path, method: e.tunnel ? 'CONNECT' : e.method, status: typeof e.status === 'number' ? e.status : 0, ssl: !e.tunnel && !e.failed, tunnel: e.tunnel, source: e.source, mapped: !!e.flags.mapRemote };
    }
    function codeOf(e) {
      if (e.pending) return '…';
      if (e.failed) return 'Failed';
      return e.tunnel ? 200 : e.status;
    }
    function visible() {
      const f = filter.toLowerCase();
      return entries.filter((e) => (!focusedOnly || st.focus.has(e.host)) && (!f || urlOf(e).toLowerCase().includes(f)));
    }

    function renderList() {
      if (!alive()) return;
      el.querySelectorAll('.ch-viewtabs button').forEach((b) => b.classList.toggle('on', b.dataset.cmd === 'view-' + view));
      $('.ch-filterbar').hidden = view !== 'sequence';
      const box = $('.ch-list');
      const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 6;
      if (view === 'sequence') {
        const rows = visible();
        box.innerHTML = `<table class="ch-seqt"><thead><tr><th>Code</th><th>Method</th><th>Host</th><th>Path</th><th>Duration</th><th>Size</th><th>Info</th></tr></thead><tbody>${rows.map((e) => {
          const code = codeOf(e);
          const cls = [selected === e.id ? 'sel' : '', e.tunnel ? 'enc' : '', e.failed ? 'bad' : '', (typeof code === 'number' && code >= 400) ? 'err' : '', e.pending ? 'pend' : ''].join(' ');
          const size = e.res ? fmtSize(resSize(e.res)) : '—';
          return `<tr data-id="${e.id}" class="${cls}"><td>${code}</td><td>${e.tunnel ? 'CONNECT' : esc(e.method)}</td><td>${esc(e.host)}${e.tunnel ? ':443' : ''}</td><td>${e.tunnel ? '' : esc(e.path + (e.query ? '?' + e.query : ''))}</td><td>${e.pending ? '' : e.duration + ' ms'}</td><td>${size}</td><td>${esc(e.info)}</td></tr>`;
        }).join('') || `<tr><td colspan="7" class="ch-empty">${entries.length ? 'Под фильтр ничего не попало.' : 'Трафика нет. Сделай что-нибудь в приложении на телефоне.'}</td></tr>`}</tbody></table>`;
      } else {
        const hosts = [];
        entries.forEach((e) => { const k = `${e.scheme}://${e.host}`; if (!hosts.includes(k)) hosts.push(k); });
        const hostOf = (k) => k.replace(/^\w+:\/\//, '');
        const node = (k) => {
          const list = entries.filter((e) => `${e.scheme}://${e.host}` === k);
          const paths = [];
          list.forEach((e) => { if (!e.tunnel && !paths.includes(e.path)) paths.push(e.path); });
          const open = expanded.has(k);
          const lock = list.every((e) => e.tunnel);
          const last = list[list.length - 1];
          const kids = open ? (paths.length ? paths.map((p) => {
            const n = list.filter((e) => !e.tunnel && e.path === p);
            const le = n[n.length - 1];
            return `<li><button type="button" class="ch-node${selected === le.id ? ' sel' : ''}" data-id="${le.id}">📄 ${esc(p)} <small>(${n.length})</small></button></li>`;
          }).join('') : `<li><button type="button" class="ch-node${selected === last.id ? ' sel' : ''}" data-id="${last.id}">🔒 &lt;unknown&gt; <small>(${list.length})</small></button></li>`) : '';
          return `<li><button type="button" class="ch-node host${st.focus.has(hostOf(k)) ? ' focused' : ''}" data-host="${esc(k)}" data-id="${last.id}">${open ? '▾' : '▸'} ${lock ? '🔒' : '🌐'} ${esc(k)}</button>${open ? `<ul>${kids}</ul>` : ''}</li>`;
        };
        let html;
        if (st.focus.size) {
          const foc = hosts.filter((k) => st.focus.has(hostOf(k)));
          const rest = hosts.filter((k) => !st.focus.has(hostOf(k)));
          html = foc.map(node).join('') + (rest.length ? `<li><button type="button" class="ch-node other" data-other>${otherOpen ? '▾' : '▸'} 📁 Other Hosts <small>(${rest.length})</small></button>${otherOpen ? `<ul>${rest.map(node).join('')}</ul>` : ''}</li>` : '');
        } else html = hosts.map(node).join('');
        box.innerHTML = `<ul class="ch-tree">${html || '<li class="ch-empty">Трафика нет. Сделай что-нибудь в приложении на телефоне.</li>'}</ul>`;
      }
      if (stick) box.scrollTop = box.scrollHeight;
      renderStatus();
    }

    function select(id, quiet) {
      selected = id;
      const e = cur();
      renderList();
      renderDetail();
      if (e && !quiet) emit(Object.assign({ type: 'select' }, entryInfo(e)));
    }

    function overviewHtml(e) {
      const rows = [
        ['URL', urlOf(e)],
        ['Status', e.pending ? (e.info === 'Breakpoint' ? 'Breakpoint — ожидает действий' : 'Receiving response…') : e.failed ? 'Failed' : 'Complete'],
      ];
      if (e.failed) rows.push(['Failure', e.failed]);
      rows.push(['Response Code', e.tunnel && !e.failed ? '200 Connection established' : e.res ? `${e.res.status} ${STATUS_TEXT[e.res.status] || ''}` : '—']);
      rows.push(['Protocol', 'HTTP/1.1']);
      if (e.scheme === 'https') rows.push(['TLS', e.tunnel ? (e.flags.sslFail ? 'Handshake failed: устройство не доверяет сертификату Charles' : 'SSL Proxying not enabled for this host: enable in Proxy › SSL Proxying Settings') : 'TLSv1.3 (TLS_AES_128_GCM_SHA256)']);
      rows.push(['Method', e.tunnel ? 'CONNECT' : e.method]);
      rows.push(['Kept Alive', 'Yes']);
      if (e.res && !e.tunnel) rows.push(['Content-Type', hget(e.res.headers, 'Content-Type') || '—']);
      rows.push(['Client Address', `/${e.clientIp}`]);
      rows.push(['Remote Address', `${e.req.host}/104.18.${(e.id * 7) % 250}.${(e.id * 13) % 250}:${e.scheme === 'https' ? 443 : 80}`]);
      if (e.notes.length) rows.push(['Notes', e.notes.join(' · ')]);
      rows.push(['Request Start Time', `11.10.26 ${e.start}`]);
      rows.push(['Duration', e.pending ? '—' : `${e.duration} ms`]);
      rows.push(['Request Size', e.tunnel ? '—' : fmtSize(bytes(e.req.body) + bytes(headersText(e.req.headers)) + 40)]);
      rows.push(['Response Size', e.res && !e.tunnel ? fmtSize(resSize(e.res)) : '—']);
      return `<table class="ch-kv">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
    }

    function jsonTree(v) {
      if (v === null) return '<span class="jn">null</span>';
      if (Array.isArray(v)) return `<span class="jt">Array[${v.length}]</span><ul>${v.map((x, i) => `<li><span class="jk">${i}</span>: ${jsonTree(x)}</li>`).join('')}</ul>`;
      if (typeof v === 'object') return `<span class="jt">Object</span><ul>${Object.keys(v).map((k) => `<li><span class="jk">${esc(k)}</span>: ${jsonTree(v[k])}</li>`).join('')}</ul>`;
      if (typeof v === 'string') return `<span class="js">"${esc(v)}"</span>`;
      return `<span class="jv">${esc(v)}</span>`;
    }
    const rawReq = (r) => `${r.method} ${r.path}${r.query ? '?' + r.query : ''} HTTP/1.1\nHost: ${r.host}\n${headersText(r.headers)}${r.body ? `\nContent-Length: ${bytes(r.body)}\n\n${r.body}` : ''}`;
    const rawRes = (s) => `HTTP/1.1 ${s.status} ${STATUS_TEXT[s.status] || ''}\n${headersText(s.headers)}${s.body ? `\n\n${s.body}` : s.binary ? `\n\n${s.binary}` : ''}`;
    const kvTable = (pairs, first) => `<table class="ch-kv">${first ? `<tr><td colspan="2" class="ch-reqline">${esc(first)}</td></tr>` : ''}${pairs.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;

    function contentsHtml(e, shown) {
      if (e.tunnel) {
        return e.flags.sslFail
          ? '<p class="ch-enc">❌ SSL handshake with client failed. Телефон не доверяет сертификату Charles: установи его на устройство (chls.pro/ssl).</p>'
          : '<p class="ch-enc">🔒 Содержимое зашифровано (CONNECT-туннель). Включи SSL Proxying для этого хоста: правый клик → Enable SSL Proxying или Proxy › SSL Proxying Settings.</p>';
      }
      const r = e.req;
      const q = qsParse(r.query);
      const rj = parseJson(r.body);
      const reqTabs = [['headers', 'Headers']].concat(q.length ? [['query', 'Query']] : [], r.body ? [['text', 'Text']] : [], rj !== undefined ? [['json', 'JSON']] : [], [['raw', 'Raw']]);
      shown.req = reqTabs.some(([k]) => k === reqPane) ? reqPane : 'headers';
      let reqBody;
      if (shown.req === 'headers') reqBody = kvTable(r.headers, `${r.method} ${r.path}${r.query ? '?' + r.query : ''} HTTP/1.1`);
      else if (shown.req === 'query') reqBody = kvTable(q);
      else if (shown.req === 'text') reqBody = `<pre>${esc(prettyBody(r.body))}</pre>`;
      else if (shown.req === 'json') reqBody = `<div class="ch-json">${jsonTree(rj)}</div>`;
      else reqBody = `<pre>${esc(rawReq(r))}</pre>`;
      const tabs = (side, list, on) => `<div class="ch-subtabs">${list.map(([k, l]) => `<button type="button" data-pane="${side}:${k}" class="${k === on ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      let resHtml;
      const s = e.res;
      if (!s) {
        shown.res = 'none';
        resHtml = `<p class="ch-empty">${e.failed ? 'Ответа нет: ' + esc(e.failed) : 'Ожидание ответа…'}</p>`;
      } else {
        const sj = parseJson(s.body);
        const resTabs = [['headers', 'Headers'], ['text', s.binary ? 'Image' : 'Text']].concat(sj !== undefined ? [['json', 'JSON']] : [], [['raw', 'Raw']]);
        shown.res = resTabs.some(([k]) => k === resPane) ? resPane : 'text';
        let b;
        if (shown.res === 'headers') b = kvTable(s.headers, `HTTP/1.1 ${s.status} ${STATUS_TEXT[s.status] || ''}`);
        else if (shown.res === 'text') b = s.binary ? `<p class="ch-img">🖼️ ${esc(s.binary)}</p>` : s.body ? `<pre>${esc(prettyBody(s.body))}</pre>` : '<p class="ch-empty">Тело ответа пустое (0 байт).</p>';
        else if (shown.res === 'json') b = `<div class="ch-json">${jsonTree(sj)}</div>`;
        else b = `<pre>${esc(rawRes(s))}</pre>`;
        resHtml = tabs('res', resTabs, shown.res) + b;
      }
      return `<div class="ch-half"><p class="ch-sub">Request</p>${tabs('req', reqTabs, shown.req)}${reqBody}</div>
        <div class="ch-half"><p class="ch-sub">Response</p>${resHtml}</div>`;
    }

    function renderDetail() {
      if (!alive()) return;
      const box = $('.ch-detail');
      const e = cur();
      if (!e) { box.innerHTML = '<p class="ch-empty">Выбери запрос в списке (правый клик или «Actions ▾» — меню действий).</p>'; return; }
      const shown = {};
      const body = detailTab === 'overview' ? overviewHtml(e) : contentsHtml(e, shown);
      box.innerHTML = `<div class="ch-dhead"><span class="ch-durl">${esc(e.tunnel ? 'CONNECT' : e.method)} ${esc(urlOf(e))}</span><button type="button" class="btn" data-cmd="ctx-open">Actions ▾</button></div>
        <div class="ch-tabs"><button type="button" data-t="overview" class="${detailTab === 'overview' ? 'on' : ''}">Overview</button><button type="button" data-t="contents" class="${detailTab === 'contents' ? 'on' : ''}">Contents</button></div>
        <div class="ch-pane">${body}</div>`;
      if (detailTab === 'contents' && !e.tunnel) {
        const key = `${e.id}|${shown.req}|${shown.res}`;
        if (key !== lastPaneKey) {
          lastPaneKey = key;
          const info = entryInfo(e);
          emit(Object.assign({ type: 'pane', side: 'req', pane: shown.req }, info));
          if (shown.res !== 'none') emit(Object.assign({ type: 'pane', side: 'res', pane: shown.res }, info));
        }
      }
    }

    function renderToolbar() {
      $('.ch-tb-rec').classList.toggle('on', st.recording);
      $('.ch-tb-thr').classList.toggle('on', st.throttle.on);
      $('.ch-tb-bp').classList.toggle('on', st.bpOn);
      $('.ch-tb-bp').classList.toggle('hit', bpQueue.length > 0);
    }
    function renderStatus() {
      renderToolbar();
      const t = [st.recording ? '● Recording' : '○ Not recording'];
      if (st.throttle.on) t.push(`🐢 Throttling: ${st.throttle.preset}`);
      if (bpActive(st)) t.push('⬣ Breakpoints');
      if (mapLocalActive(st)) t.push('Map Local');
      if (mapRemoteActive(st)) t.push('Map Remote');
      if (rewriteActive(st)) t.push('Rewrite');
      if (st.noCache.on) t.push('No Caching');
      if (blockActive(st)) t.push('Block List');
      t.push(`${entries.length} requests`);
      $('.ch-statusbar').textContent = t.join('  ·  ');
    }

    let toastTimer = 0;
    function toast(msg) {
      const t = $('.ch-toast');
      t.textContent = msg;
      t.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { if (alive()) t.hidden = true; }, 2600);
    }

    // ---------- меню ----------
    const MENUS = {
      file: () => [['clear', 'New Session'], ['clear', 'Clear Session']],
      edit: () => [['copy-url', 'Copy URL', !cur()], ['copy-curl', 'Copy cURL Request', !cur() || cur().tunnel]],
      view: () => [['view-structure', 'Structure', false, view === 'structure'], ['view-sequence', 'Sequence', false, view === 'sequence']],
      proxy: () => [['record', 'Recording', false, st.recording], ['throttle', 'Throttling', false, st.throttle.on], ['breakpoints', 'Breakpoints', false, st.bpOn], '-',
        ['dlg-throttle', 'Throttle Settings…'], ['dlg-bp', 'Breakpoint Settings…'], '-', ['dlg-proxy', 'Proxy Settings…'], ['dlg-ssl', 'SSL Proxying Settings…'], ['dlg-access', 'Access Control Settings…']],
      tools: () => [['dlg-nocache', 'No Caching…', false, st.noCache.on], ['dlg-block', 'Block List…', false, st.block.on], ['dlg-mapremote', 'Map Remote…', false, st.mapRemote.on],
        ['dlg-maplocal', 'Map Local…', false, st.mapLocal.on], ['dlg-rewrite', 'Rewrite…', false, st.rewrite.on], '-', ['compose-new', 'Compose New…'], ['repeat-adv', 'Repeat Advanced…', !cur() || cur().tunnel]],
      help: () => [['help-ip', 'Local IP Address'], ['help-ssl', 'SSL Proxying › Install Charles Root Certificate on a Mobile Device or Remote Browser'], '-', ['help-about', 'About Charles']],
    };
    function ctxItems(e) {
      const exactSsl = st.sslLocs.some((l) => l.host === e.host);
      const decrypted = !e.tunnel || e.flags.sslFail;
      const hasBp = st.bps.some((b) => b.host === e.host && b.path === e.path);
      const hasNc = st.noCache.on && st.noCache.locs.some((l) => l.host === e.host);
      const hasBl = st.block.on && st.block.locs.some((l) => l.host === e.host && (e.tunnel ? (!l.path || l.path === '*') : l.path === e.path));
      return [['cx-copy-url', 'Copy URL'], ['cx-copy-curl', 'Copy cURL Request', e.tunnel], '-',
        ['cx-focus', st.focus.has(e.host) ? 'Unfocus' : 'Focus'], '-',
        decrypted && (exactSsl || sslMatch(e.host)) ? ['cx-ssl-off', 'Disable SSL Proxying'] : ['cx-ssl-on', 'Enable SSL Proxying'], '-',
        ['cx-repeat', 'Repeat', e.tunnel || e.pending], ['cx-repeat-adv', 'Repeat Advanced…', e.tunnel || e.pending], ['cx-compose', 'Compose', e.tunnel], '-',
        ['cx-bp', 'Breakpoints', e.tunnel, hasBp], ['cx-nocache', 'No Caching', false, hasNc], ['cx-block', 'Block List', false, hasBl],
        ['cx-mapremote', 'Map Remote…', e.tunnel], ['cx-maplocal', 'Map Local…', e.tunnel]];
    }
    function showDropdown(items, x, y) {
      const dd = $('.ch-dropdown');
      dd.innerHTML = items.map((it) => (it === '-' ? '<hr>' : `<button type="button" role="menuitem" data-cmd="${it[0]}" ${it[2] ? 'disabled' : ''}><span class="ck">${it[3] ? '✓' : ''}</span>${esc(it[1])}</button>`)).join('');
      dd.hidden = false;
      const W = chEl.clientWidth;
      dd.style.left = '0px';
      dd.style.top = `${y}px`;
      const w = dd.offsetWidth;
      dd.style.left = `${Math.max(4, Math.min(x, W - w - 4))}px`;
    }
    let openMenu = '';
    const hideDropdown = () => { const dd = $('.ch-dropdown'); dd.hidden = true; dd.innerHTML = ''; openMenu = ''; };
    function relPos(node) {
      const a = chEl.getBoundingClientRect();
      const b = node.getBoundingClientRect();
      return { x: b.left - a.left, y: b.bottom - a.top };
    }
    function openCtx(e, x, y) {
      ctxEntry = e;
      showDropdown(ctxItems(e), x, y);
      openMenu = '';
    }

    // ---------- диалоги ----------
    function openDialog(o) {
      hideDropdown();
      const layer = $('.ch-dlg-layer');
      layer.hidden = false;
      layer.innerHTML = `<div class="ch-dlg" role="dialog" aria-label="${esc(o.title)}"><div class="ch-dlg-title">${esc(o.title)}</div>
        <div class="ch-dlg-body">${o.body}</div>
        <div class="ch-dlg-btns">${o.cancel === false ? '' : '<button type="button" class="btn" data-dlg="cancel">Cancel</button>'}<button type="button" class="btn primary" data-dlg="ok">${o.ok || 'OK'}</button></div></div>`;
      const box = layer.querySelector('.ch-dlg');
      if (o.open) o.open(box);
      layer.querySelector('[data-dlg="ok"]').addEventListener('click', () => {
        if (o.onOk && o.onOk(box) === false) return;
        closeDialog();
        renderStatus();
      });
      const c = layer.querySelector('[data-dlg="cancel"]');
      if (c) c.addEventListener('click', closeDialog);
      if (chEl.getBoundingClientRect().top < 0) chEl.scrollIntoView({ block: 'start' });
    }
    function closeDialog() { const l = $('.ch-dlg-layer'); l.hidden = true; l.innerHTML = ''; }

    // Таблица правил с редактированием прямо в ячейках (как списки Locations в Charles).
    function tableEditor(box, cols, rows, blank, onChange) {
      const sync = () => box.querySelectorAll('tbody tr[data-i]').forEach((tr) => {
        const r = rows[+tr.dataset.i];
        tr.querySelectorAll('[data-k]').forEach((inp) => { r[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.value.trim(); });
      });
      const cell = (c, r) => {
        const v = r[c.k];
        if (c.type === 'check') return `<td class="c"><input type="checkbox" data-k="${c.k}" ${v ? 'checked' : ''} aria-label="${esc(c.label)}"></td>`;
        if (c.type === 'select') return `<td><select data-k="${c.k}" aria-label="${esc(c.label)}">${c.options.map(([val, lab]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select></td>`;
        return `<td><input type="text" data-k="${c.k}" value="${esc(v)}" placeholder="${esc(c.ph || '')}" aria-label="${esc(c.label)}" spellcheck="false"></td>`;
      };
      function render() {
        box.innerHTML = `<div class="ch-te-wrap"><table class="ch-te"><thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}<th></th></tr></thead>
          <tbody>${rows.map((r, i) => `<tr data-i="${i}">${cols.map((c) => cell(c, r)).join('')}<td><button type="button" class="ch-te-del" data-del="${i}" title="Remove" aria-label="Remove">✕</button></td></tr>`).join('') || `<tr><td colspan="${cols.length + 1}" class="ch-empty">Список пуст — нажми Add.</td></tr>`}</tbody></table></div>
          <div class="ch-te-btns"><button type="button" class="btn" data-add>Add</button></div>`;
        box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { sync(); rows.splice(+b.dataset.del, 1); render(); if (onChange) onChange(); }));
        box.querySelector('[data-add]').addEventListener('click', () => {
          sync(); rows.push(Object.assign({}, blank)); render(); if (onChange) onChange();
          const inp = box.querySelector('tbody tr:last-child input[type="text"]');
          if (inp) inp.focus();
        });
      }
      render();
      return { rows: () => { sync(); return rows; }, render };
    }

    function listDialog(o) {
      let te;
      openDialog({
        title: o.title,
        body: `${o.enable ? `<label class="ch-chk"><input type="checkbox" data-o="enable" ${o.enable[0] ? 'checked' : ''}> ${o.enable[1]}</label>` : ''}${o.top || ''}${o.note ? `<p class="ch-dlg-note">${o.note}</p>` : ''}
          <p class="ch-dlg-sub">${o.listTitle || 'Locations'}</p><div data-te></div>${o.bottom || ''}`,
        open: (box) => {
          te = tableEditor(box.querySelector('[data-te]'), o.cols, o.rows.map((r) => Object.assign({}, r)), o.blank);
          // Добавил правило — значит, хочет его включить: отмечаем Enable, как подсказка.
          box.querySelector('[data-te]').addEventListener('click', (ev) => {
            const en = box.querySelector('[data-o="enable"]');
            if (en && ev.target.closest('[data-add]')) en.checked = true;
          });
        },
        onOk: (box) => {
          const en = box.querySelector('[data-o="enable"]');
          o.apply(te.rows().filter(o.keep || (() => true)), en ? en.checked : null, box);
        },
      });
    }
    const C_ON = { k: 'on', label: '✓', type: 'check' };
    const C_HOST = { k: 'host', label: 'Host', ph: 'api.potions.shop' };
    const C_PATH = { k: 'path', label: 'Path', ph: '*' };
    const keepHost = (r) => r.host;

    function dlgSsl(addRow) {
      const rows = st.sslLocs.slice();
      if (addRow) rows.push(addRow);
      listDialog({
        title: 'SSL Proxying Settings', enable: [st.sslOn || !!addRow, 'Enable SSL Proxying'], listTitle: 'Include',
        top: '<div class="ch-dlg-tabs"><span class="on">SSL Proxying</span><span>Client Certificates</span><span>Root Certificate</span></div>',
        note: 'Charles расшифровывает HTTPS только для хостов из списка Include. Маски: <code>*.potions.shop</code> — все поддомены, <code>*</code> — всё подряд. На устройстве должен стоять доверенный сертификат Charles.',
        cols: [C_ON, { k: 'host', label: 'Host', ph: '*.example.com' }, { k: 'port', label: 'Port', ph: '443' }], rows, blank: { on: true, host: '', port: '443' }, keep: keepHost,
        apply: (r, en) => { st.sslOn = en; st.sslLocs = r; emit({ type: 'tool', tool: 'ssl', on: en, hosts: r.filter((x) => x.on).map((x) => x.host) }); },
      });
    }
    function dlgAccess() {
      listDialog({
        title: 'Access Control Settings', listTitle: 'Access Control List (IP / сеть)',
        note: 'Charles принимает подключения только с адресов из списка. С неизвестного адреса появится окно Allow/Deny.',
        cols: [{ k: 'ip', label: 'IP address', ph: '192.168.1.23' }], rows: [...st.acl.allowed].map((ip) => ({ ip })), blank: { ip: '' }, keep: (r) => r.ip,
        apply: (r) => {
          st.acl.allowed = new Set(r.map((x) => x.ip));
          r.forEach((x) => st.acl.denied.delete(x.ip));
          emit({ type: 'tool', tool: 'access', ips: [...st.acl.allowed] });
        },
      });
    }
    function dlgBp(addRow) {
      const rows = st.bps.slice();
      if (addRow) rows.push(addRow);
      listDialog({
        title: 'Breakpoint Settings', enable: [st.bpOn || !!addRow, 'Enable Breakpoints'],
        note: 'Request — остановить запрос до отправки на сервер, Response — остановить ответ до отдачи в приложение. Path поддерживает маски: <code>/v2/products/*</code>.',
        cols: [C_ON, C_HOST, C_PATH, { k: 'req', label: 'Request', type: 'check' }, { k: 'res', label: 'Response', type: 'check' }],
        rows, blank: { on: true, host: API, path: '*', req: true, res: true }, keep: keepHost,
        apply: (r, en) => { st.bpOn = en; st.bps = r; emit({ type: 'tool', tool: 'breakpoints', on: en }); },
      });
    }
    function dlgNoCache(addRow) {
      const rows = st.noCache.locs.slice();
      if (addRow) rows.push(addRow);
      listDialog({
        title: 'No Caching Settings', enable: [st.noCache.on || !!addRow, 'Enable No Caching'],
        top: `<label class="ch-chk"><input type="checkbox" data-o="only" ${st.noCache.only || addRow ? 'checked' : ''}> Only for selected locations</label>`,
        note: 'Charles убирает из запросов If-None-Match / If-Modified-Since и добавляет Pragma: no-cache, а из ответов — ETag, Last-Modified, Expires и Cache-Control.',
        cols: [C_ON, C_HOST, C_PATH], rows, blank: { on: true, host: API, path: '*' }, keep: keepHost,
        apply: (r, en, box) => { st.noCache = { on: en, only: box.querySelector('[data-o="only"]').checked, locs: r }; emit({ type: 'tool', tool: 'nocache', on: en }); },
      });
    }
    function dlgBlock(addRow) {
      const rows = st.block.locs.slice();
      if (addRow) rows.push(addRow);
      listDialog({
        title: 'Block List Settings', enable: [st.block.on || !!addRow, 'Enable Block List'],
        note: 'Запросы к этим адресам не дойдут до сервера. Для HTTPS без SSL Proxying блокировка работает по хосту (Path = *).',
        cols: [C_ON, C_HOST, C_PATH], rows, blank: { on: true, host: '', path: '*' }, keep: keepHost,
        bottom: `<label class="ch-field">Blocking action <select data-o="action"><option value="drop" ${st.block.action === 'drop' ? 'selected' : ''}>Drop connection</option><option value="403" ${st.block.action === '403' ? 'selected' : ''}>Return 403 response</option></select></label>`,
        apply: (r, en, box) => { st.block = { on: en, action: box.querySelector('[data-o="action"]').value, locs: r }; emit({ type: 'tool', tool: 'block', on: en, action: st.block.action }); },
      });
    }
    function dlgMapRemote(addRow) {
      const rows = st.mapRemote.rules.slice();
      if (addRow) rows.push(addRow);
      listDialog({
        title: 'Map Remote Settings', enable: [st.mapRemote.on || !!addRow, 'Enable Map Remote'], listTitle: 'Mappings',
        note: `Запрос на адрес From уходит на адрес To, а приложение думает, что говорит с исходным сервером. Пустой To path — путь сохраняется. Стенды: <code>${API}</code> (prod), <code>${STG}</code> (staging).`,
        cols: [C_ON, { k: 'fromHost', label: 'From host', ph: API }, { k: 'fromPath', label: 'From path', ph: '*' }, { k: 'toHost', label: 'To host', ph: STG }, { k: 'toPath', label: 'To path', ph: '' }],
        rows, blank: { on: true, fromHost: '', fromPath: '*', toHost: '', toPath: '' }, keep: (r) => r.fromHost,
        apply: (r, en) => { st.mapRemote = { on: en, rules: r }; emit({ type: 'tool', tool: 'mapremote', on: en }); },
      });
    }
    function dlgMapLocal(addRow) {
      const rows = st.mapLocal.rules.slice();
      if (addRow) rows.push(addRow);
      const opts = [['', '— выбери файл —']].concat(Object.keys(FILES).map((f) => [f, '~/qa/mocks/' + f]));
      listDialog({
        title: 'Map Local Settings', enable: [st.mapLocal.on || !!addRow, 'Enable Map Local'], listTitle: 'Mappings',
        note: 'Ответ на запрос берётся из локального файла, сервер не вызывается (нужен SSL Proxying для HTTPS).',
        cols: [C_ON, C_HOST, C_PATH, { k: 'file', label: 'Local path', type: 'select', options: opts }],
        rows, blank: { on: true, host: API, path: '', file: '' }, keep: keepHost,
        bottom: `<details class="ch-files"><summary>Файлы в ~/qa/mocks</summary><ul>${Object.keys(FILES).map((f) => `<li><code>${f}</code> — ${esc(FILES[f].about)}</li>`).join('')}</ul></details>`,
        apply: (r, en) => { st.mapLocal = { on: en, rules: r }; emit({ type: 'tool', tool: 'maplocal', on: en }); },
      });
    }
    function dlgRewrite() {
      const sets = clone(st.rewrite.sets);
      let curSet = 0;
      let setsTe;
      let rulesTe;
      const ruleCols = [C_ON, { k: 'type', label: 'Type', type: 'select', options: REWRITE_TYPES }, { k: 'where', label: 'Where', type: 'select', options: [['req', 'Request'], ['res', 'Response']] },
        { k: 'matchName', label: 'Match name', ph: 'Authorization' }, { k: 'matchValue', label: 'Match value', ph: '' }, { k: 'newName', label: 'Replace name', ph: '' }, { k: 'newValue', label: 'Replace value', ph: '' }];
      const blankRule = { on: true, type: 'modify-header', where: 'req', matchName: '', matchValue: '', newName: '', newValue: '' };
      function renderRules(box) {
        const sel = box.querySelector('[data-o="set"]');
        const all = setsTe.rows();
        if (curSet >= all.length) curSet = Math.max(0, all.length - 1);
        sel.innerHTML = all.map((s, i) => `<option value="${i}" ${i === curSet ? 'selected' : ''}>${esc(s.name || 'Set ' + (i + 1))}</option>`).join('');
        const rb = box.querySelector('[data-rules]');
        if (!all.length) { rb.innerHTML = '<p class="ch-empty">Сначала добавь набор правил (Add в списке Sets).</p>'; rulesTe = null; return; }
        if (!all[curSet].rules) all[curSet].rules = [];
        rulesTe = tableEditor(rb, ruleCols, all[curSet].rules, blankRule);
      }
      openDialog({
        title: 'Rewrite Settings',
        body: `<label class="ch-chk"><input type="checkbox" data-o="enable" ${st.rewrite.on || !sets.length ? 'checked' : ''}> Enable Rewrite</label>
          <p class="ch-dlg-note">Набор (Set) действует на свои Locations (Host + Path) и содержит правила. Типы: Add/Modify/Remove Header, Host, Path, Add/Modify/Remove Query Param, Response Status (Match value 200 → Replace value 401), Body (замена текста).</p>
          <p class="ch-dlg-sub">Sets</p><div data-sets></div>
          <label class="ch-field">Rules of set <select data-o="set"></select></label><div data-rules></div>`,
        open: (box) => {
          setsTe = tableEditor(box.querySelector('[data-sets]'), [C_ON, { k: 'name', label: 'Name', ph: 'Expired token' }, { k: 'host', label: 'Location host', ph: API }, C_PATH],
            sets, { on: true, name: '', host: API, path: '*', rules: [] }, () => { if (rulesTe) rulesTe.rows(); renderRules(box); });
          box.querySelector('[data-o="set"]').addEventListener('change', (ev) => { if (rulesTe) rulesTe.rows(); curSet = Number(ev.target.value); renderRules(box); });
          renderRules(box);
        },
        onOk: (box) => {
          if (rulesTe) rulesTe.rows();
          st.rewrite = { on: box.querySelector('[data-o="enable"]').checked, sets: setsTe.rows().map((s, i) => Object.assign(s, { name: s.name || `Set ${i + 1}`, rules: (s.rules || []).filter((r) => r.type) })) };
          emit({ type: 'tool', tool: 'rewrite', on: st.rewrite.on });
        },
      });
    }
    function dlgThrottle() {
      const t = st.throttle;
      const f = (k, label, v) => `<label class="ch-field">${label}<input type="number" data-o="${k}" value="${v}" min="0"></label>`;
      openDialog({
        title: 'Throttle Settings',
        body: `<label class="ch-chk"><input type="checkbox" data-o="on" ${t.on ? 'checked' : ''}> Enable Throttling</label>
          <label class="ch-field">Throttle preset <select data-o="preset">${Object.keys(THROTTLE).concat('Custom').map((p) => `<option ${p === t.preset ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
          <div class="ch-grid2">${f('down', 'Bandwidth download (kbps)', t.down)}${f('up', 'Bandwidth upload (kbps)', t.up)}${f('util', 'Utilisation (%)', t.util)}${f('rtt', 'Round-trip latency (ms)', t.rtt)}</div>
          <p class="ch-dlg-note">Throttling замедляет весь трафик через Charles: так проверяют спиннеры, таймауты и двойные нажатия на медленной сети.</p>`,
        open: (box) => {
          const ps = box.querySelector('[data-o="preset"]');
          ps.addEventListener('change', () => {
            const p = THROTTLE[ps.value];
            if (p) ['down', 'up', 'util', 'rtt'].forEach((k) => { box.querySelector(`[data-o="${k}"]`).value = p[k]; });
          });
          ['down', 'up', 'util', 'rtt'].forEach((k) => box.querySelector(`[data-o="${k}"]`).addEventListener('input', () => { ps.value = 'Custom'; }));
        },
        onOk: (box) => {
          const g = (k) => box.querySelector(`[data-o="${k}"]`);
          const num = (k) => Math.max(0, Number(g(k).value) || 0);
          st.throttle = { on: g('on').checked, preset: g('preset').value, down: num('down') || 1, up: num('up') || 1, util: num('util') || 100, rtt: num('rtt') };
          emit({ type: 'tool', tool: 'throttle', on: st.throttle.on, preset: st.throttle.preset, rtt: st.throttle.rtt });
        },
      });
    }
    function dlgRepeatAdv(e) {
      openDialog({
        title: 'Repeat Advanced', ok: 'OK',
        body: `<p class="ch-dlg-note">${esc(e.method)} ${esc(urlOf(e))}</p>
          <div class="ch-grid2"><label class="ch-field">Iterations<input type="number" data-o="n" value="5" min="1" max="50"></label>
          <label class="ch-field">Concurrency<input type="number" data-o="c" value="1" min="1" max="10"></label>
          <label class="ch-field">Repeat delay (ms)<input type="number" data-o="d" value="0" min="0" max="2000"></label></div>`,
        onOk: (box) => {
          const n = Math.min(50, Math.max(1, Math.round(Number(box.querySelector('[data-o="n"]').value) || 1)));
          const c = Math.max(1, Number(box.querySelector('[data-o="c"]').value) || 1);
          const d = Math.max(0, Number(box.querySelector('[data-o="d"]').value) || 0);
          emit({ type: 'repeat', adv: true, n, concurrency: c, method: e.req.method, path: e.path, host: e.host });
          for (let i = 0; i < n; i++) setTimeout(() => { if (alive()) send(cloneReq(e.req), { source: 'repeat' }); }, d * Math.floor(i / c));
        },
      });
    }
    function info(title, html) { openDialog({ title, body: html, cancel: false }); }

    function curl(e) {
      const r = e.req;
      const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
      return ['curl', ...r.headers.map(([k, v]) => `-H ${q(k + ': ' + v)}`), r.method !== 'GET' ? `-X ${r.method}` : '', r.body ? `--data-binary ${q(r.body)}` : '', '--compressed', q(fullUrl(r))].filter(Boolean).join(' ');
    }
    function copy(text, what, e) {
      try { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {}); } catch (er) { /* буфер недоступен — не страшно */ }
      st.clipboard = text;
      toast(`Скопировано: ${text.length > 90 ? text.slice(0, 90) + '…' : text}`);
      emit({ type: 'copy', what, host: e.host, path: e.path, method: e.method });
    }

    // ---------- команды ----------
    function run(cmd) {
      hideDropdown();
      const e = cmd.startsWith('cx-') ? ctxEntry : cur();
      if (cmd.startsWith('dlg-') || cmd.startsWith('help-')) emit({ type: 'menu', cmd });
      switch (cmd) {
        case 'clear': entries = []; selected = null; lastPaneKey = ''; renderList(); renderDetail(); emit({ type: 'clear' }); break;
        case 'record': st.recording = !st.recording; renderStatus(); emit({ type: 'record', on: st.recording }); break;
        case 'throttle': st.throttle.on = !st.throttle.on; renderStatus(); toast(st.throttle.on ? `Throttling включён: ${st.throttle.preset}` : 'Throttling выключен'); emit({ type: 'tool', tool: 'throttle', on: st.throttle.on, preset: st.throttle.preset }); break;
        case 'breakpoints': st.bpOn = !st.bpOn; renderStatus(); toast(st.bpOn ? 'Breakpoints включены' : 'Breakpoints выключены'); emit({ type: 'tool', tool: 'breakpoints', on: st.bpOn }); break;
        case 'view-structure': case 'view-sequence': view = cmd.slice(5); renderList(); emit({ type: 'view', view }); break;
        case 'compose': if (!e || e.tunnel) { toast(e ? 'Зашифрованный туннель нельзя редактировать: включи SSL Proxying.' : 'Выбери запрос в списке.'); break; } openCompose(e); break;
        case 'compose-new': openCompose(null); break;
        case 'compose-close': composeDraft = null; renderEditor(); break;
        case 'compose-exec': composeExec(); break;
        case 'repeat': case 'cx-repeat':
          if (!e || e.tunnel || e.pending) { toast(e ? 'Этот запрос нельзя повторить.' : 'Выбери запрос в списке.'); break; }
          emit({ type: 'repeat', adv: false, n: 1, method: e.req.method, path: e.path, host: e.host });
          send(cloneReq(e.req), { source: 'repeat' });
          break;
        case 'repeat-adv': case 'cx-repeat-adv': if (e && !e.tunnel) dlgRepeatAdv(e); break;
        case 'bp-exec': bpResolve('exec'); break;
        case 'bp-abort': bpResolve('abort'); break;
        case 'bp-cancel': bpResolve('cancel'); break;
        case 'dlg-throttle': dlgThrottle(); break;
        case 'dlg-bp': dlgBp(); break;
        case 'dlg-ssl': dlgSsl(); break;
        case 'dlg-access': dlgAccess(); break;
        case 'dlg-nocache': dlgNoCache(); break;
        case 'dlg-block': dlgBlock(); break;
        case 'dlg-mapremote': dlgMapRemote(); break;
        case 'dlg-maplocal': dlgMapLocal(); break;
        case 'dlg-rewrite': dlgRewrite(); break;
        case 'dlg-proxy': info('Proxy Settings', `<table class="ch-kv"><tr><td>HTTP Proxy Port</td><td><b>${CH_PORT}</b></td></tr><tr><td>Support HTTP/2</td><td>✓</td></tr><tr><td>Enable transparent HTTP proxying</td><td>—</td></tr><tr><td>SOCKS proxy</td><td>выключен</td></tr></table><p class="ch-dlg-note">Это порт, который нужно указать в настройках прокси на телефоне.</p>`); break;
        case 'help-ip': info('Local IP Address', `<p>Your local IP address is:</p><table class="ch-kv"><tr><td>en0 (Wi‑Fi)</td><td><b>${CH_IP}</b></td></tr><tr><td>utun3 (VPN)</td><td>10.8.0.2</td></tr><tr><td>lo0</td><td>127.0.0.1</td></tr></table><p class="ch-dlg-note">Телефон должен быть в той же Wi‑Fi сети, что и ноутбук, — нужен адрес интерфейса Wi‑Fi.</p>`); break;
        case 'help-ssl': info('Install Charles Root Certificate', `<p>Configure your device to use Charles as its HTTP proxy on <b>${CH_IP}:${CH_PORT}</b>, then browse to <b>chls.pro/ssl</b> to download and install the certificate.</p><p class="ch-dlg-note">Android: Настройки → Безопасность → Установить сертификат → Сертификат ЦС. Приложение должно доверять пользовательским сертификатам (network_security_config в debug-сборке).</p>`); break;
        case 'help-about': info('About Charles', '<p>Charles 4.6.7 — Web Debugging Proxy.</p>'); break;
        case 'copy-url': case 'cx-copy-url': if (e) copy(urlOf(e), 'url', e); break;
        case 'copy-curl': case 'cx-copy-curl': if (e && !e.tunnel) copy(curl(e), 'curl', e); break;
        case 'cx-focus':
          if (st.focus.has(e.host)) st.focus.delete(e.host); else st.focus.add(e.host);
          renderList();
          emit({ type: 'focus', host: e.host, on: st.focus.has(e.host) });
          break;
        case 'cx-ssl-on':
          if (!st.sslLocs.some((l) => l.host === e.host)) st.sslLocs.push({ on: true, host: e.host, port: '443' });
          st.sslLocs.forEach((l) => { if (l.host === e.host) l.on = true; });
          st.sslOn = true;
          toast(`SSL Proxying включён для ${e.host}:443. Повтори действие в приложении.`);
          emit({ type: 'ssl', host: e.host, on: true });
          emit({ type: 'tool', tool: 'ssl', on: true });
          renderDetail();
          break;
        case 'cx-ssl-off':
          if (st.sslLocs.some((l) => l.host === e.host)) {
            st.sslLocs = st.sslLocs.filter((l) => l.host !== e.host);
            toast(`SSL Proxying выключен для ${e.host}`);
            emit({ type: 'ssl', host: e.host, on: false });
          } else toast('Хост попадает под маску — измени список в Proxy › SSL Proxying Settings.');
          renderDetail();
          break;
        case 'cx-bp': {
          const i = st.bps.findIndex((b) => b.host === e.host && b.path === e.path);
          if (i >= 0) st.bps.splice(i, 1); else { st.bps.push({ on: true, host: e.host, path: e.path, req: true, res: true }); st.bpOn = true; }
          toast(i >= 0 ? `Breakpoint снят: ${e.path}` : `Breakpoint: ${e.host}${e.path} (Request + Response)`);
          renderStatus();
          emit({ type: 'breakpoint', key: e.host + e.path, on: i < 0 });
          break;
        }
        case 'cx-nocache': {
          const has = st.noCache.on && st.noCache.locs.some((l) => l.host === e.host);
          if (has) st.noCache.locs = st.noCache.locs.filter((l) => l.host !== e.host);
          else { st.noCache.locs.push({ on: true, host: e.host, path: '*' }); st.noCache.only = true; }
          st.noCache.on = st.noCache.locs.some((l) => l.on);
          toast(has ? `No Caching снят для ${e.host}` : `No Caching для ${e.host}`);
          renderStatus();
          emit({ type: 'tool', tool: 'nocache', on: st.noCache.on });
          break;
        }
        case 'cx-block': {
          const path = e.tunnel ? '*' : e.path;
          const i = st.block.locs.findIndex((l) => l.host === e.host && l.path === path);
          if (i >= 0 && st.block.on) st.block.locs.splice(i, 1); else if (i < 0) st.block.locs.push({ on: true, host: e.host, path });
          st.block.on = st.block.locs.some((l) => l.on);
          toast(st.block.locs.some((l) => l.host === e.host && l.path === path) ? `Block List: ${e.host}${path === '*' ? '' : path}` : 'Убрано из Block List');
          renderStatus();
          emit({ type: 'tool', tool: 'block', on: st.block.on });
          break;
        }
        case 'cx-mapremote': dlgMapRemote({ on: true, fromHost: e.host, fromPath: e.path, toHost: '', toPath: '' }); break;
        case 'cx-maplocal': dlgMapLocal({ on: true, host: e.host, path: e.path, file: '' }); break;
        case 'cx-compose': openCompose(e); break;
        default: break;
      }
    }

    // ---------- события окна Charles ----------
    chEl.addEventListener('click', (ev) => {
      const m = ev.target.closest('[data-menu]');
      if (m) {
        const dd = $('.ch-dropdown');
        if (!dd.hidden && openMenu === m.dataset.menu) { hideDropdown(); return; }
        const p = relPos(m);
        showDropdown(MENUS[m.dataset.menu](), p.x, p.y);
        openMenu = m.dataset.menu;
        return;
      }
      const c = ev.target.closest('[data-cmd]');
      if (c && !c.disabled) {
        if (c.dataset.cmd === 'ctx-open') { const e = cur(); if (e) { const p = relPos(c); openCtx(e, p.x - 120, p.y); } return; }
        run(c.dataset.cmd);
        return;
      }
      if (!ev.target.closest('.ch-dropdown')) hideDropdown();
      const tr = ev.target.closest('.ch-seqt tr[data-id]');
      if (tr) { select(+tr.dataset.id); return; }
      if (ev.target.closest('[data-other]')) { otherOpen = !otherOpen; renderList(); return; }
      const nd = ev.target.closest('.ch-node[data-id]');
      if (nd) {
        if (nd.dataset.host) { const k = nd.dataset.host; if (expanded.has(k)) expanded.delete(k); else expanded.add(k); }
        select(+nd.dataset.id);
        return;
      }
      const t = ev.target.closest('.ch-tabs [data-t]');
      if (t) {
        detailTab = t.dataset.t;
        renderDetail();
        const e = cur();
        if (e) emit(Object.assign({ type: 'tab', tab: detailTab }, entryInfo(e)));
        return;
      }
      const pn = ev.target.closest('[data-pane]');
      if (pn) {
        const [side, pane] = pn.dataset.pane.split(':');
        if (side === 'req') reqPane = pane; else resPane = pane;
        renderDetail();
      }
    });
    chEl.addEventListener('contextmenu', (ev) => {
      const tr = ev.target.closest('.ch-seqt tr[data-id], .ch-node[data-id]');
      if (!tr) return;
      ev.preventDefault();
      const id = +tr.dataset.id;
      if (selected !== id) select(id);
      const a = chEl.getBoundingClientRect();
      openCtx(cur(), ev.clientX - a.left, ev.clientY - a.top);
    });
    $('.ch-filter').addEventListener('input', (ev) => {
      filter = ev.target.value.trim();
      renderList();
      const rows = visible();
      emit({ type: 'filter', text: filter, focused: focusedOnly, count: rows.length, paths: rows.map((e) => (e.tunnel ? '' : e.path)), hosts: rows.map((e) => e.host) });
    });
    $('.ch-focused').addEventListener('change', (ev) => { focusedOnly = ev.target.checked; renderList(); emit({ type: 'focused-only', on: focusedOnly }); });

    // ================= ТЕЛЕФОН =================
    const phone = { screen: S.screen === 'launcher' ? 'launcher' : 'app', settings: 'main', certKind: 'ca', page: null, toast: '' };
    const form = { proxyMode: st.phone.proxyMode, proxyHost: st.phone.proxyHost, proxyPort: st.phone.proxyPort, email: USER.email, password: USER.password, url: '', promo: '' };
    const app = {
      screen: S.loggedIn ? 'catalog' : 'login', token: S.loggedIn ? TOKEN : null,
      items: [], itemsState: 'ok', itemsErr: '', img: {},
      product: null, productState: 'loading', productErr: '',
      cart: null, cartState: 'loading', cartErr: '', promo: null, promoMsg: '',
      checkoutId: 0, sending: false, checkoutErr: '', lastOrder: null,
      profile: null, profileState: 'loading', profileErr: '',
      orders: [], ordersState: 'loading', ordersErr: '', ordersFrom: 'profile',
      loginBusy: false, loginMsg: '', etag: null, cache: null,
      cartCount: S.cart.reduce((s, [, q]) => s + q, 0), retry: null, prev: 'catalog',
    };
    // Каталог уже был загружен до начала сессии Charles.
    if (S.etagCache) {
      app.items = PRODUCTS.map((p) => ({ id: p.id, name: p.name, price: OLD_PRICES[p.id], image: `https://${CDN}/img/${p.slug}.png` }));
      app.etag = '"v41"';
      app.cache = app.items;
    } else app.items = PRODUCTS.map((p) => ({ id: p.id, name: bugs.langEn ? p.name : p.name, price: p.price, image: `https://${CDN}/img/${p.slug}.png` }));
    app.items.forEach((i) => { app.img[i.id] = 'ok'; });

    const appEv = (ev, extra) => emit(Object.assign({ type: 'app', ev, screen: app.screen }, extra || {}));
    let phoneToastTimer = 0;
    function phoneToast(msg) {
      phone.toast = msg;
      renderPhone();
      clearTimeout(phoneToastTimer);
      phoneToastTimer = setTimeout(() => { if (alive()) { phone.toast = ''; renderPhone(); } }, 2200);
    }

    function appReq(method, path, o) {
      o = o || {};
      const headers = [['User-Agent', UA], ['Accept', 'application/json'], ['Accept-Language', 'ru-RU,ru;q=0.9'], ['X-App-Version', '3.4.1']];
      if (o.auth !== false && app.token) headers.push(['Authorization', 'Bearer ' + app.token]);
      if (o.body !== undefined) headers.push(['Content-Type', 'application/json; charset=utf-8']);
      (o.headers || []).forEach((h) => headers.push(h));
      return { scheme: o.scheme || 'https', host: o.host || API, method, path, query: o.query || '', headers, body: o.body === undefined ? '' : JSON.stringify(o.body) };
    }
    function norm(r) {
      if (!r || r.error) return { ok: false, status: 0, error: (r && r.error) || 'network', headers: [], body: '' };
      return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: r.headers || [], body: r.body || '', json: parseJson(r.body), empty: !r.body };
    }
    async function call(method, path, o) {
      const r = norm(await send(appReq(method, path, o), { source: 'app', timeout: APP_TIMEOUT }));
      if (r.error) appEv(r.error === 'timeout' ? 'timeout' : 'neterror', { error: r.error, path, throttled: st.throttle.on });
      return r;
    }
    function errMsg(r) {
      if (r.error === 'timeout') return 'Превышено время ожидания. Проверьте соединение.';
      if (r.error === 'no-connection') return 'Нет подключения к интернету.';
      if (r.error) return 'Нет соединения с сервером.';
      if (r.status >= 500) return `Сервер временно недоступен (${r.status}). Попробуйте позже.`;
      if (r.status === 404) return 'Не найдено (404).';
      if (r.ok) return 'Не удалось обработать ответ сервера.';
      return `Ошибка запроса (${r.status}).`;
    }
    const track = (event) => send({ scheme: 'https', host: ANL, method: 'POST', path: '/v1/events', query: '', headers: [['User-Agent', UA], ['Content-Type', 'application/json']], body: JSON.stringify({ event, ts: 1791800000 + Math.round((Date.now() - t0) / 1000), device_id: 'a7f3c2', app_version: '3.4.1' }) }, { source: 'app' }).then(norm);
    let noiseI = 0;
    function noise() {
      if (!S.noise) return;
      for (let k = 0; k < 2; k++) {
        const n = NOISE[noiseI++ % NOISE.length];
        send({ scheme: 'https', host: n.host, method: n.method, path: n.path, query: '', headers: [['User-Agent', 'okhttp/4.12.0']], body: n.method === 'POST' ? '{"batch":[]}' : '' }, { source: 'app' });
      }
    }
    function logout(reason) {
      app.token = null;
      app.screen = 'login';
      app.loginMsg = reason || '';
      appEv('logout', { reason: reason ? 401 : 'user' });
      renderPhone();
    }
    const SESSION_EXPIRED = 'Сессия истекла. Войдите снова.';

    async function loadCatalog() {
      app.screen = 'catalog';
      app.itemsState = 'loading';
      app.retry = loadCatalog;
      renderPhone();
      const query = qsBuild([['page', '1'], ['limit', '20'], ['lang', bugs.langEn ? 'en' : 'ru'], ['sort', 'popular']]);
      track('catalog_open');
      noise();
      const r = await call('GET', '/v2/catalog', { query, headers: app.etag ? [['If-None-Match', app.etag]] : [] });
      if (r.status === 401) { logout(SESSION_EXPIRED); return; }
      if (r.status === 304 && app.cache) { app.items = app.cache; app.itemsState = 'ok'; }
      else if (r.ok && r.json && Array.isArray(r.json.items)) {
        app.items = r.json.items;
        // Баг клиента (ур. 10): пустой список не обработан — спиннер крутится вечно.
        app.itemsState = app.items.length ? 'ok' : bugs.emptySpinner ? 'loading' : 'empty';
        if (S.etagCache) { app.cache = app.items; app.etag = hget(r.headers, 'ETag') || app.etag; }
        loadImages();
      } else { app.itemsState = 'error'; app.itemsErr = errMsg(r); }
      appEv('catalog', { state: app.itemsState, status: r.status, error: r.error || null, count: app.items.length });
      renderPhone();
    }
    function loadImages() {
      app.items.slice(0, 4).forEach((it) => {
        let u;
        try { u = new URL(it.image); } catch (er) { app.img[it.id] = 'fail'; return; }
        app.img[it.id] = 'loading';
        send({ scheme: u.protocol.replace(':', ''), host: u.hostname, method: 'GET', path: u.pathname, query: '', headers: [['User-Agent', UA], ['Accept', 'image/webp,image/*']], body: '' }, { source: 'app' })
          .then((res) => { app.img[it.id] = res && !res.error && res.status === 200 ? 'ok' : 'fail'; if (app.screen === 'catalog') renderPhone(); });
      });
      app.items.slice(4).forEach((it) => { app.img[it.id] = app.img[it.id] || 'ok'; });
    }
    async function loadProduct(idx) {
      // Баг клиента (ур. 7): берётся id соседнего товара.
      const target = bugs.offByOne ? app.items[idx + 1] : app.items[idx];
      const id = target ? target.id : 'undefined';
      app.screen = 'product';
      app.prev = 'catalog';
      app.productState = 'loading';
      app.retry = () => loadProduct(idx);
      renderPhone();
      appEv('open-product', { tapped: app.items[idx] && app.items[idx].id, requested: id });
      track('product_view');
      const r = await call('GET', `/v2/products/${id}`);
      if (r.status === 401) { logout(SESSION_EXPIRED); return; }
      if (r.ok && r.json && typeof r.json === 'object') { app.product = r.json; app.productState = 'ok'; }
      else { app.productState = 'error'; app.productErr = r.status === 404 ? 'Товар не найден.' : errMsg(r); }
      appEv('product', { state: app.productState, status: r.status, stock: app.product && app.productState === 'ok' ? app.product.stock : null });
      renderPhone();
    }
    async function addToCart() {
      const p = app.product;
      if (!p) return;
      const canBuy = Number(p.stock) > 0 || bugs.stockIgnored;
      if (!canBuy) return;
      appEv('add', { product: p.id, stock: p.stock });
      track('add_to_cart');
      const r = await call('POST', '/v2/cart/items', { body: { product_id: p.id, qty: 1 } });
      if (r.status === 401) { logout(SESSION_EXPIRED); return; }
      if (r.ok && r.json && Array.isArray(r.json.items)) { app.cartCount = r.json.items.reduce((s, i) => s + Number(i.qty || 0), 0); phoneToast('Добавлено в корзину'); }
      else phoneToast(`Не удалось добавить: ${r.status || r.error}`);
      appEv('added', { status: r.status });
    }
    async function loadCart() {
      app.screen = 'cart';
      app.cartState = 'loading';
      app.retry = loadCart;
      app.checkoutErr = '';
      renderPhone();
      const r = await call('GET', '/v2/cart');
      let silent = false;
      if (r.status === 401) {
        // Баг клиента (ур. 12): 401 проглатывается и выглядит как пустая корзина.
        if (!bugs.cart401Silent) { logout(SESSION_EXPIRED); return; }
        app.cart = { items: [], total: 0 }; app.cartState = 'ok'; silent = true;
      } else if (r.ok && r.json && Array.isArray(r.json.items)) {
        app.cart = r.json; app.cartState = 'ok';
        app.cartCount = r.json.items.reduce((s, i) => s + Number(i.qty || 0), 0);
      } else { app.cartState = 'error'; app.cartErr = errMsg(r); }
      appEv('cart', { status: r.status, silent401: silent, count: app.cart && app.cartState === 'ok' ? app.cart.items.length : 0 });
      renderPhone();
    }
    async function applyPromo() {
      const code = form.promo.trim();
      if (!code) return;
      const r = await call('POST', '/v2/promo', { body: { code } });
      if (r.status === 401) { logout(SESSION_EXPIRED); return; }
      if (r.ok && r.json && r.json.discount_pct) { app.promo = { code: r.json.code, pct: r.json.discount_pct }; app.promoMsg = ''; }
      else { app.promo = null; app.promoMsg = r.status === 404 ? 'Промокод не найден' : errMsg(r); }
      appEv('promo', { ok: !!app.promo, code });
      renderPhone();
    }
    const cartTotal = () => (app.cart ? Number(app.cart.total) || 0 : 0);
    const payTotal = () => (app.promo ? Math.round(cartTotal() * (100 - app.promo.pct) / 100) : cartTotal());
    function openCheckout() {
      if (!app.cart || !app.cart.items.length) return;
      app.screen = 'checkout';
      app.prev = 'cart';
      app.checkoutId += 1;
      app.sending = false;
      app.checkoutErr = '';
      renderPhone();
      appEv('checkout-open', { checkoutId: app.checkoutId });
    }
    async function pay() {
      // Баг клиента (ур. 13): без флага кнопка не блокируется на время запроса.
      if (app.sending && !bugs.doubleSubmit) return;
      const cid = app.checkoutId;
      app.sending = true;
      app.checkoutErr = '';
      renderPhone();
      appEv('order-submit', { checkoutId: cid, promo: !!app.promo });
      if (bugs.checkoutNeedsAnalytics) {
        // Баг клиента (ур. 17): заказ ждёт успешной отправки аналитики.
        const a = await track('checkout_start');
        if (!a.ok) {
          app.sending = false;
          app.checkoutErr = 'Не удалось оформить заказ. Попробуйте позже.';
          appEv('checkout-fail', { cause: 'analytics', checkoutId: cid });
          renderPhone();
          return;
        }
      } else track('checkout_start');
      const body = { items: app.cart.items.map((i) => ({ product_id: i.product_id, qty: i.qty, price: i.price })), total: bugs.promoNotSent ? cartTotal() : payTotal(), address: 'Башня магов, 7, кв. 3', payment: 'coins' };
      if (app.promo && !bugs.promoNotSent) body.promo = app.promo.code;
      const r = await call('POST', '/v2/orders', { body, headers: [['Idempotency-Key', `chk-${gen}-${cid}-8f2a`]] });
      app.sending = false;
      if (r.status === 401) { logout(SESSION_EXPIRED); return; }
      if (r.ok && r.json && r.json.order_id) {
        app.lastOrder = r.json;
        app.cart = { items: [], total: 0 };
        app.cartCount = 0;
        app.promo = null;
        if (app.checkoutId === cid) app.screen = 'success';
        appEv('order-ok', { order: r.json.order_id, total: r.json.total, checkoutId: cid });
      } else {
        app.checkoutErr = `Не удалось оформить заказ. ${errMsg(r)}`;
        appEv('checkout-fail', { cause: 'orders', status: r.status, checkoutId: cid });
      }
      renderPhone();
    }
    async function loadProfile() {
      app.screen = 'profile';
      app.profileState = 'loading';
      app.retry = loadProfile;
      renderPhone();
      appEv('profile-open');
      // Баг клиента (ур. 4): три одинаковых запроса на одно открытие экрана.
      const n = bugs.profileTriple ? 3 : 1;
      const rs = await Promise.all(Array.from({ length: n }, () => call('GET', '/v2/profile')));
      const r = rs[rs.length - 1];
      if (r.status === 401) { logout(SESSION_EXPIRED); return; }
      if (r.ok && r.json && typeof r.json === 'object') { app.profile = r.json; app.profileState = 'ok'; }
      else if (r.ok) {
        // Баг клиента (ур. 18): пустое тело роняет приложение.
        if (bugs.profileEmptyCrash) { crash('profile'); return; }
        app.profileState = 'error'; app.profileErr = errMsg(r);
      } else { app.profileState = 'error'; app.profileErr = errMsg(r); }
      appEv('profile', { state: app.profileState, status: r.status, balance: app.profile ? app.profile.balance : undefined });
      renderPhone();
    }
    async function loadOrders(from) {
      app.screen = 'orders';
      app.prev = from || 'profile';
      app.ordersState = 'loading';
      app.retry = () => loadOrders(from);
      renderPhone();
      const r = await call('GET', '/v2/orders');
      if (r.status === 401) { logout(SESSION_EXPIRED); return; }
      if (r.ok && r.json && Array.isArray(r.json.items)) { app.orders = r.json.items; app.ordersState = 'ok'; }
      else if (bugs.ordersErrorAsEmpty) { app.orders = []; app.ordersState = 'ok'; }
      else { app.ordersState = 'error'; app.ordersErr = errMsg(r); }
      appEv('orders', { state: app.ordersState, status: r.status, count: app.ordersState === 'ok' ? app.orders.length : 0 });
      renderPhone();
    }
    async function login() {
      if (app.loginBusy) return;
      app.loginBusy = true;
      app.loginMsg = '';
      renderPhone();
      // Баг клиента (ур. 19): логин уходит по HTTP.
      const r = await call('POST', '/v2/auth/login', { auth: false, scheme: bugs.loginHttp ? 'http' : 'https', body: { email: form.email.trim(), password: form.password } });
      app.loginBusy = false;
      if (r.ok && r.json && r.json.token) {
        app.token = r.json.token;
        appEv('login-ok');
        loadCatalog();
        return;
      }
      app.loginMsg = r.status === 401 ? 'Неверный email или пароль.' : `Не удалось войти. ${errMsg(r)}`;
      appEv('login-fail', { status: r.status });
      renderPhone();
    }
    function crash(where) {
      phone.screen = 'crash';
      appEv('crash', { where });
      renderPhone();
    }

    // ---------- отрисовка телефона ----------
    const fmtPrice = (p) => {
      if (p === null || p === undefined) return `${p} 🪙`;
      if (bugs.priceTrim) return `${String(p).slice(0, 2)} 🪙`; // баг клиента (ур. 1)
      return `${Number(p).toLocaleString('ru-RU')} 🪙`;
    };
    // Баг клиента (ур. 10): имя выводится как HTML (без экранирования b/i/u).
    const nameHtml = (n) => (bugs.htmlNames ? esc(n).replace(/&lt;(\/?)(b|i|u)&gt;/g, '<$1$2>') : esc(n));
    const iconOf = (id) => (PRODUCTS.find((p) => p.id === id) || { icon: '🧴' }).icon;
    const spinner = (t) => `<div class="ap-center"><div class="spinner"></div><p>${t || 'Загрузка…'}</p></div>`;
    const errorBox = (msg) => `<div class="ap-center ap-error"><p class="ap-err-icon">⚠️</p><p>${esc(msg)}</p><button type="button" class="ap-btn" data-act="retry">Повторить</button></div>`;

    function screenHtml() {
      const a = app;
      if (a.screen === 'login') {
        return `<div class="ap-login"><p class="ap-logo-big">🧪</p><h4>Лавка зелий</h4>
          <label>Email<input data-f="email" value="${esc(form.email)}" autocomplete="off" spellcheck="false"></label>
          <label>Пароль<input data-f="password" type="password" value="${esc(form.password)}"></label>
          ${a.loginMsg ? `<p class="ap-msg">${esc(a.loginMsg)}</p>` : ''}
          <button type="button" class="ap-btn" data-act="login" ${a.loginBusy ? 'disabled' : ''}>${a.loginBusy ? 'Входим…' : 'Войти'}</button>
          <p class="ap-note">Тестовый аккаунт: ${USER.email} / ${USER.password}</p></div>`;
      }
      if (a.screen === 'catalog') {
        if (a.itemsState === 'loading') return spinner();
        if (a.itemsState === 'error') return errorBox(a.itemsErr);
        if (a.itemsState === 'empty') return '<div class="ap-center"><p class="ap-err-icon">🫙</p><p>Каталог пуст. Загляните позже.</p></div>';
        return `<ul class="ap-list">${a.items.map((it, i) => `<li><button type="button" data-act="product" data-arg="${i}">
          <span class="ap-img${a.img[it.id] === 'fail' ? ' fail' : ''}">${a.img[it.id] === 'fail' ? '🖼️' : a.img[it.id] === 'loading' ? '·' : iconOf(it.id)}</span>
          <span class="ap-name">${nameHtml(it.name)}</span><b class="ap-price">${fmtPrice(it.price)}</b></button></li>`).join('')}</ul>`;
      }
      if (a.screen === 'product') {
        if (a.productState === 'loading') return spinner();
        if (a.productState === 'error') return errorBox(a.productErr);
        const p = a.product;
        const inStock = Number(p.stock) > 0;
        const can = inStock || bugs.stockIgnored;
        return `<div class="ap-product"><div class="ap-hero">${iconOf(p.id)}</div><h4>${nameHtml(p.name)}</h4>
          <p class="ap-price big">${fmtPrice(p.price)}</p><p class="ap-meta">★ ${esc(p.rating)} · ${inStock || bugs.stockIgnored ? `В наличии: ${esc(p.stock)} шт.` : '<b class="ap-out">Нет в наличии</b>'}</p>
          <p>${esc(p.description)}</p>
          <button type="button" class="ap-btn" data-act="add" ${can ? '' : 'disabled'}>В корзину</button></div>`;
      }
      if (a.screen === 'cart') {
        if (a.cartState === 'loading') return spinner();
        if (a.cartState === 'error') return errorBox(a.cartErr);
        if (!a.cart.items.length) return '<div class="ap-center"><p class="ap-err-icon">🛒</p><p>Корзина пуста.</p></div>';
        return `<ul class="ap-lines">${a.cart.items.map((i) => `<li><span>${esc(i.name)} × ${esc(i.qty)}</span><b>${fmtPrice(i.subtotal)}</b></li>`).join('')}</ul>
          <div class="ap-sum"><span>Итого</span><b>${fmtPrice(cartTotal())}</b></div>
          <div class="ap-promo"><input data-f="promo" value="${esc(form.promo)}" placeholder="Промокод" spellcheck="false"><button type="button" class="ap-btn sm" data-act="promo">Применить</button></div>
          ${a.promo ? `<p class="ap-ok">Промокод ${esc(a.promo.code)}: −${a.promo.pct}%</p><div class="ap-sum"><span>К оплате</span><b>${fmtPrice(payTotal())}</b></div>` : ''}
          ${a.promoMsg ? `<p class="ap-msg">${esc(a.promoMsg)}</p>` : ''}
          <button type="button" class="ap-btn" data-act="checkout">Оформить заказ</button>`;
      }
      if (a.screen === 'checkout') {
        const block = a.sending && !bugs.doubleSubmit;
        return `<div class="ap-co"><p class="ap-meta">Доставка</p><p>Башня магов, 7, кв. 3</p><p class="ap-meta">Оплата</p><p>Баланс монет</p>
          <ul class="ap-lines">${a.cart.items.map((i) => `<li><span>${esc(i.name)} × ${esc(i.qty)}</span><b>${fmtPrice(i.subtotal)}</b></li>`).join('')}</ul>
          ${a.promo ? `<p class="ap-ok">Скидка ${esc(a.promo.code)}: −${a.promo.pct}%</p>` : ''}
          ${a.checkoutErr ? `<p class="ap-msg">${esc(a.checkoutErr)}</p>` : ''}
          <button type="button" class="ap-btn" data-act="pay" ${block ? 'disabled' : ''}>${block ? '<span class="spinner sm"></span> Оплата…' : `Оплатить ${fmtPrice(payTotal())}`}</button></div>`;
      }
      if (a.screen === 'success') {
        const o = a.lastOrder || {};
        return `<div class="ap-center"><p class="ap-err-icon">✅</p><p>Заказ №${esc(o.order_id)} оформлен</p><p class="ap-meta">Списано: ${fmtPrice(o.total)}</p>
          <button type="button" class="ap-btn" data-act="tab" data-arg="catalog">В каталог</button><button type="button" class="ap-link" data-act="orders" data-arg="success">Мои заказы</button></div>`;
      }
      if (a.screen === 'profile') {
        if (a.profileState === 'loading') return spinner();
        if (a.profileState === 'error') return errorBox(a.profileErr);
        const p = a.profile;
        return `<div class="ap-profile"><div class="ap-avatar">🧙‍♀️</div><h4>${esc(p.name)}</h4><p class="ap-meta">${esc(p.email)}</p>
          <div class="ap-sum"><span>Баланс</span><b>${fmtPrice(p.balance)}</b></div><div class="ap-sum"><span>Статус</span><b>${esc(p.tier)}</b></div>
          <button type="button" class="ap-btn" data-act="orders" data-arg="profile">Мои заказы</button><button type="button" class="ap-link" data-act="logout">Выйти</button></div>`;
      }
      if (a.screen === 'orders') {
        if (a.ordersState === 'loading') return spinner();
        if (a.ordersState === 'error') return errorBox(a.ordersErr);
        if (!a.orders.length) return '<div class="ap-center"><p class="ap-err-icon">📦</p><p>Заказов пока нет.</p></div>';
        return `<ul class="ap-lines">${a.orders.map((o) => `<li><span>№${esc(o.order_id)} · ${esc(o.status)}</span><b>${fmtPrice(o.total)}</b></li>`).join('')}</ul>`;
      }
      return '';
    }
    function appHtml() {
      const a = app;
      const titles = { login: 'Вход', catalog: 'Лавка зелий', product: 'Товар', cart: 'Корзина', checkout: 'Оформление', success: 'Готово', profile: 'Профиль', orders: 'Мои заказы' };
      const back = ['product', 'checkout', 'orders'].includes(a.screen);
      const head = `<div class="ap-head">${back ? '<button type="button" class="ap-icon" data-act="app-back" aria-label="Назад">←</button>' : '<span class="ap-icon">🧪</span>'}<b>${titles[a.screen]}</b>${a.screen === 'catalog' ? '<button type="button" class="ap-icon" data-act="refresh" title="Обновить каталог" aria-label="Обновить каталог">↻</button>' : '<span class="ap-icon"></span>'}</div>`;
      const tab = (k, ic, l) => `<button type="button" data-act="tab" data-arg="${k}" class="${a.screen === k || (k === 'profile' && a.screen === 'orders') || (k === 'cart' && a.screen === 'checkout') ? 'on' : ''}"><span>${ic}${k === 'cart' && a.cartCount ? `<i>${a.cartCount}</i>` : ''}</span>${l}</button>`;
      const tabs = a.screen === 'login' ? '' : `<nav class="ap-tabs">${tab('catalog', '🧪', 'Каталог')}${tab('cart', '🛒', 'Корзина')}${tab('profile', '👤', 'Профиль')}</nav>`;
      return `<div class="ap">${head}<div class="ap-body">${screenHtml()}</div>${tabs}</div>`;
    }

    const SET_PARENT = { main: null, wifi: 'main', 'wifi-net': 'wifi', security: 'main', 'cert-type': 'security', 'cert-warn': 'cert-type', 'cert-pick': 'cert-type', about: 'main' };
    function settingsHtml() {
      const p = st.phone;
      const sc = phone.settings;
      const titles = { main: 'Настройки', wifi: 'Wi‑Fi', 'wifi-net': 'Guild-WiFi', security: 'Безопасность', 'cert-type': 'Установить сертификат', 'cert-warn': 'Сертификат ЦС', 'cert-pick': 'Загрузки', about: 'О телефоне' };
      const head = `<div class="ps-head"><button type="button" class="ps-back" data-act="back" aria-label="Назад">←</button><b>${titles[sc]}</b></div>`;
      const row = (act, arg, title, sub) => `<button type="button" class="ps-row" data-act="${act}" data-arg="${arg}"><span>${title}</span>${sub ? `<small>${sub}</small>` : ''}</button>`;
      let b = '';
      if (sc === 'main') b = row('set', 'wifi', '📶 Wi‑Fi', 'Guild-WiFi') + row('set', 'security', '🔒 Безопасность', 'Шифрование и учётные данные') + row('set', 'about', 'ℹ️ О телефоне', 'Pixel 7 · Android 14');
      else if (sc === 'wifi') b = '<p class="ps-sub">Wi‑Fi включён</p>' + row('set', 'wifi-net', 'Guild-WiFi', `Подключено${p.proxyMode === 'manual' ? ' · прокси' : ''}`) + row('wifi-other', 'Tavern-Guest', 'Tavern-Guest', 'Защищённая') + row('wifi-other', 'Dragon5G', 'Dragon5G', 'Защищённая');
      else if (sc === 'wifi-net') {
        const m = form.proxyMode;
        b = `<div class="ps-info"><p>Подключено</p><dl><dt>IP-адрес</dt><dd>${PHONE_IP}</dd><dt>Шлюз</dt><dd>192.168.1.1</dd></dl></div>
          <label class="ps-field">Прокси<select data-f="proxyMode"><option value="none" ${m === 'none' ? 'selected' : ''}>Нет</option><option value="manual" ${m === 'manual' ? 'selected' : ''}>Вручную</option><option value="pac" ${m === 'pac' ? 'selected' : ''}>Автонастройка прокси</option></select></label>
          ${m === 'manual' ? `<label class="ps-field">Имя хоста прокси<input data-f="proxyHost" value="${esc(form.proxyHost)}" placeholder="proxy.example.com" spellcheck="false"></label>
            <label class="ps-field">Порт прокси<input data-f="proxyPort" value="${esc(form.proxyPort)}" placeholder="8080" inputmode="numeric"></label>
            <label class="ps-field">Не использовать прокси для<input data-f="bypass" placeholder="example.com"></label>` : ''}
          ${m === 'pac' ? '<label class="ps-field">URL автонастройки<input placeholder="http://…/proxy.pac"></label>' : ''}
          <button type="button" class="ps-save" data-act="proxy-save">Сохранить</button>`;
      } else if (sc === 'security') {
        const certs = (p.certInstalled ? '<li>🛡️ Charles Proxy CA (11 Oct 2026, mira-macbook.local) <small>ЦС · доверенный</small></li>' : '') +
          (p.wrongCert ? '<li>📄 charles-proxy-ssl-proxying-certificate <small>VPN и приложения</small></li>' : '');
        b = row('set', 'cert-type', 'Установить сертификат', 'Из памяти устройства') + `<p class="ps-sub">Пользовательские сертификаты</p><ul class="ps-certs">${certs || '<li class="ps-empty">Нет установленных сертификатов</li>'}</ul>`;
      } else if (sc === 'cert-type') {
        b = row('cert-kind', 'ca', 'Сертификат ЦС', 'Для проверки HTTPS-трафика') + row('cert-kind', 'vpn', 'Сертификат пользователя VPN и приложений', '') + row('cert-kind', 'wifi', 'Сертификат Wi‑Fi', '');
      } else if (sc === 'cert-warn') {
        b = '<div class="ps-warn"><p>⚠️ <b>Ваши данные не будут защищены</b></p><p>Владелец сертификата ЦС сможет просматривать зашифрованный трафик: пароли, сообщения, данные карт. Устанавливайте только сертификаты, которым доверяете.</p></div>' +
          '<button type="button" class="ps-save" data-act="cert-go">Всё равно установить</button><button type="button" class="ps-row ps-center" data-act="back">Отмена</button>';
      } else if (sc === 'cert-pick') {
        b = `<p class="ps-sub">Загрузки</p>${p.certDownloaded ? row('cert-file', 'pem', '📄 charles-proxy-ssl-proxying-certificate.pem', '1,3 КБ · сегодня') : ''}<button type="button" class="ps-row" disabled><span>🖼️ IMG_2041.jpg</span><small>2,1 МБ</small></button>${p.certDownloaded ? '' : '<p class="ps-empty">Сертификата нет. Скачай его в браузере: chls.pro/ssl</p>'}`;
      } else if (sc === 'about') {
        b = `<div class="ps-info"><dl><dt>Модель</dt><dd>Pixel 7</dd><dt>Android</dt><dd>14</dd><dt>IP-адрес</dt><dd>${PHONE_IP}</dd><dt>MAC</dt><dd>3c:28:6d:a1:9e:04</dd></dl></div>`;
      }
      return `<div class="ps">${head}${b}</div>`;
    }
    function browserHtml() {
      return `<div class="pb"><div class="pb-bar"><input data-f="url" value="${esc(form.url)}" placeholder="Поиск или адрес" spellcheck="false" aria-label="Адрес"><button type="button" data-act="nav" aria-label="Перейти">→</button></div>
        <div class="pb-page">${phone.page || '<p class="ps-empty">Введите адрес сайта.</p>'}</div></div>`;
    }
    function renderPhone() {
      if (!alive()) return;
      const scr = $('.ph-body');
      const focusF = document.activeElement && scr.contains(document.activeElement) ? document.activeElement.dataset.f : null;
      let html;
      if (phone.screen === 'launcher') {
        html = `<div class="pl"><p class="pl-clock">10:24</p><p class="pl-date">воскресенье, 11 октября</p><div class="pl-grid">
          <button type="button" data-act="launch" data-arg="app"><span>🧪</span>Лавка зелий</button>
          <button type="button" data-act="launch" data-arg="settings"><span>⚙️</span>Настройки</button>
          <button type="button" data-act="launch" data-arg="browser"><span>🌐</span>Браузер</button></div></div>`;
      } else if (phone.screen === 'settings') html = settingsHtml();
      else if (phone.screen === 'browser') html = browserHtml();
      else if (phone.screen === 'crash') html = appHtml() + '<div class="ph-crash"><div><p><b>Приложение «Лавка зелий» остановлено</b></p><button type="button" data-act="crash-close">Закрыть приложение</button></div></div>';
      else html = appHtml();
      scr.innerHTML = html + (phone.toast ? `<div class="ph-toast">${esc(phone.toast)}</div>` : '');
      el.querySelector('.ph-icons').textContent = `${st.phone.proxyMode === 'manual' ? '⇄ ' : ''}📶 🔋`;
      if (focusF) { const f = scr.querySelector(`[data-f="${focusF}"]`); if (f) { f.focus(); if (f.setSelectionRange && f.type !== 'number') { const n = f.value.length; try { f.setSelectionRange(n, n); } catch (er) { /* не все поля */ } } } }
    }

    async function navigate() {
      let u = form.url.trim();
      if (!u) return;
      if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
      let url;
      try { url = new URL(u); } catch (er) { phone.page = '<p class="ps-empty">Некорректный адрес.</p>'; renderPhone(); return; }
      phone.page = spinner('Загрузка…');
      renderPhone();
      const r = await send({ scheme: url.protocol.replace(':', ''), host: url.hostname, method: 'GET', path: url.pathname, query: url.search.replace(/^\?/, ''), headers: [['User-Agent', 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/129.0 Mobile'], ['Accept', 'text/html,*/*']], body: '' }, { source: 'browser' });
      const codes = { 'no-connection': 'ERR_PROXY_CONNECTION_FAILED', refused: 'ERR_CONNECTION_REFUSED', dns: 'ERR_NAME_NOT_RESOLVED', ssl: 'ERR_CERT_AUTHORITY_INVALID', dropped: 'ERR_CONNECTION_CLOSED', aborted: 'ERR_CONNECTION_ABORTED' };
      if (!r || r.error) phone.page = `<div class="pb-err"><p>😵 Не удаётся открыть страницу</p><p class="ps-empty">${esc(url.hostname)}<br>${codes[r && r.error] || 'ERR_FAILED'}</p></div>`;
      else if (/attachment/.test(hget(r.headers, 'Content-Disposition') || '')) {
        st.phone.certDownloaded = true;
        phone.page = '<div class="pb-dl"><p>⬇️ Загрузка завершена</p><p><b>charles-proxy-ssl-proxying-certificate.pem</b></p><p class="ps-empty">Чтобы установить сертификат, откройте Настройки → Безопасность → Установить сертификат.</p></div>';
        emit({ type: 'cert', stage: 'downloaded' });
      } else phone.page = `<div class="pb-html">${esc((r.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())}</div>`;
      emit({ type: 'browse', host: url.hostname, error: r && r.error ? r.error : null });
      renderPhone();
    }

    function phoneBack() {
      if (phone.screen === 'settings') {
        const p = SET_PARENT[phone.settings];
        if (p) phone.settings = p; else phone.screen = 'launcher';
      } else if (phone.screen === 'browser' || phone.screen === 'crash') phone.screen = 'launcher';
      else if (phone.screen === 'app') {
        if (app.screen === 'product') { app.screen = 'catalog'; }
        else if (app.screen === 'checkout') { app.screen = 'cart'; }
        else if (app.screen === 'orders') { app.screen = app.prev === 'success' ? 'catalog' : 'profile'; }
        else if (app.screen === 'success') app.screen = 'catalog';
        else phone.screen = 'launcher';
      }
      renderPhone();
    }

    function act(name, arg) {
      switch (name) {
        case 'home': phone.screen = 'launcher'; renderPhone(); break;
        case 'back': phoneBack(); break;
        case 'recent': phoneToast('Недавних приложений нет'); break;
        case 'launch':
          if (arg === 'app') {
            phone.screen = 'app';
            if (!app.token) { app.screen = 'login'; renderPhone(); } else loadCatalog();
          } else if (arg === 'settings') { phone.screen = 'settings'; phone.settings = 'main'; renderPhone(); } else { phone.screen = 'browser'; renderPhone(); }
          emit({ type: 'phone', screen: arg });
          break;
        case 'set': phone.settings = arg; renderPhone(); emit({ type: 'phone', screen: 'settings:' + arg }); break;
        case 'wifi-other': phoneToast(`${arg}: нужен пароль — подключайся к Guild-WiFi`); break;
        case 'proxy-save': {
          const p = st.phone;
          p.proxyMode = form.proxyMode === 'manual' ? 'manual' : 'none';
          p.proxyHost = p.proxyMode === 'manual' ? form.proxyHost.trim() : '';
          p.proxyPort = p.proxyMode === 'manual' ? String(form.proxyPort).trim() : '';
          phone.settings = 'wifi';
          phoneToast(form.proxyMode === 'pac' ? 'PAC-файл не найден, прокси отключён' : 'Сохранено');
          emit({ type: 'proxy-saved', mode: p.proxyMode, host: p.proxyHost, port: p.proxyPort, ok: proxyOk(st) });
          // Android сразу проверяет доступ в интернет через новый прокси.
          send({ scheme: 'http', host: GSTATIC, method: 'GET', path: '/generate_204', query: '', headers: [['User-Agent', 'Dalvik/2.1.0 (Linux; U; Android 14; Pixel 7)']], body: '' }, { source: 'os' });
          break;
        }
        case 'cert-kind':
          phone.certKind = arg;
          phone.settings = arg === 'ca' ? 'cert-warn' : 'cert-pick';
          renderPhone();
          break;
        case 'cert-go': phone.settings = 'cert-pick'; renderPhone(); break;
        case 'cert-file':
          if (phone.certKind === 'ca') {
            st.phone.certInstalled = true;
            phoneToast('Сертификат ЦС установлен');
            emit({ type: 'cert', stage: 'installed' });
          } else {
            st.phone.wrongCert = true;
            phoneToast('Установлен как сертификат VPN/Wi‑Fi — для HTTPS он не используется');
            emit({ type: 'cert', stage: 'wrong-type' });
          }
          phone.settings = 'security';
          renderPhone();
          break;
        case 'nav': navigate(); break;
        case 'refresh': loadCatalog(); break;
        case 'retry': if (app.retry) app.retry(); break;
        case 'product': loadProduct(Number(arg)); break;
        case 'add': addToCart(); break;
        case 'tab':
          if (arg === 'catalog') loadCatalog(); else if (arg === 'cart') loadCart(); else loadProfile();
          break;
        case 'promo': applyPromo(); break;
        case 'checkout': openCheckout(); break;
        case 'pay': pay(); break;
        case 'orders': loadOrders(arg); break;
        case 'logout': logout(''); break;
        case 'login': login(); break;
        case 'app-back': phoneBack(); break;
        case 'crash-close':
          phone.screen = 'launcher';
          app.screen = app.token ? 'catalog' : 'login';
          renderPhone();
          break;
        default: break;
      }
    }
    const phoneEl = $('.phone');
    phoneEl.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b || b.disabled) return;
      act(b.dataset.act, b.dataset.arg);
    });
    phoneEl.addEventListener('input', (ev) => { const f = ev.target.dataset && ev.target.dataset.f; if (f) form[f] = ev.target.value; });
    phoneEl.addEventListener('change', (ev) => { if (ev.target.dataset && ev.target.dataset.f === 'proxyMode') { form.proxyMode = ev.target.value; renderPhone(); } });
    phoneEl.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || !ev.target.dataset) return;
      const f = ev.target.dataset.f;
      if (f === 'url') navigate(); else if (f === 'password' || f === 'email') login(); else if (f === 'promo') applyPromo();
    });
    document.addEventListener('click', (ev) => { if (alive() && !chEl.contains(ev.target)) hideDropdown(); });

    renderPhone();
    renderList();
    renderDetail();
    renderStatus();
    return {};
  }

  // ================= УРОВНИ =================
  const has = (c, type, f) => c.log.some((e) => e.type === type && (!f || f(e)));
  const lastOf = (c, type, f) => { for (let i = c.log.length - 1; i >= 0; i--) { const e = c.log[i]; if (e.type === type && (!f || f(e))) return e; } return null; };
  const idxOf = (c, type, f) => c.log.findIndex((e) => e.type === type && (!f || f(e)));
  const hasAfter = (c, i, type, f) => i >= 0 && c.log.slice(i + 1).some((e) => e.type === type && (!f || f(e)));
  const appRes = (path, f) => (e) => e.source === 'app' && e.path === path && (!f || f(e));
  const isAppEv = (name, f) => (e) => e.ev === name && (!f || f(e));
  const digits = (v) => String(v).replace(/\D/g, '');
  const SSL_ALL = ['*.potions.shop'];

  const LEVELS = [
    {
      id: 'ch-1',
      title: 'Чей это баг: приложения или сервера?',
      giver: { name: 'Паук-перехватчик', sprite: '🕸️' },
      gold: 80,
      setup: { bugs: { priceTrim: true } },
      outro: 'Сравни ответ сервера с экраном: если данные в ответе верные, а на экране нет, — баг в приложении.',
      steps: [
        { id: 'catch', text: 'Нажми <b>↻</b> (обновить каталог) в приложении на телефоне и выбери в Charles строку <code>api.potions.shop</code>.',
          check: (c) => has(c, 'select', (e) => e.host === 'api.potions.shop'),
          success: 'Запрос пойман, но видно только CONNECT: трафик зашифрован HTTPS.' },
        { id: 'ssl', text: 'Включи <b>SSL Proxying</b> для <code>api.potions.shop</code> (правый клик по строке или «Actions ▾» → Enable SSL Proxying) и снова обнови каталог.',
          check: (c) => has(c, 'response', appRes('/v2/catalog', (e) => e.ssl)),
          success: 'Теперь видны метод, путь, заголовки и тело: GET /v2/catalog.' },
        { id: 'price', text: 'Открой у запроса каталога вкладку <b>Contents</b>. Какую цену «Эликсира маны» присылает сервер?',
          answer: { kind: 'text', placeholder: 'Цена из ответа сервера', accept: (v) => digits(v) === '120', wrong: 'Не то число. Найди в теле ответа элемент с name «Эликсир маны» и его price.' },
          success: 'Сервер присылает 120, а приложение показывает 12: приложение обрезает цену. Баг клиента.' },
        { id: 'bp500', text: 'Проверь реакцию на сбой сервера: правый клик по запросу каталога → <b>Breakpoints</b>, обнови каталог. В Edit Request нажми Execute, в Edit Response поставь Status <code>500</code> и Execute.',
          check: (c) => has(c, 'response', appRes('/v2/catalog', (e) => e.viaBreakpoint && e.status >= 500)),
          success: 'Приложение показало экран ошибки с кнопкой «Повторить», а не упало. Это правильное поведение.' },
        { id: 'restore', text: 'Сними Breakpoint (ещё раз «Breakpoints» в меню строки или кнопка ⬣ на панели) и обнови каталог: должен прийти настоящий ответ.',
          check: (c) => { const last = lastOf(c, 'response', appRes('/v2/catalog')); return !bpActive(c.state) && !!last && last.status === 200 && !last.viaBreakpoint; },
          success: 'Всё вернулось как было. Привычка снимать Breakpoints экономит часы.' },
      ],
      hints: [
        'Charles видит только трафик, прошедший после нажатия ↻. Пока SSL Proxying выключен, HTTPS виден как CONNECT без содержимого.',
        'Выбери строку <code>api.potions.shop:443</code>, открой «Actions ▾» → Enable SSL Proxying. После ↻ появится <code>GET /v2/catalog</code>: у неё есть вкладка Contents и пункт Breakpoints в меню.',
        '↻ → строка api.potions.shop → Actions ▾ → Enable SSL Proxying → ↻ → строка /v2/catalog → Contents: price = <b>120</b> → Actions ▾ → Breakpoints → ↻ → Execute (запрос) → Status 500 → Execute → Actions ▾ → Breakpoints (снять) → ↻.',
      ],
    },
    {
      id: 'ch-2',
      title: 'Прокси на телефоне и Access Control',
      giver: { name: 'Привратник сети', sprite: '🚪' },
      gold: 90,
      setup: { proxy: false, cert: false, allowed: false, screen: 'launcher', intruder: true },
      outro: 'Телефон и ноутбук должны быть в одной Wi‑Fi сети, а прокси — это IP ноутбука в этой сети и порт Charles 8888.',
      steps: [
        { id: 'ip', text: 'Узнай адрес ноутбука с Charles: меню <b>Help → Local IP Address</b>.',
          check: (c) => has(c, 'menu', (e) => e.cmd === 'help-ip'), success: 'Нужен адрес интерфейса Wi‑Fi (en0), а не VPN.' },
        { id: 'proxy', text: 'На телефоне: <b>Настройки → Wi‑Fi → Guild-WiFi → Прокси: Вручную</b>, хост — IP ноутбука, порт <code>8888</code> → Сохранить.',
          check: (c) => proxyOk(c.state), success: 'Телефон отправляет трафик через Charles. Сразу после сохранения Android проверяет интернет через прокси.' },
        { id: 'allow', text: 'В Charles появилось окно <b>Access Control</b> с адресом телефона <code>192.168.1.23</code>. Разреши подключение.',
          check: (c) => c.state.acl.allowed.has(PHONE_IP), success: 'Телефон добавлен в Access Control List.' },
        { id: 'deny', text: 'Следом подключается чужое устройство <code>192.168.1.57</code>. Не пускай его в свой Charles.',
          check: (c) => c.state.acl.denied.has(INTRUDER_IP) && !c.state.acl.allowed.has(INTRUDER_IP), success: 'Чужой трафик в сессию не попадёт, а твой прокси никто не использует втихую.' },
        { id: 'traffic', text: 'Открой на телефоне приложение «Лавка зелий» и выбери в Charles строку <code>api.potions.shop</code>.',
          check: (c) => has(c, 'select', (e) => e.host === 'api.potions.shop' && e.source === 'app'), success: 'Трафик приложения идёт через Charles.' },
      ],
      hints: [
        'Charles слушает порт 8888 на ноутбуке. Телефону нужен IP ноутбука в той же Wi‑Fi сети.',
        'Help → Local IP Address: строка en0 (Wi‑Fi) — 192.168.1.10. В телефоне: Настройки → Wi‑Fi → Guild-WiFi → Прокси «Вручную». Окна Allow/Deny появляются в окне Charles.',
        'Help → Local IP Address → OK. Телефон: ⚙️ Настройки → Wi‑Fi → Guild-WiFi → Прокси: Вручную, хост <b>192.168.1.10</b>, порт <b>8888</b> → Сохранить. В Charles: Allow для 192.168.1.23, Deny для 192.168.1.57. Телефон: ○ → Лавка зелий → в Charles клик по строке api.potions.shop. Если случайно нажал Deny для телефона — Proxy → Access Control Settings → Add 192.168.1.23.',
      ],
    },
    {
      id: 'ch-3',
      title: 'Сертификат Charles и SSL Proxying',
      giver: { name: 'Хранитель печатей', sprite: '🔏' },
      gold: 100,
      setup: { cert: false },
      outro: 'На Android 7+ приложение доверяет пользовательскому сертификату только если это разрешено в network_security_config — обычно в debug-сборке.',
      steps: [
        { id: 'handshake', text: 'Включи SSL Proxying для <code>api.potions.shop</code> и обнови каталог (↻). Посмотри, что стало с приложением и строкой в Charles.',
          check: (c) => has(c, 'response', (e) => e.source === 'app' && e.host === 'api.potions.shop' && e.sslFail),
          success: 'SSL handshake failed: телефон не доверяет сертификату Charles, и приложение осталось без сети.' },
        { id: 'download', text: 'Скачай сертификат: на телефоне открой <b>Браузер</b> и перейди на <code>chls.pro/ssl</code>.',
          check: (c) => has(c, 'cert', (e) => e.stage === 'downloaded'), success: 'Файл .pem скачан. Эту страницу отдаёт сам Charles, поэтому она открывается только через прокси.' },
        { id: 'install', text: 'Установи его: <b>Настройки → Безопасность → Установить сертификат → Сертификат ЦС</b>.',
          check: (c) => c.state.phone.certInstalled, success: 'Сертификат Charles теперь в доверенных пользовательских.' },
        { id: 'wildcard', text: 'Включи расшифровку для всех поддоменов магазина: <b>Proxy → SSL Proxying Settings</b>, добавь Host <code>*.potions.shop</code>, порт 443.',
          check: (c) => c.state.sslOn && c.state.sslLocs.some((l) => l.on && l.host.trim() === '*.potions.shop'), success: 'Маска покрывает api, cdn, analytics и staging.' },
        { id: 'decrypted', text: 'Обнови каталог и убедись, что в Charles открыты запросы и к <code>api.potions.shop</code>, и к <code>cdn.potions.shop</code>.',
          check: (c) => { const i = idxOf(c, 'cert', (e) => e.stage === 'installed'); return hasAfter(c, i, 'response', (e) => e.source === 'app' && e.host === 'api.potions.shop' && e.ssl) && hasAfter(c, i, 'response', (e) => e.source === 'app' && e.host === 'cdn.potions.shop' && e.ssl); },
          success: 'Оба хоста расшифрованы: видны картинки и API.' },
      ],
      hints: [
        'Чтобы Charles расшифровал HTTPS, телефон должен доверять его корневому сертификату. Скачивают его по адресу chls.pro/ssl через прокси.',
        'Браузер на телефоне → chls.pro/ssl. Затем Настройки → Безопасность → Установить сертификат → именно «Сертификат ЦС» (не VPN и не Wi‑Fi). Маска добавляется в Proxy → SSL Proxying Settings → Add.',
        'Строка api.potions.shop → Actions ▾ → Enable SSL Proxying → ↻ (ошибка). ○ → 🌐 Браузер → chls.pro/ssl → →. ○ → ⚙️ → Безопасность → Установить сертификат → Сертификат ЦС → Всё равно установить → .pem. Proxy → SSL Proxying Settings → Add: Host <b>*.potions.shop</b>, Port 443 → OK. Приложение → ↻.',
      ],
    },
    {
      id: 'ch-4',
      title: 'Structure, Focus и фильтр',
      giver: { name: 'Сова-архивариус', sprite: '🦉' },
      gold: 105,
      setup: { ssl: SSL_ALL, noise: true, bugs: { profileTriple: true } },
      outro: 'Лишние одинаковые запросы — баг производительности: на слабой сети и под нагрузкой они дорого стоят.',
      steps: [
        { id: 'structure', text: 'Сделай пару действий в приложении и переключи список на вид <b>Structure</b>: трафик сгруппируется по хостам.',
          check: (c) => has(c, 'view', (e) => e.view === 'structure'), success: 'Structure — дерево хостов и путей, Sequence — запросы по времени.' },
        { id: 'focus', text: 'Шум от SDK мешает. Сделай <b>Focus</b> на <code>api.potions.shop</code> (меню строки): остальные хосты уйдут в Other Hosts.',
          check: (c) => c.state.focus.has('api.potions.shop'), success: 'В Sequence можно включить галочку Focused, чтобы видеть только свой хост.' },
        { id: 'filter', text: 'Вернись в <b>Sequence</b>, очисти сессию (🧹 Clear), <b>один раз</b> открой вкладку «Профиль» и введи в Filter <code>profile</code>.',
          check: (c) => has(c, 'filter', (e) => /profile/i.test(e.text) && e.count > 0 && e.paths.every((p) => p.includes('/v2/profile'))),
          success: 'Фильтр оставил только запросы профиля.' },
        { id: 'count', text: 'Сколько запросов <code>GET /v2/profile</code> приложение делает при одном открытии экрана?',
          answer: { kind: 'text', placeholder: 'Число', accept: (v) => digits(v) === '3', wrong: 'Очисти сессию, открой профиль ровно один раз и посчитай строки под фильтром.' },
          success: '3 одинаковых запроса вместо одного — баг клиента. Заводим с Sequence-скриншотом.' },
      ],
      hints: [
        'Structure и Sequence переключаются кнопками над списком. Focus есть в меню строки (правый клик или Actions ▾).',
        'Focus: выбери любую строку api.potions.shop → Actions ▾ → Focus. Поле Filter находится под списком в режиме Sequence и ищет по URL.',
        'Каталог ↻ → Structure → строка api.potions.shop → Actions ▾ → Focus → Sequence → 🧹 Clear → вкладка «Профиль» один раз → Filter: <b>profile</b> → в списке 3 строки → ответ <b>3</b>.',
      ],
    },
    {
      id: 'ch-5',
      title: 'Читаем запрос: Query и заголовки',
      giver: { name: 'Толмач гильдии', sprite: '📜' },
      gold: 115,
      setup: { ssl: SSL_ALL, bugs: { langEn: true } },
      outro: 'Если неверное значение уже в запросе — ищи баг в клиенте; сервер честно ответил на то, что у него спросили.',
      steps: [
        { id: 'select', text: 'Телефон на русском, но после обновления каталог на английском. Обнови каталог и выбери запрос <code>GET /v2/catalog</code>.',
          check: (c) => has(c, 'select', (e) => e.path === '/v2/catalog' && e.ssl), success: 'Запрос каталога выбран.' },
        { id: 'query', text: 'Открой <b>Contents → Request → Query</b>: параметры строки запроса.',
          check: (c) => has(c, 'pane', (e) => e.side === 'req' && e.pane === 'query' && e.path === '/v2/catalog'), success: 'page, limit, lang, sort — всё как в таблице.' },
        { id: 'headers', text: 'Переключись на <b>Request → Headers</b> и найди язык устройства.',
          check: (c) => has(c, 'pane', (e) => e.side === 'req' && e.pane === 'headers' && e.path === '/v2/catalog'), success: 'Accept-Language: ru-RU — устройство на русском.' },
        { id: 'param', text: 'Какой параметр запроса отправлен с неверным значением?',
          answer: { kind: 'text', placeholder: 'Имя параметра', accept: (v) => /lang/i.test(v), wrong: 'Сравни значения в Query с Accept-Language в заголовках.' },
          success: 'lang=en при Accept-Language: ru-RU.' },
        { id: 'whose', text: 'Чей это баг?',
          answer: { kind: 'choice', options: ['Сервера: он игнорирует Accept-Language', 'Клиента: приложение шлёт lang=en, хотя язык устройства ru-RU', 'Это не баг: каталог бывает только на английском'], accept: (v) => v === 1, wrong: 'Посмотри, что именно спросило приложение.' },
          success: 'Баг клиента: в баг-репорт — URL запроса с lang=en и заголовок Accept-Language.' },
      ],
      hints: [
        'Во вкладке Contents верхняя половина — запрос, нижняя — ответ. У каждой свои подвкладки.',
        'Выбери строку /v2/catalog → Contents → в блоке Request кнопки Headers, Query, Raw.',
        '↻ → строка GET /v2/catalog → Contents → Request: Query (lang = en) → Headers (Accept-Language: ru-RU) → ответ <b>lang</b> → «Клиента…».',
      ],
    },
    {
      id: 'ch-6',
      title: 'Данные для баг-репорта',
      giver: { name: 'Летописец багов', sprite: '🪶' },
      gold: 125,
      setup: { ssl: SSL_ALL, bugs: { product500: true } },
      outro: 'X-Request-Id + cURL + время запроса позволяют бэкендеру за минуту найти твою ошибку в логах.',
      steps: [
        { id: 'repro', text: 'Карточка «Драконья кровь» не открывается. Воспроизведи и выбери в Charles упавший запрос товара.',
          check: (c) => has(c, 'select', (e) => e.path === '/v2/products/4' && e.status === 500), success: '500 Internal Server Error на /v2/products/4 — баг сервера.' },
        { id: 'raw', text: 'Открой <b>Contents → Response → Raw</b>: ответ целиком, как его прислал сервер.',
          check: (c) => has(c, 'pane', (e) => e.side === 'res' && e.pane === 'raw' && e.path === '/v2/products/4'), success: 'В Raw видны статус, заголовки и тело с текстом исключения.' },
        { id: 'reqid', text: 'Впиши <code>X-Request-Id</code> этого ответа — по нему бэкенд найдёт запрос в логах.',
          answer: { kind: 'text', placeholder: 'X-Request-Id', accept: (v, c) => has(c, 'response', (e) => e.path === '/v2/products/4' && e.status === 500 && e.reqId && e.reqId === v.trim().toLowerCase()), wrong: 'Скопируй значение заголовка X-Request-Id из ответа на /v2/products/4 со статусом 500.' },
          success: 'Request-Id записан.' },
        { id: 'curl', text: 'Скопируй запрос для разработчика: меню строки → <b>Copy cURL Request</b>.',
          check: (c) => has(c, 'copy', (e) => e.what === 'curl' && e.path === '/v2/products/4'), success: 'cURL позволяет воспроизвести баг без приложения.' },
      ],
      hints: [
        'Открой товар «Драконья кровь» в каталоге: приложение покажет ошибку, а в Charles появится красная строка.',
        'Строка /v2/products/4 → Contents → Response → Raw или Headers: там X-Request-Id. Copy cURL Request — в меню Actions ▾.',
        'Каталог → «Драконья кровь» → строка GET /v2/products/4 (500) → Contents → Response: Raw → скопируй значение X-Request-Id в ответ → Actions ▾ → Copy cURL Request.',
      ],
    },
    {
      id: 'ch-7',
      title: 'Локализация: клиент или сервер',
      giver: { name: 'Судья гильдии', sprite: '⚖️' },
      gold: 135,
      setup: { ssl: SSL_ALL, cart: [[1, 2], [2, 1]], bugs: { offByOne: true, cartTotalWrong: true } },
      outro: 'Запрос уже неверный — баг клиента. Запрос верный, ответ неверный — баг сервера. Оба верные, экран нет — снова клиент.',
      steps: [
        { id: 'card', text: 'Нажми в каталоге на «Эликсир маны» — откроется чужая карточка. Выбери в Charles запрос товара.',
          check: (c) => has(c, 'app', isAppEv('open-product', (e) => e.tapped === 2)) && has(c, 'select', (e) => e.path === '/v2/products/3'), success: 'Приложение запросило /v2/products/3.' },
        { id: 'whose1', text: 'Чей баг с карточкой?',
          answer: { kind: 'choice', options: ['Сервера: вернул не тот товар', 'Клиента: запросил /v2/products/3 вместо /v2/products/2', 'Charles подменил запрос'], accept: (v) => v === 1, wrong: 'Посмотри на путь запроса: какой id запросило приложение?' },
          success: 'Неверный id уже в запросе — баг клиента (сдвиг индекса на 1).' },
        { id: 'cart', text: 'Открой «Корзину» и посмотри ответ <code>GET /v2/cart</code> во вкладке Contents (Text или JSON).',
          check: (c) => has(c, 'pane', (e) => e.side === 'res' && ['text', 'json', 'raw'].includes(e.pane) && e.path === '/v2/cart'), success: 'В ответе есть qty, price, subtotal и total.' },
        { id: 'whose2', text: 'Итог в корзине неверный. Чей это баг?',
          answer: { kind: 'choice', options: ['Клиента: неправильно сложил суммы', 'Сервера: total в ответе не равен сумме subtotal', 'Не баг: total считается без количества'], accept: (v) => v === 1, wrong: 'Сложи subtotal позиций и сравни с total в ответе.' },
          success: '90 + 120 = 210, а сервер прислал total 165 — приложение честно показывает то, что пришло. Баг сервера.' },
      ],
      hints: [
        'Сравни, что приложение спросило (Request), что сервер ответил (Response) и что на экране.',
        'После нажатия на товар в Charles появится GET /v2/products/{id}: посмотри на id в пути. В корзине сравни total с суммой subtotal.',
        'Каталог → «Эликсир маны» → строка /v2/products/3 → «Клиента…». Вкладка «Корзина» → строка /v2/cart → Contents → Response: JSON → «Сервера…».',
      ],
    },
    {
      id: 'ch-8',
      title: 'Breakpoint на запрос',
      giver: { name: 'Стражница порога', sprite: '🛑' },
      gold: 145,
      setup: { ssl: SSL_ALL, bugs: { qtyNoValidation: true } },
      outro: 'Валидация на клиенте не защищает API: сервер обязан проверять всё, что ему прислали.',
      steps: [
        { id: 'bpset', text: 'Поставь Breakpoint только на <b>запрос</b> <code>POST /v2/cart/items</code>: Proxy → Breakpoint Settings (Request ✓, Response ✗).',
          check: (c) => c.state.bpOn && c.state.bps.some((b) => b.on && glob(b.host, 'api.potions.shop') && glob(b.path, '/v2/cart/items') && b.req && !b.res),
          success: 'Charles остановит запрос до отправки на сервер.' },
        { id: 'edit', text: 'Добавь любой товар в корзину. В окне Edit Request замени <code>"qty": 1</code> на отрицательное число и нажми Execute.',
          check: (c) => has(c, 'response', appRes('/v2/cart/items', (e) => e.reqEdited && e.reqJson && Number(e.reqJson.qty) < 0)),
          success: 'Запрос с отрицательным количеством ушёл на сервер.' },
        { id: 'status', text: 'Что ответил сервер?',
          answer: { kind: 'choice', options: ['422 — сервер отклонил qty, всё верно', '201 — сервер принял отрицательное количество: баг валидации на сервере', '500 — сервер упал'], accept: (v) => v === 1, wrong: 'Посмотри статус и тело ответа на /v2/cart/items.' },
          success: 'Сервер принял qty < 0, и total корзины ушёл в минус. Серьёзный баг сервера.' },
        { id: 'off', text: 'Выключи Breakpoints (кнопка ⬣ или сними правило), чтобы не мешали дальше.',
          check: (c) => !bpActive(c.state), success: 'Breakpoints выключены.' },
      ],
      hints: [
        'Breakpoint на запрос позволяет поменять тело до того, как оно уйдёт на сервер, — в обход проверок в UI.',
        'Proxy → Breakpoint Settings → Add: Host api.potions.shop, Path /v2/cart/items, Request ✓, Response ✗, Enable Breakpoints ✓.',
        'Breakpoint Settings → Add → Path <b>/v2/cart/items</b>, сними Response → OK. Каталог → товар → «В корзину» → в Body "qty": <b>-3</b> → Execute → ответ 201 → «201…» → ⬣.',
      ],
    },
    {
      id: 'ch-9',
      title: 'Breakpoint на ответ',
      giver: { name: 'Мастер подмен', sprite: '🎭' },
      gold: 150,
      setup: { ssl: SSL_ALL, bugs: { stockIgnored: true } },
      outro: 'Подмена ответа — быстрый способ проверить редкие состояния (нет в наличии, 0, null), не трогая базу.',
      steps: [
        { id: 'bpset', text: 'Поставь Breakpoint на <b>ответ</b> карточки товара: путь <code>/v2/products/*</code> или конкретный товар, Response ✓.',
          check: (c) => c.state.bpOn && c.state.bps.some((b) => b.on && b.res && glob(b.host, 'api.potions.shop') && [1, 2, 3, 4, 5].some((i) => glob(b.path, `/v2/products/${i}`))),
          success: 'Charles остановит ответ до того, как его получит приложение.' },
        { id: 'stock0', text: 'Открой карточку товара и в Edit Response поменяй <code>"stock"</code> на <code>0</code> → Execute.',
          check: (c) => has(c, 'response', (e) => e.source === 'app' && /^\/v2\/products\/\d+$/.test(e.path) && e.resEdited && e.json && e.json.stock === 0),
          success: 'Приложение получило товар с нулевым остатком.' },
        { id: 'tap', text: 'Попробуй нажать «В корзину» на этой карточке.',
          check: (c) => has(c, 'app', isAppEv('add', (e) => Number(e.stock) === 0)), success: 'Кнопка сработала, хотя товара нет.' },
        { id: 'whose', text: 'Что здесь не так?',
          answer: { kind: 'choice', options: ['Баг сервера: он прислал stock 0', 'Баг клиента: при stock = 0 кнопка «В корзину» должна быть неактивной', 'Не баг: Breakpoint ломает приложение'], accept: (v) => v === 1, wrong: 'stock 0 — допустимое значение. Как должно реагировать приложение?' },
          success: 'Баг клиента. Заодно стоит проверить, что сервер не даёт купить отсутствующий товар.' },
        { id: 'off', text: 'Выключи Breakpoints.', check: (c) => !bpActive(c.state), success: 'Чисто.' },
      ],
      hints: [
        'Если на одно правило включены и Request, и Response, Charles остановится дважды: сначала Execute для запроса, потом правка ответа.',
        'Proxy → Breakpoint Settings → Add: Path <code>/v2/products/*</code>, Request ✗, Response ✓. Остаток — поле stock в Body.',
        'Breakpoint Settings → Add (Path <b>/v2/products/*</b>, Response ✓) → OK → каталог → любой товар → в Body "stock": <b>0</b> → Execute → «В корзину» → «Баг клиента…» → ⬣.',
      ],
    },
    {
      id: 'ch-10',
      title: 'Map Local: подмена ответа файлом',
      giver: { name: 'Картограф', sprite: '🗺️' },
      gold: 160,
      setup: { ssl: SSL_ALL, bugs: { emptySpinner: true, htmlNames: true } },
      outro: 'Держи набор моков (пусто, огромные числа, юникод, битый JSON) и прогоняй их на каждом списке.',
      steps: [
        { id: 'empty', text: 'Подмени каталог пустым: <b>Tools → Map Local</b> (или меню строки /v2/catalog → Map Local…), файл <code>catalog-empty.json</code>, затем обнови каталог.',
          check: (c) => has(c, 'response', appRes('/v2/catalog', (e) => e.mapLocal === 'catalog-empty.json')), success: 'Ответ пришёл из локального файла.' },
        { id: 'what', text: 'Как приложение отреагировало на пустой каталог?',
          answer: { kind: 'choice', options: ['Показало «Каталог пуст»', 'Бесконечный спиннер загрузки — пустой список не обработан', 'Экран ошибки с кнопкой «Повторить»'], accept: (v) => v === 1, wrong: 'Посмотри на экран телефона после обновления.' },
          success: 'Баг клиента: пользователь будет ждать вечно.' },
        { id: 'huge', text: 'Замени файл на <code>catalog-huge-price.json</code> и обнови каталог.',
          check: (c) => has(c, 'response', appRes('/v2/catalog', (e) => e.mapLocal === 'catalog-huge-price.json')), success: 'Огромная, нулевая и отрицательная цена — проверь, что вёрстка не поехала.' },
        { id: 'unicode', text: 'Теперь <code>catalog-unicode.json</code>: эмодзи, арабский, длинное имя и HTML-теги.',
          check: (c) => has(c, 'response', appRes('/v2/catalog', (e) => e.mapLocal === 'catalog-unicode.json')), success: 'Теги &lt;b&gt; отрисовались как жирный текст: приложение не экранирует данные — потенциальная инъекция.' },
        { id: 'off', text: 'Выключи Map Local и обнови каталог: должен вернуться настоящий ответ сервера.',
          check: (c) => { const l = lastOf(c, 'response', appRes('/v2/catalog')); return !mapLocalActive(c.state) && !!l && !l.mapLocal && l.status === 200; },
          success: 'Каталог снова с сервера.' },
      ],
      hints: [
        'Map Local отдаёт приложению содержимое локального файла вместо ответа сервера. Правило: Host + Path → файл.',
        'Tools → Map Local → Add: Host api.potions.shop, Path /v2/catalog, Local path — выбери файл. Смену файла делай там же. Enable Map Local ✓.',
        'Tools → Map Local → Add (Path <b>/v2/catalog</b>, файл catalog-empty.json) → OK → ↻ → «Бесконечный спиннер…» → Tools → Map Local: файл catalog-huge-price.json → ↻ → catalog-unicode.json → ↻ → снять Enable Map Local → ↻.',
      ],
    },
    {
      id: 'ch-11',
      title: 'Map Remote: проверка на staging',
      giver: { name: 'Проводник порталов', sprite: '🌀' },
      gold: 170,
      setup: { ssl: SSL_ALL, bugs: { balanceNull: true } },
      outro: 'Map Remote позволяет проверить фикс бэкенда на staging тем же релизным приложением, без пересборки.',
      steps: [
        { id: 'prod', text: 'Открой «Профиль»: баланс показывает null. Выбери запрос <code>/v2/profile</code> к prod-серверу.',
          check: (c) => has(c, 'select', (e) => e.path === '/v2/profile' && e.host === 'api.potions.shop' && !e.mapped && e.ssl), success: 'На prod "balance": null — баг сервера, фикс уже на staging.' },
        { id: 'map', text: 'Перенаправь API на staging: <b>Tools → Map Remote</b>, From <code>api.potions.shop</code> → To <code>staging-api.potions.shop</code>. Открой профиль снова.',
          check: (c) => has(c, 'response', appRes('/v2/profile', (e) => e.mapRemote === 'staging-api.potions.shop' && e.status === 200)), success: 'Запрос ушёл на staging, приложение этого не заметило.' },
        { id: 'balance', text: 'Какой баланс вернул staging?',
          answer: { kind: 'text', placeholder: 'Баланс', accept: (v) => digits(v) === '1250', wrong: 'Посмотри balance в ответе со staging (заголовок X-Env: staging).' },
          success: 'Фикс на staging работает: баланс 1250.' },
        { id: 'off', text: 'Выключи Map Remote и открой профиль ещё раз — снова prod.',
          check: (c) => { const l = lastOf(c, 'response', appRes('/v2/profile')); return !mapRemoteActive(c.state) && !!l && !l.mapRemote; }, success: 'Вернулись на prod.' },
      ],
      hints: [
        'Map Remote подменяет адрес сервера: приложение думает, что ходит на prod, а Charles отправляет запрос на другой стенд.',
        'Tools → Map Remote → Add: From host api.potions.shop, From path *, To host staging-api.potions.shop, To path пустой. Enable Map Remote ✓.',
        '«Профиль» → строка /v2/profile → Tools → Map Remote → Add (From host <b>api.potions.shop</b>, To host <b>staging-api.potions.shop</b>) → OK → «Профиль» → ответ <b>1250</b> → Tools → Map Remote → снять Enable → «Профиль».',
      ],
    },
    {
      id: 'ch-12',
      title: 'Rewrite: протухший токен',
      giver: { name: 'Алхимик правил', sprite: '⚗️' },
      gold: 180,
      setup: { ssl: SSL_ALL, cart: [[2, 1]], bugs: { cart401Silent: true } },
      outro: 'Rewrite — постоянное правило для всех подходящих запросов. Breakpoint — ручная правка одного запроса.',
      steps: [
        { id: 'rule', text: 'Сымитируй протухший токен для всего API: <b>Tools → Rewrite</b>, набор для <code>api.potions.shop</code> и правило — Response Status 200 → 401 или Modify/Remove Header <code>Authorization</code> в Request.',
          check: (c) => rewriteGives401(c.state), success: 'Правило включено: все запросы к API получат 401.' },
        { id: 'cart', text: 'Открой «Корзину» (в ней лежит товар).',
          check: (c) => has(c, 'app', isAppEv('cart', (e) => e.silent401)), success: 'Корзина «пуста», хотя сервер ответил 401.' },
        { id: 'whose', text: 'Как оценишь поведение корзины?',
          answer: { kind: 'choice', options: ['Корректно: корзина действительно пуста', 'Баг клиента: на 401 приложение молча показывает пустую корзину вместо входа', 'Баг сервера: он должен был вернуть 200'], accept: (v) => v === 1, wrong: 'Сервер сказал «не авторизован». Что должно сделать приложение?' },
          success: 'Баг клиента: пользователь думает, что потерял корзину.' },
        { id: 'profile', text: 'Теперь открой «Профиль»: на 401 приложение должно отправить на экран входа.',
          check: (c) => has(c, 'app', isAppEv('logout', (e) => e.reason === 401)), success: 'Здесь всё правильно: «Сессия истекла. Войдите снова».' },
        { id: 'off', text: 'Выключи Rewrite и войди в приложение заново.',
          check: (c) => !rewriteActive(c.state) && has(c, 'response', appRes('/v2/auth/login', (e) => e.status === 200 && !e.rewritten)) && !!lastOf(c, 'app', isAppEv('login-ok')),
          success: 'Сессия восстановлена.' },
      ],
      hints: [
        'Rewrite меняет запросы и ответы по правилам: заголовки, параметры, статус, тело.',
        'Tools → Rewrite → Sets: Add (Location host api.potions.shop, Path *) → Rules: Add → Type Response Status, Match value 200, Replace value 401. Enable Rewrite ✓.',
        'Tools → Rewrite → Add набор → Add правило: <b>Response Status</b>, Match value <b>200</b>, Replace value <b>401</b> → OK → «Корзина» → «Баг клиента…» → «Профиль» → Tools → Rewrite → снять Enable → OK → «Войти».',
      ],
    },
    {
      id: 'ch-13',
      title: 'Throttling: медленная сеть',
      giver: { name: 'Черепаха-предсказатель', sprite: '🐢' },
      gold: 185,
      setup: { ssl: SSL_ALL, cart: [[1, 1], [5, 3]], bugs: { doubleSubmit: true } },
      outro: 'На медленной сети проявляются двойные нажатия, гонки и таймауты — проверяй ключевые сценарии на 3G.',
      steps: [
        { id: 'preset', text: 'Включи медленную сеть: <b>Proxy → Throttle Settings</b>, Enable Throttling, пресет <code>3G</code>.',
          check: (c) => c.state.throttle.on && c.state.throttle.preset === '3G', success: '3G: ~1 Мбит/с и 400 мс задержки.' },
        { id: 'slow', text: 'Обнови каталог и посмотри на Duration в Charles и на спиннер в приложении.',
          check: (c) => has(c, 'response', appRes('/v2/catalog', (e) => e.throttled && e.throttlePreset === '3G')), success: 'Запрос стал заметно медленнее, спиннер есть.' },
        { id: 'double', text: 'Корзина → Оформить заказ → нажми <b>«Оплатить» два раза подряд</b>.',
          check: (c) => { const m = {}; c.log.forEach((e) => { if (e.type === 'app' && e.ev === 'order-submit') m[e.checkoutId] = (m[e.checkoutId] || 0) + 1; }); return Object.values(m).some((n) => n >= 2); },
          success: 'В Charles два POST /v2/orders.' },
        { id: 'answer', text: 'Что произошло?',
          answer: { kind: 'choice', options: ['Всё верно: каждый тап — новый заказ', 'Баг: кнопка не блокируется на время запроса — создано два заказа', 'Charles продублировал запрос'], accept: (v) => v === 1, wrong: 'Посмотри, сколько POST /v2/orders ушло и какие order_id вернулись.' },
          success: 'Баг клиента: кнопку надо блокировать. И сервер не защищён Idempotency-Key — это отдельный баг.' },
        { id: 'timeout', text: 'Проверь таймаут: в Throttle Settings поставь Round-trip latency <code>7000</code> мс и обнови каталог.',
          check: (c) => has(c, 'app', isAppEv('timeout', (e) => e.throttled)), success: 'Через 6 секунд приложение показало «Превышено время ожидания» и «Повторить».' },
        { id: 'off', text: 'Выключи Throttling (🐢).', check: (c) => !c.state.throttle.on, success: 'Сеть снова быстрая.' },
      ],
      hints: [
        'Throttling замедляет весь трафик через Charles: полоса, загрузка канала и задержка (RTT).',
        'Proxy → Throttle Settings: Enable Throttling ✓, Throttle preset 3G. Для таймаута увеличь Round-trip latency — пресет станет Custom.',
        'Throttle Settings: ✓, 3G → OK → ↻ → «Корзина» → «Оформить заказ» → два быстрых клика «Оплатить» → «Баг: кнопка…» → Throttle Settings: Round-trip latency <b>7000</b> → OK → «Каталог» ↻ → ждём → 🐢.',
      ],
    },
    {
      id: 'ch-14',
      title: 'Repeat: дубли и идемпотентность',
      giver: { name: 'Эхо подземелья', sprite: '🔁' },
      gold: 195,
      setup: { ssl: SSL_ALL, cart: [[2, 1]] },
      outro: 'Повтор POST — частая ситуация (ретраи, плохая сеть). С одинаковым Idempotency-Key сервер должен вернуть тот же заказ.',
      steps: [
        { id: 'order', text: 'Оформи заказ в приложении: Корзина → Оформить заказ → Оплатить.',
          check: (c) => has(c, 'response', appRes('/v2/orders', (e) => e.method === 'POST' && e.status === 201)), success: 'Заказ создан. В запросе есть заголовок Idempotency-Key.' },
        { id: 'repeat', text: 'Выбери <code>POST /v2/orders</code> и нажми <b>Repeat</b> (↻ на панели или меню строки).',
          check: (c) => has(c, 'response', (e) => e.source === 'repeat' && e.path === '/v2/orders' && e.method === 'POST' && e.status === 201), success: 'Тот же запрос отправлен ещё раз.' },
        { id: 'answer', text: 'Сравни ответы. Как сервер обработал повтор?',
          answer: { kind: 'choice', options: ['Вернул тот же заказ — идемпотентность работает', 'Создал новый заказ с другим order_id при том же Idempotency-Key — баг сервера', 'Repeat отправил запрос без тела'], accept: (v) => v === 1, wrong: 'Сравни order_id в двух ответах и Idempotency-Key в запросах.' },
          success: 'Баг сервера: ретрай списывает деньги повторно.' },
        { id: 'adv', text: 'Нагрузи: меню строки → <b>Repeat Advanced…</b>, Iterations ≥ 5.',
          check: (c) => has(c, 'repeat', (e) => e.adv && e.n >= 5 && e.path === '/v2/orders' && e.method === 'POST'), success: 'Пачка одинаковых заказов ушла на сервер.' },
        { id: 'orders', text: 'Открой «Профиль → Мои заказы» и убедись, что дубли видны пользователю.',
          check: (c) => has(c, 'app', isAppEv('orders', (e) => e.count >= 8)), success: 'Список заказов распух — баг подтверждён с точки зрения пользователя.' },
      ],
      hints: [
        'Repeat отправляет выбранный запрос ровно таким, каким он был, включая заголовки и тело.',
        'Repeat — кнопка ↻ на панели Charles или пункт в Actions ▾. Repeat Advanced… в том же меню: Iterations, Concurrency.',
        '«Корзина» → «Оформить заказ» → «Оплатить» → строка POST /v2/orders → ↻ Repeat → «Создал новый заказ…» → Actions ▾ → Repeat Advanced… → Iterations <b>5</b> → OK → «Профиль» → «Мои заказы».',
      ],
    },
    {
      id: 'ch-15',
      title: 'Compose: цена и чужие заказы',
      giver: { name: 'Ревизор казны', sprite: '💰' },
      gold: 205,
      setup: { ssl: SSL_ALL, cart: [[4, 1]] },
      outro: 'Сервер не должен доверять клиенту ни цену, ни номер чужого заказа: цену берут из своей базы, а владельца проверяют по токену.',
      steps: [
        { id: 'order', text: 'Оформи заказ в приложении: «Корзина» → «Оформить заказ» → «Оплатить».',
          check: (c) => has(c, 'response', appRes('/v2/orders', (e) => e.method === 'POST' && e.status === 201)),
          success: 'В теле POST /v2/orders приложение само передаёт price каждой позиции.' },
        { id: 'price', text: 'Выбери <code>POST /v2/orders</code> и нажми <b>Compose</b> (✎ на панели или меню строки). В Body поменяй <code>"price": 990</code> на <code>1</code> и нажми Execute.',
          check: (c) => has(c, 'response', (e) => e.source === 'compose' && e.method === 'POST' && e.path === '/v2/orders' && e.status === 201 &&
            e.reqJson && Array.isArray(e.reqJson.items) && e.reqJson.items.some((i) => { const p = PRODUCTS.find((x) => x.id === Number(i.product_id)); return p && Number(i.price) < p.price; })),
          success: 'Сервер ответил 201 и создал заказ на сумму из запроса.' },
        { id: 'whose', text: 'Сколько списал сервер и что это значит?',
          answer: { kind: 'choice', options: ['990 — сервер пересчитал цену по своему каталогу, всё верно', 'Сумму из подменённого запроса — сервер доверяет цене от клиента, это уязвимость сервера', 'Ничего — Compose не создаёт настоящих заказов'], accept: (v) => v === 1, wrong: 'Посмотри total в ответе на запрос из Compose.' },
          success: 'Критичный баг сервера: покупатель сам назначает цену.' },
        { id: 'idor', text: 'Проверь доступ к чужим заказам: снова Compose из запроса приложения (в нём есть токен), метод <code>GET</code>, URL <code>https://api.potions.shop/v2/orders/5009</code> → Execute. Свои заказы — 5011 и выше.',
          check: (c) => has(c, 'response', (e) => e.source === 'compose' && e.method === 'GET' && /^\/v2\/orders\/\d+$/.test(e.path) && e.status === 200 && e.json && e.json.user_id !== undefined && Number(e.json.user_id) !== 7),
          success: 'Сервер отдал чужой заказ с именем и адресом: IDOR — нет проверки владельца.' },
        { id: 'name', text: 'Чьё имя пришло в чужом заказе?',
          answer: { kind: 'text', placeholder: 'Имя покупателя', accept: (v) => /борин/i.test(v), wrong: 'Посмотри поле customer в ответе на GET /v2/orders/5009.' },
          success: 'Персональные данные другого покупателя — в баг-репорт с пометкой Security.' },
      ],
      hints: [
        'Compose открывает копию выбранного запроса в редакторе: можно поменять метод, URL, заголовки и тело и отправить вручную, без приложения.',
        'Строка POST /v2/orders → ✎ Compose → в Body поле price → Execute. Для чужого заказа в том же Compose выбери Method GET и замени путь в URL. Compose New… не подойдёт: в нём нет заголовка Authorization.',
        '«Корзина» → «Оформить заказ» → «Оплатить» → строка POST /v2/orders → ✎ Compose → Body: "price": <b>1</b> → Execute → «Сумму из подменённого запроса…» → строка POST /v2/orders → ✎ Compose → Method <b>GET</b>, URL <b>https://api.potions.shop/v2/orders/5009</b> → Execute → ответ <b>Борин Каменный</b>.',
      ],
    },
    {
      id: 'ch-16',
      title: 'Кэш: ETag, 304 и No Caching',
      giver: { name: 'Хранитель кладовой', sprite: '🗄️' },
      gold: 215,
      setup: { ssl: SSL_ALL, etagCache: true, bugs: { staleEtag: true } },
      outro: '304 Not Modified — это «бери из кэша». Если данные на сервере изменились, а ETag нет, пользователи будут видеть старые данные.',
      steps: [
        { id: 'r304', text: 'Цены в приложении устарели. Обнови каталог (↻) и выбери запрос <code>GET /v2/catalog</code>. Какой у него код ответа?',
          check: (c) => has(c, 'select', (e) => e.path === '/v2/catalog' && e.status === 304),
          success: '304 Not Modified: тела нет, приложение показало каталог из своего кэша.' },
        { id: 'inm', text: 'Открой у этого запроса <b>Contents → Request → Headers</b> и найди, чем приложение спросило «изменилось ли что-нибудь».',
          check: (c) => has(c, 'pane', (e) => e.side === 'req' && e.pane === 'headers' && e.path === '/v2/catalog' && e.status === 304),
          success: 'If-None-Match: "v41" — ETag закэшированной версии. Сервер ответил тем же ETag "v41" и 304.' },
        { id: 'nocache', text: 'Отключи кэширование: <b>Tools → No Caching</b> (или меню строки → No Caching) для <code>api.potions.shop</code> и обнови каталог.',
          check: (c) => has(c, 'response', appRes('/v2/catalog', (e) => e.noCaching && e.status === 200)),
          success: 'Charles убрал If-None-Match, сервер прислал полный ответ 200 — на экране новые цены.' },
        { id: 'whose', text: 'Сравни: ответ 200 с новыми ценами и ответ 304 с ETag "v41". Чей это баг?',
          answer: { kind: 'choice', options: ['Клиента: приложение вообще не должно слать If-None-Match', 'Сервера: цены изменились, а ETag остался прежним, поэтому сервер подтверждает устаревший кэш', 'Не баг: 304 означает, что данные не менялись'], accept: (v) => v === 1, wrong: 'Если данные изменились, ETag тоже обязан измениться. Сравни цены в 200 с экраном до обновления.' },
          success: 'Баг сервера: ETag надо пересчитывать при каждом изменении данных.' },
        { id: 'off', text: 'Выключи No Caching, чтобы проверять приложение с обычным кэшированием.',
          check: (c) => !c.state.noCache.on, success: 'No Caching выключен.' },
      ],
      hints: [
        'Приложение шлёт If-None-Match с ETag своей копии. Если ETag на сервере тот же — ответ 304 без тела. No Caching в Charles вырезает эти заголовки.',
        'Код ответа — первая колонка Code в списке. Заголовки запроса — Contents → Request → Headers. No Caching — Tools → No Caching… → Enable, Add: Host api.potions.shop.',
        '↻ → строка GET /v2/catalog (304) → Contents → Request: Headers → Actions ▾ → No Caching → ↻ → «Сервера…» → Tools → No Caching… → снять Enable No Caching → OK.',
      ],
    },
    {
      id: 'ch-17',
      title: 'Block List: недоступный хост',
      giver: { name: 'Страж ворот', sprite: '🧱' },
      gold: 225,
      setup: { ssl: SSL_ALL, cart: [[1, 1]], bugs: { checkoutNeedsAnalytics: true } },
      outro: 'Второстепенные сервисы (аналитика, реклама, крэш-репорты) не должны ломать основной сценарий, если они недоступны.',
      steps: [
        { id: 'block', text: 'Отрежь только аналитику: <b>Tools → Block List</b> (или меню строки → Block List), Host <code>analytics.potions.shop</code>. API магазина блокировать нельзя.',
          check: (c) => { const ls = c.state.block.on ? c.state.block.locs.filter((l) => l.on && l.host) : []; return ls.some((l) => glob(l.host, ANL)) && !ls.some((l) => glob(l.host, API)); },
          success: 'Запросы к аналитике не дойдут до сервера.' },
        { id: 'catalog', text: 'Обнови каталог: аналитика заблокирована, а каталог должен работать.',
          check: (c) => { const i = idxOf(c, 'tool', (e) => e.tool === 'block' && e.on); return hasAfter(c, i, 'response', (e) => e.host === ANL && e.blocked) && hasAfter(c, i, 'app', isAppEv('catalog', (e) => e.state === 'ok')); },
          success: 'Каталог загрузился, строка analytics в Charles помечена Blocked.' },
        { id: 'pay', text: 'Оформи заказ: «Корзина» → «Оформить заказ» → «Оплатить».',
          check: (c) => has(c, 'app', isAppEv('checkout-fail', (e) => e.cause === 'analytics')),
          success: 'Заказ не оформился, а POST /v2/orders так и не ушёл на сервер.' },
        { id: 'whose', text: 'В чём проблема?',
          answer: { kind: 'choice', options: ['Баг сервера заказов: он недоступен', 'Баг клиента: оформление заказа ждёт успешной отправки аналитики и падает без неё', 'Не баг: без аналитики заказ оформлять нельзя'], accept: (v) => v === 1, wrong: 'Посмотри в Charles: был ли вообще запрос POST /v2/orders?' },
          success: 'Баг клиента: у пользователей с блокировщиком рекламы магазин не принимает заказы.' },
        { id: 'api', text: 'Теперь сымитируй падение API: добавь в Block List <code>api.potions.shop</code> (Blocking action — Drop connection) и обнови каталог.',
          check: (c) => has(c, 'response', (e) => e.source === 'app' && e.host === API && e.blocked) && has(c, 'app', isAppEv('catalog', (e) => e.state === 'error')),
          success: 'Приложение показало ошибку и кнопку «Повторить» — корректная реакция на недоступный сервер.' },
        { id: 'off', text: 'Выключи Block List и нажми «Повторить» или ↻: каталог должен загрузиться.',
          check: (c) => { const l = lastOf(c, 'app', isAppEv('catalog')); return !blockActive(c.state) && !!l && l.state === 'ok' && l.status === 200; },
          success: 'Связь восстановлена.' },
      ],
      hints: [
        'Block List не пропускает запросы к указанным адресам: Charles отвечает 403 или просто рвёт соединение (Drop connection).',
        'Tools → Block List… → Enable Block List ✓ → Add: Host analytics.potions.shop, Path *. Маска *.potions.shop не подходит — она заблокирует и API.',
        'Tools → Block List → Add (Host <b>analytics.potions.shop</b>) → OK → ↻ → «Корзина» → «Оформить заказ» → «Оплатить» → «Баг клиента…» → Tools → Block List → Add (Host <b>api.potions.shop</b>), Blocking action: Drop connection → OK → ↻ → Tools → Block List → снять Enable → OK → «Повторить».',
      ],
    },
    {
      id: 'ch-18',
      title: 'Пустые, битые и ошибочные ответы',
      giver: { name: 'Ломатель зелий', sprite: '💥' },
      gold: 235,
      setup: { ssl: SSL_ALL, bugs: { profileEmptyCrash: true } },
      outro: 'Негативные ответы (пусто, мусор, 4xx/5xx) проверяют на каждом экране: приложение должно показать понятную ошибку, а не падать.',
      steps: [
        { id: 'empty', text: 'Подмени ответ профиля пустым файлом: <b>Tools → Map Local</b>, Path <code>/v2/profile</code>, файл <code>profile-empty.json</code> (0 байт). Открой «Профиль».',
          check: (c) => has(c, 'response', appRes('/v2/profile', (e) => e.mapLocal === 'profile-empty.json')) && has(c, 'app', isAppEv('crash', (e) => e.where === 'profile')),
          success: 'Приложение упало: «Лавка зелий остановлена».' },
        { id: 'whose', text: 'Как оценить падение?',
          answer: { kind: 'choice', options: ['Не баг: сервер никогда не пришлёт пустой ответ', 'Баг клиента: на пустое или неожиданное тело приложение должно показать ошибку, а не падать', 'Баг Charles: Map Local испортил ответ'], accept: (v) => v === 1, wrong: 'Сеть и прокси могут обрезать ответ. Что должно делать приложение?' },
          success: 'Краш — баг клиента с высоким приоритетом.' },
        { id: 'broken', text: 'Закрой приложение и запусти снова. Подмени каталог битым JSON: Map Local для <code>/v2/catalog</code> → <code>catalog-broken.json</code>, обнови каталог.',
          check: (c) => has(c, 'response', appRes('/v2/catalog', (e) => e.mapLocal === 'catalog-broken.json')) && has(c, 'app', isAppEv('catalog', (e) => e.state === 'error' && e.status === 200)),
          success: 'Каталог не упал: «Не удалось обработать ответ сервера» и «Повторить». Здесь всё правильно.' },
        { id: 'e503', text: 'Выключи Map Local. Поставь Breakpoint на <b>ответ</b> <code>/v2/orders</code>, открой «Профиль → Мои заказы» и замени Status на <code>503</code>.',
          check: (c) => has(c, 'response', appRes('/v2/orders', (e) => e.viaBreakpoint && e.resEdited && e.status >= 500)) && has(c, 'app', isAppEv('orders', (e) => e.state === 'error' && e.status >= 500)),
          success: 'Экран заказов показал «Сервер временно недоступен (503)».' },
        { id: 'off', text: 'Выключи Map Local и Breakpoints.',
          check: (c) => !mapLocalActive(c.state) && !bpActive(c.state), success: 'Все подмены сняты.' },
      ],
      hints: [
        'Map Local — для подмены тела файлом (пусто, мусор), Breakpoint на ответ — для смены статуса вручную.',
        'Tools → Map Local… → Add: Path /v2/profile, файл profile-empty.json. После краша — «Закрыть приложение» и снова 🧪. Breakpoint: Proxy → Breakpoint Settings → Add: Path /v2/orders, Response ✓.',
        'Map Local Add (<b>/v2/profile</b> → profile-empty.json) → «Профиль» → «Баг клиента…» → Закрыть → 🧪 → Map Local Add (<b>/v2/catalog</b> → catalog-broken.json) → ↻ → Map Local: снять Enable → Breakpoint Settings Add (<b>/v2/orders</b>, Response ✓) → «Профиль» → «Мои заказы» → Execute (если стоит Request) → Status <b>503</b> → Execute → ⬣.',
      ],
    },
    {
      id: 'ch-19',
      title: 'Истёкший токен и повторный вход',
      giver: { name: 'Ключник', sprite: '🗝️' },
      gold: 240,
      setup: { ssl: SSL_ALL, cart: [[5, 2]], bugs: { loginHttp: true } },
      outro: 'Сценарий «токен истёк» проверяют на каждом защищённом экране: 401 → экран входа → после входа всё снова работает.',
      steps: [
        { id: 'expire', text: 'Испорть токен в одном запросе: Breakpoint на запрос <code>/v2/cart</code> (или <code>/v2/profile</code>), открой экран и в Edit Request замени значение <code>Authorization</code> на <code>Bearer expired</code> → Execute.',
          check: (c) => has(c, 'response', (e) => e.source === 'app' && e.status === 401 && (e.reqEdited || e.rewritten)) && has(c, 'app', isAppEv('logout', (e) => e.reason === 401)),
          success: 'Сервер ответил 401, приложение отправило на экран входа: «Сессия истекла».' },
        { id: 'hdr', text: 'Открой у ответа 401 вкладку <b>Contents → Response → Headers</b>: сервер объясняет, что не так с токеном.',
          check: (c) => has(c, 'pane', (e) => e.side === 'res' && e.pane === 'headers' && e.status === 401),
          success: 'WWW-Authenticate: Bearer error="invalid_token" — стандартный ответ на плохой токен.' },
        { id: 'relogin', text: 'Выключи Breakpoints (и Rewrite, если пользовался) и войди в приложение снова.',
          check: (c) => { const i = idxOf(c, 'app', isAppEv('logout', (e) => e.reason === 401)); return !bpActive(c.state) && !rewriteActive(c.state) && hasAfter(c, i, 'response', appRes('/v2/auth/login', (e) => e.status === 200)); },
          success: 'Новый токен получен.' },
        { id: 'http', text: 'Посмотри в Charles на запрос входа <code>/v2/auth/login</code> (URL, Contents). Что с ним не так?',
          answer: { kind: 'choice', options: ['Ничего: вход прошёл успешно', 'Он ушёл по http:// — email и пароль передаются открытым текстом', 'Сервер выдал токен без срока жизни'], accept: (v) => v === 1, wrong: 'Посмотри на схему в URL запроса и на замок у строки.' },
          success: 'Баг безопасности клиента: логин обязан идти только по HTTPS.' },
        { id: 'after', text: 'Проверь, что с новым токеном защищённые экраны работают: открой «Корзину» или «Профиль».',
          check: (c) => { const i = idxOf(c, 'app', isAppEv('login-ok')); return hasAfter(c, i, 'response', (e) => e.source === 'app' && ['/v2/cart', '/v2/profile', '/v2/orders'].includes(e.path) && e.status === 200 && !e.edited); },
          success: 'Корзина на месте, сессия восстановлена полностью.' },
      ],
      hints: [
        'Чтобы получить 401, достаточно отправить серверу неверный токен: поправь заголовок Authorization в Breakpoint или правилом Rewrite.',
        'Proxy → Breakpoint Settings → Add: Path /v2/cart, Request ✓. В Edit Request в Headers строка Authorization: Bearer … — замени значение. Заголовки ответа: строка 401 → Contents → Response → Headers.',
        'Breakpoint Settings Add (<b>/v2/cart</b>, Request ✓) → «Корзина» → Headers: Authorization: <b>Bearer expired</b> → Execute (и Execute для ответа) → строка 401 → Contents → Response: Headers → ⬣ → «Войти» → «Он ушёл по http://…» → «Корзина».',
      ],
    },
    {
      id: 'ch-20',
      title: 'Финальное расследование',
      giver: { name: 'Верховный дознаватель', sprite: '🔮' },
      gold: 250,
      setup: { ssl: SSL_ALL, noise: true, cart: [[2, 2]], bugs: { orders500: true, ordersErrorAsEmpty: true, promoNotSent: true } },
      outro: 'Хороший отчёт о расследовании: что видит пользователь, что ушло в запросе, что пришло в ответе, cURL для повтора и чья это зона ответственности.',
      steps: [
        { id: 'orders', text: 'Жалоба: «пропали все заказы». Открой «Профиль → Мои заказы» и найди в Charles запрос списка заказов (Focus или Filter помогут отсеять шум SDK).',
          check: (c) => has(c, 'select', (e) => e.path === '/v2/orders' && e.method === 'GET' && e.status === 500),
          success: 'Сервер ответил 500, а приложение показало «Заказов пока нет».' },
        { id: 'curl', text: 'Скопируй для бэкенда <b>Copy cURL Request</b> этого запроса.',
          check: (c) => has(c, 'copy', (e) => e.what === 'curl' && e.path === '/v2/orders' && e.method === 'GET'),
          success: 'cURL приложим к багу сервера.' },
        { id: 'pay', text: 'Вторая жалоба: «скидка не применилась». В «Корзине» введи промокод <code>WIZARD10</code>, «Применить» → «Оформить заказ» → «Оплатить».',
          check: (c) => has(c, 'app', isAppEv('promo', (e) => e.ok)) && has(c, 'app', isAppEv('order-ok')),
          success: 'На кнопке была сумма со скидкой, а списано больше.' },
        { id: 'body', text: 'Открой тело запроса <code>POST /v2/orders</code>: <b>Contents → Request → JSON</b> (или Text).',
          check: (c) => has(c, 'pane', (e) => e.side === 'req' && ['json', 'text', 'raw'].includes(e.pane) && e.path === '/v2/orders' && e.method === 'POST'),
          success: 'В теле нет поля promo.' },
        { id: 'compose', text: 'Проверь сервер: Compose этого запроса, добавь в Body поле <code>"promo": "WIZARD10"</code> → Execute.',
          check: (c) => has(c, 'response', (e) => e.source === 'compose' && e.method === 'POST' && e.path === '/v2/orders' && e.status === 201 && e.reqJson && String(e.reqJson.promo || '').toUpperCase() === 'WIZARD10'),
          success: 'С полем promo сервер дал скидку 10%: сервер работает, промокод теряет приложение.' },
        { id: 'verdict', text: 'Итог расследования?',
          answer: { kind: 'choice', options: [
            'Один баг сервера: 500 на /v2/orders, остальное — следствие',
            'Сервер: 500 на GET /v2/orders. Клиент: ошибку выдаёт за пустой список. Клиент: не передаёт promo в заказ',
            'Два бага клиента, сервер в порядке',
            'Баг сервера: он игнорирует промокод'], accept: (v) => v === 1, wrong: 'Пройдись по каждому шагу: где было неверно в запросе, где в ответе, где на экране?' },
          success: 'Три бага, у каждого свой исполнитель и свои доказательства из Charles.' },
      ],
      hints: [
        'Для каждой жалобы ищи запрос и сравнивай три вещи: запрос, ответ, экран. Неверный запрос — баг клиента, неверный ответ на верный запрос — баг сервера.',
        'Шум от SDK убирается через Focus на api.potions.shop или Filter «orders». Copy cURL — в Actions ▾. Compose — ✎ на панели при выбранном POST /v2/orders.',
        '«Профиль» → «Мои заказы» → строка GET /v2/orders (500) → Actions ▾ → Copy cURL Request → «Корзина» → <b>WIZARD10</b> → «Применить» → «Оформить заказ» → «Оплатить» → строка POST /v2/orders → Contents → Request: JSON → ✎ Compose → в Body добавь <b>"promo": "WIZARD10",</b> → Execute → второй вариант ответа.',
      ],
    },
  ];

  Quest.create({
    mode: 'charles',
    icon: '🕸️',
    title: 'API · Charles Proxy',
    buildSim,
    levels: LEVELS,
  });
})();
