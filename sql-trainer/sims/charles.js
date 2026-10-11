// Симулятор Charles Proxy: телефон с приложением «Лавка зелий» и окно Charles с перехваченным трафиком.
(function () {
  'use strict';

  const Core = window.Core;
  const esc = Core.esc;
  const API = 'api.potions.shop';

  const CATALOG = {
    currency: 'coins',
    items: [
      { id: 1, name: 'Зелье лечения', price: 45 },
      { id: 2, name: 'Эликсир маны', price: 120 },
      { id: 3, name: 'Настой невидимости', price: 300 },
    ],
  };

  // Трафик, который приложение отправляет при каждом обновлении каталога.
  function traffic() {
    return [
      { host: API, method: 'GET', path: '/v2/catalog', status: 200, type: 'application/json', reqHeaders: { 'User-Agent': 'PotionShop/3.4 (Android 14)', Accept: 'application/json', Authorization: 'Bearer eyJhbGciOi…' }, body: JSON.stringify(CATALOG, null, 2), main: true },
      { host: 'analytics.potions.shop', method: 'POST', path: '/v1/events', status: 204, type: 'text/plain', reqHeaders: { 'Content-Type': 'application/json' }, reqBody: '{"event":"catalog_open","ts":1791727000}', body: '' },
      { host: 'cdn.potions.shop', method: 'GET', path: '/img/mana.png', status: 200, type: 'image/png', reqHeaders: { Accept: 'image/*' }, body: '[image/png · 4.2 KB]' },
    ];
  }

  function buildSim(el, ctx) {
    const st = ctx.state;
    st.ssl = new Set();
    st.breakpoints = new Set();
    let recording = true;
    let entries = [];
    let seq = 0;
    let selected = null;
    let detailTab = 'overview';
    let filter = '';
    let appScreen = 'idle';
    let appItems = [];

    el.innerHTML = `
      <div class="charles-wrap">
        <div class="phone" aria-label="Телефон с приложением">
          <div class="phone-notch"></div>
          <div class="phone-screen"></div>
        </div>
        <div class="charles">
          <div class="ch-title">Charles 4.6 — Session 1 *</div>
          <div class="ch-toolbar">
            <button type="button" class="ch-rec on" title="Запись трафика">● Record</button>
            <button type="button" class="ch-clear" title="Очистить сессию">🧹 Clear</button>
            <button type="button" class="ch-ssl-settings">🔐 SSL Proxying…</button>
            <span class="ch-bp-status"></span>
            <input class="ch-filter" type="search" placeholder="Filter" aria-label="Фильтр запросов">
          </div>
          <div class="ch-main">
            <div class="ch-seq"><table><thead><tr><th>#</th><th>Code</th><th>Method</th><th>Host</th><th>Path</th><th>Duration</th><th>Size</th></tr></thead><tbody></tbody></table></div>
            <div class="ch-detail"><p class="ch-empty">Выбери запрос в списке.</p></div>
          </div>
        </div>
      </div>`;
    const $ = (s) => el.querySelector(s);

    // ---------- приложение на телефоне ----------
    function renderApp() {
      const scr = $('.phone-screen');
      const head = '<div class="app-head">🧪 Лавка зелий</div>';
      if (appScreen === 'idle') scr.innerHTML = head + '<div class="app-empty"><p>Каталог ещё не загружен.</p><button type="button" class="app-btn" data-refresh>Обновить каталог</button></div>';
      else if (appScreen === 'loading') scr.innerHTML = head + '<div class="app-empty"><div class="spinner"></div><p>Загрузка…</p></div>';
      else if (appScreen === 'error') scr.innerHTML = head + '<div class="app-empty app-error"><p class="app-err-icon">⚠️</p><p>Не удалось загрузить каталог.<br>Попробуйте позже.</p><button type="button" class="app-btn" data-refresh>Повторить</button></div>';
      else {
        // Баг приложения: цена обрезается до двух цифр.
        scr.innerHTML = head + `<ul class="app-list">${appItems.map((i) => `<li><span>${esc(i.name)}</span><b>${String(i.price).slice(0, 2)} 🪙</b></li>`).join('')}</ul>
          <button type="button" class="app-btn" data-refresh>Обновить каталог</button>`;
      }
      scr.querySelectorAll('[data-refresh]').forEach((b) => b.addEventListener('click', refresh));
    }

    function deliver(status, body, meta) {
      if (status >= 200 && status < 300) {
        try { appItems = JSON.parse(body).items || []; appScreen = 'list'; } catch (e) { appScreen = 'error'; }
      } else appScreen = 'error';
      renderApp();
      ctx.emit({ type: 'app', screen: appScreen, status, edited: !!meta.edited });
      ctx.emit({ type: 'response', path: '/v2/catalog', status, edited: !!meta.edited, ssl: meta.ssl, viaBreakpoint: !!meta.viaBreakpoint });
    }

    function refresh() {
      appScreen = 'loading';
      renderApp();
      ctx.emit({ type: 'refresh' });
      setTimeout(() => {
        let mainEntry = null;
        traffic().forEach((t) => {
          const ssl = st.ssl.has(t.host);
          const e = Object.assign({ id: ++seq, ssl, duration: 60 + Math.round(Math.random() * 200) }, t);
          if (recording) entries.push(e);
          if (t.main) mainEntry = e;
        });
        renderSeq();
        const bp = mainEntry.ssl && st.breakpoints.has(`${API}/v2/catalog`);
        if (bp) breakpoint(mainEntry);
        else deliver(mainEntry.status, mainEntry.body, { ssl: mainEntry.ssl });
      }, 350);
    }

    // ---------- окно Breakpoint ----------
    function breakpoint(entry) {
      let executed = false;
      Core.modal(`
        <h3>Breakpoint</h3>
        <p class="modal-tip">Charles остановил ответ на <code>https://${API}/v2/catalog</code>. Отредактируй его и нажми Execute или прерви запрос.</p>
        <div class="ch-bp-form">
          <label>Status <input id="bp-status" type="number" value="${entry.status}" min="100" max="599"></label>
          <label>Body <textarea id="bp-body" spellcheck="false">${esc(entry.body)}</textarea></label>
        </div>
        <button class="btn attack" id="modal-next" type="button">Execute</button>
        <button class="btn" id="modal-close" type="button">Abort</button>`, {
        onNext: () => {
          executed = true;
          const status = Number(document.getElementById('bp-status').value) || entry.status;
          const body = document.getElementById('bp-body').value;
          entry.status = status;
          entry.edited = status !== 200 || body !== entry.body;
          entry.body = body;
          setTimeout(() => { renderSeq(); deliver(status, body, { ssl: true, edited: entry.edited, viaBreakpoint: true }); }, 0);
        },
        onClose: () => {
          if (!executed && appScreen === 'loading') {
            entry.status = 'Failed';
            renderSeq();
            appScreen = 'error';
            renderApp();
            ctx.emit({ type: 'app', screen: 'error', aborted: true });
          }
        },
      });
    }

    // ---------- окно Charles ----------
    function renderBpStatus() {
      $('.ch-bp-status').textContent = st.breakpoints.size ? `🛑 Breakpoints: ${[...st.breakpoints].join(', ')}` : 'Breakpoints: нет';
    }

    function renderSeq() {
      const rows = entries.filter((e) => !filter || (e.host + e.path).includes(filter));
      $('.ch-seq tbody').innerHTML = rows.map((e) => {
        const m = e.ssl ? e.method : 'CONNECT';
        const path = e.ssl ? e.path : '';
        const size = e.ssl ? `${(e.body || '').length + 180} B` : '—';
        return `<tr data-id="${e.id}" class="${selected === e.id ? 'sel' : ''}${e.edited ? ' edited' : ''}${e.ssl ? '' : ' enc'}">
          <td>${e.id}</td><td>${e.ssl ? e.status : 200}</td><td>${m}</td><td>${e.host}${e.ssl ? '' : ':443'}</td><td>${esc(path)}</td><td>${e.duration} ms</td><td>${size}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="ch-empty">Трафика нет. Обнови каталог в приложении на телефоне.</td></tr>';
      el.querySelectorAll('.ch-seq tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => select(+tr.dataset.id)));
    }

    function select(id) {
      selected = id;
      const e = entries.find((x) => x.id === id);
      renderSeq();
      renderDetail();
      ctx.emit({ type: 'select', host: e.host, ssl: e.ssl, path: e.path });
    }

    function renderDetail() {
      const box = $('.ch-detail');
      const e = entries.find((x) => x.id === selected);
      if (!e) { box.innerHTML = '<p class="ch-empty">Выбери запрос в списке.</p>'; return; }
      const bpKey = `${e.host}${e.path}`;
      const actions = `<div class="ch-actions">
        ${e.ssl ? '' : `<button class="btn" type="button" data-ssl>Enable SSL Proxying для ${e.host}</button>`}
        ${e.ssl ? `<button class="btn${st.breakpoints.has(bpKey) ? ' on' : ''}" type="button" data-bp>${st.breakpoints.has(bpKey) ? '🛑 Убрать Breakpoint' : 'Breakpoints'}</button>` : ''}
      </div>`;
      let content;
      if (detailTab === 'overview') {
        content = `<table class="ch-kv">
          <tr><td>URL</td><td>https://${e.host}${e.ssl ? e.path : ''}</td></tr>
          <tr><td>Status</td><td>${e.ssl ? (e.status === 'Failed' ? 'Failed' : 'Complete') : 'Complete'}</td></tr>
          <tr><td>Response Code</td><td>${e.ssl ? e.status : '200 Connection established'}</td></tr>
          <tr><td>Method</td><td>${e.ssl ? e.method : 'CONNECT'}</td></tr>
          <tr><td>Protocol</td><td>HTTP/1.1</td></tr>
          <tr><td>TLS</td><td>${e.ssl ? 'TLSv1.3 (расшифровано Charles)' : '<b>SSL Proxying not enabled for this host.</b> Включи его, чтобы видеть содержимое.'}</td></tr>
          <tr><td>Duration</td><td>${e.duration} ms</td></tr>
          ${e.edited ? '<tr><td>Notes</td><td>Ответ изменён через Breakpoint</td></tr>' : ''}
        </table>`;
      } else if (!e.ssl) {
        content = '<p class="ch-enc">🔒 Содержимое зашифровано. Charles видит только, что приложение открыло соединение с этим хостом.</p>';
      } else {
        content = `<p class="ch-sub">Request</p><pre>${esc(`${e.method} ${e.path} HTTP/1.1\nHost: ${e.host}\n` + Object.entries(e.reqHeaders).map(([k, v]) => `${k}: ${v}`).join('\n') + (e.reqBody ? `\n\n${e.reqBody}` : ''))}</pre>
          <p class="ch-sub">Response</p><pre>${esc(`HTTP/1.1 ${e.status}\nContent-Type: ${e.type}`)}</pre>
          ${e.body ? `<pre class="ch-body">${esc(e.body)}</pre>` : '<p class="ch-empty">Тело пустое.</p>'}`;
      }
      box.innerHTML = `${actions}
        <div class="ch-tabs"><button type="button" data-t="overview" class="${detailTab === 'overview' ? 'on' : ''}">Overview</button><button type="button" data-t="contents" class="${detailTab === 'contents' ? 'on' : ''}">Contents</button></div>
        <div class="ch-pane">${content}</div>`;
      box.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => {
        detailTab = b.dataset.t;
        renderDetail();
        ctx.emit({ type: 'tab', tab: detailTab, host: e.host, ssl: e.ssl });
      }));
      const s = box.querySelector('[data-ssl]');
      if (s) s.addEventListener('click', () => toggleSsl(e.host, true));
      const b = box.querySelector('[data-bp]');
      if (b) b.addEventListener('click', () => toggleBp(bpKey));
    }

    function toggleSsl(host, on) {
      if (on) st.ssl.add(host); else st.ssl.delete(host);
      renderDetail();
      ctx.emit({ type: 'ssl', host, on });
    }

    function toggleBp(key) {
      if (st.breakpoints.has(key)) st.breakpoints.delete(key); else st.breakpoints.add(key);
      renderBpStatus();
      renderDetail();
      ctx.emit({ type: 'breakpoint', key, on: st.breakpoints.has(key) });
    }

    $('.ch-rec').addEventListener('click', (e) => { recording = !recording; e.target.classList.toggle('on', recording); e.target.textContent = recording ? '● Record' : '○ Record'; });
    $('.ch-clear').addEventListener('click', () => { entries = []; selected = null; renderSeq(); renderDetail(); });
    $('.ch-filter').addEventListener('input', (e) => { filter = e.target.value.trim(); renderSeq(); });
    $('.ch-ssl-settings').addEventListener('click', () => {
      const hosts = [...new Set(entries.map((e) => e.host))];
      Core.modal(`
        <h3>SSL Proxying Settings</h3>
        <p class="modal-tip">Charles расшифровывает HTTPS только для отмеченных хостов. На телефоне должен быть установлен сертификат Charles — здесь он уже стоит.</p>
        <div class="ch-ssl-list">${hosts.length ? hosts.map((h) => `<label><input type="checkbox" data-host="${h}" ${st.ssl.has(h) ? 'checked' : ''}> ${h}:443</label>`).join('') : '<p>Хостов пока нет: сначала поймай трафик.</p>'}</div>
        <button class="btn attack" id="modal-next" type="button">OK</button>
        <button class="btn" id="modal-close" type="button">Cancel</button>`, {
        onNext: () => {
          const changes = [...document.querySelectorAll('[data-host]')].map((i) => [i.dataset.host, i.checked]);
          setTimeout(() => changes.forEach(([h, on]) => { if (st.ssl.has(h) !== on) toggleSsl(h, on); }), 0);
        },
      });
    });

    renderApp();
    renderSeq();
    renderBpStatus();
    return {};
  }

  const has = (c, type, f) => c.log.some((e) => e.type === type && (!f || f(e)));
  const lastOf = (c, type, f) => c.log.filter((e) => e.type === type && (!f || f(e))).pop();

  Quest.create({
    mode: 'charles',
    icon: '🕸️',
    title: 'API · Charles Proxy',
    buildSim,
    levels: [{
      id: 'ch-1',
      title: 'Чей это баг: приложения или сервера?',
      giver: { name: 'Паук-перехватчик', sprite: '🕸️' },
      gold: 100,
      intro: 'Пользователи жалуются: в «Лавке зелий» Эликсир маны стоит 12 монет, а на кассе списывают 120. Паук-перехватчик сидит между телефоном и сервером и видит всё, что они говорят друг другу. Научись видеть так же.',
      outro: 'Ты локализовал баг на стороне приложения и проверил, как оно переживает ошибку сервера. Это и есть ежедневная работа с Charles.',
      steps: [
        { id: 'catch', text: 'Нажми <b>«Обновить каталог»</b> на телефоне и выбери в Charles запрос к <code>api.potions.shop</code>.',
          check: (c) => has(c, 'select', (e) => e.host === API),
          success: 'Запрос пойман, но вместо содержимого только CONNECT: трафик зашифрован HTTPS.' },
        { id: 'ssl', text: 'Включи <b>SSL Proxying</b> для <code>api.potions.shop</code> и обнови каталог ещё раз, чтобы увидеть запрос в открытом виде.',
          check: (c) => has(c, 'response', (e) => e.ssl),
          success: 'Теперь видны метод, путь, заголовки и тело ответа: GET /v2/catalog.' },
        { id: 'price', text: 'Открой вкладку <b>Contents</b> у запроса каталога. Какую цену «Эликсира маны» на самом деле присылает сервер?',
          answer: { kind: 'text', placeholder: 'Цена из ответа сервера', accept: (v) => v.replace(/\D/g, '') === '120', wrong: 'Не то число. Найди в теле ответа элемент с name «Эликсир маны» и его price.' },
          success: 'Сервер присылает 120, а приложение показывает 12. Баг в приложении: оно обрезает цену. API тут ни при чём.' },
        { id: 'bp500', text: 'Проверь, как приложение переживёт сбой сервера: поставь <b>Breakpoint</b> на запрос каталога, обнови каталог и в окне Breakpoint замени статус на <code>500</code>.',
          check: (c) => has(c, 'response', (e) => e.viaBreakpoint && e.status >= 500),
          success: 'Приложение показало экран ошибки и кнопку «Повторить», а не упало. Это корректное поведение.' },
        { id: 'restore', text: 'Убери Breakpoint и обнови каталог: приложение должно снова получить настоящий ответ.',
          check: (c) => {
            const last = lastOf(c, 'response');
            return last && !last.viaBreakpoint && last.status === 200 && c.state.breakpoints.size === 0;
          },
          success: 'Всё вернулось как было. Не забывать снимать Breakpoints — привычка, которая экономит часы.' },
      ],
      hints: [
        'Charles показывает только тот трафик, который прошёл после нажатия «Обновить». Пока SSL Proxying выключен, HTTPS-запросы видны как CONNECT без содержимого.',
        'Выбери строку с <code>api.potions.shop:443</code> и нажми кнопку «Enable SSL Proxying». После обновления каталога появится строка <code>GET /v2/catalog</code>: у неё есть вкладка Contents и кнопка Breakpoints.',
        'Порядок: «Обновить» → выбрать строку api.potions.shop → Enable SSL Proxying → «Обновить» → Contents: price = <b>120</b> → Breakpoints → «Обновить» → Status = 500, Execute → «Убрать Breakpoint» → «Обновить».',
      ],
    }],
  });
})();
