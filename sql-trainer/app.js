(function () {
  'use strict';

  const D = window.DUNGEON;
  const STORE_KEY = 'sql-dungeon-v2';
  const $ = (id) => document.getElementById(id);

  // ---------- состояние ----------

  function freshState() {
    const rooms = {};
    D.rooms.forEach((r, i) => {
      rooms[r.id] = { unlocked: i === 0, cleared: false, stars: 0, golden: false, hints: 0, best: 0, wounds: 0 };
    });
    return {
      player: { level: 1, xp: 0, hp: 100, maxHp: 100, gold: 0 },
      rooms,
      current: D.rooms[0].id,
      drafts: {},
      log: [],
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return freshState();
      const s = JSON.parse(raw);
      const base = freshState();
      // новые комнаты из data.js подмешиваются к старому сохранению
      s.rooms = Object.assign(base.rooms, s.rooms || {});
      return Object.assign(base, s);
    } catch (e) {
      return freshState();
    }
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* без сохранения тоже играем */ }
  }

  let state = load();
  let SQL = null;
  let pristine = null; // байты эталонной БД; каждый запрос идёт по свежей копии
  const expected = {};

  const room = () => D.rooms.find((r) => r.id === state.current);
  const progress = () => state.rooms[state.current];
  const xpToNext = (lvl) => 50 * lvl;
  const rankOf = (lvl) => D.ranks.filter(([from]) => lvl >= from).pop()[1];

  // ---------- SQL ----------

  function runSql(sql) {
    const db = new SQL.Database(pristine);
    try {
      const res = db.exec(sql);
      if (!res.length) return { columns: [], values: [] };
      return res[res.length - 1];
    } finally {
      db.close();
    }
  }

  function norm(v) {
    if (v === null || v === undefined) return '∅';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
    return String(v);
  }
  const rowKey = (row) => row.map(norm).join('␟');

  function multisetOverlap(a, b) {
    const bag = new Map();
    b.forEach((k) => bag.set(k, (bag.get(k) || 0) + 1));
    let hit = 0;
    a.forEach((k) => {
      const n = bag.get(k) || 0;
      if (n > 0) { hit++; bag.set(k, n - 1); }
    });
    return hit;
  }

  // Насколько результат игрока похож на эталон: 1 — точное совпадение.
  function evaluate(actual, exp, ordered) {
    const expCols = exp.columns.length;
    const actCols = actual.columns.length;
    const colSig = (res, i) => res.values.map((r) => norm(r[i])).sort().join('␟');
    const expSigs = exp.columns.map((_, i) => colSig(exp, i));
    const actSigs = actual.columns.map((_, i) => colSig(actual, i));
    const colsHit = multisetOverlap(expSigs, actSigs);

    let rowsHit = 0;
    let rowF1 = 0;
    if (actCols === expCols) {
      rowsHit = multisetOverlap(actual.values.map(rowKey), exp.values.map(rowKey));
      const p = actual.values.length ? rowsHit / actual.values.length : 0;
      const r = exp.values.length ? rowsHit / exp.values.length : 0;
      rowF1 = p + r ? (2 * p * r) / (p + r) : 0;
    }
    const sameSet = actCols === expCols && rowF1 === 1;
    const orderOk = sameSet && actual.values.map(rowKey).join('\n') === exp.values.map(rowKey).join('\n');
    const exact = sameSet && (!ordered || orderOk);

    let sim = 1;
    if (!exact) {
      sim = 0.4 * (colsHit / expCols) + 0.6 * rowF1 * (sameSet && ordered && !orderOk ? 0.75 : 1);
      sim = Math.min(0.9, sim);
    }

    const notes = [];
    if (actCols !== expCols) notes.push(`Колонок: ${actCols}, а нужно ${expCols}.`);
    notes.push(`Верных колонок: ${colsHit} из ${expCols}.`);
    if (actCols === expCols) {
      notes.push(`Совпало строк: ${rowsHit} из ${exp.values.length}` + (actual.values.length > rowsHit ? `, лишних: ${actual.values.length - rowsHit}.` : '.'));
    } else {
      notes.push(`Строк: ${actual.values.length}, нужно ${exp.values.length}.`);
    }
    if (ordered && sameSet && !orderOk) notes.push('Строки верные, но порядок другой.');
    return { exact, sim, notes };
  }

  // ---------- рендер ----------

  function setBar(el, frac) { el.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%'; }

  function renderHud() {
    const p = state.player;
    $('hp-text').textContent = `${p.hp} / ${p.maxHp}`;
    setBar($('hp-bar'), p.hp / p.maxHp);
    $('lvl-text').textContent = `${rankOf(p.level)} · ${p.level}`;
    $('cleared-text').textContent = `${D.rooms.filter((r) => state.rooms[r.id].cleared).length} / ${D.rooms.length}`;
    $('xp-text').textContent = `${p.xp} / ${xpToNext(p.level)} XP`;
    setBar($('xp-bar'), p.xp / xpToNext(p.level));
    $('gold-text').textContent = p.gold;
    const tro = $('trophies');
    tro.innerHTML = '';
    D.rooms.forEach((r) => {
      const st = state.rooms[r.id];
      if (!st.cleared) return;
      const s = document.createElement('span');
      s.className = 'trophy' + (st.golden ? ' gold' : '');
      s.textContent = r.trophy.icon;
      s.title = r.trophy.name + (st.golden ? ' (золотой: без подсказок и ранений)' : '');
      tro.appendChild(s);
    });
  }

  const starStr = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

  function renderMap() {
    const map = $('map');
    map.innerHTML = '';
    const add = (el) => {
      if (map.children.length) {
        const path = document.createElement('span');
        path.className = 'map-path';
        map.appendChild(path);
      }
      map.appendChild(el);
    };
    D.rooms.forEach((r) => {
      const st = state.rooms[r.id];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'map-room' + (r.id === state.current ? ' current' : '') + (st.cleared ? ' cleared' : '') + (st.unlocked ? '' : ' locked');
      b.disabled = !st.unlocked;
      b.innerHTML = `<span class="sprite">${st.unlocked ? r.sprite : '🔒'}</span>
        <span><span class="floor">${r.floor}</span><br><span class="name">${st.unlocked ? r.monster : '???'}</span></span>
        <span class="stars">${st.cleared ? starStr(st.stars) : st.unlocked ? 'в бою' : 'закрыто'}</span>`;
      b.addEventListener('click', () => switchRoom(r.id));
      add(b);
    });
    const cur = map.querySelector('.current');
    if (cur) map.scrollLeft = cur.offsetLeft - map.clientWidth / 2 + cur.offsetWidth / 2;
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
    $('monster-name').innerHTML = r.monster + (r.boss ? '<span class="boss-tag">БОСС</span>' : '');
    const hp = monsterHp();
    setBar($('monster-bar'), hp / r.maxHp);
    $('monster-meta').textContent = st.cleared
      ? 'Повержен. Можно потренироваться ещё раз, но без добычи.'
      : `HP ${hp} / ${r.maxHp} · бьёт на ${r.attack} за промах`;
    $('monster-intro').textContent = r.intro;
  }

  function rewardFor(r, st) {
    const mult = D.hintMultipliers[st.hints];
    return { gold: Math.round(r.gold * mult), xp: Math.round(r.xp * mult), stars: 3 - st.hints, mult };
  }

  function renderTask() {
    const r = room();
    const st = progress();
    $('task-text').innerHTML = r.task;
    $('task-spell').innerHTML = `Заклинание: <b>${r.spell}</b> · ${r.topic}`;
    $('task-tables').innerHTML = 'Таблицы: ' + r.tables.map((t) => `<code>${t}</code>`).join(', ') + (r.ordered ? ' · порядок строк проверяется' : ' · порядок строк не важен');
    const rw = rewardFor(r, st);
    $('reward').innerHTML = st.cleared
      ? `<span class="stars">${starStr(st.stars)}</span><span class="muted">Комната зачищена</span>`
      : `<span>Добыча:</span><span class="chip gold">🪙 <b>${rw.gold}</b></span><span class="chip">✦ ${rw.xp} XP</span><span class="stars">${starStr(rw.stars)}</span>` +
        `<span class="muted">${rw.mult < 1 ? `подсказки срезали добычу до ${Math.round(rw.mult * 100)}%` : `${r.trophy.icon} ${r.trophy.name}`}</span>`;
  }

  function renderHints() {
    const r = room();
    const st = progress();
    const box = $('hints');
    box.innerHTML = '';
    r.hints.forEach((text, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      if (i < st.hints) {
        b.className = 'hint open';
        b.disabled = true;
        b.innerHTML = `<span class="lvl">${'I'.repeat(i + 1)}</span><span class="body">${text}</span>`;
      } else {
        const next = i === st.hints;
        const after = Math.round(D.hintMultipliers[i + 1] * 100);
        b.className = 'hint' + (next ? '' : ' sealed');
        b.disabled = !next;
        b.innerHTML = `<span class="lvl">${'I'.repeat(i + 1)}</span><span>${next ? 'Сломать печать свитка' : 'Запечатан: сначала открой предыдущий'}</span><span class="cost">добыча → ${after}%</span>`;
        if (next) b.addEventListener('click', () => openHint(i));
      }
      box.appendChild(b);
    });
  }

  function renderLog() {
    const ul = $('log');
    ul.innerHTML = '';
    state.log.slice(-30).reverse().forEach((e) => {
      const li = document.createElement('li');
      li.className = e.t;
      li.textContent = e.m;
      ul.appendChild(li);
    });
  }

  function log(t, m) {
    state.log.push({ t, m });
    if (state.log.length > 60) state.log = state.log.slice(-60);
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
    dg.links.forEach(([ft, fc, tt, tc]) => {
      const a = dg.tables[ft], b = dg.tables[tt];
      const y1 = rowY(ft, fc), y2 = rowY(tt, tc);
      let x1, x2, path;
      if (ft === tt) {
        // ссылка таблицы на саму себя: петля справа
        x1 = x2 = a.x + W;
        path = `M${x1} ${y1} C${x1 + 30} ${y1} ${x1 + 30} ${y2} ${x2} ${y2}`;
      } else if (a.x === b.x) {
        // таблицы друг под другом: дуга слева
        x1 = a.x; x2 = b.x;
        path = `M${x1} ${y1} C${x1 - 28} ${y1} ${x2 - 28} ${y2} ${x2} ${y2}`;
      } else {
        x1 = a.x > b.x ? a.x : a.x + W;
        x2 = a.x > b.x ? b.x + W : b.x;
        const mid = (x1 + x2) / 2;
        path = `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
      }
      out += `<path class="schema-link" d="${path}"/><circle class="schema-dot" cx="${x1}" cy="${y1}" r="3"/><circle class="schema-dot" cx="${x2}" cy="${y2}" r="3"/>`;
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
    const box = $('results');
    const meta = $('results-meta');
    box.innerHTML = '';
    if (opts && opts.verdict) box.appendChild(opts.verdict);
    if (res.error) {
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = res.error;
      box.appendChild(p);
      meta.textContent = '';
      return;
    }
    if (!res.columns.length) {
      box.insertAdjacentHTML('beforeend', '<p class="empty">Запрос выполнен, но ничего не вернул.</p>');
      meta.textContent = '';
      return;
    }
    meta.textContent = (opts && opts.label ? opts.label + ' · ' : '') + `${res.values.length} строк`;
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
    renderLog();
    renderSchema();
  }

  // ---------- эффекты ----------

  function floater(text, cls) {
    const arena = $('arena');
    const f = document.createElement('span');
    f.className = 'floater ' + cls;
    f.textContent = text;
    f.style.left = (cls === 'dmg' ? 22 + Math.random() * 30 : 60 + Math.random() * 25) + '%';
    f.style.top = '30%';
    arena.appendChild(f);
    setTimeout(() => f.remove(), 1200);
  }

  function shakeMonster() {
    const m = $('monster-sprite');
    m.classList.remove('hit');
    void m.offsetWidth;
    m.classList.add('hit');
  }

  function flashArena() {
    const a = $('arena');
    a.classList.remove('flash');
    void a.offsetWidth;
    a.classList.add('flash');
  }

  // ---------- действия ----------

  function currentSql() { return $('sql').value; }

  function scout() {
    if (!SQL) return;
    try {
      renderResult(runSql(currentSql()), { label: 'разведка' });
    } catch (e) {
      renderResult({ error: e.message });
    }
  }

  function peekTable(name) {
    if (!SQL) return;
    renderResult(runSql(`SELECT * FROM ${name}`), { label: `таблица ${name}` });
  }

  function hurtPlayer(dmg, why) {
    const p = state.player;
    p.hp = Math.max(0, p.hp - dmg);
    progress().wounds++;
    floater('−' + dmg, 'hurt');
    flashArena();
    log('hurt', `${why} −${dmg} HP.`);
    if (p.hp === 0) defeat();
  }

  function attack() {
    if (!SQL) return;
    const r = room();
    const st = progress();
    const sql = currentSql().trim();
    if (!sql) return;

    let res;
    try {
      res = runSql(sql);
    } catch (e) {
      renderResult({ error: e.message });
      if (st.cleared) return;
      Spell.fizzle();
      hurtPlayer(Math.ceil(r.attack / 2), `Заклинание рассеялось (ошибка SQL). ${r.monster} пользуется моментом:`);
      return finishTurn();
    }

    const ev = evaluate(res, expected[r.id], r.ordered);
    if (ev.exact) Spell.cast(); else Spell.fizzle();
    const verdict = document.createElement('div');
    verdict.className = 'verdict ' + (ev.exact ? 'ok' : 'bad');
    verdict.innerHTML = ev.exact
      ? '<b>Точное попадание. Результат совпал с эталоном.</b>'
      : `<b>Удар не смертельный. Результат близок к ответу на ${Math.round(ev.sim * 100)}%.</b><ul>${ev.notes.map((n) => `<li>${n}</li>`).join('')}</ul>`;
    renderResult(res, { verdict, label: 'атака' });

    if (st.cleared) {
      log('info', ev.exact ? 'Тренировочный удар точен.' : 'Тренировочный удар мимо.');
      return finishTurn();
    }

    if (ev.sim > st.best) {
      const dmg = Math.round(r.maxHp * (ev.sim - st.best));
      st.best = ev.sim;
      floater('−' + dmg, 'dmg');
      shakeMonster();
      log('dmg', `Ты наносишь ${dmg} урона. ` + (ev.exact ? '' : r.taunts[Math.floor(Math.random() * r.taunts.length)]));
    } else if (!ev.exact) {
      log('info', 'Удар соскользнул: этот запрос не ближе к ответу, чем прошлый.');
    }

    if (ev.exact) return victory();
    hurtPlayer(r.attack, `${r.monster} контратакует:`);
    finishTurn();
  }

  function finishTurn() {
    save();
    renderHud();
    renderArena();
    renderLog();
  }

  function openHint(i) {
    const st = progress();
    if (i !== st.hints) return;
    st.hints++;
    // в зачищенной комнате подсказки ничего не стоят: награда уже получена
    if (!st.cleared) log('info', `Сломана печать свитка ${'I'.repeat(i + 1)}. Добыча теперь ${Math.round(D.hintMultipliers[st.hints] * 100)}%.`);
    save();
    renderHints();
    renderTask();
    renderLog();
  }

  function victory() {
    const r = room();
    const st = progress();
    const p = state.player;
    const rw = rewardFor(r, st);
    const flawless = st.wounds === 0;
    const bonus = flawless ? Math.round(rw.gold * 0.25) : 0;
    const golden = flawless && st.hints === 0;

    st.cleared = true;
    st.best = 1;
    st.stars = rw.stars;
    st.golden = golden;
    p.gold += rw.gold + bonus;
    p.xp += rw.xp;
    const heal = Math.min(30, p.maxHp - p.hp);
    p.hp += heal;
    const levels = [];
    while (p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level++;
      p.maxHp += 10;
      p.hp = p.maxHp;
      levels.push(p.level);
    }
    const idx = D.rooms.indexOf(r);
    const next = D.rooms[idx + 1];
    if (next) state.rooms[next.id].unlocked = true;

    log('win', `${r.monster} повержен! +${rw.gold + bonus} золота, +${rw.xp} XP.`);
    const oldRank = rankOf(p.level - levels.length);
    levels.forEach((l) => log('win', `Новый уровень: ${l}. Максимум здоровья +10.`));
    const newRank = levels.length && rankOf(p.level) !== oldRank ? rankOf(p.level) : null;
    if (newRank) log('win', `Ты достиг звания: ${newRank}.`);
    save();
    renderAll();

    const items = [
      `<li><span>Золото (${Math.round(rw.mult * 100)}%)</span><span>+${rw.gold}</span></li>`,
      bonus ? `<li><span>Без единой царапины</span><span>+${bonus}</span></li>` : `<li class="minus"><span>Получено ран</span><span>${st.wounds}</span></li>`,
      `<li><span>Опыт</span><span>+${rw.xp} XP</span></li>`,
      heal ? `<li><span>Отдых у костра</span><span>+${heal} HP</span></li>` : '',
      levels.length ? `<li><span>Новый уровень</span><span>${p.level}</span></li>` : '',
      newRank ? `<li><span>Новое звание</span><span>${newRank}</span></li>` : '',
      `<li><span>Трофей: ${r.trophy.name}${golden ? ' (золотой)' : ''}</span><span>${r.trophy.icon}</span></li>`,
    ].join('');
    showModal(`
      <div class="big">${r.trophy.icon}</div>
      <h3>${r.monster} повержен</h3>
      <div class="stars" style="color:var(--torch);font-size:1.4rem;letter-spacing:.15em">${starStr(rw.stars)}</div>
      <ul class="loot">${items}</ul>
      ${next ? `<button class="btn attack" id="modal-next" type="button">Дальше: ${next.monster}</button>` : '<p>Дракон пал. Подземелье зачищено, а ты прошёл путь от ученика до мастера заклинаний.</p>'}
      <button class="btn" id="modal-close" type="button">Остаться в комнате</button>
    `, false, () => next && switchRoom(next.id));
  }

  function defeat() {
    const r = room();
    const st = progress();
    const p = state.player;
    const lost = Math.floor(p.gold * 0.25);
    p.gold -= lost;
    p.hp = p.maxHp;
    st.best = 0;
    log('hurt', `Ты пал в бою. ${r.monster} восстановил силы. Потеряно ${lost} золота.`);
    save();
    renderAll();
    showModal(`
      <div class="big">🪦</div>
      <h3>Ты пал</h3>
      <p>${r.monster} оказался сильнее. Ты приходишь в себя в лагере у входа.</p>
      <ul class="loot">
        <li class="minus"><span>Потеряно золота</span><span>−${lost}</span></li>
        <li><span>Здоровье восстановлено</span><span>${p.maxHp} HP</span></li>
        <li><span>Открытые свитки остаются с тобой</span><span>${st.hints}</span></li>
      </ul>
      <p style="color:var(--dust);margin:0">Совет: «Разведать» бесплатно. Проверь запрос перед атакой.</p>
      <button class="btn attack" id="modal-close" type="button">Вернуться в бой</button>
    `, true);
  }

  function showModal(html, isDefeat, onNext) {
    const ov = $('overlay');
    ov.innerHTML = `<div class="modal${isDefeat ? ' defeat' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    ov.hidden = false;
    const close = () => { ov.hidden = true; ov.innerHTML = ''; $('sql').focus(); };
    const c = $('modal-close');
    if (c) { c.addEventListener('click', close); c.focus(); }
    const n = $('modal-next');
    if (n) { n.addEventListener('click', () => { close(); onNext && onNext(); }); n.focus(); }
  }

  function switchRoom(id) {
    if (!state.rooms[id] || !state.rooms[id].unlocked) return;
    state.drafts[state.current] = currentSql();
    state.current = id;
    const r = room();
    $('sql').value = state.drafts[id] != null ? state.drafts[id] : r.starter;
    Spell.update($('sql').value);
    if (!progress().cleared) log('info', `Ты входишь: ${r.floor}. Перед тобой ${r.monster}.`);
    save();
    renderAll();
    scout();
  }

  function resetGame() {
    const btn = $('reset-btn');
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = 'Точно? Нажми ещё раз';
      setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Начать заново'; }, 3000);
      return;
    }
    btn.dataset.armed = '';
    btn.textContent = 'Начать заново';
    state = freshState();
    $('sql').value = room().starter;
    Spell.update($('sql').value);
    log('info', `Ты спускаешься в подземелье. Перед тобой ${room().monster}.`);
    save();
    renderAll();
    scout();
  }

  // ---------- запуск ----------

  function bind() {
    $('run-btn').addEventListener('click', scout);
    $('attack-btn').addEventListener('click', attack);
    $('reset-btn').addEventListener('click', resetGame);
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
    ta.addEventListener('input', () => {
      Spell.update(ta.value);
      state.drafts[state.current] = ta.value;
      clearTimeout(bind.t);
      bind.t = setTimeout(save, 400);
    });
  }

  async function start() {
    bind();
    const r = room();
    $('sql').value = state.drafts[r.id] != null ? state.drafts[r.id] : r.starter;
    Spell.mount($('pentagram'));
    Spell.update($('sql').value);
    if (!state.log.length) log('info', `Ты спускаешься в подземелье. Перед тобой ${r.monster}.`);
    renderAll();
    try {
      SQL = await window.initSqlJs();
      const db = new SQL.Database();
      db.run(D.schemaSql);
      pristine = db.export();
      Spell.init($('pentagram'), new SQL.Database(pristine));
      Spell.update($('sql').value);
      db.close();
      D.rooms.forEach((rm) => { expected[rm.id] = runSql(rm.solution); });
      $('run-btn').disabled = false;
      $('attack-btn').disabled = false;
      scout();
    } catch (e) {
      renderResult({ error: 'Не удалось загрузить SQLite: ' + e.message });
    }
  }

  start();
})();
