(function () {
  'use strict';

  const D = window.DUNGEON;
  D.finalize();
  // Во II и III актах — те же монстры и в том же порядке, что в I, только сильнее (сила растёт с номером зала).
  D.rooms.forEach((r) => {
    if (r.index < 30) return;
    const base = D.rooms[r.index % 30];
    r.monster = base.monster;
    r.sprite = base.sprite;
    r.taunts = base.taunts;
  });
  // Портрет монстра — клетка спрайтшита images/<1-10|11-20|21-30>/<акт>.jpeg: 5 по горизонтали, 2 по вертикали.
  function portrait(r) {
    const k = r.index % 30;
    const act = Math.floor(r.index / 30);
    const group = ['1-10', '11-20', '21-30'][Math.floor(k / 10)];
    const cell = k % 10;
    return `background-image:url('images/${group}/${act}.jpeg');background-position:${(cell % 5) * 25}% ${Math.floor(cell / 5) * 100}%`;
  }
  const Core = window.Core;
  const $ = (id) => document.getElementById(id);

  // ---------- состояние: часть общего состояния мага ----------

  function S() {
    const st = Core.state;
    if (!st.sql || !st.sql.rooms) st.sql = { rooms: {}, current: D.rooms[0].id };
    D.rooms.forEach((r, i) => {
      if (!st.sql.rooms[r.id]) st.sql.rooms[r.id] = { unlocked: i === 0, cleared: false, stars: 0, hints: 0, best: 0, wounds: 0 };
    });
    if (!st.sql.rooms[st.sql.current]) st.sql.current = D.rooms[0].id;
    return st.sql;
  }
  const save = () => Core.save();

  let judge = null;
  let viewAct = null;

  const room = () => D.rooms.find((r) => r.id === S().current);

  // Бой в зале: монстр после победы не умирает навсегда — каждый заход это новый бой с полным здоровьем монстра.
  const TICK_MS = 5000; // монстр бьёт каждые 5 секунд
  const MANA_REGEN = 2; // мана, восстанавливаемая за тот же промежуток
  let fight = { id: null, best: 0, wounds: 0, scrolls: [] };
  function F() {
    if (fight.id !== S().current) fight = { id: S().current, best: 0, wounds: 0, scrolls: [] };
    return fight;
  }
  const resetFight = () => { fight = { id: S().current, best: 0, wounds: 0, scrolls: [] }; };
  const progress = () => S().rooms[S().current];
  const maxHp = () => Core.maxHp();
  const attackOf = (r) => D.attackFor(r, maxHp());
  const tickOf = (r) => Math.max(1, Math.round(attackOf(r) * 0.4));
  const actOf = (r) => D.acts.findIndex((a) => r.index >= a.from && r.index < a.to);

  // ---------- рендер ----------

  function setBar(el, frac) { el.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%'; }
  const starStr = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function renderHud() {
    Core.renderHud();
    $('cleared-text').textContent = `${D.rooms.filter((r) => S().rooms[r.id].cleared).length} / ${D.rooms.length}`;
  }

  // Трофеи: портрет каждого побеждённого монстра; в каждом акте — новый портрет того же монстра.
  function openTrophies() {
    const rooms = S().rooms;
    const close = Core.modal(`<div class="trophies">
      <h3>Трофеи · ${D.rooms.filter((r) => rooms[r.id].cleared).length} / ${D.rooms.length}</h3>
      ${D.acts.map((a) => `<p class="eyebrow">${esc(a.name)}</p><div class="trophy-grid">${D.rooms.slice(a.from, a.to).map((r) => rooms[r.id].cleared
        ? `<button type="button" class="trophy" data-room="${r.index}" title="${esc(r.monster)}" style="${portrait(r)}"></button>`
        : `<span class="trophy locked" title="Ещё не побеждён">${r.index + 1}</span>`).join('')}</div>`).join('')}
      <button class="btn" id="modal-close" type="button">Закрыть</button></div>`);
    document.querySelectorAll('.trophy[data-room]').forEach((b) => b.addEventListener('click', () => {
      const r = D.rooms[+b.dataset.room];
      close();
      Core.modal(`<div class="trophy-big wide" style="${portrait(r)}"></div><h3>${esc(r.monster)}</h3><p class="modal-tip">${esc(r.floor)} · ${esc(D.acts[actOf(r)].name)}</p>
        <button class="btn" id="modal-close" type="button">Закрыть</button>`, { onClose: openTrophies });
    }));
  }

  function renderMap() {
    if (viewAct == null) viewAct = actOf(room());
    const acts = $('acts');
    acts.innerHTML = '';
    D.acts.forEach((a, i) => {
      const done = D.rooms.slice(a.from, a.to).filter((r) => S().rooms[r.id].cleared).length;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'act-tab' + (i === viewAct ? ' active' : '') + (S().rooms[D.rooms[a.from].id].unlocked ? '' : ' sealed');
      b.setAttribute('aria-pressed', i === viewAct ? 'true' : 'false');
      b.innerHTML = `<span class="act-name">${a.name}</span><span class="act-progress">${done} / ${a.to - a.from}</span>`;
      b.addEventListener('click', () => { viewAct = i; renderMap(); });
      acts.appendChild(b);
    });
    $('act-topic').textContent = D.acts[viewAct].topic;

    const tiles = $('tiles');
    tiles.innerHTML = '';
    D.rooms.slice(D.acts[viewAct].from, D.acts[viewAct].to).forEach((r) => {
      const st = S().rooms[r.id];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tile' + (r.id === S().current ? ' current' : '') + (st.cleared ? ' cleared' : '') + (st.unlocked ? '' : ' locked') + (r.boss ? ' boss' : '');
      b.disabled = !st.unlocked;
      b.title = st.unlocked ? `${r.floor}: ${r.monster} · ${r.topic}` : `${r.floor}: закрыт`;
      b.innerHTML = (st.unlocked ? `<span class="tile-img" style="${portrait(r)}"></span>` : '<span class="tile-sprite">🔒</span>') + `<span class="tile-num">${r.index + 1}</span>` +
        `<span class="tile-stars">${st.cleared ? starStr(st.stars) : r.boss ? 'босс' : '&nbsp;'}</span>`;
      b.addEventListener('click', () => switchRoom(r.id));
      tiles.appendChild(b);
    });
  }

  function monsterHp() {
    return Math.round(room().maxHp * (1 - F().best));
  }

  function renderArena() {
    const r = room();
    const st = progress();
    $('arena').classList.toggle('boss', !!r.boss);
    const sprite = $('monster-sprite');
    sprite.textContent = '';
    sprite.setAttribute('style', portrait(r));
    sprite.classList.add('portrait');
    sprite.classList.remove('dead');
    $('monster-floor').textContent = `${r.floor} · ${D.acts[actOf(r)].name}`;
    $('monster-name').innerHTML = esc(r.monster) + (r.boss ? '<span class="boss-tag">БОСС</span>' : '');
    const hp = monsterHp();
    setBar($('monster-bar'), hp / r.maxHp);
    $('monster-meta').textContent = `HP ${hp} / ${r.maxHp} · бьёт на ${tickOf(r)} каждые 5 с и на ${attackOf(r)} за промах` +
      (st.cleared ? ` · побеждён ${st.wins || 1} раз` : '');
    $('monster-intro').textContent = '';
  }

  // Звёзды — по самому сильному свитку, прочитанному в этом бою. Золото и опыт — полные: свитки уже куплены.
  function rewardFor(r) {
    const tier = F().scrolls.length ? Math.max(...F().scrolls) : 0;
    return { gold: r.gold, xp: r.xp, stars: 3 - tier };
  }

  function renderTask() {
    const r = room();
    const st = progress();
    $('task-text').innerHTML = r.task;
    $('task-spell').innerHTML = `Заклинание: <b>${esc(r.spell)}</b> · ${esc(r.topic)}`;
    const order = r.kind === 'query' ? (r.ordered ? ' · порядок строк проверяется' : ' · порядок строк не важен') : '';
    $('task-tables').innerHTML = 'Таблицы: ' + r.tables.map((t) => `<code>${t}</code>`).join(', ') + order;
    const rw = rewardFor(r);
    $('reward').innerHTML = `<span>Добыча:</span><span class="chip gold">🪙 <b>${rw.gold}</b></span><span class="chip">✦ ${rw.xp} XP</span>` +
      `<span class="stars">${starStr(rw.stars)}</span>` + (st.cleared ? `<span class="muted">лучшее: ${starStr(st.stars)}</span>` : '');
  }

  // Свитки, прочитанные в этом бою, и пояс с расходниками: зелья и три свитка, в любом порядке.
  const TIERS = ['', 'Малый свиток', 'Свиток', 'Великий свиток'];
  function renderHints() {
    const r = room();
    const box = $('hints');
    const read = F().scrolls.slice().sort();
    box.innerHTML = read.map((t) => `<div class="hint open"><span class="lvl">${'I'.repeat(t)}</span><span class="body">${r.hints[t - 1]}</span></div>`).join('') +
      (read.length ? '' : '<p class="muted belt-empty">Свитки заклинаний подсказывают решение: малый — направление, обычный — подробнее, великий — почти готовое заклинание.</p>');
    const items = window.Shop.ITEMS;
    box.insertAdjacentHTML('beforeend', `<div class="belt" aria-label="Пояс с расходниками">${items.map((it, i) => {
      const tier = it.id.startsWith('scroll') ? +it.id.slice(-1) : 0;
      const used = tier && F().scrolls.includes(tier);
      return `<button type="button" data-use="${it.id}" title="${it.name}: ${it.text}" ${window.Shop.count(it.id) && !used ? '' : 'disabled'}>
        ${it.icon}${tier ? `<span class="belt-tier">${'I'.repeat(tier)}</span>` : ''} <b>${window.Shop.count(it.id)}</b></button>`;
    }).join('')}<button type="button" class="belt-shop" data-go-shop>🧪 Лавка</button></div>`);
    box.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => useItem(b.dataset.use)));
    box.querySelector('[data-go-shop]').addEventListener('click', () => Core.go('shop'));
    $('hints-count').textContent = read.length ? `прочитано ${read.length} из 3` : '';
  }

  function useItem(id) {
    const r = room();
    const p = Core.state;
    const tier = id.startsWith('scroll') ? +id.slice(-1) : 0;
    if (tier && F().scrolls.includes(tier)) return;
    if (!window.Shop.take(id)) return;
    if (id === 'hp') {
      const heal = Math.min(Math.round(maxHp() * 0.5), maxHp() - p.hp);
      p.hp += heal;
      floater('+' + heal, 'heal');
      log('info', `Зелье жизни: +${heal} HP.`);
    } else if (id === 'mana') {
      const add = Math.min(Math.round(Core.maxMana() * 0.6), Core.maxMana() - p.mana);
      p.mana += add;
      log('info', `Зелье маны: +${add} маны.`);
    } else {
      F().scrolls.push(tier);
      log('info', `${TIERS[tier]} прочитан: ${r.monster} уже не так страшен.`);
    }
    save();
    renderHud();
    renderHints();
    renderTask();
    renderCost();
  }

  // Сколько маны стоит заклинание в книге — под пентаграммой.
  function renderCost() {
    const el = $('mana-cost');
    if (!el) return;
    const c = Spell.cost(currentSql());
    el.textContent = c.total ? `Заклинание: ${c.major} печат${c.major === 1 ? 'ь' : c.major < 5 && c.major > 1 ? 'и' : 'ей'} и ${c.minor} рун — ${c.total} маны` : 'Печати пентаграммы тратят ману: большие — 12, малые руны — 4';
    el.classList.toggle('short', c.total > Core.state.mana);
  }

  // Короткая строка о последнем событии боя прямо под монстром.
  // В пределах одной атаки сообщения дописываются: «ты нанёс урон» + «монстр ответил».
  let turnLogged = false;
  let inAttack = false;
  function log(t, m) {
    const line = $('arena-line');
    line.className = 'arena-line ' + t;
    line.textContent = turnLogged ? line.textContent + ' ' + m : m;
    turnLogged = inAttack;
  }

  function renderSchema() {
    const dg = D.diagram;
    const svg = $('schema');
    const W = 200, HEAD = 26, ROW = 20;
    const focus = new Set(room().tables);
    svg.setAttribute('viewBox', `0 0 ${dg.width} ${dg.height}`);
    const rowY = (t, col) => {
      const tb = dg.tables[t];
      const i = tb.cols.findIndex((c) => c[0] === col);
      return tb.y + HEAD + ROW * i + ROW / 2;
    };
    let out = '';
    // Связи рисуются ломаными по своим «коридорам» (lane), чтобы не пересекаться.
    const sideX = (t, side) => (side === 'left' ? dg.tables[t].x : dg.tables[t].x + W);
    const rounded = (pts) => {
      let d = `M${pts[0][0]} ${pts[0][1]}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const [px, py] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1];
        const r1 = Math.min(6, Math.hypot(x - px, y - py) / 2), r2 = Math.min(6, Math.hypot(nx - x, ny - y) / 2);
        const ux = Math.sign(x - px), uy = Math.sign(y - py), vx = Math.sign(nx - x), vy = Math.sign(ny - y);
        d += ` L${x - ux * r1} ${y - uy * r1} Q${x} ${y} ${x + vx * r2} ${y + vy * r2}`;
      }
      const [lx, ly] = pts[pts.length - 1];
      return d + ` L${lx} ${ly}`;
    };
    const pkDots = new Set();
    dg.links.forEach(({ from: [ft, fc, fs], to: [tt, tc, ts], lane }) => {
      const x1 = sideX(ft, fs), y1 = rowY(ft, fc);
      const x2 = sideX(tt, ts), y2 = rowY(tt, tc);
      const pts = y1 === y2 ? [[x1, y1], [x2, y2]] : [[x1, y1], [lane, y1], [lane, y2], [x2, y2]];
      out += `<path class="schema-link" d="${rounded(pts)}"/><circle class="schema-dot fk" cx="${x1}" cy="${y1}" r="3"/>`;
      const key = x2 + ':' + y2;
      if (!pkDots.has(key)) {
        pkDots.add(key);
        out += `<circle class="schema-dot" cx="${x2}" cy="${y2}" r="4"/>`;
      }
    });
    Object.entries(dg.tables).forEach(([name, tb]) => {
      const h = HEAD + ROW * tb.cols.length;
      let g = `<g class="schema-table${focus.has(name) ? ' focus' : ''}" data-table="${name}" tabindex="0" role="button" aria-label="Показать строки таблицы ${name}">`;
      g += `<rect class="frame" x="${tb.x}" y="${tb.y}" width="${W}" height="${h}" rx="5"/>`;
      g += `<path class="head" d="M${tb.x} ${tb.y + HEAD} V${tb.y + 5} Q${tb.x} ${tb.y} ${tb.x + 5} ${tb.y} H${tb.x + W - 5} Q${tb.x + W} ${tb.y} ${tb.x + W} ${tb.y + 5} V${tb.y + HEAD} Z"/>`;
      g += `<text class="title" x="${tb.x + 10}" y="${tb.y + 17}">${name}</text>`;
      tb.cols.forEach(([c, type, key], i) => {
        const y = tb.y + HEAD + ROW * i + 14;
        if (key) g += `<text class="key" x="${tb.x + 8}" y="${y}">${key.toUpperCase()}</text>`;
        g += `<text x="${tb.x + 30}" y="${y}">${c}</text><text class="type" x="${tb.x + W - 10}" y="${y}" text-anchor="end">${type}</text>`;
      });
      g += '</g>';
      out += g;
    });
    svg.innerHTML = out;
    svg.querySelectorAll('.schema-table').forEach((g) => {
      const show = () => peekTable(g.dataset.table);
      g.addEventListener('click', show);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } });
    });
  }

  function renderResult(res, opts) {
    opts = opts || {};
    const box = $('results');
    const meta = $('results-meta');
    box.innerHTML = '';
    if (opts.verdict) box.appendChild(opts.verdict);
    if (opts.error) {
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = opts.error;
      box.appendChild(p);
      meta.textContent = '';
      return;
    }
    if (opts.note) box.insertAdjacentHTML('beforeend', `<p class="empty">${esc(opts.note)}</p>`);
    if (!res || !res.columns.length) {
      if (!opts.note) box.insertAdjacentHTML('beforeend', '<p class="empty">Заклинание выполнено, но ничего не вернуло.</p>');
      meta.textContent = opts.label || '';
      return;
    }
    if (res.error) {
      box.insertAdjacentHTML('beforeend', `<p class="error">${esc(res.error)}</p>`);
      meta.textContent = '';
      return;
    }
    meta.textContent = (opts.label ? opts.label + ' · ' : '') + `${res.values.length} строк`;
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    res.columns.forEach((c) => { const th = document.createElement('th'); th.textContent = c; tr.appendChild(th); });
    thead.appendChild(tr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    res.values.slice(0, 200).forEach((row) => {
      const r = document.createElement('tr');
      row.forEach((v) => {
        const td = document.createElement('td');
        if (v === null) { td.className = 'null'; td.textContent = 'NULL'; } else td.textContent = v;
        r.appendChild(td);
      });
      tbody.appendChild(r);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);
  }

  function renderAll() {
    renderHud();
    renderMap();
    renderArena();
    renderTask();
    renderHints();
    renderSchema();
    renderCost();
  }

  // ---------- эффекты ----------

  function floater(text, cls) {
    const arena = $('arena');
    const f = document.createElement('span');
    f.className = 'floater ' + cls;
    f.textContent = text;
    f.style.left = (cls === 'dmg' ? 4 + Math.random() * 10 : 70 + Math.random() * 15) + '%';
    f.style.top = cls === 'dmg' ? '8%' : '30%';
    arena.appendChild(f);
    setTimeout(() => f.remove(), 1200);
  }

  function pulse(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // ---------- действия ----------

  const currentSql = () => $('sql').value;
  const modalOpen = () => Core.modalOpen();

  function scout() {
    if (!judge) return;
    if (!currentSql().trim()) {
      renderResult(null, { note: 'Книга пуста. Напиши заклинание и нажми «Разведать», или нажми на таблицу в схеме, чтобы прочесть её строки.' });
      return;
    }
    const s = judge.scout(room(), currentSql());
    if (s.error) return renderResult(null, { error: s.error });
    const notes = [];
    if (s.txLost) notes.push('Транзакция не была зафиксирована: без COMMIT её изменения отменены.');
    if (s.changes) notes.push(`Изменено строк: ${s.changes}. В разведке Хроники восстанавливаются после каждого заклинания.`);
    renderResult(s.res, { label: s.label, note: notes.join(' ') || null });
  }

  function peekTable(name) {
    if (!judge) return;
    renderResult(judge.table(room(), name), { label: `таблица ${name}` });
  }

  function hurtPlayer(dmg, why) {
    const p = Core.state;
    p.hp = Math.max(0, Math.min(p.hp, maxHp()) - dmg);
    F().wounds++;
    floater('−' + dmg, 'hurt');
    pulse($('arena'), 'flash');
    log('hurt', `${why} −${dmg} HP.`);
    if (p.hp === 0) defeat();
  }

  function attack() {
    if (!judge || modalOpen()) return;
    inAttack = true;
    turnLogged = false;
    try { attackTurn(); } finally { inAttack = false; turnLogged = false; }
  }

  function verdictEl(ev) {
    const v = document.createElement('div');
    v.className = 'verdict ' + (ev.exact ? 'ok' : 'bad');
    const notes = ev.notes.length ? `<ul>${ev.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
    const plan = ev.planText != null ? `<div class="plan"><span>План запроса:</span><pre>${esc(ev.planText)}</pre></div>` : '';
    v.innerHTML = (ev.exact
      ? '<b>Точное попадание. Заклинание сработало как надо.</b>'
      : `<b>Удар не смертельный. Заклинание близко к цели на ${Math.round(ev.sim * 100)}%.</b>`) + notes + plan;
    return v;
  }

  function attackTurn() {
    const r = room();
    const st = progress();
    const sql = currentSql().trim();
    if (!sql) return;

    const cost = Spell.cost(sql).total;
    if (Core.state.mana < cost) {
      log('hurt', `Не хватает маны: заклинание стоит ${cost}, у тебя ${Math.floor(Core.state.mana)}. Выпей зелье маны или подожди — мана понемногу восстанавливается.`);
      renderCost();
      return;
    }
    Core.state.mana -= cost;
    const ev = judge.evaluate(r, sql);
    if (ev.error) {
      renderResult(null, { error: ev.error });
      Spell.fizzle();
      hurtPlayer(Math.ceil(attackOf(r) / 2), `Заклинание рассеялось (ошибка SQL). ${r.monster} пользуется моментом:`);
      return finishTurn();
    }

    if (ev.exact) Spell.cast(); else Spell.fizzle();
    const d = ev.display || {};
    const extra = d.changes ? `Изменено строк: ${d.changes}.` : null;
    renderResult(d.res, { verdict: verdictEl(ev), label: d.label, note: d.res ? null : extra });

    const f = F();
    if (ev.sim > f.best) {
      const dmg = Math.round(r.maxHp * (ev.sim - f.best));
      f.best = ev.sim;
      floater('−' + dmg, 'dmg');
      pulse($('monster-sprite'), 'hit');
      log('dmg', `Ты наносишь ${dmg} урона.` + (ev.exact ? '' : ' ' + r.taunts[Math.floor(Math.random() * r.taunts.length)]));
    } else if (!ev.exact) {
      log('info', 'Удар соскользнул: это заклинание не ближе к цели, чем прошлое.');
    }

    if (ev.exact) return victory();
    hurtPlayer(attackOf(r), `${r.monster} контратакует:`);
    finishTurn();
  }

  function finishTurn() {
    save();
    renderHud();
    renderArena();
    renderCost();
  }

  function victory() {
    const r = room();
    const st = progress();
    const p = Core.state;
    const rw = rewardFor(r);
    const wounds = F().wounds;
    const bonus = wounds === 0 ? Math.round(rw.gold * 0.25) : 0;
    const before = Core.rank();

    // первая победа засчитывается как пройденный зал, повторные — добавляют тот же опыт сверху
    const firstWin = !st.cleared;
    if (st.cleared) S().extraXp = (S().extraXp || 0) + rw.xp;
    st.cleared = true;
    st.wins = (st.wins || 0) + 1;
    st.best = 1;
    Core.track('sql-room', { id: r.id });
    st.stars = Math.max(st.stars || 0, rw.stars);
    p.gold += rw.gold + bonus;
    resetFight();
    const up = Core.rankUp(before);
    let heal = 0;
    if (!up.rank) {
      heal = Math.min(Math.round(maxHp() * 0.35), maxHp() - p.hp);
      p.hp += heal;
    }
    const next = D.rooms[r.index + 1];
    if (next) S().rooms[next.id].unlocked = true;

    log('win', `Победа в зале ${r.index + 1}! +${rw.gold + bonus} золота, +${rw.xp} XP.`);
    if (up.rank) log('win', `Ты достиг звания: ${up.rank.name}.`);
    viewAct = null;
    save();
    renderAll();

    const items = [
      `<li><span>Золото</span><span>+${rw.gold}</span></li>`,
      bonus ? `<li><span>Без единой царапины</span><span>+${bonus}</span></li>` : `<li class="minus"><span>Получено ран</span><span>${wounds}</span></li>`,
      `<li><span>Опыт</span><span>+${rw.xp} XP</span></li>`,
      heal ? `<li><span>Отдых у костра</span><span>+${heal} HP</span></li>` : '',
    ].concat(up.lines).join('');
    const finale = !next
      ? '<p>Дракон пал. Подземелье запросов зачищено.</p>'
      : '';
    const nextAct = next && actOf(next) !== actOf(r) ? `<p class="act-open">Открыт ${esc(D.acts[actOf(next)].name)}</p>` : '';
    Core.modal(`
      <div class="big">${up.rank ? `<img class="modal-avatar" src="${Core.avatar(up.rank)}" alt="">` : `<div class="trophy-big" style="${portrait(r)}"></div>`}</div>
      ${firstWin ? '<p class="act-open">🏆 Новый трофей: портрет монстра в коллекции</p>' : ''}
      <h3>Победа!</h3>
      <p class="modal-tip">${esc(r.monster)} повержен. Он вернётся, если захочешь сразиться снова — за ту же добычу.</p>
      <div class="modal-stars">${starStr(rw.stars)}</div>
      <ul class="loot">${items}</ul>
      ${finale}${nextAct}
      ${next ? `<button class="btn attack" id="modal-next" type="button">Дальше: ${esc(next.monster)}</button>` : ''}
      <button class="btn" id="modal-close" type="button">Сразиться снова</button>
    `, { onNext: () => next && switchRoom(next.id), onClose: () => { renderAll(); $('sql').focus(); } });
  }

  function defeat() {
    const r = room();
    const st = progress();
    const p = Core.state;
    const lost = Math.floor(p.gold * 0.25);
    p.gold -= lost;
    p.hp = maxHp();
    p.mana = Core.maxMana();
    resetFight();
    log('hurt', `Ты пал в бою. ${r.monster} восстановил силы. Потеряно ${lost} золота.`);
    save();
    renderAll();
    Core.modal(`
      <div class="big">🪦</div>
      <h3>Ты пал</h3>
      <p>${esc(r.monster)} оказался сильнее. Ты приходишь в себя в лагере у входа.</p>
      <ul class="loot">
        <li class="minus"><span>Потеряно золота</span><span>−${lost}</span></li>
        <li><span>Здоровье и мана восстановлены</span><span>${p.hp} HP</span></li>
      </ul>
      <p class="modal-tip">Совет: «Разведать» бесплатно. Проверь заклинание перед атакой.</p>
      <button class="btn attack" id="modal-close" type="button">Вернуться в бой</button>
    `, { defeat: true, onClose: () => $('sql').focus() });
  }

  function switchRoom(id) {
    if (!S().rooms[id] || !S().rooms[id].unlocked) return;
    S().current = id;
    resetFight();
    viewAct = null;
    const r = room();
    $('sql').value = '';
    Spell.update('');
    log('info', `Ты входишь: ${r.floor}. Перед тобой ${r.monster}.`);
    save();
    renderAll();
    scout();
  }

  // ---------- запуск ----------

  function bind() {
    $('run-btn').addEventListener('click', scout);
    $('trophies-btn').addEventListener('click', openTrophies);
    // высота шапки — чтобы экран боя ровно занял окно без прокрутки
    const hudH = () => document.documentElement.style.setProperty('--hud-h', document.querySelector('.hud').getBoundingClientRect().bottom + 'px');
    window.addEventListener('resize', hudH);
    hudH();
    $('attack-btn').addEventListener('click', attack);
    const ta = $('sql');
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) attack(); else scout();
      } else if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const s = ta.selectionStart;
        ta.setRangeText('  ', s, ta.selectionEnd, 'end');
      }
    });
    ta.addEventListener('input', () => { Spell.update(ta.value); renderCost(); });

    // Монстр не ждёт: каждые 5 секунд бьёт, пока ты в зале. Мана тем временем понемногу копится.
    setInterval(() => {
      if (Core.screen !== 'sql' || !judge || modalOpen() || document.hidden || !$('auth-gate').hidden) return;
      const p = Core.state;
      p.mana = Math.min(Core.maxMana(), (p.mana || 0) + MANA_REGEN);
      const r = room();
      hurtPlayer(tickOf(r), `${r.monster} атакует:`);
      // в облако это не пишем каждые 5 секунд — здоровье уйдёт с ближайшим действием
      renderHud();
      renderCost();
    }, TICK_MS);
  }

  let opened = false;
  function open() {
    if (!opened) {
      opened = true;
      $('sql').value = '';
      Spell.mount($('pentagram'));
      Spell.update('');
      const r = room();
      log('info', `Ты стоишь в зале ${r.index + 1}. Перед тобой ${r.monster}.`);
    }
    viewAct = null;
    renderAll();
    if (judge) scout();
  }

  async function init() {
    bind();
    try {
      const SQL = await window.initSqlJs();
      judge = window.Judge.create(SQL, D);
      const db = new SQL.Database();
      db.run(D.schemaSql);
      Spell.init($('pentagram'), new SQL.Database(db.export()));
      db.close();
      Spell.update($('sql').value);
      $('run-btn').disabled = false;
      $('attack-btn').disabled = false;
      if (Core.screen === 'sql') scout();
    } catch (e) {
      renderResult(null, { error: 'Не удалось загрузить SQLite: ' + e.message });
    }
  }

  Core.registerMode('sql', {
    icon: '🐉',
    xpOf: (state) => {
      const rooms = (state.sql && state.sql.rooms) || {};
      return D.rooms.reduce((sum, r) => sum + (rooms[r.id] && rooms[r.id].cleared ? r.xp : 0), 0) + ((state.sql && state.sql.extraXp) || 0);
    },
    progressOf: (state) => {
      const rooms = (state.sql && state.sql.rooms) || {};
      return { done: D.rooms.filter((r) => rooms[r.id] && rooms[r.id].cleared).length, available: D.rooms.length };
    },
    open,
    refresh: () => { viewAct = null; renderAll(); },
  });

  init();
})();
