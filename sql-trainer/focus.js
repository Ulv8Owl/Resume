// «Протокол фокуса»: шесть шагов, чтобы долго и без отвлечений готовиться к собеседованию.
//   1. Преднастрой дофамин — с вечера записать цель на завтра, картину результата и связь с большой целью.
//   2. Раздели типы работы — у каждого спринта тип: черновой (новое, без перфекционизма) или механический (практика).
//   3. Ограничь время — таймер дня (до какого часа работаешь) и таймер спринта, оба всё время на экране.
//   4. Создай челлендж — у спринта цель в очках; очки начисляются сами за дела в режимах игры.
//   5. Успешный старт — первый спринт дня короткий и с заниженной целью, награда за него двойная.
//   6. Исключи стимулы — чек-лист перед стартом; уход со вкладки во время спринта считается отвлечением.
// Состояние — Core.state.focus (синхронизируется с облаком вместе с остальным прогрессом).
(function () {
  'use strict';

  const Core = window.Core;
  const esc = Core.esc;
  const $ = (id) => document.getElementById(id);

  // сколько очков приносит дело в игре (Core.track)
  const POINTS = { 'sql-room': 3, 'http-task': 2, 'sim-level': 5, 'theory-card': 1, 'jobs-action': 1 };
  const WORDS_PER_POINT = 20; // конспект: очко за каждые 20 новых слов
  const AWAY_MS = 15000; // ушёл со вкладки дольше чем на 15 секунд — отвлечение

  const TYPES = {
    draft: { name: 'Черновой', icon: '✍️', text: 'Новое, без стремления к идеалу: новые залы SQL и монстры HTTP, карточки Библиотеки, черновики в Конспекте.' },
    mech: { name: 'Механический', icon: '⚙️', text: 'Практика по готовому: повтор пройденных монстров, Блиц, уровни симуляторов, правка конспектов.' },
  };
  const CHECKLIST = [
    'Телефон в другой комнате или экраном вниз, звук выключен',
    'Уведомления на компьютере выключены, соцсети и мессенджеры закрыты',
    'Лишние вкладки закрыты — открыта только Академия',
    'Завтрак лёгкий и белковый, без быстрых углеводов и без видео за едой',
    'Вода рядом, место для работы готово',
    'Я знаю, ради чего сегодня работаю',
  ];

  const day = (d) => (d || new Date()).toLocaleDateString('sv');
  const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return day(d); };
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const hmm = (ms) => { const m = Math.max(0, Math.ceil(ms / 60000)); return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`; };

  function S() {
    const st = Core.state;
    if (!st.focus || typeof st.focus !== 'object') st.focus = {};
    const f = st.focus;
    if (!f.history) f.history = {};
    return f;
  }
  // день фокуса — только сегодняшний; вчерашний незакрытый день закрываем
  function today() {
    const f = S();
    if (f.day && f.day.date !== day()) endDay(true);
    return f.day || null;
  }
  const sprint = () => { const d = today(); return d && d.cur != null ? d.sprints[d.cur] : null; };
  const planFor = (date) => { const p = S().plan; return p && p.for === date ? p : null; };

  // ---------- очки за дела в игре ----------
  Core.on((type, data) => {
    const sp = sprint();
    if (!sp || Date.now() > sp.end) return;
    const pts = type === 'notes-words' ? (data.n || 0) / WORDS_PER_POINT : POINTS[type] || 0;
    if (!pts) return;
    sp.points = Math.round((sp.points + pts) * 100) / 100;
    widget();
  });

  // ---------- отвлечения: уход со вкладки во время спринта ----------
  let awayAt = 0;
  document.addEventListener('visibilitychange', () => {
    const sp = sprint();
    if (!sp) return;
    if (document.hidden) { awayAt = Date.now(); return; }
    if (awayAt && Date.now() - awayAt > AWAY_MS && Date.now() < sp.end) {
      sp.distractions = (sp.distractions || 0) + 1;
      Core.save();
      flash(`Отвлечение №${sp.distractions}. Возвращаемся в фокус!`);
    }
    awayAt = 0;
  });

  // ---------- день и спринты ----------
  function startDay(deadlineTime) {
    const [h, m] = deadlineTime.split(':').map(Number);
    const end = new Date();
    end.setHours(h, m, 0, 0);
    if (end.getTime() <= Date.now()) return 'Время окончания уже прошло — выбери более позднее.';
    const plan = planFor(day());
    S().day = { date: day(), started: Date.now(), deadline: end.getTime(), sprints: [], cur: null, planned: !!(plan && plan.made < new Date().setHours(0, 0, 0, 0)) };
    Core.save();
    return '';
  }

  function startSprint(type, minutes, target) {
    const d = today();
    d.sprints.push({ type, minutes, target, start: Date.now(), end: Math.min(d.deadline, Date.now() + minutes * 60000), points: 0, distractions: 0, done: false });
    d.cur = d.sprints.length - 1;
    Core.save();
  }

  // Итог спринта: челлендж выполнен — золото (первый спринт ×2, без отвлечений +50%, цель записана с вечера +25%).
  function finishSprint(early) {
    const d = today();
    const sp = sprint();
    if (!sp) return;
    sp.done = true;
    sp.end = Math.min(sp.end, Date.now());
    sp.ok = sp.points >= sp.target;
    const first = d.cur === 0;
    let gold = 0;
    const lines = [];
    if (sp.ok) {
      gold = 10 + Math.round(sp.minutes / 3);
      lines.push(`<li><span>Челлендж выполнен</span><span>+${gold}</span></li>`);
      if (first) { lines.push(`<li><span>Успешный старт ×2</span><span>+${gold}</span></li>`); gold *= 2; }
      if (!sp.distractions) { const b = Math.round(gold * 0.5); lines.push(`<li><span>Ни одного отвлечения</span><span>+${b}</span></li>`); gold += b; }
      if (d.planned) { const b = Math.round(gold * 0.25); lines.push(`<li><span>Цель записана с вечера</span><span>+${b}</span></li>`); gold += b; }
      Core.state.gold += gold;
    }
    sp.gold = gold;
    d.cur = null;
    Core.save();
    Core.renderHud();
    widget();
    if (Core.screen === 'focus') render();
    Core.modal(`<div class="big">${sp.ok ? '🎯' : '⏳'}</div>
      <h3>${sp.ok ? 'Спринт выполнен!' : early ? 'Спринт остановлен' : 'Время спринта вышло'}</h3>
      <p class="modal-tip">${TYPES[sp.type].icon} ${TYPES[sp.type].name} · ${sp.minutes} мин · очки ${fmt(sp.points)} из ${sp.target} · отвлечений: ${sp.distractions || 0}</p>
      ${sp.ok ? `<ul class="loot">${lines.join('')}</ul>` : '<p>Не страшно: поставь следующий спринт короче или цель поменьше — важно снова попасть в рамки.</p>'}
      <p class="modal-tip">Перерыв 5–10 минут без телефона: встань, подвигайся, попей воды.</p>
      <button class="btn attack" id="modal-close" type="button">К протоколу</button>`, { onClose: () => Core.go('focus') });
  }

  function endDay(silent) {
    const f = S();
    const d = f.day;
    if (!d) return;
    if (d.cur != null) { const sp = d.sprints[d.cur]; sp.done = true; sp.ok = sp.points >= sp.target; sp.end = Math.min(sp.end, Date.now()); d.cur = null; }
    const ok = d.sprints.filter((s) => s.ok).length;
    const minutes = Math.round(d.sprints.reduce((s, x) => s + (x.end - x.start), 0) / 60000);
    const points = d.sprints.reduce((s, x) => s + x.points, 0);
    let bonus = 0;
    if (ok >= 3 && !silent) { bonus = 50 + ok * 10; Core.state.gold += bonus; }
    f.history[d.date] = { sprints: d.sprints.length, ok, minutes, points: fmt(points), bonus };
    f.day = null;
    Core.save();
    Core.renderHud();
    widget();
    if (silent) return;
    if (Core.screen === 'focus') render();
    Core.modal(`<div class="big">🌙</div><h3>День фокуса завершён</h3>
      <ul class="loot"><li><span>Спринтов выполнено</span><span>${ok} из ${d.sprints.length}</span></li><li><span>Время в фокусе</span><span>${hmm(minutes * 60000)}</span></li><li><span>Очки</span><span>${fmt(points)}</span></li>${bonus ? `<li><span>Бонус за 3+ выполненных спринта</span><span>+${bonus} 🪙</span></li>` : ''}</ul>
      <p class="modal-tip">Не забудь шаг 1: запиши цель на завтра — утром начать будет гораздо легче.</p>
      <button class="btn attack" id="modal-close" type="button">Записать цель на завтра</button>`, { onClose: () => Core.go('focus') });
  }

  const fmt = (n) => Math.round(n * 10) / 10;

  // ---------- плавающие таймеры (шаг 3): видны в любом режиме ----------
  const box = document.createElement('button');
  box.type = 'button';
  box.id = 'focus-widget';
  box.className = 'focus-widget';
  box.hidden = true;
  box.title = 'Протокол фокуса';
  box.addEventListener('click', () => Core.go('focus'));
  document.body.appendChild(box);
  let flashText = '';
  let flashUntil = 0;
  function flash(text) { flashText = text; flashUntil = Date.now() + 6000; widget(); }

  function widget() {
    const d = Core.ready ? today() : null;
    box.hidden = !d || !$('auth-gate').hidden;
    if (box.hidden) return;
    const sp = sprint();
    const now = Date.now();
    const pct = sp ? Math.min(100, (sp.points / sp.target) * 100) : 0;
    box.classList.toggle('warn', !!sp && sp.end - now < 5 * 60000);
    box.innerHTML = flashUntil > now
      ? `<b class="fw-flash">${esc(flashText)}</b>`
      : `${sp ? `<span class="fw-main">🎯 ${mmss(sp.end - now)}</span><span class="fw-pts">${fmt(sp.points)} / ${sp.target}</span><i class="fw-bar"><i style="width:${pct}%"></i></i>`
        : '<span class="fw-main">☕ Перерыв</span><span class="fw-pts">начни спринт</span>'}
        <span class="fw-day">день: ${hmm(d.deadline - now)}</span>`;
  }

  setInterval(() => {
    if (!Core.ready) return;
    const d = today();
    if (d && Date.now() >= d.deadline && !Core.modalOpen()) return endDay(false);
    const sp = sprint();
    if (sp && Date.now() >= sp.end && !Core.modalOpen()) return finishSprint(false);
    widget();
    if (Core.screen === 'focus' && !Core.modalOpen()) tickScreen();
  }, 1000);

  // ---------- экран протокола ----------
  const screen = document.querySelector('.screen[data-screen="focus"]');
  let msg = '';

  const STEPS = [
    ['Преднастрой дофамин', 'С вечера запиши цель на завтра и представь результат дня в деталях.'],
    ['Раздели типы работы', 'Черновая работа — отдельно от механической: так меньше сопротивление на старте.'],
    ['Ограничь время', 'Таймер дня и таймер спринта всё время перед глазами.'],
    ['Создай челлендж', 'Цель в очках на короткий спринт — мозг включает «туннельное зрение».'],
    ['Успешный старт', 'Первый спринт короткий и лёгкий: уложился — заряд на весь день.'],
    ['Исключи стимулы', 'Телефон, соцсети, ролики и тяжёлая еда крадут дофамин у дела.'],
  ];
  const stepsHtml = `<details class="focus-steps"><summary>6 шагов протокола — как это работает</summary><ol>${STEPS.map(([t, d]) => `<li><b>${t}.</b> ${d}</li>`).join('')}</ol>
    <p class="modal-tip">Очки: зал SQL — 3, монстр HTTP — 2, уровень симулятора — 5, вопрос Библиотеки или Блица — 1, действие в «Поиске работы» — 1, ${WORDS_PER_POINT} новых слов в Конспекте — 1.</p></details>`;

  function planForm() {
    const p = planFor(tomorrow());
    return `<section class="panel focus-card"><p class="eyebrow">Шаг 1 · Преднастрой дофамин</p>
      <h3>Цель на завтра</h3>
      <form class="focus-plan" data-plan>
        <label>Что сделаю завтра<input name="goal" maxlength="140" required value="${esc(p ? p.goal : '')}" placeholder="Например: 10 залов SQL и конспект по HTTP"></label>
        <label>Как будет выглядеть результат дня<textarea name="result" maxlength="400" rows="2" placeholder="Вечером закрываю ноутбук: 10 залов пройдено, конспект готов, я спокоен перед собеседованием">${esc(p ? p.result : '')}</textarea></label>
        <label>Ради чего это<input name="why" maxlength="140" value="${esc(p ? p.why : (S().plan && S().plan.why) || '')}" placeholder="Оффер Middle QA с зарплатой мечты"></label>
        <button class="btn" type="submit">${p ? 'Обновить план на завтра' : 'Записать план на завтра'}</button>
      </form>${p ? '<p class="focus-ok">✓ План на завтра записан. Перед сном представь, как ты весь день спокойно и сосредоточенно работаешь.</p>' : ''}</section>`;
  }

  function todayPlan() {
    const p = planFor(day());
    if (!p) return '<p class="modal-tip">Вчера цель не записана — запиши её сейчас в двух словах в «Цель на завтра» вечером, а сегодня просто начни с короткого спринта.</p>';
    return `<div class="focus-today"><p class="eyebrow">Твоя цель на сегодня (записана вчера)</p><p class="focus-goal">${esc(p.goal)}</p>
      ${p.result ? `<p>${esc(p.result)}</p>` : ''}${p.why ? `<p class="modal-tip">Ради чего: ${esc(p.why)}</p>` : ''}</div>`;
  }

  function startForm() {
    const def = new Date(Math.min(Date.now() + 8 * 3600000, new Date().setHours(23, 30, 0, 0)));
    const t = `${String(def.getHours()).padStart(2, '0')}:${String(def.getMinutes() < 30 ? 0 : 30).padStart(2, '0')}`;
    return `<section class="panel focus-card"><p class="eyebrow">Начать день фокуса</p>
      ${todayPlan()}
      <form class="focus-start" data-start>
        <p class="eyebrow">Шаг 6 · Исключи стимулы</p>
        <div class="focus-check">${CHECKLIST.map((c, i) => `<label><input type="checkbox" name="c${i}" required> ${esc(c)}</label>`).join('')}</div>
        <p class="eyebrow">Шаг 3 · Ограничь время</p>
        <label class="focus-inline">Работаю до <input type="time" name="deadline" value="${t}" required></label>
        <button class="btn attack" type="submit">Начать день фокуса</button>
      </form></section>`;
  }

  function sprintForm(d) {
    const first = d.sprints.length === 0;
    const left = Math.floor((d.deadline - Date.now()) / 60000);
    const durs = [15, 25, 30, 45, 60].filter((m) => m <= Math.max(15, left));
    const def = first ? 25 : 30;
    const target = (m) => Math.max(2, Math.round(m / 3 * (first ? 0.7 : 1)));
    return `<section class="panel focus-card"><p class="eyebrow">${first ? 'Шаг 5 · Успешный старт' : 'Следующий спринт'}</p>
      ${first ? '<p>Первый спринт — короткий и с заниженной целью. Уложиться в рамки сейчас важнее всего: награда за него двойная.</p>' : ''}
      <form class="focus-sprint" data-sprint>
        <p class="eyebrow">Шаг 2 · Тип работы</p>
        <div class="focus-types">${Object.entries(TYPES).map(([k, v], i) => `<label class="focus-type"><input type="radio" name="type" value="${k}" ${i === (first ? 0 : d.sprints.length % 2) ? 'checked' : ''}><b>${v.icon} ${v.name}</b><small>${v.text}</small></label>`).join('')}</div>
        <p class="eyebrow">Шаг 4 · Челлендж</p>
        <div class="focus-row">
          <label class="focus-inline">Длительность <select name="min">${durs.map((m) => `<option value="${m}" ${m === def ? 'selected' : ''}>${m} мин</option>`).join('')}</select></label>
          <label class="focus-inline">Цель <input type="number" name="target" min="1" max="200" value="${target(def)}" required> очков</label>
        </div>
        <button class="btn attack" type="submit">▶ Старт спринта</button>
      </form></section>`;
  }

  function activeCard(sp) {
    const now = Date.now();
    return `<section class="panel focus-card focus-live"><p class="eyebrow">Идёт спринт · ${TYPES[sp.type].icon} ${TYPES[sp.type].name}</p>
      <div class="focus-clock" data-clock>${mmss(sp.end - now)}</div>
      <div class="bar focus-progress"><i data-prog style="width:${Math.min(100, sp.points / sp.target * 100)}%"></i></div>
      <p><b data-pts>${fmt(sp.points)}</b> из ${sp.target} очков · отвлечений: ${sp.distractions || 0}</p>
      <p class="modal-tip">${TYPES[sp.type].text} Очки начисляются сами — иди в режимы, таймер останется в углу экрана.</p>
      <div class="focus-row"><button class="btn attack" type="button" data-go-home>К башне — работать</button><button class="ghost-btn" type="button" data-stop>Остановить спринт</button></div></section>`;
  }

  function dayCard(d) {
    const done = d.sprints.filter((s) => s.done);
    return `<section class="panel focus-card"><p class="eyebrow">Сегодня</p>
      <p class="focus-daytime">До конца дня фокуса: <b data-day>${hmm(d.deadline - Date.now())}</b></p>
      ${done.length ? `<ul class="focus-list">${done.map((s, i) => `<li>${s.ok ? '✅' : '⏳'} Спринт ${i + 1} · ${TYPES[s.type].icon} ${s.minutes} мин · ${fmt(s.points)}/${s.target}${s.distractions ? ` · отвлечений ${s.distractions}` : ''}${s.gold ? ` · +${s.gold} 🪙` : ''}</li>`).join('')}</ul>` : '<p class="modal-tip">Спринтов ещё не было.</p>'}
      <button class="ghost-btn" type="button" data-end-day>Завершить день</button></section>`;
  }

  function historyCard() {
    const h = S().history;
    const days = Object.keys(h).sort().reverse().slice(0, 7);
    if (!days.length) return '';
    return `<section class="panel focus-card"><p class="eyebrow">Последние дни</p><ul class="focus-list">${days.map((k) => {
      const x = h[k];
      return `<li><b>${k.split('-').reverse().slice(0, 2).join('.')}</b> · спринтов ${x.ok}/${x.sprints} · ${hmm(x.minutes * 60000)} в фокусе · ${x.points} очков</li>`;
    }).join('')}</ul></section>`;
  }

  function render() {
    const d = today();
    const sp = sprint();
    screen.innerHTML = `
      <div class="sim-head">
        <button class="ghost-btn" type="button" data-home>← К выбору режима</button>
        <h2 class="sim-title"><span aria-hidden="true">🎯</span> Протокол фокуса</h2>
      </div>
      ${stepsHtml}
      ${msg ? `<p class="shop-msg" aria-live="polite">${esc(msg)}</p>` : ''}
      <div class="focus-grid">
        ${!d ? startForm() : sp ? activeCard(sp) : sprintForm(d)}
        ${d ? dayCard(d) : ''}
        ${planForm()}
        ${historyCard()}
      </div>`;
    msg = '';
    bind();
  }

  // раз в секунду обновляем только цифры — формы не перерисовываем
  function tickScreen() {
    const sp = sprint();
    const d = today();
    const c = screen.querySelector('[data-clock]');
    if (c && sp) {
      c.textContent = mmss(sp.end - Date.now());
      screen.querySelector('[data-pts]').textContent = fmt(sp.points);
      screen.querySelector('[data-prog]').style.width = Math.min(100, sp.points / sp.target * 100) + '%';
    }
    const dd = screen.querySelector('[data-day]');
    if (dd && d) dd.textContent = hmm(d.deadline - Date.now());
  }

  function bind() {
    screen.querySelector('[data-home]').addEventListener('click', () => Core.go('home'));
    const plan = screen.querySelector('[data-plan]');
    plan.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(plan));
      S().plan = { for: tomorrow(), made: Date.now(), goal: v.goal.trim(), result: v.result.trim(), why: v.why.trim() };
      Core.save();
      msg = 'План на завтра записан. Утром он будет ждать тебя здесь.';
      render();
    });
    const start = screen.querySelector('[data-start]');
    if (start) start.addEventListener('submit', (e) => {
      e.preventDefault();
      const err = startDay(new FormData(start).get('deadline'));
      msg = err || 'День фокуса начат. Теперь первый спринт — короткий и лёгкий.';
      render();
      widget();
    });
    const sf = screen.querySelector('[data-sprint]');
    if (sf) {
      const first = today().sprints.length === 0;
      sf.querySelector('[name="min"]').addEventListener('change', (e) => {
        sf.querySelector('[name="target"]').value = Math.max(2, Math.round(+e.target.value / 3 * (first ? 0.7 : 1)));
      });
      sf.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = new FormData(sf);
        startSprint(v.get('type'), +v.get('min'), Math.max(1, +v.get('target')));
        render();
        widget();
      });
    }
    const home = screen.querySelector('[data-go-home]');
    if (home) home.addEventListener('click', () => Core.go('home'));
    const stop = screen.querySelector('[data-stop]');
    if (stop) stop.addEventListener('click', () => { if (window.confirm('Остановить спринт досрочно?')) finishSprint(true); });
    const end = screen.querySelector('[data-end-day]');
    if (end) end.addEventListener('click', () => { if (window.confirm('Завершить день фокуса?')) endDay(false); });
  }

  Core.registerMode('focus', { open: () => render(), refresh: () => { if (!screen.querySelector('form:focus-within')) render(); } });
  window.Focus = { widget, state: S };
})();
