// Режим «Осада»: орки штурмуют башню. Включается кнопкой-катапультой на главном экране на выбранное время
// (от 5 минут до 6 часов). Пока осада идёт: башня горит (Town-battle.jpeg), открыт только зал шара — режим «Осада»,
// играет Battle2, в меню тикает красный таймер, Архимаг говорит только об обороне.
// В зале шара бой начинается сразу. Бои идут по кругу типов: SQL → Блиц → тест-дизайн/UX → API (мини-Postman),
// а задание внутри типа — случайное из тех, что в этой осаде ещё не встречались (siege-data.js, siege-postman.js).
// Без монстров и трофеев, но враги бьют: удар раз в 10 секунд и за каждую ошибку. Награда — золото.
(function () {
  'use strict';

  const Core = window.Core;
  const esc = Core.esc;
  const $ = (id) => document.getElementById(id);
  const ANSWER_MANA = 12;
  const TICK_MS = 10000;
  const MANA_REGEN = 4;
  const DURATIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 360];
  const ALLOWED = ['home', 'siege', 'shop', 'focus']; // куда можно ходить во время осады
  const ORDER = ['sql', 'blitz', 'design', 'postman'];
  const TYPE_NAME = { sql: 'SQL', blitz: 'Блиц', design: 'Тест-дизайн и UX', postman: 'API · Postman' };
  const SIEGE_ICON = 'Avatars/Icon_Battle_5.jpeg';
  const GOLD = { sql: 35, blitz: 20, design: 30, postman: 45 };

  const battleOf = (type) => ((window.SIEGE && window.SIEGE.battles) || []).find((b) => b.type === type);
  const poolOf = (type) => (type === 'postman' ? window.SIEGE_PM || [] : (battleOf(type) || { tasks: [] }).tasks);
  const S = () => Core.state.siege || null;
  const active = () => { const s = S(); return !!(s && s.until > Date.now()); };
  const stats = () => { const st = Core.state; if (!st.siegeStats) st.siegeStats = { wins: 0 }; return st.siegeStats; };
  const left = () => { const s = S(); return s ? Math.max(0, s.until - Date.now()) : 0; };
  const clock = (ms) => { const t = Math.ceil(ms / 1000); const h = Math.floor(t / 3600); const m = Math.floor(t / 60) % 60; const s = t % 60; return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`; };
  const durText = (m) => (m < 60 ? `${m} мин` : `${m / 60} ч`.replace('.5', ',5'));
  const tickDmg = () => Math.max(2, Math.round(Core.maxHp() * 0.04));
  const hitDmg = () => Math.max(5, Math.round(Core.maxHp() * 0.12));
  const shuffle = (a) => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

  // ---------- начало и конец осады ----------
  function start(minutes) {
    Core.state.siege = { started: Date.now(), until: Date.now() + minutes * 60000, minutes, wins: 0, turn: 0, seen: {} };
    fight = null;
    Core.save();
    renderLaunch();
    if (window.Town) window.Town.render();
    Core.go('siege');
  }

  function finish(early) {
    const s = S();
    if (!s) return;
    Core.state.siege = null;
    fight = null;
    Core.save();
    renderLaunch();
    Core.go('home');
    Core.modal(`<div class="big"><img class="siege-modal-icon" src="${SIEGE_ICON}" alt=""></div>
      <h3>${early ? 'Осада снята досрочно' : 'Осада окончена'}</h3>
      <ul class="loot"><li><span>Выиграно боёв</span><span>${s.wins || 0}</span></li><li><span>Длительность</span><span>${durText(s.minutes)}</span></li></ul>
      <p class="modal-tip">${s.wins ? 'Орки отброшены от стен, маги восстанавливают башню.' : 'В этот раз орки отступили сами. В следующую осаду — в бой!'}</p>
      <button class="btn attack" id="modal-close" type="button">В башню</button>`);
  }

  function chooseDuration() {
    const close = Core.modal(`<div class="siege-start"><img class="siege-modal-icon" src="${SIEGE_ICON}" alt="">
      <h3>Орки у стен башни!</h3>
      <p>Пока идёт осада, в башне открыт только зал шара: маги через шар отбивают штурм — бой за боем: SQL, Блиц, тест-дизайн и API. Все остальные залы закрыты до конца осады.</p>
      <label class="siege-dur">Сколько держать оборону
        <select id="siege-minutes">${DURATIONS.map((m) => `<option value="${m}" ${m === 60 ? 'selected' : ''}>${durText(m)}</option>`).join('')}</select></label>
      <button class="btn attack" type="button" id="siege-go">⚔ Начать осаду</button>
      <button class="btn" id="modal-close" type="button">Не сейчас</button></div>`);
    $('siege-go').addEventListener('click', () => { const m = +$('siege-minutes').value; close(); start(m); });
  }

  function launchClick() {
    if (!active()) return chooseDuration();
    const close = Core.modal(`<div class="siege-start"><img class="siege-modal-icon" src="${SIEGE_ICON}" alt="">
      <h3>Осада идёт</h3><p class="siege-red">До конца: ${clock(left())}</p><p>Выиграно боёв: ${S().wins || 0}</p>
      <button class="btn attack" type="button" id="siege-hall">В зал шара</button>
      <button class="btn" type="button" id="siege-stop">Снять осаду досрочно</button>
      <button class="ghost-btn" id="modal-close" type="button">Закрыть</button></div>`);
    $('siege-hall').addEventListener('click', () => { close(); Core.go('siege'); });
    $('siege-stop').addEventListener('click', () => { if (window.confirm('Снять осаду досрочно?')) { close(); finish(true); } });
  }

  // кнопка-катапульта и красный таймер на главном экране
  function renderLaunch() {
    const on = active();
    const img = $('siege-btn-img');
    if (img) img.src = on ? 'Avatars/Botton-battle-active.jpeg' : 'Avatars/Botton-battle.jpeg';
    const btn = $('siege-btn');
    if (btn) btn.classList.toggle('on', on);
    const t = $('siege-timer');
    if (t) { t.hidden = !on; t.textContent = on ? clock(left()) : ''; }
  }

  // ---------- выбор боя: тип по кругу, задание — случайное из ещё не встречавшихся ----------
  function prepare(type, t) {
    if (type === 'blitz') { const options = shuffle(t.a); return Object.assign({}, t, { options, right: options.indexOf(t.a[0]) }); }
    if (type === 'design') {
      const order = shuffle(t.options.map((_, i) => i));
      return Object.assign({}, t, { options: order.map((i) => t.options[i]), right: t.right.map((r) => order.indexOf(r)) });
    }
    return t;
  }

  let fight = null; // { type, index, task, wounds, mistakes, note, noteCls, draft, last, picked, pm }
  function nextFight() {
    const s = S();
    if (!s.seen) s.seen = {};
    let type = null;
    let pool = [];
    for (let k = 0; k < ORDER.length; k++) {
      type = ORDER[(s.turn || 0) % ORDER.length];
      pool = poolOf(type);
      if (pool.length) break;
      s.turn = (s.turn || 0) + 1;
    }
    let seen = s.seen[type] || [];
    if (seen.length >= pool.length) seen = []; // все задания этого типа уже были — круг заново
    const free = pool.map((_, i) => i).filter((i) => !seen.includes(i));
    const index = free[Math.floor(Math.random() * free.length)];
    s.seen[type] = seen.concat(index);
    s.turn = (s.turn || 0) + 1;
    fight = { type, index, task: prepare(type, pool[index]), wounds: 0, mistakes: 0, note: '', noteCls: '', draft: '', last: null, picked: [] };
    if (type === 'postman') fight.pm = newPm(fight.task);
    Core.save();
  }

  // ---------- мини-Postman ----------
  function newPm(t) {
    return {
      api: window.MockApi.create({ bugs: t.bugs || {} }),
      method: 'GET', url: '{{baseUrl}}/', params: [{ key: '', value: '', on: true }],
      auth: { type: 'none', token: '' }, headers: [{ key: '', value: '', on: true }],
      body: '', tests: '', tab: 'params', resTab: 'body', env: t.env.map((x) => Object.assign({}, x)), envOpen: false,
      history: [], answer: '',
    };
  }
  const PM_TABS = [['params', 'Params'], ['auth', 'Authorization'], ['headers', 'Headers'], ['body', 'Body'], ['tests', 'Tests']];
  const SNIPPETS = [
    ['Статус 200', 'pm.test("Статус 200", () => pm.response.to.have.status(200));'],
    ['Поле в JSON', 'pm.test("Есть поле id", () => pm.expect(pm.response.json()).to.have.property("id"));'],
    ['Сохранить токен', 'pm.environment.set("token", pm.response.json().token);'],
    ['Заголовок ответа', 'pm.test("Есть X-Total-Count", () => pm.response.to.have.header("X-Total-Count"));'],
  ];

  // URL ↔ Params: таблица параметров собирает строку запроса, правка URL пересобирает таблицу
  function urlFromParams(pm) {
    const base = pm.url.split('?')[0];
    const qs = pm.params.filter((p) => p.on && p.key).map((p) => `${p.key}=${p.value}`).join('&');
    pm.url = qs ? `${base}?${qs}` : base;
  }
  function paramsFromUrl(pm) {
    const i = pm.url.indexOf('?');
    const list = i < 0 ? [] : pm.url.slice(i + 1).split('&').filter(Boolean).map((kv) => { const j = kv.indexOf('='); return { key: j < 0 ? kv : kv.slice(0, j), value: j < 0 ? '' : kv.slice(j + 1), on: true }; });
    pm.params = list.concat({ key: '', value: '', on: true });
  }

  const kvRows = (list, kind) => `<div class="pm-kv">${list.map((r, i) => `<div class="pm-kv-row">
      <input type="checkbox" data-kv-on="${kind}:${i}" ${r.on ? 'checked' : ''} aria-label="Включить">
      <input type="text" data-kv="${kind}:${i}:key" value="${esc(r.key)}" placeholder="Key">
      <input type="text" data-kv="${kind}:${i}:value" value="${esc(r.value)}" placeholder="Value">
      <button type="button" class="ghost-btn" data-kv-del="${kind}:${i}" aria-label="Удалить строку">✕</button></div>`).join('')}</div>`;

  function pmTabHtml(pm) {
    if (pm.tab === 'params') return `<p class="pm-note">Query Params — собираются в URL автоматически.</p>${kvRows(pm.params, 'params')}`;
    if (pm.tab === 'headers') return `<p class="pm-note">Content-Type: application/json добавляется сам, если есть тело.</p>${kvRows(pm.headers, 'headers')}`;
    if (pm.tab === 'auth') {
      return `<div class="pm-auth"><label>Type <select data-auth-type>
          <option value="none" ${pm.auth.type === 'none' ? 'selected' : ''}>No Auth</option>
          <option value="bearer" ${pm.auth.type === 'bearer' ? 'selected' : ''}>Bearer Token</option></select></label>
        ${pm.auth.type === 'bearer' ? `<label>Token <input type="text" data-auth-token value="${esc(pm.auth.token)}" placeholder="{{token}}"></label>` : '<p class="pm-note">Запрос уйдёт без авторизации.</p>'}</div>`;
    }
    if (pm.tab === 'body') return `<p class="pm-note">raw · JSON</p><textarea class="pm-code" data-pm-body spellcheck="false" placeholder='{ "name": "…" }'>${esc(pm.body)}</textarea>`;
    return `<p class="pm-note">Tests — JavaScript после ответа: <code>pm.test</code>, <code>pm.expect</code>, <code>pm.environment.set</code>.</p>
      <div class="pm-snips">${SNIPPETS.map(([n], i) => `<button type="button" class="ghost-btn" data-snip="${i}">+ ${esc(n)}</button>`).join('')}</div>
      <textarea class="pm-code" data-pm-tests spellcheck="false" placeholder="// pm.test(...)">${esc(pm.tests)}</textarea>`;
  }

  function pmResHtml(pm) {
    const e = pm.history[pm.history.length - 1];
    if (!e) return '<p class="http-empty">Нажми Send — ответ сервера появится здесь.</p>';
    if (e.res.networkError) return `<pre class="http-res bad">Could not send request: ${esc(e.res.networkError)}</pre>`;
    const tabs = [['body', 'Body'], ['headers', 'Headers'], ['tests', `Test Results${e.tests.length ? ` (${e.tests.filter((t) => t.pass).length}/${e.tests.length})` : ''}`]];
    let inner;
    if (pm.resTab === 'headers') inner = `<table class="pm-htable">${Object.entries(e.res.headers).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
    else if (pm.resTab === 'tests') {
      inner = e.testError ? `<pre class="http-res bad">${esc(e.testError)}</pre>` : '';
      inner += e.tests.length ? `<ul class="pm-tests">${e.tests.map((t) => `<li class="${t.pass ? 'pass' : 'fail'}"><b>${t.pass ? 'PASS' : 'FAIL'}</b> ${esc(t.name)}${t.error ? ` <small>${esc(t.error)}</small>` : ''}</li>`).join('')}</ul>` : (inner ? '' : '<p class="http-empty">Тестов нет — напиши их во вкладке Tests.</p>');
    } else inner = `<pre class="http-res">${esc(e.res.body || '')}</pre>`;
    return `<div class="pm-status"><span class="${e.res.status < 300 ? 'ok' : 'bad'}">${e.res.status} ${esc(e.res.statusText || '')}</span><span>${e.res.time} ms</span></div>
      <div class="pm-tabs">${tabs.map(([k, n]) => `<button type="button" class="${pm.resTab === k ? 'on' : ''}" data-res-tab="${k}">${n}</button>`).join('')}</div>${inner}`;
  }

  function pmHtml() {
    const t = fight.task;
    const pm = fight.pm;
    return `<p class="eyebrow">Штурм стены · задание тестировщика</p><p class="blitz-text pm-q">${t.q}</p>
      <div class="pm-app">
        <div class="pm-env"><span>Environment: <b>Осада</b></span><button type="button" class="ghost-btn" data-env>👁 Переменные</button></div>
        ${pm.envOpen ? `<table class="pm-htable pm-envtable">${pm.env.map((v) => `<tr><th>${esc(v.key)}</th><td>${esc(v.value === '' ? '—' : String(v.value))}</td></tr>`).join('')}</table>` : ''}
        <div class="pm-bar">
          <select data-pm-method aria-label="Метод">${['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => `<option ${pm.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
          <input type="text" data-pm-url value="${esc(pm.url)}" spellcheck="false" aria-label="URL">
          <button type="button" class="btn attack" data-pm-send>Send</button>
        </div>
        <div class="pm-tabs">${PM_TABS.map(([k, n]) => `<button type="button" class="${pm.tab === k ? 'on' : ''}" data-pm-tab="${k}">${n}${k === 'params' && pm.params.some((p) => p.key) ? ' •' : ''}${k === 'tests' && pm.tests.trim() ? ' •' : ''}</button>`).join('')}</div>
        <div class="pm-pane">${pmTabHtml(pm)}</div>
        <p class="eyebrow">Response</p>
        <div class="pm-res">${pmResHtml(pm)}</div>
      </div>
      <div class="pm-submit">${t.answerLabel ? `<label>Ответ: <input type="text" data-pm-answer value="${esc(pm.answer)}" placeholder="${esc(t.answerLabel)}"></label>` : ''}
        <button type="button" class="btn attack" data-pm-check>⚔ Сдать задание</button><span class="http-keys">Send — бесплатно, сдача стоит ${ANSWER_MANA} маны</span></div>`;
  }

  function pmSend() {
    const pm = fight.pm;
    const sc = { env: pm.env, envName: 'Осада', coll: [], glob: [] };
    const run = { local: [], data: {} };
    const R = (s) => window.PmSandbox.resolve(s, run, sc);
    let url = R(pm.url.trim());
    if (url.startsWith('/')) url = 'https://api.chronicles.guild/v1' + url;
    const headers = {};
    pm.headers.filter((h) => h.on && h.key).forEach((h) => { headers[h.key] = R(h.value); });
    if (pm.auth.type === 'bearer') headers.Authorization = `Bearer ${R(pm.auth.token)}`;
    const body = ['GET', 'DELETE'].includes(pm.method) ? '' : R(pm.body.trim());
    if (body && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
    let res = pm.api.handle({ method: pm.method, url, headers, body });
    if (res.networkError) res = { networkError: res.networkError, headers: {}, status: 0 };
    let json = null;
    try { json = res.body ? JSON.parse(res.body) : null; } catch (e) { json = null; }
    let reqJson = null;
    try { reqJson = body ? JSON.parse(body) : null; } catch (e) { reqJson = null; }
    const rec = { tests: [], logs: [], varChanges: [], preHeaders: [], headers, url };
    let testError = '';
    if (!res.networkError && pm.tests.trim()) {
      const resp = { code: res.status, status: res.statusText, headers: res.headers, body: res.body, time: res.time };
      testError = window.PmSandbox.runScript(pm.tests, { kind: 'test', r: { id: 'siege', name: 'Осада', method: pm.method, url: pm.url, headers: [], body: { mode: 'raw', raw: body } }, run, rec, scopes: sc, response: resp, iterationCount: 1 }).error;
    }
    let parsed;
    try { parsed = new URL(url); } catch (e) { parsed = new URL('https://invalid.local/'); }
    pm.history.push({
      method: pm.method, url: parsed, rawUrl: pm.url,
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
      raw: { auth: pm.auth.type === 'bearer' ? pm.auth.token : '', headers: pm.headers.map((h) => `${h.key}: ${h.value}`).join('\n') },
      body, json: reqJson, res: Object.assign({}, res, { json }), tests: rec.tests, testsCode: pm.tests, testError,
    });
    pm.resTab = rec.tests.length || testError ? 'tests' : 'body';
    renderTask();
  }

  function bindPm(box) {
    const pm = fight.pm;
    const on = (sel, ev, fn) => box.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, (e) => fn(el, e)));
    on('[data-pm-method]', 'change', (el) => { pm.method = el.value; });
    on('[data-pm-url]', 'input', (el) => { pm.url = el.value; paramsFromUrl(pm); });
    on('[data-pm-url]', 'keydown', (el, e) => { if (e.key === 'Enter') pmSend(); });
    on('[data-pm-send]', 'click', () => pmSend());
    on('[data-pm-tab]', 'click', (el) => { pm.tab = el.dataset.pmTab; renderTask(); });
    on('[data-res-tab]', 'click', (el) => { pm.resTab = el.dataset.resTab; renderTask(); });
    on('[data-env]', 'click', () => { pm.envOpen = !pm.envOpen; renderTask(); });
    on('[data-kv]', 'input', (el) => {
      const [kind, i, f] = el.dataset.kv.split(':');
      const list = pm[kind];
      list[+i][f] = el.value;
      if (kind === 'params') { urlFromParams(pm); box.querySelector('[data-pm-url]').value = pm.url; }
      // начал заполнять последнюю строку — снизу появляется новая пустая, как в Postman
      if (+i === list.length - 1 && el.value) { list.push({ key: '', value: '', on: true }); renderTask(); focusKv(kind, i, f); }
    });
    on('[data-kv-on]', 'change', (el) => { const [kind, i] = el.dataset.kvOn.split(':'); pm[kind][+i].on = el.checked; if (kind === 'params') urlFromParams(pm); renderTask(); });
    on('[data-kv-del]', 'click', (el) => {
      const [kind, i] = el.dataset.kvDel.split(':');
      pm[kind].splice(+i, 1);
      if (!pm[kind].length || pm[kind][pm[kind].length - 1].key) pm[kind].push({ key: '', value: '', on: true });
      if (kind === 'params') urlFromParams(pm);
      renderTask();
    });
    on('[data-auth-type]', 'change', (el) => { pm.auth.type = el.value; renderTask(); });
    on('[data-auth-token]', 'input', (el) => { pm.auth.token = el.value; });
    on('[data-pm-body]', 'input', (el) => { pm.body = el.value; });
    on('[data-pm-tests]', 'input', (el) => { pm.tests = el.value; });
    on('[data-snip]', 'click', (el) => { pm.tests = (pm.tests.trim() ? pm.tests.trimEnd() + '\n' : '') + SNIPPETS[+el.dataset.snip][1]; renderTask(); });
    on('[data-pm-answer]', 'input', (el) => { pm.answer = el.value; });
    on('[data-pm-check]', 'click', () => answer());
  }
  function focusKv(kind, i, f) {
    const el = screen.querySelector(`[data-kv="${kind}:${i}:${f}"]`);
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }

  // ---------- экран боя ----------
  const screen = document.querySelector('.screen[data-screen="siege"]');

  function arenaHtml() {
    const b = battleOf(fight.type) || {};
    const s = S();
    return `<img class="siege-enemy" src="${b.icon || SIEGE_ICON}" alt="">
      <p class="monster-floor">${esc(TYPE_NAME[fight.type])} · бой ${s.turn} · побед ${s.wins || 0}</p>
      <h2 class="monster-name">${esc(b.enemy || 'Орки')}</h2>
      <div class="monster-meta">${esc(b.name || '')} · бьют на ${tickDmg()} каждые 10 с и на ${hitDmg()} за ошибку · ответ стоит ${ANSWER_MANA} маны</div>
      <div class="player-bars">
        <div><span>❤ Ты <b>${Core.state.hp} / ${Core.maxHp()}</b></span><div class="bar hp"><i style="width:${Core.state.hp / Core.maxHp() * 100}%"></i></div></div>
        <div><span>💧 Мана <b>${Math.floor(Core.state.mana)} / ${Core.maxMana()}</b></span><div class="bar mana"><i style="width:${Core.state.mana / Core.maxMana() * 100}%"></i></div></div>
      </div>
      ${fight.note ? `<p class="arena-line ${fight.noteCls || ''}">${esc(fight.note)}</p>` : ''}
      <div class="belt">${['hp', 'mana', 'scroll1', 'scroll3'].map((id) => {
        const it = window.Shop.item(id);
        const tip = id === 'scroll1' ? 'подсказка' : id === 'scroll3' ? 'готовый ответ' : it.text;
        return `<button type="button" data-use="${id}" title="${esc(it.name)}: ${esc(tip)}" ${window.Shop.count(id) ? '' : 'disabled'}>${it.icon}${id.startsWith('scroll') ? `<span class="belt-tier">${id === 'scroll1' ? 'I' : 'III'}</span>` : ''} <b>${window.Shop.count(id)}</b></button>`;
      }).join('')}<button type="button" class="belt-shop" data-shop>🧪 Лавка</button></div>`;
  }

  function table(res) {
    if (!res || !res.columns || !res.columns.length) return '<p class="http-empty">Пусто.</p>';
    const rows = res.values.slice(0, 50);
    return `<div class="siege-table"><table><thead><tr>${res.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${v === null ? '<i>NULL</i>' : esc(String(v))}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${res.values.length > 50 ? `<p class="http-empty">…и ещё ${res.values.length - 50} строк</p>` : ''}</div>`;
  }

  function taskHtml() {
    const t = fight.task;
    const f = fight;
    if (f.type === 'postman') return pmHtml();
    if (f.type === 'sql') {
      return `<p class="eyebrow">Катапульты · SQL</p><p class="blitz-text">${t.task}</p>${t.tables ? `<p class="http-empty">Таблицы: ${t.tables.map((x) => `<code>${esc(x)}</code>`).join(', ')}</p>` : ''}
        <textarea class="http-editor" data-editor spellcheck="false" placeholder="SELECT …">${esc(f.draft)}</textarea>
        <div class="http-actions"><button class="btn" type="button" data-scout>Разведать</button><button class="btn attack" type="button" data-send>⚔ Атаковать</button>
          <span class="http-keys"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> — атака</span></div>
        ${f.last ? (f.last.error ? `<pre class="http-res bad">${esc(f.last.error)}</pre>` : `<p class="eyebrow">${esc(f.last.label)}</p>${table(f.last.res)}`) : ''}`;
    }
    if (f.type === 'blitz') {
      return `<p class="eyebrow">Вожак · Блиц</p><p class="blitz-text">${esc(t.q)}</p>
        <div class="blitz-options">${t.options.map((o, i) => `<button type="button" class="blitz-opt" data-opt="${i}">${esc(o)}</button>`).join('')}</div>`;
    }
    return `<p class="eyebrow">Лагерь · тест-дизайн и UX</p><p class="blitz-text">${esc(t.q)}</p>
      ${t.mock ? `<div class="siege-mock" aria-label="Макет интерфейса">${t.mock}</div>` : ''}
      ${t.multi ? '<p class="http-empty">Отметь все верные варианты и нажми «Ответить».</p>' : ''}
      <div class="blitz-options">${t.options.map((o, i) => t.multi
        ? `<label class="blitz-opt siege-check"><input type="checkbox" data-pick="${i}" ${f.picked.includes(i) ? 'checked' : ''}> ${esc(o)}</label>`
        : `<button type="button" class="blitz-opt" data-opt="${i}">${esc(o)}</button>`).join('')}</div>
      ${t.multi ? '<button class="btn attack" type="button" data-multi>⚔ Ответить</button>' : ''}`;
  }

  function render() {
    if (!active()) { screen.innerHTML = ''; return; }
    if (!fight) nextFight();
    screen.innerHTML = `<div class="siege-head">
        <button class="ghost-btn" type="button" data-back>← В башню</button>
        <h2 class="sim-title"><img class="siege-head-icon" src="${SIEGE_ICON}" alt=""> Осада башни</h2>
        <span class="siege-red siege-clock" data-clock>⏳ ${clock(left())}</span></div>
      <div class="blitz-board siege-board${fight.type === 'postman' ? ' siege-wide' : ''}">
        <section class="panel arena siege-arena">${arenaHtml()}</section>
        <section class="panel blitz-q siege-task">${taskHtml()}</section>
      </div>`;
    screen.querySelector('[data-back]').addEventListener('click', () => Core.go('home'));
    bindArena();
    bindTask();
  }

  function renderArena() {
    const box = screen.querySelector('.siege-arena');
    if (!box) return;
    box.innerHTML = arenaHtml();
    bindArena();
  }
  function renderTask() {
    const box = screen.querySelector('.siege-task');
    if (!box) return render();
    box.innerHTML = taskHtml();
    bindTask();
  }

  function bindArena() {
    const shop = screen.querySelector('[data-shop]');
    if (shop) shop.addEventListener('click', () => Core.go('shop'));
    screen.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => useItem(b.dataset.use)));
  }

  function bindTask() {
    const box = screen.querySelector('.siege-task');
    if (fight.type === 'postman') return bindPm(box);
    const ed = box.querySelector('[data-editor]');
    if (ed) {
      ed.addEventListener('input', () => { fight.draft = ed.value; });
      ed.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); answer(); } });
    }
    const send = box.querySelector('[data-send]');
    if (send) send.addEventListener('click', () => answer());
    const scout = box.querySelector('[data-scout]');
    if (scout) scout.addEventListener('click', doScout);
    box.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => answer(+b.dataset.opt)));
    box.querySelectorAll('[data-pick]').forEach((c) => c.addEventListener('change', () => {
      fight.picked = [...box.querySelectorAll('[data-pick]:checked')].map((x) => +x.dataset.pick);
    }));
    const multi = box.querySelector('[data-multi]');
    if (multi) multi.addEventListener('click', () => answer(fight.picked.slice()));
  }

  const roomOf = () => ({ id: `siege-sql-${fight.index}`, kind: 'query', solution: fight.task.solution, ordered: !!fight.task.ordered, tables: fight.task.tables || [] });
  const judge = () => window.Dungeon && window.Dungeon.judge;

  function doScout() {
    const j = judge();
    if (!j) { fight.note = 'Хроники ещё загружаются — попробуй через секунду.'; fight.noteCls = ''; return renderArena(); }
    const r = j.scout(roomOf(), fight.draft);
    fight.last = { res: r.res, error: r.error, label: 'разведка (бесплатно)' };
    renderTask();
  }

  // Проверка ответа: { ok, why } или { soft } — подсказка без урона и без траты маны
  function check(input) {
    const t = fight.task;
    if (fight.type === 'blitz') return { ok: input === t.right, why: 'Неверно.' };
    if (fight.type === 'design') {
      if (!t.multi) return { ok: input === t.right[0], why: 'Неверно.' };
      if (!input.length) return { soft: 'Отметь хотя бы один вариант.' };
      return { ok: t.right.slice().sort().join(',') === input.slice().sort().join(','), why: `Не совсем: верных вариантов ${t.right.length}, проверь ещё раз.` };
    }
    if (fight.type === 'postman') {
      if (!fight.pm.history.length) return { soft: 'Сначала отправь запрос (Send) — это бесплатно.' };
      const r = t.check({ history: fight.pm.history, env: Object.fromEntries(fight.pm.env.map((v) => [v.key, v.value])), answer: fight.pm.answer || '' });
      return r === true ? { ok: true } : { ok: false, why: r };
    }
    const j = judge();
    if (!j) return { soft: 'Хроники ещё загружаются — попробуй через секунду.' };
    if (!input.trim()) return { soft: 'Сначала напиши запрос.' };
    const ev = j.evaluate(roomOf(), input);
    fight.last = ev.error ? { error: ev.error } : { res: ev.display && ev.display.res, label: 'атака' };
    return { ok: !ev.error && ev.exact, why: ev.error ? 'Ошибка в запросе.' : (ev.notes && ev.notes[0]) || 'Результат не совпадает с заданием.' };
  }

  function answer(input) {
    const p = Core.state;
    if (input === undefined) input = fight.draft;
    const r = check(input);
    if (r.soft) { fight.note = r.soft; fight.noteCls = 'hurt'; return renderArena(); }
    if (p.mana < ANSWER_MANA) {
      fight.note = `Не хватает маны: ответ стоит ${ANSWER_MANA}, у тебя ${Math.floor(p.mana)}. Выпей зелье маны или подожди.`;
      fight.noteCls = 'hurt';
      return renderArena();
    }
    p.mana -= ANSWER_MANA;
    if (r.ok) return victory();
    fight.mistakes++;
    const t = fight.task;
    if (fight.type === 'blitz') { const right = t.options[t.right]; t.options = shuffle(t.options); t.right = t.options.indexOf(right); }
    hurt(hitDmg(), `${r.why} ${(battleOf(fight.type) || {}).enemy || 'Орки'} бьют:`);
    if (p.hp === 0) return;
    Core.save();
    renderArena();
    renderTask();
  }

  function hurt(dmg, why) {
    const p = Core.state;
    p.hp = Math.max(0, Math.min(p.hp, Core.maxHp()) - dmg);
    fight.wounds++;
    fight.note = `${why} −${dmg} HP.`;
    fight.noteCls = 'hurt';
    if (p.hp === 0) defeat();
  }

  function scrollAnswer(t) {
    if (fight.type === 'sql') return `<pre class="http-res">${esc(t.solution)}</pre>`;
    if (fight.type === 'postman') return `<pre class="http-res">${esc(t.solution)}</pre>`;
    if (fight.type === 'blitz') return `<p class="scroll-answer">Верный ответ: <b>${esc(t.options[t.right])}</b></p><p>${esc(t.why || '')}</p>`;
    return `<p class="scroll-answer">Верно: <b>${t.right.map((i) => esc(t.options[i])).join('; ')}</b></p><p>${esc(t.why || '')}</p>`;
  }

  function useItem(id) {
    if (!window.Shop.take(id)) return;
    const p = Core.state;
    const t = fight.task;
    if (id === 'hp') { p.hp = Math.min(Core.maxHp(), p.hp + Math.round(Core.maxHp() * 0.5)); fight.note = 'Зелье жизни выпито.'; }
    else if (id === 'mana') { p.mana = Math.min(Core.maxMana(), p.mana + Math.round(Core.maxMana() * 0.6)); fight.note = 'Зелье маны выпито.'; }
    fight.noteCls = '';
    Core.save();
    renderArena();
    if (!id.startsWith('scroll')) return;
    fight.mistakes++; // свиток — тоже помощь: бонуса «без ошибок» не будет
    const body = id === 'scroll1' ? `<p>${esc(t.hint || 'Подсказки нет.')}</p>` : scrollAnswer(t);
    Core.modal(`<div class="scroll-view"><p class="eyebrow">Бой на паузе</p><h3>📜 ${id === 'scroll1' ? 'Малый свиток' : 'Великий свиток'}</h3>${body}
      <button class="btn attack" id="modal-close" type="button">OK — продолжить бой</button></div>`);
  }

  function victory() {
    const b = battleOf(fight.type) || {};
    const base = GOLD[fight.type];
    const gold = base + (!fight.wounds && !fight.mistakes ? Math.round(base * 0.5) : 0);
    const extra = fight.type === 'postman' && fight.task.done ? `<p>${esc(fight.task.done)}</p>` : '';
    Core.state.gold += gold;
    S().wins = (S().wins || 0) + 1;
    stats().wins++;
    Core.track('siege-win', { type: fight.type });
    const heal = Math.min(Math.round(Core.maxHp() * 0.2), Core.maxHp() - Core.state.hp);
    Core.state.hp += heal;
    fight = null;
    nextFight();
    Core.renderHud();
    render();
    Core.modal(`<div class="big"><img class="siege-modal-icon" src="${b.icon || SIEGE_ICON}" alt=""></div><h3>Атака отбита!</h3>${extra}
      <ul class="loot"><li><span>Золото</span><span>+${gold}</span></li>${heal ? `<li><span>Передышка у стены</span><span>+${heal} HP</span></li>` : ''}</ul>
      <p class="modal-tip">Следующая волна: ${esc(TYPE_NAME[fight.type])}.</p>
      <button class="btn attack" id="modal-close" type="button">⚔ В бой</button>`);
  }

  function defeat() {
    const p = Core.state;
    const lost = Math.floor(p.gold * 0.25);
    p.gold -= lost;
    p.hp = Core.maxHp();
    p.mana = Core.maxMana();
    fight = null;
    nextFight();
    Core.renderHud();
    render();
    Core.modal(`<div class="big">🪦</div><h3>Орки прорвались</h3>
      <ul class="loot"><li class="minus"><span>Потеряно золота</span><span>−${lost}</span></li><li><span>Здоровье и мана восстановлены</span><span>${p.hp} HP</span></li></ul>
      <button class="btn attack" id="modal-close" type="button">Снова на стены</button>`, { defeat: true });
  }

  // таймер осады, удары врагов, красный таймер в меню
  setInterval(() => {
    if (!Core.ready) return;
    const s = S();
    if (s && s.until <= Date.now() && !Core.modalOpen()) return finish(false);
    renderLaunch();
    const c = screen.querySelector('[data-clock]');
    if (c) c.textContent = `⏳ ${clock(left())}`;
  }, 1000);
  setInterval(() => {
    if (Core.screen !== 'siege' || !fight || !active() || Core.modalOpen() || document.hidden || !$('auth-gate').hidden) return;
    Core.state.mana = Math.min(Core.maxMana(), (Core.state.mana || 0) + MANA_REGEN);
    hurt(tickDmg(), `${(battleOf(fight.type) || {}).enemy || 'Орки'} атакуют:`);
    if (Core.state.hp > 0) renderArena();
  }, TICK_MS);

  $('siege-btn').addEventListener('click', launchClick);

  Core.registerMode('siege', {
    icon: '🔮',
    xpOf: () => 0,
    progressOf: () => ({ done: (S() && S().wins) || 0, available: 0 }),
    open: () => { if (!active()) return Core.go('home'); render(); },
    // перерисовка не должна сбивать набранный текст: обновляем только карточку бойца
    refresh: () => { if (fight) renderArena(); else render(); },
  });

  window.Siege = {
    active,
    blocks: (screen) => active() && !ALLOWED.includes(screen),
    renderLaunch,
    _fight: () => fight, // для автотестов
  };
  renderLaunch();
})();
