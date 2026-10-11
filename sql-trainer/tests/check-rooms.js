// Проверка всех залов подземелья.
// Запуск: npm i sql.js@1.10.3 && node sql-trainer/tests/check-rooms.js
// Для каждого зала: эталон побеждает, пустые и типичные ошибочные заклинания — нет,
// альтернативные верные решения тоже побеждают, порядок строк однозначен.
'use strict';

const path = require('path');
const fs = require('fs');

const dir = path.join(__dirname, '..');
global.window = global;
for (const f of ['data.js', 'rooms-act1.js', 'rooms-act2.js', 'rooms-act3.js']) {
  const p = path.join(dir, f);
  if (fs.existsSync(p)) require(p);
}
const D = window.DUNGEON;
D.finalize();
const Judge = require(path.join(dir, 'judge.js'));
const cases = require('./cases.js');

let initSqlJs;
try { initSqlJs = require('sql.js/dist/sql-asm.js'); } catch (e) {
  console.error('Нужен пакет sql.js: npm i sql.js@1.10.3');
  process.exit(2);
}

initSqlJs().then((SQL) => {
  const judge = Judge.create(SQL, D);
  const fails = [];
  const fail = (room, msg) => fails.push(`#${room.index + 1} ${room.id}: ${msg}`);
  const ids = new Set();
  let checkedHints = 0;

  D.rooms.forEach((room) => {
    if (ids.has(room.id)) fail(room, 'повторяющийся id');
    ids.add(room.id);
    for (const k of ['monster', 'sprite', 'spell', 'topic', 'intro', 'task', 'solution']) if (!room[k]) fail(room, `нет поля ${k}`);
    if (!room.hints || room.hints.length !== 3) fail(room, 'нужно ровно 3 подсказки');
    if (!room.taunts || room.taunts.length < 2) fail(room, 'нужно 2 реплики монстра');
    (room.tables || []).forEach((t) => { if (!D.diagram.tables[t]) fail(room, `таблицы ${t} нет на схеме`); });

    const ok = judge.evaluate(room, room.solution);
    if (ok.error) return fail(room, 'эталон падает: ' + ok.error);
    if (!ok.exact) return fail(room, 'эталон не побеждает: ' + ok.notes.join(' '));

    const exp = judge.expected(room);
    if (room.kind === 'query' && !exp.result.values.length) fail(room, 'эталон возвращает пустой результат');
    if ((room.kind === 'change' || room.kind === 'object') && !room.unchanged) {
      const b = JSON.stringify(exp.base.values), e = JSON.stringify(exp.exp.values);
      if (b === e) fail(room, 'эталон ничего не меняет');
    }

    // Однозначность порядка: при обратном порядке «равных» строк результат не должен меняться.
    if (room.ordered && room.kind === 'query') {
      const db = new SQL.Database(judge.bytes(room));
      db.exec('PRAGMA reverse_unordered_selects = ON');
      const r = db.exec(room.solution);
      db.close();
      const a = JSON.stringify(r[r.length - 1].values), b = JSON.stringify(exp.result.values);
      if (a !== b) fail(room, 'порядок строк неоднозначен: есть равные значения в ORDER BY');
    }

    const blanks = ['SELECT 1', `SELECT * FROM ${(room.tables || ['heroes'])[0]}`];
    const squash = (q) => q.replace(/\s+/g, ' ').trim().toLowerCase();
    blanks.filter((sql) => squash(sql) !== squash(room.solution)).forEach((sql) => {
      const r = judge.evaluate(room, sql);
      if (!r.error && r.exact) fail(room, `пустышка побеждает: ${sql}`);
      if (!r.error && r.sim > 0.6) fail(room, `пустышка наносит слишком много урона (${Math.round(r.sim * 100)}%): ${sql}`);
    });

    // Третья подсказка, если это готовое заклинание без «…», обязана побеждать.
    const h3 = room.hints[2].replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').trim();
    if (!h3.includes('…') && /^(SELECT|INSERT|UPDATE|DELETE|CREATE|BEGIN|WITH|EXPLAIN|SAVEPOINT)\b/i.test(h3)) {
      const r = judge.evaluate(room, h3);
      if (r.error || !r.exact) fail(room, `третья подсказка не побеждает: ${h3} → ${r.error || r.notes.join(' ')}`);
      else checkedHints++;
    }

    const c = cases[room.id] || {};
    (c.alts || []).forEach((sql) => {
      const r = judge.evaluate(room, sql);
      if (r.error || !r.exact) fail(room, `верная альтернатива не побеждает: ${sql} → ${r.error || r.notes.join(' ')}`);
    });
    (c.wrongs || []).forEach((sql) => {
      const r = judge.evaluate(room, sql);
      if (!r.error && r.exact) fail(room, `ошибочное заклинание побеждает: ${sql}`);
    });
    (c.hints || []).forEach(([sql, text]) => {
      const r = judge.evaluate(room, sql);
      const all = (r.error || '') + ' ' + (r.notes || []).join(' ') + ' ' + (r.planText || '');
      if (!all.includes(text)) fail(room, `ожидалось пояснение «${text}» для: ${sql} → ${all}`);
    });
  });

  // Пороги званий: последний зал даёт ровно Архимага.
  const last = D.rooms[D.rooms.length - 1];
  const before = D.rankFor(last.xpBefore).name;
  const after = D.rankFor(last.xpBefore + last.xp).name;
  if (after !== 'Архимаг' || before === 'Архимаг') fails.push(`звания: до последнего зала «${before}», после «${after}»`);
  if (D.ranks.length !== 8) fails.push('званий должно быть 8');

  console.log(`Залов: ${D.rooms.length}. Проверено готовых подсказок: ${checkedHints}. Ошибок: ${fails.length}.`);
  fails.forEach((f) => console.log(' ✗ ' + f));
  process.exit(fails.length ? 1 : 0);
});
