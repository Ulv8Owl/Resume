// Ядро Академии: общее состояние мага, сохранение (браузер + Supabase), шапка, экраны, стартовый экран.
(function () {
  'use strict';

  const P = window.Progression;
  const LOCAL_KEY = 'qa-academy-v1';
  const LEGACY_SQL_KEY = 'sql-dungeon-v3';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- облако ----------

  const CLOUD = {
    url: 'https://axktnlfdxfctswouwnxh.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4a3RubGZkeGZjdHN3b3V3bnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0ODE1MzUsImV4cCI6MjEwMDA1NzUzNX0.zJ9JBiH0L81FeyvmqEPKEJvnQ4qpNZi3PTlpHPw7rlo',
  };
  const CLOUD_ERRORS = {
    name_taken: 'Этот никнейм уже занят. Выбери другой или войди, если это ты.',
    bad_credentials: 'Неверный никнейм или пароль.',
    bad_name: 'Никнейм: от 2 до 32 символов — буквы, цифры, пробел, «-» и «_».',
    bad_password: 'Пароль: от 6 до 72 символов.',
  };
  const OFFLINE_MSG = 'Облако недоступно: нет связи с Supabase. Прогресс сохраняется в этом браузере и уйдёт в облако при следующем сохранении со связью.';

  // Аккаунты — пользователи Supabase Auth. Сессию хранит и продлевает сама библиотека supabase-js.
  let sb = null;
  function client() {
    if (sb) return sb;
    if (!window.supabase || !window.supabase.createClient) {
      const e = new Error(OFFLINE_MSG);
      e.offline = true;
      throw e;
    }
    sb = window.supabase.createClient(CLOUD.url, CLOUD.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'qa-academy-auth' },
    });
    sb.auth.onAuthStateChange((event) => {
      // токен обновления отозван или протух — просим войти заново
      if (event === 'SIGNED_OUT' && Core.account && !loggingOut) sessionExpired();
    });
    return sb;
  }

  function toError(error) {
    const msg = (error && (error.message || String(error))) || '';
    if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)) {
      const e = new Error(OFFLINE_MSG);
      e.offline = true;
      return e;
    }
    if (/Invalid login credentials/i.test(msg)) return Object.assign(new Error(CLOUD_ERRORS.bad_credentials), { code: 'bad_credentials' });
    if (CLOUD_ERRORS[msg]) return Object.assign(new Error(CLOUD_ERRORS[msg]), { code: msg });
    return Object.assign(new Error(msg ? `Ошибка облака: ${msg}` : 'Ошибка облака.'), { code: 'cloud' });
  }

  async function call(promise) {
    let res;
    try { res = await promise; } catch (e) { throw toError(e); }
    if (res.error) throw toError(res.error);
    return res.data;
  }
  const rpc = (fn, args) => call(client().rpc(fn, args));
  const loadRow = (userId) => call(client().from('qa_progress').select('nickname, state').eq('user_id', userId).single());

  // ---------- состояние ----------

  function freshState() {
    return { v: 1, gold: 0, hp: P.RANKS[0].maxHp, sql: {}, theory: {}, sims: {}, updatedAt: 0 };
  }

  // Прогресс старой версии (только SQL, в браузере) переносится в общее состояние.
  function migrateLegacy(state) {
    try {
      const raw = localStorage.getItem(LEGACY_SQL_KEY);
      if (!raw) return false;
      const old = JSON.parse(raw);
      state.sql = { rooms: old.rooms || {}, current: old.current };
      state.gold = (old.player && old.player.gold) || 0;
      state.updatedAt = Date.now();
      localStorage.removeItem(LEGACY_SQL_KEY);
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        return { state: Object.assign(freshState(), d.state || {}), account: d.account || null, lastName: d.lastName || '', guest: !!d.guest };
      }
    } catch (e) { /* хранилище недоступно */ }
    const state = freshState();
    migrateLegacy(state);
    return { state, account: null, lastName: '', guest: false };
  }

  const boot = loadLocal();
  const Core = {
    state: boot.state,
    account: boot.account, // { name, id } — пользователь Supabase Auth
    lastName: boot.lastName, // имя последнего вошедшего мага — подставляется в форму входа
    guest: boot.guest, // игрок сам выбрал игру без аккаунта
    sync: boot.account ? 'pending' : 'guest', // guest | pending | saving | saved | offline | error
    syncNote: '',
    modes: {},
    screen: 'home',
    P,
    esc,
  };
  window.Core = Core;

  function writeLocal() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify({ state: Core.state, account: Core.account, lastName: Core.lastName, guest: Core.guest }));
    } catch (e) { /* без хранилища тоже играем */ }
  }

  let cloudTimer = null;
  Core.save = function save() {
    Core.state.updatedAt = Date.now();
    writeLocal();
    if (!Core.account) return;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(pushCloud, 1200);
    setSync('pending');
  };

  async function pushCloud() {
    if (!Core.account) return;
    setSync('saving');
    try {
      await call(client().from('qa_progress')
        .update({ state: Core.state, updated_at: new Date().toISOString() })
        .eq('user_id', Core.account.id));
      setSync('saved');
    } catch (e) {
      setSync(e.offline ? 'offline' : 'error', e.message);
    }
  }

  // Сессия истекла: прогресс остаётся в браузере, а игрока просят войти заново.
  function sessionExpired() {
    Core.account = null;
    writeLocal();
    setSync('guest');
    showGate('login', 'Сессия истекла. Войди заново — прогресс из этого браузера сохранится в облаке.');
  }

  function setSync(s, note) {
    Core.sync = s;
    Core.syncNote = note || '';
    renderSync();
  }

  // При запуске: если есть сохранённая сессия Supabase Auth — входим сами и сверяем прогресс с облаком.
  async function restoreSession() {
    let session = null;
    try {
      const d = await call(client().auth.getSession());
      session = d && d.session;
    } catch (e) {
      if (Core.account) setSync('offline', e.message);
      return !!Core.account;
    }
    if (!session) {
      if (Core.account) sessionExpired();
      return false;
    }
    try {
      const row = await loadRow(session.user.id);
      Core.account = { name: row.nickname, id: session.user.id };
      Core.lastName = row.nickname;
      Core.guest = false;
      adopt(row.state);
      writeLocal();
      setSync('saved');
    } catch (e) {
      Core.account = Core.account || { name: Core.lastName || 'маг', id: session.user.id };
      setSync(e.offline ? 'offline' : 'error', e.message);
    }
    Core.refresh();
    return true;
  }

  function isEmpty(st) { return !st || !st.updatedAt; }
  function adopt(cloudState) {
    if (isEmpty(cloudState)) { pushCloud(); return 'pushed'; }
    if (cloudState.updatedAt >= (Core.state.updatedAt || 0)) {
      Core.state = Object.assign(freshState(), cloudState);
      return 'pulled';
    }
    pushCloud();
    return 'pushed';
  }

  // Регистрация создаёт пользователя Auth по никнейму (без почты и подтверждений), вход — по никнейму и паролю.
  Core.login = async function login(name, password, create) {
    const email = create
      ? (await rpc('qa_register', { p_name: name, p_password: password })).email
      : await rpc('qa_login_email', { p_name: name });
    if (!email) throw Object.assign(new Error(CLOUD_ERRORS.bad_credentials), { code: 'bad_credentials' });
    const auth = await call(client().auth.signInWithPassword({ email, password }));
    const row = await loadRow(auth.user.id);
    Core.account = { name: row.nickname, id: auth.user.id };
    Core.lastName = row.nickname;
    Core.guest = false;
    let how;
    if (create) {
      how = 'Маг создан. Текущий прогресс сохранён в облаке.';
      Core.state.updatedAt = Date.now();
      writeLocal();
      await pushCloud();
    } else {
      const r = adopt(row.state);
      how = r === 'pulled' ? 'Прогресс загружен из облака.' : 'Прогресс из этого браузера сохранён в облаке.';
      writeLocal();
      if (r === 'pulled') setSync('saved');
    }
    Core.refresh();
    return how;
  };

  let loggingOut = false;
  Core.logout = async function logout() {
    clearTimeout(cloudTimer);
    if (Core.account) await pushCloud();
    loggingOut = true;
    try { await client().auth.signOut(); } catch (e) { /* выходим в любом случае */ }
    loggingOut = false;
    Core.account = null;
    Core.guest = false;
    Core.state = freshState();
    writeLocal();
    setSync('guest');
    Core.refresh();
    showGate('login');
  };

  Core.resetAll = function resetAll() {
    Core.state = freshState();
    Core.save();
    Core.refresh();
  };

  // ---------- опыт и звания ----------

  Core.registerMode = function registerMode(id, api) { Core.modes[id] = api; };

  Core.xpBy = function xpBy(id) {
    const m = Core.modes[id];
    return m && m.xpOf ? m.xpOf(Core.state) : 0;
  };
  Core.xp = function xp() {
    return P.MODES.reduce((sum, m) => sum + Core.xpBy(m.id), 0);
  };
  Core.rank = () => P.rankFor(Core.xp());
  Core.maxHp = () => Core.rank().maxHp;

  // Вызывается режимом после победы: возвращает строки добычи про новое звание и лечит при повышении.
  Core.rankUp = function rankUp(before) {
    const after = Core.rank();
    if (after.index <= before.index) return { rank: null, lines: [] };
    Core.state.hp = after.maxHp;
    return {
      rank: after,
      lines: [
        `<li class="rank-up"><span>Новое звание</span><span>${esc(after.name)}</span></li>`,
        `<li><span>Максимум здоровья</span><span>${after.maxHp} HP</span></li>`,
      ],
    };
  };

  Core.avatar = (rank) => (window.AVATARS && window.AVATARS[rank.index]) || rank.avatar;

  // ---------- шапка ----------

  function setBar(el, frac) { el.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%'; }

  Core.renderHud = function renderHud() {
    const xp = Core.xp();
    const rk = P.rankFor(xp);
    const nx = P.nextRank(rk);
    $('hud-avatar').src = Core.avatar(rk);
    $('hud-avatar').alt = rk.name;
    $('rank-text').textContent = rk.name;
    $('xp-text').textContent = nx ? `${xp - rk.xp} / ${nx.xp - rk.xp} XP до звания «${nx.name}»` : `Высшее звание · ${xp} XP`;
    setBar($('xp-bar'), nx ? (xp - rk.xp) / (nx.xp - rk.xp) : 1);
    $('gold-text').textContent = Core.state.gold;
    const hp = Math.min(Core.state.hp, rk.maxHp);
    Core.state.hp = hp;
    $('hp-text').textContent = `${hp} / ${rk.maxHp}`;
    setBar($('hp-bar'), hp / rk.maxHp);
    $('hud-hp').hidden = Core.screen !== 'sql';
    renderSync();
  };

  const SYNC_LABEL = {
    guest: ['Гость', 'Прогресс хранится только в этом браузере. Войди, чтобы сохранять в облаке.'],
    pending: ['☁ …', 'Изменения скоро уйдут в облако.'],
    saving: ['☁ Сохраняю', 'Сохраняю прогресс в облаке.'],
    saved: ['☁ Сохранено', 'Прогресс сохранён в облаке.'],
    offline: ['⚠ Офлайн', 'Нет связи с облаком. Прогресс сохранён в браузере и уйдёт в облако при следующем сохранении.'],
    error: ['⚠ Ошибка', 'Облако вернуло ошибку.'],
  };
  function renderSync() {
    const chip = $('sync-chip');
    if (!chip) return;
    const [label, title] = SYNC_LABEL[Core.sync] || SYNC_LABEL.guest;
    chip.textContent = Core.account ? `${Core.account.name} · ${label}` : label;
    chip.title = Core.syncNote || title;
    chip.className = 'chip sync ' + Core.sync;
  }

  // ---------- экраны ----------

  Core.go = function go(screen) {
    Core.screen = screen;
    document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.dataset.screen !== screen; });
    const m = Core.modes[screen];
    if (m && m.open) m.open();
    if (screen === 'home') renderHome();
    Core.renderHud();
    window.scrollTo(0, 0);
  };

  Core.refresh = function refresh() {
    Core.renderHud();
    if (Core.screen === 'home') renderHome();
    else {
      const m = Core.modes[Core.screen];
      if (m && m.refresh) m.refresh();
    }
  };

  // ---------- общее модальное окно ----------

  Core.modal = function modal(html, opts) {
    opts = opts || {};
    const ov = $('overlay');
    ov.innerHTML = `<div class="modal${opts.defeat ? ' defeat' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    ov.hidden = false;
    const close = () => { ov.hidden = true; ov.innerHTML = ''; if (opts.onClose) opts.onClose(); };
    const c = $('modal-close');
    if (c) { c.addEventListener('click', close); c.focus(); }
    const n = $('modal-next');
    // onNext вызывается до закрытия: он ещё может прочитать поля окна
    if (n) { n.addEventListener('click', () => { if (opts.onNext) opts.onNext(); close(); }); n.focus(); }
    return close;
  };
  Core.modalOpen = () => !$('overlay').hidden;

  // ---------- стартовый экран ----------

  function renderHome() {
    const xp = Core.xp();
    const rk = P.rankFor(xp);
    const nx = P.nextRank(rk);
    $('home-avatar').src = Core.avatar(rk);
    $('home-avatar').alt = `Аватар: ${rk.name}`;
    $('home-rank').innerHTML = esc(rk.name) + (Core.account ? ` <span class="home-name">«${esc(Core.account.name)}»</span>` : '');
    $('home-next').textContent = nx ? `До звания «${nx.name}»: ${nx.xp - xp} XP` : `Высшее звание · ${xp} XP`;
    setBar($('home-xp-bar'), nx ? (xp - rk.xp) / (nx.xp - rk.xp) : 1);

    $('modes').innerHTML = P.MODES.map((m) => {
      const api = Core.modes[m.id] || {};
      const pr = api.progressOf ? api.progressOf(Core.state) : { done: 0, available: 0 };
      const earned = Core.xpBy(m.id);
      return `
      <button class="mode-card" type="button" data-mode="${m.id}">
        <span class="mode-icon" aria-hidden="true">${api.icon || '✦'}</span>
        <span class="mode-name">${esc(m.name)}</span>
        <span class="mode-tag">${esc(m.tagline)}</span>
        <span class="mode-meta">
          <span>${pr.text || `Пройдено: <b>${pr.done}</b> из ${pr.available} ${m.unit}`}</span>
          <span class="bar xp"><i style="width:${Math.min(100, (earned / m.budget) * 100)}%"></i></span>
          <span>Опыт: ${earned} / ${m.budget} XP · ${Math.round(m.share * 100)}% всего опыта</span>
        </span>
      </button>`;
    }).join('');
    document.querySelectorAll('.mode-card').forEach((b) => b.addEventListener('click', () => Core.go(b.dataset.mode)));
  }

  // ---------- настройки: аккаунт и сброс прогресса ----------

  function openSettings() {
    const acc = Core.account;
    const close = Core.modal(`
      <div class="settings">
        <h3>Настройки</h3>
        <div class="settings-block">
          <p class="eyebrow">Аккаунт</p>
          <p class="acc-line">${acc
            ? `Ты вошёл как <b>${esc(acc.name)}</b>. Прогресс сохраняется в облаке, а при следующем заходе игра войдёт сама.`
            : 'Ты играешь без аккаунта: прогресс хранится только в этом браузере. Создай мага, чтобы продолжать с любого устройства.'}</p>
          <div class="acc-actions">${acc
            ? '<button class="btn" id="logout-btn" type="button">Выйти из аккаунта</button>'
            : '<button class="btn attack" id="open-gate-btn" type="button">Войти или создать мага</button>'}</div>
        </div>
        <div class="settings-block">
          <p class="eyebrow">Прогресс</p>
          <p class="acc-line">Сброс обнуляет опыт, золото и пройденные уровни во всех режимах.</p>
          <div class="acc-actions"><button class="ghost-btn" id="reset-all-btn" type="button">Сбросить весь прогресс</button></div>
        </div>
        <button class="btn" id="modal-close" type="button">Закрыть</button>
      </div>`);
    const lo = $('logout-btn');
    if (lo) lo.addEventListener('click', () => { close(); Core.logout(); });
    const og = $('open-gate-btn');
    if (og) og.addEventListener('click', () => { close(); showGate(Core.lastName ? 'login' : 'register'); });
    const reset = $('reset-all-btn');
    reset.addEventListener('click', () => {
      if (reset.dataset.armed !== '1') {
        reset.dataset.armed = '1';
        reset.textContent = 'Точно? Весь опыт и золото пропадут. Нажми ещё раз';
        setTimeout(() => { if (reset.isConnected) { reset.dataset.armed = ''; reset.textContent = 'Сбросить весь прогресс'; } }, 4000);
        return;
      }
      close();
      Core.resetAll();
    });
  }
  Core.openSettings = openSettings;

  // ---------- экран входа и регистрации ----------

  const NAME_RE = /^[A-Za-zА-Яа-яЁё0-9_\- ]{2,32}$/; // те же правила, что в qa_register
  let gateTab = 'register';
  let nameCheck = null;

  function showGate(tab, note) {
    gateTab = tab || gateTab;
    const g = $('auth-gate');
    g.hidden = false;
    document.body.classList.add('gated');
    renderGate(note);
  }
  function hideGate() {
    $('auth-gate').hidden = true;
    document.body.classList.remove('gated');
  }
  Core.showGate = showGate;

  function renderGate(note) {
    const g = $('auth-gate');
    const reg = gateTab === 'register';
    g.innerHTML = `
      <div class="gate-card" role="dialog" aria-modal="true" aria-labelledby="gate-title">
        <img class="gate-avatar" src="${Core.avatar(P.RANKS[0])}" alt="" width="120" height="120">
        <h2 class="gate-title" id="gate-title">Академия QA</h2>
        <p class="gate-sub">Тренажёр к собеседованию тестировщика. Путь от Ученика до Архимага.</p>
        <div class="gate-tabs" role="tablist">
          <button type="button" role="tab" aria-selected="${!reg}" class="${reg ? '' : 'on'}" data-tab="login">Вход</button>
          <button type="button" role="tab" aria-selected="${reg}" class="${reg ? 'on' : ''}" data-tab="register">Регистрация</button>
        </div>
        <form class="gate-form" id="gate-form" novalidate>
          <label>Никнейм
            <input id="gate-name" name="username" autocomplete="username" maxlength="32" required value="${esc(reg ? '' : Core.lastName || '')}" placeholder="${reg ? 'Придумай уникальное имя мага' : 'Твой никнейм'}">
          </label>
          ${reg ? '<p class="gate-hint" id="gate-name-hint">От 2 до 32 символов: буквы, цифры, пробел, «-» и «_». Регистр не важен.</p>' : ''}
          <label>Пароль
            <input id="gate-pass" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" minlength="6" required placeholder="${reg ? 'Не короче 6 символов' : ''}">
          </label>
          ${reg ? '<label>Повтори пароль<input id="gate-pass2" type="password" autocomplete="new-password" minlength="6" required></label>' : ''}
          <p class="gate-status" id="gate-status" aria-live="polite">${note ? esc(note) : ''}</p>
          <button class="btn attack gate-submit" type="submit">${reg ? 'Создать мага' : 'Войти'}</button>
        </form>
        <p class="gate-foot">${reg ? 'Без почты и подтверждений: только никнейм и пароль.' : 'Нет аккаунта? Открой вкладку «Регистрация».'}</p>
        <button class="gate-guest" type="button" id="gate-guest">Играть без аккаунта — прогресс останется только в этом браузере</button>
      </div>`;
    g.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { gateTab = b.dataset.tab; renderGate(); }));
    $('gate-guest').addEventListener('click', () => {
      Core.guest = true;
      writeLocal();
      hideGate();
      Core.refresh();
    });
    const nameInput = $('gate-name');
    if (reg) nameInput.addEventListener('input', () => checkName(nameInput.value));
    $('gate-form').addEventListener('submit', (e) => { e.preventDefault(); submitGate(reg); });
    (nameInput.value ? $('gate-pass') : nameInput).focus();
  }

  // Живая проверка, свободен ли никнейм. Окончательно уникальность всё равно проверяет база при регистрации.
  function checkName(raw) {
    const hint = $('gate-name-hint');
    const name = raw.trim();
    clearTimeout(nameCheck);
    if (!hint) return;
    if (!name) { hint.textContent = 'От 2 до 32 символов: буквы, цифры, пробел, «-» и «_». Регистр не важен.'; hint.className = 'gate-hint'; return; }
    if (!NAME_RE.test(name)) { hint.textContent = 'Никнейм: от 2 до 32 символов — буквы, цифры, пробел, «-» и «_».'; hint.className = 'gate-hint bad'; return; }
    hint.textContent = 'Проверяю, свободен ли никнейм…';
    hint.className = 'gate-hint';
    nameCheck = setTimeout(async () => {
      try {
        const free = await rpc('qa_name_available', { p_name: name });
        if ($('gate-name') && $('gate-name').value.trim() !== name) return;
        hint.textContent = free ? `✓ «${name}» свободен` : `✗ «${name}» уже занят — выбери другой`;
        hint.className = 'gate-hint ' + (free ? 'ok' : 'bad');
      } catch (e) {
        hint.textContent = e.offline ? 'Не удалось проверить: нет связи с облаком.' : 'Свободен ли никнейм, проверим при регистрации.';
        hint.className = 'gate-hint';
      }
    }, 400);
  }

  async function submitGate(reg) {
    const name = $('gate-name').value.trim();
    const pass = $('gate-pass').value;
    const st = $('gate-status');
    const bad = (m) => { st.textContent = m; st.className = 'gate-status bad'; };
    if (!NAME_RE.test(name)) return bad('Никнейм: от 2 до 32 символов — буквы, цифры, пробел, «-» и «_».');
    if (pass.length < 6) return bad('Пароль должен быть не короче 6 символов.');
    if (reg && pass !== $('gate-pass2').value) return bad('Пароли не совпадают.');
    const btn = document.querySelector('.gate-submit');
    btn.disabled = true;
    st.textContent = reg ? 'Создаю мага…' : 'Вхожу…';
    st.className = 'gate-status';
    try {
      await Core.login(name, pass, reg);
      hideGate();
      Core.go('home');
    } catch (e) {
      btn.disabled = false;
      bad(e.message);
    }
  }

  // ---------- запуск ----------

  Core.start = async function start() {
    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => Core.go(b.dataset.go)));
    $('settings-btn').addEventListener('click', openSettings);
    Core.go('home');
    if (Core.account) setSync('pending');
    const signedIn = await restoreSession(); // уже заходил: входим сами по сохранённой сессии
    if (!signedIn && !Core.account && !Core.guest && $('auth-gate').hidden) showGate(Core.lastName ? 'login' : 'register');
  };
})();
