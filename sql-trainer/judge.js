// Судья: выполняет заклинание игрока на свежей копии Хроник и сравнивает с эталоном.
// Работает и в браузере (window.Judge), и в node (module.exports) — на нём же гоняются тесты комнат.
(function (root) {
  'use strict';

  // Слепок Хроник: если он изменился, значит заклинание исказило данные.
  const FINGERPRINT = `SELECT
    (SELECT COUNT(*) FROM heroes), (SELECT SUM(gold) FROM heroes), (SELECT SUM(level) FROM heroes),
    (SELECT COUNT(*) FROM guilds), (SELECT COUNT(*) FROM quests), (SELECT COUNT(*) FROM quest_log),
    (SELECT COUNT(*) FROM artifacts), (SELECT COUNT(*) FROM ledger)`;

  function norm(v) {
    if (v === null || v === undefined) return '∅';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
    if (v instanceof Uint8Array) return '[blob]';
    return String(v);
  }
  const rowKey = (row) => row.map(norm).join('␟');

  function bag(keys) {
    const m = new Map();
    keys.forEach((k) => m.set(k, (m.get(k) || 0) + 1));
    return m;
  }
  // Пересечение мультимножеств: сколько элементов a нашлось в b.
  function overlap(a, b) {
    const m = bag(b);
    let hit = 0;
    a.forEach((k) => {
      const n = m.get(k) || 0;
      if (n > 0) { hit++; m.set(k, n - 1); }
    });
    return hit;
  }
  // a − b как мультимножество.
  function minus(a, b) {
    const m = bag(b);
    const out = [];
    a.forEach((k) => {
      const n = m.get(k) || 0;
      if (n > 0) m.set(k, n - 1); else out.push(k);
    });
    return out;
  }

  // Строки и комментарии убираются, чтобы 'BEGIN' внутри текста не считался ключевым словом.
  function stripSql(sql) {
    return sql
      .replace(/--[^\n]*/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/'(?:[^']|'')*'?/g, " '' ");
  }

  function create(SQL, D) {
    const rootBytes = (() => {
      const db = new SQL.Database();
      db.run(D.schemaSql);
      const b = db.export();
      db.close();
      return b;
    })();
    const bytesCache = new Map();
    const expCache = new Map();

    function bytes(room) {
      if (!room.setup) return rootBytes;
      if (!bytesCache.has(room.id)) {
        const db = new SQL.Database(rootBytes);
        db.run(room.setup);
        bytesCache.set(room.id, db.export());
        db.close();
      }
      return bytesCache.get(room.id);
    }

    function query(db, sql) {
      try {
        const r = db.exec(sql);
        return r.length ? r[r.length - 1] : { columns: [], values: [] };
      } catch (e) {
        return { columns: [], values: [], error: e.message };
      }
    }

    // Выполнить заклинание. Ошибка останавливает его на месте, как в настоящей СУБД.
    function cast(db, sql) {
      let last = null;
      let error = null;
      try {
        const r = db.exec(sql);
        last = r.length ? r[r.length - 1] : null;
      } catch (e) {
        error = e.message;
      }
      // Незафиксированная транзакция теряется, как при обрыве соединения.
      let txLost = false;
      try { db.exec('ROLLBACK'); txLost = true; } catch (e) { /* транзакции не было */ }
      return { last, error, txLost };
    }

    function probe(db, room) {
      (room.probe || []).forEach((stmt) => {
        try { db.exec(stmt); } catch (e) { /* испытание может и должно иногда падать */ }
      });
    }

    function singleStatement(sql) {
      const s = sql.trim().replace(/;\s*$/, '');
      return stripSql(s).includes(';') ? null : s;
    }

    function plan(db, sql) {
      const r = query(db, 'EXPLAIN QUERY PLAN ' + sql);
      if (r.error) return { error: r.error, text: '' };
      return { text: r.values.map((v) => v[v.length - 1]).join('\n') };
    }

    // Состояние Хроник для комнат на изменение: то, что вернёт check после заклинания (и испытания).
    function stateAfter(room, sql) {
      const db = new SQL.Database(bytes(room));
      const c = sql == null ? { last: null, error: null, txLost: false } : cast(db, sql);
      let intact = true;
      if (room.kind === 'object') intact = sameFingerprint(room, db);
      if (room.kind === 'object') probe(db, room);
      const state = query(db, room.check);
      const verify = (room.verify || []).map((v) => {
        const r = query(db, v.sql);
        return { ok: !r.error && r.values.length > 0 && !!r.values[0][0], msg: v.msg };
      });
      const show = room.show ? query(db, room.show) : state;
      let changes = 0;
      try { changes = db.exec('SELECT total_changes()')[0].values[0][0]; } catch (e) { /* */ }
      db.close();
      return Object.assign(c, { state, show, intact, verify, changes });
    }

    const fpCache = new Map();
    function sameFingerprint(room, db) {
      if (!fpCache.has(room.id)) {
        const clean = new SQL.Database(bytes(room));
        fpCache.set(room.id, rowKey(query(clean, FINGERPRINT).values[0] || []));
        clean.close();
      }
      const now = query(db, FINGERPRINT);
      return !now.error && rowKey(now.values[0] || []) === fpCache.get(room.id);
    }

    function expected(room) {
      if (expCache.has(room.id)) return expCache.get(room.id);
      let e;
      if (room.kind === 'change' || room.kind === 'object') {
        const base = stateAfter(room, null).state;
        const exp = stateAfter(room, room.solution);
        e = { base, exp: exp.state };
      } else {
        const db = new SQL.Database(bytes(room));
        const c = cast(db, room.solution);
        e = { result: c.last || { columns: [], values: [] } };
        db.close();
      }
      expCache.set(room.id, e);
      return e;
    }

    function compareResult(actual, exp, ordered) {
      const expCols = exp.columns.length;
      const actCols = actual.columns.length;
      const colSig = (res, i) => res.values.map((r) => norm(r[i])).sort().join('␟');
      const colsHit = overlap(exp.columns.map((_, i) => colSig(exp, i)), actual.columns.map((_, i) => colSig(actual, i)));
      let rowsHit = 0;
      let rowF1 = 0;
      if (actCols === expCols) {
        rowsHit = overlap(actual.values.map(rowKey), exp.values.map(rowKey));
        const p = actual.values.length ? rowsHit / actual.values.length : 0;
        const r = exp.values.length ? rowsHit / exp.values.length : (actual.values.length ? 0 : 1);
        rowF1 = p + r ? (2 * p * r) / (p + r) : 0;
        if (!exp.values.length && !actual.values.length) rowF1 = 1;
      }
      const sameSet = actCols === expCols && rowF1 === 1 && actual.values.length === exp.values.length;
      const orderOk = sameSet && actual.values.map(rowKey).join('\n') === exp.values.map(rowKey).join('\n');
      const exact = sameSet && (!ordered || orderOk);
      let sim = 1;
      if (!exact) sim = Math.min(0.9, 0.4 * (expCols ? colsHit / expCols : 0) + 0.6 * rowF1 * (sameSet && ordered && !orderOk ? 0.75 : 1));
      const notes = [];
      if (!exact) {
        if (actCols !== expCols) notes.push(`Колонок: ${actCols}, а нужно ${expCols}.`);
        notes.push(`Верных колонок: ${colsHit} из ${expCols}.`);
        if (actCols === expCols) {
          notes.push(`Совпало строк: ${rowsHit} из ${exp.values.length}` + (actual.values.length > rowsHit ? `, лишних: ${actual.values.length - rowsHit}.` : '.'));
        } else {
          notes.push(`Строк: ${actual.values.length}, нужно ${exp.values.length}.`);
        }
        if (ordered && sameSet && !orderOk) notes.push('Строки верные, но порядок другой.');
      }
      return { exact, sim, notes };
    }

    // Сравнение изменений: что заклинание добавило и убрало относительно исходных Хроник.
    function compareChange(base, exp, act, kind) {
      const b = base.values.map(rowKey);
      const e = exp.values.map(rowKey);
      const a = act.error ? [] : act.values.map(rowKey);
      const sameCols = !act.error && act.columns.length === exp.columns.length;
      const exact = sameCols && a.length === e.length && overlap(a, e) === e.length;
      const eAdd = minus(e, b), eRem = minus(b, e);
      const aAdd = minus(a, b), aRem = minus(b, a);
      const need = eAdd.length + eRem.length;
      const made = aAdd.length + aRem.length;
      const notes = [];
      let sim;
      if (exact) sim = 1;
      else if (need === 0) {
        sim = 0;
        notes.push(`Хроники должны были остаться прежними, а изменилось строк: ${made}.`);
      } else {
        const hit = overlap(aAdd, eAdd) + overlap(aRem, eRem);
        const p = made ? hit / made : 0;
        const r = hit / need;
        sim = Math.min(0.9, (p + r ? (2 * p * r) / (p + r) : 0) * 0.9);
        if (!made) {
          notes.push(kind === 'object'
            ? 'Испытание прошло так, будто твоего заклинания нет: объект не создан или не срабатывает.'
            : 'Заклинание ничего не изменило в Хрониках.');
        } else {
          notes.push(`Нужных изменений сделано: ${hit} из ${need}.`);
          if (made > hit) notes.push(`Лишних или неверных изменений: ${made - hit}.`);
        }
      }
      if (act.error) notes.push('Проверка не смогла прочесть результат: ' + act.error);
      return { exact, sim, notes, needZero: need === 0 };
    }

    function evaluate(room, sql) {
      const kind = room.kind || 'query';
      const upper = stripSql(sql).toUpperCase();
      let ev;
      let display = null;
      let planText = null;
      let pre = [];

      if (kind === 'change' || kind === 'object') {
        const s = stateAfter(room, sql);
        const expectedError = s.error && room.allowError && room.allowError.test(s.error);
        if (s.error && !expectedError) return { error: s.error };
        if (expectedError) pre.push('Заклинание прервалось: ' + s.error + '.');
        else if (s.txLost) pre.push('Транзакция не была зафиксирована: без COMMIT все её изменения отменены.');
        const e = expected(room);
        ev = compareChange(e.base, e.exp, s.state, kind);
        if (!s.intact) { ev.exact = false; ev.sim = 0; pre.push('Заклинание изменило данные Хроник, а здесь нужно только создать объект.'); }
        s.verify.forEach((v) => { if (!v.ok) { pre.push(v.msg); if (ev.exact) { ev.exact = false; ev.sim = 0.8; } } });
        display = room.showLast && s.last
          ? { res: s.last, label: 'отклик заклинания' }
          : { res: s.show, label: kind === 'object' ? 'Хроники после испытания' : 'Хроники после заклинания', changes: s.changes };
      } else {
        const db = new SQL.Database(bytes(room));
        const c = cast(db, sql);
        if (c.error) { db.close(); return { error: c.error }; }
        if (c.txLost) pre.push('Транзакция не была зафиксирована и отменена.');
        const intact = sameFingerprint(room, db);
        if (kind === 'plan') {
          const target = room.plan.query || singleStatement(sql);
          if (!target) {
            ev = { exact: false, sim: 0, notes: ['Здесь нужно одно заклинание-запрос, без «;» внутри.'] };
          } else {
            const p = plan(db, target);
            planText = p.error ? 'Ошибка плана: ' + p.error : p.text;
            const ok = !p.error && room.plan.must.every((re) => re.test(p.text)) && !(room.plan.mustNot || []).some((re) => re.test(p.text));
            const created = /\bCREATE\b/.test(upper);
            ev = { exact: ok, sim: ok ? 1 : created ? 0.3 : 0, notes: ok ? [] : [room.plan.fail] };
            if (room.plan.query == null) {
              const cmp = compareResult(c.last || { columns: [], values: [] }, expected(room).result, room.ordered);
              if (!cmp.exact) { ev.exact = false; ev.sim = Math.min(ev.sim, cmp.sim * 0.5); ev.notes = ev.notes.concat(cmp.notes); }
            }
          }
          (room.verify || []).forEach((v) => {
            const r = query(db, v.sql);
            if (r.error || !r.values.length || !r.values[0][0]) { ev.notes.push(v.msg); if (ev.exact) { ev.exact = false; ev.sim = 0.6; } }
          });
          display = { res: c.last, label: 'атака' };
        } else {
          if (!c.last) {
            ev = { exact: false, sim: 0, notes: ['Заклинание ничего не вернуло. Здесь нужен запрос, который выводит строки.'] };
          } else {
            ev = compareResult(c.last, expected(room).result, room.ordered);
          }
          display = { res: c.last, label: 'атака' };
        }
        if (!intact) { ev.exact = false; ev.sim = 0; pre.push('Заклинание исказило данные Хроник. Здесь их можно только читать.'); }
        db.close();
      }

      // Обязательные и запретные приёмы. Верный итог без нужного приёма — не победа.
      const missing = (room.require || []).filter((rq) => !rq.re.test(upper))
        .concat((room.forbid || []).filter((rq) => rq.re.test(upper)));
      if (missing.length) {
        missing.forEach((rq) => pre.push(rq.msg));
        ev.exact = false;
        ev.sim = ev.needZero ? 0 : Math.min(ev.sim, 0.5);
      }
      ev.notes = pre.concat(ev.notes);
      return Object.assign(ev, { display, planText });
    }

    // Разведка: выполнить и показать, ничего не оценивая.
    function scout(room, sql) {
      const db = new SQL.Database(bytes(room));
      const c = cast(db, sql);
      let changes = 0;
      try { changes = db.exec('SELECT total_changes()')[0].values[0][0]; } catch (e) { /* */ }
      let res = c.last;
      let label = 'разведка';
      if (!c.error && !res && room.kind === 'plan' && room.plan.query) {
        res = query(db, 'EXPLAIN QUERY PLAN ' + room.plan.query);
        label = 'план запроса из задания после твоего заклинания';
      } else if (!c.error && !res && (room.show || room.check)) {
        res = query(db, room.show || room.check);
        label = 'Хроники после заклинания (в разведке ничего не сохраняется)';
      }
      db.close();
      return { res, label, error: c.error, txLost: c.txLost, changes };
    }

    function table(room, name) {
      const db = new SQL.Database(bytes(room));
      const r = query(db, `SELECT * FROM ${name}`);
      db.close();
      return r;
    }

    return { evaluate, scout, table, expected, bytes };
  }

  const Judge = { create, stripSql };
  if (typeof module !== 'undefined' && module.exports) module.exports = Judge;
  else root.Judge = Judge;
})(typeof window !== 'undefined' ? window : globalThis);
