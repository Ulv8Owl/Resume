// Фоновая музыка на повторе: Town1…Town4 по кругу для башни и всех режимов, Battle — для Подземелья SQL.
// Файлы лежат в каталоге music/ репозитория (на Vercel они не выкладываются: слишком большие) и
// проигрываются прямо с GitHub. Браузер разрешает звук только после первого нажатия.
(function () {
  'use strict';

  const Core = window.Core;
  const BASE = 'https://raw.githubusercontent.com/Ulv8Owl/Resume/claude/sql-trainer-gamification-hw09tw/music/';
  const TOWN = ['Town1', 'Town2', 'Town3', 'Town4'];
  const KEY = 'qa-academy-music';
  const audio = new Audio();
  audio.preload = 'none';
  audio.volume = 0.35;

  const NOTES_KEY = 'qa-academy-music-notes';
  let enabled = true;
  let inNotes = true; // играть ли музыку в «Конспекте» (там её можно выключить отдельно)
  try { enabled = localStorage.getItem(KEY) !== 'off'; inNotes = localStorage.getItem(NOTES_KEY) !== 'off'; } catch (e) { /* по умолчанию включена */ }
  let unlocked = false;
  let mode = null; // 'town' | 'battle'
  let townIndex = 0;
  const missing = new Set(); // треки, которых нет в репозитории (например, Town4), пропускаем

  function play(name) {
    audio.src = BASE + name + '.mp3';
    audio.loop = name === 'Battle';
    audio.play().catch(() => { /* ждём нажатия */ });
  }
  function nextTown() {
    for (let i = 0; i < TOWN.length; i++) {
      townIndex = (townIndex + 1) % TOWN.length;
      if (!missing.has(TOWN[townIndex])) return play(TOWN[townIndex]);
    }
  }

  function sync() {
    if (!unlocked) return;
    if (!enabled || (Core.screen === 'notes' && !inNotes)) { audio.pause(); return; }
    const want = Core.BATTLE.includes(Core.screen) ? 'battle' : 'town';
    if (want !== mode) {
      mode = want;
      if (want === 'battle') play('Battle'); else play(TOWN[townIndex]);
    } else if (audio.paused) audio.play().catch(() => {});
  }

  audio.addEventListener('ended', () => { if (mode === 'town') nextTown(); });
  audio.addEventListener('error', () => {
    if (mode !== 'town') return;
    missing.add(TOWN[townIndex]);
    if (missing.size < TOWN.length) nextTown();
  });

  const unlock = () => { if (!unlocked) { unlocked = true; sync(); } };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, unlock, { passive: true }));
  setInterval(sync, 1000); // смена экрана — смена музыки

  window.Music = {
    get enabled() { return enabled; },
    toggle(on) {
      enabled = on;
      try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* не запомнили */ }
      if (on) mode = null;
      sync();
    },
    get inNotes() { return inNotes; },
    toggleNotes(on) {
      inNotes = on;
      try { localStorage.setItem(NOTES_KEY, on ? 'on' : 'off'); } catch (e) { /* не запомнили */ }
      sync();
    },
  };
})();
