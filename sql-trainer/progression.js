// Прогрессия мага: режимы, бюджет опыта и звания.
// Опыт не хранится, а считается из прогресса во всех режимах, поэтому перебалансировка не ломает сохранения.
(function (root) {
  'use strict';

  // Весь опыт игры. Его делят режимы: больше там, где сложнее (SQL и API).
  const TOTAL_XP = 20000;

  // planned — сколько уровней (или карточек) в режиме. Опыт за уровень берётся из бюджета режима.
  const MODES = [
    { id: 'theory',   name: 'Библиотека',          share: 0.10, planned: 160, unit: 'карточек', tagline: 'Вопросы собеседования по всем темам тестирования' },
    { id: 'http',     name: 'HTTP',                share: 0.06, planned: 90,  unit: 'монстров', tagline: 'Монстры Подземелья и API-запросы: напиши запрос — получи ответ сервера' },
    { id: 'blitz',    name: 'Блиц',                share: 0.06, planned: 90,  unit: 'монстров', tagline: 'Монстры Подземелья и вопросы по теории: 4 варианта, один верный' },
    { id: 'sql',      name: 'SQL',                 share: 0.20, planned: 90,  unit: 'залов',    tagline: 'Подземелье запросов: от SELECT до процедур' },
    { id: 'design',   name: 'Тест-дизайн',         share: 0.07, planned: 20,  unit: 'задач',    tagline: 'Классы эквивалентности, границы, таблицы решений, pairwise' },
    { id: 'swagger',  name: 'API · Swagger',       share: 0.09, planned: 20,  unit: 'уровней',  tagline: 'Читать документацию и пробовать эндпоинты' },
    { id: 'postman',  name: 'API · Postman',       share: 0.10, planned: 20,  unit: 'уровней',  tagline: 'Запросы, окружения, авторизация, тесты' },
    { id: 'charles',  name: 'API · Charles Proxy', share: 0.08, planned: 20,  unit: 'уровней',  tagline: 'Перехват и подмена трафика мобильного приложения' },
    { id: 'devtools', name: 'DevTools',            share: 0.09, planned: 20,  unit: 'уровней',  tagline: 'Console, Network, Elements, Application: ищем причину бага' },
    { id: 'git',      name: 'Git · GitLab CI',     share: 0.08, planned: 20,  unit: 'уровней',  tagline: 'Ветки, коммиты, merge request и пайплайны' },
    { id: 'jmeter',   name: 'Нагрузка · JMeter',   share: 0.08, planned: 20,  unit: 'уровней',  tagline: 'Тест-планы, потоки, ассерты и отчёты нагрузочного тестирования' },
    // Поиск работы — бесконечные задания: опыт копится без конца, но в звание засчитывается не больше бюджета режима.
    { id: 'jobs',     name: 'Поиск работы',        share: 0.05, planned: 0,   unit: 'действий', tagline: 'Отклики, резюме рекрутёрам, каналы и компании' },
  ];
  MODES.forEach((m) => { m.budget = Math.round(TOTAL_XP * m.share); });

  // Архимаг — на 92% всего опыта: под конец полного прохождения игрок успевает им побыть.
  const ARCHMAGE_SHARE = 0.92;
  const RANK_STEPS = [
    ['Ученик', 0],
    ['Подмастерье', 0.05],
    ['Адепт', 0.13],
    ['Чародей', 0.24],
    ['Волшебник', 0.38],
    ['Магистр', 0.55],
    ['Верховный магистр', 0.75],
    ['Архимаг', 1],
  ];
  const RANKS = RANK_STEPS.map(([name, f], k) => ({
    name,
    xp: Math.round(TOTAL_XP * ARCHMAGE_SHARE * f),
    maxHp: 100 + 20 * k,
    maxMana: 100 + 20 * k,
    avatar: `Avatars/${k + 1}.webp`,
    index: k,
  }));

  const mode = (id) => MODES.find((m) => m.id === id);

  // Опыт за i-й уровень режима: растёт к концу режима, сумма по всем запланированным уровням = бюджет.
  function curve(planned, weight) {
    const w = [];
    for (let i = 0; i < planned; i++) w.push(weight ? weight(i) : 1 + i * 0.08);
    const sum = w.reduce((a, b) => a + b, 0);
    return w.map((x) => x / sum);
  }
  const cache = {};
  function levelXp(modeId, i, weight) {
    const m = mode(modeId);
    if (!cache[modeId]) cache[modeId] = curve(m.planned, weight);
    return Math.round(m.budget * cache[modeId][i]);
  }

  function rankFor(xp) {
    return RANKS.filter((r) => xp >= r.xp).pop();
  }
  function nextRank(rank) {
    return RANKS[rank.index + 1] || null;
  }

  const Progression = { TOTAL_XP, MODES, RANKS, ARCHMAGE_SHARE, mode, levelXp, rankFor, nextRank };
  if (typeof module !== 'undefined' && module.exports) module.exports = Progression;
  else root.Progression = Progression;
})(typeof window !== 'undefined' ? window : globalThis);
