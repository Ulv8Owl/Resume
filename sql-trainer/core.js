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
    name_taken: 'Маг с таким именем уже есть. Войди или выбери другое имя.',
    bad_credentials: 'Неверное имя или пароль.',
    bad_name: 'Имя: от 2 до 32 символов.',
    bad_password: 'Пароль: не короче 6 символов.',
    bad_session: 'Сессия истекла. Войди заново.',
    state_too_large: 'Прогресс слишком большой для сохранения.',
  };

  async function rpc(fn, args) {
    let res;
    try {
      res = await fetch(`${CLOUD.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: CLOUD.key, Authorization: `Bearer ${CLOUD.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
    } catch (e) {
      const err = new Error('Облако недоступно: нет связи с Supabase. Если игра открыта в окне просмотра Claude, облако там заблокировано — открой index.html из репозитория или скачанный файл. Прогресс пока сохраняется в браузере.');
      err.offline = true;
      throw err;
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const code = data && data.message;
      const err = new Error(CLOUD_ERRORS[code] || (data && (data.message || data.hint)) || `Ошибка облака (${res.status}).`);
      err.code = code;
      throw err;
    }
    return data;
  }

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
        return { state: Object.assign(freshState(), d.state || {}), account: d.account || null };
      }
    } catch (e) { /* хранилище недоступно */ }
    const state = freshState();
    migrateLegacy(state);
    return { state, account: null };
  }

  const boot = loadLocal();
  const Core = {
    state: boot.state,
    account: boot.account, // { name, token }
    sync: boot.account ? 'pending' : 'guest', // guest | pending | saving | saved | offline | error
    syncNote: '',
    modes: {},
    screen: 'home',
    P,
    esc,
  };
  window.Core = Core;

  function writeLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ state: Core.state, account: Core.account })); } catch (e) { /* без хранилища тоже играем */ }
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
      await rpc('qa_save', { p_token: Core.account.token, p_state: Core.state });
      setSync('saved');
    } catch (e) {
      if (e.code === 'bad_session') { Core.account = null; writeLocal(); setSync('guest', e.message); }
      else setSync(e.offline ? 'offline' : 'error', e.message);
    }
  }

  function setSync(s, note) {
    Core.sync = s;
    Core.syncNote = note || '';
    renderSync();
  }

  // При входе облако и браузер сравниваются: побеждает более свежий прогресс.
  async function pullCloud() {
    if (!Core.account) return;
    try {
      const d = await rpc('qa_load', { p_token: Core.account.token });
      adopt(d.state);
      Core.account.name = d.name;
      writeLocal();
      setSync('saved');
    } catch (e) {
      if (e.code === 'bad_session') { Core.account = null; writeLocal(); setSync('guest', e.message); }
      else setSync(e.offline ? 'offline' : 'error', e.message);
    }
    Core.refresh();
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

  Core.login = async function login(name, password, create) {
    const d = await rpc(create ? 'qa_register' : 'qa_login', { p_name: name, p_password: password });
    Core.account = { name: d.name, token: d.token };
    let how;
    if (create) {
      how = 'Маг создан. Текущий прогресс сохранён в облаке.';
      writeLocal();
      await pushCloud();
    } else {
      const r = adopt(d.state);
      how = r === 'pulled' ? 'Прогресс загружен из облака.' : 'Прогресс из этого браузера сохранён в облаке.';
      writeLocal();
      if (r === 'pulled') setSync('saved');
    }
    Core.refresh();
    return how;
  };

  Core.logout = async function logout() {
    const acc = Core.account;
    clearTimeout(cloudTimer);
    if (acc) { try { await rpc('qa_logout', { p_token: acc.token }); } catch (e) { /* выходим в любом случае */ } }
    Core.account = null;
    Core.state = freshState();
    writeLocal();
    setSync('guest');
    Core.refresh();
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

  const GREETINGS = [
    'Каждый мастер когда-то был учеником. Начнём с азов.',
    'Посох уже не дрожит в руке. Пора на испытания посложнее.',
    'Ты знаешь основы. Теперь отточим их до блеска.',
    'Твои заклинания уже пугают баги. Продолжим.',
    'Ты видишь систему насквозь. Осталось закрепить мастерство.',
    'Магистры не гадают, они проверяют. Ты из таких.',
    'До вершины рукой подать. Не останавливайся.',
    'Архимаг. Ты готов к любому собеседованию.',
  ];

  function renderHome() {
    const xp = Core.xp();
    const rk = P.rankFor(xp);
    const nx = P.nextRank(rk);
    const arch = P.RANKS[P.RANKS.length - 1];
    $('home-avatar').src = Core.avatar(rk);
    $('home-avatar').alt = `Аватар: ${rk.name}`;
    $('home-rank').textContent = rk.name;
    $('home-greeting').textContent = (Core.account ? `${Core.account.name}, ` : '') + GREETINGS[rk.index].charAt(0).toLowerCase() + GREETINGS[rk.index].slice(1);
    if (!Core.account) $('home-greeting').textContent = GREETINGS[rk.index];
    $('home-next').textContent = nx
      ? `До звания «${nx.name}»: ${nx.xp - xp} XP. До Архимага: ${Math.max(0, arch.xp - xp)} XP.`
      : `Ты Архимаг. Всего опыта: ${xp} XP.`;
    setBar($('home-xp-bar'), xp / arch.xp);

    // лестница званий
    $('ladder').innerHTML = P.RANKS.map((r) => `
      <li class="${r.index === rk.index ? 'current' : r.index < rk.index ? 'passed' : ''}">
        <img src="${Core.avatar(r)}" alt="" width="44" height="44" loading="lazy">
        <span class="ladder-name">${esc(r.name)}</span>
        <span class="ladder-xp">${r.xp} XP</span>
      </li>`).join('');

    // режимы
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
          <span>Пройдено: <b>${pr.done}</b> из ${pr.available} готовых · всего будет ${m.planned} ${m.unit}</span>
          <span class="bar xp"><i style="width:${Math.min(100, (earned / m.budget) * 100)}%"></i></span>
          <span>Опыт: ${earned} / ${m.budget} XP · ${Math.round(m.share * 100)}% всего опыта</span>
        </span>
      </button>`;
    }).join('');
    document.querySelectorAll('.mode-card').forEach((b) => b.addEventListener('click', () => Core.go(b.dataset.mode)));

    renderAccount();
  }

  function renderAccount() {
    const box = $('account');
    if (Core.account) {
      box.innerHTML = `
        <p class="eyebrow">Аккаунт</p>
        <p class="acc-line">Ты вошёл как <b>${esc(Core.account.name)}</b>. Прогресс сохраняется в облаке Supabase.</p>
        <p class="acc-status" id="acc-status"></p>
        <div class="acc-actions">
          <button class="btn" id="logout-btn" type="button">Выйти</button>
          <button class="ghost-btn" id="reset-all-btn" type="button">Сбросить весь прогресс</button>
        </div>`;
      $('logout-btn').addEventListener('click', () => Core.logout());
    } else {
      box.innerHTML = `
        <p class="eyebrow">Сохранение в облаке</p>
        <p class="acc-line">Сейчас ты играешь как гость, и прогресс хранится только в этом браузере. Войди или создай мага, чтобы продолжать с любого устройства.</p>
        <form class="acc-form" id="acc-form" autocomplete="on">
          <label>Имя мага<input id="acc-name" name="username" autocomplete="username" minlength="2" maxlength="32" required></label>
          <label>Пароль<input id="acc-pass" name="password" type="password" autocomplete="current-password" minlength="6" required></label>
          <div class="acc-actions">
            <button class="btn attack" type="submit" id="login-btn">Войти</button>
            <button class="btn" type="button" id="register-btn">Создать мага</button>
          </div>
        </form>
        <p class="acc-status" id="acc-status"></p>
        <div class="acc-actions"><button class="ghost-btn" id="reset-all-btn" type="button">Сбросить весь прогресс</button></div>`;
      const go = async (create) => {
        const name = $('acc-name').value.trim();
        const pass = $('acc-pass').value;
        const st = $('acc-status');
        if (name.length < 2 || pass.length < 6) { st.textContent = 'Имя от 2 символов, пароль от 6 символов.'; st.className = 'acc-status bad'; return; }
        st.textContent = create ? 'Создаю мага…' : 'Вхожу…';
        st.className = 'acc-status';
        try {
          const how = await Core.login(name, pass, create);
          const s2 = $('acc-status');
          if (s2) { s2.textContent = how; s2.className = 'acc-status ok'; }
        } catch (e) {
          st.textContent = e.message;
          st.className = 'acc-status bad';
        }
      };
      $('acc-form').addEventListener('submit', (e) => { e.preventDefault(); go(false); });
      $('register-btn').addEventListener('click', () => { if ($('acc-form').reportValidity()) go(true); });
    }
    const reset = $('reset-all-btn');
    reset.addEventListener('click', () => {
      if (reset.dataset.armed !== '1') {
        reset.dataset.armed = '1';
        reset.textContent = 'Точно? Весь опыт и золото пропадут. Нажми ещё раз';
        setTimeout(() => { if (reset.isConnected) { reset.dataset.armed = ''; reset.textContent = 'Сбросить весь прогресс'; } }, 4000);
        return;
      }
      Core.resetAll();
    });
  }

  // ---------- запуск ----------

  Core.start = function start() {
    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => Core.go(b.dataset.go)));
    Core.go('home');
    if (Core.account) pullCloud();
  };
})();
