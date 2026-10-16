// Фоновая музыка с YouTube на повторе: одна мелодия для башни и всех режимов, другая — для Подземелья SQL.
// Плеер скрыт за краем экрана. Браузер разрешает звук только после первого нажатия, поэтому музыка
// начинается с первого клика или клавиши. Выключить можно в настройках.
(function () {
  'use strict';

  const Core = window.Core;
  const TRACKS = { main: 'OwF0zVLDLJo', sql: 'BLoigY6WpGM' };
  const VOLUME = 35;
  const KEY = 'qa-academy-music';

  let player = null;
  let ready = false;
  let unlocked = false;
  let current = null;
  let enabled = true;
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch (e) { /* по умолчанию включена */ }

  const wanted = () => (Core.screen === 'sql' ? 'sql' : 'main');

  function sync() {
    if (!ready || !unlocked) return;
    if (!enabled) { player.pauseVideo(); return; }
    const t = wanted();
    if (t !== current) {
      current = t;
      player.loadVideoById(TRACKS[t]);
    } else if (player.getPlayerState() !== 1) player.playVideo();
  }

  function create() {
    const box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    // YouTube не играет в слишком маленьком плеере, поэтому 200×200, но за краем экрана
    box.style.cssText = 'position:fixed;left:-10000px;top:0;width:200px;height:200px;overflow:hidden;pointer-events:none;';
    box.innerHTML = '<div id="music-player"></div>';
    document.body.appendChild(box);
    player = new window.YT.Player('music-player', {
      width: 200,
      height: 200,
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, playsinline: 1, rel: 0 },
      events: {
        onReady: () => { ready = true; player.setVolume(VOLUME); sync(); },
        // повтор: дослушали до конца — с начала
        onStateChange: (e) => { if (e.data === window.YT.PlayerState.ENDED) { player.seekTo(0); player.playVideo(); } },
      },
    });
  }

  window.onYouTubeIframeAPIReady = create;
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);

  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    sync();
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, unlock, { once: false, passive: true }));

  // смена экрана — смена мелодии (Core.go вызывает режимы; проверяем раз в секунду, это дёшево)
  setInterval(sync, 1000);

  window.Music = {
    get enabled() { return enabled; },
    toggle(on) {
      enabled = on;
      try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* не запомнили */ }
      if (on) current = null;
      sync();
    },
  };
})();
