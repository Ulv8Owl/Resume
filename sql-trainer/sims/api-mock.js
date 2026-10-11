// Имитация сервера «Хроники API» для симуляторов Swagger и Postman.
// Каждый уровень получает свою копию данных. В сервере есть намеренный баг на граничном значении level.
(function (root) {
  'use strict';

  const BASE = 'https://api.chronicles.guild/v1';
  const TOKEN = 'tok_7f3a9c21';
  const LOGIN = { login: 'mage', password: 'chronicles' };
  const CLASSES = ['Маг', 'Воин', 'Лучник', 'Жрец', 'Паладин', 'Плут'];

  const SEED = [
    [1, 'Айра', 'Маг', 7, 'Орден Пепла'],
    [2, 'Борин', 'Воин', 9, 'Серебряный Клинок'],
    [3, 'Велена', 'Лучник', 5, 'Лесные Тени'],
    [4, 'Гримм', 'Воин', 4, 'Серебряный Клинок'],
    [5, 'Даэль', 'Маг', 11, 'Дом Совы'],
    [6, 'Ессения', 'Жрец', 6, 'Серебряный Клинок'],
    [7, 'Жорен', 'Маг', 3, 'Орден Пепла'],
    [8, 'Зира', 'Лучник', 8, 'Лесные Тени'],
    [9, 'Ирвин', 'Воин', 12, 'Орден Пепла'],
    [10, 'Кайра', 'Маг', 2, null],
  ];

  const STATUS_TEXT = { 200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 405: 'Method Not Allowed', 415: 'Unsupported Media Type' };

  function create() {
    const heroes = SEED.map(([id, name, cls, level, guild]) => ({ id, name, class: cls, level, guild }));
    let nextId = 11;

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

    function authorized(headers) {
      const h = Object.keys(headers || {}).find((k) => k.toLowerCase() === 'authorization');
      return h && String(headers[h]).trim() === `Bearer ${TOKEN}`;
    }

    function parseBody(req) {
      if (!req.body || !String(req.body).trim()) return { empty: true };
      try { return { value: JSON.parse(req.body) }; } catch (e) { return { malformed: true }; }
    }

    // Валидация героя по схеме HeroCreate. Баг сервера: нижняя граница level не проверяется.
    function validateHero(b) {
      const errors = [];
      if (typeof b !== 'object' || b === null || Array.isArray(b)) return [{ field: 'body', message: 'must be an object' }];
      if (typeof b.name !== 'string' || !b.name.trim()) errors.push({ field: 'name', message: 'required' });
      else if (b.name.length > 32) errors.push({ field: 'name', message: 'must be at most 32 characters' });
      if (b.class === undefined) errors.push({ field: 'class', message: 'required' });
      else if (!CLASSES.includes(b.class)) errors.push({ field: 'class', message: `must be one of: ${CLASSES.join(', ')}` });
      if (b.level === undefined) errors.push({ field: 'level', message: 'required' });
      else if (!Number.isInteger(b.level)) errors.push({ field: 'level', message: 'must be an integer' });
      else if (b.level > 100) errors.push({ field: 'level', message: 'must be <= 100' });
      return errors;
    }

    function handle(req) {
      let url;
      try { url = new URL(req.url); } catch (e) { return { networkError: 'Invalid URL' }; }
      if (!(url.origin + url.pathname + '/').startsWith(BASE + '/')) {
        return { networkError: `getaddrinfo ENOTFOUND ${url.hostname}` };
      }
      const path = url.pathname.replace(/^\/v1/, '').replace(/\/$/, '') || '/';
      const method = (req.method || 'GET').toUpperCase();
      const seg = path.split('/').filter(Boolean);

      if (path === '/auth/login') {
        if (method !== 'POST') return reply(405, { error: 'Method Not Allowed' });
        const b = parseBody(req);
        if (b.malformed) return reply(400, { error: 'Malformed JSON' });
        const v = b.value || {};
        if (!v.login || !v.password) return reply(400, { error: 'login and password are required' });
        if (v.login !== LOGIN.login || v.password !== LOGIN.password) return reply(401, { error: 'Invalid credentials' });
        return reply(200, { token: TOKEN, token_type: 'Bearer', expires_in: 3600 });
      }

      if (path === '/me') {
        if (method !== 'GET') return reply(405, { error: 'Method Not Allowed' });
        if (!authorized(req.headers)) return reply(401, { error: 'Unauthorized' }, { 'www-authenticate': 'Bearer' });
        return reply(200, { login: LOGIN.login, role: 'tester', guild: 'Дом Совы' });
      }

      if (seg[0] === 'heroes' && seg.length === 1) {
        if (method === 'GET') {
          let list = heroes.slice();
          const cls = url.searchParams.get('class');
          if (cls) list = list.filter((h) => h.class === cls);
          const limit = url.searchParams.get('limit');
          if (limit !== null) {
            if (!/^\d+$/.test(limit)) return reply(400, { error: 'limit must be a positive integer' });
            list = list.slice(0, Number(limit));
          }
          return reply(200, list, { 'x-total-count': String(list.length) });
        }
        if (method === 'POST') {
          if (!authorized(req.headers)) return reply(401, { error: 'Unauthorized' }, { 'www-authenticate': 'Bearer' });
          const b = parseBody(req);
          if (b.malformed) return reply(400, { error: 'Malformed JSON' });
          const errors = validateHero(b.value);
          if (errors.length) return reply(400, { errors });
          const hero = { id: nextId++, name: b.value.name, class: b.value.class, level: b.value.level, guild: null };
          heroes.push(hero);
          return reply(201, hero, { location: `/v1/heroes/${hero.id}` });
        }
        return reply(405, { error: 'Method Not Allowed' });
      }

      if (seg[0] === 'heroes' && seg.length === 2) {
        if (!/^\d+$/.test(seg[1])) return reply(400, { error: 'id must be an integer' });
        const id = Number(seg[1]);
        const idx = heroes.findIndex((h) => h.id === id);
        if (method === 'GET') return idx < 0 ? reply(404, { error: 'Hero not found' }) : reply(200, heroes[idx]);
        if (method === 'DELETE') {
          if (!authorized(req.headers)) return reply(401, { error: 'Unauthorized' }, { 'www-authenticate': 'Bearer' });
          if (idx < 0) return reply(404, { error: 'Hero not found' });
          heroes.splice(idx, 1);
          return reply(204);
        }
        return reply(405, { error: 'Method Not Allowed' });
      }

      return reply(404, { error: `No route for ${method} ${path}` });
    }

    return { handle, heroes };
  }

  const MockApi = { create, BASE, TOKEN, LOGIN, CLASSES };
  if (typeof module !== 'undefined' && module.exports) module.exports = MockApi;
  else root.MockApi = MockApi;
})(typeof window !== 'undefined' ? window : globalThis);
