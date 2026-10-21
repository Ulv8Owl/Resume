// Режим «Осада»: орки штурмуют башню. Включается кнопкой-катапультой на главном экране на выбранное время
// (от 5 минут до 6 часов). Пока осада идёт: башня горит (Town-battle.jpeg), открыт только зал шара — режим «Осада»,
// играет Battle2, в меню тикает красный таймер. В зале шара — 4 боя (siege-data.js): SQL, Блиц, тест-дизайн/UX и API.
// Без монстров и трофеев, но враги бьют: удар раз в 10 секунд и за каждую ошибку. Награда — золото.
(function () {
  'use strict';

  const Core = window.Core;
  const esc = Core.esc;
  const $ = (id) => document.getElementById(id);
  const ANSWER_MANA = 12;
  const TICK_MS = 10000;
  const MANA_REGEN = 4;
  const DURATIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 360];
  const ALLOWED = ['home', 'siege', 'shop', 'focus']; // куда можно ходить во время осады
  const TYPE_NAME = { sql: 'SQL', blitz: 'Блиц', design: 'Тест-дизайн и UX', postman: 'API · Postman' };
  const SIEGE_ICON = 'Avatars/Icon_Battle_5.jpeg';

  const battles = () => (window.SIEGE && window.SIEGE.battles) || [];
  const S = () => Core.state.siege || null;
  const active = () => { const s = S(); return !!(s && s.until > Date.now()); };
  const stats = () => { const st = Core.state; if (!st.siegeStats) st.siegeStats = { wins: 0 }; return st.siegeStats; };
  const left = () => { const s = S(); return s ? Math.max(0, s.until - Date.now()) : 0; };
  const clock = (ms) => { const t = Math.ceil(ms / 1000); const h = Math.floor(t / 3600); const m = Math.floor(t / 60) % 60; const s = t % 60; return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`; };
  const durText = (m) => (m < 60 ? `${m} мин` : `${m / 60} ч`.replace('.5', ',5'));
  const tickDmg = () => Math.max(2, Math.round(Core.maxHp() * 0.04));
  const hitDmg = () => Math.max(5, Math.round(Core.maxHp() * 0.12));
  const goldOf = (b) => 40 + b.tasks.length * 10;
  const shuffle = (a) => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

  // ---------- начало и конец осады ----------
  function start(minutes) {
    Core.state.siege = { started: Date.now(), until: Date.now() + minutes * 60000, minutes, wins: 0 };
    fight = null;
    Core.save();
    renderLaunch();
    if (window.Town) window.Town.render();
    Core.go('siege');
  }

  function finish(early) {
    const s = S();
    if (!s) return;
    Core.state.siege = null;
    fight = null;
    Core.save();
    renderLaunch();
    Core.go('home');
    Core.modal(`<div class="big"><img class="siege-modal-icon" src="${SIEGE_ICON}" alt=""></div>
      <h3>${early ? 'Осада снята досрочно' : 'Осада окончена'}</h3>
      <ul class="loot"><li><span>Выиграно боёв</span><span>${s.wins || 0}</span></li><li><span>Длительность</span><span>${durText(s.minutes)}</span></li></ul>
      <p class="modal-tip">${s.wins ? 'Орки отброшены от стен, маги восстанавливают башню.' : 'В этот раз орки отступили сами. В следующую осаду — в бой!'}</p>
      <button class="btn attack" id="modal-close" type="button">В башню</button>`);
  }

  function chooseDuration() {
    const close = Core.modal(`<div class="siege-start"><img class="siege-modal-icon" src="${SIEGE_ICON}" alt="">
      <h3>Орки у стен башни!</h3>
      <p>Пока идёт осада, в башне открыт только зал шара: маги через шар отбивают штурм — SQL, Блиц, тест-дизайн и API. Все остальные залы закрыты до конца осады.</p>
      <label class="siege-dur">Сколько держать оборону
        <select id="siege-minutes">${DURATIONS.map((m) => `<option value="${m}" ${m === 60 ? 'selected' : ''}>${durText(m)}</option>`).join('')}</select></label>
      <button class="btn attack" type="button" id="siege-go">⚔ Начать осаду</button>
      <button class="btn" id="modal-close" type="button">Не сейчас</button></div>`);
    $('siege-go').addEventListener('click', () => { const m = +$('siege-minutes').value; close(); start(m); });
  }

  function launchClick() {
    if (!active()) return chooseDuration();
    const close = Core.modal(`<div class="siege-start"><img class="siege-modal-icon" src="${SIEGE_ICON}" alt="">
      <h3>Осада идёт</h3><p class="siege-red">До конца: ${clock(left())}</p><p>Выиграно боёв: ${S().wins || 0}</p>
      <button class="btn attack" type="button" id="siege-hall">В зал шара</button>
      <button class="btn" type="button" id="siege-stop">Снять осаду досрочно</button>
      <button class="ghost-btn" id="modal-close" type="button">Закрыть</button></div>`);
    $('siege-hall').addEventListener('click', () => { close(); Core.go('siege'); });
    $('siege-stop').addEventListener('click', () => { if (window.confirm('Снять осаду досрочно?')) { close(); finish(true); } });
  }

  // кнопка-катапульта и красный таймер на главном экране
  function renderLaunch() {
    const on = active();
    const img = $('siege-btn-img');
    if (img) img.src = on ? 'Avatars/Botton-battle-active.jpeg' : 'Avatars/Botton-battle.jpeg';
    const btn = $('siege-btn');
    if (btn) btn.classList.toggle('on', on);
    const t = $('siege-timer');
    if (t) { t.hidden = !on; t.textContent = on ? clock(left()) : ''; }
  }

  // ---------- бой ----------
  let fight = null; // { id, at, tasks, wounds, mistakes, hints, note, noteCls, draft, last, picked }
  let view = 'hub';
  const battle = () => battles().find((b) => b.id === (fight && fight.id));

  function prepare(b, t) {
    if (b.type === 'blitz') { const options = shuffle(t.a); return Object.assign({}, t, { options, right: options.indexOf(t.a[0]) }); }
    if (b.type === 'design') {
      const order = shuffle(t.options.map((_, i) => i));
      return Object.assign({}, t, { options: order.map((i) => t.options[i]), right: t.right.map((r) => order.indexOf(r)) });
    }
    return Object.assign({}, t);
  }

  function enter(id) {
    const b = battles().find((x) => x.id === id);
    if (!b) return;
    fight = { id, at: 0, tasks: b.tasks.map((t) => prepare(b, t)), wounds: 0, mistakes: 0, hints: 0, note: '', noteCls: '', draft: '', last: null, picked: [] };
    view = 'battle';
    render();
  }

  const screen = document.querySelector('.screen[data-screen="siege"]');

  function head(title) {
    return `<div class="siege-head">
      <button class="ghost-btn" type="button" data-back>${view === 'battle' ? '← К боям' : '← В башню'}</button>
      <h2 class="sim-title"><img class="siege-head-icon" src="${SIEGE_ICON}" alt=""> ${esc(title)}</h2>
      <span class="siege-red siege-clock" data-clock>⏳ ${clock(left())}</span></div>`;
  }

  function hub() {
    return `${head('Осада башни')}
      <p class="siege-lead">Маги держат оборону через хрустальный шар. Выбери участок стены — каждая победа отбрасывает орков.</p>
      <div class="siege-hub">${battles().map((b) => `
        <button type="button" class="siege-card" data-battle="${b.id}">
          <img src="${b.icon}" alt="">
          <span class="siege-card-text"><small>${esc(TYPE_NAME[b.type])} · ${b.tasks.length} ${b.tasks.length < 5 ? 'волны' : 'волн'}</small><b>${esc(b.name)}</b><span>${esc(b.text || '')}</span>
          <em>Награда: 🪙 ${goldOf(b)}</em></span></button>`).join('')}</div>
      <p class="siege-lead">Побед в этой осаде: <b>${(S() && S().wins) || 0}</b> · за всё время: <b>${stats().wins}</b></p>`;
  }

  function arenaHtml() {
    const b = battle();
    const f = fight;
    return `<img class="siege-enemy" src="${b.icon}" alt="">
      <p class="monster-floor">${esc(TYPE_NAME[b.type])} · волна ${f.at + 1} из ${f.tasks.length}</p>
      <h2 class="monster-name">${esc(b.enemy)}</h2>
      <div class="monster-hp"><div class="blitz-pips">${f.tasks.map((x, i) => `<i class="${i < f.at ? 'done' : i === f.at ? 'now' : ''}"></i>`).join('')}</div>
        <div class="monster-meta">Бьют на ${tickDmg()} каждые 10 с и на ${hitDmg()} за ошибку · ответ стоит ${ANSWER_MANA} маны</div></div>
      <div class="player-bars">
        <div><span>❤ Ты <b>${Core.state.hp} / ${Core.maxHp()}</b></span><div class="bar hp"><i style="width:${Core.state.hp / Core.maxHp() * 100}%"></i></div></div>
        <div><span>💧 Мана <b>${Math.floor(Core.state.mana)} / ${Core.maxMana()}</b></span><div class="bar mana"><i style="width:${Core.state.mana / Core.maxMana() * 100}%"></i></div></div>
      </div>
      ${f.note ? `<p class="arena-line ${f.noteCls || ''}">${esc(f.note)}</p>` : ''}
      <div class="belt">${['hp', 'mana', 'scroll1', 'scroll3'].map((id) => {
        const it = window.Shop.item(id);
        const tip = id === 'scroll1' ? 'подсказка к волне' : id === 'scroll3' ? 'готовый ответ' : it.text;
        return `<button type="button" data-use="${id}" title="${esc(it.name)}: ${esc(tip)}" ${window.Shop.count(id) ? '' : 'disabled'}>${it.icon}${id.startsWith('scroll') ? `<span class="belt-tier">${id === 'scroll1' ? 'I' : 'III'}</span>` : ''} <b>${window.Shop.count(id)}</b></button>`;
      }).join('')}<button type="button" class="belt-shop" data-shop>🧪 Лавка</button></div>`;
  }

  function table(res) {
    if (!res || !res.columns || !res.columns.length) return '<p class="http-empty">Пусто.</p>';
    const rows = res.values.slice(0, 50);
    return `<div class="siege-table"><table><thead><tr>${res.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${v === null ? '<i>NULL</i>' : esc(String(v))}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${res.values.length > 50 ? `<p class="http-empty">…и ещё ${res.values.length - 50} строк</p>` : ''}</div>`;
  }

  function taskHtml() {
    const b = battle();
    const f = fight;
    const t = f.tasks[f.at];
    const wave = `<p class="eyebrow">Волна ${f.at + 1} из ${f.tasks.length}</p>`;
    if (b.type === 'sql') {
      return `${wave}<p class="blitz-text">${t.task}</p>${t.tables ? `<p class="http-empty">Таблицы: ${t.tables.map((x) => `<code>${esc(x)}</code>`).join(', ')}</p>` : ''}
        <textarea class="http-editor" data-editor spellcheck="false" placeholder="SELECT …">${esc(f.draft)}</textarea>
        <div class="http-actions"><button class="btn" type="button" data-scout>Разведать</button><button class="btn attack" type="button" data-send>⚔ Атаковать</button>
          <span class="http-keys"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> — атака</span></div>
        ${f.last ? (f.last.error ? `<pre class="http-res bad">${esc(f.last.error)}</pre>` : `<p class="eyebrow">${esc(f.last.label)}</p>${table(f.last.res)}`) : ''}`;
    }
    if (b.type === 'postman') {
      return `${wave}<p class="blitz-text">${esc(t.q)}</p>
        <textarea class="http-editor" data-editor spellcheck="false" placeholder="GET /heroes&#10;Authorization: Bearer …&#10;&#10;{ тело }">${esc(f.draft)}</textarea>
        <div class="http-actions"><button class="btn attack" type="button" data-send>➤ Отправить</button><span class="http-keys"><kbd>Ctrl</kbd>+<kbd>Enter</kbd></span></div>
        <p class="eyebrow">Ответ сервера</p>${window.HttpView ? window.HttpView(f.last) : ''}`;
    }
    if (b.type === 'blitz') {
      return `${wave}<p class="blitz-text">${esc(t.q)}</p>
        <div class="blitz-options">${t.options.map((o, i) => `<button type="button" class="blitz-opt" data-opt="${i}">${esc(o)}</button>`).join('')}</div>`;
    }
    // тест-дизайн и UX: макет интерфейса и варианты (один или несколько верных)
    return `${wave}<p class="blitz-text">${esc(t.q)}</p>
      ${t.mock ? `<div class="siege-mock" aria-label="Макет интерфейса">${t.mock}</div>` : ''}
      ${t.multi ? '<p class="http-empty">Отметь все верные варианты и нажми «Ответить».</p>' : ''}
      <div class="blitz-options">${t.options.map((o, i) => t.multi
        ? `<label class="blitz-opt siege-check"><input type="checkbox" data-pick="${i}" ${f.picked.includes(i) ? 'checked' : ''}> ${esc(o)}</label>`
        : `<button type="button" class="blitz-opt" data-opt="${i}">${esc(o)}</button>`).join('')}</div>
      ${t.multi ? '<button class="btn attack" type="button" data-multi>⚔ Ответить</button>' : ''}`;
  }

  function render() {
    if (!active()) { screen.innerHTML = ''; return; }
    if (view === 'hub' || !fight || !battle()) {
      view = 'hub';
      screen.innerHTML = hub();
    } else {
      screen.innerHTML = `${head(battle().name)}
        <div class="blitz-board siege-board">
          <section class="panel arena siege-arena">${arenaHtml()}</section>
          <section class="panel blitz-q siege-task">${taskHtml()}</section>
        </div>`;
    }
    bind();
  }

  function renderArena() {
    const box = screen.querySelector('.siege-arena');
    if (!box) return;
    box.innerHTML = arenaHtml();
    bindArena();
  }

  function bindArena() {
    const shop = screen.querySelector('[data-shop]');
    if (shop) shop.addEventListener('click', () => Core.go('shop'));
    screen.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => useItem(b.dataset.use)));
  }

  function bind() {
    screen.querySelector('[data-back]').addEventListener('click', () => { if (view === 'battle') { view = 'hub'; fight = null; render(); } else Core.go('home'); });
    screen.querySelectorAll('[data-battle]').forEach((b) => b.addEventListener('click', () => enter(b.dataset.battle)));
    if (view !== 'battle') return;
    bindArena();
    const ed = screen.querySelector('[data-editor]');
    if (ed) {
      ed.addEventListener('input', () => { fight.draft = ed.value; });
      ed.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); answer(); } });
    }
    const send = screen.querySelector('[data-send]');
    if (send) send.addEventListener('click', () => answer());
    const scout = screen.querySelector('[data-scout]');
    if (scout) scout.addEventListener('click', doScout);
    screen.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => answer(+b.dataset.opt)));
    screen.querySelectorAll('[data-pick]').forEach((c) => c.addEventListener('change', () => {
      fight.picked = [...screen.querySelectorAll('[data-pick]:checked')].map((x) => +x.dataset.pick);
    }));
    const multi = screen.querySelector('[data-multi]');
    if (multi) multi.addEventListener('click', () => answer(fight.picked.slice()));
  }

  const roomOf = (t, i) => ({ id: `siege-${fight.id}-${i}`, kind: 'query', solution: t.solution, ordered: !!t.ordered, tables: t.tables || [] });
  const judge = () => window.Dungeon && window.Dungeon.judge;

  function doScout() {
    const j = judge();
    if (!j) { fight.note = 'Хроники ещё загружаются — попробуй через секунду.'; fight.noteCls = ''; return renderArena(); }
    const r = j.scout(roomOf(fight.tasks[fight.at], fight.at), fight.draft);
    fight.last = { res: r.res, error: r.error, label: 'разведка (бесплатно)' };
    render();
  }

  // Проверка ответа текущей волны: { ok, why, last }
  function check(b, t, input) {
    if (b.type === 'blitz') return { ok: input === t.right, why: 'Неверно.' };
    if (b.type === 'design') {
      if (!t.multi) return { ok: input === t.right[0], why: 'Неверно.' };
      const want = t.right.slice().sort().join(',');
      const got = input.slice().sort().join(',');
      if (!input.length) return { soft: 'Отметь хотя бы один вариант.' };
      return { ok: want === got, why: `Не совсем: верных вариантов ${t.right.length}, проверь ещё раз.` };
    }
    if (b.type === 'postman') {
      const p = window.HttpEngine.parse(input);
      if (p.error) return { soft: p.error };
      const r = window.HttpEngine.check(t, input);
      return { ok: r.ok, why: r.reason, last: r.res || null };
    }
    const j = judge();
    if (!j) return { soft: 'Хроники ещё загружаются — попробуй через секунду.' };
    if (!input.trim()) return { soft: 'Сначала напиши запрос.' };
    const ev = j.evaluate(roomOf(t, fight.at), input);
    const last = ev.error ? { error: ev.error } : { res: ev.display && ev.display.res, label: 'атака' };
    return { ok: !ev.error && ev.exact, why: ev.error ? 'Ошибка в запросе.' : (ev.notes && ev.notes[0]) || 'Результат не совпадает с заданием.', last };
  }

  function answer(input) {
    const b = battle();
    const f = fight;
    const t = f.tasks[f.at];
    if (input === undefined) input = f.draft;
    const p = Core.state;
    const r = check(b, t, input);
    if (r.soft) { f.note = r.soft; f.noteCls = 'hurt'; return renderArena(); }
    if (p.mana < ANSWER_MANA) {
      f.note = `Не хватает маны: ответ стоит ${ANSWER_MANA}, у тебя ${Math.floor(p.mana)}. Выпей зелье маны или подожди.`;
      f.noteCls = 'hurt';
      return renderArena();
    }
    p.mana -= ANSWER_MANA;
    if (r.last !== undefined) f.last = r.last;
    if (r.ok) {
      f.at++;
      f.draft = '';
      f.picked = [];
      f.last = b.type === 'postman' ? f.last : null;
      f.note = 'Точно в цель! Волна отбита.';
      f.noteCls = 'dmg';
      if (f.at >= f.tasks.length) return victory();
    } else {
      f.mistakes++;
      if (b.type === 'blitz') { const right = t.options[t.right]; t.options = shuffle(t.options); t.right = t.options.indexOf(right); }
      hurt(hitDmg(), `${r.why} ${b.enemy} бьют:`);
      if (p.hp === 0) return;
    }
    Core.save();
    render();
  }

  function hurt(dmg, why) {
    const p = Core.state;
    p.hp = Math.max(0, Math.min(p.hp, Core.maxHp()) - dmg);
    fight.wounds++;
    fight.note = `${why} −${dmg} HP.`;
    fight.noteCls = 'hurt';
    if (p.hp === 0) defeat();
  }

  function useItem(id) {
    if (!window.Shop.take(id)) return;
    const p = Core.state;
    const b = battle();
    const t = fight.tasks[fight.at];
    if (id === 'hp') { p.hp = Math.min(Core.maxHp(), p.hp + Math.round(Core.maxHp() * 0.5)); fight.note = 'Зелье жизни выпито.'; }
    else if (id === 'mana') { p.mana = Math.min(Core.maxMana(), p.mana + Math.round(Core.maxMana() * 0.6)); fight.note = 'Зелье маны выпито.'; }
    fight.noteCls = '';
    Core.save();
    if (!id.startsWith('scroll')) return renderArena();
    fight.hints++;
    renderArena();
    let body;
    if (id === 'scroll1') body = `<p>${esc(t.hint || 'Подсказки нет.')}</p>`;
    else if (b.type === 'sql') body = `<pre class="http-res">${esc(t.solution)}</pre>`;
    else if (b.type === 'postman') body = `<pre class="http-res">${esc(t.answer)}</pre>`;
    else if (b.type === 'blitz') body = `<p class="scroll-answer">Верный ответ: <b>${esc(t.options[t.right])}</b></p><p>${esc(t.why || '')}</p>`;
    else body = `<p class="scroll-answer">Верно: <b>${t.right.map((i) => esc(t.options[i])).join('; ')}</b></p><p>${esc(t.why || '')}</p>`;
    Core.modal(`<div class="scroll-view"><p class="eyebrow">Бой на паузе</p><h3>📜 ${id === 'scroll1' ? 'Малый свиток' : 'Великий свиток'}</h3>${body}
      <button class="btn attack" id="modal-close" type="button">OK — продолжить бой</button></div>`);
  }

  function victory() {
    const b = battle();
    const gold = goldOf(b) + (fight.wounds === 0 ? Math.round(goldOf(b) * 0.25) : 0);
    Core.state.gold += gold;
    S().wins = (S().wins || 0) + 1;
    stats().wins++;
    Core.track('siege-win', { id: b.id });
    const heal = Math.min(Math.round(Core.maxHp() * 0.35), Core.maxHp() - Core.state.hp);
    Core.state.hp += heal;
    const mistakes = fight.mistakes;
    fight = null;
    view = 'hub';
    Core.save();
    Core.renderHud();
    render();
    Core.modal(`<div class="big"><img class="siege-modal-icon" src="${b.icon}" alt=""></div><h3>Участок отбит!</h3>
      <ul class="loot"><li><span>Золото</span><span>+${gold}</span></li>${heal ? `<li><span>Передышка у стены</span><span>+${heal} HP</span></li>` : ''}<li><span>Ошибок</span><span>${mistakes}</span></li></ul>
      <p class="modal-tip">Маги вливают силу в шар — башня понемногу восстанавливается.</p>
      <button class="btn attack" id="modal-close" type="button">К боям</button>`);
  }

  function defeat() {
    const p = Core.state;
    const lost = Math.floor(p.gold * 0.25);
    p.gold -= lost;
    p.hp = Core.maxHp();
    p.mana = Core.maxMana();
    fight = null;
    view = 'hub';
    Core.save();
    Core.renderHud();
    render();
    Core.modal(`<div class="big">🪦</div><h3>Орки прорвались</h3>
      <ul class="loot"><li class="minus"><span>Потеряно золота</span><span>−${lost}</span></li><li><span>Здоровье и мана восстановлены</span><span>${p.hp} HP</span></li></ul>
      <button class="btn attack" id="modal-close" type="button">Снова на стены</button>`, { defeat: true });
  }

  // таймер осады, удары врагов, красный таймер в меню
  setInterval(() => {
    if (!Core.ready) return;
    const s = S();
    if (s && s.until <= Date.now() && !Core.modalOpen()) return finish(false);
    renderLaunch();
    const c = screen.querySelector('[data-clock]');
    if (c) c.textContent = `⏳ ${clock(left())}`;
  }, 1000);
  setInterval(() => {
    if (Core.screen !== 'siege' || !fight || Core.modalOpen() || document.hidden || !$('auth-gate').hidden) return;
    Core.state.mana = Math.min(Core.maxMana(), (Core.state.mana || 0) + MANA_REGEN);
    hurt(tickDmg(), `${battle().enemy} атакуют:`);
    if (Core.state.hp > 0) renderArena();
  }, TICK_MS);

  $('siege-btn').addEventListener('click', launchClick);

  Core.registerMode('siege', {
    icon: '🔮',
    xpOf: () => 0,
    progressOf: () => ({ done: (S() && S().wins) || 0, available: 0 }),
    open: () => { if (!active()) return Core.go('home'); render(); },
    refresh: () => { if (!screen.querySelector('[data-editor]:focus')) render(); },
  });

  window.Siege = {
    active,
    blocks: (screen) => active() && !ALLOWED.includes(screen),
    renderLaunch,
    _fight: () => fight, // для автотестов
  };
  renderLaunch();
})();
