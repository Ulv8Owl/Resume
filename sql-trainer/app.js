(function () {
  'use strict';

  const D = window.DUNGEON;
  D.finalize();
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
  const progress = () => S().rooms[S().current];
  const maxHp = () => Core.maxHp();
  const attackOf = (r) => D.attackFor(r, maxHp());
  const actOf = (r) => D.acts.findIndex((a) => r.index >= a.from && r.index < a.to);

  // ---------- рендер ----------

  function setBar(el, frac) { el.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%'; }
  const starStr = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function renderHud() {
    Core.renderHud();
    $('cleared-text').textContent = `${D.rooms.filter((r) => S().rooms[r.id].cleared).length} / ${D.rooms.length}`;
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
      b.innerHTML = `<span class="tile-sprite">${st.unlocked ? r.sprite : '🔒'}</span><span class="tile-num">${r.index + 1}</span>` +
        `<span class="tile-stars">${st.cleared ? starStr(st.stars) : r.boss ? 'босс' : '&nbsp;'}</span>`;
      b.addEventListener('click', () => switchRoom(r.id));
      tiles.appendChild(b);
    });
  }

  function monsterHp() {
    const r = room();
    const st = progress();
    return st.cleared ? 0 : Math.round(r.maxHp * (1 - st.best));
  }

  function renderArena() {
    const r = room();
    const st = progress();
    $('arena').classList.toggle('boss', !!r.boss);
    const sprite = $('monster-sprite');
    sprite.textContent = r.sprite;
    sprite.classList.toggle('dead', st.cleared);
    $('monster-floor').textContent = `${r.floor} · ${D.acts[actOf(r)].name}`;
    $('monster-name').innerHTML = esc(r.monster) + (r.boss ? '<span class="boss-tag">БОСС</span>' : '');
    const hp = monsterHp();
    setBar($('monster-bar'), hp / r.maxHp);
    $('monster-meta').textContent = st.cleared
      ? 'Повержен. Можно потренироваться ещё раз, но без добычи.'
      : `HP ${hp} / ${r.maxHp} · бьёт на ${attackOf(r)} за промах`;
    $('monster-intro').textContent = r.intro;
  }

  function rewardFor(r, st) {
    const mult = D.hintMultipliers[st.hints];
    return { gold: Math.round(r.gold * mult), xp: r.xp, stars: 3 - st.hints, mult };
  }

  function renderTask() {
    const r = room();
    const st = progress();
    $('task-text').innerHTML = r.task;
    $('task-spell').innerHTML = `Заклинание: <b>${esc(r.spell)}</b> · ${esc(r.topic)}`;
    const order = r.kind === 'query' ? (r.ordered ? ' · порядок строк проверяется' : ' · порядок строк не важен') : '';
    $('task-tables').innerHTML = 'Таблицы: ' + r.tables.map((t) => `<code>${t}</code>`).join(', ') + order;
    const rw = rewardFor(r, st);
    $('reward').innerHTML = st.cleared
      ? `<span class="stars">${starStr(st.stars)}</span><span class="muted">Зал зачищен</span>`
      : `<span>Добыча:</span><span class="chip gold">🪙 <b>${rw.gold}</b></span><span class="chip">✦ ${rw.xp} XP</span><span class="stars">${starStr(rw.stars)}</span>` +
        (rw.mult < 1 ? `<span class="muted">подсказки срезали золото до ${Math.round(rw.mult * 100)}%</span>` : '');
  }

  function renderHints() {
    const r = room();
    const st = progress();
    const box = $('hints');
    box.innerHTML = '';
    r.hints.slice(0, st.hints).forEach((text, i) => {
      const d = document.createElement('div');
      d.className = 'hint open';
      d.innerHTML = `<span class="lvl">${'I'.repeat(i + 1)}</span><span class="body">${text}</span>`;
      box.appendChild(d);
    });
    if (st.hints < r.hints.length) {
      const i = st.hints;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hint';
      const cost = st.cleared ? 'бесплатно' : `золото → ${Math.round(D.hintMultipliers[i + 1] * 100)}%`;
      b.innerHTML = `<span class="lvl">${'I'.repeat(i + 1)}</span><span>Сломать печать свитка</span><span class="cost">${cost}</span>`;
      b.addEventListener('click', () => openHint(i));
      box.appendChild(b);
    }
    $('hints-count').textContent = `открыто ${st.hints} из ${r.hints.length}`;
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
    progress().wounds++;
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

    const ev = judge.evaluate(r, sql);
    if (ev.error) {
      renderResult(null, { error: ev.error });
      Spell.fizzle();
      if (st.cleared) return;
      hurtPlayer(Math.ceil(attackOf(r) / 2), `Заклинание рассеялось (ошибка SQL). ${r.monster} пользуется моментом:`);
      return finishTurn();
    }

    if (ev.exact) Spell.cast(); else Spell.fizzle();
    const d = ev.display || {};
    const extra = d.changes ? `Изменено строк: ${d.changes}.` : null;
    renderResult(d.res, { verdict: verdictEl(ev), label: d.label, note: d.res ? null : extra });

    if (st.cleared) {
      log('info', ev.exact ? 'Тренировочный удар точен.' : 'Тренировочный удар мимо.');
      return finishTurn();
    }

    if (ev.sim > st.best) {
      const dmg = Math.round(r.maxHp * (ev.sim - st.best));
      st.best = ev.sim;
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
  }

  function openHint(i) {
    const st = progress();
    if (i !== st.hints) return;
    st.hints++;
    // в зачищенном зале подсказки ничего не стоят: награда уже получена
    if (!st.cleared) log('info', `Сломана печать свитка ${'I'.repeat(i + 1)}. Золото за зал теперь ${Math.round(D.hintMultipliers[st.hints] * 100)}%.`);
    save();
    renderHints();
    renderTask();
  }

  function victory() {
    const r = room();
    const st = progress();
    const p = Core.state;
    const rw = rewardFor(r, st);
    const bonus = st.wounds === 0 ? Math.round(rw.gold * 0.25) : 0;
    const before = Core.rank();

    st.cleared = true;
    st.best = 1;
    st.stars = rw.stars;
    p.gold += rw.gold + bonus;
    // опыт не копится в переменной: он считается из пройденного, поэтому зал уже учтён
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
      `<li><span>Золото${rw.mult < 1 ? ` (${Math.round(rw.mult * 100)}%)` : ''}</span><span>+${rw.gold}</span></li>`,
      bonus ? `<li><span>Без единой царапины</span><span>+${bonus}</span></li>` : `<li class="minus"><span>Получено ран</span><span>${st.wounds}</span></li>`,
      `<li><span>Опыт</span><span>+${rw.xp} XP</span></li>`,
      heal ? `<li><span>Отдых у костра</span><span>+${heal} HP</span></li>` : '',
    ].concat(up.lines).join('');
    const finale = !next
      ? '<p>Дракон пал. Подземелье запросов зачищено.</p>'
      : '';
    const nextAct = next && actOf(next) !== actOf(r) ? `<p class="act-open">Открыт ${esc(D.acts[actOf(next)].name)}</p>` : '';
    Core.modal(`
      <div class="big">${up.rank ? `<img class="modal-avatar" src="${Core.avatar(up.rank)}" alt="">` : r.sprite}</div>
      <h3>Победа!</h3>
      <p class="modal-tip">${esc(r.monster)} больше не стоит у тебя на пути.</p>
      <div class="modal-stars">${starStr(rw.stars)}</div>
      <ul class="loot">${items}</ul>
      ${finale}${nextAct}
      ${next ? `<button class="btn attack" id="modal-next" type="button">Дальше: ${esc(next.monster)}</button>` : ''}
      <button class="btn" id="modal-close" type="button">Остаться в зале</button>
    `, { onNext: () => next && switchRoom(next.id), onClose: () => $('sql').focus() });
  }

  function defeat() {
    const r = room();
    const st = progress();
    const p = Core.state;
    const lost = Math.floor(p.gold * 0.25);
    p.gold -= lost;
    p.hp = maxHp();
    st.best = 0;
    log('hurt', `Ты пал в бою. ${r.monster} восстановил силы. Потеряно ${lost} золота.`);
    save();
    renderAll();
    Core.modal(`
      <div class="big">🪦</div>
      <h3>Ты пал</h3>
      <p>${esc(r.monster)} оказался сильнее. Ты приходишь в себя в лагере у входа.</p>
      <ul class="loot">
        <li class="minus"><span>Потеряно золота</span><span>−${lost}</span></li>
        <li><span>Здоровье восстановлено</span><span>${p.hp} HP</span></li>
        <li><span>Открытые свитки остаются с тобой</span><span>${st.hints}</span></li>
      </ul>
      <p class="modal-tip">Совет: «Разведать» бесплатно. Проверь заклинание перед атакой.</p>
      <button class="btn attack" id="modal-close" type="button">Вернуться в бой</button>
    `, { defeat: true, onClose: () => $('sql').focus() });
  }

  function switchRoom(id) {
    if (!S().rooms[id] || !S().rooms[id].unlocked) return;
    S().current = id;
    viewAct = null;
    const r = room();
    $('sql').value = '';
    Spell.update('');
    if (progress().cleared) log('info', 'Этот зал уже зачищен. Здесь можно тренироваться без риска.');
    else log('info', `Ты входишь: ${r.floor}. Перед тобой ${r.monster}.`);
    save();
    renderAll();
    scout();
  }

  // ---------- запуск ----------

  function bind() {
    $('run-btn').addEventListener('click', scout);
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
    ta.addEventListener('input', () => Spell.update(ta.value));
  }

  let opened = false;
  function open() {
    if (!opened) {
      opened = true;
      $('sql').value = '';
      Spell.mount($('pentagram'));
      Spell.update('');
      const r = room();
      log('info', progress().cleared ? 'Этот зал уже зачищен. Здесь можно тренироваться без риска.' : `Ты стоишь в зале ${r.index + 1}. Перед тобой ${r.monster}.`);
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
      return D.rooms.reduce((sum, r) => sum + (rooms[r.id] && rooms[r.id].cleared ? r.xp : 0), 0);
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
