// Помощник ввода SQL: выпадающий список подсказок (ключевые слова, таблицы, колонки) и строка
// быстрых символов для телефона. Подсказки зависят от контекста: после FROM/JOIN — таблицы,
// после «псевдоним.» — колонки этой таблицы.
(function () {
  'use strict';

  const D = window.DUNGEON;
  const esc = window.Core.esc;
  const ta = document.getElementById('sql');
  if (!ta || !D) return;

  const TABLES = Object.entries(D.diagram.tables).map(([name, t]) => ({ name, cols: t.cols.map((c) => c[0]) }));
  const VIEWS = ['complete_quest', 'guild_treasury', 'hero_cards', 'hire', 'rich_heroes', 'transfer'];
  const KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS NULL', 'IS NOT NULL', 'DISTINCT', 'AS',
    'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET', 'ASC', 'DESC',
    'JOIN', 'INNER JOIN', 'LEFT JOIN', 'CROSS JOIN', 'ON', 'USING', 'UNION', 'UNION ALL', 'EXISTS',
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH',
    'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'DEFAULT',
    'CREATE INDEX', 'CREATE UNIQUE INDEX', 'CREATE VIEW', 'CREATE TRIGGER', 'DROP INDEX', 'DROP VIEW', 'DROP TRIGGER',
    'BEFORE', 'AFTER', 'INSTEAD OF', 'FOR EACH ROW', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE',
    'EXPLAIN QUERY PLAN', 'NULL', 'NEW.', 'OLD.', 'RAISE(ABORT, ',
  ];
  const FUNCS = ['COUNT(', 'SUM(', 'AVG(', 'MIN(', 'MAX(', 'ROUND(', 'COALESCE(', 'IFNULL(', 'LENGTH(', 'UPPER(', 'LOWER(',
    'SUBSTR(', 'TRIM(', 'CAST(', 'ABS(', 'DATE(', 'STRFTIME(', 'GROUP_CONCAT(', 'REPLACE(', 'INSTR('];
  const TABLE_CONTEXT = /\b(FROM|JOIN|INTO|UPDATE|TABLE|ON\s+\w+\s*\(?$)\s*$/i;

  // Псевдонимы из текста запроса: «FROM heroes h», «JOIN guilds AS g».
  function aliases(sql) {
    const map = {};
    const re = /\b(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi;
    let m;
    while ((m = re.exec(sql))) {
      const t = TABLES.find((x) => x.name.toLowerCase() === m[1].toLowerCase());
      if (!t) continue;
      map[t.name.toLowerCase()] = t;
      if (m[2] && !/^(WHERE|JOIN|ON|LEFT|INNER|CROSS|GROUP|ORDER|LIMIT|USING|SET|AS)$/i.test(m[2])) map[m[2].toLowerCase()] = t;
    }
    return map;
  }

  function context() {
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return null;
    const before = ta.value.slice(0, pos);
    const m = before.match(/([A-Za-z_][\w]*\.)?([A-Za-z_]\w*)?$/);
    const qual = m[1] || '';
    const word = m[2] || '';
    if (!qual && !word) return null;
    return { pos, start: pos - qual.length - word.length, qual, word, rest: before.slice(0, pos - qual.length - word.length) };
  }

  function suggest(ctx) {
    const w = ctx.word.toLowerCase();
    const starts = (s) => s.toLowerCase().startsWith(w) && s.toLowerCase() !== w;
    const al = aliases(ta.value);
    if (ctx.qual) {
      const t = al[ctx.qual.slice(0, -1).toLowerCase()];
      if (!t) return [];
      return t.cols.filter((c) => !w || starts(c)).map((c) => ({ text: ctx.qual + c, label: c, kind: t.name }));
    }
    if (!w) return [];
    const used = Object.values(al);
    const cols = [];
    (used.length ? used : TABLES).forEach((t) => t.cols.forEach((c) => { if (starts(c) && !cols.some((x) => x.label === c)) cols.push({ text: c, label: c, kind: t.name }); }));
    const tables = TABLES.map((t) => t.name).concat(VIEWS).filter(starts).map((n) => ({ text: n, label: n, kind: 'таблица' }));
    const words = KEYWORDS.filter(starts).map((k) => ({ text: k, label: k, kind: 'слово' }));
    const funcs = FUNCS.filter(starts).map((f) => ({ text: f, label: f + ')', kind: 'функция' }));
    const list = TABLE_CONTEXT.test(ctx.rest) ? tables.concat(words) : words.concat(cols, funcs, tables);
    return list.slice(0, 8);
  }

  // ---------- выпадающий список ----------

  const box = document.createElement('div');
  box.className = 'sqla';
  box.setAttribute('role', 'listbox');
  box.hidden = true;
  ta.insertAdjacentElement('afterend', box);
  let items = [];
  let active = 0;
  let current = null;

  function show() {
    current = context();
    items = current ? suggest(current) : [];
    if (!items.length) { hide(); return; }
    active = 0;
    box.innerHTML = items.map((it, i) => `<button type="button" class="sqla-item${i === 0 ? ' on' : ''}" role="option" data-i="${i}" tabindex="-1">
      <span>${esc(it.label)}</span><small>${esc(it.kind)}</small></button>`).join('');
    box.hidden = false;
  }
  function hide() { box.hidden = true; items = []; }
  function move(d) {
    active = (active + d + items.length) % items.length;
    box.querySelectorAll('.sqla-item').forEach((b, i) => b.classList.toggle('on', i === active));
  }

  function insertText(text, from, to) {
    ta.focus();
    ta.setRangeText(text, from, to, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function accept(i) {
    const it = items[i];
    const ctx = current;
    if (!it || !ctx) return;
    const after = ta.value.slice(ctx.pos, ctx.pos + 1);
    const space = /[(.]$/.test(it.text) || /, $/.test(it.text) || after === ' ' || after === ',' || after === ')' ? '' : ' ';
    insertText(it.text + space, ctx.start, ctx.pos);
    hide();
  }

  // pointerdown, а не click: так поле не теряет фокус и клавиатура телефона не прячется
  box.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.sqla-item');
    if (!b) return;
    e.preventDefault();
    accept(+b.dataset.i);
  });
  ta.addEventListener('input', show);
  ta.addEventListener('blur', () => setTimeout(hide, 120));
  ta.addEventListener('click', hide);
  // перехватываем раньше общего обработчика (Tab — отступ, Ctrl+Enter — запуск)
  ta.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); accept(active); }
    else if (e.key === 'Escape') { e.preventDefault(); hide(); }
  }, true);

  // ---------- строка символов для телефона ----------

  const KEYS = ['*', ',', '(', ')', '=', "'", ';', '.', '<', '>', '%', '_', '⏎'];
  const bar = document.createElement('div');
  bar.className = 'sqla-keys';
  bar.setAttribute('aria-label', 'Быстрые символы');
  bar.innerHTML = KEYS.map((k) => `<button type="button" data-key="${esc(k)}" tabindex="-1">${esc(k)}</button>`).join('');
  box.insertAdjacentElement('afterend', bar);
  bar.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-key]');
    if (!b) return;
    e.preventDefault();
    const k = b.dataset.key;
    const text = k === '⏎' ? '\n' : k === ',' ? ', ' : k === "'" ? "''" : k;
    let s = ta.selectionStart;
    // «name ,» → «name,»: пробел, который поставила подсказка, перед запятой и скобкой не нужен
    if ([',', ')', ';'].includes(k) && s === ta.selectionEnd && ta.value[s - 1] === ' ') s -= 1;
    insertText(text, s, ta.selectionEnd);
    // кавычки ставятся парой, курсор — между ними
    if (k === "'") ta.setSelectionRange(s + 1, s + 1);
  });
  ta.setAttribute('autocorrect', 'off');
  ta.setAttribute('autocomplete', 'off');

  window.SqlAssist = { suggest: () => (context() ? suggest(context()) : []) };
})();
