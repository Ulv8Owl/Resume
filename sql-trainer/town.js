// Башня Академии — меню выбора режима. Комнаты на картинке Avatars/Town.jpeg кликабельны.
// Координаты областей — в процентах от размеров картинки (768 × 1376).
(function () {
  'use strict';

  const Core = window.Core;
  const P = window.Progression;
  const esc = Core.esc;
  const IMAGE = 'Avatars/Town.jpeg';

  // compact — у узких областей всегда короткая подпись (иначе на телефоне она не помещается)
  const SPOTS = [
    { mode: 'git',      room: 'Левая башня',       short: 'Git',         x: 5,    y: 2,    w: 21,   h: 19 },
    { mode: 'devtools', room: 'Правая башня',      short: 'DevTools',    x: 74,   y: 2,    w: 21,   h: 19 },
    { mode: 'jobs',     room: 'Воронятня',         short: 'Работа',      x: 25,   y: 8.5,  w: 50,   h: 13.5 },
    { mode: 'swagger',  room: 'Зал API, свитки',   short: 'Swagger',     x: 25,   y: 23,   w: 16.7, h: 16, compact: true },
    { mode: 'charles',  room: 'Зал API, шар',      short: 'Charles',     x: 41.7, y: 23,   w: 16.6, h: 16, compact: true },
    { mode: 'postman',  room: 'Зал API, карты',    short: 'Postman',     x: 58.3, y: 23,   w: 16.7, h: 16, compact: true },
    { mode: 'design',   room: 'Совет магов',       short: 'Тест-дизайн', x: 25,   y: 40,   w: 50,   h: 14.8 },
    { mode: 'theory',   room: 'Библиотека',        short: 'Теория',      x: 25,   y: 55.6, w: 50,   h: 14.2 },
    { mode: 'jmeter',   room: 'Мастерская голема', short: 'JMeter',      x: 25,   y: 71,   w: 50,   h: 12.8 },
    { mode: 'sql',      room: 'Подземелье',        short: 'SQL',         x: 25,   y: 84.4, w: 50,   h: 12.8 },
  ];

  function progressText(m) {
    const api = Core.modes[m.id] || {};
    const pr = api.progressOf ? api.progressOf(Core.state) : { done: 0, available: 0 };
    return m.id === 'jobs' ? `${pr.done} действий` : `${pr.done}/${pr.available}`;
  }

  function render() {
    const box = document.getElementById('town');
    if (!box) return;
    box.innerHTML = `
      <div class="town-map">
        <img class="town-img" src="${IMAGE}" alt="Башня Академии: в каждой комнате — свой режим" width="768" height="1376">
        ${SPOTS.map((s) => {
          const m = P.mode(s.mode);
          const api = Core.modes[s.mode];
          if (!m || !api) return '';
          const frac = Math.min(1, Core.xpBy(s.mode) / m.budget);
          return `<button class="town-spot${s.compact ? ' compact' : ''}" type="button" data-mode="${s.mode}" style="left:${s.x}%;top:${s.y}%;width:${s.w}%;height:${s.h}%"
            aria-label="${esc(s.room)} — ${esc(m.name)}, пройдено ${esc(progressText(m))}">
            <span class="town-label"><span aria-hidden="true">${api.icon || '✦'}</span><span class="tl-full">${esc(s.compact ? s.short : m.name)}</span><span class="tl-short">${esc(s.short)}</span><small>${esc(progressText(m))}</small>
              <i class="town-bar"><i style="width:${frac * 100}%"></i></i></span>
          </button>`;
        }).join('')}
        <button class="town-teacher" type="button" data-teacher aria-label="Наставник: ежедневное задание">
          <img src="${window.Teacher ? Teacher.PORTRAIT : ''}" alt=""><span class="teacher-count"></span>
        </button>
      </div>`;
    box.querySelectorAll('.town-spot').forEach((b) => b.addEventListener('click', () => Core.go(b.dataset.mode)));
    box.querySelector('[data-teacher]').addEventListener('click', () => Teacher.open());
    if (window.Teacher) Teacher.renderBadge();
  }

  window.Town = { render, SPOTS };
})();
