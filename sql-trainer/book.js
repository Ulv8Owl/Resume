// Книга заметок (📖 в шапке): всё, что игрок сам использовал в победных запросах, с пояснениями.
//   SQL   — каждый элемент победного запроса игрока: SELECT, *, FROM, WHERE, =, ORDER BY… (словарь — book-glossary.js);
//           важен именно написанный запрос, а не зал: пропустил первый зал — элементы всё равно попадут в книгу;
//   HTTP  — метод, путь, параметры, заголовки, тело и код ответа из победного запроса игрока;
//   Блиц  — понятия: вопрос, верный ответ и пояснение (после верного ответа).
// В сохранении — только ключи записей в порядке получения (book.sql / book.http / book.blitz) и прочитанные (book.read).
// Разворот 1 — оглавление: раздел SQL, HTTP, Блиц → переход к странице начала раздела. Дальше страницы
// раскладываются заново при каждом открытии (по фактической высоте текста), каждый раздел начинается с новой страницы,
// его название — вверху. Листание — как у настоящей книги: наведи на нижний правый (левый) уголок и нажми.
(function () {
  'use strict';

  const Core = window.Core;
  const G = window.BOOK_GLOSSARY;
  const esc = Core.esc;
  const $ = (id) => document.getElementById(id);
  const IMG = { base: 'Avatars/book.jpeg', right: 'Avatars/right_book.jpeg', left: 'Avatars/left_book.jpeg' };
  const CHAPTERS = [['sql', 'SQL', 'Элементы запросов, которые ты использовал в победах'], ['http', 'HTTP', 'Методы, параметры, заголовки и коды ответов'], ['blitz', 'Блиц', 'Понятия, на которые ты ответил верно']];

  function B() {
    const st = Core.state;
    if (!st.book || !Array.isArray(st.book.sql)) st.book = { sql: [], http: [], blitz: [], read: [], announced: [], v: 2 };
    return st.book;
  }

  // ---------- что нового в запросе ----------
  const clean = (sql) => String(sql || '').replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:[^']|'')*'/g, "''").toUpperCase();
  const sqlKeys = (sql) => { const s = clean(sql); return G.sql.filter((g) => g[4].test(s)).map((g) => 'sql:' + g[0]); };

  function httpKeys(text, status) {
    const p = window.HttpEngine && window.HttpEngine.parse(text);
    if (!p || p.error) return [];
    const out = ['http:feature:line', 'http:method:' + p.method];
    const path = p.url.pathname;
    if (/^\/v2\//.test(path)) out.push('http:feature:v2');
    if (/\/auth\/login/.test(path)) out.push('http:feature:login');
    if (/\/\d+(\/|$)/.test(path)) out.push('http:feature:pathid');
    const params = [...p.url.searchParams.keys()];
    if (params.length) out.push('http:feature:query');
    params.forEach((k) => out.push('http:param:' + k));
    Object.keys(p.headers).forEach((h) => out.push('http:header:' + h.toLowerCase()));
    if (p.body) out.push('http:feature:body');
    if (status && G.http.status[status]) out.push('http:status:' + status);
    return out;
  }

  function add(chapter, keys) {
    const b = B();
    const fresh = keys.filter((k) => !b[chapter].includes(k));
    if (!fresh.length) return 0;
    b[chapter] = b[chapter].concat(fresh);
    Core.save();
    badge();
    return fresh.length;
  }

  // События боёв: победный SQL-запрос, победный HTTP-запрос, верный ответ Блица
  Core.on((type, d) => {
    if (type === 'sql-cast') add('sql', sqlKeys(d.sql));
    else if (type === 'http-sent') add('http', httpKeys(d.text, d.status));
    else if (type === 'blitz-right' && d.key) add('blitz', ['blitz:' + d.key]);
    else return;
    setTimeout(announce, 0); // окно победы уже открыто — дописать в него, что попало в книгу
  });
  function announce() {
    const b = B();
    const all = [].concat(b.sql, b.http, b.blitz);
    const fresh = all.filter((k) => !b.announced.includes(k));
    const loot = document.querySelector('.modal .loot');
    if (!fresh.length || !loot) return;
    b.announced = b.announced.concat(fresh);
    Core.save();
    const names = fresh.map((k) => entry(k)).filter(Boolean).map((e) => e.title);
    loot.insertAdjacentHTML('afterend', `<p class="act-open book-new">📖 В книгу заметок: ${names.slice(0, 5).map(esc).join(', ')}${names.length > 5 ? ` и ещё ${names.length - 5}` : ''}</p>`);
  }

  // ---------- содержимое записи по ключу ----------
  function entry(key) {
    const [ch, a, b] = key.split(':');
    if (ch === 'sql') {
      const g = G.sql.find((x) => x[0] === a);
      return g && { key, title: g[1], html: g[2], example: g[3] };
    }
    if (ch === 'http') {
      const h = G.http[a] && G.http[a][b];
      if (h) return { key, title: a === 'status' ? 'Код ' + h[0] : a === 'param' ? `Параметр ${h[0]}` : a === 'method' ? `Метод ${h[0]}` : h[0], html: esc(h[1]), example: h[2] || '' };
      if (a === 'header') return { key, title: `Заголовок ${b}`, html: 'Дополнительный заголовок запроса: «Имя: значение». Сервер читает его, если ждёт.', example: `${b}: …` };
      if (a === 'param') return { key, title: `Параметр ${b}`, html: 'Query-параметр: настройка или фильтр запроса после «?».', example: `?${b}=…` };
      return null;
    }
    if (ch === 'blitz') {
      const q = ((window.BLITZ_Q || {})[+a] || [])[+b];
      return q && { key, title: q.q, html: `<b>${esc(q.a[0])}.</b> ${esc(q.why || '')}`, example: '' };
    }
    return null;
  }

  // Прогресс до этой версии книги: берём эталоны уже пройденных залов, монстров HTTP и вопросы пройденных монстров Блица
  function backfill() {
    const b = B();
    if (b.filled) return;
    const D = window.DUNGEON;
    const st = Core.state;
    const done = (k, r) => st[k] && st[k].rooms && st[k].rooms[r.id] && st[k].rooms[r.id].cleared;
    const keys = { sql: [], http: [], blitz: [] };
    D.rooms.forEach((r) => {
      if (done('sql', r)) keys.sql.push(...sqlKeys(r.solution));
      const act = Math.floor(r.index / 30);
      const t = ((window.HTTP_TASKS || {})[act] || [])[r.index % 30];
      if (done('http', r) && t) keys.http.push(...httpKeys(t.answer, t.status));
      if (done('blitz', r)) for (let j = 0; j < 3; j++) keys.blitz.push(`blitz:${act}:${(r.index % 30) * 3 + j}`);
    });
    Object.keys(keys).forEach((ch) => { b[ch] = Array.from(new Set(b[ch].concat(keys[ch]))); });
    b.announced = Array.from(new Set(b.announced.concat(b.sql, b.http, b.blitz)));
    b.read = Array.from(new Set(b.read.concat(b.sql, b.http, b.blitz)));
    b.filled = true;
    Core.save();
  }

  function badge() {
    const el = document.querySelector('#book-btn .book-count');
    if (!el || !Core.state) return;
    const b = B();
    const n = [].concat(b.sql, b.http, b.blitz).filter((k) => !b.read.includes(k)).length;
    el.hidden = !n;
    el.textContent = n > 99 ? '99+' : n;
  }

  // ---------- вёрстка страниц ----------
  const entryHtml = (e) => `<div class="book-entry${B().read.includes(e.key) ? '' : ' fresh'}"><h5>${esc(e.title)}</h5><div class="book-text">${e.html || ''}</div>${e.example ? `<pre>${esc(e.example)}</pre>` : ''}</div>`;

  // Раскладка: страница 1 — оглавление, 2 — как пользоваться, дальше разделы. Страницы наполняются по высоте:
  // запись, которая не влезла, переносится на следующую страницу. Раздел всегда начинается с новой страницы.
  function layout(measure) {
    const b = B();
    const pages = [{ kind: 'toc' }, { kind: 'about' }];
    const starts = {};
    CHAPTERS.forEach(([id, name, sub]) => {
      const list = b[id].map(entry).filter(Boolean);
      if (!list.length) return;
      starts[id] = pages.length;
      let cur = `<h3 class="book-chapter">${esc(name)}</h3><p class="book-sub">${esc(sub)}</p>`;
      let has = false;
      list.forEach((e) => {
        const html = entryHtml(e);
        measure.innerHTML = `<div class="book-page">${cur}${html}<span class="book-num">0</span></div>`;
        if (has && measure.scrollHeight > measure.clientHeight + 1) {
          pages.push({ kind: 'page', html: cur, chapter: name });
          cur = `<p class="book-running">${esc(name)}</p>` + html;
        } else cur += html;
        has = true;
      });
      pages.push({ kind: 'page', html: cur, chapter: name });
    });
    if (pages.length % 2) pages.push({ kind: 'blank' });
    return { pages, starts };
  }

  function pageHtml(p, n, starts) {
    if (!p) return '';
    let inner = '';
    if (p.kind === 'toc') {
      inner = `<h3 class="book-chapter">Книга заметок</h3><p class="book-sub">Разделы</p><ul class="book-toc">${CHAPTERS.map(([id, name]) => {
        const count = B()[id].length;
        return starts[id] != null
          ? `<li><button type="button" data-goto="${starts[id]}"><span>${esc(name)}</span><i></i><b>${starts[id] + 1}</b></button><small>${count} ${count % 10 === 1 && count % 100 !== 11 ? 'запись' : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? 'записи' : 'записей'}</small></li>`
          : `<li class="empty"><span>${esc(name)}</span><small>пока пусто — побеждай в режиме ${esc(name)}</small></li>`;
      }).join('')}</ul>`;
    } else if (p.kind === 'about') {
      inner = `<h3 class="book-chapter">Как вести записи</h3><div class="book-text"><p>Сюда сама собой записывается всё, что ты использовал в победах: каждый элемент SQL-запроса, части HTTP-запроса и понятия из Блица.</p>
        <p>Важно, как ты написал запрос, а не какой зал прошёл: другой запрос — другие записи.</p><p>Новые записи подсвечены. Листай за нижние уголки страниц, к разделу — через оглавление.</p></div>`;
    } else if (p.kind === 'page') inner = p.html;
    return `<div class="book-page">${inner}<span class="book-num">${n + 1}</span></div>`;
  }

  let spread = 0;
  let pending = null; // переход из оглавления

  function open() {
    backfill();
    const close = Core.modal(`<div class="book-wrap">
        <div class="book">
          <img class="book-img" src="${IMG.base}" alt="Книга заметок" width="1408" height="768">
          <div class="book-left"></div><div class="book-right"></div>
          <div class="book-left book-measure" aria-hidden="true"></div>
          <button type="button" class="book-corner left" data-turn="-1" aria-label="Предыдущие страницы"></button>
          <button type="button" class="book-corner right" data-turn="1" aria-label="Следующие страницы"></button>
        </div>
        <p class="modal-tip" data-book-tip></p>
        <button class="btn" id="modal-close" type="button">Закрыть книгу</button></div>`);
    const measure = document.querySelector('.book-measure');
    const { pages, starts } = layout(measure);
    measure.remove();
    const img = document.querySelector('.book-img');
    const show = () => {
      const max = Math.ceil(pages.length / 2) - 1;
      spread = Math.max(0, Math.min(spread, max));
      document.querySelector('.book-left').innerHTML = pageHtml(pages[spread * 2], spread * 2, starts);
      document.querySelector('.book-right').innerHTML = pageHtml(pages[spread * 2 + 1], spread * 2 + 1, starts);
      document.querySelector('[data-turn="-1"]').disabled = spread === 0;
      document.querySelector('[data-turn="1"]').disabled = spread >= max;
      document.querySelector('[data-book-tip]').textContent = `Разворот ${spread + 1} из ${max + 1}. Листай за нижние уголки страниц.`;
      img.src = IMG.base;
      // открытые страницы — прочитаны
      const b = B();
      const seen = [pages[spread * 2], pages[spread * 2 + 1]].filter((p) => p && p.html).map((p) => p.html).join('');
      [].concat(b.sql, b.http, b.blitz).forEach((k) => { const e = entry(k); if (e && !b.read.includes(k) && seen.includes(esc(e.title))) b.read.push(k); });
      Core.save();
      badge();
      document.querySelectorAll('[data-goto]').forEach((g) => g.addEventListener('click', () => { spread = Math.floor(+g.dataset.goto / 2); show(); }));
    };
    document.querySelectorAll('.book-corner').forEach((c) => {
      const side = c.classList.contains('left') ? 'left' : 'right';
      c.addEventListener('mouseenter', () => { if (!c.disabled) img.src = IMG[side]; });
      c.addEventListener('mouseleave', () => { img.src = IMG.base; });
      c.addEventListener('click', () => { if (c.disabled) return; spread += +c.dataset.turn; show(); });
    });
    if (pending != null) { spread = pending; pending = null; }
    show();
    return close;
  }

  // картинки уголков подгружаем заранее, чтобы при наведении не мигало
  [IMG.right, IMG.left].forEach((src) => { const i = new Image(); i.src = src; });
  $('book-btn').addEventListener('click', () => { spread = 0; open(); });
  setInterval(() => { if (Core.ready) { try { backfill(); badge(); } catch (e) { console.error(e); } } }, 3000);
  window.Book = { open, sqlKeys, httpKeys };
})();
