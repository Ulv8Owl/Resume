// «Практика собеседования» (🎓 в шапке): доп. режимы с практическими заданиями, как на собеседовании Middle QA.
// Режимы — в extra-modes/<id>.js (window.EXTRA[id] = { icon, name, tagline, tasks }), у каждого 5 заданий.
// Задание — ситуация (brief), необязательный макет (mock) и 1–4 шага разных типов:
//   single — один верный вариант, multi — несколько, lines — нажать нужные строки текста (лог, ТЗ, запрос),
//   order — расставить по порядку, match — сопоставить. Режим с sql: true играется на экране SQL (пентаграмма, схема).
// Награда: первое прохождение — золото и опыт режима «Практика», повтор — немного золота.
(function () {
  'use strict';

  const Core = window.Core;
  const P = window.Progression;
  const esc = Core.esc;
  const ORDER = ['testcases', 'bugreport', 'requirements', 'logs', 'mobile', 'strategy', 'webbasics', 'security', 'sqldata'];
  const FIRST_GOLD = 40;
  const REPEAT_GOLD = 10;
  const SQL_HIT = 10;

  const modes = () => ORDER.filter((id) => window.EXTRA && window.EXTRA[id]).map((id) => Object.assign({ id }, window.EXTRA[id]));
  const modeOf = (id) => modes().find((m) => m.id === id);
  // сквозной номер задания — для опыта: у каждого задания своя доля бюджета режима «Практика»
  const globalIndex = (id, i) => ORDER.indexOf(id) * 5 + i;
  const xpOf = (id, i) => P.levelXp('extra', globalIndex(id, i));
  const shuffle = (a) => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
  const starStr = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

  function S() {
    const st = Core.state;
    if (!st.extra || typeof st.extra !== 'object') st.extra = { done: {} };
    if (!st.extra.done) st.extra.done = {};
    return st.extra;
  }
  // done[id] = { "0": звёзды, "3": звёзды, … }
  const doneOf = (id) => S().done[id] || {};

  const screen = document.querySelector('.screen[data-screen="extra"]');
  let view = { mode: null, task: null };
  let run = null; // { mode, index, task, at, mistakes, state, note, noteCls }

  // ---------- шаги ----------
  function prepStep(s) {
    if (s.type === 'single' || s.type === 'multi') {
      const order = shuffle(s.options.map((_, i) => i));
      const right = s.type === 'single' ? [s.right] : s.right;
      return Object.assign({}, s, { view: order, rightSet: right });
    }
    if (s.type === 'order') {
      let items = shuffle(s.items);
      if (items.join('\u0001') === s.items.join('\u0001')) items = items.slice(1).concat(items[0]);
      return Object.assign({}, s, { cur: items });
    }
    if (s.type === 'match') {
      return Object.assign({}, s, { choices: shuffle(Array.from(new Set(s.pairs.map((p) => p[1])))), pick: s.pairs.map(() => '') });
    }
    return Object.assign({}, s);
  }

  function stepHtml(s) {
    const pick = run.pick || [];
    if (s.type === 'single') {
      return `<div class="blitz-options">${s.view.map((i) => `<button type="button" class="blitz-opt" data-single="${i}">${esc(s.options[i])}</button>`).join('')}</div>`;
    }
    if (s.type === 'multi') {
      return `<div class="blitz-options">${s.view.map((i) => `<label class="blitz-opt siege-check"><input type="checkbox" data-pick="${i}" ${pick.includes(i) ? 'checked' : ''}> ${esc(s.options[i])}</label>`).join('')}</div>
        <button class="btn attack" type="button" data-check>Проверить</button>`;
    }
    if (s.type === 'lines') {
      return `<ol class="x-lines${s.mono ? ' mono' : ''}">${s.text.map((t, i) => `<li><button type="button" class="${pick.includes(i) ? 'on' : ''}" data-line="${i}">${esc(t)}</button></li>`).join('')}</ol>
        <button class="btn attack" type="button" data-check>Проверить</button>`;
    }
    if (s.type === 'order') {
      return `<ol class="x-order">${s.cur.map((t, i) => `<li><span>${esc(t)}</span>
          <button type="button" class="ghost-btn" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Выше">↑</button>
          <button type="button" class="ghost-btn" data-down="${i}" ${i < s.cur.length - 1 ? '' : 'disabled'} aria-label="Ниже">↓</button></li>`).join('')}</ol>
        <button class="btn attack" type="button" data-check>Проверить</button>`;
    }
    return `<div class="x-match">${s.pairs.map((p, i) => `<label><span>${esc(p[0])}</span>
        <select data-match="${i}"><option value="">— выбери —</option>${s.choices.map((c) => `<option ${s.pick[i] === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>`).join('')}</div>
      <button class="btn attack" type="button" data-check>Проверить</button>`;
  }

  function grade(s, input) {
    const same = (a, b) => a.slice().sort().join(',') === b.slice().sort().join(',');
    if (s.type === 'single') return input === s.right ? '' : 'Неверно.';
    if (s.type === 'multi') {
      if (!input.length) return 'soft:Отметь хотя бы один вариант.';
      return same(input, s.rightSet) ? '' : `Не совсем: верных вариантов ${s.rightSet.length}.`;
    }
    if (s.type === 'lines') {
      if (!input.length) return 'soft:Нажми на нужные строки.';
      return same(input, s.right) ? '' : `Не совсем: нужных строк ${s.right.length}.`;
    }
    if (s.type === 'order') {
      const wrong = s.cur.filter((t, i) => t !== s.items[i]).length;
      return wrong ? `Порядок неверный: не на своём месте ${wrong} из ${s.items.length}.` : '';
    }
    if (s.pick.some((x) => !x)) return 'soft:Выбери значение для каждой строки.';
    const wrong = s.pairs.filter((p, i) => s.pick[i] !== p[1]).length;
    return wrong ? `Неверных сопоставлений: ${wrong}.` : '';
  }

  // ---------- экраны ----------
  function head(title, back) {
    return `<div class="sim-head">
      <button class="ghost-btn" type="button" data-back="${back}">${back === 'home' ? '← К выбору режима' : '← Назад'}</button>
      <h2 class="sim-title"><span aria-hidden="true">🎓</span> ${esc(title)}</h2></div>`;
  }

  function listHtml() {
    return `${head('Практика собеседования', 'home')}
      <p class="x-lead">Практические задания, которые реально дают на собеседовании Middle QA: по 5 в каждом режиме.</p>
      <div class="x-grid">${modes().map((m) => {
        const n = Object.keys(doneOf(m.id)).length;
        return `<button type="button" class="x-card${n >= m.tasks.length ? ' full' : ''}" data-mode="${m.id}">
          <span class="x-ico" aria-hidden="true">${m.icon}</span><span class="x-txt"><b>${esc(m.name)}</b><small>${esc(m.tagline)}</small></span>
          <span class="x-prog">${n}/${m.tasks.length}</span></button>`;
      }).join('')}</div>`;
  }

  function modeHtml(m) {
    const d = doneOf(m.id);
    return `${head(m.name, 'list')}<p class="x-lead">${esc(m.tagline)}</p>
      <ol class="x-tasks">${m.tasks.map((t, i) => `<li><button type="button" data-task="${i}">
        <span class="x-num">${i + 1}</span><span class="x-txt"><b>${esc(t.title)}</b><small>${t.steps ? `${t.steps.length} ${t.steps.length === 1 ? 'шаг' : 'шага'}` : 'на экране SQL'} · ${d[i] != null ? 'пройдено' : `🪙 ${FIRST_GOLD} · ✦ ${xpOf(m.id, i)} XP`}</small></span>
        <span class="x-stars">${d[i] != null ? starStr(d[i]) : ''}</span></button></li>`).join('')}</ol>`;
  }

  function taskHtml() {
    const m = modeOf(run.mode);
    const t = run.task;
    const s = run.steps[run.at];
    return `${head(m.name, 'mode')}
      <div class="x-task panel">
        <p class="eyebrow">Задание ${run.index + 1} из ${m.tasks.length} · шаг ${run.at + 1} из ${run.steps.length}</p>
        <h3>${esc(t.title)}</h3>
        <div class="x-brief">${t.brief}</div>
        ${t.mock ? `<div class="siege-mock x-mock">${t.mock}</div>` : ''}
        <div class="x-step"><p class="blitz-text">${esc(s.q)}</p>${stepHtml(s)}</div>
        ${run.note ? `<p class="arena-line ${run.noteCls}">${esc(run.note)}</p>` : ''}
        <div class="x-foot"><button type="button" class="ghost-btn" data-hint>💡 Подсказка</button><span class="x-mist">Ошибок: ${run.mistakes}</span></div>
      </div>`;
  }

  function render() {
    if (run) screen.innerHTML = taskHtml();
    else if (view.mode) screen.innerHTML = modeHtml(modeOf(view.mode));
    else screen.innerHTML = listHtml();
    bind();
  }

  function start(id, i) {
    const m = modeOf(id);
    const t = m.tasks[i];
    if (m.sql) return startSql(m, i);
    run = { mode: id, index: i, task: t, steps: t.steps.map(prepStep), at: 0, mistakes: 0, pick: [], note: '', noteCls: '' };
    render();
  }

  function submit(input) {
    const s = run.steps[run.at];
    const r = grade(s, input);
    if (r.startsWith('soft:')) { run.note = r.slice(5); run.noteCls = 'hurt'; return render(); }
    if (r) { run.mistakes++; run.note = r; run.noteCls = 'hurt'; return render(); }
    run.at++;
    run.pick = [];
    run.note = 'Верно!';
    run.noteCls = 'dmg';
    if (run.at >= run.steps.length) return finish(run.mode, run.index, run.mistakes, run.task.why);
    render();
  }

  function finish(id, i, mistakes, why) {
    const d = S().done[id] || (S().done[id] = {});
    const first = d[i] == null;
    const stars = Math.max(1, 3 - mistakes);
    const before = Core.rank();
    d[i] = Math.max(d[i] || 0, stars);
    const gold = first ? FIRST_GOLD : REPEAT_GOLD;
    Core.state.gold += gold;
    Core.track('extra-task', { id, i });
    const up = Core.rankUp(before);
    Core.save();
    Core.renderHud();
    run = null;
    view = { mode: id };
    if (Core.screen !== 'extra') Core.go('extra'); else render();
    const m = modeOf(id);
    const next = m.tasks[i + 1];
    Core.modal(`<div class="big">🎓</div><h3>Задание решено!</h3><div class="modal-stars">${starStr(stars)}</div>
      ${why ? `<p class="x-why">${esc(why)}</p>` : ''}
      <ul class="loot"><li><span>Золото</span><span>+${gold}</span></li>${first ? `<li><span>Опыт</span><span>+${xpOf(id, i)} XP</span></li>` : ''}${up.lines.join('')}</ul>
      ${next ? `<button class="btn attack" id="modal-next" type="button">Дальше: ${esc(next.title)}</button>` : ''}
      <button class="btn" id="modal-close" type="button">К списку заданий</button>`, { onNext: () => start(id, i + 1) });
  }

  // ---------- SQL-режим: задание на экране SQL ----------
  let launching = false;
  function startSql(m, i) {
    const t = m.tasks[i];
    const r = Object.assign({ index: 0, maxHp: 100, gold: FIRST_GOLD, xp: 0, monster: 'Архимаг-экзаменатор', floor: 'Практика', spell: 'Практика тестировщика', topic: 'тестовые данные', taunts: ['Архимаг качает головой.'], tables: [] }, t.room);
    launching = true;
    window.Dungeon.playExternal({
      label: `Практика · ${m.name} · ${i + 1}/${m.tasks.length}`,
      intro: t.brief.replace(/<[^>]+>/g, ''),
      enemy: { name: 'Архимаг-экзаменатор', icon: 'Avatars/Teacher.jpeg', hit: SQL_HIT },
      room: r,
      keep: () => { const k = launching; launching = false; return k; },
      onWin: () => { window.Dungeon.stopExternal(); finish(m.id, i, 0, t.why); },
      onDeath: () => {
        window.Dungeon.stopExternal();
        Core.state.hp = Core.maxHp();
        Core.state.mana = Core.maxMana();
        Core.save();
        Core.go('extra');
        Core.modal(`<div class="big">🪦</div><h3>Экзамен провален</h3><p>Здоровье восстановлено — попробуй ещё раз, «Разведать» бесплатно.</p>
          <button class="btn attack" id="modal-close" type="button">К заданиям</button>`);
      },
    });
    Core.go('sql');
  }

  function bind() {
    const back = screen.querySelector('[data-back]');
    if (back) back.addEventListener('click', () => {
      const to = back.dataset.back;
      if (to === 'home') return Core.go('home');
      if (to === 'mode') run = null; else view = { mode: null };
      render();
    });
    screen.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { view = { mode: b.dataset.mode }; render(); }));
    screen.querySelectorAll('[data-task]').forEach((b) => b.addEventListener('click', () => start(view.mode, +b.dataset.task)));
    if (!run) return;
    const s = run.steps[run.at];
    screen.querySelectorAll('[data-single]').forEach((b) => b.addEventListener('click', () => submit(+b.dataset.single)));
    screen.querySelectorAll('[data-pick]').forEach((c) => c.addEventListener('change', () => {
      run.pick = [...screen.querySelectorAll('[data-pick]:checked')].map((x) => +x.dataset.pick);
    }));
    screen.querySelectorAll('[data-line]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.line;
      run.pick = run.pick.includes(i) ? run.pick.filter((x) => x !== i) : run.pick.concat(i);
      b.classList.toggle('on');
    }));
    const move = (i, d) => { const a = s.cur; [a[i], a[i + d]] = [a[i + d], a[i]]; run.note = ''; render(); };
    screen.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.up, -1)));
    screen.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.down, 1)));
    screen.querySelectorAll('[data-match]').forEach((sel) => sel.addEventListener('change', () => { s.pick[+sel.dataset.match] = sel.value; }));
    const check = screen.querySelector('[data-check]');
    if (check) check.addEventListener('click', () => submit(s.type === 'multi' || s.type === 'lines' ? run.pick.slice() : null));
    screen.querySelector('[data-hint]').addEventListener('click', () => { run.mistakes++; run.note = '💡 ' + s.hint; run.noteCls = ''; render(); });
  }

  Core.registerMode('extra', {
    icon: '🎓',
    xpOf: (state) => {
      const d = (state.extra && state.extra.done) || {};
      return Object.entries(d).reduce((sum, [id, tasks]) => sum + Object.keys(tasks).reduce((s2, i) => s2 + (ORDER.includes(id) ? xpOf(id, +i) : 0), 0), 0);
    },
    progressOf: (state) => {
      const d = (state.extra && state.extra.done) || {};
      return { done: Object.values(d).reduce((s, x) => s + Object.keys(x).length, 0), available: modes().reduce((s, m) => s + m.tasks.length, 0) };
    },
    open: () => render(),
    refresh: () => { if (!run) render(); },
  });
})();
