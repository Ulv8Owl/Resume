// Симулятор Postman: коллекции и папки, окружения и области переменных, авторизация (в т.ч. наследование),
// тела запросов, Pre-request Script и Tests со скриптами pm.*, Console, Collection Runner с файлами данных, cURL.
(function () {
  'use strict';

  const Core = window.Core;
  const M = window.MockApi;
  const esc = Core.esc;

  const BASE = M.BASE;
  const OLD_BASE = 'https://old.chronicles.guild/v1';
  const BASIC = { username: 'admin', password: 's3cret' };
  const API_KEY = 'qa-key-42';
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const STATUS_TEXT = { 200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 406: 'Not Acceptable', 409: 'Conflict', 415: 'Unsupported Media Type', 422: 'Unprocessable Entity', 500: 'Internal Server Error' };
  // «Файлы на диске» для form-data
  const UPLOADS = {
    'avatar.png': { type: 'image/png', size: 48213 },
    'portrait.jpg': { type: 'image/jpeg', size: 73102 },
    'report.pdf': { type: 'application/pdf', size: 120544 },
  };
  // Файлы данных для Collection Runner
  const DATA_FILES = {
    'heroes.csv': 'name,class,level,expected\nУльрих,Воин,5,201\nМира,Жрец,1,201\n,Маг,3,400\nТарн,Ворон,2,400\nНулла,Плут,0,400\n',
    'heroes.json': '[\n  { "name": "Первый", "class": "Маг", "level": 1, "expected": 201 },\n  { "name": "Сотый", "class": "Паладин", "level": 100, "expected": 201 },\n  { "name": "Перебор", "class": "Воин", "level": 101, "expected": 400 }\n]\n',
  };
  const TREASURY = [
    { id: 1, item: 'Слеза дракона', amount: 1 },
    { id: 2, item: 'Золотые монеты', amount: 15400 },
    { id: 3, item: 'Свиток огня', amount: 12 },
  ];

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
  function hget(h, name) {
    const k = Object.keys(h || {}).find((x) => x.toLowerCase() === String(name).toLowerCase());
    return k === undefined ? undefined : h[k];
  }
  function guid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const byteLen = (s) => new TextEncoder().encode(s).length;

  // ---------- сервер: обёртка над MockApi с маршрутами, нужными уровням Postman ----------

  function createServer() {
    const api = M.create();
    const heroes = api.heroes;

    function reply(status, body, extra) {
      const text = body === undefined ? '' : JSON.stringify(body, null, 2);
      return {
        status,
        statusText: STATUS_TEXT[status] || '',
        headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'x-request-id': Math.random().toString(16).slice(2, 10) }, body === undefined ? { 'content-length': '0' } : {}, extra || {}),
        body: text,
        json: body,
        time: 40 + Math.round(Math.random() * 140),
      };
    }
    const bearerOk = (h) => String(hget(h, 'authorization') || '').trim() === `Bearer ${M.TOKEN}`;
    const unauthorized = () => reply(401, { error: 'Unauthorized' }, { 'www-authenticate': 'Bearer' });

    // Те же правила, что у HeroCreate в сервере (и тот же баг: нижняя граница level не проверяется).
    function heroErrors(b, partial) {
      if (typeof b !== 'object' || b === null || Array.isArray(b)) return [{ field: 'body', message: 'must be an object' }];
      const errors = [];
      const need = (f) => { if (!partial) errors.push({ field: f, message: 'required' }); };
      if (b.name === undefined) need('name');
      else if (typeof b.name !== 'string' || !b.name.trim()) errors.push({ field: 'name', message: 'required' });
      else if (b.name.length > 32) errors.push({ field: 'name', message: 'must be at most 32 characters' });
      if (b.class === undefined) need('class');
      else if (!M.CLASSES.includes(b.class)) errors.push({ field: 'class', message: `must be one of: ${M.CLASSES.join(', ')}` });
      if (b.level === undefined) need('level');
      else if (!Number.isInteger(b.level)) errors.push({ field: 'level', message: 'must be an integer' });
      else if (b.level > 100) errors.push({ field: 'level', message: 'must be <= 100' });
      if (b.guild !== undefined && b.guild !== null && typeof b.guild !== 'string') errors.push({ field: 'guild', message: 'must be a string or null' });
      if (partial) Object.keys(b).filter((k) => !['name', 'class', 'level', 'guild'].includes(k)).forEach((k) => errors.push({ field: k, message: 'unknown field' }));
      return errors;
    }

    function handle(req) {
      let url;
      try { url = new URL(req.url); } catch (e) { return { networkError: 'Invalid URL' }; }
      if (url.host !== new URL(BASE).host) return { networkError: `getaddrinfo ENOTFOUND ${url.hostname}` };
      const v1 = (url.origin + url.pathname + '/').startsWith(BASE + '/');
      const path = url.pathname.replace(/^\/v1/, '').replace(/\/$/, '') || '/';
      const method = String(req.method || 'GET').toUpperCase();
      const h = req.headers || {};
      const hasBody = req.body != null && String(req.body).trim() !== '';
      const ct = String(hget(h, 'content-type') || '');
      let m;

      if (v1) {
        const accept = hget(h, 'accept');
        if (accept && !/application\/json|\*\/\*|application\/\*/i.test(accept)) return reply(406, { error: 'Not Acceptable: only application/json is available' });
        const jsonRoute = /^\/(auth\/login|heroes(\/[^/]+)?)$/.test(path) && ['POST', 'PUT', 'PATCH'].includes(method);
        if (jsonRoute && hasBody && !/application\/json/i.test(ct)) return reply(415, { error: `Unsupported Media Type: ${ct || 'none'}. Use application/json` });

        if (path === '/auth/token') {
          if (method !== 'POST') return reply(405, { error: 'Method Not Allowed' });
          if (!/application\/x-www-form-urlencoded/i.test(ct)) return reply(415, { error: 'Use application/x-www-form-urlencoded' });
          const p = new URLSearchParams(req.body || '');
          if (p.get('grant_type') !== 'password') return reply(400, { error: 'unsupported_grant_type' });
          if (!p.get('username') || !p.get('password')) return reply(400, { error: 'invalid_request: username and password are required' });
          if (p.get('username') !== M.LOGIN.login || p.get('password') !== M.LOGIN.password) return reply(401, { error: 'invalid_grant' });
          return reply(200, { access_token: M.TOKEN, token_type: 'Bearer', expires_in: 3600 });
        }

        if ((m = path.match(/^\/heroes\/([^/]+)\/avatar$/))) {
          if (method !== 'POST') return reply(405, { error: 'Method Not Allowed' });
          if (!bearerOk(h)) return unauthorized();
          if (!/multipart\/form-data/i.test(ct)) return reply(415, { error: 'Use multipart/form-data' });
          if (!/^\d+$/.test(m[1])) return reply(400, { error: 'id must be an integer' });
          const hero = heroes.find((x) => x.id === Number(m[1]));
          if (!hero) return reply(404, { error: 'Hero not found' });
          const f = (req.form || []).find((x) => x.key === 'avatar');
          if (!f) return reply(400, { error: 'field "avatar" is required' });
          if (f.type !== 'file' || !f.value) return reply(400, { error: 'avatar must be a file' });
          const info = UPLOADS[f.value];
          if (!info || !/^image\/(png|jpeg)$/.test(info.type)) return reply(415, { error: 'avatar must be image/png or image/jpeg' });
          return reply(201, { heroId: hero.id, file: f.value, contentType: info.type, size: info.size }, { location: `/v1/heroes/${hero.id}/avatar` });
        }

        if (path === '/admin/stats') {
          if (method !== 'GET') return reply(405, { error: 'Method Not Allowed' });
          if (String(hget(h, 'authorization') || '').trim() !== 'Basic ' + b64(`${BASIC.username}:${BASIC.password}`)) return reply(401, { error: 'Unauthorized' }, { 'www-authenticate': 'Basic realm="admin"' });
          const byClass = {};
          heroes.forEach((x) => { byClass[x.class] = (byClass[x.class] || 0) + 1; });
          return reply(200, { heroes: heroes.length, byClass, avgLevel: Math.round(heroes.reduce((s, x) => s + x.level, 0) / heroes.length * 10) / 10 });
        }

        if (path === '/treasury') {
          if (method !== 'GET') return reply(405, { error: 'Method Not Allowed' });
          const key = hget(h, 'x-api-key') || url.searchParams.get('api_key');
          if (!key) return reply(401, { error: 'API key is missing: X-Api-Key header or api_key query param' });
          if (key !== API_KEY) return reply(403, { error: 'Invalid API key' });
          return reply(200, TREASURY);
        }

        if ((m = path.match(/^\/heroes\/([^/]+)$/)) && (method === 'PUT' || method === 'PATCH')) {
          if (!bearerOk(h)) return unauthorized();
          if (!/^\d+$/.test(m[1])) return reply(400, { error: 'id must be an integer' });
          let b;
          try { b = hasBody ? JSON.parse(req.body) : undefined; } catch (e) { return reply(400, { error: 'Malformed JSON' }); }
          const hero = heroes.find((x) => x.id === Number(m[1]));
          if (!hero) return reply(404, { error: 'Hero not found' });
          if (method === 'PATCH' && (typeof b !== 'object' || b === null || Array.isArray(b) || !Object.keys(b).length)) return reply(400, { error: 'Body must be a non-empty JSON object' });
          const errors = heroErrors(b, method === 'PATCH');
          if (errors.length) return reply(400, { errors });
          if (method === 'PUT') {
            hero.name = b.name; hero.class = b.class; hero.level = b.level;
            hero.guild = b.guild === undefined ? null : b.guild;
          } else Object.keys(b).forEach((k) => { hero[k] = b[k]; });
          return reply(200, hero);
        }
      }
      return api.handle({ method, url: req.url, headers: h, body: hasBody ? req.body : null });
    }
    return { handle, heroes };
  }

  // ---------- переменные ----------
  // Каждая область хранится массивом [{ key, value }] — так же, как таблица в интерфейсе.

  const vget = (arr, k) => { const v = arr.find((x) => x.key === k); return v ? v.value : undefined; };
  function vset(arr, k, val) { const v = arr.find((x) => x.key === k); if (v) v.value = val; else arr.push({ key: k, value: val }); }
  function vunset(arr, k) { const i = arr.findIndex((x) => x.key === k); if (i >= 0) arr.splice(i, 1); }
  const vars = (o) => Object.entries(o).map(([key, value]) => ({ key, value }));
  const cloneScopes = (s) => ({ env: s.env ? s.env.map((x) => Object.assign({}, x)) : null, envName: s.envName, coll: s.coll.map((x) => Object.assign({}, x)), glob: s.glob.map((x) => Object.assign({}, x)) });

  const FIRST = ['Aria', 'Boris', 'Celia', 'Dorian', 'Elena', 'Felix', 'Greta', 'Hugo', 'Iris', 'Jonas'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const DYN = {
    $guid: guid,
    $randomUUID: guid,
    $timestamp: () => String(Math.floor(Date.now() / 1000)),
    $isoTimestamp: () => new Date().toISOString(),
    $randomInt: () => String(Math.floor(Math.random() * 1001)),
    $randomFirstName: () => pick(FIRST),
    $randomEmail: () => `${pick(FIRST).toLowerCase()}${Math.floor(Math.random() * 100)}@example.com`,
    $randomAlphaNumeric: () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)],
    $randomBoolean: () => String(Math.random() < 0.5),
  };

  // Приоритет Postman: Local → Data → Environment → Collection → Global.
  function lookup(name, run, sc) {
    if (name[0] === '$') return DYN[name] ? DYN[name]() : undefined;
    let v = vget(run.local, name);
    if (v !== undefined) return v;
    if (run.data && hasOwn(run.data, name)) return run.data[name];
    if (sc.env) { v = vget(sc.env, name); if (v !== undefined) return v; }
    v = vget(sc.coll, name);
    if (v !== undefined) return v;
    return vget(sc.glob, name);
  }
  function resolve(str, run, sc) {
    let s = String(str == null ? '' : str);
    for (let i = 0; i < 3 && /\{\{[^{}]+\}\}/.test(s); i++) {
      s = s.replace(/\{\{([^{}]+)\}\}/g, (m0, k) => {
        const v = lookup(k.trim(), run, sc);
        return v === undefined ? m0 : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      });
    }
    return s;
  }

  // ---------- мини-chai и pm.* ----------

  class AssertionError extends Error { constructor(m) { super(m); this.name = 'AssertionError'; } }
  function show(v) {
    if (v === undefined) return 'undefined';
    if (typeof v === 'string') return `'${v}'`;
    if (typeof v === 'function') return '[Function]';
    try { const s = JSON.stringify(v); return s.length > 90 ? s.slice(0, 87) + '…' : s; } catch (e) { return String(v); }
  }
  function deepEq(a, b) {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => hasOwn(b, k) && deepEq(a[k], b[k]));
  }
  const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  function isType(v, t) {
    switch (t) {
      case 'integer': return Number.isInteger(v);
      case 'number': return typeof v === 'number' && Number.isFinite(v);
      case 'null': return v === null;
      case 'array': return Array.isArray(v);
      case 'object': return typeName(v) === 'object';
      default: return typeof v === t;
    }
  }

  // Подмножество JSON Schema (draft-07): type, required, properties, items, enum, const, границы, anyOf/oneOf/allOf.
  function validateSchema(v, s, p, errs) {
    p = p || 'data';
    errs = errs || [];
    if (!s || typeof s !== 'object') return errs;
    if (s.nullable && v === null) return errs;
    if (s.type) {
      const ts = [].concat(s.type);
      if (!ts.some((t) => isType(v, t))) { errs.push(`${p} should be ${ts.join(',')}`); return errs; }
    }
    if (s.enum && !s.enum.some((x) => deepEq(x, v))) errs.push(`${p} should be equal to one of the allowed values`);
    if (hasOwn(s, 'const') && !deepEq(s.const, v)) errs.push(`${p} should be equal to constant`);
    if (typeof v === 'string') {
      if (s.minLength !== undefined && v.length < s.minLength) errs.push(`${p} should NOT be shorter than ${s.minLength} characters`);
      if (s.maxLength !== undefined && v.length > s.maxLength) errs.push(`${p} should NOT be longer than ${s.maxLength} characters`);
      if (s.pattern && !new RegExp(s.pattern).test(v)) errs.push(`${p} should match pattern "${s.pattern}"`);
    }
    if (typeof v === 'number') {
      if (s.minimum !== undefined && v < s.minimum) errs.push(`${p} should be >= ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) errs.push(`${p} should be <= ${s.maximum}`);
      if (typeof s.exclusiveMinimum === 'number' && v <= s.exclusiveMinimum) errs.push(`${p} should be > ${s.exclusiveMinimum}`);
      if (typeof s.exclusiveMaximum === 'number' && v >= s.exclusiveMaximum) errs.push(`${p} should be < ${s.exclusiveMaximum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) errs.push(`${p} should NOT have fewer than ${s.minItems} items`);
      if (s.maxItems !== undefined && v.length > s.maxItems) errs.push(`${p} should NOT have more than ${s.maxItems} items`);
      if (Array.isArray(s.items)) s.items.forEach((it, i) => { if (i < v.length) validateSchema(v[i], it, `${p}[${i}]`, errs); });
      else if (s.items) v.forEach((x, i) => validateSchema(x, s.items, `${p}[${i}]`, errs));
    } else if (typeName(v) === 'object') {
      (s.required || []).forEach((k) => { if (!hasOwn(v, k)) errs.push(`${p} should have required property '${k}'`); });
      if (s.properties) Object.keys(s.properties).forEach((k) => { if (hasOwn(v, k)) validateSchema(v[k], s.properties[k], `${p}.${k}`, errs); });
      if (s.additionalProperties === false) Object.keys(v).forEach((k) => { if (!s.properties || !hasOwn(s.properties, k)) errs.push(`${p} should NOT have additional properties ('${k}')`); });
    }
    if (s.anyOf && !s.anyOf.some((x) => !validateSchema(v, x, p).length)) errs.push(`${p} should match some schema in anyOf`);
    if (s.oneOf && s.oneOf.filter((x) => !validateSchema(v, x, p).length).length !== 1) errs.push(`${p} should match exactly one schema in oneOf`);
    if (s.allOf) s.allOf.forEach((x) => validateSchema(v, x, p, errs));
    return errs;
  }
  const schemaMsg = (errs) => `expected data to satisfy schema but found following errors: \n${errs.join(', ')}`;

  function expect(actual, label) {
    let subj = actual;
    let neg = false;
    let deep = false;
    let any = false;
    const a = {};
    const pre = label ? `${label}: ` : '';
    const ok = (cond, msg, nmsg) => { if (neg ? cond : !cond) throw new AssertionError(pre + (neg ? nmsg : msg)); return a; };
    const def = (n, get) => Object.defineProperty(a, n, { get, configurable: true });
    ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'does', 'but', 'still', 'also', 'own', 'nested', 'all', 'itself'].forEach((w) => def(w, () => a));
    def('not', () => { neg = !neg; return a; });
    def('deep', () => { deep = true; return a; });
    def('any', () => { any = true; return a; });
    const S = () => show(subj);
    def('ok', () => ok(!!subj, `expected ${S()} to be truthy`, `expected ${S()} to be falsy`));
    def('true', () => ok(subj === true, `expected ${S()} to be true`, `expected ${S()} to not be true`));
    def('false', () => ok(subj === false, `expected ${S()} to be false`, `expected ${S()} to not be false`));
    def('null', () => ok(subj === null, `expected ${S()} to be null`, `expected ${S()} to not be null`));
    def('undefined', () => ok(subj === undefined, `expected ${S()} to be undefined`, `expected ${S()} to not be undefined`));
    def('NaN', () => ok(Number.isNaN(subj), `expected ${S()} to be NaN`, `expected ${S()} not to be NaN`));
    def('exist', () => ok(subj != null, `expected ${S()} to exist`, `expected ${S()} to not exist`));
    def('empty', () => {
      const e = typeof subj === 'string' || Array.isArray(subj) ? subj.length === 0 : subj && typeof subj === 'object' ? Object.keys(subj).length === 0 : false;
      return ok(e, `expected ${S()} to be empty`, `expected ${S()} not to be empty`);
    });
    a.equal = a.equals = a.eq = (v) => ok(deep ? deepEq(subj, v) : subj === v, `expected ${S()} to ${deep ? 'deeply ' : ''}equal ${show(v)}`, `expected ${S()} to not ${deep ? 'deeply ' : ''}equal ${show(v)}`);
    a.eql = a.eqls = (v) => ok(deepEq(subj, v), `expected ${S()} to deeply equal ${show(v)}`, `expected ${S()} to not deeply equal ${show(v)}`);
    a.a = a.an = (t) => {
      t = String(t).toLowerCase();
      const art = /^[aeiou]/.test(t) ? 'an' : 'a';
      return ok(typeName(subj) === t, `expected ${S()} to be ${art} ${t}`, `expected ${S()} not to be ${art} ${t}`);
    };
    const cmp = (cond, word, n) => {
      if (typeof subj !== 'number') throw new AssertionError(`${pre}expected ${S()} to be a number`);
      return ok(cond, `expected ${S()} to be ${word} ${n}`, `expected ${S()} to be not ${word} ${n}`);
    };
    a.above = a.gt = a.greaterThan = (n) => cmp(subj > n, 'above', n);
    a.below = a.lt = a.lessThan = (n) => cmp(subj < n, 'below', n);
    a.least = a.gte = a.greaterThanOrEqual = (n) => cmp(subj >= n, 'at least', n);
    a.most = a.lte = a.lessThanOrEqual = (n) => cmp(subj <= n, 'at most', n);
    a.within = (lo, hi) => cmp(subj >= lo && subj <= hi, 'within', `${lo}..${hi}`);
    a.closeTo = a.approximately = (n, d) => cmp(Math.abs(subj - n) <= d, 'close to', `${n} +/- ${d}`);
    const keysCheck = (subset) => (...ks) => {
      if (ks.length === 1 && Array.isArray(ks[0])) ks = ks[0];
      else if (ks.length === 1 && ks[0] && typeof ks[0] === 'object') ks = Object.keys(ks[0]);
      const own = subj && typeof subj === 'object' ? Object.keys(subj) : [];
      const c = any ? ks.some((k) => own.includes(k)) : subset ? ks.every((k) => own.includes(k)) : ks.length === own.length && ks.every((k) => own.includes(k));
      return ok(c, `expected ${S()} to have keys ${show(ks)}`, `expected ${S()} to not have keys ${show(ks)}`);
    };
    const members = (subset) => (arr) => {
      const c = Array.isArray(subj) && Array.isArray(arr) && arr.every((x) => subj.some((y) => deepEq(x, y))) && (subset || arr.length === subj.length);
      return ok(c, `expected ${S()} to have the same members as ${show(arr)}`, `expected ${S()} to not have the same members as ${show(arr)}`);
    };
    const include = (v) => {
      let c = false;
      if (typeof subj === 'string') c = subj.includes(String(v));
      else if (Array.isArray(subj)) c = subj.some((x) => deepEq(x, v));
      else if (subj && typeof subj === 'object' && v && typeof v === 'object') c = Object.keys(v).every((k) => deepEq(subj[k], v[k]));
      return ok(c, `expected ${S()} to include ${show(v)}`, `expected ${S()} to not include ${show(v)}`);
    };
    include.keys = keysCheck(true);
    include.members = members(true);
    a.include = a.includes = a.contain = a.contains = include;
    a.keys = a.key = keysCheck(false);
    a.members = members(false);
    a.string = (s) => ok(typeof subj === 'string' && subj.includes(s), `expected ${S()} to contain ${show(s)}`, `expected ${S()} to not contain ${show(s)}`);
    a.match = a.matches = (re) => ok(typeof subj === 'string' && re.test(subj), `expected ${S()} to match ${re}`, `expected ${S()} not to match ${re}`);
    a.oneOf = (list) => ok(list.some((x) => (deep ? deepEq(x, subj) : x === subj)), `expected ${S()} to be one of ${show(list)}`, `expected ${S()} to not be one of ${show(list)}`);
    a.property = a.ownProperty = a.haveOwnProperty = (name, ...rest) => {
      const has = subj != null && (typeof subj === 'object' || typeof subj === 'function') && name in Object(subj);
      const val = has ? subj[name] : undefined;
      if (rest.length) {
        const c = has && (deep ? deepEq(val, rest[0]) : val === rest[0]);
        ok(c, `expected ${S()} to have property '${name}' of ${show(rest[0])}, but got ${show(val)}`, `expected ${S()} to not have property '${name}' of ${show(rest[0])}`);
      } else ok(has, `expected ${S()} to have property '${name}'`, `expected ${S()} to not have property '${name}'`);
      if (has && !neg) subj = val;
      return a;
    };
    a.lengthOf = a.length = (n) => {
      const len = subj != null ? subj.length : undefined;
      return ok(len === n, `expected ${S()} to have a length of ${n} but got ${len}`, `expected ${S()} to not have a length of ${n}`);
    };
    a.instanceOf = a.instanceof = (C) => ok(subj instanceof C, `expected ${S()} to be an instance of ${C && C.name}`, `expected ${S()} to not be an instance of ${C && C.name}`);
    a.satisfy = a.satisfies = (fn) => ok(!!fn(subj), `expected ${S()} to satisfy the condition`, `expected ${S()} to not satisfy the condition`);
    a.jsonSchema = (schema) => { const errs = validateSchema(subj, schema); return ok(!errs.length, schemaMsg(errs), 'expected data to not satisfy schema'); };
    return a;
  }
  expect.fail = (m) => { throw new AssertionError(m || 'expect.fail()'); };

  function safeJson(s) { try { return s ? JSON.parse(s) : undefined; } catch (e) { return undefined; } }
  function jsonPath(j, path) {
    return String(path).split('.').filter(Boolean).reduce((o, k) => (o != null ? o[k.replace(/\[(\d+)\]/, '$1')] : undefined), j);
  }

  // pm.response.to.have.status(...), pm.response.to.be.ok и т.д.
  function respTo(r) {
    let neg = false;
    const t = {};
    const def = (n, get) => Object.defineProperty(t, n, { get });
    ['to', 'be', 'have', 'and', 'a', 'an', 'that', 'with', 'is'].forEach((w) => def(w, () => t));
    def('not', () => { neg = !neg; return t; });
    const ok = (cond, msg, nmsg) => { if (neg ? cond : !cond) throw new AssertionError(neg ? nmsg : msg); return t; };
    const code = r.code;
    t.status = (x) => {
      if (typeof x === 'string' && /^\d{3}$/.test(x.trim())) x = Number(x);
      return typeof x === 'number'
        ? ok(code === x, `expected response to have status code ${x} but got ${code}`, `expected response to not have status code ${x}`)
        : ok(r.status === x, `expected response to have status reason '${x}' but got '${r.status}'`, `expected response to not have status reason '${x}'`);
    };
    t.header = (n, v) => {
      const hv = hget(r.headers, n);
      if (v === undefined) return ok(hv !== undefined, `expected response to have header with key '${n}'`, `expected response to not have header with key '${n}'`);
      return ok(hv === v, `expected '${n}' response header to be '${v}' but got '${hv}'`, `expected '${n}' response header to not be '${v}'`);
    };
    t.body = (s) => {
      if (s === undefined) return ok(!!r.body, 'expected response to have content in body', 'expected response to not have content in body');
      return ok(typeof s === 'string' ? r.body === s : deepEq(safeJson(r.body), s), `expected response body to equal ${show(s)}`, `expected response body to not equal ${show(s)}`);
    };
    t.jsonBody = (path, val) => {
      const j = safeJson(r.body);
      if (j === undefined) return ok(false, 'expected response body to be a valid json', 'expected response body to not be a valid json');
      if (path === undefined) return ok(true, '', 'expected response body to not be a valid json');
      if (typeof path === 'object') return ok(deepEq(j, path), `expected response body json to equal ${show(path)}`, `expected response body json to not equal ${show(path)}`);
      const v = jsonPath(j, path);
      if (val === undefined) return ok(v !== undefined, `expected response body json to have path '${path}'`, `expected response body json to not have path '${path}'`);
      return ok(deepEq(v, val), `expected response body json at '${path}' to contain ${show(val)}`, `expected response body json at '${path}' to not contain ${show(val)}`);
    };
    t.jsonSchema = (schema) => {
      const j = safeJson(r.body);
      const errs = j === undefined ? ['response body is not JSON'] : validateSchema(j, schema);
      return ok(!errs.length, schemaMsg(errs), 'expected data to not satisfy schema');
    };
    const ranges = {
      ok: [(c) => c === 200, '200'], success: [(c) => c >= 200 && c < 300, '2XX'], info: [(c) => c >= 100 && c < 200, '1XX'],
      redirection: [(c) => c >= 300 && c < 400, '3XX'], clientError: [(c) => c >= 400 && c < 500, '4XX'], serverError: [(c) => c >= 500, '5XX'],
      error: [(c) => c >= 400, '4XX or 5XX'], accepted: [(c) => c === 202, '202'], badRequest: [(c) => c === 400, '400'],
      unauthorized: [(c) => c === 401, '401'], unauthorised: [(c) => c === 401, '401'], forbidden: [(c) => c === 403, '403'], notFound: [(c) => c === 404, '404'], rateLimited: [(c) => c === 429, '429'],
    };
    Object.keys(ranges).forEach((n) => def(n, () => ok(ranges[n][0](code), `expected response code to be ${ranges[n][1]} but found ${code}`, `expected response code to not be ${ranges[n][1]} but found ${code}`)));
    def('json', () => ok(/json/i.test(hget(r.headers, 'content-type') || '') && safeJson(r.body) !== undefined, 'expected response to have a valid json body', 'expected response to not be json'));
    def('withBody', () => ok(!!r.body, 'expected response to have content in body', 'expected response to not have content in body'));
    return t;
  }

  function responseApi(r) {
    const jsonErr = (m) => { const e = new Error(m); e.name = 'JSONError'; return e; };
    return {
      code: r.code,
      status: r.status,
      responseTime: r.time,
      responseSize: r.size,
      headers: {
        get: (n) => hget(r.headers, n),
        has: (n, v) => { const hv = hget(r.headers, n); return v === undefined ? hv !== undefined : hv === v; },
        toObject: () => Object.assign({}, r.headers),
        all: () => Object.entries(r.headers).map(([key, value]) => ({ key, value })),
        each: (fn) => Object.entries(r.headers).forEach(([key, value]) => fn({ key, value })),
        count: () => Object.keys(r.headers).length,
      },
      text: () => r.body,
      reason: () => r.status,
      json: () => {
        if (!r.body) throw jsonErr('No data, empty input at 1:1');
        try { return JSON.parse(r.body); } catch (e) { throw jsonErr(e.message); }
      },
      get to() { return respTo(r); },
    };
  }

  function requestApi(o) {
    const r = o.r;
    const rec = o.rec;
    const isPre = o.kind === 'pre';
    const list = () => (isPre
      ? r.headers.filter((x) => x.key && x.on !== false).map((x) => ({ key: x.key, value: x.value })).concat(rec.preHeaders)
      : Object.entries(rec.headers || {}).map(([key, value]) => ({ key, value })));
    const norm = (hd) => {
      if (typeof hd === 'string') { const i = hd.indexOf(':'); return i > 0 ? { key: hd.slice(0, i).trim(), value: hd.slice(i + 1).trim() } : null; }
      return hd && hd.key ? { key: String(hd.key), value: String(hd.value == null ? '' : hd.value) } : null;
    };
    const remove = (k) => {
      for (let i = rec.preHeaders.length - 1; i >= 0; i--) if (rec.preHeaders[i].key.toLowerCase() === String(k).toLowerCase()) rec.preHeaders.splice(i, 1);
    };
    const headers = {
      add: (hd) => { const x = norm(hd); if (isPre && x) rec.preHeaders.push(x); },
      upsert: (hd) => { const x = norm(hd); if (isPre && x) { remove(x.key); rec.preHeaders.push(x); } },
      remove: (k) => { if (isPre) remove(k); },
      get: (k) => { const f = list().filter((x) => x.key.toLowerCase() === String(k).toLowerCase()).pop(); return f ? f.value : undefined; },
      has: (k) => headers.get(k) !== undefined,
      toObject: () => Object.fromEntries(list().map((x) => [x.key, x.value])),
      all: list,
    };
    const urlStr = () => (isPre ? r.url : rec.url);
    return {
      id: r.id,
      name: r.name,
      method: r.method,
      url: { toString: urlStr, getPath: () => { try { return new URL(urlStr()).pathname; } catch (e) { return ''; } } },
      headers,
      body: { mode: r.body.mode, raw: r.body.raw, toString: () => r.body.raw },
    };
  }

  // Подставные имена закрывают доступ скрипта к странице.
  const BLOCKED = ['window', 'document', 'globalThis', 'self', 'top', 'parent', 'frames', 'opener', 'location', 'navigator', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'Core', 'MockApi', 'Quest', 'Progression', 'Supabase', 'supabase'];

  function fmtLog(v) {
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
  }

  // o: { kind: 'pre'|'test', r, run, rec, scopes, response, iterationCount }
  function runScript(code, o) {
    const rec = o.rec;
    const sc = o.scopes;
    const log = (level) => (...args) => rec.logs.push({ level, phase: o.kind, text: args.map(fmtLog).join(' ') });
    const con = { log: log('log'), info: log('info'), warn: log('warn'), error: log('error'), debug: log('log') };
    const change = (scope, key, value) => rec.varChanges.push({ scope, key, value, phase: o.kind });
    const scopeApi = (name, getArr) => ({
      get: (k) => { const a = getArr(); return a ? vget(a, k) : undefined; },
      set: (k, v) => {
        const a = getArr();
        if (!a) { con.warn(`pm.${name}.set('${k}'): окружение не выбрано (No Environment), значение не сохранено`); return; }
        vset(a, String(k), v);
        change(name, String(k), v);
      },
      unset: (k) => { const a = getArr(); if (a) { vunset(a, k); change(name, k, undefined); } },
      has: (k) => { const a = getArr(); return !!a && a.some((x) => x.key === k); },
      clear: () => { const a = getArr(); if (a) a.splice(0); },
      toObject: () => Object.fromEntries((getArr() || []).map((x) => [x.key, x.value])),
      replaceIn: (s) => resolve(s, o.run, sc),
    });
    const pmTest = (name, fn) => {
      if (typeof fn !== 'function') { rec.tests.push({ name: String(name), pass: false, error: 'pm.test: вторым аргументом нужна функция' }); return; }
      try { fn(); rec.tests.push({ name: String(name), pass: true }); } catch (e) { rec.tests.push({ name: String(name), pass: false, error: `${(e && e.name) || 'Error'}: ${e && e.message}` }); }
    };
    pmTest.skip = (name) => rec.tests.push({ name: String(name), pass: true, skipped: true });
    const pm = {
      environment: Object.assign(scopeApi('environment', () => sc.env), { name: sc.envName || '' }),
      collectionVariables: scopeApi('collectionVariables', () => sc.coll),
      globals: scopeApi('globals', () => sc.glob),
      variables: {
        get: (k) => lookup(k, o.run, sc),
        set: (k, v) => { vset(o.run.local, String(k), v); change('variables', String(k), v); },
        has: (k) => lookup(k, o.run, sc) !== undefined,
        unset: (k) => vunset(o.run.local, k),
        replaceIn: (s) => resolve(s, o.run, sc),
        toObject: () => Object.fromEntries(o.run.local.map((x) => [x.key, x.value])),
      },
      iterationData: {
        get: (k) => o.run.data[k],
        has: (k) => hasOwn(o.run.data, k),
        toObject: () => Object.assign({}, o.run.data),
      },
      info: { eventName: o.kind === 'pre' ? 'prerequest' : 'test', iteration: rec.iteration || 0, iterationCount: o.iterationCount || 1, requestName: o.r.name, requestId: o.r.id },
      request: requestApi(o),
      expect,
      test: pmTest,
      sendRequest: () => { throw new Error('pm.sendRequest в тренажёре недоступен: сделай отдельный запрос в коллекции и свяжи их переменной'); },
    };
    const resp = o.response;
    if (resp) pm.response = responseApi(resp);
    const tv4 = {
      error: null,
      validate(data, schema) { const e = validateSchema(data, schema); tv4.error = e.length ? { message: e[0] } : null; return !e.length; },
      validateResult(data, schema) { const e = validateSchema(data, schema); return { valid: !e.length, error: e.length ? { message: e[0] } : null }; },
    };
    // Старый синтаксис: tests["имя"] = условие; postman.setEnvironmentVariable(...)
    const testsObj = {};
    const postman = {
      setEnvironmentVariable: (k, v) => pm.environment.set(k, v),
      getEnvironmentVariable: (k) => pm.environment.get(k),
      clearEnvironmentVariable: (k) => pm.environment.unset(k),
      setGlobalVariable: (k, v) => pm.globals.set(k, v),
      getGlobalVariable: (k) => pm.globals.get(k),
      setNextRequest: () => con.warn('postman.setNextRequest в тренажёре не поддерживается'),
    };
    let error = '';
    try {
      const fn = new Function('pm', 'postman', 'console', 'tests', 'responseBody', 'responseCode', 'responseTime', 'responseHeaders', 'tv4', 'data', ...BLOCKED, '"use strict";\n' + code);
      fn.call(undefined, pm, postman, con, testsObj, resp ? resp.body : undefined, resp ? { code: resp.code, name: resp.status } : undefined,
        resp ? resp.time : undefined, resp ? Object.assign({}, resp.headers) : undefined, tv4, Object.assign({}, o.run.data));
    } catch (e) {
      error = `${(e && e.name) || 'Error'}: ${e && e.message}`;
    }
    Object.keys(testsObj).forEach((k) => rec.tests.push({ name: k, pass: !!testsObj[k], error: testsObj[k] ? '' : 'AssertionError: expected false to be truthy' }));
    return { error };
  }

  // ---------- данные для Runner ----------

  function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
  }
  function parseData(name, text) {
    if (/\.json$/i.test(name)) {
      const j = JSON.parse(text);
      if (!Array.isArray(j)) throw new Error('JSON-файл данных должен быть массивом объектов');
      return j;
    }
    const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
    const head = parseCsvLine(lines[0] || '');
    return lines.slice(1).map((l) => { const v = parseCsvLine(l); return Object.fromEntries(head.map((h, i) => [h.trim(), v[i] === undefined ? '' : v[i]])); });
  }

  // ---------- cURL ----------

  function shellSplit(s) {
    const out = [];
    let cur = '';
    let has = false;
    let q = null;
    s = s.replace(/\\\r?\n/g, ' ');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q === "'") { if (c === "'") q = null; else cur += c; continue; }
      if (q === '"') {
        if (c === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) { cur += s[++i]; continue; }
        if (c === '"') q = null; else cur += c;
        continue;
      }
      if (c === "'" || c === '"') { q = c; has = true; continue; }
      if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
      if (/\s/.test(c)) { if (has || cur) { out.push(cur); cur = ''; has = false; } continue; }
      cur += c;
    }
    if (q) throw new Error('незакрытая кавычка');
    if (has || cur) out.push(cur);
    return out;
  }

  function parseCurl(text) {
    const t = shellSplit(String(text).trim());
    if (t[0] !== 'curl') throw new Error('команда должна начинаться с curl');
    const o = { method: '', url: '', headers: [], data: null, urlenc: [], form: [], user: null };
    const needArg = (i) => { if (i >= t.length) throw new Error(`у флага ${t[i - 1]} нет значения`); return t[i]; };
    for (let i = 1; i < t.length; i++) {
      const a = t[i];
      if (a === '-X' || a === '--request') o.method = needArg(++i).toUpperCase();
      else if (a === '-H' || a === '--header') {
        const hv = needArg(++i);
        const k = hv.indexOf(':');
        if (k > 0) o.headers.push({ key: hv.slice(0, k).trim(), value: hv.slice(k + 1).trim() });
      } else if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii'].includes(a)) o.data = (o.data ? o.data + '&' : '') + needArg(++i);
      else if (a === '--data-urlencode') { const v = needArg(++i); const k = v.indexOf('='); o.urlenc.push(k > 0 ? { key: v.slice(0, k), value: v.slice(k + 1) } : { key: v, value: '' }); }
      else if (a === '-F' || a === '--form') {
        const v = needArg(++i);
        const k = v.indexOf('=');
        const key = k > 0 ? v.slice(0, k) : v;
        const val = k > 0 ? v.slice(k + 1) : '';
        if (val[0] === '@') o.form.push({ key, type: 'file', value: val.slice(1).replace(/^"|"$/g, '').split('/').pop() });
        else o.form.push({ key, type: 'text', value: val });
      } else if (a === '-u' || a === '--user') { const v = needArg(++i); const k = v.indexOf(':'); o.user = { username: k >= 0 ? v.slice(0, k) : v, password: k >= 0 ? v.slice(k + 1) : '' }; }
      else if (a === '--url') o.url = needArg(++i);
      else if (/^-/.test(a)) { /* --location, --compressed, -s, -i, -k… — на запрос не влияют */ }
      else if (!o.url) o.url = a;
    }
    if (!o.url) throw new Error('не найден URL');
    if (!/^https?:\/\//i.test(o.url)) o.url = 'http://' + o.url;
    if (!o.method) o.method = o.data !== null || o.urlenc.length || o.form.length ? 'POST' : 'GET';
    if (!METHODS.includes(o.method)) throw new Error(`метод ${o.method} не поддерживается`);
    return o;
  }

  // ---------- модель коллекции ----------

  let uidSeq = 0;
  const uid = () => 'n' + (++uidSeq);
  const emptyAuth = (type) => ({ type: type || 'inherit', token: '', username: '', password: '', key: '', value: '', in: 'header' });

  function syncFromUrl(r) {
    const i = r.url.indexOf('?');
    const q = i >= 0 ? r.url.slice(i + 1) : '';
    r.params = q ? q.split('&').filter(Boolean).map((p) => {
      const [k, ...v] = p.split('=');
      let key = k;
      let value = v.join('=');
      try { key = decodeURIComponent(k); value = decodeURIComponent(value); } catch (e) { /* оставляем как есть */ }
      return { key, value };
    }) : [];
    const base = i >= 0 ? r.url.slice(0, i) : r.url;
    const names = [];
    base.replace(/\/:([A-Za-z_]\w*)/g, (m0, k) => { names.push(k); return m0; });
    const pv = {};
    names.forEach((k) => { pv[k] = hasOwn(r.pathVars, k) ? r.pathVars[k] : ''; });
    r.pathVars = pv;
  }
  function urlFromParams(r) {
    const base = r.url.split('?')[0];
    const q = r.params.filter((p) => p.key).map((p) => `${p.key}=${p.value}`).join('&');
    r.url = q ? `${base}?${q}` : base;
  }

  function mkReq(name, method, url, o) {
    o = o || {};
    const r = { type: 'request', id: uid(), name, method, url: url || '', params: [], pathVars: Object.assign({}, o.pathVars), headers: (o.headers || []).map((h) => Object.assign({ on: true }, h)),
      auth: Object.assign(emptyAuth(), o.auth), body: Object.assign({ mode: 'none', lang: 'json', raw: '', form: [], urlenc: [] }, o.body), pre: o.pre || '', tests: o.tests || '' };
    syncFromUrl(r);
    return r;
  }
  const mkFolder = (name, items) => ({ type: 'folder', id: uid(), name, items: items || [] });

  const HERO_BODY = '{\n  "name": "",\n  "class": "",\n  "level": 1\n}';

  function baseWorkspace() {
    return {
      collection: {
        type: 'collection', id: 'col', name: 'Хроники API', auth: emptyAuth('none'), vars: [],
        items: [
          mkFolder('Auth', [
            mkReq('Логин', 'POST', '{{baseUrl}}/auth/login', { body: { mode: 'raw', raw: '{\n  "login": "",\n  "password": ""\n}' } }),
            mkReq('Кто я', 'GET', '{{baseUrl}}/me'),
          ]),
          mkFolder('Heroes', [
            mkReq('Список героев', 'GET', '{{baseUrl}}/heroes'),
            mkReq('Герой по id', 'GET', '{{baseUrl}}/heroes/:id'),
            mkReq('Создать героя', 'POST', '{{baseUrl}}/heroes', { body: { mode: 'raw', raw: HERO_BODY } }),
            mkReq('Обновить героя', 'PUT', '{{baseUrl}}/heroes/:id', { body: { mode: 'raw', raw: HERO_BODY } }),
            mkReq('Изменить героя', 'PATCH', '{{baseUrl}}/heroes/:id', { body: { mode: 'raw', raw: '{\n  "level": 10\n}' } }),
            mkReq('Удалить героя', 'DELETE', '{{baseUrl}}/heroes/:id'),
          ]),
        ],
      },
      envs: [
        { id: 'dev', name: 'Хроники · dev', values: vars({ baseUrl: BASE, token: '' }) },
        { id: 'stage', name: 'Хроники · stage', values: vars({ baseUrl: 'https://stage.chronicles.guild/v1', token: '' }) },
      ],
      activeEnv: 'dev',
      globals: [],
      files: Object.assign({}, DATA_FILES),
    };
  }

  function walk(node, fn, parent) {
    (node.items || []).forEach((x) => { fn(x, parent || node); if (x.type === 'folder') walk(x, fn, x); });
  }
  function findNode(ws, id) {
    if (id === 'col') return ws.collection;
    let f = null;
    walk(ws.collection, (x) => { if (x.id === id) f = x; });
    return f;
  }
  function parentOf(ws, id) {
    let p = null;
    walk(ws.collection, (x, par) => { if (x.id === id) p = par; });
    return p;
  }
  function requestsUnder(node) {
    const out = [];
    walk(node, (x) => { if (x.type === 'request') out.push(x); });
    return out;
  }
  const folderByName = (ws, name) => { let f = null; walk(ws.collection, (x) => { if (x.type === 'folder' && x.name === name) f = x; }); return f; };
  const reqByName = (ws, name) => { let f = null; walk(ws.collection, (x) => { if (x.type === 'request' && x.name === name) f = x; }); return f; };

  // ---------- сниппеты скриптов (как в панели Snippets) ----------

  const SNIPPETS = {
    tests: [
      ['Status code: Code is 200', 'pm.test("Status code is 200", function () {\n    pm.response.to.have.status(200);\n});'],
      ['Response body: JSON value check', 'pm.test("Your test name", function () {\n    var jsonData = pm.response.json();\n    pm.expect(jsonData.value).to.eql(100);\n});'],
      ['Response body: Contains string', 'pm.test("Body matches string", function () {\n    pm.expect(pm.response.text()).to.include("string_you_want_to_search");\n});'],
      ['Response headers: Content-Type header check', 'pm.test("Content-Type is present", function () {\n    pm.response.to.have.header("Content-Type");\n});'],
      ['Response time is less than 200ms', 'pm.test("Response time is less than 200ms", function () {\n    pm.expect(pm.response.responseTime).to.be.below(200);\n});'],
      ['Set an environment variable', 'pm.environment.set("variable_key", "variable_value");'],
      ['Set a collection variable', 'pm.collectionVariables.set("variable_key", "variable_value");'],
      ['Get a variable', 'pm.variables.get("variable_key");'],
    ],
    pre: [
      ['Set an environment variable', 'pm.environment.set("variable_key", "variable_value");'],
      ['Set a collection variable', 'pm.collectionVariables.set("variable_key", "variable_value");'],
      ['Set a local variable', 'pm.variables.set("variable_key", "variable_value");'],
      ['Add a request header', 'pm.request.headers.add({ key: "X-Header", value: "value" });'],
      ['Get an environment variable', 'pm.environment.get("variable_key");'],
    ],
  };

  const AUTH_LABEL = { inherit: 'Inherit auth from parent', none: 'No Auth', bearer: 'Bearer Token', basic: 'Basic Auth', apikey: 'API Key' };
  const COLL_DESC = `
    <p>Тестовый стенд гильдии: <code>${BASE}</code>.</p>
    <ul>
      <li>Логин в API: <code>${M.LOGIN.login}</code> / <code>${M.LOGIN.password}</code> → <code>POST /auth/login</code> возвращает Bearer-токен.</li>
      <li>OAuth-форма: <code>POST /auth/token</code> c полями <code>grant_type=password</code>, <code>username</code>, <code>password</code>.</li>
      <li>Админка: <code>GET /admin/stats</code> — Basic Auth, <code>${BASIC.username}</code> / <code>${BASIC.password}</code>.</li>
      <li>Казна: <code>GET /treasury</code> — API Key <code>${API_KEY}</code> в заголовке <code>X-Api-Key</code> или в query <code>api_key</code>.</li>
      <li>Аватар героя: <code>POST /heroes/:id/avatar</code> — form-data, поле <code>avatar</code> (файл PNG или JPEG).</li>
      <li>Герой (HeroCreate): <code>name</code> 1–32 символа, <code>class</code> из списка (${M.CLASSES.join(', ')}), <code>level</code> целое 1–100.</li>
    </ul>`;

  // ---------- симулятор ----------

  function buildSim(el, ctx, level) {
    const server = createServer();
    const ws = baseWorkspace();
    if (level && level.setup) level.setup(ws);
    ctx.state.ws = ws;
    ctx.state.server = server;
    const envOf = () => ws.envs.find((e) => e.id === ws.activeEnv) || null;
    Object.defineProperty(ctx.state, 'env', { get: () => { const e = envOf(); return e ? Object.fromEntries(e.values.map((x) => [x.key, x.value])) : {}; } });

    const S = {
      side: 'collections', view: null, reqTab: 'params', resTab: 'body', colTab: 'overview',
      closed: new Set(), console: [], consoleOpen: false, drafts: 0,
      runner: { target: 'col', iterations: 1, file: '', last: null },
    };
    let recSeq = 0;

    el.innerHTML = `
      <div class="postman">
        <div class="pm-top">
          <span class="pm-logo">◉ Postman</span>
          <span class="pm-ws">Академия QA</span>
          <span class="pm-top-acts">
            <button class="pm-tbtn" type="button" data-act="new">New</button>
            <button class="pm-tbtn" type="button" data-act="import">Import</button>
            <button class="pm-tbtn" type="button" data-act="runner">Runner</button>
          </span>
          <label class="pm-env"><span>Environment</span><select class="pm-env-sel" data-f="activeEnv" aria-label="Активное окружение"></select></label>
          <button class="pm-tbtn pm-eye" type="button" data-act="quicklook" title="Environment quick look" aria-label="Переменные">👁</button>
        </div>
        <div class="pm-main">
          <aside class="pm-side"></aside>
          <section class="pm-work"></section>
        </div>
        <div class="pm-console" hidden></div>
        <div class="pm-foot"><button type="button" data-act="console">▤ Console</button><span class="pm-foot-info"></span></div>
        <div class="pm-dlg-wrap" hidden></div>
      </div>`;
    const root = el.querySelector('.postman');
    const $ = (s) => root.querySelector(s);
    const side = $('.pm-side');
    const work = $('.pm-work');
    const dlg = $('.pm-dlg-wrap');
    const touch = () => ctx.emit({ type: 'state' });

    const liveScopes = () => { const e = envOf(); return { env: e ? e.values : null, envName: e ? e.name : '', coll: ws.collection.vars, glob: ws.globals }; };
    function effectiveAuth(r) {
      if (r.auth.type !== 'inherit') return Object.assign({}, r.auth, { source: 'request' });
      if (parentOf(ws, r.id)) return Object.assign({}, ws.collection.auth, { source: 'collection' });
      return Object.assign(emptyAuth('none'), { source: 'none' });
    }

    // ---------- выполнение запроса ----------

    function execute(r, o) {
      o = o || {};
      const scopes = liveScopes();
      const run = { local: [], data: o.data || {} };
      const rec = {
        id: ++recSeq, reqId: r.id, name: r.name, method: r.method, imported: !!r.imported, inRunner: !!o.inRunner,
        iteration: o.iteration || 0, data: run.data, envId: ws.activeEnv, envName: scopes.envName,
        logs: [], varChanges: [], tests: [], preHeaders: [], testError: '', preError: '',
        pre: r.pre, testsScript: r.tests, reqAuthType: r.auth.type, userHeaders: r.headers.map((h) => Object.assign({}, h)),
      };
      if (r.pre.trim()) rec.preError = runScript(r.pre, { kind: 'pre', r, run, rec, scopes, iterationCount: o.iterationCount }).error;
      const res = (s) => resolve(s, run, scopes);

      const qi = r.url.indexOf('?');
      const base = qi >= 0 ? r.url.slice(0, qi) : r.url;
      rec.rawUrl = base.replace(/\/:([A-Za-z_]\w*)/g, (m0, k) => (hasOwn(r.pathVars, k) ? '/' + r.pathVars[k] : m0)) + (qi >= 0 ? r.url.slice(qi) : '');
      let url = res(rec.rawUrl.trim());
      if (url && !/^[a-z]+:\/\//i.test(url)) url = 'http://' + url;
      const auth = effectiveAuth(r);
      rec.authType = auth.type;
      rec.authSource = auth.source;
      rec.authRaw = auth.type === 'bearer' ? auth.token : auth.type === 'basic' ? `${auth.username}:${auth.password}` : auth.type === 'apikey' ? `${auth.key}=${auth.value}` : '';
      if (auth.type === 'apikey' && auth.in === 'query' && auth.key) url += (url.includes('?') ? '&' : '?') + `${encodeURIComponent(res(auth.key))}=${encodeURIComponent(res(auth.value))}`;

      const H = {};
      const put = (k, v) => { Object.keys(H).filter((x) => x.toLowerCase() === k.toLowerCase()).forEach((x) => delete H[x]); H[k] = v; };
      let host = '';
      try { host = new URL(url).host; } catch (e) { host = url.replace(/^[a-z]+:\/\//i, '').split('/')[0]; }
      put('User-Agent', 'PostmanRuntime/7.39.0');
      put('Accept', '*/*');
      put('Postman-Token', guid());
      put('Host', host);
      put('Accept-Encoding', 'gzip, deflate, br');
      put('Connection', 'keep-alive');
      if (auth.type === 'bearer') put('Authorization', `Bearer ${res(auth.token)}`);
      else if (auth.type === 'basic') put('Authorization', `Basic ${b64(`${res(auth.username)}:${res(auth.password)}`)}`);
      else if (auth.type === 'apikey' && auth.in !== 'query' && auth.key) put(res(auth.key), res(auth.value));
      r.headers.filter((h) => h.key && h.on !== false).forEach((h) => put(res(h.key), res(h.value)));
      rec.preHeaders.forEach((h) => put(res(h.key), res(h.value)));

      const b = r.body;
      let body = null;
      let form = null;
      let ctAuto = '';
      if (b.mode === 'raw' && b.raw.trim() !== '') { body = res(b.raw); ctAuto = b.lang === 'json' ? 'application/json' : 'text/plain'; }
      else if (b.mode === 'urlencoded') {
        const rows = b.urlenc.filter((x) => x.key && x.on !== false);
        if (rows.length) { body = rows.map((x) => `${encodeURIComponent(res(x.key))}=${encodeURIComponent(res(x.value))}`).join('&'); ctAuto = 'application/x-www-form-urlencoded'; }
      } else if (b.mode === 'formdata') {
        form = b.form.filter((x) => x.key && x.on !== false).map((x) => ({ key: res(x.key), type: x.type, value: x.type === 'file' ? x.value : res(x.value) }));
        if (form.length) {
          const bd = '--------------------------' + String(Math.random()).slice(2, 26);
          body = form.map((f) => `--${bd}\r\nContent-Disposition: form-data; name="${f.key}"` + (f.type === 'file'
            ? `; filename="${f.value}"\r\nContent-Type: ${(UPLOADS[f.value] || {}).type || 'application/octet-stream'}\r\n\r\n<${f.value || 'файл не выбран'}>`
            : `\r\n\r\n${f.value}`)).join('\r\n') + `\r\n--${bd}--`;
          ctAuto = `multipart/form-data; boundary=${bd}`;
        } else form = null;
      }
      if (body !== null && ctAuto && hget(H, 'content-type') === undefined) put('Content-Type', ctAuto);
      if (body !== null && !form) put('Content-Length', String(byteLen(body)));

      Object.assign(rec, { url, headers: H, body, form, bodyMode: b.mode, bodyLang: b.lang, bodyTemplate: b.mode === 'raw' ? b.raw : '' });
      try {
        const u = new URL(url);
        rec.host = u.host;
        rec.path = u.pathname.replace(/^\/v1/, '').replace(/\/$/, '') || '/';
        rec.query = Object.fromEntries(u.searchParams);
      } catch (e) { rec.host = host; rec.path = ''; rec.query = {}; }
      try { rec.bodyJson = body !== null && b.mode === 'raw' ? JSON.parse(body) : undefined; } catch (e) { rec.bodyJson = undefined; }

      let resp;
      if (!url.trim()) resp = { networkError: 'Invalid URL: адрес запроса пуст' };
      else {
        try { new URL(url); resp = server.handle({ method: r.method, url, headers: H, body, form }); } catch (e) { resp = { networkError: `getaddrinfo ENOTFOUND ${host}` }; }
      }
      if (resp.networkError) { rec.status = 0; rec.networkError = resp.networkError; }
      else {
        rec.status = resp.status;
        rec.statusText = resp.statusText;
        rec.json = resp.json;
        rec.time = resp.time;
        rec.res = { code: resp.status, status: resp.statusText, headers: resp.headers, body: resp.body, time: resp.time, size: byteLen(resp.body || '') + 160 };
        if (r.tests.trim()) rec.testError = runScript(r.tests, { kind: 'test', r, run, rec, scopes, response: rec.res, iterationCount: o.iterationCount }).error;
      }
      // Повторный прогон тестов игрока на изменённом ответе: так уровни проверяют, что тест действительно что-то ловит.
      rec.probe = (mut) => {
        if (!rec.res || !r.tests.trim()) return { tests: [], error: 'нет тестов' };
        const m = { code: rec.res.code, headers: Object.assign({}, rec.res.headers), json: clone(rec.json), time: rec.res.time };
        mut(m);
        const body2 = m.json === undefined ? '' : JSON.stringify(m.json, null, 2);
        const resp2 = { code: m.code, status: STATUS_TEXT[m.code] || '', headers: m.headers, body: body2, time: m.time, size: byteLen(body2) + 160 };
        const tmp = Object.assign({}, rec, { logs: [], varChanges: [], tests: [], preHeaders: rec.preHeaders.slice() });
        const out = runScript(rec.testsScript, { kind: 'test', r, run: { local: run.local.map((x) => Object.assign({}, x)), data: run.data }, rec: tmp, scopes: cloneScopes(scopes), response: resp2, iterationCount: o.iterationCount });
        return { tests: tmp.tests, error: out.error };
      };
      pushConsole(rec);
      return rec;
    }

    // ---------- консоль ----------

    function pushConsole(rec) {
      rec.logs.filter((l) => l.phase === 'pre').forEach((l) => S.console.push({ kind: 'log', level: l.level, text: l.text }));
      if (rec.preError) S.console.push({ kind: 'log', level: 'error', text: `Pre-request Script: ${rec.preError}` });
      S.console.push({ kind: 'req', rec });
      rec.logs.filter((l) => l.phase === 'test').forEach((l) => S.console.push({ kind: 'log', level: l.level, text: l.text }));
      if (rec.testError) S.console.push({ kind: 'log', level: 'error', text: `Tests: ${rec.testError}` });
      if (S.console.length > 300) S.console.splice(0, S.console.length - 300);
      renderFoot();
      if (S.consoleOpen) renderConsole();
    }
    const kvRows = (o) => Object.entries(o || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
    function renderConsole() {
      const box = $('.pm-console');
      box.hidden = !S.consoleOpen;
      if (!S.consoleOpen) return;
      const items = S.console.map((c) => {
        if (c.kind === 'log') return `<div class="pm-log l-${c.level}"><span>${c.level}</span><pre>${esc(c.text)}</pre></div>`;
        const r = c.rec;
        return `<details class="pm-centry"><summary><span class="pm-m m-${r.method.toLowerCase()}">${r.method}</span><span class="pm-curl">${esc(r.url)}</span>
          ${r.networkError ? '<b class="pm-cerr">Error</b>' : `<b class="pm-status s${String(r.status)[0]}">${r.status}</b><span class="pm-ctime">${r.time} ms</span>`}</summary>
          <div class="pm-cbody">
            ${r.networkError ? `<p class="pm-cerr">Error: ${esc(r.networkError)}</p>` : ''}
            <p class="pm-sub">Request Headers</p><table class="pm-kv">${kvRows(r.headers)}</table>
            ${r.body !== null ? `<p class="pm-sub">Request Body</p><pre class="pm-json">${esc(r.body)}</pre>` : ''}
            ${r.res ? `<p class="pm-sub">Response Headers</p><table class="pm-kv">${kvRows(r.res.headers)}</table><p class="pm-sub">Response Body</p>${r.res.body ? `<pre class="pm-json">${esc(r.res.body)}</pre>` : '<p class="pm-note">пусто</p>'}` : ''}
          </div></details>`;
      }).join('');
      box.innerHTML = `<div class="pm-console-head"><b>Console</b><span class="pm-note">сырые запросы и console.log из скриптов</span><button type="button" data-act="console-clear">Clear</button><button type="button" data-act="console" aria-label="Закрыть консоль">✕</button></div>
        <div class="pm-console-list">${items || '<p class="pm-note">Пока пусто. Отправь запрос — здесь появится всё, что реально ушло на сервер.</p>'}</div>`;
      const list = box.querySelector('.pm-console-list');
      list.scrollTop = list.scrollHeight;
    }
    function renderFoot() {
      const n = S.console.filter((c) => c.kind === 'req').length;
      $('.pm-foot-info').textContent = n ? `Запросов в консоли: ${n}` : '';
    }

    // ---------- боковая панель ----------

    function renderEnvSelect() {
      const sel = $('.pm-env-sel');
      sel.innerHTML = '<option value="">No Environment</option>' + ws.envs.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
      sel.value = ws.activeEnv || '';
    }

    function treeHtml(node, depth) {
      return node.items.map((x) => {
        const active = S.view && S.view.kind === 'request' && S.view.req === x;
        if (x.type === 'folder') {
          const open = !S.closed.has(x.id);
          return `<li class="pm-folder"><div class="pm-node" style="--d:${depth}">
              <button type="button" class="pm-node-name" data-act="toggle" data-id="${x.id}" aria-expanded="${open}">${open ? '▾' : '▸'} 📁 ${esc(x.name)}</button>
              <span class="pm-node-acts"><button type="button" data-act="add-req" data-id="${x.id}" title="Add request" aria-label="Добавить запрос в папку">＋</button><button type="button" data-act="run" data-id="${x.id}" title="Run folder" aria-label="Запустить папку">▶</button><button type="button" data-act="menu" data-id="${x.id}" title="Ещё" aria-label="Действия с папкой">⋯</button></span>
            </div>${open ? `<ul>${treeHtml(x, depth + 1)}</ul>` : ''}</li>`;
        }
        return `<li><div class="pm-node${active ? ' on' : ''}" style="--d:${depth}">
            <button type="button" class="pm-node-name" data-act="open" data-id="${x.id}"><span class="pm-m m-${x.method.toLowerCase()}">${x.method === 'DELETE' ? 'DEL' : x.method}</span>${esc(x.name)}</button>
            <span class="pm-node-acts"><button type="button" data-act="menu" data-id="${x.id}" title="Ещё" aria-label="Действия с запросом">⋯</button></span>
          </div></li>`;
      }).join('');
    }

    function renderSide() {
      const tabs = `<div class="pm-side-tabs"><button type="button" data-act="side" data-v="collections" class="${S.side === 'collections' ? 'on' : ''}">Collections</button><button type="button" data-act="side" data-v="environments" class="${S.side === 'environments' ? 'on' : ''}">Environments</button></div>`;
      if (S.side === 'collections') {
        const c = ws.collection;
        side.innerHTML = `${tabs}<div class="pm-tree">
          <div class="pm-node pm-colnode${S.view && S.view.kind === 'collection' ? ' on' : ''}">
            <button type="button" class="pm-node-name" data-act="open-col">🗂 ${esc(c.name)}</button>
            <span class="pm-node-acts"><button type="button" data-act="add-req" data-id="col" title="Add request" aria-label="Добавить запрос">＋</button><button type="button" data-act="add-folder" title="Add folder" aria-label="Добавить папку">📁</button><button type="button" data-act="run" data-id="col" title="Run collection" aria-label="Запустить коллекцию">▶</button></span>
          </div>
          <ul>${treeHtml(c, 1)}</ul></div>`;
      } else {
        side.innerHTML = `${tabs}<ul class="pm-envlist">
          <li><button type="button" class="${S.view && S.view.kind === 'globals' ? 'on' : ''}" data-act="open-glob">🌐 Globals</button></li>
          ${ws.envs.map((e) => `<li><button type="button" class="${S.view && S.view.kind === 'env' && S.view.id === e.id ? 'on' : ''}" data-act="open-env" data-id="${e.id}">${ws.activeEnv === e.id ? '✓' : '·'} ${esc(e.name)}</button></li>`).join('')}
        </ul><p class="pm-note">Активное окружение выбирается вверху справа. ✓ — активное.</p>`;
      }
    }

    // ---------- рабочая область ----------

    function renderWork() {
      const v = S.view;
      if (!v) { work.innerHTML = '<p class="pm-empty">Выбери запрос в коллекции слева или создай новый (New).</p>'; return; }
      if (v.kind === 'request') renderRequest();
      else if (v.kind === 'collection') renderCollection();
      else if (v.kind === 'env' || v.kind === 'globals') renderEnv();
      else if (v.kind === 'runner') renderRunner();
    }

    function crumbOf(r) {
      const p = parentOf(ws, r.id);
      if (!p) return 'Черновик (не сохранён)';
      return p.type === 'collection' ? ws.collection.name : `${ws.collection.name} / ${p.name}`;
    }

    const REQ_TABS = [['params', 'Params'], ['auth', 'Authorization'], ['headers', 'Headers'], ['body', 'Body'], ['pre', 'Pre-request Script'], ['tests', 'Tests']];
    function tabLabel(r, k, l) {
      if (k === 'params') { const n = r.params.length + Object.keys(r.pathVars).length; return n ? `${l} (${n})` : l; }
      if (k === 'headers') { const n = r.headers.filter((h) => h.key).length; return n ? `${l} (${n})` : l; }
      if (k === 'pre' || k === 'tests') return r[k].trim() ? `${l} <i class="pm-dot"></i>` : l;
      if (k === 'body' && r.body.mode !== 'none') return `${l} <i class="pm-dot"></i>`;
      return l;
    }

    function renderRequest() {
      const r = S.view.req;
      work.innerHTML = `
        <div class="pm-reqhead">
          <span class="pm-crumb">${esc(crumbOf(r))} /</span>
          <input class="pm-reqname" data-f="name" value="${esc(r.name)}" aria-label="Имя запроса" spellcheck="false">
          <span class="pm-head-acts">
            <button class="btn" type="button" data-act="save">Save</button>
            <button class="btn" type="button" data-act="saveas">Save As</button>
            <button class="btn" type="button" data-act="code" title="Code snippet" aria-label="Code snippet">&lt;/&gt;</button>
          </span>
        </div>
        <div class="pm-reqline">
          <select class="pm-method m-${r.method.toLowerCase()}" data-f="method" aria-label="Метод">${METHODS.map((m) => `<option${m === r.method ? ' selected' : ''}>${m}</option>`).join('')}</select>
          <input class="pm-url" type="text" data-f="url" value="${esc(r.url)}" spellcheck="false" placeholder="Enter URL or paste text" aria-label="URL запроса">
          <button class="btn attack pm-send" type="button" data-act="send">Send</button>
        </div>
        <div class="pm-tabs" role="tablist"></div>
        <div class="pm-tabpane"></div>
        <div class="pm-response"></div>`;
      renderTabs();
      renderPane();
      renderResponse();
    }
    function renderTabs() {
      const r = S.view.req;
      const box = work.querySelector('.pm-tabs');
      if (!box) return;
      // Кнопки обновляются на месте: если пересоздать их на blur редактора, клик по вкладке потеряется.
      if (!box.children.length) box.innerHTML = REQ_TABS.map(([k]) => `<button type="button" role="tab" data-act="tab" data-v="${k}"></button>`).join('');
      REQ_TABS.forEach(([k, l], i) => {
        const btn = box.children[i];
        const html = tabLabel(r, k, l);
        if (btn.innerHTML !== html) btn.innerHTML = html;
        btn.classList.toggle('on', S.reqTab === k);
        btn.setAttribute('aria-selected', String(S.reqTab === k));
      });
    }

    function kvTable(t, rows, opts) {
      opts = opts || {};
      return `<div class="pm-kvwrap"><table class="pm-kv"><thead><tr>${opts.check ? '<th class="pm-c"></th>' : ''}<th>${opts.kLabel || 'Key'}</th><th>${opts.vLabel || 'Value'}</th><th class="pm-c"></th></tr></thead><tbody>
        ${rows.map((x, i) => `<tr>${opts.check ? `<td class="pm-c"><input type="checkbox" data-f="${t}-on" data-i="${i}" ${x.on !== false ? 'checked' : ''} aria-label="Включить"></td>` : ''}
          <td><input data-f="${t}-k" data-i="${i}" ${opts.scope ? `data-scope="${opts.scope}"` : ''} value="${esc(x.key)}" placeholder="Key" spellcheck="false"></td>
          <td><input data-f="${t}-v" data-i="${i}" ${opts.scope ? `data-scope="${opts.scope}"` : ''} value="${esc(x.value == null ? '' : x.value)}" placeholder="Value" spellcheck="false"></td>
          <td class="pm-c"><button type="button" data-act="del-row" data-t="${t}" data-i="${i}" ${opts.scope ? `data-scope="${opts.scope}"` : ''} title="Удалить" aria-label="Удалить строку">✕</button></td></tr>`).join('')}
        </tbody></table></div><button type="button" class="pm-add" data-act="add-row" data-t="${t}" ${opts.scope ? `data-scope="${opts.scope}"` : ''}>+ Add</button>`;
    }

    function authPane(obj, scope) {
      const a = obj.auth;
      const types = scope === 'req' ? ['inherit', 'none', 'bearer', 'basic', 'apikey'] : ['none', 'bearer', 'basic', 'apikey'];
      const inp = (f, label, val, ph) => `<label class="pm-field"><span>${label}</span><input data-f="${f}" data-scope="${scope}" value="${esc(val)}" placeholder="${ph || ''}" spellcheck="false"></label>`;
      let body = '';
      if (a.type === 'inherit') {
        body = parentOf(ws, obj.id)
          ? `<p class="pm-note">Запрос использует авторизацию коллекции «${esc(ws.collection.name)}»: <b>${AUTH_LABEL[ws.collection.auth.type]}</b>. Она настраивается в коллекции → Authorization.</p>`
          : '<p class="pm-note">У черновика нет родителя — запрос уйдёт без авторизации. Сохрани его в коллекцию.</p>';
      } else if (a.type === 'none') body = '<p class="pm-note">Этот запрос не использует авторизацию.</p>';
      else if (a.type === 'bearer') body = inp('auth-token', 'Token', a.token, 'Token или {{переменная}}') + '<p class="pm-note">Postman добавит заголовок <code>Authorization: Bearer &lt;token&gt;</code>.</p>';
      else if (a.type === 'basic') body = inp('auth-user', 'Username', a.username) + inp('auth-pass', 'Password', a.password) + '<p class="pm-note">Postman закодирует <code>username:password</code> в Base64 и добавит <code>Authorization: Basic …</code>.</p>';
      else body = inp('auth-key', 'Key', a.key, 'например X-Api-Key') + inp('auth-val', 'Value', a.value) +
        `<label class="pm-field"><span>Add to</span><select data-f="auth-in" data-scope="${scope}"><option value="header"${a.in === 'header' ? ' selected' : ''}>Header</option><option value="query"${a.in === 'query' ? ' selected' : ''}>Query Params</option></select></label>`;
      return `<div class="pm-auth"><label class="pm-field"><span>Auth Type</span><select data-f="auth-type" data-scope="${scope}">${types.map((t) => `<option value="${t}"${t === a.type ? ' selected' : ''}>${AUTH_LABEL[t]}</option>`).join('')}</select></label>${body}</div>`;
    }

    function renderPane() {
      const r = S.view.req;
      const pane = work.querySelector('.pm-tabpane');
      if (!pane) return;
      const t = S.reqTab;
      if (t === 'params') {
        const pv = Object.keys(r.pathVars);
        pane.innerHTML = `<p class="pm-sub">Query Params</p>${kvTable('p', r.params)}
          ${pv.length ? `<p class="pm-sub">Path Variables</p><div class="pm-kvwrap"><table class="pm-kv"><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>
            ${pv.map((k) => `<tr><td><code>${esc(k)}</code></td><td><input data-f="pv" data-k="${esc(k)}" value="${esc(r.pathVars[k])}" placeholder="Value" spellcheck="false"></td></tr>`).join('')}</tbody></table></div>` : ''}`;
      } else if (t === 'auth') pane.innerHTML = authPane(r, 'req');
      else if (t === 'headers') {
        pane.innerHTML = kvTable('h', r.headers, { check: true }) + '<p class="pm-note">Скрытые заголовки Postman добавляет сам: User-Agent, Accept: */*, Postman-Token, Host, Accept-Encoding, Connection, а также Content-Type по типу Body и Authorization с вкладки Authorization.</p>';
      } else if (t === 'body') {
        const b = r.body;
        const modes = [['none', 'none'], ['formdata', 'form-data'], ['urlencoded', 'x-www-form-urlencoded'], ['raw', 'raw']];
        let inner = '';
        if (b.mode === 'none') inner = '<p class="pm-note">This request does not have a body</p>';
        else if (b.mode === 'raw') inner = `<textarea class="pm-body pm-code" data-f="body-raw" spellcheck="false" aria-label="Тело запроса" placeholder='{ "key": "value" }'>${esc(b.raw)}</textarea>`;
        else if (b.mode === 'urlencoded') inner = kvTable('u', b.urlenc, { check: true });
        else {
          inner = `<div class="pm-kvwrap"><table class="pm-kv"><thead><tr><th class="pm-c"></th><th>Key</th><th>Type</th><th>Value</th><th class="pm-c"></th></tr></thead><tbody>
            ${b.form.map((x, i) => `<tr><td class="pm-c"><input type="checkbox" data-f="f-on" data-i="${i}" ${x.on !== false ? 'checked' : ''} aria-label="Включить"></td>
              <td><input data-f="f-k" data-i="${i}" value="${esc(x.key)}" placeholder="Key" spellcheck="false"></td>
              <td><select data-f="f-type" data-i="${i}" aria-label="Тип поля"><option value="text"${x.type !== 'file' ? ' selected' : ''}>Text</option><option value="file"${x.type === 'file' ? ' selected' : ''}>File</option></select></td>
              <td>${x.type === 'file'
                ? `<select data-f="f-file" data-i="${i}" aria-label="Файл"><option value="">Select Files</option>${Object.keys(UPLOADS).map((f) => `<option${f === x.value ? ' selected' : ''}>${f}</option>`).join('')}</select>`
                : `<input data-f="f-v" data-i="${i}" value="${esc(x.value)}" placeholder="Value" spellcheck="false">`}</td>
              <td class="pm-c"><button type="button" data-act="del-row" data-t="f" data-i="${i}" title="Удалить" aria-label="Удалить строку">✕</button></td></tr>`).join('')}
            </tbody></table></div><button type="button" class="pm-add" data-act="add-row" data-t="f">+ Add</button>`;
        }
        pane.innerHTML = `<div class="pm-body-modes">${modes.map(([v, l]) => `<label><input type="radio" name="pm-bm" data-f="body-mode" value="${v}"${b.mode === v ? ' checked' : ''}> ${l}</label>`).join('')}
          ${b.mode === 'raw' ? `<select data-f="body-lang" aria-label="Формат raw"><option value="json"${b.lang === 'json' ? ' selected' : ''}>JSON</option><option value="text"${b.lang === 'text' ? ' selected' : ''}>Text</option></select>` : ''}</div>${inner}`;
      } else {
        const kind = t;
        pane.innerHTML = `<div class="pm-script">
            <textarea class="pm-code" data-f="${kind}" spellcheck="false" aria-label="${kind === 'pre' ? 'Pre-request Script' : 'Tests'}" placeholder="${kind === 'pre' ? '// выполняется ДО отправки запроса' : '// выполняется ПОСЛЕ ответа: pm.test(...)'}">${esc(r[kind])}</textarea>
            <aside class="pm-snips"><p class="pm-sub">Snippets</p>${SNIPPETS[kind].map(([l], i) => `<button type="button" data-act="snip" data-k="${kind}" data-i="${i}">${esc(l)}</button>`).join('')}</aside>
          </div>
          <p class="pm-note">${kind === 'pre' ? 'Скрипт выполнится перед отправкой: здесь готовят переменные и заголовки.' : 'Скрипт выполнится после ответа. Результаты — в Test Results под ответом.'} В новых версиях Postman это вкладка Scripts → ${kind === 'pre' ? 'Pre-request' : 'Post-response'}.</p>`;
      }
    }

    function renderResponse() {
      const box = work.querySelector('.pm-response');
      if (!box) return;
      const r = S.view.req;
      const rec = r._last;
      if (!rec) { box.innerHTML = '<p class="pm-empty">Response · Нажми Send, чтобы получить ответ.</p>'; return; }
      const pre = rec.preError ? `<p class="pm-neterr">There was an error in evaluating the Pre-request Script: ${esc(rec.preError)}</p>` : '';
      if (rec.networkError) {
        box.innerHTML = `${pre}<div class="pm-neterr"><b>Could not send request</b><p>Error: ${esc(rec.networkError)}</p><p class="pm-note">Подробности — в Console (внизу).</p></div>`;
        return;
      }
      const passed = rec.tests.filter((x) => x.pass).length;
      const failed = rec.tests.length - passed;
      const tl = rec.tests.length ? `Test Results <span class="${failed ? 'pm-red' : 'pm-green'}">(${passed}/${rec.tests.length})</span>` : 'Test Results';
      box.innerHTML = `${pre}
        <div class="pm-res-head">
          <div class="pm-res-tabs" role="tablist">
            <button type="button" data-act="rtab" data-v="body" class="${S.resTab === 'body' ? 'on' : ''}">Body</button>
            <button type="button" data-act="rtab" data-v="headers" class="${S.resTab === 'headers' ? 'on' : ''}">Headers (${Object.keys(rec.res.headers).length})</button>
            <button type="button" data-act="rtab" data-v="tests" class="${S.resTab === 'tests' ? 'on' : ''}">${tl}</button>
          </div>
          <span class="pm-meta"><span class="pm-status s${String(rec.status)[0]}">${rec.status} ${esc(rec.statusText)}</span><span>${rec.time} ms</span><span>${rec.res.size} B</span></span>
        </div>
        <div class="pm-res-body">${resBody(rec)}</div>`;
    }
    function testsHtml(rec) {
      const list = rec.tests.map((x) => `<li class="${x.skipped ? 'skip' : x.pass ? 'pass' : 'fail'}"><b>${x.skipped ? 'SKIPPED' : x.pass ? 'PASS' : 'FAIL'}</b><span>${esc(x.name)}${x.error ? ` <em>| ${esc(x.error)}</em>` : ''}</span></li>`).join('');
      const err = rec.testError ? `<p class="pm-neterr">There was an error in evaluating the test script: ${esc(rec.testError)}</p>` : '';
      return err + (list ? `<ul class="pm-tests">${list}</ul>` : (err ? '' : '<p class="pm-note">Тестов нет. Напиши их во вкладке Tests.</p>'));
    }
    function resBody(rec) {
      if (S.resTab === 'headers') return `<table class="pm-kv">${kvRows(rec.res.headers)}</table>`;
      if (S.resTab === 'tests') return testsHtml(rec);
      return rec.res.body ? `<pre class="pm-json">${esc(rec.res.body)}</pre>` : '<p class="pm-note">Тело ответа пустое.</p>';
    }

    function varsTable(arr, scope) {
      return kvTable('v', arr, { scope, kLabel: 'Variable', vLabel: 'Current value' }) + '<p class="pm-note">В запросах переменная пишется как <code>{{имя}}</code>; значение подставляется при отправке. Приоритет: Local → Data → Environment → Collection → Global.</p>';
    }

    function renderCollection() {
      const c = ws.collection;
      const tabs = [['overview', 'Overview'], ['auth', 'Authorization'], ['vars', 'Variables']];
      let pane = '';
      if (S.colTab === 'overview') pane = `<div class="pm-overview">${COLL_DESC}<p class="pm-note">Запросов в коллекции: ${requestsUnder(c).length}.</p></div>`;
      else if (S.colTab === 'auth') pane = authPane(c, 'col') + '<p class="pm-note">Все запросы с типом <b>Inherit auth from parent</b> получат эту авторизацию.</p>';
      else pane = varsTable(c.vars, 'coll');
      work.innerHTML = `<div class="pm-viewhead"><h4>🗂 ${esc(c.name)}</h4><button class="btn" type="button" data-act="run" data-id="col">▶ Run</button></div>
        <div class="pm-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" data-act="ctab" data-v="${k}" class="${S.colTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="pm-tabpane">${pane}</div>`;
    }

    function renderEnv() {
      const v = S.view;
      if (v.kind === 'globals') {
        work.innerHTML = `<div class="pm-viewhead"><h4>🌐 Globals</h4></div><p class="pm-note">Глобальные переменные видны во всех коллекциях и окружениях — самый широкий и самый слабый по приоритету scope.</p>${varsTable(ws.globals, 'glob')}`;
        return;
      }
      const e = ws.envs.find((x) => x.id === v.id);
      work.innerHTML = `<div class="pm-viewhead"><h4>${esc(e.name)}</h4>${ws.activeEnv === e.id ? '<span class="pm-pill">Active</span>' : `<button class="btn" type="button" data-act="env-activate" data-id="${e.id}">Set active</button>`}</div>${varsTable(e.values, 'env:' + e.id)}`;
    }

    // ---------- Runner ----------

    function targets() {
      const out = [{ id: 'col', label: ws.collection.name }];
      walk(ws.collection, (x) => { if (x.type === 'folder') out.push({ id: x.id, label: `${ws.collection.name} / ${x.name}` }); });
      return out;
    }
    function renderRunner() {
      const R = S.runner;
      if (!findNode(ws, R.target)) R.target = 'col';
      const node = findNode(ws, R.target);
      const reqs = requestsUnder(node);
      let rows = null;
      let fileErr = '';
      if (R.file) { try { rows = parseData(R.file, ws.files[R.file]); } catch (e) { fileErr = e.message; } }
      const preview = rows ? `<div class="pm-kvwrap"><table class="pm-kv"><thead><tr><th>#</th>${Object.keys(rows[0] || {}).map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>
        ${rows.map((x, i) => `<tr><td>${i + 1}</td>${Object.values(x).map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
      work.innerHTML = `<div class="pm-viewhead"><h4>▶ Collection Runner</h4></div>
        <div class="pm-runner">
          <div class="pm-run-cfg">
            <label class="pm-field"><span>Run</span><select data-f="run-target" aria-label="Что запускать">${targets().map((t) => `<option value="${t.id}"${t.id === R.target ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
            <p class="pm-sub">Run order</p>
            <ol class="pm-order">${reqs.map((x) => `<li><span class="pm-m m-${x.method.toLowerCase()}">${x.method}</span>${esc(x.name)}${x.tests.trim() ? '' : ' <em class="pm-note">— нет тестов</em>'}</li>`).join('') || '<li class="pm-note">В папке нет запросов</li>'}</ol>
            <label class="pm-field"><span>Iterations</span><input type="number" min="1" max="20" data-f="run-iter" value="${R.iterations}"></label>
            <label class="pm-field"><span>Data</span><select data-f="run-file" aria-label="Файл данных"><option value="">Select File</option>${Object.keys(ws.files).map((f) => `<option${f === R.file ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
            ${fileErr ? `<p class="pm-neterr">${esc(fileErr)}</p>` : preview ? `<p class="pm-sub">Preview · ${esc(R.file)}</p>${preview}` : ''}
            <button class="btn attack pm-runbtn" type="button" data-act="run-start" ${reqs.length ? '' : 'disabled'}>Run ${esc(node.name)}</button>
          </div>
          <div class="pm-run-res">${runResultsHtml(R.last)}</div>
        </div>`;
    }
    function runResultsHtml(run) {
      if (!run) return '<p class="pm-empty">Здесь появится отчёт прогона: каждый запрос каждой итерации и его тесты.</p>';
      const its = [];
      run.results.forEach((x) => { (its[x.iteration] = its[x.iteration] || []).push(x); });
      return `<div class="pm-run-sum"><b>${esc(run.target)}</b><span>Iterations: ${run.iterations}</span>${run.file ? `<span>Data: ${esc(run.file)}</span>` : ''}
          <span class="pm-green">Passed ${run.passed}</span><span class="pm-red">Failed ${run.failed}</span>${run.errors ? `<span class="pm-red">Errors ${run.errors}</span>` : ''}</div>
        ${its.map((list, i) => `<div class="pm-iter"><p class="pm-sub">Iteration ${i + 1}</p>${list.map((x) => `<div class="pm-run-item">
            <div class="pm-run-line"><span class="pm-m m-${x.method.toLowerCase()}">${x.method}</span><b>${esc(x.name)}</b><span class="pm-curl">${esc(x.url)}</span>
            ${x.networkError ? '<span class="pm-red">Error</span>' : `<span class="pm-status s${String(x.status)[0]}">${x.status} ${esc(x.statusText)}</span><span>${x.time} ms</span>`}</div>
            ${x.networkError ? `<p class="pm-neterr">${esc(x.networkError)}</p>` : testsHtml(x)}</div>`).join('')}</div>`).join('')}`;
    }
    function startRun() {
      const R = S.runner;
      const node = findNode(ws, R.target) || ws.collection;
      const reqs = requestsUnder(node);
      let rows = [];
      if (R.file) { try { rows = parseData(R.file, ws.files[R.file]); } catch (e) { rows = []; } }
      const n = Math.max(1, Math.min(20, Number(R.iterations) || 1));
      const results = [];
      for (let i = 0; i < n; i++) {
        const data = rows.length ? Object.assign({}, rows[Math.min(i, rows.length - 1)]) : {};
        reqs.forEach((r) => results.push(execute(r, { inRunner: true, data, iteration: i, iterationCount: n })));
      }
      const all = results.reduce((a, x) => a.concat(x.tests.filter((t) => !t.skipped)), []);
      const run = {
        type: 'run', targetId: node.id, target: node.type === 'collection' ? node.name : `${ws.collection.name} / ${node.name}`, iterations: n, file: R.file, rows: rows.length,
        results, passed: all.filter((t) => t.pass).length, failed: all.filter((t) => !t.pass).length,
        errors: results.filter((x) => x.testError || x.preError || x.networkError).length,
      };
      R.last = run;
      renderWork();
      ctx.emit(run);
    }

    // ---------- диалоги внутри Postman ----------

    function dialog(title, html, opts) {
      opts = opts || {};
      dlg.hidden = false;
      dlg.innerHTML = `<div class="pm-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="pm-dlg-head"><b>${esc(title)}</b><button type="button" data-dlg="close" aria-label="Закрыть">✕</button></div>
        <div class="pm-dlg-body">${html}</div>
        <div class="pm-dlg-foot">${opts.ok ? `<button class="btn attack" type="button" data-dlg="ok">${esc(opts.ok)}</button>` : ''}<button class="btn" type="button" data-dlg="close">${opts.ok ? 'Cancel' : 'Close'}</button></div></div>`;
      const close = () => { dlg.hidden = true; dlg.innerHTML = ''; dlg.onclick = null; dlg.onchange = null; };
      dlg.onclick = (e) => {
        if (e.target === dlg) { close(); return; }
        const b = e.target.closest('[data-dlg]');
        if (!b) return;
        if (b.dataset.dlg === 'close') close();
        else if (b.dataset.dlg === 'ok') { if (opts.onOk(dlg) !== false) close(); } else if (opts.onAct) opts.onAct(b.dataset.dlg, b);
      };
      dlg.onchange = opts.onChange ? (e) => opts.onChange(e.target) : null;
      const f = dlg.querySelector('input, textarea, select');
      if (f) f.focus();
      return close;
    }

    function folderOptions(sel) {
      const out = [`<option value="col"${sel === 'col' ? ' selected' : ''}>${esc(ws.collection.name)}</option>`];
      walk(ws.collection, (x) => { if (x.type === 'folder') out.push(`<option value="${x.id}"${sel === x.id ? ' selected' : ''}>${esc(ws.collection.name)} / ${esc(x.name)}</option>`); });
      return out.join('');
    }

    function saveDialog(r, asCopy) {
      const p = parentOf(ws, r.id);
      dialog(asCopy ? 'Save As' : 'Save Request', `
        <label class="pm-field"><span>Request name</span><input class="pm-dlg-name" value="${esc(asCopy ? r.name + ' (copy)' : r.name)}" spellcheck="false"></label>
        <label class="pm-field"><span>Save to</span><select class="pm-dlg-folder">${folderOptions(p ? p.id : 'col')}</select></label>`, {
        ok: 'Save',
        onOk: (box) => {
          const name = box.querySelector('.pm-dlg-name').value.trim() || r.name;
          const target = findNode(ws, box.querySelector('.pm-dlg-folder').value) || ws.collection;
          let saved = r;
          if (asCopy) {
            saved = JSON.parse(JSON.stringify(Object.assign({}, r, { _last: undefined })));
            saved.id = uid();
            saved.imported = false;
          } else if (p) p.items.splice(p.items.indexOf(r), 1);
          saved.name = name;
          target.items.push(saved);
          S.view = { kind: 'request', req: saved };
          S.closed.delete(target.id);
          renderSide();
          renderWork();
          setTimeout(() => ctx.emit({ type: 'save', reqId: saved.id, fromId: r.id, imported: !!r.imported, folderId: target.id, folder: target.name, name, asCopy: !!asCopy }), 0);
          return true;
        },
      });
    }

    function codeDialog(r) {
      const rec = buildPreview(r);
      const gen = (lang) => {
        const hs = Object.entries(rec.headers).filter(([k]) => !/^(user-agent|accept|postman-token|host|accept-encoding|connection|content-length)$/i.test(k) || (k.toLowerCase() === 'accept' && rec.headers[k] !== '*/*'));
        if (lang === 'curl') {
          const implicit = (r.method === 'GET' && rec.body === null && !rec.form) || (r.method === 'POST' && (rec.body !== null || !!rec.form));
          const lines = [`curl --location${implicit ? '' : ` --request ${r.method}`} '${rec.url}'`];
          hs.filter(([k]) => !(rec.form && /^content-type$/i.test(k))).forEach(([k, v]) => lines.push(`--header '${k}: ${v}'`));
          if (rec.form) rec.form.forEach((f) => lines.push(f.type === 'file' ? `--form '${f.key}=@"/Users/qa/${f.value}"'` : `--form '${f.key}="${f.value}"'`));
          else if (r.body.mode === 'urlencoded' && rec.body) r.body.urlenc.filter((x) => x.key && x.on !== false).forEach((x) => lines.push(`--data-urlencode '${x.key}=${resolve(x.value, { local: [], data: {} }, liveScopes())}'`));
          else if (rec.body !== null) lines.push(`--data '${rec.body.replace(/'/g, "'\\''")}'`);
          return lines.join(' \\\n');
        }
        if (lang === 'fetch') {
          return `const myHeaders = new Headers();\n${hs.map(([k, v]) => `myHeaders.append(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n')}\n\nconst requestOptions = {\n  method: "${r.method}",\n  headers: myHeaders,${rec.body !== null && !rec.form ? `\n  body: ${JSON.stringify(rec.body)},` : ''}\n  redirect: "follow"\n};\n\nfetch(${JSON.stringify(rec.url)}, requestOptions)\n  .then((response) => response.text())\n  .then((result) => console.log(result))\n  .catch((error) => console.error(error));`;
        }
        return `import requests\n\nurl = ${JSON.stringify(rec.url)}\n\npayload = ${rec.body !== null && !rec.form ? JSON.stringify(rec.body) : '{}'}\nheaders = {\n${hs.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n\nresponse = requests.request("${r.method}", url, headers=headers, data=payload)\n\nprint(response.text)`;
      };
      const LANGS = [['curl', 'cURL'], ['fetch', 'JavaScript - Fetch'], ['python', 'Python - Requests']];
      const showLang = (lang) => {
        dlg.querySelector('.pm-snippet').textContent = gen(lang);
        ctx.emit({ type: 'snippet', lang, reqId: r.id, method: r.method, code: gen(lang) });
      };
      dialog('Code snippet', `<label class="pm-field"><span>Language</span><select class="pm-dlg-lang">${LANGS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <pre class="pm-json pm-snippet"></pre><p class="pm-note">Переменные подставлены текущими значениями. Сниппет удобно приложить к баг-репорту.</p>`, {
        onChange: (t) => { if (t.classList.contains('pm-dlg-lang')) showLang(t.value); },
      });
      showLang('curl');
    }

    // Сборка запроса без отправки — для сниппета кода.
    function buildPreview(r) {
      const scopes = liveScopes();
      const run = { local: [], data: {} };
      const res = (s) => resolve(s, run, scopes);
      const qi = r.url.indexOf('?');
      const base = qi >= 0 ? r.url.slice(0, qi) : r.url;
      let url = res(base.replace(/\/:([A-Za-z_]\w*)/g, (m0, k) => (hasOwn(r.pathVars, k) ? '/' + r.pathVars[k] : m0)) + (qi >= 0 ? r.url.slice(qi) : ''));
      const H = {};
      const put = (k, v) => { Object.keys(H).filter((x) => x.toLowerCase() === k.toLowerCase()).forEach((x) => delete H[x]); H[k] = v; };
      const auth = effectiveAuth(r);
      if (auth.type === 'bearer') put('Authorization', `Bearer ${res(auth.token)}`);
      else if (auth.type === 'basic') put('Authorization', `Basic ${b64(`${res(auth.username)}:${res(auth.password)}`)}`);
      else if (auth.type === 'apikey' && auth.key) {
        if (auth.in === 'query') url += (url.includes('?') ? '&' : '?') + `${res(auth.key)}=${res(auth.value)}`;
        else put(res(auth.key), res(auth.value));
      }
      r.headers.filter((h) => h.key && h.on !== false).forEach((h) => put(res(h.key), res(h.value)));
      let body = null;
      let form = null;
      if (r.body.mode === 'raw' && r.body.raw.trim()) { body = res(r.body.raw); if (hget(H, 'content-type') === undefined) put('Content-Type', r.body.lang === 'json' ? 'application/json' : 'text/plain'); }
      else if (r.body.mode === 'urlencoded') {
        const rows = r.body.urlenc.filter((x) => x.key && x.on !== false);
        if (rows.length) { body = rows.map((x) => `${encodeURIComponent(res(x.key))}=${encodeURIComponent(res(x.value))}`).join('&'); if (hget(H, 'content-type') === undefined) put('Content-Type', 'application/x-www-form-urlencoded'); }
      } else if (r.body.mode === 'formdata') {
        form = r.body.form.filter((x) => x.key && x.on !== false).map((x) => ({ key: res(x.key), type: x.type, value: x.type === 'file' ? x.value : res(x.value) }));
        if (!form.length) form = null;
      }
      return { url, headers: H, body, form };
    }

    function importDialog() {
      dialog('Import', `<p class="pm-note">Вставь команду cURL (например, из баг-репорта или DevTools → Copy as cURL).</p>
        <textarea class="pm-code pm-dlg-curl" spellcheck="false" aria-label="Команда cURL" placeholder="curl --location 'https://…'"></textarea><p class="pm-neterr pm-dlg-err" hidden></p>`, {
        ok: 'Import',
        onOk: (box) => {
          const text = box.querySelector('.pm-dlg-curl').value;
          let p;
          try { p = parseCurl(text); } catch (e) {
            const er = box.querySelector('.pm-dlg-err');
            er.hidden = false;
            er.textContent = `Error while importing cURL: ${e.message}`;
            return false;
          }
          const o = { headers: p.headers.slice(), auth: { type: p.user ? 'basic' : 'none', username: p.user ? p.user.username : '', password: p.user ? p.user.password : '' } };
          if (p.form.length) o.body = { mode: 'formdata', form: p.form.map((x) => Object.assign({ on: true }, x)) };
          else if (p.urlenc.length) o.body = { mode: 'urlencoded', urlenc: p.urlenc.map((x) => Object.assign({ on: true }, x)) };
          else if (p.data !== null) {
            const ct = (p.headers.find((x) => /^content-type$/i.test(x.key)) || {}).value || '';
            const looksJson = /json/i.test(ct) || /^\s*[[{]/.test(p.data);
            if (!looksJson && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(p.data)) o.body = { mode: 'urlencoded', urlenc: p.data.split('&').map((kv) => { const i = kv.indexOf('='); return { on: true, key: decodeURIComponent(kv.slice(0, i)), value: decodeURIComponent(kv.slice(i + 1)) }; }) };
            else o.body = { mode: 'raw', lang: looksJson ? 'json' : 'text', raw: p.data };
          }
          const r = mkReq(p.url.replace(/^https?:\/\//, '').slice(0, 40), p.method, p.url, o);
          r.imported = true;
          S.view = { kind: 'request', req: r };
          S.reqTab = r.body.mode !== 'none' ? 'body' : 'headers';
          renderSide();
          renderWork();
          setTimeout(() => ctx.emit({ type: 'import', reqId: r.id, method: r.method, url: r.url }), 0);
          return true;
        },
      });
    }

    function nodeMenu(id) {
      const n = findNode(ws, id);
      if (!n) return;
      const isF = n.type === 'folder';
      dialog(isF ? `Папка «${n.name}»` : `Запрос «${n.name}»`, `
        <label class="pm-field"><span>Name</span><input class="pm-dlg-name" value="${esc(n.name)}" spellcheck="false"></label>
        <div class="pm-dlg-acts">${isF ? '' : '<button class="btn" type="button" data-dlg="dup">Duplicate</button>'}<button class="btn pm-danger" type="button" data-dlg="del">Delete</button></div>`, {
        ok: 'Rename',
        onOk: (box) => { const v = box.querySelector('.pm-dlg-name').value.trim(); if (v) n.name = v; renderSide(); renderWork(); touch(); return true; },
        onAct: (act) => {
          const p = parentOf(ws, id);
          if (act === 'dup') {
            const c = JSON.parse(JSON.stringify(Object.assign({}, n, { _last: undefined })));
            c.id = uid();
            c.name = n.name + ' Copy';
            p.items.splice(p.items.indexOf(n) + 1, 0, c);
          } else if (act === 'del') {
            p.items.splice(p.items.indexOf(n), 1);
            if (S.view && S.view.kind === 'request' && (S.view.req === n || (isF && requestsUnder(n).includes(S.view.req)))) S.view = null;
          }
          dlg.hidden = true;
          dlg.innerHTML = '';
          renderSide();
          renderWork();
          touch();
        },
      });
    }

    function quickLook() {
      const sc = liveScopes();
      const tbl = (arr) => (arr && arr.length ? `<table class="pm-kv">${arr.map((x) => `<tr><td><code>${esc(x.key)}</code></td><td>${esc(x.value)}</td></tr>`).join('')}</table>` : '<p class="pm-note">нет переменных</p>');
      dialog('Environment quick look', `
        <p class="pm-sub">${sc.env ? esc(sc.envName) : 'No Environment selected'} <button type="button" class="pm-link" data-dlg="env">Edit</button></p>${sc.env ? tbl(sc.env) : ''}
        <p class="pm-sub">Collection · ${esc(ws.collection.name)} <button type="button" class="pm-link" data-dlg="coll">Edit</button></p>${tbl(sc.coll)}
        <p class="pm-sub">Globals <button type="button" class="pm-link" data-dlg="glob">Edit</button></p>${tbl(sc.glob)}`, {
        onAct: (act) => {
          dlg.hidden = true;
          dlg.innerHTML = '';
          if (act === 'env') { S.side = 'environments'; S.view = ws.activeEnv ? { kind: 'env', id: ws.activeEnv } : { kind: 'env', id: ws.envs[0].id }; }
          else if (act === 'coll') { S.view = { kind: 'collection' }; S.colTab = 'vars'; }
          else { S.side = 'environments'; S.view = { kind: 'globals' }; }
          renderSide();
          renderWork();
        },
      });
    }

    // ---------- действия ----------

    function openReq(r) {
      S.view = { kind: 'request', req: r };
      S.reqTab = r.body.mode !== 'none' && r.method !== 'GET' ? 'body' : 'params';
      renderSide();
      renderWork();
    }
    function send() {
      const r = S.view.req;
      const rec = execute(r);
      r._last = rec;
      renderTabs();
      renderResponse();
      ctx.emit(Object.assign({ type: 'request' }, rec));
    }
    function scopeArr(scope) {
      if (scope === 'coll') return ws.collection.vars;
      if (scope === 'glob') return ws.globals;
      const e = ws.envs.find((x) => 'env:' + x.id === scope);
      return e ? e.values : [];
    }
    function rowsOf(t, scope) {
      const r = S.view && S.view.req;
      if (t === 'p') return r.params;
      if (t === 'h') return r.headers;
      if (t === 'f') return r.body.form;
      if (t === 'u') return r.body.urlenc;
      return scopeArr(scope);
    }

    function act(name, b) {
      const id = b.dataset.id;
      switch (name) {
        case 'side': S.side = b.dataset.v; renderSide(); break;
        case 'toggle': if (S.closed.has(id)) S.closed.delete(id); else S.closed.add(id); renderSide(); break;
        case 'open': openReq(findNode(ws, id)); break;
        case 'open-col': S.view = { kind: 'collection' }; renderSide(); renderWork(); break;
        case 'open-env': S.view = { kind: 'env', id }; renderSide(); renderWork(); break;
        case 'open-glob': S.view = { kind: 'globals' }; renderSide(); renderWork(); break;
        case 'env-activate': ws.activeEnv = id; renderEnvSelect(); renderSide(); renderWork(); touch(); break;
        case 'add-req': {
          const parent = findNode(ws, id);
          const r = mkReq('New Request', 'GET', '');
          parent.items.push(r);
          S.closed.delete(parent.id);
          openReq(r);
          touch();
          break;
        }
        case 'add-folder':
          dialog('New Folder', '<label class="pm-field"><span>Name</span><input class="pm-dlg-name" value="New Folder" spellcheck="false"></label>', {
            ok: 'Create',
            onOk: (box) => { ws.collection.items.push(mkFolder(box.querySelector('.pm-dlg-name').value.trim() || 'New Folder')); renderSide(); setTimeout(touch, 0); return true; },
          });
          break;
        case 'menu': nodeMenu(id); break;
        case 'run': S.runner.target = id || 'col'; S.view = { kind: 'runner' }; renderSide(); renderWork(); break;
        case 'runner': S.view = { kind: 'runner' }; renderSide(); renderWork(); break;
        case 'run-start': startRun(); break;
        case 'new': { S.drafts++; openReq(mkReq('Untitled Request', 'GET', '')); break; }
        case 'import': importDialog(); break;
        case 'quicklook': quickLook(); break;
        case 'console':
          S.consoleOpen = !S.consoleOpen;
          renderConsole();
          if (S.consoleOpen) ctx.emit({ type: 'console-open' });
          break;
        case 'console-clear': S.console = []; renderConsole(); renderFoot(); break;
        case 'send': send(); break;
        case 'save': if (parentOf(ws, S.view.req.id)) { b.textContent = 'Saved ✓'; setTimeout(() => { b.textContent = 'Save'; }, 900); ctx.emit({ type: 'save', reqId: S.view.req.id, fromId: S.view.req.id, imported: !!S.view.req.imported, folderId: parentOf(ws, S.view.req.id).id, name: S.view.req.name }); } else saveDialog(S.view.req, false); break;
        case 'saveas': saveDialog(S.view.req, !!parentOf(ws, S.view.req.id)); break;
        case 'code': codeDialog(S.view.req); break;
        case 'tab': S.reqTab = b.dataset.v; renderTabs(); renderPane(); break;
        case 'rtab': S.resTab = b.dataset.v; renderResponse(); break;
        case 'ctab': S.colTab = b.dataset.v; renderWork(); break;
        case 'add-row': rowsOf(b.dataset.t, b.dataset.scope).push(b.dataset.t === 'f' ? { key: '', value: '', type: 'text', on: true } : { key: '', value: '', on: true }); renderWork(); break;
        case 'del-row': {
          const t = b.dataset.t;
          rowsOf(t, b.dataset.scope).splice(+b.dataset.i, 1);
          if (t === 'p') urlFromParams(S.view.req);
          renderWork();
          touch();
          break;
        }
        case 'snip': {
          const r = S.view.req;
          const k = b.dataset.k;
          r[k] = (r[k].trim() ? r[k].replace(/\s*$/, '') + '\n\n' : '') + SNIPPETS[k][+b.dataset.i][1];
          renderTabs();
          renderPane();
          touch();
          break;
        }
        default: break;
      }
    }

    function field(t, evType) {
      const f = t.dataset.f;
      if (!f) return;
      const r = S.view && S.view.req;
      const i = Number(t.dataset.i);
      const isInput = evType === 'input';
      const authObj = () => (t.dataset.scope === 'col' ? ws.collection : r);
      switch (f) {
        case 'activeEnv': if (!isInput) { ws.activeEnv = t.value || null; renderSide(); if (S.view && S.view.kind === 'env') renderWork(); touch(); } break;
        case 'name': r.name = t.value; renderSide(); break;
        case 'method': if (!isInput) { r.method = t.value; t.className = `pm-method m-${r.method.toLowerCase()}`; renderSide(); } break;
        case 'url': if (isInput) { r.url = t.value; syncFromUrl(r); renderTabs(); if (S.reqTab === 'params') renderPane(); } break;
        case 'p-k': case 'p-v':
          if (isInput) { r.params[i][f === 'p-k' ? 'key' : 'value'] = t.value; urlFromParams(r); work.querySelector('.pm-url').value = r.url; renderTabs(); }
          break;
        case 'pv': if (isInput) r.pathVars[t.dataset.k] = t.value; break;
        case 'h-k': case 'u-k': case 'f-k': case 'v-k': if (isInput) { rowsOf(f[0], t.dataset.scope)[i].key = t.value; if (f === 'h-k') renderTabs(); touch(); } break;
        case 'h-v': case 'u-v': case 'f-v': case 'v-v': if (isInput) { rowsOf(f[0], t.dataset.scope)[i].value = t.value; touch(); } break;
        case 'h-on': case 'u-on': case 'f-on': if (!isInput) rowsOf(f[0])[i].on = t.checked; break;
        case 'f-type': if (!isInput) { r.body.form[i].type = t.value; r.body.form[i].value = ''; renderPane(); } break;
        case 'f-file': if (!isInput) r.body.form[i].value = t.value; break;
        case 'auth-type': if (!isInput) { authObj().auth.type = t.value; renderWork(); touch(); } break;
        case 'auth-token': case 'auth-user': case 'auth-pass': case 'auth-key': case 'auth-val':
          if (isInput) { authObj().auth[{ 'auth-token': 'token', 'auth-user': 'username', 'auth-pass': 'password', 'auth-key': 'key', 'auth-val': 'value' }[f]] = t.value; touch(); }
          break;
        case 'auth-in': if (!isInput) { authObj().auth.in = t.value; touch(); } break;
        case 'body-mode': if (!isInput) { r.body.mode = t.value; renderTabs(); renderPane(); } break;
        case 'body-lang': if (!isInput) r.body.lang = t.value; break;
        case 'body-raw': if (isInput) r.body.raw = t.value; break;
        case 'pre': case 'tests': if (isInput) { r[f] = t.value; } else { renderTabs(); touch(); } break;
        case 'run-target': if (!isInput) { S.runner.target = t.value; renderWork(); } break;
        case 'run-iter': if (isInput) S.runner.iterations = Math.max(1, Math.min(20, Number(t.value) || 1)); break;
        case 'run-file': if (!isInput) {
          S.runner.file = t.value;
          if (t.value) { try { S.runner.iterations = parseData(t.value, ws.files[t.value]).length || 1; } catch (e) { /* ошибка покажется в превью */ } }
          renderWork();
        } break;
        default: break;
      }
    }

    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b && root.contains(b) && !b.disabled) act(b.dataset.act, b);
    });
    root.addEventListener('input', (e) => field(e.target, 'input'));
    root.addEventListener('change', (e) => field(e.target, 'change'));
    root.addEventListener('keydown', (e) => {
      const t = e.target;
      if (e.key === 'Enter' && t.classList.contains('pm-url')) { e.preventDefault(); send(); }
      if (e.key === 'Tab' && t.tagName === 'TEXTAREA' && t.classList.contains('pm-code') && !e.shiftKey) {
        e.preventDefault();
        const s = t.selectionStart;
        t.value = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd);
        t.selectionStart = t.selectionEnd = s + 2;
        t.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && S.view && S.view.kind === 'request') { e.preventDefault(); send(); }
    });

    renderEnvSelect();
    const first = level && level.open ? reqByName(ws, level.open) : null;
    if (first) { S.view = { kind: 'request', req: first }; S.reqTab = level.openTab || 'params'; } else S.view = { kind: 'request', req: mkReq('Untitled Request', 'GET', '') };
    renderSide();
    renderWork();
    renderFoot();
    return {};
  }

  // ---------- проверки уровней ----------

  const reqs = (c, f) => c.log.filter((e) => e.type === 'request' && f(e));
  const runs = (c, f) => c.log.filter((e) => e.type === 'run' && f(e));
  const hdr = (e, n) => hget(e.headers, n);
  const green = (e) => e.tests.length > 0 && !e.testError && e.tests.every((t) => t.pass);
  const catches = (e, mut) => { const p = e.probe(mut); return !!p.error || p.tests.some((t) => !t.pass); };
  const failedTest = (e) => !e.testError && e.tests.some((t) => !t.pass);
  const heroPath = /^\/heroes\/\d+$/;
  const tokenSet = (e) => e.varChanges.some((v) => v.key === 'token' && String(v.value) === M.TOKEN);
  const ws = (c) => c.state.ws;
  const envOf = (c) => ws(c).envs.find((e) => e.id === ws(c).activeEnv);
  const setEnv = (w, k, v) => w.envs.forEach((e) => vset(e.values, k, v));
  const bearerColl = (w) => { w.collection.auth = Object.assign(emptyAuth('bearer'), { token: '{{token}}' }); };
  const after = (c, a, b) => !!a && !!b && c.log.indexOf(a) > c.log.indexOf(b);

  const LEVELS = [
    {
      id: 'pm-1',
      title: 'Токен и переменные окружения',
      giver: { name: 'Почтовый голем', sprite: '📮' },
      gold: 80,
      outro: 'Токен в переменной окружения: сменился токен — правишь одно место, а не каждый запрос.',
      steps: [
        { id: 'base', text: 'Открой запрос <b>Heroes → Список героев</b> из коллекции и нажми <b>Send</b>. Адрес использует переменную <code>{{baseUrl}}</code> из окружения.',
          check: (c) => reqs(c, (e) => e.method === 'GET' && e.rawUrl.includes('{{baseUrl}}') && e.path === '/heroes' && e.status === 200).length > 0,
          success: '200 OK. {{baseUrl}} подставилась из окружения «Хроники · dev».' },
        { id: 'param', text: 'На вкладке <b>Params</b> добавь query-параметр <code>class</code> = <b>Лучник</b> и отправь запрос: в ответе должны быть только лучники.',
          check: (c) => reqs(c, (e) => e.method === 'GET' && e.path === '/heroes' && e.query.class === 'Лучник' && e.status === 200).length > 0,
          success: 'Сервер вернул двух лучников. Параметр из Params сам добавился в URL.' },
        { id: 'login', text: 'Открой <b>Auth → Логин</b> и получи токен: <code>POST</code> с телом JSON. Учётные данные — в описании коллекции (клик по «Хроники API» → Overview).',
          check: (c) => reqs(c, (e) => e.method === 'POST' && e.path === '/auth/login' && e.status === 200).length > 0,
          success: 'Токен получен. Копировать его в каждый запрос неудобно, поэтому сохраним его в окружение.' },
        { id: 'env', text: 'Сохрани полученный токен в переменную окружения <code>token</code> (вкладка <b>Environments</b> слева или 👁 вверху).',
          check: (c) => { const e = envOf(c); return !!e && vget(e.values, 'token') === M.TOKEN; },
          success: 'Токен лежит в окружении.' },
        { id: 'me', text: 'Открой <b>Auth → Кто я</b>, на вкладке <b>Authorization</b> выбери <b>Bearer Token</b> со значением <code>{{token}}</code> и получи <code>200</code>.',
          check: (c) => reqs(c, (e) => e.path === '/me' && e.status === 200 && e.authType === 'bearer' && /\{\{\s*token\s*\}\}/.test(e.authRaw)).length > 0,
          success: '200 OK: сервер узнал тебя по токену из переменной окружения.' },
      ],
      hints: [
        'Запросы коллекции открываются по клику слева. Окружение «Хроники · dev» выбрано вверху справа, его переменные видны по кнопке 👁 и во вкладке Environments.',
        'Query-параметр: вкладка Params → + Add → Key <code>class</code>, Value <code>Лучник</code>. Для логина заполни Body (raw, JSON) полями <code>login</code> и <code>password</code>. Токен из ответа скопируй в Current value переменной <code>token</code> окружения.',
        'Тело логина: <code>{"login": "mage", "password": "chronicles"}</code>. Токен: <code>tok_7f3a9c21</code> — Environments → Хроники · dev → token. В «Кто я»: Authorization → Auth Type = Bearer Token, Token = <code>{{token}}</code> → Send.',
      ],
    },
    {
      id: 'pm-2',
      title: 'Path-переменные и коды 400/404',
      giver: { name: 'Хранитель ключей', sprite: '🗝️' },
      gold: 89,
      open: 'Герой по id',
      outro: '404 — ресурса нет, 400 — сам запрос некорректный. Это разные баги и разные проверки.',
      steps: [
        { id: 'path', text: 'В запросе <b>Герой по id</b> адрес содержит path-переменную <code>:id</code>. На вкладке <b>Params → Path Variables</b> задай <code>id</code> = <b>5</b> и отправь: должен прийти Даэль.',
          check: (c) => reqs(c, (e) => e.rawUrl !== undefined && /\/heroes\/:id|\/heroes\//.test(e.rawUrl) && e.path === '/heroes/5' && e.status === 200 && e.json && e.json.name === 'Даэль').length > 0,
          success: 'Path-переменная подставилась в путь: /heroes/5.' },
        { id: 'nf', text: 'Запроси героя, которого нет (например, <code>id</code> = 999). Какой код вернёт сервер?',
          check: (c) => reqs(c, (e) => e.method === 'GET' && heroPath.test(e.path) && e.status === 404).length > 0,
          success: '404 Not Found: адрес корректный, но такого героя нет.' },
        { id: 'bad', text: 'Теперь передай в <code>id</code> не число (например, <code>abc</code>).',
          check: (c) => reqs(c, (e) => e.method === 'GET' && /^\/heroes\/[^/]*[^\d/][^/]*$/.test(e.path) && e.status === 400).length > 0,
          success: '400 Bad Request: сервер отверг некорректный параметр.' },
        { id: 'q', text: 'Какой код должен вернуть API на запрос героя с несуществующим, но корректным числовым id?',
          answer: { kind: 'choice', options: ['400 Bad Request', '404 Not Found', '200 OK с пустым телом', '500 Internal Server Error'], accept: (v) => v === 1, wrong: 'Запрос корректный, просто ресурса нет.' } },
      ],
      hints: [
        'Path-переменная — часть пути вида <code>/heroes/:id</code>. Её значение задаётся во вкладке Params, в отдельной таблице Path Variables.',
        'Открой «Герой по id» → Params → Path Variables → id. Отправь с 5, с 999 и с abc. Сам URL с <code>:id</code> не меняй.',
        'id = 5 → Send (200, Даэль); id = 999 → Send (404); id = abc → Send (400). На вопрос ответ: 404 Not Found.',
      ],
    },
    {
      id: 'pm-3',
      title: 'POST: создание сущности',
      giver: { name: 'Кузнец-создатель', sprite: '🔨' },
      gold: 98,
      open: 'Создать героя',
      setup: (w) => setEnv(w, 'token', M.TOKEN),
      outro: 'На каждый POST есть три обязательных проверки: без авторизации, с невалидным телом и позитивная.',
      steps: [
        { id: 'unauth', text: 'Отправь <b>Создать героя</b> как есть, без авторизации. Убедись, что сервер не даёт создавать героев анонимно.',
          check: (c) => reqs(c, (e) => e.method === 'POST' && e.path === '/heroes' && e.status === 401 && !hdr(e, 'authorization')).length > 0,
          success: '401 Unauthorized — защита на месте.' },
        { id: 'created', text: 'Токен уже лежит в окружении. Настрой <b>Authorization → Bearer Token</b> = <code>{{token}}</code>, заполни тело (raw, JSON) валидным героем и получи <code>201 Created</code>.',
          check: (c) => reqs(c, (e) => e.method === 'POST' && e.path === '/heroes' && e.status === 201 && e.bodyMode === 'raw').length > 0,
          success: '201 Created. В ответе — созданный герой с id, в заголовке Location — его адрес.' },
        { id: 'invalid', text: 'Негативная проверка: отправь героя с ошибкой в данных (класс не из списка, пустое имя или level строкой) — с токеном. Ожидаем <code>400</code> со списком ошибок.',
          check: (c) => reqs(c, (e) => e.method === 'POST' && e.path === '/heroes' && e.status === 400 && hdr(e, 'authorization') && e.json && Array.isArray(e.json.errors)).length > 0,
          success: '400 и errors[] с полем и причиной — валидация работает.' },
        { id: 'id', text: 'Какой <code>id</code> сервер присвоил первому созданному тобой герою?',
          answer: { kind: 'text', placeholder: 'id', accept: (v, c) => { const e = reqs(c, (x) => x.method === 'POST' && x.path === '/heroes' && x.status === 201)[0]; return !!e && String(e.json.id) === String(v).trim(); }, wrong: 'Посмотри поле id в ответе на свой первый успешный POST.' } },
      ],
      hints: [
        'Токен уже в окружении (👁). Нужны три запроса: без токена, с токеном и валидным телом, с токеном и невалидным телом.',
        'Authorization → Auth Type = Bearer Token, Token = <code>{{token}}</code>. Body → raw → JSON. Правила полей — в Overview коллекции.',
        'Сначала Send без авторизации (401). Затем Bearer <code>{{token}}</code> и тело <code>{"name": "Ульрих", "class": "Воин", "level": 5}</code> → 201 (id 11). Затем <code>{"name": "Ульрих", "class": "Ворон", "level": 5}</code> → 400. Ответ: 11.',
      ],
    },
    {
      id: 'pm-4',
      title: 'PUT, PATCH и DELETE',
      giver: { name: 'Летописец правок', sprite: '✒️' },
      gold: 107,
      setup: (w) => { setEnv(w, 'token', M.TOKEN); bearerColl(w); },
      outro: 'PUT заменяет ресурс целиком, PATCH меняет только переданные поля. После DELETE обязательно проверь, что ресурс действительно исчез.',
      steps: [
        { id: 'put', text: 'Авторизация уже настроена на коллекции. В <b>Обновить героя</b> задай <code>id</code> существующего героя и отправь <b>полное</b> тело героя через <code>PUT</code> → <code>200</code>.',
          check: (c) => reqs(c, (e) => e.method === 'PUT' && heroPath.test(e.path) && e.status === 200).length > 0,
          success: 'PUT заменил героя целиком.' },
        { id: 'putbad', text: 'Отправь <code>PUT</code>, в теле которого только одно поле (например, <code>{"level": 8}</code>). Что ответит сервер?',
          check: (c) => reqs(c, (e) => e.method === 'PUT' && heroPath.test(e.path) && e.status === 400).length > 0,
          success: '400: для PUT нужен полный ресурс. Частичное изменение делают через PATCH.' },
        { id: 'patch', text: 'Через <b>Изменить героя</b> (<code>PATCH</code>) поменяй у героя только <code>level</code>. Остальные поля должны сохраниться.',
          check: (c) => reqs(c, (e) => e.method === 'PATCH' && heroPath.test(e.path) && e.status === 200 && e.bodyJson && Object.keys(e.bodyJson).length === 1 && 'level' in e.bodyJson && e.json.level === e.bodyJson.level && !!e.json.name).length > 0,
          success: 'PATCH изменил только level, имя и класс остались прежними.' },
        { id: 'delete', text: 'Удали героя через <b>Удалить героя</b> (<code>DELETE</code>) → <code>204 No Content</code>.',
          check: (c) => reqs(c, (e) => e.method === 'DELETE' && heroPath.test(e.path) && e.status === 204).length > 0,
          success: '204: тела в ответе нет, и это нормально.' },
        { id: 'gone', text: 'Убедись, что удалённого героя больше нет: <code>GET</code> по тому же id → <code>404</code>.',
          check: (c) => reqs(c, (e) => e.method === 'DELETE' && e.status === 204).some((d) => reqs(c, (g) => g.method === 'GET' && g.path === d.path && g.status === 404 && after(c, g, d)).length > 0),
          success: 'Удаление подтверждено повторным запросом.' },
      ],
      hints: [
        'Все нужные запросы есть в папке Heroes. id задаётся в Params → Path Variables, тело — в Body (raw, JSON).',
        'PUT: полное тело <code>{"name": …, "class": …, "level": …}</code>. PATCH: тело из одного поля. После DELETE открой «Герой по id» с тем же id.',
        'Обновить героя: id = 2, тело <code>{"name": "Борин", "class": "Паладин", "level": 10}</code> → 200; тело <code>{"level": 8}</code> → 400. Изменить героя: id = 3, <code>{"level": 10}</code> → 200. Удалить героя: id = 4 → 204. Герой по id: id = 4 → 404.',
      ],
    },
    {
      id: 'pm-5',
      title: 'Headers: Accept и Content-Type',
      giver: { name: 'Глашатай заголовков', sprite: '📯' },
      gold: 116,
      open: 'Список героев',
      setup: (w) => { setEnv(w, 'token', M.TOKEN); bearerColl(w); },
      outro: 'Accept — что клиент хочет получить, Content-Type — что он отправляет. Ошибки 406 и 415 — про них.',
      steps: [
        { id: 'accept', text: 'В <b>Список героев</b> на вкладке <b>Headers</b> добавь <code>Accept: application/xml</code> и отправь. Сервер умеет только JSON.',
          check: (c) => reqs(c, (e) => e.path === '/heroes' && /xml/i.test(hdr(e, 'accept') || '') && e.status === 406).length > 0,
          success: '406 Not Acceptable: сервер не может ответить в нужном формате.' },
        { id: 'json', text: 'Поменяй значение на <code>application/json</code> → <code>200</code>.',
          check: (c) => reqs(c, (e) => e.path === '/heroes' && e.userHeaders.some((h) => /^accept$/i.test(h.key) && h.on !== false && /application\/json/i.test(h.value)) && e.status === 200).length > 0,
          success: '200 OK.' },
        { id: 'ctype', text: 'В <b>Создать героя</b> отправь валидное тело, но в Body → raw переключи формат с <b>JSON</b> на <b>Text</b>. Postman отправит <code>Content-Type: text/plain</code>.',
          check: (c) => reqs(c, (e) => e.method === 'POST' && e.path === '/heroes' && e.status === 415).length > 0,
          success: '415 Unsupported Media Type: сервер принимает только application/json.' },
        { id: 'fix', text: 'Верни формат JSON (или явно задай заголовок <code>Content-Type: application/json</code>) и получи <code>201</code>.',
          check: (c) => { const bad = reqs(c, (e) => e.status === 415)[0]; return !!bad && reqs(c, (e) => e.method === 'POST' && e.path === '/heroes' && e.status === 201 && after(c, e, bad)).length > 0; },
          success: '201 Created.' },
        { id: 'total', text: 'Запроси <code>/heroes?class=Маг</code> и посмотри в ответе вкладку <b>Headers</b>. Сколько героев указано в заголовке <code>x-total-count</code>?',
          answer: { kind: 'text', placeholder: 'число', accept: (v, c) => String(v).trim() === '4' && reqs(c, (e) => e.path === '/heroes' && e.query.class === 'Маг' && e.status === 200).length > 0, wrong: 'Сначала отправь запрос с class=Маг и открой Headers ответа.' } },
      ],
      hints: [
        'Заголовки запроса добавляются во вкладке Headers. Формат raw-тела выбирается выпадающим списком рядом с переключателем raw.',
        'Headers → + Add → Key <code>Accept</code>, Value <code>application/xml</code> → Send (406) → поменяй Value на <code>application/json</code> → Send. В «Создать героя»: Body → raw → Text → Send (415) → JSON → Send.',
        'Тело героя: <code>{"name": "Мира", "class": "Жрец", "level": 3}</code>. Последний шаг: Params → class = Маг → Send → Headers ответа → x-total-count = 4.',
      ],
    },
    {
      id: 'pm-6',
      title: 'form-data и x-www-form-urlencoded',
      giver: { name: 'Писарь форм', sprite: '📜' },
      gold: 125,
      setup: (w) => {
        setEnv(w, 'token', M.TOKEN);
        bearerColl(w);
        w.collection.items.push(mkFolder('Forms', [
          mkReq('Токен (форма)', 'POST', '{{baseUrl}}/auth/token', { auth: { type: 'none' } }),
          mkReq('Аватар героя', 'POST', '{{baseUrl}}/heroes/:id/avatar', { pathVars: { id: '1' } }),
        ]));
      },
      outro: 'Форма с файлом — form-data (multipart), простая форма без файлов — x-www-form-urlencoded.',
      steps: [
        { id: 'token', text: 'Открой <b>Forms → Токен (форма)</b>. Этот эндпоинт принимает только <b>x-www-form-urlencoded</b>: поля <code>grant_type</code> = <code>password</code>, <code>username</code>, <code>password</code>. Получи <code>200</code> и access_token.',
          check: (c) => reqs(c, (e) => e.path === '/auth/token' && e.bodyMode === 'urlencoded' && e.status === 200).length > 0,
          success: 'Токен выдан. Тело ушло как grant_type=password&username=…' },
        { id: 'avatar', text: 'Открой <b>Аватар героя</b>: Body → <b>form-data</b>, ключ <code>avatar</code> с типом <b>File</b>, файл <code>avatar.png</code>. Получи <code>201</code>.',
          check: (c) => reqs(c, (e) => /^\/heroes\/\d+\/avatar$/.test(e.path) && e.bodyMode === 'formdata' && e.status === 201).length > 0,
          success: '201: файл загружен.' },
        { id: 'pdf', text: 'Негативная проверка: загрузи вместо картинки <code>report.pdf</code>.',
          check: (c) => reqs(c, (e) => /^\/heroes\/\d+\/avatar$/.test(e.path) && e.status === 415 && e.form && e.form.some((f) => f.value === 'report.pdf')).length > 0,
          success: '415: сервер принимает только PNG и JPEG.' },
        { id: 'ctype', text: 'Какой <code>Content-Type</code> Postman выставил для тела form-data? (посмотри в Console или в Code snippet)',
          answer: { kind: 'choice', options: ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=…', 'text/plain'], accept: (v) => v === 2, wrong: 'В form-data части тела разделяются границей (boundary).' } },
      ],
      hints: [
        'У Body четыре режима: none, form-data, x-www-form-urlencoded и raw. Для файлов подходит form-data, для простой формы — x-www-form-urlencoded.',
        'Токен (форма): Body → x-www-form-urlencoded → три строки key/value. Аватар: Body → form-data → Key <code>avatar</code>, Type = File, Value = avatar.png.',
        'grant_type = password, username = mage, password = chronicles → Send (200). Аватар: avatar (File) = avatar.png → Send (201), затем report.pdf → Send (415). Ответ: multipart/form-data; boundary=…',
      ],
    },
    {
      id: 'pm-7',
      title: 'Области переменных и приоритет',
      giver: { name: 'Хранитель сундуков', sprite: '🧰' },
      gold: 134,
      open: 'Список героев',
      setup: (w) => { w.globals = vars({ baseUrl: OLD_BASE }); },
      outro: 'Одноимённая переменная берётся из самой узкой области: Local → Data → Environment → Collection → Global.',
      steps: [
        { id: 'env', text: 'В Globals кто-то оставил старый <code>baseUrl</code>. Отправь <b>Список героев</b> с выбранным окружением «Хроники · dev» — должен прийти <code>200</code>.',
          check: (c) => reqs(c, (e) => e.path === '/heroes' && e.status === 200 && e.envId === 'dev' && e.rawUrl.includes('{{baseUrl}}')).length > 0,
          success: 'Окружение перекрыло глобальную переменную.' },
        { id: 'global', text: 'Переключи окружение на <b>No Environment</b> и отправь тот же запрос. Куда он ушёл?',
          check: (c) => reqs(c, (e) => !e.envId && e.networkError && e.url.startsWith(OLD_BASE)).length > 0,
          success: 'Без окружения подставился глобальный baseUrl со старым хостом — ENOTFOUND.' },
        { id: 'coll', text: 'Не включая окружение, создай в коллекции (Хроники API → <b>Variables</b>) переменную <code>baseUrl</code> = <code>' + BASE + '</code> и отправь запрос снова.',
          check: (c) => vget(ws(c).collection.vars, 'baseUrl') === BASE && reqs(c, (e) => !e.envId && e.path === '/heroes' && e.status === 200 && e.rawUrl.includes('{{baseUrl}}')).length > 0,
          success: 'Переменная коллекции перекрыла глобальную.' },
        { id: 'order', text: 'Какой порядок приоритета у областей переменных Postman (от сильной к слабой)?',
          answer: { kind: 'choice', options: ['Global → Collection → Environment → Data → Local', 'Local → Data → Environment → Collection → Global', 'Environment → Global → Collection → Local → Data', 'Collection → Environment → Global → Local → Data'], accept: (v) => v === 1 } },
      ],
      hints: [
        'Посмотри все области кнопкой 👁: окружение, переменные коллекции и Globals. У baseUrl два значения.',
        'Окружение переключается списком Environment вверху справа. Переменные коллекции: клик по «Хроники API» → вкладка Variables → + Add.',
        'Send с dev (200) → No Environment → Send (ENOTFOUND old.chronicles.guild) → Хроники API → Variables → baseUrl = <code>' + BASE + '</code> → Send (200). Ответ: Local → Data → Environment → Collection → Global.',
      ],
    },
    {
      id: 'pm-8',
      title: 'Авторизация коллекции и наследование',
      giver: { name: 'Страж ворот', sprite: '🛡️' },
      gold: 143,
      setup: (w) => setEnv(w, 'token', M.TOKEN),
      outro: 'Auth на коллекции + Inherit в запросах: токен настраивается в одном месте.',
      steps: [
        { id: 'coll', text: 'Открой коллекцию <b>Хроники API → Authorization</b> и настрой <b>Bearer Token</b> = <code>{{token}}</code> (токен уже в окружении).',
          check: (c) => ws(c).collection.auth.type === 'bearer' && /\{\{\s*token\s*\}\}/.test(ws(c).collection.auth.token),
          success: 'Авторизация коллекции настроена.' },
        { id: 'inherit', text: 'Отправь <b>Кто я</b>, не трогая его Authorization: там стоит <b>Inherit auth from parent</b>.',
          check: (c) => reqs(c, (e) => e.path === '/me' && e.status === 200 && e.reqAuthType === 'inherit').length > 0,
          success: '200: запрос унаследовал токен от коллекции.' },
        { id: 'create', text: 'Создай героя через <b>Создать героя</b> — тоже с унаследованной авторизацией.',
          check: (c) => reqs(c, (e) => e.method === 'POST' && e.path === '/heroes' && e.status === 201 && e.reqAuthType === 'inherit').length > 0,
          success: '201 без ручной настройки токена в запросе.' },
        { id: 'noauth', text: 'Проверка доступа без токена: в <b>Кто я</b> выбери <b>No Auth</b> (переопределение для одного запроса) и отправь.',
          check: (c) => reqs(c, (e) => e.path === '/me' && e.status === 401 && e.reqAuthType === 'none').length > 0,
          success: '401: запрос переопределил родительскую авторизацию.' },
      ],
      hints: [
        'Авторизацию можно задать на коллекции, а запросы наследуют её через Inherit auth from parent.',
        'Клик по «Хроники API» в дереве → вкладка Authorization → Bearer Token → <code>{{token}}</code>. Затем открой «Кто я» и «Создать героя» и отправь.',
        'Коллекция: Bearer Token = <code>{{token}}</code>. «Кто я» → Send (200). «Создать героя» → тело <code>{"name": "Тесса", "class": "Плут", "level": 2}</code> → Send (201). «Кто я» → Authorization → No Auth → Send (401).',
      ],
    },
    {
      id: 'pm-9',
      title: 'Basic Auth и API Key',
      giver: { name: 'Казначей', sprite: '💰' },
      gold: 152,
      setup: (w) => {
        w.collection.items.push(mkFolder('Admin', [
          mkReq('Статистика', 'GET', '{{baseUrl}}/admin/stats'),
          mkReq('Казна', 'GET', '{{baseUrl}}/treasury'),
        ]));
      },
      outro: 'Basic Auth — это не шифрование, а Base64: его легко раскодировать, поэтому только через HTTPS.',
      steps: [
        { id: 'basic', text: 'Открой <b>Admin → Статистика</b>. Доступ по <b>Basic Auth</b>: логин <code>admin</code>, пароль <code>s3cret</code>. Получи <code>200</code>.',
          check: (c) => reqs(c, (e) => e.path === '/admin/stats' && e.status === 200).length > 0,
          success: '200: админская статистика.' },
        { id: 'b64', text: 'Открой <b>Console</b> (внизу) и найди заголовок <code>Authorization</code> этого запроса. Что стоит после слова <code>Basic</code>?',
          answer: { kind: 'text', placeholder: 'строка Base64', accept: (v) => String(v).replace(/^\s*(authorization:)?\s*basic\s+/i, '').trim() === b64('admin:s3cret'), wrong: 'Скопируй значение из Console → Request Headers → Authorization.' } },
        { id: 'keyh', text: 'Открой <b>Казна</b>. Нужен API Key <code>' + API_KEY + '</code> в заголовке <code>X-Api-Key</code>: Authorization → <b>API Key</b>, Add to = Header.',
          check: (c) => reqs(c, (e) => e.path === '/treasury' && e.status === 200 && hdr(e, 'x-api-key') === API_KEY).length > 0,
          success: '200: ключ в заголовке принят.' },
        { id: 'keyq', text: 'Тот же ключ можно передать в query-параметре <code>api_key</code> (Add to = Query Params). Отправь так, без заголовка.',
          check: (c) => reqs(c, (e) => e.path === '/treasury' && e.status === 200 && e.query.api_key === API_KEY && !hdr(e, 'x-api-key')).length > 0,
          success: '200: ключ в URL. Запомни: такой ключ попадает в логи и историю, поэтому заголовок безопаснее.' },
      ],
      hints: [
        'На вкладке Authorization есть типы Basic Auth и API Key. Сырые заголовки отправленного запроса видны в Console.',
        'Статистика: Basic Auth → Username/Password. Console → разверни запрос → Request Headers → Authorization. Казна: API Key → Key <code>X-Api-Key</code>, Value <code>' + API_KEY + '</code>.',
        'admin / s3cret → Send (200). После Basic: <code>YWRtaW46czNjcmV0</code>. Казна: API Key, Key = X-Api-Key, Value = ' + API_KEY + ', Add to = Header → Send; затем Key = api_key, Add to = Query Params → Send.',
      ],
    },
    {
      id: 'pm-10',
      title: 'Tests: pm.test и статус',
      giver: { name: 'Испытатель', sprite: '🧪' },
      gold: 161,
      open: 'Список героев',
      openTab: 'tests',
      outro: 'Тест полезен, только если он может упасть. Всегда проверь, что тест краснеет на неправильном ответе.',
      steps: [
        { id: 'status', text: 'На вкладке <b>Tests</b> запроса «Список героев» напиши <code>pm.test</code>, который проверяет код ответа <code>200</code>. Отправь: в <b>Test Results</b> тест должен быть зелёным.',
          check: (c) => reqs(c, (e) => e.path === '/heroes' && e.status === 200 && green(e) && catches(e, (m) => { m.code = 500; })).length > 0,
          success: 'PASS. Тест действительно проверяет статус: на 500 он бы упал.' },
        { id: 'fail', text: 'Убедись, что тест умеет падать: поменяй ожидаемый код (например, на 201), отправь и посмотри на FAIL с сообщением.',
          check: (c) => reqs(c, (e) => failedTest(e)).length > 0,
          success: 'FAIL с понятным сообщением AssertionError. Верни правильный код.' },
        { id: 'time', text: 'Добавь тест на время ответа: <code>pm.response.responseTime</code> меньше 1000 мс. Все тесты запроса должны пройти.',
          check: (c) => reqs(c, (e) => e.status === 200 && green(e) && catches(e, (m) => { m.time = 5000; })).length > 0,
          success: 'Тест на время ответа работает.' },
      ],
      hints: [
        'Во вкладке Tests пишут JavaScript. Справа есть Snippets — готовые заготовки.',
        'Сниппет «Status code: Code is 200» вставит готовый тест. Для времени: <code>pm.expect(pm.response.responseTime).to.be.below(1000)</code> внутри <code>pm.test</code>.',
        '<code>pm.test("Статус 200", () =&gt; { pm.response.to.have.status(200); });</code> → Send. Поменяй 200 на 201 → Send (FAIL) → верни 200. Добавь <code>pm.test("Быстро", () =&gt; { pm.expect(pm.response.responseTime).to.be.below(1000); });</code> → Send.',
      ],
    },
    {
      id: 'pm-11',
      title: 'Проверки тела ответа',
      giver: { name: 'Алхимик', sprite: '⚗️' },
      gold: 170,
      open: 'Герой по id',
      openTab: 'params',
      outro: 'Проверяй не только «200», но и данные: значения, типы и наличие полей.',
      steps: [
        { id: 'name', text: 'Запроси героя <code>id</code> = 1 и напиши тест через <code>pm.response.json()</code> и <code>pm.expect</code>: имя героя — <b>Айра</b>.',
          check: (c) => reqs(c, (e) => e.path === '/heroes/1' && e.status === 200 && green(e) && catches(e, (m) => { m.json.name = 'Борин'; })).length > 0,
          success: 'Тест проверяет имя: на другом имени он упадёт.' },
        { id: 'type', text: 'Добавь проверку типа: <code>level</code> — число (<code>to.be.a(\'number\')</code>).',
          check: (c) => reqs(c, (e) => e.path === '/heroes/1' && green(e) && catches(e, (m) => { m.json.level = String(m.json.level); })).length > 0,
          success: 'Если сервер начнёт отдавать level строкой, тест это поймает.' },
        { id: 'prop', text: 'Добавь проверку, что в ответе есть поле <code>guild</code> (<code>to.have.property</code>).',
          check: (c) => reqs(c, (e) => e.path === '/heroes/1' && green(e) && catches(e, (m) => { delete m.json.guild; })).length > 0,
          success: 'Пропадёт поле — тест покраснеет.' },
        { id: 'neg', text: 'Отправь тот же запрос с другим id (например, 2) и убедись, что тест на имя падает.',
          check: (c) => reqs(c, (e) => heroPath.test(e.path) && e.status === 200 && e.json && e.json.name !== 'Айра' && failedTest(e)).length > 0,
          success: 'Тест краснеет на чужих данных — значит, он рабочий.' },
      ],
      hints: [
        '<code>pm.response.json()</code> возвращает тело как объект. Каждое утверждение — <code>pm.expect(значение)…</code> внутри <code>pm.test</code>.',
        'Path Variables → id = 1. Сниппет «Response body: JSON value check» — хорошая заготовка; замени <code>value</code> и <code>100</code> на своё.',
        '<code>const hero = pm.response.json();<br>pm.test("Имя", () =&gt; pm.expect(hero.name).to.eql("Айра"));<br>pm.test("level — число", () =&gt; pm.expect(hero.level).to.be.a("number"));<br>pm.test("Есть guild", () =&gt; pm.expect(hero).to.have.property("guild"));</code> → Send; затем id = 2 → Send.',
      ],
    },
    {
      id: 'pm-12',
      title: 'Массивы и заголовки ответа',
      giver: { name: 'Счетовод', sprite: '🧮' },
      gold: 179,
      open: 'Список героев',
      outro: 'Проверка только первого элемента массива пропускает баги в остальных. Проверяй каждый.',
      steps: [
        { id: 'every', text: 'Запроси <code>/heroes?class=Маг</code> и напиши тест: у <b>каждого</b> героя в массиве <code>class</code> = <b>Маг</b>.',
          check: (c) => reqs(c, (e) => e.path === '/heroes' && e.query.class === 'Маг' && Array.isArray(e.json) && e.json.length > 1 && green(e) && catches(e, (m) => { m.json[m.json.length - 1].class = 'Воин'; })).length > 0,
          success: 'Фильтр проверен для всех элементов, а не только для первого.' },
        { id: 'count', text: 'Добавь тест: число героев в массиве совпадает с заголовком <code>x-total-count</code> (или равно 4).',
          check: (c) => reqs(c, (e) => e.path === '/heroes' && e.query.class === 'Маг' && green(e) && catches(e, (m) => { m.json.pop(); })).length > 0,
          success: 'Количество проверено.' },
        { id: 'header', text: 'Добавь тест на заголовок ответа: <code>Content-Type</code> содержит <code>application/json</code>.',
          check: (c) => reqs(c, (e) => e.path === '/heroes' && green(e) && catches(e, (m) => { Object.keys(m.headers).forEach((k) => { if (/^content-type$/i.test(k)) m.headers[k] = 'text/html; charset=utf-8'; }); })).length > 0,
          success: 'Если сервер начнёт отдавать HTML, тест это покажет.' },
      ],
      hints: [
        'Массив перебирают через <code>forEach</code> или проверяют через <code>every</code>. Заголовки ответа читаются через <code>pm.response.headers.get("имя")</code>.',
        'Params → class = Маг. Число элементов — <code>json.length</code>, заголовок — <code>Number(pm.response.headers.get("x-total-count"))</code>.',
        '<code>const list = pm.response.json();<br>pm.test("Все маги", () =&gt; list.forEach(h =&gt; pm.expect(h.class).to.eql("Маг")));<br>pm.test("Количество", () =&gt; pm.expect(list.length).to.eql(Number(pm.response.headers.get("x-total-count"))));<br>pm.test("JSON", () =&gt; pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json"));</code>',
      ],
    },
    {
      id: 'pm-13',
      title: 'Проверка JSON-схемы',
      giver: { name: 'Зодчий схем', sprite: '📐' },
      gold: 188,
      open: 'Герой по id',
      outro: 'Схема проверяет контракт целиком: типы, обязательные поля и null. Расхождение с документацией — повод для вопроса аналитику или для баг-репорта.',
      steps: [
        { id: 'schema', text: 'Опиши схему героя по документации: <code>id</code>, <code>level</code> — integer, <code>name</code>, <code>class</code>, <code>guild</code> — string, все пять обязательны. Проверь ответ для героя 1 через <code>pm.response.to.have.jsonSchema(schema)</code>.',
          check: (c) => reqs(c, (e) => e.path === '/heroes/1' && green(e) && /jsonSchema|tv4/.test(e.testsScript) && catches(e, (m) => { m.json.level = '7'; }) && catches(e, (m) => { delete m.json.name; })).length > 0,
          success: 'Схема ловит и неверный тип, и пропавшее поле.' },
        { id: 'bug', text: 'Прогони тот же тест на герое с <code>id</code> = 10.',
          check: (c) => reqs(c, (e) => e.path === '/heroes/10' && e.status === 200 && failedTest(e)).length > 0,
          success: 'Тест упал: в ответе есть расхождение со схемой.' },
        { id: 'field', text: 'Какое поле нарушает схему у героя 10?',
          answer: { kind: 'choice', options: ['id', 'name', 'level', 'guild'], accept: (v) => v === 3, wrong: 'Прочитай сообщение в Test Results: data.<поле> should be string.' } },
        { id: 'fix', text: 'Аналитик подтвердил: гильдии у героя может не быть. Разреши <code>guild</code> быть <code>null</code> (<code>"type": ["string", "null"]</code>) — тест для героя 10 должен пройти.',
          check: (c) => reqs(c, (e) => e.path === '/heroes/10' && green(e) && /jsonSchema|tv4/.test(e.testsScript) && catches(e, (m) => { m.json.guild = 5; }) && catches(e, (m) => { m.json.level = '2'; })).length > 0,
          success: 'Схема уточнена и всё ещё строгая.' },
      ],
      hints: [
        'Схема — обычный JS-объект: <code>{ type: "object", required: [...], properties: { поле: { type: ... } } }</code>.',
        'Сначала id = 1 → Send. Потом в Path Variables id = 10 → Send и прочитай сообщение в Test Results.',
        '<code>const schema = { type: "object", required: ["id","name","class","level","guild"], properties: { id: {type:"integer"}, name: {type:"string"}, class: {type:"string"}, level: {type:"integer"}, guild: {type:"string"} } };<br>pm.test("Схема", () =&gt; pm.response.to.have.jsonSchema(schema));</code> Ответ: guild. Затем <code>guild: {type: ["string","null"]}</code> → Send с id = 10.',
      ],
    },
    {
      id: 'pm-14',
      title: 'Pre-request Script и динамические данные',
      giver: { name: 'Чародей случайностей', sprite: '🎲' },
      gold: 197,
      open: 'Создать героя',
      setup: (w) => { setEnv(w, 'token', M.TOKEN); bearerColl(w); },
      outro: 'Уникальные тестовые данные на каждый прогон избавляют от конфликтов и «мусорных» зависимостей между тестами.',
      steps: [
        { id: 'dyn', text: 'Создай героя с динамическим именем: в теле используй встроенную переменную, например <code>"name": "Герой-{{$randomInt}}"</code>.',
          check: (c) => reqs(c, (e) => e.method === 'POST' && e.path === '/heroes' && e.status === 201 && /\{\{\$\w+\}\}/.test(e.bodyTemplate)).length > 0,
          success: 'Postman подставил случайное число при отправке.' },
        { id: 'pre', text: 'На вкладке <b>Pre-request Script</b> сгенерируй имя сам (например, <code>pm.variables.set(\'heroName\', \'QA-\' + Date.now() % 100000)</code>) и используй <code>{{heroName}}</code> в теле. Получи <code>201</code>.',
          check: (c) => reqs(c, (e) => e.status === 201 && !e.preError && e.varChanges.some((v) => v.phase === 'pre' && e.bodyTemplate.includes(`{{${v.key}}}`))).length > 0,
          success: 'Переменная создана скриптом до отправки и подставилась в тело.' },
        { id: 'hdr', text: 'В Pre-request Script добавь заголовок трассировки: <code>pm.request.headers.add({ key: \'X-Trace-Id\', value: ... })</code> и отправь запрос.',
          check: (c) => reqs(c, (e) => e.preHeaders.length > 0 && e.status >= 200 && e.status < 300 && e.preHeaders.every((h) => hdr(e, h.key) !== undefined)).length > 0,
          success: 'Заголовок добавлен скриптом — его видно в Console.' },
        { id: 'ts', text: 'Что подставит <code>{{$timestamp}}</code>?',
          answer: { kind: 'choice', options: ['Текущую дату в формате ДД.ММ.ГГГГ', 'Unix-время в секундах', 'Случайный GUID', 'Время ответа сервера в мс'], accept: (v) => v === 1 } },
      ],
      hints: [
        'Встроенные динамические переменные начинаются с <code>$</code>: <code>{{$randomInt}}</code>, <code>{{$guid}}</code>, <code>{{$timestamp}}</code>. Pre-request Script выполняется перед отправкой.',
        'Имя героя — не длиннее 32 символов (GUID длиной 36 не подойдёт). В Pre-request: <code>pm.variables.set("heroName", …)</code>, в Body: <code>"name": "{{heroName}}"</code>.',
        'Тело: <code>{"name": "Герой-{{$randomInt}}", "class": "Маг", "level": 3}</code> → Send. Pre-request: <code>pm.variables.set("heroName", "QA-" + Date.now() % 100000);<br>pm.request.headers.add({ key: "X-Trace-Id", value: pm.variables.replaceIn("{{$guid}}") });</code>, в теле <code>"name": "{{heroName}}"</code> → Send. Ответ: Unix-время в секундах.',
      ],
    },
    {
      id: 'pm-15',
      title: 'Цепочки запросов',
      giver: { name: 'Звонарь цепей', sprite: '⛓️' },
      gold: 206,
      open: 'Логин',
      setup: (w) => { bearerColl(w); setEnv(w, 'token', ''); },
      outro: 'Цепочка «логин → создать → прочитать → удалить» без ручного копирования — основа любого автотеста API.',
      steps: [
        { id: 'token', text: 'В <b>Логин</b> на вкладке <b>Tests</b> сохрани токен из ответа в окружение: <code>pm.environment.set(\'token\', pm.response.json().token)</code>. Отправь логин.',
          check: (c) => reqs(c, (e) => e.path === '/auth/login' && e.status === 200 && tokenSet(e)).length > 0,
          success: 'Токен записан скриптом — копировать руками больше не нужно.' },
        { id: 'me', text: 'Отправь <b>Кто я</b>: коллекция берёт Bearer <code>{{token}}</code>, который только что положил скрипт.',
          check: (c) => reqs(c, (e) => e.path === '/me' && e.status === 200 && /\{\{\s*token\s*\}\}/.test(e.authRaw)).length > 0,
          success: '200.' },
        { id: 'id', text: 'Создай героя и в его Tests сохрани id из ответа в переменную (например, <code>pm.collectionVariables.set(\'heroId\', pm.response.json().id)</code>).',
          check: (c) => reqs(c, (e) => e.method === 'POST' && e.path === '/heroes' && e.status === 201 && e.varChanges.some((v) => String(v.value) === String(e.json.id))).length > 0,
          success: 'id созданного героя сохранён.' },
        { id: 'use', text: 'Запроси созданного героя через переменную: в «Герой по id» укажи <code>id</code> = <code>{{heroId}}</code> → <code>200</code>.',
          check: (c) => {
            const made = reqs(c, (e) => e.method === 'POST' && e.status === 201);
            return reqs(c, (e) => e.method === 'GET' && heroPath.test(e.path) && e.status === 200 && /\{\{\w+\}\}/.test(e.rawUrl) && made.some((m) => m.json.id === e.json.id)).length > 0;
          },
          success: 'Запрос взял id из предыдущего ответа.' },
        { id: 'del', text: 'Удали этого героя так же, через переменную → <code>204</code>.',
          check: (c) => {
            const made = reqs(c, (e) => e.method === 'POST' && e.status === 201).map((m) => `/heroes/${m.json.id}`);
            return reqs(c, (e) => e.method === 'DELETE' && e.status === 204 && /\{\{\w+\}\}/.test(e.rawUrl) && made.includes(e.path)).length > 0;
          },
          success: 'Цепочка собрана: данные создаются и удаляются сами.' },
      ],
      hints: [
        'Тест может не только проверять, но и сохранять данные из ответа в переменные: <code>pm.environment.set</code>, <code>pm.collectionVariables.set</code>.',
        'В Логин → Tests: <code>pm.environment.set("token", pm.response.json().token);</code>. В Создать героя → Tests: <code>pm.collectionVariables.set("heroId", pm.response.json().id);</code>. Path Variable id = <code>{{heroId}}</code>.',
        'Логин: тело mage/chronicles + скрипт → Send. Кто я → Send. Создать героя: <code>{"name": "Цепь", "class": "Воин", "level": 2}</code> + скрипт heroId → Send. Герой по id: id = <code>{{heroId}}</code> → Send. Удалить героя: id = <code>{{heroId}}</code> → Send.',
      ],
    },
    {
      id: 'pm-16',
      title: 'Postman Console',
      giver: { name: 'Провидица консоли', sprite: '🔮' },
      gold: 215,
      open: 'Кто я',
      openTab: 'auth',
      setup: (w) => { setEnv(w, 'token', M.TOKEN); const r = reqByName(w, 'Кто я'); r.auth = Object.assign(emptyAuth('bearer'), { token: '{{tokne}}' }); },
      outro: 'Console показывает то, что реально ушло на сервер. Это первое место, куда смотреть, когда «в Postman всё правильно, а не работает».',
      steps: [
        { id: 'send', text: 'Коллега жалуется: «Кто я» отвечает 401, хотя токен в окружении правильный. Отправь запрос.',
          check: (c) => reqs(c, (e) => e.path === '/me' && e.status === 401).length > 0,
          success: '401 воспроизведён.' },
        { id: 'open', text: 'Открой <b>Console</b> (кнопка внизу) и разверни последний запрос.',
          check: (c) => c.log.some((e) => e.type === 'console-open'),
          success: 'В Console видны Request Headers — ровно то, что получил сервер.' },
        { id: 'raw', text: 'Что на самом деле ушло в заголовке <code>Authorization</code>?',
          answer: { kind: 'text', placeholder: 'значение заголовка', accept: (v) => /\{\{\s*tokne\s*\}\}/.test(v), wrong: 'Скопируй значение из Console → Request Headers → Authorization.' } },
        { id: 'fix', text: 'Исправь ошибку и получи <code>200</code>.',
          check: (c) => reqs(c, (e) => e.path === '/me' && e.status === 200).length > 0,
          success: 'Опечатка в имени переменной: неизвестная переменная уходит на сервер как есть.' },
        { id: 'log', text: 'Добавь в Tests «Кто я» вывод <code>console.log(pm.response.json())</code>, отправь и найди его в Console.',
          check: (c) => reqs(c, (e) => e.path === '/me' && e.logs.some((l) => l.phase === 'test')).length > 0,
          success: 'console.log из скриптов — главный инструмент отладки тестов.' },
      ],
      hints: [
        'Консоль показывает сырой запрос после подстановки переменных. Сравни заголовок с тем, что ты ожидаешь.',
        'Console → разверни строку GET …/me → Request Headers → Authorization. Затем вкладка Authorization запроса.',
        'В заголовке ушло <code>Bearer {{tokne}}</code> — опечатка. Исправь Token на <code>{{token}}</code> → Send (200). В Tests: <code>console.log(pm.response.json());</code> → Send.',
      ],
    },
    {
      id: 'pm-17',
      title: 'Code snippet и импорт cURL',
      giver: { name: 'Толмач', sprite: '🗣️' },
      gold: 224,
      open: 'Создать героя',
      setup: (w) => { setEnv(w, 'token', M.TOKEN); bearerColl(w); },
      outro: 'cURL — общий язык тестировщика и разработчика: прикладывай его к баг-репорту и импортируй чужие.',
      steps: [
        { id: 'snippet', text: 'Открой у запроса <b>Создать героя</b> кнопку <b>&lt;/&gt;</b> (Code snippet) и выбери <b>cURL</b>.',
          check: (c) => c.log.some((e) => e.type === 'snippet' && e.lang === 'curl' && e.method === 'POST'),
          success: 'Такой cURL разработчик выполнит у себя без Postman.' },
        { id: 'import', text: 'Разработчик прислал команду. Нажми <b>Import</b> вверху и вставь её:<br><code>curl --location --request PATCH \'' + BASE + '/heroes/4\' --header \'Authorization: Bearer ' + M.TOKEN + '\' --header \'Content-Type: application/json\' --data \'{"level": 0}\'</code>',
          check: (c) => c.log.some((e) => e.type === 'import' && e.method === 'PATCH' && /\/heroes\/4/.test(e.url)),
          success: 'Запрос импортирован: метод, заголовки и тело разобраны.' },
        { id: 'send', text: 'Отправь импортированный запрос.',
          check: (c) => reqs(c, (e) => e.imported && e.method === 'PATCH' && e.path === '/heroes/4' && e.status === 200).length > 0,
          success: 'Сервер ответил 200 и записал level = 0.' },
        { id: 'bug', text: 'По схеме <code>level</code> — от 1 до 100. Как оценить ответ 200 на <code>level: 0</code>?',
          answer: { kind: 'choice', options: ['Всё верно: 0 — допустимое число', 'Баг: нижняя граница не проверяется, ожидался 400', 'Баг клиента: Postman неверно отправил тело', 'Ожидался 404'], accept: (v) => v === 1 } },
        { id: 'save', text: 'Сохрани импортированный запрос в коллекцию (<b>Save</b>, папка Heroes), чтобы он стал регрессионной проверкой.',
          check: (c) => c.log.some((e) => e.type === 'save' && e.imported && e.folderId !== undefined),
          success: 'Запрос из баг-репорта теперь в коллекции.' },
      ],
      hints: [
        'Кнопка &lt;/&gt; справа от имени запроса показывает код на разных языках. Import вверху принимает cURL.',
        'Import → вставь команду целиком → Import. Откроется черновик PATCH с заголовками и телом. Send, затем Save.',
        '&lt;/&gt; → Language = cURL. Import → вставь команду из шага → Import → Send (200). Ответ: баг, ожидался 400. Save → Save to: Хроники API / Heroes → Save.',
      ],
    },
    {
      id: 'pm-18',
      title: 'Collection Runner',
      giver: { name: 'Капитан дозора', sprite: '⚔️' },
      gold: 233,
      setup: (w) => {
        w.collection.items.push(mkFolder('Smoke', [
          mkReq('Список героев', 'GET', '{{baseUrl}}/heroes', { tests: 'pm.test("Статус 200", () => pm.response.to.have.status(200));\npm.test("Пришёл массив", () => pm.expect(pm.response.json()).to.be.an("array"));' }),
          mkReq('Айра', 'GET', '{{baseUrl}}/heroes/1', { tests: 'pm.test("Имя — Айра", () => pm.expect(pm.response.json().name).to.eql("Айра"));' }),
          mkReq('Кто я без токена', 'GET', '{{baseUrl}}/me', { auth: { type: 'none' }, tests: 'pm.test("Без токена доступ запрещён", () => pm.response.to.have.status(200));' }),
        ]));
      },
      outro: 'Runner прогоняет всю папку одним кликом — это и есть смоук-тест после каждого деплоя.',
      steps: [
        { id: 'run1', text: 'Запусти папку <b>Smoke</b> через Runner (▶ у папки) и посмотри отчёт.',
          check: (c) => runs(c, (r) => r.target.endsWith('Smoke') && r.failed > 0).length > 0,
          success: 'Один тест красный.' },
        { id: 'which', text: 'Какой запрос упал?',
          answer: { kind: 'choice', options: ['Список героев', 'Айра', 'Кто я без токена'], accept: (v) => v === 2 } },
        { id: 'fix', text: 'Разберись: это баг API или ошибка в тесте? Исправь, не убирая проверку, и прогони Smoke снова — всё зелёное.',
          check: (c) => runs(c, (r) => r.target.endsWith('Smoke') && r.failed === 0 && !r.errors && r.results.length >= 3 && r.results.every((x) => x.tests.length > 0) && r.results.some((x) => x.path === '/me' && x.status === 401)).length > 0,
          success: 'Ошибка была в тесте: без токена правильный ответ — 401.' },
        { id: 'iter', text: 'Прогони Smoke с <b>Iterations</b> = 3 — стабильно зелёным.',
          check: (c) => runs(c, (r) => r.target.endsWith('Smoke') && r.iterations >= 3 && r.failed === 0 && !r.errors && r.results.some((x) => x.path === '/me' && x.status === 401)).length > 0,
          success: 'Три итерации подряд без падений: тесты стабильны.' },
      ],
      hints: [
        'У папки в дереве есть кнопка ▶ — она открывает Runner с этой папкой. Отчёт показывает каждый тест.',
        'Тест «Без токена доступ запрещён» ждёт 200, хотя без токена правильный ответ — 401. Исправь ожидание во вкладке Tests этого запроса, а не авторизацию.',
        '▶ у Smoke → Run Smoke (1 FAIL). Ответ: «Кто я без токена». Открой его → Tests → <code>to.have.status(401)</code> → Runner → Run. Затем Iterations = 3 → Run.',
      ],
    },
    {
      id: 'pm-19',
      title: 'Data-driven: CSV и JSON',
      giver: { name: 'Картограф данных', sprite: '🗺️' },
      gold: 242,
      open: 'Создать из данных',
      openTab: 'tests',
      setup: (w) => {
        setEnv(w, 'token', M.TOKEN);
        bearerColl(w);
        w.collection.items.push(mkFolder('Создание героев', [
          mkReq('Создать из данных', 'POST', '{{baseUrl}}/heroes', { body: { mode: 'raw', raw: '{\n  "name": "{{name}}",\n  "class": "{{class}}",\n  "level": {{level}}\n}' } }),
        ]));
      },
      outro: 'Один запрос и файл данных заменяют десятки копий запроса. Ожидаемый результат — тоже колонка в данных.',
      steps: [
        { id: 'csv', text: 'Тело «Создать из данных» берёт <code>{{name}}</code>, <code>{{class}}</code>, <code>{{level}}</code> из файла данных. Напиши тест, который сверяет код ответа с колонкой <code>expected</code> (<code>pm.iterationData.get(\'expected\')</code>), и запусти папку в Runner с файлом <b>heroes.csv</b>.',
          check: (c) => runs(c, (r) => r.file === 'heroes.csv' && r.iterations >= 5 && r.results.filter((x) => x.path === '/heroes' && x.method === 'POST' && x.tests.length > 0).length >= 5).length > 0,
          success: 'Пять итераций — по одной на строку файла.' },
        { id: 'datatest', text: 'Тест должен падать только там, где сервер ведёт себя не по ожиданию из файла. Добейся, чтобы красной была ровно одна итерация.',
          check: (c) => runs(c, (r) => {
            if (r.file !== 'heroes.csv') return false;
            const posts = r.results.filter((x) => x.path === '/heroes' && x.method === 'POST');
            const bad = posts.filter((x) => x.testError || x.tests.some((t) => !t.pass));
            return posts.length >= 5 && posts.every((x) => x.tests.length > 0) && bad.length === 1 && bad[0].data.level === '0';
          }).length > 0,
          success: 'Упала одна строка — там, где сервер не выполнил ожидание.' },
        { id: 'bug', text: 'Как зовут героя из строки, которая упала?',
          answer: { kind: 'text', placeholder: 'имя', accept: (v) => /^нулла$/i.test(String(v).trim()), wrong: 'Посмотри в отчёте Runner номер красной итерации и найди её в превью файла.' } },
        { id: 'json', text: 'Запусти ту же папку с файлом <b>heroes.json</b> (граничные значения level 1, 100 и 101) — все итерации зелёные.',
          check: (c) => runs(c, (r) => r.file === 'heroes.json' && r.iterations >= 3 && r.failed === 0 && !r.errors && r.results.filter((x) => x.path === '/heroes').length >= 3).length > 0,
          success: 'Верхняя граница работает, а нижняя (level 0) — нет: это баг для отчёта.' },
      ],
      hints: [
        'В Runner есть поле Data: Select File. Колонки файла становятся переменными, а в скриптах доступны через <code>pm.iterationData.get("колонка")</code>.',
        'В CSV значения — строки, поэтому сравнивай через <code>Number(...)</code>. Runner: ▶ у папки «Создание героев» → Data → heroes.csv (Iterations станет 5) → Run.',
        'Tests: <code>pm.test("Код как в данных", () =&gt; pm.response.to.have.status(Number(pm.iterationData.get("expected"))));</code> → ▶ → Data = heroes.csv → Run (падает 5-я строка, Нулла: level 0 принят). Затем Data = heroes.json → Run.',
      ],
    },
    {
      id: 'pm-20',
      title: 'Финал: регресс-коллекция',
      giver: { name: 'Магистр автотестов', sprite: '👑' },
      gold: 250,
      setup: (w) => { bearerColl(w); setEnv(w, 'token', ''); w.collection.items.push(mkFolder('Регресс')); },
      outro: 'Такая коллекция запускается в CI через Newman (postman collection run) на каждый деплой.',
      steps: [
        { id: 'build', text: 'Собери в пустой папке <b>Регресс</b> минимум 4 запроса, и в каждом — тесты. Используй <b>Save As</b> из готовых запросов или <b>＋</b> у папки.',
          check: (c) => { const f = folderByName(ws(c), 'Регресс'); const rs = f ? requestsUnder(f) : []; return rs.length >= 4 && rs.every((r) => r.tests.trim()); },
          success: 'Каркас регресса готов.' },
        { id: 'chain', text: 'Первым в папке должен быть логин, который в Tests кладёт токен в переменную <code>token</code>. Запусти Регресс в Runner: авторизованные запросы должны пройти с этим токеном.',
          check: (c) => runs(c, (r) => r.target.endsWith('Регресс') && r.results.some((x, i) => x.path === '/auth/login' && x.status === 200 && tokenSet(x)
            && r.results.slice(i + 1).some((y) => y.iteration === x.iteration && hdr(y, 'authorization') === `Bearer ${M.TOKEN}` && y.status >= 200 && y.status < 300))).length > 0,
          success: 'Цепочка внутри прогона работает.' },
        { id: 'neg', text: 'Добавь в регресс негативную проверку: например, запрос удалённого героя → <code>404</code> или запрос без токена → <code>401</code>, с тестом на этот код.',
          check: (c) => runs(c, (r) => r.target.endsWith('Регресс') && r.results.some((x) => x.status >= 400 && x.status < 500 && green(x))).length > 0,
          success: 'Негативный сценарий проверен.' },
        { id: 'green', text: 'Финальный прогон Регресса: минимум 4 запроса, минимум 3 разных метода, в каждом запросе тесты, ни одного падения.',
          check: (c) => runs(c, (r) => {
            if (!r.target.endsWith('Регресс') || r.failed > 0 || r.errors) return false;
            const first = r.results.filter((x) => x.iteration === 0);
            return first.length >= 4 && first.every((x) => x.tests.length > 0) && new Set(first.map((x) => x.method)).size >= 3;
          }).length > 0,
          success: 'Регресс-коллекция зелёная. Это готовый автотест API.' },
      ],
      hints: [
        'Типовой регресс: логин (сохраняет токен) → создать героя (сохраняет id) → прочитать героя → удалить → прочитать снова и ждать 404. Авторизация коллекции уже ссылается на <code>{{token}}</code>.',
        'Открой «Логин» → Save As → Save to: Регресс. Так же скопируй «Создать героя», «Герой по id», «Удалить героя». Порядок в папке — порядок прогона. В каждом запросе напиши Tests.',
        'Логин: тело mage/chronicles, Tests <code>pm.test("200", () =&gt; pm.response.to.have.status(200)); pm.environment.set("token", pm.response.json().token);</code>. Создать: Tests <code>pm.test("201", () =&gt; pm.response.to.have.status(201)); pm.collectionVariables.set("heroId", pm.response.json().id);</code>. Удалить: id = <code>{{heroId}}</code>, тест на 204. Ещё раз «Герой по id» с <code>{{heroId}}</code> и тестом на 404. ▶ у Регресса → Run.',
      ],
    },
  ];

  Quest.create({
    mode: 'postman',
    icon: '📮',
    title: 'API · Postman',
    buildSim,
    levels: LEVELS,
  });
})();
