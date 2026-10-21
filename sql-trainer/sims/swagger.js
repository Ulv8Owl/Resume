// Симулятор Swagger UI: документация «Хроник API», Servers, Try it out, Authorize (Bearer и API key), Responses и Schemas.
(function () {
  'use strict';

  const Core = window.Core;
  const M = window.MockApi;
  const esc = Core.esc;

  const SERVERS = [
    { url: M.BASE, description: 'v1 — тестовый стенд' },
    { url: M.BASE_V2, description: 'v2 (beta) — новая версия героев' },
  ];

  const SCHEMES = {
    bearerAuth: { label: 'http, Bearer', hint: 'токен без слова Bearer' },
    apiKeyAuth: { label: 'apiKey', hint: 'значение ключа', header: 'X-API-Key' },
  };

  // ---------- модели (components/schemas) ----------
  const S = (required, props, desc) => ({ required, props, desc });
  const int = (example, o) => Object.assign({ type: 'integer', example }, o);
  const str = (example, o) => Object.assign({ type: 'string', example }, o);
  const ITEM_PROPS = (forCreate) => ({
    name: str('Плащ ветра', { minLength: 1, maxLength: 40 }),
    rarity: str('rare', { enum: M.RARITIES }),
    price: int(350, { minimum: 1, maximum: 10000, desc: forCreate ? 'цена в золоте' : '' }),
    description: str('Лёгкий, как ветер', { maxLength: 200, nullable: true }),
  });
  const SCHEMAS = {
    Hero: S([], { id: int(5), name: str('Даэль'), class: str('Маг', { enum: M.CLASSES }), level: int(11, { minimum: 1, maximum: 100 }), guild: str('Дом Совы', { nullable: true }) }),
    HeroCreate: S(['name', 'class', 'level'], { name: str('Ульрих', { minLength: 1, maxLength: 32 }), class: str('Воин', { enum: M.CLASSES }), level: int(1, { minimum: 1, maximum: 100 }) }),
    GuildRef: S([], { id: int(4), name: str('Дом Совы') }),
    HeroV2: S([], { id: int(5), name: str('Даэль'), class: str('Маг', { enum: M.CLASSES }), level: int(11, { minimum: 1, maximum: 100 }), guild: { ref: 'GuildRef', nullable: true } }, 'Герой в API v2 (только сервер v2)'),
    HeroV2List: S([], { data: { type: 'array', items: 'HeroV2' }, total: int(10) }, 'Ответ GET /heroes в API v2'),
    LoginRequest: S(['login', 'password'], { login: str('mage'), password: str('chronicles', { format: 'password' }) }),
    Token: S([], { token: str('tok_…'), token_type: str('Bearer'), expires_in: int(3600) }),
    User: S([], { login: str('mage'), role: str('tester', { enum: ['tester', 'reader'], desc: 'reader — только чтение' }), guild: str('Дом Совы', { nullable: true }) }),
    Guild: S([], { id: int(4), name: str('Дом Совы'), motto: str('Знание — свет', { nullable: true }), members: int(1, { desc: 'число героев в гильдии' }) }),
    GuildCreate: S(['name'], { name: str('Дом Ворона', { minLength: 3, maxLength: 40, desc: 'уникально без учёта регистра' }), motto: str('Видим всё', { maxLength: 80 }) }),
    Item: S([], { id: int(7), name: str('Амулет совы'), rarity: str('rare', { enum: M.RARITIES }), price: int(950), description: str('Видит в темноте', { nullable: true }) }),
    ItemCreate: S(['name', 'rarity', 'price'], ITEM_PROPS(true)),
    ItemPatch: S([], ITEM_PROPS(false), 'Любое подмножество полей ItemCreate'),
    Quest: S([], { id: int(1), title: str('Ледяной перевал'), realm: str('north', { enum: M.REALMS }), status: str('open', { enum: M.QUEST_STATUSES }), reward: int(300) }),
    Stats: S([], { heroes: int(10), guilds: int(4), items: int(23), quests: int(9) }),
    Error: S([], { error: str('string') }),
    FieldError: S([], { field: str('name'), message: str('required') }),
    ValidationError: S([], { errors: { type: 'array', items: 'FieldError' } }),
  };

  // ---------- операции (paths) ----------
  const R = (d, schema, headers) => ({ d, schema, headers });
  const P = (name, where, type, o) => Object.assign({ name, in: where, type }, o);
  const ID = (what) => P('id', 'path', 'integer', { required: true, desc: `Идентификатор ${what}` });
  const MEDIA = ['application/json', 'application/xml', 'text/plain'];
  const OPS = [
    { tag: 'auth', method: 'POST', path: '/auth/login', summary: 'Получить токен доступа',
      description: 'Возвращает Bearer-токен по логину и паролю. Учётные записи стенда — в описании API.',
      body: { schema: 'LoginRequest', required: true, example: { login: 'mage', password: 'chronicles' } },
      responses: { 200: R('Токен выдан', 'Token'), 400: R('Не хватает полей', 'Error'), 401: R('Неверные учётные данные', 'Error') } },
    { tag: 'auth', method: 'GET', path: '/me', summary: 'Текущий пользователь', security: 'bearerAuth',
      responses: { 200: R('Профиль и роль', 'User'), 401: R('Нет или неверный токен', 'Error') } },

    { tag: 'heroes', method: 'GET', path: '/heroes', summary: 'Список героев',
      description: 'Можно отфильтровать по классу и ограничить количество. В API v2 ответ — объект HeroV2List.',
      params: [P('class', 'query', 'string', { desc: 'Класс героя', enum: M.CLASSES }), P('limit', 'query', 'integer', { desc: 'Сколько героев вернуть' })],
      responses: { 200: R('Массив Hero', 'Hero[]', { 'X-Total-Count': 'integer — число героев в ответе' }), 400: R('Неверный limit', 'Error') } },
    { tag: 'heroes', method: 'GET', path: '/heroes/{id}', summary: 'Герой по id',
      description: 'В API v2 возвращается HeroV2.',
      params: [ID('героя')],
      responses: { 200: R('Hero', 'Hero'), 400: R('id не целое число', 'Error'), 404: R('Герой не найден', 'Error') } },
    { tag: 'heroes', method: 'POST', path: '/heroes', summary: 'Создать героя', security: 'bearerAuth',
      description: 'Создаёт героя. Поля и ограничения — в схеме HeroCreate.',
      body: { schema: 'HeroCreate', required: true, example: { name: 'Ульрих', class: 'Воин', level: 1 } },
      responses: { 201: R('Созданный Hero', 'Hero'), 400: R('Ошибка валидации', 'ValidationError'), 401: R('Нет или неверный токен', 'Error') } },
    { tag: 'heroes', method: 'DELETE', path: '/heroes/{id}', summary: 'Удалить героя', security: 'bearerAuth',
      params: [ID('героя')],
      responses: { 204: R('Удалён'), 401: R('Нет или неверный токен', 'Error'), 404: R('Герой не найден', 'Error') } },

    { tag: 'guilds', method: 'GET', path: '/guilds', summary: 'Список гильдий',
      responses: { 200: R('Массив Guild', 'Guild[]') } },
    { tag: 'guilds', method: 'POST', path: '/guilds', summary: 'Основать гильдию', security: 'bearerAuth',
      description: 'Имя гильдии уникально без учёта регистра. Нужна роль tester.',
      body: { schema: 'GuildCreate', required: true, media: MEDIA, example: { name: 'Дом Ворона', motto: 'Видим всё' } },
      responses: { 201: R('Созданная Guild', 'Guild'), 401: R('Нет или неверный токен', 'Error'), 403: R('Роль reader не может изменять данные', 'Error'), 409: R('Гильдия с таким именем уже есть', 'Error'), 415: R('Тело не в application/json', 'Error'), 422: R('Ошибка валидации', 'ValidationError') } },
    { tag: 'guilds', method: 'GET', path: '/guilds/{id}', summary: 'Гильдия по id',
      params: [ID('гильдии')],
      responses: { 200: R('Guild', 'Guild'), 400: R('id не целое число', 'Error'), 404: R('Гильдия не найдена', 'Error') } },
    { tag: 'guilds', method: 'DELETE', path: '/guilds/{id}', summary: 'Распустить гильдию', security: 'bearerAuth',
      description: 'Нужна роль tester.',
      params: [ID('гильдии')],
      responses: { 204: R('Удалена'), 401: R('Нет или неверный токен', 'Error'), 403: R('Роль reader не может изменять данные', 'Error'), 404: R('Гильдия не найдена', 'Error') } },
    { tag: 'guilds', method: 'GET', path: '/guilds/{id}/heroes', summary: 'Герои гильдии',
      params: [ID('гильдии')],
      responses: { 200: R('Массив Hero', 'Hero[]'), 400: R('id не целое число', 'Error'), 404: R('Гильдия не найдена', 'Error') } },

    { tag: 'items', method: 'GET', path: '/items', summary: 'Список предметов',
      description: 'Фильтры, сортировка и пагинация. Общее число найденных предметов — в заголовке X-Total-Count.',
      params: [
        P('rarity', 'query', 'string', { desc: 'Редкость', enum: M.RARITIES }),
        P('min_price', 'query', 'integer', { desc: 'Минимальная цена, minimum: 0' }),
        P('sort', 'query', 'string', { desc: 'Поле сортировки, default: id', enum: ['id', 'name', 'price'] }),
        P('order', 'query', 'string', { desc: 'Направление, default: asc', enum: ['asc', 'desc'] }),
        P('limit', 'query', 'integer', { desc: 'Размер страницы: minimum 1, maximum 50, default 10' }),
        P('offset', 'query', 'integer', { desc: 'Сколько пропустить: minimum 0, default 0' }),
      ],
      responses: { 200: R('Страница предметов', 'Item[]', { 'X-Total-Count': 'integer — всего предметов с учётом фильтров' }), 400: R('Неверный параметр запроса', 'Error') } },
    { tag: 'items', method: 'POST', path: '/items', summary: 'Создать предмет', security: 'bearerAuth',
      description: 'Нужна роль tester. Тело — строго application/json по схеме ItemCreate.',
      body: { schema: 'ItemCreate', required: true, media: MEDIA, example: { name: 'Плащ ветра', rarity: 'rare', price: 350, description: 'Лёгкий, как ветер' } },
      responses: { 201: R('Созданный Item', 'Item'), 400: R('Некорректный JSON', 'Error'), 401: R('Нет или неверный токен', 'Error'), 403: R('Роль reader не может изменять данные', 'Error'), 415: R('Тело не в application/json', 'Error'), 422: R('Ошибка валидации по схеме', 'ValidationError') } },
    { tag: 'items', method: 'GET', path: '/items/{id}', summary: 'Предмет по id',
      params: [ID('предмета')],
      responses: { 200: R('Item', 'Item'), 400: R('id не целое число', 'Error'), 404: R('Предмет не найден', 'Error') } },
    { tag: 'items', method: 'PUT', path: '/items/{id}', summary: 'Заменить предмет целиком', security: 'bearerAuth',
      description: 'Полная замена: передаются все обязательные поля ItemCreate, непереданные необязательные станут null.',
      params: [ID('предмета')],
      body: { schema: 'ItemCreate', required: true, media: MEDIA, example: { name: 'Зелье лечения', rarity: 'common', price: 150, description: 'Восстанавливает 50 HP' } },
      responses: { 200: R('Обновлённый Item', 'Item'), 400: R('Некорректный JSON или id', 'Error'), 401: R('Нет или неверный токен', 'Error'), 403: R('Роль reader', 'Error'), 404: R('Предмет не найден', 'Error'), 415: R('Тело не в application/json', 'Error'), 422: R('Ошибка валидации', 'ValidationError') } },
    { tag: 'items', method: 'PATCH', path: '/items/{id}', summary: 'Изменить поля предмета', security: 'bearerAuth',
      description: 'Частичное обновление: меняются только переданные поля, остальные остаются прежними.',
      params: [ID('предмета')],
      body: { schema: 'ItemPatch', required: true, media: MEDIA, example: { price: 500 } },
      responses: { 200: R('Обновлённый Item', 'Item'), 400: R('Некорректный JSON или id', 'Error'), 401: R('Нет или неверный токен', 'Error'), 403: R('Роль reader', 'Error'), 404: R('Предмет не найден', 'Error'), 415: R('Тело не в application/json', 'Error'), 422: R('Ошибка валидации', 'ValidationError') } },
    { tag: 'items', method: 'DELETE', path: '/items/{id}', summary: 'Удалить предмет', security: 'bearerAuth',
      description: 'Нужна роль tester.',
      params: [ID('предмета')],
      responses: { 204: R('Удалён'), 401: R('Нет или неверный токен', 'Error'), 403: R('Роль reader не может изменять данные', 'Error'), 404: R('Предмет не найден', 'Error') } },

    { tag: 'quests', method: 'GET', path: '/quests', summary: 'Квесты королевства',
      description: 'Королевство передаётся заголовком X-Realm. Язык названий — заголовком Accept-Language.',
      params: [
        P('X-Realm', 'header', 'string', { required: true, desc: 'Королевство', enum: M.REALMS }),
        P('status', 'query', 'string', { desc: 'Статус квеста', enum: M.QUEST_STATUSES }),
        P('Accept-Language', 'header', 'string', { desc: 'Язык названий, default: ru', enum: ['ru', 'en'] }),
      ],
      responses: { 200: R('Массив Quest', 'Quest[]'), 400: R('Нет или неверный X-Realm / status', 'Error') } },

    { tag: 'stats', method: 'GET', path: '/stats', summary: 'Сводка по стенду', security: 'apiKeyAuth',
      description: 'Защищено API-ключом в заголовке X-API-Key.',
      responses: { 200: R('Счётчики', 'Stats'), 401: R('Нет или неверный API key', 'Error') } },
  ];

  const TAGS = { auth: 'Авторизация', heroes: 'Герои', guilds: 'Гильдии', items: 'Предметы', quests: 'Квесты', stats: 'Отчёты' };
  const TAG_MODELS = { heroes: ['HeroV2List'] };
  const keyOf = (op) => `${op.method} ${op.path}`;

  // ---------- примеры и отрисовка моделей ----------
  function exampleOf(ref) {
    if (ref.endsWith('[]')) return [exampleOf(ref.slice(0, -2))];
    const o = {};
    Object.entries(SCHEMAS[ref].props).forEach(([k, p]) => { o[k] = p.ref ? exampleOf(p.ref) : p.type === 'array' ? [exampleOf(p.items)] : p.example; });
    return o;
  }

  function refsOf(ref, acc) {
    const name = ref.replace(/\[\]$/, '');
    if (!SCHEMAS[name] || acc.includes(name)) return acc;
    acc.push(name);
    Object.values(SCHEMAS[name].props).forEach((p) => { if (p.ref) refsOf(p.ref, acc); if (p.items) refsOf(p.items, acc); });
    return acc;
  }

  function typeOf(p) {
    if (p.ref) return p.ref;
    if (p.type === 'array') return `array[${p.items}]`;
    return p.type + (p.format ? ` (${p.format})` : '');
  }

  function modelHtml(ref) {
    const arr = ref.endsWith('[]');
    const name = arr ? ref.slice(0, -2) : ref;
    const s = SCHEMAS[name];
    const rows = Object.entries(s.props).map(([k, p]) => {
      const req = s.required.includes(k);
      const notes = [];
      if (p.nullable) notes.push('nullable: true');
      if (p.minLength !== undefined) notes.push(`minLength: ${p.minLength}`);
      if (p.maxLength !== undefined) notes.push(`maxLength: ${p.maxLength}`);
      if (p.minimum !== undefined) notes.push(`minimum: ${p.minimum}`);
      if (p.maximum !== undefined) notes.push(`maximum: ${p.maximum}`);
      if (p.enum) notes.push(`Enum: [ ${p.enum.join(', ')} ]`);
      if (p.desc) notes.push(p.desc);
      return `<tr><td class="${req ? 'req' : ''}">${esc(k)}${req ? '*' : ''}</td><td><span class="sw-type">${esc(typeOf(p))}</span>${notes.map((n) => `<small>${esc(n)}</small>`).join('')}</td></tr>`;
    }).join('');
    return `<div class="sw-model">${arr ? '<span class="sw-brace">array [</span>' : ''}<span class="sw-brace">${esc(name)} {</span>${s.desc ? `<small class="sw-model-desc">${esc(s.desc)}</small>` : ''}<table>${rows}</table><span class="sw-brace">}${arr ? ' ]' : ''}</span></div>`;
  }

  // ---------- симулятор ----------
  function buildSim(el, ctx, level) {
    const setup = (level && level.setup) || {};
    const api = M.create(setup.mock);
    const state = ctx.state;
    state.token = '';
    state.apiKey = '';
    state.server = M.BASE;
    const tags = setup.tags || Object.keys(TAGS);
    const ops = OPS.filter((o) => tags.includes(o.tag));
    const schemes = Object.keys(SCHEMES).filter((s) => ops.some((o) => o.security === s));
    const models = [];
    ops.forEach((o) => {
      if (o.body) refsOf(o.body.schema, models);
      Object.values(o.responses).forEach((r) => { if (r.schema) refsOf(r.schema, models); });
    });
    tags.forEach((t) => (TAG_MODELS[t] || []).forEach((m) => refsOf(m, models)));

    const info = [];
    if (setup.showToken !== false && schemes.includes('bearerAuth')) info.push(`Токен тестового стенда (роль tester): <code>${M.TOKEN}</code>.`);
    if (setup.showToken === false || tags.includes('auth')) info.push(`Учётные записи: <code>${M.LOGIN.login} / ${M.LOGIN.password}</code> (роль tester), <code>${M.READER_LOGIN.login} / ${M.READER_LOGIN.password}</code> (роль reader).`);
    if (schemes.includes('apiKeyAuth')) info.push(`API key для отчётов: <code>${M.API_KEY}</code>.`);

    el.innerHTML = `
      <div class="swagger">
        <div class="sw-top"><span class="sw-logo">{…} Swagger</span><span class="sw-url">${M.BASE}/openapi.json</span></div>
        <div class="sw-info">
          <h3>Хроники API <span class="sw-ver">1.0.0</span> <span class="sw-oas">OAS 3.0</span></h3>
          <p>API гильдии героев. Тестовый стенд: <code>${M.BASE}</code>.</p>
          ${schemes.length ? '<p>Для методов с замком нужна авторизация.</p>' : ''}
          ${info.map((t) => `<p>${t}</p>`).join('')}
        </div>
        <div class="sw-bar">
          <label class="sw-servers">Servers <select class="sw-server-sel">${SERVERS.map((s) => `<option value="${s.url}">${s.url} — ${esc(s.description)}</option>`).join('')}</select></label>
          ${schemes.length ? '<button class="sw-authorize" type="button">Authorize <span class="lock">🔓</span></button>' : ''}
        </div>
        <div class="sw-ops"></div>
        <details class="sw-schemas"><summary>Schemas</summary><div></div></details>
      </div>`;

    el.querySelector('.sw-server-sel').addEventListener('change', (e) => {
      state.server = e.target.value;
      ctx.emit({ type: 'server', url: state.server });
    });

    // --- Authorize ---
    const authBtn = el.querySelector('.sw-authorize');
    const isAuthed = (s) => (s === 'bearerAuth' ? !!state.token : !!state.apiKey);
    function renderAuth() {
      if (authBtn) {
        const any = schemes.some(isAuthed);
        authBtn.querySelector('.lock').textContent = any ? '🔒' : '🔓';
        authBtn.classList.toggle('on', any);
      }
      el.querySelectorAll('.sw-op-lock').forEach((l) => { l.textContent = isAuthed(l.dataset.scheme) ? '🔒' : '🔓'; });
    }
    function schemeForm(s) {
      const ids = s === 'bearerAuth' ? ['sw-token', 'sw-auth-ok', 'sw-logout'] : ['sw-apikey', 'sw-apikey-ok', 'sw-apikey-logout'];
      const val = s === 'bearerAuth' ? state.token : state.apiKey;
      const where = s === 'apiKeyAuth' ? `<p class="sw-auth-meta">Name: X-API-Key · In: header</p>` : '';
      return `<div class="sw-auth-form" data-scheme="${s}">
        <p><b>${s}</b> (${SCHEMES[s].label})</p>${where}
        ${val ? `<p>Authorized. Value: <code>${'*'.repeat(8)}</code></p><button class="btn" id="${ids[2]}" type="button">Logout</button>`
          : `<label>Value <input id="${ids[0]}" type="text" autocomplete="off" placeholder="${SCHEMES[s].hint}"></label><button class="btn attack" id="${ids[1]}" type="button">Authorize</button>`}
      </div>`;
    }
    function setScheme(s, v) {
      if (s === 'bearerAuth') state.token = v; else state.apiKey = v;
      renderAuth();
    }
    if (authBtn) authBtn.addEventListener('click', () => {
      Core.modal(`<h3>Available authorizations</h3><div class="sw-auth-list"></div><button class="btn" id="modal-close" type="button">Close</button>`);
      const list = document.querySelector('.sw-auth-list');
      function draw() {
        list.innerHTML = schemes.map(schemeForm).join('');
        list.querySelectorAll('.sw-auth-form').forEach((f) => {
          const s = f.dataset.scheme;
          const ok = f.querySelector('.attack');
          const inp = f.querySelector('input');
          const submit = () => {
            const v = inp.value.trim().replace(s === 'bearerAuth' ? /^Bearer\s+/i : /^$/, '');
            if (!v) return;
            setScheme(s, v);
            draw();
            setTimeout(() => ctx.emit({ type: 'authorize', scheme: s, token: v }), 0);
          };
          if (ok) ok.addEventListener('click', submit);
          if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
          const lo = f.querySelector('.btn:not(.attack)');
          if (lo) lo.addEventListener('click', () => { setScheme(s, ''); draw(); setTimeout(() => ctx.emit({ type: 'logout', scheme: s }), 0); });
        });
      }
      draw();
    });

    // --- операции ---
    const opsEl = el.querySelector('.sw-ops');
    tags.forEach((tag) => {
      const sec = document.createElement('section');
      sec.className = 'sw-tag';
      sec.innerHTML = `<h4>${tag} <small>${TAGS[tag]}</small></h4>`;
      ops.filter((o) => o.tag === tag).forEach((op) => sec.appendChild(opBlock(op)));
      opsEl.appendChild(sec);
    });

    const schemasEl = el.querySelector('.sw-schemas');
    schemasEl.querySelector('div').innerHTML = models.map((m) => `
      <details class="sw-model-item" data-model="${m}"><summary>${m}</summary>${modelHtml(m)}</details>`).join('');
    schemasEl.addEventListener('toggle', (e) => { if (e.target.open) ctx.emit({ type: 'schemas' }); });
    schemasEl.querySelectorAll('.sw-model-item').forEach((d) => d.addEventListener('toggle', () => { if (d.open) ctx.emit({ type: 'model', name: d.dataset.model }); }));

    function paramInput(p) {
      const attrs = `class="sw-param" data-name="${p.name}" data-in="${p.in}" disabled aria-label="${p.name}"`;
      if (p.enum) return `<select ${attrs}><option value="">--</option>${p.enum.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select>`;
      return `<input ${attrs} placeholder="${p.name}">`;
    }

    function responsesHtml(op) {
      return Object.entries(op.responses).map(([code, r]) => `
        <tr><td class="sw-code">${code}</td><td>
          <p class="sw-rdesc">${esc(r.d)}</p>
          ${r.headers ? `<small>Headers: ${Object.entries(r.headers).map(([h, t]) => `<code>${esc(h)}</code> ${esc(t)}`).join('; ')}</small>` : ''}
          ${r.schema ? `<small>Media type: application/json</small>
            <div class="sw-tabs" data-code="${code}"><button type="button" class="on" data-tab="example">Example Value</button><button type="button" data-tab="schema">Schema</button></div>
            <pre class="sw-ex">${esc(JSON.stringify(exampleOf(r.schema), null, 2))}</pre>
            <div class="sw-sch" hidden>${modelHtml(r.schema)}</div>` : ''}
        </td></tr>`).join('');
    }

    function opBlock(op) {
      const key = keyOf(op);
      const d = document.createElement('div');
      d.className = `sw-op m-${op.method.toLowerCase()}`;
      d.dataset.op = key;
      d.innerHTML = `
        <button class="sw-op-head" type="button" aria-expanded="false">
          <span class="sw-method">${op.method}</span><span class="sw-path">${esc(op.path)}</span>
          <span class="sw-sum">${esc(op.summary)}</span>${op.security ? `<span class="sw-op-lock" data-scheme="${op.security}" title="${op.security}">🔓</span>` : ''}
        </button>
        <div class="sw-op-body" hidden></div>`;
      const head = d.querySelector('.sw-op-head');
      const body = d.querySelector('.sw-op-body');
      let tryOut = false;
      let built = false;

      function build() {
        built = true;
        const b = op.body;
        body.innerHTML = `
          ${op.description ? `<p class="sw-desc">${esc(op.description)}</p>` : ''}
          <div class="sw-row"><b>Parameters</b><button class="btn sw-try" type="button">Try it out</button></div>
          ${op.params ? `<table class="sw-params"><tr><th>Name</th><th>Description</th></tr>${op.params.map((p) => `
            <tr><td><span class="${p.required ? 'req' : ''}">${p.name}${p.required ? ' *' : ''}</span><small>${p.type}</small><small><i>(${p.in})</i></small></td>
            <td>${esc(p.desc || '')}${p.enum ? `<br><small>Available values: ${p.enum.map(esc).join(', ')}</small>` : ''}
            ${paramInput(p)}</td></tr>`).join('')}</table>` : '<p class="sw-none">No parameters</p>'}
          ${b ? `<div class="sw-row"><b>Request body${b.required ? ' <span class="req">required</span>' : ''}</b>
              <select class="sw-media" aria-label="Media type">${(b.media || ['application/json']).map((m) => `<option>${m}</option>`).join('')}</select></div>
            <small class="sw-body-note">Схема: ${b.schema}</small>
            <textarea class="sw-body" spellcheck="false" disabled aria-label="Request body">${esc(JSON.stringify(b.example, null, 2))}</textarea>` : ''}
          <div class="sw-exec" hidden><button class="btn attack sw-execute" type="button">Execute</button><button class="btn sw-clear" type="button">Clear</button></div>
          <div class="sw-result"></div>
          <div class="sw-row"><b>Responses</b></div>
          <table class="sw-resp"><tr><th>Code</th><th>Description</th></tr>${responsesHtml(op)}</table>`;
        body.querySelector('.sw-try').addEventListener('click', (e) => {
          tryOut = !tryOut;
          e.target.textContent = tryOut ? 'Cancel' : 'Try it out';
          e.target.classList.toggle('cancel', tryOut);
          body.querySelectorAll('.sw-param, .sw-body').forEach((i) => { i.disabled = !tryOut; });
          body.querySelector('.sw-exec').hidden = !tryOut;
          if (tryOut) ctx.emit({ type: 'tryout', op: key });
        });
        body.querySelector('.sw-execute').addEventListener('click', execute);
        body.querySelector('.sw-clear').addEventListener('click', () => { body.querySelector('.sw-result').innerHTML = ''; });
        body.querySelectorAll('.sw-tabs').forEach((t) => t.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-tab]');
          if (!btn) return;
          const cell = t.parentElement;
          t.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === btn));
          cell.querySelector('.sw-ex').hidden = btn.dataset.tab !== 'example';
          cell.querySelector('.sw-sch').hidden = btn.dataset.tab !== 'schema';
          ctx.emit({ type: 'resp-tab', op: key, code: t.dataset.code, tab: btn.dataset.tab });
        }));
      }

      function execute() {
        let path = op.path;
        const query = new URLSearchParams();
        const qobj = {};
        const hparams = {};
        const missing = [];
        body.querySelectorAll('.sw-param').forEach((i) => {
          const v = i.value.trim();
          const p = op.params.find((x) => x.name === i.dataset.name);
          i.classList.remove('invalid');
          if (!v) {
            if (p.required) { missing.push(p.name); i.classList.add('invalid'); }
            return;
          }
          if (p.in === 'path') path = path.replace(`{${p.name}}`, encodeURIComponent(v));
          else if (p.in === 'query') { query.set(p.name, v); qobj[p.name] = v; } else hparams[p.name] = v;
        });
        const res = body.querySelector('.sw-result');
        if (missing.length) {
          res.innerHTML = `<p class="sw-error">Required field is not provided: ${missing.map(esc).join(', ')}</p>`;
          ctx.emit({ type: 'validation', op: key, missing });
          return;
        }
        const server = state.server;
        const url = server + path + (query.toString() ? '?' + query.toString() : '');
        const headers = { accept: 'application/json' };
        Object.assign(headers, hparams);
        let raw = null;
        let contentType = null;
        if (op.body) {
          contentType = body.querySelector('.sw-media').value;
          headers['Content-Type'] = contentType;
          raw = body.querySelector('.sw-body').value;
        }
        if (op.security === 'bearerAuth' && state.token) headers.Authorization = `Bearer ${state.token}`;
        if (op.security === 'apiKeyAuth' && state.apiKey) headers['X-API-Key'] = state.apiKey;
        const r = api.handle({ method: op.method, url, headers, body: raw });
        const documented = String(r.status) in op.responses;
        const curl = [`curl -X '${op.method}' \\`, `  '${url}' \\`].concat(Object.entries(headers).map(([k, v]) => `  -H '${k}: ${v}' \\`))
          .concat(raw ? [`  -d '${raw.replace(/\s*\n\s*/g, ' ')}'`] : []).join('\n').replace(/ \\$/, '');
        res.innerHTML = `
          <div class="sw-row"><p class="sw-label">Curl</p><button class="btn sw-copy" type="button" title="Copy to clipboard">Copy</button></div><pre class="sw-curl">${esc(curl)}</pre>
          <p class="sw-label">Request URL</p><pre>${esc(url)}</pre>
          <p class="sw-label">Server response</p>
          <table class="sw-server"><tr><th>Code</th><th>Details</th></tr><tr><td class="code s${String(r.status)[0]}">${r.status}${documented ? '' : '<small class="sw-undoc">Undocumented</small>'}</td><td>
            ${r.status >= 400 ? `<small class="sw-errline">Error: ${esc(r.statusText)}</small>` : ''}
            ${r.body ? `<small>Response body</small><pre>${esc(r.body)}</pre>` : '<small>Тело ответа пустое</small>'}
            <small>Response headers</small><pre>${esc(Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join('\n'))}</pre></td></tr></table>`;
        res.querySelector('.sw-copy').addEventListener('click', (e) => {
          try { if (navigator.clipboard) navigator.clipboard.writeText(curl).catch(() => {}); } catch (err) { /* буфер недоступен */ }
          e.target.textContent = 'Copied';
          ctx.emit({ type: 'copy-curl', op: key, url, server, curl });
        });
        let parsed = null;
        if (raw !== null) { try { parsed = JSON.parse(raw); } catch (e) { parsed = undefined; } }
        ctx.emit({ type: 'request', key, method: op.method, op: op.path, server, url, path, query: qobj, headers, raw, body: parsed, contentType,
          status: r.status, response: r.json, respHeaders: r.headers, documented });
      }

      head.addEventListener('click', () => {
        const open = body.hidden;
        if (open && !built) build();
        body.hidden = !open;
        head.setAttribute('aria-expanded', String(open));
        if (open) ctx.emit({ type: 'expand', op: key });
      });
      return d;
    }

    renderAuth();
    return {};
  }

  // ---------- проверки шагов ----------
  const reqs = (ctx, f) => ctx.log.filter((e) => e.type === 'request' && f(e));
  const has = (ctx, f) => reqs(ctx, f).length > 0;
  const happened = (ctx, type, f) => ctx.log.some((e) => e.type === type && (!f || f(e)));
  const isObj = (b) => typeof b === 'object' && b !== null && !Array.isArray(b);
  const bodyHas = (e, f) => isObj(e.body) && f(e.body);
  const REQ_ITEM = ['name', 'rarity', 'price'];
  const num = (v) => (v === undefined || v === '' ? null : Number(v));
  const lc = (v) => String(v).trim().toLowerCase();
  const GUILD_NAMES = ['Орден Пепла', 'Серебряный Клинок', 'Лесные Тени', 'Дом Совы'];

  const LEVELS = [
    {
      id: 'sw-1',
      title: 'Первое знакомство с документацией',
      giver: { name: 'Хранитель свитков API', sprite: '📜' },
      gold: 80,
      setup: { tags: ['auth', 'heroes'] },
      outro: 'Ты нашёл настоящий баг по документации. Именно так Swagger и используют на работе.',
      steps: [
        { id: 'get-ok', text: 'Найди эндпоинт, который возвращает героя по id, нажми <b>Try it out</b> и запроси героя с id <b>5</b>.',
          check: (c) => has(c, (e) => e.method === 'GET' && e.op === '/heroes/{id}' && e.path === '/heroes/5' && e.status === 200),
          success: 'Сервер вернул 200 и героя Даэль. Позитивная проверка пройдена.' },
        { id: 'get-404', text: 'Негативная проверка: запроси героя, которого <b>нет</b> в базе, и получи <code>404</code>.',
          check: (c) => has(c, (e) => e.op === '/heroes/{id}' && e.status === 404),
          success: 'Сервер честно сказал 404 Not Found. Негативные проверки так же важны, как позитивные.' },
        { id: 'auth', text: 'Методы с замком требуют токен. Нажми <b>Authorize</b> и введи тестовый токен из описания API.',
          check: (c) => c.state.token === M.TOKEN,
          success: 'Замки закрылись: теперь Swagger отправляет заголовок Authorization: Bearer … со всеми защищёнными запросами.' },
        { id: 'post-201', text: 'Создай героя через <code>POST /heroes</code> с корректным телом и получи <code>201</code>.',
          check: (c) => has(c, (e) => e.method === 'POST' && e.op === '/heroes' && e.status === 201 && e.body && e.body.level >= 1),
          success: '201 Created: сервер создал героя и вернул его с новым id.' },
        { id: 'post-400', text: 'Проверь обязательное поле: отправь <code>POST /heroes</code> <b>без поля name</b> и получи ошибку валидации.',
          check: (c) => has(c, (e) => e.method === 'POST' && e.op === '/heroes' && e.status === 400 && e.body && e.body.name === undefined),
          success: '400 Bad Request с указанием поля name. Сервер проверяет обязательные поля правильно.' },
        { id: 'bug', text: 'Открой раздел <b>Schemas</b>: какие границы у поля <code>level</code> в HeroCreate? Проверь нижнюю границу минус один: отправь героя с <code>level = 0</code> и посмотри, что ответит сервер.',
          check: (c) => has(c, (e) => e.method === 'POST' && e.op === '/heroes' && e.body && e.body.level === 0 && e.status === 201),
          success: 'Баг найден! По схеме level ≥ 1, а сервер принял 0 и вернул 201. Ожидалось 400. Это классическая ошибка на границе диапазона.' },
      ],
      hints: [
        'Каждый эндпоинт раскрывается по клику. Внутри: параметры, тело запроса и ответы. Чтобы отправить запрос, нажми <b>Try it out</b>, заполни поля и нажми <b>Execute</b>.',
        'Герой по id — это <code>GET /heroes/{id}</code>, несуществующий id — например 999. Токен написан в шапке документации, его вставляют в окно <b>Authorize</b> без слова Bearer. Для <code>POST /heroes</code> пример тела уже заполнен — просто убери из него строку с <code>name</code> для негативной проверки.',
        'Порядок: <code>GET /heroes/{id}</code> с id 5 → тот же метод с id 999 → Authorize с токеном <code>tok_7f3a9c21</code> → <code>POST /heroes</code> с примером как есть → тело <code>{"class": "Воин", "level": 1}</code> → в Schemas раскрой HeroCreate и отправь <code>{"name": "Ноль", "class": "Воин", "level": 0}</code>.',
      ],
    },
    {
      id: 'sw-2',
      title: 'Чтение документации: Responses и модели',
      giver: { name: 'Летописец Орм', sprite: '📖' },
      gold: 90,
      setup: { tags: ['heroes'] },
      outro: 'Прежде чем заводить баг, сверь ответ со схемой: nullable-поле с null — это норма.',
      steps: [
        { id: 'expand', text: 'Раскрой операцию <code>GET /heroes/{id}</code> и найди внизу блок <b>Responses</b>.',
          check: (c) => happened(c, 'expand', (e) => e.op === 'GET /heroes/{id}') },
        { id: 'schema-tab', text: 'У ответа <code>200</code> переключись с <b>Example Value</b> на <b>Schema</b>, чтобы увидеть типы полей.',
          check: (c) => happened(c, 'resp-tab', (e) => e.op === 'GET /heroes/{id}' && e.code === '200' && e.tab === 'schema'),
          success: 'Example Value — пример ответа, Schema — контракт: типы, ограничения, nullable.' },
        { id: 'model', text: 'Внизу страницы открой <b>Schemas</b> и раскрой модель <code>Hero</code>.',
          check: (c) => happened(c, 'model', (e) => e.name === 'Hero') },
        { id: 'hero10', text: 'Запроси героя с id <b>10</b> и посмотри на поле <code>guild</code> в ответе.',
          check: (c) => has(c, (e) => e.key === 'GET /heroes/{id}' && e.path === '/heroes/10' && e.status === 200) },
        { id: 'verdict', text: 'У Кайры <code>guild: null</code>. Это баг?',
          answer: { kind: 'choice', options: ['Да: guild по схеме — строка, null недопустим', 'Нет: по схеме guild — string, nullable: true, значит null допустим', 'Нет: просто гильдия не найдена, сервер должен был вернуть 404'],
            accept: (v) => v === 1, wrong: 'Посмотри на ограничения поля guild в модели Hero.' } },
      ],
      hints: [
        'Каждая операция раскрывается кликом по заголовку. Модели собраны в разделе Schemas в самом низу.',
        'В блоке Responses у кода 200 есть две вкладки: Example Value и Schema. В модели Hero у поля guild написано <code>nullable: true</code>.',
        'Кликни по <code>GET /heroes/{id}</code> → в Responses у 200 нажми <b>Schema</b> → внизу раскрой Schemas → Hero → вернись к операции, Try it out, id = 10, Execute → ответ «Нет: … nullable …».',
      ],
    },
    {
      id: 'sw-3',
      title: 'Path-параметры: 400 и 404',
      giver: { name: 'Привратник Тиль', sprite: '🚪' },
      gold: 95,
      setup: { tags: ['heroes', 'guilds'] },
      outro: '400 — запрос сформирован неверно (id не число), 404 — запрос верный, но такого ресурса нет.',
      steps: [
        { id: 'empty', text: 'В <code>GET /heroes/{id}</code> нажми <b>Try it out</b> и <b>Execute</b> с пустым id. Посмотри, что сделает Swagger.',
          check: (c) => happened(c, 'validation', (e) => e.op === 'GET /heroes/{id}' && e.missing.includes('id')),
          success: 'Swagger сам не пустил запрос: id отмечен как required (звёздочка) — без него URL не собрать.' },
        { id: 'ok', text: 'Запроси героя с id <b>2</b> и получи <code>200</code>.',
          check: (c) => has(c, (e) => e.key === 'GET /heroes/{id}' && e.path === '/heroes/2' && e.status === 200) },
        { id: 'nf', text: 'Передай целый id, которого нет в базе, и получи <code>404</code>.',
          check: (c) => has(c, (e) => e.key === 'GET /heroes/{id}' && e.status === 404) },
        { id: 'bad', text: 'Передай id, который не является целым числом (например <code>abc</code>), и получи <code>400</code>.',
          check: (c) => has(c, (e) => e.key === 'GET /heroes/{id}' && e.status === 400),
          success: 'Сервер различает «неверный запрос» (400) и «нет такого ресурса» (404) — ровно как в Responses.' },
        { id: 'nested', text: 'Вложенный путь: через <code>GET /guilds/{id}/heroes</code> получи список героев гильдии с id <b>2</b>.',
          check: (c) => has(c, (e) => e.key === 'GET /guilds/{id}/heroes' && e.path === '/guilds/2/heroes' && e.status === 200) },
      ],
      hints: [
        'Path-параметр подставляется прямо в URL вместо <code>{id}</code>. Обязательные параметры помечены звёздочкой.',
        'Пустое поле id → Execute: Swagger покажет «Required field is not provided». Несуществующий id — 999, не число — abc.',
        '<code>GET /heroes/{id}</code> → Try it out → Execute с пустым полем → id 2 → id 999 → id abc. Затем <code>GET /guilds/{id}/heroes</code> → Try it out → id 2 → Execute.',
      ],
    },
    {
      id: 'sw-4',
      title: 'Query-параметры и enum',
      giver: { name: 'Картограф Мира', sprite: '🗺️' },
      gold: 105,
      setup: { tags: ['heroes'] },
      outro: 'Enum в документации — это готовый список классов эквивалентности для проверок фильтра.',
      steps: [
        { id: 'enum', text: 'В <code>GET /heroes</code> выбери в выпадающем списке <code>class</code> значение <b>Лучник</b> и выполни запрос.',
          check: (c) => has(c, (e) => e.key === 'GET /heroes' && e.query.class === 'Лучник' && e.status === 200 && Array.isArray(e.response) && e.response.length > 0 && e.response.every((h) => h.class === 'Лучник')) },
        { id: 'limit', text: 'Сбрось фильтр класса и ограничь выдачу: <code>limit = 3</code>.',
          check: (c) => has(c, (e) => e.key === 'GET /heroes' && !e.query.class && e.query.limit === '3' && e.status === 200 && e.response.length === 3) },
        { id: 'combo', text: 'Комбинация параметров: только маги и не больше двух (<code>class = Маг</code>, <code>limit = 2</code>).',
          check: (c) => has(c, (e) => e.key === 'GET /heroes' && e.query.class === 'Маг' && e.query.limit === '2' && e.status === 200 && e.response.length === 2) },
        { id: 'bad-limit', text: 'Негативная проверка: передай в <code>limit</code> не число и получи <code>400</code>.',
          check: (c) => has(c, (e) => e.key === 'GET /heroes' && e.status === 400) },
        { id: 'count', text: 'Сколько на стенде героев класса <b>Воин</b>?',
          answer: { kind: 'text', placeholder: 'Число', accept: (v) => v.trim() === '3', wrong: 'Отфильтруй список по классу Воин и посчитай элементы ответа.' } },
      ],
      hints: [
        'Query-параметры попадают в URL после <code>?</code>. Если у параметра есть enum, Swagger показывает выпадающий список.',
        'Сбросить фильтр — выбрать <code>--</code> в списке class. Не число в limit — например <code>abc</code>. Смотри Request URL: там видно, что ушло на сервер.',
        '<code>GET /heroes</code> → Try it out → class = Лучник → Execute → class = -- , limit = 3 → class = Маг, limit = 2 → limit = abc → class = Воин, limit пусто — в ответе 3 героя.',
      ],
    },
    {
      id: 'sw-5',
      title: 'Header-параметры',
      giver: { name: 'Гонец Лиран', sprite: '📯' },
      gold: 115,
      setup: { tags: ['quests'] },
      outro: 'Параметры бывают path, query, header и cookie — смотри на пометку (in) под именем.',
      steps: [
        { id: 'required', text: 'Раскрой <code>GET /quests</code>, нажми <b>Try it out</b> и <b>Execute</b>, не выбирая королевство.',
          check: (c) => happened(c, 'validation', (e) => e.op === 'GET /quests' && e.missing.includes('X-Realm')),
          success: 'X-Realm — обязательный параметр (header), Swagger не отправил запрос без него.' },
        { id: 'realm', text: 'Выбери <code>X-Realm = north</code> и получи квесты северного королевства.',
          check: (c) => has(c, (e) => e.key === 'GET /quests' && e.headers['X-Realm'] === 'north' && e.status === 200 && e.response.length > 0) },
        { id: 'status', text: 'Теперь только <b>открытые</b> квесты юга: <code>X-Realm = south</code> и <code>status = open</code>.',
          check: (c) => has(c, (e) => e.key === 'GET /quests' && e.headers['X-Realm'] === 'south' && e.query.status === 'open' && e.status === 200 && e.response.length > 0 && e.response.every((q) => q.status === 'open')) },
        { id: 'lang', text: 'Получи названия квестов на английском — через заголовок <code>Accept-Language</code>.',
          check: (c) => has(c, (e) => e.key === 'GET /quests' && e.headers['Accept-Language'] === 'en' && e.status === 200),
          success: 'В ответе пришёл заголовок content-language: en, а названия — на английском.' },
        { id: 'curl', text: 'Посмотри в блок <b>Curl</b>: как в нём передан X-Realm?',
          answer: { kind: 'choice', options: ['В URL после ?', 'Флагом -H, как заголовок запроса', 'В теле запроса -d'], accept: (v) => v === 1 } },
      ],
      hints: [
        'Header-параметры не видны в URL — Swagger кладёт их в заголовки запроса. Под именем параметра написано <i>(header)</i>.',
        'X-Realm и Accept-Language — выпадающие списки в Parameters. status — query-параметр.',
        'Try it out → Execute с пустым X-Realm → X-Realm = north → X-Realm = south + status = open → Accept-Language = en → в Curl заголовок виден как <code>-H \'X-Realm: …\'</code>.',
      ],
    },
    {
      id: 'sw-6',
      title: 'Authorize: Bearer и API key',
      giver: { name: 'Стражница Вейла', sprite: '🛡️' },
      gold: 120,
      setup: { tags: ['auth', 'stats'], showToken: false },
      outro: 'У каждой операции своя схема безопасности: Bearer уходит в Authorization, API key — в своём заголовке.',
      steps: [
        { id: 'me-401', text: 'Без авторизации вызови <code>GET /me</code> и получи <code>401</code>.',
          check: (c) => has(c, (e) => e.key === 'GET /me' && e.status === 401) },
        { id: 'login', text: 'Получи токен: <code>POST /auth/login</code> с учётной записью роли tester.',
          check: (c) => has(c, (e) => e.key === 'POST /auth/login' && e.status === 200 && e.response.token === M.TOKEN) },
        { id: 'bearer', text: 'Вставь токен в <b>Authorize → bearerAuth</b> и снова вызови <code>GET /me</code> — теперь <code>200</code>.',
          check: (c) => has(c, (e) => e.key === 'GET /me' && e.status === 200) },
        { id: 'stats-401', text: '<code>GET /stats</code> защищён другой схемой. Вызови его без API-ключа.',
          check: (c) => has(c, (e) => e.key === 'GET /stats' && e.status === 401 && !e.headers['X-API-Key']),
          success: 'Bearer-токен тут не помог: у операции схема apiKeyAuth.' },
        { id: 'apikey', text: 'Авторизуйся в схеме <b>apiKeyAuth</b> ключом из описания и получи <code>200</code> от <code>GET /stats</code>.',
          check: (c) => has(c, (e) => e.key === 'GET /stats' && e.status === 200) },
        { id: 'header', text: 'В блоке Curl найди: в каком заголовке Swagger отправил API-ключ?',
          answer: { kind: 'text', placeholder: 'Имя заголовка', accept: (v) => lc(v) === 'x-api-key' } },
      ],
      hints: [
        'Токен выдаёт <code>POST /auth/login</code>. В окне Authorize две схемы: bearerAuth и apiKeyAuth — заполняются отдельно.',
        'Логин и пароль tester — в описании API (mage / chronicles). Токен из ответа (<code>"token"</code>) вставляй без слова Bearer. Ключ для /stats тоже в описании.',
        '<code>GET /me</code> → 401 → <code>POST /auth/login</code> с примером тела → скопируй <code>tok_7f3a9c21</code> → Authorize → bearerAuth → <code>GET /me</code> → <code>GET /stats</code> (401) → Authorize → apiKeyAuth = <code>key_guild_9d4e</code> → <code>GET /stats</code> → ответ: X-API-Key.',
      ],
    },
    {
      id: 'sw-7',
      title: '401 и 403: роли',
      giver: { name: 'Капитан Дорн', sprite: '⚔️' },
      gold: 130,
      setup: { tags: ['auth', 'guilds'], showToken: false },
      outro: '401 — «кто ты?», 403 — «я знаю, кто ты, но тебе нельзя».',
      steps: [
        { id: 'login-reader', text: 'Получи токен для роли <b>reader</b> через <code>POST /auth/login</code>.',
          check: (c) => has(c, (e) => e.key === 'POST /auth/login' && e.status === 200 && e.response.token === M.READER_TOKEN) },
        { id: 'me-reader', text: 'Авторизуйся этим токеном и убедись через <code>GET /me</code>, что роль — reader.',
          check: (c) => has(c, (e) => e.key === 'GET /me' && e.status === 200 && e.response.role === 'reader') },
        { id: 'del-403', text: 'Под reader попробуй распустить гильдию: <code>DELETE /guilds/{id}</code>.',
          check: (c) => has(c, (e) => e.key === 'DELETE /guilds/{id}' && e.status === 403),
          success: '403 Forbidden: токен валиден, но прав на изменение нет.' },
        { id: 'del-401', text: 'Сделай <b>Logout</b> в Authorize и повтори <code>DELETE /guilds/{id}</code> без токена.',
          check: (c) => has(c, (e) => e.key === 'DELETE /guilds/{id}' && e.status === 401 && !e.headers.Authorization) },
        { id: 'del-204', text: 'Войди как <b>tester</b> и удали гильдию — <code>204</code>.',
          check: (c) => has(c, (e) => e.key === 'DELETE /guilds/{id}' && e.status === 204) },
        { id: 'verdict', text: 'Чем 401 отличается от 403?',
          answer: { kind: 'choice', options: ['Ничем, это синонимы', '401 — нет или неверная аутентификация; 403 — пользователь опознан, но у его роли нет прав', '401 — нет прав у роли; 403 — нет токена'], accept: (v) => v === 1 } },
      ],
      hints: [
        'Учётные записи обеих ролей — в описании API. Токен из ответа login вставляется в Authorize → bearerAuth.',
        'reader: <code>scribe / quill</code>, tester: <code>mage / chronicles</code>. Чтобы сменить токен, нажми Logout и авторизуйся заново.',
        '<code>POST /auth/login</code> с <code>{"login":"scribe","password":"quill"}</code> → Authorize токеном <code>tok_reader_51b2</code> → <code>GET /me</code> → <code>DELETE /guilds/{id}</code> id 3 (403) → Logout → снова DELETE (401) → login mage → Authorize <code>tok_7f3a9c21</code> → DELETE (204).',
      ],
    },
    {
      id: 'sw-8',
      title: 'Schemas и обязательные поля',
      giver: { name: 'Оружейник Брам', sprite: '⚒️' },
      gold: 140,
      setup: { tags: ['items'] },
      outro: 'Звёздочка в модели — обязательное поле. Минимальный валидный запрос — лучшая первая проверка.',
      steps: [
        { id: 'model', text: 'В разделе <b>Schemas</b> раскрой модель <code>ItemCreate</code> и найди обязательные поля (со звёздочкой).',
          check: (c) => happened(c, 'model', (e) => e.name === 'ItemCreate') },
        { id: 'minimal', text: 'Авторизуйся и создай предмет через <code>POST /items</code>, передав <b>только обязательные</b> поля.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 201 && bodyHas(e, (b) => Object.keys(b).sort().join() === REQ_ITEM.slice().sort().join())),
          success: '201: необязательное description сервер заполнил null.' },
        { id: 'missing', text: 'Отправь <code>POST /items</code> без поля <code>price</code> и посмотри на ошибку.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 422 && bodyHas(e, (b) => b.price === undefined)) },
        { id: 'empty', text: 'Отправь пустой объект <code>{}</code> — сервер должен перечислить все обязательные поля.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 422 && bodyHas(e, (b) => Object.keys(b).length === 0) && e.response.errors.length === 3) },
        { id: 'optional', text: 'Какое поле <code>ItemCreate</code> необязательное?',
          answer: { kind: 'choice', options: ['name', 'rarity', 'price', 'description'], accept: (v) => v === 3 } },
      ],
      hints: [
        'Schemas — внизу страницы. Поле со звёздочкой обязательно. Токен — в описании API.',
        'В примере тела <code>POST /items</code> есть description — его и нужно убрать для минимального запроса.',
        'Schemas → ItemCreate → Authorize <code>tok_7f3a9c21</code> → <code>{"name":"Плащ ветра","rarity":"rare","price":350}</code> → <code>{"name":"Плащ","rarity":"rare"}</code> → <code>{}</code> → ответ description.',
      ],
    },
    {
      id: 'sw-9',
      title: 'Граничные значения',
      giver: { name: 'Меняла Сарра', sprite: '⚖️' },
      gold: 145,
      setup: { tags: ['items'], mock: { bugs: { priceNoMax: true } } },
      outro: 'Для диапазона [1; 10000] проверяй 0, 1, 10000 и 10001 — на границах живёт больше всего багов.',
      steps: [
        { id: 'min', text: 'По схеме <code>price</code>: minimum 1, maximum 10000. Авторизуйся и создай предмет с ценой на нижней границе.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 201 && bodyHas(e, (b) => b.price === 1)) },
        { id: 'below', text: 'Теперь на единицу ниже нижней границы.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 422 && bodyHas(e, (b) => b.price === 0)) },
        { id: 'max', text: 'Цена ровно на верхней границе.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 201 && bodyHas(e, (b) => b.price === 10000)) },
        { id: 'above', text: 'И на единицу выше верхней границы. Сравни ответ с документацией.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && bodyHas(e, (b) => b.price === 10001) && e.status === 201),
          success: 'Баг: сервер принял 10001, хотя maximum: 10000.' },
        { id: 'expected', text: 'Какой код ответа должен был вернуть сервер на <code>price = 10001</code>?',
          answer: { kind: 'text', placeholder: 'Код ответа', accept: (v) => v.trim() === '422', wrong: 'Посмотри Responses у POST /items: какой код означает ошибку валидации по схеме?' } },
      ],
      hints: [
        'Граничные значения: сама граница и соседнее значение за ней. Для [1; 10000] это 0, 1, 10000, 10001.',
        'Меняй в теле только <code>price</code>, остальные поля оставь валидными. Ошибка валидации у /items — 422.',
        'Authorize → <code>POST /items</code> с price 1 (201) → 0 (422) → 10000 (201) → 10001 (сервер ответит 201 — баг) → ответ 422.',
      ],
    },
    {
      id: 'sw-10',
      title: 'Классы эквивалентности',
      giver: { name: 'Алхимик Ферн', sprite: '⚗️' },
      gold: 155,
      setup: { tags: ['items'] },
      outro: 'Один представитель от каждого класса: валидное значение, чужое значение, другой регистр, пустая строка.',
      steps: [
        { id: 'valid', text: 'Авторизуйся и создай предмет с любым допустимым значением <code>rarity</code> из enum.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 201 && bodyHas(e, (b) => M.RARITIES.includes(b.rarity))) },
        { id: 'alien', text: 'Класс «значение не из списка»: передай rarity, которого нет в enum (например <code>mythic</code>).',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 422 && bodyHas(e, (b) => typeof b.rarity === 'string' && b.rarity !== '' && !M.RARITIES.includes(b.rarity.toLowerCase()))) },
        { id: 'case', text: 'Класс «другой регистр»: значение из enum, но с заглавными буквами.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 422 && bodyHas(e, (b) => typeof b.rarity === 'string' && !M.RARITIES.includes(b.rarity) && M.RARITIES.includes(b.rarity.toLowerCase()))) },
        { id: 'empty-name', text: 'Класс «пустая строка» для текстового поля: <code>name = ""</code>.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 422 && bodyHas(e, (b) => b.name === '') && e.response.errors.some((x) => x.field === 'name')) },
      ],
      hints: [
        'Класс эквивалентности — группа значений, которые сервер должен обработать одинаково. Из каждого класса достаточно одного представителя.',
        'Допустимые rarity — в модели ItemCreate (Enum). Чужое значение — <code>mythic</code>, другой регистр — <code>Epic</code>.',
        'Authorize → <code>POST /items</code>: rarity "epic" (201) → "mythic" (422) → "Epic" (422) → name "" с валидным rarity (422).',
      ],
    },
    {
      id: 'sw-11',
      title: 'Типы данных',
      giver: { name: 'Писарь Квинт', sprite: '✒️' },
      gold: 160,
      setup: { tags: ['items'], mock: { bugs: { stringPrice: true } } },
      outro: '"100" и 100 — разные типы. Сервер, принявший строку вместо числа, сломает клиентов, которые ждут integer.',
      steps: [
        { id: 'string', text: 'Авторизуйся и передай <code>price</code> строкой: <code>"100"</code> (в кавычках). Сравни ответ со схемой Item.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && bodyHas(e, (b) => typeof b.price === 'string') && e.status === 201),
          success: 'Сервер принял строку и вернул price строкой — по схеме это integer.' },
        { id: 'float', text: 'Дробное число вместо integer: например <code>12.5</code>.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 422 && bodyHas(e, (b) => typeof b.price === 'number' && !Number.isInteger(b.price))) },
        { id: 'null', text: 'Передай <code>price: null</code> — поле обязательно и не nullable.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 422 && bodyHas(e, (b) => b.price === null)) },
        { id: 'name-num', text: 'Число вместо строки: <code>name: 123</code>.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 422 && bodyHas(e, (b) => typeof b.name === 'number')) },
        { id: 'verdict', text: 'Что не так в первом запросе?',
          answer: { kind: 'choice', options: ['Всё верно: сервер вправе привести строку к числу', 'Баг: строка "100" принята (201) и сохранена строкой; по схеме price — integer, ожидался 422', 'Баг Swagger UI: он должен был сам переделать строку в число'], accept: (v) => v === 1 } },
      ],
      hints: [
        'В JSON <code>"100"</code> — строка, <code>100</code> — число. Swagger UI не проверяет тело запроса, его проверяет только сервер.',
        'Меняй по одному полю: price "100", 12.5, null; name 123. Ожидание по схеме — 422 на всё.',
        'Authorize → <code>POST /items</code>: <code>"price": "100"</code> (201 — баг) → <code>"price": 12.5</code> → <code>"price": null</code> → <code>"name": 123</code> → второй вариант ответа.',
      ],
    },
    {
      id: 'sw-12',
      title: 'PUT и PATCH',
      giver: { name: 'Кузнец Ярл', sprite: '🔨' },
      gold: 170,
      setup: { tags: ['items'] },
      outro: 'PUT заменяет ресурс целиком, PATCH меняет только переданные поля.',
      steps: [
        { id: 'get', text: 'Посмотри текущее состояние предмета через <code>GET /items/{id}</code> (например id 3).',
          check: (c) => has(c, (e) => e.key === 'GET /items/{id}' && e.status === 200) },
        { id: 'patch', text: 'Авторизуйся и измени у предмета только цену через <code>PATCH /items/{id}</code>.',
          check: (c) => has(c, (e) => e.key === 'PATCH /items/{id}' && e.status === 200 && bodyHas(e, (b) => b.price !== undefined && b.name === undefined && b.rarity === undefined) && e.response.name),
          success: 'name и rarity остались прежними — PATCH частичный.' },
        { id: 'put-partial', text: 'Отправь такое же частичное тело через <code>PUT /items/{id}</code>.',
          check: (c) => has(c, (e) => e.key === 'PUT /items/{id}' && e.status === 422 && bodyHas(e, (b) => REQ_ITEM.some((f) => b[f] === undefined))),
          success: '422: PUT требует полный объект — все обязательные поля.' },
        { id: 'put-full', text: 'Отправь через <code>PUT</code> полный объект и получи <code>200</code>.',
          check: (c) => has(c, (e) => e.key === 'PUT /items/{id}' && e.status === 200 && bodyHas(e, (b) => REQ_ITEM.every((f) => b[f] !== undefined))) },
        { id: 'verdict', text: 'Ты отправил PUT без <code>description</code>. Что станет с этим полем?',
          answer: { kind: 'choice', options: ['Останется прежним', 'Станет null: PUT заменяет ресурс целиком', 'Сервер вернёт 422'], accept: (v) => v === 1, wrong: 'Прочитай описание операции PUT /items/{id}.' } },
      ],
      hints: [
        'Сравни описания операций PUT и PATCH: одна заменяет ресурс целиком, другая меняет поля частично.',
        'Пример тела PATCH уже частичный: <code>{"price": 500}</code>. Его же отправь в PUT. Полный PUT — пример тела PUT как есть.',
        '<code>GET /items/{id}</code> id 3 → Authorize → <code>PATCH /items/{id}</code> id 3 с <code>{"price": 500}</code> → <code>PUT /items/{id}</code> id 3 с <code>{"price": 500}</code> (422) → PUT с примером (200) → «Станет null».',
      ],
    },
    {
      id: 'sw-13',
      title: 'DELETE и идемпотентность',
      giver: { name: 'Могильщик Хорс', sprite: '⚰️' },
      gold: 180,
      setup: { tags: ['items'] },
      outro: 'Идемпотентность — про состояние сервера, а не про код ответа: второй DELETE вернёт 404, но ничего не изменит.',
      steps: [
        { id: 'del', text: 'Авторизуйся и удали существующий предмет через <code>DELETE /items/{id}</code>.',
          check: (c) => has(c, (e) => e.key === 'DELETE /items/{id}' && e.status === 204) },
        { id: 'del-again', text: 'Повтори тот же DELETE ещё раз.',
          check: (c) => { const gone = reqs(c, (e) => e.key === 'DELETE /items/{id}' && e.status === 204).map((e) => e.path); return has(c, (e) => e.key === 'DELETE /items/{id}' && e.status === 404 && gone.includes(e.path)); } },
        { id: 'get-gone', text: 'Убедись через <code>GET /items/{id}</code>, что удалённого предмета больше нет.',
          check: (c) => { const gone = reqs(c, (e) => e.key === 'DELETE /items/{id}' && e.status === 204).map((e) => e.path); return has(c, (e) => e.key === 'GET /items/{id}' && e.status === 404 && gone.includes(e.path)); } },
        { id: 'post-twice', text: 'Отправь <code>POST /items</code> дважды с одинаковым телом и сравни id в ответах.',
          check: (c) => { const ok = reqs(c, (e) => e.key === 'POST /items' && e.status === 201); return ok.some((a) => ok.some((b) => a !== b && JSON.stringify(a.body) === JSON.stringify(b.body) && a.response.id !== b.response.id)); },
          success: 'Два одинаковых POST — два разных предмета. POST не идемпотентен.' },
        { id: 'verdict', text: 'Какие методы идемпотентны?',
          answer: { kind: 'choice', options: ['GET, POST', 'GET, PUT, DELETE', 'Только GET', 'POST, PATCH'], accept: (v) => v === 1 } },
      ],
      hints: [
        'Идемпотентный метод при повторе даёт то же состояние сервера, что и при одном вызове.',
        'Удали, например, предмет 5, повтори DELETE с тем же id, затем GET с этим id. Пример тела POST отправь два раза подряд.',
        'Authorize → <code>DELETE /items/{id}</code> id 5 (204) → ещё раз (404) → <code>GET /items/{id}</code> id 5 (404) → <code>POST /items</code> Execute дважды → «GET, PUT, DELETE».',
      ],
    },
    {
      id: 'sw-14',
      title: 'Пагинация',
      giver: { name: 'Библиотекарь Ив', sprite: '📚' },
      gold: 185,
      setup: { tags: ['items'] },
      outro: 'Пагинацию проверяют на первой, средней, последней неполной странице и за пределами данных.',
      steps: [
        { id: 'page1', text: 'Получи первую страницу из 5 предметов (<code>limit = 5</code>).',
          check: (c) => has(c, (e) => e.key === 'GET /items' && e.query.limit === '5' && !num(e.query.offset) && !e.query.rarity && !e.query.min_price && e.status === 200 && e.response.length === 5) },
        { id: 'total', text: 'Найди в <b>Response headers</b> общее число предметов. Сколько их?',
          answer: { kind: 'text', placeholder: 'Число', accept: (v) => v.trim() === '23', wrong: 'Ищи заголовок x-total-count в ответе.' } },
        { id: 'page2', text: 'Вторая страница по 5: используй <code>offset</code>.',
          check: (c) => has(c, (e) => e.key === 'GET /items' && e.query.limit === '5' && num(e.query.offset) === 5 && !e.query.sort && e.status === 200 && e.response[0] && e.response[0].id === 6) },
        { id: 'last', text: 'Последняя, неполная страница при <code>limit = 5</code>.',
          check: (c) => has(c, (e) => e.key === 'GET /items' && e.query.limit === '5' && !e.query.rarity && !e.query.min_price && e.status === 200 && e.response.length > 0 && e.response.length < 5 && num(e.query.offset) + e.response.length === 23) },
        { id: 'beyond', text: 'Offset за пределами данных — что вернёт сервер?',
          check: (c) => has(c, (e) => e.key === 'GET /items' && num(e.query.offset) >= 23 && !e.query.rarity && !e.query.min_price && e.status === 200 && e.response.length === 0),
          success: '200 и пустой массив — корректное поведение.' },
        { id: 'limit-max', text: 'Нарушь документированный максимум <code>limit</code> и получи <code>400</code>.',
          check: (c) => has(c, (e) => e.key === 'GET /items' && num(e.query.limit) > 50 && e.status === 400) },
      ],
      hints: [
        'limit — размер страницы, offset — сколько записей пропустить. Общее число — в заголовке X-Total-Count (в Response headers).',
        'Вторая страница — offset 5. Последняя при 23 предметах — offset 20. За пределами — offset 100. Максимум limit — 50.',
        '<code>GET /items</code>: limit 5 → ответ 23 → limit 5, offset 5 → limit 5, offset 20 (3 шт.) → offset 100 → limit 51.',
      ],
    },
    {
      id: 'sw-15',
      title: 'Сортировка и фильтры',
      giver: { name: 'Торговка Мила', sprite: '🏷️' },
      gold: 195,
      setup: { tags: ['items'], mock: { bugs: { sortAsString: true } } },
      outro: 'Сортировку числовых полей проверяй на числах разной длины: 95, 120, 1200, 10000.',
      steps: [
        { id: 'filter', text: 'Отфильтруй предметы по редкости <b>epic</b>.',
          check: (c) => has(c, (e) => e.key === 'GET /items' && e.query.rarity === 'epic' && e.status === 200 && e.response.length > 0 && e.response.every((i) => i.rarity === 'epic')) },
        { id: 'min', text: 'Покажи предметы дороже или ровно <b>1000</b> (<code>min_price</code>).',
          check: (c) => has(c, (e) => e.key === 'GET /items' && num(e.query.min_price) === 1000 && e.status === 200 && e.response.length > 0 && e.response.every((i) => i.price >= 1000)) },
        { id: 'sort', text: 'Отсортируй все предметы по цене по возрастанию (<code>sort</code>, <code>order</code>) и внимательно посмотри на порядок цен.',
          check: (c) => has(c, (e) => e.key === 'GET /items' && e.query.sort === 'price' && (e.query.order || 'asc') === 'asc' && !e.query.rarity && !e.query.min_price && e.status === 200 && e.response.length > 2) },
        { id: 'verdict', text: 'Что не так с сортировкой?',
          answer: { kind: 'choice', options: ['Всё верно', 'Цены сортируются как строки: 10000 и 120 идут раньше 15', 'Сервер игнорирует order', 'Сортировка идёт по id'], accept: (v) => v === 1 } },
      ],
      hints: [
        'Фильтры (rarity, min_price) сужают выборку, sort и order задают порядок. Все — query-параметры GET /items.',
        'Возьми limit побольше (например 50), чтобы увидеть весь порядок. Смотри, как стоят цены 10000, 120, 1200, 15.',
        '<code>GET /items</code>: rarity epic → min_price 1000 (rarity --) → min_price пусто, sort price, order asc, limit 50 → «как строки».',
      ],
    },
    {
      id: 'sw-16',
      title: '409 Conflict',
      giver: { name: 'Глашатай Ренн', sprite: '🏰' },
      gold: 205,
      setup: { tags: ['guilds'], mock: { bugs: { guildDupCaseSensitive: true } } },
      outro: 'Уникальность проверяй с вариациями: регистр, пробелы по краям, похожие символы.',
      steps: [
        { id: 'create', text: 'Авторизуйся и основай новую гильдию через <code>POST /guilds</code>.',
          check: (c) => has(c, (e) => e.key === 'POST /guilds' && e.status === 201) },
        { id: 'dup', text: 'Отправь тот же запрос ещё раз — имя уже занято.',
          check: (c) => has(c, (e) => e.key === 'POST /guilds' && e.status === 409) },
        { id: 'case', text: 'В описании: имя уникально <b>без учёта регистра</b>. Создай гильдию с именем уже существующей, но в другом регистре.',
          check: (c) => {
            const created = reqs(c, (e) => e.key === 'POST /guilds' && e.status === 201);
            return created.some((e, i) => {
              const n = String(e.response.name);
              const others = GUILD_NAMES.concat(created.slice(0, i).map((x) => String(x.response.name)));
              return others.some((o) => o !== n && o.toLowerCase() === n.toLowerCase());
            });
          },
          success: 'Баг: сервер создал дубликат, отличающийся только регистром.' },
        { id: 'expected', text: 'Какой код должен был вернуть сервер на последний запрос?',
          answer: { kind: 'text', placeholder: 'Код ответа', accept: (v) => v.trim() === '409' } },
      ],
      hints: [
        '409 Conflict — запрос корректный, но противоречит текущему состоянию (например, дубликат уникального поля).',
        'Execute дважды подряд с примером тела. Для регистра возьми имя существующей гильдии: «Орден Пепла» → «орден пепла».',
        'Authorize → <code>POST /guilds</code> с примером (201) → ещё раз (409) → <code>{"name": "орден пепла"}</code> (201 — баг) → 409.',
      ],
    },
    {
      id: 'sw-17',
      title: 'Content-Type: 415, 400, 422',
      giver: { name: 'Таможенник Гарт', sprite: '📦' },
      gold: 215,
      setup: { tags: ['items'] },
      outro: '415 — не тот формат, 400 — не разобрать, 422 — разобрали, но данные не по схеме.',
      steps: [
        { id: 'xml', text: 'Авторизуйся и в <code>POST /items</code> выбери media type тела не <code>application/json</code>. Выполни запрос.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 415) },
        { id: 'broken', text: 'Верни <code>application/json</code> и сломай синтаксис JSON (например, убери закрывающую скобку).',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 400 && e.body === undefined && /json/.test(e.contentType)) },
        { id: 'schema', text: 'Валидный JSON, но с нарушением схемы (например <code>price: -5</code>).',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 422 && isObj(e.body)) },
        { id: 'ok', text: 'Исправь запрос и получи <code>201</code>.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 201) },
        { id: 'verdict', text: 'Чем 400 отличается от 422 в этом API?',
          answer: { kind: 'choice', options: ['Ничем', '400 — тело не удалось разобрать как JSON; 422 — JSON корректен, но данные нарушают схему', '400 — нет токена; 422 — нет прав'], accept: (v) => v === 1 } },
      ],
      hints: [
        'Тип тела выбирается в выпадающем списке рядом с Request body и уходит в заголовок Content-Type.',
        'Сломанный JSON — например, без последней <code>}</code>. Нарушение схемы — цена меньше 1 или rarity не из списка.',
        'Authorize → media type application/xml → Execute (415) → application/json, тело без <code>}</code> (400) → <code>"price": -5</code> (422) → пример тела (201) → второй вариант.',
      ],
    },
    {
      id: 'sw-18',
      title: 'Документация и реальный ответ',
      giver: { name: 'Ревизор Ост', sprite: '🔍' },
      gold: 225,
      setup: { tags: ['guilds'], mock: { bugs: { guildExtraField: true, guildCreate200: true } } },
      outro: 'Лишнее поле в ответе может быть утечкой данных, а недокументированный код ломает клиентов, сгенерированных по спецификации.',
      steps: [
        { id: 'model', text: 'Открой в Schemas модель <code>Guild</code> и запомни её поля.',
          check: (c) => happened(c, 'model', (e) => e.name === 'Guild') },
        { id: 'get', text: 'Запроси любую гильдию через <code>GET /guilds/{id}</code>.',
          check: (c) => has(c, (e) => e.key === 'GET /guilds/{id}' && e.status === 200) },
        { id: 'extra', text: 'Какого поля из ответа нет в модели Guild?',
          answer: { kind: 'text', placeholder: 'Имя поля', accept: (v) => lc(v) === 'treasury' } },
        { id: 'post', text: 'Авторизуйся и создай гильдию. Сравни код ответа со списком Responses.',
          check: (c) => has(c, (e) => e.key === 'POST /guilds' && e.status === 200 && !e.documented),
          success: 'Swagger UI пометил ответ как Undocumented.' },
        { id: 'verdict', text: 'Что не так с созданием гильдии?',
          answer: { kind: 'choice', options: ['Ничего: 200 — тоже успех', 'Сервер вернул недокументированный 200 вместо 201 Created и без заголовка location', 'Сервер должен был вернуть 204'], accept: (v) => v === 1 } },
      ],
      hints: [
        'Сравнивай ответ сервера с моделью поле за полем, а код — со списком Responses операции.',
        'В модели Guild четыре поля: id, name, motto, members. Swagger подписывает код, которого нет в спецификации, словом Undocumented.',
        'Schemas → Guild → <code>GET /guilds/{id}</code> id 1 → ответ treasury → Authorize → <code>POST /guilds</code> с примером (200, Undocumented) → второй вариант.',
      ],
    },
    {
      id: 'sw-19',
      title: 'Версии API и curl',
      giver: { name: 'Хронист Вел', sprite: '⏳' },
      gold: 235,
      setup: { tags: ['heroes'] },
      outro: 'Смена типа поля — ломающее изменение: старые клиенты сломаются, поэтому его выпускают в новой версии API.',
      steps: [
        { id: 'v1', text: 'На сервере v1 запроси героя через <code>GET /heroes/{id}</code>.',
          check: (c) => has(c, (e) => e.key === 'GET /heroes/{id}' && e.server === M.BASE && e.status === 200) },
        { id: 'switch', text: 'В списке <b>Servers</b> выбери сервер v2.',
          check: (c) => happened(c, 'server', (e) => e.url === M.BASE_V2) },
        { id: 'v2', text: 'Запроси того же героя на v2 и сравни ответы.',
          check: (c) => { const v1 = reqs(c, (e) => e.key === 'GET /heroes/{id}' && e.server === M.BASE && e.status === 200).map((e) => e.path); return has(c, (e) => e.key === 'GET /heroes/{id}' && e.server === M.BASE_V2 && e.status === 200 && v1.includes(e.path)); } },
        { id: 'field', text: 'Какое поле поменяло тип в v2?',
          answer: { kind: 'text', placeholder: 'Имя поля', accept: (v) => lc(v) === 'guild', wrong: 'Сравни ответы v1 и v2 поле за полем: где строка стала объектом?' } },
        { id: 'curl', text: 'Выполни <code>GET /heroes</code> на v2 и скопируй команду кнопкой <b>Copy</b> в блоке Curl — её прикладывают к баг-репорту.',
          check: (c) => happened(c, 'copy-curl', (e) => e.op === 'GET /heroes' && e.server === M.BASE_V2) },
      ],
      hints: [
        'Сервер выбирается в списке Servers над операциями — меняется базовый URL всех запросов.',
        'Запроси один и тот же id (например 1) на обоих серверах. В v2 guild — объект {id, name}, а список героев обёрнут в {data, total}.',
        '<code>GET /heroes/{id}</code> id 1 → Servers: v2 → тот же запрос → ответ guild → <code>GET /heroes</code> → Execute → Copy.',
      ],
    },
    {
      id: 'sw-20',
      title: 'Мини-регресс эндпоинта /items',
      giver: { name: 'Магистр Аурелия', sprite: '🧙‍♀️' },
      gold: 250,
      setup: { tags: ['auth', 'items'], mock: { bugs: { patchAsPut: true, deleteTwice500: true, readerCanDelete: true } } },
      outro: 'Регресс — это чек-лист: частичное обновление, повторное удаление, права ролей. Каждый пункт однажды ловит баг.',
      steps: [
        { id: 'patch-bug', text: 'Авторизуйся как tester и проверь частичное обновление: <code>PATCH /items/{id}</code> только с ценой. Сравни остальные поля с описанием операции.',
          check: (c) => has(c, (e) => e.key === 'PATCH /items/{id}' && e.status === 200 && bodyHas(e, (b) => b.name === undefined) && e.response.name === null),
          success: 'Баг №1: PATCH затёр непереданные поля null — ведёт себя как PUT.' },
        { id: 'delete-bug', text: 'Проверь повторное удаление: дважды <code>DELETE /items/{id}</code> с одним id.',
          check: (c) => has(c, (e) => e.key === 'DELETE /items/{id}' && e.status === 500),
          success: 'Баг №2: повторный DELETE — 500 вместо 404.' },
        { id: 'role-bug', text: 'Проверь права: получи токен роли reader, авторизуйся им и попробуй удалить другой существующий предмет.',
          check: (c) => has(c, (e) => e.key === 'DELETE /items/{id}' && e.status === 204 && e.headers.Authorization === `Bearer ${M.READER_TOKEN}`),
          success: 'Баг №3: reader смог удалить предмет, ожидался 403.' },
        { id: 'report', text: 'Выбери верную сводку для баг-репортов.',
          answer: { kind: 'choice', options: [
            'PATCH — 200 (ок); повторный DELETE — 500; reader — 403 (ок)',
            'PATCH затирает поля (ожидалось частичное обновление); повторный DELETE — 500 вместо 404; reader удаляет предмет — 204 вместо 403',
            'Все три проверки прошли, багов нет',
          ], accept: (v) => v === 1 } },
      ],
      hints: [
        'Для каждой проверки сформулируй ожидание по документации (описание операции + Responses), потом сравни с фактом.',
        'PATCH с <code>{"price": 500}</code> — посмотри на name в ответе. Повторный DELETE — тот же id второй раз. Токен reader — через <code>POST /auth/login</code> (scribe / quill), затем Logout и Authorize им.',
        'Authorize <code>tok_7f3a9c21</code> → PATCH id 3 <code>{"price": 500}</code> → DELETE id 5 дважды → <code>POST /auth/login</code> scribe/quill → Logout → Authorize <code>tok_reader_51b2</code> → DELETE id 7 (204) → второй вариант.',
      ],
    },
    {
      id: 'sw-21',
      title: 'Сверка ответа со схемой',
      giver: { name: 'Контролёр Иса', sprite: '🧾' },
      gold: 260,
      setup: { tags: ['guilds'], mock: { bugs: { guildExtraField: true } } },
      outro: 'Ответ сверяют со схемой по трём пунктам: набор полей, типы и nullable. null в nullable-поле — норма, лишнее поле — расхождение контракта.',
      steps: [
        { id: 'model', text: 'Открой в <b>Schemas</b> модель <code>Guild</code>: какие в ней поля и каких они типов?',
          check: (c) => happened(c, 'model', (e) => e.name === 'Guild') },
        { id: 'list', text: 'Запроси список гильдий через <code>GET /guilds</code> и сверь каждый элемент массива с моделью Guild.',
          check: (c) => has(c, (e) => e.key === 'GET /guilds' && e.status === 200 && Array.isArray(e.response) && e.response.length > 0) },
        { id: 'extra', text: 'Какое поле приходит в ответе, но не описано в модели Guild?',
          answer: { kind: 'text', placeholder: 'Имя поля', accept: (v) => lc(v) === 'treasury', wrong: 'Сравни ключи элемента ответа с полями модели: id, name, motto, members.' } },
        { id: 'one', text: 'Запроси гильдию <b>Лесные Тени</b> через <code>GET /guilds/{id}</code> (её id — в списке) и посмотри на поле <code>motto</code>.',
          check: (c) => has(c, (e) => e.key === 'GET /guilds/{id}' && e.status === 200 && isObj(e.response) && e.response.name === 'Лесные Тени') },
        { id: 'motto', text: 'У Лесных Теней <code>motto: null</code>. Это расхождение со схемой?',
          answer: { kind: 'choice', options: ['Да: motto — string, а пришёл null', 'Нет: в модели у motto указано nullable: true, null допустим', 'Да: сервер должен был вообще не присылать поле'], accept: (v) => v === 1, wrong: 'Посмотри на пометки под типом поля motto в модели Guild.' } },
        { id: 'verdict', text: 'Как правильно оформить находку с полем treasury?',
          answer: { kind: 'choice', options: [
            'Не баг: лишние поля клиенту не мешают',
            'Баг контракта: в ответе Guild есть недокументированное поле treasury — его нужно описать в схеме или убрать из ответа (казна гильдии может оказаться утечкой данных)',
            'Баг Swagger UI: он должен был скрыть поле, которого нет в схеме',
          ], accept: (v) => v === 1 } },
      ],
      hints: [
        'Модель — это контракт. Ответ сверяют поле за полем: всё ли есть, нет ли лишнего, совпадают ли типы, допустим ли null.',
        'В модели Guild четыре поля: id, name, motto (nullable), members. Лесные Тени — гильдия с id 3.',
        'Schemas → Guild → <code>GET /guilds</code> → ответ treasury → <code>GET /guilds/{id}</code> id 3 → «Нет: … nullable …» → второй вариант.',
      ],
    },
    {
      id: 'sw-22',
      title: 'Обязательные поля и типы тела',
      giver: { name: 'Нотариус Эльма', sprite: '🖋️' },
      gold: 270,
      setup: { tags: ['guilds'] },
      outro: 'По модели запроса строится чек-лист: минимальный валидный запрос, отсутствие каждого обязательного поля и неверный тип каждого поля.',
      steps: [
        { id: 'model', text: 'Открой в Schemas модель <code>GuildCreate</code>: какие поля обязательны и каких они типов?',
          check: (c) => happened(c, 'model', (e) => e.name === 'GuildCreate') },
        { id: 'minimal', text: 'Авторизуйся и основай гильдию через <code>POST /guilds</code>, передав <b>только обязательные</b> поля.',
          check: (c) => has(c, (e) => e.key === 'POST /guilds' && e.status === 201 && bodyHas(e, (b) => Object.keys(b).join() === 'name')),
          success: '201: необязательное motto сервер заполнил null.' },
        { id: 'no-name', text: 'Отправь тело без обязательного поля <code>name</code>.',
          check: (c) => has(c, (e) => e.key === 'POST /guilds' && e.status === 422 && bodyHas(e, (b) => b.name === undefined) && e.response.errors.some((x) => x.field === 'name')) },
        { id: 'name-type', text: 'Неверный тип: передай <code>name</code> числом, без кавычек.',
          check: (c) => has(c, (e) => e.key === 'POST /guilds' && e.status === 422 && bodyHas(e, (b) => typeof b.name === 'number')) },
        { id: 'motto-type', text: 'Необязательное поле тоже проверяют по типу: валидное <code>name</code> и <code>motto</code> числом.',
          check: (c) => has(c, (e) => e.key === 'POST /guilds' && e.status === 422 && bodyHas(e, (b) => typeof b.motto === 'number') && e.response.errors.some((x) => x.field === 'motto')),
          success: '422 с указанием поля motto: сервер проверяет типы и у необязательных полей.' },
        { id: 'code', text: 'Какой код этот эндпоинт возвращает на ошибку валидации тела?',
          answer: { kind: 'text', placeholder: 'Код ответа', accept: (v) => v.trim() === '422', wrong: 'Посмотри Responses у POST /guilds или код последнего ответа.' } },
      ],
      hints: [
        'Обязательные поля в модели отмечены звёздочкой. Тип каждого поля написан справа от имени.',
        'Минимальный запрос — <code>{"name": "Дом Ворона"}</code>. Без name — например <code>{"motto": "Видим всё"}</code>. Число без кавычек — <code>"name": 123</code>. Имя гильдии должно быть новым.',
        'Schemas → GuildCreate → Authorize <code>tok_7f3a9c21</code> → <code>{"name": "Дом Ворона"}</code> (201) → <code>{"motto": "Видим всё"}</code> (422) → <code>{"name": 123}</code> (422) → <code>{"name": "Дом Лиса", "motto": 5}</code> (422) → 422.',
      ],
    },
    {
      id: 'sw-23',
      title: 'Границы из документации: длина и PATCH',
      giver: { name: 'Землемер Тарн', sprite: '📏' },
      gold: 280,
      setup: { tags: ['guilds', 'items'], mock: { bugs: { priceNoMax: true } } },
      outro: 'Границы бывают не только у чисел, но и у длины строк. И проверять их нужно в каждой операции, которая принимает поле: POST, PUT и PATCH.',
      steps: [
        { id: 'below', text: 'В модели GuildCreate у <code>name</code>: minLength 3, maxLength 40. Авторизуйся и попробуй основать гильдию с именем из <b>2</b> символов.',
          check: (c) => has(c, (e) => e.key === 'POST /guilds' && e.status === 422 && bodyHas(e, (b) => typeof b.name === 'string' && b.name.length === 2)) },
        { id: 'min', text: 'Теперь имя ровно на нижней границе — <b>3</b> символа.',
          check: (c) => has(c, (e) => e.key === 'POST /guilds' && e.status === 201 && bodyHas(e, (b) => typeof b.name === 'string' && b.name.length === 3)) },
        { id: 'max', text: 'Имя ровно на верхней границе — <b>40</b> символов.',
          check: (c) => has(c, (e) => e.key === 'POST /guilds' && e.status === 201 && bodyHas(e, (b) => typeof b.name === 'string' && b.name.length === 40)) },
        { id: 'above', text: 'И на символ длиннее — <b>41</b>.',
          check: (c) => has(c, (e) => e.key === 'POST /guilds' && e.status === 422 && bodyHas(e, (b) => typeof b.name === 'string' && b.name.length === 41)),
          success: 'Длина имени гильдии проверяется верно на обеих границах.' },
        { id: 'patch', text: 'Границы проверяют в каждой операции. Через <code>PATCH /items/{id}</code> передай <code>price</code> на единицу выше maximum из схемы ItemPatch.',
          check: (c) => has(c, (e) => e.key === 'PATCH /items/{id}' && e.status === 200 && bodyHas(e, (b) => b.price === 10001)),
          success: 'Баг: PATCH сохранил цену 10001, хотя по схеме maximum: 10000.' },
        { id: 'expected', text: 'Какой код должен был вернуть <code>PATCH /items/{id}</code> на <code>price = 10001</code>?',
          answer: { kind: 'text', placeholder: 'Код ответа', accept: (v) => v.trim() === '422', wrong: 'Посмотри Responses у PATCH /items/{id}: какой код означает ошибку валидации?' } },
      ],
      hints: [
        'Для длины [3; 40] граничные значения — 2, 3, 40 и 41 символ. Пробелы по краям сервер обрезает, так что считай только буквы.',
        'Короткие имена: <code>Ок</code> и <code>Ось</code>. 40 символов: <code>Братство Северного Ветра и Ледяной Скалы</code>, 41: <code>Братство Северного Ветра и Ледяных Вершин</code>. Для PATCH хватит тела <code>{"price": 10001}</code>.',
        'Authorize <code>tok_7f3a9c21</code> → <code>POST /guilds</code> с name «Ок» (422) → «Ось» (201) → 40 символов (201) → 41 символ (422) → <code>PATCH /items/{id}</code> id 3 с <code>{"price": 10001}</code> (200 — баг) → 422.',
      ],
    },
    {
      id: 'sw-24',
      title: 'Код ответа против документации',
      giver: { name: 'Судья Корвин', sprite: '🏛️' },
      gold: 290,
      setup: { tags: ['guilds', 'items'], mock: { bugs: { guildCreate200: true } } },
      outro: 'Код ответа — часть контракта. Сгенерированный по спецификации клиент ждёт именно 201 и Location; «тоже успешный» 200 его ломает.',
      steps: [
        { id: 'doc', text: 'Раскрой <code>POST /guilds</code> и в блоке Responses у кода <code>201</code> открой вкладку <b>Schema</b>: что обещает документация при успехе?',
          check: (c) => happened(c, 'resp-tab', (e) => e.op === 'POST /guilds' && e.code === '201' && e.tab === 'schema') },
        { id: 'etalon', text: 'Для сравнения авторизуйся и создай предмет через <code>POST /items</code>: посмотри код ответа и Response headers.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 201 && e.respHeaders.location),
          success: '201 Created и заголовок location с адресом нового ресурса — так создание и должно выглядеть.' },
        { id: 'create', text: 'Теперь основай новую гильдию через <code>POST /guilds</code> и сравни код со списком Responses.',
          check: (c) => has(c, (e) => e.key === 'POST /guilds' && e.status === 200 && !e.documented),
          success: 'Swagger UI пометил код как Undocumented: 200 нет в Responses.' },
        { id: 'header', text: 'Какого заголовка нет в ответе <code>POST /guilds</code>, хотя он есть в ответе <code>POST /items</code>?',
          answer: { kind: 'text', placeholder: 'Имя заголовка', accept: (v) => lc(v) === 'location', wrong: 'Сравни Response headers двух ответов на создание.' } },
        { id: 'dup', text: 'Негативные коды тоже сверяют с документацией: повтори создание той же гильдии.',
          check: (c) => has(c, (e) => e.key === 'POST /guilds' && e.status === 409 && e.documented),
          success: '409 есть в Responses — здесь сервер ведёт себя по документации.' },
        { id: 'report', text: 'Выбери верную формулировку для баг-репорта.',
          answer: { kind: 'choice', options: [
            'POST /guilds: ожидалось 200 OK, фактически 201',
            'POST /guilds: ожидалось 201 Created с заголовком location (по спецификации), фактически 200 OK без location — код не задокументирован',
            'POST /guilds: ожидалось 204 No Content, фактически 200 с телом',
          ], accept: (v) => v === 1 } },
      ],
      hints: [
        'Сравнивай фактический код с таблицей Responses операции, а не с «успех / не успех». Swagger подписывает код вне спецификации словом Undocumented.',
        'Эталон — <code>POST /items</code> с примером тела: 201 и заголовок location. У гильдии смотри те же места: код и Response headers.',
        'POST /guilds → 201 → Schema → Authorize <code>tok_7f3a9c21</code> → <code>POST /items</code> с примером (201) → <code>POST /guilds</code> с примером (200, Undocumented) → ответ location → тот же POST /guilds ещё раз (409) → второй вариант.',
      ],
    },
    {
      id: 'sw-25',
      title: 'Права ролей и PATCH по документации',
      giver: { name: 'Канцлер Сильвана', sprite: '👑' },
      gold: 300,
      setup: { tags: ['auth', 'items'], mock: { bugs: { patchAsPut: true, readerCanDelete: true } } },
      outro: 'Права проверяют матрицей «роль × операция», а PATCH — повторным GET: важно не только что вернул ответ, но и что сохранилось на сервере.',
      steps: [
        { id: 'login', text: 'По описанию API роль reader может только читать. Получи токен reader через <code>POST /auth/login</code> и авторизуйся им.',
          check: (c) => c.state.token === M.READER_TOKEN },
        { id: 'post-403', text: 'Под reader попробуй создать предмет через <code>POST /items</code>.',
          check: (c) => has(c, (e) => e.key === 'POST /items' && e.status === 403 && e.headers.Authorization === `Bearer ${M.READER_TOKEN}`),
          success: '403, как в документации: создавать reader не может.' },
        { id: 'del-bug', text: 'Под reader попробуй удалить существующий предмет через <code>DELETE /items/{id}</code>.',
          check: (c) => has(c, (e) => e.key === 'DELETE /items/{id}' && e.status === 204 && e.headers.Authorization === `Bearer ${M.READER_TOKEN}`),
          success: 'Баг: reader удалил предмет — 204 вместо документированного 403.' },
        { id: 'patch', text: 'Сделай Logout, авторизуйся как tester и измени у другого предмета только цену через <code>PATCH /items/{id}</code>.',
          check: (c) => has(c, (e) => e.key === 'PATCH /items/{id}' && e.status === 200 && e.headers.Authorization === `Bearer ${M.TOKEN}` && bodyHas(e, (b) => b.price !== undefined && b.name === undefined)),
          success: 'Посмотри на ответ: что стало с name и rarity?' },
        { id: 'get', text: 'Проверь, что сохранилось на сервере: запроси этот же предмет через <code>GET /items/{id}</code>.',
          check: (c) => { const patched = reqs(c, (e) => e.key === 'PATCH /items/{id}' && e.status === 200).map((e) => e.path); return has(c, (e) => e.key === 'GET /items/{id}' && e.status === 200 && patched.includes(e.path) && e.response.name === null); },
          success: 'Баг: PATCH затёр непереданные поля null, и это сохранилось на сервере.' },
        { id: 'report', text: 'Выбери верную сводку проверки.',
          answer: { kind: 'choice', options: [
            'Всё по документации: reader получил 403, PATCH вернул 200',
            'reader: POST — 403 (ок), DELETE — 204 вместо 403 (баг прав); PATCH меняет не только переданные поля, а затирает остальные null — ведёт себя как PUT (баг)',
            'reader: POST — 403 (баг, он должен уметь создавать); PATCH — ок',
          ], accept: (v) => v === 1 } },
      ],
      hints: [
        'Роли описаны в модели User и в описаниях операций: reader — только чтение. Сравни описание PATCH («меняются только переданные поля») с ответом.',
        'Токен reader — из <code>POST /auth/login</code> с <code>{"login": "scribe", "password": "quill"}</code>. Удаляй и патчи разные предметы, например 5 и 3. Тело PATCH — <code>{"price": 500}</code>.',
        '<code>POST /auth/login</code> scribe/quill → Authorize <code>tok_reader_51b2</code> → <code>POST /items</code> (403) → <code>DELETE /items/{id}</code> id 5 (204 — баг) → Logout → Authorize <code>tok_7f3a9c21</code> → PATCH id 3 <code>{"price": 500}</code> → <code>GET /items/{id}</code> id 3 (name: null — баг) → второй вариант.',
      ],
    },
  ];

  Quest.create({ mode: 'swagger', icon: '📜', title: 'API · Swagger', buildSim, levels: LEVELS });
})();
