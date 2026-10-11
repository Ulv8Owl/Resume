// Симулятор Postman: коллекция, окружение с переменными, вкладки Params / Authorization / Headers / Body.
(function () {
  'use strict';

  const Core = window.Core;
  const M = window.MockApi;
  const esc = Core.esc;

  const COLLECTION = [
    { name: 'Список героев', method: 'GET', url: '{{baseUrl}}/heroes' },
    { name: 'Логин', method: 'POST', url: '{{baseUrl}}/auth/login' },
    { name: 'Кто я', method: 'GET', url: '{{baseUrl}}/me' },
  ];

  function buildSim(el, ctx) {
    const api = M.create();
    const env = { baseUrl: M.BASE, token: '' };
    ctx.state.env = env;
    let useEnv = true;
    const req = { method: 'GET', url: '', params: [], headers: [], authType: 'none', authToken: '', bodyMode: 'none', body: '' };
    let tab = 'params';
    let resTab = 'body';
    let last = null;

    el.innerHTML = `
      <div class="postman">
        <div class="pm-top">
          <span class="pm-logo">◉ Postman</span>
          <span class="pm-ws">Рабочее пространство · Академия QA</span>
          <label class="pm-env">Окружение <select class="pm-env-sel"><option value="dev">Хроники · dev</option><option value="none">No Environment</option></select></label>
          <button class="btn pm-env-btn" type="button" title="Переменные окружения">👁 Переменные</button>
        </div>
        <div class="pm-main">
          <aside class="pm-side">
            <p class="pm-side-title">Collections</p>
            <details open><summary>📁 Хроники API</summary>
              <p class="pm-coll-desc">Тестовый стенд гильдии. Учётные данные: логин <code>${M.LOGIN.login}</code>, пароль <code>${M.LOGIN.password}</code>.</p>
              <ul class="pm-coll">${COLLECTION.map((c, i) => `<li><button type="button" data-i="${i}"><span class="pm-m m-${c.method.toLowerCase()}">${c.method}</span>${esc(c.name)}</button></li>`).join('')}</ul>
            </details>
          </aside>
          <section class="pm-work">
            <div class="pm-reqline">
              <select class="pm-method">${['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => `<option>${m}</option>`).join('')}</select>
              <input class="pm-url" type="text" spellcheck="false" placeholder="Введите URL или вставьте текст" aria-label="URL запроса">
              <button class="btn attack pm-send" type="button">Send</button>
            </div>
            <div class="pm-tabs" role="tablist">
              <button type="button" data-tab="params">Params</button>
              <button type="button" data-tab="auth">Authorization</button>
              <button type="button" data-tab="headers">Headers</button>
              <button type="button" data-tab="body">Body</button>
            </div>
            <div class="pm-tabpane"></div>
            <div class="pm-response"><p class="pm-empty">Нажми Send, чтобы получить ответ.</p></div>
          </section>
        </div>
      </div>`;

    const $ = (s) => el.querySelector(s);
    const resolve = (s) => (useEnv ? String(s).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in env ? env[k] : m)) : String(s));

    // URL и вкладка Params синхронизированы, как в Postman.
    function paramsFromUrl() {
      const q = req.url.split('?')[1];
      req.params = q ? q.split('&').filter(Boolean).map((p) => {
        const [k, ...v] = p.split('=');
        return { key: decodeURIComponent(k), value: decodeURIComponent(v.join('=')) };
      }) : [];
    }
    function urlFromParams() {
      const base = req.url.split('?')[0];
      const q = req.params.filter((p) => p.key).map((p) => `${p.key}=${p.value}`).join('&');
      req.url = q ? `${base}?${q}` : base;
      $('.pm-url').value = req.url;
    }

    function renderTab() {
      el.querySelectorAll('.pm-tabs button').forEach((b) => {
        b.classList.toggle('on', b.dataset.tab === tab);
        const n = b.dataset.tab === 'params' ? req.params.length : b.dataset.tab === 'headers' ? req.headers.length : 0;
        b.textContent = { params: 'Params', auth: 'Authorization', headers: 'Headers', body: 'Body' }[b.dataset.tab] + (n ? ` (${n})` : '');
      });
      const pane = $('.pm-tabpane');
      if (tab === 'params' || tab === 'headers') {
        const rows = tab === 'params' ? req.params : req.headers;
        pane.innerHTML = `<table class="pm-kv"><tr><th>Key</th><th>Value</th><th></th></tr>
          ${rows.map((r, i) => `<tr><td><input data-k="${i}" value="${esc(r.key)}"></td><td><input data-v="${i}" value="${esc(r.value)}"></td><td><button type="button" data-del="${i}" title="Удалить">✕</button></td></tr>`).join('')}
          <tr><td colspan="3"><button type="button" class="pm-add">+ Добавить</button></td></tr></table>
          ${tab === 'headers' ? '<p class="pm-note">Заголовок Content-Type: application/json Postman добавляет сам, когда тело запроса — JSON.</p>' : ''}`;
        pane.querySelectorAll('[data-k]').forEach((i) => i.addEventListener('input', () => { rows[+i.dataset.k].key = i.value; if (tab === 'params') urlFromParams(); }));
        pane.querySelectorAll('[data-v]').forEach((i) => i.addEventListener('input', () => { rows[+i.dataset.v].value = i.value; if (tab === 'params') urlFromParams(); }));
        pane.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { rows.splice(+b.dataset.del, 1); if (tab === 'params') urlFromParams(); renderTab(); }));
        pane.querySelector('.pm-add').addEventListener('click', () => { rows.push({ key: '', value: '' }); renderTab(); });
      } else if (tab === 'auth') {
        pane.innerHTML = `<label class="pm-field">Type <select class="pm-auth-type"><option value="none">No Auth</option><option value="bearer">Bearer Token</option></select></label>
          ${req.authType === 'bearer' ? `<label class="pm-field">Token <input class="pm-auth-token" value="${esc(req.authToken)}" placeholder="токен или {{переменная}}"></label>
          <p class="pm-note">Postman сам добавит заголовок <code>Authorization: Bearer &lt;токен&gt;</code>.</p>` : '<p class="pm-note">Запрос уйдёт без авторизации.</p>'}`;
        pane.querySelector('.pm-auth-type').value = req.authType;
        pane.querySelector('.pm-auth-type').addEventListener('change', (e) => { req.authType = e.target.value; renderTab(); });
        const t = pane.querySelector('.pm-auth-token');
        if (t) t.addEventListener('input', () => { req.authToken = t.value; });
      } else {
        pane.innerHTML = `<div class="pm-body-modes"><label><input type="radio" name="pm-bm" value="none"> none</label><label><input type="radio" name="pm-bm" value="raw"> raw · JSON</label></div>
          ${req.bodyMode === 'raw' ? `<textarea class="pm-body" spellcheck="false" placeholder='{ "ключ": "значение" }'>${esc(req.body)}</textarea>` : '<p class="pm-note">У этого запроса нет тела.</p>'}`;
        pane.querySelector(`input[value="${req.bodyMode}"]`).checked = true;
        pane.querySelectorAll('input[name="pm-bm"]').forEach((r) => r.addEventListener('change', () => { req.bodyMode = r.value; renderTab(); }));
        const b = pane.querySelector('.pm-body');
        if (b) b.addEventListener('input', () => { req.body = b.value; });
      }
    }

    function load(c) {
      Object.assign(req, { method: c.method, url: c.url, headers: [], authType: 'none', authToken: '', bodyMode: c.method === 'POST' ? 'raw' : 'none', body: '' });
      paramsFromUrl();
      $('.pm-method').value = req.method;
      $('.pm-url').value = req.url;
      tab = req.bodyMode === 'raw' ? 'body' : 'params';
      renderTab();
    }

    function send() {
      req.method = $('.pm-method').value;
      req.url = $('.pm-url').value.trim();
      const headers = {};
      req.headers.filter((h) => h.key).forEach((h) => { headers[h.key] = resolve(h.value); });
      if (req.authType === 'bearer') headers.Authorization = `Bearer ${resolve(req.authToken)}`;
      const hasBody = req.bodyMode === 'raw' && req.body.trim();
      if (hasBody && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
      const url = resolve(req.url);
      const unresolved = (url.match(/\{\{(\w+)\}\}/g) || []).concat(Object.values(headers).join(' ').match(/\{\{(\w+)\}\}/g) || []);
      const r = /^https?:\/\//.test(url) ? api.handle({ method: req.method, url, headers, body: hasBody ? resolve(req.body) : null }) : { networkError: 'Invalid protocol: укажи полный адрес, например {{baseUrl}}/heroes' };
      last = r;
      renderResponse(unresolved);
      let parsedUrl = null;
      try { parsedUrl = new URL(url); } catch (e) { /* неверный адрес */ }
      let body = null;
      try { body = hasBody ? JSON.parse(resolve(req.body)) : null; } catch (e) { body = undefined; }
      ctx.emit({
        type: 'request', method: req.method, rawUrl: req.url, url, status: r.status || 0,
        path: parsedUrl ? parsedUrl.pathname.replace(/^\/v1/, '') : '',
        query: parsedUrl ? Object.fromEntries(parsedUrl.searchParams) : {},
        rawAuth: req.authType === 'bearer' ? req.authToken : '', headers, body, response: r.json,
      });
    }

    function renderResponse(unresolved) {
      const box = $('.pm-response');
      const r = last;
      if (r.networkError) {
        box.innerHTML = `<div class="pm-neterr"><b>Could not send request</b><p>Error: ${esc(r.networkError)}</p>${unresolved.length ? `<p>Неизвестные переменные: ${esc(unresolved.join(', '))}. Проверь окружение.</p>` : ''}</div>`;
        return;
      }
      const size = (r.body || '').length + 120;
      box.innerHTML = `
        <div class="pm-res-head">
          <div class="pm-res-tabs"><button type="button" data-rt="body">Body</button><button type="button" data-rt="headers">Headers (${Object.keys(r.headers).length})</button></div>
          <span class="pm-status s${String(r.status)[0]}">${r.status} ${esc(r.statusText)}</span><span>${r.time} ms</span><span>${size} B</span>
        </div>
        ${unresolved.length ? `<p class="pm-warn">Переменные без значения: ${esc(unresolved.join(', '))}</p>` : ''}
        <div class="pm-res-body"></div>`;
      const body = box.querySelector('.pm-res-body');
      const show = () => {
        box.querySelectorAll('[data-rt]').forEach((b) => b.classList.toggle('on', b.dataset.rt === resTab));
        body.innerHTML = resTab === 'body'
          ? (r.body ? `<pre class="pm-json">${esc(r.body)}</pre>` : '<p class="pm-note">Тело ответа пустое.</p>')
          : `<table class="pm-kv">${Object.entries(r.headers).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
      };
      box.querySelectorAll('[data-rt]').forEach((b) => b.addEventListener('click', () => { resTab = b.dataset.rt; show(); }));
      show();
    }

    function openEnv() {
      const close = Core.modal(`
        <h3>Хроники · dev</h3>
        <table class="pm-kv pm-envtable"><tr><th>Variable</th><th>Current value</th></tr>
          ${Object.entries(env).map(([k, v]) => `<tr><td><code>${k}</code></td><td><input data-env="${k}" value="${esc(v)}" spellcheck="false"></td></tr>`).join('')}
        </table>
        <p class="modal-tip">В запросах переменная пишется как <code>{{имя}}</code>. Значение подставляется при отправке.</p>
        <button class="btn attack" id="modal-next" type="button">Save</button>
        <button class="btn" id="modal-close" type="button">Отмена</button>`, {
        onNext: () => {
          document.querySelectorAll('[data-env]').forEach((i) => { env[i.dataset.env] = i.value.trim(); });
          // событие — после закрытия окна, чтобы окно победы не закрылось вместе с ним
          setTimeout(() => ctx.emit({ type: 'env', env: Object.assign({}, env) }), 0);
        },
      });
      return close;
    }

    $('.pm-send').addEventListener('click', send);
    $('.pm-url').addEventListener('input', (e) => { req.url = e.target.value; paramsFromUrl(); if (tab === 'params') renderTab(); });
    $('.pm-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    $('.pm-method').addEventListener('change', (e) => { req.method = e.target.value; });
    el.querySelectorAll('.pm-tabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; renderTab(); }));
    el.querySelectorAll('.pm-coll button').forEach((b) => b.addEventListener('click', () => load(COLLECTION[+b.dataset.i])));
    $('.pm-env-sel').addEventListener('change', (e) => { useEnv = e.target.value === 'dev'; });
    $('.pm-env-btn').addEventListener('click', openEnv);

    load({ method: 'GET', url: '' });
    return {};
  }

  const reqs = (ctx, f) => ctx.log.filter((e) => e.type === 'request' && f(e));

  Quest.create({
    mode: 'postman',
    icon: '📮',
    title: 'API · Postman',
    buildSim,
    levels: [{
      id: 'pm-1',
      title: 'Токен и переменные окружения',
      giver: { name: 'Почтовый голем', sprite: '📮' },
      gold: 110,
      intro: 'Почтовый голем не пропускает тех, кто вбивает адреса руками и копирует токены в каждый запрос. Покажи ему, как работают коллекции, параметры и окружение.',
      outro: 'Окружение с переменными — то, что отличает аккуратного тестировщика в Postman. Дальше будут тесты и цепочки запросов.',
      steps: [
        { id: 'base', text: 'Открой запрос <b>«Список героев»</b> из коллекции и отправь его. Адрес должен использовать переменную <code>{{baseUrl}}</code>.',
          check: (c) => reqs(c, (e) => e.method === 'GET' && e.rawUrl.includes('{{baseUrl}}') && e.path === '/heroes' && e.status === 200).length > 0,
          success: '200 OK. Переменная {{baseUrl}} подставилась из окружения «Хроники · dev».' },
        { id: 'param', text: 'Через вкладку <b>Params</b> добавь параметр <code>class</code> со значением <b>Лучник</b> и отправь запрос: должны прийти только лучники.',
          check: (c) => reqs(c, (e) => e.method === 'GET' && e.path === '/heroes' && e.query.class === 'Лучник' && e.status === 200).length > 0,
          success: 'Сервер вернул двух лучников. Параметр из вкладки Params сам добавился в URL.' },
        { id: 'login', text: 'Открой <b>«Логин»</b> и получи токен: <code>POST</code> с телом в формате JSON. Учётные данные — в описании коллекции.',
          check: (c) => reqs(c, (e) => e.method === 'POST' && e.path === '/auth/login' && e.status === 200).length > 0,
          success: 'Токен получен. Копировать его в каждый запрос неудобно: сохраним его в окружение.' },
        { id: 'env', text: 'Открой <b>Переменные</b> окружения и сохрани полученный токен в переменную <code>token</code>.',
          check: (c) => c.state.env.token === M.TOKEN,
          success: 'Токен в окружении. Если он сменится, поправить придётся одну переменную, а не все запросы.' },
        { id: 'me', text: 'Открой <b>«Кто я»</b>, на вкладке <b>Authorization</b> выбери <b>Bearer Token</b> со значением <code>{{token}}</code> и получи <code>200</code>.',
          check: (c) => reqs(c, (e) => e.path === '/me' && e.status === 200 && /\{\{\s*token\s*\}\}/.test(e.rawAuth)).length > 0,
          success: '200 OK: сервер узнал тебя по токену из переменной окружения.' },
      ],
      hints: [
        'Запросы коллекции открываются по клику слева. Окружение «Хроники · dev» уже выбрано вверху справа, а кнопка <b>Переменные</b> показывает его значения.',
        'Параметр запроса добавляется во вкладке Params: Key <code>class</code>, Value <code>Лучник</code>. Для логина выбери в Body режим raw и впиши JSON с полями <code>login</code> и <code>password</code>. Токен из ответа скопируй в Current value переменной <code>token</code> и нажми Save.',
        'Тело логина: <code>{"login": "mage", "password": "chronicles"}</code>. Токен: <code>tok_7f3a9c21</code>. В «Кто я» на вкладке Authorization: Type = Bearer Token, Token = <code>{{token}}</code>.',
      ],
    }],
  });
})();
