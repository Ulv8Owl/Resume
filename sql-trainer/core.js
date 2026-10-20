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
    not_signed_in: 'Сначала войди в аккаунт.',
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
    return { v: 1, gold: 0, hp: P.RANKS[0].maxHp, mana: P.RANKS[0].maxMana, items: {}, sql: {}, theory: {}, sims: {}, updatedAt: 0 };
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
    BATTLE: ['sql', 'blitz', 'http'], // экраны боя: без шапки, с боевой музыкой и без отдыха
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

  // Перед записью подтягиваем облачную версию и объединяем: иначе два устройства (ссылка, локальный файл,
  // телефон) по очереди затирали бы прогресс друг друга целиком.
  async function pushCloud() {
    if (!Core.account) return;
    setSync('saving');
    try {
      const row = await loadRow(Core.account.id);
      if (!isEmpty(row.state)) {
        const merged = mergeStates(Core.state, row.state);
        merged.updatedAt = Math.max(Core.state.updatedAt || 0, merged.updatedAt || 0);
        Core.state = merged;
        writeLocal();
      }
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

  // Вне Подземелья (в башне и других режимах) здоровье восстанавливается за 10 секунд: +20% каждые 2 секунды;
  // мана — в прежнем темпе (+6 за 2 секунды).
  setInterval(() => {
    if (Core.BATTLE.includes(Core.screen) || document.hidden) return;
    const st = Core.state;
    const hp = Math.min(Core.maxHp(), (st.hp || 0) + Math.ceil(Core.maxHp() * 0.2));
    const mana = Math.min(Core.maxMana(), (st.mana || 0) + 6);
    if (hp === st.hp && mana === st.mana) return;
    st.hp = hp;
    st.mana = mana;
    writeLocal(); // в облако уйдёт с ближайшим сохранением, не каждые 2 секунды
    Core.renderHud();
  }, 2000);

  // Вернулся на вкладку — подтягиваем прогресс из облака: вдруг играл на другом устройстве.
  async function pullCloud() {
    if (!Core.account || Core.sync === 'saving' || Core.sync === 'pending') return;
    try {
      const row = await loadRow(Core.account.id);
      if (isEmpty(row.state) || (row.state.updatedAt || 0) <= (Core.state.updatedAt || 0)) return;
      Core.state = mergeStates(Core.state, row.state);
      writeLocal();
      Core.refresh();
    } catch (e) { /* нет связи — поиграем на локальном */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pullCloud(); });
  // Облако и браузер не перезаписывают друг друга, а объединяются: всё, что пройдено хотя бы в одном
  // сохранении, остаётся пройденным. Иначе пустое, но «более свежее» сохранение могло затереть весь прогресс.
  function adopt(cloudState) {
    if (isEmpty(cloudState)) { pushCloud(); return 'pushed'; }
    const localEmpty = isEmpty(Core.state);
    Core.state = localEmpty ? Object.assign(freshState(), cloudState) : mergeStates(Core.state, cloudState);
    if (!localEmpty) {
      Core.state.updatedAt = Date.now();
      writeLocal();
      pushCloud();
      return 'merged';
    }
    return 'pulled';
  }

  // ---------- слияние двух сохранений ----------
  const num = (a, b) => Math.max(+a || 0, +b || 0);
  function mergeMap(a, b, fn) {
    a = a || {};
    b = b || {};
    const out = {};
    new Set(Object.keys(a).concat(Object.keys(b))).forEach((k) => {
      out[k] = !(k in a) ? b[k] : !(k in b) ? a[k] : fn(a[k], b[k], k);
    });
    return out;
  }
  // Зал или уровень: пройденный важнее непройденного, из двух пройденных — с бо́льшим числом звёзд.
  function mergeStage(x, y) {
    if (!!x.cleared !== !!y.cleared) return Object.assign({}, x.cleared ? x : y, { unlocked: true });
    if (x.cleared) return Object.assign({}, num(x.stars, 0) >= num(y.stars, 0) ? x : y, { unlocked: true });
    const out = Object.assign({}, x, { hints: num(x.hints, y.hints), best: num(x.best, y.best), wounds: num(x.wounds, y.wounds) });
    if ('unlocked' in x || 'unlocked' in y) out.unlocked = !!(x.unlocked || y.unlocked);
    if (x.done || y.done) out.done = Array.from(new Set((x.done || []).concat(y.done || [])));
    return out;
  }
  function mergeStates(a, b) {
    const newer = (a.updatedAt || 0) >= (b.updatedAt || 0) ? a : b;
    const older = newer === a ? b : a;
    const out = Object.assign(freshState(), older, newer);
    // золото, здоровье, мана и расходники тратятся — их берём из более свежего сохранения, а не максимум
    out.updatedAt = num(a.updatedAt, b.updatedAt);

    const sa = a.sql || {};
    const sb = b.sql || {};
    out.sql = Object.assign({}, older.sql, newer.sql, { rooms: mergeMap(sa.rooms, sb.rooms, mergeStage), extraXp: num(sa.extraXp, sb.extraXp) });

    ['blitz', 'http'].forEach((k) => {
      if (!a[k] && !b[k]) return;
      const ba = a[k] || {};
      const bb = b[k] || {};
      out[k] = Object.assign({}, older[k], newer[k], { rooms: mergeMap(ba.rooms, bb.rooms, mergeStage), extraXp: num(ba.extraXp, bb.extraXp) });
    });
    if (a.notes || b.notes) {
      // каталоги и тексты — из более свежего сохранения, «уже оплаченные» счётчики — максимум (иначе награду можно получить дважды)
      const na = a.notes || {};
      const nb = b.notes || {};
      out.notes = Object.assign({}, older.notes, newer.notes, { paidFolders: num(na.paidFolders, nb.paidFolders), paidFiles: num(na.paidFiles, nb.paidFiles) });
    }
    out.trophies = mergeMap(a.trophies, b.trophies, num);
    out.sims = mergeMap(a.sims, b.sims, (x, y) => Object.assign({}, x, y, { levels: mergeMap(x.levels, y.levels, mergeStage) }));

    const ta = a.theory || {};
    const tb = b.theory || {};
    out.theory = Object.assign({}, older.theory, newer.theory, {
      cards: mergeMap(ta.cards, tb.cards, (x, y) => ({ known: !!(x.known || y.known), box: num(x.box, y.box), wrongs: num(x.wrongs, y.wrongs) })),
      topics: mergeMap(ta.topics, tb.topics, (x, y) => ({ cleared: !!(x.cleared || y.cleared) })),
      bestStreak: num(ta.bestStreak, tb.bestStreak),
    });

    const ja = a.jobs || {};
    const jb = b.jobs || {};
    if (ja.counts || jb.counts) {
      const byName = (list) => { const seen = new Set(); return list.filter((c) => { const k = String(c.name).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };
      const logs = (ja.log || []).concat(jb.log || []);
      out.jobs = Object.assign({}, older.jobs, newer.jobs, {
        counts: mergeMap(ja.counts, jb.counts, num),
        log: logs.filter((e, i) => logs.findIndex((x) => x.at === e.at && x.task === e.task) === i).sort((x, y) => y.at - x.at).slice(0, 100),
        channels: byName((ja.channels || []).concat(jb.channels || [])),
        companies: byName((ja.companies || []).concat(jb.companies || [])),
        status: Object.assign({}, (older.jobs || {}).status, (newer.jobs || {}).status),
        days: mergeMap(ja.days, jb.days, (x, y) => ({ all: num(x.all, y.all), main: num(x.main, y.main) })),
        bonus: Object.assign({}, ja.bonus, jb.bonus),
      });
    }

    const da = a.daily;
    const db = b.daily;
    if (da && db && da.date === db.date) {
      const score = (d) => (d.claimed ? 1e6 : 0) + (d.tasks || []).reduce((sum, t) => sum + (t.done ? t.done.length : 0) + (t.n || 0), 0);
      out.daily = Object.assign({}, score(da) >= score(db) ? da : db, { greeted: !!(da.greeted || db.greeted), streak: num(da.streak, db.streak) });
    } else if (da || db) {
      out.daily = !da ? db : !db ? da : da.date > db.date ? da : db;
    }
    return out;
  }
  Core.mergeStates = mergeStates;

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
      how = r === 'pulled' ? 'Прогресс загружен из облака.' : r === 'merged' ? 'Прогресс из этого браузера объединён с облаком.' : 'Прогресс из этого браузера сохранён в облаке.';
      writeLocal();
      if (r === 'pulled') setSync('saved');
    }
    Core.refresh();
    return how;
  };

  // Смена никнейма: база проверяет правила и уникальность. Вход дальше — по новому имени.
  Core.rename = async function rename(name) {
    const res = await rpc('qa_rename', { p_name: name.trim() });
    Core.account.name = res.name;
    Core.lastName = res.name;
    writeLocal();
    Core.refresh();
    return res.name;
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

  // События прогресса: режимы сообщают о сделанном (решён зал, засчитана карточка…), ежедневное задание их считает.
  const listeners = [];
  Core.on = (fn) => listeners.push(fn);
  Core.track = function track(type, data) { listeners.forEach((fn) => { try { fn(type, data || {}); } catch (e) { console.error(e); } }); };

  Core.xpBy = function xpBy(id) {
    const m = Core.modes[id];
    return m && m.xpOf ? m.xpOf(Core.state) : 0;
  };
  Core.xp = function xp() {
    return P.MODES.reduce((sum, m) => sum + Core.xpBy(m.id), 0);
  };
  Core.rank = () => P.rankFor(Core.xp());
  Core.maxHp = () => Core.rank().maxHp;
  Core.maxMana = () => Core.rank().maxMana;

  // Вызывается режимом после победы: возвращает строки добычи про новое звание и лечит при повышении.
  Core.rankUp = function rankUp(before) {
    const after = Core.rank();
    if (after.index <= before.index) return { rank: null, lines: [] };
    return {
      rank: after,
      lines: [
        `<li class="rank-up"><span>Новое звание</span><span>${esc(after.name)}</span></li>`,
        `<li><span>Максимум здоровья</span><span>${after.maxHp} HP</span></li>`,
        `<li><span>Максимум маны</span><span>${after.maxMana}</span></li>`,
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
    if ($('p-hp-text')) { $('p-hp-text').textContent = `${hp} / ${rk.maxHp}`; setBar($('p-hp-bar'), hp / rk.maxHp); }
    if (Core.state.mana == null) Core.state.mana = rk.maxMana;
    const mana = Math.min(Core.state.mana, rk.maxMana);
    Core.state.mana = mana;
    $('mana-text').textContent = `${Math.floor(mana)} / ${rk.maxMana}`;
    setBar($('mana-bar'), mana / rk.maxMana);
    if ($('p-mana-text')) { $('p-mana-text').textContent = `${Math.floor(mana)} / ${rk.maxMana}`; setBar($('p-mana-bar'), mana / rk.maxMana); }
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
    const prev = Core.modes[Core.screen];
    if (prev && prev.close && Core.screen !== screen) prev.close(); // режим может подвести итоги при уходе (Конспект)
    Core.screen = screen;
    document.body.classList.toggle('in-sql', Core.BATTLE.includes(screen)); // в бою шапка прячется — больше места для боя
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
    $('home-rank').innerHTML = esc(rk.name) + (Core.account ? ` <span class="home-name">${esc(Core.account.name)}</span>` : '');
    $('home-next').textContent = nx ? `До звания «${nx.name}»: ${nx.xp - xp} XP` : `Высшее звание · ${xp} XP`;
    setBar($('home-xp-bar'), nx ? (xp - rk.xp) / (nx.xp - rk.xp) : 1);

    if (window.Town) window.Town.render();
    if (window.Teacher) setTimeout(() => window.Teacher.greetIfNeeded(), 0);
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
          ${acc ? `<form class="rename-form" id="rename-form" novalidate>
            <label>Никнейм<input id="rename-input" maxlength="32" autocomplete="username" value="${esc(acc.name)}"></label>
            <button class="btn" type="submit">Сменить</button>
            <p class="acc-line rename-status" id="rename-status" aria-live="polite">Входить нужно будет по новому никнейму, пароль прежний.</p>
          </form>` : ''}
          <div class="acc-actions">${acc
            ? '<button class="btn" id="logout-btn" type="button">Выйти из аккаунта</button>'
            : '<button class="btn attack" id="open-gate-btn" type="button">Войти или создать мага</button>'}</div>
        </div>
        <div class="settings-block">
          <p class="eyebrow">Звук</p>
          <label class="music-toggle"><input type="checkbox" id="music-toggle" ${window.Music && window.Music.enabled ? 'checked' : ''}> Фоновая музыка</label>
        </div>
        <div class="settings-block">
          <p class="eyebrow">Прогресс</p>
          <p class="acc-line">Сброс обнуляет опыт, золото и пройденные уровни во всех режимах.</p>
          <div class="acc-actions"><button class="ghost-btn" id="reset-all-btn" type="button">Сбросить весь прогресс</button></div>
        </div>
        <button class="btn" id="modal-close" type="button">Закрыть</button>
      </div>`);
    const mt = $('music-toggle');
    if (mt) mt.addEventListener('change', () => window.Music && window.Music.toggle(mt.checked));
    const rf = $('rename-form');
    if (rf) rf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = $('rename-status');
      const name = $('rename-input').value.trim();
      const set = (text, cls) => { status.textContent = text; status.className = 'acc-line rename-status ' + (cls || ''); };
      if (name === acc.name) return set('Это и так твой никнейм.');
      if (!NAME_RE.test(name)) return set('Никнейм: от 2 до 32 символов — буквы, цифры, пробел, «-» и «_».', 'bad');
      set('Меняю…');
      try {
        const n = await Core.rename(name);
        set(`Готово! Теперь ты «${n}». Входи по этому никнейму.`, 'ok');
      } catch (err) {
        set(err.message, 'bad');
      }
    });
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
    $('trophies-btn').addEventListener('click', () => Core.openTrophies && Core.openTrophies());
    $('hud-teacher').addEventListener('click', () => window.Teacher && window.Teacher.open());
    Core.go('home');
    if (Core.account) setSync('pending');
    const signedIn = await restoreSession(); // уже заходил: входим сами по сохранённой сессии
    if (!signedIn && !Core.account && !Core.guest && $('auth-gate').hidden) showGate(Core.lastName ? 'login' : 'register');
    // наставник здоровается, только когда ясно, кто играет (после входа или выбора игры без аккаунта)
    Core.ready = true;
    if (window.Teacher) window.Teacher.greetIfNeeded();
  };
})();
