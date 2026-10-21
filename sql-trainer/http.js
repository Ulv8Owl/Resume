// Режим «HTTP»: те же 90 монстров Подземелья (3 акта по 30), но удар — это API-запрос.
// У каждого монстра одно задание: написать запрос к «Хроникам API» (sims/api-mock.js). Сервер отвечает по-настоящему,
// а движок (http-engine.js) сверяет запрос с эталоном. Отправка тратит ману, неверный запрос — удар по игроку,
// монстр и так бьёт каждые 10 секунд. Задания — в http-tasks/act1..3.js. Свиток ставит бой на паузу.
(function () {
  'use strict';

  const Core = window.Core;
  const D = window.DUNGEON;
  const P = window.Progression;
  const E = window.HttpEngine;
  const esc = Core.esc;
  const SEND_MANA = 12;
  const TICK_MS = 10000;
  const MANA_REGEN = 4;
  const starStr = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

  function S() {
    const st = Core.state;
    if (!st.http || !st.http.rooms) st.http = { rooms: {}, current: D.rooms[0].id, extraXp: 0 };
    D.rooms.forEach((r, i) => { if (!st.http.rooms[r.id]) st.http.rooms[r.id] = { unlocked: i === 0, cleared: false, stars: 0, wins: 0 }; });
    return st.http;
  }
  const room = () => D.rooms.find((r) => r.id === S().current) || D.rooms[0];
  const actOf = (r) => Math.floor(r.index / 30);
  const xpOf = (r) => P.levelXp('http', r.index);
  const goldOf = (r) => Math.round(r.gold * 0.6);
  const attackOf = (r) => window.Dungeon.attackFor(r);
  const tickOf = (r) => Math.max(1, Math.round(attackOf(r) * 0.4));
  const taskOf = (r) => ((window.HTTP_TASKS || {})[actOf(r)] || [])[r.index % 30] ||
    { q: 'Задания для этого акта не загрузились.', answer: 'GET /heroes', hint: '' };

  let fight = null;
  function newFight() {
    const r = room();
    fight = { id: r.id, task: taskOf(r), draft: '', scrolls: [], wounds: 0, mistakes: 0, note: '', noteCls: '', last: null };
  }
  const F = () => { if (!fight || fight.id !== room().id) newFight(); return fight; };

  const screen = document.querySelector('.screen[data-screen="http"]');
  let viewAct = null;

  const SHOWN_HEADERS = ['location', 'x-total-count', 'content-language', 'www-authenticate'];
  function responseHtml(res) {
    if (!res) return '<p class="http-empty">Ответ сервера появится здесь после отправки.</p>';
    if (res.networkError) return `<pre class="http-res bad">Ошибка сети: ${esc(res.networkError)}</pre>`;
    const head = SHOWN_HEADERS.filter((h) => res.headers[h]).map((h) => `${h}: ${res.headers[h]}`).join('\n');
    const cls = res.status < 300 ? 'ok' : 'bad';
    return `<pre class="http-res"><b class="${cls}">HTTP/1.1 ${res.status} ${esc(res.statusText)}</b>${head ? '\n' + esc(head) : ''}${res.body ? '\n\n' + esc(res.body) : ''}</pre>`;
  }

  window.HttpView = responseHtml; // тем же видом ответ сервера показывает Осада

  function arenaHtml() {
    const r = room();
    const f = F();
    const portrait = window.Dungeon.portrait;
    return `
      <div class="monster portrait" style="${portrait(r)}"></div>
      <p class="monster-floor">Монстр ${r.index + 1} · ${esc(D.acts[actOf(r)].name)}</p>
      <h2 class="monster-name">${esc(r.monster)}${r.boss ? '<span class="boss-tag">БОСС</span>' : ''}</h2>
      <div class="monster-meta">Бьёт на ${tickOf(r)} каждые 10 с и на ${attackOf(r)} за неверный запрос · отправка стоит ${SEND_MANA} маны</div>
      <div class="player-bars">
        <div><span>❤ Ты <b>${Core.state.hp} / ${Core.maxHp()}</b></span><div class="bar hp"><i style="width:${Core.state.hp / Core.maxHp() * 100}%"></i></div></div>
        <div><span>💧 Мана <b>${Math.floor(Core.state.mana)} / ${Core.maxMana()}</b></span><div class="bar mana"><i style="width:${Core.state.mana / Core.maxMana() * 100}%"></i></div></div>
      </div>
      ${f.note ? `<p class="arena-line ${f.noteCls || ''}">${esc(f.note)}</p>` : ''}
      <div class="belt">${['hp', 'mana', 'scroll1', 'scroll2', 'scroll3'].map((id) => {
        const it = window.Shop.item(id);
        const tier = id.startsWith('scroll') ? +id.slice(-1) : 0;
        const off = !window.Shop.count(id) || (tier && f.scrolls.includes(tier));
        return `<button type="button" data-use="${id}" title="${esc(it.name)}: ${esc(SCROLL_TEXT[tier] || it.text)}" ${off ? 'disabled' : ''}>${it.icon}${tier ? `<span class="belt-tier">${'I'.repeat(tier)}</span>` : ''} <b>${window.Shop.count(id)}</b></button>`;
      }).join('')}<button type="button" class="belt-shop" data-shop>🧪 Лавка</button></div>`;
  }

  // Обновляет только карточку монстра: удар монстра по таймеру не сбивает набранный запрос и курсор.
  function renderArena() {
    const box = screen.querySelector('.arena');
    if (!box) return render();
    box.innerHTML = arenaHtml();
    bindArena();
  }
  function bindArena() {
    screen.querySelector('[data-shop]').addEventListener('click', () => Core.go('shop'));
    screen.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => useItem(b.dataset.use)));
  }

  const API_REF = `<details class="http-ref"><summary>Справочник API</summary>
    <p>База: <code>${E.ORIGIN}/v1</code> — в запросе достаточно пути: <code>GET /heroes</code>. Есть и <code>/v2</code>.</p>
    <ul>
      <li><code>POST /auth/login</code> {"login","password"} → токен. mage / chronicles — тестировщик, scribe / quill — читатель.</li>
      <li><code>Authorization: Bearer tok_7f3a9c21</code> — тестировщик; <code>Bearer tok_reader_51b2</code> — только чтение.</li>
      <li><code>/heroes</code> (?class, ?limit), <code>/heroes/{id}</code>, <code>/me</code></li>
      <li><code>/items</code> (?rarity, ?min_price, ?sort=id|name|price, ?order=asc|desc, ?limit, ?offset), <code>/items/{id}</code></li>
      <li><code>/guilds</code>, <code>/guilds/{id}</code>, <code>/guilds/{id}/heroes</code></li>
      <li><code>/quests</code> — заголовок <code>X-Realm</code>: north|south|east|west, ?status=open|done, <code>Accept-Language</code></li>
      <li><code>/stats</code> — заголовок <code>X-API-Key: key_guild_9d4e</code></li>
    </ul>
    <p>Формат: первая строка — метод и путь, дальше заголовки «Имя: значение», пустая строка, тело (JSON).</p></details>`;

  function render() {
    const r = room();
    const st = S();
    const f = F();
    if (viewAct == null) viewAct = actOf(r);
    const portrait = window.Dungeon.portrait;
    screen.innerHTML = `
      <nav class="map" aria-label="Карта режима HTTP">
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
        <section class="panel arena${r.boss ? ' boss' : ''}">${arenaHtml()}</section>
        <section class="panel http-panel">
          <p class="eyebrow">Задание</p>
          <p class="blitz-text">${esc(f.task.q)}</p>
          <textarea class="http-editor" spellcheck="false" autocomplete="off" aria-label="HTTP-запрос"
            placeholder="GET /heroes&#10;Authorization: Bearer tok_7f3a9c21&#10;&#10;{ тело запроса, если нужно }">${esc(f.draft)}</textarea>
          <div class="http-actions">
            <button class="btn attack" type="button" data-send>➤ Отправить</button>
            <span class="http-keys"><kbd>Ctrl</kbd>+<kbd>Enter</kbd></span>
            <span class="blitz-reward">Добыча: 🪙 ${goldOf(r)} · ✦ ${xpOf(r)} XP${st.rooms[r.id].cleared ? ` · лучшее: ${starStr(st.rooms[r.id].stars)}` : ''}</span>
          </div>
          ${API_REF}
          <p class="eyebrow">Ответ сервера</p>
          ${responseHtml(f.last)}
        </section>
      </div>`;
    screen.querySelector('[data-home]').addEventListener('click', () => Core.go('home'));
    screen.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => { viewAct = +b.dataset.act; render(); }));
    screen.querySelectorAll('[data-room]').forEach((b) => b.addEventListener('click', () => { S().current = b.dataset.room; viewAct = null; newFight(); Core.save(); render(); }));
    const ed = screen.querySelector('.http-editor');
    ed.addEventListener('input', () => { F().draft = ed.value; });
    ed.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
    screen.querySelector('[data-send]').addEventListener('click', send);
    bindArena();
  }

  const SCROLL_TEXT = ['', 'подсказка к заданию', 'подсказка и первая строка запроса', 'готовый запрос целиком'];

  // Свиток: бой на паузе (пока открыто окно, монстр не бьёт), свиток — на весь экран, «OK» — продолжить.
  function readScroll(tier) {
    const f = F();
    if (f.scrolls.includes(tier) || !window.Shop.take('scroll' + tier)) return;
    f.scrolls.push(tier);
    Core.save();
    renderArena();
    const title = ['', 'Малый свиток заклинания', 'Свиток заклинания', 'Великий свиток заклинания'][tier];
    const t = f.task;
    const body = tier === 3
      ? `<p class="scroll-q">${esc(t.q)}</p><p class="scroll-answer">Готовый запрос:</p><pre class="http-res">${esc(t.answer)}</pre>`
      : `<p class="scroll-q">${esc(t.q)}</p><p>${esc(t.hint)}</p>${tier === 2 ? `<p class="scroll-answer">Первая строка: <b>${esc(t.answer.split('\n')[0])}</b></p>` : ''}`;
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
    renderArena();
  }

  function hurt(dmg, why) {
    const p = Core.state;
    p.hp = Math.max(0, Math.min(p.hp, Core.maxHp()) - dmg);
    F().wounds++;
    F().note = `${why} −${dmg} HP.`;
    F().noteCls = 'hurt';
    if (p.hp === 0) defeat();
  }

  function send() {
    const f = F();
    const r = room();
    const p = Core.state;
    const ed = screen.querySelector('.http-editor');
    if (ed) f.draft = ed.value;
    const parsed = E.parse(f.draft);
    // запрос, который даже не разобрать, — подсказка без урона и без траты маны
    if (parsed.error) {
      f.note = parsed.error;
      f.noteCls = 'hurt';
      return renderArena();
    }
    if (p.mana < SEND_MANA) {
      f.note = `Не хватает маны: запрос стоит ${SEND_MANA}, у тебя ${Math.floor(p.mana)}. Выпей зелье маны или подожди.`;
      f.noteCls = 'hurt';
      return renderArena();
    }
    p.mana -= SEND_MANA;
    const result = E.check(f.task, f.draft);
    f.last = result.res || null;
    if (result.ok) {
      Core.track('http-sent', { text: f.draft, status: result.res && result.res.status });
      Core.track('http-task', { id: r.id });
      return victory();
    }
    f.mistakes++;
    hurt(attackOf(r), `${result.reason} ${r.monster} бьёт:`);
    if (p.hp === 0) return;
    Core.save();
    render();
  }

  function victory() {
    const r = room();
    const st = S();
    const rs = st.rooms[r.id];
    const before = Core.rank();
    const stars = Math.max(1, 3 - fight.mistakes - fight.scrolls.length);
    const gold = goldOf(r) + (fight.wounds === 0 ? Math.round(goldOf(r) * 0.25) : 0);
    const res = fight.last;
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
    fight.last = res; // ответ сервера остаётся на экране — его полезно рассмотреть
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

  // монстр бьёт каждые 10 секунд, пока ты в режиме; мана понемногу копится
  setInterval(() => {
    if (Core.screen !== 'http' || Core.modalOpen() || document.hidden || !document.getElementById('auth-gate').hidden) return;
    const r = room();
    Core.state.mana = Math.min(Core.maxMana(), (Core.state.mana || 0) + MANA_REGEN);
    hurt(tickOf(r), `${r.monster} атакует:`);
    if (Core.state.hp > 0) renderArena();
  }, TICK_MS);

  Core.registerMode('http', {
    icon: '📨',
    xpOf: (state) => {
      const rooms = (state.http && state.http.rooms) || {};
      return D.rooms.reduce((sum, r) => sum + (rooms[r.id] && rooms[r.id].cleared ? xpOf(r) : 0), 0) + ((state.http && state.http.extraXp) || 0);
    },
    progressOf: (state) => {
      const rooms = (state.http && state.http.rooms) || {};
      return { done: D.rooms.filter((r) => rooms[r.id] && rooms[r.id].cleared).length, available: D.rooms.length };
    },
    open: () => { viewAct = null; render(); },
    refresh: () => render(),
  });
})();
