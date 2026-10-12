// Видео-награды: выдача после побед, инвентарь, покупка воспроизведений и плеер.
// Сами видео лежат только на компьютере игрока, в папке mp3/ рядом с index.html (в git их нет).
// В прогрессе (браузер и Supabase) хранятся лишь номера полученных видео и число воспроизведений.
(function () {
  'use strict';

  const Core = window.Core;
  const esc = Core.esc;

  const CONFIG = {
    dir: 'mp3',
    exts: ['mp3', 'mp4', 'webm'], // файл N ищется как mp3/N.mp3, затем mp3/N.mp4, затем mp3/N.webm
    pool: 144, // сколько файлов лежит в папке: 1 … 144; больше этого числа видео получить нельзя
    playPrice: 50, // золото за одно воспроизведение в инвентаре
    playSeconds: 25, // одно воспроизведение ≈ столько секунд: короткое видео повторяется (15,2 с → 2 раза, 5 с → 5 раз)
    sqlEvery: 3, // в SQL видео дают залы 3, 6, 9 … 90
    simLevels: [4, 7, 10, 13, 16, 19], // в режимах по 20 уровней видео дают эти уровни
    dropChance: 0.1, // Теория («Знаю») и Поиск работы («Сделал»): шанс выпадения видео
  };

  function S() {
    const st = Core.state;
    if (!st.rewards || !st.rewards.videos) st.rewards = { videos: {}, order: [], sources: {} };
    return st.rewards;
  }
  const owned = () => S().order.slice();
  const sourcesOf = (id) => CONFIG.exts.map((x) => `<source src="${CONFIG.dir}/${id}.${x}">`).join('');

  // Сколько раз подряд проигрывается видео за одно воспроизведение.
  function loopsFor(duration) {
    if (!isFinite(duration) || duration <= 0) return 1;
    return Math.max(1, Math.round(CONFIG.playSeconds / duration));
  }

  // Выдать награду за источник (например «sql:<id зала>»): случайное видео из тех, которых ещё нет.
  // Награда — одно бесплатное воспроизведение: не посмотрел сразу — оно ждёт в инвентаре.
  function grant(source) {
    const r = S();
    if (r.sources[source]) return null;
    const free = [];
    for (let i = 1; i <= CONFIG.pool; i++) if (!r.videos[i]) free.push(i);
    if (!free.length) return null;
    const id = free[Math.floor(Math.random() * free.length)];
    r.videos[id] = { plays: 1, at: Date.now() };
    r.order.push(id);
    r.sources[source] = id;
    return id;
  }

  const isSqlRewardRoom = (index) => (index + 1) % CONFIG.sqlEvery === 0;
  const isSimRewardLevel = (index) => CONFIG.simLevels.includes(index + 1);

  // Случайное выпадение: в Теории и Поиске работы. Возвращает номер видео или null.
  function drop(mode) {
    if (Math.random() >= CONFIG.dropChance) return null;
    return grant(`drop:${mode}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`);
  }

  // Забрать видео обратно (например, когда игрок отменил действие, за которое оно выпало).
  function revoke(id) {
    const r = S();
    if (!r.videos[id]) return;
    delete r.videos[id];
    r.order = r.order.filter((x) => x !== id);
    Object.keys(r.sources).forEach((k) => { if (r.sources[k] === id) delete r.sources[k]; });
  }

  // Симуляторы сообщают свои уровни, чтобы уже пройденные уровни с наградой тоже принесли видео.
  const sims = {};
  const registerSim = (mode, levels) => { sims[mode] = levels; };

  // Залы, пройденные до появления наград, тоже приносят свои видео (с одним воспроизведением).
  function reconcile() {
    const D = window.DUNGEON;
    const rooms = Core.state.sql && Core.state.sql.rooms;
    let changed = false;
    if (D && D.rooms && rooms) {
      D.rooms.forEach((room) => {
        if (isSqlRewardRoom(room.index) && rooms[room.id] && rooms[room.id].cleared && grant('sql:' + room.id)) changed = true;
      });
    }
    Object.entries(sims).forEach(([mode, levels]) => {
      const done = (Core.state.sims && Core.state.sims[mode] && Core.state.sims[mode].levels) || {};
      levels.forEach((l, i) => {
        if (isSimRewardLevel(i) && done[l.id] && done[l.id].cleared && grant(`sim:${mode}:${l.id}`)) changed = true;
      });
    });
    if (changed) Core.save();
  }

  // ---------- плеер ----------

  let player = null;
  function closePlayer() {
    if (!player) return;
    player.video.pause();
    player.video.removeAttribute('src');
    player.layer.remove();
    document.removeEventListener('keydown', player.onKey);
    const done = player.onDone;
    player = null;
    if (done) done();
  }

  // Воспроизведение тратится, только когда видео действительно пошло: если файла нет, оно не сгорает.
  function play(id, opts) {
    opts = opts || {};
    const v = S().videos[id];
    if (!v || v.plays < 1) return;
    closePlayer();
    const layer = document.createElement('div');
    layer.className = 'vplayer';
    layer.innerHTML = `
      <div class="vplayer-box" role="dialog" aria-modal="true" aria-label="Видео-награда">
        <video playsinline disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback">${sourcesOf(id)}</video>
        <div class="vplayer-bar"><span class="vplayer-info">Загружаю…</span><button class="btn" type="button" data-close>Закрыть</button></div>
      </div>`;
    document.body.appendChild(layer);
    const video = layer.querySelector('video');
    const info = layer.querySelector('.vplayer-info');
    let loops = 1;
    let round = 1;
    let started = false;
    const onKey = (e) => { if (e.key === 'Escape') closePlayer(); };
    player = { layer, video, onKey, onDone: opts.onDone };
    document.addEventListener('keydown', onKey);
    layer.addEventListener('contextmenu', (e) => e.preventDefault());
    layer.querySelector('[data-close]').addEventListener('click', closePlayer);
    layer.addEventListener('click', (e) => { if (e.target === layer) closePlayer(); });
    video.addEventListener('click', () => { if (video.paused) video.play(); else video.pause(); });
    const showInfo = () => { info.textContent = loops > 1 ? `Повтор ${round} из ${loops}` : 'Воспроизведение'; };
    video.addEventListener('loadedmetadata', () => {
      loops = loopsFor(video.duration);
      showInfo();
      video.play().catch(() => { info.textContent = 'Нажми на видео, чтобы запустить'; });
    });
    video.addEventListener('playing', () => {
      if (started) return;
      started = true;
      v.plays -= 1;
      Core.save();
      if (opts.onStart) opts.onStart();
      refresh();
    });
    video.addEventListener('ended', () => {
      if (round < loops) { round++; showInfo(); video.currentTime = 0; video.play(); } else closePlayer();
    });
    // ошибка последнего <source> — значит, ни одного файла с этим номером нет
    const last = video.querySelector('source:last-child');
    last.addEventListener('error', () => {
      info.textContent = `Не нашёл файл ${CONFIG.dir}/${id}.${CONFIG.exts.join(' / .')}. Положи его в папку ${CONFIG.dir} рядом с index.html — воспроизведение не потрачено.`;
      info.classList.add('bad');
    });
  }

  // ---------- окно победы ----------

  function modalHtml(id) {
    return `<div class="reward-video">
      <button class="reward-video-btn" type="button" id="reward-video-btn" aria-label="Посмотреть видео-награду">🎬</button>
      <p class="reward-video-note" id="reward-video-note">Нажми, чтобы посмотреть сейчас, или закрой окно — видео будет ждать в инвентаре с одним бесплатным воспроизведением.</p>
    </div>`;
  }
  function bindModal(id) {
    const b = document.getElementById('reward-video-btn');
    if (!b) return;
    b.addEventListener('click', () => play(id, {
      onStart: () => {
        b.disabled = true;
        b.classList.add('used');
        const n = document.getElementById('reward-video-note');
        if (n) n.textContent = 'Видео уже в инвентаре. Пересмотреть его можно, купив воспроизведения.';
      },
    }));
  }

  // Окно выпавшей награды (Теория, Поиск работы). extra — строки добычи, например новое звание.
  function showDrop(id, extra) {
    Core.modal(`
      <h3>Видео-награда!</h3>
      ${extra && extra.length ? `<ul class="loot">${extra.join('')}</ul>` : ''}
      ${modalHtml(id)}
      <button class="btn" id="modal-close" type="button">Закрыть</button>`);
    bindModal(id);
  }

  // ---------- инвентарь ----------

  let filter = 'all'; // all | fav

  const screen = document.querySelector('.screen[data-screen="inventory"]');

  function render() {
    if (!screen) return;
    const r = S();
    const all = owned();
    const favCount = all.filter((id) => r.videos[id].fav).length;
    if (filter === 'fav' && !favCount) filter = 'all';
    const list = filter === 'fav' ? all.filter((id) => r.videos[id].fav) : all;
    screen.innerHTML = `
      <div class="sim-head">
        <button class="ghost-btn" type="button" data-home>← К выбору режима</button>
        <h2 class="sim-title"><span aria-hidden="true">🎒</span> Инвентарь</h2>
        <span class="chip">🎬 <b>${all.length}</b> из ${CONFIG.pool}</span>
        <span class="chip gold">🪙 <b>${Core.state.gold}</b></span>
      </div>
      ${all.length ? `<div class="inv-filter" role="tablist">
        <button type="button" role="tab" data-filter="all" class="${filter === 'all' ? 'on' : ''}" aria-selected="${filter === 'all'}">Все · ${all.length}</button>
        <button type="button" role="tab" data-filter="fav" class="${filter === 'fav' ? 'on' : ''}" aria-selected="${filter === 'fav'}" ${favCount ? '' : 'disabled'}>★ Избранное · ${favCount}</button>
      </div>` : ''}
      ${all.length ? `<div class="inv-grid">${list.map((id) => {
        const v = r.videos[id];
        const has = v.plays > 0;
        return `<div class="inv-item${has ? '' : ' empty'}">
          <button class="inv-thumb" type="button" data-play="${id}" ${has ? '' : 'disabled'} aria-label="Смотреть видео ${id}">
            <canvas data-thumb="${id}" width="320" height="180"></canvas>
            <span class="inv-missing" hidden>файл не найден</span>
            ${has ? '<span class="inv-playicon" aria-hidden="true">▶</span>' : ''}
          </button>
          <button class="inv-fav${v.fav ? ' on' : ''}" type="button" data-fav="${id}" aria-pressed="${!!v.fav}" title="${v.fav ? 'Убрать из избранного' : 'В избранное'}">${v.fav ? '★' : '☆'}</button>
          <div class="inv-row">
            <span class="inv-plays" title="Доступно воспроизведений">▶ <b>${v.plays}</b></span>
            <button class="inv-buy" type="button" data-buy="${id}" ${Core.state.gold >= CONFIG.playPrice ? '' : 'disabled'} title="Купить одно воспроизведение">＋ ${CONFIG.playPrice} 🪙</button>
          </div>
        </div>`;
      }).join('')}</div>` : `<div class="panel inv-empty"><p>Пока пусто. Видео дают каждые ${CONFIG.sqlEvery} зала в SQL, уровни ${CONFIG.simLevels.join(', ')} в режимах по 20 уровней, а в Теории и Поиске работы оно выпадает с шансом ${Math.round(CONFIG.dropChance * 100)}%.</p></div>`}
      <p class="inv-note">Видео без воспроизведений показано чёрно-белым. Одно воспроизведение — ${CONFIG.playPrice} золота.</p>`;
    screen.querySelector('[data-home]').addEventListener('click', () => Core.go('home'));
    screen.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => play(+b.dataset.play)));
    screen.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => buy(+b.dataset.buy)));
    screen.querySelectorAll('[data-fav]').forEach((b) => b.addEventListener('click', () => {
      const v = r.videos[+b.dataset.fav];
      v.fav = !v.fav;
      if (!v.fav) delete v.fav;
      Core.save();
      render();
    }));
    screen.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.filter; render(); }));
    list.forEach((id) => { if (thumbs[id]) paintThumb(id); else queueThumb(id); });
  }

  // ---------- превью ----------
  // Кадр каждого видео один раз рисуется на холст и запоминается. Видео грузятся по одному:
  // десятки одновременно открытых <video> браузер не тянет.
  const thumbs = {};
  const thumbQueue = [];
  let thumbBusy = false;

  function paintThumb(id) {
    const c = screen && screen.querySelector(`canvas[data-thumb="${id}"]`);
    if (!c) return;
    const t = thumbs[id];
    if (t === 'missing') {
      c.hidden = true;
      c.parentNode.querySelector('.inv-missing').hidden = false;
    } else if (t) {
      c.width = t.width;
      c.height = t.height;
      c.getContext('2d').drawImage(t, 0, 0);
    }
  }
  function queueThumb(id) {
    if (!thumbQueue.includes(id)) thumbQueue.push(id);
    nextThumb();
  }
  function nextThumb() {
    if (thumbBusy || !thumbQueue.length) return;
    thumbBusy = true;
    const id = thumbQueue.shift();
    const vid = document.createElement('video');
    vid.muted = true;
    vid.preload = 'auto';
    vid.innerHTML = sourcesOf(id);
    const done = (result) => {
      if (result) thumbs[id] = result;
      vid.removeAttribute('src');
      vid.innerHTML = '';
      vid.load();
      thumbBusy = false;
      paintThumb(id);
      nextThumb();
    };
    // кадр примерно с трети видео, чтобы не показывать чёрный первый кадр
    vid.addEventListener('loadedmetadata', () => { vid.currentTime = Math.min(1.5, vid.duration / 3 || 0); }, { once: true });
    vid.addEventListener('seeked', () => {
      const w = 320;
      const h = Math.round(w * (vid.videoHeight / vid.videoWidth || 9 / 16));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(vid, 0, 0, w, h);
      done(c);
    }, { once: true });
    vid.querySelector('source:last-child').addEventListener('error', () => done('missing'));
  }

  function buy(id) {
    const v = S().videos[id];
    if (!v || Core.state.gold < CONFIG.playPrice) return;
    Core.state.gold -= CONFIG.playPrice;
    v.plays += 1;
    Core.save();
    Core.renderHud();
    render();
  }

  function refresh() {
    if (Core.screen === 'inventory') render();
    Core.renderHud();
  }

  Core.registerMode('inventory', {
    open: () => { reconcile(); render(); },
    refresh: () => { reconcile(); render(); },
  });

  window.Rewards = {
    CONFIG, grant, drop, revoke, registerSim, isSqlRewardRoom, isSimRewardLevel, reconcile,
    play, modalHtml, bindModal, showDrop, loopsFor, count: () => S().order.length,
  };
})();
