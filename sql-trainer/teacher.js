// Наставник-Архимаг: ежедневное задание и разговор.
// Каждый день (по местному времени) задание новое: 20 карточек теории, 10 залов SQL и ещё два случайных дела.
// Режимы сообщают о сделанном через Core.track, здесь это считается. За выполненное задание — золото и расходники.
(function () {
  'use strict';

  const Core = window.Core;
  const P = window.Progression;
  const esc = Core.esc;
  const PORTRAIT = 'Avatars/Teacher.jpeg';
  const REWARD_GOLD = 200;
  // опыт — как за пять боёв в Подземелье SQL (средний бой); копится в sql.extraXp, как опыт за повторные победы
  const SQL_MODE = window.Progression.mode('sql');
  const REWARD_XP = Math.round(SQL_MODE.budget / SQL_MODE.planned * 5);
  const DAILY_ITEMS = [['hp', 2], ['mana', 2], ['scroll2', 1]];

  // Обязательные дела и пул случайных. count — сколько нужно; unique — считать разные залы/уровни, а не повторы.
  const REQUIRED = [
    { kind: 'theory', mode: 'theory', event: 'theory-card', count: 20, unique: true, text: 'Ответь на 20 вопросов теории (засчитанных «Знаю»)' },
    { kind: 'sql', mode: 'sql', event: 'sql-room', count: 10, unique: true, text: 'Пройди 10 залов SQL (можно и уже зачищенные)' },
  ];
  const SIM_MODES = ['design', 'swagger', 'postman', 'charles', 'devtools', 'git', 'jmeter'];
  const EXTRA = SIM_MODES.map((m) => ({ kind: 'sim-' + m, mode: m, event: 'sim-level', match: (d) => d.mode === m, count: 1, unique: true }))
    .concat([{ kind: 'jobs', mode: 'jobs', event: 'jobs-action', count: 5, text: 'Сделай 5 действий в «Поиске работы»' }]);
  const extraText = (t) => t.text || `Пройди уровень в режиме «${P.mode(t.mode).name}»`;

  const today = () => new Date().toLocaleDateString('sv');

  // Детерминированный «случай» по дате: в один день у игрока одно и то же задание, даже после перезагрузки.
  function seeded(seed) {
    let h = 2166136261;
    for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
  }

  function S() {
    const st = Core.state;
    if (!st.daily || st.daily.date !== today()) {
      const rnd = seeded(today() + ':' + ((Core.account && Core.account.id) || 'guest'));
      const pool = EXTRA.filter((t) => Core.modes[t.mode]);
      const picks = [];
      while (picks.length < 2 && pool.length) picks.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
      const prevStreak = st.daily && st.daily.claimed && st.daily.date === yesterday() ? (st.daily.streak || 0) : 0;
      st.daily = {
        date: today(),
        tasks: REQUIRED.concat(picks).map((t) => ({ kind: t.kind, mode: t.mode, count: t.count, done: [], n: 0, required: REQUIRED.includes(t) })),
        claimed: false,
        greeted: false,
        streak: prevStreak,
      };
    }
    return st.daily;
  }
  function yesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString('sv');
  }

  const defOf = (task) => REQUIRED.concat(EXTRA).find((t) => t.kind === task.kind);
  const progressOf = (task) => Math.min(task.count, defOf(task).unique ? task.done.length : task.n);
  const isDone = (task) => progressOf(task) >= task.count;
  const allDone = () => S().tasks.every(isDone);
  const textOf = (task) => (task.required ? defOf(task).text : extraText(defOf(task)));

  Core.on((type, data) => {
    const d = S();
    if (d.claimed) return;
    let changed = false;
    d.tasks.forEach((task) => {
      const def = defOf(task);
      if (!def || def.event !== type || (def.match && !def.match(data)) || isDone(task)) return;
      if (def.unique) {
        const key = data.id || '';
        if (!task.done.includes(key)) { task.done.push(key); changed = true; }
      } else { task.n++; changed = true; }
    });
    if (changed) {
      Core.save();
      if (allDone()) toast('Наставник ждёт тебя: ежедневное задание выполнено!');
      renderBadge();
    }
  });

  // ---------- значок наставника ----------

  function badgeState() {
    const d = S();
    if (d.claimed) return '';
    if (allDone()) return 'reward';
    return d.greeted ? '' : 'new';
  }
  function renderBadge() {
    document.querySelectorAll('[data-teacher]').forEach((b) => {
      const st = badgeState();
      const done = S().tasks.filter(isDone).length;
      b.dataset.badge = st;
      const cnt = b.querySelector('.teacher-count');
      if (cnt) cnt.textContent = S().claimed ? '✓' : `${done}/${S().tasks.length}`;
    });
  }

  let toastTimer = null;
  function toast(text) {
    let t = document.getElementById('teacher-toast');
    if (!t) {
      t = document.createElement('button');
      t.id = 'teacher-toast';
      t.type = 'button';
      t.className = 'teacher-toast';
      t.addEventListener('click', () => { t.hidden = true; open(); });
      document.body.appendChild(t);
    }
    t.innerHTML = `<img src="${PORTRAIT}" alt=""><span>${esc(text)}</span>`;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
  }

  // ---------- диалог ----------

  const TIPS = [
    'На собеседовании не бойся сказать «не знаю, но рассуждал бы так…». Ход мысли ценят больше, чем заученный ответ.',
    'Рассказывая о баге, начинай с последствий для пользователя: «пользователь не может оплатить заказ», а не «кнопка серая».',
    'Тест-дизайн спрашивают почти всегда. Потренируй на любом поле формы: классы эквивалентности, границы и пара негативных проверок.',
    'Если просят протестировать предмет — ручку, лифт, чайник — сначала задай вопросы о требованиях. Это и есть первый шаг тестировщика.',
    'Знай разницу между 401 и 403, 400 и 422, 500 и 503. Её любят спрашивать на собеседованиях по API.',
    'SQL на собеседовании — это обычно JOIN, GROUP BY с HAVING и подзапрос. Каждый день по несколько залов — и рука набита.',
    'В резюме пиши результаты, а не обязанности: «нашёл 40 багов в модуле оплаты, 6 критичных» лучше, чем «тестировал оплату».',
    'Откликайся каждый день понемногу: пять откликов в день за месяц — это больше сотни шансов.',
    'Сопроводительное письмо в три предложения: кто ты, почему эта компания, чем полезен. Длинные письма не дочитывают.',
    'Перед собеседованием открой сайт или приложение компании и найди пару багов. Рассказать о них — сильный ход.',
    'Git тестировщику нужен каждый день: подтянуть ветку, посмотреть изменения, переключиться на нужную версию.',
    'Нагрузочное тестирование — это не «сломать сервер», а узнать, сколько пользователей он выдерживает с нужной скоростью.',
  ];

  function nextAdvice() {
    // Совет, чем заняться: режим, где доля набранного опыта меньше всего.
    const modes = P.MODES.filter((m) => Core.modes[m.id] && m.id !== 'jobs');
    let best = null;
    modes.forEach((m) => {
      const frac = Core.xpBy(m.id) / m.budget;
      if (!best || frac < best.frac) best = { m, frac };
    });
    return best ? `Загляни в «${best.m.name}»: там ты пока продвинулся меньше всего (${Math.round(best.frac * 100)}% опыта режима).` : 'Ты везде хорош. Повтори пройденное.';
  }

  function greeting() {
    const d = S();
    const name = Core.account ? Core.account.name : 'ученик';
    if (d.claimed) return `Сегодняшнее задание выполнено, ${name}. Отдыхай или тренируйся дальше — завтра утром будет новое.`;
    if (allDone()) return `Всё сделано, ${name}! Ты заслужил награду.`;
    return `Доброе утро, ${name}. Вот задание на сегодня. Первые два дела обязательны — это основа, без которой на собеседование не ходят.`;
  }

  function taskList() {
    return `<ul class="teacher-tasks">${S().tasks.map((t) => {
      const p = progressOf(t);
      return `<li class="${isDone(t) ? 'done' : ''}">
        <span class="tt-mark" aria-hidden="true">${isDone(t) ? '✓' : t.required ? '★' : '◆'}</span>
        <span class="tt-text">${esc(textOf(t))}${t.required ? '' : ' <small>доп.</small>'}</span>
        <span class="tt-prog">${p}/${t.count}</span>
        ${isDone(t) ? '' : `<button class="ghost-btn tt-go" type="button" data-go-mode="${t.mode}">Идти</button>`}
      </li>`;
    }).join('')}</ul>`;
  }

  function open(say) {
    const d = S();
    d.greeted = true;
    Core.save();
    renderBadge();
    const reward = allDone() && !d.claimed;
    const close = Core.modal(`
      <div class="teacher-dlg">
        <div class="teacher-head">
          <img class="teacher-portrait" src="${PORTRAIT}" alt="Наставник">
          <div><p class="eyebrow">Наставник · Архимаг</p><p class="teacher-say">${esc(say || greeting())}</p></div>
        </div>
        <p class="eyebrow">Задание на ${new Date().toLocaleDateString('ru', { day: 'numeric', month: 'long' })}${d.streak ? ` · 🔥 дней подряд: ${d.streak}` : ''}</p>
        ${taskList()}
        ${reward ? `<button class="btn attack" id="teacher-claim" type="button">Забрать награду: ${REWARD_GOLD} 🪙, ${REWARD_XP} XP и зелья 🧪</button>` : ''}
        <div class="teacher-talk">
          <button class="ghost-btn" type="button" data-talk="task">Зачем мне это задание?</button>
          <button class="ghost-btn" type="button" data-talk="next">Чем заняться дальше?</button>
          <button class="ghost-btn" type="button" data-talk="tip">Дай совет к собеседованию</button>
          <button class="ghost-btn" type="button" data-talk="tower">Что где в башне?</button>
          <button class="ghost-btn" type="button" data-talk="me">Расскажи о себе</button>
        </div>
        <button class="btn" id="modal-close" type="button">До встречи</button>
      </div>`);
    const answer = (text) => { close(); open(text); };
    document.querySelectorAll('[data-go-mode]').forEach((b) => b.addEventListener('click', () => { close(); Core.go(b.dataset.goMode); }));
    document.querySelectorAll('[data-talk]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.talk;
      if (k === 'task') answer('Теория и SQL — то, что спрашивают на каждом собеседовании. Понемногу каждый день лучше, чем всё за одну ночь: знания закрепляются, когда к ним возвращаешься. А два случайных дела не дают забыть остальные инструменты.');
      else if (k === 'next') answer(nextAdvice());
      else if (k === 'tip') answer(TIPS[Math.floor(Math.random() * TIPS.length)]);
      else if (k === 'tower') answer('В левой башенке — цитадель Git, в правой — обсерватория DevTools. Под крышей вороны разносят твои резюме — это Поиск работы. Ниже — зал API: свитки Swagger, хрустальный шар Charles и карты Postman. Дальше Совет магов с задачами по тест-дизайну, библиотека Теории, мастерская Голема для нагрузки JMeter и, в самом низу, дверь в Подземелье SQL.');
      else if (k === 'me') answer('Когда-то я тоже был учеником и путал верификацию с валидацией. Потом тысячи багов, сотни собеседований с обеих сторон стола… Теперь я помогаю другим пройти этот путь быстрее. Глаза мои не видят, зато баги я чую издалека.');
    }));
    const claim = document.getElementById('teacher-claim');
    if (claim) claim.addEventListener('click', () => {
      const dd = S();
      dd.claimed = true;
      dd.streak = (dd.streak || 0) + 1;
      Core.state.gold += REWARD_GOLD;
      const before = Core.rank();
      const sql = Core.state.sql || (Core.state.sql = {});
      sql.extraXp = (sql.extraXp || 0) + REWARD_XP;
      const up = Core.rankUp(before);
      // награда — золото и расходники в лавку: зелья и свиток
      const it = Core.state.items || (Core.state.items = {});
      DAILY_ITEMS.forEach(([k, n]) => { it[k] = (it[k] || 0) + n; });
      Core.save();
      Core.renderHud();
      close();
      open(`Держи: ${REWARD_GOLD} золота, ${REWARD_XP} опыта${up.rank ? ` — и новое звание: ${up.rank.name}!` : ''}, два зелья жизни, два зелья маны и обычный свиток. Они уже в твоей сумке.`);
      renderBadge();
    });
  }

  // Утром — новое задание: наставник сам зовёт, когда игрок впервые за день открывает главный экран.
  function greetIfNeeded() {
    if (!Core.ready || !document.getElementById('auth-gate').hidden || Core.modalOpen()) return;
    const d = S();
    if (d.greeted) return;
    open();
  }

  window.Teacher = { open, renderBadge, greetIfNeeded, PORTRAIT, state: S };
})();
