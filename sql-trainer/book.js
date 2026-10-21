// Книга заметок (📖 в шапке): всё новое, что встретилось в победах в SQL, HTTP и Блице.
//   SQL   — приём запроса из зала (topic) с объяснением и запросом-примером;
//   HTTP  — элементы запроса: методы, параметры, заголовки, тело, коды ответов (по эталонам пройденных монстров);
//   Блиц  — понятия: вопрос, верный ответ и пояснение.
// Записи не хранятся отдельно — книга собирается из прогресса. В сохранении только какие записи уже объявлены
// (book.announced, чтобы сказать «в книгу добавлено…» при победе) и прочитаны (book.read — для счётчика на кнопке).
// Листание — как у настоящей книги: наведи на нижний правый (левый) уголок и нажми.
(function () {
  'use strict';

  const Core = window.Core;
  const D = window.DUNGEON;
  const esc = Core.esc;
  const $ = (id) => document.getElementById(id);
  const IMG = { base: 'Avatars/book.jpeg', right: 'Avatars/right_book.jpeg', left: 'Avatars/left_book.jpeg' };

  // ---------- HTTP: словарь элементов запроса ----------
  const H = [
    ['m-GET', 'Метод GET', 'Получить данные. Не меняет состояние сервера, поэтому безопасен и идемпотентен; тела у запроса нет.', 'GET /heroes'],
    ['m-POST', 'Метод POST', 'Создать ресурс (или выполнить действие, например вход). Не идемпотентен: два одинаковых POST создадут два ресурса. Успех — обычно 201 Created и заголовок Location.', 'POST /items\nContent-Type: application/json\n\n{"name": "Факел", "rarity": "common", "price": 15}'],
    ['m-PUT', 'Метод PUT', 'Полностью заменить ресурс: непереданные поля сбрасываются. Идемпотентен — повтор даёт тот же результат.', 'PUT /items/5\n\n{"name": "Лук", "rarity": "rare", "price": 500, "description": null}'],
    ['m-PATCH', 'Метод PATCH', 'Частично изменить ресурс: меняются только переданные поля, остальные остаются как были.', 'PATCH /items/5\n\n{"price": 480}'],
    ['m-DELETE', 'Метод DELETE', 'Удалить ресурс. Успех — 204 No Content без тела; повторное удаление — 404.', 'DELETE /items/13'],
    ['path-id', 'Параметр пути', 'Идентификатор ресурса прямо в пути: /items/{id}. Неверный формат id — 400, такого ресурса нет — 404.', 'GET /heroes/3'],
    ['query', 'Query-параметры', 'Фильтры и настройки списка после «?»: ключ=значение, между парами «&». Порядок параметров не важен.', 'GET /heroes?class=Маг&limit=2'],
    ['paging', 'Пагинация: limit и offset', 'limit — сколько записей на странице, offset — сколько пропустить. Вторая страница по 5: limit=5&offset=5. Общее число — в X-Total-Count.', 'GET /items?limit=5&offset=5'],
    ['sort', 'Сортировка: sort и order', 'sort — по какому полю, order — asc (по возрастанию) или desc (по убыванию). Неизвестное поле — 400.', 'GET /items?sort=price&order=desc'],
    ['login', 'Вход и токен', 'POST /auth/login с логином и паролем возвращает токен. Дальше токен передаётся в каждом запросе, где нужна авторизация.', 'POST /auth/login\n\n{"login": "mage", "password": "chronicles"}'],
    ['bearer', 'Authorization: Bearer', 'Заголовок с токеном: «Bearer» + пробел + токен. Нет или неверный токен — 401, токен есть, но прав не хватает — 403.', 'Authorization: Bearer tok_7f3a9c21'],
    ['ctype', 'Content-Type', 'Тип тела запроса. Для JSON — application/json. Сервер, который ждёт JSON, на другой тип ответит 415.', 'Content-Type: application/json'],
    ['body', 'Тело запроса (JSON)', 'Данные для POST/PUT/PATCH: после заголовков пустая строка, затем JSON. Строки в кавычках, числа — без. Сломанный JSON — 400, неверные поля — 422.', '{"name": "Лиора", "class": "Жрец", "level": 4}'],
    ['apikey', 'X-API-Key', 'Авторизация ключом приложения в отдельном заголовке — так часто защищают служебные эндпоинты. Нет ключа или он неверный — 401.', 'X-API-Key: key_guild_9d4e'],
    ['custom', 'Свой заголовок (X-Realm)', 'API может требовать собственные заголовки. Обязательного нет — 400 с объяснением в теле.', 'X-Realm: north'],
    ['lang', 'Accept-Language', 'Клиент просит язык ответа. Сервер сообщает выбранный язык заголовком Content-Language.', 'Accept-Language: en'],
    ['v2', 'Версии API', 'Новая версия — новый префикс пути (/v2). Формат ответа может отличаться: например, список в конверте { data, total }.', 'GET /v2/heroes'],
  ];
  const STATUS = {
    200: ['200 OK', 'Запрос выполнен, в теле — результат.'],
    201: ['201 Created', 'Ресурс создан. Обычно в теле созданный объект, в заголовке Location — его адрес.'],
    204: ['204 No Content', 'Успех без тела ответа — так обычно отвечает DELETE.'],
    400: ['400 Bad Request', 'Запрос сформирован неверно: сломанный JSON, неверный формат параметра, нет обязательного заголовка.'],
    401: ['401 Unauthorized', 'Не удалось установить, кто ты: нет токена, токен неверный или истёк.'],
    403: ['403 Forbidden', 'Кто ты — известно, но прав на действие нет (например, читатель пытается удалить).'],
    404: ['404 Not Found', 'Ресурса нет: неверный id или путь.'],
    405: ['405 Method Not Allowed', 'Путь есть, но этот метод на нём не поддерживается.'],
    409: ['409 Conflict', 'Конфликт с текущим состоянием: например, такое имя уже занято.'],
    415: ['415 Unsupported Media Type', 'Сервер не принимает такой Content-Type тела.'],
    422: ['422 Unprocessable Entity', 'JSON корректный, но значения полей не проходят проверку: в теле — какие поля и почему.'],
  };

  function httpFeatures(t) {
    const a = t.answer || '';
    const first = a.split('\n')[0];
    const m = first.split(/\s+/)[0];
    const f = ['m-' + m];
    if (/\/\d+(\b|\/|\?|$)/.test(first.split('?')[0])) f.push('path-id');
    if (/\?/.test(first)) f.push('query');
    if (/[?&](limit|offset)=/.test(first)) f.push('paging');
    if (/[?&](sort|order)=/.test(first)) f.push('sort');
    if (/\/auth\/login/.test(first)) f.push('login');
    if (/^authorization:\s*bearer/im.test(a)) f.push('bearer');
    if (/^content-type:/im.test(a)) f.push('ctype');
    if (/\n\s*\n\s*\S/.test(a)) f.push('body');
    if (/^x-api-key:/im.test(a)) f.push('apikey');
    if (/^x-realm:/im.test(a)) f.push('custom');
    if (/^accept-language:/im.test(a)) f.push('lang');
    if (/\/v2\//.test(first)) f.push('v2');
    if (STATUS[t.status]) f.push('s' + t.status);
    return f;
  }

  // ---------- все записи книги по прогрессу ----------
  const roomsDone = (key) => ((Core.state[key] && Core.state[key].rooms) || {});
  function entries() {
    const out = [];
    const sql = roomsDone('sql');
    const seenTopic = new Set();
    D.rooms.forEach((r) => {
      if (!sql[r.id] || !sql[r.id].cleared || seenTopic.has(r.topic)) return;
      seenTopic.add(r.topic);
      out.push({ key: 'sql:' + r.topic, ch: 'SQL', title: r.topic, html: r.hints[0], example: r.solution, from: `Зал ${r.index + 1} · ${r.monster}` });
    });
    const http = roomsDone('http');
    const seenF = new Set();
    D.rooms.forEach((r) => {
      if (!http[r.id] || !http[r.id].cleared) return;
      const t = ((window.HTTP_TASKS || {})[Math.floor(r.index / 30)] || [])[r.index % 30];
      if (!t) return;
      httpFeatures(t).forEach((k) => {
        if (seenF.has(k)) return;
        seenF.add(k);
        if (k[0] === 's') { const s = STATUS[k.slice(1)]; out.push({ key: 'http:' + k, ch: 'HTTP', title: 'Код ' + s[0], html: esc(s[1]), example: '', from: `Монстр ${r.index + 1}` }); return; }
        const g = H.find((x) => x[0] === k);
        if (g) out.push({ key: 'http:' + k, ch: 'HTTP', title: g[1], html: esc(g[2]), example: g[3], from: `Монстр ${r.index + 1}` });
      });
    });
    const blitz = roomsDone('blitz');
    D.rooms.forEach((r) => {
      if (!blitz[r.id] || !blitz[r.id].cleared) return;
      const act = Math.floor(r.index / 30);
      for (let j = 0; j < 3; j++) {
        const q = ((window.BLITZ_Q || {})[act] || [])[(r.index % 30) * 3 + j];
        if (q) out.push({ key: `blitz:${act}:${(r.index % 30) * 3 + j}`, ch: 'Блиц', title: q.q, html: `<b>${esc(q.a[0])}.</b> ${esc(q.why || '')}`, example: '', from: `Монстр ${r.index + 1}` });
      }
    });
    return out;
  }

  function B() {
    if (!Core.state.book) {
      // первое знакомство с книгой: всё уже пройденное считается объявленным и прочитанным
      const keys = entries().map((e) => e.key);
      Core.state.book = { announced: keys.slice(), read: keys.slice() };
    }
    return Core.state.book;
  }

  function badge() {
    const el = document.querySelector('#book-btn .book-count');
    if (!el || !Core.state) return;
    const read = new Set(B().read);
    const n = entries().filter((e) => !read.has(e.key)).length;
    el.hidden = !n;
    el.textContent = n > 99 ? '99+' : n;
  }

  // После победы: новые записи — строкой в окно победы и счётчиком на кнопке книги
  Core.on((type) => {
    if (!['sql-room', 'http-task', 'theory-card'].includes(type)) return;
    setTimeout(() => {
      const b = B();
      const known = new Set(b.announced);
      const fresh = entries().filter((e) => !known.has(e.key));
      if (!fresh.length) return;
      b.announced = b.announced.concat(fresh.map((e) => e.key));
      Core.save();
      badge();
      const modal = document.querySelector('.modal .loot');
      if (modal) modal.insertAdjacentHTML('afterend', `<p class="act-open book-new">📖 В книгу заметок: ${fresh.slice(0, 4).map((e) => esc(e.title)).join(', ')}${fresh.length > 4 ? ` и ещё ${fresh.length - 4}` : ''}</p>`);
    }, 0);
  });

  // ---------- книга ----------
  const CHAPTERS = ['SQL', 'HTTP', 'Блиц'];
  let chapter = 'SQL';
  let spread = 0;

  function page(e, n) {
    if (!e) return `<div class="book-page empty"><p>${n === 0 ? 'Здесь пока пусто. Побеждай — и в книге появятся заметки.' : ''}</p></div>`;
    const read = B().read.includes(e.key);
    return `<div class="book-page"><p class="book-from">${esc(e.ch)} · ${esc(e.from)}${read ? '' : ' · <b>новое</b>'}</p>
      <h4>${esc(e.title)}</h4><div class="book-text">${e.html || ''}</div>${e.example ? `<pre>${esc(e.example)}</pre>` : ''}<span class="book-num">${n + 1}</span></div>`;
  }

  function open() {
    const all = entries().filter((e) => e.ch === chapter);
    const pages = Math.max(1, Math.ceil(all.length / 2));
    spread = Math.min(spread, pages - 1);
    const L = all[spread * 2];
    const R = all[spread * 2 + 1];
    // открытые страницы — прочитаны
    const b = B();
    [L, R].forEach((e) => { if (e && !b.read.includes(e.key)) b.read.push(e.key); });
    Core.save();
    badge();
    const counts = Object.fromEntries(CHAPTERS.map((c) => [c, entries().filter((e) => e.ch === c).length]));
    const close = Core.modal(`<div class="book-wrap">
        <div class="book-tabs">${CHAPTERS.map((c) => `<button type="button" class="${c === chapter ? 'on' : ''}" data-ch="${c}">${c} <small>${counts[c]}</small></button>`).join('')}</div>
        <div class="book">
          <img class="book-img" src="${IMG.base}" alt="Книга заметок" width="1408" height="768">
          <div class="book-left">${page(L, spread * 2)}</div>
          <div class="book-right">${page(R, spread * 2 + 1)}</div>
          <button type="button" class="book-corner left" data-turn="-1" aria-label="Предыдущие страницы" ${spread > 0 ? '' : 'disabled'}></button>
          <button type="button" class="book-corner right" data-turn="1" aria-label="Следующие страницы" ${spread < pages - 1 ? '' : 'disabled'}></button>
        </div>
        <p class="modal-tip">Разворот ${spread + 1} из ${pages}. Листай за нижние уголки страниц.</p>
        <button class="btn" id="modal-close" type="button">Закрыть книгу</button></div>`);
    const img = document.querySelector('.book-img');
    document.querySelectorAll('.book-corner').forEach((c) => {
      const side = c.classList.contains('left') ? 'left' : 'right';
      c.addEventListener('mouseenter', () => { if (!c.disabled) img.src = IMG[side]; });
      c.addEventListener('mouseleave', () => { img.src = IMG.base; });
      c.addEventListener('click', () => { if (c.disabled) return; spread += +c.dataset.turn; close(); open(); });
    });
    document.querySelectorAll('[data-ch]').forEach((t) => t.addEventListener('click', () => { chapter = t.dataset.ch; spread = 0; close(); open(); }));
  }

  // картинки уголков подгружаем заранее, чтобы при наведении не мигало
  [IMG.right, IMG.left].forEach((src) => { const i = new Image(); i.src = src; });
  $('book-btn').addEventListener('click', open);
  setInterval(badge, 3000);
  window.Book = { open, entries, badge };
})();
