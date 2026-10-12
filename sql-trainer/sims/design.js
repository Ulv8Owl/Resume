// Тест-дизайн: конструкторы техник (классы эквивалентности, границы, таблицы решений, переходы состояний,
// pairwise, предугадывание ошибок, чек-листы, тест-кейсы, Given-When-Then) со строгой автопроверкой.
(function () {
  'use strict';

  const Core = window.Core;
  const esc = Core.esc;

  // ---------- утилиты ----------

  // Число из строки («1,5» → 1.5); округление до тысячных, чтобы 0.1 + 0.2 сравнивались честно.
  function num(s) {
    const t = String(s).trim().replace(',', '.').replace(/\s+/g, '');
    if (!/^[-+]?\d+(\.\d+)?$/.test(t)) return NaN;
    return Math.round(parseFloat(t) * 1000) / 1000;
  }
  const fmt = (n) => String(n).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const r3 = (n) => Math.round(n * 1000) / 1000;
  // Значение тестовых данных: пустое и пробелы — видимыми.
  function vis(v) {
    if (v === '') return '<i class="td-empty">пусто</i>';
    return esc(v).replace(/ /g, '<span class="td-sp">·</span>');
  }
  const ok = (t) => ({ ok: true, t });
  const bad = (t) => ({ ok: false, t });
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };

  function card(title, body) {
    return `<div class="td-card">
      ${title ? `<h3 class="td-h">${title}</h3>` : ''}
      ${body}
      <div class="td-actions"><button class="btn td-check" type="button">Проверить</button><span class="td-live"></span></div>
      <ul class="td-fb" hidden></ul>
    </div>`;
  }
  function showFb(box, items) {
    const ul = box.querySelector('.td-fb');
    ul.hidden = !items.length;
    ul.innerHTML = items.map((i) => `<li class="${i.ok ? 'ok' : 'bad'}">${i.t}</li>`).join('');
  }
  // Пройден ли «флаг» проверки части part (флаг — имя или предикат от flags).
  function passed(ctx, part, f) {
    return ctx.log.some((e) => e.type === 'check' && e.part === part && e.flags &&
      (typeof f === 'function' ? f(e.flags) : !!e.flags[f]));
  }
  const F = (part, f) => (ctx) => passed(ctx, part, f);

  const W = {};

  // ---------- классы эквивалентности ----------
  // P: { classes: [{ id, label, type: 'valid'|'invalid'|'extra' }], values: [{ v, cls }] }
  const MARKS = [['valid', 'Валидный'], ['invalid', 'Невалидный'], ['extra', 'Лишний']];
  W.ec = function (box, P, api) {
    const marks = {};
    const picked = new Set();
    box.innerHTML = card(P.title || 'Классы эквивалентности', `
      <p class="td-sub"><b>1.</b> Размечай классы. <b>Лишний</b> — «класс», который требования не отличают от другого (дробит или дублирует его).</p>
      <div class="td-classes">${P.classes.map((c) => `
        <div class="td-cls" data-cls="${c.id}"><span class="td-cls-name">${esc(c.label)}</span>
          <div class="td-seg" role="group">${MARKS.map((m) => `<button type="button" class="m-${m[0]}" data-mark="${m[0]}">${m[1]}</button>`).join('')}</div></div>`).join('')}</div>
      <p class="td-sub"><b>2.</b> Тестовые данные: по одному представителю на каждый класс (валидный и невалидный).</p>
      <div class="td-chips">${P.values.map((v, i) => `<button type="button" class="td-chip" data-val="${i}" aria-pressed="false">${vis(v.v)}</button>`).join('')}</div>`);
    const live = box.querySelector('.td-live');
    const upd = () => { live.textContent = `Выбрано значений: ${picked.size}`; };
    box.querySelectorAll('.td-cls').forEach((row) => row.querySelectorAll('[data-mark]').forEach((b) => b.addEventListener('click', () => {
      marks[row.dataset.cls] = b.dataset.mark;
      row.querySelectorAll('[data-mark]').forEach((x) => x.classList.toggle('on', x === b));
    })));
    box.querySelectorAll('[data-val]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.val;
      if (picked.has(i)) picked.delete(i); else picked.add(i);
      b.classList.toggle('on', picked.has(i));
      b.setAttribute('aria-pressed', picked.has(i));
      upd();
    }));
    upd();
    box.querySelector('.td-check').addEventListener('click', () => {
      const out = [];
      const unmarked = P.classes.filter((c) => !marks[c.id]).length;
      const wrong = P.classes.filter((c) => marks[c.id] && marks[c.id] !== c.type);
      const classes = !unmarked && !wrong.length;
      if (unmarked) out.push(bad(`Не размечено классов: ${unmarked}.`));
      if (wrong.length) {
        out.push(bad(`Неверно размечено: ${wrong.length} ${plural(wrong.length, 'класс', 'класса', 'классов')}.` +
          (wrong.some((c) => c.type === 'extra') ? ' Среди них есть «класс», который требования не отличают от соседнего.' : '')));
      }
      let pick = false;
      if (classes) {
        out.push(ok('Классы размечены верно.'));
        const by = {};
        picked.forEach((i) => { (by[P.values[i].cls] = by[P.values[i].cls] || []).push(i); });
        const real = P.classes.filter((c) => c.type !== 'extra');
        const miss = real.filter((c) => !by[c.id]);
        const dup = real.filter((c) => by[c.id] && by[c.id].length > 1);
        miss.forEach((c) => out.push(bad(`Не покрыт класс «${esc(c.label)}».`)));
        dup.forEach((c) => out.push(bad(`Из класса «${esc(c.label)}» выбрано ${by[c.id].length} значения (${by[c.id].map((i) => vis(P.values[i].v)).join(', ')}) — оставь одно.`)));
        pick = !miss.length && !dup.length;
        if (pick) out.push(ok(`Набор тестовых данных минимален: ${picked.size} ${plural(picked.size, 'значение', 'значения', 'значений')}, каждый класс покрыт ровно один раз.`));
      } else out.push(bad('Тестовые данные проверю, когда классы будут размечены верно.'));
      showFb(box, out);
      api.emit({ classes, pick });
    });
  };

  // ---------- граничные значения ----------
  // P: { unit, step, points: 2|3, bounds?: [{ label, v }], segments: [{ from?, to?, label, valid }],
  //      groups: [{ label, vals }], outcomes?: [..], expect?(v) → idx, impl?(v) → idx }
  W.bva = function (box, P, api) {
    const step = P.step || 1;
    let boundsOk = !P.bounds;
    let picked = [];
    const exp = {};
    let ran = false;
    box.innerHTML = card(P.title || 'Граничные значения', `
      ${P.bounds ? `<p class="td-sub"><b>1.</b> Определи границы по требованиям${P.unit ? ` (в ${esc(P.unit)})` : ''}.</p>
        <div class="td-bounds">${P.bounds.map((b, i) => `<label class="td-field"><span>${esc(b.label)}</span><input type="text" inputmode="decimal" data-bound="${i}" autocomplete="off"></label>`).join('')}</div>` : ''}
      <div class="td-axis-wrap"></div>
      <p class="td-sub"><b>${P.bounds ? 2 : 1}.</b> ${P.points === 3 ? 'Трёхточечный анализ: сама граница и значения по обе стороны от неё.' : 'Двухточечный анализ: граница и ближайшее значение соседнего класса.'} Шаг значения — ${fmt(step)}${P.per ? ' ' + esc(P.per) : ''}.</p>
      <div class="td-add"><input type="text" inputmode="decimal" class="td-val-in" placeholder="Значение" aria-label="Тестовое значение" autocomplete="off"><button class="btn td-add-btn" type="button">Добавить</button></div>
      <div class="td-chips td-picked"></div>
      ${P.outcomes ? `<div class="td-exp" hidden><p class="td-sub"><b>${P.bounds ? 3 : 2}.</b> Ожидаемый результат для каждого значения${P.impl ? ', затем прогон тестов' : ''}.</p><div class="td-scroll"><table class="td-tbl td-exp-tbl"></table></div></div>` : ''}`);
    const axisWrap = box.querySelector('.td-axis-wrap');
    const pickedEl = box.querySelector('.td-picked');
    const valIn = box.querySelector('.td-val-in');
    const expWrap = box.querySelector('.td-exp');
    const segOf = (v) => P.segments.findIndex((s) => (s.from == null || v >= s.from - 1e-9) && (s.to == null || v <= s.to + 1e-9));

    function axis() {
      if (!boundsOk) { axisWrap.innerHTML = '<p class="td-ph">Ось классов появится, когда границы будут определены верно.</p>'; return; }
      const n = P.segments.length;
      const X0 = 10, Wd = 620, sw = Wd / n;
      let svg = '';
      P.segments.forEach((s, i) => {
        svg += `<rect class="seg ${s.valid ? 'v' : 'i'}" x="${X0 + i * sw}" y="44" width="${sw}" height="22"></rect>
          <text class="seg-l" x="${X0 + i * sw + sw / 2}" y="84">${esc(s.label)}</text>`;
      });
      picked.forEach((v, k) => {
        const si = segOf(v);
        if (si < 0) return;
        const s = P.segments[si];
        const a = X0 + si * sw, b = a + sw;
        let x = a + sw / 2;
        if (s.from != null && (v - s.from) / step < 4) x = a + 8 + ((v - s.from) / step) * 12;
        else if (s.to != null && (s.to - v) / step < 4) x = b - 8 - ((s.to - v) / step) * 12;
        const y = k % 2 ? 14 : 30;
        svg += `<line class="mk" x1="${x}" y1="${y + 3}" x2="${x}" y2="66"></line><circle class="mk" cx="${x}" cy="55" r="4"></circle><text class="mk-l" x="${x}" y="${y}">${esc(fmt(v))}</text>`;
      });
      axisWrap.innerHTML = `<div class="td-scroll"><svg class="td-axis" viewBox="0 0 640 92" role="img" aria-label="Ось классов">${svg}</svg></div>`;
    }
    function renderPicked() {
      pickedEl.innerHTML = picked.length ? picked.map((v) => {
        const si = segOf(v);
        const cls = si < 0 ? '' : P.segments[si].valid ? ' v' : ' i';
        return `<span class="td-tag${boundsOk ? cls : ''}">${esc(fmt(v))}<button type="button" data-rm="${v}" aria-label="Убрать ${esc(fmt(v))}">×</button></span>`;
      }).join('') : '<span class="td-ph">Значений пока нет</span>';
      pickedEl.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { picked = picked.filter((x) => x !== +b.dataset.rm); ran = false; refresh(); }));
      box.querySelector('.td-live').textContent = `Значений: ${picked.length}`;
    }
    function renderExp() {
      if (!expWrap) return;
      const tbl = expWrap.querySelector('table');
      tbl.innerHTML = `<thead><tr><th>Значение</th><th>Ожидаемый результат</th>${ran ? '<th>Факт</th>' : ''}</tr></thead><tbody>${picked.map((v) => {
        const act = ran ? P.impl(v) : null;
        return `<tr${ran ? ` class="${act === exp[v] ? 'pass' : 'fail'}"` : ''}><td class="num">${esc(fmt(v))}</td><td><select data-exp="${v}" aria-label="Ожидаемый результат для ${esc(fmt(v))}">
          <option value="">— выбери —</option>${P.outcomes.map((o, i) => `<option value="${i}"${exp[v] === i ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></td>
          ${ran ? `<td>${act === exp[v] ? '✓ ' : '✗ '}${esc(P.outcomes[act])}</td>` : ''}</tr>`;
      }).join('')}</tbody>`;
      tbl.querySelectorAll('[data-exp]').forEach((s) => s.addEventListener('change', () => { exp[+s.dataset.exp] = s.value === '' ? undefined : +s.value; ran = false; renderExp(); }));
    }
    function refresh() { axis(); renderPicked(); renderExp(); }
    function add() {
      const v = num(valIn.value);
      if (isNaN(v)) { valIn.classList.add('err'); return; }
      valIn.classList.remove('err');
      if (!picked.includes(v)) picked.push(v);
      picked.sort((a, b) => a - b);
      valIn.value = '';
      ran = false;
      refresh();
    }
    box.querySelector('.td-add-btn').addEventListener('click', add);
    valIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    refresh();

    box.querySelector('.td-check').addEventListener('click', () => {
      const out = [];
      const flags = { bounds: false, pick: false, expect: false };
      if (P.bounds) {
        const ins = [...box.querySelectorAll('[data-bound]')];
        const wrong = P.bounds.filter((b, i) => num(ins[i].value) !== b.v);
        if (!boundsOk && !wrong.length) { boundsOk = true; ins.forEach((x) => { x.disabled = true; }); refresh(); }
        if (!boundsOk) {
          wrong.forEach((b) => out.push(bad(`«${esc(b.label)}» — неверно. Перечитай, включается ли граница.`)));
          showFb(box, out);
          api.emit(flags);
          return;
        }
        out.push(ok('Границы определены верно.'));
      }
      flags.bounds = true;
      const set = new Set(picked);
      const need = new Set();
      P.groups.forEach((g) => {
        const miss = g.vals.filter((v) => !set.has(v)).length;
        g.vals.forEach((v) => need.add(v));
        if (miss) out.push(bad(`Граница ${esc(g.label)}: не хватает ${miss} ${plural(miss, 'значения', 'значений', 'значений')}.`));
      });
      picked.filter((v) => !need.has(v)).forEach((v) => {
        const near = P.groups.some((g) => g.vals.some((x) => Math.abs(x - v) <= 2 * step + 1e-9));
        out.push(bad(`Лишнее значение ${esc(fmt(v))}: ${near ? `для ${P.points}-точечного анализа оно не нужно` : 'не граничное — это представитель класса, а не граница'}.`));
      });
      if (!picked.length) out.push(bad('Добавь тестовые значения.'));
      flags.pick = picked.length > 0 && picked.every((v) => need.has(v)) && [...need].every((v) => set.has(v));
      if (flags.pick) out.push(ok(`Набор граничных значений полный и минимальный: ${picked.length}.`));
      if (P.outcomes) {
        if (flags.pick) {
          expWrap.hidden = false;
          const empty = picked.filter((v) => exp[v] === undefined).length;
          const wrongE = picked.filter((v) => exp[v] !== undefined && exp[v] !== P.expect(v)).length;
          if (empty) out.push(bad(`Не указан ожидаемый результат: ${empty} ${plural(empty, 'значение', 'значения', 'значений')}.`));
          if (wrongE) out.push(bad(`Ожидаемый результат не соответствует требованиям: ${wrongE} ${plural(wrongE, 'значение', 'значения', 'значений')}.`));
          flags.expect = !empty && !wrongE;
          if (flags.expect) {
            out.push(ok('Ожидаемые результаты верны.'));
            if (P.impl) {
              ran = true;
              const fails = picked.filter((v) => P.impl(v) !== exp[v]).length;
              out.push(fails ? bad(`Прогон: упало ${fails} из ${picked.length}. Красные строки — расхождение факта с ожиданием.`) : ok('Прогон: все тесты прошли.'));
              flags.run = true;
            }
          } else ran = false;
          renderExp();
        } else if (expWrap.hidden) out.push(bad('Таблица ожидаемых результатов откроется, когда набор значений будет верным.'));
      }
      showFb(box, out);
      api.emit(flags);
    });
  };

  // ---------- таблица решений ----------
  // P: { conds: [..], acts: [..], fn(bool[]) → [индексы действий] | null (невозможная комбинация), cols, target? }
  W.dt = function (box, P, api) {
    const n = P.conds.length;
    const blank = () => ({ c: P.conds.map(() => ''), a: P.acts.map(() => false) });
    const cols = Array.from({ length: P.cols || 1 }, blank);
    const NEXT = { '': 'Y', Y: 'N', N: '-', '-': 'Y' };
    box.innerHTML = card(P.title || 'Таблица решений', `
      <p class="td-sub">Клик по условию: <b>Y</b> → <b>N</b> → <b>–</b> (не важно). Клик по действию ставит или снимает <b>✕</b>.</p>
      <div class="td-scroll"><table class="td-tbl td-dt"></table></div>
      <div class="td-row-btns"><button class="ghost-btn td-add-col" type="button">+ Правило</button></div>`);
    const tbl = box.querySelector('.td-dt');
    function render() {
      const sym = (v) => (v === '-' ? '–' : v || '·');
      tbl.innerHTML = `<thead><tr><th class="td-dt-h">Условия</th>${cols.map((c, j) => `<th>R${j + 1}<button type="button" class="td-x" data-del="${j}" aria-label="Удалить правило R${j + 1}">×</button></th>`).join('')}</tr></thead>
        <tbody>${P.conds.map((c, i) => `<tr><th>${esc(c)}</th>${cols.map((col, j) => `<td><button type="button" class="td-cell v${col.c[i] === '-' ? 'D' : col.c[i]}" data-c="${i}" data-j="${j}" aria-label="${esc(c)}, R${j + 1}">${sym(col.c[i])}</button></td>`).join('')}</tr>`).join('')}
        <tr class="td-dt-sep"><th>Действия</th>${cols.map(() => '<td></td>').join('')}</tr>
        ${P.acts.map((a, i) => `<tr><th>${esc(a)}</th>${cols.map((col, j) => `<td><button type="button" class="td-cell act${col.a[i] ? ' on' : ''}" data-a="${i}" data-j="${j}" aria-label="${esc(a)}, R${j + 1}">${col.a[i] ? '✕' : ''}</button></td>`).join('')}</tr>`).join('')}</tbody>`;
      tbl.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { const col = cols[+b.dataset.j]; col.c[+b.dataset.c] = NEXT[col.c[+b.dataset.c]]; render(); }));
      tbl.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { const col = cols[+b.dataset.j]; col.a[+b.dataset.a] = !col.a[+b.dataset.a]; render(); }));
      tbl.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { cols.splice(+b.dataset.del, 1); render(); }));
      box.querySelector('.td-live').textContent = `Правил: ${cols.length}`;
    }
    box.querySelector('.td-add-col').addEventListener('click', () => { cols.push(blank()); render(); });
    render();

    const combos = [];
    for (let m = 0; m < 1 << n; m++) combos.push(P.conds.map((c, i) => !((m >> (n - 1 - i)) & 1)));
    const key = (cb) => cb.map((b) => (b ? 'Y' : 'N')).join('');
    const expand = (col) => combos.filter((cb) => col.c.every((v, i) => v === '-' || (v === 'Y') === cb[i]));
    const actKey = (arr) => arr.slice().sort().join(',');

    box.querySelector('.td-check').addEventListener('click', () => {
      const out = [];
      const flags = {};
      const incomplete = cols.map((c, j) => j).filter((j) => cols[j].c.some((v) => v === ''));
      incomplete.forEach((j) => out.push(bad(`R${j + 1}: заполни все условия.`)));
      const cover = {};
      cols.forEach((col, j) => { if (!incomplete.includes(j)) expand(col).forEach((cb) => { (cover[key(cb)] = cover[key(cb)] || []).push(j); }); });
      const possible = combos.filter((cb) => P.fn(cb) !== null);
      const seen = new Set();
      let overlaps = 0;
      possible.forEach((cb) => {
        const js = cover[key(cb)];
        if (js && js.length > 1) {
          const k = js.join('-');
          if (!seen.has(k)) { seen.add(k); overlaps++; out.push(bad(`${js.map((j) => 'R' + (j + 1)).join(' и ')} описывают одну и ту же комбинацию условий.`)); }
        }
      });
      const unc = possible.filter((cb) => !cover[key(cb)]).length;
      if (unc) out.push(bad(`Не покрыто ${unc} ${plural(unc, 'комбинация', 'комбинации', 'комбинаций')} условий.`));
      const impossibleCols = cols.map((c, j) => j).filter((j) => !incomplete.includes(j) && expand(cols[j]).every((cb) => P.fn(cb) === null));
      impossibleCols.forEach((j) => out.push(bad(`R${j + 1} описывает невозможную комбинацию условий.`)));
      flags.combos = cols.length > 0 && !incomplete.length && !overlaps && !unc && !impossibleCols.length;
      const noDash = cols.every((c) => !c.c.includes('-'));
      flags.combosFull = flags.combos && noDash;
      if (flags.combos) out.push(ok('Комбинации условий: полный набор без пересечений.'));
      if (flags.combos) {
        let actsOk = true;
        cols.forEach((col, j) => {
          const keys = new Set(expand(col).filter((cb) => P.fn(cb) !== null).map((cb) => actKey(P.fn(cb))));
          const mine = actKey(col.a.map((v, i) => (v ? i : -1)).filter((i) => i >= 0));
          if (keys.size > 1) { actsOk = false; out.push(bad(`R${j + 1}: «–» стоит там, где от условия зависит результат — такие правила объединять нельзя.`)); } else if (!keys.has(mine)) { actsOk = false; out.push(bad(`R${j + 1}: действия не соответствуют требованиям.`)); }
        });
        flags.actions = actsOk;
        if (actsOk) out.push(ok('Действия во всех правилах верны.'));
      }
      flags.full = !!flags.actions && noDash;
      flags.reduced = !!flags.actions && P.target != null && cols.length <= P.target;
      if (flags.actions && P.target != null) out.push(flags.reduced ? ok(`Таблица сокращена: ${cols.length} ${plural(cols.length, 'правило', 'правила', 'правил')}.`) : bad(`Правил ${cols.length}. Сократи до ${P.target}: объединяй правила, которые отличаются одним условием и дают одинаковые действия.`));
      showFb(box, out);
      api.emit(flags);
    });
  };

  // ---------- переходы состояний ----------
  // P: { states: [{ id, label, x, y }], init, vb: [w, h], trans: [{ id, from, to, ev, bend?, loop? }],
  //      events?: [..] и table?: true — сначала построить таблицу переходов; tableStates?;
  //      maxTests?, maxStateTests?, neg?: [[stateId, ev]] — кандидаты в негативные тесты }
  W.st = function (box, P, api) {
    const S = {};
    P.states.forEach((s) => { S[s.id] = s; });
    const T = P.trans;
    const NW = 116, NH = 38;
    let tableOk = !P.table;
    let path = [];
    const tests = [];
    const negSel = new Set();
    const tStates = P.tableStates ? P.tableStates.map((id) => S[id]) : P.states;
    const target = (sid, ev) => { const t = T.find((x) => x.from === sid && x.ev === ev); return t ? t.to : ''; };
    const label = (t) => `${S[t.from].label} —${t.ev}→ ${S[t.to].label}`;

    box.innerHTML = card(P.title || 'Диаграмма состояний', `
      ${P.table ? `<div class="td-st-table"><p class="td-sub"><b>1.</b> Построй таблицу переходов: в какое состояние ведёт событие. «—» — событие в этом состоянии ничего не меняет / недопустимо.</p>
        <div class="td-scroll"><table class="td-tbl td-tt"><thead><tr><th>Состояние \\ событие</th>${P.events.map((e) => `<th>${esc(e)}</th>`).join('')}</tr></thead><tbody>
        ${tStates.map((s) => `<tr><th>${esc(s.label)}</th>${P.events.map((e, k) => `<td><select data-tt="${s.id}|${k}" aria-label="${esc(s.label)}: ${esc(e)}"><option value="">—</option>${P.states.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join('')}</select></td>`).join('')}</tr>`).join('')}
        </tbody></table></div></div>` : ''}
      <div class="td-graph"></div>
      <div class="td-builder"></div>
      ${P.neg ? `<div class="td-neg"><p class="td-sub"><b>Негативные тесты.</b> Отметь пары «состояние + событие», которые система должна отклонить (перехода нет).</p>
        <div class="td-chips">${P.neg.map((p, i) => `<button type="button" class="td-chip" data-neg="${i}" aria-pressed="false">${esc(S[p[0]].label)} + «${esc(p[1])}»</button>`).join('')}</div></div>` : ''}`);
    const graphEl = box.querySelector('.td-graph');
    const builderEl = box.querySelector('.td-builder');
    const cur = () => (path.length ? T.find((t) => t.id === path[path.length - 1]).to : P.init);
    const covered = () => new Set([].concat(...tests));

    function clip(cx, cy, tx, ty) {
      const dx = tx - cx, dy = ty - cy;
      const s = Math.min(dx ? (NW / 2 + 3) / Math.abs(dx) : 1e9, dy ? (NH / 2 + 3) / Math.abs(dy) : 1e9);
      return [cx + dx * s, cy + dy * s];
    }
    function edgeGeom(t) {
      const a = S[t.from], b = S[t.to];
      if (t.from === t.to) {
        const L = t.loop || 'top';
        if (L === 'top') { const y = a.y - NH / 2; return { d: `M${a.x - 16},${y} C${a.x - 34},${y - 46} ${a.x + 34},${y - 46} ${a.x + 16},${y}`, lx: a.x, ly: y - 38 }; }
        if (L === 'bottom') { const y = a.y + NH / 2; return { d: `M${a.x + 16},${y} C${a.x + 34},${y + 46} ${a.x - 34},${y + 46} ${a.x - 16},${y}`, lx: a.x, ly: y + 38 }; }
        const x = L === 'right' ? a.x + NW / 2 : a.x - NW / 2, k = L === 'right' ? 1 : -1;
        return { d: `M${x},${a.y - 10} C${x + k * 50},${a.y - 30} ${x + k * 50},${a.y + 30} ${x},${a.y + 10}`, lx: x + k * 40, ly: a.y };
      }
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const bend = t.bend || 0;
      const cx = mx - ((b.y - a.y) / len) * bend, cy = my + ((b.x - a.x) / len) * bend;
      const [sx, sy] = clip(a.x, a.y, cx, cy);
      const [ex, ey] = clip(b.x, b.y, cx, cy);
      return { d: `M${sx},${sy} Q${cx},${cy} ${ex},${ey}`, lx: 0.25 * sx + 0.5 * cx + 0.25 * ex, ly: 0.25 * sy + 0.5 * cy + 0.25 * ey };
    }
    function renderGraph(miss) {
      if (!tableOk) { graphEl.innerHTML = '<p class="td-ph">Диаграмма появится, когда таблица переходов будет верной.</p>'; return; }
      const cov = covered();
      const c = cur();
      const avail = new Set(T.filter((t) => t.from === c).map((t) => t.id));
      const inPath = new Set(path);
      const [w, h] = P.vb;
      let edges = '', labels = '';
      T.forEach((t) => {
        const g = edgeGeom(t);
        const cls = `edge${cov.has(t.id) ? ' cov' : ''}${inPath.has(t.id) ? ' path' : ''}${avail.has(t.id) ? ' avail' : ''}${miss && miss.has(t.id) ? ' miss' : ''}`;
        edges += `<g class="${cls}" data-t="${t.id}"><path class="hit" d="${g.d}"></path><path class="ln" d="${g.d}" marker-end="url(#td-ar-${P.uid})"></path></g>`;
        const tw = t.ev.length * 6.3 + 10;
        if (t.from === t.to && (t.loop === 'right' || t.loop === 'left')) g.lx += (t.loop === 'right' ? 1 : -1) * (tw / 2 - 4);
        labels += `<g class="elabel${avail.has(t.id) ? ' avail' : ''}${cov.has(t.id) ? ' cov' : ''}" data-t="${t.id}"><rect x="${g.lx - tw / 2}" y="${g.ly - 9}" width="${tw}" height="17" rx="4"></rect><text x="${g.lx}" y="${g.ly + 4}">${esc(t.ev)}</text></g>`;
      });
      const visited = new Set([P.init]);
      tests.forEach((ts) => ts.forEach((id) => visited.add(T.find((t) => t.id === id).to)));
      const nodes = P.states.map((s) => `<g class="node${s.id === c ? ' cur' : ''}${visited.has(s.id) ? ' vis' : ''}${s.id === P.init ? ' init' : ''}"><rect x="${s.x - NW / 2}" y="${s.y - NH / 2}" width="${NW}" height="${NH}" rx="9"></rect><text x="${s.x}" y="${s.y + 4.5}">${esc(s.label)}</text></g>`).join('');
      graphEl.innerHTML = `<div class="td-scroll"><svg class="td-svg" viewBox="0 0 ${w} ${h}" style="min-width:${Math.round(w * 0.82)}px;max-width:${Math.round(w * 1.2)}px" role="img" aria-label="Диаграмма состояний">
        <defs><marker id="td-ar-${P.uid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrow"></path></marker></defs>
        ${edges}${nodes}${labels}</svg></div>`;
      graphEl.querySelectorAll('[data-t]').forEach((g) => g.addEventListener('click', () => step(g.dataset.t)));
    }
    function step(id) {
      const t = T.find((x) => x.id === id);
      if (!t || t.from !== cur()) return;
      path.push(id);
      render();
    }
    function renderBuilder() {
      if (!tableOk) { builderEl.innerHTML = ''; return; }
      const c = cur();
      const outs = T.filter((t) => t.from === c);
      const cov = covered();
      builderEl.innerHTML = `
        <p class="td-sub"><b>${P.table ? 2 : 1}.</b> Собери тест: начни с «${esc(S[P.init].label)}» и кликай по стрелкам (или по кнопкам событий). Каждый тест — один путь.</p>
        <div class="td-path"><span class="td-st-chip">${esc(S[P.init].label)}</span>${path.map((id) => { const t = T.find((x) => x.id === id); return `<span class="td-ev">${esc(t.ev)}</span><span class="td-st-chip">${esc(S[t.to].label)}</span>`; }).join('')}</div>
        <div class="td-evs">${outs.length ? outs.map((t) => `<button type="button" class="td-evbtn" data-step="${t.id}">${esc(t.ev)} → ${esc(S[t.to].label)}</button>`).join('') : '<span class="td-ph">Из этого состояния переходов нет.</span>'}</div>
        <div class="td-row-btns"><button type="button" class="btn td-save"${path.length ? '' : ' disabled'}>Сохранить тест</button><button type="button" class="ghost-btn td-reset"${path.length ? '' : ' disabled'}>Сбросить путь</button><button type="button" class="ghost-btn td-undo"${path.length ? '' : ' disabled'}>↶ Шаг назад</button></div>
        <ol class="td-tests">${tests.map((ts, i) => `<li><span>${esc(S[P.init].label)} ${ts.map((id) => { const t = T.find((x) => x.id === id); return `→ <i>${esc(t.ev)}</i> → ${esc(S[t.to].label)}`; }).join(' ')}</span><button type="button" class="td-x" data-rmt="${i}" aria-label="Удалить тест ${i + 1}">×</button></li>`).join('')}</ol>`;
      box.querySelector('.td-live').textContent = `Тестов: ${tests.length} · переходов покрыто: ${T.filter((t) => cov.has(t.id)).length} / ${T.length}`;
      builderEl.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => step(b.dataset.step)));
      builderEl.querySelector('.td-save').addEventListener('click', () => {
        if (!path.length) return;
        tests.push(path);
        const visits = [P.init].concat(path.map((id) => T.find((t) => t.id === id).to));
        path = [];
        render();
        api.emit({ saved: true, visits });
      });
      builderEl.querySelector('.td-reset').addEventListener('click', () => { path = []; render(); });
      builderEl.querySelector('.td-undo').addEventListener('click', () => { path.pop(); render(); });
      builderEl.querySelectorAll('[data-rmt]').forEach((b) => b.addEventListener('click', () => { tests.splice(+b.dataset.rmt, 1); render(); }));
    }
    function render(miss) { renderGraph(miss); renderBuilder(); }
    box.querySelectorAll('[data-neg]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.neg;
      if (negSel.has(i)) negSel.delete(i); else negSel.add(i);
      b.classList.toggle('on', negSel.has(i));
      b.setAttribute('aria-pressed', negSel.has(i));
    }));
    render();

    box.querySelector('.td-check').addEventListener('click', () => {
      const out = [];
      const flags = {};
      if (P.table && !tableOk) {
        let wrong = 0;
        box.querySelectorAll('[data-tt]').forEach((s) => {
          const [sid, k] = s.dataset.tt.split('|');
          const good = s.value === target(sid, P.events[+k]);
          s.classList.toggle('err', false);
          if (!good) wrong++;
        });
        if (wrong) {
          const rows = tStates.filter((s) => P.events.some((e, k) => box.querySelector(`[data-tt="${s.id}|${k}"]`).value !== target(s.id, e)));
          out.push(bad(`Неверно заполнено ячеек: ${wrong}. Ошибки в строках: ${rows.map((s) => '«' + esc(s.label) + '»').join(', ')}.`));
          showFb(box, out);
          api.emit({ table: false });
          return;
        }
        tableOk = true;
        box.querySelectorAll('[data-tt]').forEach((s) => { s.disabled = true; });
        out.push(ok('Таблица переходов верна — по ней построена диаграмма.'));
        flags.table = true;
        render();
        showFb(box, out);
        api.emit(flags);
        return;
      }
      flags.table = true;
      const cov = covered();
      const miss = new Set(T.filter((t) => !cov.has(t.id)).map((t) => t.id));
      const visited = new Set([P.init]);
      tests.forEach((ts) => ts.forEach((id) => visited.add(T.find((t) => t.id === id).to)));
      const unv = P.states.filter((s) => !visited.has(s.id));
      if (!tests.length) out.push(bad('Сохранённых тестов нет: собери путь и нажми «Сохранить тест».'));
      if (path.length) out.push(bad('Текущий путь не сохранён — он не учитывается.'));
      flags.states = tests.length > 0 && !unv.length;
      flags.statesMin = flags.states && (P.maxStateTests == null || tests.length <= P.maxStateTests);
      if (P.maxStateTests != null && tests.length) {
        if (unv.length) out.push(bad(`Не посещены состояния: ${unv.map((s) => '«' + esc(s.label) + '»').join(', ')}.`));
        else out.push(ok('Покрытие состояний: все состояния посещены.'));
      }
      flags.trans = tests.length > 0 && !miss.size;
      flags.transMin = flags.trans && (P.maxTests == null || tests.length <= P.maxTests);
      if (tests.length) {
        if (miss.size) out.push(bad(`Не покрыто переходов: ${miss.size} — ${T.filter((t) => miss.has(t.id)).map((t) => esc(label(t))).join('; ')}.`));
        else out.push(ok(`Покрытие переходов (0-switch): все ${T.length} ${plural(T.length, 'переход', 'перехода', 'переходов')}.`));
        if (flags.trans && P.maxTests != null) out.push(flags.transMin ? ok(`Тестов: ${tests.length} — минимально.`) : bad(`Тестов ${tests.length}. Можно уложиться в ${P.maxTests}: длинные пути покрывают больше переходов.`));
      }
      if (P.neg) {
        const isInv = (p) => !T.some((t) => t.from === p[0] && t.ev === p[1]);
        const missN = P.neg.filter((p, i) => isInv(p) && !negSel.has(i)).length;
        const extraN = P.neg.filter((p, i) => !isInv(p) && negSel.has(i)).length;
        if (missN) out.push(bad(`Негативные тесты: пропущено недопустимых переходов — ${missN}.`));
        if (extraN) out.push(bad(`Негативные тесты: отмечено допустимых переходов — ${extraN}. Сверься с диаграммой.`));
        flags.neg = !missN && !extraN;
        if (flags.neg) out.push(ok('Недопустимые переходы найдены верно.'));
      }
      renderGraph(miss.size && tests.length ? miss : null);
      showFb(box, out);
      api.emit(flags);
    });
  };

  // ---------- pairwise ----------
  // P: { params: [{ name, vals }], forbid?(row → значения) → текст | null, maxRows, rows? }
  W.pw = function (box, P, api) {
    const K = P.params.length;
    const rows = Array.from({ length: P.rows || 2 }, () => P.params.map(() => -1));
    // Все допустимые полные комбинации → какие пары вообще достижимы
    const all = [];
    (function gen(i, acc) {
      if (i === K) { if (!P.forbid || !P.forbid(acc.map((v, k) => P.params[k].vals[v]))) all.push(acc.slice()); return; }
      P.params[i].vals.forEach((v, k) => { acc.push(k); gen(i + 1, acc); acc.pop(); });
    })(0, []);
    const pk = (p, a, q, b) => `${p}:${a}|${q}:${b}`;
    const need = new Map();
    all.forEach((r) => { for (let p = 0; p < K; p++) for (let q = p + 1; q < K; q++) need.set(pk(p, r[p], q, r[q]), [p, r[p], q, r[q]]); });
    const named = (r) => r.map((v, k) => P.params[k].vals[v]);
    const forbidMsg = (r) => (P.forbid && r.every((v) => v >= 0) ? P.forbid(named(r)) : null);

    box.innerHTML = card(P.title || 'Pairwise', `
      <p class="td-sub">Каждая строка — один тест (комбинация значений). Цель — каждая пара значений любых двух параметров хотя бы в одной строке.</p>
      <div class="td-scroll"><table class="td-tbl td-pw"></table></div>
      <div class="td-row-btns"><button class="ghost-btn td-add-row" type="button">+ Строка</button></div>
      <div class="td-unc"></div>`);
    const tbl = box.querySelector('.td-pw');
    function coveredSet() {
      const s = new Set();
      rows.forEach((r) => {
        if (r.some((v) => v < 0) || forbidMsg(r)) return;
        for (let p = 0; p < K; p++) for (let q = p + 1; q < K; q++) s.add(pk(p, r[p], q, r[q]));
      });
      return s;
    }
    function live() {
      const c = coveredSet();
      box.querySelector('.td-live').textContent = `Строк: ${rows.length} · пар покрыто: ${[...need.keys()].filter((k) => c.has(k)).length} / ${need.size}`;
    }
    function render(marks) {
      tbl.innerHTML = `<thead><tr><th>#</th>${P.params.map((p) => `<th>${esc(p.name)}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map((r, i) => `
        <tr class="${marks && marks[i] ? marks[i] : ''}"><td class="num">${i + 1}</td>${P.params.map((p, k) => `<td><select data-r="${i}" data-k="${k}" aria-label="Строка ${i + 1}: ${esc(p.name)}"><option value="-1">—</option>${p.vals.map((v, j) => `<option value="${j}"${r[k] === j ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></td>`).join('')}
        <td><button type="button" class="td-x" data-rmr="${i}" aria-label="Удалить строку ${i + 1}">×</button></td></tr>`).join('')}</tbody>`;
      tbl.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => { rows[+s.dataset.r][+s.dataset.k] = +s.value; live(); }));
      tbl.querySelectorAll('[data-rmr]').forEach((b) => b.addEventListener('click', () => { rows.splice(+b.dataset.rmr, 1); render(); }));
      live();
    }
    box.querySelector('.td-add-row').addEventListener('click', () => { rows.push(P.params.map(() => -1)); render(); });
    render();

    box.querySelector('.td-check').addEventListener('click', () => {
      const out = [];
      const marks = {};
      const inc = rows.map((r, i) => i).filter((i) => rows[i].some((v) => v < 0));
      if (inc.length) out.push(bad(`Строки заполнены не полностью: ${inc.map((i) => i + 1).join(', ')}.`));
      inc.forEach((i) => { marks[i] = 'warn'; });
      let forb = 0;
      rows.forEach((r, i) => { const m = forbidMsg(r); if (m) { forb++; marks[i] = 'bad'; out.push(bad(`Строка ${i + 1}: ${esc(m)}`)); } });
      const seen = {};
      let dups = 0;
      rows.forEach((r, i) => { if (r.some((v) => v < 0)) return; const k = r.join(','); if (seen[k] != null) { dups++; marks[i] = 'warn'; out.push(bad(`Строка ${i + 1} повторяет строку ${seen[k] + 1}.`)); } else seen[k] = i; });
      const c = coveredSet();
      const unc = [...need.entries()].filter(([k]) => !c.has(k)).map(([, v]) => v);
      const uncEl = box.querySelector('.td-unc');
      uncEl.innerHTML = unc.length ? `<p class="td-sub">Не покрыты пары (${unc.length}):</p><div class="td-chips">${unc.map(([p, a, q, b]) => `<span class="td-tag i">${esc(P.params[p].name)}: ${esc(P.params[p].vals[a])} × ${esc(P.params[q].name)}: ${esc(P.params[q].vals[b])}</span>`).join('')}</div>` : '';
      if (unc.length) out.push(bad(`Не покрыто пар: ${unc.length} из ${need.size} (список под таблицей).`));
      const cover = rows.length > 0 && !inc.length && !forb && !unc.length;
      if (cover) out.push(ok(`Все ${need.size} допустимых пар покрыты.`));
      const min = cover && !dups && rows.length <= P.maxRows;
      if (cover && rows.length > P.maxRows) out.push(bad(`Строк ${rows.length} — уложись в ${P.maxRows}: убери строки, все пары которых уже есть в других.`));
      if (min) out.push(ok(`Набор из ${rows.length} строк покрывает все пары (полный перебор — ${all.length}).`));
      render(marks);
      showFb(box, out);
      api.emit({ cover, min });
    });
  };

  // ---------- предугадывание ошибок: «живое» поле с дефектами ----------
  // P: { mode: 'text'|'files', label, placeholder?, gen?, files?: [{ name, meta }], run(input) → { ok, out (HTML), bug? }, bugs: [{ id, title }] }
  W.bug = function (box, P, api) {
    const found = new Set();
    const entries = [];
    let file = -1;
    box.innerHTML = `<div class="td-card">
      <h3 class="td-h">${P.title || 'Исследуем поле'}</h3>
      <div class="td-app">
        ${P.mode === 'files'
          ? `<p class="td-app-l">${esc(P.label)}</p><div class="td-files">${P.files.map((f, i) => `<button type="button" class="td-file" data-file="${i}"><b>${esc(f.name)}</b><small>${esc(f.meta)}</small></button>`).join('')}</div>
             <div class="td-row-btns"><button type="button" class="btn td-run">Загрузить</button></div>`
          : `<label class="td-app-l" for="td-bug-in-${P.uid}">${esc(P.label)}</label>
             <div class="td-add"><input id="td-bug-in-${P.uid}" type="text" class="td-bug-in" placeholder="${esc(P.placeholder || '')}" autocomplete="off" spellcheck="false"><button type="button" class="btn td-run">Сохранить</button></div>
             ${P.gen ? `<div class="td-gen"><span>Генератор: строка из букв длиной</span><input type="number" min="1" max="500" value="50" class="td-gen-n" aria-label="Длина строки"><button type="button" class="ghost-btn td-gen-btn">Вставить</button></div>` : ''}`}
      </div>
      <p class="td-sub">Ответы системы. Если поведение расходится с требованиями — жми <b>🐞 Баг</b>.</p>
      <ol class="td-log"><li class="td-ph">Пока пусто.</li></ol>
      <div class="td-found"></div>
      <p class="td-note" hidden></p>
    </div>`;
    const logEl = box.querySelector('.td-log');
    const note = box.querySelector('.td-note');
    const say = (t, good) => { note.hidden = false; note.className = 'td-note ' + (good ? 'ok' : 'bad'); note.innerHTML = t; };
    function renderFound() {
      box.querySelector('.td-found').innerHTML = `<p class="td-sub">Найдено дефектов: <b>${found.size}</b> из ${P.bugs.length}</p>${found.size ? `<ul class="td-bugs">${P.bugs.filter((b) => found.has(b.id)).map((b) => `<li>🐞 ${esc(b.title)}</li>`).join('')}</ul>` : ''}`;
    }
    function renderLog() {
      logEl.innerHTML = entries.length ? entries.map((e, i) => `<li class="${e.res.ok ? 'ok' : 'err'}"><div class="td-log-in">${P.mode === 'files' ? esc(P.files[e.input].name) : `«${vis(e.input)}»` + (e.input.length > 12 ? ` <small>(${e.input.length} симв.)</small>` : '')}</div>
        <div class="td-log-out">${e.res.out}</div><button type="button" class="ghost-btn td-rep" data-rep="${i}">🐞 Баг</button></li>`).join('') : '<li class="td-ph">Пока пусто.</li>';
      logEl.querySelectorAll('[data-rep]').forEach((b) => b.addEventListener('click', () => {
        const e = entries[+b.dataset.rep];
        if (e.res.bug) {
          if (found.has(e.res.bug)) { say('Этот дефект уже в списке — ищи другой.', false); return; }
          found.add(e.res.bug);
          say(`Дефект зафиксирован: ${esc(P.bugs.find((x) => x.id === e.res.bug).title)}.`, true);
          renderFound();
          api.emit({ count: found.size, ['bug_' + e.res.bug]: true });
        } else {
          say('Это поведение соответствует требованиям — не дефект.', false);
          api.emit({ falseReport: true, count: found.size });
        }
      }));
    }
    function run() {
      let input;
      if (P.mode === 'files') { if (file < 0) { say('Выбери файл.', false); return; } input = file; } else input = box.querySelector('.td-bug-in').value;
      const res = P.run(P.mode === 'files' ? P.files[input] : input);
      entries.unshift({ input, res });
      if (entries.length > 30) entries.pop();
      note.hidden = true;
      renderLog();
      if (res.ok && !res.bug) api.emit({ valid: true, count: found.size });
    }
    box.querySelector('.td-run').addEventListener('click', run);
    const inp = box.querySelector('.td-bug-in');
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    const gb = box.querySelector('.td-gen-btn');
    if (gb) gb.addEventListener('click', () => {
      const n = Math.max(1, Math.min(500, parseInt(box.querySelector('.td-gen-n').value, 10) || 1));
      const abc = 'Abcdefghijklmnopqrstuvwxyz';
      inp.value = Array.from({ length: n }, (x, i) => abc[i % 26]).join('');
    });
    box.querySelectorAll('[data-file]').forEach((b) => b.addEventListener('click', () => {
      file = +b.dataset.file;
      box.querySelectorAll('[data-file]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    renderFound();
  };

  // ---------- чек-лист ----------
  // P: { groups: { key: 'Название' }, items: [{ t, g?, trap? }] } — g: обязательная группа; trap: почему пункт лишний
  W.cl = function (box, P, api) {
    const sel = new Set();
    box.innerHTML = card(P.title || 'Чек-лист', `
      <p class="td-sub">Отметь пункты, которые войдут в чек-лист. Не всё из списка относится к объекту и требованиям.</p>
      <div class="td-cl">${P.items.map((it, i) => `<button type="button" class="td-cl-item" data-cl="${i}" aria-pressed="false"><span class="td-box" aria-hidden="true"></span><span>${esc(it.t)}</span></button>`).join('')}</div>`);
    const upd = () => { box.querySelector('.td-live').textContent = `В чек-листе: ${sel.size}`; };
    box.querySelectorAll('[data-cl]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.cl;
      if (sel.has(i)) sel.delete(i); else sel.add(i);
      b.classList.toggle('on', sel.has(i));
      b.setAttribute('aria-pressed', sel.has(i));
      upd();
    }));
    upd();
    box.querySelector('.td-check').addEventListener('click', () => {
      const out = [];
      const flags = {};
      let allG = true;
      Object.keys(P.groups).forEach((g) => {
        const miss = P.items.filter((it, i) => it.g === g && !it.trap && !sel.has(i)).length;
        flags['g_' + g] = !miss;
        if (miss) { allG = false; out.push(bad(`${esc(P.groups[g])}: не хватает ${miss} ${plural(miss, 'проверки', 'проверок', 'проверок')}.`)); } else out.push(ok(`${esc(P.groups[g])}: всё на месте.`));
      });
      const traps = P.items.filter((it, i) => it.trap && sel.has(i));
      traps.forEach((it) => out.push(bad(`Лишнее: «${esc(it.t)}» — ${esc(it.trap)}`)));
      flags.traps = !traps.length;
      flags.all = allG && !traps.length;
      showFb(box, out);
      api.emit(flags);
    });
  };

  // ---------- ревью тест-кейса ----------
  // P: { types: ['Без ошибок', ...], lines: [{ k, t, bad?: индекс типа }] }
  W.tcr = function (box, P, api) {
    box.innerHTML = card(P.title || 'Ревью тест-кейса', `
      <p class="td-sub">Для каждой строки выбери, есть ли в ней ошибка и какая.</p>
      <div class="td-tc">${P.lines.map((l, i) => `<div class="td-tc-row"><div class="td-tc-k">${esc(l.k)}</div><div class="td-tc-t">${esc(l.t)}</div>
        <select data-tcr="${i}" aria-label="Ошибка в строке «${esc(l.k)}»">${P.types.map((t, k) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></div>`).join('')}</div>`);
    box.querySelector('.td-check').addEventListener('click', () => {
      const out = [];
      const v = [...box.querySelectorAll('[data-tcr]')].map((s) => +s.value);
      const missed = P.lines.filter((l, i) => l.bad && !v[i]).length;
      const extra = P.lines.filter((l, i) => !l.bad && v[i]);
      const wrongType = P.lines.filter((l, i) => l.bad && v[i] && v[i] !== l.bad).length;
      if (missed) out.push(bad(`Пропущено строк с ошибками: ${missed}.`));
      extra.forEach((l) => out.push(bad(`Строка «${esc(l.k)}» в порядке — ошибки в ней нет.`)));
      const found = !missed && !extra.length;
      if (found) out.push(ok('Все проблемные строки найдены.'));
      if (found && wrongType) out.push(bad(`Тип ошибки указан неверно в ${wrongType} ${plural(wrongType, 'строке', 'строках', 'строках')}.`));
      const typed = found && !wrongType;
      if (typed) out.push(ok('Типы ошибок определены верно.'));
      showFb(box, out);
      api.emit({ found, typed });
    });
  };

  // ---------- сборка тест-кейса ----------
  // P: { name, frags: [{ t, sec: 'pre'|'step'|'exp'|'none', order? }] }
  const SECS = [['pre', 'Предусловие'], ['step', 'Шаг'], ['exp', 'Ожидаемый результат'], ['none', 'Не относится']];
  W.tcb = function (box, P, api) {
    const asg = P.frags.map(() => '');
    let order = [];
    box.innerHTML = card(P.title || 'Сборка тест-кейса', `
      <p class="td-sub">Разнеси фрагменты по разделам. Шаги выстрой по порядку стрелками ↑↓ в превью.</p>
      <div class="td-frags">${P.frags.map((f, i) => `<div class="td-frag"><span>${esc(f.t)}</span><select data-frag="${i}" aria-label="Раздел для фрагмента ${i + 1}"><option value="">— раздел —</option>${SECS.map((s) => `<option value="${s[0]}">${s[1]}</option>`).join('')}</select></div>`).join('')}</div>
      <div class="td-tc-prev"></div>`);
    const prev = box.querySelector('.td-tc-prev');
    function render() {
      const list = (sec) => P.frags.map((f, i) => i).filter((i) => asg[i] === sec);
      prev.innerHTML = `<p class="td-tc-name">${esc(P.name)}</p>
        <p class="td-sub"><b>Предусловия</b></p><ul>${list('pre').map((i) => `<li>${esc(P.frags[i].t)}</li>`).join('') || '<li class="td-ph">—</li>'}</ul>
        <p class="td-sub"><b>Шаги</b></p><ol class="td-steps-ord">${order.map((i, k) => `<li><span>${esc(P.frags[i].t)}</span><span class="td-ord"><button type="button" data-up="${k}" aria-label="Выше"${k ? '' : ' disabled'}>↑</button><button type="button" data-dn="${k}" aria-label="Ниже"${k < order.length - 1 ? '' : ' disabled'}>↓</button></span></li>`).join('') || '<li class="td-ph">—</li>'}</ol>
        <p class="td-sub"><b>Ожидаемый результат</b></p><ul>${list('exp').map((i) => `<li>${esc(P.frags[i].t)}</li>`).join('') || '<li class="td-ph">—</li>'}</ul>`;
      prev.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => { const k = +b.dataset.up; [order[k - 1], order[k]] = [order[k], order[k - 1]]; render(); }));
      prev.querySelectorAll('[data-dn]').forEach((b) => b.addEventListener('click', () => { const k = +b.dataset.dn; [order[k + 1], order[k]] = [order[k], order[k + 1]]; render(); }));
    }
    box.querySelectorAll('[data-frag]').forEach((s) => s.addEventListener('change', () => {
      const i = +s.dataset.frag;
      asg[i] = s.value;
      order = order.filter((x) => x !== i);
      if (s.value === 'step') order.push(i);
      render();
    }));
    render();
    box.querySelector('.td-check').addEventListener('click', () => {
      const out = [];
      const flags = {};
      const un = asg.filter((a) => !a).length;
      if (un) out.push(bad(`Не распределено фрагментов: ${un}.`));
      SECS.forEach(([sec, name]) => {
        const miss = P.frags.filter((f, i) => f.sec === sec && asg[i] && asg[i] !== sec).length + P.frags.filter((f, i) => f.sec === sec && !asg[i]).length;
        const extra = P.frags.filter((f, i) => asg[i] === sec && f.sec !== sec).length;
        flags[sec] = !miss && !extra;
        if (extra) out.push(bad(`«${name}»: лишних фрагментов — ${extra}.`));
        if (miss && !extra && sec !== 'none') out.push(bad(`«${name}»: не хватает фрагментов — ${miss}.`));
      });
      if (flags.step) {
        const right = P.frags.map((f, i) => i).filter((i) => P.frags[i].sec === 'step').sort((a, b) => P.frags[a].order - P.frags[b].order);
        flags.steps = order.join() === right.join();
        if (!flags.steps) out.push(bad('Шаги на месте, но порядок неверный.'));
      } else flags.steps = false;
      flags.all = !un && flags.pre && flags.steps && flags.exp && flags.none;
      if (flags.pre) out.push(ok('Предусловия верны.'));
      if (flags.steps) out.push(ok('Шаги верны и в правильном порядке.'));
      if (flags.exp) out.push(ok('Ожидаемый результат верен.'));
      if (flags.all) out.push(ok('Тест-кейс собран.'));
      showFb(box, out);
      api.emit(flags);
    });
  };

  // ---------- сценарии Given-When-Then ----------
  // P: { given, when, then: [..], valid: [{ g, w, t, ac }], acs: [ид критериев, которые надо покрыть] }
  W.gwt = function (box, P, api) {
    const rows = [[-1, -1, -1]];
    box.innerHTML = card(P.title || 'Сценарии приёмки', `
      <p class="td-sub">Каждый сценарий: <b>Given</b> (исходное состояние) → <b>When</b> (действие) → <b>Then</b> (проверяемый результат).</p>
      <div class="td-gwt"></div>
      <div class="td-row-btns"><button class="ghost-btn td-add-sc" type="button">+ Сценарий</button></div>`);
    const wrap = box.querySelector('.td-gwt');
    const KW = [['Given', 'given'], ['When', 'when'], ['Then', 'then']];
    function render(marks) {
      wrap.innerHTML = rows.map((r, i) => `<div class="td-sc${marks && marks[i] ? ' ' + marks[i] : ''}"><div class="td-sc-h"><b>Сценарий ${i + 1}</b><button type="button" class="td-x" data-rms="${i}" aria-label="Удалить сценарий ${i + 1}">×</button></div>
        ${KW.map(([kw, f], k) => `<label class="td-sc-l"><span class="kw">${kw}</span><select data-sc="${i}" data-k="${k}"><option value="-1">— выбери —</option>${P[f].map((o, j) => `<option value="${j}"${r[k] === j ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`).join('')}</div>`).join('');
      wrap.querySelectorAll('[data-sc]').forEach((s) => s.addEventListener('change', () => { rows[+s.dataset.sc][+s.dataset.k] = +s.value; }));
      wrap.querySelectorAll('[data-rms]').forEach((b) => b.addEventListener('click', () => { rows.splice(+b.dataset.rms, 1); render(); }));
      box.querySelector('.td-live').textContent = `Сценариев: ${rows.length}`;
    }
    box.querySelector('.td-add-sc').addEventListener('click', () => { rows.push([-1, -1, -1]); render(); });
    render();
    box.querySelector('.td-check').addEventListener('click', () => {
      const out = [];
      const flags = {};
      const marks = {};
      const cov = new Set();
      let invalid = 0;
      const seen = {};
      rows.forEach((r, i) => {
        if (r.some((v) => v < 0)) { invalid++; marks[i] = 'warn'; out.push(bad(`Сценарий ${i + 1}: заполни Given, When и Then.`)); return; }
        const m = P.valid.find((x) => x.g === r[0] && x.w === r[1] && x.t === r[2]);
        if (!m) {
          invalid++;
          marks[i] = 'bad';
          const sameGW = P.valid.some((x) => x.g === r[0] && x.w === r[1]);
          out.push(bad(`Сценарий ${i + 1}: ${sameGW ? 'Then не следует из Given и When по критериям приёмки' : 'такой ситуации нет в критериях приёмки (или результат в ней не определён)'}.`));
          return;
        }
        const k = r.join(',');
        if (seen[k] != null) { invalid++; marks[i] = 'warn'; out.push(bad(`Сценарий ${i + 1} дублирует сценарий ${seen[k] + 1}.`)); return; }
        seen[k] = i;
        marks[i] = 'good';
        cov.add(m.ac);
        flags['ac_' + m.ac] = true;
      });
      const miss = P.acs.filter((a) => !cov.has(a));
      miss.forEach((a) => out.push(bad(`Не покрыт критерий ${esc(a)}.`)));
      flags.all = !invalid && !miss.length;
      if (flags.all) out.push(ok(`Все критерии (${P.acs.join(', ')}) покрыты корректными сценариями.`));
      render(marks);
      showFb(box, out);
      api.emit(flags);
    });
  };

  // ---------- сборка экрана уровня ----------
  let uid = 0;
  function buildSim(el, ctx, level) {
    const S = level.setup;
    const parts = S.parts;
    el.innerHTML = `<div class="td">
      <section class="td-spec"><p class="eyebrow">Объект тестирования</p>${S.spec}</section>
      ${parts.length > 1 ? `<div class="td-tabs" role="tablist">${parts.map((p, i) => `<button type="button" role="tab" data-tab="${i}" aria-selected="${!i}" class="${i ? '' : 'on'}">${esc(p.tab)}</button>`).join('')}</div>` : ''}
      ${parts.map((p, i) => `<div class="td-part" data-part="${p.id}"${i ? ' hidden' : ''}>${p.spec ? `<div class="td-pspec">${p.spec}</div>` : ''}<div class="td-w"></div></div>`).join('')}
    </div>`;
    parts.forEach((p) => {
      const box = el.querySelector(`.td-part[data-part="${p.id}"] .td-w`);
      W[p.kind](box, Object.assign({ uid: ++uid }, p), { emit: (flags) => ctx.emit({ type: 'check', part: p.id, flags }) });
    });
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      el.querySelectorAll('[data-tab]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
      el.querySelectorAll('.td-part').forEach((d, i) => { d.hidden = i !== +b.dataset.tab; });
    }));
    return {};
  }

  const choice = (options, right, wrong) => ({ kind: 'choice', options, accept: (v) => v === right, wrong });
  const numAns = (n, placeholder, wrong) => ({ kind: 'text', placeholder: placeholder || 'Число', accept: (v) => num(v) === n, wrong });

  // ---------- уровни ----------
  const LEVELS = [];

  LEVELS.push({
    id: 'td-1', title: 'Классы эквивалентности', giver: { name: 'Аналитик Вера', sprite: '👩‍💼' },
    setup: {
      spec: `<p><b>Поле «Возраст»</b> в анкете на страховку.</p><ul>
        <li>Принимается целое число от 18 до 65 включительно.</li>
        <li>Меньше 18 — ошибка «Страхование доступно с 18 лет».</li>
        <li>Больше 65 — ошибка «Старше 65 лет — оформление в офисе».</li>
        <li>Дробное число — «Укажите полное число лет».</li>
        <li>Буквы и символы — «Введите число».</li>
        <li>Пустое поле — «Обязательное поле».</li></ul>`,
      parts: [{
        id: 'a', kind: 'ec',
        classes: [
          { id: 'ok', label: '18–65', type: 'valid' },
          { id: 'x1', label: '18–30', type: 'extra' },
          { id: 'lo', label: 'Меньше 18', type: 'invalid' },
          { id: 'hi', label: 'Больше 65', type: 'invalid' },
          { id: 'x2', label: 'Ровно 18 и ровно 65', type: 'extra' },
          { id: 'fr', label: 'Дробное число', type: 'invalid' },
          { id: 'tx', label: 'Не число (буквы, символы)', type: 'invalid' },
          { id: 'x3', label: '31–65', type: 'extra' },
          { id: 'em', label: 'Пустое поле', type: 'invalid' },
        ],
        values: [
          { v: '25', cls: 'ok' }, { v: '10', cls: 'lo' }, { v: '70', cls: 'hi' }, { v: '40', cls: 'ok' }, { v: '30.5', cls: 'fr' },
          { v: '-3', cls: 'lo' }, { v: 'двадцать', cls: 'tx' }, { v: '', cls: 'em' }, { v: '120', cls: 'hi' }, { v: '#$%', cls: 'tx' }, { v: '18', cls: 'ok' },
        ],
      }],
    },
    gold: 80,
    steps: [
      { id: 'classes', text: 'Размечай классы: <b>Валидный</b>, <b>Невалидный</b> или <b>Лишний</b> (требования его не отличают от другого класса). Нажми «Проверить».', check: F('a', 'classes'), success: 'Классы выделены. Валидный диапазон не дробим: 25 и 40 система обрабатывает одинаково.' },
      { id: 'pick', text: 'Собери тестовые данные: ровно одно значение из каждого класса. «Проверить».', check: F('a', 'pick'), success: 'Минимальный набор: каждый класс покрыт одним тестом.' },
      { id: 'count', text: 'Сколько тестов в минимальном наборе по классам эквивалентности?', answer: numAns(6, 'Число тестов', 'Посчитай классы, которые остались после разметки.') },
    ],
    hints: [
      'Класс — группа значений, на которые система реагирует одинаково. Требования не различают 25 и 40 — значит, 18–30 и 31–65 не отдельные классы. Граница — не класс, это другая техника.',
      'Валидный класс один: «18–65». Невалидных пять: меньше 18, больше 65, дробное, не число, пустое. Остальные три — «Лишний». Затем выбери по одному чипу на каждый из шести классов.',
      'Валидный: «18–65». Невалидные: «Меньше 18», «Больше 65», «Дробное число», «Не число», «Пустое поле». Лишние: «18–30», «Ровно 18 и ровно 65», «31–65». Чипы: 25, 10, 70, 30.5, двадцать, (пусто) → «Проверить». Ответ: 6.',
    ],
    outro: 'Один тест на класс: больше тестов из того же класса почти никогда не находят новых ошибок.',
  });

  LEVELS.push({
    id: 'td-2', title: 'Границы: 2 точки', giver: { name: 'Разработчик Глеб', sprite: '👨‍💻' },
    setup: {
      spec: `<p><b>Поле «Сумма перевода»</b>, целые рубли.</p><ul>
        <li>Допустимо от 100 до 15 000 ₽ включительно.</li>
        <li>Меньше — «Минимальная сумма перевода 100 ₽».</li>
        <li>Больше — «Лимит 15 000 ₽ за операцию».</li></ul>`,
      parts: [{
        id: 'a', kind: 'bva', per: '₽', unit: '₽', step: 1, points: 2,
        bounds: [{ label: 'Минимальная допустимая сумма', v: 100 }, { label: 'Максимальная допустимая сумма', v: 15000 }],
        segments: [{ to: 99, label: '< 100', valid: false }, { from: 100, to: 15000, label: '100 – 15 000', valid: true }, { from: 15001, label: '> 15 000', valid: false }],
        groups: [{ label: '100', vals: [99, 100] }, { label: '15 000', vals: [15000, 15001] }],
      }],
    },
    gold: 89,
    steps: [
      { id: 'bounds', text: 'Определи границы допустимой суммы и нажми «Проверить».', check: F('a', 'bounds') },
      { id: 'pick', text: 'Двухточечный анализ: для каждой границы — крайнее значение класса и ближайшее значение соседнего. Добавь значения, «Проверить».', check: F('a', 'pick'), success: 'Четыре значения проверяют обе границы с обеих сторон.' },
      { id: 'bug', text: 'Разработчик написал <code>amount &lt; 15000</code> вместо <code>amount &lt;= 15000</code>. Какой тест это поймает?', answer: choice(['99', '100', '15 000', '15 001'], 2, 'Найди значение, на котором «<» и «<=» дают разный ответ.') },
    ],
    hints: [
      '«Включительно» — значит, сама граница валидна. Шаг — 1 ₽: соседнее значение отличается на рубль.',
      'Границы: 100 и 15 000. Для каждой нужна пара «последнее невалидное + первое валидное» (или наоборот).',
      'Минимум 100, максимум 15 000 → «Проверить». Добавь 99, 100, 15000, 15001 → «Проверить». Ответ: 15 000 — при «<» оно отклонится.',
    ],
    outro: 'Ошибки «на единицу» (< вместо <=) — самые частые; ловят их именно граничные значения.',
  });

  LEVELS.push({
    id: 'td-3', title: 'Границы: 3 точки', giver: { name: 'QA-лид Марина', sprite: '👩‍🔬' },
    setup: {
      spec: `<p><b>Пароль при регистрации.</b> Тестовые значения — длина пароля в символах.</p><ul>
        <li>Длина от 8 до 20 символов включительно — пароль принимается.</li>
        <li>Короче — ошибка «Минимум 8 символов».</li>
        <li>Длиннее — ошибка «Максимум 20 символов».</li></ul>`,
      parts: [{
        id: 'a', kind: 'bva', per: 'символ', unit: 'символах', step: 1, points: 3,
        bounds: [{ label: 'Минимальная длина', v: 8 }, { label: 'Максимальная длина', v: 20 }],
        segments: [{ to: 7, label: 'короче 8', valid: false }, { from: 8, to: 20, label: '8 – 20', valid: true }, { from: 21, label: 'длиннее 20', valid: false }],
        groups: [{ label: '8', vals: [7, 8, 9] }, { label: '20', vals: [19, 20, 21] }],
        outcomes: ['Принят', 'Ошибка «Минимум 8 символов»', 'Ошибка «Максимум 20 символов»'],
        expect: (v) => (v < 8 ? 1 : v > 20 ? 2 : 0),
        impl: (v) => (v < 8 ? 1 : v >= 20 ? 2 : 0),
      }],
    },
    gold: 98,
    steps: [
      { id: 'bounds', text: 'Определи границы длины пароля. «Проверить».', check: F('a', 'bounds') },
      { id: 'pick', text: 'Трёхточечный анализ: для каждой границы — она сама и соседние значения слева и справа. «Проверить».', check: F('a', 'pick') },
      { id: 'expect', text: 'Укажи ожидаемый результат для каждого значения и нажми «Проверить» — тесты прогонятся.', check: F('a', 'run'), success: 'Прогон показал расхождение — это и есть дефект.' },
      { id: 'bug', text: 'Какой дефект нашёл прогон?', answer: choice(['Пароль длиной 7 принимается', 'Пароль длиной 8 отклоняется', 'Пароль длиной 20 отклоняется', 'Пароль длиной 21 принимается'], 2, 'Посмотри на красную строку в таблице прогона.') },
    ],
    hints: [
      'Три точки на границу: граница − 1, граница, граница + 1. Границы — 8 и 20.',
      'Значения: 7, 8, 9 и 19, 20, 21. Ожидание: до 7 — «Минимум 8», 8–20 — «Принят», от 21 — «Максимум 20».',
      'Мин 8, макс 20 → «Проверить». Добавь 7, 8, 9, 19, 20, 21 → «Проверить». Ожидания: 7 — «Минимум 8 символов», 8/9/19/20 — «Принят», 21 — «Максимум 20 символов» → «Проверить». Ответ: «Пароль длиной 20 отклоняется».',
    ],
    outro: 'Трёхточечный вариант ловит больше ошибок вида «==» вместо «<=», двухточечный — короче.',
  });

  LEVELS.push({
    id: 'td-4', title: 'Классы для строки', giver: { name: 'Продакт Олег', sprite: '🧑‍💼' },
    setup: {
      spec: `<p><b>Поле «Логин»</b> при регистрации.</p><ul>
        <li>3–16 символов: латинские буквы, цифры и «_».</li>
        <li>Первый символ — буква.</li>
        <li>Логин должен быть свободен. Уже заняты: <code>admin</code>, <code>support</code>.</li>
        <li>Пустое поле — «Обязательное поле». На каждое нарушение — своё сообщение об ошибке.</li></ul>`,
      parts: [{
        id: 'a', kind: 'ec',
        classes: [
          { id: 'ok', label: 'Свободный логин по всем правилам', type: 'valid' },
          { id: 'sh', label: 'Короче 3 символов', type: 'invalid' },
          { id: 'x1', label: 'Только строчные буквы', type: 'extra' },
          { id: 'ln', label: 'Длиннее 16 символов', type: 'invalid' },
          { id: 'ch', label: 'Недопустимые символы (кириллица, пробел, «-», «@»…)', type: 'invalid' },
          { id: 'x2', label: 'Только кириллица', type: 'extra' },
          { id: 'st', label: 'Начинается с цифры или «_»', type: 'invalid' },
          { id: 'tk', label: 'Логин уже занят', type: 'invalid' },
          { id: 'x3', label: 'Цифры в конце логина', type: 'extra' },
          { id: 'em', label: 'Пустое поле', type: 'invalid' },
        ],
        values: [
          { v: 'qa_tester', cls: 'ok' }, { v: 'ab', cls: 'sh' }, { v: 'тестер', cls: 'ch' }, { v: 'superlongusername1', cls: 'ln' }, { v: 'Anna2024', cls: 'ok' },
          { v: '1qa', cls: 'st' }, { v: 'admin', cls: 'tk' }, { v: 'qa tester', cls: 'ch' }, { v: '', cls: 'em' }, { v: '_qa', cls: 'st' }, { v: 'a', cls: 'sh' }, { v: 'support', cls: 'tk' }, { v: 'qa-tester', cls: 'ch' },
        ],
      }],
    },
    gold: 107,
    steps: [
      { id: 'classes', text: 'Размечай классы логина. «Проверить».', check: F('a', 'classes'), success: 'Подклассы вроде «только кириллица» не нужны: требования обрабатывают любой недопустимый символ одинаково.' },
      { id: 'pick', text: 'Выбери по одному логину на каждый класс. «Проверить».', check: F('a', 'pick') },
      { id: 'why', text: 'Почему для невалидного класса плохо значение вроде <code>1_тест</code>, нарушающее сразу два правила?', answer: choice(['Одна ошибка маскирует другую: непонятно, какая проверка сработала', 'Такие значения запрещены стандартом ISO 29119', 'Их невозможно ввести с клавиатуры', 'Оно всегда проходит валидацию'], 0) },
    ],
    hints: [
      'Валидный класс один. Каждое правило (длина снизу, длина сверху, символы, первый символ, занятость, пустота) — свой невалидный класс.',
      'Лишние: «Только строчные буквы», «Только кириллица», «Цифры в конце логина» — требования их не выделяют. Значения: по одному на 7 классов, например qa_tester, ab, superlongusername1, тестер, 1qa, admin, (пусто).',
      'Валидный: «Свободный логин по всем правилам». Невалидные: «Короче 3», «Длиннее 16», «Недопустимые символы», «Начинается с цифры или _», «Логин уже занят», «Пустое поле». Лишние — остальные три. Чипы: qa_tester, ab, superlongusername1, тестер, 1qa, admin, (пусто). Ответ: «Одна ошибка маскирует другую».',
    ],
    outro: 'Невалидные значения — по одному нарушению на тест, иначе одна ошибка спрячет другую.',
  });

  LEVELS.push({
    id: 'td-5', title: 'Таблица решений', giver: { name: 'Аналитик Вера', sprite: '👩‍💼' },
    setup: {
      spec: `<p><b>Скидки в корзине</b> интернет-магазина.</p><ul>
        <li>Введён действующий промокод — скидка 15%, другие скидки не применяются.</li>
        <li>Без промокода: есть карта лояльности и сумма ≥ 5 000 ₽ — скидка 10%; карта есть, сумма меньше — 5%; карты нет — без скидки.</li>
        <li>Сумма ≥ 5 000 ₽ — бесплатная доставка (независимо от скидок).</li></ul>`,
      parts: [{
        id: 'a', kind: 'dt', cols: 8, target: 6,
        conds: ['Промокод введён', 'Есть карта лояльности', 'Сумма ≥ 5 000 ₽'],
        acts: ['Скидка 15%', 'Скидка 10%', 'Скидка 5%', 'Без скидки', 'Бесплатная доставка'],
        fn: ([p, c, s]) => (p ? [0] : c ? [s ? 1 : 2] : [3]).concat(s ? [4] : []),
      }],
    },
    gold: 116,
    steps: [
      { id: 'conds', text: 'Заполни условия: 8 правил — все комбинации Y/N, без повторов и без «–». «Проверить».', check: F('a', 'combosFull'), success: '3 условия → 2³ = 8 комбинаций.' },
      { id: 'acts', text: 'Отметь ✕ действия каждого правила по требованиям. «Проверить».', check: F('a', 'full'), success: 'Полная таблица решений готова.' },
      { id: 'reduce', text: 'Сократи таблицу до 6 правил: где результат не зависит от условия, поставь «–» и удали лишнее правило. «Проверить».', check: F('a', 'reduced'), success: 'При промокоде карта не важна — два правила схлопнулись в одно, ещё два — тоже.' },
    ],
    hints: [
      'Перебор как в двоичном счёте: первое условие меняется реже всех (YYYY NNNN), последнее — чаще (YNYN…). Действия бери из требований для каждой комбинации.',
      'При введённом промокоде «Есть карта» не влияет на результат: правила «Y Y Y» и «Y N Y» дают одно и то же, как и «Y Y N» и «Y N N». Их можно слить, поставив «–» у карты.',
      'R1 YYY: 15% + доставка; R2 YYN: 15%; R3 YNY: 15% + доставка; R4 YNN: 15%; R5 NYY: 10% + доставка; R6 NYN: 5%; R7 NNY: без скидки + доставка; R8 NNN: без скидки. Затем в R1 и R2 поставь «–» во второй строке, удали R3 и R4 → 6 правил.',
    ],
    outro: 'Полная таблица — гарантия, что ни одна комбинация не забыта; сокращённая — минимальный набор тестов.',
  });

  LEVELS.push({
    id: 'td-6', title: 'Переходы состояний', giver: { name: 'Логист Семён', sprite: '📦' },
    setup: {
      spec: `<p><b>Статусы заказа.</b></p><ul>
        <li>Созданный заказ можно оплатить или отменить.</li>
        <li>Оплаченный заказ можно отправить или отменить (с возвратом денег).</li>
        <li>Отправленный заказ курьер доставляет — отменить его уже нельзя.</li>
        <li>Доставленный заказ можно вернуть.</li>
        <li>«Отменён» и «Возвращён» — конечные статусы.</li></ul>`,
      parts: [{
        id: 'a', kind: 'st', vb: [720, 270], init: 'new', maxTests: 3,
        states: [
          { id: 'new', label: 'Создан', x: 70, y: 60 }, { id: 'paid', label: 'Оплачен', x: 262, y: 60 }, { id: 'ship', label: 'Отправлен', x: 456, y: 60 },
          { id: 'done', label: 'Доставлен', x: 646, y: 60 }, { id: 'cancel', label: 'Отменён', x: 262, y: 220 }, { id: 'ret', label: 'Возвращён', x: 646, y: 220 },
        ],
        trans: [
          { id: 't1', from: 'new', to: 'paid', ev: 'оплатить' }, { id: 't2', from: 'new', to: 'cancel', ev: 'отменить' },
          { id: 't3', from: 'paid', to: 'ship', ev: 'отправить' }, { id: 't4', from: 'paid', to: 'cancel', ev: 'отменить' },
          { id: 't5', from: 'ship', to: 'done', ev: 'доставить' }, { id: 't6', from: 'done', to: 'ret', ev: 'вернуть' },
        ],
        neg: [['new', 'отправить'], ['paid', 'отменить'], ['ship', 'отменить'], ['done', 'вернуть'], ['cancel', 'оплатить'], ['paid', 'оплатить'], ['new', 'отменить'], ['ret', 'вернуть']],
      }],
    },
    gold: 125,
    steps: [
      { id: 'first', text: 'Собери тест, который доводит заказ до статуса «Доставлен», и нажми «Сохранить тест».', check: F('a', (f) => f.saved && f.visits.includes('done')) },
      { id: 'trans', text: 'Покрой тестами все переходы (0-switch): каждую стрелку хотя бы раз. «Проверить».', check: F('a', 'trans') },
      { id: 'min', text: 'Уложись в 3 теста. «Проверить».', check: F('a', 'transMin'), success: 'Три пути — минимум: в конечные статусы ведут три разные «ветки».' },
      { id: 'neg', text: 'Отметь недопустимые пары «состояние + событие» — это негативные тесты. «Проверить».', check: F('a', 'neg') },
    ],
    hints: [
      'Тест — путь от «Создан». Из конечного статуса пути нет, поэтому каждая ветка, заканчивающаяся в «Отменён» или «Возвращён», — отдельный тест.',
      'Тесты: «оплатить → отправить → доставить → вернуть», «отменить», «оплатить → отменить». Недопустимы события, для которых на диаграмме нет стрелки из этого состояния.',
      '1) оплатить, отправить, доставить, вернуть → «Сохранить тест». 2) отменить → сохранить. 3) оплатить, отменить → сохранить. Недопустимые: «Создан + отправить», «Отправлен + отменить», «Отменён + оплатить», «Оплачен + оплатить», «Возвращён + вернуть» → «Проверить».',
    ],
    outro: '0-switch — каждый переход хотя бы раз; негативные тесты — события, которых в этом состоянии быть не должно.',
  });

  LEVELS.push({
    id: 'td-7', title: 'Pairwise', giver: { name: 'DevOps Артём', sprite: '🛠️' },
    setup: {
      spec: `<p><b>Веб-приложение банка.</b> Окружения для регресса:</p><ul>
        <li>ОС: Windows, macOS, Linux.</li>
        <li>Браузер: Chrome, Firefox, Edge.</li>
        <li>Язык интерфейса: RU, EN.</li>
        <li>Ограничений на сочетания нет. Нужен минимальный набор, где встречается каждая пара значений.</li></ul>`,
      parts: [{
        id: 'a', kind: 'pw', maxRows: 9, rows: 3,
        params: [{ name: 'ОС', vals: ['Windows', 'macOS', 'Linux'] }, { name: 'Браузер', vals: ['Chrome', 'Firefox', 'Edge'] }, { name: 'Язык', vals: ['RU', 'EN'] }],
      }],
    },
    gold: 134,
    steps: [
      { id: 'full', text: 'Сколько тестов нужно при полном переборе всех комбинаций?', answer: numAns(18, 'Число комбинаций', 'Перемножь количество значений параметров.') },
      { id: 'cover', text: 'Заполни таблицу так, чтобы каждая пара значений любых двух параметров встретилась хотя бы раз. «Проверить».', check: F('a', 'cover') },
      { id: 'min', text: 'Уложись в 9 строк — это минимум: пар «ОС × Браузер» ровно 9. «Проверить».', check: F('a', 'min'), success: '9 тестов вместо 18 — и все пары на месте.' },
    ],
    hints: [
      'Полный перебор — 3 × 3 × 2. Минимум строк для pairwise не меньше произведения двух самых «больших» параметров.',
      'Сделай 9 строк: все сочетания ОС × Браузер, а язык чередуй так, чтобы у каждой ОС и у каждого браузера были и RU, и EN.',
      'Ответ: 18. Строки: Windows-Chrome-RU, Windows-Firefox-EN, Windows-Edge-RU, macOS-Chrome-EN, macOS-Firefox-RU, macOS-Edge-EN, Linux-Chrome-RU, Linux-Firefox-EN, Linux-Edge-EN → «Проверить».',
    ],
    outro: 'Большинство дефектов окружения вызывает сочетание двух параметров — на этом и держится pairwise.',
  });

  // Поле «Имя» со скрытыми дефектами
  function runName(v) {
    const t = v.trim();
    if (v === '') return { ok: false, out: 'Ошибка: «Обязательное поле»' };
    if (t === '') return { ok: true, out: 'Сохранено. Приветствие: «Привет, !»', bug: 'spaces' };
    if (/<\s*[a-z!/]/i.test(t)) {
      const tag = (t.match(/<\s*\/?\s*([a-z]+)/i) || [])[1] || 'тег';
      return { ok: true, out: `Сохранено. Приветствие отрисовано как HTML: тег <code>&lt;${esc(tag.toLowerCase())}&gt;</code> применился на странице`, bug: 'html' };
    }
    if (!/^[A-Za-zА-Яа-яЁё '\-]+$/.test(t)) return { ok: false, out: 'Ошибка: «Имя может содержать только буквы, пробел, дефис и апостроф»' };
    if (t.length > 51) return { ok: false, out: 'Ошибка: «Не больше 50 символов»' };
    if (t.length === 51) return { ok: true, out: `Сохранено (${t.length} симв.). Приветствие: «Привет, ${esc(t.slice(0, 12))}…!»`, bug: 'len' };
    if (t.includes("'")) return { ok: false, out: '500 Internal Server Error', bug: 'apos' };
    return { ok: true, out: `Сохранено. Приветствие: «Привет, ${esc(t)}!»` };
  }

  LEVELS.push({
    id: 'td-8', title: 'Предугадывание ошибок', giver: { name: 'Тестировщик Ника', sprite: '🕵️‍♀️' },
    setup: {
      spec: `<p><b>Поле «Имя» в профиле.</b></p><ul>
        <li>1–50 символов: русские и латинские буквы, пробел, дефис, апостроф.</li>
        <li>Пробелы в начале и в конце обрезаются при сохранении.</li>
        <li>После сохранения показывается «Привет, ‹имя›!».</li>
        <li>Недопустимое значение — сообщение об ошибке, имя не сохраняется.</li></ul>`,
      parts: [{
        id: 'a', kind: 'bug', mode: 'text', label: 'Имя', placeholder: 'Введи значение', gen: true, run: runName,
        bugs: [{ id: 'spaces', title: 'Имя из одних пробелов сохраняется пустым' }, { id: 'apos', title: 'Апостроф в имени (O\'Brien) — ошибка сервера 500' },
          { id: 'len', title: 'Имя из 51 символа сохраняется' }, { id: 'html', title: 'HTML-теги из имени выполняются на странице (XSS)' }],
      }],
    },
    gold: 143,
    steps: [
      { id: 'valid', text: 'Сначала позитивная проверка: сохрани корректное имя.', check: F('a', 'valid') },
      { id: 'one', text: 'Подбери «опасное» значение и отметь неверный ответ системы кнопкой <b>🐞 Баг</b>.', check: F('a', (f) => f.count >= 1) },
      { id: 'two', text: 'Найди ещё один дефект.', check: F('a', (f) => f.count >= 2) },
      { id: 'all', text: 'Найди все 4 дефекта поля.', check: F('a', (f) => f.count >= 4), success: 'Пробелы, граница длины, спецсимволы из разрешённых и HTML — классика предугадывания ошибок.' },
    ],
    hints: [
      'Опыт тестировщика: пустые и «пробельные» значения, граница длины ±1, разрешённые, но опасные символы (кавычки, апостроф), HTML и скрипты.',
      'Попробуй: строку только из пробелов, «O\'Brien», строку длиной 51 (генератор), «&lt;b&gt;Вася&lt;/b&gt;». Сравни каждый ответ с требованиями.',
      'Введи «Анна» → «Сохранить». Затем по очереди: «   » (три пробела), «O\'Brien», генератор 51 → «Вставить», «&lt;b&gt;Вася&lt;/b&gt;» — после каждого «Сохранить» жми «🐞 Баг» у ответа.',
    ],
    outro: 'Error guessing — не случайный ввод, а чек-лист типовых ловушек: пусто, пробелы, границы, кавычки, юникод, HTML/SQL.',
  });

  LEVELS.push({
    id: 'td-9', title: 'Чек-лист формы', giver: { name: 'QA-лид Марина', sprite: '👩‍🔬' },
    setup: {
      spec: `<p><b>Форма входа:</b> Email, Пароль, чекбокс «Запомнить меня», кнопка «Войти», ссылка «Забыли пароль?».</p><ul>
        <li>Пароль скрыт точками, кнопка «👁» показывает его.</li>
        <li>После 5 неверных попыток подряд вход блокируется на 15 минут.</li>
        <li>«Запомнить меня» — сессия живёт 30 дней.</li>
        <li>Любая ошибка входа — общий текст «Неверный email или пароль» (не раскрываем, что именно неверно).</li></ul>`,
      parts: [{
        id: 'a', kind: 'cl',
        groups: { pos: 'Позитивные', neg: 'Негативные', sec: 'Безопасность' },
        items: [
          { t: 'Вход с зарегистрированным email и верным паролем', g: 'pos' },
          { t: 'Неверный пароль → «Неверный email или пароль»', g: 'neg' },
          { t: 'После 3 неверных попыток аккаунт удаляется', trap: 'в требованиях блокировка на 15 минут после 5 попыток.' },
          { t: 'Пароль скрыт точками, «👁» показывает и снова скрывает', g: 'sec' },
          { t: 'С «Запомнить меня» сессия сохраняется после перезапуска браузера', g: 'pos' },
          { t: 'Незарегистрированный email → тот же общий текст ошибки', g: 'neg' },
          { t: 'При неверном email показать «Пользователь не найден»', trap: 'противоречит требованию об общем тексте ошибки.' },
          { t: 'Пустые поля → форма не отправляется, поля подсвечены', g: 'neg' },
          { t: 'После 5 неверных попыток вход заблокирован на 15 минут', g: 'sec' },
          { t: 'SQL-инъекция в email (\' OR 1=1 --) не даёт войти', g: 'sec' },
          { t: 'Ссылка «Забыли пароль?» ведёт на восстановление', g: 'pos' },
          { t: 'Проверить сортировку товаров в каталоге', trap: 'не относится к форме входа.' },
          { t: 'Email без «@» → ошибка формата', g: 'neg' },
          { t: 'Пароль не попадает в URL и историю браузера', g: 'sec' },
          { t: 'Email в другом регистре (User@Mail.ru) — вход работает' },
          { t: '«Запомнить меня» — сессия живёт 7 дней', trap: 'по требованиям — 30 дней.' },
          { t: 'Переход между полями по Tab, вход по Enter' },
        ],
      }],
    },
    gold: 152,
    steps: [
      { id: 'pn', text: 'Собери позитивные и негативные проверки формы. «Проверить».', check: F('a', (f) => f.g_pos && f.g_neg) },
      { id: 'sec', text: 'Добавь проверки безопасности. «Проверить».', check: F('a', 'g_sec') },
      { id: 'clean', text: 'Убери пункты, которые противоречат требованиям или не относятся к форме. «Проверить».', check: F('a', 'all'), success: 'Чек-лист покрывает требования и не содержит ложных ожиданий.' },
    ],
    hints: [
      'Иди по требованиям: каждое — минимум одна проверка. Пункт, который ждёт поведения, противоречащего требованиям, — ловушка.',
      'Ловушки: удаление аккаунта после 3 попыток, «Пользователь не найден», сессия 7 дней, сортировка каталога. Безопасность — маскировка пароля, блокировка, SQL-инъекция, пароль не в URL.',
      'Отметь всё, кроме четырёх ловушек: «После 3 неверных попыток аккаунт удаляется», «При неверном email показать «Пользователь не найден»», «Проверить сортировку товаров», «Сессия живёт 7 дней». Пункты про регистр email и Tab — по желанию. «Проверить».',
    ],
    outro: 'Чек-лист строят от требований и рисков, а не от фантазии: каждый пункт должен иметь проверяемое ожидание.',
  });

  LEVELS.push({
    id: 'td-10', title: 'Ревью тест-кейса', giver: { name: 'Стажёр Паша', sprite: '🧑‍🎓' },
    setup: {
      spec: `<p><b>Тест-кейс стажёра</b> на добавление товара в корзину. Хороший тест-кейс: название говорит, что проверяем; есть предусловия; конкретные данные; один шаг — одно действие; конкретный ожидаемый результат.</p>`,
      parts: [{
        id: 'a', kind: 'tcr',
        types: ['Без ошибок', 'Название не отражает проверку', 'Нет нужных предусловий', 'Нет конкретных тестовых данных', 'В шаге несколько разных проверок', 'Неконкретный ожидаемый результат'],
        lines: [
          { k: 'ID', t: 'TC-042' },
          { k: 'Название', t: 'Проверка корзины', bad: 1 },
          { k: 'Предусловия', t: '—', bad: 2 },
          { k: 'Шаг 1', t: 'Открыть shop.test и войти под user1 / Qwerty123' },
          { k: 'Шаг 2', t: 'Найти какой-нибудь товар', bad: 3 },
          { k: 'Шаг 3', t: 'Нажать «В корзину», изменить количество на 3, применить промокод и оформить заказ', bad: 4 },
          { k: 'Ожидаемый результат', t: 'Всё работает корректно', bad: 5 },
          { k: 'Приоритет', t: 'High' },
        ],
      }],
    },
    gold: 161,
    steps: [
      { id: 'found', text: 'Найди строки с ошибками: у каждой проблемной выбери в списке тип ошибки (пока любой). «Проверить».', check: F('a', 'found') },
      { id: 'typed', text: 'Уточни тип ошибки в каждой строке. «Проверить».', check: F('a', 'typed') },
      { id: 'exp', text: 'Какой ожидаемый результат подходит шагу «Нажать «В корзину» у товара «Кружка QA», 350 ₽»?', answer: choice(['Товар добавлен', 'Счётчик корзины — 1; в корзине «Кружка QA», 1 шт., 350 ₽', 'Корзина работает правильно', 'Нет ошибок'], 1) },
    ],
    hints: [
      'Проверь каждую строку вопросом: «Сможет ли другой человек пройти тест и однозначно сказать, прошёл он или нет?»',
      'Ошибки в 5 строках: Название, Предусловия, Шаг 2, Шаг 3, Ожидаемый результат. ID, Шаг 1 и Приоритет — в порядке.',
      'Название — «Название не отражает проверку»; Предусловия — «Нет нужных предусловий»; Шаг 2 — «Нет конкретных тестовых данных»; Шаг 3 — «В шаге несколько разных проверок»; ОР — «Неконкретный ожидаемый результат». Ответ: «Счётчик корзины — 1…».',
    ],
    outro: 'Ожидаемый результат должен быть проверяемым: числа, тексты, состояние — а не «всё работает».',
  });

  LEVELS.push({
    id: 'td-11', title: 'Сборка тест-кейса', giver: { name: 'QA-лид Марина', sprite: '👩‍🔬' },
    setup: {
      spec: `<p><b>Смена пароля в профиле.</b></p><ul>
        <li>Поля: «Текущий пароль», «Новый пароль» (8–20 символов), «Подтверждение»; кнопка «Сохранить».</li>
        <li>При успехе — сообщение «Пароль изменён»; старый пароль больше не подходит.</li></ul>
        <p>Собери позитивный тест-кейс «Успешная смена пароля» из фрагментов.</p>`,
      parts: [{
        id: 'a', kind: 'tcb', name: 'TC-101. Успешная смена пароля на валидный',
        frags: [
          { t: 'Ввести в «Новый пароль»: New_pass22', sec: 'step', order: 2 },
          { t: 'Появилось сообщение «Пароль изменён»', sec: 'exp' },
          { t: 'Пользователь qa@test.ru зарегистрирован с паролем Old_pass1', sec: 'pre' },
          { t: 'Нажать «Сохранить»', sec: 'step', order: 4 },
          { t: 'Проверить, что всё работает', sec: 'none' },
          { t: 'Ввести в «Текущий пароль»: Old_pass1', sec: 'step', order: 1 },
          { t: 'Вход с Old_pass1 отклоняется, с New_pass22 — успешен', sec: 'exp' },
          { t: 'Ввести в «Новый пароль»: 1234567 (7 символов)', sec: 'none' },
          { t: 'Пользователь авторизован и открыл «Профиль → Безопасность»', sec: 'pre' },
          { t: 'Ввести в «Подтверждение»: New_pass22', sec: 'step', order: 3 },
          { t: 'Разработчик исправит баг до пятницы', sec: 'none' },
        ],
      }],
    },
    gold: 170,
    steps: [
      { id: 'pre', text: 'Отнеси к предусловиям то, что должно быть готово до первого шага. «Проверить».', check: F('a', 'pre') },
      { id: 'steps', text: 'Собери шаги и выстрой их по порядку. «Проверить».', check: F('a', 'steps') },
      { id: 'all', text: 'Заполни ожидаемый результат и отбрось фрагменты, которым не место в этом тест-кейсе. «Проверить».', check: F('a', 'all'), success: 'Один тест-кейс — одна проверка: негативный ввод 7 символов — это другой тест.' },
    ],
    hints: [
      'Предусловия — состояние системы и данные до начала. Шаги — действия пользователя. Ожидаемый результат — что проверяем после. Негативный ввод — отдельный тест-кейс.',
      'Предусловий 2 (пользователь зарегистрирован; авторизован и на странице), шагов 4 (текущий → новый → подтверждение → «Сохранить»), ОР — 2. Не относятся: «всё работает», пароль из 7 символов, «баг до пятницы».',
      'Предусловия: «qa@test.ru зарегистрирован…», «авторизован и открыл…». Шаги по порядку: Old_pass1 в «Текущий», New_pass22 в «Новый», New_pass22 в «Подтверждение», «Сохранить». ОР: «Пароль изменён», «вход с Old_pass1 отклоняется…». Остальное — «Не относится».',
    ],
  });

  LEVELS.push({
    id: 'td-12', title: 'Given-When-Then', giver: { name: 'Продакт Олег', sprite: '🧑‍💼' },
    setup: {
      spec: `<p><b>User story:</b> как покупатель, я хочу применить промокод в корзине, чтобы получить скидку.</p>
        <p><b>Критерии приёмки:</b></p><ul>
        <li><b>AC-1</b> Промокод SALE10 (−10%) при сумме корзины от 3 000 ₽ применяется, итог пересчитывается.</li>
        <li><b>AC-2</b> Сумма меньше 3 000 ₽ — сообщение «Промокод действует от 3 000 ₽», итог не меняется.</li>
        <li><b>AC-3</b> Истёкший промокод — «Срок действия промокода истёк», итог не меняется.</li>
        <li><b>AC-4</b> Несуществующий промокод — «Промокод не найден», итог не меняется.</li>
        <li><b>AC-5</b> Промокод применяется быстро и удобно.</li></ul>`,
      parts: [{
        id: 'a', kind: 'gwt', acs: ['AC-1', 'AC-2', 'AC-3', 'AC-4'],
        given: ['в корзине товаров на 4 000 ₽', 'в корзине товаров на 2 500 ₽', 'в корзине товаров на 4 000 ₽, промокод OLD5 истёк вчера'],
        when: ['покупатель вводит SALE10 и нажимает «Применить»', 'покупатель вводит OLD5 и нажимает «Применить»', 'покупатель вводит NOPE и нажимает «Применить»'],
        then: ['итог 3 600 ₽, промокод отмечен как применённый', 'сообщение «Промокод действует от 3 000 ₽», итог 2 500 ₽', 'сообщение «Срок действия промокода истёк», итог 4 000 ₽', 'сообщение «Промокод не найден», итог 4 000 ₽', 'итог 2 250 ₽, промокод применён'],
        valid: [{ g: 0, w: 0, t: 0, ac: 'AC-1' }, { g: 2, w: 0, t: 0, ac: 'AC-1' }, { g: 1, w: 0, t: 1, ac: 'AC-2' }, { g: 2, w: 1, t: 2, ac: 'AC-3' }, { g: 0, w: 2, t: 3, ac: 'AC-4' }, { g: 2, w: 2, t: 3, ac: 'AC-4' }],
      }],
    },
    gold: 179,
    steps: [
      { id: 'one', text: 'Опиши позитивный сценарий для AC-1. «Проверить».', check: F('a', 'ac_AC-1') },
      { id: 'all', text: 'Добавь сценарии для AC-2, AC-3 и AC-4 — без ошибочных и дублирующих. «Проверить».', check: F('a', 'all'), success: 'Каждый критерий подтверждён проверяемым сценарием.' },
      { id: 'untest', text: 'Какой критерий нельзя проверить в нынешнем виде — его нужно вернуть аналитику?', answer: choice(['AC-1', 'AC-2', 'AC-3', 'AC-4', 'AC-5'], 4, 'Ищи критерий без измеримого ожидаемого результата.') },
    ],
    hints: [
      'Given — исходное состояние (сумма корзины, состояние промокода), When — действие, Then — измеримый результат, который прямо следует из критерия.',
      'AC-1: корзина 4 000 + SALE10 → 3 600 ₽. AC-2: корзина 2 500 + SALE10 → «от 3 000 ₽». AC-3: OLD5 истёк + OLD5. AC-4: NOPE → «не найден». «Итог 2 250 ₽» не следует ни из одного критерия.',
      'Сценарии: (4 000 ₽ / SALE10 / итог 3 600 ₽), (2 500 ₽ / SALE10 / «действует от 3 000 ₽»), (OLD5 истёк / OLD5 / «срок истёк»), (4 000 ₽ / NOPE / «не найден»). Ответ: AC-5 — «быстро и удобно» не измеримо.',
    ],
    outro: 'Критерий приёмки без измеримого результата — дефект требований; его ловят ещё до разработки.',
  });

  LEVELS.push({
    id: 'td-13', title: 'Блокировка после 3 попыток', giver: { name: 'Безопасник Рустам', sprite: '🛡️' },
    setup: {
      spec: `<p><b>Вход в аккаунт.</b></p><ul>
        <li>Неверный пароль увеличивает счётчик ошибок. Третья ошибка подряд блокирует аккаунт.</li>
        <li>Верный пароль до блокировки — вход выполнен.</li>
        <li>Заблокированный аккаунт отклоняет любой пароль, даже верный, и остаётся заблокированным.</li>
        <li>Через 30 минут блокировка снимается, счётчик обнуляется. До блокировки таймер ничего не меняет.</li></ul>`,
      parts: [{
        id: 'a', kind: 'st', vb: [600, 390], init: 's0', maxTests: 3, table: true,
        events: ['Верный пароль', 'Неверный пароль', 'Прошло 30 мин'], tableStates: ['s0', 's1', 's2', 'lock'],
        states: [
          { id: 's0', label: '0 ошибок', x: 330, y: 40 }, { id: 's1', label: '1 ошибка', x: 330, y: 130 }, { id: 's2', label: '2 ошибки', x: 330, y: 220 },
          { id: 'in', label: 'Вход выполнен', x: 90, y: 130 }, { id: 'lock', label: 'Заблокирован', x: 330, y: 310 },
        ],
        trans: [
          { id: 'a1', from: 's0', to: 'in', ev: 'Верный пароль' }, { id: 'a2', from: 's0', to: 's1', ev: 'Неверный пароль' },
          { id: 'b1', from: 's1', to: 'in', ev: 'Верный пароль' }, { id: 'b2', from: 's1', to: 's2', ev: 'Неверный пароль' },
          { id: 'c1', from: 's2', to: 'in', ev: 'Верный пароль' }, { id: 'c2', from: 's2', to: 'lock', ev: 'Неверный пароль' },
          { id: 'd1', from: 'lock', to: 'lock', ev: 'Верный пароль', loop: 'left' }, { id: 'd2', from: 'lock', to: 'lock', ev: 'Неверный пароль', loop: 'bottom' },
          { id: 'd3', from: 'lock', to: 's0', ev: 'Прошло 30 мин', bend: 230 },
        ],
      }],
    },
    gold: 188,
    steps: [
      { id: 'table', text: 'Построй таблицу переходов по требованиям. «Проверить».', check: F('a', 'table'), success: 'Ключевые ячейки — верный пароль и таймер в состоянии «Заблокирован».' },
      { id: 'trans', text: 'Покрой тестами все переходы диаграммы. «Проверить».', check: F('a', 'trans') },
      { id: 'min', text: 'Уложись в 3 теста. «Проверить».', check: F('a', 'transMin'), success: 'Из «Вход выполнен» выхода нет — поэтому три пути, один из них проходит блокировку целиком.' },
    ],
    hints: [
      'Строка таблицы — состояние, столбец — событие. «Прошло 30 мин» что-то меняет только в «Заблокирован». Верный пароль в «Заблокирован» никуда не ведёт — аккаунт остаётся заблокированным.',
      'Таблица: 0/1/2 ошибки + верный → «Вход выполнен»; неверный → следующий счётчик (2 ошибки → «Заблокирован»); «Заблокирован»: верный и неверный → «Заблокирован», 30 мин → «0 ошибок». Таймер в остальных — «—». Тесты: заканчивай в «Вход выполнен» из каждого счётчика.',
      'Таблицу заполни как во 2-й подсказке → «Проверить». Тесты: 1) неверный, верный; 2) неверный, неверный, верный; 3) неверный ×3, верный (в блоке), неверный (в блоке), прошло 30 мин, верный. Каждый — «Сохранить тест» → «Проверить».',
    ],
    outro: 'Самый частый пропуск — верный пароль в состоянии блокировки: он обязан отклоняться.',
  });

  LEVELS.push({
    id: 'td-14', title: 'Pairwise с ограничениями', giver: { name: 'DevOps Артём', sprite: '🛠️' },
    setup: {
      spec: `<p><b>Видеоплеер.</b> Окружения:</p><ul>
        <li>Платформа: Windows, macOS, Android, iOS.</li>
        <li>Браузер: Chrome, Firefox, Safari.</li>
        <li>Сеть: Wi-Fi, 4G. Язык: RU, EN.</li></ul>
        <p><b>Ограничения:</b> Safari — только на macOS и iOS; на iOS тестируем только Safari; 4G — только на Android и iOS.</p>`,
      parts: [{
        id: 'a', kind: 'pw', maxRows: 10, rows: 4,
        params: [{ name: 'Платформа', vals: ['Windows', 'macOS', 'Android', 'iOS'] }, { name: 'Браузер', vals: ['Chrome', 'Firefox', 'Safari'] }, { name: 'Сеть', vals: ['Wi-Fi', '4G'] }, { name: 'Язык', vals: ['RU', 'EN'] }],
        forbid: ([p, b, n]) => {
          if (b === 'Safari' && p !== 'macOS' && p !== 'iOS') return `Safari на ${p} — недопустимая комбинация.`;
          if (p === 'iOS' && b !== 'Safari') return `на iOS тестируем только Safari, а не ${b}.`;
          if (n === '4G' && (p === 'Windows' || p === 'macOS')) return `4G на ${p} — недопустимая комбинация.`;
          return null;
        },
      }],
    },
    gold: 197,
    steps: [
      { id: 'full', text: 'Сколько допустимых комбинаций (с учётом ограничений) при полном переборе?', answer: numAns(22, 'Число комбинаций', 'Посчитай по платформам: допустимые браузеры × сети × 2 языка.') },
      { id: 'cover', text: 'Покрой все допустимые пары без недопустимых строк. «Проверить».', check: F('a', 'cover') },
      { id: 'min', text: 'Уложись в 10 строк. «Проверить».', check: F('a', 'min'), success: 'Ограничения «съели» часть пар, но и заставили выделить строки под iOS и Android.' },
    ],
    hints: [
      'Ограничения убирают пары, которых не бывает (Safari × Windows), — их покрывать не нужно, а строки с ними — ошибка. Полный перебор: Windows 2×1×2, macOS 3×1×2, Android 2×2×2, iOS 1×2×2.',
      'iOS — только Safari, но нужны и Wi-Fi, и 4G → 2 строки. Пары Chrome × 4G и Firefox × 4G возможны только на Android, плюс Android × Wi-Fi → 3 строки Android. Windows — 2, macOS — 3.',
      'Ответ: 22. Строки: Windows-Chrome-WiFi-RU, Windows-Firefox-WiFi-EN, macOS-Chrome-WiFi-EN, macOS-Firefox-WiFi-RU, macOS-Safari-WiFi-RU, Android-Chrome-4G-RU, Android-Firefox-4G-EN, Android-Chrome-WiFi-EN, iOS-Safari-WiFi-EN, iOS-Safari-4G-RU.',
    ],
    outro: 'Ограничения в pairwise обязательны: тест на несуществующем окружении — потраченное время.',
  });

  LEVELS.push({
    id: 'td-15', title: 'Банкомат: состояния и переходы', giver: { name: 'Инженер Борис', sprite: '🏧' },
    setup: {
      spec: `<p><b>Банкомат.</b></p><ul>
        <li>Ожидание: вставили карту → Ввод PIN.</li>
        <li>Ввод PIN: верный PIN → Меню; неверный (1-й или 2-й раз) → снова Ввод PIN; 3-й неверный → Карта изъята; «Отмена» → Возврат карты.</li>
        <li>Меню: «Снять наличные» → Выдача денег; «Отмена» → Возврат карты.</li>
        <li>Выдача денег: деньги забрали → Возврат карты. Отменить выдачу нельзя.</li>
        <li>Возврат карты: карту забрали → Ожидание. Карта изъята: через 10 с → Ожидание.</li></ul>`,
      parts: [{
        id: 'a', kind: 'st', vb: [640, 350], init: 'idle', maxStateTests: 1,
        states: [
          { id: 'idle', label: 'Ожидание', x: 75, y: 185 }, { id: 'pin', label: 'Ввод PIN', x: 250, y: 80 }, { id: 'menu', label: 'Меню', x: 470, y: 80 },
          { id: 'cash', label: 'Выдача денег', x: 565, y: 195 }, { id: 'ret', label: 'Возврат карты', x: 390, y: 300 }, { id: 'eaten', label: 'Карта изъята', x: 120, y: 305 },
        ],
        trans: [
          { id: 'e1', from: 'idle', to: 'pin', ev: 'вставить карту' }, { id: 'e2', from: 'pin', to: 'menu', ev: 'верный PIN' },
          { id: 'e3', from: 'pin', to: 'pin', ev: 'неверный PIN', loop: 'top' }, { id: 'e4', from: 'pin', to: 'eaten', ev: '3-й неверный' },
          { id: 'e5', from: 'pin', to: 'ret', ev: 'отмена', bend: 30 }, { id: 'e6', from: 'menu', to: 'cash', ev: 'снять наличные' },
          { id: 'e7', from: 'menu', to: 'ret', ev: 'отмена' }, { id: 'e8', from: 'cash', to: 'ret', ev: 'забрать деньги' },
          { id: 'e9', from: 'ret', to: 'idle', ev: 'забрать карту', bend: 30 }, { id: 'e10', from: 'eaten', to: 'idle', ev: 'прошло 10 с' },
        ],
        neg: [['idle', 'верный PIN'], ['pin', 'отмена'], ['cash', 'отмена'], ['menu', 'вставить карту'], ['ret', 'забрать карту'], ['eaten', 'забрать карту'], ['menu', 'отмена']],
      }],
    },
    gold: 206,
    steps: [
      { id: 'states', text: 'Покрытие состояний: собери <b>один</b> тест, который побывает во всех 6 состояниях. «Проверить».', check: F('a', 'statesMin') },
      { id: 'trans', text: 'Покрытие переходов: добавь или перестрой тесты так, чтобы пройти все 10 переходов. «Проверить».', check: F('a', 'trans') },
      { id: 'neg', text: 'Отметь недопустимые пары «состояние + событие» для негативных тестов. «Проверить».', check: F('a', 'neg') },
      { id: 'why', text: 'Почему покрытия состояний недостаточно?', answer: choice(['Можно побывать во всех состояниях и не пройти часть переходов — например, «Отмена» из меню', 'Покрытие состояний всегда требует больше тестов, чем покрытие переходов', 'Состояния нельзя проверить вручную', 'Покрытие состояний не учитывает начальное состояние'], 0) },
    ],
    hints: [
      'Граф замкнут: из «Возврат карты» и «Карта изъята» можно вернуться в «Ожидание», поэтому один длинный тест может пройти многое.',
      'Состояния одним тестом: вставить → верный → снять → забрать деньги → забрать карту → вставить → 3-й неверный. Для переходов добавь неверный PIN, «отмена» из PIN и из меню, «прошло 10 с». Недопустимы события без стрелки из состояния.',
      'Тест 1: вставить карту, верный PIN, снять наличные, забрать деньги, забрать карту, вставить карту, 3-й неверный → «Сохранить тест» → «Проверить». Тест 2: вставить карту, неверный PIN, отмена, забрать карту, вставить карту, верный PIN, отмена, забрать карту, вставить карту, 3-й неверный, прошло 10 с → сохранить → «Проверить». Недопустимые: «Ожидание + верный PIN», «Выдача денег + отмена», «Меню + вставить карту», «Карта изъята + забрать карту». Ответ — первый вариант.',
    ],
    outro: 'Покрытие переходов строже покрытия состояний: 100% переходов всегда дают 100% состояний, но не наоборот.',
  });

  LEVELS.push({
    id: 'td-16', title: 'Сокращённая таблица решений', giver: { name: 'Кредитный аналитик Ия', sprite: '🏦' },
    setup: {
      spec: `<p><b>Автоматическое решение по кредиту.</b></p><ul>
        <li>Возраст вне 21–65 лет — отказ.</li>
        <li>Есть просрочки по кредитам — отказ.</li>
        <li>Иначе: доход ≥ 50 000 ₽ — одобрить; доход меньше, но есть поручитель — одобрить с поручительством; ни дохода, ни поручителя — отказ.</li></ul>`,
      parts: [{
        id: 'a', kind: 'dt', cols: 2, target: 5,
        conds: ['Возраст 21–65', 'Доход ≥ 50 000 ₽', 'Есть просрочки', 'Есть поручитель'],
        acts: ['Одобрить', 'Одобрить с поручительством', 'Отказать'],
        fn: ([age, inc, late, g]) => (!age || late ? [2] : inc ? [0] : g ? [1] : [2]),
      }],
    },
    gold: 215,
    steps: [
      { id: 'full', text: 'Сколько правил было бы в полной таблице решений для 4 условий?', answer: numAns(16, 'Число правил', 'Каждое условие — Y или N.') },
      { id: 'combos', text: 'Собери сразу сокращённую таблицу: каждая из 16 комбинаций должна попасть ровно в одно правило (используй «–»). «Проверить».', check: F('a', 'combos') },
      { id: 'acts', text: 'Отметь действия для каждого правила. «Проверить».', check: F('a', 'actions') },
      { id: 'min', text: 'Уложись в 5 правил. «Проверить».', check: F('a', 'reduced'), success: '16 комбинаций — 5 тестов, и ни одна ветка логики не потеряна.' },
    ],
    hints: [
      'Начни с условий, которые сразу дают отказ: если возраст не подходит — остальное не важно (три «–»).',
      'Правила: «N – – –» → отказ; «Y – Y –» → отказ; «Y Y N –» → одобрить; «Y N N Y» → с поручительством; «Y N N N» → отказ.',
      'Ответ: 16. Добавь правила кнопкой «+ Правило» до пяти. R1: N – – – / Отказать. R2: Y – Y – / Отказать. R3: Y Y N – / Одобрить. R4: Y N N Y / Одобрить с поручительством. R5: Y N N N / Отказать → «Проверить».',
    ],
    outro: '«–» означает: результат от условия не зависит. Неверный «–» склеивает разные ветки — и тест теряет дефект.',
  });

  LEVELS.push({
    id: 'td-17', title: 'Границы нескольких диапазонов', giver: { name: 'Разработчик Глеб', sprite: '👨‍💻' },
    setup: {
      spec: `<p><b>Стоимость поездки на такси</b> по расстоянию, шаг — 0,1 км.</p><ul>
        <li>0 км и меньше — ошибка «Неверный маршрут».</li>
        <li>До 5 км включительно — 300 ₽.</li>
        <li>Больше 5 и до 30 км включительно — 300 ₽ + 25 ₽ за каждый км сверх 5 (сверх считается с точностью до 0,1 км).</li>
        <li>Больше 30 км — «Поездка недоступна».</li></ul>`,
      parts: [{
        id: 'a', kind: 'bva', per: 'км', unit: 'км', step: 0.1, points: 2,
        bounds: [{ label: 'Последнее расстояние с ошибкой «Неверный маршрут»', v: 0 }, { label: 'Последнее расстояние за 300 ₽', v: 5 }, { label: 'Максимальное доступное расстояние', v: 30 }],
        segments: [{ to: 0, label: '≤ 0', valid: false }, { from: 0.1, to: 5, label: '0,1 – 5 · 300 ₽', valid: true }, { from: 5.1, to: 30, label: '5,1 – 30 · тариф', valid: true }, { from: 30.1, label: '> 30', valid: false }],
        groups: [{ label: '0', vals: [0, 0.1] }, { label: '5', vals: [5, 5.1] }, { label: '30', vals: [30, 30.1] }],
        outcomes: ['Ошибка «Неверный маршрут»', '300 ₽', '300 ₽ + 25 ₽/км сверх 5', '«Поездка недоступна»'],
        expect: (v) => (v <= 0 ? 0 : v <= 5 ? 1 : v <= 30 ? 2 : 3),
      }],
    },
    gold: 224,
    steps: [
      { id: 'bounds', text: 'Определи три границы классов. «Проверить».', check: F('a', 'bounds') },
      { id: 'pick', text: 'Двухточечный анализ всех трёх границ с шагом 0,1 км. «Проверить».', check: F('a', 'pick') },
      { id: 'expect', text: 'Укажи ожидаемый результат для каждого значения. «Проверить».', check: F('a', 'expect') },
      { id: 'price', text: 'Сколько рублей стоит поездка на 5,1 км?', answer: { kind: 'text', placeholder: 'Сумма, ₽', accept: (v) => num(v) === 302.5, wrong: '300 ₽ + 25 ₽ × (5,1 − 5).' } },
    ],
    hints: [
      'Классов четыре — границ три: 0, 5 и 30. Шаг 0,1: соседнее значение отличается на 0,1.',
      'Пары значений: 0 и 0,1; 5 и 5,1; 30 и 30,1. Ожидание: ≤ 0 — ошибка, до 5 — 300 ₽, до 30 — тариф, больше — недоступна.',
      'Границы: 0, 5, 30 → «Проверить». Значения: 0; 0,1; 5; 5,1; 30; 30,1 → «Проверить». Ожидания: 0 — ошибка; 0,1 и 5 — 300 ₽; 5,1 и 30 — тариф; 30,1 — недоступна → «Проверить». Ответ: 302,5.',
    ],
    outro: 'У каждого перехода между классами — своя граница; с дробным шагом соседнее значение — граница ± шаг.',
  });

  LEVELS.push({
    id: 'td-18', title: 'Фильтр каталога', giver: { name: 'Продакт Олег', sprite: '🧑‍💼' },
    setup: {
      spec: `<p><b>Фильтр каталога.</b></p><ul>
        <li>Цена «от» и «до»: целые рубли ≥ 0; можно заполнить одно поле, оба или ни одного (тогда фильтр не применяется).</li>
        <li>«от» больше «до» — ошибка «Минимальная цена больше максимальной».</li>
        <li>Отрицательное число или не число — ошибка «Введите цену числом от 0».</li>
        <li>Остальные фильтры: Бренд (Все, Apple, Samsung, Xiaomi), «Только в наличии» (вкл/выкл), Сортировка (популярные, дешевле, дороже).</li></ul>`,
      parts: [{
        id: 'a', tab: '1. Цена: классы', kind: 'ec', title: 'Классы для пары полей «от — до»',
        classes: [
          { id: 'both', label: 'Заполнены оба, «от» ≤ «до»', type: 'valid' },
          { id: 'from', label: 'Заполнено только «от»', type: 'valid' },
          { id: 'x1', label: '«от» и «до» отличаются больше чем на 1 000 ₽', type: 'extra' },
          { id: 'to', label: 'Заполнено только «до»', type: 'valid' },
          { id: 'none', label: 'Оба поля пустые', type: 'valid' },
          { id: 'inv', label: '«от» больше «до»', type: 'invalid' },
          { id: 'neg', label: 'Отрицательное число', type: 'invalid' },
          { id: 'x2', label: 'Только «до», меньше 100 ₽', type: 'extra' },
          { id: 'nan', label: 'Не число', type: 'invalid' },
        ],
        values: [
          { v: 'от 100 · до 500', cls: 'both' }, { v: 'от 300 · до —', cls: 'from' }, { v: 'от 900 · до 100', cls: 'inv' }, { v: 'от — · до 300', cls: 'to' },
          { v: 'от 700 · до 700', cls: 'both' }, { v: 'от -50 · до 100', cls: 'neg' }, { v: 'от — · до —', cls: 'none' }, { v: 'от abc · до 100', cls: 'nan' },
          { v: 'от — · до 50', cls: 'to' }, { v: 'от 0 · до 5000', cls: 'both' },
        ],
      }, {
        id: 'b', tab: '2. Фильтры: pairwise', kind: 'pw', maxRows: 12, rows: 4,
        params: [{ name: 'Бренд', vals: ['Все', 'Apple', 'Samsung', 'Xiaomi'] }, { name: 'В наличии', vals: ['Вкл', 'Выкл'] }, { name: 'Сортировка', vals: ['Популярные', 'Дешевле', 'Дороже'] }],
      }],
    },
    gold: 233,
    steps: [
      { id: 'classes', text: 'Вкладка 1: размечай классы для пары полей цены. «Проверить».', check: F('a', 'classes') },
      { id: 'pick', text: 'Вкладка 1: по одному тесту на класс. «Проверить».', check: F('a', 'pick') },
      { id: 'cover', text: 'Вкладка 2: покрой все пары значений фильтров. «Проверить».', check: F('b', 'cover') },
      { id: 'min', text: 'Вкладка 2: уложись в 12 строк. «Проверить».', check: F('b', 'min'), success: 'Классы — для данных внутри поля, pairwise — для сочетаний настроек.' },
    ],
    hints: [
      'Классы бывают у пары полей: важно не значение каждого, а их отношение и заполненность. Pairwise: минимум строк = 4 бренда × 3 сортировки.',
      'Валидных классов 4 (оба с от ≤ до, только «от», только «до», оба пустые), невалидных 3. Для pairwise сделай все 12 сочетаний Бренд × Сортировка и чередуй «В наличии» так, чтобы у каждого бренда и у каждой сортировки были оба значения.',
      'Классы: валидные — «оба, от ≤ до», «только от», «только до», «оба пустые»; невалидные — «от > до», «отрицательное», «не число»; лишние — два других. Чипы: «от 100 · до 500», «от 300 · до —», «от — · до 300», «от — · до —», «от 900 · до 100», «от -50 · до 100», «от abc · до 100». Pairwise: Все-Вкл-Популярные, Все-Выкл-Дешевле, Все-Вкл-Дороже, Apple-Выкл-Популярные, Apple-Вкл-Дешевле, Apple-Выкл-Дороже, Samsung-Вкл-Популярные, Samsung-Выкл-Дешевле, Samsung-Вкл-Дороже, Xiaomi-Выкл-Популярные, Xiaomi-Вкл-Дешевле, Xiaomi-Выкл-Дороже.',
    ],
  });

  // Загрузка аватара со скрытыми дефектами
  const AVA_FILES = [
    { name: 'cat.jpg', meta: 'JPG · 800 КБ · 1024×768', type: 'jpg', kb: 800, w: 1024, h: 768 },
    { name: 'avatar_5mb.png', meta: 'PNG · 5 120 КБ · 2000×2000', type: 'png', kb: 5120, w: 2000, h: 2000 },
    { name: 'empty.jpg', meta: 'JPG · 0 КБ', type: 'jpg', kb: 0, w: 0, h: 0 },
    { name: 'фото отпуска.JPG', meta: 'JPG · 900 КБ · 1200×1200', type: 'jpg', kb: 900, w: 1200, h: 1200 },
    { name: 'big.png', meta: 'PNG · 5 121 КБ · 3000×3000', type: 'png', kb: 5121, w: 3000, h: 3000 },
    { name: 'icon.png', meta: 'PNG · 20 КБ · 150×150', type: 'png', kb: 20, w: 150, h: 150 },
    { name: 'report.pdf', meta: 'PDF · 300 КБ', type: 'pdf', kb: 300, w: 0, h: 0 },
    { name: 'logo.svg', meta: 'SVG · 12 КБ · 512×512', type: 'svg', kb: 12, w: 512, h: 512 },
    { name: 'photo.png.exe', meta: 'EXE · 500 КБ', type: 'exe', kb: 500, w: 0, h: 0 },
    { name: 'tiny.png', meta: 'PNG · 1 КБ · 200×200', type: 'png', kb: 1, w: 200, h: 200 },
  ];
  function runAvatar(f) {
    if (f.kb === 0) return { ok: false, out: '500 Internal Server Error', bug: 'empty' };
    if (f.type === 'svg') return { ok: true, out: 'Аватар обновлён', bug: 'svg' };
    if (f.type !== 'jpg' && f.type !== 'png') return { ok: false, out: 'Ошибка: «Допустимы только JPG и PNG»' };
    if (f.kb >= 5120) return { ok: false, out: 'Ошибка: «Файл больше 5 МБ»', bug: f.kb === 5120 ? 'max' : undefined };
    if (f.w < 200 || f.h < 200) return { ok: true, out: 'Аватар обновлён (растянут до 200×200)', bug: 'dim' };
    return { ok: true, out: 'Аватар обновлён' };
  }

  LEVELS.push({
    id: 'td-19', title: 'Загрузка файла', giver: { name: 'Тестировщик Ника', sprite: '🕵️‍♀️' },
    setup: {
      spec: `<p><b>Загрузка аватара.</b></p><ul>
        <li>Форматы — только JPG и PNG.</li>
        <li>Размер файла от 1 КБ до 5 МБ включительно (1 МБ = 1 024 КБ, размеры — целые КБ).</li>
        <li>Картинка не меньше 200×200 px, иначе ошибка «Минимальный размер 200×200».</li>
        <li>Имя файла может быть любым. Нарушение правил — понятное сообщение об ошибке.</li></ul>`,
      parts: [{
        id: 'a', tab: '1. Размер: границы', kind: 'bva', per: 'КБ', unit: 'КБ', step: 1, points: 2, title: 'Граничные значения размера файла',
        bounds: [{ label: 'Минимальный размер, КБ', v: 1 }, { label: 'Максимальный размер, КБ', v: 5120 }],
        segments: [{ to: 0, label: 'пустой файл', valid: false }, { from: 1, to: 5120, label: '1 – 5 120 КБ', valid: true }, { from: 5121, label: '> 5 120 КБ', valid: false }],
        groups: [{ label: '1 КБ', vals: [0, 1] }, { label: '5 МБ', vals: [5120, 5121] }],
      }, {
        id: 'b', tab: '2. Загрузка: ищем дефекты', kind: 'bug', mode: 'files', title: 'Загрузка аватара', label: 'Тестовые файлы — выбери и нажми «Загрузить»:',
        files: AVA_FILES, run: runAvatar,
        bugs: [{ id: 'max', title: 'Файл ровно 5 МБ отклоняется' }, { id: 'empty', title: 'Пустой файл — ошибка сервера 500' }, { id: 'dim', title: 'Картинка меньше 200×200 принимается' }, { id: 'svg', title: 'SVG принимается, хотя разрешены только JPG и PNG' }],
      }],
    },
    gold: 242,
    steps: [
      { id: 'bounds', text: 'Вкладка 1: границы размера файла в КБ. «Проверить».', check: F('a', 'bounds') },
      { id: 'pick', text: 'Вкладка 1: двухточечные граничные значения размера. «Проверить».', check: F('a', 'pick') },
      { id: 'two', text: 'Вкладка 2: загружай тестовые файлы и отметь два дефекта кнопкой 🐞.', check: F('b', (f) => f.count >= 2) },
      { id: 'all', text: 'Вкладка 2: найди все 4 дефекта.', check: F('b', (f) => f.count >= 4), success: 'Граничные значения подсказали, какие файлы готовить, а опыт — где ещё искать.' },
    ],
    hints: [
      '5 МБ = 5 × 1 024 КБ. Пустой файл — 0 КБ. В файлах ищи границы размера, неподходящий формат, маленькую картинку, пустой файл.',
      'Границы: 1 и 5 120 КБ; значения 0, 1, 5 120, 5 121. Подозрительные файлы: avatar_5mb.png, empty.jpg, icon.png, logo.svg — сравни их ответы с требованиями.',
      'Мин 1, макс 5120 → «Проверить»; значения 0, 1, 5120, 5121 → «Проверить». Вкладка 2: загрузи по очереди avatar_5mb.png, empty.jpg, icon.png, logo.svg и после каждого жми «🐞 Баг».',
    ],
    outro: 'Тестовые файлы готовят заранее: граница размера, 0 байт, не тот формат с «правильным» расширением, крошечная картинка.',
  });

  LEVELS.push({
    id: 'td-20', title: 'Финал: форма регистрации', giver: { name: 'Архитектор тестов Лев', sprite: '🧙‍♂️' },
    setup: {
      spec: `<p><b>Регистрация в сервисе.</b></p><ul>
        <li>Email обязателен, формат <code>имя@домен.зона</code> без пробелов; уже зарегистрированный (<code>taken@mail.ru</code>) — «Email занят».</li>
        <li>Пароль: от 8 до 64 символов включительно.</li>
        <li>Кнопка «Создать аккаунт» активна, только когда email и пароль валидны и стоит галочка «Принимаю условия».</li>
        <li>Платформы: Web, iOS, Android; способ регистрации: Email, Google, Apple ID (Apple ID недоступен на Android); язык RU/EN.</li>
        <li>Пароли хранятся только в виде хэша; на почту приходит письмо подтверждения.</li></ul>`,
      parts: [{
        id: 'a', tab: '1. Email', kind: 'ec', title: 'Классы эквивалентности: Email',
        classes: [
          { id: 'ok', label: 'Корректный свободный email', type: 'valid' },
          { id: 'noat', label: 'Без «@»', type: 'invalid' },
          { id: 'x1', label: 'Email на gmail.com', type: 'extra' },
          { id: 'nodom', label: 'Без домена или зоны после «@»', type: 'invalid' },
          { id: 'sp', label: 'С пробелом внутри', type: 'invalid' },
          { id: 'x2', label: 'Email с цифрами', type: 'extra' },
          { id: 'tk', label: 'Уже зарегистрирован', type: 'invalid' },
          { id: 'em', label: 'Пустое поле', type: 'invalid' },
        ],
        values: [
          { v: 'new.user@mail.ru', cls: 'ok' }, { v: 'usermail.ru', cls: 'noat' }, { v: 'user@mail', cls: 'nodom' }, { v: 'qa2026@gmail.com', cls: 'ok' },
          { v: 'user name@mail.ru', cls: 'sp' }, { v: 'taken@mail.ru', cls: 'tk' }, { v: '', cls: 'em' }, { v: 'user@', cls: 'nodom' },
        ],
      }, {
        id: 'b', tab: '2. Пароль', kind: 'bva', per: 'символ', unit: 'символах', step: 1, points: 3, title: 'Граничные значения: длина пароля (3 точки)',
        bounds: [{ label: 'Минимальная длина', v: 8 }, { label: 'Максимальная длина', v: 64 }],
        segments: [{ to: 7, label: 'короче 8', valid: false }, { from: 8, to: 64, label: '8 – 64', valid: true }, { from: 65, label: 'длиннее 64', valid: false }],
        groups: [{ label: '8', vals: [7, 8, 9] }, { label: '64', vals: [63, 64, 65] }],
      }, {
        id: 'c', tab: '3. Кнопка', kind: 'dt', cols: 2, target: 4, title: 'Таблица решений: кнопка «Создать аккаунт»',
        conds: ['Email валиден', 'Пароль валиден', 'Галочка «Принимаю условия»'],
        acts: ['Кнопка активна', 'Кнопка неактивна'],
        fn: (c) => (c.every(Boolean) ? [0] : [1]),
      }, {
        id: 'd', tab: '4. Окружения', kind: 'pw', maxRows: 8, rows: 3,
        params: [{ name: 'Платформа', vals: ['Web', 'iOS', 'Android'] }, { name: 'Способ', vals: ['Email', 'Google', 'Apple ID'] }, { name: 'Язык', vals: ['RU', 'EN'] }],
        forbid: ([p, s]) => (p === 'Android' && s === 'Apple ID' ? 'Apple ID недоступен на Android.' : null),
      }, {
        id: 'e', tab: '5. Чек-лист', kind: 'cl', title: 'Чек-лист: функциональность и безопасность',
        groups: { fn: 'Функциональные', sec: 'Безопасность' },
        items: [
          { t: 'После регистрации на email приходит письмо подтверждения', g: 'fn' },
          { t: 'Пароль скрыт при вводе', g: 'sec' },
          { t: 'Пароль виден в базе данных в открытом виде', trap: 'по требованиям пароли хранятся только в виде хэша — это был бы дефект.' },
          { t: 'Двойной клик по «Создать аккаунт» не создаёт два аккаунта', g: 'fn' },
          { t: 'HTML и скрипт в поле email не выполняются', g: 'sec' },
          { t: 'Регистрация по номеру телефона', trap: 'в требованиях такого способа нет.' },
          { t: 'Пароль хранится как хэш, а не открытым текстом', g: 'sec' },
          { t: 'Регистрация через Google на iOS создаёт аккаунт с email из Google', g: 'fn' },
          { t: 'Проверить дизайн главной страницы', trap: 'не относится к форме регистрации.' },
        ],
      }],
    },
    gold: 251,
    steps: [
      { id: 'email', text: 'Вкладка 1: размечай классы email и выбери по представителю. «Проверить».', check: F('a', 'pick') },
      { id: 'pass', text: 'Вкладка 2: трёхточечные граничные значения длины пароля. «Проверить».', check: F('b', 'pick') },
      { id: 'btn', text: 'Вкладка 3: сокращённая таблица решений для кнопки — не больше 4 правил. «Проверить».', check: F('c', 'reduced') },
      { id: 'env', text: 'Вкладка 4: pairwise окружений с учётом ограничения — не больше 8 строк. «Проверить».', check: F('d', 'min') },
      { id: 'cl', text: 'Вкладка 5: чек-лист без ложных ожиданий. «Проверить».', check: F('e', 'all'), success: 'Форма покрыта: данные полей, логика кнопки, окружения и риски.' },
    ],
    hints: [
      'Каждая вкладка — своя техника: классы, границы, таблица решений, pairwise, чек-лист. Решай как в прошлых уровнях.',
      'Email: 1 валидный, 5 невалидных, 2 лишних. Пароль: 7, 8, 9, 63, 64, 65. Кнопка: «Y Y Y» → активна, остальное — тремя правилами с «–». Окружения: 8 строк, Apple ID — только Web и iOS.',
      '1) Валидный: «Корректный свободный»; лишние: gmail, цифры; остальные — невалидные. Чипы: new.user@mail.ru, usermail.ru, user@mail, user name@mail.ru, taken@mail.ru, (пусто). 2) 8 и 64; 7, 8, 9, 63, 64, 65. 3) R1 Y Y Y — активна; R2 N – – ; R3 Y N – ; R4 Y Y N — неактивна. 4) Web-Email-RU, Web-Google-EN, Web-Apple ID-RU, iOS-Email-EN, iOS-Google-RU, iOS-Apple ID-EN, Android-Email-RU, Android-Google-EN. 5) Всё, кроме «пароль виден в БД», «по телефону», «дизайн главной».',
    ],
    outro: 'Техники тест-дизайна работают вместе: каждая закрывает свой тип риска.',
  });

  window.TestDesign = { levels: LEVELS };
  window.Quest.create({ mode: 'design', icon: '🧩', title: 'Тест-дизайн', buildSim, levels: LEVELS });
})();
