// Режим «Блиц»: те же 90 монстров Подземелья (3 акта по 30), но вместо SQL — вопросы по теории.
// У монстра 3 вопроса с 4 вариантами; чтобы победить, нужно ответить верно на все три.
// Каждый ответ тратит ману (против угадывания), ошибка — удар по игроку; монстр и так бьёт каждые 10 секунд.
// Вопросы — в blitz-questions/act1..3.js (по 3 на монстра). Свиток ставит бой на паузу и открывается на весь экран.
(function () {
  'use strict';

  const Core = window.Core;
  const D = window.DUNGEON;
  const T = window.THEORY;
  const P = window.Progression;
  const esc = Core.esc;
  const ANSWER_MANA = 12;
  const TICK_MS = 10000;
  const MANA_REGEN = 4;
  const starStr = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const shuffle = (a) => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

  function S() {
    const st = Core.state;
    if (!st.blitz || !st.blitz.rooms) st.blitz = { rooms: {}, current: D.rooms[0].id, extraXp: 0 };
    D.rooms.forEach((r, i) => { if (!st.blitz.rooms[r.id]) st.blitz.rooms[r.id] = { unlocked: i === 0, cleared: false, stars: 0, wins: 0 }; });
    return st.blitz;
  }
  const room = () => D.rooms.find((r) => r.id === S().current) || D.rooms[0];
  const actOf = (r) => Math.floor(r.index / 30);
  const xpOf = (r) => P.levelXp('blitz', r.index);
  const goldOf = (r) => Math.round(r.gold * 0.6);
  const attackOf = (r) => window.Dungeon.attackFor(r);
  const tickOf = (r) => Math.max(1, Math.round(attackOf(r) * 0.4));

  // Вопрос j монстра r: из файла акта. Варианты перемешиваются при каждом показе.
  function question(r, j) {
    const src = ((window.BLITZ_Q || {})[actOf(r)] || [])[(r.index % 30) * 3 + j];
    if (!src) return { q: 'Вопросы для этого акта не загрузились.', options: ['—', '—', '—', '—'], right: 0, hint: '', why: '' };
    const options = shuffle(src.a);
    return { q: src.q, options, right: options.indexOf(src.a[0]), hint: src.hint, why: src.why, hidden: [], scrolls: [] };
  }
  const reshuffle = (q) => { const right = q.options[q.right]; q.options = shuffle(q.options); q.right = q.options.indexOf(right); };

  let fight = null;
  function newFight() {
    const r = room();
    fight = { id: r.id, qs: [0, 1, 2].map((j) => question(r, j)), at: 0, wounds: 0, mistakes: 0, scrolls: 0, note: '' };
  }
  const F = () => { if (!fight || fight.id !== room().id) newFight(); return fight; };

  const screen = document.querySelector('.screen[data-screen="blitz"]');
  let viewAct = null;

  function render() {
    const r = room();
    const st = S();
    const f = F();
    if (viewAct == null) viewAct = actOf(r);
    const portrait = window.Dungeon.portrait;
    const q = f.qs[f.at];
    screen.innerHTML = `
      <nav class="map" aria-label="Карта Блица">
        <div class="map-top">
          <div class="acts">${D.acts.map((a, i) => {
            const done = D.rooms.slice(a.from, a.to).filter((x) => st.rooms[x.id].cleared).length;
            return `<button type="button" class="act-tab${i === viewAct ? ' active' : ''}" data-act="${i}">${esc(a.name)} <small>${done}/30</small></button>`;
          }).join('')}</div>
          <span class="chip" title="Пройдено монстров">🚪 <b>${D.rooms.filter((x) => st.rooms[x.id].cleared).length} / ${D.rooms.length}</b></span>
          <button class="ghost-btn map-home" type="button" data-home>← К выбору режима</button>
        </div>
        <div class="tiles">${D.rooms.slice(D.acts[viewAct].from, D.acts[viewAct].to).map((x) => {
          const s = st.rooms[x.id];
          return `<button type="button" class="tile${x.id === r.id ? ' current' : ''}${s.cleared ? ' cleared' : ''}${s.unlocked ? '' : ' locked'}${x.boss ? ' boss' : ''}" data-room="${x.id}" ${s.unlocked ? '' : 'disabled'} title="${esc(x.monster)}">
            ${s.unlocked ? `<span class="tile-img" style="${portrait(x)}"></span>` : '<span class="tile-sprite">🔒</span>'}<span class="tile-num">${x.index + 1}</span><span class="tile-stars">${s.cleared ? starStr(s.stars) : '&nbsp;'}</span></button>`;
        }).join('')}</div>
      </nav>
      <div class="blitz-board">
        <section class="panel arena${r.boss ? ' boss' : ''}">
          <div class="monster portrait" style="${portrait(r)}"></div>
          <p class="monster-floor">Монстр ${r.index + 1} · ${esc(D.acts[actOf(r)].name)}</p>
          <h2 class="monster-name">${esc(r.monster)}${r.boss ? '<span class="boss-tag">БОСС</span>' : ''}</h2>
          <div class="monster-hp"><div class="blitz-pips">${f.qs.map((x, i) => `<i class="${i < f.at ? 'done' : i === f.at ? 'now' : ''}"></i>`).join('')}</div>
            <div class="monster-meta">Вопрос ${f.at + 1} из 3 · бьёт на ${tickOf(r)} каждые 10 с и на ${attackOf(r)} за ошибку · ответ стоит ${ANSWER_MANA} маны</div></div>
          <div class="player-bars">
            <div><span>❤ Ты <b>${Core.state.hp} / ${Core.maxHp()}</b></span><div class="bar hp"><i style="width:${Core.state.hp / Core.maxHp() * 100}%"></i></div></div>
            <div><span>💧 Мана <b>${Math.floor(Core.state.mana)} / ${Core.maxMana()}</b></span><div class="bar mana"><i style="width:${Core.state.mana / Core.maxMana() * 100}%"></i></div></div>
          </div>
          ${f.note ? `<p class="arena-line ${f.noteCls || ''}">${esc(f.note)}</p>` : ''}
          <div class="belt">${['hp', 'mana', 'scroll1', 'scroll2', 'scroll3'].map((id) => {
            const it = window.Shop.item(id);
            const tier = id.startsWith('scroll') ? +id.slice(-1) : 0;
            const off = !window.Shop.count(id) || (tier && q.scrolls.includes(tier));
            return `<button type="button" data-use="${id}" title="${esc(it.name)}: ${esc(SCROLL_TEXT[tier] || it.text)}" ${off ? 'disabled' : ''}>${it.icon}${tier ? `<span class="belt-tier">${'I'.repeat(tier)}</span>` : ''} <b>${window.Shop.count(id)}</b></button>`;
          }).join('')}<button type="button" class="belt-shop" data-shop>🧪 Лавка</button></div>
        </section>
        <section class="panel blitz-q">
          <p class="eyebrow">Вопрос ${f.at + 1} из 3</p>
          <p class="blitz-text">${esc(q.q)}</p>
          <div class="blitz-options">${q.options.map((o, i) => `<button type="button" class="blitz-opt${q.scrolls.includes(3) && i === q.right ? ' shown' : ''}" data-opt="${i}" ${q.hidden.includes(o) ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>
          <p class="blitz-reward">Добыча: 🪙 ${goldOf(r)} · ✦ ${xpOf(r)} XP${st.rooms[r.id].cleared ? ` · лучшее: ${starStr(st.rooms[r.id].stars)}` : ''}</p>
        </section>
      </div>`;
    screen.querySelector('[data-home]').addEventListener('click', () => Core.go('home'));
    screen.querySelector('[data-shop]').addEventListener('click', () => Core.go('shop'));
    screen.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => { viewAct = +b.dataset.act; render(); }));
    screen.querySelectorAll('[data-room]').forEach((b) => b.addEventListener('click', () => { S().current = b.dataset.room; viewAct = null; newFight(); Core.save(); render(); }));
    screen.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => answer(+b.dataset.opt)));
    screen.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => useItem(b.dataset.use)));
  }

  const SCROLL_TEXT = ['', 'подсказка к вопросу', 'подсказка и минус два неверных варианта', 'верный ответ и пояснение'];

  // Свиток: бой на паузе (пока открыто окно, монстр не бьёт), свиток — на весь экран, «OK» — продолжить.
  function readScroll(tier) {
    const f = F();
    const q = f.qs[f.at];
    if (q.scrolls.includes(tier) || !window.Shop.take('scroll' + tier)) return;
    q.scrolls.push(tier);
    f.scrolls++;
    if (tier === 2) {
      // «сгоревшие» варианты храним по тексту: после перемешивания они остаются выключенными
      const wrong = shuffle(q.options.filter((o, i) => i !== q.right && !q.hidden.includes(o)));
      q.hidden = q.hidden.concat(wrong.slice(0, 2));
    }
    Core.save();
    render();
    const title = ['', 'Малый свиток заклинания', 'Свиток заклинания', 'Великий свиток заклинания'][tier];
    const body = tier === 3
      ? `<p class="scroll-q">${esc(q.q)}</p><p class="scroll-answer">Верный ответ: <b>${esc(q.options[q.right])}</b></p><p>${esc(q.why)}</p>`
      : `<p class="scroll-q">${esc(q.q)}</p><p>${esc(q.hint)}</p>${tier === 2 ? '<p class="scroll-note">Два неверных варианта сгорели вместе со свитком.</p>' : ''}`;
    Core.modal(`<div class="scroll-view"><p class="eyebrow">Бой на паузе</p><h3>📜 ${title}</h3>${body}
      <button class="btn attack" id="modal-close" type="button">OK — продолжить бой</button></div>`);
  }

  function useItem(id) {
    if (id.startsWith('scroll')) return readScroll(+id.slice(-1));
    if (!window.Shop.take(id)) return;
    const p = Core.state;
    if (id === 'hp') p.hp = Math.min(Core.maxHp(), p.hp + Math.round(Core.maxHp() * 0.5));
    else p.mana = Math.min(Core.maxMana(), p.mana + Math.round(Core.maxMana() * 0.6));
    F().note = id === 'hp' ? 'Зелье жизни выпито.' : 'Зелье маны выпито.';
    F().noteCls = '';
    Core.save();
    render();
  }

  function hurt(dmg, why) {
    const p = Core.state;
    p.hp = Math.max(0, Math.min(p.hp, Core.maxHp()) - dmg);
    F().wounds++;
    F().note = `${why} −${dmg} HP.`;
    F().noteCls = 'hurt';
    if (p.hp === 0) defeat();
  }

  function answer(i) {
    const f = F();
    const r = room();
    const p = Core.state;
    if (p.mana < ANSWER_MANA) {
      f.note = `Не хватает маны: ответ стоит ${ANSWER_MANA}, у тебя ${Math.floor(p.mana)}. Выпей зелье маны или подожди.`;
      f.noteCls = 'hurt';
      return render();
    }
    p.mana -= ANSWER_MANA;
    const q = f.qs[f.at];
    if (i === q.right) {
      f.at++;
      f.note = 'Верно! Удар пришёлся точно в цель.';
      f.noteCls = 'dmg';
      Core.track('theory-card', { id: 'blitz:' + q.q });
      if (f.at >= 3) return victory();
    } else {
      f.mistakes++;
      // вопрос тот же, но варианты перемешиваются — тыкать по порядку не выйдет
      reshuffle(q);
      hurt(attackOf(r), `Неверно. ${r.monster} бьёт:`);
      if (p.hp === 0) return;
    }
    Core.save();
    render();
  }

  function victory() {
    const r = room();
    const st = S();
    const rs = st.rooms[r.id];
    const before = Core.rank();
    const stars = Math.max(1, 3 - fight.mistakes - fight.scrolls);
    const gold = goldOf(r) + (fight.wounds === 0 ? Math.round(goldOf(r) * 0.25) : 0);
    if (rs.cleared) st.extraXp = (st.extraXp || 0) + xpOf(r);
    rs.cleared = true;
    rs.wins = (rs.wins || 0) + 1;
    rs.stars = Math.max(rs.stars || 0, stars);
    Core.state.gold += gold;
    window.Dungeon.giveTrophy(r);
    const next = D.rooms[r.index + 1];
    if (next) st.rooms[next.id].unlocked = true;
    const up = Core.rankUp(before);
    // отдых у костра, как в SQL: после победы залечиваем часть ран (при новом ранге и так полное здоровье)
    let heal = 0;
    if (!up.rank) {
      heal = Math.min(Math.round(Core.maxHp() * 0.35), Core.maxHp() - Core.state.hp);
      Core.state.hp += heal;
    }
    newFight();
    Core.save();
    Core.renderHud();
    render();
    Core.modal(`
      <div class="big">${up.rank ? `<img class="modal-avatar" src="${Core.avatar(up.rank)}" alt="">` : `<div class="monster portrait win-portrait" style="${window.Dungeon.portrait(r)}"></div>`}</div>
      <h3>Победа!</h3>
      <div class="modal-stars">${starStr(stars)}</div>
      <ul class="loot"><li><span>Золото</span><span>+${gold}</span></li><li><span>Опыт</span><span>+${xpOf(r)} XP</span></li>${heal ? `<li><span>Отдых у костра</span><span>+${heal} HP</span></li>` : ''}${up.lines.join('')}</ul>
      <p class="act-open">🏆 Трофей: портрет монстра в коллекции на 10 минут</p>
      ${next ? `<button class="btn attack" id="modal-next" type="button">Дальше: ${esc(next.monster)}</button>` : ''}
      <button class="btn" id="modal-close" type="button">Сразиться снова</button>`, {
      onNext: () => { if (next) { S().current = next.id; viewAct = null; newFight(); Core.save(); render(); } },
    });
  }

  function defeat() {
    const p = Core.state;
    const lost = Math.floor(p.gold * 0.25);
    p.gold -= lost;
    p.hp = Core.maxHp();
    p.mana = Core.maxMana();
    newFight();
    Core.save();
    Core.renderHud();
    render();
    Core.modal(`<div class="big">🪦</div><h3>Ты пал</h3>
      <ul class="loot"><li class="minus"><span>Потеряно золота</span><span>−${lost}</span></li><li><span>Здоровье и мана восстановлены</span><span>${p.hp} HP</span></li></ul>
      <button class="btn attack" id="modal-close" type="button">Вернуться в бой</button>`, { defeat: true });
  }

  // монстр бьёт каждые 10 секунд, пока ты в Блице; мана понемногу копится
  setInterval(() => {
    if (Core.screen !== 'blitz' || Core.modalOpen() || document.hidden || !document.getElementById('auth-gate').hidden) return;
    const r = room();
    Core.state.mana = Math.min(Core.maxMana(), (Core.state.mana || 0) + MANA_REGEN);
    hurt(tickOf(r), `${r.monster} атакует:`);
    if (Core.state.hp > 0) render();
  }, TICK_MS);

  Core.registerMode('blitz', {
    icon: '⚡',
    xpOf: (state) => {
      const rooms = (state.blitz && state.blitz.rooms) || {};
      return D.rooms.reduce((sum, r) => sum + (rooms[r.id] && rooms[r.id].cleared ? xpOf(r) : 0), 0) + ((state.blitz && state.blitz.extraXp) || 0);
    },
    progressOf: (state) => {
      const rooms = (state.blitz && state.blitz.rooms) || {};
      return { done: D.rooms.filter((r) => rooms[r.id] && rooms[r.id].cleared).length, available: D.rooms.length };
    },
    open: () => { viewAct = null; render(); },
    refresh: () => render(),
  });
})();
