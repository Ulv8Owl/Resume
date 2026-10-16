// Пентаграмма заклинания: SQL из книги заклинаний превращается в руны на круге.
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const C = 150;            // центр круга
  const R_VERTEX = 102;     // радиус вершин звезды
  const R_TEXT = 131;       // радиус кольцевой надписи

  // Главные руны — пять вершин звезды, в том порядке, в каком идут части запроса.
  // Первая вершина — «глагол» заклинания: что оно делает с Хрониками.
  const VERBS = [
    { kw: 'SELECT', glyph: 'ᛟ', name: 'Призыв',       re: /\bSELECT\b/ },
    { kw: 'INSERT', glyph: 'ᚫ', name: 'Сотворение',   re: /\bINSERT\b/ },
    { kw: 'UPDATE', glyph: 'ᚹ', name: 'Преображение', re: /\bUPDATE\b/ },
    { kw: 'DELETE', glyph: 'ᛤ', name: 'Изгнание',     re: /\bDELETE\b/ },
    { kw: 'CREATE', glyph: 'ᛠ', name: 'Возведение',   re: /\bCREATE\b/ },
  ];
  const VERTICES = [
    { id: 'verb', resolve: (q) => {
      // глагол — то, что встречается в заклинании первым
      let best = null;
      VERBS.forEach((v) => { const m = q.search(v.re); if (m >= 0 && (!best || m < best.at)) best = Object.assign({ at: m }, v); });
      return best;
    } },
    { id: 'source', resolve: (q) => (/\bFROM\b/.test(q) ? { kw: 'FROM', glyph: 'ᚠ', name: 'Источник' }
      : /\bINTO\b/.test(q) ? { kw: 'INTO', glyph: 'ᚩ', name: 'Вместилище' }
      : /\bSET\b/.test(q) ? { kw: 'SET', glyph: 'ᚪ', name: 'Перемена' } : null) },
    { id: 'where', resolve: (q) => (/\bWHERE\b/.test(q) ? { kw: 'WHERE', glyph: 'ᛉ', name: 'Печать отбора' } : null) },
    { id: 'group', resolve: (q) => (/\bGROUP\s+BY\b/.test(q) ? { kw: 'GROUP BY', glyph: 'ᚷ', name: 'Сплетение' } : null) },
    { id: 'order', resolve: (q) => (/\bORDER\s+BY\b/.test(q) ? { kw: 'ORDER BY', glyph: 'ᛏ', name: 'Строй' } : null) },
  ];
  const IDLE_GLYPHS = ['ᛟ', 'ᚠ', 'ᛉ', 'ᚷ', 'ᛏ'];

  // Малые руны встают на круг между вершинами.
  const MINOR = [
    { id: 'explain',   kw: 'EXPLAIN',     glyph: 'ᛳ', name: 'Прозрение',        re: /\bEXPLAIN\b/ },
    { id: 'begin',     kw: 'BEGIN',       glyph: 'ᛋ', name: 'Начало',           re: /\bBEGIN\b/ },
    { id: 'savepoint', kw: 'SAVEPOINT',   glyph: 'ᛲ', name: 'Веха',             re: /\bSAVEPOINT\b/ },
    { id: 'rollback',  kw: 'ROLLBACK',    glyph: 'ᛱ', name: 'Откат',            re: /\bROLLBACK\b/ },
    { id: 'commit',    kw: 'COMMIT',      glyph: 'ᛧ', name: 'Печать вечности',  re: /\bCOMMIT\b|\bEND\s+TRANSACTION\b/ },
    { id: 'index',     kw: 'INDEX',       glyph: 'ᛪ', name: 'Указатель',        re: /\bINDEX\b/ },
    { id: 'view',      kw: 'VIEW',        glyph: 'ᛮ', name: 'Окно',             re: /\bVIEW\b/ },
    { id: 'trigger',   kw: 'TRIGGER',     glyph: 'ᛰ', name: 'Ловушка',          re: /\bTRIGGER\b/ },
    { id: 'with',      kw: 'WITH',        glyph: 'ᛣ', name: 'Предзнаменование', re: /^\s*WITH\b/ },
    { id: 'recursive', kw: 'RECURSIVE',   glyph: 'ᛯ', name: 'Петля',            re: /\bRECURSIVE\b/ },
    { id: 'distinct',  kw: 'DISTINCT',    glyph: 'ᛁ', name: 'Очищение',         re: /\bDISTINCT\b/ },
    { id: 'join',      kw: 'JOIN',        glyph: 'ᛗ', name: 'Узы',              test: (q) => count(q, /\bJOIN\b/g) > count(q, /\bLEFT\s+(?:OUTER\s+)?JOIN\b/g) },
    { id: 'left',      kw: 'LEFT JOIN',   glyph: 'ᛞ', name: 'Тёмные узы',       re: /\bLEFT\s+(?:OUTER\s+)?JOIN\b/ },
    { id: 'union',     kw: 'UNION',       glyph: 'ᚣ', name: 'Слияние',          re: /\bUNION\b/ },
    { id: 'having',    kw: 'HAVING',      glyph: 'ᚺ', name: 'Клятва',           re: /\bHAVING\b/ },
    { id: 'limit',     kw: 'LIMIT',       glyph: 'ᛚ', name: 'Предел',           re: /\bLIMIT\b/ },
    { id: 'offset',    kw: 'OFFSET',      glyph: 'ᛦ', name: 'Отступ',           re: /\bOFFSET\b/ },
    { id: 'values',    kw: 'VALUES',      glyph: 'ᛃ', name: 'Дары',             re: /\bVALUES\b/ },
    { id: 'conflict',  kw: 'ON CONFLICT', glyph: 'ᛩ', name: 'Распря',           re: /\bON\s+CONFLICT\b|\bOR\s+(?:IGNORE|REPLACE)\b/ },
    { id: 'returning', kw: 'RETURNING',   glyph: 'ᛨ', name: 'Отклик',           re: /\bRETURNING\b/ },
    { id: 'count',     kw: 'COUNT',       glyph: 'ᚲ', name: 'Счёт',             re: /\bCOUNT\s*\(/ },
    { id: 'sum',       kw: 'SUM',         glyph: 'ᛊ', name: 'Сбор',             re: /\bSUM\s*\(/ },
    { id: 'avg',       kw: 'AVG',         glyph: 'ᚨ', name: 'Мера',             re: /\bAVG\s*\(/ },
    { id: 'min',       kw: 'MIN',         glyph: 'ᛡ', name: 'Умаление',         re: /\bMIN\s*\(/ },
    { id: 'max',       kw: 'MAX',         glyph: 'ᛒ', name: 'Возвышение',       re: /\bMAX\s*\(/ },
    { id: 'and',       kw: 'AND',         glyph: 'ᛖ', name: 'Союз',             re: /\bAND\b/ },
    { id: 'or',        kw: 'OR',          glyph: 'ᚢ', name: 'Выбор',            re: /\bOR\b(?!\s+(?:IGNORE|REPLACE))/ },
    { id: 'not',       kw: 'NOT',         glyph: 'ᚾ', name: 'Отрицание',        re: /\bNOT\b/ },
    { id: 'in',        kw: 'IN',          glyph: 'ᛇ', name: 'Круг',             re: /\bIN\s*\(/ },
    { id: 'like',      kw: 'LIKE',        glyph: 'ᚱ', name: 'Отражение',        re: /\bLIKE\b/ },
    { id: 'null',      kw: 'IS NULL',     glyph: 'ᛝ', name: 'Пустота',          re: /\bIS\s+(?:NOT\s+)?NULL\b/ },
    { id: 'between',   kw: 'BETWEEN',     glyph: 'ᛈ', name: 'Грань',            re: /\bBETWEEN\b/ },
    { id: 'case',      kw: 'CASE',        glyph: 'ᚦ', name: 'Развилка',         re: /\bCASE\b/ },
    { id: 'exists',    kw: 'EXISTS',      glyph: 'ᛜ', name: 'Бытие',            re: /\bEXISTS\b/ },
    { id: 'over',      kw: 'OVER',        glyph: 'ᛥ', name: 'Око',              re: /\bOVER\b/ },
    { id: 'sub',       kw: 'подзапрос',   glyph: '◎', name: 'Малый круг',       test: (q) => /\(\s*SELECT\b/.test(q) },
  ];

  const TIERS = [
    [0, 'Книга пуста'],
    [1, 'Малое заклинание'],
    [3, 'Заклинание'],
    [5, 'Великое заклинание'],
    [7, 'Запретное заклинание'],
  ];

  function count(q, re) { return (q.match(re) || []).length; }

  // Строки и комментарии не должны превращаться в руны: 'Маг' — это не ключевое слово.
  function strip(sql) {
    return sql
      .replace(/--[^\n]*/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/'(?:[^']|'')*'?/g, " '' ");
  }

  const polar = (r, deg) => {
    const a = (deg * Math.PI) / 180;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  };
  const vertexAngle = (i) => -90 + i * 72;
  const el = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    if (text != null) n.textContent = text;
    return n;
  };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let root = null;
  let checkDb = null;
  let prev = new Set();
  let parts = {};

  function build(host) {
    host.innerHTML = '';
    const svg = el('svg', { viewBox: '0 0 300 300', class: 'pentagram-svg', role: 'img', 'aria-label': 'Пентаграмма заклинания' });
    svg.appendChild(el('path', { id: 'ring-path', d: `M ${C} ${C - R_TEXT} a ${R_TEXT} ${R_TEXT} 0 1 1 -0.01 0`, fill: 'none' }));
    svg.appendChild(el('circle', { class: 'pg-circle outer', cx: C, cy: C, r: 143 }));
    svg.appendChild(el('circle', { class: 'pg-circle inner', cx: C, cy: C, r: 120 }));
    svg.appendChild(el('circle', { class: 'pg-circle core', cx: C, cy: C, r: R_VERTEX }));

    const ringG = el('g', { class: 'pg-ring' });
    const ringText = el('text', { class: 'pg-ring-text' });
    const tp = el('textPath', { href: '#ring-path' });
    ringText.appendChild(tp);
    ringG.appendChild(ringText);
    svg.appendChild(ringG);

    // лучи звезды: вершина i соединяется с i+2
    const lines = [];
    for (let i = 0; i < 5; i++) {
      const j = (i + 2) % 5;
      const [x1, y1] = polar(R_VERTEX, vertexAngle(i));
      const [x2, y2] = polar(R_VERTEX, vertexAngle(j));
      const line = el('line', { class: 'pg-line', x1, y1, x2, y2 });
      line.dataset.a = i;
      line.dataset.b = j;
      svg.appendChild(line);
      lines.push(line);
    }

    const center = el('g', { class: 'pg-center' });
    svg.appendChild(center);
    const minorG = el('g', { class: 'pg-minor' });
    svg.appendChild(minorG);

    const verts = VERTICES.map((v, i) => {
      const [x, y] = polar(R_VERTEX, vertexAngle(i));
      const g = el('g', { class: 'pg-vertex' });
      g.appendChild(el('circle', { cx: x, cy: y, r: 16 }));
      g.appendChild(el('text', { x, y: y + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, IDLE_GLYPHS[i]));
      g.appendChild(el('title', {}, ''));
      svg.appendChild(g);
      return g;
    });

    host.appendChild(svg);
    const status = document.createElement('div');
    status.className = 'pg-status';
    host.appendChild(status);
    const legend = document.createElement('ul');
    legend.className = 'pg-legend';
    host.appendChild(legend);

    root = host;
    parts = { svg, tp, lines, verts, center, minorG, status, legend };
  }

  function update(sql) {
    if (!root) return;
    const raw = sql || '';
    const q = strip(raw).toUpperCase();
    const isOn = (r) => (r.test ? r.test(q) : r.re.test(q));

    const vRunes = VERTICES.map((v) => v.resolve(q));
    const vOn = vRunes.map(Boolean);
    const minors = MINOR.filter(isOn);
    // ключ руны вершины включает глагол: смена SELECT на INSERT — новая руна
    const vKey = (i) => VERTICES[i].id + ':' + (vRunes[i] ? vRunes[i].kw : '');
    const active = new Set(vRunes.map((r, i) => (r ? vKey(i) : null)).filter(Boolean).concat(minors.map((r) => r.id)));

    parts.verts.forEach((g, i) => {
      const r = vRunes[i];
      g.classList.toggle('on', vOn[i]);
      g.classList.toggle('new', vOn[i] && !prev.has(vKey(i)));
      g.querySelector('text').textContent = r ? r.glyph : IDLE_GLYPHS[i];
      g.querySelector('title').textContent = r ? `${r.name} — ${r.kw}` : '';
    });
    parts.lines.forEach((l) => l.classList.toggle('on', vOn[l.dataset.a] && vOn[l.dataset.b]));

    // малые руны: по кругу между вершинами, по очереди в каждый из пяти промежутков
    parts.minorG.innerHTML = '';
    minors.forEach((r, k) => {
      const gap = k % 5;
      const pos = Math.floor(k / 5);
      const offsets = [36, 24, 48, 14, 58, 30, 42];
      const [x, y] = polar(R_VERTEX, vertexAngle(gap) + offsets[pos % offsets.length]);
      const g = el('g', { class: 'pg-rune' + (prev.has(r.id) ? '' : ' new') });
      g.appendChild(el('circle', { cx: x, cy: y, r: 10 }));
      g.appendChild(el('text', { x, y: y + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, r.glyph));
      g.appendChild(el('title', {}, `${r.name} — ${r.kw}`));
      parts.minorG.appendChild(g);
    });

    // в центре — сущности, к которым обращается заклинание (таблицы)
    const tables = [];
    const plain = strip(raw);
    const reT = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE|VIEW|INDEX\s+\w+\s+ON|ON)\s+([A-Za-z_][\w]*)/gi;
    const skip = ['select', 'lateral', 'or', 'of', 'conflict'];
    let m;
    while ((m = reT.exec(plain))) {
      const t = m[1].toLowerCase();
      // ON g.id = … — это псевдоним в условии соединения, а не таблица
      if (/^\s*\./.test(plain.slice(m.index + m[0].length))) continue;
      if (!tables.includes(t) && !skip.includes(t) && t.length > 2) tables.push(t);
    }
    parts.center.innerHTML = '';
    tables.slice(0, 3).forEach((t, i, arr) => {
      const y = C + (i - (arr.length - 1) / 2) * 13;
      parts.center.appendChild(el('text', { x: C, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'pg-entity' }, t));
    });

    // кольцевая надпись: сам текст заклинания, повторённый по кругу
    const words = raw.replace(/\s+/g, ' ').trim();
    let ring = '';
    if (words) {
      const unit = words.toUpperCase() + '  ✦  ';
      while (ring.length < 120) ring += unit;
      ring = ring.slice(0, 120);
    }
    parts.tp.textContent = ring;

    // устойчивость: компилируется ли запрос
    let state = 'idle';
    let note = '';
    if (words) {
      if (!checkDb) state = 'idle';
      else {
        try {
          const st = checkDb.prepare(raw);
          st.free();
          state = 'stable';
        } catch (e) {
          state = 'broken';
          note = e.message;
        }
      }
    }
    root.classList.toggle('stable', state === 'stable');
    root.classList.toggle('broken', state === 'broken');

    const power = active.size;
    const tier = TIERS.filter(([n]) => power >= n).pop()[1];
    parts.status.innerHTML = !words
      ? '<b>Книга пуста</b><span>Начни писать — руны лягут на круг</span>'
      : `<b>${tier}</b><span>${state === 'stable' ? `Плетение устойчиво · рун: ${power}` : state === 'broken' ? `Плетение рвётся: ${esc(note)}` : `рун: ${power}`}</span>`;

    parts.legend.innerHTML = [...vRunes.filter(Boolean), ...minors]
      .map((r) => `<li><span class="g">${r.glyph}</span>${r.name}<code>${esc(r.kw)}</code></li>`)
      .join('');

    prev = active;
  }

  function pulse(cls) {
    if (!root) return;
    root.classList.remove('cast', 'fizzle');
    void root.offsetWidth;
    root.classList.add(cls);
  }

  // Мана за заклинание: большие печати (вершины звезды ᛟ ᚠ ᛉ ᚷ ᛏ) дорогие, малые руны между ними — дешевле.
  const MAJOR_COST = 12;
  const MINOR_COST = 4;
  function cost(sql) {
    const q = strip(sql || '').toUpperCase();
    const major = VERTICES.filter((v) => v.resolve(q)).length;
    const minor = MINOR.filter((r) => (r.test ? r.test(q) : r.re.test(q))).length;
    return { major, minor, total: major * MAJOR_COST + minor * MINOR_COST };
  }

  window.Spell = {
    cost,
    init(host, db) {
      checkDb = db;
      if (!root) build(host);
    },
    mount(host) { if (!root) build(host); },
    update,
    cast: () => pulse('cast'),
    fizzle: () => pulse('fizzle'),
  };
})();
