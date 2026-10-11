// Симулятор Chrome DevTools: страница входа с багом и панели Elements, Console, Network.
(function () {
  'use strict';

  const Core = window.Core;
  const esc = Core.esc;

  const LOGIN_RESPONSE = { data: null, error: { code: 'INVALID_EMAIL', message: 'Email должен содержать домен, например name@guild.app' } };

  function buildSim(el, ctx) {
    const st = ctx.state;
    st.forgotVisible = false;
    let panel = 'elements';
    let netSel = null;
    let netTab = 'headers';
    let elSel = 'form';
    const consoleMsgs = [
      { level: 'info', text: 'Портал Гильдии v2.8.1 загружен', src: 'app.js:3' },
      { level: 'warn', text: 'DevTools failed to load source map: Could not load content for https://guild-portal.app/login.js.map', src: '' },
    ];
    const net = [
      { id: 1, name: 'login', method: 'GET', status: 200, type: 'document', size: '6.1 kB', time: 84, url: 'https://guild-portal.app/login' },
      { id: 2, name: 'styles.css', method: 'GET', status: 200, type: 'stylesheet', size: '12.4 kB', time: 31, url: 'https://guild-portal.app/styles.css' },
      { id: 3, name: 'login.js', method: 'GET', status: 200, type: 'script', size: '8.7 kB', time: 42, url: 'https://guild-portal.app/login.js' },
      { id: 4, name: 'logo.svg', method: 'GET', status: 200, type: 'svg+xml', size: '2.2 kB', time: 18, url: 'https://guild-portal.app/logo.svg' },
      { id: 5, name: 'config', method: 'GET', status: 200, type: 'fetch', size: '0.4 kB', time: 57, url: 'https://guild-portal.app/api/config', response: { locale: 'ru', features: { sso: false } } },
    ];
    let attempts = 0;

    // DOM страницы в виде дерева для панели Elements.
    const DOM = [
      { id: 'html', depth: 0, open: '<html lang="ru">' },
      { id: 'body', depth: 1, open: '<body>' },
      { id: 'header', depth: 2, open: '<header class="top">', inner: '…</header>' },
      { id: 'form', depth: 2, open: '<form id="login-form" novalidate>' },
      { id: 'email', depth: 3, open: '<input id="email" type="email" name="email" value="mage@guild">' },
      { id: 'pass', depth: 3, open: '<input id="password" type="password" name="password">' },
      { id: 'btn', depth: 3, open: '<button class="btn-login" type="submit">Войти</button>' },
      { id: 'forgot', depth: 3, open: '<a class="forgot-link" href="/restore" style="display: none;">Забыли пароль?</a>' },
      { id: 'formEnd', depth: 2, open: '</form>' },
    ];
    const STYLES = {
      forgot: [
        { selector: 'element.style', src: '', decls: [{ prop: 'display', value: 'none', id: 'forgot-display' }] },
        { selector: '.forgot-link', src: 'styles.css:88', decls: [{ prop: 'color', value: '#7c5cff' }, { prop: 'font-size', value: '13px' }] },
      ],
      btn: [{ selector: '.btn-login', src: 'styles.css:61', decls: [{ prop: 'background', value: '#3b5bdb' }, { prop: 'color', value: '#fff' }, { prop: 'cursor', value: 'pointer' }] }],
      email: [{ selector: 'input', src: 'styles.css:40', decls: [{ prop: 'border', value: '1px solid #ccd' }, { prop: 'padding', value: '8px 10px' }] }],
      form: [{ selector: '#login-form', src: 'styles.css:22', decls: [{ prop: 'display', value: 'grid' }, { prop: 'gap', value: '10px' }] }],
    };
    const disabled = new Set();

    el.innerHTML = `
      <div class="browser">
        <div class="br-bar"><span class="br-dots"><i></i><i></i><i></i></span><span class="br-url">🔒 https://guild-portal.app/login</span></div>
        <div class="br-page">
          <div class="pg-header">🛡️ Портал Гильдии</div>
          <form class="pg-form" onsubmit="return false">
            <label>Email<input class="pg-email" type="text" value="mage@guild"></label>
            <label>Пароль<input type="password" value="chronicles"></label>
            <button type="button" class="pg-login">Войти</button>
            <a class="pg-forgot" href="#" hidden>Забыли пароль?</a>
            <p class="pg-status" aria-live="polite"></p>
          </form>
        </div>
        <div class="devtools">
          <div class="dt-tabs" role="tablist">
            <button type="button" data-p="elements">Elements</button>
            <button type="button" data-p="console">Console <span class="dt-badge" hidden></span></button>
            <button type="button" data-p="network">Network</button>
          </div>
          <div class="dt-pane"></div>
        </div>
      </div>`;
    const $ = (s) => el.querySelector(s);

    $('.pg-login').addEventListener('click', () => {
      attempts++;
      const btn = $('.pg-login');
      btn.disabled = true;
      btn.textContent = 'Вход…';
      setTimeout(() => {
        net.push({ id: net.length + 1, name: 'login', method: 'POST', status: 200, type: 'fetch', size: '0.3 kB', time: 143, url: 'https://guild-portal.app/api/login', payload: { email: $('.pg-email').value, password: '••••••••••' }, response: LOGIN_RESPONSE, isLogin: true });
        consoleMsgs.push({ level: 'error', text: "Uncaught (in promise) TypeError: Cannot read properties of null (reading 'token')\n    at handleLogin (login.js:42:31)", src: 'login.js:42' });
        btn.disabled = false;
        btn.textContent = 'Войти';
        renderBadge();
        renderPane();
        ctx.emit({ type: 'login-click', attempts });
      }, 300);
    });

    function renderBadge() {
      const errors = consoleMsgs.filter((m) => m.level === 'error').length;
      const b = $('.dt-badge');
      b.hidden = !errors;
      b.textContent = errors;
    }

    function renderPane() {
      el.querySelectorAll('.dt-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.p === panel));
      const pane = $('.dt-pane');
      if (panel === 'console') {
        pane.innerHTML = `<div class="dt-console">${consoleMsgs.map((m) => `
          <div class="dt-msg ${m.level}"><span class="dt-ico">${m.level === 'error' ? '⛔' : m.level === 'warn' ? '⚠️' : 'ℹ️'}</span><pre>${esc(m.text)}</pre><span class="dt-src">${esc(m.src)}</span></div>`).join('')}
          <div class="dt-prompt">›</div></div>`;
      } else if (panel === 'network') {
        const sel = net.find((n) => n.id === netSel);
        pane.innerHTML = `<div class="dt-net${sel ? ' split' : ''}">
          <table class="dt-net-table"><thead><tr><th>Name</th><th>Method</th><th>Status</th><th>Type</th><th>Size</th><th>Time</th></tr></thead>
          <tbody>${net.map((n) => `<tr data-id="${n.id}" class="${n.id === netSel ? 'sel' : ''}"><td>${esc(n.name)}</td><td>${n.method}</td><td>${n.status}</td><td>${n.type}</td><td>${n.size}</td><td>${n.time} ms</td></tr>`).join('')}</tbody></table>
          ${sel ? `<div class="dt-req">
            <div class="dt-req-tabs"><button type="button" data-nt="headers">Headers</button>${sel.payload ? '<button type="button" data-nt="payload">Payload</button>' : ''}<button type="button" data-nt="response">Response</button><button type="button" data-close>✕</button></div>
            <div class="dt-req-body">${netBody(sel)}</div></div>` : ''}
        </div>`;
        pane.querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => {
          netSel = +tr.dataset.id;
          netTab = 'headers';
          renderPane();
          const n = net.find((x) => x.id === netSel);
          ctx.emit({ type: 'net-select', name: n.name, method: n.method, isLogin: !!n.isLogin });
        }));
        pane.querySelectorAll('[data-nt]').forEach((b) => {
          b.classList.toggle('on', b.dataset.nt === netTab);
          b.addEventListener('click', () => {
            netTab = b.dataset.nt;
            renderPane();
            ctx.emit({ type: 'net-tab', tab: netTab, isLogin: !!sel.isLogin });
          });
        });
        const c = pane.querySelector('[data-close]');
        if (c) c.addEventListener('click', () => { netSel = null; renderPane(); });
      } else {
        pane.innerHTML = `<div class="dt-elements">
          <div class="dt-dom">${DOM.map((n) => `<div class="dt-node${n.id === elSel ? ' sel' : ''}" data-node="${n.id}" style="padding-left:${n.depth * 14 + 6}px">${esc(n.open)}${n.inner ? esc(n.inner) : ''}</div>`).join('')}</div>
          <div class="dt-styles"><p class="dt-sub">Styles</p>${(STYLES[elSel] || [{ selector: 'element.style', src: '', decls: [] }]).map((r) => `
            <div class="dt-rule"><div class="dt-rule-head"><span>${esc(r.selector)} {</span><span class="dt-src">${esc(r.src)}</span></div>
            ${r.decls.map((d) => `<label class="dt-decl${d.id && disabled.has(d.id) ? ' off' : ''}"><input type="checkbox" ${d.id && disabled.has(d.id) ? '' : 'checked'} ${d.id ? `data-decl="${d.id}"` : 'disabled'}> ${esc(d.prop)}: <b>${esc(d.value)}</b>;</label>`).join('')}
            <div>}</div></div>`).join('')}</div>
        </div>`;
        pane.querySelectorAll('[data-node]').forEach((n) => n.addEventListener('click', () => {
          elSel = n.dataset.node;
          renderPane();
          ctx.emit({ type: 'el-select', node: elSel });
        }));
        pane.querySelectorAll('[data-decl]').forEach((c) => c.addEventListener('change', () => {
          if (c.checked) disabled.delete(c.dataset.decl); else disabled.add(c.dataset.decl);
          st.forgotVisible = disabled.has('forgot-display');
          $('.pg-forgot').hidden = !st.forgotVisible;
          renderPane();
          ctx.emit({ type: 'style', decl: c.dataset.decl, enabled: c.checked });
        }));
      }
    }

    function netBody(n) {
      if (netTab === 'payload' && n.payload) return `<p class="dt-sub">Request Payload</p><pre>${esc(JSON.stringify(n.payload, null, 2))}</pre>`;
      if (netTab === 'response') return n.response ? `<pre>${esc(JSON.stringify(n.response, null, 2))}</pre>` : '<p class="dt-sub">Ответ — файл ресурса, его содержимое здесь не показываем.</p>';
      return `<p class="dt-sub">General</p><table class="dt-kv">
        <tr><td>Request URL</td><td>${esc(n.url)}</td></tr><tr><td>Request Method</td><td>${n.method}</td></tr>
        <tr><td>Status Code</td><td><span class="dt-ok">●</span> ${n.status} OK</td></tr><tr><td>Remote Address</td><td>185.12.44.10:443</td></tr></table>
        <p class="dt-sub">Response Headers</p><table class="dt-kv"><tr><td>content-type</td><td>${n.type === 'fetch' ? 'application/json' : n.type}</td></tr></table>`;
    }

    el.querySelectorAll('.dt-tabs button').forEach((b) => b.addEventListener('click', () => {
      panel = b.dataset.p;
      renderPane();
      ctx.emit({ type: 'panel', panel, afterLogin: attempts > 0 });
    }));
    renderBadge();
    renderPane();
    return {};
  }

  const has = (c, type, f) => c.log.some((e) => e.type === type && (!f || f(e)));

  Quest.create({
    mode: 'devtools',
    icon: '🔍',
    title: 'DevTools',
    buildSim,
    levels: [{
      id: 'dt-1',
      title: 'Кнопка «Войти» ничего не делает',
      giver: { name: 'Призрак консоли', sprite: '👻' },
      gold: 100,
      intro: 'В Портале Гильдии кнопка «Войти» молчит: ни ошибки на экране, ни входа. Призрак консоли знает причину, но скажет её только тому, кто сам пройдёт по следу в DevTools.',
      outro: 'Ты нашёл корень бага, а не только его симптом. В баг-репорт пойдут статус, ответ сервера и ошибка из Console.',
      steps: [
        { id: 'console', text: 'Нажми <b>«Войти»</b> на странице и открой вкладку <b>Console</b>. Что там появилось?',
          check: (c) => has(c, 'panel', (e) => e.panel === 'console' && e.afterLogin),
          success: 'В Console ошибка: TypeError при чтении token в login.js:42. Фронтенд упал, но почему?' },
        { id: 'net', text: 'Открой <b>Network</b> и найди запрос авторизации, который ушёл после нажатия кнопки.',
          check: (c) => has(c, 'net-select', (e) => e.isLogin),
          success: 'Это POST /api/login. Статус 200 OK — вроде бы всё хорошо?' },
        { id: 'resp', text: 'Посмотри, что сервер ответил на самом деле: вкладка <b>Response</b> у этого запроса.',
          check: (c) => has(c, 'net-tab', (e) => e.isLogin && e.tab === 'response'),
          success: 'В ответе data: null и ошибка INVALID_EMAIL. Сервер вернул ошибку, но со статусом 200.' },
        { id: 'cause', text: 'Сформулируй причину для баг-репорта. Что на самом деле происходит?',
          answer: {
            kind: 'choice',
            options: [
              'Сервер упал с ошибкой 500, и вход недоступен.',
              'Сервер вернул ошибку валидации email со статусом 200, а фронтенд не обработал её и упал на чтении token.',
              'Кнопка «Войти» заблокирована атрибутом disabled.',
              'В браузере не загрузился файл login.js.',
            ],
            accept: (v) => v === 1,
            wrong: 'Сверь с фактами: какой статус в Network, что в Response и что в Console?',
          },
          success: 'Точно. Здесь два бага: сервер отдаёт ошибку со статусом 200 вместо 400, а фронтенд не показывает пользователю ошибку валидации.' },
        { id: 'style', text: 'Бонус-навык: на странице есть ссылка <b>«Забыли пароль?»</b>, но её не видно. Найди её в <b>Elements</b> и отключи мешающий стиль.',
          check: (c) => c.state.forgotVisible,
          success: 'Ссылка появилась. Так проверяют гипотезы о вёрстке прямо в браузере, не трогая код.' },
      ],
      hints: [
        'DevTools — панель под страницей. Сначала воспроизведи баг (нажми «Войти»), потом смотри Console и Network: ошибки и запросы появляются именно в момент действия.',
        'В Network интересен последний запрос <code>login</code> с методом POST. У выбранного запроса есть вкладки Headers, Payload и Response. В Elements ссылка — это узел <code>a.forgot-link</code>, её стили видны справа.',
        'Console → Network → строка POST login → вкладка Response → в ответе ошибка при статусе 200 → второй вариант ответа. Затем Elements → <code>&lt;a class="forgot-link"…&gt;</code> → сними галочку у <code>display: none</code>.',
      ],
    }],
  });
})();
