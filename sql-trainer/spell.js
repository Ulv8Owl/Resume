// Пентаграмма заклинания: SQL из книги заклинаний превращается в руны на круге.
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const C = 150;            // центр круга
  const R_VERTEX = 102;     // радиус вершин звезды
  const R_TEXT = 131;       // радиус кольцевой надписи

  // Главные руны — пять вершин звезды, в том порядке, в каком идут части запроса.
  const VERTICES = [
    { id: 'select', kw: 'SELECT',   glyph: 'ᛟ', name: 'Призыв',        re: /\bSELECT\b/ },
    { id: 'from',   kw: 'FROM',     glyph: 'ᚠ', name: 'Источник',      re: /\bFROM\b/ },
    { id: 'where',  kw: 'WHERE',    glyph: 'ᛉ', name: 'Печать отбора', re: /\bWHERE\b/ },
    { id: 'group',  kw: 'GROUP BY', glyph: 'ᚷ', name: 'Сплетение',     re: /\bGROUP\s+BY\b/ },
    { id: 'order',  kw: 'ORDER BY', glyph: 'ᛏ', name: 'Строй',         re: /\bORDER\s+BY\b/ },
  ];

  // Малые руны встают на круг между вершинами.
  const MINOR = [
    { id: 'with',     kw: 'WITH',      glyph: 'ᛣ', name: 'Предзнаменование', re: /^\s*WITH\b/ },
    { id: 'distinct', kw: 'DISTINCT',  glyph: 'ᛁ', name: 'Очищение',    re: /\bDISTINCT\b/ },
    { id: 'join',     kw: 'JOIN',      glyph: 'ᛗ', name: 'Узы',         test: (q) => count(q, /\bJOIN\b/g) > count(q, /\bLEFT\s+(?:OUTER\s+)?JOIN\b/g) },
    { id: 'left',     kw: 'LEFT JOIN', glyph: 'ᛞ', name: 'Тёмные узы',  re: /\bLEFT\s+(?:OUTER\s+)?JOIN\b/ },
    { id: 'having',   kw: 'HAVING',    glyph: 'ᚺ', name: 'Клятва',      re: /\bHAVING\b/ },
    { id: 'limit',    kw: 'LIMIT',     glyph: 'ᛚ', name: 'Предел',      re: /\bLIMIT\b/ },
    { id: 'count',    kw: 'COUNT',     glyph: 'ᚲ', name: 'Счёт',        re: /\bCOUNT\s*\(/ },
    { id: 'sum',      kw: 'SUM',       glyph: 'ᛊ', name: 'Сбор',        re: /\bSUM\s*\(/ },
    { id: 'avg',      kw: 'AVG',       glyph: 'ᚨ', name: 'Мера',        re: /\bAVG\s*\(/ },
    { id: 'min',      kw: 'MIN',       glyph: 'ᛃ', name: 'Умаление',    re: /\bMIN\s*\(/ },
    { id: 'max',      kw: 'MAX',       glyph: 'ᛒ', name: 'Возвышение',  re: /\bMAX\s*\(/ },
    { id: 'and',      kw: 'AND',       glyph: 'ᛖ', name: 'Союз',        re: /\bAND\b/ },
    { id: 'or',       kw: 'OR',        glyph: 'ᚢ', name: 'Выбор',       re: /\bOR\b/ },
    { id: 'not',      kw: 'NOT',       glyph: 'ᚾ', name: 'Отрицание',   re: /\bNOT\b/ },
    { id: 'in',       kw: 'IN',        glyph: 'ᛇ', name: 'Круг',        re: /\bIN\s*\(/ },
    { id: 'like',     kw: 'LIKE',      glyph: 'ᚱ', name: 'Отражение',   re: /\bLIKE\b/ },
    { id: 'null',     kw: 'IS NULL',   glyph: 'ᛝ', name: 'Пустота',     re: /\bIS\s+(?:NOT\s+)?NULL\b/ },
    { id: 'between',  kw: 'BETWEEN',   glyph: 'ᛈ', name: 'Грань',       re: /\bBETWEEN\b/ },
    { id: 'case',     kw: 'CASE',      glyph: 'ᚦ', name: 'Развилка',    re: /\bCASE\b/ },
    { id: 'exists',   kw: 'EXISTS',    glyph: 'ᛜ', name: 'Бытие',       re: /\bEXISTS\b/ },
    { id: 'over',     kw: 'OVER',      glyph: 'ᛥ', name: 'Око',         re: /\bOVER\s*\(/ },
    { id: 'sub',      kw: 'подзапрос', glyph: '◎', name: 'Малый круг',  test: (q) => count(q, /\bSELECT\b/g) > 1 },
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
      g.appendChild(el('text', { x, y: y + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, v.glyph));
      g.appendChild(el('title', {}, `${v.name} — ${v.kw}`));
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

    const vOn = VERTICES.map(isOn);
    const minors = MINOR.filter(isOn);
    const active = new Set([...VERTICES.filter((_, i) => vOn[i]), ...minors].map((r) => r.id));

    parts.verts.forEach((g, i) => {
      g.classList.toggle('on', vOn[i]);
      g.classList.toggle('new', vOn[i] && !prev.has(VERTICES[i].id));
    });
    parts.lines.forEach((l) => l.classList.toggle('on', vOn[l.dataset.a] && vOn[l.dataset.b]));

    // малые руны: по кругу между вершинами, по очереди в каждый из пяти промежутков
    parts.minorG.innerHTML = '';
    minors.forEach((r, k) => {
      const gap = k % 5;
      const pos = Math.floor(k / 5);
      const offsets = [36, 24, 48, 14, 58];
      const [x, y] = polar(R_VERTEX, vertexAngle(gap) + offsets[pos % offsets.length]);
      const g = el('g', { class: 'pg-rune' + (prev.has(r.id) ? '' : ' new') });
      g.appendChild(el('circle', { cx: x, cy: y, r: 10 }));
      g.appendChild(el('text', { x, y: y + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, r.glyph));
      g.appendChild(el('title', {}, `${r.name} — ${r.kw}`));
      parts.minorG.appendChild(g);
    });

    // в центре — сущности, к которым обращается заклинание (таблицы)
    const tables = [];
    const reT = /\b(?:FROM|JOIN)\s+([A-Za-z_][\w]*)/gi;
    let m;
    const plain = strip(raw);
    while ((m = reT.exec(plain))) {
      const t = m[1].toLowerCase();
      if (!tables.includes(t) && !['select', 'lateral'].includes(t)) tables.push(t);
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

    parts.legend.innerHTML = [...VERTICES.filter((_, i) => vOn[i]), ...minors]
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

  window.Spell = {
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
