// Симулятор Apache JMeter 5.6: дерево тест-плана, редакторы элементов, слушатели, CLI-режим и HTML-отчёт.
// Тестируемый стенд shop.load.test — модель производительности: пул воркеров, очередь, таймауты (504),
// переполнение очереди (503), разогрев пула, конкуренция за ресурс, кэш, утечка памяти.
// Прогон — детерминированная событийная симуляция в виртуальном времени; результат «проигрывается»
// за 1–4 секунды (window.JM_FAST = true — почти мгновенно, для автотестов).
(function () {
  'use strict';

  const Core = window.Core;
  const esc = (v) => Core.esc(v == null ? '' : String(v));

  const VERSION = '5.6.3';
  const HOST = 'shop.load.test';
  const HOME = '/home/qa/tests';
  const PASSWORD = 'Passw0rd!';
  const STATIC_TOKEN = 'qa-static-token';
  const OLD_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJsb2FkX3VzZXIxIiwiaWF0IjoxNzYwMzQ1NjAwfQ.Zm9vYmFyYmF6';
  const UA = 'Apache-HttpClient/4.5.14 (Java/17.0.12)';
  const MAX_SAMPLES = 160000;
  const MAX_THREADS = 1000;
  const VRT_ROWS = 1000;
  const T0 = Date.UTC(2026, 9, 14, 9, 0, 0); // «настенное» время старта прогонов
  const USERS = Array.from({ length: 50 }, (_, i) => `load_user${i + 1}`);
  const FILES = {
    'users.csv': USERS.map((u) => `${u},${PASSWORD}`).join('\n') + '\n',
    'products.csv': Array.from({ length: 30 }, (_, i) => String(((i * 37) % 500) + 1)).join('\n') + '\n',
  };
  const STATUS = { 200: 'OK', 201: 'Created', 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 415: 'Unsupported Media Type', 500: 'Internal Server Error', 503: 'Service Unavailable', 504: 'Gateway Time-out' };
  const PRODUCTS = ['Зелье лечения', 'Эликсир маны', 'Настой невидимости', 'Драконья кровь', 'Пыльца феи', 'Слеза единорога', 'Корень мандрагоры', 'Перо феникса', 'Глиняный амулет', 'Свиток огня'];

  // ---------- утилиты ----------
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const num = (v, d) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) ? n : (d === undefined ? 0 : d); };
  const int = (v, d) => { const n = parseInt(String(v == null ? '' : v).trim(), 10); return Number.isFinite(n) ? n : (d === undefined ? 0 : d); };
  const pad = (n, w) => String(n).padStart(w, ' ');
  const pad0 = (n, w) => String(n).padStart(w || 2, '0');
  const hms = (ms) => { const s = Math.floor(ms / 1000); return `${pad0(Math.floor(s / 3600))}:${pad0(Math.floor(s / 60) % 60)}:${pad0(s % 60)}`; };
  const wall = (ms) => { const d = new Date(T0 + ms); return `${d.getUTCFullYear()}-${pad0(d.getUTCMonth() + 1)}-${pad0(d.getUTCDate())} ${pad0(d.getUTCHours() + 3)}:${pad0(d.getUTCMinutes())}:${pad0(d.getUTCSeconds())}`; };
  const bytes = (s) => new TextEncoder().encode(s || '').length;
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hex = (r, n) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
  function parseCookies(s) {
    const o = {};
    String(s || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
    return o;
  }
  const parseJson = (s) => { try { return JSON.parse(s); } catch (e) { return undefined; } };

  // Подмножество JSONPath: $.a.b, $..a, $.a[0], $['a'], [*], .*
  function jsonPath(obj, path) {
    path = String(path || '').trim();
    if (path[0] !== '$') return null;
    const toks = [];
    let rest = path.slice(1);
    const re = /^(\.\.|\.)([A-Za-z_$][\w$-]*|\*)|^\[(\d+|\*|'[^']*'|"[^"]*")\]/;
    while (rest) {
      const m = re.exec(rest);
      if (!m) return null;
      toks.push(m[1] ? { deep: m[1] === '..', key: m[2] } : { key: m[3].replace(/^['"]|['"]$/g, '') });
      rest = rest.slice(m[0].length);
    }
    let cur = [obj];
    for (const t of toks) {
      const next = [];
      const take = (o) => {
        if (o == null || typeof o !== 'object') return;
        if (t.key === '*') next.push(...Object.values(o));
        else if (Object.prototype.hasOwnProperty.call(o, t.key)) next.push(o[t.key]);
      };
      for (const o of cur) {
        if (!t.deep) { take(o); continue; }
        const stack = [o];
        while (stack.length) { const x = stack.shift(); take(x); if (x && typeof x === 'object') stack.push(...Object.values(x)); }
      }
      cur = next;
    }
    return cur;
  }

  // Мини-куча по времени события (t, порядок постановки).
  function heap() {
    const a = [];
    const less = (i, j) => a[i].t < a[j].t || (a[i].t === a[j].t && a[i].s < a[j].s);
    const sw = (i, j) => { const x = a[i]; a[i] = a[j]; a[j] = x; };
    return {
      get size() { return a.length; },
      push(x) { a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!less(i, p)) break; sw(i, p); i = p; } },
      pop() {
        const top = a[0];
        const last = a.pop();
        if (a.length) {
          a[0] = last;
          let i = 0;
          for (;;) { const l = 2 * i + 1; const r = l + 1; let m = i; if (l < a.length && less(l, m)) m = l; if (r < a.length && less(r, m)) m = r; if (m === i) break; sw(i, m); i = m; }
        }
        return top;
      },
    };
  }

  // ---------- модель тестируемого сервиса ----------
  const SERVER = {
    workers: 50, // размер пула обработчиков (соединений с БД)
    queueMax: 500, // длина очереди, дальше — 503
    timeout: 10000, // шлюз отвечает 504, если ответа нет дольше
    sigma: 0.22, // разброс времени обработки (логнормальный)
    warm: null, // { start, perSec } — пул поднимается постепенно после старта (холодный старт)
    tail: null, // { ep, p, min, max } — редкие очень медленные ответы (холодный кэш, GC)
    contention: null, // { ep: k } — время растёт с числом одновременных запросов к ресурсу (блокировки в БД)
    leak: 0, // рост времени обработки за минуту работы (утечка)
    oomAfter: 0, // после этой минуты работы часть ответов — 500 OutOfMemoryError
    softErr: 0, // доля «200 OK + страница техработ» у /api/catalog
    singleSession: false, // новый вход пользователя гасит его прежние сессии и токены
    staticToken: false, // принимать долгоживущий токен qa-static-token
    pools: null, // { ep: n } — у ресурса эндпоинта свой маленький пул (например, соединения к БД), запросы ждут в нём
    sigmaEp: null, // { ep: sigma } — свой разброс времени для эндпоинта
    cost: { health: 3, products: 55, product: 18, productMiss: 85, search: 160, categories: 35, catalog: 60, login: 75, profile: 25, cart: 30, cartAdd: 40, orders: 120, notFound: 2 },
  };

  function createServer(cfg, rnd) {
    const sv = { busy: 0, queue: [], processed: 0, active: {}, epq: {}, sessions: {}, tokens: {}, byUser: {}, cache: new Set(), seq: 10230 };
    const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
    const pool = (now) => (cfg.warm ? Math.min(cfg.workers, cfg.warm.start + Math.floor((now / 1000) * cfg.warm.perSec)) : cfg.workers);
    const res = (code, body, ep, extra) => Object.assign({ code, body: typeof body === 'string' ? body : JSON.stringify(body), ctype: typeof body === 'string' ? 'text/html; charset=UTF-8' : 'application/json', ep }, extra || {});
    const e503 = () => res(503, '<html><body><h1>503 Service Unavailable</h1>\nNo server is available to handle this request.\n</body></html>', 'lb');
    const e504 = () => res(504, '<html><body><h1>504 Gateway Time-out</h1>\nThe server didn\'t respond in time.\n</body></html>', 'lb');

    function svcTime(ep, now) {
      let ms = (cfg.cost[ep] || 20) * Math.exp(((cfg.sigmaEp && cfg.sigmaEp[ep]) || cfg.sigma) * gauss());
      if (cfg.tail && cfg.tail.ep === ep && rnd() < cfg.tail.p) ms = cfg.tail.min + rnd() * (cfg.tail.max - cfg.tail.min);
      if (cfg.contention && cfg.contention[ep]) ms *= 1 + cfg.contention[ep] * Math.max(0, (sv.active[ep] || 0) - 1);
      if (cfg.leak) ms *= 1 + cfg.leak * (now / 60000);
      return Math.max(1, ms);
    }

    function newSession(user) {
      if (cfg.singleSession && sv.byUser[user]) {
        const old = sv.byUser[user];
        if (sv.sessions[old.sid]) sv.sessions[old.sid].valid = false;
        if (sv.tokens[old.token]) sv.tokens[old.token].valid = false;
      }
      const sid = hex(rnd, 24).toUpperCase();
      const token = 'eyJhbGciOiJIUzI1NiJ9.' + btoa(JSON.stringify({ sub: user, n: ++sv.seq })).replace(/=+$/, '') + '.' + hex(rnd, 16);
      sv.sessions[sid] = { user, valid: true };
      sv.tokens[token] = { user, valid: true };
      sv.byUser[user] = { sid, token };
      return { sid, token };
    }

    // Логика эндпоинтов: выполняется в момент приёма запроса.
    function handle(req) {
      const m = req.method;
      const p = req.path;
      const q = req.query;
      const H = req.h;
      const bearer = () => {
        const mt = /^Bearer\s+(\S+)\s*$/i.exec(H.authorization || '');
        if (!mt) return null;
        if (cfg.staticToken && mt[1] === STATIC_TOKEN) return { user: 'qa_static', valid: true };
        return sv.tokens[mt[1]] || { valid: false, unknown: true };
      };
      const session = () => { const s = sv.sessions[parseCookies(H.cookie).SESSIONID]; return s || null; };
      const only = (meth) => (m !== meth ? res(405, { error: `Method ${m} not allowed` }, 'notFound') : null);
      let mt;
      if (p === '/api/health') return only('GET') || res(200, { status: 'UP' }, 'health');
      if (p === '/api/products') {
        return only('GET') || res(200, { page: 1, total: PRODUCTS.length, items: PRODUCTS.map((n, i) => ({ id: i + 1, name: n, price: 15 + i * 37 })) }, 'products');
      }
      if ((mt = /^\/api\/products\/([^/]+)$/.exec(p))) {
        const bad = only('GET');
        if (bad) return bad;
        const id = int(mt[1], -1);
        if (!(id >= 1 && id <= 500) || String(id) !== mt[1]) return res(404, { error: 'Product not found', id: mt[1] }, 'product');
        const hit = sv.cache.has(id);
        sv.cache.add(id);
        return res(200, { id, name: PRODUCTS[id % PRODUCTS.length], price: 10 + (id * 7) % 990, stock: id % 13 }, hit ? 'product' : 'productMiss', { cache: hit ? 'HIT' : 'MISS' });
      }
      if (p === '/api/search') {
        const bad = only('GET');
        if (bad) return bad;
        const s = (q.find(([k]) => k === 'q') || [])[1];
        if (!s) return res(400, { error: 'Query parameter q is required' }, 'notFound');
        return res(200, { query: s, total: 3, results: PRODUCTS.slice(0, 3).map((n, i) => ({ id: i + 1, name: n })) }, 'search');
      }
      if (p === '/api/categories') return only('GET') || res(200, { items: ['Зелья', 'Эликсиры', 'Артефакты', 'Свитки'].map((n, i) => ({ id: i + 1, name: n, products: 120 + i * 7 })) }, 'categories');
      if (p === '/api/catalog') {
        const bad = only('GET');
        if (bad) return bad;
        if (cfg.softErr && rnd() < cfg.softErr) {
          return res(200, '<html><head><title>Maintenance</title></head><body><h1>Сервис временно недоступен</h1><p>Идут технические работы. Попробуйте позже.</p></body></html>', 'catalog', { soft: true });
        }
        return res(200, { items: PRODUCTS.slice(0, 6).map((n, i) => ({ id: i + 1, name: n })), total: 6 }, 'catalog');
      }
      if (p === '/api/login') {
        const bad = only('POST');
        if (bad) return bad;
        if (!/application\/json/i.test(H['content-type'] || '')) return res(415, { error: 'Unsupported Media Type: expected Content-Type application/json' }, 'notFound');
        const b = parseJson(req.body);
        if (!b || typeof b !== 'object') return res(400, { error: 'Malformed JSON body' }, 'notFound');
        if (!USERS.includes(b.username) || b.password !== PASSWORD) return res(401, { error: 'Invalid credentials' }, 'login');
        const s = newSession(b.username);
        return res(200, { token: s.token, user: b.username, expiresIn: 900 }, 'login', { cookie: `SESSIONID=${s.sid}; Path=/; HttpOnly` });
      }
      if (p === '/api/profile') {
        const bad = only('GET');
        if (bad) return bad;
        const t = bearer() || session();
        if (!t) return res(401, { error: 'Authentication required' }, 'profile');
        if (!t.valid) return res(401, { error: 'Token expired or revoked' }, 'profile');
        return res(200, { user: t.user, level: 7, email: `${t.user}@shop.load.test` }, 'profile');
      }
      if (p === '/api/cart' || p === '/api/cart/items') {
        const bad = only(p === '/api/cart' ? 'GET' : 'POST');
        if (bad) return bad;
        const s = session();
        if (!s) return res(401, { error: 'Not authenticated: no session cookie' }, 'cart');
        if (!s.valid) return res(401, { error: 'Session terminated: user logged in from another session' }, 'cart');
        return p === '/api/cart' ? res(200, { user: s.user, items: [], total: 0 }, 'cart') : res(201, { added: true }, 'cartAdd');
      }
      if (p === '/api/orders') {
        const bad = only('POST');
        if (bad) return bad;
        const t = bearer();
        if (!t) return res(401, { error: 'Authorization header with Bearer token is required' }, 'notFound');
        if (!t.valid) return res(401, { error: 'Invalid or expired token' }, 'notFound');
        const b = parseJson(req.body);
        if (!b || !b.productId) return res(400, { error: 'productId is required' }, 'notFound');
        return res(201, { orderId: ++sv.seq, status: 'CREATED', productId: b.productId, user: t.user }, 'orders');
      }
      return res(404, { error: 'Not Found', path: p }, 'notFound');
    }

    // Приём запроса: пул → очередь → 503; ответ дольше timeout — 504 от шлюза.
    function arrive(now, req, reply, at) {
      pump(now, at);
      if (sv.busy >= pool(now) && sv.queue.length >= cfg.queueMax) { at(now + 2, () => reply(now + 2, e503())); return; }
      const job = { r: handle(req), arr: now, state: 'q', reply };
      if (sv.busy < pool(now)) { startJob(job, now, at); return; }
      sv.queue.push(job);
      at(now + cfg.timeout, () => { if (job.state === 'q') { job.state = 'x'; reply(now + cfg.timeout, e504()); } });
    }
    function startJob(job, now, at) {
      sv.busy++;
      const ep = job.r.ep;
      const lim = cfg.pools && cfg.pools[ep];
      if (lim && (sv.active[ep] || 0) >= lim) {
        // поток приложения занят, но ждёт свободное соединение ресурса
        job.state = 'w';
        (sv.epq[ep] = sv.epq[ep] || []).push(job);
        const tt = job.arr + cfg.timeout;
        at(tt, () => {
          if (job.state !== 'w') return;
          job.state = 'x';
          sv.epq[ep].splice(sv.epq[ep].indexOf(job), 1);
          sv.busy--;
          job.reply(tt, e504());
          pump(tt, at);
        });
        return;
      }
      exec(job, now, at);
    }
    function exec(job, now, at) {
      job.state = 'r';
      const ep = job.r.ep;
      sv.active[ep] = (sv.active[ep] || 0) + 1;
      const end = now + svcTime(ep, now);
      if (end - job.arr > cfg.timeout) { const tt = job.arr + cfg.timeout; job.late = true; at(tt, () => job.reply(tt, e504())); }
      at(end, () => {
        sv.busy--;
        sv.active[ep]--;
        sv.processed++;
        if (!job.late) {
          if (cfg.oomAfter && end > cfg.oomAfter * 60000 && rnd() < Math.min(0.6, (end - cfg.oomAfter * 60000) / 240000)) job.reply(end, res(500, { error: 'java.lang.OutOfMemoryError: Java heap space' }, ep));
          else job.reply(end, job.r);
        }
        const wq = sv.epq[ep];
        if (wq && wq.length) exec(wq.shift(), end, at);
        pump(end, at);
      });
    }
    function pump(now, at) {
      while (sv.busy < pool(now) && sv.queue.length) {
        const j = sv.queue.shift();
        if (j.state === 'q') startJob(j, now, at);
      }
    }
    return { arrive };
  }

  // ---------- элементы тест-плана ----------
  // kind: plan | tg | sampler | ctrl | config | timer | assert | post | listener
  const T = {
    testplan: { kind: 'plan', label: 'Test Plan', icon: '🧪', p: () => ({ vars: [] }) },
    threadgroup: { kind: 'tg', cat: 'threads', label: 'Thread Group', icon: '👥', p: () => ({ onError: 'continue', threads: '1', rampup: '1', infinite: false, loops: '1', lifetime: false, duration: '', delay: '' }) },
    http: { kind: 'sampler', cat: 'sampler', label: 'HTTP Request', icon: '🌐', p: () => ({ protocol: '', host: '', port: '', method: 'GET', path: '', params: [], body: '' }) },
    once: { kind: 'ctrl', cat: 'logic', label: 'Once Only Controller', icon: '1️⃣', p: () => ({}) },
    txn: { kind: 'ctrl', cat: 'logic', label: 'Transaction Controller', icon: '🔀', p: () => ({ parent: false, timers: false }) },
    loopc: { kind: 'ctrl', cat: 'logic', label: 'Loop Controller', icon: '🔁', p: () => ({ infinite: false, loops: '1' }) },
    headers: { kind: 'config', cat: 'config', label: 'HTTP Header Manager', icon: '🔧', p: () => ({ list: [] }) },
    cookies: { kind: 'config', cat: 'config', label: 'HTTP Cookie Manager', icon: '🍪', p: () => ({ clearEach: false, policy: 'standard' }) },
    csv: { kind: 'config', cat: 'config', label: 'CSV Data Set Config', icon: '📄', p: () => ({ file: '', enc: 'UTF-8', names: '', ignoreFirst: 'False', delim: ',', recycle: 'True', stopThread: 'False', share: 'all' }) },
    udv: { kind: 'config', cat: 'config', label: 'User Defined Variables', icon: '🔧', p: () => ({ vars: [] }) },
    defaults: { kind: 'config', cat: 'config', label: 'HTTP Request Defaults', icon: '🔧', p: () => ({ protocol: '', host: '', port: '' }) },
    ctimer: { kind: 'timer', cat: 'timer', label: 'Constant Timer', icon: '⏱', p: () => ({ delay: '300' }) },
    urtimer: { kind: 'timer', cat: 'timer', label: 'Uniform Random Timer', icon: '⏱', p: () => ({ range: '100.0', offset: '0' }) },
    cttimer: { kind: 'timer', cat: 'timer', label: 'Constant Throughput Timer', icon: '⏱', p: () => ({ tput: '0.0', mode: 'this' }) },
    rassert: { kind: 'assert', cat: 'assert', label: 'Response Assertion', icon: '🔍', p: () => ({ field: 'text', rule: 'contains', not: false, or: false, patterns: [], msg: '' }) },
    dassert: { kind: 'assert', cat: 'assert', label: 'Duration Assertion', icon: '🔍', p: () => ({ duration: '' }) },
    jassert: { kind: 'assert', cat: 'assert', label: 'JSON Assertion', icon: '🔍', p: () => ({ path: '', validate: false, regex: true, expected: '', expectNull: false, invert: false }) },
    jextract: { kind: 'post', cat: 'post', label: 'JSON Extractor', icon: '⤵', p: () => ({ ref: '', path: '', match: '', def: '' }) },
    rextract: { kind: 'post', cat: 'post', label: 'Regular Expression Extractor', icon: '⤵', p: () => ({ field: 'body', ref: '', regex: '', template: '', match: '', def: '' }) },
    vrt: { kind: 'listener', cat: 'listener', label: 'View Results Tree', icon: '📊', p: () => ({ file: '', errors: false, successes: false }) },
    summary: { kind: 'listener', cat: 'listener', label: 'Summary Report', icon: '📊', p: () => ({ file: '' }) },
    aggregate: { kind: 'listener', cat: 'listener', label: 'Aggregate Report', icon: '📊', p: () => ({ file: '' }) },
    rtgraph: { kind: 'listener', cat: 'listener', label: 'Response Time Graph', icon: '📈', p: () => ({ interval: '1000' }) },
    atgraph: { kind: 'listener', cat: 'listener', label: 'Active Threads Over Time', icon: '📈', p: () => ({}) },
  };
  const CATS = [['threads', 'Threads (Users)'], ['sampler', 'Sampler'], ['logic', 'Logic Controller'], ['config', 'Config Element'], ['timer', 'Timer'], ['post', 'Post Processors'], ['assert', 'Assertions'], ['listener', 'Listener']];
  const CHILD_CATS = {
    plan: ['threads', 'config', 'timer', 'post', 'assert', 'listener'],
    tg: ['sampler', 'logic', 'config', 'timer', 'post', 'assert', 'listener'],
    ctrl: ['sampler', 'logic', 'config', 'timer', 'post', 'assert', 'listener'],
    sampler: ['config', 'timer', 'post', 'assert', 'listener'],
  };
  const kindOf = (e) => T[e.type].kind;
  const catsFor = (e) => CHILD_CATS[kindOf(e)] || [];
  const canHold = (parent, child) => catsFor(parent).includes(T[child.type].cat);

  let UID = 0;
  // E(type, name, props, children) — компактная запись плана для уровней.
  function E(type, name, props, children) {
    return { id: 'n' + (++UID), type, name: name || (type === 'testplan' ? 'Test Plan' : T[type].label), enabled: true, comment: '', p: Object.assign(T[type].p(), props || {}), children: children || [] };
  }
  const reId = (e) => { e.id = 'n' + (++UID); e.children.forEach(reId); return e; };
  function walk(e, fn, parent) { fn(e, parent); e.children.forEach((c) => walk(c, fn, e)); }
  function all(plan, pred) { const out = []; walk(plan, (e, par) => { if (!pred || pred(e, par)) out.push(e); }); return out; }
  function parentOf(plan, id) { let r = null; walk(plan, (e, par) => { if (e.id === id) r = par || null; }); return r; }
  function byId(plan, id) { let r = null; walk(plan, (e) => { if (e.id === id) r = e; }); return r; }
  // Включён ли элемент вместе со всеми предками.
  function live(plan, el) {
    let ok = true;
    const rec = (e, on) => { if (e === el) ok = on && e.enabled; e.children.forEach((c) => rec(c, on && e.enabled)); };
    rec(plan, true);
    return ok;
  }
  const liveAll = (plan, pred) => all(plan, pred).filter((e) => live(plan, e));
  const ancestors = (plan, el) => { const out = []; let p = parentOf(plan, el.id); while (p) { out.push(p); p = parentOf(plan, p.id); } return out; };

  // ---------- переменные и функции ${...} ----------
  function subst(s, vars, fx) {
    if (s == null) return '';
    return String(s).replace(/\$\{(__\w+\([^)]*\)|__\w+|[^}]+)\}/g, (all0, k) => {
      const f = /^__(\w+)(?:\((.*)\))?$/.exec(k);
      if (f) {
        const args = (f[2] || '').split(',').map((x) => x.trim());
        if (f[1] === 'Random') { const a = int(args[0]); const b = int(args[1]); const v = String(a + Math.floor(fx.rnd() * (b - a + 1))); if (args[2]) vars[args[2]] = v; return v; }
        if (f[1] === 'threadNum') return String(fx.threadNum || 1);
        if (f[1] === 'UUID') return [hex(fx.rnd, 8), hex(fx.rnd, 4), '4' + hex(fx.rnd, 3), 'a' + hex(fx.rnd, 3), hex(fx.rnd, 12)].join('-');
        if (f[1] === 'P' || f[1] === 'property') { const v = (fx.props || {})[args[0]]; return v != null ? v : (args[1] != null ? args[1] : ''); }
        if (f[1] === 'time') return String(T0 + (fx.now || 0));
        return all0;
      }
      return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : all0;
    });
  }

  // ---------- проверки ответов ----------
  function runAssertion(a, smp, vars, fx) {
    const P = a.p;
    if (a.type === 'dassert') {
      const d = int(subst(P.duration, vars, fx), 0);
      if (d > 0 && smp.e > d) return `The operation lasted too long: It took ${smp.e} milliseconds, but should not have lasted longer than ${d} milliseconds.`;
      return null;
    }
    if (a.type === 'rassert') {
      const src = P.field === 'code' ? String(smp.code) : P.field === 'message' ? smp.msg : P.field === 'headers' ? smp.resHead : P.field === 'url' ? smp.url : smp.body;
      const pats = (P.patterns || []).map((r) => subst(r[0], vars, fx)).filter((x) => x !== '');
      if (!pats.length) return null;
      const what = { text: 'text', code: 'code', message: 'message', headers: 'headers', url: 'URL' }[P.field] || 'text';
      const verb = { contains: 'contain', matches: 'match', equals: 'equal', substring: 'contain' }[P.rule];
      const test = (pt) => {
        try {
          if (P.rule === 'contains') return new RegExp(pt).test(src);
          if (P.rule === 'matches') return new RegExp('^(?:' + pt + ')$').test(src);
        } catch (e) { return 'bad'; }
        if (P.rule === 'equals') return src === pt;
        return src.indexOf(pt) >= 0;
      };
      const rs = pats.map(test);
      if (rs.includes('bad')) return 'Assertion error: invalid regular expression';
      const raw = P.or ? rs.some(Boolean) : rs.every(Boolean);
      const pass = P.not ? (P.or ? rs.some((x) => !x) : rs.every((x) => !x)) : raw;
      if (pass) return null;
      const bad = pats[P.not ? rs.findIndex((x) => x) : rs.findIndex((x) => !x)] || pats[0];
      return P.msg ? subst(P.msg, vars, fx) : `Test failed: ${what} expected ${P.not ? 'not ' : ''}to ${verb} /${bad}/`;
    }
    if (a.type === 'jassert') {
      const path = subst(P.path, vars, fx).trim();
      if (!path) return null;
      const j = parseJson(smp.body);
      let fail;
      if (j === undefined) fail = `Expected JSON response but got: ${String(smp.body).slice(0, 60)}`;
      else {
        const r = jsonPath(j, path);
        if (r === null) fail = `Invalid JSON path: ${path}`;
        else if (!r.length) fail = `No results for path: ${path}`;
        else if (P.validate) {
          const exp = subst(P.expected, vars, fx);
          const v = r[0];
          const vs = v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
          let ok;
          if (P.expectNull) ok = v === null;
          else if (P.regex) { try { ok = new RegExp('^(?:' + exp + ')$').test(vs); } catch (e) { ok = false; } } else ok = vs === exp;
          if (!ok) fail = P.expectNull ? `Value expected to be null, but found '${vs}'` : `Value expected to ${P.regex ? 'match' : 'be'} '${exp}', but found '${vs}'`;
        }
      }
      if (P.invert) return fail ? null : `Value expected to be different from '${subst(P.expected, vars, fx)}' (inverted assertion)`;
      return fail || null;
    }
    return null;
  }

  function runExtractor(x, smp, vars, fx) {
    const P = x.p;
    const ref = subst(P.ref, vars, fx).trim();
    if (!ref) return;
    const pick = (arr) => { const n = int(P.match, 0); if (!arr.length) return undefined; if (n > 0) return arr[n - 1]; return arr[Math.floor(fx.rnd() * arr.length)]; };
    let v;
    if (x.type === 'jextract') {
      const j = parseJson(smp.body);
      const r = j === undefined ? [] : (jsonPath(j, subst(P.path, vars, fx)) || []);
      const got = pick(r);
      v = got === undefined ? undefined : (got !== null && typeof got === 'object' ? JSON.stringify(got) : String(got));
    } else {
      const src = P.field === 'headers' ? smp.resHead : P.field === 'url' ? smp.url : P.field === 'code' ? String(smp.code) : smp.body;
      let re;
      try { re = new RegExp(subst(P.regex, vars, fx), 'g'); } catch (e) { re = null; }
      const ms = [];
      if (re && P.regex) { let m; while ((m = re.exec(src)) && ms.length < 50) { ms.push(m); if (!m[0]) re.lastIndex++; } }
      const m = pick(ms);
      if (m) v = (P.template || '$1$').replace(/\$(\d+)\$/g, (a0, g) => (m[+g] != null ? m[+g] : ''));
    }
    vars[ref] = v === undefined ? subst(P.def, vars, fx) : v;
  }

  // ---------- компиляция и прогон ----------
  // Область действия: элементы на уровне Test Plan — для всех, в Thread Group — для его сэмплеров,
  // в контроллере — для сэмплеров внутри, внутри сэмплера — только для него.
  function scopeAdd(sc, kids) {
    const n = { headers: sc.headers.slice(), cookies: sc.cookies.slice(), defaults: sc.defaults.slice(), timers: sc.timers.slice(), asserts: sc.asserts.slice(), posts: sc.posts.slice(), csvs: sc.csvs.slice(), anc: sc.anc };
    for (const c of kids) {
      if (!c.enabled) continue;
      const k = kindOf(c);
      if (c.type === 'headers') n.headers.push(c);
      else if (c.type === 'cookies') n.cookies.push(c);
      else if (c.type === 'defaults') n.defaults.push(c);
      else if (c.type === 'csv') n.csvs.push(c);
      else if (k === 'timer') n.timers.push(c);
      else if (k === 'assert') n.asserts.push(c);
      else if (k === 'post') n.posts.push(c);
    }
    return n;
  }
  function compile(plan, tg) {
    const base = scopeAdd({ headers: [], cookies: [], defaults: [], timers: [], asserts: [], posts: [], csvs: [], anc: [plan.id] }, plan.children);
    const rec = (el, sc) => el.children.filter((c) => c.enabled && ['sampler', 'ctrl'].includes(kindOf(c))).map((c) => {
      const sc2 = scopeAdd(sc, c.children);
      sc2.anc = sc.anc.concat(c.id);
      const node = { k: c.type, el: c, sc: sc2, anc: new Set(sc2.anc) };
      if (kindOf(c) === 'ctrl') node.kids = rec(c, sc2);
      return node;
    });
    const sc = scopeAdd(base, tg.children);
    sc.anc = [plan.id, tg.id];
    return rec(tg, sc);
  }

  // o: { gui, noPauses, server, files, props, seed }
  function simulate(plan, o) {
    const rnd = rng(o.seed || 20261014);
    const cfg = Object.assign({}, SERVER, o.server || {});
    cfg.cost = Object.assign({}, SERVER.cost, (o.server || {}).cost || {});
    const server = createServer(cfg, rnd);
    const q = heap();
    let NOW = 0;
    let seq = 0;
    const at = (t, fn) => q.push({ t, s: seq++, fn });
    const samples = [];
    const threads = [];
    const warn = [];
    let active = 0;
    const activeTg = {};
    let stopAll = false;
    let truncated = false;
    let warnedVrt = false;
    const vrtHeavy = o.gui && liveAll(plan, (e) => e.type === 'vrt').some((v) => !v.p.errors);
    let lag = 0;
    const fxBase = { rnd, props: o.props || {} };

    const globals = {};
    (plan.p.vars || []).forEach(([k, v]) => { if (k) globals[k] = subst(v, globals, fxBase); });
    liveAll(plan, (e) => e.type === 'udv').forEach((u) => (u.p.vars || []).forEach(([k, v]) => { if (k) globals[k] = subst(v, globals, fxBase); }));

    const csvState = {};
    function readCsv(c, Th) {
      const P = c.p;
      const file = subst(P.file, Th.vars, fxBase).trim().replace(/^.*\//, '');
      const key = c.id + (P.share === 'thread' ? ':' + Th.uid : P.share === 'group' ? ':' + Th.tgi : '');
      if (!csvState[key]) {
        const text = (o.files || {})[file];
        if (typeof text !== 'string') {
          if (!csvState['err:' + c.id]) { csvState['err:' + c.id] = 1; warn.push(['ERROR', `o.a.j.c.CSVDataSet: java.io.FileNotFoundException: ${file || '(пустое имя файла)'} (No such file or directory)`]); }
          return null;
        }
        const delim = P.delim === '\\t' ? '\t' : (P.delim || ',');
        let lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l !== '');
        let names = String(P.names || '').split(',').map((x) => x.trim()).filter(Boolean);
        if (!names.length) { names = (lines[0] || '').split(delim).map((x) => x.trim()); lines = lines.slice(1); } else if (P.ignoreFirst === 'True') lines = lines.slice(1);
        csvState[key] = { lines, names, pos: 0, delim };
      }
      const cs = csvState[key];
      if (cs.pos >= cs.lines.length) {
        if (P.recycle !== 'False') cs.pos = 0;
        else if (P.stopThread === 'True') return 'stop';
        else { cs.names.forEach((n) => { Th.vars[n] = '<EOF>'; }); return null; }
      }
      const vals = cs.lines[cs.pos++].split(cs.delim);
      cs.names.forEach((n, i) => { Th.vars[n] = vals[i] != null ? vals[i] : ''; });
      return null;
    }

    function buildReq(el, sc, Th, fx) {
      const v = (s) => subst(s, Th.vars, fx).trim();
      const d = {};
      sc.defaults.forEach((x) => ['protocol', 'host', 'port'].forEach((k) => { const val = v(x.p[k]); if (val) d[k] = val; }));
      let protocol = (v(el.p.protocol) || d.protocol || 'http').toLowerCase();
      let host = v(el.p.host) || d.host || '';
      let port = v(el.p.port) || d.port || '';
      let path = v(el.p.path);
      const full = /^(https?):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/i.exec(path);
      if (full) { protocol = full[1].toLowerCase(); host = full[2]; port = full[3] || ''; path = full[4] || '/'; }
      if (path && path[0] !== '/') path = '/' + path;
      if (!path) path = '/';
      const method = el.p.method || 'GET';
      let qs = '';
      const qi = path.indexOf('?');
      const query = [];
      if (qi >= 0) { qs = path.slice(qi + 1); path = path.slice(0, qi); qs.split('&').filter(Boolean).forEach((kv) => { const i = kv.indexOf('='); query.push(i < 0 ? [kv, ''] : [decodeURIComponent(kv.slice(0, i)), decodeURIComponent(kv.slice(i + 1))]); }); }
      const params = (el.p.params || []).filter((r) => r[0] && r[0].trim()).map((r) => [v(r[0]), subst(r[1], Th.vars, fx)]);
      const rawBody = subst(el.p.body, Th.vars, fx);
      let body = '';
      const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
      const autoHead = [];
      if (hasBody && rawBody.trim()) body = rawBody;
      else if (hasBody && params.length) { body = params.map(([k, x]) => `${encodeURIComponent(k)}=${encodeURIComponent(x)}`).join('&'); autoHead.push(['Content-Type', 'application/x-www-form-urlencoded']); }
      else params.forEach((p) => query.push(p));
      const qstr = query.map(([k, x]) => `${encodeURIComponent(k)}=${encodeURIComponent(x)}`).join('&');
      const defPort = protocol === 'https' ? '443' : '80';
      const url = `${protocol}://${host}${port && port !== defPort ? ':' + port : ''}${path}${qstr ? '?' + qstr : ''}`;
      // заголовки: внешние менеджеры, затем внутренние (перекрывают одноимённые)
      const hs = [];
      const put = (k, x) => { const i = hs.findIndex(([n]) => n.toLowerCase() === k.toLowerCase()); if (i >= 0) hs[i] = [k, x]; else hs.push([k, x]); };
      autoHead.forEach(([k, x]) => put(k, x));
      sc.headers.forEach((hm) => (hm.p.list || []).forEach(([k, x]) => { if (k && k.trim()) put(k.trim(), subst(x, Th.vars, fx)); }));
      const cookieOn = sc.cookies.length > 0;
      const ck = Object.entries(Th.cookies).map(([k, x]) => `${k}=${x}`).join('; ');
      const head = [['Connection', 'keep-alive']].concat(hs);
      if (body) head.push(['Content-Length', String(bytes(body))]);
      head.push(['Host', host + (port && port !== defPort ? ':' + port : '')], ['User-Agent', UA]);
      if (cookieOn && ck) head.push(['Cookie', ck]);
      const h = {};
      head.forEach(([k, x]) => { h[k.toLowerCase()] = x; });
      let err = null;
      if (!host) err = ['java.lang.IllegalArgumentException', 'Host may not be blank'];
      else if (!['http', 'https'].includes(protocol)) err = ['java.net.MalformedURLException', `unknown protocol: ${protocol}`];
      else if (host.toLowerCase() !== HOST) err = ['java.net.UnknownHostException', `${host}: Name or service not known`];
      else if (port && !['80', '443'].includes(port)) err = ['org.apache.http.conn.HttpHostConnectException', `Connect to ${host}:${port} [${host}/10.12.0.7] failed: Connection refused`];
      return { method, url, path, query, body, head, h, cookieOn, cookieStr: cookieOn ? ck : '', err };
    }

    // Поток JMeter — генератор: отдаёт { wait } или { req } и получает ответ.
    function* runThread(Th, prog) {
      for (Th.iter = 0; ; Th.iter++) {
        if (!Th.tgc.infinite && Th.iter >= Th.tgc.loops) return;
        if (stopAll) return;
        Th.csvRead = new Set();
        if (Th.cookieClear) Th.cookies = {};
        const ops = Th.ops;
        const r = yield* runNodes(prog, Th);
        if (r === 'stop' || Th.ops === ops) return; // итерация без сэмплеров — поток завершается
      }
    }
    function* runNodes(nodes, Th) {
      for (const n of nodes) {
        const r = yield* runNode(n, Th);
        if (r) return r;
      }
      return null;
    }
    function* runNode(n, Th) {
      if (n.k === 'http') return yield* runSampler(n, Th);
      if (n.k === 'once') return Th.iter === 0 && !Th.loopDepth ? yield* runNodes(n.kids, Th) : null;
      if (n.k === 'loopc') {
        const lim = n.el.p.infinite ? Infinity : int(subst(n.el.p.loops, Th.vars, fxBase), 1);
        Th.loopDepth = (Th.loopDepth || 0) + 1;
        let r = null;
        for (let i = 0; i < lim && !r; i++) { r = yield* runNodes(n.kids, Th); if (lim === Infinity && Th.stopAt && NOW >= Th.stopAt) r = 'stop'; }
        Th.loopDepth--;
        return r;
      }
      if (n.k === 'txn') {
        const list = [];
        const t0 = NOW;
        Th.txn.push({ list, parent: !!n.el.p.parent });
        const r = yield* runNodes(n.kids, Th);
        Th.txn.pop();
        if (list.length) {
          const fails = list.filter((s) => !s.ok).length;
          const e = n.el.p.timers ? NOW - t0 : list.reduce((a, s) => a + s.e, 0);
          const smp = { node: n, label: n.el.name, t: list[0].t, e, lat: 0, ct: 0, code: fails ? (list.find((s) => !s.ok).code) : '200', msg: `Number of samples in transaction : ${list.length}, number of failing samples : ${fails}`, ok: !fails, by: list.reduce((a, s) => a + s.by, 0), sb: list.reduce((a, s) => a + s.sb, 0), thr: Th.name, txn: true, kids: n.el.p.parent ? list : null, fails: fails ? [`${fails} failing sample(s)`] : [] };
          record(smp, Th);
        }
        return r;
      }
      return null;
    }
    function* runSampler(n, Th) {
      const sc = n.sc;
      Th.ops++;
      if (Th.stopAt && NOW >= Th.stopAt) return 'stop';
      if (stopAll) return 'stop';
      for (const c of sc.csvs) {
        if (Th.csvRead.has(c.id)) continue;
        Th.csvRead.add(c.id);
        if (readCsv(c, Th) === 'stop') return 'stop';
      }
      const fx = { rnd, threadNum: Th.num, props: o.props, now: NOW };
      let delay = 0;
      if (!o.noPauses) {
        for (const tm of sc.timers) {
          if (tm.type === 'ctimer') delay += Math.max(0, num(subst(tm.p.delay, Th.vars, fx)));
          else if (tm.type === 'urtimer') delay += Math.max(0, num(subst(tm.p.offset, Th.vars, fx))) + rnd() * Math.max(0, num(subst(tm.p.range, Th.vars, fx)));
          else if (tm.type === 'cttimer') {
            const tp = num(subst(tm.p.tput, Th.vars, fx));
            if (tp > 0) {
              const mode = tm.p.mode;
              const shared = mode === 'allShared' || mode === 'tgShared';
              const nThr = mode === 'all' ? active : mode === 'tg' ? activeTg[Th.tgi] : 1;
              const interval = (60000 / tp) * Math.max(1, nThr);
              const key = shared ? (mode === 'tgShared' ? 'g' + Th.tgi : 'all') + tm.id : tm.id;
              const store = shared ? cttShared : Th.ctt;
              const last = store[key];
              const next = last == null ? NOW : last + interval;
              const d = Math.max(0, next - NOW);
              store[key] = NOW + d;
              delay += d;
            }
          }
        }
      }
      if (delay > 0) {
        if (Th.stopAt && NOW + delay >= Th.stopAt) { yield { wait: Th.stopAt - NOW }; return 'stop'; }
        yield { wait: delay };
        if (stopAll) return 'stop';
      }
      const req = buildReq(n.el, sc, Th, fx);
      const sendT = NOW;
      let smp;
      if (req.err) {
        yield { wait: 2 + Math.floor(rnd() * 3) };
        const body = `${req.err[0]}: ${req.err[1]}\n\tat org.apache.jmeter.protocol.http.sampler.HTTPHC4Impl.sample(HTTPHC4Impl.java:651)`;
        smp = { code: `Non HTTP response code: ${req.err[0]}`, msg: `Non HTTP response message: ${req.err[1]}`, body, resHead: '', ctype: '', by: bytes(body), sb: 0, ct: 0 };
      } else {
        const reply = yield { req };
        const r = reply.resp;
        if (r.cookie && req.cookieOn) { const c = r.cookie.split(';')[0]; const i = c.indexOf('='); Th.cookies[c.slice(0, i)] = c.slice(i + 1); }
        const resHead = [`HTTP/1.1 ${r.code} ${STATUS[r.code] || ''}`, `Date: ${new Date(T0 + NOW).toUTCString()}`, `Content-Type: ${r.ctype}`, `Content-Length: ${bytes(r.body)}`, 'Connection: keep-alive'].concat(r.cookie ? [`Set-Cookie: ${r.cookie}`] : []).concat(r.cache ? [`X-Cache: ${r.cache}`] : []).join('\n');
        smp = { code: r.code, msg: STATUS[r.code] || '', body: r.body, resHead, ctype: r.ctype, by: bytes(r.body) + resHead.length, sb: req.head.reduce((a, [k, x]) => a + k.length + x.length + 4, 0) + bytes(req.body) + req.url.length, ct: Th.conn ? 0 : 3 + Math.floor(rnd() * 4), soft: !!r.soft, ep: r.ep };
        Th.conn = true;
      }
      Object.assign(smp, { node: n, label: n.el.name, t: sendT, e: Math.max(1, Math.round(NOW - sendT)), thr: Th.name, url: req.url, method: req.method, path: req.path, reqBody: req.body, reqHead: req.head, cookie: req.cookieStr, fails: [] });
      smp.lat = Math.max(0, smp.e - Math.min(smp.e, 1 + Math.floor(smp.by / 20000)));
      smp.ok = typeof smp.code === 'number' && smp.code < 400;
      for (const x of sc.posts) runExtractor(x, smp, Th.vars, fx);
      for (const a of sc.asserts) {
        const f = runAssertion(a, smp, Th.vars, fx);
        if (f) { smp.fails.push({ name: a.name, msg: f }); smp.ok = false; }
      }
      // при Generate parent sample дочерние запросы видны только внутри родительского сэмпла
      if (!Th.txn.some((x) => x.parent)) record(smp, Th);
      Th.txn.forEach((x) => x.list.push(smp));
      if (!smp.ok) {
        const oe = Th.tgc.onError;
        if (oe === 'nextloop') return 'next';
        if (oe === 'stopthread') return 'stop';
        if (oe === 'stoptest' || oe === 'stopnow') { stopAll = true; return 'stop'; }
      }
      return null;
    }
    const cttShared = {};

    function record(smp, Th) {
      smp.at = NOW;
      smp.act = active;
      if (samples.length < MAX_SAMPLES) samples.push(smp);
      else truncated = true;
      if (vrtHeavy) {
        lag = Math.min(220, Math.floor(samples.length / 250));
        if (!warnedVrt && samples.length >= 5000) {
          warnedVrt = true;
          warn.push(['WARN', `o.a.j.v.ViewResultsFullVisualizer: View Results Tree накопил ${samples.length} сэмплов и продолжает расти: GUI перегружен, замеры искажаются (до +${220} ms к каждому ответу). Отключи слушатель и запускай нагрузку в CLI-режиме.`]);
        }
      }
      void Th;
    }

    function resume(Th, val) {
      if (truncated) return;
      const r = Th.gen.next(val);
      if (r.done) { active--; activeTg[Th.tgi]--; Th.end = NOW; return; }
      const y = r.value;
      if (y.wait != null) at(NOW + y.wait, () => resume(Th));
      else {
        const net = 1 + Math.floor(rnd() * 3);
        at(NOW + net / 2, () => server.arrive(NOW, y.req, (t, resp) => at(t + net / 2 + lag, () => resume(Th, { resp })), at));
      }
    }

    const tgs = plan.children.filter((c) => c.type === 'threadgroup' && c.enabled);
    const tgInfo = [];
    let uid = 0;
    tgs.forEach((tg, gi) => {
      const P = tg.p;
      const n = Math.min(MAX_THREADS, Math.max(0, int(subst(P.threads, globals, fxBase), 0)));
      const ramp = Math.max(0, num(subst(P.rampup, globals, fxBase)));
      const tgc = { name: tg.name, threads: n, rampup: ramp, infinite: !!P.infinite, loops: P.infinite ? Infinity : int(subst(P.loops, globals, fxBase), 1), lifetime: !!P.lifetime, duration: P.lifetime ? num(subst(P.duration, globals, fxBase)) : 0, delay: P.lifetime ? num(subst(P.delay, globals, fxBase)) : 0, onError: P.onError };
      if (int(subst(P.threads, globals, fxBase), 0) > MAX_THREADS) warn.push(['WARN', `Симулятор ограничивает Thread Group «${tg.name}» до ${MAX_THREADS} потоков.`]);
      if (tgc.loops === -1) { tgc.loops = Infinity; tgc.infinite = true; }
      tgInfo.push(tgc);
      const prog = compile(plan, tg);
      const clearEach = all(tg, (e) => e.type === 'cookies' && e.enabled && e.p.clearEach).length > 0 || plan.children.some((e) => e.type === 'cookies' && e.enabled && e.p.clearEach);
      activeTg[gi] = 0;
      for (let i = 0; i < n; i++) {
        const Th = { uid: uid++, tgi: gi, num: i + 1, name: `${tg.name} ${gi + 1}-${i + 1}`, vars: Object.assign({}, globals), cookies: {}, ctt: {}, txn: [], tgc, cookieClear: clearEach, conn: false, ops: 0 };
        Th.start = tgc.delay * 1000 + (n > 0 ? (ramp * 1000 * i) / n : 0);
        Th.stopAt = tgc.lifetime && tgc.duration > 0 ? (tgc.delay + tgc.duration) * 1000 : 0;
        Th.gen = runThread(Th, prog);
        threads.push(Th);
        at(Th.start, () => { active++; activeTg[gi]++; resume(Th); });
      }
    });

    // Бесконечный цикл без Duration в настоящем JMeter идёт до Stop — здесь прогон обрывается через 10 минут.
    const endless = tgInfo.some((t) => t.infinite && !(t.lifetime && t.duration > 0));
    const maxT = endless ? 600000 : 3600000;
    let guard = 0;
    while (q.size && !truncated) {
      const ev = q.pop();
      if (ev.t > maxT) { warn.push(['WARN', endless ? 'Loop Count = Infinite без Duration: тест шёл бы бесконечно. Симулятор остановил его через 10 минут, как будто нажали Stop.' : 'Симулятор ограничивает прогон одним часом.']); NOW = maxT; break; }
      NOW = ev.t;
      ev.fn();
      if (++guard > 6000000) break;
    }
    if (truncated) warn.push(['WARN', `Прогон остановлен: превышен лимит симулятора ${MAX_SAMPLES} сэмплов.`]);
    const dur = Math.max(NOW, ...threads.map((t) => t.end || 0), 0);
    return {
      samples, warn, truncated, dur, tgs: tgInfo, lag: vrtHeavy,
      threads: threads.map((t) => ({ tgi: t.tgi, start: t.start, end: t.end == null ? dur : t.end })),
    };
  }

  // ---------- статистика слушателей ----------
  const pct = (sorted, p) => (sorted.length ? sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1))] : 0);
  function stats(list) {
    const n = list.length;
    if (!n) return null;
    const es = new Float64Array(n);
    let sum = 0, err = 0, by = 0, sb = 0, t0 = Infinity, t1 = 0;
    for (let i = 0; i < n; i++) {
      const s = list[i];
      es[i] = s.e; sum += s.e; if (!s.ok) err++; by += s.by; sb += s.sb;
      if (s.t < t0) t0 = s.t;
      if (s.t + s.e > t1) t1 = s.t + s.e;
    }
    es.sort();
    const avg = sum / n;
    let sd = 0;
    for (let i = 0; i < n; i++) sd += (es[i] - avg) * (es[i] - avg);
    const span = Math.max(1, t1 - t0) / 1000;
    return { n, avg, med: pct(es, 0.5), p90: pct(es, 0.9), p95: pct(es, 0.95), p99: pct(es, 0.99), min: es[0], max: es[n - 1], sd: Math.sqrt(sd / n), err: err / n, errN: err, tput: n / span, rkb: by / 1024 / span, skb: sb / 1024 / span, avgBytes: by / n };
  }
  function byLabel(list) {
    const m = new Map();
    for (const s of list) { if (!m.has(s.label)) m.set(s.label, []); m.get(s.label).push(s); }
    return [...m.entries()].map(([label, l]) => ({ label, list: l, st: stats(l) }));
  }
  const f0 = (x) => String(Math.round(x));
  const f2 = (x) => x.toFixed(2);
  const fPct = (x) => (x * 100).toFixed(2) + '%';
  function fTput(x) {
    if (x >= 1) return x.toFixed(1) + '/sec';
    if (x * 60 >= 1) return (x * 60).toFixed(1) + '/min';
    return (x * 3600).toFixed(1) + '/hour';
  }

  function summaryTable(list) {
    const rows = byLabel(list);
    const tot = stats(list);
    const head = ['Label', '# Samples', 'Average', 'Min', 'Max', 'Std. Dev.', 'Error %', 'Throughput', 'Received KB/sec', 'Sent KB/sec', 'Avg. Bytes'];
    const line = (label, s, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td>${esc(label)}</td><td>${s.n}</td><td>${f0(s.avg)}</td><td>${f0(s.min)}</td><td>${f0(s.max)}</td><td>${f2(s.sd)}</td><td>${fPct(s.err)}</td><td>${fTput(s.tput)}</td><td>${f2(s.rkb)}</td><td>${f2(s.skb)}</td><td>${s.avgBytes.toFixed(1)}</td></tr>`;
    return `<div class="jm-tablewrap"><table class="jm-table" data-table="summary"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => line(r.label, r.st)).join('')}${tot ? line('TOTAL', tot, 'total') : ''}</tbody></table></div>`;
  }
  function aggregateTable(list) {
    const rows = byLabel(list);
    const tot = stats(list);
    const head = ['Label', '# Samples', 'Average', 'Median', '90% Line', '95% Line', '99% Line', 'Min', 'Maximum', 'Error %', 'Throughput', 'Received KB/sec', 'Sent KB/sec'];
    const line = (label, s, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td>${esc(label)}</td><td>${s.n}</td><td>${f0(s.avg)}</td><td>${f0(s.med)}</td><td>${f0(s.p90)}</td><td>${f0(s.p95)}</td><td>${f0(s.p99)}</td><td>${f0(s.min)}</td><td>${f0(s.max)}</td><td>${fPct(s.err)}</td><td>${fTput(s.tput)}</td><td>${f2(s.rkb)}</td><td>${f2(s.skb)}</td></tr>`;
    return `<div class="jm-tablewrap"><table class="jm-table" data-table="aggregate"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => line(r.label, r.st)).join('')}${tot ? line('TOTAL', tot, 'total') : ''}</tbody></table></div>`;
  }

  // ---------- графики (SVG) ----------
  const COLORS = ['#d62728', '#1f77b4', '#2ca02c', '#ff7f0e', '#9467bd', '#8c564b', '#e377c2', '#17becf'];
  function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
  function lineChart(series, opt) {
    const W = 640, H = 260, L = 52, R = 14, Tp = 24, B = 34;
    const xs = series.flatMap((s) => s.pts.map((p) => p[0]));
    const ys = series.flatMap((s) => s.pts.map((p) => p[1]));
    if (!xs.length) return `<div class="jm-empty">Нет данных: запусти тест (▶ Start).</div>`;
    const x0 = 0, x1 = Math.max(1000, ...xs);
    const y1 = niceMax(Math.max(1, ...ys) * 1.05);
    const X = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
    const Y = (y) => H - B - (y / y1) * (H - B - Tp);
    let g = '';
    for (let i = 0; i <= 4; i++) { const y = (y1 * i) / 4; g += `<line x1="${L}" x2="${W - R}" y1="${Y(y)}" y2="${Y(y)}" class="jm-grid"/><text x="${L - 6}" y="${Y(y) + 4}" text-anchor="end">${Math.round(y)}</text>`; }
    // шаг подписей по времени — «круглый»: 5 с, 10 с, 30 с, 1 мин, 2 мин…
    const stepX = [1, 2, 5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1800].map((v) => v * 1000).find((v) => x1 / v <= 6) || 3600000;
    for (let x = 0; x <= x1; x += stepX) g += `<text x="${X(x)}" y="${H - B + 16}" text-anchor="middle">${hms(x).slice(3)}</text>`;
    const lines = series.map((s, i) => `<polyline fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="1.6" points="${s.pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}"/>`).join('');
    const legend = series.map((s, i) => `<span><i style="background:${COLORS[i % COLORS.length]}"></i>${esc(s.name)}</span>`).join('');
    return `<figure class="jm-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.title)}"><text x="${L}" y="${H - 4}" class="jm-axis">${esc(opt.x || 'Elapsed time (mm:ss)')}</text><text x="${L}" y="12" class="jm-axis">${esc(opt.y)}</text>${g}<line x1="${L}" x2="${L}" y1="${Tp}" y2="${H - B}" class="jm-ax"/><line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="jm-ax"/>${lines}</svg><figcaption class="jm-legend">${legend}</figcaption></figure>`;
  }
  // Среднее время ответа по интервалам для каждого Label.
  function rtSeries(list, interval) {
    const span = list.reduce((m, s) => Math.max(m, s.t), 0);
    let iv = Math.max(100, interval || 1000);
    while (span / iv > 600) iv *= 2;
    const m = new Map();
    for (const s of list) {
      if (!m.has(s.label)) m.set(s.label, new Map());
      const b = Math.floor(s.t / iv);
      const mm = m.get(s.label);
      const c = mm.get(b) || [0, 0];
      c[0] += s.e; c[1]++;
      mm.set(b, c);
    }
    return [...m.entries()].map(([name, mm]) => ({ name, pts: [...mm.entries()].sort((a, b) => a[0] - b[0]).map(([b, c]) => [b * iv, c[0] / c[1]]) }));
  }
  function atSeries(run, upto, tgNames) {
    const end = Math.min(upto, run.dur);
    let step = 1000;
    while (end / step > 400) step *= 2;
    return tgNames.map((name, gi) => {
      const th = run.threads.filter((t) => t.tgi === gi);
      const pts = [];
      for (let x = 0; x <= end; x += step) pts.push([x, th.filter((t) => t.start <= x && t.end > x).length]);
      return { name, pts };
    });
  }

  // ---------- тексты View Results Tree ----------
  function samplerText(s) {
    if (s.txn) {
      return [`Thread Name:${s.thr}`, `Sample Start:${wall(s.t)} MSK`, `Load time:${s.e}`, 'Connect Time:0', 'Latency:0', `Size in bytes:${s.by}`, `Sent bytes:${s.sb}`, 'Sample Count:1', `Error Count:${s.ok ? 0 : 1}`, `Response code:${s.code}`, `Response message:${s.msg}`].join('\n');
    }
    const lines = [`Thread Name:${s.thr}`, `Sample Start:${wall(s.t)} MSK`, `Load time:${s.e}`, `Connect Time:${s.ct}`, `Latency:${s.lat}`, `Size in bytes:${s.by}`, `Sent bytes:${s.sb}`, `Headers size in bytes:${(s.resHead || '').length}`, `Body size in bytes:${bytes(s.body)}`, 'Sample Count:1', `Error Count:${s.ok ? 0 : 1}`, 'Data type ("text"|"bin"|""):text', `Response code:${s.code}`, `Response message:${s.msg}`, '', 'HTTPSampleResult fields:', `ContentType: ${s.ctype || ''}`, 'DataEncoding: UTF-8'];
    s.fails.forEach((f) => lines.push('', `Assertion: ${f.name}`, 'Assertion error:false', 'Assertion failure:true', `Assertion failure message:${f.msg}`));
    return lines.join('\n');
  }
  const requestText = (s) => (s.txn ? 'Transaction Controller: запрос не отправлялся, это суммарный сэмпл дочерних запросов.' : `${s.method} ${s.url}\n\n${s.method} data:\n${s.reqBody || ''}\n\n${s.cookie ? 'Cookie Data:\n' + s.cookie : '[no cookies]'}\n`);
  const reqHeadText = (s) => (s.reqHead || []).map(([k, v]) => `${k}: ${v}`).join('\n');

  // ---------- HTML-отчёт (dashboard) ----------
  function dashboard(run, meta) {
    const list = run.samples;
    const tot = stats(list) || stats([{ e: 0, ok: true, by: 0, sb: 0, t: 0 }]);
    const rows = byLabel(list);
    const apdex = (l) => { let s = 0, t = 0; l.forEach((x) => { if (!x.ok) return; if (x.e <= 500) s++; else if (x.e <= 1500) t++; }); return l.length ? (s + t / 2) / l.length : 0; };
    const fails = list.filter((s) => !s.ok);
    const errs = new Map();
    fails.forEach((s) => { const k = s.fails.length && typeof s.code === 'number' && s.code < 400 ? `Assertion failed: ${s.fails[0].name}` : `${s.code}/${s.msg}`; errs.set(k, (errs.get(k) || 0) + 1); });
    const okN = list.length - fails.length;
    const frac = list.length ? okN / list.length : 1;
    const C = 2 * Math.PI * 40;
    const donut = `<svg viewBox="0 0 100 100" class="jm-donut" role="img" aria-label="Requests Summary"><circle cx="50" cy="50" r="40" stroke="#d62728" stroke-width="18" fill="none"/><circle cx="50" cy="50" r="40" stroke="#4caf50" stroke-width="18" fill="none" stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 50 50)"/></svg>`;
    const statRow = (label, st, l) => `<tr${label === 'Total' ? ' class="total"' : ''}><td>${esc(label)}</td><td>${st.n}</td><td>${st.errN}</td><td>${fPct(st.err)}</td><td>${st.avg.toFixed(2)}</td><td>${f0(st.min)}</td><td>${f0(st.max)}</td><td>${st.med.toFixed(2)}</td><td>${st.p90.toFixed(2)}</td><td>${st.p95.toFixed(2)}</td><td>${st.p99.toFixed(2)}</td><td>${st.tput.toFixed(2)}</td><td>${st.rkb.toFixed(2)}</td><td>${st.skb.toFixed(2)}</td></tr>${void l || ''}`;
    return `<div class="jm-dash">
      <header class="jm-dash-top"><b>Apache JMeter Dashboard</b><span>${esc(meta.dir)}/index.html</span></header>
      <section><h4>Test and Report information</h4><table class="jm-table kv"><tbody>
        <tr><td>Source file</td><td>"${esc(meta.jtl)}"</td></tr><tr><td>Start Time</td><td>"${wall(0)}"</td></tr><tr><td>End Time</td><td>"${wall(run.dur)}"</td></tr><tr><td>Filter for display</td><td>""</td></tr></tbody></table></section>
      <div class="jm-dash-row">
        <section><h4>APDEX (Application Performance Index)</h4><table class="jm-table"><thead><tr><th>Apdex</th><th>T (Toleration threshold)</th><th>F (Frustration threshold)</th><th>Label</th></tr></thead><tbody>
          <tr class="total"><td>${apdex(list).toFixed(3)}</td><td>500 ms</td><td>1 sec 500 ms</td><td>Total</td></tr>${rows.map((r) => `<tr><td>${apdex(r.list).toFixed(3)}</td><td>500 ms</td><td>1 sec 500 ms</td><td>${esc(r.label)}</td></tr>`).join('')}</tbody></table></section>
        <section class="jm-dash-pie"><h4>Requests Summary</h4>${donut}<p><i class="ok"></i>OK ${(frac * 100).toFixed(2)}% <i class="ko"></i>KO ${((1 - frac) * 100).toFixed(2)}%</p></section>
      </div>
      <section><h4>Statistics</h4><div class="jm-tablewrap"><table class="jm-table" data-table="dash-stats"><thead><tr><th>Label</th><th>#Samples</th><th>FAIL</th><th>Error %</th><th>Average</th><th>Min</th><th>Max</th><th>Median</th><th>90th pct</th><th>95th pct</th><th>99th pct</th><th>Transactions/s</th><th>Received</th><th>Sent</th></tr></thead><tbody>
        ${statRow('Total', tot)}${rows.map((r) => statRow(r.label, r.st)).join('')}</tbody></table></div></section>
      <section><h4>Errors</h4><div class="jm-tablewrap"><table class="jm-table"><thead><tr><th>Type of error</th><th>Number of errors</th><th>% in errors</th><th>% in all samples</th></tr></thead><tbody>
        ${errs.size ? [...errs.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><td>${esc(k)}</td><td>${n}</td><td>${fPct(n / fails.length)}</td><td>${fPct(n / list.length)}</td></tr>`).join('') : '<tr><td colspan="4">Нет ошибок</td></tr>'}</tbody></table></div></section>
      <div class="jm-dash-charts"><section><h4>Response Times Over Time</h4>${lineChart(rtSeries(list, 1000), { title: 'Response Times Over Time', y: 'Response time (ms)' })}</section>
      <section><h4>Active Threads Over Time</h4>${lineChart(atSeries(run, run.dur, run.tgs.map((t) => t.name)), { title: 'Active Threads Over Time', y: 'Active threads' })}</section></div>
    </div>`;
  }

  // ---------- JMX (упрощённый XML для cat plan.jmx) ----------
  const JMX_CLASS = { testplan: 'TestPlan', threadgroup: 'ThreadGroup', http: 'HTTPSamplerProxy', once: 'OnceOnlyController', txn: 'TransactionController', loopc: 'LoopController', headers: 'HeaderManager', cookies: 'CookieManager', csv: 'CSVDataSet', udv: 'Arguments', defaults: 'ConfigTestElement', ctimer: 'ConstantTimer', urtimer: 'UniformRandomTimer', cttimer: 'ConstantThroughputTimer', rassert: 'ResponseAssertion', dassert: 'DurationAssertion', jassert: 'JSONPathAssertion', jextract: 'JSONPostProcessor', rextract: 'RegexExtractor', vrt: 'ResultCollector', summary: 'ResultCollector', aggregate: 'ResultCollector', rtgraph: 'ResultCollector', atgraph: 'kg.apc.jmeter.vizualizers.CorrectedResultCollector' };
  function jmx(plan) {
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', `<jmeterTestPlan version="1.2" properties="5.0" jmeter="${VERSION}">`, '  <hashTree>'];
    const rec = (e, d) => {
      const ind = '  '.repeat(d);
      const props = Object.entries(e.p).filter(([, v]) => v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${ind}  <stringProp name="${k}">${esc(Array.isArray(v) ? v.map((r) => r.join('=')).join('; ') : v)}</stringProp>`);
      out.push(`${ind}<${JMX_CLASS[e.type]} testname="${esc(e.name)}" enabled="${e.enabled}">`, ...props, `${ind}</${JMX_CLASS[e.type]}>`, `${ind}<hashTree>`);
      e.children.forEach((c) => rec(c, d + 1));
      out.push(`${ind}</hashTree>`);
    };
    rec(plan, 2);
    out.push('  </hashTree>', '</jmeterTestPlan>');
    return out.join('\n');
  }

  // ---------- редакторы элементов (правая панель) ----------
  const inp = (e, k, label, o) => { o = o || {}; return `<label class="jm-f${o.wide ? ' wide' : ''}"><span>${label}</span><input type="text" data-p="${k}" value="${esc(e.p[k])}"${o.dis ? ' disabled' : ''} spellcheck="false" autocomplete="off"${o.ph ? ` placeholder="${esc(o.ph)}"` : ''}></label>`; };
  const chk = (e, k, label, o) => `<label class="jm-c"><input type="checkbox" data-p="${k}"${e.p[k] ? ' checked' : ''}${o && o.dis ? ' disabled' : ''}> ${label}</label>`;
  const sel = (e, k, label, opts) => `<label class="jm-f"><span>${label}</span><select data-p="${k}">${opts.map(([v, t]) => `<option value="${v}"${e.p[k] === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  const radios = (e, k, opts) => `<div class="jm-radios">${opts.map(([v, t]) => `<label class="jm-c"><input type="radio" name="r-${e.id}-${k}" data-p="${k}" value="${v}"${e.p[k] === v ? ' checked' : ''}> ${t}</label>`).join('')}</div>`;
  const fs = (legend, body) => `<fieldset class="jm-fs"><legend>${legend}</legend>${body}</fieldset>`;
  function table(e, k, cols) {
    const rows = e.p[k] || [];
    return `<div class="jm-tbl"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}<th aria-label="Delete"></th></tr></thead><tbody>${rows.map((r, i) => `<tr>${cols.map((c, j) => `<td><input type="text" data-tbl="${k}" data-r="${i}" data-c="${j}" value="${esc(r[j] || '')}" spellcheck="false" autocomplete="off" aria-label="${esc(c)}"></td>`).join('')}<td><button type="button" class="jm-x" data-tdel="${k}" data-r="${i}" title="Delete">✕</button></td></tr>`).join('') || `<tr class="empty"><td colspan="${cols.length + 1}">&nbsp;</td></tr>`}</tbody></table><div class="jm-tbl-btns"><button type="button" class="jm-btn" data-tadd="${k}" data-n="${cols.length}">Add</button></div></div>`;
  }
  const fileFs = (e) => fs('Write results to file / Read from file', `<div class="jm-row">${inp(e, 'file', 'Filename', { wide: true })}<button type="button" class="jm-btn" disabled>Browse…</button></div>`);
  function editor(e, ui) {
    const P = e.p;
    switch (e.type) {
      case 'testplan': return fs('User Defined Variables', table(e, 'vars', ['Name:', 'Value'])) + `<label class="jm-c"><input type="checkbox" disabled> Run Thread Groups consecutively (i.e. one at a time)</label><label class="jm-c"><input type="checkbox" disabled> Functional Test Mode (i.e. save Response Data and Sampler Data)</label>`;
      case 'threadgroup': return fs('Action to be taken after a Sampler error', radios(e, 'onError', [['continue', 'Continue'], ['nextloop', 'Start Next Thread Loop'], ['stopthread', 'Stop Thread'], ['stoptest', 'Stop Test'], ['stopnow', 'Stop Test Now']])) +
        fs('Thread Properties', inp(e, 'threads', 'Number of Threads (users):') + inp(e, 'rampup', 'Ramp-up period (seconds):') +
          `<div class="jm-row"><span class="jm-lbl">Loop Count:</span>${chk(e, 'infinite', 'Infinite')}<input type="text" data-p="loops" value="${esc(P.infinite ? '-1' : P.loops)}" aria-label="Loop Count"${P.infinite ? ' disabled' : ''} class="jm-short"></div>` +
          '<label class="jm-c"><input type="checkbox" checked disabled> Same user on each iteration</label><label class="jm-c"><input type="checkbox" disabled> Delay Thread creation until needed</label>' +
          chk(e, 'lifetime', 'Specify Thread lifetime') + inp(e, 'duration', 'Duration (seconds):', { dis: !P.lifetime }) + inp(e, 'delay', 'Startup delay (seconds):', { dis: !P.lifetime }));
      case 'http': {
        const tab = ui.httpTab[e.id] || (P.body.trim() ? 'body' : 'params');
        return fs('Web Server', `<div class="jm-grid3">${inp(e, 'protocol', 'Protocol [http]:')}${inp(e, 'host', 'Server Name or IP:')}${inp(e, 'port', 'Port Number:')}</div>`) +
          fs('HTTP Request', `<div class="jm-row">${sel(e, 'method', 'Method:', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => [m, m]))}${inp(e, 'path', 'Path:', { wide: true })}</div>
            <div class="jm-row jm-mute"><label class="jm-c"><input type="checkbox" disabled> Redirect Automatically</label><label class="jm-c"><input type="checkbox" checked disabled> Follow Redirects</label><label class="jm-c"><input type="checkbox" checked disabled> Use KeepAlive</label></div>
            <div class="jm-ptabs" role="tablist"><button type="button" data-ptab="params" class="${tab === 'params' ? 'on' : ''}">Parameters</button><button type="button" data-ptab="body" class="${tab === 'body' ? 'on' : ''}">Body Data</button><button type="button" disabled>Files Upload</button></div>
            <div class="jm-ptab">${tab === 'params' ? table(e, 'params', ['Name', 'Value']) : `<textarea data-p="body" rows="7" spellcheck="false" aria-label="Body Data">${esc(P.body)}</textarea>`}</div>`);
      }
      case 'headers': return fs('Headers Stored in the Header Manager', table(e, 'list', ['Name', 'Value']));
      case 'cookies': return fs('Options', chk(e, 'clearEach', 'Clear cookies each iteration?') + sel(e, 'policy', 'Cookie Policy:', [['standard', 'standard'], ['compatibility', 'compatibility'], ['netscape', 'netscape']])) + fs('User-Defined Cookies', '<p class="jm-mute">Куки, которые сервер присылает в Set-Cookie, менеджер хранит отдельно для каждого потока и сам отправляет в следующих запросах.</p>');
      case 'csv': return fs('Configure the CSV Data Source', `<div class="jm-row">${inp(e, 'file', 'Filename:', { wide: true })}<button type="button" class="jm-btn" data-browse>Browse…</button></div>` +
        inp(e, 'enc', 'File encoding:') + inp(e, 'names', 'Variable Names (comma-delimited):', { wide: true }) + sel(e, 'ignoreFirst', 'Ignore first line (only used if Variable Names is not empty):', [['False', 'False'], ['True', 'True']]) +
        inp(e, 'delim', 'Delimiter (use \'\\t\' for tab):') + '<label class="jm-f"><span>Allow quoted data?:</span><select disabled><option>False</option></select></label>' +
        sel(e, 'recycle', 'Recycle on EOF ?:', [['True', 'True'], ['False', 'False']]) + sel(e, 'stopThread', 'Stop thread on EOF ?:', [['False', 'False'], ['True', 'True']]) +
        sel(e, 'share', 'Sharing mode:', [['all', 'All threads'], ['group', 'Current thread group'], ['thread', 'Current thread']]));
      case 'udv': return fs('User Defined Variables', table(e, 'vars', ['Name:', 'Value']));
      case 'defaults': return fs('Web Server', `<div class="jm-grid3">${inp(e, 'protocol', 'Protocol [http]:')}${inp(e, 'host', 'Server Name or IP:')}${inp(e, 'port', 'Port Number:')}</div>`);
      case 'once': return '';
      case 'txn': return chk(e, 'parent', 'Generate parent sample') + chk(e, 'timers', 'Include duration of timer and pre-post processors in generated sample');
      case 'loopc': return `<div class="jm-row"><span class="jm-lbl">Loop Count:</span>${chk(e, 'infinite', 'Infinite')}<input type="text" data-p="loops" value="${esc(P.infinite ? '-1' : P.loops)}" aria-label="Loop Count"${P.infinite ? ' disabled' : ''} class="jm-short"></div>`;
      case 'ctimer': return fs('Thread Delay Properties', inp(e, 'delay', 'Thread Delay (in milliseconds):'));
      case 'urtimer': return fs('Thread Delay Properties', inp(e, 'range', 'Random Delay Maximum (in milliseconds):') + inp(e, 'offset', 'Constant Delay Offset (in milliseconds):'));
      case 'cttimer': return fs('Delay before each affected sampler', inp(e, 'tput', 'Target throughput (in samples per minute):') + sel(e, 'mode', 'Calculate Throughput based on:', [['this', 'this thread only'], ['all', 'all active threads'], ['tg', 'all active threads in current thread group'], ['allShared', 'all active threads (shared)'], ['tgShared', 'all active threads in current thread group (shared)']]));
      case 'rassert': return fs('Apply to:', '<label class="jm-c"><input type="radio" checked disabled> Main sample only</label>') +
        fs('Field to Test', radios(e, 'field', [['text', 'Text Response'], ['code', 'Response Code'], ['message', 'Response Message'], ['headers', 'Response Headers'], ['url', 'URL Sampled']])) +
        fs('Pattern Matching Rules', `<div class="jm-row">${radios(e, 'rule', [['contains', 'Contains'], ['matches', 'Matches'], ['equals', 'Equals'], ['substring', 'Substring']])}${chk(e, 'not', 'Not')}${chk(e, 'or', 'Or')}</div>`) +
        fs('Patterns to Test', table(e, 'patterns', ['Patterns to Test'])) + fs('Custom failure message', inp(e, 'msg', '', { wide: true }));
      case 'dassert': return fs('Duration to Assert', inp(e, 'duration', 'Duration in milliseconds:'));
      case 'jassert': return inp(e, 'path', 'Assert JSON Path exists:', { wide: true }) + chk(e, 'validate', 'Additionally assert value') + chk(e, 'regex', 'Match as regular expression') + inp(e, 'expected', 'Expected Value:', { wide: true }) + chk(e, 'expectNull', 'Expect null') + chk(e, 'invert', 'Invert assertion (will fail if above conditions met)');
      case 'jextract': return fs('Apply to:', '<label class="jm-c"><input type="radio" checked disabled> Main sample only</label>') + inp(e, 'ref', 'Names of created variables:', { wide: true }) + inp(e, 'path', 'JSON Path expressions:', { wide: true }) + inp(e, 'match', 'Match No. (0 for Random):') + inp(e, 'def', 'Default Values:', { wide: true });
      case 'rextract': return fs('Field to check', radios(e, 'field', [['body', 'Body'], ['headers', 'Response Headers'], ['url', 'URL'], ['code', 'Response Code']])) +
        inp(e, 'ref', 'Name of created variable:', { wide: true }) + inp(e, 'regex', 'Regular Expression:', { wide: true }) + inp(e, 'template', 'Template ($i$ where i is capturing group number, starts at 1):', { wide: true }) + inp(e, 'match', 'Match No. (0 for Random):') + inp(e, 'def', 'Default Value:', { wide: true });
      case 'vrt': return fileFs(e) + `<div class="jm-row"><span class="jm-lbl">Log/Display Only:</span>${chk(e, 'errors', 'Errors')}${chk(e, 'successes', 'Successes')}</div>`;
      case 'summary': case 'aggregate': return fileFs(e);
      case 'rtgraph': return fs('Settings', inp(e, 'interval', 'Interval (ms):'));
      case 'atgraph': return '';
      default: return '';
    }
  }

  // ---------- симулятор ----------
  let GEN = 0;
  function buildSim(el, ctx, level) {
    const gen = ++GEN;
    const alive = () => gen === GEN && el.isConnected && el.contains(root);
    const emit = (ev) => { if (gen === GEN) ctx.emit(ev); };
    const setup = level.setup || {};
    const st = ctx.state;
    const plan = setup.plan ? reId(setup.plan()) : E('testplan');
    Object.assign(st, { plan, runs: [], fs: Object.assign({}, FILES), saved: null, reports: {}, log: [], term: [], mark: { r: 0, at: -1 }, cliBusy: false });
    const ui = { sel: plan.id, app: 'gui', menu: null, clip: null, marks: {}, vrt: {}, vrtFlat: {}, httpTab: {}, dlg: null, logOpen: false, play: null, report: null };

    el.innerHTML = `
      <div class="jm">
        <div class="jm-apptabs" role="tablist">
          <button type="button" data-app="gui" class="on">🗿 JMeter</button>
          <button type="button" data-app="term">▮ Терминал</button>
          <button type="button" data-app="report" hidden>📄 report/index.html</button>
          <button type="button" data-app="api">📘 Стенд</button>
        </div>
        <div class="jm-gui" data-pane="gui">
          <div class="jm-titlebar"></div>
          <div class="jm-menubar" role="menubar">${['File', 'Edit', 'Search', 'Run', 'Options', 'Tools', 'Help'].map((m) => `<button type="button" data-mbar="${m}">${m}</button>`).join('')}</div>
          <div class="jm-toolbar">
            <button type="button" data-cmd="add" title="Add">➕<span>Add</span></button>
            <button type="button" data-cmd="save" title="Save (Ctrl+S)">💾<span>Save</span></button>
            <i class="jm-sep"></i>
            <button type="button" data-cmd="cut" title="Cut (Ctrl+X)">✂<span>Cut</span></button>
            <button type="button" data-cmd="copy" title="Copy (Ctrl+C)">⧉<span>Copy</span></button>
            <button type="button" data-cmd="paste" title="Paste (Ctrl+V)">📋<span>Paste</span></button>
            <button type="button" data-cmd="toggle" title="Toggle (Ctrl+T)">⏯<span>Toggle</span></button>
            <i class="jm-sep"></i>
            <button type="button" data-cmd="start" class="jm-go" title="Start (Ctrl+R)">▶<span>Start</span></button>
            <button type="button" data-cmd="startnp" class="jm-go" title="Start no pauses">▷<span>No pauses</span></button>
            <button type="button" data-cmd="stop" class="jm-stop" title="Stop (Ctrl+.)">■<span>Stop</span></button>
            <button type="button" data-cmd="shutdown" class="jm-stop" title="Shutdown (Ctrl+,)">⏻<span>Shutdown</span></button>
            <i class="jm-sep"></i>
            <button type="button" data-cmd="clear" title="Clear">🧹<span>Clear</span></button>
            <button type="button" data-cmd="clearall" title="Clear All (Ctrl+E)">🧽<span>Clear All</span></button>
            <span class="jm-status"></span>
          </div>
          <div class="jm-main">
            <div class="jm-tree" tabindex="0" aria-label="Test Plan tree"></div>
            <div class="jm-panel"></div>
          </div>
          <div class="jm-logview" hidden></div>
          <div class="jm-menu" hidden></div>
          <div class="jm-dlg" hidden></div>
        </div>
        <div class="jm-termpane" data-pane="term" hidden>
          <div class="jm-term"><pre class="jm-tout" aria-live="polite"></pre>
            <label class="jm-tin"><span>qa@loadgen:~/tests$</span><input type="text" spellcheck="false" autocomplete="off" aria-label="Команда терминала"></label></div>
        </div>
        <div class="jm-reportpane" data-pane="report" hidden></div>
        <div class="jm-apipane" data-pane="api" hidden></div>
      </div>`;
    const $ = (s) => el.querySelector(s);
    const root = $('.jm'); // слушатели — на свежем корне: контейнер el переиспользуется между уровнями
    const gui = $('.jm-gui');
    const treeEl = $('.jm-tree');
    const panelEl = $('.jm-panel');
    const menuEl = $('.jm-menu');
    const dlgEl = $('.jm-dlg');
    const statusEl = $('.jm-status');
    const logEl = $('.jm-logview');
    const tout = $('.jm-tout');
    const tin = $('.jm-tin input');

    const cur = () => byId(plan, ui.sel) || plan;
    const isListener = (e) => kindOf(e) === 'listener';
    function log(level0, msg, vt) {
      const t = vt == null ? (ui.play ? ui.play.vt : 0) : vt;
      st.log.push({ level: level0, msg, t });
      if (level0 !== 'INFO') st.warnN = (st.warnN || 0) + 1;
      if (ui.logOpen) renderLog();
      renderStatus();
    }
    const dirty = () => !st.saved || st.saved.json !== JSON.stringify(plan);
    function changed() { renderTitle(); emit({ type: 'plan' }); }

    // ---------- отрисовка ----------
    function renderTitle() {
      const name = st.saved ? st.saved.name : 'Test Plan.jmx';
      $('.jm-titlebar').textContent = `${name}${dirty() ? ' *' : ''} (${HOME}/${name}) - Apache JMeter (${VERSION})`;
    }
    function playState() {
      const p = ui.play;
      const run = p ? p.run : st.runs.filter((r) => r.gui).pop();
      if (!run) return { vt: 0, act: 0, total: 0, on: false };
      const vt = p ? p.vt : run.dur;
      const started = run.threads.filter((t) => t.start <= vt);
      return { vt, act: p ? started.filter((t) => t.end > vt).length : 0, total: started.length, on: !!p };
    }
    function renderStatus() {
      const s = playState();
      statusEl.innerHTML = `<span class="jm-clock" title="Elapsed time">${hms(s.vt)}</span><button type="button" class="jm-warn${st.warnN ? ' has' : ''}" data-cmd="log" title="Warnings / Errors — Log Viewer">⚠ ${st.warnN || 0}</button><span class="jm-act" title="Active threads / started threads"><i class="${s.on ? 'on' : ''}"></i><b>${s.act}/${s.total}</b></span>`;
    }
    function renderTree() {
      const rec = (e, d, off) => {
        const o2 = off || !e.enabled;
        return `<button type="button" class="jm-node${e.id === ui.sel ? ' sel' : ''}${o2 ? ' off' : ''}" data-node="${e.id}" style="--d:${d}" aria-pressed="${e.id === ui.sel}"><span class="ic" aria-hidden="true">${T[e.type].icon}</span><span class="nm">${esc(e.name)}</span></button>${e.children.map((c) => rec(c, d + 1, o2)).join('')}`;
      };
      treeEl.innerHTML = rec(plan, 0, false);
    }
    function renderPanel() {
      const e = cur();
      panelEl.innerHTML = `<h3 class="jm-ptitle">${T[e.type].label}</h3>
        <label class="jm-f wide"><span>Name:</span><input type="text" data-f="name" value="${esc(e.name)}" spellcheck="false" autocomplete="off"></label>
        <label class="jm-f wide"><span>Comments:</span><input type="text" data-f="comment" value="${esc(e.comment)}" spellcheck="false" autocomplete="off"></label>
        ${e.enabled ? '' : '<p class="jm-disabled-note">Элемент отключён (Disable) — при запуске он и всё, что внутри, пропускаются.</p>'}
        ${editor(e, ui)}${isListener(e) ? '<div class="jm-res"></div>' : ''}`;
      if (isListener(e)) renderResults();
    }

    // Сэмплы, видимые слушателю: прогоны в GUI после последнего Clear, в области действия слушателя.
    function visible(lst) {
      const m1 = st.mark;
      const m2 = ui.marks[lst.id] || { r: 0, at: -1 };
      const m = m2.r > m1.r || (m2.r === m1.r && m2.at > m1.at) ? m2 : m1;
      const par = parentOf(plan, lst.id);
      const pid = par && par !== plan ? par.id : null;
      const out = [];
      st.runs.forEach((r, ri) => {
        if (!r.gui || ri < m.r || !r.listeners.has(lst.id)) return;
        const lim = ui.play && ui.play.run === r ? ui.play.vt : Infinity;
        for (const s of r.samples) {
          if (s.at > lim) break;
          if (ri === m.r && s.at <= m.at) continue;
          if (pid && !s.node.anc.has(pid)) continue;
          out.push(s);
        }
      });
      return out;
    }
    function renderResults() {
      const e = cur();
      const box = panelEl.querySelector('.jm-res');
      if (!box || !isListener(e)) return;
      const list = visible(e);
      if (e.type === 'summary') box.innerHTML = summaryTable(list);
      else if (e.type === 'aggregate') box.innerHTML = aggregateTable(list);
      else if (e.type === 'rtgraph') box.innerHTML = lineChart(rtSeries(list, int(e.p.interval, 1000)), { title: 'Response Time Graph', y: 'Response time (ms)' });
      else if (e.type === 'atgraph') {
        const runs = st.runs.filter((r) => r.gui && r.listeners.has(e.id));
        const r = runs.pop();
        box.innerHTML = r && list.length ? lineChart(atSeries(r, ui.play && ui.play.run === r ? ui.play.vt : r.dur, r.tgs.map((t) => t.name)), { title: 'Active Threads Over Time', y: 'Number of active threads' }) : lineChart([], {});
      } else if (e.type === 'vrt') renderVrt(e, box, list);
    }
    function renderVrt(e, box, list) {
      const keepL = box.querySelector('.jm-vlist');
      const sl = keepL ? keepL.scrollTop : 0;
      const keepD = box.querySelector('.jm-vbody');
      const sd = keepD ? keepD.scrollTop : 0;
      let shown = list;
      if (e.p.errors && !e.p.successes) shown = list.filter((s) => !s.ok);
      else if (e.p.successes && !e.p.errors) shown = list.filter((s) => s.ok);
      const flat = [];
      shown.slice(0, VRT_ROWS).forEach((s) => { flat.push({ s, d: 0 }); if (s.kids) s.kids.forEach((k) => flat.push({ s: k, d: 1 })); });
      ui.vrtFlat[e.id] = flat;
      const vs = ui.vrt[e.id] || {};
      const selS = vs.s;
      const tab = vs.tab || 'sampler';
      let detail = '<div class="jm-empty">Выбери сэмпл слева.</div>';
      if (selS) {
        let body;
        if (tab === 'sampler') body = `<pre>${esc(samplerText(selS))}</pre>`;
        else if (tab === 'request') body = `<p class="jm-sub">Request Body</p><pre>${esc(requestText(selS))}</pre><p class="jm-sub">Request Headers</p><pre>${esc(reqHeadText(selS))}</pre>`;
        else body = `<p class="jm-sub">Response Body</p><pre>${esc(selS.body || '')}</pre><p class="jm-sub">Response Headers</p><pre>${esc(selS.resHead || '')}</pre>`;
        detail = `<div class="jm-vtabs" role="tablist">${[['sampler', 'Sampler result'], ['request', 'Request'], ['response', 'Response data']].map(([k, t]) => `<button type="button" data-vtab="${k}" class="${tab === k ? 'on' : ''}">${t}</button>`).join('')}</div><div class="jm-vbody">${body}</div>`;
      }
      box.innerHTML = `<div class="jm-vrt">
        <div class="jm-vleft"><div class="jm-vhead"><select disabled aria-label="Renderer"><option>Text</option></select></div>
          <div class="jm-vlist">${flat.map((f, i) => `<button type="button" class="jm-vrow ${f.s.ok ? 'ok' : 'ko'}${f.s === selS ? ' sel' : ''}" data-vi="${i}" style="--d:${f.d}"><span aria-hidden="true">${f.s.ok ? '✔' : '✖'}</span>${esc(f.s.label)}</button>`).join('') || '<div class="jm-empty">Пусто. Запусти тест (▶ Start).</div>'}
          ${shown.length > VRT_ROWS ? `<div class="jm-empty">… и ещё ${shown.length - VRT_ROWS} сэмплов</div>` : ''}</div></div>
        <div class="jm-vright">${detail}</div></div>`;
      const nl = box.querySelector('.jm-vlist');
      if (nl) nl.scrollTop = sl;
      const nd = box.querySelector('.jm-vbody');
      if (nd) nd.scrollTop = sd;
    }
    function renderLog() {
      logEl.hidden = !ui.logOpen;
      if (!ui.logOpen) return;
      logEl.innerHTML = `<div class="jm-loghead"><b>Log Viewer</b><button type="button" class="jm-btn" data-cmd="log">✕</button></div><pre>${esc(st.log.map((l) => `${wall(l.t)},${pad0(Math.floor(l.t) % 1000, 3)} ${l.level.padEnd(5)} ${l.msg}`).join('\n')) || ' '}</pre>`;
      const pre = logEl.querySelector('pre');
      pre.scrollTop = pre.scrollHeight;
    }

    // ---------- меню (каскадное, как контекстное меню JMeter) ----------
    function openMenu(items, x, y) {
      ui.menu = { cols: [{ items, open: -1 }], x, y };
      renderMenu();
    }
    function closeMenu() { ui.menu = null; menuEl.hidden = true; menuEl.innerHTML = ''; }
    function renderMenu() {
      const m = ui.menu;
      if (!m) { closeMenu(); return; }
      menuEl.hidden = false;
      const w = gui.clientWidth;
      menuEl.style.left = Math.max(4, Math.min(m.x, w - 220)) + 'px';
      menuEl.style.top = m.y + 'px';
      menuEl.innerHTML = m.cols.map((c, ci) => `<ul class="jm-mcol" role="menu">${c.items.map((it, ii) => (it.sep ? '<li class="sep" role="separator"></li>'
        : `<li><button type="button" role="menuitem" data-mi="${ci}:${ii}" class="${it.sub ? 'sub' : ''}${c.open === ii ? ' open' : ''}"${it.disabled ? ' disabled' : ''}><span>${esc(it.label)}</span>${it.key ? `<kbd>${it.key}</kbd>` : ''}${it.sub ? '<b>▸</b>' : ''}</button></li>`)).join('')}</ul>`).join('');
    }
    function menuPick(ci, ii, hover) {
      const m = ui.menu;
      if (!m || !m.cols[ci]) return;
      const it = m.cols[ci].items[ii];
      if (!it || it.sep || it.disabled) return;
      if (it.sub) {
        if (hover && m.cols[ci].open === ii) return;
        m.cols = m.cols.slice(0, ci + 1);
        m.cols[ci].open = ii;
        m.cols.push({ items: it.sub(), open: -1 });
        renderMenu();
      } else if (!hover) { closeMenu(); it.cmd(); }
    }
    function addItems(e) {
      const cats = catsFor(e);
      if (!cats.length) return [{ label: `${T[e.type].label} не может содержать элементы`, disabled: true }];
      return CATS.filter(([c]) => cats.includes(c)).map(([c, label]) => ({ label, sub: () => Object.keys(T).filter((t) => T[t].cat === c).map((t) => ({ label: T[t].label, cmd: () => addEl(e, t) })) }));
    }
    function nodeItems(e) {
      const root = e === plan;
      const items = [];
      if (catsFor(e).length) items.push({ label: 'Add', sub: () => addItems(e) }, { sep: true });
      items.push(
        { label: 'Cut', key: 'Ctrl+X', disabled: root, cmd: () => cut(e) },
        { label: 'Copy', key: 'Ctrl+C', disabled: root, cmd: () => copy(e) },
        { label: 'Paste', key: 'Ctrl+V', disabled: !ui.clip, cmd: () => paste(e) },
        { label: 'Duplicate', key: 'Ctrl+Shift+C', disabled: root, cmd: () => dup(e) },
        { label: 'Remove', key: 'Delete', disabled: root, cmd: () => remove(e) },
        { sep: true },
        { label: 'Move Up', disabled: root, cmd: () => move(e, -1) },
        { label: 'Move Down', disabled: root, cmd: () => move(e, 1) },
        { sep: true },
        { label: e.enabled ? 'Disable' : 'Enable', key: 'Ctrl+T', disabled: root, cmd: () => toggle(e) });
      return items;
    }
    const MBAR = {
      File: () => [{ label: 'Save', key: 'Ctrl+S', cmd: () => cmd('save') }, { label: 'Save Test Plan as…', key: 'Ctrl+Shift+S', cmd: () => cmd('saveas') }, { sep: true }, { label: 'Exit', disabled: true }],
      Edit: () => nodeItems(cur()),
      Search: () => [{ label: 'Search', disabled: true }, { label: 'Reset Search', disabled: true }],
      Run: () => [{ label: 'Start', key: 'Ctrl+R', cmd: () => cmd('start') }, { label: 'Start no pauses', cmd: () => cmd('startnp') }, { sep: true }, { label: 'Stop', key: 'Ctrl+.', cmd: () => cmd('stop') }, { label: 'Shutdown', key: 'Ctrl+,', cmd: () => cmd('shutdown') }, { sep: true }, { label: 'Clear', key: 'Ctrl+Shift+E', cmd: () => cmd('clear') }, { label: 'Clear All', key: 'Ctrl+E', cmd: () => cmd('clearall') }],
      Options: () => [{ label: 'Log Viewer', cmd: () => cmd('log') }],
      Tools: () => [{ label: 'Function Helper Dialog', disabled: true }],
      Help: () => [{ label: 'About Apache JMeter', cmd: () => Core.modal(`<h3>Apache JMeter ${VERSION}</h3><p>Copyright © 1999-2024 The Apache Software Foundation</p><button class="btn" id="modal-close" type="button">OK</button>`) }],
    };

    // ---------- операции с деревом ----------
    function select(id) { ui.sel = id; renderTree(); renderPanel(); }
    function addEl(parent, type) {
      const n = E(type);
      parent.children.push(n);
      ui.sel = n.id;
      renderTree(); renderPanel(); changed();
      emit({ type: 'add', el: type });
    }
    function cut(e) {
      if (e === plan) return;
      ui.clip = { el: clone(e), keep: true };
      const par = parentOf(plan, e.id);
      par.children.splice(par.children.indexOf(e), 1);
      ui.sel = par.id;
      renderTree(); renderPanel(); changed();
    }
    function copy(e) { if (e !== plan) ui.clip = { el: clone(e), keep: false }; }
    function paste(target) {
      if (!ui.clip) return;
      const n = ui.clip.keep ? clone(ui.clip.el) : reId(clone(ui.clip.el));
      ui.clip.keep = false;
      if (canHold(target, n)) target.children.push(n);
      else {
        const par = parentOf(plan, target.id);
        if (par && canHold(par, n)) par.children.splice(par.children.indexOf(target) + 1, 0, n);
        else { log('WARN', `o.a.j.g.a.Paste: ${T[n.type].label} нельзя вставить в ${T[target.type].label}`); ui.clip.keep = true; return; }
      }
      ui.sel = n.id;
      renderTree(); renderPanel(); changed();
    }
    function dup(e) {
      if (e === plan) return;
      const par = parentOf(plan, e.id);
      const n = reId(clone(e));
      par.children.splice(par.children.indexOf(e) + 1, 0, n);
      ui.sel = n.id;
      renderTree(); renderPanel(); changed();
    }
    function remove(e) {
      if (e === plan) return;
      const par = parentOf(plan, e.id);
      par.children.splice(par.children.indexOf(e), 1);
      ui.sel = par.id;
      renderTree(); renderPanel(); changed();
    }
    function move(e, d) {
      const par = parentOf(plan, e.id);
      if (!par) return;
      const i = par.children.indexOf(e);
      const j = i + d;
      if (j < 0 || j >= par.children.length) return;
      par.children.splice(i, 1);
      par.children.splice(j, 0, e);
      renderTree(); changed();
    }
    function toggle(e) {
      if (e === plan) return;
      e.enabled = !e.enabled;
      renderTree(); renderPanel(); changed();
      emit({ type: 'toggle', el: e.type, enabled: e.enabled });
    }

    // ---------- запуск в GUI ----------
    const playMs = (run) => (window.JM_FAST ? 30 : Math.min(4000, Math.max(900, run.dur / 40)));
    function startGui(noPauses) {
      if (ui.play || st.cliBusy) { log('WARN', 'o.a.j.g.a.Start: тест уже выполняется — дождись окончания или нажми Stop.'); return; }
      const snap = clone(plan);
      const tgs = snap.children.filter((c) => c.type === 'threadgroup' && c.enabled);
      if (!tgs.length) {
        log('WARN', 'o.a.j.e.StandardJMeterEngine: No enabled Thread Group found in Test Plan — нечего запускать.');
        Core.modal('<h3>Нечего запускать</h3><p>В тест-плане нет включённой Thread Group. Добавь её: Test Plan → Add → Threads (Users) → Thread Group.</p><button class="btn" id="modal-close" type="button">OK</button>');
        return;
      }
      const res = simulate(snap, { gui: true, noPauses, server: setup.server, files: st.fs, seed: setup.seed });
      const run = Object.assign(res, { id: st.runs.length + 1, gui: true, plan: snap, listeners: new Set(liveAll(snap, (x) => kindOf(x) === 'listener').map((x) => x.id)), stopped: false, done: false, noPauses: !!noPauses });
      st.runs.push(run);
      log('INFO', 'o.a.j.e.StandardJMeterEngine: Running the test!', 0);
      run.tgs.forEach((t, i) => log('INFO', `o.a.j.t.ThreadGroup: Starting thread group... number=${i + 1} threads=${t.threads} ramp-up=${t.rampup} delayedStart=false`, 0));
      if (!run.listeners.size) log('WARN', 'o.a.j.e.StandardJMeterEngine: в плане нет ни одного включённого слушателя — результаты никуда не попадут.', 0);
      ui.play = { run, vt: 0, t0: performance.now(), dur: playMs(run), warned: 0 };
      emit({ type: 'run-start', run });
      tick();
    }
    function tick() {
      const p = ui.play;
      if (!p) return;
      if (!alive()) { ui.play = null; return; }
      const f = Math.min(1, (performance.now() - p.t0) / p.dur);
      p.vt = f * p.run.dur;
      renderStatus();
      if (isListener(cur())) renderResults();
      if (f >= 1) finish(false);
      else p.timer = setTimeout(tick, 120);
    }
    function finish(stopped) {
      const p = ui.play;
      if (!p) return;
      clearTimeout(p.timer);
      const run = p.run;
      if (stopped) {
        const vt = p.vt;
        run.samples = run.samples.filter((s) => s.at <= vt);
        run.dur = vt;
        run.threads.forEach((t) => { if (t.end > vt) t.end = vt; });
        run.stopped = true;
      }
      run.done = true;
      ui.play = null;
      run.warn.forEach(([lv, m]) => log(lv, m, run.dur));
      log('INFO', `o.a.j.e.StandardJMeterEngine: ${stopped ? 'Stopping test — все потоки остановлены' : 'Notifying test listeners of end of test'}`, run.dur);
      renderStatus();
      if (isListener(cur())) renderResults();
      emit({ type: 'run-end', run });
    }
    function clearAll() {
      st.mark = ui.play ? { r: st.runs.indexOf(ui.play.run), at: ui.play.vt } : { r: st.runs.length, at: -1 };
      ui.vrt = {};
      if (isListener(cur())) renderResults();
      emit({ type: 'clear', all: true });
    }
    function clearOne() {
      const e = cur();
      if (!isListener(e)) return;
      ui.marks[e.id] = ui.play ? { r: st.runs.indexOf(ui.play.run), at: ui.play.vt } : { r: st.runs.length, at: -1 };
      delete ui.vrt[e.id];
      renderResults();
      emit({ type: 'clear', all: false });
    }

    // ---------- диалоги ----------
    function openDlg(d) { ui.dlg = d; renderDlg(); }
    function closeDlg() { ui.dlg = null; dlgEl.hidden = true; dlgEl.innerHTML = ''; }
    function renderDlg() {
      const d = ui.dlg;
      if (!d) { closeDlg(); return; }
      dlgEl.hidden = false;
      const files = Object.keys(st.fs).sort();
      if (d.kind === 'save') {
        dlgEl.innerHTML = `<div class="jm-dbox" role="dialog" aria-label="Save Test Plan as"><div class="jm-dtitle">Save Test Plan as</div>
          <p class="jm-dlook">Look In: <b>${HOME}</b></p>
          <ul class="jm-files">${files.map((f) => `<li>${f.endsWith('.jmx') ? '🗎' : '📄'} ${esc(f)}</li>`).join('')}${Object.keys(st.reports).map((r) => `<li>📁 ${esc(r)}/</li>`).join('')}</ul>
          <label class="jm-f wide"><span>File Name:</span><input type="text" data-dlgin value="${esc(d.name)}" spellcheck="false" autocomplete="off"></label>
          <div class="jm-dbtns"><button type="button" class="jm-btn primary" data-dlg="ok">Save</button><button type="button" class="jm-btn" data-dlg="cancel">Cancel</button></div></div>`;
        const i = dlgEl.querySelector('[data-dlgin]');
        i.focus();
        i.select();
      } else if (d.kind === 'browse') {
        const csvs = files.filter((f) => typeof st.fs[f] === 'string');
        const pick = d.pick || csvs[0];
        dlgEl.innerHTML = `<div class="jm-dbox" role="dialog" aria-label="Open"><div class="jm-dtitle">Open</div>
          <p class="jm-dlook">Look In: <b>${HOME}</b></p>
          <ul class="jm-files pick">${csvs.map((f) => `<li><button type="button" data-file="${esc(f)}" class="${f === pick ? 'on' : ''}">📄 ${esc(f)}</button></li>`).join('')}</ul>
          <pre class="jm-preview">${esc((st.fs[pick] || '').split('\n').slice(0, 6).join('\n'))}…</pre>
          <div class="jm-dbtns"><button type="button" class="jm-btn primary" data-dlg="ok">Open</button><button type="button" class="jm-btn" data-dlg="cancel">Cancel</button></div></div>`;
        d.pick = pick;
      }
    }
    function dlgOk() {
      const d = ui.dlg;
      if (d.kind === 'save') {
        let name = dlgEl.querySelector('[data-dlgin]').value.trim().replace(/^.*\//, '');
        if (!name) return;
        if (!/\.jmx$/i.test(name)) name += '.jmx';
        doSave(name);
        closeDlg();
      } else if (d.kind === 'browse') {
        const e = byId(plan, d.el);
        if (e) e.p.file = d.pick;
        closeDlg();
        renderPanel();
        changed();
      }
    }
    function doSave(name) {
      st.fs[name] = { jmx: clone(plan) };
      st.saved = { name, json: JSON.stringify(plan) };
      log('INFO', `o.a.j.s.SaveService: Saved ${HOME}/${name}`);
      renderTitle();
      emit({ type: 'save', file: name });
    }

    function cmd(c) {
      const e = cur();
      switch (c) {
        case 'save': if (st.saved) doSave(st.saved.name); else openDlg({ kind: 'save', name: 'Test Plan.jmx' }); break;
        case 'saveas': openDlg({ kind: 'save', name: st.saved ? st.saved.name : 'Test Plan.jmx' }); break;
        case 'cut': cut(e); break;
        case 'copy': copy(e); break;
        case 'paste': paste(e); break;
        case 'toggle': toggle(e); break;
        case 'start': startGui(false); break;
        case 'startnp': startGui(true); break;
        case 'stop': case 'shutdown': if (ui.play) finish(true); break;
        case 'clear': clearOne(); break;
        case 'clearall': clearAll(); break;
        case 'log': ui.logOpen = !ui.logOpen; renderLog(); if (ui.logOpen) emit({ type: 'log-open' }); break;
        default: break;
      }
    }

    // ---------- терминал: CLI-режим ----------
    const PROMPT = 'qa@loadgen:~/tests$ ';
    function tprint(s) { String(s).split('\n').forEach((l) => st.term.push(l)); renderTerm(); }
    function renderTerm() {
      tout.textContent = st.term.slice(-400).join('\n');
      tout.scrollTop = tout.scrollHeight;
      tin.disabled = st.cliBusy;
    }
    function tokenize(line) { const out = []; line.replace(/"([^"]*)"|'([^']*)'|(\S+)/g, (m0, a, b, c) => { out.push(a != null ? a : b != null ? b : c); return ''; }); return out; }
    const GUI_WARN = '================================================================================\nDon\'t use GUI mode for load testing !, only for Test creation and Test debugging.\nFor load testing, use CLI Mode (was NON GUI):\n   jmeter -n -t [jmx file] -l [results file] -e -o [Path to web report folder]\n& increase Java Heap to meet your test requirements:\n   Modify current env variable HEAP="-Xms1g -Xmx1g -XX:MaxMetaspaceSize=256m" in the jmeter batch file\nCheck : https://jmeter.apache.org/usermanual/best-practices.html\n================================================================================';
    function exec(line) {
      tprint(PROMPT + line);
      const a = tokenize(line.trim());
      if (!a.length) return;
      const files = () => Object.keys(st.fs).sort().concat(Object.keys(st.reports).map((r) => r + '/'));
      switch (a[0]) {
        case 'help': tprint('Команды: ls, cat <file>, rm [-rf] <path>, pwd, clear,\n  jmeter -n -t <plan.jmx> -l <results.jtl> [-e -o <report-dir>] [-f] [-J<prop>=<value>]\n  jmeter -g <results.jtl> -o <report-dir>\n  jmeter -v'); break;
        case 'clear': st.term = []; renderTerm(); break;
        case 'pwd': tprint(HOME); break;
        case 'ls': tprint(files().join('  ') || ''); break;
        case 'cat': {
          const f = st.fs[a[1]];
          if (!a[1]) tprint('cat: missing operand');
          else if (f == null) tprint(`cat: ${a[1]}: No such file or directory`);
          else if (typeof f === 'string') tprint(f.replace(/\n$/, ''));
          else if (f.jmx) tprint(jmx(f.jmx));
          else if (f.jtl) {
            const r = st.runs.find((x) => x.id === f.jtl);
            tprint(['timeStamp,elapsed,label,responseCode,responseMessage,threadName,success,failureMessage,bytes,sentBytes,allThreads,URL,Latency,Connect']
              .concat(r.samples.slice(0, 25).map((s) => [T0 + Math.round(s.t), s.e, s.label, s.code, s.msg, s.thr, s.ok, s.fails.length ? `"${s.fails[0].msg}"` : '', s.by, s.sb, s.act, s.url || 'null', s.lat, s.ct].join(',')))
              .concat(r.samples.length > 25 ? [`… (${r.samples.length} строк)`] : []).join('\n'));
          }
          break;
        }
        case 'rm': {
          const target = a.filter((x) => !x.startsWith('-'))[1] || a[a.length - 1];
          const t = (target || '').replace(/\/$/, '');
          if (!t || t === 'rm') tprint('rm: missing operand');
          else if (st.reports[t]) { if (!a.some((x) => /^-\w*r/.test(x))) tprint(`rm: cannot remove '${t}': Is a directory`); else delete st.reports[t]; }
          else if (st.fs[t] != null) { delete st.fs[t]; if (st.saved && st.saved.name === t) st.saved = null; renderTitle(); }
          else tprint(`rm: cannot remove '${t}': No such file or directory`);
          break;
        }
        case 'jmeter': jmeterCli(a.slice(1)); break;
        default: tprint(`${a[0]}: command not found`);
      }
    }
    function jmeterCli(args) {
      const o = { J: {} };
      for (let i = 0; i < args.length; i++) {
        const x = args[i];
        if (x === '-n' || x === '--nongui') o.n = true;
        else if (x === '-e' || x === '--reportatendofloadtests') o.e = true;
        else if (x === '-f' || x === '--forceDeleteResultFile') o.f = true;
        else if (x === '-v' || x === '--version') o.v = true;
        else if (['-t', '-l', '-o', '-g'].includes(x)) o[x[1]] = args[++i];
        else if (/^-J/.test(x)) { const kv = x.slice(2); const k = kv.indexOf('='); if (k > 0) o.J[kv.slice(0, k)] = kv.slice(k + 1); }
        else if (/^-[tlog]./.test(x)) o[x[1]] = x.slice(2);
        else { tprint(`Unknown option: ${x}\nUsage: jmeter -n -t <plan.jmx> -l <results.jtl> [-e -o <report-dir>]`); return; }
      }
      if (o.v) { tprint(`    _    ____   _    ____ _   _ _____       _ __  __ _____ _____ _____ ____\n   / \\  |  _ \\ / \\  / ___| | | | ____|     | |  \\/  | ____|_   _| ____|  _ \\\n  / _ \\ | |_) / _ \\| |   | |_| |  _|    _  | | |\\/| |  _|   | | |  _| | |_) |\n / ___ \\|  __/ ___ \\ |___|  _  | |___  | |_| | |  | | |___  | | | |___|  _ <\n/_/   \\_\\_| /_/   \\_\\____|_| |_|_____|  \\___/|_|  |_|_____| |_| |_____|_| \\_\\ ${VERSION}\n\nCopyright (c) 1999-2024 The Apache Software Foundation`); return; }
      if (o.g) {
        const jf = st.fs[o.g];
        if (!jf || !jf.jtl) { tprint(`An error occurred: Cannot read test results file : ${HOME}/${o.g}`); return; }
        if (!o.o) { tprint('Option -g requires -o <output folder>'); return; }
        if (st.reports[o.o] && !o.f) { tprint(`An error occurred: Cannot write to '${HOME}/${o.o}' as folder is not empty`); return; }
        st.reports[o.o] = { run: jf.jtl, jtl: o.g };
        showReportTab(o.o);
        emit({ type: 'report', dir: o.o });
        return;
      }
      if (!o.n) { tprint(GUI_WARN + '\n(GUI уже открыт на вкладке «JMeter». Для нагрузки нужен ключ -n.)'); return; }
      if (!o.t) { tprint('An error occurred: No test plan specified. Use -t <plan.jmx>'); return; }
      const f = st.fs[o.t];
      if (!f || !f.jmx) { tprint(`An error occurred: ${HOME}/${o.t} (No such file or directory)`); return; }
      if (o.e && !o.o) { tprint('Option -e requires -o <output folder> (and -l <results file>)'); return; }
      if (o.e && !o.l) { tprint('Option -e requires -l <results file>'); return; }
      if (o.o && st.reports[o.o] && !o.f) { tprint(`An error occurred: Cannot write to '${HOME}/${o.o}' as folder is not empty`); return; }
      if (ui.play) { tprint('Error: GUI test is running. Stop it first.'); return; }
      const snap = clone(f.jmx);
      if (!snap.children.some((c) => c.type === 'threadgroup' && c.enabled)) { tprint(`Created the tree successfully using ${o.t}\nNo enabled Thread Group found. Nothing to run.`); return; }
      const res = simulate(snap, { gui: false, server: setup.server, files: st.fs, seed: setup.seed, props: o.J });
      const run = Object.assign(res, { id: st.runs.length + 1, gui: false, plan: snap, listeners: new Set(), stopped: false, done: false, cli: { t: o.t, l: o.l, e: !!o.e, o: o.o, J: o.J } });
      st.runs.push(run);
      st.cliBusy = true;
      tprint(`Creating summariser <summary>\nCreated the tree successfully using ${o.t}\nStarting standalone test @ ${wall(0)} MSK (${T0})\nWaiting for possible Shutdown/StopTestNow/HeapDump/ThreadDump message on port 4445`);
      // строки summariser каждые 30 секунд виртуального времени
      const lines = [];
      const fmt = (sign, l, a0, b0, extra) => {
        const n = l.length;
        const s = stats(l) || { avg: 0, min: 0, max: 0, errN: 0, err: 0 };
        const span = Math.max(1, b0 - a0) / 1000;
        return `summary ${sign} ${pad(n, 6)} in ${hms(b0 - a0)} = ${pad((n / span).toFixed(1), 6)}/s Avg: ${pad(Math.round(s.avg), 5)} Min: ${pad(Math.round(s.min), 5)} Max: ${pad(Math.round(s.max), 5)} Err: ${pad(s.errN, 5)} (${(s.err * 100).toFixed(2)}%)${extra}`;
      };
      let prev = 0;
      for (let b = 30000; prev < run.dur; b += 30000) {
        const end = Math.min(b, run.dur);
        const l = run.samples.filter((s) => s.at > prev && s.at <= end);
        const startedN = run.threads.filter((t) => t.start <= end).length;
        const act = run.threads.filter((t) => t.start <= end && t.end > end).length;
        lines.push({ vt: end, text: fmt('+', l, prev, end, ` Active: ${act} Started: ${startedN} Finished: ${startedN - act}`) });
        if (prev > 0) lines.push({ vt: end, text: fmt('=', run.samples.filter((s) => s.at <= end), 0, end, '') });
        prev = end;
      }
      const dur = playMs(run);
      const t0 = performance.now();
      let li = 0;
      const step = () => {
        if (!alive()) { st.cliBusy = false; return; }
        const vt = Math.min(1, (performance.now() - t0) / dur) * run.dur;
        while (li < lines.length && lines[li].vt <= vt) tprint(lines[li++].text);
        if (vt < run.dur) { setTimeout(step, 120); return; }
        while (li < lines.length) tprint(lines[li++].text);
        run.warn.forEach(([lv, m]) => { if (lv !== 'INFO') tprint(`${lv} ${m}`); });
        tprint(`Tidying up ...    @ ${wall(run.dur)} MSK (${T0 + Math.round(run.dur)})\n... end of run`);
        run.done = true;
        st.cliBusy = false;
        if (o.l) st.fs[o.l] = { jtl: run.id };
        if (o.e) { st.reports[o.o] = { run: run.id, jtl: o.l }; showReportTab(o.o); }
        renderTerm();
        tin.focus();
        emit({ type: 'cli', run, args: run.cli });
      };
      renderTerm();
      step();
    }

    // ---------- HTML-отчёт и описание стенда ----------
    function showReportTab(dir) {
      ui.report = dir;
      const b = el.querySelector('[data-app="report"]');
      b.hidden = false;
      b.textContent = `📄 ${dir}/index.html`;
    }
    function renderReport() {
      const pane = $('.jm-reportpane');
      const dir = ui.report;
      const rep = dir && st.reports[dir];
      if (!rep) { pane.innerHTML = '<div class="jm-empty">Отчёт ещё не сгенерирован: запусти jmeter с ключами -e -o &lt;папка&gt;.</div>'; return; }
      const run = st.runs.find((r) => r.id === rep.run);
      const dirs = Object.keys(st.reports);
      pane.innerHTML = `${dirs.length > 1 ? `<label class="jm-f"><span>Папка отчёта:</span><select data-repdir>${dirs.map((d) => `<option${d === dir ? ' selected' : ''}>${esc(d)}</option>`).join('')}</select></label>` : ''}${dashboard(run, { dir: `${HOME}/${dir}`, jtl: `${HOME}/${rep.jtl || 'results.jtl'}` })}`;
    }
    function renderApi() {
      const row = (m, p, d) => `<tr><td><b class="jm-m ${m.toLowerCase()}">${m}</b></td><td><code>${p}</code></td><td>${d}</td></tr>`;
      $('.jm-apipane').innerHTML = `<div class="jm-api"><h4>Стенд <code>${HOST}</code> (http и https, порт по умолчанию)</h4>
        <div class="jm-tablewrap"><table class="jm-table"><tbody>
        ${row('GET', '/api/health', 'проверка живости')}
        ${row('GET', '/api/products', 'каталог товаров')}
        ${row('GET', '/api/products/{id}', 'товар, id от 1 до 500 (с кэшем)')}
        ${row('GET', '/api/search?q=…', 'поиск, параметр q обязателен')}
        ${row('GET', '/api/categories', 'категории')}
        ${row('GET', '/api/catalog', 'витрина')}
        ${row('POST', '/api/login', 'JSON <code>{"username":"…","password":"…"}</code>, нужен <code>Content-Type: application/json</code>; ответ: <code>token</code> и cookie <code>SESSIONID</code>')}
        ${row('GET', '/api/profile', 'профиль: <code>Authorization: Bearer &lt;token&gt;</code> или cookie сессии')}
        ${row('GET', '/api/cart', 'корзина: нужна cookie <code>SESSIONID</code>')}
        ${row('POST', '/api/orders', 'заказ: JSON <code>{"productId":42,"qty":1}</code>, нужен <code>Authorization: Bearer &lt;token&gt;</code>')}
        </tbody></table></div>
        <p>Тестовые пользователи: <code>load_user1</code> … <code>load_user50</code>, пароль <code>${PASSWORD}</code>. Файлы в <code>${HOME}</code>: ${Object.keys(FILES).map((f) => `<code>${f}</code>`).join(', ')}.</p></div>`;
    }
    function switchApp(a) {
      ui.app = a;
      closeMenu();
      el.querySelectorAll('[data-app]').forEach((b) => b.classList.toggle('on', b.dataset.app === a));
      el.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== a; });
      if (a === 'term') { renderTerm(); if (!st.cliBusy) tin.focus(); }
      if (a === 'report') { renderReport(); if (ui.report) emit({ type: 'report-open', dir: ui.report }); }
      if (a === 'api') renderApi();
    }

    // ---------- события ----------
    root.addEventListener('click', (ev) => {
      const t = ev.target.closest('button, [data-node]');
      if (!ui.menu || !(t && t.closest('.jm-menu'))) { if (ui.menu && !(t && (t.dataset.mbar || t.dataset.cmd === 'add'))) closeMenu(); }
      if (!t || t.disabled) return;
      const d = t.dataset;
      if (d.app) { switchApp(d.app); return; }
      if (d.mi) { const [ci, ii] = d.mi.split(':').map(Number); menuPick(ci, ii, false); return; }
      if (d.mbar) {
        const r = t.getBoundingClientRect();
        const g = gui.getBoundingClientRect();
        if (ui.menu && ui.menu.bar === d.mbar) { closeMenu(); return; }
        openMenu(MBAR[d.mbar](), r.left - g.left, r.bottom - g.top);
        ui.menu.bar = d.mbar;
        return;
      }
      if (d.node) { closeMenu(); select(d.node); return; }
      if (d.cmd === 'add') {
        const r = t.getBoundingClientRect();
        const g = gui.getBoundingClientRect();
        if (ui.menu && ui.menu.bar === 'add') { closeMenu(); return; }
        openMenu(addItems(cur()), r.left - g.left, r.bottom - g.top);
        ui.menu.bar = 'add';
        return;
      }
      if (d.cmd) { cmd(d.cmd); return; }
      if (d.ptab) { ui.httpTab[ui.sel] = d.ptab; renderPanel(); return; }
      if (d.tadd) { const e = cur(); e.p[d.tadd] = (e.p[d.tadd] || []).concat([Array.from({ length: +d.n }, () => '')]); renderPanel(); changed(); const ins = panelEl.querySelectorAll(`[data-tbl="${d.tadd}"][data-c="0"]`); if (ins.length) ins[ins.length - 1].focus(); return; }
      if (d.tdel) { const e = cur(); e.p[d.tdel].splice(+d.r, 1); renderPanel(); changed(); return; }
      if (d.browse !== undefined) { openDlg({ kind: 'browse', el: ui.sel, pick: cur().p.file || null }); return; }
      if (d.file) { ui.dlg.pick = d.file; renderDlg(); return; }
      if (d.dlg) { if (d.dlg === 'ok') dlgOk(); else closeDlg(); return; }
      if (d.vi !== undefined) {
        const e = cur();
        const f = (ui.vrtFlat[e.id] || [])[+d.vi];
        if (!f) return;
        ui.vrt[e.id] = { s: f.s, tab: (ui.vrt[e.id] || {}).tab || 'sampler' };
        renderResults();
        emit({ type: 'vrt-select', ok: f.s.ok, code: f.s.code, path: f.s.path, label: f.s.label, txn: !!f.s.txn, soft: !!f.s.soft, fails: f.s.fails.length, tab: ui.vrt[e.id].tab });
        return;
      }
      if (d.vtab) {
        const e = cur();
        const v = ui.vrt[e.id];
        if (!v) return;
        v.tab = d.vtab;
        renderResults();
        emit({ type: 'vrt-tab', tab: d.vtab, ok: v.s.ok, code: v.s.code, path: v.s.path, label: v.s.label, soft: !!v.s.soft, fails: v.s.fails.length });
      }
    });
    menuEl.addEventListener('mouseover', (ev) => {
      const b = ev.target.closest('[data-mi]');
      if (!b || !b.classList.contains('sub') || !window.matchMedia('(hover: hover)').matches) return;
      const [ci, ii] = b.dataset.mi.split(':').map(Number);
      menuPick(ci, ii, true);
    });
    treeEl.addEventListener('contextmenu', (ev) => {
      const b = ev.target.closest('[data-node]');
      if (!b) return;
      ev.preventDefault();
      select(b.dataset.node);
      const g = gui.getBoundingClientRect();
      openMenu(nodeItems(cur()), ev.clientX - g.left, ev.clientY - g.top);
    });
    treeEl.addEventListener('keydown', (ev) => {
      const e = cur();
      const k = ev.key.toLowerCase();
      if (ev.key === 'Delete') { ev.preventDefault(); remove(e); }
      else if (ev.ctrlKey && k === 't') { ev.preventDefault(); toggle(e); }
      else if (ev.ctrlKey && k === 'x') { ev.preventDefault(); cut(e); }
      else if (ev.ctrlKey && k === 'c') { ev.preventDefault(); copy(e); }
      else if (ev.ctrlKey && k === 'v') { ev.preventDefault(); paste(e); }
      else if (ev.ctrlKey && k === 's') { ev.preventDefault(); cmd('save'); }
      else if (ev.ctrlKey && k === 'r') { ev.preventDefault(); cmd('start'); }
    });
    panelEl.addEventListener('input', (ev) => {
      const t = ev.target;
      const e = cur();
      const d = t.dataset;
      if (d.f) { e[d.f] = t.value; if (d.f === 'name') { const n = treeEl.querySelector(`[data-node="${e.id}"] .nm`); if (n) n.textContent = t.value; } changed(); return; }
      if (d.tbl) { const row = e.p[d.tbl][+d.r]; if (row) row[+d.c] = t.value; changed(); return; }
      if (d.p && (t.type === 'text' || t.tagName === 'TEXTAREA')) { e.p[d.p] = t.value; changed(); if (isListener(e)) renderResults(); }
    });
    panelEl.addEventListener('change', (ev) => {
      const t = ev.target;
      const e = cur();
      const k = t.dataset.p;
      if (!k || t.type === 'text' || t.tagName === 'TEXTAREA') return;
      if (t.type === 'checkbox') e.p[k] = t.checked;
      else e.p[k] = t.value;
      renderPanel();
      changed();
    });
    root.addEventListener('change', (ev) => { if (ev.target.matches('[data-repdir]')) { ui.report = ev.target.value; renderReport(); emit({ type: 'report-open', dir: ui.report }); } });
    dlgEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.matches('[data-dlgin]')) dlgOk(); if (ev.key === 'Escape') closeDlg(); });
    tin.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || st.cliBusy) return;
      const v = tin.value;
      tin.value = '';
      exec(v);
    });

    renderTitle();
    renderStatus();
    renderTree();
    renderPanel();
    if (setup.select) { const s = all(plan, (x) => x.name === setup.select)[0]; if (s) select(s.id); }
    st.term = [`Last login: ${wall(-3600000).slice(0, 16)} from 10.12.0.15`, 'Введи help — список команд.'];
    return { reset() { GEN++; } };
  }

  // ---------- помощники проверок уровней ----------
  const G = { name: 'Голем нагрузки', sprite: '🗿' };
  const doneRuns = (ctx) => (ctx.state.runs || []).filter((r) => r.done);
  const guiRuns = (ctx) => doneRuns(ctx).filter((r) => r.gui);
  const real = (run) => run.samples.filter((s) => !s.txn);
  const txns = (run) => run.samples.filter((s) => s.txn);
  const atPath = (run, path, method) => real(run).filter((s) => s.path === path && (!method || s.method === method));
  const errRate = (list) => (list.length ? list.filter((s) => !s.ok).length / list.length : 0);
  const allOk = (list) => list.length > 0 && list.every((s) => s.ok);
  const els = (plan, type) => liveAll(plan, (e) => e.type === type);
  function normPath(p) {
    let x = String(p || '').trim();
    const m = /^https?:\/\/[^/]+(\/.*)?$/i.exec(x);
    if (m) x = m[1] || '/';
    x = x.split('?')[0];
    if (x && x[0] !== '/') x = '/' + x;
    return x.replace(/\/+$/, '') || '/';
  }
  const samplersAt = (plan, re, method) => els(plan, 'http').filter((e) => (re instanceof RegExp ? re.test(normPath(e.p.path)) : normPath(e.p.path) === re) && (!method || e.p.method === method));
  // Действует ли элемент (конфиг, таймер, ассерт, экстрактор) на сэмплер.
  function applies(plan, el, smp) {
    if (!live(plan, el)) return false;
    const par = parentOf(plan, el.id);
    return par === plan || par === smp || ancestors(plan, smp).includes(par);
  }
  const applying = (plan, type, smp) => els(plan, type).filter((x) => applies(plan, x, smp));
  function meanDelay(plan, smp) {
    return all(plan, (e) => ['ctimer', 'urtimer'].includes(e.type)).filter((x) => applies(plan, x, smp))
      .reduce((a, t) => a + (t.type === 'ctimer' ? num(t.p.delay) : num(t.p.offset) + num(t.p.range) / 2), 0);
  }
  const parseNum = (v) => { const m = /-?\d+(?:[.,]\d+)?/.exec(String(v).replace(/\s+/g, '')); return m ? parseFloat(m[0].replace(',', '.')) : NaN; };
  // Значения, которые игрок мог видеть в слушателе: по отдельному прогону или накопленные с последнего Clear All.
  function seen(ctx, pick, key) {
    const out = [];
    const runs = guiRuns(ctx);
    runs.forEach((r) => { const s = stats(pick(r)); if (s) out.push(s[key]); });
    const m = ctx.state.mark || { r: 0, at: -1 };
    const acc = [];
    (ctx.state.runs || []).forEach((r, ri) => { if (r.gui && r.done && ri >= m.r) pick(r).forEach((s) => { if (ri > m.r || s.at > m.at) acc.push(s); }); });
    const sa = stats(acc);
    if (sa) out.push(sa[key]);
    return out;
  }
  const nearAny = (v, vals, tol) => { const x = parseNum(v); return Number.isFinite(x) && vals.some((y) => Math.abs(x - y) <= tol(y)); };
  const logHas = (ctx, pred) => ctx.log.some(pred);
  // Игрок смотрел вкладку tab у сэмпла (кликнул вкладку или выбрал сэмпл при уже открытой вкладке).
  const viewed = (ctx, tab, pred) => logHas(ctx, (e) => (e.type === 'vrt-select' || e.type === 'vrt-tab') && e.tab === tab && pred(e));
  const userOf = (s) => { const j = parseJson(s.reqBody); return j && j.username; };
  const runHas = (run, type) => liveAll(run.plan, (e) => e.type === type).length > 0;
  const tg = (run) => run.tgs[0] || {};
  const HCT = () => E('headers', 'HTTP Header Manager', { list: [['Content-Type', 'application/json']] });
  const H = (name, method, path, extra, kids) => E('http', name, Object.assign({ protocol: 'https', host: HOST, method, path }, extra || {}), kids);
  const TG = (p, kids) => E('threadgroup', 'Thread Group', p, kids);
  const LOGIN_VARS = '{"username":"${username}","password":"${password}"}';
  const ORDER_BODY = '{"productId":42,"qty":1}';
  const CSV = () => E('csv', 'CSV Data Set Config', { file: 'users.csv', names: 'username,password' });
  const plan = (kids) => () => E('testplan', 'Test Plan', {}, kids());
  // SLA для уровней 14–15: 95% Line < 1000 мс и ошибок < 1%.
  const slaRun = (r) => r.dur >= 60000 && real(r).length > 100 && !r.stopped && meanDelay(r.plan, els(r.plan, 'http')[0] || r.plan) >= 500;
  const slaGood = (r) => { const s = stats(real(r)); return s.p95 < 1000 && s.err < 0.01; };
  const satPairs = (ctx) => {
    const rs = doneRuns(ctx).filter(slaRun);
    const g = rs.filter(slaGood);
    const b = rs.filter((r) => !slaGood(r));
    const out = [];
    g.forEach((x) => b.forEach((y) => { const d = tg(y).threads - tg(x).threads; if (d > 0 && d <= 20) out.push([tg(x).threads, tg(y).threads]); }));
    return out;
  };
  const SAT_SERVER = { workers: 10, queueMax: 150, timeout: 3000, cost: { products: 100 } };
  const FINAL_SERVER = { pools: { orders: 2 }, cost: { orders: 150 } };
  function finalVerdict(run) {
    const t = stats(txns(run));
    const all0 = stats(real(run));
    const slow = !t || t.p95 >= 1500;
    const bad = all0.err >= 0.01;
    return slow && bad ? 3 : slow ? 1 : bad ? 2 : 0;
  }
  function finalPlanOk(p) {
    const login = samplersAt(p, '/api/login', 'POST')[0];
    const orders = samplersAt(p, '/api/orders', 'POST')[0];
    const prod = samplersAt(p, '/api/products', 'GET')[0];
    if (!login || !orders || !prod) return false;
    const inTxn = (s) => ancestors(p, s).some((a) => a.type === 'txn' && live(p, a));
    if (!inTxn(orders) || !inTxn(prod)) return false;
    if (!applying(p, 'csv', login).length) return false;
    const x = applying(p, 'jextract', login).concat(applying(p, 'rextract', login))[0];
    if (!x) return false;
    const auth = applying(p, 'headers', orders).flatMap((h) => h.p.list).find(([k]) => /^authorization$/i.test(String(k).trim()));
    return !!auth && auth[1].replace(/\s+/g, '') === 'Bearer${' + x.p.ref.trim() + '}';
  }
  // Экстрактор действительно вытаскивает token из ответа на вход.
  function extractsToken(x) {
    const vars = {};
    runExtractor(x, { body: '{"token":"eyJ.test.Zz9","user":"load_user1","expiresIn":900}', resHead: '', url: '', code: 200 }, vars, { rnd: () => 0 });
    return vars[x.p.ref.trim()] === 'eyJ.test.Zz9';
  }

  const LEVELS = [
    {
      id: 'jm-1', title: 'Первый тест-план', giver: G, gold: 80,
      steps: [
        { id: 'tg', text: 'Добавь группу потоков: правый клик по <b>Test Plan</b> (или ➕ <b>Add</b> на панели) → <b>Threads (Users) → Thread Group</b>.', check: (c) => els(c.state.plan, 'threadgroup').length > 0 },
        { id: 'http', text: 'Внутрь Thread Group добавь <b>Sampler → HTTP Request</b>: Protocol <code>https</code>, Server Name or IP <code>shop.load.test</code>, Method <code>GET</code>, Path <code>/api/health</code>.',
          check: (c) => els(c.state.plan, 'http').some((h) => h.p.host.trim() === HOST && normPath(h.p.path) === '/api/health' && h.p.method === 'GET' && ancestors(c.state.plan, h).some((a) => a.type === 'threadgroup')) },
        { id: 'vrt', text: 'Добавь слушатель <b>Listener → View Results Tree</b> (в Thread Group или в Test Plan).', check: (c) => els(c.state.plan, 'vrt').length > 0 },
        { id: 'run', text: 'Нажми <b>▶ Start</b> и дождись окончания (счётчик потоков справа на панели вернётся к 0).', check: (c) => guiRuns(c).some((r) => runHas(r, 'vrt') && atPath(r, '/api/health').some((s) => s.code === 200)) },
        { id: 'look', text: 'Открой <b>View Results Tree</b>, выбери зелёный сэмпл и вкладку <b>Response data</b> — это ответ сервера.', check: (c) => viewed(c, 'response', (e) => e.ok && e.path === '/api/health') },
      ],
      hints: [
        'Минимальный тест-план: Thread Group (кто и сколько) → HTTP Request (что отправить) → слушатель (куда сложить результаты).',
        'Элементы добавляются через контекстное меню узла дерева: правый клик → Add, или кнопка ➕ Add на панели (добавляет в выделенный узел). HTTP Request добавляй, выделив Thread Group.',
        'Выдели Test Plan → ➕ Add → Threads (Users) → Thread Group. Выдели Thread Group → ➕ Add → Sampler → HTTP Request: Protocol <b>https</b>, Server <b>shop.load.test</b>, Path <b>/api/health</b>. Выдели Thread Group → ➕ Add → Listener → View Results Tree. ▶ Start. Выдели View Results Tree → строка слева → вкладка Response data.',
      ],
      outro: 'Thread Group + Sampler + Listener — скелет любого плана JMeter.',
    },
    {
      id: 'jm-2', title: 'Читаем View Results Tree', giver: G, gold: 85,
      setup: {
        select: 'View Results Tree',
        plan: plan(() => [TG({}, [
          H('Каталог', 'GET', '/api/products'), H('Товар 42', 'GET', '/api/products/42'), H('Товар 999', 'GET', '/api/products/999'),
          H('Вход', 'POST', '/api/login', { body: '{"username":"load_user1","password":"qwerty"}' }, [HCT()]),
          E('vrt'),
        ])]),
      },
      steps: [
        { id: 'run', text: 'Запусти готовый план (<b>▶ Start</b>).', check: (c) => guiRuns(c).some((r) => real(r).length >= 4) },
        { id: 'red', text: 'В View Results Tree выбери сэмпл, помеченный красным ✖.', check: (c) => logHas(c, (e) => e.type === 'vrt-select' && !e.ok) },
        { id: 'req', text: 'Открой у красного сэмпла вкладку <b>Request</b>: какой метод, URL и тело ушли на сервер.', check: (c) => viewed(c, 'request', (e) => !e.ok) },
        { id: 'code', text: 'Какой <b>Response code</b> у сэмпла «Товар 999»?', answer: { kind: 'text', placeholder: 'код ответа', accept: (v) => String(v).trim() === '404', wrong: 'Выбери «Товар 999» и посмотри строку Response code во вкладке Sampler result.' } },
        { id: 'msg', text: 'Что сервер написал в поле <code>error</code> ответа на «Вход»?', answer: { kind: 'text', placeholder: 'текст ошибки', accept: (v) => /invalid\s*credentials/i.test(v), wrong: 'Выбери «Вход» → вкладка Response data → Response Body.' } },
      ],
      hints: [
        'Красный ✖ — сэмпл неуспешен: код 4xx/5xx, ошибка соединения или упавшая проверка.',
        'Слева в View Results Tree — список сэмплов, справа вкладки: Sampler result (коды, время, размер), Request (что ушло), Response data (что пришло).',
        '▶ Start → «Товар 999» (✖) → Sampler result: Response code <b>404</b> → Request: GET https://shop.load.test/api/products/999. «Вход» (✖) → Response data: <b>Invalid credentials</b>.',
      ],
    },
    {
      id: 'jm-3', title: 'Summary и Aggregate Report', giver: G, gold: 95,
      setup: {
        select: 'Thread Group',
        server: { tail: { ep: 'products', p: 0.06, min: 1500, max: 2600 } },
        plan: plan(() => [TG({ threads: '20', rampup: '5', loops: '20' }, [H('Каталог', 'GET', '/api/products')])]),
      },
      steps: [
        { id: 'sum', text: 'Добавь <b>Listener → Summary Report</b>.', check: (c) => els(c.state.plan, 'summary').length > 0 },
        { id: 'agg', text: 'Добавь <b>Listener → Aggregate Report</b>.', check: (c) => els(c.state.plan, 'aggregate').length > 0 },
        { id: 'run', text: 'Запусти тест (20 потоков × 20 итераций) и дождись окончания.', check: (c) => guiRuns(c).some((r) => runHas(r, 'summary') && runHas(r, 'aggregate') && real(r).length >= 300) },
        { id: 'p95', text: 'Сколько миллисекунд <b>95% Line</b> у «Каталог» в Aggregate Report?',
          answer: { kind: 'text', placeholder: 'мс', accept: (v, c) => nearAny(v, seen(c, (r) => real(r).filter((s) => s.label === 'Каталог'), 'p95'), (y) => Math.max(3, y * 0.01)), wrong: 'Открой Aggregate Report и возьми число из колонки 95% Line строки «Каталог».' } },
        { id: 'why', text: 'Average в Summary Report небольшой, а 95% Line в разы больше. Что это значит?',
          answer: { kind: 'choice', options: ['Average считается с ошибкой — смотреть надо только Min', 'Большинство ответов быстрые, но каждый 20-й ждёт дольше 95% Line: среднее прячет хвост, поэтому SLA задают перцентилями', '95% запросов завершились ошибкой', '95% Line — среднее за первые 95 секунд теста'], accept: (v) => v === 1 } },
      ],
      hints: [
        'Summary Report — среднее, минимум, максимум, Throughput. Aggregate Report добавляет медиану и перцентили (90/95/99% Line).',
        'Слушатели добавляются в Thread Group или Test Plan: ➕ Add → Listener. После прогона выдели слушатель — таблица справа.',
        'Thread Group → ➕ Add → Listener → Summary Report, затем ➕ Add → Listener → Aggregate Report → ▶ Start → Aggregate Report → колонка 95% Line. Вывод — второй вариант: перцентиль показывает хвост медленных ответов.',
      ],
      outro: 'Среднее — плохая метрика для SLA: оно не видит хвост медленных ответов.',
    },
    {
      id: 'jm-4', title: 'Ramp-Up: разгон нагрузки', giver: G, gold: 100,
      setup: {
        select: 'Thread Group',
        server: { warm: { start: 4, perSec: 5 }, workers: 60, queueMax: 20, timeout: 4000 },
        plan: plan(() => [TG({ threads: '100', rampup: '0', loops: '10' }, [H('Каталог', 'GET', '/api/products'), E('ctimer', 'Constant Timer', { delay: '500' }), E('summary'), E('vrt')])]),
      },
      steps: [
        { id: 'burst', text: 'Запусти тест как есть: 100 потоков стартуют одновременно (Ramp-up period = 0). Посмотри Error % в Summary Report.', check: (c) => guiRuns(c).some((r) => tg(r).threads >= 100 && tg(r).rampup <= 1 && errRate(real(r)) > 0.05) },
        { id: 'code', text: 'С каким <b>Response code</b> падают запросы?', answer: { kind: 'text', placeholder: 'код ответа', accept: (v) => String(v).trim() === '503', wrong: 'Открой View Results Tree и выбери красный сэмпл.' } },
        { id: 'ramp', text: 'Поставь <b>Ramp-up period ≥ 20</b> секунд (те же 100 потоков) и запусти снова: ошибок должно стать меньше 1%.', check: (c) => guiRuns(c).some((r) => tg(r).threads >= 100 && tg(r).rampup >= 20 && !r.stopped && real(r).length >= 900 && errRate(real(r)) < 0.01) },
        { id: 'why', text: 'Зачем нужен Ramp-Up?', answer: { kind: 'choice', options: ['Чтобы JMeter быстрее закончил тест', 'Нагрузка растёт плавно: сервер успевает поднять пулы и прогреть кэши, а по графику видно, на каком уровне начинаются проблемы', 'Ramp-up задаёт паузу между запросами одного пользователя', 'Без Ramp-up JMeter не запускает больше 10 потоков'], accept: (v) => v === 1 } },
      ],
      hints: [
        'Ramp-up period — за сколько секунд JMeter запустит все потоки. 0 — все разом, «стеной».',
        'Поле Ramp-up period (seconds) — в Thread Group. 100 потоков за 20 секунд — по 5 новых в секунду.',
        '▶ Start → Summary Report: много ошибок → View Results Tree: 503. Thread Group → Ramp-up period = <b>20</b> → 🧹 Clear All → ▶ Start → Error % 0.00%. Вывод — второй вариант.',
      ],
    },
    {
      id: 'jm-5', title: 'Loop Count и Duration', giver: G, gold: 105,
      setup: { select: 'Thread Group', plan: plan(() => [TG({ threads: '5', rampup: '1', loops: '1' }, [H('Каталог', 'GET', '/api/products'), H('Товар 42', 'GET', '/api/products/42'), E('summary')])]) },
      steps: [
        { id: 'loops', text: 'Поставь <b>Loop Count = 10</b> (Number of Threads = 5) и запусти.', check: (c) => guiRuns(c).some((r) => tg(r).threads === 5 && !tg(r).infinite && tg(r).loops === 10 && !(tg(r).lifetime && tg(r).duration > 0) && !r.stopped) },
        { id: 'count', text: 'Сколько сэмплов в строке <b>TOTAL</b> Summary Report за этот прогон?',
          answer: { kind: 'text', placeholder: '# Samples', accept: (v, c) => nearAny(v, seen(c, (r) => (tg(r).loops === 10 && tg(r).threads === 5 ? real(r) : []), 'n'), () => 0), wrong: 'Потоки × итерации × запросы в итерации. Сверь с колонкой # Samples строки TOTAL.' } },
        { id: 'dur', text: 'Теперь тест по времени: Loop Count → <b>Infinite</b>, включи <b>Specify Thread lifetime</b>, Duration = <b>60</b> секунд. Запусти.', check: (c) => guiRuns(c).some((r) => tg(r).infinite && tg(r).lifetime && tg(r).duration === 60 && !r.stopped && r.dur >= 59000 && r.dur <= 62000) },
        { id: 'pick', text: 'Когда нагрузку лучше задавать через Duration, а не через Loop Count?', answer: { kind: 'choice', options: ['Когда нужна нагрузка заданной длительности (стабильность, SLA «30 минут под нагрузкой»): время теста не зависит от скорости ответов', 'Duration ускоряет выполнение запросов', 'Loop Count нельзя использовать с несколькими потоками', 'Duration отключает ошибки'], accept: (v) => v === 0 } },
      ],
      hints: [
        'Loop Count — сколько раз каждый поток пройдёт сценарий. Duration — сколько секунд потоки работают, итераций — сколько успеют.',
        'Сэмплов = Number of Threads × Loop Count × число HTTP Request в итерации. Duration доступен только с галочкой Specify Thread lifetime.',
        'Loop Count = <b>10</b> → ▶ Start → TOTAL = 5 × 10 × 2 = <b>100</b>. Затем галочка Infinite, галочка Specify Thread lifetime, Duration = <b>60</b> → ▶ Start. Вывод — первый вариант.',
      ],
    },
    {
      id: 'jm-6', title: 'HTTP Header Manager', giver: G, gold: 110,
      setup: {
        select: 'Вход',
        server: { staticToken: true },
        plan: plan(() => [TG({}, [H('Вход', 'POST', '/api/login', { body: '{"username":"load_user1","password":"Passw0rd!"}' }), H('Профиль', 'GET', '/api/profile'), E('vrt')])]),
      },
      steps: [
        { id: 'r415', text: 'Запусти план. «Вход» падает — посмотри в View Results Tree код и тело ответа.', check: (c) => guiRuns(c).some((r) => atPath(r, '/api/login').some((s) => s.code === 415)) },
        { id: 'ctype', text: 'Добавь <b>Config Element → HTTP Header Manager</b> с заголовком <code>Content-Type: application/json</code> так, чтобы он действовал на «Вход», и запусти: вход должен вернуть 200.',
          check: (c) => guiRuns(c).some((r) => atPath(r, '/api/login').some((s) => s.code === 200 && s.reqHead.some(([k, v]) => /^content-type$/i.test(k) && /application\/json/i.test(v)))) },
        { id: 'auth', text: '«Профиль» отвечает 401. Ему нужен заголовок <code>Authorization: Bearer qa-static-token</code>. Добавь его в Header Manager и добейся 200 у «Профиль».',
          check: (c) => guiRuns(c).some((r) => atPath(r, '/api/profile').some((s) => s.code === 200 && s.reqHead.some(([k, v]) => /^authorization$/i.test(k) && /^Bearer\s+\S+/i.test(v)))) },
        { id: 'scope', text: 'Header Manager лежит прямо в Thread Group. На какие запросы он действует?', answer: { kind: 'choice', options: ['Только на первый запрос под ним', 'На все сэмплеры этой Thread Group; Header Manager внутри HTTP Request действует только на этот запрос', 'На все Thread Group в плане', 'Ни на какие: менеджер работает только внутри HTTP Request'], accept: (v) => v === 1 } },
      ],
      hints: [
        'Сервер ждёт JSON и проверяет заголовок Content-Type. JMeter сам его не ставит — заголовки задаёт HTTP Header Manager.',
        'Выдели Thread Group (или «Вход») → ➕ Add → Config Element → HTTP Header Manager → Add → Name/Value. Область действия: менеджер в Thread Group — для всех запросов группы.',
        'Thread Group → ➕ Add → Config Element → HTTP Header Manager → Add: <b>Content-Type</b> = <b>application/json</b>, ещё Add: <b>Authorization</b> = <b>Bearer qa-static-token</b> → ▶ Start → оба запроса зелёные. Вывод — второй вариант.',
      ],
    },
    {
      id: 'jm-7', title: 'Cookie Manager и сессии', giver: G, gold: 115,
      setup: {
        select: 'Thread Group',
        plan: plan(() => [TG({ threads: '3', loops: '2' }, [HCT(), H('Вход', 'POST', '/api/login', { body: '{"username":"load_user1","password":"Passw0rd!"}' }), H('Корзина', 'GET', '/api/cart'), E('vrt'), E('summary')])]),
      },
      steps: [
        { id: 'r401', text: 'Запусти: вход успешен, а «Корзина» отвечает 401. Посмотри её Response data.', check: (c) => guiRuns(c).some((r) => atPath(r, '/api/cart').some((s) => s.code === 401) && atPath(r, '/api/login').some((s) => s.code === 200)) },
        { id: 'cm', text: 'Добавь в Thread Group <b>Config Element → HTTP Cookie Manager</b> и запусти: «Корзина» должна отвечать 200 во всех потоках.', check: (c) => guiRuns(c).some((r) => runHas(r, 'cookies') && atPath(r, '/api/cart').length >= 6 && allOk(atPath(r, '/api/cart'))) },
        { id: 'name', text: 'Как называется кука, которую JMeter отправил в «Корзина»? (View Results Tree → Request → Cookie Data)', answer: { kind: 'text', placeholder: 'имя куки', accept: (v) => /^sessionid$/i.test(String(v).trim()), wrong: 'Выбери зелёную «Корзина» → вкладка Request → блок Cookie Data.' } },
      ],
      hints: [
        'Сервер выдаёт сессию в Set-Cookie. Без Cookie Manager JMeter, в отличие от браузера, не хранит куки и не отправляет их обратно.',
        'Thread Group → ➕ Add → Config Element → HTTP Cookie Manager. Он хранит куки отдельно для каждого потока.',
        'Thread Group → ➕ Add → Config Element → HTTP Cookie Manager → ▶ Start → «Корзина» 200 → View Results Tree → «Корзина» → Request → Cookie Data: <b>SESSIONID</b>=….',
      ],
    },
    {
      id: 'jm-8', title: 'CSV Data Set: разные пользователи', giver: G, gold: 120,
      setup: {
        select: 'Вход',
        server: { singleSession: true },
        plan: plan(() => [TG({ threads: '10', rampup: '2', loops: '5' }, [HCT(), E('cookies'), H('Вход', 'POST', '/api/login', { body: '{"username":"load_user1","password":"Passw0rd!"}' }), H('Корзина', 'GET', '/api/cart'), E('summary')])]),
      },
      steps: [
        { id: 'clash', text: 'Запусти: все 10 потоков входят под <code>load_user1</code>, и каждый новый вход выбивает прошлые сессии. Посмотри Error % у «Корзина».', check: (c) => guiRuns(c).some((r) => errRate(atPath(r, '/api/cart')) > 0.1 && new Set(atPath(r, '/api/login').map(userOf)).size === 1) },
        { id: 'csv', text: 'Добавь <b>Config Element → CSV Data Set Config</b>: Filename <code>users.csv</code> (кнопка Browse…), Variable Names <code>username,password</code>.',
          check: (c) => els(c.state.plan, 'csv').some((x) => x.p.file.trim().replace(/^.*\//, '') === 'users.csv' && x.p.names.split(',').filter((n) => n.trim()).length >= 2) },
        { id: 'vars', text: 'В Body Data «Вход» подставь переменные: <code>{"username":"${username}","password":"${password}"}</code>. Запусти: ошибок меньше 1%.',
          check: (c) => guiRuns(c).some((r) => { const l = atPath(r, '/api/login'); return new Set(l.map(userOf)).size >= 10 && allOk(l) && real(r).length >= 50 && errRate(real(r)) < 0.01; }) },
        { id: 'why', text: 'Почему один логин на всех виртуальных пользователей — плохой нагрузочный тест?', answer: { kind: 'choice', options: ['JMeter не умеет отправлять один логин дважды', 'Нереалистично: сессии выбивают друг друга, кэши и блокировки работают на одной записи — результат не похож на реальных пользователей', 'Так тест идёт дольше', 'Ничем, это нормальная практика'], accept: (v) => v === 1 } },
      ],
      hints: [
        'Параметризация: каждый поток берёт свою строку из файла. Файл users.csv лежит рядом с планом: логин,пароль.',
        'CSV Data Set Config читает по строке на каждую итерацию потока и кладёт значения в переменные, перечисленные в Variable Names. В запросе переменная пишется как ${username}.',
        'Thread Group → ➕ Add → Config Element → CSV Data Set Config → Browse… → users.csv → Open; Variable Names: <b>username,password</b>. «Вход» → Body Data: <b>{"username":"${username}","password":"${password}"}</b> → 🧹 Clear All → ▶ Start. Вывод — второй вариант.',
      ],
    },
    {
      id: 'jm-9', title: 'Response Assertion', giver: G, gold: 130,
      setup: {
        select: 'Витрина',
        server: { softErr: 0.08 },
        plan: plan(() => [TG({ threads: '10', rampup: '2', loops: '20' }, [H('Витрина', 'GET', '/api/catalog'), E('summary'), E('vrt')])]),
      },
      steps: [
        { id: 'green', text: 'Запусти: в Summary Report Error % = 0.00%.', check: (c) => guiRuns(c).some((r) => atPath(r, '/api/catalog').some((s) => s.soft) && allOk(real(r))) },
        { id: 'find', text: 'Найди в View Results Tree зелёный сэмпл, где в Response data вместо JSON пришла страница «Сервис временно недоступен».', check: (c) => viewed(c, 'response', (e) => e.soft) },
        { id: 'add', text: 'Добавь в «Витрина» <b>Assertions → Response Assertion</b>, которая проверяет тело ответа (Text Response) — например, Contains <code>"items"</code>.',
          check: (c) => { const p = c.state.plan; return samplersAt(p, '/api/catalog').some((s) => applying(p, 'rassert', s).some((a) => a.p.patterns.some((x) => x[0] && x[0].trim()))); } },
        { id: 'catch', text: 'Запусти снова: проверка должна ронять все «страницы техработ» и пропускать нормальные ответы.',
          check: (c) => guiRuns(c).some((r) => { const l = atPath(r, '/api/catalog'); const soft = l.filter((s) => s.soft); return soft.length > 0 && soft.every((s) => !s.ok) && l.filter((s) => !s.soft).every((s) => s.ok); }) },
        { id: 'why', text: 'Почему без проверки JMeter считал эти ответы успешными?', answer: { kind: 'choice', options: ['Он считает успехом любой код 2xx/3xx и не смотрит в тело ответа', 'Сервер вернул 500, но JMeter его скрыл', 'Summary Report не показывает ошибки', 'Из-за Ramp-Up'], accept: (v) => v === 0 } },
      ],
      hints: [
        'Код 200 ещё не значит, что ответ правильный. Ошибку внутри тела ловят ассертами.',
        'Страница техработ — HTML с «Сервис временно недоступен». В нормальном ответе есть "items". Response Assertion: Field to Test = Text Response, Contains, паттерн в Patterns to Test → Add.',
        'Пролистай View Results Tree, открывая Response data, пока не встретишь HTML-страницу. «Витрина» → ➕ Add → Assertions → Response Assertion → Text Response, Contains → Add → <b>"items"</b> → 🧹 Clear All → ▶ Start. Вывод — первый вариант.',
      ],
    },
    {
      id: 'jm-10', title: 'Duration Assertion и SLA', giver: G, gold: 135,
      setup: {
        select: 'Поиск',
        server: { cost: { search: 330 }, sigmaEp: { search: 0.4 } },
        plan: plan(() => [TG({ threads: '20', rampup: '10', loops: '10' }, [H('Поиск', 'GET', '/api/search', { params: [['q', 'зелье']] }), E('aggregate'), E('vrt')])]),
      },
      steps: [
        { id: 'add', text: 'SLA поиска — ответ не дольше 500 мс. Добавь в «Поиск» <b>Assertions → Duration Assertion</b> с Duration = <b>500</b>.',
          check: (c) => { const p = c.state.plan; return samplersAt(p, '/api/search').some((s) => applying(p, 'dassert', s).some((a) => int(a.p.duration) === 500)); } },
        { id: 'run', text: 'Запусти тест.', check: (c) => guiRuns(c).some((r) => { const l = atPath(r, '/api/search'); return l.length >= 100 && l.some((s) => s.fails.some((f) => /lasted too long/.test(f.msg))) && l.every((s) => (s.e > 500) === s.fails.some((f) => /lasted too long/.test(f.msg))); }) },
        { id: 'look', text: 'Открой в View Results Tree упавший сэмпл → <b>Sampler result</b>: внизу сообщение Duration Assertion.', check: (c) => viewed(c, 'sampler', (e) => e.fails > 0) },
        { id: 'pct', text: 'Какой <b>Error %</b> у «Поиск» в Aggregate Report? (с точностью до десятых)',
          answer: { kind: 'text', placeholder: '%', accept: (v, c) => nearAny(v, seen(c, (r) => (runHas(r, 'dassert') ? atPath(r, '/api/search') : []), 'err').map((x) => x * 100), () => 0.3), wrong: 'Колонка Error % в строке «Поиск» Aggregate Report.' } },
      ],
      hints: [
        'Duration Assertion помечает сэмпл ошибкой, если он длился дольше заданного — так SLA попадает прямо в Error %.',
        'Выдели «Поиск» → ➕ Add → Assertions → Duration Assertion. Внутри сэмплера ассерт действует только на него.',
        '«Поиск» → ➕ Add → Assertions → Duration Assertion → Duration in milliseconds: <b>500</b> → ▶ Start → View Results Tree → красный сэмпл → Sampler result: «The operation lasted too long…». Aggregate Report → Error % строки «Поиск».',
      ],
    },
    {
      id: 'jm-11', title: 'Таймеры и think time', giver: G, gold: 145,
      setup: {
        select: 'Thread Group',
        plan: plan(() => [TG({ threads: '20', rampup: '10', infinite: true, lifetime: true, duration: '60' }, [H('Каталог', 'GET', '/api/products'), H('Товар', 'GET', '/api/products/${__Random(1,500)}'), E('summary')])]),
      },
      steps: [
        { id: 'raw', text: 'Запусти без таймеров и посмотри Throughput в Summary Report: 20 «пользователей» шлют запросы без пауз.', check: (c) => guiRuns(c).some((r) => !all(r.plan, (e) => kindOf(e) === 'timer' && live(r.plan, e)).length && (stats(real(r)) || {}).tput > 50) },
        { id: 'timer', text: 'Реальный пользователь думает 3–5 секунд между действиями. Добавь в Thread Group <b>Timer → Uniform Random Timer</b>: Random Delay Maximum = <b>2000</b>, Constant Delay Offset = <b>3000</b>.',
          check: (c) => { const p = c.state.plan; const hs = els(p, 'http'); return hs.length >= 2 && hs.every((h) => { const d = meanDelay(p, h); return d >= 3000 && d <= 5000; }); } },
        { id: 'real', text: 'Запусти снова и сравни Throughput.', check: (c) => guiRuns(c).some((r) => { const hs = els(r.plan, 'http'); const s = stats(real(r)); return hs.length >= 2 && hs.every((h) => meanDelay(r.plan, h) >= 3000 && meanDelay(r.plan, h) <= 5000) && s && s.tput > 2 && s.tput < 10 && !r.stopped; }) },
        { id: 'tp', text: 'Таймер лежит в Thread Group рядом с двумя HTTP Request. Когда он срабатывает?', answer: { kind: 'choice', options: ['Один раз в начале теста', 'Перед каждым сэмплером в своей области — то есть перед обоими запросами', 'Только после последнего запроса', 'Только перед первым запросом итерации'], accept: (v) => v === 1 } },
      ],
      hints: [
        'Без пауз 20 потоков создают нагрузку как сотни реальных людей. Think time делает профиль нагрузки похожим на правду.',
        'Uniform Random Timer: пауза = Constant Delay Offset + случайное от 0 до Random Delay Maximum. Таймер действует на все сэмплеры своей области.',
        '▶ Start → Throughput сотни/sec. Thread Group → ➕ Add → Timer → Uniform Random Timer: Random Delay Maximum <b>2000</b>, Constant Delay Offset <b>3000</b> → 🧹 Clear All → ▶ Start → около 5/sec. Вывод — второй вариант.',
      ],
    },
    {
      id: 'jm-12', title: 'Корреляция: JSON Extractor', giver: G, gold: 150,
      setup: {
        select: 'Вход',
        server: { singleSession: true },
        plan: plan(() => [TG({ threads: '5', rampup: '1', loops: '3' }, [HCT(), CSV(), H('Вход', 'POST', '/api/login', { body: LOGIN_VARS }),
          H('Заказ', 'POST', '/api/orders', { body: ORDER_BODY }, [E('headers', 'HTTP Header Manager', { list: [['Authorization', 'Bearer ' + OLD_TOKEN]] })]), E('vrt')])]),
      },
      steps: [
        { id: 'stale', text: 'Запусти: «Заказ» получает 401 — в нём зашит токен из старой записи сценария.', check: (c) => guiRuns(c).some((r) => atPath(r, '/api/orders').some((s) => s.code === 401) && atPath(r, '/api/login').some((s) => s.code === 200)) },
        { id: 'extract', text: 'Добавь в «Вход» <b>Post Processors → JSON Extractor</b>: Names of created variables <code>token</code>, JSON Path expressions <code>$.token</code>.',
          check: (c) => { const p = c.state.plan; return samplersAt(p, '/api/login').some((s) => applying(p, 'jextract', s).concat(applying(p, 'rextract', s)).some(extractsToken)); } },
        { id: 'use', text: 'В Header Manager «Заказ» замени значение Authorization на <code>Bearer ${token}</code> и запусти: все заказы — 201.', check: (c) => guiRuns(c).some((r) => { const l = atPath(r, '/api/orders'); return l.length >= 5 && l.every((s) => s.code === 201); }) },
        { id: 'jassert', text: 'Добавь в «Заказ» <b>Assertions → JSON Assertion</b>: Assert JSON Path exists <code>$.status</code>, галочка Additionally assert value, Expected Value <code>CREATED</code>. Запусти — проверка проходит.',
          check: (c) => guiRuns(c).some((r) => { const p = r.plan; const o = samplersAt(p, '/api/orders')[0]; const l = atPath(r, '/api/orders'); return o && applying(p, 'jassert', o).some((a) => a.p.validate && a.p.path.trim() === '$.status' && a.p.expected.trim() === 'CREATED' && !a.p.invert) && l.length >= 5 && allOk(l); }) },
      ],
      hints: [
        'Корреляция: значение из ответа одного запроса (токен) извлекают и подставляют в следующий. Записанный когда-то токен давно отозван.',
        'Post Processors → JSON Extractor внутри «Вход» положит значение $.token в переменную token своего потока. Использование: ${token}.',
        '«Вход» → ➕ Add → Post Processors → JSON Extractor: names <b>token</b>, path <b>$.token</b>. HTTP Header Manager внутри «Заказ» → Value: <b>Bearer ${token}</b> → ▶ Start. «Заказ» → ➕ Add → Assertions → JSON Assertion: <b>$.status</b>, ✓ Additionally assert value, Expected <b>CREATED</b> → ▶ Start.',
      ],
      outro: 'Не работает «записанный» сценарий — ищи динамические значения: токены, id сессий, CSRF.',
    },
    {
      id: 'jm-13', title: 'Once Only и Transaction Controller', giver: G, gold: 160,
      setup: {
        select: 'Thread Group',
        plan: plan(() => [TG({ threads: '5', rampup: '1', loops: '5' }, [HCT(), CSV(),
          H('Вход', 'POST', '/api/login', { body: LOGIN_VARS }, [E('jextract', 'JSON Extractor', { ref: 'token', path: '$.token' })]),
          H('Каталог', 'GET', '/api/products'),
          H('Заказ', 'POST', '/api/orders', { body: ORDER_BODY }, [E('headers', 'HTTP Header Manager', { list: [['Authorization', 'Bearer ${token}']] })]),
          E('aggregate')])]),
      },
      steps: [
        { id: 'once', text: 'Логиниться нужно один раз за поток, а не на каждой итерации. Добавь <b>Logic Controller → Once Only Controller</b>, перенеси в него «Вход» (Cut → выдели контроллер → Paste) и подними контроллер выше запросов (Move Up).',
          check: (c) => { const p = c.state.plan; const l = samplersAt(p, '/api/login')[0]; const o = samplersAt(p, '/api/orders')[0]; if (!l || !o) return false; const ord = all(p).map((x) => x.id); return ancestors(p, l).some((a) => a.type === 'once') && ord.indexOf(l.id) < ord.indexOf(o.id); } },
        { id: 'txn', text: 'Добавь <b>Logic Controller → Transaction Controller</b> с именем <code>Покупка</code> и перенеси в него «Каталог» и «Заказ».',
          check: (c) => { const p = c.state.plan; return els(p, 'txn').some((t) => all(t, (x) => x.type === 'http' && ['/api/products', '/api/orders'].includes(normPath(x.p.path))).length >= 2); } },
        { id: 'run', text: 'Запусти: «Вход» выполнится 5 раз (по разу на поток), «Заказ» — 25 раз, без ошибок.',
          check: (c) => guiRuns(c).some((r) => atPath(r, '/api/login').length === tg(r).threads && tg(r).threads >= 1 && atPath(r, '/api/orders').length === tg(r).threads * tg(r).loops && txns(r).length === atPath(r, '/api/orders').length && allOk(r.samples)) },
        { id: 'avg', text: 'Какое <b>Average</b> у строки транзакции в Aggregate Report?',
          answer: { kind: 'text', placeholder: 'мс', accept: (v, c) => nearAny(v, seen(c, txns, 'avg'), (y) => Math.max(2, y * 0.02)), wrong: 'Строка с именем Transaction Controller в Aggregate Report, колонка Average.' } },
      ],
      hints: [
        'Once Only Controller выполняет содержимое только на первой итерации потока. Transaction Controller добавляет в отчёт строку с суммарным временем вложенных запросов — время бизнес-операции.',
        'Перенос элемента: выдели его → ✂ Cut, выдели новый родитель → 📋 Paste (вставит последним). Порядок меняется через Edit → Move Up / Move Down или правый клик.',
        'Thread Group → ➕ Add → Logic Controller → Once Only Controller; «Вход» → ✂ Cut → Once Only Controller → 📋 Paste; Once Only Controller → Move Up до места перед «Каталог». Thread Group → ➕ Add → Logic Controller → Transaction Controller, Name: <b>Покупка</b>; «Каталог» и «Заказ» → Cut/Paste внутрь. ▶ Start → Aggregate Report → Average строки «Покупка».',
      ],
    },
    {
      id: 'jm-14', title: 'Точка насыщения', giver: G, gold: 170,
      setup: {
        select: 'Thread Group',
        server: SAT_SERVER,
        plan: plan(() => [TG({ threads: '25', rampup: '30', infinite: true, lifetime: true, duration: '120' }, [E('urtimer', 'Uniform Random Timer', { range: '1000', offset: '500' }), H('Каталог', 'GET', '/api/products'), E('aggregate')])]),
      },
      steps: [
        { id: 'good', text: 'SLA: <b>95% Line &lt; 1000 мс</b> и <b>Error % &lt; 1%</b> (строка TOTAL). Запусти с 25 потоками — SLA выполняется. Между прогонами жми 🧹 Clear All, иначе Aggregate Report смешает результаты.',
          check: (c) => doneRuns(c).some((r) => slaRun(r) && slaGood(r) && tg(r).threads >= 25) },
        { id: 'bad', text: 'Увеличивай Number of Threads (например, 50 → 100 → 150 → 200), пока SLA не нарушится.', check: (c) => { const rs = doneRuns(c).filter(slaRun); return rs.some((b) => !slaGood(b) && rs.some((g) => slaGood(g) && tg(g).threads < tg(b).threads)); } },
        { id: 'narrow', text: 'Сузь границу: нужны прогон, который проходит SLA, и прогон, который нарушает, с разницей не больше <b>20</b> потоков.', check: (c) => satPairs(c).length > 0 },
        { id: 'answer', text: 'Сколько пользователей выдерживает сервис по этому SLA? (число потоков)',
          answer: { kind: 'text', placeholder: 'потоков', accept: (v, c) => { const x = parseNum(v); return satPairs(c).some(([g, b]) => x >= g && x < b); }, wrong: 'Ответ — между последним прогоном, который проходит SLA, и первым, который нарушает.' } },
      ],
      hints: [
        'Точку насыщения ищут ступенями: повышаешь нагрузку и смотришь, где 95% Line и ошибки начинают резко расти. Остальные настройки между прогонами не меняй.',
        'Меняй только Number of Threads. Прогоны 50/100/150/200 покажут грубую границу, затем шаги по 10–20 потоков между «ещё проходит» и «уже нет».',
        'Пример: 25 ✓ → 100 ✓ → 200 ✗ → 150 ✓/✗ → … пока разница между ✓ и ✗ не станет ≤ 20. 🧹 Clear All перед каждым ▶ Start. Ответ — последнее число потоков, при котором SLA выполнялся.',
      ],
      outro: 'Ответ «сколько выдержит» всегда привязан к SLA и профилю нагрузки.',
    },
    {
      id: 'jm-15', title: 'Стресс-тест и деградация', giver: G, gold: 180,
      setup: {
        select: 'Thread Group',
        server: SAT_SERVER,
        plan: plan(() => [TG({ threads: '300', rampup: '150', infinite: true, lifetime: true, duration: '180' }, [E('urtimer', 'Uniform Random Timer', { range: '1000', offset: '500' }), H('Каталог', 'GET', '/api/products'), E('aggregate')])]),
      },
      steps: [
        { id: 'graphs', text: 'Добавь <b>Listener → Response Time Graph</b> и <b>Listener → Active Threads Over Time</b>.', check: (c) => els(c.state.plan, 'rtgraph').length > 0 && els(c.state.plan, 'atgraph').length > 0 },
        { id: 'stress', text: 'Запусти стресс: 300 потоков с плавным разгоном 150 с — нагрузка уходит выше точки насыщения. Сравни графики.',
          check: (c) => guiRuns(c).some((r) => tg(r).threads >= 250 && tg(r).rampup >= 60 && runHas(r, 'rtgraph') && runHas(r, 'atgraph') && errRate(real(r)) > 0.05 && !r.stopped) },
        { id: 'code', text: 'Какой <b>Response code</b> у большинства ошибок?',
          answer: { kind: 'text', placeholder: 'код', accept: (v, c) => { const r = guiRuns(c).filter((x) => tg(x).threads >= 250).pop(); if (!r) return false; const cnt = {}; real(r).filter((s) => !s.ok).forEach((s) => { cnt[s.code] = (cnt[s.code] || 0) + 1; }); const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; return !!top && String(v).trim() === String(top[0]); }, wrong: 'Добавь View Results Tree с галочкой Errors или посмотри коды у красных сэмплов.' } },
        { id: 'tput', text: 'Что происходит после точки насыщения?', answer: { kind: 'choice', options: ['Throughput растёт вместе с числом потоков без ограничений', 'Throughput упирается в потолок, а время ответа и доля ошибок растут вместе с числом активных потоков', 'Время ответа падает, потому что кэш прогрелся', 'Ничего: сервер просто медленнее принимает соединения'], accept: (v) => v === 1 } },
      ],
      hints: [
        'Стресс-тест специально выходит за пределы, чтобы увидеть, как система деградирует и какими ошибками отвечает.',
        'Response Time Graph — время ответа по ходу теста, Active Threads Over Time — сколько потоков работало в каждый момент. Сопоставь их по оси времени.',
        'Thread Group → ➕ Add → Listener → Response Time Graph и Active Threads Over Time → ▶ Start. Коды ошибок: Thread Group → ➕ Add → Listener → View Results Tree, галочка Errors → ▶ Start → <b>503</b>. Вывод — второй вариант.',
      ],
    },
    {
      id: 'jm-16', title: 'Ищем узкое место', giver: G, gold: 190,
      setup: {
        select: 'Thread Group',
        server: { pools: { categories: 1 }, cost: { categories: 45, search: 260 } },
        plan: plan(() => [TG({ threads: '1', rampup: '20', infinite: true, lifetime: true, duration: '90' }, [E('urtimer', 'Uniform Random Timer', { range: '600', offset: '200' }),
          H('HTTP Request', 'GET', '/api/products'), H('HTTP Request', 'GET', '/api/products/${__Random(1,500)}'), H('HTTP Request', 'GET', '/api/categories'), H('HTTP Request', 'GET', '/api/search', { params: [['q', 'эликсир']] }), E('aggregate')])]),
      },
      steps: [
        { id: 'names', text: 'Все запросы называются «HTTP Request» — в Aggregate Report они сольются в одну строку. Дай каждому понятное имя (поле Name).', check: (c) => { const hs = els(c.state.plan, 'http'); return hs.length >= 4 && new Set(hs.map((h) => h.name.trim())).size === hs.length; } },
        { id: 'base', text: 'Сделай базовый замер: 1 поток — запусти.', check: (c) => guiRuns(c).some((r) => tg(r).threads === 1 && new Set(real(r).map((s) => s.label)).size >= 4 && real(r).length >= 40) },
        { id: 'load', text: 'Теперь поставь 60 потоков, запусти и сравни 90% Line каждого запроса с базовым замером.', check: (c) => guiRuns(c).some((r) => tg(r).threads >= 60 && new Set(real(r).map((s) => s.label)).size >= 4 && !r.stopped) },
        { id: 'which', text: 'Какой эндпоинт — узкое место под нагрузкой?', answer: { kind: 'choice', options: ['/api/products', '/api/products/{id}', '/api/categories', '/api/search'], accept: (v) => v === 2, wrong: 'Узкое место — не самый медленный запрос, а тот, что деградирует сильнее всех при росте нагрузки.' } },
      ],
      hints: [
        'Узкое место — ресурс, который первым кончается под нагрузкой. Медленный сам по себе запрос и запрос, который деградирует, — разные вещи.',
        'Сравнивай не абсолютные значения, а во сколько раз выросли 90% Line каждого Label между 1 потоком и 60.',
        'Переименуй запросы (Каталог, Товар, Категории, Поиск) → Number of Threads <b>1</b> → ▶ Start → запиши 90% Line → 🧹 Clear All → <b>60</b> потоков → ▶ Start. Поиск остался ~300 мс, Категории выросли в разы — ответ <b>/api/categories</b>.',
      ],
      outro: 'Узкое место ищут по деградации относительно базового замера, а затем подтверждают метриками сервера.',
    },
    {
      id: 'jm-17', title: 'Тест стабильности (soak)', giver: G, gold: 205,
      setup: {
        select: 'Thread Group',
        server: { leak: 0.4, oomAfter: 12 },
        plan: plan(() => [TG({ threads: '30', rampup: '30', loops: '1' }, [E('urtimer', 'Uniform Random Timer', { range: '1000', offset: '1000' }), H('Каталог', 'GET', '/api/products'), H('Товар', 'GET', '/api/products/${__Random(1,500)}'), E('summary')])]),
      },
      steps: [
        { id: 'dur', text: 'Soak-тест — долгая ровная нагрузка. Поставь Loop Count = <b>Infinite</b>, включи Specify Thread lifetime и Duration ≥ <b>900</b> секунд (15 минут).', check: (c) => els(c.state.plan, 'threadgroup').some((t) => t.p.infinite && t.p.lifetime && num(t.p.duration) >= 900) },
        { id: 'graph', text: 'Добавь <b>Listener → Response Time Graph</b>.', check: (c) => els(c.state.plan, 'rtgraph').length > 0 },
        { id: 'run', text: 'Запусти и дождись конца (15 минут в симуляторе проходят за несколько секунд). Открой Response Time Graph.', check: (c) => guiRuns(c).some((r) => r.dur >= 890000 && !r.stopped && runHas(r, 'rtgraph') && tg(r).threads >= 30) },
        { id: 'what', text: 'Нагрузка всё время одинаковая. Что показывает график?', answer: { kind: 'choice', options: ['Время ответа стабильно — сервис готов', 'Время ответа растёт со временем при постоянной нагрузке, а к концу появляются 500 OutOfMemoryError — утечка памяти или ресурсов', 'Время растёт, потому что JMeter добавляет потоки', 'Это прогрев кэша, он закончится сам'], accept: (v) => v === 1 } },
      ],
      hints: [
        'Короткий тест не покажет утечку: она копится часами. Soak-тест держит обычную нагрузку долго и смотрит на тренд.',
        'Duration задаётся только с галочкой Specify Thread lifetime, Loop Count при этом — Infinite. Response Time Graph показывает среднее время по интервалам.',
        'Thread Group: ✓ Infinite, ✓ Specify Thread lifetime, Duration <b>900</b>. ➕ Add → Listener → Response Time Graph → ▶ Start → график ползёт вверх при ровной нагрузке, в Summary появились ошибки. Вывод — второй вариант.',
      ],
    },
    {
      id: 'jm-18', title: 'Constant Throughput Timer', giver: G, gold: 215,
      setup: {
        select: 'Constant Throughput Timer',
        plan: plan(() => [TG({ threads: '20', rampup: '10', infinite: true, lifetime: true, duration: '120' }, [E('cttimer', 'Constant Throughput Timer', { tput: '600', mode: 'this' }), H('Каталог', 'GET', '/api/products'), E('summary')])]),
      },
      steps: [
        { id: 'over', text: 'Нужно держать ровно 10 запросов в секунду (600 в минуту). Запусти план как есть и посмотри Throughput в Summary Report.', check: (c) => guiRuns(c).some((r) => liveAll(r.plan, (e) => e.type === 'cttimer' && e.p.mode === 'this' && num(e.p.tput) === 600).length && (stats(real(r)) || {}).tput > 15) },
        { id: 'fix', text: 'Исправь Constant Throughput Timer, чтобы суммарно выходило <b>10/sec</b> (±10% после разгона), и запусти.',
          check: (c) => guiRuns(c).some((r) => { if (!runHas(r, 'cttimer') || r.dur < 60000 || r.stopped) return false; const from = tg(r).rampup * 1000 + 5000; const l = real(r).filter((s) => s.t >= from); const rps = l.length / ((r.dur - from) / 1000); return rps >= 9 && rps <= 11; }) },
        { id: 'limit', text: 'Что сделает Constant Throughput Timer, если потоков не хватает на заданный RPS (1 поток, 600/мин, ответ 500 мс)?', answer: { kind: 'choice', options: ['Создаст дополнительные потоки', 'Ничего: таймер только добавляет паузы и не может ускорить потоки — нужно больше потоков', 'Ускорит ответы сервера', 'Остановит тест с ошибкой'], accept: (v) => v === 1 } },
      ],
      hints: [
        'Target throughput задаётся в сэмплах в минуту. Режим «this thread only» — это цель для каждого потока отдельно.',
        '20 потоков × 600/мин = 12000/мин, если сервер успевает. Выбери в Calculate Throughput based on режим «all active threads» или раздели цель на число потоков.',
        'Constant Throughput Timer → Calculate Throughput based on: <b>all active threads</b> (Target 600) или оставь «this thread only» и поставь <b>30</b> → 🧹 Clear All → ▶ Start → около 10/sec. Вывод — второй вариант.',
      ],
    },
    {
      id: 'jm-19', title: 'Non-GUI режим и HTML-отчёт', giver: G, gold: 230,
      setup: {
        select: 'Thread Group',
        plan: plan(() => [TG({ threads: '200', rampup: '60', infinite: true, lifetime: true, duration: '300' }, [E('urtimer', 'Uniform Random Timer', { range: '1000', offset: '500' }), H('Каталог', 'GET', '/api/products'), H('Товар', 'GET', '/api/products/${__Random(1,500)}'), E('vrt'), E('aggregate')])]),
      },
      steps: [
        { id: 'gui', text: 'Запусти большой прогон прямо в GUI (▶ Start) и открой Log Viewer (кнопка ⚠ на панели): JMeter предупреждает о View Results Tree.', check: (c) => guiRuns(c).some((r) => r.lag && r.samples.length >= 5000) && logHas(c, (e) => e.type === 'log-open') },
        { id: 'off', text: 'Отключи View Results Tree (выдели → ◐ Toggle или Edit → Disable): в нагрузочном прогоне он не нужен.', check: (c) => all(c.state.plan, (e) => e.type === 'vrt').length > 0 ? !els(c.state.plan, 'vrt').length : true },
        { id: 'save', text: 'Сохрани план: File → Save Test Plan as… → <code>plan.jmx</code>.', check: (c) => Object.entries(c.state.fs || {}).some(([n, f]) => /\.jmx$/.test(n) && f.jmx && !liveAll(f.jmx, (e) => e.type === 'vrt').length && els(f.jmx, 'threadgroup').length) },
        { id: 'cli', text: 'На вкладке «Терминал» запусти тест в CLI-режиме с HTML-отчётом: <code>jmeter -n -t plan.jmx -l results.jtl -e -o report</code>.', check: (c) => doneRuns(c).some((r) => r.cli && r.cli.e && r.cli.o && real(r).length >= 5000 && !liveAll(r.plan, (e) => e.type === 'vrt').length) },
        { id: 'report', text: 'Открой вкладку с отчётом <b>report/index.html</b>: APDEX, Statistics, графики.', check: (c) => logHas(c, (e) => e.type === 'report-open') },
        { id: 'why', text: 'Почему нагрузку запускают в CLI-режиме, а не в GUI?', answer: { kind: 'choice', options: ['В CLI-режиме сервер отвечает быстрее', 'GUI и слушатели вроде View Results Tree сами съедают CPU и память генератора нагрузки и искажают замеры; GUI — только для отладки плана', 'В GUI нельзя запустить больше 10 потоков', 'CLI-режим не учитывает ошибки'], accept: (v) => v === 1 } },
      ],
      hints: [
        'GUI-режим — для создания и отладки плана. Тяжёлые прогоны запускают из командной строки, результаты пишут в .jtl, а отчёт строят после теста.',
        'Ключи: -n — без GUI, -t — план, -l — файл результатов, -e -o — сгенерировать HTML-отчёт в пустую папку. Если папка уже есть — rm -rf report или ключ -f.',
        '▶ Start → ⚠ (Log Viewer). View Results Tree → ◐ Toggle. File → Save Test Plan as… → <b>plan.jmx</b> → Save. «Терминал»: <b>jmeter -n -t plan.jmx -l results.jtl -e -o report</b> → вкладка report/index.html. Вывод — второй вариант.',
      ],
      outro: 'Сравни время ответа в GUI и в CLI: GUI со слушателями сам добавляет задержку.',
    },
    {
      id: 'jm-20', title: 'Финал: проходит ли SLA', giver: G, gold: 250,
      setup: { server: FINAL_SERVER },
      steps: [
        { id: 'tg', text: 'Требования: <b>100</b> пользователей, Ramp-up <b>60</b> с, длительность <b>300</b> с (Infinite + Specify Thread lifetime). Создай такую Thread Group.',
          check: (c) => els(c.state.plan, 'threadgroup').some((t) => int(t.p.threads) === 100 && num(t.p.rampup) === 60 && t.p.infinite && t.p.lifetime && num(t.p.duration) === 300) },
        { id: 'flow', text: 'Сценарий: «Вход» (POST <code>/api/login</code>, пользователи из <code>users.csv</code>, Content-Type: application/json, токен — JSON Extractor) → «Каталог» (GET <code>/api/products</code>) → «Заказ» (POST <code>/api/orders</code>, тело <code>{"productId":42,"qty":1}</code>, <code>Authorization: Bearer ${token}</code>). «Каталог» и «Заказ» положи в Transaction Controller «Покупка».',
          check: (c) => finalPlanOk(c.state.plan) },
        { id: 'think', text: 'Добавь think time 1–3 с (Uniform Random Timer: Random Delay Maximum 2000, Constant Delay Offset 1000) и Aggregate Report.',
          check: (c) => { const p = c.state.plan; const o = samplersAt(p, '/api/orders')[0]; return !!o && meanDelay(p, o) >= 1000 && meanDelay(p, o) <= 3000 && els(p, 'aggregate').length > 0; } },
        { id: 'run', text: 'Запусти тест (в GUI или в CLI) и дождись конца.',
          check: (c) => doneRuns(c).some((r) => tg(r).threads === 100 && tg(r).duration === 300 && !r.stopped && finalPlanOk(r.plan) && txns(r).length >= 200 && allOk(atPath(r, '/api/login')) && !atPath(r, '/api/orders').some((s) => s.code === 401)) },
        { id: 'verdict', text: 'SLA: <b>95% Line транзакции «Покупка» &lt; 1500 мс</b> и <b>Error % (TOTAL) &lt; 1%</b>. Каков вывод по последнему прогону?',
          answer: { kind: 'choice', options: ['Проходит: оба критерия выполнены', 'Не проходит: 95% Line «Покупка» выше 1500 мс, ошибок меньше 1%', 'Не проходит: ошибок больше 1%, 95% Line в норме', 'Не проходит: нарушены оба критерия'],
            accept: (v, c) => { const r = doneRuns(c).filter((x) => tg(x).threads === 100 && tg(x).duration === 300 && finalPlanOk(x.plan) && txns(x).length >= 200).pop(); return !!r && v === finalVerdict(r); },
            wrong: 'Сверь 95% Line строки транзакции и Error % строки TOTAL в Aggregate Report последнего прогона.' } },
      ],
      hints: [
        'Собирай по частям и проверяй на 1–2 потоках с View Results Tree: сначала вход и токен, потом заказ, потом транзакция. Полную нагрузку — в конце.',
        'Нужны: Thread Group → HTTP Header Manager (Content-Type) и CSV Data Set Config (users.csv, username,password) → «Вход» с JSON Extractor (token, $.token) → Transaction Controller «Покупка» → «Каталог» и «Заказ» с HTTP Header Manager (Authorization: Bearer ${token}) → Uniform Random Timer → Aggregate Report.',
        'Test Plan → Thread Group: 100 / 60 / ✓ Infinite / ✓ Specify Thread lifetime / 300. В неё: HTTP Header Manager (Content-Type: application/json), CSV Data Set Config (users.csv; username,password), Uniform Random Timer (2000 / 1000), HTTP Request «Вход» (https, shop.load.test, POST /api/login, Body <b>{"username":"${username}","password":"${password}"}</b>) с JSON Extractor (token / $.token), Transaction Controller «Покупка» с «Каталог» (GET /api/products) и «Заказ» (POST /api/orders, Body {"productId":42,"qty":1}, свой Header Manager: Authorization = Bearer ${token}), Aggregate Report. ▶ Start → сравни 95% Line «Покупка» с 1500 и Error % TOTAL с 1%.',
      ],
      outro: 'Вывод по нагрузке — это цифры против SLA плюс найденное узкое место, а не «вроде работает».',
    },
  ];

  window.JMeterSim = { simulate, E, H, TG, stats, LEVELS, SERVER, HOST };

  Quest.create({ mode: 'jmeter', icon: '🗿', title: 'Нагрузка · JMeter', buildSim, levels: LEVELS });
})();
