// Общая «панель испытания» для симуляторов: шаги, их проверка по действиям игрока, свитки подсказок, награда.
// Симулятор сообщает о действиях через ctx.emit(событие); каждый шаг проверяет журнал событий.
(function () {
  'use strict';

  const Core = window.Core;
  const P = window.Progression;
  const esc = Core.esc;
  const HINT_MULT = [1, 0.7, 0.4, 0.2];
  const starStr = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

  // opts: { mode, icon, title, levels: [level], buildSim(el, ctx, level) → { reset?() } }
  // level: { id, title, giver: { name, sprite }, gold, steps: [step], hints: [3], outro? }
  // Уровни открываются по порядку: следующий доступен, когда пройден предыдущий.
  // step: { id, text, check?(ctx) → bool, answer?: { kind: 'text'|'choice', options?, accept(value) → bool, placeholder? }, success? }
  function create(opts) {
    const screen = document.querySelector(`.screen[data-screen="${opts.mode}"]`);
    screen.innerHTML = `
      <div class="sim-head">
        <button class="ghost-btn" type="button" data-go="home">← К выбору режима</button>
        <h2 class="sim-title"><span aria-hidden="true">${opts.icon}</span> ${esc(opts.title)}</h2>
        <div class="sim-levels" role="tablist"></div>
      </div>
      <div class="sim-board">
        <aside class="panel quest" aria-live="polite"></aside>
        <div class="sim-area"></div>
      </div>`;
    screen.querySelector('[data-go]').addEventListener('click', () => Core.go('home'));
    const questEl = screen.querySelector('.quest');
    const simEl = screen.querySelector('.sim-area');
    const levelsEl = screen.querySelector('.sim-levels');

    let level = null;
    let sim = null;
    let ctx = null;
    let lastNote = '';

    function modeStore() {
      const st = Core.state;
      if (!st.sims) st.sims = {};
      if (!st.sims[opts.mode]) st.sims[opts.mode] = { levels: {} };
      return st.sims[opts.mode];
    }
    function store() {
      const m = modeStore();
      if (!m.levels[level.id]) m.levels[level.id] = { cleared: false, stars: 0, hints: 0, done: [] };
      return m.levels[level.id];
    }
    const clearedAt = (i) => { const ls = modeStore().levels[opts.levels[i].id]; return !!(ls && ls.cleared); };
    const unlocked = (i) => i === 0 || clearedAt(i - 1) || clearedAt(i);
    // Первый непройденный открытый уровень — с него продолжаем.
    function firstOpen() {
      const i = opts.levels.findIndex((l, k) => unlocked(k) && !clearedAt(k));
      return opts.levels[i < 0 ? 0 : i];
    }

    function xpOfLevel(i) { return P.levelXp(opts.mode, i); }

    function newCtx() {
      ctx = { log: [], state: {}, emit, level, MockApi: window.MockApi };
      return ctx;
    }

    function emit(ev) {
      ctx.log.push(Object.assign({ at: Date.now() }, ev));
      evaluate();
    }

    // Шаги идут по порядку: проверяется только текущий, пройденные остаются пройденными.
    function currentIndex() {
      const done = store().done;
      return level.steps.findIndex((s) => !done.includes(s.id));
    }

    function evaluate() {
      const st = store();
      let progressed = false;
      for (;;) {
        const i = currentIndex();
        if (i < 0) break;
        const step = level.steps[i];
        if (!step.check || !step.check(ctx)) break;
        complete(step);
        progressed = true;
      }
      if (progressed) {
        Core.save();
        render();
        if (currentIndex() < 0 && !st.cleared) victory();
      }
    }

    function complete(step) {
      const st = store();
      if (!st.done.includes(step.id)) st.done.push(step.id);
      lastNote = step.success || '';
    }

    function render() {
      const st = store();
      const cur = currentIndex();
      const idx = opts.levels.indexOf(level);
      const total = level.steps.length;
      const doneCount = st.done.length;
      const mult = HINT_MULT[st.hints];
      const gold = Math.round(level.gold * mult);

      levelsEl.innerHTML = opts.levels.map((l, i) => {
        const ls = modeStore().levels[l.id] || {};
        const open = unlocked(i);
        const cls = `sim-level${l === level ? ' active' : ''}${ls.cleared ? ' cleared' : ''}${open ? '' : ' locked'}`;
        const tip = `${i + 1}. ${l.title}${ls.cleared ? ' · ' + starStr(ls.stars) : open ? '' : ' · откроется после уровня ' + i}`;
        return `<button class="${cls}" type="button" data-i="${i}" title="${esc(tip)}" ${open ? '' : 'disabled'}>${open ? i + 1 : '🔒'}${ls.cleared ? `<small>${'★'.repeat(ls.stars)}</small>` : ''}</button>`;
      }).join('');
      levelsEl.querySelectorAll('.sim-level:not([disabled])').forEach((b) => b.addEventListener('click', () => { level = opts.levels[+b.dataset.i]; startLevel(); }));

      const steps = level.steps.map((s, i) => {
        const done = st.done.includes(s.id);
        const isCur = i === cur;
        let extra = '';
        if (isCur && s.answer) {
          if (s.answer.kind === 'choice') {
            extra = `<div class="step-answer" role="radiogroup">${s.answer.options.map((o, k) => `
              <label class="choice"><input type="radio" name="ans-${opts.mode}" value="${k}"><span>${esc(o)}</span></label>`).join('')}
              <button class="btn" type="button" data-answer>Ответить</button></div>`;
          } else {
            extra = `<div class="step-answer"><input type="text" class="answer-input" placeholder="${esc(s.answer.placeholder || 'Ответ')}" aria-label="Ответ">
              <button class="btn" type="button" data-answer>Ответить</button></div>`;
          }
          extra += '<p class="answer-note" hidden></p>';
        }
        return `<li class="step${done ? ' done' : ''}${isCur ? ' current' : ''}">
          <span class="step-mark" aria-hidden="true">${done ? '✓' : i + 1}</span>
          <div class="step-body"><p>${s.text}</p>${extra}</div></li>`;
      }).join('');

      const hints = level.hints.slice(0, st.hints).map((h, i) => `<div class="hint open"><span class="lvl">${'I'.repeat(i + 1)}</span><span class="body">${h}</span></div>`).join('') +
        (st.hints < level.hints.length && !st.cleared
          ? `<button class="hint" type="button" data-hint><span class="lvl">${'I'.repeat(st.hints + 1)}</span><span>Сломать печать свитка</span><span class="cost">золото → ${Math.round(HINT_MULT[st.hints + 1] * 100)}%</span></button>`
          : st.hints < level.hints.length ? `<button class="hint" type="button" data-hint><span class="lvl">${'I'.repeat(st.hints + 1)}</span><span>Открыть свиток</span><span class="cost">бесплатно</span></button>` : '');

      questEl.innerHTML = `
        <div class="giver">
          <div class="giver-sprite" aria-hidden="true">${level.giver.sprite}</div>
          <div>
            <p class="eyebrow">Уровень ${idx + 1} · ${esc(level.title)}</p>
            <h3 class="giver-name">${esc(level.giver.name)}</h3>
            <div class="bar seal"><i style="width:${(1 - doneCount / total) * 100}%"></i></div>
            <p class="giver-meta">${st.cleared ? 'Испытание пройдено' : `Печать испытания: ${total - doneCount} из ${total}`}</p>
          </div>
        </div>
        ${lastNote ? `<p class="step-success">${lastNote}</p>` : ''}
        <ol class="steps">${steps}</ol>
        <div class="reward">${st.cleared
          ? `<span class="stars">${starStr(st.stars)}</span><span class="muted">Уровень пройден</span>`
          : `<span>Награда:</span><span class="chip gold">🪙 <b>${gold}</b></span><span class="chip">✦ ${xpOfLevel(idx)} XP</span><span class="stars">${starStr(3 - st.hints)}</span>`}</div>
        <div class="scrolls"><p class="eyebrow">Свитки подсказок <span>открыто ${st.hints} из ${level.hints.length}</span></p><div class="hints">${hints}</div></div>
        <div class="quest-actions"><button class="ghost-btn" type="button" data-restart>Пройти уровень заново</button></div>`;

      const hb = questEl.querySelector('[data-hint]');
      if (hb) hb.addEventListener('click', () => { store().hints++; Core.save(); render(); });
      questEl.querySelector('[data-restart]').addEventListener('click', () => {
        const s2 = store();
        s2.done = [];
        lastNote = '';
        Core.save();
        startLevel();
      });
      const ab = questEl.querySelector('[data-answer]');
      if (ab) {
        const step = level.steps[cur];
        const submit = () => {
          let v;
          if (step.answer.kind === 'choice') {
            const c = questEl.querySelector(`input[name="ans-${opts.mode}"]:checked`);
            v = c ? Number(c.value) : null;
          } else v = questEl.querySelector('.answer-input').value.trim();
          const note = questEl.querySelector('.answer-note');
          if (v === null || v === '') { note.hidden = false; note.textContent = 'Сначала выбери или впиши ответ.'; return; }
          if (step.answer.accept(v, ctx)) {
            ctx.log.push({ type: 'answer', step: step.id, value: v });
            complete(step);
            Core.save();
            render();
            if (currentIndex() < 0 && !store().cleared) victory();
          } else {
            note.hidden = false;
            note.textContent = step.answer.wrong || 'Не то. Посмотри в симуляторе ещё раз.';
          }
        };
        ab.addEventListener('click', submit);
        const inp = questEl.querySelector('.answer-input');
        if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      }
    }

    function victory() {
      const st = store();
      const before = Core.rank();
      const idx = opts.levels.indexOf(level);
      const gold = Math.round(level.gold * HINT_MULT[st.hints]);
      st.cleared = true;
      st.stars = 3 - st.hints;
      Core.state.gold += gold;
      const up = Core.rankUp(before);
      Core.save();
      Core.renderHud();
      render();
      const next = opts.levels[idx + 1];
      const items = [
        `<li><span>Золото${st.hints ? ` (${Math.round(HINT_MULT[st.hints] * 100)}%)` : ''}</span><span>+${gold}</span></li>`,
        `<li><span>Опыт</span><span>+${xpOfLevel(idx)} XP</span></li>`,
      ].concat(up.lines).join('');
      Core.modal(`
        <div class="big">${up.rank ? `<img class="modal-avatar" src="${Core.avatar(up.rank)}" alt="">` : level.giver.sprite}</div>
        <h3>Испытание пройдено</h3>
        <div class="modal-stars">${starStr(st.stars)}</div>
        <ul class="loot">${items}</ul>
        ${level.outro ? `<p class="modal-tip">${esc(level.outro)}</p>` : ''}
        <button class="btn attack" id="modal-next" type="button">${next ? `Уровень ${idx + 2} →` : 'К выбору режима'}</button>
        <button class="btn" id="modal-close" type="button">Остаться</button>
      `, { onNext: () => { if (next) { level = next; setTimeout(startLevel, 0); } else Core.go('home'); } });
    }

    function startLevel() {
      lastNote = '';
      newCtx();
      simEl.innerHTML = '';
      sim = opts.buildSim(simEl, ctx, level) || {};
      render();
    }

    let started = false;
    Core.registerMode(opts.mode, {
      icon: opts.icon,
      xpOf: (state) => {
        const m = state.sims && state.sims[opts.mode];
        if (!m) return 0;
        return opts.levels.reduce((sum, l, i) => sum + (m.levels[l.id] && m.levels[l.id].cleared ? xpOfLevel(i) : 0), 0);
      },
      progressOf: (state) => {
        const m = (state.sims && state.sims[opts.mode]) || { levels: {} };
        return { done: opts.levels.filter((l) => m.levels[l.id] && m.levels[l.id].cleared).length, available: opts.levels.length };
      },
      open: () => { if (!started) { started = true; level = firstOpen(); startLevel(); } else render(); },
      refresh: () => render(),
    });

    return { get ctx() { return ctx; } };
  }

  window.Quest = { create };
})();
