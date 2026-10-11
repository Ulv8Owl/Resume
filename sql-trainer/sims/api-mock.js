// Имитация сервера «Хроники API» для симуляторов Swagger и Postman.
// Каждый уровень получает свою копию данных. В сервере есть намеренный баг на граничном значении level.
// MockApi.create(options): options.bugs включает дополнительные намеренные баги (по умолчанию все выключены).
(function (root) {
  'use strict';

  const BASE = 'https://api.chronicles.guild/v1';
  const BASE_V2 = 'https://api.chronicles.guild/v2';
  const TOKEN = 'tok_7f3a9c21';
  const LOGIN = { login: 'mage', password: 'chronicles' };
  const READER_TOKEN = 'tok_reader_51b2';
  const READER_LOGIN = { login: 'scribe', password: 'quill' };
  const API_KEY = 'key_guild_9d4e';
  const CLASSES = ['Маг', 'Воин', 'Лучник', 'Жрец', 'Паладин', 'Плут'];
  const RARITIES = ['common', 'rare', 'epic', 'legendary'];
  const REALMS = ['north', 'south', 'east', 'west'];
  const QUEST_STATUSES = ['open', 'done'];

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

  const GUILD_SEED = [
    [1, 'Орден Пепла', 'Из пепла — сила'],
    [2, 'Серебряный Клинок', 'Честь и сталь'],
    [3, 'Лесные Тени', null],
    [4, 'Дом Совы', 'Знание — свет'],
  ];

  const ITEM_SEED = [
    [1, 'Посох ученика', 'common', 95, 'Первый посох любого мага'],
    [2, 'Кожаный плащ', 'common', 120, null],
    [3, 'Зелье лечения', 'common', 150, 'Восстанавливает 50 HP'],
    [4, 'Свиток огня', 'rare', 300, null],
    [5, 'Лук охотника', 'rare', 450, 'Бьёт на 40 шагов'],
    [6, 'Щит стража', 'rare', 800, null],
    [7, 'Амулет совы', 'rare', 950, 'Видит в темноте'],
    [8, 'Клинок рассвета', 'epic', 1200, null],
    [9, 'Мантия звездочёта', 'epic', 1500, 'Расшита созвездиями'],
    [10, 'Кольцо теней', 'epic', 2400, null],
    [11, 'Гримуар бури', 'legendary', 4500, 'Сорок страниц молний'],
    [12, 'Корона пепла', 'legendary', 9000, null],
    [13, 'Факел', 'common', 15, null],
    [14, 'Верёвка', 'common', 30, '15 метров'],
    [15, 'Карта подземелий', 'rare', 600, null],
    [16, 'Перо феникса', 'epic', 3100, 'Тёплое на ощупь'],
    [17, 'Сапоги скорохода', 'rare', 700, null],
    [18, 'Тролличий молот', 'epic', 2000, null],
    [19, 'Эльфийская стрела', 'common', 60, null],
    [20, 'Сфера провидца', 'legendary', 7500, 'Показывает будущее, но не всё'],
    [21, 'Пояс силы', 'rare', 520, null],
    [22, 'Кинжал плута', 'common', 210, null],
    [23, 'Слеза дракона', 'legendary', 10000, null],
  ];

  const QUEST_SEED = [
    [1, 'north', 'open', 300, 'Ледяной перевал', 'The Frozen Pass'],
    [2, 'north', 'done', 120, 'Волки у мельницы', 'Wolves at the Mill'],
    [3, 'north', 'open', 450, 'Сердце метели', 'Heart of the Blizzard'],
    [4, 'south', 'open', 200, 'Песчаный червь', 'The Sand Worm'],
    [5, 'south', 'done', 90, 'Пропавший караван', 'The Lost Caravan'],
    [6, 'south', 'open', 650, 'Гробница фараона', 'Tomb of the Pharaoh'],
    [7, 'east', 'open', 380, 'Нефритовый дракон', 'The Jade Dragon'],
    [8, 'east', 'done', 150, 'Чайная церемония', 'The Tea Ceremony'],
    [9, 'west', 'open', 260, 'Пираты залива', 'Pirates of the Bay'],
  ];

  const STATUS_TEXT = { 200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 415: 'Unsupported Media Type', 422: 'Unprocessable Entity', 500: 'Internal Server Error' };

  // options.bugs (все по умолчанию false):
  //   priceNoMax — у предмета не проверяется верхняя граница price;
  //   stringPrice — price-строка из цифр принимается и сохраняется строкой;
  //   sortAsString — сортировка предметов по price идёт как по строкам;
  //   guildDupCaseSensitive — дубликат имени гильдии ищется с учётом регистра;
  //   guildExtraField — в Guild приходит недокументированное поле treasury;
  //   guildCreate200 — POST /guilds отвечает 200 вместо 201;
  //   patchAsPut — PATCH /items/{id} затирает непереданные поля null;
  //   deleteTwice500 — повторный DELETE /items/{id} отвечает 500 вместо 404;
  //   readerCanDelete — роль reader может удалять предметы.
  function create(options) {
    const bugs = Object.assign({}, options && options.bugs);
    const heroes = SEED.map(([id, name, cls, level, guild]) => ({ id, name, class: cls, level, guild }));
    let nextId = 11;
    const guilds = GUILD_SEED.map(([id, name, motto]) => ({ id, name, motto }));
    let nextGuildId = 5;
    const items = ITEM_SEED.map(([id, name, rarity, price, description]) => ({ id, name, rarity, price, description }));
    let nextItemId = 24;
    const deletedItems = new Set();
    const quests = QUEST_SEED.map(([id, realm, status, reward, ru, en]) => ({ id, realm, status, reward, ru, en }));

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

    function header(headers, name) {
      const h = Object.keys(headers || {}).find((k) => k.toLowerCase() === name);
      return h === undefined ? undefined : String(headers[h]).trim();
    }

    function authorized(headers) {
      return header(headers, 'authorization') === `Bearer ${TOKEN}`;
    }

    // Роль по Bearer-токену: tester (полные права), reader (только чтение) или null.
    function roleOf(headers) {
      const a = header(headers, 'authorization');
      if (a === `Bearer ${TOKEN}`) return 'tester';
      if (a === `Bearer ${READER_TOKEN}`) return 'reader';
      return null;
    }

    const unauthorized = () => reply(401, { error: 'Unauthorized' }, { 'www-authenticate': 'Bearer' });
    const forbidden = () => reply(403, { error: 'Forbidden: role reader is read-only' });

    // Проверка прав на изменение данных: 401 без токена, 403 для читателя.
    function guardWrite(req, allowReader) {
      const role = roleOf(req.headers);
      if (!role) return unauthorized();
      if (role === 'reader' && !allowReader) return forbidden();
      return null;
    }

    function parseBody(req) {
      if (!req.body || !String(req.body).trim()) return { empty: true };
      try { return { value: JSON.parse(req.body) }; } catch (e) { return { malformed: true }; }
    }

    // Тело новых ресурсов принимается только как JSON (без заголовка — тоже считаем JSON).
    function jsonBody(req) {
      const ct = header(req.headers, 'content-type');
      if (ct !== undefined && !/application\/json/i.test(ct)) return { res: reply(415, { error: `Unsupported Media Type: ${ct}. Use application/json` }) };
      const b = parseBody(req);
      if (b.malformed) return { res: reply(400, { error: 'Malformed JSON' }) };
      return { value: b.empty ? {} : b.value };
    }

    const isObj = (b) => typeof b === 'object' && b !== null && !Array.isArray(b);

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

    // Валидация предмета по ItemCreate (partial — для PATCH).
    function validateItem(b, partial) {
      if (!isObj(b)) return [{ field: 'body', message: 'must be an object' }];
      const errors = [];
      const need = (f) => { if (!partial) errors.push({ field: f, message: 'required' }); };
      if (b.name === undefined) need('name');
      else if (typeof b.name !== 'string') errors.push({ field: 'name', message: 'must be a string' });
      else if (b.name.length < 1) errors.push({ field: 'name', message: 'must be at least 1 character' });
      else if (b.name.length > 40) errors.push({ field: 'name', message: 'must be at most 40 characters' });
      if (b.rarity === undefined) need('rarity');
      else if (!RARITIES.includes(b.rarity)) errors.push({ field: 'rarity', message: `must be one of: ${RARITIES.join(', ')}` });
      if (b.price === undefined) need('price');
      else if (bugs.stringPrice && typeof b.price === 'string' && /^\d+$/.test(b.price)) { /* баг: строку не отклоняем */ }
      else if (!Number.isInteger(b.price)) errors.push({ field: 'price', message: 'must be an integer' });
      else if (b.price < 1) errors.push({ field: 'price', message: 'must be >= 1' });
      else if (b.price > 10000 && !bugs.priceNoMax) errors.push({ field: 'price', message: 'must be <= 10000' });
      if (b.description !== undefined && b.description !== null) {
        if (typeof b.description !== 'string') errors.push({ field: 'description', message: 'must be a string or null' });
        else if (b.description.length > 200) errors.push({ field: 'description', message: 'must be at most 200 characters' });
      }
      return errors;
    }

    function validateGuild(b) {
      if (!isObj(b)) return [{ field: 'body', message: 'must be an object' }];
      const errors = [];
      if (b.name === undefined) errors.push({ field: 'name', message: 'required' });
      else if (typeof b.name !== 'string') errors.push({ field: 'name', message: 'must be a string' });
      else if (b.name.trim().length < 3) errors.push({ field: 'name', message: 'must be at least 3 characters' });
      else if (b.name.length > 40) errors.push({ field: 'name', message: 'must be at most 40 characters' });
      if (b.motto !== undefined && b.motto !== null && (typeof b.motto !== 'string' || b.motto.length > 80)) errors.push({ field: 'motto', message: 'must be a string up to 80 characters' });
      return errors;
    }

    function guildView(g) {
      const v = { id: g.id, name: g.name, motto: g.motto, members: heroes.filter((h) => h.guild === g.name).length };
      if (bugs.guildExtraField) v.treasury = 15000 + g.id * 250;
      return v;
    }

    function heroV2(h) {
      const g = guilds.find((x) => x.name === h.guild);
      return { id: h.id, name: h.name, class: h.class, level: h.level, guild: h.guild ? { id: g ? g.id : null, name: h.guild } : null };
    }

    const itemView = (it) => ({ id: it.id, name: it.name, rarity: it.rarity, price: it.price, description: it.description });

    function intParam(v, min, max) {
      if (v === null) return { none: true };
      if (!/^-?\d+$/.test(v)) return { bad: true };
      const n = Number(v);
      if (n < min || (max !== undefined && n > max)) return { bad: true };
      return { value: n };
    }

    function itemsList(url) {
      const q = url.searchParams;
      let list = items.slice();
      const rarity = q.get('rarity');
      if (rarity !== null && rarity !== '') {
        if (!RARITIES.includes(rarity)) return reply(400, { error: `rarity must be one of: ${RARITIES.join(', ')}` });
        list = list.filter((i) => i.rarity === rarity);
      }
      const minPrice = intParam(q.get('min_price'), 0);
      if (minPrice.bad) return reply(400, { error: 'min_price must be a non-negative integer' });
      if (!minPrice.none) list = list.filter((i) => Number(i.price) >= minPrice.value);
      const sort = q.get('sort') || 'id';
      if (!['id', 'name', 'price'].includes(sort)) return reply(400, { error: 'sort must be one of: id, name, price' });
      const order = q.get('order') || 'asc';
      if (!['asc', 'desc'].includes(order)) return reply(400, { error: 'order must be asc or desc' });
      const key = (i) => (sort === 'price' && bugs.sortAsString ? String(i.price) : i[sort]);
      list.sort((a, b) => {
        const x = key(a);
        const y = key(b);
        const c = typeof x === 'string' ? x.localeCompare(y, 'ru') : x - y;
        return order === 'desc' ? -c : c;
      });
      const limit = intParam(q.get('limit'), 1, 50);
      if (limit.bad) return reply(400, { error: 'limit must be an integer from 1 to 50' });
      const offset = intParam(q.get('offset'), 0);
      if (offset.bad) return reply(400, { error: 'offset must be a non-negative integer' });
      const total = list.length;
      const from = offset.none ? 0 : offset.value;
      const page = list.slice(from, from + (limit.none ? 10 : limit.value));
      return reply(200, page.map(itemView), { 'x-total-count': String(total) });
    }

    function itemsRoute(req, url, method, seg) {
      if (seg.length === 1) {
        if (method === 'GET') return itemsList(url);
        if (method === 'POST') {
          const g = guardWrite(req);
          if (g) return g;
          const b = jsonBody(req);
          if (b.res) return b.res;
          const errors = validateItem(b.value);
          if (errors.length) return reply(422, { errors });
          const v = b.value;
          const it = { id: nextItemId++, name: v.name, rarity: v.rarity, price: v.price, description: v.description === undefined ? null : v.description };
          items.push(it);
          return reply(201, itemView(it), { location: `/v1/items/${it.id}` });
        }
        return reply(405, { error: 'Method Not Allowed' });
      }
      if (seg.length !== 2) return null;
      if (!/^\d+$/.test(seg[1])) return reply(400, { error: 'id must be an integer' });
      const id = Number(seg[1]);
      const idx = items.findIndex((i) => i.id === id);
      if (method === 'GET') return idx < 0 ? reply(404, { error: 'Item not found' }) : reply(200, itemView(items[idx]));
      if (method === 'DELETE') {
        const g = guardWrite(req, bugs.readerCanDelete);
        if (g) return g;
        if (idx < 0) {
          if (bugs.deleteTwice500 && deletedItems.has(id)) return reply(500, { error: 'Internal Server Error', trace: 'NullReferenceException at ItemService.Delete' });
          return reply(404, { error: 'Item not found' });
        }
        items.splice(idx, 1);
        deletedItems.add(id);
        return reply(204);
      }
      if (method === 'PUT' || method === 'PATCH') {
        const g = guardWrite(req);
        if (g) return g;
        const b = jsonBody(req);
        if (b.res) return b.res;
        if (idx < 0) return reply(404, { error: 'Item not found' });
        const errors = validateItem(b.value, method === 'PATCH');
        if (errors.length) return reply(422, { errors });
        const v = b.value;
        const it = items[idx];
        if (method === 'PUT' || bugs.patchAsPut) {
          ['name', 'rarity', 'price', 'description'].forEach((f) => { it[f] = v[f] === undefined ? null : v[f]; });
        } else {
          ['name', 'rarity', 'price', 'description'].forEach((f) => { if (v[f] !== undefined) it[f] = v[f]; });
        }
        return reply(200, itemView(it));
      }
      return reply(405, { error: 'Method Not Allowed' });
    }

    function guildsRoute(req, method, seg) {
      if (seg.length === 1) {
        if (method === 'GET') return reply(200, guilds.map(guildView), { 'x-total-count': String(guilds.length) });
        if (method === 'POST') {
          const g = guardWrite(req);
          if (g) return g;
          const b = jsonBody(req);
          if (b.res) return b.res;
          const errors = validateGuild(b.value);
          if (errors.length) return reply(422, { errors });
          const name = b.value.name.trim();
          const same = (x) => (bugs.guildDupCaseSensitive ? x.name === name : x.name.toLowerCase() === name.toLowerCase());
          if (guilds.some(same)) return reply(409, { error: `Guild "${name}" already exists` });
          const guild = { id: nextGuildId++, name, motto: b.value.motto === undefined ? null : b.value.motto };
          guilds.push(guild);
          return reply(bugs.guildCreate200 ? 200 : 201, guildView(guild), bugs.guildCreate200 ? {} : { location: `/v1/guilds/${guild.id}` });
        }
        return reply(405, { error: 'Method Not Allowed' });
      }
      if (seg.length > 3 || (seg.length === 3 && seg[2] !== 'heroes')) return null;
      if (!/^\d+$/.test(seg[1])) return reply(400, { error: 'id must be an integer' });
      const id = Number(seg[1]);
      const idx = guilds.findIndex((x) => x.id === id);
      if (seg.length === 3) {
        if (method !== 'GET') return reply(405, { error: 'Method Not Allowed' });
        if (idx < 0) return reply(404, { error: 'Guild not found' });
        return reply(200, heroes.filter((h) => h.guild === guilds[idx].name));
      }
      if (method === 'GET') return idx < 0 ? reply(404, { error: 'Guild not found' }) : reply(200, guildView(guilds[idx]));
      if (method === 'DELETE') {
        const g = guardWrite(req);
        if (g) return g;
        if (idx < 0) return reply(404, { error: 'Guild not found' });
        guilds.splice(idx, 1);
        return reply(204);
      }
      return reply(405, { error: 'Method Not Allowed' });
    }

    function questsRoute(req, url, method) {
      if (method !== 'GET') return reply(405, { error: 'Method Not Allowed' });
      const realm = header(req.headers, 'x-realm');
      if (!realm) return reply(400, { error: 'X-Realm header is required' });
      if (!REALMS.includes(realm)) return reply(400, { error: `X-Realm must be one of: ${REALMS.join(', ')}` });
      const status = url.searchParams.get('status');
      if (status && !QUEST_STATUSES.includes(status)) return reply(400, { error: 'status must be open or done' });
      const lang = /^en/i.test(header(req.headers, 'accept-language') || '') ? 'en' : 'ru';
      const list = quests.filter((q) => q.realm === realm && (!status || q.status === status))
        .map((q) => ({ id: q.id, title: q[lang], realm: q.realm, status: q.status, reward: q.reward }));
      return reply(200, list, { 'content-language': lang });
    }

    function handle(req) {
      let url;
      try { url = new URL(req.url); } catch (e) { return { networkError: 'Invalid URL' }; }
      const full = url.origin + url.pathname + '/';
      const v2 = full.startsWith(BASE_V2 + '/');
      if (!full.startsWith(BASE + '/') && !v2) {
        return { networkError: `getaddrinfo ENOTFOUND ${url.hostname}` };
      }
      const path = url.pathname.replace(/^\/v[12]/, '').replace(/\/$/, '') || '/';
      const method = (req.method || 'GET').toUpperCase();
      const seg = path.split('/').filter(Boolean);

      if (path === '/auth/login') {
        if (method !== 'POST') return reply(405, { error: 'Method Not Allowed' });
        const b = parseBody(req);
        if (b.malformed) return reply(400, { error: 'Malformed JSON' });
        const v = b.value || {};
        if (!v.login || !v.password) return reply(400, { error: 'login and password are required' });
        if (v.login === READER_LOGIN.login && v.password === READER_LOGIN.password) return reply(200, { token: READER_TOKEN, token_type: 'Bearer', expires_in: 3600 });
        if (v.login !== LOGIN.login || v.password !== LOGIN.password) return reply(401, { error: 'Invalid credentials' });
        return reply(200, { token: TOKEN, token_type: 'Bearer', expires_in: 3600 });
      }

      if (path === '/me') {
        if (method !== 'GET') return reply(405, { error: 'Method Not Allowed' });
        const role = roleOf(req.headers);
        if (role === 'reader') return reply(200, { login: READER_LOGIN.login, role: 'reader', guild: 'Лесные Тени' });
        if (!authorized(req.headers)) return reply(401, { error: 'Unauthorized' }, { 'www-authenticate': 'Bearer' });
        return reply(200, { login: LOGIN.login, role: 'tester', guild: 'Дом Совы' });
      }

      // v2: список героев в конверте { data, total }, guild — объект { id, name }.
      if (v2 && seg[0] === 'heroes' && method === 'GET' && seg.length <= 2) {
        if (seg.length === 1) {
          let list = heroes.slice();
          const cls = url.searchParams.get('class');
          if (cls) list = list.filter((h) => h.class === cls);
          return reply(200, { data: list.map(heroV2), total: list.length });
        }
        if (!/^\d+$/.test(seg[1])) return reply(400, { error: 'id must be an integer' });
        const h = heroes.find((x) => x.id === Number(seg[1]));
        return h ? reply(200, heroV2(h)) : reply(404, { error: 'Hero not found' });
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

      let r = null;
      if (seg[0] === 'items') r = itemsRoute(req, url, method, seg);
      else if (seg[0] === 'guilds') r = guildsRoute(req, method, seg);
      else if (path === '/quests') r = questsRoute(req, url, method);
      else if (path === '/stats') {
        if (method !== 'GET') return reply(405, { error: 'Method Not Allowed' });
        const key = header(req.headers, 'x-api-key');
        if (!key) return reply(401, { error: 'API key required: X-API-Key header' });
        if (key !== API_KEY) return reply(401, { error: 'Invalid API key' });
        return reply(200, { heroes: heroes.length, guilds: guilds.length, items: items.length, quests: quests.length });
      }
      if (r) return r;

      return reply(404, { error: `No route for ${method} ${path}` });
    }

    return { handle, heroes, guilds, items, quests };
  }

  const MockApi = { create, BASE, BASE_V2, TOKEN, LOGIN, READER_TOKEN, READER_LOGIN, API_KEY, CLASSES, RARITIES, REALMS, QUEST_STATUSES };
  if (typeof module !== 'undefined' && module.exports) module.exports = MockApi;
  else root.MockApi = MockApi;
})(typeof window !== 'undefined' ? window : globalThis);
