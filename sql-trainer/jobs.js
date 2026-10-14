// Режим «Поиск работы»: бесконечные задания на реальные действия при поиске работы.
// Игрок сам отмечает, что сделал (отправил резюме, откликнулся…), и получает золото и опыт.
// Опыт копится без конца, но в звание засчитывается не больше бюджета режима (см. progression.js).
(function () {
  'use strict';

  const Core = window.Core;
  const P = window.Progression;
  const esc = Core.esc;
  const DAILY_GOAL = 5; // «весомых» действий в день для бонуса
  const DAILY_BONUS = 50;
  const LOG_SIZE = 100;

  // Задания: gold и xp — за одно выполнение; small — мелкое действие, не идёт в цель дня.
  const T = {
    hr: (where) => ({ id: 'hr', icon: '📨', name: 'Отправить резюме рекрутёру', hint: where, gold: 30, xp: 15 }),
    respond: (where) => ({ id: 'respond', icon: '🎯', name: 'Откликнуться на вакансию', hint: where, gold: 20, xp: 10 }),
  };
  const CATEGORIES = [
    {
      id: 'telegram', icon: '✈️', name: 'Telegram',
      tasks: [
        T.hr('Нашёл рекрутёра в Telegram и отправил ему резюме (не просто переписка).'),
        { id: 'post', icon: '📌', name: 'Закинуть резюме в канал', hint: 'Опубликовал резюме в канале или чате для соискателей.', gold: 20, xp: 10 },
        { id: 'respond', icon: '🎯', name: 'Откликнуться на вакансию в канале', hint: 'Откликнулся на вакансию из канала с вакансиями.', gold: 20, xp: 10 },
        { id: 'add', icon: '➕', name: 'Добавить канал', hint: 'Подписался на новый канал с вакансиями — впиши его в список ниже.', gold: 5, xp: 2, small: true, needsName: true },
      ],
      listTitle: 'Мои каналы с вакансиями',
    },
    {
      id: 'habr', icon: '🟢', name: 'Хабр Карьера', url: 'https://career.habr.com/vacancies?q=QA',
      tasks: [
        T.hr('Написал рекрутёру на Хабр Карьере и приложил резюме.'),
        T.respond('Откликнулся на вакансию на Хабр Карьере.'),
        { id: 'resume', icon: '📝', name: 'Обновить резюме', hint: 'Обновил профиль и резюме: навыки, опыт, проекты.', gold: 10, xp: 4, small: true },
        { id: 'follow', icon: '⭐', name: 'Подписаться на компанию', hint: 'Подписался на компанию, чтобы видеть её новые вакансии.', gold: 5, xp: 2, small: true },
      ],
    },
    {
      id: 'hh', icon: '🔴', name: 'HeadHunter', url: 'https://hh.ru/search/vacancy?text=QA',
      tasks: [
        T.hr('Нашёл контакт рекрутёра и отправил резюме напрямую.'),
        T.respond('Откликнулся на вакансию на hh.ru.'),
        { id: 'letter', icon: '✉️', name: 'Отклик с сопроводительным письмом', hint: 'Откликнулся и написал письмо под конкретную вакансию.', gold: 30, xp: 15 },
        { id: 'raise', icon: '⬆️', name: 'Поднять резюме в поиске', hint: 'Поднял резюме, чтобы его увидело больше работодателей.', gold: 5, xp: 2, small: true },
      ],
    },
    {
      id: 'linkedin', icon: '🔵', name: 'LinkedIn', url: 'https://www.linkedin.com/jobs/search/?keywords=QA',
      tasks: [
        T.hr('Написал рекрутёру в LinkedIn и приложил резюме.'),
        T.respond('Откликнулся на вакансию в LinkedIn.'),
        { id: 'connect', icon: '🤝', name: 'Добавить рекрутёра в контакты', hint: 'Отправил запрос в контакты рекрутёру или тимлиду QA.', gold: 5, xp: 2, small: true },
        { id: 'post', icon: '📣', name: 'Пост «Open to work»', hint: 'Опубликовал пост о поиске работы или полезный пост по тестированию.', gold: 20, xp: 10 },
      ],
    },
    {
      id: 'other', icon: '🌐', name: 'Другие сайты',
      sites: [
        ['SuperJob', 'https://www.superjob.ru/vakansii/testirovschik.html'],
        ['Работа.ру', 'https://www.rabota.ru/vacancy/?query=тестировщик'],
        ['Zarplata.ru', 'https://www.zarplata.ru/vacancy?q=тестировщик'],
        ['GeekJob', 'https://geekjob.ru/vacancies?qs=QA'],
        ['Getmatch', 'https://getmatch.ru/vacancies?q=QA'],
        ['Работа России', 'https://trudvsem.ru/vacancy/search?_title=тестировщик'],
      ],
      tasks: [
        T.hr('Отправил резюме рекрутёру, найденному на другом сайте.'),
        T.respond('Откликнулся на вакансию на другом сайте.'),
        { id: 'resume', icon: '📝', name: 'Разместить резюме', hint: 'Разместил или обновил резюме на сайте.', gold: 10, xp: 4, small: true },
        { id: 'signup', icon: '➕', name: 'Зарегистрироваться на новом сайте', hint: 'Завёл профиль на ещё одном сайте с вакансиями.', gold: 5, xp: 2, small: true },
      ],
    },
    {
      id: 'companies', icon: '🏢', name: 'Компании',
      tasks: [
        { id: 'site', icon: '🎯', name: 'Отклик на сайте компании', hint: 'Откликнулся на вакансию на карьерном сайте компании.', gold: 25, xp: 12, perCompany: true },
        T.hr('Нашёл рекрутёра компании и отправил ему резюме.'),
        { id: 'referral', icon: '🙋', name: 'Попросить рекомендацию', hint: 'Попросил знакомого из компании передать резюме (реферал).', gold: 30, xp: 15 },
        { id: 'add', icon: '➕', name: 'Добавить компанию', hint: 'Добавь компанию в свой список ниже.', gold: 5, xp: 2, small: true, needsName: true },
      ],
    },
  ];
  // Список компаний, где нанимают тестировщиков. Ссылка ведёт на поиск их QA-вакансий на hh.ru.
  const COMPANIES = ['Яндекс', 'Сбер', 'Т-Банк', 'VK', 'Ozon', 'Wildberries', 'Авито', 'Лаборатория Касперского',
    'Positive Technologies', 'МТС', 'Билайн', 'МегаФон', 'Ростелеком', 'Альфа-Банк', 'ВТБ', 'Газпромбанк',
    'Райффайзенбанк', 'X5 Tech', 'Магнит', 'Самокат', 'Купер', 'Lamoda', '2ГИС', 'Контур', '1С', 'Циан',
    'HeadHunter', 'Selectel', 'Додо Пицца', 'Skyeng'];
  const STATUSES = [['', 'не начато'], ['applied', 'отклик отправлен'], ['interview', 'собеседование'], ['offer', 'оффер 🎉'], ['rejected', 'отказ']];
  const hhLink = (name) => `https://hh.ru/search/vacancy?text=${encodeURIComponent('QA ' + name)}`;

  const taskOf = (catId, taskId) => {
    const c = CATEGORIES.find((x) => x.id === catId);
    return c && c.tasks.find((t) => t.id === taskId);
  };

  function S() {
    const st = Core.state;
    if (!st.jobs || !st.jobs.counts) st.jobs = { counts: {}, log: [], channels: [], companies: [], status: {}, days: {}, bonus: {} };
    return st.jobs;
  }
  const today = () => new Date().toLocaleDateString('sv'); // ГГГГ-ММ-ДД по местному времени

  function rawXp(state) {
    const j = state.jobs;
    if (!j || !j.counts) return 0;
    return Object.entries(j.counts).reduce((sum, [key, n]) => {
      const [cat, task] = key.split('.');
      const t = taskOf(cat, task);
      return sum + (t ? t.xp * n : 0);
    }, 0);
  }
  const budget = () => P.mode('jobs').budget;
  const totalActions = (state) => Object.values((state.jobs && state.jobs.counts) || {}).reduce((a, b) => a + b, 0);

  // Серия: сколько дней подряд (до сегодня или вчера включительно) было хотя бы одно действие.
  function streak() {
    const days = S().days;
    let d = new Date();
    if (!days[d.toLocaleDateString('sv')]) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days[d.toLocaleDateString('sv')]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  // ---------- действия ----------

  let current = 'telegram';
  let toast = '';
  let undo = null; // последнее действие этой сессии

  function act(catId, taskId, note, company) {
    const j = S();
    const t = taskOf(catId, taskId);
    const before = Core.rank();
    const key = `${catId}.${taskId}`;
    j.counts[key] = (j.counts[key] || 0) + 1;
    const d = today();
    j.days[d] = j.days[d] || { all: 0, main: 0 };
    j.days[d].all++;
    if (!t.small) j.days[d].main++;
    let gold = t.gold;
    let bonus = 0;
    if (!t.small && j.days[d].main >= DAILY_GOAL && !j.bonus[d]) { j.bonus[d] = true; bonus = DAILY_BONUS; }
    gold += bonus;
    Core.state.gold += gold;
    const entry = { at: Date.now(), cat: catId, task: taskId, note: note || '', company: company || '' };
    j.log.unshift(entry);
    if (j.log.length > LOG_SIZE) j.log.length = LOG_SIZE;
    if (company && taskId === 'site' && !j.status[company]) j.status[company] = 'applied';
    undo = { key, gold, xp: t.xp, day: d, small: !!t.small, bonus, entry };
    toast = `${t.icon} ${t.name}: +${t.gold} 🪙 · +${t.xp} XP${bonus ? ` · цель дня выполнена: +${bonus} 🪙` : ''}`;
    const up = Core.rankUp(before);
    Core.track('jobs-action', { cat: catId, task: taskId });
    const video = Rewards.drop('jobs');
    undo.video = video;
    if (video) toast += ' · 🎬 выпало видео!';
    Core.save();
    Core.renderHud();
    render();
    if (video) Rewards.showDrop(video, up.lines);
    else if (up.rank) {
      Core.modal(`<div class="big"><img class="modal-avatar" src="${Core.avatar(up.rank)}" alt=""></div><h3>Новое звание</h3><ul class="loot">${up.lines.join('')}</ul>
        <button class="btn attack" id="modal-close" type="button">Продолжить</button>`);
    }
  }

  function undoLast() {
    if (!undo) return;
    const j = S();
    const u = undo;
    undo = null;
    if (j.counts[u.key] > 0) j.counts[u.key]--;
    const day = j.days[u.day];
    if (day) { day.all = Math.max(0, day.all - 1); if (!u.small) day.main = Math.max(0, day.main - 1); }
    if (u.bonus) delete j.bonus[u.day];
    if (u.video) Rewards.revoke(u.video); // видео, выпавшее за отменённое действие, тоже забирается
    Core.state.gold = Math.max(0, Core.state.gold - u.gold);
    const i = j.log.indexOf(u.entry);
    if (i >= 0) j.log.splice(i, 1);
    toast = 'Последнее действие отменено.';
    Core.save();
    Core.renderHud();
    render();
  }

  // ---------- экран ----------

  const screen = document.querySelector('.screen[data-screen="jobs"]');

  function render() {
    const j = S();
    const cat = CATEGORIES.find((c) => c.id === current);
    const raw = rawXp(Core.state);
    const d = j.days[today()] || { all: 0, main: 0 };
    screen.innerHTML = `
      <div class="sim-head">
        <button class="ghost-btn" type="button" data-home>← К выбору режима</button>
        <h2 class="sim-title"><span aria-hidden="true">💼</span> Поиск работы</h2>
      </div>
      <div class="jb-stats">
        <span class="chip">Сегодня: <b>${d.all}</b></span>
        <span class="chip${j.bonus[today()] ? ' done' : ''}" title="Отклики и резюме за день; мелкие действия не считаются">Цель дня: <b>${Math.min(d.main, DAILY_GOAL)}</b> / ${DAILY_GOAL}${j.bonus[today()] ? ' ✓' : ` · +${DAILY_BONUS} 🪙`}</span>
        <span class="chip">🔥 Дней подряд: <b>${streak()}</b></span>
        <span class="chip">Всего действий: <b>${totalActions(Core.state)}</b></span>
        <span class="chip" title="В звание засчитывается до ${budget()} XP этого режима">✦ ${raw} XP${raw > budget() ? ` · в звание ${budget()}` : ''}</span>
      </div>
      <nav class="jb-cats" role="tablist">${CATEGORIES.map((c) => `
        <button type="button" role="tab" class="jb-cat${c.id === current ? ' on' : ''}" data-cat="${c.id}" aria-selected="${c.id === current}">
          <span aria-hidden="true">${c.icon}</span> ${esc(c.name)}<small>${catCount(c)}</small></button>`).join('')}
      </nav>
      ${toast ? `<p class="jb-toast" aria-live="polite">${esc(toast)}${undo ? ' <button type="button" class="jb-undo" data-undo>Отменить</button>' : ''}</p>` : ''}
      <div class="jb-body">
        <section class="jb-tasks">${cat.tasks.map((t) => taskCard(cat, t)).join('')}</section>
        <aside class="panel jb-side">${side(cat)}</aside>
      </div>`;
    bind(cat);
  }

  function catCount(c) {
    const counts = S().counts;
    return c.tasks.reduce((s, t) => s + (counts[`${c.id}.${t.id}`] || 0), 0);
  }

  function taskCard(cat, t) {
    const n = S().counts[`${cat.id}.${t.id}`] || 0;
    let input = '';
    if (t.needsName) input = `<input class="jb-input" data-name-for="${t.id}" placeholder="${cat.id === 'telegram' ? '@канал или ссылка' : 'Название компании'}" maxlength="80">`;
    else if (t.perCompany) input = `<select class="jb-input" data-company-for="${t.id}"><option value="">— компания —</option>${allCompanies().map((c) => `<option>${esc(c)}</option>`).join('')}</select>`;
    else input = `<input class="jb-input" data-note-for="${t.id}" placeholder="Заметка: компания, вакансия (необязательно)" maxlength="80">`;
    return `<div class="jb-task${t.small ? ' small' : ''}">
      <div class="jb-task-head"><span class="jb-ico" aria-hidden="true">${t.icon}</span><b>${esc(t.name)}</b><span class="jb-count" title="Сколько раз выполнено">×${n}</span></div>
      <p class="jb-hint">${esc(t.hint)}</p>
      <div class="jb-act">${input}<button class="btn attack" type="button" data-do="${t.id}">Сделал · +${t.gold} 🪙 +${t.xp} XP</button></div>
      <p class="jb-err" data-err-for="${t.id}" hidden></p>
    </div>`;
  }

  const allCompanies = () => COMPANIES.concat(S().companies.map((c) => c.name).filter((n) => !COMPANIES.includes(n)));

  function side(cat) {
    const j = S();
    if (cat.id === 'telegram') {
      return `<p class="eyebrow">${cat.listTitle}</p>${j.channels.length
        ? `<ul class="jb-list">${j.channels.map((c, i) => `<li><span>${linkify(c.name)}</span><button type="button" class="jb-del" data-del-channel="${i}" title="Убрать из списка">✕</button></li>`).join('')}</ul>`
        : '<p class="jb-muted">Пока пусто. Добавляй каналы заданием «Добавить канал».</p>'}${recent(cat)}`;
    }
    if (cat.id === 'companies') {
      return `<p class="eyebrow">Компании · вакансии QA на hh.ru</p>
        <ul class="jb-list jb-companies">${allCompanies().map((name) => {
          const st = j.status[name] || '';
          return `<li class="st-${st || 'none'}"><a href="${hhLink(name)}" target="_blank" rel="noopener noreferrer">${esc(name)} ↗</a>
            <select data-status="${esc(name)}" aria-label="Статус: ${esc(name)}">${STATUSES.map(([v, l]) => `<option value="${v}"${v === st ? ' selected' : ''}>${l}</option>`).join('')}</select></li>`;
        }).join('')}</ul>${recent(cat)}`;
    }
    const links = cat.sites ? cat.sites : cat.url ? [[cat.name, cat.url]] : [];
    return `${links.length ? `<p class="eyebrow">Перейти</p><ul class="jb-list">${links.map(([n, u]) => `<li><a href="${u}" target="_blank" rel="noopener noreferrer">${esc(n)} ↗</a></li>`).join('')}</ul>` : ''}${recent(cat)}`;
  }

  function linkify(name) {
    const v = name.trim();
    const url = /^https?:\/\//.test(v) ? v : /^@\w+$/.test(v) ? `https://t.me/${v.slice(1)}` : /^t\.me\//.test(v) ? `https://${v}` : '';
    return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(v)} ↗</a>` : esc(v);
  }

  function recent(cat) {
    const items = S().log.filter((e) => e.cat === cat.id).slice(0, 8);
    if (!items.length) return '';
    return `<p class="eyebrow jb-recent-title">Последние действия</p><ul class="jb-log">${items.map((e) => {
      const t = taskOf(e.cat, e.task);
      const when = new Date(e.at).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const extra = e.company || e.note;
      return `<li><span>${t ? t.icon : '•'} ${esc(t ? t.name : e.task)}${extra ? ` · <i>${esc(extra)}</i>` : ''}</span><time>${when}</time></li>`;
    }).join('')}</ul>`;
  }

  function bind(cat) {
    const $ = (s) => screen.querySelector(s);
    $('[data-home]').addEventListener('click', () => Core.go('home'));
    screen.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { current = b.dataset.cat; toast = ''; render(); }));
    const u = $('[data-undo]');
    if (u) u.addEventListener('click', undoLast);
    screen.querySelectorAll('[data-do]').forEach((b) => b.addEventListener('click', () => {
      const t = taskOf(cat.id, b.dataset.do);
      const err = $(`[data-err-for="${t.id}"]`);
      const fail = (m) => { err.hidden = false; err.textContent = m; };
      if (t.needsName) {
        const name = $(`[data-name-for="${t.id}"]`).value.trim();
        if (!name) return fail(cat.id === 'telegram' ? 'Впиши канал: @имя или ссылку.' : 'Впиши название компании.');
        const j = S();
        if (cat.id === 'telegram') {
          if (j.channels.some((c) => c.name.toLowerCase() === name.toLowerCase())) return fail('Этот канал уже в списке.');
          j.channels.push({ name, at: Date.now() });
        } else {
          if (allCompanies().some((c) => c.toLowerCase() === name.toLowerCase())) return fail('Эта компания уже в списке.');
          j.companies.push({ name, at: Date.now() });
        }
        return act(cat.id, t.id, name);
      }
      if (t.perCompany) {
        const company = $(`[data-company-for="${t.id}"]`).value;
        if (!company) return fail('Выбери компанию.');
        return act(cat.id, t.id, '', company);
      }
      return act(cat.id, t.id, $(`[data-note-for="${t.id}"]`).value.trim());
    }));
    screen.querySelectorAll('[data-del-channel]').forEach((b) => b.addEventListener('click', () => {
      S().channels.splice(+b.dataset.delChannel, 1);
      Core.save();
      render();
    }));
    screen.querySelectorAll('[data-status]').forEach((s) => s.addEventListener('change', () => {
      const j = S();
      if (s.value) j.status[s.dataset.status] = s.value; else delete j.status[s.dataset.status];
      Core.save();
      s.closest('li').className = `st-${s.value || 'none'}`;
    }));
  }

  Core.registerMode('jobs', {
    icon: '💼',
    xpOf: (state) => Math.min(rawXp(state), budget()),
    progressOf: (state) => ({ done: totalActions(state), available: 0, text: `Действий: <b>${totalActions(state)}</b> · задания бесконечные` }),
    open: () => { toast = ''; undo = null; render(); },
    refresh: () => render(),
  });

  window.Jobs = { CATEGORIES, COMPANIES, rawXp };
})();
