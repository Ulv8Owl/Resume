// Симулятор Swagger UI: документация «Хроник API», Try it out, Authorize, схемы.
(function () {
  'use strict';

  const Core = window.Core;
  const M = window.MockApi;
  const esc = Core.esc;

  const OPS = [
    { tag: 'auth', method: 'POST', path: '/auth/login', summary: 'Получить токен доступа',
      description: 'Возвращает Bearer-токен по логину и паролю.',
      body: { schema: 'LoginRequest', example: { login: 'mage', password: 'chronicles' } },
      responses: { 200: 'Токен выдан', 400: 'Не хватает полей', 401: 'Неверные учётные данные' } },
    { tag: 'auth', method: 'GET', path: '/me', summary: 'Текущий пользователь', auth: true,
      responses: { 200: 'Профиль', 401: 'Нет или неверный токен' } },
    { tag: 'heroes', method: 'GET', path: '/heroes', summary: 'Список героев',
      description: 'Можно отфильтровать по классу и ограничить количество.',
      params: [
        { name: 'class', in: 'query', type: 'string', description: 'Класс героя', enum: M.CLASSES },
        { name: 'limit', in: 'query', type: 'integer', description: 'Сколько героев вернуть' },
      ],
      responses: { 200: 'Массив Hero', 400: 'Неверный limit' } },
    { tag: 'heroes', method: 'GET', path: '/heroes/{id}', summary: 'Герой по id',
      params: [{ name: 'id', in: 'path', type: 'integer', required: true, description: 'Идентификатор героя' }],
      responses: { 200: 'Hero', 400: 'id не число', 404: 'Герой не найден' } },
    { tag: 'heroes', method: 'POST', path: '/heroes', summary: 'Создать героя', auth: true,
      description: 'Создаёт героя. Поля и ограничения — в схеме HeroCreate.',
      body: { schema: 'HeroCreate', example: { name: 'Ульрих', class: 'Воин', level: 1 } },
      responses: { 201: 'Созданный Hero', 400: 'Ошибка валидации', 401: 'Нет или неверный токен' } },
    { tag: 'heroes', method: 'DELETE', path: '/heroes/{id}', summary: 'Удалить героя', auth: true,
      params: [{ name: 'id', in: 'path', type: 'integer', required: true, description: 'Идентификатор героя' }],
      responses: { 204: 'Удалён', 401: 'Нет или неверный токен', 404: 'Герой не найден' } },
  ];

  const SCHEMAS = {
    Hero: [['id', 'integer', ''], ['name', 'string', ''], ['class', 'string', ''], ['level', 'integer', ''], ['guild', 'string | null', '']],
    HeroCreate: [
      ['name*', 'string', 'от 1 до 32 символов'],
      ['class*', 'string', `одно из: ${M.CLASSES.join(', ')}`],
      ['level*', 'integer', 'minimum: 1, maximum: 100'],
    ],
    LoginRequest: [['login*', 'string', ''], ['password*', 'string', '']],
    Error: [['error', 'string', ''], ['errors', 'array', 'список { field, message }']],
  };

  const TAGS = { auth: 'Авторизация', heroes: 'Герои' };

  function buildSim(el, ctx) {
    const api = M.create();
    const state = ctx.state;
    state.token = '';
    el.innerHTML = `
      <div class="swagger">
        <div class="sw-top"><span class="sw-logo">{…} Swagger</span><span class="sw-url">${M.BASE}/openapi.json</span></div>
        <div class="sw-info">
          <h3>Хроники API <span class="sw-ver">1.0.0</span> <span class="sw-oas">OAS 3.0</span></h3>
          <p>API гильдии героев. Тестовый стенд: <code>${M.BASE}</code>.</p>
          <p>Для методов с замком нужна авторизация. Токен тестового стенда: <code>${M.TOKEN}</code>.</p>
        </div>
        <div class="sw-bar">
          <label>Servers <select disabled><option>${M.BASE}</option></select></label>
          <button class="sw-authorize" type="button">Authorize <span class="lock">🔓</span></button>
        </div>
        <div class="sw-ops"></div>
        <details class="sw-schemas"><summary>Schemas</summary><div></div></details>
      </div>`;

    const authBtn = el.querySelector('.sw-authorize');
    function renderAuth() {
      authBtn.querySelector('.lock').textContent = state.token ? '🔒' : '🔓';
      authBtn.classList.toggle('on', !!state.token);
      el.querySelectorAll('.sw-op-lock').forEach((l) => { l.textContent = state.token ? '🔒' : '🔓'; });
    }
    authBtn.addEventListener('click', () => {
      const close = Core.modal(`
        <h3>Available authorizations</h3>
        <div class="sw-auth-form">
          <p><b>bearerAuth</b> (http, Bearer)</p>
          ${state.token ? `<p>Authorized. Токен: <code>${esc(state.token)}</code></p><button class="btn" id="sw-logout" type="button">Logout</button>`
            : `<label>Value <input id="sw-token" type="text" placeholder="токен без слова Bearer"></label><button class="btn attack" id="sw-auth-ok" type="button">Authorize</button>`}
        </div>
        <button class="btn" id="modal-close" type="button">Close</button>`);
      const ok = document.getElementById('sw-auth-ok');
      if (ok) ok.addEventListener('click', () => {
        const v = document.getElementById('sw-token').value.trim().replace(/^Bearer\s+/i, '');
        if (!v) return;
        state.token = v;
        renderAuth();
        close();
        ctx.emit({ type: 'authorize', token: v });
      });
      const lo = document.getElementById('sw-logout');
      if (lo) lo.addEventListener('click', () => { state.token = ''; renderAuth(); close(); ctx.emit({ type: 'logout' }); });
    });

    const ops = el.querySelector('.sw-ops');
    Object.keys(TAGS).forEach((tag) => {
      const sec = document.createElement('section');
      sec.className = 'sw-tag';
      sec.innerHTML = `<h4>${tag} <small>${TAGS[tag]}</small></h4>`;
      OPS.filter((o) => o.tag === tag).forEach((op) => sec.appendChild(opBlock(op)));
      ops.appendChild(sec);
    });

    el.querySelector('.sw-schemas div').innerHTML = Object.entries(SCHEMAS).map(([name, fields]) => `
      <div class="sw-schema"><b>${name}</b><table>${fields.map(([f, t, c]) => `<tr><td class="${f.endsWith('*') ? 'req' : ''}">${esc(f)}</td><td>${esc(t)}</td><td>${esc(c)}</td></tr>`).join('')}</table></div>`).join('');
    el.querySelector('.sw-schemas').addEventListener('toggle', (e) => { if (e.target.open) ctx.emit({ type: 'schemas' }); });

    function opBlock(op) {
      const d = document.createElement('div');
      d.className = `sw-op m-${op.method.toLowerCase()}`;
      d.innerHTML = `
        <button class="sw-op-head" type="button" aria-expanded="false">
          <span class="sw-method">${op.method}</span><span class="sw-path">${esc(op.path)}</span>
          <span class="sw-sum">${esc(op.summary)}</span>${op.auth ? '<span class="sw-op-lock" title="Нужна авторизация">🔓</span>' : ''}
        </button>
        <div class="sw-op-body" hidden></div>`;
      const head = d.querySelector('.sw-op-head');
      const body = d.querySelector('.sw-op-body');
      let tryOut = false;
      let built = false;

      function build() {
        built = true;
        body.innerHTML = `
          ${op.description ? `<p class="sw-desc">${esc(op.description)}</p>` : ''}
          <div class="sw-row"><b>Parameters</b><button class="btn sw-try" type="button">Try it out</button></div>
          ${op.params ? `<table class="sw-params"><tr><th>Name</th><th>Description</th></tr>${op.params.map((p) => `
            <tr><td><span class="${p.required ? 'req' : ''}">${p.name}${p.required ? ' *' : ''}</span><small>${p.type} (${p.in})</small></td>
            <td>${esc(p.description || '')}${p.enum ? `<br><small>Доступные: ${p.enum.join(', ')}</small>` : ''}
            <input class="sw-param" data-name="${p.name}" data-in="${p.in}" disabled placeholder="${p.name}"></td></tr>`).join('')}</table>` : '<p class="sw-none">No parameters</p>'}
          ${op.body ? `<div class="sw-row"><b>Request body</b> <small>application/json · схема ${op.body.schema}</small></div>
            <textarea class="sw-body" spellcheck="false" disabled>${esc(JSON.stringify(op.body.example, null, 2))}</textarea>` : ''}
          <div class="sw-exec" hidden><button class="btn attack sw-execute" type="button">Execute</button><button class="btn sw-clear" type="button">Clear</button></div>
          <div class="sw-result"></div>
          <b>Responses</b>
          <table class="sw-resp">${Object.entries(op.responses).map(([c, t]) => `<tr><td>${c}</td><td>${esc(t)}</td></tr>`).join('')}</table>`;
        body.querySelector('.sw-try').addEventListener('click', (e) => {
          tryOut = !tryOut;
          e.target.textContent = tryOut ? 'Cancel' : 'Try it out';
          body.querySelectorAll('.sw-param, .sw-body').forEach((i) => { i.disabled = !tryOut; });
          body.querySelector('.sw-exec').hidden = !tryOut;
          if (tryOut) ctx.emit({ type: 'tryout', op: op.method + ' ' + op.path });
        });
        body.querySelector('.sw-execute').addEventListener('click', execute);
        body.querySelector('.sw-clear').addEventListener('click', () => { body.querySelector('.sw-result').innerHTML = ''; });
      }

      function execute() {
        let path = op.path;
        const query = new URLSearchParams();
        const missing = [];
        body.querySelectorAll('.sw-param').forEach((i) => {
          const v = i.value.trim();
          if (i.dataset.in === 'path') {
            if (!v) missing.push(i.dataset.name);
            path = path.replace(`{${i.dataset.name}}`, encodeURIComponent(v));
          } else if (v) query.set(i.dataset.name, v);
        });
        const res = body.querySelector('.sw-result');
        if (missing.length) { res.innerHTML = `<p class="error">Required field is not provided: ${missing.join(', ')}</p>`; return; }
        const url = M.BASE + path + (query.toString() ? '?' + query.toString() : '');
        const headers = { accept: 'application/json' };
        let reqBody = null;
        if (op.body) { headers['Content-Type'] = 'application/json'; reqBody = body.querySelector('.sw-body').value; }
        if (op.auth && state.token) headers.Authorization = `Bearer ${state.token}`;
        const r = api.handle({ method: op.method, url, headers, body: reqBody });
        const curl = [`curl -X '${op.method}' \\`, `  '${url}' \\`].concat(Object.entries(headers).map(([k, v]) => `  -H '${k}: ${v}' \\`))
          .concat(reqBody ? [`  -d '${reqBody.replace(/\s*\n\s*/g, ' ')}'`] : []).join('\n').replace(/ \\$/, '');
        res.innerHTML = `
          <p class="sw-label">Curl</p><pre>${esc(curl)}</pre>
          <p class="sw-label">Request URL</p><pre>${esc(url)}</pre>
          <p class="sw-label">Server response</p>
          <table class="sw-server"><tr><th>Code</th><th>Details</th></tr><tr><td class="code s${String(r.status)[0]}">${r.status}</td><td>
            ${r.body ? `<small>Response body</small><pre>${esc(r.body)}</pre>` : '<small>Тело ответа пустое</small>'}
            <small>Response headers</small><pre>${esc(Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join('\n'))}</pre></td></tr></table>`;
        let parsed = null;
        try { parsed = reqBody ? JSON.parse(reqBody) : null; } catch (e) { parsed = undefined; }
        ctx.emit({ type: 'request', method: op.method, op: op.path, url, path, headers, body: parsed, status: r.status, response: r.json });
      }

      head.addEventListener('click', () => {
        const open = body.hidden;
        if (open && !built) build();
        body.hidden = !open;
        head.setAttribute('aria-expanded', String(open));
      });
      return d;
    }

    renderAuth();
    return {};
  }

  const reqs = (ctx, f) => ctx.log.filter((e) => e.type === 'request' && f(e));

  Quest.create({
    mode: 'swagger',
    icon: '📜',
    title: 'API · Swagger',
    buildSim,
    levels: [{
      id: 'sw-1',
      title: 'Первое знакомство с документацией',
      giver: { name: 'Хранитель свитков API', sprite: '📜' },
      gold: 90,
      intro: 'Хранитель запечатал «Хроники API» шестью печатями. Каждую снимает одна проверка, которую тестировщик делает в Swagger: от простого запроса до поиска бага по документации.',
      outro: 'Ты нашёл настоящий баг по документации. Именно так Swagger и используют на работе.',
      steps: [
        { id: 'get-ok', text: 'Найди эндпоинт, который возвращает героя по id, нажми <b>Try it out</b> и запроси героя с id <b>5</b>.',
          check: (c) => reqs(c, (e) => e.method === 'GET' && e.op === '/heroes/{id}' && e.path === '/heroes/5' && e.status === 200).length > 0,
          success: 'Сервер вернул 200 и героя Даэль. Позитивная проверка пройдена.' },
        { id: 'get-404', text: 'Негативная проверка: запроси героя, которого <b>нет</b> в базе, и получи <code>404</code>.',
          check: (c) => reqs(c, (e) => e.op === '/heroes/{id}' && e.status === 404).length > 0,
          success: 'Сервер честно сказал 404 Not Found. Негативные проверки так же важны, как позитивные.' },
        { id: 'auth', text: 'Методы с замком требуют токен. Нажми <b>Authorize</b> и введи тестовый токен из описания API.',
          check: (c) => c.state.token === M.TOKEN,
          success: 'Замки закрылись: теперь Swagger отправляет заголовок Authorization: Bearer … со всеми защищёнными запросами.' },
        { id: 'post-201', text: 'Создай героя через <code>POST /heroes</code> с корректным телом и получи <code>201</code>.',
          check: (c) => reqs(c, (e) => e.method === 'POST' && e.op === '/heroes' && e.status === 201 && e.body && e.body.level >= 1).length > 0,
          success: '201 Created: сервер создал героя и вернул его с новым id.' },
        { id: 'post-400', text: 'Проверь обязательное поле: отправь <code>POST /heroes</code> <b>без поля name</b> и получи ошибку валидации.',
          check: (c) => reqs(c, (e) => e.method === 'POST' && e.op === '/heroes' && e.status === 400 && e.body && e.body.name === undefined).length > 0,
          success: '400 Bad Request с указанием поля name. Сервер проверяет обязательные поля правильно.' },
        { id: 'bug', text: 'Открой раздел <b>Schemas</b>: какие границы у поля <code>level</code>? Проверь нижнюю границу минус один: отправь героя с <code>level = 0</code> и посмотри, что ответит сервер.',
          check: (c) => reqs(c, (e) => e.method === 'POST' && e.op === '/heroes' && e.body && e.body.level === 0 && e.status === 201).length > 0,
          success: 'Баг найден! По схеме level ≥ 1, а сервер принял 0 и вернул 201. Ожидалось 400. Это классическая ошибка на границе диапазона.' },
      ],
      hints: [
        'Каждый эндпоинт раскрывается по клику. Внутри: параметры, тело запроса и ответы. Чтобы отправить запрос, нажми <b>Try it out</b>, заполни поля и нажми <b>Execute</b>.',
        'Герой по id — это <code>GET /heroes/{id}</code>, несуществующий id — например 999. Токен написан в шапке документации, его вставляют в окно <b>Authorize</b> без слова Bearer. Для <code>POST /heroes</code> пример тела уже заполнен — просто убери из него строку с <code>name</code> для негативной проверки.',
        'Порядок: <code>GET /heroes/{id}</code> с id 5 → тот же метод с id 999 → Authorize с токеном <code>tok_7f3a9c21</code> → <code>POST /heroes</code> с примером как есть → тело <code>{"class": "Воин", "level": 1}</code> → тело <code>{"name": "Ноль", "class": "Воин", "level": 0}</code>.',
      ],
    }],
  });
})();
