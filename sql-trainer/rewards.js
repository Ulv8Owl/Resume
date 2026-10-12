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

  // ---------- зашифрованные видео ----------
  // Если в папке mp3 лежит check.js (его создаёт tools/encrypt-videos.sh), видео хранятся зашифрованными
  // в файлах mp3/N.js: открыть их напрямую нельзя. Игра спрашивает пароль, расшифровывает видео в памяти
  // и играет его оттуда. Без check.js игра, как раньше, ищет обычные файлы mp3/N.mp3 / .mp4 / .webm.
  const PASS_KEY = 'qa-academy-vault';
  const THUMBS_KEY = 'qa-academy-thumbs';
  const CHECK_TEXT = 'qa-academy-ok';
  const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
  const vault = { mode: null, check: null, pass: null, got: {} }; // mode: off | locked | open
  window.QAVault = {
    check(b64) { vault.check = b64; },
    put(id, ext, b64) { vault.got[id] = { ext, b64 }; },
  };

  // Файлы читаются через <script>: на file:// браузер не даёт читать файлы через fetch.
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = () => { el.remove(); resolve(); };
      el.onerror = () => { el.remove(); reject(new Error('missing')); };
      document.head.appendChild(el);
    });
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Формат openssl enc -aes-256-ctr -pbkdf2 -iter 100000 -md sha256: «Salted__», 8 байт соли, шифротекст.
  async function decrypt(bytes, pass) {
    if (String.fromCharCode(...bytes.subarray(0, 8)) !== 'Salted__') throw new Error('bad format');
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: bytes.slice(8, 16), iterations: 100000, hash: 'SHA-256' }, base, 384));
    const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-CTR', false, ['decrypt']);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CTR', counter: bits.slice(32, 48), length: 128 }, key, bytes.subarray(16)));
  }
  async function tryPass(pass) {
    try {
      const out = await decrypt(b64ToBytes(vault.check), pass);
      if (new TextDecoder().decode(out) !== CHECK_TEXT) return false;
    } catch (e) { return false; }
    vault.pass = pass;
    vault.mode = 'open';
    return true;
  }
  async function vaultMode() {
    if (vault.mode) return vault.mode;
    try { await loadScript(`${CONFIG.dir}/check.js`); } catch (e) { vault.mode = 'off'; return vault.mode; }
    let saved = null;
    try { saved = localStorage.getItem(PASS_KEY); } catch (e) { /* без хранилища — спросим пароль */ }
    if (!(saved && await tryPass(saved))) vault.mode = 'locked';
    return vault.mode;
  }
  // Расшифровать видео N в blob: URL. Если файла нет — ошибка 'missing'.
  async function vaultUrl(id) {
    await loadScript(`${CONFIG.dir}/${id}.js`);
    const item = vault.got[id];
    delete vault.got[id];
    if (!item) throw new Error('missing');
    const data = await decrypt(b64ToBytes(item.b64), vault.pass);
    return URL.createObjectURL(new Blob([data], MIME[item.ext] ? { type: MIME[item.ext] } : {}));
  }

  // Форма пароля. onOk вызывается после верного пароля.
  function unlockForm(box, onOk) {
    box.innerHTML = `<form class="vault-form">
      <p>Видео зашифрованы. Введи пароль, который задал при шифровании.</p>
      <input type="password" class="vault-pass" autocomplete="current-password" placeholder="Пароль от видео" aria-label="Пароль от видео">
      <label class="vault-remember"><input type="checkbox" checked> Запомнить в этом браузере</label>
      <div class="vault-row"><button class="btn attack" type="submit">Открыть</button><span class="vault-msg" aria-live="polite"></span></div>
    </form>`;
    const form = box.querySelector('form');
    const input = form.querySelector('.vault-pass');
    const msg = form.querySelector('.vault-msg');
    input.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = 'Проверяю…';
      if (await tryPass(input.value)) {
        try {
          if (form.querySelector('.vault-remember input').checked) localStorage.setItem(PASS_KEY, input.value);
          else localStorage.removeItem(PASS_KEY);
        } catch (err) { /* не запомнили — спросим в следующий раз */ }
        onOk();
      } else {
        msg.textContent = 'Неверный пароль.';
        input.select();
      }
    });
  }

  // ---------- плеер ----------

  let player = null;
  function closePlayer() {
    if (!player) return;
    player.video.pause();
    player.video.removeAttribute('src');
    if (player.url) URL.revokeObjectURL(player.url);
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
        <div class="vplayer-lock" hidden></div>
        <video playsinline disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"></video>
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
    const fail = (text) => { info.textContent = text + ' Воспроизведение не потрачено.'; info.classList.add('bad'); };
    const p = player;
    const start = async () => {
      const mode = await vaultMode();
      if (player !== p) return;
      if (mode === 'locked') {
        const lock = layer.querySelector('.vplayer-lock');
        lock.hidden = false;
        video.hidden = true;
        info.textContent = '';
        unlockForm(lock, () => { lock.hidden = true; video.hidden = false; info.textContent = 'Загружаю…'; refresh(); start(); });
        return;
      }
      if (mode === 'open') {
        try {
          p.url = await vaultUrl(id);
        } catch (e) {
          fail(e.message === 'missing'
            ? `Не нашёл файл ${CONFIG.dir}/${id}.js. Зашифруй видео скриптом tools/encrypt-videos.sh.`
            : 'Не удалось расшифровать видео: файл повреждён или зашифрован другим паролем.');
          return;
        }
        if (player !== p) { URL.revokeObjectURL(p.url); return; }
        video.src = p.url;
        video.addEventListener('error', () => fail('Браузер не смог воспроизвести это видео.'), { once: true });
        return;
      }
      video.innerHTML = sourcesOf(id);
      // ошибка последнего <source> — значит, ни одного файла с этим номером нет
      video.querySelector('source:last-child').addEventListener('error', () => {
        fail(`Не нашёл файл ${CONFIG.dir}/${id}.${CONFIG.exts.join(' / .')}. Положи его в папку ${CONFIG.dir} рядом с index.html.`);
      });
      video.load();
    };
    start();
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
        <span class="inv-vault"></span>
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
    list.forEach((id) => { if (thumbs[id] && thumbs[id] !== 'locked') paintThumb(id); else { delete thumbs[id]; queueThumb(id); } });
    renderVaultButton();
  }

  // Кнопка в шапке инвентаря: открыть зашифрованные видео паролем или снова закрыть их.
  async function renderVaultButton() {
    const mode = await vaultMode();
    const box = screen.querySelector('.inv-vault');
    if (!box || mode === 'off') return;
    if (mode === 'locked') {
      box.innerHTML = '<button class="btn attack" type="button">🔑 Открыть видео</button>';
      box.firstChild.addEventListener('click', () => {
        const layer = document.createElement('div');
        layer.className = 'vplayer';
        layer.innerHTML = '<div class="vplayer-box vault-box" role="dialog" aria-modal="true" aria-label="Пароль от видео"><div class="vplayer-lock"></div><div class="vplayer-bar"><span></span><button class="btn" type="button" data-close>Закрыть</button></div></div>';
        document.body.appendChild(layer);
        layer.querySelector('[data-close]').addEventListener('click', () => layer.remove());
        unlockForm(layer.querySelector('.vplayer-lock'), () => { layer.remove(); render(); });
      });
    } else {
      box.innerHTML = '<button class="ghost-btn" type="button" title="Забыть пароль в этом браузере">🔒 Заблокировать</button>';
      box.firstChild.addEventListener('click', () => {
        try { localStorage.removeItem(PASS_KEY); } catch (e) { /* и так не сохранён */ }
        vault.pass = null;
        vault.mode = 'locked';
        render();
      });
    }
  }

  // ---------- превью ----------
  // Кадр каждого видео один раз рисуется на холст и запоминается. Видео грузятся по одному:
  // десятки одновременно открытых <video> браузер не тянет. Превью зашифрованных видео ещё и сохраняются
  // в браузере (маленькие JPEG), чтобы не расшифровывать все видео при каждом открытии инвентаря.
  const thumbs = {};
  const thumbQueue = [];
  let thumbBusy = false;
  function savedThumbs() {
    try { return JSON.parse(localStorage.getItem(THUMBS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveThumb(id, dataUrl) {
    try { const all = savedThumbs(); all[id] = dataUrl; localStorage.setItem(THUMBS_KEY, JSON.stringify(all)); } catch (e) { /* нет места — не страшно */ }
  }

  function paintThumb(id) {
    const c = screen && screen.querySelector(`canvas[data-thumb="${id}"]`);
    if (!c) return;
    const t = thumbs[id];
    const note = c.parentNode.querySelector('.inv-missing');
    if (t === 'missing' || t === 'locked') {
      c.hidden = true;
      note.hidden = false;
      note.textContent = t === 'locked' ? '🔒' : 'файл не найден';
    } else if (typeof t === 'string') {
      const img = new Image();
      img.onload = () => { c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); };
      img.src = t;
    } else if (t) {
      c.width = t.width;
      c.height = t.height;
      c.getContext('2d').drawImage(t, 0, 0);
    }
  }
  function queueThumb(id) {
    const saved = savedThumbs()[id];
    if (saved) { thumbs[id] = saved; paintThumb(id); return; }
    if (!thumbQueue.includes(id)) thumbQueue.push(id);
    nextThumb();
  }
  async function nextThumb() {
    if (thumbBusy || !thumbQueue.length) return;
    thumbBusy = true;
    const id = thumbQueue.shift();
    const mode = await vaultMode();
    let url = null;
    if (mode === 'locked') { thumbs[id] = 'locked'; thumbBusy = false; paintThumb(id); nextThumb(); return; }
    if (mode === 'open') {
      try { url = await vaultUrl(id); } catch (e) { thumbs[id] = 'missing'; thumbBusy = false; paintThumb(id); nextThumb(); return; }
    }
    const vid = document.createElement('video');
    vid.muted = true;
    vid.preload = 'auto';
    if (url) vid.src = url; else vid.innerHTML = sourcesOf(id);
    const done = (result) => {
      if (result) thumbs[id] = result;
      vid.removeAttribute('src');
      vid.innerHTML = '';
      vid.load();
      if (url) URL.revokeObjectURL(url);
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
      // кадр расшифрованного видео (blob:) можно сохранить; кадр файла с диска браузер сохранить не даёт
      if (url) {
        const small = document.createElement('canvas');
        small.width = 192;
        small.height = Math.round(192 * h / w);
        small.getContext('2d').drawImage(c, 0, 0, small.width, small.height);
        const data = small.toDataURL('image/jpeg', 0.7);
        saveThumb(id, data);
        done(data);
      } else done(c);
    }, { once: true });
    if (url) vid.addEventListener('error', () => done('missing'), { once: true });
    else vid.querySelector('source:last-child').addEventListener('error', () => done('missing'));
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
