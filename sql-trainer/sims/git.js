// Симулятор Git и GitLab CI: терминал git с моделью репозитория, редактор файлов и панель GitLab с пайплайнами.
(function () {
  'use strict';

  const Core = window.Core;
  const esc = Core.esc;

  // ---------- утилиты ----------

  function fnv(str, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  // «SHA-1» коммита: детерминированный 40-символьный хэш от содержимого
  function sha(str) {
    let out = '';
    for (let k = 0; k < 5; k++) out += fnv(str + '#' + k, (2166136261 ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0).toString(16).padStart(8, '0');
    return out;
  }
  const short = (h) => (h ? h.slice(0, 7) : '0000000');

  // Цвета терминала: ANSI-коды → span-ы
  const C = {
    red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    blue: (s) => `\x1b[34m${s}\x1b[0m`, magenta: (s) => `\x1b[35m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`,
  };
  function ansi(text) {
    let open = false;
    const html = esc(text).replace(/\x1b\[(\d+)m/g, (m, c) => {
      let s = open ? '</span>' : '';
      open = false;
      if (c !== '0') { s += `<span class="a${c}">`; open = true; }
      return s;
    });
    return html + (open ? '</span>' : '');
  }
  const stripAnsi = (s) => String(s).replace(/\x1b\[\d+m/g, '');

  const BASE_TIME = Date.UTC(2026, 9, 5, 7, 0, 0);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad2 = (n) => String(n).padStart(2, '0');
  function gitDate(t) {
    const d = new Date(t + 3 * 3600e3);
    return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} ${d.getUTCFullYear()} +0300`;
  }
  function shortDate(t) {
    const d = new Date(t + 3 * 3600e3);
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  }
  function dur(sec) {
    sec = Math.round(sec);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  }
  function clock(sec) {
    sec = Math.round(sec);
    return `${pad2(Math.floor(sec / 3600))}:${pad2(Math.floor(sec / 60) % 60)}:${pad2(sec % 60)}`;
  }

  // Текст ↔ строки (с учётом завершающего перевода строки)
  function toLines(text) {
    if (text == null || text === '') return [];
    const l = String(text).split('\n');
    if (l[l.length - 1] === '') l.pop();
    return l;
  }
  const fromLines = (lines) => (lines.length ? lines.join('\n') + '\n' : '');

  // LCS-дифф по строкам: [{t:'=',a,b} | {t:'-',a} | {t:'+',b}]
  function diffOps(a, b) {
    const n = a.length, m = b.length;
    const dp = [];
    for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = [];
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { ops.push({ t: '=', a: i, b: j }); i++; j++; }
      else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) { ops.push({ t: '-', a: i }); i++; }
      else { ops.push({ t: '+', b: j }); j++; }
    }
    return ops;
  }
  // Ханки изменений относительно базы: {start, end, lines}
  function hunksOf(base, other) {
    const ops = diffOps(base, other);
    const hunks = [];
    let cur = null, pos = 0;
    ops.forEach((o) => {
      if (o.t === '=') { if (cur) { hunks.push(cur); cur = null; } pos = o.a + 1; return; }
      if (!cur) cur = { start: pos, end: pos, lines: [] };
      if (o.t === '-') { cur.end = o.a + 1; pos = o.a + 1; } else cur.lines.push(other[o.b]);
    });
    if (cur) hunks.push(cur);
    return hunks;
  }
  function applyHunks(base, hunks, from, to) {
    const out = [];
    let p = from;
    hunks.forEach((h) => { while (p < h.start) out.push(base[p++]); out.push(...h.lines); p = h.end; });
    while (p < to) out.push(base[p++]);
    return out;
  }
  // Трёхсторонний merge текста (как diff3 в git): соседние/пересекающиеся правки обеих сторон — конфликт
  function merge3(baseT, oursT, theirsT, labelOurs, labelTheirs) {
    const base = toLines(baseT), ours = toLines(oursT), theirs = toLines(theirsT);
    const all = hunksOf(base, ours).map((h) => Object.assign(h, { side: 'a' }))
      .concat(hunksOf(base, theirs).map((h) => Object.assign(h, { side: 'b' })))
      .sort((x, y) => x.start - y.start || x.end - y.end);
    const out = [];
    let conflicts = 0, p = 0, i = 0;
    while (i < all.length) {
      const group = [all[i]];
      let gs = all[i].start, ge = all[i].end;
      i++;
      while (i < all.length && all[i].start <= ge) {
        group.push(all[i]); ge = Math.max(ge, all[i].end); i++;
      }
      while (p < gs) out.push(base[p++]);
      const sa = group.filter((g) => g.side === 'a'), sb = group.filter((g) => g.side === 'b');
      const ra = applyHunks(base, sa, gs, ge), rb = applyHunks(base, sb, gs, ge);
      if (!sa.length) out.push(...rb);
      else if (!sb.length) out.push(...ra);
      else if (ra.join('\n') === rb.join('\n')) out.push(...ra);
      else {
        conflicts++;
        out.push(`<<<<<<< ${labelOurs}`, ...ra, '=======', ...rb, `>>>>>>> ${labelTheirs}`);
      }
      p = ge;
    }
    while (p < base.length) out.push(base[p++]);
    return { text: fromLines(out), conflict: conflicts > 0 };
  }

  // Unified diff одного файла
  function fileDiff(path, oldT, newT, color) {
    const c = color ? C : { red: (s) => s, green: (s) => s, cyan: (s) => s, bold: (s) => s };
    const a = toLines(oldT), b = toLines(newT);
    const head = [c.bold(`diff --git a/${path} b/${path}`)];
    if (oldT == null) head.push(c.bold('new file mode 100644'), c.bold(`index 0000000..${short(sha('blob' + newT))}`), c.bold('--- /dev/null'), c.bold(`+++ b/${path}`));
    else if (newT == null) head.push(c.bold('deleted file mode 100644'), c.bold(`index ${short(sha('blob' + oldT))}..0000000`), c.bold(`--- a/${path}`), c.bold('+++ /dev/null'));
    else head.push(c.bold(`index ${short(sha('blob' + oldT))}..${short(sha('blob' + newT))} 100644`), c.bold(`--- a/${path}`), c.bold(`+++ b/${path}`));
    const ops = diffOps(a, b);
    const out = head;
    // группируем изменения в ханки с контекстом 3 строки
    const idx = [];
    ops.forEach((o, k) => { if (o.t !== '=') idx.push(k); });
    let k = 0;
    while (k < idx.length) {
      let from = Math.max(0, idx[k] - 3), to = Math.min(ops.length, idx[k] + 4);
      let j = k + 1;
      while (j < idx.length && idx[j] - 3 <= to) { to = Math.min(ops.length, idx[j] + 4); j++; }
      const seg = ops.slice(from, to);
      let as = null, bs = null, al = 0, bl = 0;
      seg.forEach((o) => {
        if (o.t !== '+') { if (as === null) as = o.a; al++; }
        if (o.t !== '-') { if (bs === null) bs = o.b; bl++; }
      });
      if (as === null) { as = 0; for (let q = from - 1; q >= 0; q--) if (ops[q].t !== '+') { as = ops[q].a + 1; break; } }
      if (bs === null) { bs = 0; for (let q = from - 1; q >= 0; q--) if (ops[q].t !== '-') { bs = ops[q].b + 1; break; } }
      out.push(c.cyan(`@@ -${al ? as + 1 : as},${al} +${bl ? bs + 1 : bs},${bl} @@`));
      seg.forEach((o) => {
        if (o.t === '=') out.push(' ' + a[o.a]);
        else if (o.t === '-') out.push(c.red('-' + a[o.a]));
        else out.push(c.green('+' + b[o.b]));
      });
      k = j;
    }
    return out.join('\n');
  }
  function lineStat(oldT, newT) {
    let ins = 0, del = 0;
    diffOps(toLines(oldT), toLines(newT)).forEach((o) => { if (o.t === '+') ins++; else if (o.t === '-') del++; });
    return { ins, del };
  }
  // Изменённые пути между двумя деревьями
  function changedPaths(t1, t2) {
    const keys = new Set(Object.keys(t1).concat(Object.keys(t2)));
    return [...keys].filter((p) => t1[p] !== t2[p]).sort();
  }
  function treeDiff(t1, t2, color, paths) {
    return changedPaths(t1, t2).filter((p) => !paths || !paths.length || paths.some((q) => p === q || p.startsWith(q.replace(/\/$/, '') + '/')))
      .map((p) => fileDiff(p, t1[p], t2[p], color)).join('\n');
  }
  function diffStat(t1, t2, color) {
    const ps = changedPaths(t1, t2);
    if (!ps.length) return '';
    let tins = 0, tdel = 0;
    const w = Math.max(...ps.map((p) => p.length));
    const rows = ps.map((p) => {
      const s = lineStat(t1[p], t2[p]);
      tins += s.ins; tdel += s.del;
      const bar = (color ? C.green('+'.repeat(Math.min(s.ins, 30))) + C.red('-'.repeat(Math.min(s.del, 30))) : '+'.repeat(Math.min(s.ins, 30)) + '-'.repeat(Math.min(s.del, 30)));
      return ` ${p.padEnd(w)} | ${String(s.ins + s.del).padStart(3)} ${bar}`;
    });
    return rows.join('\n') + '\n' + summaryLine(ps.length, tins, tdel);
  }
  function summaryLine(files, ins, del) {
    let s = ` ${files} file${files === 1 ? '' : 's'} changed`;
    if (ins || !del) s += `, ${ins} insertion${ins === 1 ? '' : 's'}(+)`;
    if (del) s += `, ${del} deletion${del === 1 ? '' : 's'}(-)`;
    return s;
  }

  // .gitignore
  function ignoreMatcher(text) {
    const rules = toLines(text || '').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((p) => {
      const neg = p.startsWith('!');
      if (neg) p = p.slice(1);
      const dirOnly = p.endsWith('/');
      if (dirOnly) p = p.slice(0, -1);
      const anchored = p.includes('/');
      if (p.startsWith('/')) p = p.slice(1);
      let re = '';
      for (let i = 0; i < p.length; i++) {
        const ch = p[i];
        if (ch === '*' && p[i + 1] === '*') { re += '.*'; i++; if (p[i + 1] === '/') i++; }
        else if (ch === '*') re += '[^/]*';
        else if (ch === '?') re += '[^/]';
        else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      }
      return { neg, dirOnly, rx: new RegExp(anchored ? `^${re}$` : `(^|/)${re}$`) };
    });
    return (path) => {
      const parts = path.split('/');
      let ignored = false;
      for (let i = 1; i <= parts.length; i++) {
        const sub = parts.slice(0, i).join('/');
        const isDir = i < parts.length;
        rules.forEach((r) => { if ((!r.dirOnly || isDir) && r.rx.test(sub)) ignored = !r.neg; });
        if (ignored && isDir) return true;
      }
      return ignored;
    };
  }

  function lev(a, b) {
    const d = [];
    for (let i = 0; i <= a.length; i++) { d[i] = [i]; for (let j = 1; j <= b.length; j++) d[i][j] = i ? 0 : j; }
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  // Разбор командной строки: кавычки, &&, ;, перенаправление > и >>
  function tokenize(line) {
    const out = [];
    let cur = null, q = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === q) q = null;
        else if (ch === '\\' && q === '"' && i + 1 < line.length && '"\\$'.includes(line[i + 1])) cur += line[++i];
        else cur += ch;
        continue;
      }
      if (ch === '"' || ch === "'") { q = ch; if (cur === null) cur = ''; continue; }
      if (/\s/.test(ch)) { if (cur !== null) { out.push(cur); cur = null; } continue; }
      if (ch === '&' && line[i + 1] === '&') { if (cur !== null) out.push(cur); cur = null; out.push({ op: '&&' }); i++; continue; }
      if (ch === ';') { if (cur !== null) out.push(cur); cur = null; out.push({ op: ';' }); continue; }
      if (ch === '>') { if (cur !== null) out.push(cur); cur = null; if (line[i + 1] === '>') { out.push({ op: '>>' }); i++; } else out.push({ op: '>' }); continue; }
      if (ch === '\\' && i + 1 < line.length) { cur = (cur || '') + line[++i]; continue; }
      cur = (cur || '') + ch;
    }
    if (q) return { error: 'unexpected EOF while looking for matching `' + q + "'" };
    if (cur !== null) out.push(cur);
    return { tokens: out };
  }

  // ---------- YAML (подмножество, достаточное для .gitlab-ci.yml) ----------

  function yamlError(msg, line, col) {
    const e = new Error(`(<unknown>): ${msg} at line ${line} column ${col}`);
    e.yaml = true;
    return e;
  }
  function stripComment(s) {
    let q = null;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) { if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { if (i === 0 || /[\s:[{,-]/.test(s[i - 1])) q = ch; continue; }
      if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).replace(/\s+$/, '');
    }
    return s.replace(/\s+$/, '');
  }
  function splitFlow(s) {
    const parts = [];
    let depth = 0, q = null, cur = '';
    for (const ch of s) {
      if (q) { cur += ch; if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === '[' || ch === '{') depth++;
      if (ch === ']' || ch === '}') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  }
  function yamlScalar(raw, ln, col) {
    const s = raw.trim();
    if (s === '' || s === '~' || s === 'null') return null;
    if (s[0] === '"') {
      const m = s.match(/^"((?:[^"\\]|\\.)*)"$/);
      if (!m) throw yamlError("did not find expected key while parsing a block mapping", ln, col);
      return m[1].replace(/\\(.)/g, (x, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
    }
    if (s[0] === "'") {
      const m = s.match(/^'((?:[^']|'')*)'$/);
      if (!m) throw yamlError("did not find expected key while parsing a block mapping", ln, col);
      return m[1].replace(/''/g, "'");
    }
    if (s[0] === '[') {
      if (!s.endsWith(']')) throw yamlError("did not find expected ',' or ']' while parsing a flow sequence", ln, col);
      return splitFlow(s.slice(1, -1)).map((x) => yamlScalar(x, ln, col));
    }
    if (s[0] === '{') {
      if (!s.endsWith('}')) throw yamlError("did not find expected ',' or '}' while parsing a flow mapping", ln, col);
      const o = {};
      splitFlow(s.slice(1, -1)).forEach((kv) => {
        const k = kv.indexOf(':');
        if (k < 0) throw yamlError('could not find expected \':\' while scanning a simple key', ln, col);
        o[String(yamlScalar(kv.slice(0, k), ln, col))] = yamlScalar(kv.slice(k + 1), ln, col);
      });
      return o;
    }
    if (s[0] === '*' || s[0] === '&') throw yamlError('anchors and aliases are not supported by this editor', ln, col);
    const mv = s.indexOf(': ');
    if (mv >= 0) throw yamlError('mapping values are not allowed in this context', ln, col + mv + 1);
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
  }
  function parseYaml(text) {
    const lines = [];
    String(text).split('\n').forEach((raw, i) => {
      const tabAt = raw.match(/^ *\t/);
      if (tabAt) throw yamlError('found character that cannot start any token while scanning for the next token', i + 1, tabAt[0].length);
      const body = stripComment(raw);
      if (!body.trim()) return;
      const indent = body.match(/^ */)[0].length;
      lines.push({ indent, text: body.slice(indent), ln: i + 1, raw });
    });
    let pos = 0;
    const KEY = /^((?:"[^"]*"|'[^']*'|[^\s:'"#][^:#]*?|[^\s:'"#]))\s*:(?:\s+(.*)|$)/;

    function parseNode(indent) {
      const l = lines[pos];
      if (l.text === '-' || l.text.startsWith('- ')) return parseSeq(l.indent);
      return parseMap(l.indent);
    }
    function blockScalar(parentIndent, style) {
      const out = [];
      let minIndent = null;
      while (pos < lines.length && lines[pos].indent > parentIndent) {
        const l = lines[pos];
        if (minIndent === null) minIndent = l.indent;
        out.push(' '.repeat(l.indent - minIndent) + l.text);
        pos++;
      }
      return style === '|' ? out.join('\n') + '\n' : out.join(' ') + '\n';
    }
    function valueAfterKey(rest, ownIndent, ln, col) {
      if (rest == null || rest === '') {
        if (pos < lines.length && lines[pos].indent > ownIndent) return parseNode(lines[pos].indent);
        if (pos < lines.length && lines[pos].indent === ownIndent && (lines[pos].text === '-' || lines[pos].text.startsWith('- '))) return parseSeq(ownIndent);
        return null;
      }
      if (/^[|>][-+]?$/.test(rest)) return blockScalar(ownIndent, rest[0]);
      return yamlScalar(rest, ln, col);
    }
    function parseMap(indent) {
      const obj = {};
      while (pos < lines.length) {
        const l = lines[pos];
        if (l.indent < indent) break;
        if (l.indent > indent) {
          const ci = l.text.indexOf(':');
          throw yamlError(ci >= 0 ? 'mapping values are not allowed in this context' : 'did not find expected key while parsing a block mapping', l.ln, l.indent + (ci >= 0 ? ci + 1 : 1));
        }
        if (l.text === '-' || l.text.startsWith('- ')) throw yamlError("did not find expected key while parsing a block mapping", l.ln, l.indent + 1);
        const m = l.text.match(KEY);
        if (!m) throw yamlError("could not find expected ':' while scanning a simple key", l.ln + (pos + 1 < lines.length ? 1 : 0), 1);
        const key = String(yamlScalar(m[1], l.ln, l.indent + 1));
        pos++;
        obj[key] = valueAfterKey(m[2], indent, l.ln, l.indent + m[0].length - (m[2] || '').length + 1);
      }
      return obj;
    }
    function parseSeq(indent) {
      const arr = [];
      while (pos < lines.length) {
        const l = lines[pos];
        if (l.indent < indent) break;
        if (l.indent > indent) throw yamlError("did not find expected '-' indicator while parsing a block sequence", l.ln, l.indent + 1);
        if (!(l.text === '-' || l.text.startsWith('- '))) {
          if (l.indent === indent) break;
          throw yamlError("did not find expected '-' indicator while parsing a block sequence", l.ln, l.indent + 1);
        }
        const content = l.text.slice(1).replace(/^ +/, '');
        const cIndent = l.indent + (l.text.length - content.length);
        if (!content) { pos++; arr.push(pos < lines.length && lines[pos].indent > indent ? parseNode(lines[pos].indent) : null); continue; }
        if (KEY.test(content) && !/^["'[{]/.test(content)) {
          // элемент-словарь: подменяем строку и читаем словарь с отступом содержимого
          lines[pos] = { indent: cIndent, text: content, ln: l.ln };
          arr.push(parseMap(cIndent));
          continue;
        }
        pos++;
        if (/^[|>][-+]?$/.test(content)) arr.push(blockScalar(indent, content[0]));
        else arr.push(yamlScalar(content, l.ln, cIndent + 1));
      }
      return arr;
    }
    if (!lines.length) return {};
    const first = lines[0];
    if (first.indent !== 0) throw yamlError('did not find expected <document start>', first.ln, first.indent + 1);
    const root = parseNode(0);
    if (pos < lines.length) {
      const l = lines[pos];
      throw yamlError('did not find expected key while parsing a block mapping', l.ln, l.indent + 1);
    }
    return root;
  }

  // ---------- модель репозитория ----------
  // w.store — все коммиты (общие для локального и удалённого репозитория), w.L — локальный клон, w.R — проект в GitLab.

  const HOST = 'gitlab.academy.qa';
  const PROJECT = 'qa/shop';
  const REMOTE_URL = `git@${HOST}:${PROJECT}.git`;
  const WEB_URL = `https://${HOST}/${PROJECT}`;
  const ME = { name: 'QA Apprentice', email: 'apprentice@academy.qa' };
  const HOME = '/home/apprentice/shop';

  function createWorld() {
    return {
      store: {},
      clock: 0,
      L: {
        inited: true, heads: {}, tags: {}, head: { branch: 'main' }, work: {}, index: {}, tracking: {}, upstream: {},
        stash: [], merging: null, seq: null, unmerged: [], config: { 'user.name': ME.name, 'user.email': ME.email },
        reflog: [], hasRemote: true, prev: null,
      },
      R: { heads: {}, tags: {}, protectedBranches: ['main', 'release/*'], protectedTags: ['v*'] },
      hooks: {},
    };
  }

  const globRx = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  const isProtected = (w, name) => w.R.protectedBranches.some((p) => globRx(p).test(name));
  const isProtectedTag = (w, name) => w.R.protectedTags.some((p) => globRx(p).test(name));

  function mkCommit(w, tree, parents, msg, author, time) {
    w.clock += 7;
    const a = author || { name: w.L.config['user.name'] || ME.name, email: w.L.config['user.email'] || ME.email };
    const t = time || BASE_TIME + w.clock * 60e3;
    const hash = sha(JSON.stringify([parents, msg, a.name, t, w.clock, Object.keys(tree).sort().map((p) => p + ':' + fnv(tree[p], 7))]));
    w.store[hash] = { hash, parents: parents.filter(Boolean), tree: Object.assign({}, tree), msg, author: a.name, email: a.email, time: t };
    return hash;
  }
  const commitOf = (w, h) => (h ? w.store[h] : null);
  const treeOf = (w, h) => (h && w.store[h] ? w.store[h].tree : {});
  const subject = (c) => c.msg.split('\n')[0];
  const headHash = (w) => (w.L.head.branch ? w.L.heads[w.L.head.branch] : w.L.head.detached);
  const headTree = (w) => treeOf(w, headHash(w));
  const curBranch = (w) => w.L.head.branch || null;

  function ancestors(w, h) {
    const seen = new Set();
    const st = h ? [h] : [];
    while (st.length) {
      const x = st.pop();
      if (seen.has(x) || !w.store[x]) continue;
      seen.add(x);
      st.push(...w.store[x].parents);
    }
    return seen;
  }
  const isAncestor = (w, a, b) => !!a && ancestors(w, b).has(a);
  function mergeBase(w, a, b) {
    const anc = ancestors(w, a);
    // ближайший общий предок — самый поздний по времени
    const common = [...ancestors(w, b)].filter((x) => anc.has(x));
    if (!common.length) return null;
    const notBest = new Set();
    common.forEach((c) => w.store[c].parents.forEach((p) => ancestors(w, p).forEach((x) => notBest.add(x))));
    const best = common.filter((c) => !notBest.has(c));
    return best.sort((x, y) => w.store[y].time - w.store[x].time)[0];
  }
  function aheadBehind(w, a, b) {
    const A = ancestors(w, a), B = ancestors(w, b);
    return { ahead: [...A].filter((x) => !B.has(x)).length, behind: [...B].filter((x) => !A.has(x)).length };
  }
  // Коммиты, достижимые из include и не достижимые из exclude, новые сверху
  function revList(w, include, exclude) {
    const ex = new Set();
    (exclude || []).forEach((h) => ancestors(w, h).forEach((x) => ex.add(x)));
    const set = new Set();
    include.forEach((h) => ancestors(w, h).forEach((x) => { if (!ex.has(x)) set.add(x); }));
    return [...set].map((h) => w.store[h]).sort((x, y) => y.time - x.time);
  }
  function knownHashes(w) {
    const L = w.L;
    const roots = [...Object.values(L.heads), ...Object.values(L.tracking), ...Object.values(L.tags).map((t) => t.hash),
      ...L.stash.map((s) => s.base), ...L.reflog.map((r) => r.hash), headHash(w)];
    if (L.merging) roots.push(L.merging.theirs);
    const all = new Set();
    roots.filter(Boolean).forEach((h) => ancestors(w, h).forEach((x) => all.add(x)));
    return all;
  }
  function resolve(w, rev) {
    const L = w.L;
    if (!rev) return null;
    const m = String(rev).match(/^(.*?)((?:[~^]\d*)*)$/);
    let base = m[1];
    let h = null;
    if (base === 'HEAD' || base === '@' || base === '') h = base === '' ? null : headHash(w);
    else if (base.startsWith('refs/heads/')) h = L.heads[base.slice(11)];
    else if (base.startsWith('refs/tags/')) h = L.tags[base.slice(10)] && L.tags[base.slice(10)].hash;
    else if (L.heads[base]) h = L.heads[base];
    else if (L.tags[base]) h = L.tags[base].hash;
    else {
      const rb = base.replace(/^(refs\/)?remotes\//, '');
      if (L.hasRemote && rb.startsWith('origin/') && L.tracking[rb.slice(7)]) h = L.tracking[rb.slice(7)];
      else if (L.hasRemote && rb === 'origin') h = L.tracking.main;
      else if (L.head.branch && (base === '@{u}' || base === '@{upstream}') && L.upstream[L.head.branch]) h = L.tracking[L.upstream[L.head.branch]];
      else if (/^[0-9a-f]{4,40}$/.test(base)) {
        const hits = [...knownHashes(w)].filter((x) => x.startsWith(base));
        if (hits.length === 1) h = hits[0];
      }
    }
    if (!h) return null;
    const sfx = m[2].match(/[~^]\d*/g) || [];
    for (const s of sfx) {
      const n = s.length > 1 ? Number(s.slice(1)) : 1;
      if (s[0] === '~') {
        for (let i = 0; i < n; i++) { h = w.store[h].parents[0]; if (!h) return null; }
      } else if (n > 0) {
        h = w.store[h].parents[n - 1];
        if (!h) return null;
      }
    }
    return h;
  }

  function logRef(w, msg) { const h = headHash(w); if (h) w.L.reflog.unshift({ hash: h, msg }); }
  function setHead(w, h, msg) {
    if (w.L.head.branch) w.L.heads[w.L.head.branch] = h;
    else w.L.head.detached = h;
    logRef(w, msg);
  }
  function setWorkTree(w, tree) {
    w.L.work = Object.assign({}, tree);
    w.L.index = Object.assign({}, tree);
  }
  // Сохраняет неотслеживаемые файлы: заменяет только отслеживаемое содержимое
  function resetHard(w, tree) {
    const L = w.L;
    Object.keys(L.index).forEach((p) => { delete L.work[p]; });
    Object.keys(tree).forEach((p) => { L.work[p] = tree[p]; });
    L.index = Object.assign({}, tree);
    L.unmerged = [];
  }

  function ignoredFn(w) { return ignoreMatcher(w.L.work['.gitignore'] || ''); }

  // ---------- состояние рабочей копии ----------
  function statusData(w) {
    const L = w.L;
    const ht = headTree(w);
    const um = new Set(L.unmerged);
    const staged = changedPaths(ht, L.index).filter((p) => !um.has(p)).map((p) => ({ p, k: ht[p] == null ? 'new file' : L.index[p] == null ? 'deleted' : 'modified' }));
    const unstaged = Object.keys(L.index).filter((p) => !um.has(p) && L.work[p] !== L.index[p]).sort()
      .map((p) => ({ p, k: L.work[p] == null ? 'deleted' : 'modified' }));
    const ign = ignoredFn(w);
    const untrackedFiles = Object.keys(L.work).filter((p) => !(p in L.index) && !um.has(p)).sort();
    const visible = untrackedFiles.filter((p) => !ign(p));
    const tracked = Object.keys(L.index);
    // целиком неотслеживаемые папки показываем как «dir/»
    const untracked = [];
    visible.forEach((p) => {
      const parts = p.split('/');
      let shown = p;
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/') + '/';
        if (!tracked.some((t) => t.startsWith(dir))) { shown = dir; break; }
      }
      if (!untracked.includes(shown)) untracked.push(shown);
    });
    const conflicts = L.unmerged.slice().sort().map((p) => ({ p, k: ht[p] == null ? 'both added' : L.work[p] == null ? 'deleted by them' : 'both modified' }));
    return { staged, unstaged, untracked, conflicts, ignored: untrackedFiles.filter((p) => ign(p)) };
  }
  function trackingLines(w) {
    const L = w.L;
    const b = L.head.branch;
    if (!b || !L.upstream[b]) return [];
    const up = L.upstream[b];
    if (!L.tracking[up]) return [`Your branch is based on 'origin/${up}', but the upstream is gone.`, '  (use "git branch --unset-upstream" to fixup)'];
    const { ahead, behind } = aheadBehind(w, L.heads[b], L.tracking[up]);
    const pl = (n) => `${n} commit${n === 1 ? '' : 's'}`;
    if (!ahead && !behind) return [`Your branch is up to date with 'origin/${up}'.`];
    if (ahead && !behind) return [`Your branch is ahead of 'origin/${up}' by ${pl(ahead)}.`, '  (use "git push" to publish your local commits)'];
    if (!ahead && behind) return [`Your branch is behind 'origin/${up}' by ${pl(behind)}, and can be fast-forwarded.`, '  (use "git pull" to update your local branch)'];
    return [`Your branch and 'origin/${up}' have diverged,`, `and have ${ahead} and ${behind} different commits each, respectively.`, '  (use "git pull" if you want to integrate the remote branch with yours)'];
  }
  function statusText(w) {
    const L = w.L;
    const d = statusData(w);
    const out = [];
    if (L.head.branch) out.push(`On branch ${L.head.branch}`);
    else out.push(C.red(`HEAD detached at ${short(L.head.detached)}`));
    if (L.seq && L.seq.kind === 'rebase') out.push(`You are currently rebasing branch '${L.seq.branch}' on '${short(L.seq.onto)}'.`, d.conflicts.length ? '  (fix conflicts and then run "git rebase --continue")' : '  (all conflicts fixed: run "git rebase --continue")', '  (use "git rebase --skip" to skip this patch)', '  (use "git rebase --abort" to check out the original branch)', '');
    else if (L.seq) out.push(`You are currently ${L.seq.kind === 'revert' ? 'reverting' : 'cherry-picking'} commit ${short(L.seq.current.hash)}.`, d.conflicts.length ? `  (fix conflicts and run "git ${L.seq.kind} --continue")` : `  (all conflicts fixed: run "git ${L.seq.kind} --continue")`, `  (use "git ${L.seq.kind} --abort" to cancel the ${L.seq.kind} operation)`, '');
    else out.push(...trackingLines(w));
    if (!headHash(w)) out.push('', 'No commits yet');
    if (L.merging) {
      out.push(d.conflicts.length ? 'You have unmerged paths.\n  (fix conflicts and run "git commit")\n  (use "git merge --abort" to abort the merge)' : 'All conflicts fixed but you are still merging.\n  (use "git commit" to conclude merge)');
    }
    if (d.staged.length) {
      out.push('', 'Changes to be committed:', headHash(w) ? '  (use "git restore --staged <file>..." to unstage)' : '  (use "git rm --cached <file>..." to unstage)');
      d.staged.forEach((x) => out.push('\t' + C.green(`${(x.k + ':').padEnd(12)}${x.p}`)));
    }
    if (d.conflicts.length) {
      out.push('', 'Unmerged paths:', '  (use "git add <file>..." to mark resolution)');
      d.conflicts.forEach((x) => out.push('\t' + C.red(`${(x.k + ':').padEnd(17)}${x.p}`)));
    }
    if (d.unstaged.length) {
      out.push('', 'Changes not staged for commit:', '  (use "git add <file>..." to update what will be committed)', '  (use "git restore <file>..." to discard changes in working directory)');
      d.unstaged.forEach((x) => out.push('\t' + C.red(`${(x.k + ':').padEnd(12)}${x.p}`)));
    }
    if (d.untracked.length) {
      out.push('', 'Untracked files:', '  (use "git add <file>..." to include in what will be committed)');
      d.untracked.forEach((p) => out.push('\t' + C.red(p)));
    }
    out.push('');
    if (!d.staged.length && !d.conflicts.length) {
      if (d.unstaged.length) out.push('no changes added to commit (use "git add" and/or "git commit -a")');
      else if (d.untracked.length) out.push('nothing added to commit but untracked files present (use "git add" to track)');
      else if (!headHash(w)) out.push('nothing to commit (create/copy files and use "git add" to track)');
      else out.push('nothing to commit, working tree clean');
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
  }
  function isClean(w, includeUntracked) {
    const d = statusData(w);
    return !d.staged.length && !d.unstaged.length && !d.conflicts.length && (!includeUntracked || !d.untracked.length);
  }

  // Разбор путей (pathspec): файл, папка, '.', простые маски
  function matchPaths(w, spec, pool) {
    const s = spec.replace(/^\.\//, '').replace(/\/$/, '');
    if (s === '.' || s === '' || s === '*' || s === ':/') return pool.slice();
    if (/[*?]/.test(s)) {
      const rx = globRx(s);
      return pool.filter((p) => rx.test(p) || rx.test(p.split('/').pop()));
    }
    return pool.filter((p) => p === s || p.startsWith(s + '/'));
  }

  // ---------- переключение веток ----------
  function moveTo(w, target) {
    const L = w.L;
    const cur = headTree(w), tgt = treeOf(w, target);
    if (L.unmerged.length) return { error: `error: you need to resolve your current index first\n${L.unmerged.map((p) => `${p}: needs merge`).join('\n')}` };
    const local = [], untr = [];
    changedPaths(cur, tgt).forEach((p) => {
      if (L.work[p] === tgt[p] && L.index[p] === tgt[p]) return;
      if (cur[p] == null && L.index[p] == null && L.work[p] != null) untr.push(p);
      else if (L.work[p] !== cur[p] || L.index[p] !== cur[p]) local.push(p);
    });
    if (local.length) return { error: `error: Your local changes to the following files would be overwritten by checkout:\n${local.map((p) => '\t' + p).join('\n')}\nPlease commit your changes or stash them before you switch branches.\nAborting` };
    if (untr.length) return { error: `error: The following untracked working tree files would be overwritten by checkout:\n${untr.map((p) => '\t' + p).join('\n')}\nPlease move or remove them before you switch branches.\nAborting` };
    changedPaths(cur, tgt).forEach((p) => {
      if (tgt[p] == null) { delete L.work[p]; delete L.index[p]; } else { L.work[p] = tgt[p]; L.index[p] = tgt[p]; }
    });
    return {};
  }
  // локальные изменения, перенесённые при переключении
  function carriedLines(w) {
    const d = statusData(w);
    return d.staged.concat(d.unstaged).map((x) => `${x.k === 'deleted' ? 'D' : x.k === 'new file' ? 'A' : 'M'}\t${x.p}`);
  }
  function switchBranch(w, name, how) {
    const L = w.L;
    const prev = L.head.branch || short(L.head.detached);
    const r = moveTo(w, how && how.detach ? how.detach : L.heads[name]);
    if (r.error) return { out: r.error, code: 1 };
    L.prev = prev;
    const out = [];
    if (how && how.detach) {
      L.head = { detached: how.detach };
      out.push(...carriedLines(w));
      logRef(w, `checkout: moving from ${prev} to ${short(how.detach)}`);
      out.push(`Note: switching to '${how.rev}'.`, '', "You are in 'detached HEAD' state. You can look around, make experimental", 'changes and commit them, and you can discard any commits you make in this', 'state without impacting any branches by switching back to a branch.', '', `HEAD is now at ${short(how.detach)} ${subject(w.store[how.detach])}`);
      return { out: out.join('\n'), code: 0 };
    }
    const same = L.head.branch === name;
    L.head = { branch: name };
    out.push(...carriedLines(w));
    logRef(w, `checkout: moving from ${prev} to ${name}`);
    if (how && how.created) out.push(...(how.track ? [`branch '${name}' set up to track 'origin/${how.track}'.`] : []), `Switched to a new branch '${name}'`);
    else out.push(same ? `Already on '${name}'` : `Switched to branch '${name}'`);
    if (!(how && how.created && !how.track)) out.push(...trackingLines(w));
    return { out: out.join('\n'), code: 0 };
  }
  function validBranchName(n) {
    return !!n && !/[\s~^:?*[\\]|\.\.|@\{|\/\/|^[-/.]|[/.]$|\.lock$/.test(n) && n !== 'HEAD';
  }
  function createBranch(w, name, start) {
    const L = w.L;
    if (!validBranchName(name)) return { out: `fatal: '${name}' is not a valid branch name`, code: 128 };
    if (L.heads[name]) return { out: `fatal: a branch named '${name}' already exists`, code: 128 };
    const h = start ? resolve(w, start) : headHash(w);
    if (!h) return { out: start ? `fatal: not a valid object name: '${start}'` : `fatal: not a valid object name: '${curBranch(w) || 'HEAD'}'`, code: 128 };
    L.heads[name] = h;
    let track = null;
    const sm = start && start.match(/^(?:remotes\/)?origin\/(.+)$/);
    if (sm && L.tracking[sm[1]]) { L.upstream[name] = sm[1]; track = sm[1]; }
    return { code: 0, track };
  }

  // ---------- команды git ----------

  function flag(a, ...names) {
    let f = false;
    for (let i = a.length - 1; i >= 0; i--) if (names.includes(a[i])) { a.splice(i, 1); f = true; }
    return f;
  }
  // Значения опций: '-m msg', '--message=msg', '--message msg'
  function vals(a, ...names) {
    const out = [];
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      const n = names.find((nm) => x === nm || (nm.startsWith('--') && x.startsWith(nm + '=')));
      if (!n) continue;
      if (x === n) {
        if (i + 1 >= a.length) { out.missing = n; a.splice(i, 1); break; }
        out.push(a[i + 1]); a.splice(i, 2);
      } else { out.push(x.slice(n.length + 1)); a.splice(i, 1); }
      i--;
    }
    return out;
  }
  const missingVal = (n) => ({ out: `error: ${n.startsWith('--') ? 'option' : 'switch'} \`${n.replace(/^-+/, '')}' requires a value`, code: 129 });
  const ok = (out) => ({ out: out || '', code: 0 });
  const fail = (out, code) => ({ out, code: code || 1 });
  const needRepo = (w) => (w.L.inited ? null : fail('fatal: not a git repository (or any of the parent directories): .git', 128));
  const noCommits = (w) => fail(`fatal: your current branch '${curBranch(w) || 'main'}' does not have any commits yet`, 128);

  function decorations(w) {
    const L = w.L, map = {};
    const add = (h, s) => { if (h) (map[h] = map[h] || []).push(s); };
    const hh = headHash(w);
    if (L.head.branch) add(hh, C.cyan('HEAD -> ') + C.green(L.head.branch));
    else add(hh, C.cyan('HEAD'));
    Object.keys(L.tags).sort().forEach((t) => add(L.tags[t].hash, C.yellow('tag: ' + t)));
    if (L.hasRemote) Object.keys(L.tracking).sort().forEach((b) => add(L.tracking[b], C.red('origin/' + b)));
    Object.keys(L.heads).sort().forEach((b) => { if (b !== L.head.branch) add(L.heads[b], C.green(b)); });
    return map;
  }
  function decoStr(map, h) { return map[h] ? ` ${C.yellow('(')}${map[h].join(C.yellow(', '))}${C.yellow(')')}` : ''; }

  // Псевдографика --graph (упрощённый алгоритм git)
  function graphRows(commits, render) {
    const rows = [];
    let cols = [];
    const bars = (n) => Array(n).fill('|').join(' ');
    commits.forEach((c) => {
      let idx = cols.indexOf(c.hash);
      if (idx < 0) { cols.push(c.hash); idx = cols.length - 1; }
      // ветки, ожидающие этот же коммит, сходятся в него
      for (let j = cols.length - 1; j > idx; j--) {
        if (cols[j] !== c.hash) continue;
        let line = '';
        for (let i = 0; i < cols.length; i++) {
          if (i < j) line += (i ? ' ' : '') + '|';
          else if (i === j) line += '/';
          else line += ' /';
        }
        rows.push(line.replace(/\| \//, '|/'));
        cols.splice(j, 1);
      }
      const prefix = cols.map((h, i) => (i === idx ? '*' : '|')).join(' ');
      const body = render(c);
      const ps = c.parents;
      if (!ps.length) cols.splice(idx, 1);
      else {
        cols[idx] = ps[0];
        ps.slice(1).forEach((p, k) => { if (!cols.includes(p)) cols.splice(idx + 1 + k, 0, p); });
      }
      rows.push(prefix + ' ' + body[0]);
      if (ps.length > 1 && cols.length > 1) {
        const before = bars(idx + 1);
        rows.push((before + '\\' + ' \\'.repeat(Math.max(0, cols.length - idx - 2))).replace(/\\$/, '\\'));
      }
      body.slice(1).forEach((l) => rows.push((cols.length ? bars(cols.length) + ' ' : '  ') + l));
    });
    return rows;
  }

  function cmdLog(w, a) {
    const L = w.L;
    const oneline = flag(a, '--oneline');
    const graph = flag(a, '--graph');
    const all = flag(a, '--all');
    const patch = flag(a, '-p', '--patch');
    const stat = flag(a, '--stat');
    flag(a, '--decorate', '--no-merges');
    let max = Infinity;
    const n = vals(a, '-n', '--max-count');
    if (n.length) max = Number(n[0]);
    for (let i = a.length - 1; i >= 0; i--) if (/^-\d+$/.test(a[i])) { max = Number(a[i].slice(1)); a.splice(i, 1); }
    const authors = vals(a, '--author');
    const greps = vals(a, '--grep');
    vals(a, '--format', '--pretty');
    const dd = a.indexOf('--');
    let paths = [];
    if (dd >= 0) { paths = a.slice(dd + 1); a.splice(dd); }
    const bad = a.find((x) => x.startsWith('-'));
    if (bad) return fail(`fatal: unrecognized argument: ${bad}`, 128);
    const inc = [], exc = [];
    for (const r of a) {
      const m = r.match(/^(.*?)\.\.(.*)$/);
      if (m) {
        const x = resolve(w, m[1] || 'HEAD'), y = resolve(w, m[2] || 'HEAD');
        if (!x || !y) return fail(`fatal: ambiguous argument '${r}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`, 128);
        exc.push(x); inc.push(y);
      } else {
        const h = resolve(w, r.replace(/^\^/, ''));
        if (!h) {
          if (Object.prototype.hasOwnProperty.call(L.work, r) || Object.keys(L.index).some((p) => p.startsWith(r))) { paths.push(r); continue; }
          return fail(`fatal: ambiguous argument '${r}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`, 128);
        }
        (r.startsWith('^') ? exc : inc).push(h);
      }
    }
    if (all) inc.push(...Object.values(L.heads), ...Object.values(L.tracking), ...Object.values(L.tags).map((t) => t.hash));
    if (!inc.length) { if (!headHash(w)) return noCommits(w); inc.push(headHash(w)); }
    let list = revList(w, inc.filter(Boolean), exc);
    if (paths.length) list = list.filter((c) => changedPaths(treeOf(w, c.parents[0]), c.tree).some((p) => paths.some((q) => p === q || p.startsWith(q.replace(/\/$/, '') + '/'))));
    if (authors.length) list = list.filter((c) => authors.some((x) => (c.author + ' <' + c.email + '>').toLowerCase().includes(x.toLowerCase())));
    if (greps.length) list = list.filter((c) => greps.some((x) => c.msg.toLowerCase().includes(x.toLowerCase())));
    list = list.slice(0, max);
    const deco = decorations(w);
    const render = (c) => {
      if (oneline) {
        const l = [C.yellow(short(c.hash)) + decoStr(deco, c.hash) + ' ' + subject(c)];
        if (stat) l.push(...diffStat(treeOf(w, c.parents[0]), c.tree, true).split('\n'));
        if (patch) l.push(...treeDiff(treeOf(w, c.parents[0]), c.tree, true, paths).split('\n'));
        return l;
      }
      const l = [C.yellow('commit ' + c.hash) + decoStr(deco, c.hash)];
      if (c.parents.length > 1) l.push(`Merge: ${c.parents.map(short).join(' ')}`);
      l.push(`Author: ${c.author} <${c.email}>`, `Date:   ${gitDate(c.time)}`, '');
      c.msg.split('\n').forEach((m) => l.push('    ' + m));
      l.push('');
      if (stat && c.parents.length < 2) l.push(...diffStat(treeOf(w, c.parents[0]), c.tree, true).split('\n'), '');
      if (patch && c.parents.length < 2) l.push(...treeDiff(treeOf(w, c.parents[0]), c.tree, true, paths).split('\n'), '');
      return l;
    };
    const rows = graph ? graphRows(list, render) : [].concat(...list.map(render));
    return ok(rows.join('\n').replace(/\n+$/, ''));
  }

  function cmdDiff(w, a) {
    const L = w.L;
    const staged = flag(a, '--staged', '--cached');
    const stat = flag(a, '--stat');
    const nameOnly = flag(a, '--name-only');
    const nameStatus = flag(a, '--name-status');
    const dd = a.indexOf('--');
    let paths = [];
    if (dd >= 0) { paths = a.slice(dd + 1); a.splice(dd); }
    const revs = [];
    for (const r of a) {
      if (r.startsWith('-')) return fail(`error: invalid option: ${r}`, 129);
      const m = r.match(/^(.*?)(\.\.\.?)(.*)$/);
      if (m) {
        let x = resolve(w, m[1] || 'HEAD');
        const y = resolve(w, m[3] || 'HEAD');
        if (!x || !y) return fail(`fatal: ambiguous argument '${r}': unknown revision or path not in the working tree.`, 128);
        if (m[2] === '...') x = mergeBase(w, x, y);
        revs.push(x, y);
        continue;
      }
      const h = resolve(w, r);
      if (h) revs.push(h);
      else if (L.work[r] != null || L.index[r] != null || Object.keys(L.work).some((p) => p.startsWith(r.replace(/\/$/, '') + '/'))) paths.push(r);
      else return fail(`fatal: ambiguous argument '${r}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`, 128);
    }
    let t1, t2;
    if (revs.length >= 2) { t1 = treeOf(w, revs[0]); t2 = treeOf(w, revs[1]); }
    else if (staged) { t1 = revs.length ? treeOf(w, revs[0]) : headTree(w); t2 = L.index; }
    else if (revs.length === 1) {
      t1 = treeOf(w, revs[0]);
      t2 = {};
      Object.keys(L.work).forEach((p) => { if (p in L.index || p in t1) t2[p] = L.work[p]; });
    } else {
      t1 = L.index;
      t2 = {};
      Object.keys(L.index).forEach((p) => { if (L.work[p] != null) t2[p] = L.work[p]; });
      L.unmerged.forEach((p) => { if (L.work[p] != null) t2[p] = L.work[p]; });
    }
    const filt = (p) => !paths.length || paths.some((q) => p === q || p.startsWith(q.replace(/\/$/, '') + '/'));
    const ps = changedPaths(t1, t2).filter(filt);
    if (nameOnly) return ok(ps.join('\n'));
    if (nameStatus) return ok(ps.map((p) => `${t1[p] == null ? 'A' : t2[p] == null ? 'D' : 'M'}\t${p}`).join('\n'));
    if (stat) {
      const a1 = {}, a2 = {};
      ps.forEach((p) => { if (t1[p] != null) a1[p] = t1[p]; if (t2[p] != null) a2[p] = t2[p]; });
      return ok(diffStat(a1, a2, true));
    }
    return ok(ps.map((p) => fileDiff(p, t1[p], t2[p], true)).join('\n'));
  }

  function showCommit(w, c, stat) {
    const deco = decorations(w);
    const l = [C.yellow('commit ' + c.hash) + decoStr(deco, c.hash)];
    if (c.parents.length > 1) l.push(`Merge: ${c.parents.map(short).join(' ')}`);
    l.push(`Author: ${c.author} <${c.email}>`, `Date:   ${gitDate(c.time)}`, '');
    c.msg.split('\n').forEach((m) => l.push('    ' + m));
    if (c.parents.length < 2) {
      l.push('');
      l.push(stat ? diffStat(treeOf(w, c.parents[0]), c.tree, true) : treeDiff(treeOf(w, c.parents[0]), c.tree, true));
    }
    return l.join('\n').replace(/\n+$/, '');
  }
  function cmdShow(w, a) {
    const stat = flag(a, '--stat');
    flag(a, '--oneline', '-p');
    const rev = a[0] || 'HEAD';
    const pm = rev.match(/^([^:]*):(.+)$/);
    if (pm) {
      const h = resolve(w, pm[1] || 'HEAD');
      if (!h) return fail(`fatal: invalid object name '${pm[1]}'.`, 128);
      const t = treeOf(w, h);
      if (t[pm[2]] == null) return fail(`fatal: path '${pm[2]}' does not exist in '${pm[1] || 'HEAD'}'`, 128);
      return ok(t[pm[2]].replace(/\n$/, ''));
    }
    const h = resolve(w, rev);
    if (!h) return rev === 'HEAD' && !headHash(w) ? noCommits(w) : fail(`fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.`, 128);
    const tag = w.L.tags[rev];
    let pre = '';
    if (tag && tag.annotated) pre = `${C.yellow('tag ' + rev)}\nTagger: ${tag.tagger} <${ME.email}>\nDate:   ${gitDate(tag.time)}\n\n${tag.msg}\n\n`;
    return ok(pre + showCommit(w, w.store[h], stat));
  }

  function cmdBlame(w, a) {
    const path = a.filter((x) => !x.startsWith('-'))[0];
    if (!path) return fail('usage: git blame [<options>] [<rev-opts>] [<rev>] [--] <file>', 129);
    const h = headHash(w);
    if (!h) return noCommits(w);
    if (treeOf(w, h)[path] == null) return fail(`fatal: no such path '${path}' in HEAD`, 128);
    const chain = [];
    for (let x = h; x; x = w.store[x].parents[0]) chain.unshift(w.store[x]);
    let lines = [], attr = [];
    chain.forEach((c) => {
      const nl = toLines(c.tree[path]);
      const na = [];
      diffOps(lines, nl).forEach((o) => { if (o.t === '=') na[o.b] = attr[o.a]; else if (o.t === '+') na[o.b] = c; });
      lines = nl; attr = na;
    });
    const wd = Math.max(...attr.map((c) => c.author.length));
    return ok(lines.map((l, i) => {
      const c = attr[i];
      const d = new Date(c.time + 3 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
      return `${C.yellow(short(c.hash))} (${c.author.padEnd(wd)} ${d} +0300 ${String(i + 1).padStart(2)}) ${l}`;
    }).join('\n'));
  }

  function cmdAdd(w, a) {
    const L = w.L;
    const force = flag(a, '-f', '--force');
    const all = flag(a, '-A', '--all');
    const upd = flag(a, '-u', '--update');
    flag(a, '-v', '--verbose');
    const bad = a.find((x) => x.startsWith('-') && x !== '--');
    if (bad) return fail(`error: unknown option \`${bad.replace(/^-+/, '')}'`, 129);
    const specs = a.filter((x) => x !== '--');
    if (!specs.length && !all && !upd) return fail('Nothing specified, nothing added.\nhint: Maybe you wanted to say \'git add .\'?\nhint: Turn this message off by running\nhint: "git config advice.addEmptyPathspec false"', 0);
    const ign = ignoredFn(w);
    const pool = [...new Set(Object.keys(L.work).concat(Object.keys(L.index), L.unmerged))];
    let targets = [];
    const ignoredHit = [];
    if (all || upd) targets = pool.slice();
    for (const s of specs) {
      const m = matchPaths(w, s, pool);
      if (!m.length) return fail(`fatal: pathspec '${s}' did not match any files`, 128);
      const explicit = !/^\.?\/?$|^\*$/.test(s) && s !== '.';
      m.forEach((p) => {
        if (!(p in L.index) && L.work[p] != null && ign(p) && !force) { if (explicit) ignoredHit.push(p); return; }
        targets.push(p);
      });
    }
    targets.forEach((p) => {
      if (upd && !(p in L.index) && !L.unmerged.includes(p)) return;
      if (!(p in L.index) && L.work[p] != null && ign(p) && !force) return;
      if (L.work[p] == null) delete L.index[p];
      else L.index[p] = L.work[p];
      L.unmerged = L.unmerged.filter((x) => x !== p);
    });
    if (ignoredHit.length) {
      return fail(`The following paths are ignored by one of your .gitignore files:\n${[...new Set(ignoredHit.map((p) => { const top = p.split('/'); return top.length > 1 && ign(top[0] + '/x') ? top[0] : p; }))].join('\n')}\nhint: Use -f if you really want to add them.\nhint: Turn this message off by running\nhint: "git config advice.addIgnoredFile false"`, 1);
    }
    return ok('');
  }

  function cmdRm(w, a) {
    const L = w.L;
    const cached = flag(a, '--cached');
    const rec = flag(a, '-r');
    flag(a, '-f', '--force', '-q');
    const specs = a.filter((x) => x !== '--');
    if (!specs.length) return fail('usage: git rm [<options>] [--] <file>...', 129);
    const out = [];
    for (const s of specs) {
      const m = matchPaths(w, s, Object.keys(L.index));
      if (!m.length) return fail(`fatal: pathspec '${s}' did not match any files`, 128);
      if (m.length > 1 || m[0] !== s.replace(/\/$/, '')) { if (!rec && !/[*?]/.test(s) && s !== '.') return fail(`fatal: not removing '${s.replace(/\/$/, '')}' recursively without -r`, 128); }
      m.forEach((p) => { delete L.index[p]; if (!cached) delete L.work[p]; L.unmerged = L.unmerged.filter((x) => x !== p); out.push(`rm '${p}'`); });
    }
    return ok(out.join('\n'));
  }

  function cmdMv(w, a) {
    const L = w.L;
    const [src, dst] = a;
    if (!src || !dst) return fail('usage: git mv [<options>] <source>... <destination>', 129);
    if (!(src in L.index)) return fail(`fatal: not under version control, source=${src}, destination=${dst}`, 128);
    if (L.work[dst] != null) return fail(`fatal: destination exists, source=${src}, destination=${dst}`, 128);
    L.work[dst] = L.work[src]; L.index[dst] = L.index[src];
    delete L.work[src]; delete L.index[src];
    return ok('');
  }

  function commitSummary(w, h, root) {
    const L = w.L;
    const c = w.store[h];
    const where = L.head.branch ? L.head.branch + (root ? ' (root-commit)' : '') : 'detached HEAD';
    const pt = treeOf(w, c.parents[0]);
    const ps = changedPaths(pt, c.tree);
    let ins = 0, del = 0;
    ps.forEach((p) => { const s = lineStat(pt[p], c.tree[p]); ins += s.ins; del += s.del; });
    const lines = [`[${where} ${short(h)}] ${subject(c)}`, summaryLine(ps.length, ins, del)];
    ps.forEach((p) => { if (pt[p] == null) lines.push(` create mode 100644 ${p}`); else if (c.tree[p] == null) lines.push(` delete mode 100644 ${p}`); });
    return lines.join('\n');
  }

  function cmdCommit(w, a) {
    const L = w.L;
    // -am "msg" → -a -m "msg"
    for (let i = 0; i < a.length; i++) if (/^-[a-z]{2,}$/.test(a[i]) && a[i].endsWith('m') && !a[i].startsWith('--')) { a.splice(i, 1, ...a[i].slice(1).split('').map((c) => '-' + c)); }
    const msgs = vals(a, '-m', '--message');
    if (msgs.missing) return missingVal(msgs.missing);
    const all = flag(a, '-a', '--all');
    const amend = flag(a, '--amend');
    const noEdit = flag(a, '--no-edit');
    const allowEmpty = flag(a, '--allow-empty');
    flag(a, '-q', '--quiet', '-v', '--no-verify', '-s');
    if (a.length) {
      if (a[0].startsWith('-')) return fail(`error: unknown option \`${a[0].replace(/^-+/, '')}'`, 129);
      return fail(`error: pathspec '${a[0]}' did not match any file(s) known to git\nhint: Сообщение коммита пиши после -m в кавычках: git commit -m "Добавил тесты"`, 1);
    }
    if (L.unmerged.length) return fail('error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use \'git add/rm <file>\'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.', 128);
    if (all) Object.keys(L.index).forEach((p) => { if (L.work[p] == null) delete L.index[p]; else L.index[p] = L.work[p]; });
    const head = headHash(w);
    let msg = msgs.join('\n\n');
    if (amend) {
      if (!head) return fail('fatal: You have nothing to amend.', 128);
      const old = w.store[head];
      if (!msg) msg = old.msg;
      const h = mkCommit(w, L.index, old.parents, msg, { name: old.author, email: old.email });
      setHead(w, h, 'commit (amend): ' + subject(w.store[h]));
      w.hooks.commit && w.hooks.commit(h);
      return ok(`[${L.head.branch || 'detached HEAD'} ${short(h)}] ${subject(w.store[h])}\n Date: ${gitDate(old.time)}\n` + summaryLine(changedPaths(treeOf(w, old.parents[0]), L.index).length, 0, 0).replace(/, 0 insertions\(\+\)/, ''));
    }
    const seqPick = L.seq && L.seq.kind !== 'rebase' && L.seq.current ? L.seq.current : null;
    if (!msg && L.merging) msg = L.merging.msg;
    if (!msg && seqPick) msg = seqPick.msg;
    if (!msg && noEdit && head) msg = w.store[head].msg;
    const parents = [head];
    if (L.merging) parents.push(L.merging.theirs);
    const same = changedPaths(headTree(w), L.index).length === 0;
    if (same && !L.merging && !allowEmpty) {
      const d = statusData(w);
      const st = statusText(w).split('\n');
      return fail(st.join('\n') + (d.unstaged.length || d.untracked.length ? '' : ''), 1);
    }
    if (!msg || !msg.trim()) return fail('Aborting commit due to empty commit message.\n' + C.dim('hint: в этом терминале нет текстового редактора — передай сообщение через -m: git commit -m "Что сделано"'), 1);
    const h = mkCommit(w, L.index, parents, msg);
    setHead(w, h, (L.merging ? 'commit (merge): ' : head ? 'commit: ' : 'commit (initial): ') + subject(w.store[h]));
    L.merging = null;
    if (seqPick) { L.seq.current = null; if (!L.seq.todo.length) L.seq = null; }
    w.hooks.commit && w.hooks.commit(h);
    return ok(commitSummary(w, h, !head));
  }

  function cmdBranch(w, a) {
    const L = w.L;
    if (flag(a, '--show-current')) return ok(L.head.branch || '');
    const del = flag(a, '-d', '--delete');
    const DEL = flag(a, '-D');
    const all = flag(a, '-a', '--all');
    const rem = flag(a, '-r', '--remotes');
    const vv = flag(a, '-vv');
    const v = flag(a, '-v', '--verbose') || vv;
    const mv = flag(a, '-m', '--move', '-M');
    const merged = flag(a, '--merged');
    const ups = vals(a, '-u', '--set-upstream-to');
    if (flag(a, '--unset-upstream')) { delete L.upstream[L.head.branch]; return ok(''); }
    if (ups.length) {
      const m = ups[0].match(/^origin\/(.+)$/);
      if (!m || !L.tracking[m[1]]) return fail(`error: the requested upstream branch '${ups[0]}' does not exist`, 1);
      const b = a[0] || L.head.branch;
      L.upstream[b] = m[1];
      return ok(`branch '${b}' set up to track '${ups[0]}'.`);
    }
    if (del || DEL) {
      if (!a.length) return fail('fatal: branch name required', 128);
      const out = [];
      for (const b of a) {
        if (!L.heads[b]) return fail(`error: branch '${b}' not found`, 1);
        if (b === L.head.branch) return fail(`error: cannot delete branch '${b}' used by worktree at '${HOME}'`, 1);
        const up = L.upstream[b] && L.tracking[L.upstream[b]];
        if (!DEL && !isAncestor(w, L.heads[b], headHash(w)) && !(up && isAncestor(w, L.heads[b], up))) {
          return fail(`error: the branch '${b}' is not fully merged.\nhint: If you are sure you want to delete it, run 'git branch -D ${b}'\nhint: Disable this message with "git config advice.forceDeleteBranch false"`, 1);
        }
        out.push(`Deleted branch ${b} (was ${short(L.heads[b])}).`);
        delete L.heads[b]; delete L.upstream[b];
      }
      w.hooks.refs && w.hooks.refs();
      return ok(out.join('\n'));
    }
    if (mv) {
      const [x, y] = a.length > 1 ? a : [L.head.branch, a[0]];
      if (!y) return fail('fatal: branch name required', 128);
      if (!L.heads[x]) return fail(`error: refname refs/heads/${x} not found\nfatal: Branch rename failed`, 128);
      if (!validBranchName(y)) return fail(`fatal: '${y}' is not a valid branch name`, 128);
      if (L.heads[y]) return fail(`fatal: a branch named '${y}' already exists`, 128);
      L.heads[y] = L.heads[x]; delete L.heads[x];
      if (L.upstream[x]) { L.upstream[y] = L.upstream[x]; delete L.upstream[x]; }
      if (L.head.branch === x) L.head.branch = y;
      return ok('');
    }
    if (a.length && !a[0].startsWith('-')) {
      const r = createBranch(w, a[0], a[1]);
      if (r.code) return r;
      w.hooks.refs && w.hooks.refs();
      return ok(r.track ? `branch '${a[0]}' set up to track 'origin/${r.track}'.` : '');
    }
    if (a.length) return fail(`error: unknown option \`${a[0].replace(/^-+/, '')}'`, 129);
    const lines = [];
    if (!L.head.branch && L.head.detached) lines.push(`* ${C.green(`(HEAD detached at ${short(L.head.detached)})`)}`);
    const hh = headHash(w);
    if (!rem) {
      Object.keys(L.heads).sort().forEach((b) => {
        if (merged && !isAncestor(w, L.heads[b], hh)) return;
        const cur = b === L.head.branch;
        let s = (cur ? '* ' + C.green(b) : '  ' + b);
        if (v) {
          const c = w.store[L.heads[b]];
          let tr = '';
          if (L.upstream[b]) {
            const up = L.tracking[L.upstream[b]];
            if (!up) tr = `[origin/${L.upstream[b]}: gone] `;
            else {
              const ab = aheadBehind(w, L.heads[b], up);
              const st = [ab.ahead ? `ahead ${ab.ahead}` : '', ab.behind ? `behind ${ab.behind}` : ''].filter(Boolean).join(', ');
              tr = vv ? `[${C.blue('origin/' + L.upstream[b])}${st ? ': ' + st : ''}] ` : st ? `[${st}] ` : '';
            }
          }
          s = s.padEnd(30 + (cur ? 9 : 0)) + ` ${C.yellow(short(c.hash))} ${tr}${subject(c)}`;
        }
        lines.push(s);
      });
    }
    if ((all || rem) && L.hasRemote) {
      Object.keys(L.tracking).sort().forEach((b) => lines.push('  ' + C.red((all ? 'remotes/' : '') + 'origin/' + b)));
    }
    return ok(lines.join('\n'));
  }

  function cmdSwitch(w, a, isCheckout) {
    const L = w.L;
    if (isCheckout) {
      const dd = a.indexOf('--');
      if (dd >= 0) return cmdRestore(w, dd > 0 ? ['--source', a[0], '--staged', '--worktree'].concat(a.slice(dd + 1)) : a.slice(dd + 1));
    }
    const cre = vals(a, '-c', '--create', '-b');
    const CRE = vals(a, '-C', '-B');
    if (cre.missing || CRE.missing) return missingVal(cre.missing || CRE.missing);
    const det = flag(a, '--detach', '-d');
    flag(a, '--track', '-t', '-q');
    const bad = a.find((x) => x.startsWith('-') && x !== '-');
    if (bad) return fail(`error: unknown switch \`${bad.replace(/^-+/, '')}'`, 129);
    const name = cre[0] || CRE[0];
    if (name) {
      if (CRE.length && L.heads[name]) delete L.heads[name];
      const r = createBranch(w, name, a[0]);
      if (r.code) return r;
      const s = switchBranch(w, name, { created: true, track: r.track });
      if (s.code) delete L.heads[name];
      w.hooks.refs && w.hooks.refs();
      return s;
    }
    let target = a[0];
    if (!target) return fail(isCheckout ? '' : 'fatal: missing branch or commit argument', isCheckout ? 0 : 128);
    if (target === '-') {
      if (!L.prev) return fail('fatal: no previous branch', 128);
      target = L.prev;
    }
    if (!det && L.heads[target]) return switchBranch(w, target);
    if (!det && L.hasRemote && L.tracking[target] && !L.heads[target]) {
      L.heads[target] = L.tracking[target];
      L.upstream[target] = target;
      const s = switchBranch(w, target, { created: true, track: target });
      if (s.code) { delete L.heads[target]; delete L.upstream[target]; }
      w.hooks.refs && w.hooks.refs();
      return s;
    }
    const h = resolve(w, target);
    if (h && (det || isCheckout)) return switchBranch(w, null, { detach: h, rev: target });
    if (h) return fail(`fatal: a branch is expected, got ${L.tracking[target.replace(/^origin\//, '')] ? 'remote branch' : 'commit'} '${target}'\nhint: If you want to detach HEAD at the commit, try again with the --detach option.`, 128);
    if (isCheckout) {
      // checkout <файл> — как restore
      const pool = Object.keys(L.index);
      if (matchPaths(w, target, pool).length) return cmdRestore(w, a);
      return fail(`error: pathspec '${target}' did not match any file(s) known to git`, 1);
    }
    return fail(`fatal: invalid reference: ${target}`, 128);
  }

  function cmdRestore(w, a) {
    const L = w.L;
    const src = vals(a, '--source', '-s');
    let staged = flag(a, '--staged', '-S');
    let wt = flag(a, '--worktree', '-W');
    if (!staged && !wt) wt = true;
    const specs = a.filter((x) => x !== '--');
    if (!specs.length) return fail('fatal: you must specify path(s) to restore', 128);
    let srcTree;
    if (src.length) {
      const h = resolve(w, src[0]);
      if (!h) return fail(`fatal: could not resolve ${src[0]}`, 128);
      srcTree = treeOf(w, h);
    }
    const ht = headTree(w);
    for (const s of specs) {
      const pool = [...new Set(Object.keys(L.index).concat(Object.keys(ht), srcTree ? Object.keys(srcTree) : [], L.unmerged))];
      const m = matchPaths(w, s, pool);
      if (!m.length) return fail(`error: pathspec '${s}' did not match any file(s) known to git`, 1);
      for (const p of m) {
        if (wt && !staged && L.unmerged.includes(p) && !src.length) return fail(`error: path '${p}' is unmerged`, 1);
      }
      m.forEach((p) => {
        if (staged) {
          const from = srcTree || ht;
          if (from[p] == null) delete L.index[p]; else L.index[p] = from[p];
          L.unmerged = L.unmerged.filter((x) => x !== p);
        }
        if (wt) {
          const from = srcTree || (staged ? ht : L.index);
          if (from[p] == null) { if (srcTree || staged) delete L.work[p]; } else L.work[p] = from[p];
        }
      });
    }
    return ok('');
  }

  function cmdReset(w, a) {
    const L = w.L;
    const soft = flag(a, '--soft');
    const hard = flag(a, '--hard');
    flag(a, '--mixed', '-q');
    const dd = a.indexOf('--');
    let paths = [];
    if (dd >= 0) { paths = a.slice(dd + 1); a.splice(dd); }
    let rev = 'HEAD';
    if (a.length) {
      if (resolve(w, a[0])) rev = a.shift();
      paths = paths.concat(a);
    }
    const h = resolve(w, rev);
    if (!h) return headHash(w) ? fail(`fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.`, 128) : (paths.length ? (() => { paths.forEach((p) => delete L.index[p]); return ok(''); })() : fail("fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.", 128));
    if (paths.length) {
      if (soft || hard) return fail(`fatal: Cannot do ${soft ? 'soft' : 'hard'} reset with paths.`, 128);
      const t = treeOf(w, h);
      for (const s of paths) {
        const m = matchPaths(w, s, [...new Set(Object.keys(L.index).concat(Object.keys(t)))]);
        if (!m.length) return fail(`fatal: ambiguous argument '${s}': unknown revision or path not in the working tree.`, 128);
        m.forEach((p) => { if (t[p] == null) delete L.index[p]; else L.index[p] = t[p]; L.unmerged = L.unmerged.filter((x) => x !== p); });
      }
      const un = statusData(w).unstaged;
      return ok(un.length ? 'Unstaged changes after reset:\n' + un.map((x) => `${x.k === 'deleted' ? 'D' : 'M'}\t${x.p}`).join('\n') : '');
    }
    const t = treeOf(w, h);
    setHead(w, h, `reset: moving to ${rev}`);
    if (hard) {
      resetHard(w, t);
      L.merging = null; L.seq = null;
      w.hooks.refs && w.hooks.refs();
      return ok(`HEAD is now at ${short(h)} ${subject(w.store[h])}`);
    }
    if (!soft) { L.index = Object.assign({}, t); L.unmerged = []; L.merging = null; }
    w.hooks.refs && w.hooks.refs();
    const un = statusData(w).unstaged;
    return ok(!soft && un.length ? 'Unstaged changes after reset:\n' + un.map((x) => `${x.k === 'deleted' ? 'D' : 'M'}\t${x.p}`).join('\n') : '');
  }

  // ---------- слияния ----------
  function mergeTrees(base, ours, theirs, labelO, labelT) {
    const res = {}, conflicts = [], auto = [], msgs = [];
    new Set(Object.keys(base).concat(Object.keys(ours), Object.keys(theirs))).forEach((p) => {
      const b = base[p], o = ours[p], t = theirs[p];
      let v;
      if (o === t) v = o;
      else if (b === o) v = t;
      else if (b === t) v = o;
      else if (o != null && t != null) {
        auto.push(p);
        const m = merge3(b || '', o, t, labelO, labelT);
        v = m.text;
        if (m.conflict) { conflicts.push(p); msgs.push(`CONFLICT (${b == null ? 'add/add' : 'content'}): Merge conflict in ${p}`); }
      } else {
        v = o != null ? o : t;
        conflicts.push(p);
        msgs.push(`CONFLICT (modify/delete): ${p} deleted in ${o == null ? 'HEAD' : labelT} and modified in ${o == null ? labelT : 'HEAD'}. Version ${o == null ? labelT : 'HEAD'} of ${p} left in tree.`);
      }
      if (v != null) res[p] = v;
    });
    return { tree: res, conflicts: conflicts.sort(), auto: auto.sort(), msgs };
  }
  // Локальные правки в файлах, которые затронет операция
  function dirtyTouched(w, paths) {
    const L = w.L, ht = headTree(w);
    return paths.filter((p) => L.work[p] !== ht[p] || L.index[p] !== ht[p]);
  }
  function applyMerge(w, ours, res) {
    const L = w.L;
    changedPaths(ours, res.tree).concat(res.conflicts).forEach((p) => {
      if (res.tree[p] == null) { delete L.work[p]; delete L.index[p]; } else L.work[p] = res.tree[p];
      if (!res.conflicts.includes(p) && res.tree[p] != null) L.index[p] = res.tree[p];
    });
    L.unmerged = res.conflicts.slice();
  }
  function mergedTree(res) {
    const t = Object.assign({}, res.tree);
    return t;
  }

  function doMerge(w, theirs, label, o) {
    const L = w.L;
    const ours = headHash(w);
    if (!ours) {
      setWorkTree(w, treeOf(w, theirs));
      setHead(w, theirs, 'merge');
      return ok('');
    }
    if (isAncestor(w, theirs, ours)) return ok('Already up to date.');
    const oursT = headTree(w), theirsT = treeOf(w, theirs);
    if (isAncestor(w, ours, theirs) && !o.noff) {
      const d = dirtyTouched(w, changedPaths(oursT, theirsT));
      if (d.length) return fail(`error: Your local changes to the following files would be overwritten by merge:\n${d.map((p) => '\t' + p).join('\n')}\nPlease commit your changes or stash them before you merge.\nAborting\nUpdating ${short(ours)}..${short(theirs)}`, 1);
      moveTo(w, theirs);
      setHead(w, theirs, `merge ${label}: Fast-forward`);
      w.hooks.refs && w.hooks.refs();
      return ok(`Updating ${short(ours)}..${short(theirs)}\nFast-forward\n${diffStat(oursT, theirsT, true)}`);
    }
    if (o.ffOnly) return fail('fatal: Not possible to fast-forward, aborting.', 128);
    const base = mergeBase(w, ours, theirs);
    const res = mergeTrees(treeOf(w, base), oursT, theirsT, 'HEAD', label);
    const d = dirtyTouched(w, changedPaths(oursT, res.tree).concat(res.conflicts));
    if (d.length || statusData(w).staged.length) return fail(`error: Your local changes to the following files would be overwritten by merge:\n${(d.length ? d : statusData(w).staged.map((x) => x.p)).map((p) => '\t' + p).join('\n')}\nPlease commit your changes or stash them before you merge.\nAborting`, 1);
    applyMerge(w, oursT, res);
    const msg = o.msg || `Merge ${o.kind || 'branch'} '${label}'${L.head.branch && L.head.branch !== 'main' && !o.pull ? ` into ${L.head.branch}` : ''}`;
    const out = res.auto.map((p) => `Auto-merging ${p}`).concat(res.msgs);
    if (res.conflicts.length) {
      L.merging = { theirs, msg };
      out.push('Automatic merge failed; fix conflicts and then commit the result.');
      w.hooks.conflict && w.hooks.conflict(res.conflicts);
      return fail(out.join('\n'), 1);
    }
    const h = mkCommit(w, mergedTree(res), [ours, theirs], msg);
    setHead(w, h, `merge ${label}: Merge made by the 'ort' strategy.`);
    w.hooks.commit && w.hooks.commit(h);
    out.push("Merge made by the 'ort' strategy.", diffStat(oursT, res.tree, true));
    return ok(out.join('\n'));
  }

  function cmdMerge(w, a) {
    const L = w.L;
    if (flag(a, '--abort')) {
      if (!L.merging) return fail('fatal: There is no merge to abort (MERGE_HEAD missing).', 128);
      resetHard(w, headTree(w));
      L.merging = null;
      return ok('');
    }
    if (flag(a, '--continue')) {
      if (!L.merging) return fail('fatal: There is no merge in progress (MERGE_HEAD missing).', 128);
      return cmdCommit(w, []);
    }
    const noff = flag(a, '--no-ff');
    const ffOnly = flag(a, '--ff-only');
    flag(a, '--no-edit', '--ff');
    const msgs = vals(a, '-m');
    if (msgs.missing) return missingVal(msgs.missing);
    if (L.merging) return fail('error: Merging is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use \'git add/rm <file>\'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.', 128);
    if (!a.length) return fail(L.head.branch && L.upstream[L.head.branch] ? '' : 'fatal: No remote for the current branch.', 128);
    const th = resolve(w, a[0]);
    if (!th) return fail(`merge: ${a[0]} - not something we can merge`, 1);
    const isRemote = /^origin\//.test(a[0]);
    return doMerge(w, th, a[0], { noff, ffOnly, msg: msgs.join('\n\n'), kind: isRemote ? 'remote-tracking branch' : L.heads[a[0]] ? 'branch' : 'commit' });
  }

  // Последовательное применение коммитов: rebase, cherry-pick, revert
  function pickOne(w, c, mode) {
    const parent = c.parents[0];
    const base = mode === 'revert' ? c.tree : treeOf(w, parent);
    const theirs = mode === 'revert' ? treeOf(w, parent) : c.tree;
    const ours = headTree(w);
    const label = mode === 'revert' ? `parent of ${short(c.hash)} (${subject(c)})` : `${short(c.hash)} (${subject(c)})`;
    const res = mergeTrees(base, ours, theirs, 'HEAD', label);
    applyMerge(w, ours, res);
    if (res.conflicts.length) return { conflict: true, res };
    if (!changedPaths(ours, res.tree).length) return { empty: true, res };
    const msg = mode === 'revert' ? `Revert "${subject(c)}"\n\nThis reverts commit ${c.hash}.` : c.msg;
    const h = mkCommit(w, res.tree, [headHash(w)], msg, mode === 'revert' ? null : { name: c.author, email: c.email });
    setHead(w, h, `${mode === 'revert' ? 'revert' : mode === 'rebase' ? 'rebase (pick)' : 'cherry-pick'}: ${subject(w.store[h])}`);
    w.hooks.commit && w.hooks.commit(h);
    return { hash: h, res };
  }
  function runSeq(w, out) {
    const L = w.L;
    const s = L.seq;
    while (s.todo.length) {
      const item = s.todo.shift();
      s.current = item.c;
      s.done++;
      const r = pickOne(w, item.c, s.kind === 'revert' ? 'revert' : s.kind === 'rebase' ? 'rebase' : 'pick');
      out.push(...r.res.auto.map((p) => `Auto-merging ${p}`), ...r.res.msgs);
      if (r.conflict) {
        const k = s.kind;
        if (k === 'rebase') {
          out.push(`error: could not apply ${short(item.c.hash)}... ${subject(item.c)}`, 'hint: Resolve all conflicts manually, mark them as resolved with', 'hint: "git add/rm <conflicted_files>", then run "git rebase --continue".', 'hint: You can instead skip this commit: run "git rebase --skip".', 'hint: To abort and get back to the state before "git rebase", run "git rebase --abort".', `Could not apply ${short(item.c.hash)}... ${subject(item.c)}`);
        } else {
          out.push(`error: could not ${k === 'revert' ? 'revert' : 'apply'} ${short(item.c.hash)}... ${subject(item.c)}`, 'hint: After resolving the conflicts, mark them with', 'hint: "git add/rm <pathspec>", then run', `hint: "git ${k} --continue".`, `hint: You can instead skip this commit with "git ${k} --skip".`, `hint: To abort and get back to the state before "git ${k}",`, `hint: run "git ${k} --abort".`);
        }
        w.hooks.conflict && w.hooks.conflict(r.res.conflicts);
        return fail(out.join('\n'), 1);
      }
      if (r.empty) {
        if (s.kind !== 'rebase') out.push(`The previous ${s.kind} is now empty, possibly due to conflict resolution.`, `Skipping ${short(item.c.hash)}`);
        continue;
      }
      if (s.kind !== 'rebase') out.push(commitSummary(w, r.hash));
    }
    s.current = null;
    if (s.kind === 'rebase') out.push(`Successfully rebased and updated refs/heads/${s.branch}.`);
    L.seq = null;
    w.hooks.refs && w.hooks.refs();
    return ok(out.join('\n'));
  }
  function seqControl(w, a, kind) {
    const L = w.L;
    const act = ['--continue', '--abort', '--skip', '--quit'].find((x) => a.includes(x));
    if (!act) return null;
    if (!L.seq || L.seq.kind !== kind) {
      return fail(kind === 'rebase' ? 'fatal: No rebase in progress?' : `error: no ${kind} in progress\nfatal: ${kind} failed`, 128);
    }
    const s = L.seq;
    if (act === '--abort' || act === '--quit') {
      if (act === '--abort') {
        if (s.branch) L.heads[s.branch] = s.origHead; else L.head.detached = s.origHead;
        resetHard(w, treeOf(w, s.origHead));
      }
      L.seq = null;
      w.hooks.refs && w.hooks.refs();
      return ok('');
    }
    if (act === '--skip') {
      resetHard(w, headTree(w));
      return runSeq(w, []);
    }
    if (L.unmerged.length) {
      return fail(kind === 'rebase' ? `${L.unmerged.join(': needs merge\n')}: needs merge\nYou must edit all merge conflicts and then\nmark them as resolved using git add` : `error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.`, 1);
    }
    const out = [];
    if (s.current && changedPaths(headTree(w), w.L.index).length) {
      const c = s.current;
      const msg = kind === 'revert' ? `Revert "${subject(c)}"\n\nThis reverts commit ${c.hash}.` : c.msg;
      const h = mkCommit(w, L.index, [headHash(w)], msg, kind === 'revert' ? null : { name: c.author, email: c.email });
      setHead(w, h, `${kind} (continue): ${subject(w.store[h])}`);
      w.hooks.commit && w.hooks.commit(h);
      if (kind !== 'rebase') out.push(commitSummary(w, h));
      else out.push(`[detached HEAD ${short(h)}] ${subject(w.store[h])}`, summaryLine(changedPaths(treeOf(w, w.store[h].parents[0]), w.store[h].tree).length, 0, 0).replace(/, 0 insertions\(\+\)/, ''));
    }
    s.current = null;
    return runSeq(w, out);
  }

  function cmdRebase(w, a) {
    const L = w.L;
    const ctl = seqControl(w, a, 'rebase');
    if (ctl) return ctl;
    if (flag(a, '-i', '--interactive')) return fail('error: интерактивный rebase (-i) в этом тренажёре не поддерживается — используй обычный git rebase <ветка>', 1);
    const onto = vals(a, '--onto');
    if (L.seq) return fail(`fatal: It seems that there is already a rebase-merge directory, and\nI wonder if you are in the middle of another rebase.  If that is the\ncase, please try\n\tgit rebase (--continue | --abort | --skip)`, 128);
    if (L.merging) return fail('error: cannot rebase: You have unmerged paths... — сначала заверши merge.', 1);
    let upName = a[0];
    if (!upName) {
      if (!L.head.branch || !L.upstream[L.head.branch]) return fail('There is no tracking information for the current branch.\nPlease specify which branch you want to rebase against.\nSee git-rebase(1) for details.\n\n    git rebase \'<branch>\'', 1);
      upName = 'origin/' + L.upstream[L.head.branch];
    }
    const up = resolve(w, upName);
    if (!up) return fail(`fatal: invalid upstream '${upName}'`, 128);
    if (!L.head.branch) return fail('fatal: в этом тренажёре rebase работает только на ветке (не в detached HEAD)', 128);
    const d = statusData(w);
    if (d.unstaged.length || d.staged.length) return fail(`error: cannot rebase: You have ${d.unstaged.length ? 'unstaged' : 'uncommitted'} changes.\nerror: Please commit or stash them.`, 1);
    const head = headHash(w);
    const newBase = onto.length ? resolve(w, onto[0]) : up;
    if (isAncestor(w, newBase, head) && !onto.length && mergeBase(w, head, up) === up) return ok(`Current branch ${L.head.branch} is up to date.`);
    const todo = revList(w, [head], [up]).filter((c) => c.parents.length < 2).reverse();
    const origHead = head;
    L.seq = { kind: 'rebase', branch: L.head.branch, onto: newBase, origHead, todo: todo.map((c) => ({ c })), done: 0, total: todo.length, current: null };
    moveTo(w, newBase);
    L.heads[L.head.branch] = newBase;
    logRef(w, `rebase (start): checkout ${upName}`);
    return runSeq(w, []);
  }

  function cmdPick(w, a, kind) {
    const L = w.L;
    const ctl = seqControl(w, a, kind);
    if (ctl) return ctl;
    flag(a, '--no-edit', '-x', '--edit');
    const mainline = vals(a, '-m', '--mainline');
    if (!a.length) return fail(`usage: git ${kind} [<options>] <commit-ish>...`, 129);
    if (L.seq || L.merging) return fail(`error: ${kind} is not possible because you have unmerged files.\nfatal: ${kind} failed`, 128);
    const cs = [];
    for (const r of a) {
      const m = r.match(/^(.*?)\.\.(.*)$/);
      if (m) {
        const x = resolve(w, m[1]), y = resolve(w, m[2] || 'HEAD');
        if (!x || !y) return fail(`fatal: bad revision '${r}'`, 128);
        cs.push(...revList(w, [y], [x]).reverse());
        continue;
      }
      const h = resolve(w, r);
      if (!h) return fail(`fatal: bad revision '${r}'`, 128);
      cs.push(w.store[h]);
    }
    for (const c of cs) {
      if (c.parents.length > 1 && !mainline.length) return fail(`error: commit ${c.hash} is a merge but no -m option was given.\nfatal: ${kind} failed`, 128);
    }
    if (statusData(w).staged.length || dirtyTouched(w, [].concat(...cs.map((c) => changedPaths(treeOf(w, c.parents[0]), c.tree)))).length) {
      return fail(`error: your local changes would be overwritten by ${kind}.\nhint: commit your changes or stash them to proceed.\nfatal: ${kind} failed`, 128);
    }
    if (!headHash(w)) return fail(`fatal: ${kind} into an empty head is not supported here`, 128);
    L.seq = { kind, branch: L.head.branch, origHead: headHash(w), todo: cs.map((c) => ({ c })), done: 0, total: cs.length, current: null };
    return runSeq(w, []);
  }

  // ---------- stash ----------
  function cmdStash(w, a) {
    const L = w.L;
    const sub = a[0] && !a[0].startsWith('-') ? a.shift() : 'push';
    const ref = (x) => {
      const m = (x || 'stash@{0}').match(/^(?:stash@\{(\d+)\}|(\d+))$/);
      return m ? Number(m[1] || m[2]) : -1;
    };
    if (sub === 'list') return ok(L.stash.map((s, i) => `stash@{${i}}: ${s.msg}`).join('\n'));
    if (sub === 'push' || sub === 'save') {
      const u = flag(a, '-u', '--include-untracked');
      let msg = vals(a, '-m', '--message')[0] || (sub === 'save' && a.length ? a.join(' ') : '');
      if (!headHash(w)) return fail('You do not have the initial commit yet', 1);
      if (L.unmerged.length) return fail(`${L.unmerged.map((p) => p + ': needs merge').join('\n')}\nerror: could not save index state`, 1);
      const d = statusData(w);
      const untr = u ? Object.keys(L.work).filter((p) => !(p in L.index) && !ignoredFn(w)(p)) : [];
      if (!d.staged.length && !d.unstaged.length && !untr.length) return ok('No local changes to save');
      const h = headHash(w);
      const where = `${L.head.branch || '(no branch)'}: ${short(h)} ${subject(w.store[h])}`;
      msg = msg ? `On ${L.head.branch}: ${msg}` : `WIP on ${where}`;
      const work = {};
      Object.keys(L.index).forEach((p) => { if (L.work[p] != null) work[p] = L.work[p]; });
      untr.forEach((p) => { work[p] = L.work[p]; });
      L.stash.unshift({ msg, base: h, index: Object.assign({}, L.index), work, untracked: untr, hash: sha('stash' + msg + w.clock++) });
      untr.forEach((p) => { delete L.work[p]; });
      resetHard(w, headTree(w));
      return ok(`Saved working directory and index state ${msg}`);
    }
    if (sub === 'show') {
      const i = ref(a.find((x) => !x.startsWith('-')));
      const s = L.stash[i];
      if (!s) return fail(i < 0 ? `error: unknown option` : `error: stash@{${i}} is not a valid reference`, 1);
      const bt = treeOf(w, s.base);
      return ok(a.includes('-p') ? treeDiff(bt, s.work, true) : diffStat(bt, s.work, true));
    }
    if (sub === 'drop' || sub === 'clear') {
      if (sub === 'clear') { L.stash = []; return ok(''); }
      const i = ref(a[0]);
      if (!L.stash[i]) return fail(L.stash.length ? `error: stash@{${i}} is not a valid reference` : 'No stash entries found.', 1);
      const s = L.stash.splice(i, 1)[0];
      return ok(`Dropped refs/stash@{${i}} (${s.hash})`);
    }
    if (sub === 'pop' || sub === 'apply') {
      const i = ref(a[0]);
      if (!L.stash.length) return fail('No stash entries found.', 1);
      const s = L.stash[i];
      if (!s) return fail(`error: stash@{${i}} is not a valid reference`, 1);
      const bt = treeOf(w, s.base), ht = headTree(w);
      const changed = changedPaths(bt, s.work);
      const dirty = dirtyTouched(w, changed).filter((p) => !(s.untracked.includes(p) && L.work[p] == null));
      const untrClash = s.untracked.filter((p) => L.work[p] != null && L.work[p] !== s.work[p]);
      if (dirty.length || untrClash.length) return fail(`error: Your local changes to the following files would be overwritten by merge:\n${dirty.concat(untrClash).map((p) => '\t' + p).join('\n')}\nPlease commit your changes or stash them before you merge.\nAborting\nThe stash entry is kept in case you need it again.`, 1);
      const res = mergeTrees(bt, ht, s.work, 'Updated upstream', 'Stashed changes');
      const out = res.auto.map((p) => `Auto-merging ${p}`).concat(res.msgs);
      changed.forEach((p) => {
        const v = res.tree[p];
        if (v == null) delete L.work[p]; else L.work[p] = v;
        if (bt[p] == null && !s.untracked.includes(p) && v != null && !res.conflicts.includes(p)) L.index[p] = v;
      });
      L.unmerged = res.conflicts.slice();
      if (res.conflicts.length) {
        out.push('On branch ' + (L.head.branch || 'HEAD'), 'The stash entry is kept in case you need it again.');
        w.hooks.conflict && w.hooks.conflict(res.conflicts);
        return fail(out.join('\n'), 1);
      }
      out.push(statusText(w));
      if (sub === 'pop') { L.stash.splice(i, 1); out.push(`Dropped refs/stash@{${i}} (${s.hash})`); }
      return ok(out.join('\n'));
    }
    return fail(`error: unknown subcommand: ${sub}\nusage: git stash list | show | drop | pop | apply | push | clear`, 129);
  }

  // ---------- теги ----------
  function cmdTag(w, a) {
    const L = w.L;
    const del = flag(a, '-d', '--delete');
    const ann = flag(a, '-a', '--annotate');
    const force = flag(a, '-f', '--force');
    const list = flag(a, '-l', '--list');
    const n = flag(a, '-n');
    const msgs = vals(a, '-m', '--message');
    if (msgs.missing) return missingVal(msgs.missing);
    if (del) {
      if (!a.length) return fail('usage: git tag -d <tagname>...', 129);
      const out = [];
      for (const t of a) {
        if (!L.tags[t]) return fail(`error: tag '${t}' not found.`, 1);
        out.push(`Deleted tag '${t}' (was ${short(L.tags[t].hash)})`);
        delete L.tags[t];
      }
      return ok(out.join('\n'));
    }
    if (!a.length || list) {
      const rx = a[0] ? globRx(a[0]) : null;
      return ok(Object.keys(L.tags).filter((t) => !rx || rx.test(t)).sort().map((t) => n ? `${t.padEnd(15)} ${L.tags[t].msg || subject(w.store[L.tags[t].hash])}` : t).join('\n'));
    }
    const name = a[0];
    if (!/^[\w.\-/]+$/.test(name) || name.includes('..')) return fail(`fatal: '${name}' is not a valid tag name.`, 128);
    if (L.tags[name] && !force) return fail(`fatal: tag '${name}' already exists`, 128);
    const h = resolve(w, a[1] || 'HEAD');
    if (!h) return fail(a[1] ? `fatal: Failed to resolve '${a[1]}' as a valid ref.` : "fatal: Failed to resolve 'HEAD' as a valid ref.", 128);
    if (ann && !msgs.length) return fail('fatal: no tag message?\n' + C.dim('hint: в этом терминале нет редактора — добавь сообщение: git tag -a v1.0.0 -m "Release 1.0.0"'), 128);
    L.tags[name] = { hash: h, annotated: ann || msgs.length > 0, msg: msgs.join('\n\n'), tagger: L.config['user.name'], time: BASE_TIME + (w.clock += 1) * 60e3 };
    w.hooks.refs && w.hooks.refs();
    return ok('');
  }

  // ---------- работа с GitLab (origin) ----------
  function noRemote() {
    return fail("fatal: 'origin' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.", 128);
  }
  function doFetch(w, prune) {
    const L = w.L, R = w.R;
    const lines = [];
    Object.keys(R.heads).sort().forEach((b) => {
      const old = L.tracking[b], nw = R.heads[b];
      if (old === nw) return;
      if (!old) lines.push(` * [new branch]      ${b.padEnd(14)} -> origin/${b}`);
      else if (isAncestor(w, old, nw)) lines.push(`   ${short(old)}..${short(nw)}  ${b.padEnd(14)} -> origin/${b}`);
      else lines.push(` + ${short(old)}...${short(nw)} ${b.padEnd(14)} -> origin/${b}  (forced update)`);
      L.tracking[b] = nw;
    });
    if (prune) {
      Object.keys(L.tracking).forEach((b) => {
        if (!R.heads[b]) { lines.push(` - [deleted]         (none)         -> origin/${b}`); delete L.tracking[b]; }
      });
    }
    Object.keys(R.tags).sort().forEach((t) => {
      if (L.tags[t]) return;
      L.tags[t] = Object.assign({}, R.tags[t]);
      lines.push(` * [new tag]         ${t.padEnd(14)} -> ${t}`);
    });
    if (lines.length) w.hooks.refs && w.hooks.refs();
    return lines.length ? `From ${HOST}:${PROJECT}\n${lines.join('\n')}` : '';
  }
  function cmdFetch(w, a) {
    if (!w.L.hasRemote) return noRemote();
    const prune = flag(a, '-p', '--prune');
    flag(a, '--all', '--tags', 'origin', '-v');
    return ok(doFetch(w, prune));
  }
  function cmdPull(w, a) {
    const L = w.L;
    if (!L.hasRemote) return noRemote();
    const rebase = flag(a, '--rebase', '-r');
    const noRebase = flag(a, '--no-rebase');
    const ffOnly = flag(a, '--ff-only');
    flag(a, '--ff', '--no-edit', '-v');
    if (a[0] && a[0] !== 'origin') return fail(`fatal: '${a[0]}' does not appear to be a git repository\nfatal: Could not read from remote repository.`, 128);
    const b = L.head.branch;
    if (!b) return fail('You are not currently on a branch.\nPlease specify which branch you want to merge with.', 1);
    if (L.merging || L.unmerged.length) return fail('error: Pulling is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use \'git add/rm <file>\'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.', 128);
    const up = a[1] || L.upstream[b];
    const fetched = doFetch(w, false);
    const out = fetched ? [fetched] : [];
    if (!up) {
      out.push('There is no tracking information for the current branch.', 'Please specify which branch you want to merge with.', 'See git-pull(1) for details.', '', '    git pull <remote> <branch>', '', 'If you wish to set tracking information for this branch you can do so with:', '', `    git branch --set-upstream-to=origin/<branch> ${b}`);
      return fail(out.join('\n'), 1);
    }
    const target = L.tracking[up];
    if (!target) { out.push(`fatal: couldn't find remote ref ${up}`); return fail(out.join('\n'), 128); }
    const head = headHash(w);
    let r;
    if (head && isAncestor(w, target, head)) r = ok('Already up to date.');
    else if (!head || isAncestor(w, head, target)) r = doMerge(w, target, `origin/${up}`, { ffOnly: true });
    else if (rebase) r = cmdRebase(w, ['origin/' + up]);
    else if (noRebase) r = doMerge(w, target, up, { msg: `Merge branch '${up}' of ${HOST}:${PROJECT}${b !== up ? ' into ' + b : ''}`, pull: true });
    else if (ffOnly) r = fail('fatal: Not possible to fast-forward, aborting.', 128);
    else r = fail(['hint: You have divergent branches and need to specify how to reconcile them.', 'hint: You can do so by running one of the following commands sometime before', 'hint: your next pull:', 'hint:', 'hint:   git config pull.rebase false  # merge', 'hint:   git config pull.rebase true   # rebase', 'hint:   git config pull.ff only       # fast-forward only', 'hint:', 'hint: You can replace "git config" with "git config --global" to set a default', 'hint: preference for all repositories. You can also pass --rebase, --no-rebase,', 'hint: or --ff-only on the command line to override the configured default per', 'hint: invocation.', 'fatal: Need to specify how to reconcile divergent branches.'].join('\n'), 128);
    if (!r.code && !rebase && !noRebase && !ffOnly && L.config['pull.rebase'] === 'true') { /* без изменений */ }
    out.push(r.out);
    return { out: out.filter(Boolean).join('\n'), code: r.code };
  }

  function pushTag(w, t, out, force) {
    const L = w.L, R = w.R;
    const tag = L.tags[t];
    if (R.tags[t] && R.tags[t].hash === tag.hash) return true;
    if (R.tags[t] && !force) { out.push(` ! [rejected]        ${t} -> ${t} (already exists)`); return false; }
    R.tags[t] = Object.assign({}, tag);
    out.push(` * [new tag]         ${t} -> ${t}`);
    w.hooks.push && w.hooks.push({ type: 'tag', name: t, after: tag.hash });
    return true;
  }
  function cmdPush(w, a) {
    const L = w.L, R = w.R;
    if (!L.hasRemote) return fail('fatal: No configured push destination.\nEither specify the URL from the command-line or configure a remote repository using\n\n    git remote add <name> <url>\n\nand then push using the remote name\n\n    git push <name>', 128);
    const setUp = flag(a, '-u', '--set-upstream');
    const force = flag(a, '-f', '--force');
    const lease = flag(a, '--force-with-lease');
    const tags = flag(a, '--tags');
    const del = flag(a, '-d', '--delete');
    flag(a, '-v', '--no-verify');
    if (a[0] && a[0] !== 'origin') return fail(`fatal: '${a[0]}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`, 128);
    let specs = a.slice(1);
    const cur = L.head.branch;
    if (!specs.length && !tags) {
      if (!cur) return fail('fatal: You are not currently on a branch.\nTo push the history leading to the current (detached HEAD)\nstate now, use\n\n    git push origin HEAD:<name-of-remote-branch>', 128);
      if (!headHash(w)) return fail(`error: src refspec ${cur} does not match any\nerror: failed to push some refs to '${REMOTE_URL}'`, 1);
      if (!L.upstream[cur] && !setUp) return fail(`fatal: The current branch ${cur} has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream origin ${cur}\n\nTo have this happen automatically for branches without a tracking\nupstream, see 'push.autoSetupRemote' in 'git help config'.`, 128);
      specs = [cur + (L.upstream[cur] && L.upstream[cur] !== cur ? ':' + L.upstream[cur] : '')];
    }
    const out = [];
    const after = [];
    let failed = false;
    let wrote = false;
    if (del) {
      for (const b of specs) {
        if (!R.heads[b]) { out.push(`error: unable to delete '${b}': remote ref does not exist`); failed = true; continue; }
        if (isProtected(w, b)) { out.push('remote: GitLab: You can only delete protected branches using the web interface.', `To ${REMOTE_URL}`, ` ! [remote rejected] ${b} (pre-receive hook declined)`); failed = true; continue; }
        delete R.heads[b]; delete L.tracking[b];
        out.push(`To ${REMOTE_URL}`, ` - [deleted]         ${b}`);
        w.hooks.push && w.hooks.push({ type: 'delete', name: b });
      }
      if (failed) out.push(`error: failed to push some refs to '${REMOTE_URL}'`);
      return { out: out.join('\n'), code: failed ? 1 : 0 };
    }
    const lines = [];
    for (const spec of specs) {
      let [src, dst] = spec.split(':');
      if (src === 'HEAD') src = cur || 'HEAD';
      dst = dst || src;
      if (L.tags[src] && !L.heads[src]) { if (!pushTag(w, src, lines, force)) failed = true; continue; }
      const h = src === 'HEAD' ? headHash(w) : L.heads[src];
      if (!h) { out.push(`error: src refspec ${src} does not match any\nerror: failed to push some refs to '${REMOTE_URL}'`); return fail(out.join('\n'), 1); }
      const old = R.heads[dst];
      if (old === h) { if (setUp) L.upstream[src] = dst; continue; }
      if (old && !isAncestor(w, old, h)) {
        if (lease || force) {
          if (isProtected(w, dst)) { lines.push('remote: GitLab: You are not allowed to force push code to a protected branch on this project.', ` ! [remote rejected] ${src} -> ${dst} (pre-receive hook declined)`); failed = true; continue; }
          if (lease && L.tracking[dst] !== old) { lines.push(` ! [rejected]        ${src} -> ${dst} (stale info)`); failed = true; continue; }
          R.heads[dst] = h; L.tracking[dst] = h; wrote = true;
          lines.push(` + ${short(old)}...${short(h)} ${src} -> ${dst} (forced update)`);
          after.push({ type: 'branch', name: dst, before: old, after: h, forced: true });
        } else {
          const fetchFirst = L.tracking[dst] !== old;
          lines.push(` ! [rejected]        ${src} -> ${dst} (${fetchFirst ? 'fetch first' : 'non-fast-forward'})`);
          failed = fetchFirst ? 'fetch' : 'nff';
        }
        continue;
      }
      R.heads[dst] = h; L.tracking[dst] = h; wrote = true;
      if (!old) lines.push(` * [new branch]      ${src} -> ${dst}`);
      else lines.push(`   ${short(old)}..${short(h)}  ${src} -> ${dst}`);
      if (setUp) L.upstream[src] = dst;
      after.push({ type: 'branch', name: dst, before: old, after: h, created: !old });
    }
    if (tags) Object.keys(L.tags).sort().forEach((t) => { if (!pushTag(w, t, lines, force)) failed = true; });
    if (wrote) out.push('Enumerating objects: 9, done.', 'Counting objects: 100% (9/9), done.', 'Delta compression using up to 8 threads', 'Compressing objects: 100% (5/5), done.', 'Writing objects: 100% (5/5), 612 bytes | 612.00 KiB/s, done.', 'Total 5 (delta 3), reused 0 (delta 0), pack-reused 0');
    after.forEach((ev) => {
      if (ev.name === 'main' || isProtected(w, ev.name)) return;
      const mr = w.hooks.mrFor && w.hooks.mrFor(ev.name);
      if (mr) out.push('remote: ', `remote: View merge request for ${ev.name}:`, `remote:   ${WEB_URL}/-/merge_requests/${mr}`, 'remote: ');
      else out.push('remote: ', `remote: To create a merge request for ${ev.name}, visit:`, `remote:   ${WEB_URL}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(ev.name)}`, 'remote: ');
    });
    if (lines.length) out.push(`To ${REMOTE_URL}`, ...lines);
    else if (!failed) out.push('Everything up-to-date');
    if (setUp) specs.forEach((s) => { const [src, dst] = s.split(':'); if (L.heads[src] && R.heads[dst || src]) out.push(`branch '${src}' set up to track 'origin/${dst || src}'.`); });
    if (failed) {
      out.push(`error: failed to push some refs to '${REMOTE_URL}'`);
      if (failed === 'fetch') out.push('hint: Updates were rejected because the remote contains work that you do not', 'hint: have locally. This is usually caused by another repository pushing to', 'hint: the same ref. If you want to integrate the remote changes, use', "hint: 'git pull' before pushing again.", "hint: See the 'Note about fast-forwards' in 'git push --help' for details.");
      if (failed === 'nff') out.push('hint: Updates were rejected because the tip of your current branch is behind', 'hint: its remote counterpart. If you want to integrate the remote changes,', "hint: use 'git pull' before pushing again.", "hint: See the 'Note about fast-forwards' in 'git push --help' for details.");
    }
    after.forEach((ev) => w.hooks.push && w.hooks.push(ev));
    w.hooks.refs && w.hooks.refs();
    return { out: out.join('\n'), code: failed ? 1 : 0 };
  }

  function cmdRemote(w, a) {
    const L = w.L;
    const v = flag(a, '-v', '--verbose');
    if (a[0] === 'add') {
      if (a.length < 3) return fail('usage: git remote add [<options>] <name> <url>', 129);
      if (L.hasRemote) return fail(`error: remote ${a[1]} already exists.`, 3);
      if (a[1] !== 'origin') return fail('error: в этом тренажёре удалённый репозиторий называется origin', 1);
      if (!/gitlab\.academy\.qa[:/]qa\/shop(\.git)?$/.test(a[2])) return fail(`error: этот проект живёт по адресу ${REMOTE_URL} (или ${WEB_URL}.git)`, 1);
      L.hasRemote = true;
      return ok('');
    }
    if (a[0] === 'remove' || a[0] === 'rm') { L.hasRemote = false; L.tracking = {}; L.upstream = {}; return ok(''); }
    if (a[0] === 'show') return L.hasRemote ? ok(`* remote origin\n  Fetch URL: ${REMOTE_URL}\n  Push  URL: ${REMOTE_URL}\n  HEAD branch: main`) : noRemote();
    if (a[0] === 'get-url') return L.hasRemote ? ok(REMOTE_URL) : fail("error: No such remote 'origin'", 2);
    if (!L.hasRemote) return ok('');
    return ok(v ? `origin\t${REMOTE_URL} (fetch)\norigin\t${REMOTE_URL} (push)` : 'origin');
  }

  function cmdConfig(w, a) {
    const L = w.L;
    flag(a, '--global', '--local');
    if (flag(a, '--list', '-l')) return ok(Object.keys(L.config).map((k) => `${k}=${L.config[k]}`).concat(L.hasRemote ? [`remote.origin.url=${REMOTE_URL}`, 'remote.origin.fetch=+refs/heads/*:refs/remotes/origin/*'] : []).join('\n'));
    if (!a.length) return fail('usage: git config [<options>]', 129);
    if (a.length === 1) return L.config[a[0]] != null ? ok(L.config[a[0]]) : fail('', 1);
    L.config[a[0]] = a.slice(1).join(' ');
    return ok('');
  }

  function cmdClean(w, a) {
    const L = w.L;
    const dry = flag(a, '-n', '--dry-run');
    const f = flag(a, '-f', '--force', '-fd', '-df');
    flag(a, '-d', '-x');
    if (!dry && !f) return fail('fatal: clean.requireForce is true and -f not given: refusing to clean', 128);
    const d = statusData(w);
    const untr = Object.keys(L.work).filter((p) => !(p in L.index) && !ignoredFn(w)(p));
    if (!f) return ok(d.untracked.map((p) => `Would remove ${p}`).join('\n'));
    untr.forEach((p) => delete L.work[p]);
    return ok(d.untracked.map((p) => `Removing ${p}`).join('\n'));
  }

  const GIT_CMDS = ['add', 'blame', 'branch', 'checkout', 'cherry-pick', 'clean', 'clone', 'commit', 'config', 'diff', 'fetch', 'help', 'init', 'log', 'merge', 'mv', 'pull', 'push', 'rebase', 'reflog', 'remote', 'reset', 'restore', 'rev-parse', 'revert', 'rm', 'show', 'stash', 'status', 'switch', 'tag', 'version'];
  const GIT_HELP = `usage: git [-v | --version] [-h | --help] <command> [<args>]

These are common Git commands used in various situations:

start a working area
   clone     Clone a repository into a new directory
   init      Create an empty Git repository or reinitialize an existing one

work on the current change
   add       Add file contents to the index
   mv        Move or rename a file, a directory, or a symlink
   restore   Restore working tree files
   rm        Remove files from the working tree and from the index

examine the history and state
   diff      Show changes between commits, commit and working tree, etc
   log       Show commit logs
   show      Show various types of objects
   status    Show the working tree status
   blame     Show what revision and author last modified each line of a file

grow, mark and tweak your common history
   branch    List, create, or delete branches
   commit    Record changes to the repository
   merge     Join two or more development histories together
   rebase    Reapply commits on top of another base tip
   reset     Reset current HEAD to the specified state
   switch    Switch branches
   tag       Create, list, delete or verify a tag object
   stash     Stash the changes in a dirty working directory away
   cherry-pick  Apply the changes introduced by some existing commits
   revert    Revert some existing commits

collaborate
   fetch     Download objects and refs from another repository
   pull      Fetch from and integrate with another repository or a local branch
   push      Update remote refs along with associated objects
   remote    Manage set of tracked repositories`;

  function runGit(w, argv) {
    const L = w.L;
    const a = argv.slice();
    // глобальные опции вида -C dir, --no-pager
    while (a[0] === '--no-pager' || a[0] === '-P') a.shift();
    const cmd = a.shift();
    if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') return ok(GIT_HELP);
    if (cmd === '--version' || cmd === '-v' || cmd === 'version') return ok('git version 2.47.1');
    if (!GIT_CMDS.includes(cmd)) {
      const near = GIT_CMDS.filter((c) => lev(c, cmd) <= 2);
      return fail(`git: '${cmd}' is not a git command. See 'git --help'.${near.length ? `\n\nThe most similar command${near.length > 1 ? 's are' : ' is'}\n${near.map((c) => '\t' + c).join('\n')}` : ''}`, 1);
    }
    if (a.includes('--help') || a.includes('-h')) return ok(`usage: git ${cmd} [<options>]\n\n${C.dim('Полную справку смотри в документации: https://git-scm.com/docs/git-' + cmd)}`);
    if (cmd === 'init') {
      if (L.inited) return ok(`Reinitialized existing Git repository in ${HOME}/.git/`);
      L.inited = true;
      L.head = { branch: 'main' };
      return ok(`Initialized empty Git repository in ${HOME}/.git/`);
    }
    if (cmd === 'clone') return fail(a.length ? `fatal: destination path 'shop' already exists and is not an empty directory.` : 'fatal: You must specify a repository to clone.', 128);
    if (cmd === 'config') return cmdConfig(w, a);
    const nr = needRepo(w);
    if (nr) return nr;
    switch (cmd) {
      case 'status': {
        if (flag(a, '-s', '--short')) {
          const d = statusData(w);
          const rows = {};
          d.staged.forEach((x) => { rows[x.p] = [x.k === 'new file' ? 'A' : x.k === 'deleted' ? 'D' : 'M', ' ']; });
          d.unstaged.forEach((x) => { rows[x.p] = rows[x.p] || [' ', ' ']; rows[x.p][1] = x.k === 'deleted' ? 'D' : 'M'; });
          const lines = Object.keys(rows).sort().map((p) => C.green(rows[p][0]) + C.red(rows[p][1]) + ' ' + p);
          d.conflicts.forEach((x) => lines.push(C.red('UU') + ' ' + x.p));
          d.untracked.forEach((p) => lines.push(C.red('??') + ' ' + p));
          return ok(lines.join('\n'));
        }
        return ok(statusText(w));
      }
      case 'add': return cmdAdd(w, a);
      case 'rm': return cmdRm(w, a);
      case 'mv': return cmdMv(w, a);
      case 'commit': return cmdCommit(w, a);
      case 'log': return cmdLog(w, a);
      case 'diff': return cmdDiff(w, a);
      case 'show': return cmdShow(w, a);
      case 'blame': return cmdBlame(w, a);
      case 'branch': return cmdBranch(w, a);
      case 'switch': return cmdSwitch(w, a, false);
      case 'checkout': return cmdSwitch(w, a, true);
      case 'restore': return cmdRestore(w, a);
      case 'reset': return cmdReset(w, a);
      case 'merge': return cmdMerge(w, a);
      case 'rebase': return cmdRebase(w, a);
      case 'cherry-pick': return cmdPick(w, a, 'cherry-pick');
      case 'revert': return cmdPick(w, a, 'revert');
      case 'stash': return cmdStash(w, a);
      case 'tag': return cmdTag(w, a);
      case 'fetch': return cmdFetch(w, a);
      case 'pull': return cmdPull(w, a);
      case 'push': return cmdPush(w, a);
      case 'remote': return cmdRemote(w, a);
      case 'clean': return cmdClean(w, a);
      case 'reflog': return ok(L.reflog.slice(0, 30).map((r, i) => `${C.yellow(short(r.hash))} HEAD@{${i}}: ${r.msg}`).join('\n'));
      case 'rev-parse': {
        const abbrev = flag(a, '--abbrev-ref');
        const sh = flag(a, '--short');
        if (flag(a, '--show-toplevel')) return ok(HOME);
        const r = a[0] || 'HEAD';
        if (abbrev) return ok(r === 'HEAD' ? (L.head.branch || 'HEAD') : r);
        const h = resolve(w, r);
        if (!h) return fail(`fatal: ambiguous argument '${r}': unknown revision or path not in the working tree.`, 128);
        return ok(sh ? short(h) : h);
      }
      default: return fail(`git: '${cmd}' is not a git command. See 'git --help'.`, 1);
    }
  }

  // ---------- GitLab CI: .gitlab-ci.yml ----------

  const RESERVED = ['stages', 'variables', 'default', 'workflow', 'include', 'image', 'services', 'before_script', 'after_script', 'cache'];
  const JOB_KEYS = ['script', 'before_script', 'after_script', 'stage', 'image', 'services', 'variables', 'rules', 'only', 'except', 'needs', 'dependencies',
    'artifacts', 'cache', 'when', 'allow_failure', 'retry', 'tags', 'extends', 'environment', 'timeout', 'interruptible', 'coverage', 'parallel', 'resource_group', 'release', 'trigger', 'start_in'];
  const WHENS = ['on_success', 'on_failure', 'always', 'manual', 'delayed', 'never'];
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  function deepMerge(a, b) {
    const out = Object.assign({}, a);
    Object.keys(b).forEach((k) => { out[k] = isObj(out[k]) && isObj(b[k]) ? deepMerge(out[k], b[k]) : b[k]; });
    return out;
  }
  const flatList = (x) => (Array.isArray(x) ? [].concat(...x.map(flatList)) : x == null ? [] : [x]);

  // Выражения rules:if — $VAR == "x", !=, =~ /re/, &&, ||, скобки
  function parseExpr(src) {
    const toks = [];
    const re = /\s*(\$\{?\w+\}?|"(?:[^"\\]|\\.)*"|'[^']*'|\/(?:[^/\\]|\\.)+\/[a-z]*|==|!=|=~|!~|&&|\|\||\(|\)|null\b)/y;
    let i = 0;
    const s = String(src);
    while (i < s.length) {
      if (/^\s*$/.test(s.slice(i))) break;
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m) return null;
      toks.push(m[1]);
      i = re.lastIndex;
    }
    let p = 0;
    function primary() {
      const t = toks[p++];
      if (t === undefined) throw 0;
      if (t === '(') { const v = or(); if (toks[p++] !== ')') throw 0; return v; }
      if (t[0] === '$') { const name = t.replace(/[${}]/g, ''); return { k: 'var', name }; }
      if (t[0] === '"' || t[0] === "'") return { k: 'str', v: t.slice(1, -1) };
      if (t[0] === '/') { const m = t.match(/^\/(.*)\/([a-z]*)$/); return { k: 're', v: new RegExp(m[1], m[2].replace(/[^gimsuy]/g, '')) }; }
      if (t === 'null') return { k: 'null' };
      throw 0;
    }
    function cmp() {
      const l = primary();
      if (['==', '!=', '=~', '!~'].includes(toks[p])) { const op = toks[p++]; return { k: 'cmp', op, l, r: primary() }; }
      return l;
    }
    function and() { let l = cmp(); while (toks[p] === '&&') { p++; l = { k: 'and', l, r: cmp() }; } return l; }
    function or() { let l = and(); while (toks[p] === '||') { p++; l = { k: 'or', l, r: and() }; } return l; }
    try {
      const ast = or();
      return p === toks.length ? ast : null;
    } catch (e) { return null; }
  }
  function evalExpr(ast, vars) {
    const val = (n) => (n.k === 'var' ? (vars[n.name] == null ? null : String(vars[n.name])) : n.k === 'str' ? n.v : n.k === 'null' ? null : n.v);
    switch (ast.k) {
      case 'or': return evalExpr(ast.l, vars) || evalExpr(ast.r, vars);
      case 'and': return evalExpr(ast.l, vars) && evalExpr(ast.r, vars);
      case 'cmp': {
        const l = val(ast.l), r = val(ast.r);
        if (ast.op === '==') return l === r;
        if (ast.op === '!=') return l !== r;
        const hit = r instanceof RegExp && l != null && r.test(l);
        return ast.op === '=~' ? hit : !hit;
      }
      case 'var': { const v = vars[ast.name]; return v != null && v !== ''; }
      case 'str': return ast.v !== '';
      default: return false;
    }
  }

  function ciConfig(text) {
    let y;
    try { y = parseYaml(text); } catch (e) { return { errors: [e.yaml ? e.message : 'Invalid configuration format'] }; }
    if (!isObj(y)) return { errors: ['Invalid configuration format'] };
    const errors = [];
    if (y.include) errors.push('include: в этом тренажёре внешние файлы не подключаются — опиши всё в .gitlab-ci.yml');
    if (y.stages != null && (!Array.isArray(y.stages) || y.stages.some((s) => typeof s !== 'string'))) errors.push('stages config should be an array of strings');
    const stages = ['.pre'].concat(Array.isArray(y.stages) ? y.stages.map(String) : ['build', 'test', 'deploy'], ['.post']);
    if (y.variables != null && (!isObj(y.variables) || Object.values(y.variables).some((v) => isObj(v) ? v.value == null : Array.isArray(v)))) errors.push('variables config should be a hash of key value pairs');
    const def = Object.assign({}, isObj(y.default) ? y.default : {});
    ['image', 'before_script', 'after_script', 'cache', 'services'].forEach((k) => { if (y[k] != null && def[k] == null) def[k] = y[k]; });
    const names = Object.keys(y).filter((k) => !RESERVED.includes(k));
    const expanded = {};
    function expand(name, seen) {
      if (expanded[name]) return expanded[name];
      const d = y[name];
      if (!isObj(d)) return d;
      if (d.extends == null) return (expanded[name] = d);
      const bases = flatList(d.extends);
      let acc = {};
      bases.forEach((b) => {
        if (!(b in y) || RESERVED.includes(b)) { errors.push(`${name}: unknown keys in \`extends\` (${b})`); return; }
        if (seen.includes(b)) { errors.push(`${name}: circular dependency detected in \`extends\``); return; }
        acc = deepMerge(acc, expand(b, seen.concat(b)) || {});
      });
      const own = Object.assign({}, d);
      delete own.extends;
      return (expanded[name] = deepMerge(acc, own));
    }
    const jobs = {};
    names.forEach((n) => {
      if (y[n] != null && !isObj(y[n])) { if (!n.startsWith('.')) errors.push(`jobs:${n} config should be a hash`); return; }
      const j = expand(n, [n]);
      if (n.startsWith('.') || !j) return;
      const unknown = Object.keys(j).filter((k) => !JOB_KEYS.includes(k));
      if (unknown.length) errors.push(`jobs:${n} config contains unknown keys: ${unknown.join(', ')}`);
      if (j.script == null && j.trigger == null) errors.push(`jobs:${n} config should implement a script: or a trigger: keyword`);
      else if (j.script != null && !(typeof j.script === 'string' || (Array.isArray(j.script) && flatList(j.script).every((s) => typeof s === 'string' || typeof s === 'number')))) errors.push(`jobs:${n}:script config should be a string or a nested array of strings up to 10 levels deep`);
      const stage = j.stage == null ? 'test' : String(j.stage);
      if (!stages.includes(stage)) errors.push(`${n} job: chosen stage ${stage} does not exist; available stages are ${stages.join(', ')}`);
      if (j.when != null && !WHENS.includes(j.when)) errors.push(`jobs:${n} when should be one of: ${WHENS.join(', ')}`);
      if (j.rules != null) {
        if (!Array.isArray(j.rules) || j.rules.some((r) => !isObj(r))) errors.push(`jobs:${n}:rules config should be an array of hashes`);
        else j.rules.forEach((r) => {
          const bad = Object.keys(r).filter((k) => !['if', 'when', 'allow_failure', 'changes', 'exists', 'variables', 'needs', 'start_in'].includes(k));
          if (bad.length) errors.push(`jobs:${n}:rules:rule config contains unknown keys: ${bad.join(', ')}`);
          if (r.if != null && !parseExpr(r.if)) errors.push(`jobs:${n}:rules:rule if invalid expression syntax`);
          if (r.when != null && !WHENS.includes(r.when)) errors.push(`jobs:${n}:rules:rule when unknown value: ${r.when}`);
        });
        ['only', 'except'].forEach((k) => { if (j[k] != null) errors.push(`jobs:${n} config key may not be used with \`rules\`: ${k}`); });
      }
      if (j.retry != null) {
        const m = isObj(j.retry) ? j.retry.max : j.retry;
        if (typeof m !== 'number' || m < 0 || m > 2) errors.push(`jobs:${n}:retry config must be between 0 and 2`);
      }
      if (j.artifacts != null) {
        if (!isObj(j.artifacts)) errors.push(`jobs:${n}:artifacts config should be a hash`);
        else {
          const bad = Object.keys(j.artifacts).filter((k) => !['paths', 'reports', 'expire_in', 'when', 'name', 'expose_as', 'untracked', 'exclude', 'public', 'access'].includes(k));
          if (bad.length) errors.push(`jobs:${n}:artifacts config contains unknown keys: ${bad.join(', ')}`);
          if (j.artifacts.paths != null && !Array.isArray(j.artifacts.paths)) errors.push(`jobs:${n}:artifacts paths should be an array of strings`);
          if (j.artifacts.reports != null && !isObj(j.artifacts.reports)) errors.push(`jobs:${n}:artifacts:reports config should be a hash`);
        }
      }
      if (j.needs != null && !Array.isArray(j.needs)) errors.push(`jobs:${n}:needs config should be an array`);
      if (j.allow_failure != null && typeof j.allow_failure !== 'boolean' && !isObj(j.allow_failure)) errors.push(`jobs:${n} allow failure should be a hash or a boolean value`);
      const job = Object.assign({}, j, { name: n, stage });
      ['image', 'before_script', 'after_script', 'cache', 'services'].forEach((k) => { if (job[k] == null && def[k] != null) job[k] = def[k]; });
      if (job.retry == null && def.retry != null) job.retry = def.retry;
      jobs[n] = job;
    });
    Object.values(jobs).forEach((j) => {
      flatList(j.needs).forEach((x) => {
        const nm = isObj(x) ? x.job : x;
        if (!jobs[nm]) errors.push(`${j.name} job: undefined need: ${nm}`);
        else if (stages.indexOf(jobs[nm].stage) > stages.indexOf(j.stage)) errors.push(`${j.name} job: need ${nm} is not defined in current or prior stages`);
      });
      flatList(j.dependencies).forEach((nm) => {
        if (!jobs[nm]) errors.push(`${j.name} job: undefined dependency: ${nm}`);
      });
    });
    if (!Object.keys(jobs).length && !errors.length) errors.push('jobs config should contain at least one visible job');
    let workflow = null;
    if (y.workflow != null) {
      if (!isObj(y.workflow) || (y.workflow.rules != null && !Array.isArray(y.workflow.rules))) errors.push('workflow config should be a hash');
      else {
        workflow = y.workflow;
        (workflow.rules || []).forEach((r) => { if (isObj(r) && r.if != null && !parseExpr(r.if)) errors.push('workflow:rules:rule if invalid expression syntax'); });
      }
    }
    const variables = {};
    if (isObj(y.variables)) Object.keys(y.variables).forEach((k) => { const v = y.variables[k]; variables[k] = String(isObj(v) ? v.value : v); });
    return { errors, stages, jobs, variables, workflow };
  }

  // Какие джобы попадут в пайплайн
  function refMatches(r, vars) {
    const src = vars.CI_PIPELINE_SOURCE;
    if (r === 'branches') return !!vars.CI_COMMIT_BRANCH;
    if (r === 'tags') return !!vars.CI_COMMIT_TAG;
    if (r === 'merge_requests') return src === 'merge_request_event';
    if (r === 'pushes') return src === 'push';
    if (r === 'web') return src === 'web';
    const ref = vars.CI_COMMIT_BRANCH || vars.CI_COMMIT_TAG;
    if (!ref) return false;
    const m = String(r).match(/^\/(.*)\/([a-z]*)$/);
    return m ? new RegExp(m[1], m[2]).test(ref) : r === ref;
  }
  function jobRule(job, vars) {
    if (job.rules) {
      for (const r of job.rules) {
        if (r.if != null) { const ast = parseExpr(r.if); if (!ast || !evalExpr(ast, vars)) continue; }
        const when = r.when || job.when || 'on_success';
        if (when === 'never') return null;
        return { when, allowFailure: r.allow_failure != null ? !!r.allow_failure : job.allow_failure != null ? !!job.allow_failure : when === 'manual' };
      }
      return null;
    }
    const refs = (x) => (x == null ? null : Array.isArray(x) ? x : isObj(x) ? x.refs || [] : [x]);
    const only = refs(job.only) || ['branches', 'tags'];
    const except = refs(job.except) || [];
    if (!only.some((r) => refMatches(r, vars)) || except.some((r) => refMatches(r, vars))) return null;
    const when = job.when || 'on_success';
    if (when === 'never') return null;
    return { when, allowFailure: job.allow_failure != null ? !!job.allow_failure : when === 'manual' };
  }
  function workflowAllows(cfg, vars) {
    if (!cfg.workflow || !cfg.workflow.rules) return true;
    for (const r of cfg.workflow.rules) {
      if (r.if != null) { const ast = parseExpr(r.if); if (!ast || !evalExpr(ast, vars)) continue; }
      return r.when !== 'never';
    }
    return false;
  }
  function plannedJobs(cfg, vars) {
    if (!workflowAllows(cfg, vars)) return { filtered: true, jobs: [] };
    const jobs = [];
    Object.values(cfg.jobs).forEach((j) => {
      const r = jobRule(j, Object.assign({}, cfg.variables, j.variables || {}, vars));
      if (r) jobs.push(Object.assign({ def: j }, r));
    });
    return { jobs };
  }

  // ---------- мини-jest: настоящие тесты над файлами репозитория ----------
  function fmtVal(v) {
    if (typeof v === 'string') return JSON.stringify(v);
    if (v === undefined) return 'undefined';
    if (typeof v === 'number' && Number.isNaN(v)) return 'NaN';
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  function makeExpect() {
    return function expect(received) {
      const mk = (neg) => {
        const check = (pass, name, exp, extra) => {
          if (pass !== neg) return;
          const e = new Error(`expect(received).${neg ? 'not.' : ''}${name}(expected)${extra || ''}\n\n${neg ? `Expected: not ${fmtVal(exp)}` : `Expected: ${fmtVal(exp)}`}\nReceived: ${fmtVal(received)}`);
          e.jest = true;
          throw e;
        };
        return {
          toBe: (x) => check(Object.is(received, x), 'toBe', x, ' // Object.is equality'),
          toEqual: (x) => check(JSON.stringify(received) === JSON.stringify(x), 'toEqual', x, ' // deep equality'),
          toStrictEqual: (x) => check(JSON.stringify(received) === JSON.stringify(x), 'toStrictEqual', x),
          toBeCloseTo: (x, d) => check(Math.abs(received - x) < Math.pow(10, -(d == null ? 2 : d)) / 2, 'toBeCloseTo', x),
          toBeTruthy: () => check(!!received, 'toBeTruthy', 'truthy'),
          toBeFalsy: () => check(!received, 'toBeFalsy', 'falsy'),
          toBeNull: () => check(received === null, 'toBeNull', null),
          toBeUndefined: () => check(received === undefined, 'toBeUndefined', undefined),
          toBeDefined: () => check(received !== undefined, 'toBeDefined', 'defined'),
          toContain: (x) => check(received != null && received.includes && received.includes(x), 'toContain', x),
          toHaveLength: (x) => check(received != null && received.length === x, 'toHaveLength', x),
          toBeGreaterThan: (x) => check(received > x, 'toBeGreaterThan', x),
          toBeGreaterThanOrEqual: (x) => check(received >= x, 'toBeGreaterThanOrEqual', x),
          toBeLessThan: (x) => check(received < x, 'toBeLessThan', x),
          toBeLessThanOrEqual: (x) => check(received <= x, 'toBeLessThanOrEqual', x),
          toThrow: (x) => {
            let thrown = null;
            try { received(); } catch (e) { thrown = e; }
            const pass = !!thrown && (x == null || String(thrown.message).includes(x));
            check(pass, 'toThrow', x == null ? 'an error' : x);
          },
        };
      };
      const api = mk(false);
      api.not = mk(true);
      return api;
    };
  }
  function dirname(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function joinPath(dir, rel) {
    const parts = (dir ? dir.split('/') : []);
    rel.split('/').forEach((s) => { if (s === '..') parts.pop(); else if (s !== '.' && s !== '') parts.push(s); });
    return parts.join('/');
  }
  function makeRequire(tree, globals) {
    const cache = {};
    function load(path) {
      if (cache[path]) return cache[path].exports;
      const module = { exports: {} };
      cache[path] = module;
      const names = Object.keys(globals);
      // eslint-disable-next-line no-new-func
      const fn = new Function('module', 'exports', 'require', ...names, tree[path] + '\n//# sourceURL=' + path);
      fn(module, module.exports, (spec) => req(dirname(path), spec, path), ...names.map((k) => globals[k]));
      return module.exports;
    }
    function req(dir, spec, from) {
      if (!spec.startsWith('.')) {
        const e = new Error(`Cannot find module '${spec}' from '${from}'`);
        throw e;
      }
      const base = joinPath(dir, spec);
      const hit = [base, base + '.js', base + '.json', base + '/index.js'].find((p) => tree[p] != null);
      if (!hit) throw new Error(`Cannot find module '${spec}' from '${from}'`);
      if (hit.endsWith('.json')) return JSON.parse(tree[hit]);
      return load(hit);
    }
    return { load };
  }
  function runJest(tree) {
    const files = Object.keys(tree).filter((p) => /\.test\.js$/.test(p) && !p.startsWith('node_modules/')).sort();
    const suites = [];
    files.forEach((file) => {
      const tests = [];
      const stack = [];
      const before = [];
      const suite = { file, tests: [], error: null };
      const globals = {
        describe: (n, fn) => { stack.push(n); try { fn(); } finally { stack.pop(); } },
        test: (n, fn) => tests.push({ name: stack.concat(n).join(' › '), short: n, fn }),
        it: (n, fn) => tests.push({ name: stack.concat(n).join(' › '), short: n, fn }),
        expect: makeExpect(),
        beforeEach: (fn) => before.push(fn),
      };
      try {
        makeRequire(tree, globals).load(file);
      } catch (e) {
        suite.error = e;
      }
      if (!suite.error) {
        tests.forEach((t) => {
          let err = null;
          try { before.forEach((f) => f()); t.fn(); } catch (e) { err = e; }
          suite.tests.push({ name: t.name, ok: !err, error: err, time: 0.002 + (fnv(t.name, 3) % 30) / 1000 });
        });
      }
      suites.push(suite);
    });
    const all = [].concat(...suites.map((s) => s.tests));
    const failed = all.filter((t) => !t.ok).length + suites.filter((s) => s.error).length;
    const out = [];
    suites.forEach((s) => {
      const bad = s.error || s.tests.some((t) => !t.ok);
      out.push(bad ? `${C.red(' FAIL ')} ${s.file}` : `${C.green(' PASS ')} ${s.file}`);
      if (s.error) {
        out.push(C.red('  ● Test suite failed to run'), '', '    ' + String(s.error.name || 'Error') + ': ' + String(s.error.message).split('\n').join('\n    '), '');
      }
      s.tests.filter((t) => !t.ok).forEach((t) => {
        out.push(C.red(`  ● ${t.name}`), '');
        String(t.error && t.error.jest ? t.error.message : `${t.error && t.error.name}: ${t.error && t.error.message}`).split('\n').forEach((l) => out.push('    ' + l));
        out.push('', C.dim(`      at Object.<anonymous> (${s.file})`), '');
      });
    });
    const sp = suites.filter((s) => !s.error && s.tests.every((t) => t.ok)).length;
    const tp = all.filter((t) => t.ok).length;
    const tf = all.filter((t) => !t.ok).length;
    out.push('');
    out.push(`${C.bold('Test Suites:')} ${suites.length - sp ? C.red(`${suites.length - sp} failed`) + ', ' : ''}${C.green(sp + ' passed')}, ${suites.length} total`);
    out.push(`${C.bold('Tests:')}       ${tf ? C.red(`${tf} failed`) + ', ' : ''}${C.green(tp + ' passed')}, ${all.length} total`);
    out.push(`${C.bold('Snapshots:')}   0 total`, `${C.bold('Time:')}        ${(1.2 + all.length * 0.07).toFixed(2)} s`, C.dim('Ran all test suites.'));
    const junit = [];
    suites.forEach((s) => {
      if (s.error) junit.push({ suite: s.file, name: 'Test suite failed to run', ok: false, message: String(s.error.message), time: 0 });
      s.tests.forEach((t) => junit.push({ suite: s.file, name: t.name, ok: t.ok, message: t.ok ? '' : stripAnsi(String(t.error && t.error.message)), time: t.time }));
    });
    return { ok: !failed && files.length > 0, failed, passed: tp, total: all.length, files: files.length, output: out.join('\n'), junit };
  }
  function junitXml(results) {
    const fails = results.filter((r) => !r.ok).length;
    const lines = [`<?xml version="1.0" encoding="UTF-8"?>`, `<testsuites name="jest tests" tests="${results.length}" failures="${fails}">`];
    results.forEach((r) => {
      lines.push(`  <testcase classname="${esc(r.suite)}" name="${esc(r.name)}" time="${r.time.toFixed(3)}">${r.ok ? '' : `<failure>${esc(r.message)}</failure>`}</testcase>`);
    });
    lines.push('</testsuites>');
    return lines.join('\n') + '\n';
  }
  function compileCheck(tree) {
    const errs = [];
    Object.keys(tree).filter((p) => p.startsWith('src/') && p.endsWith('.js')).forEach((p) => {
      try {
        // eslint-disable-next-line no-new-func
        new Function('module', 'exports', 'require', tree[p]);
      } catch (e) { errs.push({ path: p, msg: `${e.name}: ${e.message}` }); }
    });
    return errs;
  }
  function runLint(tree) {
    const out = [];
    let n = 0;
    compileCheck(tree).forEach((e) => { out.push('', C.bold(e.path), `  1:1  ${C.red('error')}  Parsing error: ${e.msg.replace(/^SyntaxError: /, '')}`); n++; });
    Object.keys(tree).filter((p) => p.startsWith('src/') && p.endsWith('.js')).sort().forEach((p) => {
      const rows = [];
      toLines(tree[p]).forEach((l, i) => {
        const c = l.indexOf('console.log');
        if (c >= 0 && !/^\s*\/\//.test(l)) rows.push(`  ${i + 1}:${c + 1}  ${C.red('error')}  Unexpected console statement  ${C.dim('no-console')}`);
        const d = l.search(/\bdebugger\b/);
        if (d >= 0 && !/^\s*\/\//.test(l)) rows.push(`  ${i + 1}:${d + 1}  ${C.red('error')}  Unexpected 'debugger' statement  ${C.dim('no-debugger')}`);
      });
      if (rows.length) { out.push('', C.bold(p), ...rows); n += rows.length; }
    });
    if (n) out.push('', C.red(`✖ ${n} problem${n === 1 ? '' : 's'} (${n} error${n === 1 ? '' : 's'}, 0 warnings)`), '');
    return { ok: !n, output: out.join('\n') };
  }

  // ---------- npm и оболочка (общие для терминала и раннера) ----------

  // env: { ci, installed, w, files, vars, job }
  function runNpm(args, env) {
    const tree = env.files;
    let pkg;
    if (tree['package.json'] == null) return { out: 'npm ERR! code ENOENT\nnpm ERR! syscall open\nnpm ERR! path ' + (env.ci ? '/builds/qa/shop' : HOME) + '/package.json\nnpm ERR! errno -2\nnpm ERR! enoent Could not read package.json', code: 254 };
    try { pkg = JSON.parse(tree['package.json']); } catch (e) { return { out: `npm ERR! code EJSONPARSE\nnpm ERR! JSON.parse Failed to parse json\nnpm ERR! JSON.parse ${e.message}`, code: 1 }; }
    const sub = args[0];
    if (!sub || sub === 'help') return { out: 'Usage: npm <command>\n\nnpm install        install all the dependencies in your project\nnpm test           run this project\'s tests\nnpm run <foo>      run the script named <foo>', code: 1 };
    if (sub === '-v' || sub === '--version') return { out: '10.8.2', code: 0 };
    if (sub === 'ci' || sub === 'install' || sub === 'i') {
      env.installed = true;
      env.sim = (env.sim || 0) + (env.cached ? 6 : 19);
      return { out: `\nadded 318 packages, and audited 319 packages in ${env.cached ? '3' : '9'}s\n\n52 packages are looking for funding\n  run \`npm fund\` for details\n\nfound ${C.green('0')} vulnerabilities`, code: 0 };
    }
    let name = sub;
    if (sub === 'run' || sub === 'run-script') {
      name = args[1];
      if (!name) return { out: `Lifecycle scripts included in ${pkg.name}@${pkg.version}:\n${Object.keys(pkg.scripts || {}).map((k) => `  ${k}\n    ${pkg.scripts[k]}`).join('\n')}`, code: 0 };
    } else if (sub === 't') name = 'test';
    else if (sub !== 'test') return { out: `Unknown command: "${sub}"\n\nTo see a list of supported npm commands, run:\n  npm help`, code: 1 };
    const script = (pkg.scripts || {})[name];
    if (!script) return { out: `npm ERR! Missing script: "${name}"\nnpm ERR!\nnpm ERR! To see a list of scripts, run:\nnpm ERR!   npm run`, code: 1 };
    const head = `\n> ${pkg.name}@${pkg.version} ${name}\n> ${script}\n`;
    return runTool(script, env, head);
  }
  function runTool(script, env, head) {
    const tree = env.files;
    const bin = script.split(/\s+/)[0];
    if (env.ci && !env.installed && ['jest', 'eslint', 'playwright'].includes(bin)) return { out: `${head}\nsh: 1: ${bin}: not found`, code: 127 };
    if (bin === 'jest') {
      const r = runJest(tree);
      env.sim = (env.sim || 0) + 14 + r.total * 2;
      env.junit = r.junit;
      env.files['junit.xml'] = junitXml(r.junit);
      if (!r.files) return { out: `${head}\nNo tests found, exiting with code 1`, code: 1 };
      return { out: head + '\n' + r.output, code: r.ok ? 0 : 1, tests: r };
    }
    if (bin === 'eslint') {
      const r = runLint(tree);
      env.sim = (env.sim || 0) + 11;
      return { out: head + r.output, code: r.ok ? 0 : 1 };
    }
    if (bin === 'node' && /build/.test(script)) {
      const errs = compileCheck(tree);
      env.sim = (env.sim || 0) + 38;
      if (errs.length) return { out: `${head}\n${errs[0].path}\n${errs[0].msg}\n\nBuild failed`, code: 1 };
      const src = Object.keys(tree).filter((p) => p.startsWith('src/')).sort();
      tree['dist/app.js'] = `/* shop build ${short(sha(src.map((p) => tree[p]).join('')))} */\n` + src.map((p) => `// ${p}\n${tree[p]}`).join('\n');
      tree['dist/index.html'] = '<!doctype html><title>Shop</title><script src="app.js"></script>\n';
      return { out: `${head}\nBundling ${src.length} modules...\n${C.green('✓')} Build complete: dist/app.js (${(tree['dist/app.js'].length / 1024).toFixed(1)} kB), dist/index.html`, code: 0 };
    }
    if (bin === 'playwright') {
      env.sim = (env.sim || 0) + 92;
      if (tree['dist/app.js'] == null) {
        return { out: `${head}\n[WebServer] Error: Cannot find module '/builds/qa/shop/dist/app.js'\n[WebServer]     at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)\n\nError: Process from config.webServer was not able to start. Exit code: 1`, code: 1 };
      }
      const w = env.w;
      if (env.ci && w && w.gl.ci.flaky > 0) {
        w.gl.ci.flaky--;
        return { out: `${head}\nRunning 6 tests using 2 workers\n\n  ${C.red('✘')}  1 [chromium] › checkout.spec.ts:14:5 › checkout › pays for the cart (5.2s)\n  ${C.green('✓')}  2 [chromium] › cart.spec.ts:8:5 › cart › adds an item (1.1s)\n  ${C.green('✓')}  3 [chromium] › cart.spec.ts:21:5 › cart › removes an item (0.9s)\n  ${C.green('✓')}  4 [chromium] › catalog.spec.ts:6:5 › catalog › shows products (0.7s)\n  ${C.green('✓')}  5 [chromium] › catalog.spec.ts:15:5 › catalog › filters by price (1.0s)\n  ${C.green('✓')}  6 [chromium] › login.spec.ts:5:5 › login › signs in (1.3s)\n\n  1) [chromium] › checkout.spec.ts:14:5 › checkout › pays for the cart\n\n    TimeoutError: locator.click: Timeout 5000ms exceeded.\n    Call log:\n      - waiting for locator('#pay-button')\n      -   locator resolved to <button disabled id="pay-button">Pay</button>\n      - element is not enabled - waiting...\n\n      at checkout.spec.ts:19:30\n\n  ${C.red('1 failed')}\n    [chromium] › checkout.spec.ts:14:5 › checkout › pays for the cart\n  ${C.green('5 passed')} (41.8s)`, code: 1 };
      }
      return { out: `${head}\nRunning 6 tests using 2 workers\n\n  ${C.green('6 passed')} (38.4s)`, code: 0 };
    }
    return { out: `${head}\nsh: 1: ${bin}: not found`, code: 127 };
  }

  function expandVars(s, vars) {
    return String(s).replace(/\$\{(\w+)\}|\$(\w+)/g, (m, a, b) => { const v = vars[a || b]; return v == null ? '' : v; });
  }

  // Одна строка script: в джобе
  function shellLine(line, st, lineNo) {
    const orParts = line.split(/\s\|\|\s/);
    if (orParts.length > 1) {
      const r = shellLine(orParts[0], st, lineNo);
      if (!r.code) return r;
      const r2 = shellLine(orParts.slice(1).join(' || '), st, lineNo);
      return { out: [r.out, r2.out].filter(Boolean).join('\n'), code: r2.code };
    }
    const andParts = line.split(/\s&&\s/);
    if (andParts.length > 1) {
      const outs = [];
      for (const part of andParts) {
        const r = shellLine(part, st, lineNo);
        if (r.out) outs.push(r.out);
        if (r.code) return { out: outs.join('\n'), code: r.code };
      }
      return { out: outs.join('\n'), code: 0 };
    }
    const tk = tokenize(expandVars(line, st.vars));
    if (tk.error) return { out: `/bin/sh: eval: line ${lineNo}: syntax error: ${tk.error}`, code: 2 };
    const t = tk.tokens.filter((x) => typeof x === 'string');
    const cmd = t[0];
    const args = t.slice(1);
    const nf = (c) => ({ out: `/bin/sh: eval: line ${lineNo}: ${c}: not found`, code: 127 });
    if (!cmd) return { out: '', code: 0 };
    switch (cmd) {
      case 'echo': return { out: args.filter((x) => x !== '-e' && x !== '-n').join(' '), code: 0 };
      case 'export': args.forEach((a) => { const i = a.indexOf('='); if (i > 0) st.vars[a.slice(0, i)] = a.slice(i + 1); }); return { out: '', code: 0 };
      case 'true': case ':': case 'cd': case 'set': case 'mkdir': case 'touch': case 'cp': case 'rm': return { out: '', code: 0 };
      case 'false': return { out: '', code: 1 };
      case 'exit': return { out: '', code: Number(args[0] || 0) };
      case 'sleep': st.sim += Number(args[0]) || 0; return { out: '', code: 0 };
      case 'pwd': return { out: '/builds/qa/shop', code: 0 };
      case 'date': return { out: 'Mon Oct  5 07:42:10 UTC 2026', code: 0 };
      case 'whoami': return { out: 'root', code: 0 };
      case 'env': case 'printenv': return { out: Object.keys(st.vars).sort().map((k) => `${k}=${st.vars[k]}`).join('\n'), code: 0 };
      case 'ls': {
        const p = (args.filter((a) => !a.startsWith('-'))[0] || '').replace(/\/$/, '');
        const files = Object.keys(st.files);
        if (!p) return { out: [...new Set(files.map((f) => f.split('/')[0]))].sort().join('\n'), code: 0 };
        if (st.files[p] != null) return { out: p, code: 0 };
        const inside = files.filter((f) => f.startsWith(p + '/'));
        if (!inside.length) return { out: `ls: cannot access '${p}': No such file or directory`, code: 2 };
        return { out: [...new Set(inside.map((f) => f.slice(p.length + 1).split('/')[0]))].sort().join('\n'), code: 0 };
      }
      case 'cat': {
        const p = args[0];
        if (st.files[p] == null) return { out: `cat: can't open '${p}': No such file or directory`, code: 1 };
        return { out: st.files[p].replace(/\n$/, ''), code: 0 };
      }
      case 'node':
        if (!st.node) return nf('node');
        if (args[0] === '-v' || args[0] === '--version') return { out: 'v20.18.0', code: 0 };
        return runTool('node ' + args.join(' '), st, '');
      case 'npm':
        if (!st.node) return nf('npm');
        return runNpm(args, st);
      case 'npx':
        if (!st.node) return nf('npx');
        return runTool(args.join(' '), st, '');
      case 'apk': case 'apt-get': case 'pip': return { out: 'OK: 24 MiB in 31 packages', code: 0 };
      case 'git':
        if (args[0] === 'rev-parse') return { out: st.vars.CI_COMMIT_SHA, code: 0 };
        return { out: '', code: 0 };
      case 'curl': return { out: '{"status":"ok"}', code: 0 };
      case './deploy.sh': case 'sh': case 'bash': {
        const file = cmd === './deploy.sh' ? 'deploy.sh' : (args.shift() || '').replace(/^\.\//, '');
        if (st.files[file] == null) return { out: `/bin/sh: ${cmd === './deploy.sh' ? cmd : file}: not found`, code: 127 };
        if (file !== 'deploy.sh') return { out: '', code: 0 };
        return runDeploy(args[0] || 'production', st);
      }
      default: return nf(cmd);
    }
  }
  function runDeploy(target, st) {
    st.sim += 21;
    const w = st.w;
    const tok = st.vars.DEPLOY_TOKEN;
    const out = [`Deploying shop@${st.vars.CI_COMMIT_SHORT_SHA} to ${target}...`];
    if (!tok) { out.push(`./deploy.sh: line 4: DEPLOY_TOKEN: DEPLOY_TOKEN is not set`); return { out: out.join('\n'), code: 1 }; }
    out.push(`curl -sf -X POST -H "PRIVATE-TOKEN: ${tok}" https://deploy.academy.qa/api/releases`);
    if (w && w.gl.ci.deployToken && tok !== w.gl.ci.deployToken) { out.push('curl: (22) The requested URL returned error: 401 Unauthorized'); return { out: out.join('\n'), code: 22 }; }
    out.push(`${C.green('✔')} Release ${st.vars.CI_COMMIT_SHORT_SHA} is live: https://${target === 'production' ? '' : target + '.'}shop.academy.qa`);
    st.deployed = target;
    return { out: out.join('\n'), code: 0 };
  }

  // ---------- GitLab: пайплайны ----------

  function initGl(w) {
    w.gl = { pipelines: [], mrs: [], vars: [], envs: {}, nextPid: 1418, nextJid: 9120, nextMr: 1, ci: { flaky: 0 }, mrSettings: { pipelineMustSucceed: true, threadsResolved: true } };
    return w;
  }
  const FINAL = ['success', 'failed', 'canceled', 'skipped'];
  const refProtected = (w, p) => (p.tag ? isProtectedTag(w, p.ref) : isProtected(w, p.ref));

  function pipelineVars(w, p) {
    const c = w.store[p.sha];
    const v = {
      CI: 'true', GITLAB_CI: 'true', CI_SERVER_URL: `https://${HOST}`, CI_PROJECT_PATH: PROJECT, CI_PROJECT_NAME: 'shop', CI_PROJECT_DIR: '/builds/qa/shop',
      CI_DEFAULT_BRANCH: 'main', CI_PIPELINE_SOURCE: p.source, CI_PIPELINE_ID: String(p.id), CI_COMMIT_SHA: p.sha, CI_COMMIT_SHORT_SHA: short(p.sha),
      CI_COMMIT_REF_NAME: p.ref, CI_COMMIT_REF_SLUG: p.ref.toLowerCase().replace(/[^a-z0-9]+/g, '-'), CI_COMMIT_TITLE: c ? subject(c) : '', CI_COMMIT_MESSAGE: c ? c.msg : '',
      CI_COMMIT_REF_PROTECTED: refProtected(w, p) ? 'true' : 'false', GITLAB_USER_LOGIN: 'apprentice',
    };
    if (p.tag) v.CI_COMMIT_TAG = p.ref;
    else if (p.source !== 'merge_request_event') v.CI_COMMIT_BRANCH = p.ref;
    if (p.mr) {
      const mr = w.gl.mrs.find((m) => m.iid === p.mr);
      Object.assign(v, { CI_MERGE_REQUEST_IID: String(p.mr), CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: mr.source, CI_MERGE_REQUEST_TARGET_BRANCH_NAME: mr.target, CI_MERGE_REQUEST_TITLE: mr.title });
    }
    w.gl.vars.forEach((x) => { if (!x.protected || refProtected(w, p)) v[x.key] = x.value; });
    return v;
  }

  function createPipeline(w, o) {
    const gl = w.gl;
    const tree = treeOf(w, o.sha);
    if (tree['.gitlab-ci.yml'] == null) return { error: 'Missing CI config file' };
    const p = { id: gl.nextPid++, ref: o.ref, sha: o.sha, source: o.source, mr: o.mr || null, tag: !!o.tag, jobs: [], status: 'created', created: Date.now(), yamlErrors: null, stages: [] };
    const cfg = ciConfig(tree['.gitlab-ci.yml']);
    p.vars = pipelineVars(w, p);
    p.projectKeys = w.gl.vars.map((x) => x.key);
    if (cfg.errors.length) {
      p.yamlErrors = cfg.errors;
      p.status = 'failed';
      gl.pipelines.unshift(p);
      w.hooks.pipelineDone && w.hooks.pipelineDone(p);
      return { pipeline: p };
    }
    // переменные проекта важнее переменных из .gitlab-ci.yml
    Object.keys(cfg.variables).forEach((k) => { if (!w.gl.vars.some((x) => x.key === k && p.vars[k] === x.value)) p.vars[k] = cfg.variables[k]; });
    const plan = plannedJobs(cfg, p.vars);
    if (plan.filtered) return { error: 'Pipeline filtered out by workflow rules.' };
    if (!plan.jobs.length) return { error: 'No stages / jobs for this pipeline.' };
    // needs на джоб, которого нет в этом пайплайне — ошибка создания
    const inPipe = new Set(plan.jobs.map((j) => j.def.name));
    const needErr = [];
    plan.jobs.forEach((j) => flatList(j.def.needs).forEach((x) => {
      const nm = isObj(x) ? x.job : x;
      if (!inPipe.has(nm) && !(isObj(x) && x.optional)) needErr.push(`'${j.def.name}' job needs '${nm}' job, but '${nm}' does not exist in the pipeline. This might be because of the only, except, or rules keywords. To need a job that sometimes does not exist in the pipeline, use needs:optional.`);
    }));
    p.stages = cfg.stages.filter((s) => plan.jobs.some((j) => j.def.stage === s));
    if (needErr.length) {
      p.yamlErrors = needErr;
      p.status = 'failed';
      gl.pipelines.unshift(p);
      w.hooks.pipelineDone && w.hooks.pipelineDone(p);
      return { pipeline: p };
    }
    p.jobs = plan.jobs.map((j) => ({
      id: gl.nextJid++, name: j.def.name, stage: j.def.stage, stageIdx: cfg.stages.indexOf(j.def.stage), def: j.def, when: j.when, allowFailure: j.allowFailure,
      needs: j.def.needs != null ? flatList(j.def.needs).map((x) => (isObj(x) ? x.job : x)).filter((nm) => inPipe.has(nm)) : null,
      status: 'created', attempt: 1, log: '', history: [], simStart: null, simEnd: null, played: false,
    }));
    p.status = 'created';
    gl.pipelines.unshift(p);
    w.hooks.pipelineCreated && w.hooks.pipelineCreated(p);
    return { pipeline: p };
  }

  function prereqs(p, job) {
    if (job.needs) return p.jobs.filter((j) => job.needs.includes(j.name));
    return p.jobs.filter((j) => j.stageIdx < job.stageIdx);
  }
  function pipeStatus(p) {
    if (p.yamlErrors) return 'failed';
    const st = p.jobs.map((j) => j.status);
    if (st.some((s) => s === 'running' || s === 'pending')) return 'running';
    if (st.some((s) => s === 'created')) return st.some((s) => s === 'manual') ? 'manual' : 'running';
    if (st.some((s) => s === 'canceled')) return 'canceled';
    if (p.jobs.some((j) => j.status === 'failed' && !j.allowFailure)) return 'failed';
    if (st.every((s) => s === 'manual' || s === 'skipped') && st.includes('manual')) return 'manual';
    return 'success';
  }
  const pipeWarn = (p) => p.jobs.some((j) => j.status === 'failed' && j.allowFailure);
  function pipeDuration(p) {
    const ran = p.jobs.filter((j) => j.simEnd != null);
    if (!ran.length) return 0;
    return Math.max(...ran.map((j) => j.simEnd)) - Math.min(...ran.map((j) => j.simStart));
  }
  const simSpeed = () => (typeof window.GIT_SIM_SPEED === 'number' ? window.GIT_SIM_SPEED : 1);

  function startJob(w, p, job, now) {
    job.status = 'pending';
    job.realStart = now + 250 * simSpeed();
    const ps = prereqs(p, job).filter((x) => x.simEnd != null);
    job.simStart = ps.length ? Math.max(...ps.map((x) => x.simEnd)) + 3 : 2;
  }
  function advance(w, now) {
    let changed = false;
    w.gl.pipelines.forEach((p) => {
      if (p.yamlErrors || FINAL.includes(p.status) && !p.jobs.some((j) => !FINAL.includes(j.status) && j.status !== 'manual')) return;
      p.jobs.forEach((job) => {
        if (job.status === 'pending' && now >= job.realStart) {
          job.status = 'running';
          job.result = execJob(w, p, job);
          job.simEnd = job.simStart + job.result.sim;
          job.realEnd = now + Math.min(2400, Math.max(700, 450 + job.result.sim * 7)) * simSpeed();
          job.log = job.result.log.slice(0, job.result.log.findIndex((l) => l.startsWith('\x1b[32m$')) + 1).join('\n');
          changed = true;
        }
        if (job.status === 'running' && now >= job.realEnd) {
          finishJob(w, p, job);
          changed = true;
        }
      });
      p.jobs.forEach((job) => {
        if (job.status !== 'created') return;
        const pre = prereqs(p, job);
        const waiting = pre.some((x) => !FINAL.includes(x.status) && !(x.status === 'manual' && !job.needs));
        if (waiting) return;
        const bad = pre.some((x) => (x.status === 'failed' && !x.allowFailure) || x.status === 'canceled');
        const when = job.when;
        if (when === 'on_failure') { if (bad) startJob(w, p, job, now); else job.status = 'skipped'; }
        else if (when === 'always') startJob(w, p, job, now);
        else if (bad) job.status = 'skipped';
        else if (when === 'manual' && !job.played) job.status = 'manual';
        else startJob(w, p, job, now);
        changed = true;
      });
      const before = p.status;
      p.status = pipeStatus(p);
      if (before !== p.status && (FINAL.includes(p.status) || p.status === 'manual')) w.hooks.pipelineDone && w.hooks.pipelineDone(p);
    });
    return changed;
  }
  function finishJob(w, p, job) {
    const r = job.result;
    job.log = r.log.join('\n');
    job.status = r.ok ? 'success' : 'failed';
    job.artifacts = r.ok || (job.def.artifacts && job.def.artifacts.when === 'always') ? r.artifacts : null;
    job.junit = r.junit;
    job.finishedAt = Date.now();
    if (r.ok && r.deployed && job.def.environment) {
      const envName = isObj(job.def.environment) ? job.def.environment.name : job.def.environment;
      const url = isObj(job.def.environment) ? job.def.environment.url : null;
      w.gl.envs[envName] = { name: envName, url, sha: p.sha, ref: p.ref, job: job.id, jobName: job.name, pipeline: p.id, at: Date.now() };
    }
    // retry: N — автоматический перезапуск упавшей джобы
    const max = job.def.retry == null ? 0 : isObj(job.def.retry) ? job.def.retry.max : job.def.retry;
    if (!r.ok && job.attempt <= max) {
      retryJob(w, p, job, true);
      return;
    }
    w.hooks.jobDone && w.hooks.jobDone(p, job);
  }
  function retryJob(w, p, job, auto) {
    job.history.push({ id: job.id, status: job.status, log: job.log, attempt: job.attempt });
    job.id = w.gl.nextJid++;
    job.attempt++;
    job.status = 'created';
    job.played = job.when === 'manual';
    job.log = '';
    job.simStart = job.simEnd = null;
    job.autoRetried = !!auto;
    // зависимые пропущенные джобы снова ждут
    p.jobs.forEach((j) => { if (j !== job && (j.status === 'skipped' || j.status === 'canceled') && (j.needs ? j.needs.includes(job.name) : j.stageIdx > job.stageIdx)) j.status = 'created'; });
    p.status = 'running';
    w.hooks.jobRetried && w.hooks.jobRetried(p, job, auto);
  }
  function playJob(w, p, job) {
    if (job.status !== 'manual') return;
    job.played = true;
    job.status = 'created';
    p.status = 'running';
    w.hooks.jobPlayed && w.hooks.jobPlayed(p, job);
  }
  function cancelPipeline(w, p) {
    p.jobs.forEach((j) => { if (!FINAL.includes(j.status) && j.status !== 'manual') { j.status = 'canceled'; j.log = (j.log || '') + '\n' + C.red('ERROR: Job failed: canceled'); } });
    p.status = pipeStatus(p);
    w.hooks.pipelineDone && w.hooks.pipelineDone(p);
  }

  function execJob(w, p, job) {
    const def = job.def;
    const vars = Object.assign({}, p.vars);
    // при Retry GitLab берёт актуальные переменные проекта
    Object.keys(vars).forEach((k) => { if (p.projectKeys && p.projectKeys.includes(k) && !w.gl.vars.some((x) => x.key === k)) delete vars[k]; });
    w.gl.vars.forEach((x) => { if (!x.protected || refProtected(w, p)) vars[x.key] = x.value; });
    const cfgVars = def.variables || {};
    Object.keys(cfgVars).forEach((k) => { if (!w.gl.vars.some((x) => x.key === k && vars[k] != null)) vars[k] = String(isObj(cfgVars[k]) ? cfgVars[k].value : cfgVars[k]); });
    vars.CI_JOB_ID = String(job.id);
    vars.CI_JOB_NAME = job.name;
    vars.CI_JOB_STAGE = job.stage;
    const masks = w.gl.vars.filter((x) => x.masked && vars[x.key] === x.value).map((x) => x.value);
    const mask = (s) => masks.reduce((acc, v) => acc.split(v).join('[MASKED]'), String(s));
    const image = (isObj(def.image) ? def.image.name : def.image) || 'ruby:3.1';
    const log = [];
    const files = Object.assign({}, treeOf(w, p.sha));
    const st = { ci: true, w, files, vars, installed: false, sim: 9, node: /^node(:|$)/.test(image), cached: !!def.cache && job.attempt > 0 && w.gl.pipelines.some((q) => q !== p), job };
    log.push(C.dim('Running with gitlab-runner 17.4.0 (b92ee590)'), C.dim('  on academy-shared-runner-3 Kz7xQ9wd, system ID: s_4f2a91c0d3e5'));
    log.push(C.bold('Preparing the "docker" executor'), `Using Docker executor with image ${image} ...`, `Pulling docker image ${image} ...`, `Using docker image sha256:${sha(image).slice(0, 12)} for ${image} ...`);
    log.push(C.bold('Preparing environment'), `Running on runner-kz7xq9wd-project-42-concurrent-0 via academy-shared-runner-3...`);
    log.push(C.bold('Getting source from Git repository'), 'Fetching changes with git depth set to 20...', 'Initialized empty Git repository in /builds/qa/shop/.git/', 'Created fresh repository.', `Checking out ${p.sha.slice(0, 8)} as detached HEAD (ref is ${p.mr ? 'refs/merge-requests/' + p.mr + '/head' : p.ref})...`, 'Skipping Git submodules setup');
    if (def.cache) log.push(C.bold('Restoring cache'), st.cached ? 'Checking cache for default-protected...\nSuccessfully extracted cache' : 'Checking cache for default-protected...\nWARNING: file does not exist\nFailed to extract cache');
    // артефакты из предыдущих джоб
    let deps;
    if (def.dependencies != null) deps = p.jobs.filter((j) => flatList(def.dependencies).includes(j.name));
    else if (job.needs) deps = p.jobs.filter((j) => job.needs.includes(j.name) && !flatList(def.needs).some((x) => isObj(x) && x.job === j.name && x.artifacts === false));
    else deps = p.jobs.filter((j) => j.stageIdx < job.stageIdx);
    const withArt = deps.filter((j) => j.artifacts && Object.keys(j.artifacts.files).length);
    if (withArt.length) {
      log.push(C.bold('Downloading artifacts'));
      withArt.forEach((j) => { log.push(`Downloading artifacts for ${j.name} (${j.id})...`, `Downloading artifacts from coordinator... ok        id=${j.id} responseStatus=200 OK`); Object.assign(files, j.artifacts.files); });
    }
    log.push(C.bold('Executing "step_script" stage of the job script'));
    if (/^node/.test(image) && !st.node) log.push('');
    const before = flatList(def.before_script).map(String);
    const script = flatList(def.script).map(String);
    let code = 0;
    const lines = before.concat(script);
    for (let i = 0; i < lines.length; i++) {
      log.push(C.green('$ ' + lines[i]));
      const r = shellLine(lines[i], st, i + 1);
      if (r.out) log.push(...mask(r.out).split('\n'));
      if (r.code) { code = r.code; break; }
    }
    const after = flatList(def.after_script).map(String);
    if (after.length) {
      log.push(C.bold('Running after_script'), 'Running after script...');
      after.forEach((l, i) => { log.push(C.green('$ ' + l)); const r = shellLine(l, st, i + 1); if (r.out) log.push(...mask(r.out).split('\n')); });
    }
    const okRun = code === 0;
    const art = def.artifacts;
    const artifacts = { files: {}, expire: art && art.expire_in ? String(art.expire_in) : '30 days' };
    let junit = null;
    if (art && (okRun || art.when === 'always' || art.when === 'on_failure')) {
      log.push(C.bold(`Uploading artifacts for ${okRun ? 'successful' : 'failed'} job`));
      flatList(art.paths).forEach((pth) => {
        const pp = String(pth).replace(/^\.\//, '').replace(/\/$/, '');
        const hit = Object.keys(files).filter((f) => f === pp || f.startsWith(pp + '/') || globRx(pp).test(f));
        if (hit.length) {
          hit.forEach((f) => { artifacts.files[f] = files[f]; });
          log.push('Uploading artifacts...', `${pth}: found ${hit.length} matching artifact files and directories`, `Uploading artifacts as "archive" to coordinator... 201 Created  id=${job.id} responseStatus=201 Created`);
        } else log.push('Uploading artifacts...', C.yellow(`WARNING: ${pth}: no matching files. Ensure that the artifact path is relative to the working directory (/builds/qa/shop)`), C.red('ERROR: No files to upload'));
      });
      const rep = art.reports && art.reports.junit;
      if (rep) {
        flatList(rep).forEach((f) => {
          if (files[f] != null && st.junit) {
            junit = st.junit;
            artifacts.files[f] = files[f];
            log.push('Uploading artifacts...', `${f}: found 1 matching artifact files and directories`, `Uploading artifacts as "junit" to coordinator... 201 Created  id=${job.id} responseStatus=201 Created`);
          } else log.push('Uploading artifacts...', C.yellow(`WARNING: ${f}: no matching files. Ensure that the artifact path is relative to the working directory (/builds/qa/shop)`), C.red('ERROR: No files to upload'));
        });
      }
    }
    if (def.cache && okRun) log.push(C.bold('Saving cache for successful job'), 'Creating cache default-protected...', 'node_modules/: found 4120 matching artifact files and directories', 'Created cache');
    log.push(C.bold('Cleaning up project directory and file based variables'));
    log.push(okRun ? C.green('Job succeeded') : C.red(`ERROR: Job failed: exit code ${code}`));
    return { ok: okRun, log, sim: st.sim, artifacts, junit, deployed: st.deployed };
  }

  // ---------- GitLab: merge requests ----------
  const openMrFor = (w, branch) => w.gl.mrs.find((m) => m.state === 'opened' && m.source === branch);
  function mrPipeline(w, mr) {
    const shaNow = mr.state === 'merged' ? mr.sourceSha : w.R.heads[mr.source];
    const list = w.gl.pipelines.filter((p) => p.sha === shaNow && (p.mr === mr.iid || (!p.mr && p.ref === mr.source)));
    return list.find((p) => p.mr === mr.iid) || list[0] || null;
  }
  function mrConflicts(w, mr) {
    const s = w.R.heads[mr.source], t = w.R.heads[mr.target];
    if (!s || !t) return [];
    const base = mergeBase(w, s, t);
    return mergeTrees(treeOf(w, base), treeOf(w, t), treeOf(w, s), mr.target, mr.source).conflicts;
  }
  function mrBlockers(w, mr) {
    const out = [];
    if (!w.R.heads[mr.source]) return ['Source branch does not exist.'];
    const s = w.R.heads[mr.source], t = w.R.heads[mr.target];
    if (isAncestor(w, s, t)) out.push('Merge blocked: the source branch has no new commits.');
    if (mrConflicts(w, mr).length) out.push('Merge blocked: merge conflicts must be resolved.');
    const p = mrPipeline(w, mr);
    if (w.gl.mrSettings.pipelineMustSucceed) {
      if (!p) out.push('Merge blocked: pipeline must succeed. Push a commit that fixes the failure or learn about other solutions.');
      else if (p.status === 'running' || p.status === 'created') out.push('Merge blocked: pipeline must succeed. It\'s waiting for a pipeline to complete.');
      else if (p.status !== 'success' && p.status !== 'manual') out.push('Merge blocked: pipeline must succeed. Push a commit that fixes the failure or learn about other solutions.');
    }
    if (w.gl.mrSettings.threadsResolved && mr.threads.some((th) => !th.resolved)) out.push('Merge blocked: all threads must be resolved.');
    return out;
  }
  function mrCreate(w, o) {
    const mr = { iid: w.gl.nextMr++, title: o.title, description: o.description || '', source: o.source, target: o.target || 'main', state: 'opened', squash: !!o.squash, removeSource: o.removeSource !== false, threads: [], author: o.author || ME.name, created: Date.now() };
    w.gl.mrs.unshift(mr);
    w.hooks.mrCreated && w.hooks.mrCreated(mr);
    return mr;
  }
  function mrMerge(w, mr) {
    const R = w.R;
    const s = R.heads[mr.source], t = R.heads[mr.target];
    const base = mergeBase(w, s, t);
    const res = mergeTrees(treeOf(w, base), treeOf(w, t), treeOf(w, s), mr.target, mr.source);
    let src = s;
    if (mr.squash && revList(w, [s], [t]).length > 1) src = mkCommit(w, treeOf(w, s), [base], mr.title, ME);
    const mc = mkCommit(w, res.tree, [t, src], `Merge branch '${mr.source}' into '${mr.target}'\n\n${mr.title}\n\nSee merge request ${PROJECT}!${mr.iid}`, ME);
    R.heads[mr.target] = mc;
    mr.state = 'merged';
    mr.mergeCommit = mc;
    mr.sourceSha = s;
    mr.mergedAt = Date.now();
    if (mr.removeSource) delete R.heads[mr.source];
    w.hooks.merged && w.hooks.merged(mr);
    return mc;
  }

  // ---------- учебный проект «shop» ----------

  const TEAM = {
    anna: { name: 'Anna Smirnova', email: 'anna.smirnova@academy.qa' },
    igor: { name: 'Igor Petrov', email: 'igor.petrov@academy.qa' },
    maria: { name: 'Maria Kim', email: 'maria.kim@academy.qa' },
    oleg: { name: 'Oleg Novikov', email: 'oleg.novikov@academy.qa' },
    me: ME,
  };
  const DEPLOY_TOKEN = 'glpat-Xk29dPq7LmW4vR8s';

  const F = {
    'README.md': `# Shop

Интернет-магазин гильдии: корзина, скидки и доставка.

## Запуск

\`\`\`
npm ci
npm test
\`\`\`
`,
    'package.json': `{
  "name": "shop",
  "version": "1.4.0",
  "private": true,
  "scripts": {
    "test": "jest --ci",
    "lint": "eslint src",
    "build": "node build.js",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "eslint": "^9.12.0",
    "jest": "^29.7.0",
    "jest-junit": "^16.0.0"
  }
}
`,
    '.gitignore': `node_modules/
dist/
.env
*.log
junit.xml
`,
    'build.js': `// Сборка: склеивает src/*.js в dist/app.js
const fs = require('fs');
const files = fs.readdirSync('src').map((f) => fs.readFileSync('src/' + f, 'utf8'));
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/app.js', files.join('\\n'));
`,
    'src/config.js': `module.exports = {
  currency: 'RUB',
  freeShippingFrom: 3000,
  shippingCost: 299,
};
`,
    'src/cart.js': `const config = require('./config');

function subtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function shipping(sum) {
  return sum >= config.freeShippingFrom ? 0 : config.shippingCost;
}

function total(items) {
  const sum = subtotal(items);
  return sum + shipping(sum);
}

module.exports = { subtotal, shipping, total };
`,
    'test/cart.test.js': `const { subtotal, shipping, total } = require('../src/cart');

describe('cart', () => {
  test('sums price * qty', () => {
    expect(subtotal([{ price: 100, qty: 2 }, { price: 50, qty: 1 }])).toBe(250);
  });
  test('charges shipping below the threshold', () => {
    expect(shipping(2999)).toBe(299);
  });
  test('free shipping from 3000', () => {
    expect(shipping(3000)).toBe(0);
  });
  test('total includes shipping', () => {
    expect(total([{ price: 1000, qty: 1 }])).toBe(1299);
  });
});
`,
    'src/discount.js': `// Скидка в процентах, результат округляется до целых рублей
function applyDiscount(price, percent) {
  if (percent < 0 || percent > 100) throw new Error('Invalid percent');
  return Math.round(price * (100 - percent) / 100);
}

module.exports = { applyDiscount };
`,
    'test/discount.test.js': `const { applyDiscount } = require('../src/discount');

describe('applyDiscount', () => {
  test('10% off 1000', () => {
    expect(applyDiscount(1000, 10)).toBe(900);
  });
  test('rounds to whole rubles', () => {
    expect(applyDiscount(990, 15)).toBe(842);
  });
  test('rejects percent above 100', () => {
    expect(() => applyDiscount(100, 150)).toThrow('Invalid percent');
  });
});
`,
    'deploy.sh': `#!/bin/sh
# Выкладка сборки на сервер. Токен берётся из CI/CD-переменной DEPLOY_TOKEN.
set -e
: "\${DEPLOY_TOKEN:?DEPLOY_TOKEN is not set}"
echo "Deploying shop@$CI_COMMIT_SHORT_SHA to $1..."
curl -sf -X POST -H "PRIVATE-TOKEN: $DEPLOY_TOKEN" https://deploy.academy.qa/api/releases
`,
  };

  const CI_BASIC = `stages:
  - build
  - test
  - deploy

default:
  image: node:20-alpine
  cache:
    paths:
      - node_modules/

build:
  stage: build
  script:
    - npm ci
    - npm run build
  artifacts:
    paths:
      - dist/

unit-tests:
  stage: test
  script:
    - npm ci
    - npm test

lint:
  stage: test
  script:
    - npm ci
    - npm run lint

deploy:
  stage: deploy
  script:
    - ./deploy.sh production
  environment: production
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
`;

  // Сборщик стартового состояния уровня
  function makeSetup(w) {
    const refs = {};
    const S = {
      w, refs, F, TEAM,
      // коммит в «черновую» ветку refs[branch] (локально и в GitLab её публикуют отдельно)
      commit(branch, changes, msg, who) {
        const parent = refs[branch];
        const tree = Object.assign({}, treeOf(w, parent));
        Object.keys(changes).forEach((p) => { if (changes[p] == null) delete tree[p]; else tree[p] = changes[p]; });
        refs[branch] = mkCommit(w, tree, parent ? [parent] : [], msg, TEAM[who || 'anna'] || who);
        return refs[branch];
      },
      branch(name, from) { refs[name] = refs[from]; return refs[name]; },
      merge(into, from, msg, who) {
        const a = refs[into], b = refs[from];
        const res = mergeTrees(treeOf(w, mergeBase(w, a, b)), treeOf(w, a), treeOf(w, b), into, from);
        refs[into] = mkCommit(w, res.tree, [a, b], msg, TEAM[who || 'anna']);
        return refs[into];
      },
      publish(...names) { names.forEach((n) => { w.R.heads[n] = refs[n]; }); },
      tag(name, ref, msg) {
        const t = { hash: refs[ref] || ref, annotated: !!msg, msg: msg || '', tagger: 'Anna Smirnova', time: BASE_TIME + w.clock * 60e3 };
        w.R.tags[name] = t;
        w.L.tags[name] = Object.assign({}, t);
      },
      // локальный клон: ветка checkout, известные удалённые ветки — как после git clone/fetch
      clone(branch) {
        const L = w.L;
        L.inited = true;
        L.hasRemote = true;
        L.tracking = Object.assign({}, w.R.heads);
        L.heads = { [branch]: w.R.heads[branch] || refs[branch] };
        if (w.R.heads[branch]) L.upstream[branch] = branch;
        L.head = { branch };
        setWorkTree(w, treeOf(w, L.heads[branch]));
        Object.keys(w.R.tags).forEach((t) => { L.tags[t] = Object.assign({}, w.R.tags[t]); });
        L.reflog = [{ hash: L.heads[branch], msg: `clone: from ${REMOTE_URL}` }];
      },
      local(name, upstream) {
        w.L.heads[name] = refs[name];
        if (upstream) w.L.upstream[name] = name;
      },
      checkout(name) {
        w.L.head = { branch: name };
        setWorkTree(w, treeOf(w, w.L.heads[name]));
      },
      fetchAll() { w.L.tracking = Object.assign({}, w.R.heads); },
      work(changes) { Object.keys(changes).forEach((p) => { if (changes[p] == null) delete w.L.work[p]; else w.L.work[p] = changes[p]; }); },
      stage(...paths) { paths.forEach((p) => { if (w.L.work[p] == null) delete w.L.index[p]; else w.L.index[p] = w.L.work[p]; }); },
      variable(key, value, o) { w.gl.vars.push(Object.assign({ key, value, masked: false, protected: false }, o || {})); },
      // пайплайн, уже отработавший до прихода игрока
      pipeline(ref, o) {
        o = o || {};
        const r = createPipeline(w, { ref, sha: o.sha || w.R.heads[ref] || refs[ref], source: o.source || 'push', mr: o.mr, tag: o.tag });
        if (!r.pipeline) return null;
        let t = Date.now();
        for (let i = 0; i < 200; i++) { t += 5000; advance(w, t); if (!['running', 'created', 'pending'].includes(r.pipeline.status)) break; }
        const ago = (o.ago || 20) * 60e3;
        r.pipeline.created = Date.now() - ago;
        r.pipeline.jobs.forEach((j) => { j.finishedAt = Date.now() - ago + 60e3; });
        return r.pipeline;
      },
      mr(o) { return mrCreate(w, Object.assign({ author: TEAM.me.name }, o)); },
      // стандартная история: 4 коммита в main, клон, токен деплоя, зелёный пайплайн
      std(o) {
        o = o || {};
        S.commit('main', Object.assign({ 'README.md': F['README.md'], 'package.json': F['package.json'], 'build.js': F['build.js'] }, o.noIgnore ? {} : { '.gitignore': F['.gitignore'] }), 'Initial commit', 'anna');
        S.commit('main', { 'src/config.js': F['src/config.js'], 'src/cart.js': F['src/cart.js'], 'test/cart.test.js': F['test/cart.test.js'] }, 'Add cart with shipping', 'igor');
        S.commit('main', { 'src/discount.js': F['src/discount.js'], 'test/discount.test.js': F['test/discount.test.js'] }, 'Add percentage discounts', 'maria');
        S.commit('main', { '.gitlab-ci.yml': o.ci || CI_BASIC, 'deploy.sh': F['deploy.sh'] }, 'Add GitLab CI pipeline', 'oleg');
        S.publish('main');
        if (o.token !== false) S.variable('DEPLOY_TOKEN', DEPLOY_TOKEN, { masked: true, protected: true });
        if (o.pipeline !== false) S.pipeline('main', { ago: 90 });
        return S;
      },
    };
    return S;
  }

  // ---------- интерфейс симулятора ----------

  let TICK = null;
  const STATUS_LABEL = { success: 'passed', failed: 'failed', running: 'running', pending: 'pending', created: 'created', manual: 'manual', skipped: 'skipped', canceled: 'canceled', warning: 'warning' };
  const STATUS_GLYPH = { success: '✓', failed: '✕', running: '', pending: '‖', created: '', manual: '⚙', skipped: '»', canceled: '⊘', warning: '!' };
  function ago(t) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
    const h = Math.round(m / 60);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const initials = (n) => String(n).split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();

  function buildSim(el, ctx, level) {
    if (TICK) clearInterval(TICK);
    const w = initGl(createWorld());
    const S = makeSetup(w);
    if (level.setup) level.setup(S, w);
    ctx.state.w = w;
    const L = w.L;
    const emit = (ev) => ctx.emit(ev);
    const later = (ev) => setTimeout(() => emit(ev), 0);

    // --- реакции GitLab на push, MR и завершение пайплайнов ---
    function branchPipelines(name, sha) {
      const out = [];
      const r = createPipeline(w, { ref: name, sha, source: 'push' });
      if (r.pipeline) out.push(r.pipeline);
      const mr = openMrFor(w, name);
      if (mr) {
        const r2 = createPipeline(w, { ref: name, sha, source: 'merge_request_event', mr: mr.iid });
        if (r2.pipeline) out.push(r2.pipeline);
      }
      return out;
    }
    w.hooks.push = (ev) => {
      if (ev.type === 'branch') branchPipelines(ev.name, ev.after);
      if (ev.type === 'tag') createPipeline(w, { ref: ev.name, sha: ev.after, source: 'push', tag: true });
      later({ type: 'push', ref: ev.name, kind: ev.type, forced: !!ev.forced });
      ui.dirty = true;
    };
    w.hooks.mrFor = (b) => { const m = openMrFor(w, b); return m ? m.iid : null; };
    w.hooks.pipelineDone = (p) => { later({ type: 'pipeline', id: p.id, status: p.status, ref: p.ref, source: p.source }); ui.dirty = true; };
    w.hooks.jobDone = (p, j) => { later({ type: 'job', pipeline: p.id, name: j.name, status: j.status }); };
    w.hooks.mrCreated = (mr) => {
      if (level.onMr) level.onMr(mr, S, w);
      const sha0 = w.R.heads[mr.source];
      const r = createPipeline(w, { ref: mr.source, sha: sha0, source: 'merge_request_event', mr: mr.iid });
      mr.noMrPipeline = !r.pipeline;
    };
    w.hooks.merged = (mr) => { createPipeline(w, { ref: mr.target, sha: w.R.heads[mr.target], source: 'push' }); };
    w.hooks.conflict = (paths) => later({ type: 'conflict', paths });

    // --- разметка ---
    el.innerHTML = `
      <div class="gx">
        <div class="gx-tabs" role="tablist">
          <button type="button" data-view="ws" class="on">🖥 Терминал и редактор</button>
          <button type="button" data-view="gl"><span class="gx-fox" aria-hidden="true"></span> GitLab <span class="gx-badge" hidden></span></button>
        </div>
        <div class="gx-body">
          <section class="gx-ws">
            <div class="gx-editor">
              <aside class="gx-tree">
                <div class="gx-tree-head"><span>EXPLORER · shop</span><button type="button" class="gx-new" title="Новый файл">＋</button></div>
                <div class="gx-newfile" hidden><input type="text" placeholder="путь, например .gitignore" spellcheck="false" aria-label="Имя нового файла"></div>
                <ul class="gx-files"></ul>
              </aside>
              <div class="gx-edit">
                <div class="gx-edit-head"><span class="gx-fname">Выбери файл слева</span><span class="gx-fstate"></span><button type="button" class="gx-del" title="Удалить файл" hidden>🗑</button></div>
                <div class="gx-conflict" hidden>Конфликт слияния: оставь нужные строки и удали маркеры <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code>, <code>=======</code>, <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code>, затем <code>git add</code>.</div>
                <textarea class="gx-text" spellcheck="false" disabled aria-label="Содержимое файла"></textarea>
              </div>
            </div>
            <div class="gx-term" tabindex="-1">
              <div class="gx-term-out" aria-live="polite"></div>
              <label class="gx-term-line"><span class="gx-prompt"></span><input class="gx-term-in" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Команда терминала"></label>
            </div>
          </section>
          <section class="gx-gl gl" hidden></section>
        </div>
      </div>`;
    const $ = (s) => el.querySelector(s);
    const ui = { view: 'ws', open: null, route: { page: 'project' }, hist: [], hi: 0, dirty: false, graphBy: 'stage', mrTab: 'overview', pipeTab: 'pipeline', drafts: {}, edBranch: 'main', edTab: 'edit', lint: null, varForm: null, reveal: false, browse: null, fileRef: 'main', filePath: null, mrFilter: 'opened', runForm: false, newMr: null };
    ctx.state.ui = ui;

    function setView(v) {
      ui.view = v;
      el.querySelectorAll('.gx-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
      $('.gx-ws').hidden = v !== 'ws';
      $('.gx-gl').hidden = v !== 'gl';
      if (v === 'gl') { renderGl(); later({ type: 'view', page: ui.route.page, id: ui.route.id }); }
      else { refreshWs(); setTimeout(() => $('.gx-term-in').focus({ preventScroll: true }), 0); }
    }
    el.querySelectorAll('.gx-tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

    // ---------- терминал ----------
    const out = $('.gx-term-out');
    function print(text, cls) {
      const d = document.createElement('div');
      d.className = 't-l' + (cls ? ' ' + cls : '');
      d.innerHTML = ansi(text);
      out.appendChild(d);
      while (out.childElementCount > 400) out.removeChild(out.firstChild);
      out.scrollTop = out.scrollHeight;
    }
    function promptText() {
      let s = C.green('apprentice@academy') + ':' + C.blue('~/shop');
      if (L.inited) {
        let st = '';
        if (L.merging) st = '|MERGING';
        else if (L.seq) st = L.seq.kind === 'rebase' ? `|REBASE ${L.seq.done}/${L.seq.total}` : L.seq.kind === 'revert' ? '|REVERTING' : '|CHERRY-PICKING';
        s += ' ' + C.cyan(`(${L.head.branch || short(L.head.detached)}${st})`);
      }
      return s + '$ ';
    }
    function renderPrompt() { $('.gx-prompt').innerHTML = ansi(promptText()); }

    function lsCmd(args) {
      const all = args.includes('-a') || args.includes('-la') || args.includes('-al');
      const target = (args.filter((a) => !a.startsWith('-'))[0] || '').replace(/^\.\//, '').replace(/\/$/, '');
      const files = Object.keys(L.work);
      if (target && L.work[target] != null) return { out: target, code: 0 };
      const pre = target ? target + '/' : '';
      const inside = files.filter((f) => f.startsWith(pre));
      if (target && !inside.length) return { out: `ls: cannot access '${target}': No such file or directory`, code: 2 };
      const names = [...new Set(inside.map((f) => { const rest = f.slice(pre.length); const i = rest.indexOf('/'); return i < 0 ? rest : rest.slice(0, i + 1); }))]
        .filter((n) => all || !n.startsWith('.')).sort();
      if (all && !target) names.unshift('./', '../', ...(L.inited ? ['.git/'] : []));
      return { out: names.map((n) => (n.endsWith('/') ? C.blue(n) : n)).join('  '), code: 0 };
    }
    const HELP = `${C.bold('Терминал тренажёра')} — работает в папке проекта ~/shop.
  ${C.green('git')} <команда>     git status, add, commit, log, diff, show, branch, switch, checkout, merge,
                     rebase, stash, restore, reset, revert, cherry-pick, tag, fetch, pull, push, remote…
  ${C.green('npm')} test | ci | run lint | run build   — запустить тесты и скрипты проекта локально
  ls [-a] [папка], cat <файл>, echo "текст" > файл, touch, rm, pwd, clear, history
  Файлы правь в редакторе выше (дерево слева). Стрелки ↑/↓ — история команд, Tab — автодополнение.`;

    function runOne(argv, redirect) {
      const cmd = argv[0];
      const args = argv.slice(1);
      let r;
      switch (cmd) {
        case 'git': r = runGit(w, args); break;
        case 'clear': out.innerHTML = ''; r = { out: '', code: 0 }; break;
        case 'help': r = { out: HELP, code: 0 }; break;
        case 'ls': case 'll': case 'dir': r = lsCmd(cmd === 'll' ? ['-a'].concat(args) : args); break;
        case 'pwd': r = { out: HOME, code: 0 }; break;
        case 'whoami': r = { out: 'apprentice', code: 0 }; break;
        case 'date': r = { out: gitDate(BASE_TIME + w.clock * 60e3).replace(' +0300', ' MSK'), code: 0 }; break;
        case 'history': r = { out: ui.hist.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`).join('\n'), code: 0 }; break;
        case 'cd': r = !args[0] || ['~', '.', HOME, '~/shop', './'].includes(args[0]) ? { out: '', code: 0 } : { out: `bash: cd: ${args[0]}: в тренажёре работаем только в папке ~/shop`, code: 1 }; break;
        case 'echo': r = { out: args.join(' '), code: 0 }; break;
        case 'cat': {
          if (!args.length) { r = { out: '', code: 0 }; break; }
          const missing = args.find((p) => L.work[p] == null);
          r = missing ? { out: `cat: ${missing}: ${Object.keys(L.work).some((f) => f.startsWith(missing.replace(/\/$/, '') + '/')) ? 'Is a directory' : 'No such file or directory'}`, code: 1 } : { out: args.map((p) => L.work[p].replace(/\n$/, '')).join('\n'), code: 0 };
          break;
        }
        case 'touch': args.forEach((p) => { if (L.work[p] == null) L.work[p] = ''; }); r = { out: '', code: 0 }; break;
        case 'mkdir': r = { out: '', code: 0 }; break;
        case 'rm': {
          const rec = args.some((a) => /^-\w*r/.test(a));
          const ps = args.filter((a) => !a.startsWith('-'));
          const outs = [];
          ps.forEach((p) => {
            const q = p.replace(/\/$/, '');
            if (L.work[q] != null) delete L.work[q];
            else if (Object.keys(L.work).some((f) => f.startsWith(q + '/'))) {
              if (rec) Object.keys(L.work).forEach((f) => { if (f.startsWith(q + '/')) delete L.work[f]; });
              else outs.push(`rm: cannot remove '${p}': Is a directory`);
            } else outs.push(`rm: cannot remove '${p}': No such file or directory`);
          });
          r = { out: outs.join('\n'), code: outs.length ? 1 : 0 };
          break;
        }
        case 'npm': case 'npx': {
          const env = { ci: false, installed: true, w, files: Object.assign({}, L.work) };
          r = cmd === 'npm' ? runNpm(args, env) : runTool(args.join(' '), env, '');
          if (cmd === 'npm' && /test|^t$/.test(args[0] === 'run' ? args[1] || '' : args[0] || '')) later({ type: 'npm-test', ok: r.code === 0 });
          if (r.code && cmd === 'npm') r.out += `\n${C.dim('npm ERR! code ' + r.code)}`;
          break;
        }
        case 'node': r = args[0] === '-v' || args[0] === '--version' ? { out: 'v20.18.0', code: 0 } : { out: 'node: в тренажёре запускай скрипты через npm (npm test, npm run build)', code: 1 }; break;
        case 'nano': case 'vim': case 'vi': case 'code': case 'mcedit': case 'emacs':
          if (args[0]) { if (L.work[args[0]] == null) L.work[args[0]] = ''; openFile(args[0]); }
          r = { out: C.dim(`Файл открыт в редакторе выше${args[0] ? ': ' + args[0] : ''}. Изменения сохраняются автоматически.`), code: 0 };
          break;
        default: r = { out: `bash: ${cmd}: command not found`, code: 127 };
      }
      if (redirect && r.code === 0) {
        const f = redirect.file;
        L.work[f] = (redirect.append && L.work[f] != null ? L.work[f] : '') + stripAnsi(r.out) + '\n';
        r = { out: '', code: 0 };
      }
      emit({ type: 'cmd', line: argv.join(' '), argv, git: cmd === 'git' ? (argv[1] || '') : null, code: r.code });
      return r;
    }
    function runShell(line) {
      const tk = tokenize(line);
      if (tk.error) { print(`bash: ${tk.error}`); return; }
      const cmds = [];
      let cur = { argv: [], op: null, redirect: null };
      const toks = tk.tokens;
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (typeof t === 'string') { cur.argv.push(t); continue; }
        if (t.op === '>' || t.op === '>>') {
          const f = toks[i + 1];
          if (typeof f !== 'string') { print("bash: syntax error near unexpected token `newline'"); return; }
          cur.redirect = { file: f.replace(/^\.\//, ''), append: t.op === '>>' };
          i++;
          continue;
        }
        cmds.push(cur);
        cur = { argv: [], op: t.op, redirect: null };
      }
      cmds.push(cur);
      let last = 0;
      for (const c of cmds) {
        if (!c.argv.length) continue;
        if (c.op === '&&' && last !== 0) continue;
        const r = runOne(c.argv, c.redirect);
        last = r.code;
        if (r.out) print(r.out);
      }
    }
    const input = $('.gx-term-in');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const line = input.value;
        input.value = '';
        print(promptText() + line, 't-cmd');
        if (line.trim()) {
          ui.hist.push(line);
          ui.hi = ui.hist.length;
          runShell(line);
        }
        renderPrompt();
        refreshWs();
        if (ui.view === 'gl') renderGl();
        updateBadge();
      } else if (e.key === 'ArrowUp') {
        if (ui.hi > 0) { ui.hi--; input.value = ui.hist[ui.hi]; }
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        if (ui.hi < ui.hist.length) { ui.hi++; input.value = ui.hist[ui.hi] || ''; }
        e.preventDefault();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        complete();
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        out.innerHTML = '';
      }
    });
    function complete() {
      const v = input.value;
      const parts = v.split(/\s+/);
      const last = parts[parts.length - 1];
      let pool;
      if (parts.length === 2 && parts[0] === 'git') pool = GIT_CMDS;
      else if (parts.length === 1) pool = ['git', 'npm', 'ls', 'cat', 'clear', 'help', 'echo', 'touch', 'rm', 'pwd', 'history'];
      else {
        const dirs = new Set();
        Object.keys(L.work).forEach((f) => { const segs = f.split('/'); for (let i = 1; i < segs.length; i++) dirs.add(segs.slice(0, i).join('/') + '/'); });
        pool = Object.keys(L.heads).concat(Object.keys(L.tracking).map((b) => 'origin/' + b), Object.keys(L.tags), Object.keys(L.work).filter((f) => !f.startsWith('node_modules/')), [...dirs].filter((d) => !d.startsWith('node_modules/') || d === 'node_modules/'), parts[0] === 'git' ? ['origin', '--staged', '--oneline', '--graph', '--all'] : []);
      }
      const hits = [...new Set(pool)].filter((x) => x.startsWith(last)).sort();
      if (!hits.length) return;
      let common = hits[0];
      hits.forEach((h) => { while (!h.startsWith(common)) common = common.slice(0, -1); });
      if (hits.length === 1) common = hits[0] + (hits[0].endsWith('/') ? '' : ' ');
      if (common.length > last.length) input.value = v.slice(0, v.length - last.length) + common;
      else { print(promptText() + v, 't-cmd'); print(hits.join('  ')); }
    }
    $('.gx-term').addEventListener('click', (e) => { if (!window.getSelection().toString() && e.target.tagName !== 'INPUT') input.focus({ preventScroll: true }); });

    // ---------- редактор ----------
    const text = $('.gx-text');
    let editTimer = null;
    function fileMarks() {
      const d = statusData(w);
      const m = {};
      d.staged.forEach((x) => { m[x.p] = x.k === 'new file' ? 'A' : 'M'; });
      d.unstaged.forEach((x) => { m[x.p] = x.k === 'deleted' ? 'D' : 'M'; });
      Object.keys(L.work).forEach((p) => { if (!(p in L.index) && !m[p]) m[p] = d.ignored.includes(p) ? 'I' : 'U'; });
      d.conflicts.forEach((x) => { m[x.p] = 'C'; });
      if (!L.inited) Object.keys(L.work).forEach((p) => { m[p] = ''; });
      return m;
    }
    function renderTree() {
      const marks = fileMarks();
      const files = Object.keys(L.work).sort((a, b) => {
        const da = a.includes('/'), db = b.includes('/');
        return a.localeCompare(b);
      });
      const rows = [];
      const seenDirs = new Set();
      let nm = false;
      files.forEach((f) => {
        if (f.startsWith('node_modules/')) {
          if (!nm) { nm = true; rows.push(`<li class="gx-dir${marks[f] === 'I' ? ' ign' : ''}" style="--d:0">▸ node_modules</li>`); }
          return;
        }
        const segs = f.split('/');
        for (let i = 1; i < segs.length; i++) {
          const dir = segs.slice(0, i).join('/');
          if (!seenDirs.has(dir)) { seenDirs.add(dir); rows.push(`<li class="gx-dir" style="--d:${i - 1}">▾ ${esc(segs[i - 1])}</li>`); }
        }
        const mk = marks[f] || '';
        rows.push(`<li><button type="button" class="gx-file m-${mk || 'n'}${ui.open === f ? ' on' : ''}" data-f="${esc(f)}" style="--d:${segs.length - 1}"><span class="gx-fn">${esc(segs[segs.length - 1])}</span><span class="gx-mk">${mk === 'I' ? '' : mk}</span></button></li>`);
      });
      $('.gx-files').innerHTML = rows.join('') || '<li class="gx-empty">Папка пуста</li>';
    }
    $('.gx-files').addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]');
      if (b) openFile(b.dataset.f);
    });
    function openFile(path) {
      ui.open = path;
      text.disabled = false;
      text.value = L.work[path] != null ? L.work[path] : '';
      $('.gx-fname').textContent = path;
      $('.gx-del').hidden = false;
      refreshWs();
      later({ type: 'open-file', path });
    }
    text.addEventListener('input', () => {
      if (!ui.open) return;
      L.work[ui.open] = text.value;
      $('.gx-fstate').textContent = '● сохранено';
      $('.gx-conflict').hidden = !/^(<{7}|>{7})/m.test(text.value);
      clearTimeout(editTimer);
      editTimer = setTimeout(() => { renderTree(); emit({ type: 'edit', path: ui.open }); }, 250);
    });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = text.selectionStart;
        text.setRangeText('  ', s, text.selectionEnd, 'end');
        text.dispatchEvent(new Event('input'));
      }
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) e.preventDefault();
    });
    $('.gx-new').addEventListener('click', () => {
      const box = $('.gx-newfile');
      box.hidden = !box.hidden;
      if (!box.hidden) box.querySelector('input').focus();
    });
    $('.gx-newfile input').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.target.value = ''; $('.gx-newfile').hidden = true; }
      if (e.key !== 'Enter') return;
      const p = e.target.value.trim().replace(/^\.?\//, '');
      if (!p || p.endsWith('/')) return;
      if (L.work[p] == null) L.work[p] = '';
      e.target.value = '';
      $('.gx-newfile').hidden = true;
      openFile(p);
      emit({ type: 'edit', path: p });
    });
    $('.gx-del').addEventListener('click', () => {
      if (!ui.open) return;
      delete L.work[ui.open];
      const p = ui.open;
      ui.open = null;
      refreshWs();
      emit({ type: 'edit', path: p, deleted: true });
    });
    function refreshWs() {
      renderPrompt();
      renderTree();
      if (ui.open && L.work[ui.open] == null) {
        ui.open = null;
      }
      if (!ui.open) {
        text.value = '';
        text.disabled = true;
        $('.gx-fname').textContent = 'Выбери файл слева';
        $('.gx-del').hidden = true;
        $('.gx-fstate').textContent = '';
        $('.gx-conflict').hidden = true;
        return;
      }
      if (text.value !== L.work[ui.open]) {
        const pos = text.selectionStart;
        text.value = L.work[ui.open];
        if (document.activeElement === text) text.setSelectionRange(pos, pos);
      }
      const mk = fileMarks()[ui.open];
      $('.gx-fstate').textContent = { M: 'изменён', A: 'в индексе', U: 'не отслеживается', C: 'конфликт', I: 'игнорируется', D: '' }[mk] || '';
      $('.gx-conflict').hidden = !/^(<{7}|>{7})/m.test(L.work[ui.open]);
    }

    // ---------- GitLab ----------
    const gl = $('.gx-gl');
    const TANUKI = '<svg viewBox="0 0 25 24" width="24" height="24" aria-hidden="true"><path fill="#E24329" d="m24.5 9.5-.03-.09L21.08.56a.9.9 0 0 0-1.69.09l-2.29 7.01H7.83L5.54.65a.9.9 0 0 0-1.7-.09L.45 9.41l-.03.09a6.3 6.3 0 0 0 2.09 7.28l.01.01.03.02 5.16 3.87 2.56 1.94 1.55 1.17a1.05 1.05 0 0 0 1.27 0l1.56-1.17 2.56-1.94 5.2-3.89.01-.01A6.3 6.3 0 0 0 24.5 9.5Z"/><path fill="#FC6D26" d="m24.5 9.5-.03-.09a11.4 11.4 0 0 0-4.56 2.05l-7.45 5.63 4.74 3.59 5.2-3.9.01-.01A6.3 6.3 0 0 0 24.5 9.5Z"/><path fill="#FCA326" d="m7.71 20.77 2.56 1.94 1.55 1.17a1.05 1.05 0 0 0 1.27 0l1.56-1.17 2.56-1.94-4.74-3.59-4.76 3.59Z"/><path fill="#FC6D26" d="M5.01 11.46A11.4 11.4 0 0 0 .45 9.41l-.03.09a6.3 6.3 0 0 0 2.09 7.28l.01.01.03.02 5.16 3.87 4.75-3.59-7.45-5.63Z"/></svg>';
    $('.gx-fox').innerHTML = TANUKI;
    const NAV = [
      ['', [['project', 'Project overview']]],
      ['Code', [['mrs', 'Merge requests'], ['files', 'Repository'], ['branches', 'Branches'], ['commits', 'Commits'], ['tags', 'Tags']]],
      ['Build', [['pipelines', 'Pipelines'], ['editor', 'Pipeline editor']]],
      ['Operate', [['envs', 'Environments']]],
      ['Settings', [['vars', 'CI/CD']]],
    ];
    const NAV_OF = { mr: 'mrs', 'mr-new': 'mrs', pipeline: 'pipelines', job: 'pipelines' };
    const TITLES = { project: 'shop', files: 'Repository', branches: 'Branches', commits: 'Commits', tags: 'Tags', mrs: 'Merge requests', mr: 'Merge requests', 'mr-new': 'New merge request', pipelines: 'Pipelines', pipeline: 'Pipelines', job: 'Jobs', editor: 'Pipeline editor', envs: 'Environments', vars: 'CI/CD Settings' };
    gl.innerHTML = `
      <header class="gl-top">${TANUKI}<span class="gl-crumbs"></span></header>
      <div class="gl-wrap">
        <nav class="gl-side" aria-label="GitLab">
          <div class="gl-proj"><span class="gl-ava">S</span><span>shop</span></div>
          ${NAV.map(([h, items]) => `${h ? `<p class="gl-sec">${h}</p>` : ''}${items.map(([id, t]) => `<button type="button" class="gl-nav" data-go="${id}">${t}<span class="gl-cnt" data-cnt="${id}"></span></button>`).join('')}`).join('')}
        </nav>
        <main class="gl-page"></main>
      </div>`;
    const page = gl.querySelector('.gl-page');

    const icon = (st, title) => `<span class="ci-ic s-${st}" title="${esc(title || STATUS_LABEL[st] || st)}" role="img" aria-label="${esc(STATUS_LABEL[st] || st)}">${STATUS_GLYPH[st] || ''}</span>`;
    const pStatus = (p) => (p.status === 'success' && pipeWarn(p) ? 'warning' : p.status);
    const badge = (st, txt) => `<span class="ci-badge s-${st}">${icon(st)}${esc(txt || STATUS_LABEL[st] || st)}</span>`;
    const jobSt = (j) => (j.status === 'failed' && j.allowFailure ? 'warning' : j.status);
    function stageStatus(jobs) {
      const s = jobs.map((j) => j.status);
      if (s.some((x) => x === 'running' || x === 'pending')) return 'running';
      if (jobs.some((j) => j.status === 'failed' && !j.allowFailure)) return 'failed';
      if (s.includes('canceled')) return 'canceled';
      if (s.includes('created')) return 'created';
      if (s.every((x) => x === 'skipped')) return 'skipped';
      if (s.every((x) => x === 'manual' || x === 'skipped')) return 'manual';
      return jobs.some((j) => j.status === 'failed') ? 'warning' : 'success';
    }
    function mini(p) {
      if (p.yamlErrors) return '<span class="gl-tag bad">yaml invalid</span>';
      return `<span class="pl-mini">${p.stages.map((s) => { const js = p.jobs.filter((j) => j.stage === s); const st = stageStatus(js); return `<button type="button" class="pl-mini-st" data-go="pipeline:${p.id}" title="${esc(s)}: ${STATUS_LABEL[st]}">${icon(st, s + ': ' + STATUS_LABEL[st])}</button>`; }).join('<i></i>')}</span>`;
    }
    const pipesFor = (sha) => w.gl.pipelines.filter((p) => p.sha === sha);
    const shaIcon = (sha) => { const p = pipesFor(sha)[0]; return p ? `<button type="button" class="gl-linkic" data-go="pipeline:${p.id}">${icon(pStatus(p), 'Pipeline #' + p.id + ': ' + STATUS_LABEL[pStatus(p)])}</button>` : ''; };
    const srcLabel = (p) => (p.source === 'merge_request_event' ? 'merge request' : p.tag ? 'tag' : p.source === 'web' ? 'web' : 'branch');
    function findJob(id) {
      for (const p of w.gl.pipelines) {
        for (const j of p.jobs) {
          if (j.id === id) return { p, job: j };
          const old = j.history.find((h) => h.id === id);
          if (old) return { p, job: j, old };
        }
      }
      return null;
    }
    const remoteBranches = () => Object.keys(w.R.heads).sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b)));
    const branchOpts = (sel, list) => (list || remoteBranches()).map((b) => `<option value="${esc(b)}"${b === sel ? ' selected' : ''}>${esc(b)}</option>`).join('');
    function diffHtml(t1, t2) {
      const ps = changedPaths(t1, t2);
      if (!ps.length) return '<p class="gl-muted">No changes.</p>';
      return ps.map((p) => {
        const lines = fileDiff(p, t1[p], t2[p], false).split('\n').slice(4);
        return `<div class="gl-diff"><div class="gl-diff-h">${esc(p)} ${t1[p] == null ? '<span class="gl-tag ok">added</span>' : t2[p] == null ? '<span class="gl-tag bad">deleted</span>' : ''}</div><pre>${lines.map((l) => `<span class="${l[0] === '+' ? 'd-add' : l[0] === '-' ? 'd-del' : l.startsWith('@@') ? 'd-hunk' : ''}">${esc(l)}</span>`).join('\n')}</pre></div>`;
      }).join('');
    }
    function md(src) {
      let inCode = false;
      return toLines(src).map((l) => {
        if (l.startsWith('```')) { inCode = !inCode; return inCode ? '<pre>' : '</pre>'; }
        if (inCode) return esc(l) + '\n';
        if (/^#\s/.test(l)) return `<h3>${esc(l.slice(2))}</h3>`;
        if (/^##\s/.test(l)) return `<h4>${esc(l.slice(3))}</h4>`;
        return l.trim() ? `<p>${esc(l)}</p>` : '';
      }).join('');
    }

    // --- страницы ---
    const P = {};
    P.project = () => {
      if (!Object.keys(w.R.heads).length) {
        return `<h2 class="gl-h">shop</h2><div class="gl-box"><h3>The repository for this project is empty</h3>
          <p>You can push an existing Git repository:</p>
          <pre class="gl-code">cd shop\ngit remote add origin ${REMOTE_URL}\ngit push -u origin main</pre></div>`;
      }
      const h = w.R.heads.main;
      const c = w.store[h];
      return `<h2 class="gl-h">shop <small>Project ID: 42</small></h2>
        <p class="gl-stats"><button type="button" data-go="commits">${revList(w, [h]).length} Commits</button><button type="button" data-go="branches">${Object.keys(w.R.heads).length} Branches</button><button type="button" data-go="tags">${Object.keys(w.R.tags).length} Tags</button></p>
        <div class="gl-commitbox"><span class="gl-ava sm">${initials(c.author)}</span><div><b>${esc(subject(c))}</b><br><small>${esc(c.author)} authored ${esc(shortDate(c.time))}</small></div><span class="gl-sha">${shaIcon(h)} <code>${short(h)}</code></span></div>
        <div class="gl-box gl-readme"><div class="gl-box-h">README.md</div>${md(c.tree['README.md'] || '')}</div>`;
    };
    P.files = () => {
      const ref = w.R.heads[ui.fileRef] ? ui.fileRef : 'main';
      const t = treeOf(w, w.R.heads[ref]);
      const f = ui.filePath && t[ui.filePath] != null ? ui.filePath : null;
      return `<h2 class="gl-h">Repository</h2>
        <div class="gl-bar"><label>Branch <select data-bind="fileRef">${branchOpts(ref)}</select></label>${f ? `<button type="button" class="gl-btn" data-act="file-close">← ${esc(ref)}</button>` : ''}</div>
        ${f ? `<div class="gl-box"><div class="gl-box-h">${esc(f)}</div><pre class="gl-code">${esc(t[f])}</pre></div>`
          : `<table class="gl-table"><tr><th>Name</th><th>Last commit</th></tr>${Object.keys(t).sort().map((p) => {
            const last = revList(w, [w.R.heads[ref]]).find((c) => c.tree[p] !== treeOf(w, c.parents[0])[p]);
            return `<tr><td><button type="button" class="gl-link" data-act="file-open" data-p="${esc(p)}">📄 ${esc(p)}</button></td><td class="gl-muted">${last ? esc(subject(last)) : ''}</td></tr>`;
          }).join('')}</table>`}`;
    };
    P.branches = () => {
      const main = w.R.heads.main;
      return `<h2 class="gl-h">Branches</h2>
        <div class="gl-list">${remoteBranches().map((b) => {
          const h = w.R.heads[b];
          const c = w.store[h];
          const ab = main && b !== 'main' ? aheadBehind(w, h, main) : null;
          const mr = openMrFor(w, b);
          return `<div class="gl-row"><div class="gl-row-main"><b class="gl-mono">${esc(b)}</b> ${b === 'main' ? '<span class="gl-tag">default</span>' : ''}${isProtected(w, b) ? '<span class="gl-tag">protected</span>' : ''}
            <div class="gl-sub">${shaIcon(h)}<code>${short(h)}</code> · ${esc(subject(c))} · ${esc(shortDate(c.time))}</div></div>
            ${ab ? `<span class="gl-ab" title="Behind ${ab.behind} | Ahead ${ab.ahead}">${ab.behind} | ${ab.ahead}</span>` : ''}
            <div class="gl-row-act">${b !== 'main' ? (mr ? `<button type="button" class="gl-btn" data-go="mr:${mr.iid}">!${mr.iid}</button>` : `<button type="button" class="gl-btn" data-act="new-mr" data-b="${esc(b)}">New merge request</button>`) : ''}
            ${!isProtected(w, b) ? `<button type="button" class="gl-btn danger" data-act="del-branch" data-b="${esc(b)}" title="Delete branch">🗑</button>` : ''}</div></div>`;
        }).join('') || '<p class="gl-muted">No branches.</p>'}</div>`;
    };
    P.commits = () => {
      const ref = w.R.heads[ui.fileRef] ? ui.fileRef : 'main';
      const list = w.R.heads[ref] ? revList(w, [w.R.heads[ref]]).slice(0, 40) : [];
      return `<h2 class="gl-h">Commits</h2><div class="gl-bar"><label>Branch <select data-bind="fileRef">${branchOpts(ref)}</select></label></div>
        <div class="gl-list">${list.map((c) => `<div class="gl-row"><span class="gl-ava sm">${initials(c.author)}</span><div class="gl-row-main"><b>${esc(subject(c))}</b><div class="gl-sub">${esc(c.author)} authored ${esc(shortDate(c.time))}</div></div><span class="gl-sha">${shaIcon(c.hash)}<code>${short(c.hash)}</code></span></div>`).join('') || '<p class="gl-muted">No commits.</p>'}</div>`;
    };
    P.tags = () => `<h2 class="gl-h">Tags</h2><div class="gl-list">${Object.keys(w.R.tags).sort().reverse().map((t) => {
      const tg = w.R.tags[t];
      const c = w.store[tg.hash];
      return `<div class="gl-row"><div class="gl-row-main"><b class="gl-mono">🏷 ${esc(t)}</b>${isProtectedTag(w, t) ? ' <span class="gl-tag">protected</span>' : ''}<div class="gl-sub">${shaIcon(tg.hash)}<code>${short(tg.hash)}</code> · ${esc(subject(c))}${tg.msg ? ` · <i>${esc(tg.msg)}</i>` : ''}</div></div></div>`;
    }).join('') || '<div class="gl-empty">Repository has no tags yet.<br><small>Use tags to mark specific points in history, for example releases: <code>git tag -a v1.0.0 -m "…"</code> и <code>git push origin v1.0.0</code>.</small></div>'}</div>`;

    P.mrs = () => {
      const f = ui.mrFilter;
      const list = w.gl.mrs.filter((m) => f === 'all' || m.state === f);
      const cnt = (s) => w.gl.mrs.filter((m) => s === 'all' || m.state === s).length;
      return `<div class="gl-hrow"><h2 class="gl-h">Merge requests</h2><button type="button" class="gl-btn primary" data-act="new-mr">New merge request</button></div>
        <div class="gl-subtabs">${[['opened', 'Open'], ['merged', 'Merged'], ['all', 'All']].map(([k, t]) => `<button type="button" class="${f === k ? 'on' : ''}" data-act="mr-filter" data-v="${k}">${t} <span class="gl-pill">${cnt(k)}</span></button>`).join('')}</div>
        <div class="gl-list">${list.map((m) => {
          const p = mrPipeline(w, m);
          return `<div class="gl-row"><div class="gl-row-main"><button type="button" class="gl-link b" data-go="mr:${m.iid}">${esc(m.title)}</button><div class="gl-sub">!${m.iid} · created ${ago(m.created)} by ${esc(m.author)} · <span class="gl-mono">${esc(m.source)}</span> → <span class="gl-mono">${esc(m.target)}</span></div></div>
            ${p ? `<button type="button" class="gl-linkic" data-go="pipeline:${p.id}">${icon(pStatus(p))}</button>` : ''}${m.state === 'merged' ? '<span class="gl-tag info">Merged</span>' : ''}</div>`;
        }).join('') || '<div class="gl-empty">There are no merge requests to show.</div>'}</div>`;
    };
    P['mr-new'] = () => {
      const branches = remoteBranches();
      const n = ui.newMr || (ui.newMr = { source: branches.find((b) => b !== 'main' && !openMrFor(w, b)) || '', target: 'main', title: '', description: '', squash: false, remove: true });
      if (!n.title && n.source && w.R.heads[n.source]) n.title = subject(w.store[w.R.heads[n.source]]);
      return `<h2 class="gl-h">New merge request</h2>
        <div class="gl-form">
          <div class="gl-2col"><label>Source branch<select data-bind="mr.source"><option value="">Select source branch</option>${branchOpts(n.source, branches)}</select></label>
          <label>Target branch<select data-bind="mr.target">${branchOpts(n.target, branches)}</select></label></div>
          <label>Title<input type="text" data-bind="mr.title" value="${esc(n.title)}"></label>
          <label>Description<textarea data-bind="mr.description" rows="3" placeholder="Describe the goal of the changes and what reviewers should be aware of.">${esc(n.description)}</textarea></label>
          <label class="gl-check"><input type="checkbox" data-bind="mr.remove"${n.remove ? ' checked' : ''}> Delete source branch when merge request is accepted.</label>
          <label class="gl-check"><input type="checkbox" data-bind="mr.squash"${n.squash ? ' checked' : ''}> Squash commits when merge request is accepted.</label>
          <p class="gl-err" data-err="mr"></p>
          <div><button type="button" class="gl-btn primary" data-act="mr-create">Create merge request</button> <button type="button" class="gl-btn" data-go="mrs">Cancel</button></div>
        </div>`;
    };
    P.mr = (iid) => {
      const m = w.gl.mrs.find((x) => x.iid === iid);
      if (!m) return '<p>Merge request not found.</p>';
      const srcHead = m.state === 'merged' ? m.sourceSha : w.R.heads[m.source];
      const tgt = w.R.heads[m.target];
      const commits = srcHead && tgt ? revList(w, [srcHead], [m.state === 'merged' ? m.mergeCommit && w.store[m.mergeCommit].parents[0] : tgt]) : [];
      const tab = ui.mrTab;
      let body = '';
      if (tab === 'commits') body = `<div class="gl-list">${commits.map((c) => `<div class="gl-row"><span class="gl-ava sm">${initials(c.author)}</span><div class="gl-row-main"><b>${esc(subject(c))}</b><div class="gl-sub">${esc(c.author)} · ${esc(shortDate(c.time))}</div></div><span class="gl-sha">${shaIcon(c.hash)}<code>${short(c.hash)}</code></span></div>`).join('') || '<p class="gl-muted">No commits.</p>'}</div>`;
      else if (tab === 'changes') {
        const base = srcHead && tgt ? mergeBase(w, srcHead, m.state === 'merged' ? w.store[m.mergeCommit].parents[0] : tgt) : null;
        body = srcHead ? diffHtml(treeOf(w, base), treeOf(w, srcHead)) : '<p class="gl-muted">Source branch does not exist.</p>';
      } else {
        const p = mrPipeline(w, m);
        const blockers = m.state === 'opened' ? mrBlockers(w, m) : [];
        const junitJobs = p ? p.jobs.filter((j) => j.junit && j.status !== 'created') : [];
        const tests = [].concat(...junitJobs.map((j) => j.junit));
        const tf = tests.filter((t) => !t.ok);
        body = `${m.description ? `<div class="gl-desc">${esc(m.description)}</div>` : ''}
          <div class="gl-widget">${p ? `${icon(pStatus(p))}<div><b>${p.mr ? 'Merge request pipeline' : 'Pipeline'} <button type="button" class="gl-link" data-go="pipeline:${p.id}">#${p.id}</button> ${STATUS_LABEL[pStatus(p)]}</b> for <code>${short(p.sha)}</code> ${p.yamlErrors ? '<span class="gl-tag bad">yaml invalid</span>' : ''}<div class="gl-sub">${p.yamlErrors ? '' : mini(p)}</div></div>`
            : `${icon('created')}<div><b>No pipeline</b><div class="gl-sub">${m.noMrPipeline ? 'Merge request pipeline was not created: no jobs match the rules for <code>merge_request_event</code>.' : 'Waiting for a pipeline…'}</div></div>`}</div>
          ${junitJobs.length ? `<div class="gl-widget tests">${icon(tf.length ? 'failed' : 'success')}<div><b>Test summary: ${tf.length ? `${tf.length} failed, ` : 'no changed test results, '}${tests.length} total tests</b>
            ${tf.map((t) => `<div class="gl-sub bad">✕ ${esc(t.name)} <small>(${esc(t.suite)})</small></div>`).join('')}<div class="gl-sub"><button type="button" class="gl-link" data-act="tests-report" data-id="${p.id}">Full report</button></div></div></div>` : ''}
          <div class="gl-merge">${m.state === 'merged'
            ? `${icon('success')}<div><b>Merged by ${esc(ME.name)} ${ago(m.mergedAt)}</b><div class="gl-sub">The changes were merged into <code>${esc(m.target)}</code> with <code>${short(m.mergeCommit)}</code>.${m.removeSource ? ' The source branch has been deleted.' : ''}</div></div>`
            : `<div class="gl-merge-body">${blockers.length ? blockers.map((b) => `<div class="gl-block">✕ ${esc(b)}</div>`).join('') : '<div class="gl-ready">✓ Ready to merge!</div>'}
              <label class="gl-check"><input type="checkbox" data-act="mr-opt" data-k="removeSource"${m.removeSource ? ' checked' : ''}> Delete source branch</label>
              <label class="gl-check"><input type="checkbox" data-act="mr-opt" data-k="squash"${m.squash ? ' checked' : ''}> Squash commits</label>
              <div><button type="button" class="gl-btn ${blockers.length ? '' : 'confirm'}" data-act="mr-merge" ${blockers.length ? 'disabled' : ''}>Merge</button></div></div>`}</div>
          <h3 class="gl-h3">Activity</h3>
          ${m.threads.map((t, i) => `<div class="gl-thread${t.resolved ? ' resolved' : ''}"><span class="gl-ava sm">${initials(t.author)}</span><div><b>${esc(t.author)}</b> <small class="gl-muted">started a thread</small><p>${esc(t.text)}</p>
            ${t.resolved ? '<small class="gl-ok">✓ Thread resolved</small>' : `<button type="button" class="gl-btn" data-act="resolve" data-i="${i}">Resolve thread</button>`}</div></div>`).join('') || '<p class="gl-muted">No comments yet.</p>'}`;
      }
      return `<h2 class="gl-h">${esc(m.title)}</h2>
        <p class="gl-meta"><span class="gl-tag ${m.state === 'merged' ? 'info' : 'ok'}">${m.state === 'merged' ? 'Merged' : 'Open'}</span> !${m.iid} · ${esc(m.author)} requested to merge <span class="gl-mono">${esc(m.source)}</span> into <span class="gl-mono">${esc(m.target)}</span> · ${ago(m.created)}</p>
        <div class="gl-subtabs">${[['overview', 'Overview'], ['commits', `Commits <span class="gl-pill">${commits.length}</span>`], ['changes', 'Changes']].map(([k, t]) => `<button type="button" class="${tab === k ? 'on' : ''}" data-act="mr-tab" data-v="${k}">${t}</button>`).join('')}</div>${body}`;
    };

    P.pipelines = () => `<div class="gl-hrow"><h2 class="gl-h">Pipelines</h2><button type="button" class="gl-btn primary" data-act="run-form">Run pipeline</button></div>
      ${ui.runForm ? `<div class="gl-form gl-box"><label>Run for branch name or tag<select data-bind="runRef">${branchOpts(ui.runRef || 'main', remoteBranches().concat(Object.keys(w.R.tags)))}</select></label><p class="gl-err" data-err="run"></p><div><button type="button" class="gl-btn primary" data-act="run-go">Run pipeline</button> <button type="button" class="gl-btn" data-act="run-form">Cancel</button></div></div>` : ''}
      <div class="gl-list">${w.gl.pipelines.map((p) => {
        const c = w.store[p.sha];
        return `<div class="gl-row pl-row"><div class="pl-st">${badge(pStatus(p))}<small class="gl-muted">${p.jobs.some((j) => j.simEnd != null) ? '⏱ ' + clock(pipeDuration(p)) : ''}</small></div>
          <div class="gl-row-main"><button type="button" class="gl-link b" data-go="pipeline:${p.id}">${esc(c ? subject(c) : '')}</button>
            <div class="gl-sub"><button type="button" class="gl-link" data-go="pipeline:${p.id}">#${p.id}</button> <span class="gl-mono">${p.tag ? '🏷 ' : ''}${esc(p.ref)}</span> · <code>${short(p.sha)}</code> <span class="gl-tag">${srcLabel(p)}</span>${p.yamlErrors ? ' <span class="gl-tag bad">yaml invalid</span>' : ''}</div></div>
          <div class="pl-stages">${mini(p)}</div>
          <div class="gl-row-act">${p.jobs.some((j) => j.status === 'failed' || j.status === 'canceled') && !['running'].includes(p.status) ? `<button type="button" class="gl-btn" data-act="retry-pipe" data-id="${p.id}" title="Retry">↻</button>` : ''}${p.status === 'running' ? `<button type="button" class="gl-btn danger" data-act="cancel-pipe" data-id="${p.id}" title="Cancel">✕</button>` : ''}</div></div>`;
      }).join('') || '<div class="gl-empty">There are currently no pipelines.<br><small>Pipelines run automatically after <code>git push</code>, when a merge request is created, or with <b>Run pipeline</b>.</small></div>'}</div>`;

    function layers(p) {
      const memo = {};
      const L2 = (j) => {
        if (memo[j.name] != null) return memo[j.name];
        memo[j.name] = 0;
        const pre = prereqs(p, j);
        return (memo[j.name] = pre.length ? 1 + Math.max(...pre.map(L2)) : 0);
      };
      p.jobs.forEach(L2);
      return memo;
    }
    function jobCard(p, j) {
      const st = jobSt(j);
      let act = '';
      if (j.status === 'manual') act = `<button type="button" class="pl-act" data-act="play-job" data-id="${j.id}" title="Run">▶</button>`;
      else if (j.status === 'running' || j.status === 'pending') act = `<button type="button" class="pl-act" data-act="cancel-job" data-id="${j.id}" title="Cancel">✕</button>`;
      else if (['failed', 'success', 'canceled'].includes(j.status)) act = `<button type="button" class="pl-act" data-act="retry-job" data-id="${j.id}" title="Retry">↻</button>`;
      return `<div class="pl-job s-${st}"><button type="button" class="pl-jname" data-go="job:${j.id}">${icon(st)}<span>${esc(j.name)}</span></button>${act}${ui.graphBy === 'deps' && j.needs ? `<small class="pl-needs">needs: ${j.needs.map(esc).join(', ') || '[]'}</small>` : ''}</div>`;
    }
    P.pipeline = (id) => {
      const p = w.gl.pipelines.find((x) => x.id === id);
      if (!p) return '<p>Pipeline not found.</p>';
      const c = w.store[p.sha];
      const tests = [].concat(...p.jobs.filter((j) => j.junit && ['success', 'failed'].includes(j.status)).map((j) => j.junit));
      const tab = ui.pipeTab;
      let body;
      if (p.yamlErrors) {
        body = `<div class="gl-alert bad"><b>Unable to create pipeline</b><ul>${p.yamlErrors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
      } else if (tab === 'jobs') {
        body = `<table class="gl-table"><tr><th>Status</th><th>Job</th><th>Stage</th><th>Duration</th></tr>${p.jobs.map((j) => `<tr><td>${badge(jobSt(j))}</td><td><button type="button" class="gl-link" data-go="job:${j.id}">${esc(j.name)}</button> <small class="gl-muted">#${j.id}</small>${j.allowFailure ? ' <span class="gl-tag">allowed to fail</span>' : ''}${j.attempt > 1 ? ` <span class="gl-tag">retried</span>` : ''}</td><td>${esc(j.stage)}</td><td>${j.simEnd != null && j.status !== 'running' ? dur(j.simEnd - j.simStart) : ''}</td></tr>`).join('')}</table>`;
      } else if (tab === 'tests') {
        const tf = tests.filter((t) => !t.ok);
        const suites = [...new Set(tests.map((t) => t.suite))];
        body = tests.length ? `<div class="gl-testsum"><div><b>${tests.length}</b><small>tests</small></div><div class="bad"><b>${tf.length}</b><small>failures</small></div><div><b>${tests.length ? Math.round((tests.length - tf.length) / tests.length * 100) : 0}%</b><small>success rate</small></div></div>
          ${suites.map((s) => `<div class="gl-box"><div class="gl-box-h">${esc(s)}</div>${tests.filter((t) => t.suite === s).map((t) => `<div class="gl-test ${t.ok ? '' : 'bad'}">${icon(t.ok ? 'success' : 'failed')} ${esc(t.name)}${t.ok ? '' : `<pre>${esc(t.message)}</pre>`}</div>`).join('')}</div>`).join('')}`
          : '<div class="gl-empty">There are no test reports for this pipeline.<br><small>Add <code>artifacts:reports:junit</code> to a test job to see results here.</small></div>';
      } else {
        let cols;
        if (ui.graphBy === 'deps') {
          const ly = layers(p);
          const n = Math.max(...Object.values(ly)) + 1;
          cols = Array.from({ length: n }, (x, i) => ({ title: '', jobs: p.jobs.filter((j) => ly[j.name] === i) }));
        } else cols = p.stages.map((s) => ({ title: s, jobs: p.jobs.filter((j) => j.stage === s) }));
        body = `<div class="pl-groupby">Group jobs by <button type="button" class="${ui.graphBy === 'stage' ? 'on' : ''}" data-act="graph-by" data-v="stage">Stage</button><button type="button" class="${ui.graphBy === 'deps' ? 'on' : ''}" data-act="graph-by" data-v="deps">Job dependencies</button></div>
          <div class="pl-graph">${cols.map((col) => `<div class="pl-col">${col.title ? `<h4>${esc(col.title)}</h4>` : '<h4>&nbsp;</h4>'}${col.jobs.map((j) => jobCard(p, j)).join('')}</div>`).join('')}</div>`;
      }
      const canRetry = p.jobs.some((j) => j.status === 'failed' || j.status === 'canceled') && p.status !== 'running';
      return `<div class="gl-hrow"><h2 class="gl-h">${esc(c ? subject(c) : 'Pipeline')}</h2><div>${canRetry ? `<button type="button" class="gl-btn" data-act="retry-pipe" data-id="${p.id}">Retry</button>` : ''}${p.status === 'running' ? ` <button type="button" class="gl-btn danger" data-act="cancel-pipe" data-id="${p.id}">Cancel pipeline</button>` : ''}</div></div>
        <p class="gl-meta">${badge(pStatus(p))} Pipeline <b>#${p.id}</b> triggered ${ago(p.created)} by ${esc(ME.name)} · <span class="gl-mono">${esc(p.ref)}</span> · <code>${short(p.sha)}</code> <span class="gl-tag">${srcLabel(p)}</span>${p.jobs.length ? ` · ${p.jobs.length} jobs` : ''}${p.jobs.some((j) => j.simEnd != null) ? ` · ⏱ ${clock(pipeDuration(p))}` : ''}</p>
        ${p.yamlErrors ? '' : `<div class="gl-subtabs">${[['pipeline', 'Pipeline'], ['jobs', `Jobs <span class="gl-pill">${p.jobs.length}</span>`], ['tests', `Tests <span class="gl-pill">${tests.length}</span>`]].map(([k, t]) => `<button type="button" class="${tab === k ? 'on' : ''}" data-act="pipe-tab" data-v="${k}">${t}</button>`).join('')}</div>`}${body}`;
    };
    P.job = (id) => {
      const f = findJob(id);
      if (!f) return '<p>Job not found.</p>';
      const { p, job } = f;
      const j = f.old ? Object.assign({}, job, f.old, { history: [] }) : job;
      const st = f.old ? f.old.status : jobSt(job);
      let main;
      if (!f.old && job.status === 'manual') main = `<div class="gl-empty"><h3>This job requires a manual action</h3><p>This job requires manual intervention to start. Before starting this job, you can add variables below for last-minute configuration changes.</p><button type="button" class="gl-btn primary" data-act="play-job" data-id="${job.id}">Run job</button></div>`;
      else if (!f.old && job.status === 'created') main = '<div class="gl-empty"><h3>This job has not started yet</h3><p>This job is in pending state and is waiting to be picked by a runner, or waiting for the previous stages to complete.</p></div>';
      else if (!f.old && job.status === 'skipped') main = '<div class="gl-empty"><h3>This job has been skipped</h3><p>A job in a previous stage failed, so this job did not run.</p></div>';
      else main = `<pre class="job-log">${(j.log || '').split('\n').map((l, i) => `<span class="ln">${i + 1}</span>${ansi(l)}`).join('\n')}${!f.old && job.status === 'running' ? '\n<span class="ln"></span><span class="job-cursor">▍</span>' : ''}</pre>`;
      const art = !f.old && job.artifacts && Object.keys(job.artifacts.files).length ? job.artifacts : null;
      return `<div class="gl-hrow"><h2 class="gl-h">${badge(st)} ${esc(job.name)}</h2><div>
          ${!f.old && ['failed', 'success', 'canceled'].includes(job.status) ? `<button type="button" class="gl-btn" data-act="retry-job" data-id="${job.id}">Retry</button>` : ''}
          ${!f.old && ['running', 'pending'].includes(job.status) ? `<button type="button" class="gl-btn danger" data-act="cancel-job" data-id="${job.id}">Cancel</button>` : ''}</div></div>
        <p class="gl-meta">Job <b>#${id}</b> triggered ${ago(p.created)} by ${esc(ME.name)} · Pipeline <button type="button" class="gl-link" data-go="pipeline:${p.id}">#${p.id}</button> · stage <b>${esc(job.stage)}</b> · <span class="gl-mono">${esc(p.ref)}</span>${f.old ? ' · <span class="gl-tag">retried</span>' : ''}</p>
        <div class="job-wrap"><div class="job-main">${main}</div>
        <aside class="job-side">
          ${j.simEnd != null && (f.old || !['running', 'pending'].includes(job.status)) ? `<p><b>Duration:</b> ${dur(j.simEnd - j.simStart)}</p>` : ''}
          <p><b>Runner:</b> #12 (academy-shared-runner-3)</p>
          ${job.allowFailure ? '<p><span class="gl-tag">allowed to fail</span></p>' : ''}
          ${art ? `<div class="gl-box"><div class="gl-box-h">Job artifacts</div><p class="gl-note">These artifacts will be removed in ${esc(art.expire)}.</p>
            <button type="button" class="gl-btn" data-act="art-download" data-id="${job.id}">Download</button> <button type="button" class="gl-btn" data-act="art-browse" data-id="${job.id}">Browse</button>
            ${ui.browse === job.id ? `<ul class="gl-art">${Object.keys(art.files).sort().map((x) => `<li>📄 ${esc(x)} <small>${(art.files[x].length / 1024).toFixed(1)} KiB</small></li>`).join('')}</ul>` : ''}</div>` : ''}
          ${job.history.length || f.old ? `<div class="gl-box"><div class="gl-box-h">Attempts</div>${job.history.map((h) => `<button type="button" class="gl-link" data-go="job:${h.id}">${icon(h.status)} #${h.id}</button>`).join('<br>')}${f.old ? '' : ''}${f.old || job.history.length ? `<br><button type="button" class="gl-link" data-go="job:${job.id}">${icon(jobSt(job))} #${job.id} (latest)</button>` : ''}</div>` : ''}
          <div class="gl-box"><div class="gl-box-h">${esc(job.stage)}</div>${p.jobs.filter((x) => x.stage === job.stage).map((x) => `<button type="button" class="gl-link" data-go="job:${x.id}">${icon(jobSt(x))} ${esc(x.name)}</button>`).join('<br>')}</div>
        </aside></div>`;
    };

    function ciDraft(branch) {
      const h = w.R.heads[branch];
      const orig = treeOf(w, h)['.gitlab-ci.yml'] || '';
      const d = ui.drafts[branch];
      if (!d || (d.base !== h && d.text === d.orig)) ui.drafts[branch] = { base: h, orig, text: orig };
      return ui.drafts[branch];
    }
    function yamlDump(v, ind) {
      ind = ind || '';
      if (Array.isArray(v)) return v.map((x) => (isObj(x) || Array.isArray(x) ? `${ind}-\n${yamlDump(x, ind + '  ')}` : `${ind}- ${JSON.stringify(x)}`)).join('\n');
      return Object.keys(v).filter((k) => k !== 'name' || !ind).map((k) => {
        const x = v[k];
        if (isObj(x) || Array.isArray(x)) return `${ind}${k}:\n${yamlDump(x, ind + '  ')}`;
        return `${ind}${k}: ${typeof x === 'string' && !/[:#"']/.test(x) ? x : JSON.stringify(x)}`;
      }).join('\n');
    }
    P.editor = () => {
      const branches = remoteBranches();
      if (!branches.length) return '<h2 class="gl-h">Pipeline editor</h2><div class="gl-empty">The repository is empty. Push a commit first.</div>';
      if (!w.R.heads[ui.edBranch]) ui.edBranch = branches[0];
      const d = ciDraft(ui.edBranch);
      const cfg = ciConfig(d.text);
      const valid = !cfg.errors.length;
      const tab = ui.edTab;
      let body;
      if (tab === 'visualize') {
        body = valid ? `<div class="pl-graph">${cfg.stages.filter((s) => Object.values(cfg.jobs).some((j) => j.stage === s)).map((s) => `<div class="pl-col"><h4>${esc(s)}</h4>${Object.values(cfg.jobs).filter((j) => j.stage === s).map((j) => `<div class="pl-job"><span class="pl-jname"><span>${esc(j.name)}</span></span>${j.needs ? `<small class="pl-needs">needs: ${flatList(j.needs).map((x) => esc(isObj(x) ? x.job : x)).join(', ') || '[]'}</small>` : ''}</div>`).join('')}</div>`).join('')}</div>` : '<div class="gl-empty">Fix the configuration errors to see the pipeline visualization.</div>';
      } else if (tab === 'validate') {
        const r = ui.lint;
        body = `<div class="gl-form"><p class="gl-muted">CI Lint: проверь синтаксис и посмотри, какие джобы будут созданы для выбранного события.</p>
          <label>Pipeline source<select data-bind="lintSrc">${[['push-main', 'Git push event to the default branch (main)'], ['mr', 'Merge request event'], ['push-branch', `Git push event to ${ui.edBranch === 'main' ? 'a feature branch' : ui.edBranch}`], ['tag', 'Tag push (v1.0.0)']].map(([k, t]) => `<option value="${k}"${(ui.lintSrc || 'push-main') === k ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
          <div><button type="button" class="gl-btn confirm" data-act="lint">Validate pipeline</button></div></div>
          ${r ? (r.errors ? `<div class="gl-alert bad"><b>Syntax is incorrect.</b><ul>${r.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`
            : `<div class="gl-alert ok"><b>Syntax is correct.</b> ${r.jobs.length ? `Simulation completed successfully: ${r.jobs.length} job${r.jobs.length === 1 ? '' : 's'} would run.` : 'No jobs would run for this event, so no pipeline will be created.'}</div>
              ${r.jobs.length ? `<table class="gl-table"><tr><th>Job</th><th>Stage</th><th>When</th><th>Allow failure</th></tr>${r.jobs.map((j) => `<tr><td>${esc(j.def.name)}</td><td>${esc(j.def.stage)}</td><td>${esc(j.when)}</td><td>${j.allowFailure ? 'true' : 'false'}</td></tr>`).join('')}</table>` : ''}`) : ''}`;
      } else if (tab === 'full') {
        body = valid ? `<pre class="gl-code">${esc(yamlDump(Object.assign({ stages: cfg.stages.filter((s) => s[0] !== '.') }, cfg.jobs)))}</pre>` : '<div class="gl-empty">Fix the configuration errors to see the merged configuration.</div>';
      } else {
        body = `<textarea class="ed-text" data-bind="edText" spellcheck="false" aria-label=".gitlab-ci.yml">${esc(d.text)}</textarea>
          <div class="gl-form gl-box"><label>Commit message<input type="text" data-bind="edMsg" value="${esc(ui.edMsg || 'Update .gitlab-ci.yml file')}"></label>
          <label>Branch<input type="text" value="${esc(ui.edBranch)}" disabled></label><p class="gl-err" data-err="ed"></p>
          <div><button type="button" class="gl-btn confirm" data-act="ed-commit" ${d.text === d.orig ? 'disabled' : ''}>Commit changes</button> <button type="button" class="gl-btn" data-act="ed-reset" ${d.text === d.orig ? 'disabled' : ''}>Reset</button></div></div>`;
      }
      return `<h2 class="gl-h">Pipeline editor</h2>
        <div class="gl-bar"><label>Branch <select data-bind="edBranch">${branchOpts(ui.edBranch)}</select></label></div>
        <div class="ed-status ${valid ? 'ok' : 'bad'}">${valid ? '✓ Pipeline syntax is correct.' : `✕ This GitLab CI configuration is invalid: ${esc(cfg.errors[0])}${cfg.errors.length > 1 ? ` <small>(+${cfg.errors.length - 1})</small>` : ''}`}</div>
        <div class="gl-subtabs">${[['edit', 'Edit'], ['visualize', 'Visualize'], ['validate', 'Validate'], ['full', 'Full configuration']].map(([k, t]) => `<button type="button" class="${tab === k ? 'on' : ''}" data-act="ed-tab" data-v="${k}">${t}</button>`).join('')}</div>${body}`;
    };
    P.envs = () => {
      const envs = Object.values(w.gl.envs);
      return `<h2 class="gl-h">Environments</h2>${envs.length ? `<div class="gl-list">${envs.map((e) => `<div class="gl-row"><div class="gl-row-main"><b>${esc(e.name)}</b> <span class="gl-tag ok">Available</span>
        <div class="gl-sub">Latest deployment: ${shaIcon(e.sha)} <code>${short(e.sha)}</code> ${esc(subject(w.store[e.sha]))} · <span class="gl-mono">${esc(e.ref)}</span> · job <button type="button" class="gl-link" data-go="job:${e.job}">${esc(e.jobName)} #${e.job}</button> · ${ago(e.at)}</div></div>
        <span class="gl-btn" title="${esc(e.url || 'https://shop.academy.qa')}">Open ↗</span></div>`).join('')}</div>`
        : '<div class="gl-empty"><h3>Get started with environments</h3><p>Environments are places where code gets deployed, such as staging or production. Add <code>environment:</code> to a deploy job.</p></div>'}`;
    };
    P.vars = () => {
      const f = ui.varForm;
      return `<h2 class="gl-h">CI/CD Settings</h2>
        <div class="gl-box"><div class="gl-box-h">Variables</div>
        <p class="gl-note">Variables store information, like passwords and secret keys, that you can use in job scripts. Each project can define a maximum of 8000 variables.<br><b>Protected</b>: only exposed to protected branches or protected tags. <b>Masked</b>: hidden in job logs. Must match masking requirements.</p>
        <div class="gl-hrow"><b>CI/CD Variables <span class="gl-pill">${w.gl.vars.length}</span></b><div><button type="button" class="gl-btn" data-act="reveal">${ui.reveal ? 'Hide values' : 'Reveal values'}</button> <button type="button" class="gl-btn primary" data-act="var-add">Add variable</button></div></div>
        ${w.gl.vars.length ? `<table class="gl-table"><tr><th>Key</th><th>Value</th><th>Environments</th><th></th></tr>${w.gl.vars.map((v, i) => `<tr><td><b class="gl-mono">${esc(v.key)}</b><div>${v.protected ? '<span class="gl-tag">Protected</span>' : ''}${v.masked ? '<span class="gl-tag">Masked</span>' : ''}</div></td><td class="gl-mono">${ui.reveal ? esc(v.value) : '*****'}</td><td>All (default)</td><td><button type="button" class="gl-btn" data-act="var-edit" data-i="${i}" title="Edit">✎</button></td></tr>`).join('')}</table>` : '<p class="gl-muted">There are no variables yet.</p>'}
        ${f ? `<div class="gl-form gl-drawer"><h3>${f.i == null ? 'Add variable' : 'Edit variable'}</h3>
          <label>Type<select disabled><option>Variable (default)</option></select></label>
          <label>Environments<select disabled><option>All (default)</option></select></label>
          <fieldset><legend>Visibility</legend><label class="gl-check"><input type="radio" name="gl-vis" data-bind="var.visible" value="visible"${f.masked ? '' : ' checked'}> Visible</label><label class="gl-check"><input type="radio" name="gl-vis" data-bind="var.visible" value="masked"${f.masked ? ' checked' : ''}> Masked</label></fieldset>
          <fieldset><legend>Flags</legend><label class="gl-check"><input type="checkbox" data-bind="var.protected"${f.protected ? ' checked' : ''}> Protect variable <small class="gl-muted">— Export variable to pipelines running on protected branches and tags only.</small></label></fieldset>
          <label>Key<input type="text" data-bind="var.key" value="${esc(f.key)}" spellcheck="false"></label>
          <label>Value<textarea data-bind="var.value" rows="2" spellcheck="false">${esc(f.value)}</textarea></label>
          <p class="gl-err" data-err="var"></p>
          <div><button type="button" class="gl-btn confirm" data-act="var-save">${f.i == null ? 'Add variable' : 'Save changes'}</button> <button type="button" class="gl-btn" data-act="var-cancel">Cancel</button>${f.i != null ? ' <button type="button" class="gl-btn danger" data-act="var-del">Delete variable</button>' : ''}</div></div>` : ''}
        </div>`;
    };

    const LIVE = ['project', 'branches', 'commits', 'tags', 'mrs', 'mr', 'pipelines', 'pipeline', 'job', 'envs'];
    function renderGl() {
      const r = ui.route;
      const navId = NAV_OF[r.page] || r.page;
      gl.querySelectorAll('.gl-nav').forEach((b) => b.classList.toggle('on', b.dataset.go === navId));
      gl.querySelector('.gl-crumbs').innerHTML = `QA Academy / <b>shop</b>${r.page === 'project' ? '' : ' / ' + esc(TITLES[r.page] || '')}${r.id ? ` / ${r.page === 'mr' ? '!' : '#'}${r.id}` : ''}`;
      const cnt = gl.querySelector('[data-cnt="mrs"]');
      const open = w.gl.mrs.filter((m) => m.state === 'opened').length;
      cnt.textContent = open || '';
      const log = page.querySelector('.job-log');
      const atBottom = log && log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
      const keep = page.scrollTop;
      const logTop = log ? log.scrollTop : 0;
      page.innerHTML = P[r.page](r.id);
      page.scrollTop = keep;
      const nl = page.querySelector('.job-log');
      if (nl) nl.scrollTop = !log || atBottom ? nl.scrollHeight : logTop;
    }
    function go(target) {
      const [pg, id] = String(target).split(':');
      if (pg === 'mr' && ui.route.id !== Number(id)) ui.mrTab = 'overview';
      if (pg === 'pipeline' && ui.route.id !== Number(id)) ui.pipeTab = 'pipeline';
      if (pg === 'job') ui.browse = null;
      ui.route = { page: pg, id: id != null ? Number(id) : undefined };
      if (ui.view !== 'gl') setView('gl'); else renderGl();
      page.scrollTop = 0;
      const ev = { type: 'view', page: pg, id: ui.route.id };
      if (pg === 'job') { const f = findJob(ui.route.id); if (f) Object.assign(ev, { name: f.job.name, status: f.old ? f.old.status : f.job.status, pipeline: f.p.id, old: !!f.old }); }
      if (ui.view === 'gl') later(ev);
    }
    function updateBadge() {
      const n = w.gl.pipelines.filter((p) => p.status === 'running').length;
      const b = $('.gx-badge');
      b.hidden = !n;
      b.textContent = n ? `${n} running` : '';
    }
    function errOut(key, msg) { const e = page.querySelector(`[data-err="${key}"]`); if (e) e.textContent = msg; }
    const changed = (ev) => { renderGl(); updateBadge(); emit(ev); };

    gl.addEventListener('click', (e) => {
      const g = e.target.closest('[data-go]');
      if (g && gl.contains(g)) { go(g.dataset.go); return; }
      const a = e.target.closest('[data-act]');
      if (!a || a.disabled || a.type === 'checkbox') return;
      const act = a.dataset.act;
      const id = Number(a.dataset.id);
      const pipe = () => w.gl.pipelines.find((p) => p.id === id);
      switch (act) {
        case 'file-open': ui.filePath = a.dataset.p; renderGl(); break;
        case 'file-close': ui.filePath = null; renderGl(); break;
        case 'new-mr': ui.newMr = null; if (a.dataset.b) ui.newMr = { source: a.dataset.b, target: 'main', title: '', description: '', squash: false, remove: true }; go('mr-new'); break;
        case 'del-branch': {
          const b = a.dataset.b;
          if (isProtected(w, b)) break;
          delete w.R.heads[b];
          changed({ type: 'gl-branch-delete', branch: b });
          break;
        }
        case 'mr-filter': ui.mrFilter = a.dataset.v; renderGl(); break;
        case 'mr-tab': ui.mrTab = a.dataset.v; renderGl(); break;
        case 'mr-create': {
          const n = ui.newMr;
          if (!n.source) return errOut('mr', 'Select a source branch.');
          if (n.source === n.target) return errOut('mr', 'Source and target branch must be different.');
          if (!w.R.heads[n.source] || !w.R.heads[n.target]) return errOut('mr', 'Branch does not exist on the server. Push it first: git push -u origin <branch>.');
          if (openMrFor(w, n.source) && openMrFor(w, n.source).target === n.target) return errOut('mr', `Another open merge request already exists for this source branch: !${openMrFor(w, n.source).iid}`);
          if (isAncestor(w, w.R.heads[n.source], w.R.heads[n.target])) return errOut('mr', `There are no commits in ${n.source} that are not in ${n.target}. Push changes to the source branch first.`);
          if (!n.title.trim()) return errOut('mr', "Title can't be blank");
          const mr = mrCreate(w, { source: n.source, target: n.target, title: n.title.trim(), description: n.description, squash: n.squash, removeSource: n.remove });
          ui.newMr = null;
          emit({ type: 'mr-create', iid: mr.iid, source: mr.source });
          go('mr:' + mr.iid);
          break;
        }
        case 'mr-merge': {
          const m = w.gl.mrs.find((x) => x.iid === ui.route.id);
          if (!m || m.state !== 'opened' || mrBlockers(w, m).length) break;
          mrMerge(w, m);
          changed({ type: 'mr-merge', iid: m.iid, squash: m.squash, removeSource: m.removeSource });
          break;
        }
        case 'resolve': {
          const m = w.gl.mrs.find((x) => x.iid === ui.route.id);
          m.threads[Number(a.dataset.i)].resolved = true;
          changed({ type: 'resolve', iid: m.iid });
          break;
        }
        case 'tests-report': ui.pipeTab = 'tests'; go('pipeline:' + id); later({ type: 'tests-tab', pipeline: id }); break;
        case 'run-form': ui.runForm = !ui.runForm; renderGl(); break;
        case 'run-go': {
          const ref = ui.runRef || 'main';
          const tag = !w.R.heads[ref] && !!w.R.tags[ref];
          const r = createPipeline(w, { ref, sha: tag ? w.R.tags[ref].hash : w.R.heads[ref], source: 'web', tag });
          if (!r.pipeline) return errOut('run', r.error);
          ui.runForm = false;
          emit({ type: 'run-pipeline', id: r.pipeline.id });
          go('pipeline:' + r.pipeline.id);
          break;
        }
        case 'retry-pipe': {
          const p = pipe();
          p.jobs.filter((j) => j.status === 'failed' || j.status === 'canceled').forEach((j) => retryJob(w, p, j));
          changed({ type: 'retry', pipeline: p.id, all: true });
          break;
        }
        case 'cancel-pipe': cancelPipeline(w, pipe()); changed({ type: 'cancel', pipeline: id }); break;
        case 'retry-job': case 'play-job': case 'cancel-job': {
          const f = findJob(id);
          if (!f || f.old) break;
          if (act === 'retry-job') { if (!['failed', 'success', 'canceled'].includes(f.job.status)) break; retryJob(w, f.p, f.job); }
          else if (act === 'play-job') playJob(w, f.p, f.job);
          else { f.job.status = 'canceled'; f.p.status = pipeStatus(f.p); }
          const ev = { type: act === 'retry-job' ? 'retry' : act === 'play-job' ? 'play' : 'cancel', pipeline: f.p.id, name: f.job.name, job: f.job.id };
          if (ui.route.page === 'job') ui.route.id = f.job.id;
          changed(ev);
          break;
        }
        case 'graph-by': ui.graphBy = a.dataset.v; renderGl(); emit({ type: 'graph-by', v: a.dataset.v }); break;
        case 'pipe-tab': ui.pipeTab = a.dataset.v; renderGl(); if (a.dataset.v === 'tests') emit({ type: 'tests-tab', pipeline: ui.route.id }); break;
        case 'art-browse': ui.browse = ui.browse === id ? null : id; renderGl(); emit({ type: 'artifacts', job: id, name: findJob(id).job.name }); break;
        case 'art-download': emit({ type: 'artifacts', job: id, name: findJob(id).job.name, download: true }); Core.modal(`<h3>artifacts.zip</h3><p>Архив артефактов джоба <b>#${id}</b> скачан: ${Object.keys(findJob(id).job.artifacts.files).map(esc).join(', ')}</p><button class="btn" id="modal-close" type="button">OK</button>`); break;
        case 'ed-tab': ui.edTab = a.dataset.v; renderGl(); break;
        case 'ed-reset': { const d = ciDraft(ui.edBranch); d.text = d.orig; renderGl(); break; }
        case 'lint': {
          const d = ciDraft(ui.edBranch);
          const cfg = ciConfig(d.text);
          const src = ui.lintSrc || 'push-main';
          if (cfg.errors.length) ui.lint = { errors: cfg.errors };
          else {
            const ref = src === 'push-main' ? 'main' : src === 'tag' ? 'v1.0.0' : ui.edBranch === 'main' ? 'feature' : ui.edBranch;
            const fake = { id: 0, ref, sha: w.R.heads[ui.edBranch], source: src === 'mr' ? 'merge_request_event' : 'push', tag: src === 'tag', mr: null };
            const vars = pipelineVars(w, fake);
            if (src === 'mr') Object.assign(vars, { CI_MERGE_REQUEST_IID: '1', CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: ref, CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main' });
            Object.keys(cfg.variables).forEach((k) => { if (vars[k] == null) vars[k] = cfg.variables[k]; });
            ui.lint = { errors: null, jobs: plannedJobs(cfg, vars).jobs };
          }
          renderGl();
          emit({ type: 'lint', valid: !cfg.errors.length, errors: cfg.errors, source: src, branch: ui.edBranch });
          break;
        }
        case 'ed-commit': {
          const d = ciDraft(ui.edBranch);
          const b = ui.edBranch;
          const msg = (ui.edMsg || 'Update .gitlab-ci.yml file').trim();
          if (!msg) return errOut('ed', 'Commit message is required.');
          const tree = Object.assign({}, treeOf(w, w.R.heads[b]), { '.gitlab-ci.yml': d.text });
          const h = mkCommit(w, tree, [w.R.heads[b]], msg, ME);
          const before = w.R.heads[b];
          w.R.heads[b] = h;
          ui.drafts[b] = null;
          w.hooks.push({ type: 'branch', name: b, before, after: h });
          changed({ type: 'web-commit', branch: b, sha: h });
          break;
        }
        case 'reveal': ui.reveal = !ui.reveal; renderGl(); break;
        case 'var-add': ui.varForm = { i: null, key: '', value: '', masked: false, protected: true }; renderGl(); break;
        case 'var-edit': { const v = w.gl.vars[Number(a.dataset.i)]; ui.varForm = { i: Number(a.dataset.i), key: v.key, value: v.value, masked: v.masked, protected: v.protected }; renderGl(); break; }
        case 'var-cancel': ui.varForm = null; renderGl(); break;
        case 'var-del': w.gl.vars.splice(ui.varForm.i, 1); ui.varForm = null; changed({ type: 'var-delete' }); break;
        case 'var-save': {
          const f = ui.varForm;
          const key = f.key.trim();
          if (!key) return errOut('var', "Key can't be blank");
          if (!/^[A-Za-z0-9_]+$/.test(key)) return errOut('var', "Key can contain only letters, digits and '_'.");
          if (w.gl.vars.some((v, i) => v.key === key && i !== f.i)) return errOut('var', `(${key}) has already been taken`);
          if (f.masked && (f.value.length < 8 || !/^[A-Za-z0-9+/=@:.~_-]+$/.test(f.value))) return errOut('var', 'Unable to create masked variable because: The value must have at least 8 characters and consist only of characters from the Base64 alphabet (RFC4648), plus @ : . ~ - _ and no spaces.');
          const v = { key, value: f.value, masked: !!f.masked, protected: !!f.protected };
          if (f.i == null) w.gl.vars.push(v); else w.gl.vars[f.i] = v;
          ui.varForm = null;
          changed(Object.assign({ type: 'var' }, v, { value: undefined }));
          break;
        }
        default: break;
      }
    });
    function bindInput(e) {
      const t = e.target;
      const k = t.dataset.bind;
      if (!k) {
        if (t.dataset.act === 'mr-opt') {
          const m = w.gl.mrs.find((x) => x.iid === ui.route.id);
          m[t.dataset.k] = t.checked;
          emit({ type: 'mr-opt', k: t.dataset.k, v: t.checked });
        }
        return;
      }
      const val = t.type === 'checkbox' ? t.checked : t.value;
      if (k.startsWith('mr.')) {
        ui.newMr[k.slice(3)] = val;
        if (k === 'mr.source' && e.type === 'change') { ui.newMr.title = w.R.heads[val] ? subject(w.store[w.R.heads[val]]) : ''; renderGl(); }
      } else if (k.startsWith('var.')) {
        const f = ui.varForm;
        if (k === 'var.visible') f.masked = val === 'masked';
        else f[k.slice(4)] = val;
      } else if (k === 'edText') {
        ciDraft(ui.edBranch).text = val;
        clearTimeout(bindInput.t);
        bindInput.t = setTimeout(() => {
          const cfg = ciConfig(val);
          const st = page.querySelector('.ed-status');
          if (st) { st.className = 'ed-status ' + (cfg.errors.length ? 'bad' : 'ok'); st.textContent = cfg.errors.length ? `✕ This GitLab CI configuration is invalid: ${cfg.errors[0]}` : '✓ Pipeline syntax is correct.'; }
          const d = ciDraft(ui.edBranch);
          page.querySelectorAll('[data-act="ed-commit"], [data-act="ed-reset"]').forEach((b) => { b.disabled = d.text === d.orig; });
          emit({ type: 'ci-draft', branch: ui.edBranch, valid: !cfg.errors.length });
        }, 250);
      } else if (k === 'edMsg') ui.edMsg = val;
      else if (e.type === 'change') {
        if (k === 'fileRef') { ui.fileRef = val; ui.filePath = null; }
        else if (k === 'edBranch') { ui.edBranch = val; ui.lint = null; }
        else ui[k] = val;
        renderGl();
      }
    }
    gl.addEventListener('input', bindInput);
    gl.addEventListener('change', bindInput);
    gl.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && e.target.classList.contains('ed-text')) {
        e.preventDefault();
        e.target.setRangeText('  ', e.target.selectionStart, e.target.selectionEnd, 'end');
        e.target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    // ---------- таймер раннера ----------
    TICK = setInterval(() => {
      if (!el.isConnected) { clearInterval(TICK); TICK = null; return; }
      const ch = advance(w, Date.now());
      if (ch || ui.dirty) {
        ui.dirty = false;
        if (ui.view === 'gl' && LIVE.includes(ui.route.page) && !(document.activeElement && page.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) renderGl();
        updateBadge();
      }
    }, 150);

    print(C.dim(`Терминал проекта shop (${L.inited ? 'git-репозиторий' : 'папка ещё не под git'}). Введи help — список команд.`));
    refreshWs();
    renderGl();
    if (level.startView === 'gl') setView('gl');
    ctx.state.go = go;
    return {};
  }

  // ---------- уровни ----------

  const Wd = (ctx) => ctx.state.w;
  const cmdOk = (ctx, re) => ctx.log.some((e) => e.type === 'cmd' && e.code === 0 && re.test(e.line));
  const viewed = (ctx, pred) => ctx.log.some((e) => e.type === 'view' && pred(e));
  const pipeAt = (w, ref, shaV) => w.gl.pipelines.find((p) => p.ref === ref && p.sha === shaV && !p.mr);
  const jobOf = (p, name) => (p ? p.jobs.find((j) => j.name === name) : null);
  const markers = (s) => /^(<{7}|={7}|>{7})/m.test(s || '');
  function loadMod(tree, path) {
    try { return makeRequire(tree, {}).load(path); } catch (e) { return null; }
  }
  const okCfg = (text) => { const c = ciConfig(text || ''); return c.errors.length ? null : c; };
  // Какие джобы будут в пайплайне для события: 'mr' | 'main' | 'branch'
  function planFor(w, text, kind) {
    const cfg = okCfg(text);
    if (!cfg) return null;
    const fake = { id: 0, sha: w.R.heads.main, tag: false, mr: null, ref: kind === 'main' ? 'main' : 'feature/x', source: kind === 'mr' ? 'merge_request_event' : 'push' };
    const vars = pipelineVars(w, fake);
    if (kind === 'mr') Object.assign(vars, { CI_MERGE_REQUEST_IID: '1', CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'feature/x', CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main' });
    Object.keys(cfg.variables).forEach((k) => { if (vars[k] == null) vars[k] = cfg.variables[k]; });
    const r = {};
    plannedJobs(cfg, vars).jobs.forEach((j) => { r[j.def.name] = j.when; });
    return r;
  }
  const featureBranch = (w, prefix) => {
    const b = w.L.head.branch;
    return b && b.startsWith(prefix) ? b : null;
  };
  const answerIdx = (opts, right) => opts.indexOf(right);

  const CI_MR = `stages:
  - build
  - test
  - deploy

default:
  image: node:20-alpine

# общие правила: MR-пайплайны и main
.mr-and-main:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "main"

build:
  extends: .mr-and-main
  stage: build
  script:
    - npm ci
    - npm run build
  artifacts:
    paths:
      - dist/
    expire_in: 1 week

unit-tests:
  extends: .mr-and-main
  stage: test
  script:
    - npm ci
    - npm test
  artifacts:
    reports:
      junit: junit.xml
`;
  const DEPLOY_MANUAL = `
deploy:
  stage: deploy
  script:
    - ./deploy.sh production
  environment: production
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: manual
`;
  const E2E_JOB = `
e2e:
  extends: .mr-and-main
  stage: test
  script:
    - npm ci
    - npm run e2e
`;

  const levels = [];
  const L1 = {
    id: 'git-1', title: 'Первый коммит', giver: { name: 'Хранитель свитков', sprite: '📜' }, gold: 80,
    setup(S, w) {
      w.L.inited = false;
      w.L.hasRemote = false;
      w.L.head = { branch: 'main' };
      S.work({ 'README.md': F['README.md'], 'package.json': F['package.json'], '.gitignore': 'node_modules/\n', 'src/config.js': F['src/config.js'], 'src/cart.js': F['src/cart.js'], 'test/cart.test.js': F['test/cart.test.js'], 'node_modules/jest/package.json': '{ "name": "jest" }\n' });
    },
    steps: [
      { id: 'init', text: 'Папка проекта ещё не под контролем версий. Создай в ней git-репозиторий: <code>git init</code>.', check: (ctx) => Wd(ctx).L.inited },
      { id: 'status', text: 'Посмотри состояние репозитория: <code>git status</code>. Все файлы сейчас <i>Untracked</i>, а <code>node_modules/</code> скрыт благодаря <code>.gitignore</code>.', check: (ctx) => cmdOk(ctx, /^git status/) },
      {
        id: 'add', text: 'Добавь все файлы проекта в индекс (staging area) и снова посмотри <code>git status</code> — они станут зелёными.',
        check: (ctx) => { const w = Wd(ctx); const d = statusData(w); return !d.untracked.length && d.staged.length >= 6 && cmdOk(ctx, /^git status/) && ctx.log.filter((e) => e.type === 'cmd' && /^git status/.test(e.line)).length >= 2; },
      },
      {
        id: 'commit', text: 'Сделай первый коммит с понятным сообщением: <code>git commit -m "Initial commit"</code>.',
        check: (ctx) => { const w = Wd(ctx); const h = headHash(w); return !!h && w.store[h].msg.trim().length >= 3 && w.store[h].tree['src/cart.js'] != null && w.store[h].tree['README.md'] != null; },
      },
      { id: 'log', text: 'Убедись, что коммит появился в истории: <code>git log</code>.', check: (ctx) => !!headHash(Wd(ctx)) && cmdOk(ctx, /^git log/) },
    ],
    hints: [
      'Порядок работы с git: <code>init</code> → <code>status</code> → <code>add</code> → <code>commit</code> → <code>log</code>.',
      'Добавить всё разом: <code>git add .</code> (точка — текущая папка). Коммит без <code>-m</code> здесь не получится: редактора нет.',
      'Введи по очереди: <code>git init</code>, <code>git status</code>, <code>git add .</code>, <code>git status</code>, <code>git commit -m "Initial commit"</code>, <code>git log</code>.',
    ],
    outro: 'Делай маленькие коммиты с понятными сообщениями — по ним потом ищут, когда появился баг.',
  };
  levels.push(L1);

  levels.push({
    id: 'git-2', title: '.gitignore и restore', giver: { name: 'Страж тайников', sprite: '🗝️' }, gold: 89,
    setup(S) {
      S.std({ noIgnore: true, pipeline: false });
      S.clone('main');
      S.work({ '.env': 'DB_PASSWORD=super-secret-123\n', 'node_modules/jest/package.json': '{ "name": "jest" }\n', 'debug.log': '[debug] cart total = 1299\n',
        'src/cart.js': F['src/cart.js'].replace('  const sum = subtotal(items);\n', '  const sum = subtotal(items);\n  console.log(\'DEBUG total\', sum);\n') });
      S.stage('debug.log');
    },
    steps: [
      { id: 'unstage', text: 'В индекс случайно попал <code>debug.log</code>. Убери его из индекса, но не удаляй файл: <code>git restore --staged debug.log</code>.', check: (ctx) => { const L = Wd(ctx).L; return L.index['debug.log'] == null && L.work['debug.log'] != null; } },
      {
        id: 'ignore', text: 'Создай в редакторе файл <code>.gitignore</code>, чтобы git перестал видеть <code>.env</code>, папку <code>node_modules/</code> и все <code>*.log</code>. Проверь через <code>git status</code>.',
        check: (ctx) => { const w = Wd(ctx); if (w.L.work['.gitignore'] == null) return false; const ig = ignoredFn(w); return ig('.env') && ig('node_modules/jest/package.json') && ig('debug.log') && ig('logs/app.log') && !ig('src/cart.js') && !ig('README.md'); },
      },
      { id: 'discard', text: 'В <code>src/cart.js</code> осталась отладочная строка с <code>console.log</code>. Отмени это изменение — верни файл к версии из последнего коммита.', check: (ctx) => { const w = Wd(ctx); return w.L.work['src/cart.js'] === headTree(w)['src/cart.js']; } },
      {
        id: 'commit', text: 'Закоммить <code>.gitignore</code> — и только его: секреты и логи не должны попасть в историю.',
        check: (ctx) => { const w = Wd(ctx); const t = headTree(w); return t['.gitignore'] != null && t['.env'] == null && t['debug.log'] == null && !Object.keys(t).some((p) => p.startsWith('node_modules/')) && t['src/cart.js'] === F['src/cart.js']; },
      },
    ],
    hints: [
      '<code>git restore --staged</code> убирает файл из индекса, <code>git restore</code> — откатывает правки в рабочей копии.',
      'Нажми «＋» в дереве файлов, введи <code>.gitignore</code> и впиши три строки: <code>.env</code>, <code>node_modules/</code>, <code>*.log</code>.',
      '<code>git restore --staged debug.log</code> → создай .gitignore с <code>.env</code>, <code>node_modules/</code>, <code>*.log</code> → <code>git restore src/cart.js</code> → <code>git add .gitignore</code> → <code>git commit -m "Add .gitignore"</code>.',
    ],
    outro: 'Если секрет уже попал в коммит, .gitignore не поможет: ключ считается скомпрометированным, его надо перевыпустить.',
  });

  levels.push({
    id: 'git-3', title: 'Ветка и push', giver: { name: 'Садовник ветвей', sprite: '🌳' }, gold: 98,
    setup(S) { S.std(); S.clone('main'); },
    steps: [
      { id: 'branch', text: 'Работу над задачей ведут в отдельной ветке. Создай и переключись на <code>feature/readme-lint</code>: <code>git switch -c feature/readme-lint</code>.', check: (ctx) => !!featureBranch(Wd(ctx), 'feature/') },
      {
        id: 'commit', text: 'Допиши в <code>README.md</code> строку <code>npm run lint</code> в блок запуска и закоммить изменение в этой ветке.',
        check: (ctx) => { const w = Wd(ctx); const b = featureBranch(w, 'feature/'); if (!b) return false; const t = treeOf(w, w.L.heads[b]); return /npm run lint/.test(t['README.md'] || '') && w.L.heads[b] !== w.R.heads.main; },
      },
      {
        id: 'push', text: 'Отправь ветку в GitLab и свяжи её с удалённой: <code>git push -u origin feature/readme-lint</code>.',
        check: (ctx) => { const w = Wd(ctx); return Object.keys(w.R.heads).some((b) => b.startsWith('feature/') && w.L.heads[b] === w.R.heads[b] && w.L.upstream[b] === b && /npm run lint/.test(treeOf(w, w.R.heads[b])['README.md'] || '')); },
      },
      {
        id: 'pipeline', text: 'Push запустил пайплайн. Открой GitLab → <b>Build → Pipelines</b>, дождись статуса <b>passed</b> у пайплайна своей ветки и открой его.',
        check: (ctx) => { const w = Wd(ctx); return viewed(ctx, (e) => e.page === 'pipeline' && w.gl.pipelines.some((p) => p.id === e.id && p.ref.startsWith('feature/') && p.status === 'success')); },
      },
    ],
    hints: [
      'Ветка создаётся локально; в GitLab она появится только после <code>git push</code>.',
      'Без <code>-u</code> git не знает, куда пушить новую ветку. После правки README: <code>git add README.md</code> и <code>git commit -m "…"</code>.',
      '<code>git switch -c feature/readme-lint</code> → в README.md добавь строку <code>npm run lint</code> → <code>git commit -am "Document lint command"</code> → <code>git push -u origin feature/readme-lint</code> → вкладка GitLab → Pipelines → дождись passed → кликни по пайплайну.',
    ],
  });

  levels.push({
    id: 'git-4', title: 'История и diff', giver: { name: 'Летописец', sprite: '🦉' }, gold: 107,
    setup(S, w) {
      S.std({ pipeline: false });
      S.commit('main', { 'README.md': F['README.md'] + '\n## Лицензия\n\nMIT\n' }, 'Add license section to README', 'oleg');
      S.commit('main', { 'src/config.js': F['src/config.js'].replace('shippingCost: 299', 'shippingCost: 349') }, 'Raise shipping cost', 'maria');
      w.meta = { ship: S.refs.main };
      S.commit('main', { 'src/cart.js': F['src/cart.js'].replace('function total', '// TODO: limit the number of items\nfunction total') }, 'Add TODO about item limit', 'igor');
      S.commit('main', { 'test/cart.test.js': F['test/cart.test.js'].replace('.toBe(299)', '.toBe(349)').replace('toBe(1299)', 'toBe(1349)') }, 'Update cart tests', 'anna');
      S.publish('main');
      S.pipeline('main', { ago: 30 });
      S.clone('main');
      S.work({ 'src/config.js': w.L.work['src/config.js'].replace("currency: 'RUB',", "currency: 'RUB', // ISO 4217") });
      S.stage('src/config.js');
      S.work({ 'README.md': w.L.work['README.md'].replace('корзина, скидки и доставка', 'корзина, скидки, доставка и купоны') });
    },
    steps: [
      { id: 'oneline', text: 'Посмотри историю коротко — по строке на коммит: <code>git log --oneline</code>.', check: (ctx) => cmdOk(ctx, /^git log .*--oneline|^git log --oneline/) },
      { id: 'diff', text: 'Что изменено в рабочей копии, но ещё <b>не</b> добавлено в индекс? <code>git diff</code>.', check: (ctx) => cmdOk(ctx, /^git diff(?!.*--(staged|cached))/) },
      { id: 'staged', text: 'А что уже в индексе и попадёт в следующий коммит? <code>git diff --staged</code>.', check: (ctx) => cmdOk(ctx, /^git diff.*--(staged|cached)/) },
      {
        id: 'show', text: 'Стоимость доставки недавно поменяли. Найди этот коммит и открой его целиком: <code>git show &lt;хэш&gt;</code>.',
        check: (ctx) => { const w = Wd(ctx); return ctx.log.some((e) => e.type === 'cmd' && e.code === 0 && e.argv[0] === 'git' && e.argv[1] === 'show' && e.argv.slice(2).some((a) => resolve(w, a) === w.meta.ship)); },
      },
      {
        id: 'who', text: 'Кто автор этого коммита?',
        answer: { kind: 'choice', options: ['Anna Smirnova', 'Igor Petrov', 'Maria Kim', 'Oleg Novikov'], accept: (v) => v === 2, wrong: 'Посмотри строку Author в выводе git show.' },
      },
    ],
    hints: [
      '<code>git diff</code> сравнивает рабочую копию с индексом, <code>git diff --staged</code> — индекс с последним коммитом.',
      'Сузить историю до одного файла: <code>git log --oneline -- src/config.js</code>. Хэш — первые 7 символов строки.',
      '<code>git log --oneline</code> → <code>git diff</code> → <code>git diff --staged</code> → <code>git log --oneline -- src/config.js</code> → <code>git show &lt;хэш «Raise shipping cost»&gt;</code> → ответ: Maria Kim.',
    ],
    outro: 'git log -p, git blame и git show — главные инструменты, чтобы понять, когда и кем внесён баг.',
  });

  levels.push({
    id: 'git-5', title: 'Merge request', giver: { name: 'Ревьюер гильдии', sprite: '🧐' }, gold: 116,
    startView: 'gl',
    setup(S) {
      S.std();
      S.branch('feature/shipping-banner', 'main');
      S.commit('feature/shipping-banner', { 'src/banner.js': "const config = require('./config');\n\n// Баннер «до бесплатной доставки осталось N ₽»\nfunction freeShippingBanner(sum) {\n  const left = config.freeShippingFrom - sum;\n  return left > 0 ? `До бесплатной доставки осталось ${left} ₽` : '';\n}\n\nmodule.exports = { freeShippingBanner };\n" }, 'Add free shipping banner', 'me');
      S.commit('feature/shipping-banner', { 'test/banner.test.js': "const { freeShippingBanner } = require('../src/banner');\n\ntest('shows how much is left', () => {\n  expect(freeShippingBanner(2500)).toBe('До бесплатной доставки осталось 500 ₽');\n});\n\ntest('hidden from 3000', () => {\n  expect(freeShippingBanner(3000)).toBe('');\n});\n" }, 'Cover banner with tests', 'me');
      S.publish('feature/shipping-banner');
      S.pipeline('feature/shipping-banner', { ago: 10 });
      S.clone('main');
      S.local('feature/shipping-banner', true);
    },
    onMr(mr) {
      if (mr.source === 'feature/shipping-banner' && !mr.threads.length) mr.threads.push({ author: 'Anna Smirnova', text: 'Проверь, пожалуйста, границу: при сумме ровно 3000 баннер не должен показываться. Тест на это есть?', resolved: false });
    },
    steps: [
      { id: 'create', text: 'Ветка <code>feature/shipping-banner</code> уже в GitLab. Создай merge request из неё в <code>main</code>: <b>Merge requests → New merge request</b>.', check: (ctx) => Wd(ctx).gl.mrs.some((m) => m.source === 'feature/shipping-banner' && m.target === 'main') },
      { id: 'pipeline', text: 'Посмотри на виджет пайплайна в MR: изменения можно вливать только при зелёном пайплайне.', check: (ctx) => { const w = Wd(ctx); const m = w.gl.mrs.find((x) => x.source === 'feature/shipping-banner'); return !!m && viewed(ctx, (e) => e.page === 'mr' && e.id === m.iid) && (m.state === 'merged' || (mrPipeline(w, m) && mrPipeline(w, m).status === 'success')); } },
      { id: 'thread', text: 'Ревьюер оставил вопрос в обсуждении. Тест <code>hidden from 3000</code> как раз проверяет границу — отметь обсуждение решённым: <b>Resolve thread</b>.', check: (ctx) => Wd(ctx).gl.mrs.some((m) => m.source === 'feature/shipping-banner' && m.threads.length && m.threads.every((t) => t.resolved)) },
      { id: 'merge', text: 'Смёрджи MR, оставив галочку <b>Delete source branch</b>.', check: (ctx) => { const w = Wd(ctx); return w.gl.mrs.some((m) => m.source === 'feature/shipping-banner' && m.state === 'merged' && m.removeSource) && !w.R.heads['feature/shipping-banner']; } },
      { id: 'pull', text: 'Обнови локальный <code>main</code>: переключись на него и сделай <code>git pull</code>.', check: (ctx) => { const w = Wd(ctx); return w.L.head.branch === 'main' && w.L.heads.main === w.R.heads.main && treeOf(w, w.L.heads.main)['src/banner.js'] != null; } },
    ],
    hints: [
      'MR создаётся в GitLab, а не в git. Merge заблокирован, пока есть нерешённые обсуждения или пайплайн не зелёный.',
      'Merge requests → New merge request → Source branch: feature/shipping-banner → Create merge request. Кнопка Resolve thread — под комментарием.',
      'New merge request → выбери ветку → Create → Resolve thread → убедись, что «Delete source branch» отмечено → Merge. Затем в терминале: <code>git switch main</code> и <code>git pull</code>.',
    ],
  });

  levels.push({
    id: 'git-6', title: 'Конфликт слияния', giver: { name: 'Миротворец', sprite: '🕊️' }, gold: 125,
    setup(S) {
      S.std();
      S.branch('feature/max-items', 'main');
      S.commit('feature/max-items', { 'src/config.js': F['src/config.js'].replace('  shippingCost: 299,\n', '  shippingCost: 299,\n  maxItems: 50,\n') }, 'Limit cart to 50 items', 'me');
      S.publish('feature/max-items');
      S.clone('main');
      S.local('feature/max-items', true);
      S.checkout('feature/max-items');
      S.commit('main', { 'src/config.js': F['src/config.js'].replace('  shippingCost: 299,\n', '  shippingCost: 299,\n  taxRate: 0.2,\n') }, 'Add VAT rate to config', 'anna');
      S.publish('main');
      S.pipeline('main', { ago: 5 });
      S.mr({ source: 'feature/max-items', title: 'Limit cart to 50 items' });
    },
    steps: [
      { id: 'conflict', text: 'Пока ты работал, в <code>main</code> влили правку того же места <code>src/config.js</code>. Забери изменения (<code>git fetch</code>) и влей <code>origin/main</code> в свою ветку — получишь конфликт.', check: (ctx) => ctx.log.some((e) => e.type === 'conflict' && e.paths.includes('src/config.js')) },
      {
        id: 'resolve', text: 'Открой <code>src/config.js</code> в редакторе: оставь <b>обе</b> настройки — <code>taxRate: 0.2</code> и <code>maxItems: 50</code> — и удали маркеры конфликта.',
        check: (ctx) => { const t = Wd(ctx).L.work['src/config.js'] || ''; if (markers(t)) return false; const m = loadMod({ 'src/config.js': t }, 'src/config.js'); return !!m && m.taxRate === 0.2 && m.maxItems === 50 && m.shippingCost === 299; },
      },
      {
        id: 'commit', text: 'Отметь конфликт решённым (<code>git add</code>) и заверши слияние коммитом.',
        check: (ctx) => { const w = Wd(ctx); const L = w.L; if (L.merging || L.seq || L.unmerged.length || L.head.branch !== 'feature/max-items') return false; const t = headTree(w)['src/config.js'] || ''; return !markers(t) && /taxRate/.test(t) && /maxItems/.test(t) && isAncestor(w, w.R.heads.main, headHash(w)); },
      },
      { id: 'push', text: 'Отправь ветку в GitLab.', check: (ctx) => { const w = Wd(ctx); const h = w.R.heads['feature/max-items']; return !!h && h === w.L.heads['feature/max-items'] && isAncestor(w, w.R.heads.main, h); } },
      { id: 'mr', text: 'Открой MR этой ветки в GitLab: блокировка «merge conflicts must be resolved» должна исчезнуть.', check: (ctx) => { const w = Wd(ctx); const m = w.gl.mrs.find((x) => x.source === 'feature/max-items'); return !!m && isAncestor(w, w.R.heads.main, w.R.heads['feature/max-items']) && viewed(ctx, (e) => e.page === 'mr' && e.id === m.iid) && !mrConflicts(w, m).length; } },
    ],
    hints: [
      'Конфликт — это не ошибка, а вопрос «какую версию оставить». Git помечает спорный кусок маркерами <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> / <code>=======</code> / <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code>.',
      '<code>git fetch</code>, затем <code>git merge origin/main</code>. После правки файла: <code>git add src/config.js</code> и <code>git commit</code> (сообщение подставится само).',
      '<code>git fetch</code> → <code>git merge origin/main</code> → в редакторе оставь строки <code>taxRate: 0.2,</code> и <code>maxItems: 50,</code>, удали три строки-маркера → <code>git add src/config.js</code> → <code>git commit</code> → <code>git push</code> → GitLab → Merge requests → !1.',
    ],
    outro: 'После разрешения конфликта всегда прогоняй тесты: синтаксически верный файл ещё не значит рабочий код.',
  });

  levels.push({
    id: 'git-7', title: 'Stash', giver: { name: 'Хранительница карманов', sprite: '🎒' }, gold: 134,
    setup(S, w) {
      S.std();
      S.branch('feature/search', 'main');
      S.commit('feature/search', { 'src/cart.js': F['src/cart.js'].replace('module.exports = { subtotal, shipping, total };', 'function count(items) {\n  return items.reduce((n, item) => n + item.qty, 0);\n}\n\nmodule.exports = { subtotal, shipping, total, count };') }, 'Add items counter', 'me');
      S.publish('feature/search');
      S.clone('main');
      S.local('feature/search', true);
      S.checkout('feature/search');
      S.commit('main', { 'README.md': F['README.md'].replace('## Запуск', '## Запуск\n\nНужен Node.js 20.') }, 'Hotfix: document Node.js version', 'oleg');
      S.publish('main');
      const wip = w.L.work['src/cart.js'].replace('function count(items) {', '// поиск товара по названию\nfunction find(items, q) {\n  return items.filter((i) => i.title.toLowerCase().includes(q.toLowerCase()));\n}\n\nfunction count(items) {');
      S.work({ 'src/cart.js': wip, 'src/search.js': "// TODO: полнотекстовый поиск\nmodule.exports = {};\n" });
      w.meta = { wip };
    },
    steps: [
      { id: 'stash', text: 'Тимлид просит срочно подтянуть хотфикс в <code>main</code>, а у тебя незаконченная работа. Спрячь её вместе с новым файлом <code>src/search.js</code>: <code>git stash -u</code>.', check: (ctx) => { const w = Wd(ctx); return w.L.stash.length > 0 && w.L.stash[0].work['src/search.js'] != null && w.L.work['src/search.js'] == null && w.L.work['src/cart.js'] === headTree(w)['src/cart.js']; } },
      { id: 'main', text: 'Переключись на <code>main</code> и подтяни хотфикс: <code>git pull</code>.', check: (ctx) => { const w = Wd(ctx); return w.L.head.branch === 'main' && w.L.heads.main === w.R.heads.main; } },
      { id: 'pop', text: 'Вернись в <code>feature/search</code> и достань спрятанное: <code>git stash pop</code>.', check: (ctx) => { const w = Wd(ctx); return w.L.head.branch === 'feature/search' && !w.L.stash.length && w.L.work['src/search.js'] != null && w.L.work['src/cart.js'] === w.meta.wip; } },
      { id: 'commit', text: 'Закоммить работу (оба файла) и запушь ветку.', check: (ctx) => { const w = Wd(ctx); const t = treeOf(w, w.R.heads['feature/search']); return t['src/search.js'] != null && /function find/.test(t['src/cart.js'] || ''); } },
    ],
    hints: [
      'Без <code>-u</code> stash не берёт неотслеживаемые (новые) файлы. Список спрятанного — <code>git stash list</code>.',
      'Попробуй <code>git switch main</code> до stash — git откажет: локальные правки будут перезаписаны.',
      '<code>git stash -u</code> → <code>git switch main</code> → <code>git pull</code> → <code>git switch feature/search</code> → <code>git stash pop</code> → <code>git add .</code> → <code>git commit -m "Add search"</code> → <code>git push</code>.',
    ],
  });

  levels.push({
    id: 'git-8', title: 'Revert в main', giver: { name: 'Часовщик', sprite: '⏳' }, gold: 143,
    setup(S, w) {
      S.std();
      S.commit('main', { 'src/discount.js': F['src/discount.js'].replace('Math.round', 'Math.floor') }, 'Speed up discount calculation', 'oleg');
      w.meta = { bad: S.refs.main };
      S.commit('main', { 'README.md': F['README.md'] + '\n## Контакты\n\nqa-guild@academy.qa\n' }, 'Add contacts to README', 'maria');
      S.publish('main');
      S.pipeline('main', { ago: 15 });
      S.clone('main');
    },
    steps: [
      { id: 'repro', text: 'После последних коммитов пайплайн <code>main</code> красный. Воспроизведи проблему локально: <code>npm test</code>.', check: (ctx) => ctx.log.some((e) => e.type === 'npm-test' && !e.ok) },
      {
        id: 'revert', text: 'Виноват коммит <i>Speed up discount calculation</i>. Отмени его, <b>не переписывая</b> историю (main общий и защищённый): <code>git revert &lt;хэш&gt;</code>.',
        check: (ctx) => { const w = Wd(ctx); const h = headHash(w); const t = treeOf(w, h); return isAncestor(w, w.meta.bad, h) && /Math\.round/.test(t['src/discount.js'] || '') && /Контакты/.test(t['README.md'] || '') && /^Revert "Speed up discount calculation"/.test(w.store[h].msg); },
      },
      { id: 'test', text: 'Проверь, что тесты снова зелёные: <code>npm test</code>.', check: (ctx) => ctx.log.some((e) => e.type === 'npm-test' && e.ok) },
      { id: 'push', text: 'Запушь <code>main</code> и дождись зелёного пайплайна.', check: (ctx) => { const w = Wd(ctx); const p = pipeAt(w, 'main', w.R.heads.main); return w.R.heads.main === w.L.heads.main && /^Revert/.test(w.store[w.R.heads.main].msg) && !!p && p.status === 'success'; } },
    ],
    hints: [
      '<code>git revert</code> создаёт новый коммит с обратными изменениями. <code>git reset</code> + force push в защищённый main GitLab не пропустит.',
      'Хэш плохого коммита — в <code>git log --oneline</code>. Можно сослаться и относительно: <code>HEAD~1</code>.',
      '<code>npm test</code> → <code>git log --oneline</code> → <code>git revert HEAD~1</code> → <code>npm test</code> → <code>git push</code> → GitLab → Pipelines.',
    ],
    outro: 'В общих ветках откатывают через revert: история остаётся честной, а коллегам не нужно ничего чинить у себя.',
  });

  levels.push({
    id: 'git-9', title: 'Cherry-pick хотфикса', giver: { name: 'Сборщица вишен', sprite: '🍒' }, gold: 152,
    setup(S, w) {
      S.std();
      S.branch('release/1.4', 'main');
      S.publish('release/1.4');
      S.pipeline('release/1.4', { ago: 300 });
      S.commit('main', { 'src/wishlist.js': "// Список желаний (в разработке, не для релиза 1.4)\nconst items = [];\nfunction add(id) { items.push(id); }\nmodule.exports = { add, items };\n" }, 'Add wishlist (WIP)', 'igor');
      const fixed = F['src/discount.js'].replace("  if (percent < 0", "  if (price < 0) throw new Error('Invalid price');\n  if (percent < 0");
      S.commit('main', { 'src/discount.js': fixed, 'test/discount.test.js': F['test/discount.test.js'].replace("  test('rejects percent above 100'", "  test('rejects negative price', () => {\n    expect(() => applyDiscount(-5, 10)).toThrow('Invalid price');\n  });\n  test('rejects percent above 100'") }, 'Fix: reject negative prices in applyDiscount', 'anna');
      w.meta = { fix: S.refs.main };
      S.commit('main', { 'src/wishlist.js': "// Список желаний (в разработке, не для релиза 1.4)\nconst items = [];\nfunction add(id) { if (!items.includes(id)) items.push(id); }\nmodule.exports = { add, items };\n" }, 'Wishlist: skip duplicates', 'igor');
      S.publish('main');
      S.pipeline('main', { ago: 20 });
      S.clone('main');
    },
    steps: [
      { id: 'switch', text: 'В релизе 1.4 нашли баг, а исправление уже есть в <code>main</code>. Переключись на релизную ветку <code>release/1.4</code> (локально её ещё нет — git создаст её из origin).', check: (ctx) => Wd(ctx).L.head.branch === 'release/1.4' },
      {
        id: 'pick', text: 'Перенеси в релиз <b>только</b> коммит <i>Fix: reject negative prices in applyDiscount</i>: <code>git cherry-pick &lt;хэш&gt;</code>. Недоделанный wishlist в релиз попасть не должен.',
        check: (ctx) => { const w = Wd(ctx); if (w.L.head.branch !== 'release/1.4' || w.L.seq) return false; const t = headTree(w); return /Invalid price/.test(t['src/discount.js'] || '') && t['src/wishlist.js'] == null && /reject negative prices/.test(w.store[headHash(w)].msg); },
      },
      { id: 'push', text: 'Запушь релизную ветку.', check: (ctx) => { const w = Wd(ctx); const h = w.R.heads['release/1.4']; return h === w.L.heads['release/1.4'] && /Invalid price/.test(treeOf(w, h)['src/discount.js'] || ''); } },
      { id: 'pipeline', text: 'Дождись зелёного пайплайна на <code>release/1.4</code>.', check: (ctx) => { const w = Wd(ctx); const p = pipeAt(w, 'release/1.4', w.R.heads['release/1.4']); return !!p && p.status === 'success' && /Invalid price/.test(treeOf(w, p.sha)['src/discount.js'] || ''); } },
    ],
    hints: [
      'cherry-pick копирует изменения одного коммита на текущую ветку новым коммитом (с новым хэшем).',
      'Хэш исправления найди в истории main: <code>git log --oneline main</code>. Переключение: <code>git switch release/1.4</code>.',
      '<code>git switch release/1.4</code> → <code>git log --oneline main</code> → <code>git cherry-pick &lt;хэш Fix: reject negative prices&gt;</code> → <code>git push</code> → GitLab → Pipelines.',
    ],
  });

  levels.push({
    id: 'git-10', title: 'Rebase на свежий main', giver: { name: 'Ткач истории', sprite: '🧵' }, gold: 161,
    setup(S) {
      S.std();
      S.branch('feature/coupons', 'main');
      S.commit('feature/coupons', { 'src/coupon.js': "const CODES = { WELCOME: 10, QA2026: 15 };\n\nfunction couponPercent(code) {\n  return CODES[String(code).toUpperCase()] || 0;\n}\n\nmodule.exports = { couponPercent };\n" }, 'Add coupon codes', 'me');
      S.commit('feature/coupons', { 'test/coupon.test.js': "const { couponPercent } = require('../src/coupon');\n\ntest('known code', () => {\n  expect(couponPercent('welcome')).toBe(10);\n});\n\ntest('unknown code', () => {\n  expect(couponPercent('nope')).toBe(0);\n});\n" }, 'Test coupon codes', 'me');
      S.publish('feature/coupons');
      S.clone('main');
      S.local('feature/coupons', true);
      S.checkout('feature/coupons');
      S.commit('main', { 'README.md': F['README.md'].replace('## Запуск', '## Требования\n\nNode.js 20+\n\n## Запуск') }, 'Document requirements', 'oleg');
      S.commit('main', { 'src/config.js': F['src/config.js'].replace("currency: 'RUB',", "currency: 'RUB',\n  locale: 'ru-RU',") }, 'Add locale to config', 'anna');
      S.publish('main');
      S.pipeline('main', { ago: 8 });
    },
    steps: [
      { id: 'fetch', text: 'В <code>main</code> появились новые коммиты. Забери их с сервера, не меняя свои ветки: <code>git fetch</code>.', check: (ctx) => { const w = Wd(ctx); return w.L.tracking.main === w.R.heads.main; } },
      {
        id: 'rebase', text: 'Перенеси свои коммиты поверх свежего main, чтобы история осталась линейной: <code>git rebase origin/main</code>. Посмотри результат в <code>git log --oneline --graph</code>.',
        check: (ctx) => { const w = Wd(ctx); if (w.L.head.branch !== 'feature/coupons' || w.L.seq) return false; const h = headHash(w); const own = revList(w, [h], [w.R.heads.main]); return isAncestor(w, w.R.heads.main, h) && own.length === 2 && own.every((c) => c.parents.length === 1) && headTree(w)['src/coupon.js'] != null; },
      },
      {
        id: 'push', text: 'Обычный <code>git push</code> отклонят: история ветки переписана. Отправь её безопасным принудительным пушем: <code>git push --force-with-lease</code>.',
        check: (ctx) => { const w = Wd(ctx); const h = w.R.heads['feature/coupons']; return h === w.L.heads['feature/coupons'] && isAncestor(w, w.R.heads.main, h) && revList(w, [h], [w.R.heads.main]).every((c) => c.parents.length === 1); },
      },
      {
        id: 'why', text: 'Чем <code>--force-with-lease</code> безопаснее <code>--force</code>?',
        answer: { kind: 'choice', options: ['Он работает быстрее', 'Он откажет, если на сервере появились чужие коммиты, которых ты ещё не видел', 'Он сам делает rebase перед отправкой', 'Он пушит только теги'], accept: (v) => v === 1, wrong: 'Подумай, что будет, если коллега успел запушить в ту же ветку.' },
      },
    ],
    hints: [
      'rebase берёт твои коммиты и заново применяет их поверх новой базы — хэши меняются, поэтому нужен принудительный push.',
      '<code>git fetch</code> обновляет только <code>origin/*</code>. Затем <code>git rebase origin/main</code>.',
      '<code>git fetch</code> → <code>git rebase origin/main</code> → <code>git log --oneline --graph</code> → <code>git push --force-with-lease</code> → ответ: «откажет, если на сервере появились чужие коммиты».',
    ],
    outro: 'Rebase — только для своих веток. Общие ветки (main, release) не переписывают.',
  });

  levels.push({
    id: 'git-11', title: 'Теги и релиз', giver: { name: 'Глашатай релизов', sprite: '🏷️' }, gold: 170,
    setup(S) {
      S.std({ ci: CI_BASIC + `
release:
  stage: deploy
  script:
    - echo "Publishing release $CI_COMMIT_TAG"
    - npm run build
  rules:
    - if: $CI_COMMIT_TAG
` });
      S.tag('v1.3.0', S.refs.main, 'Release 1.3.0');
      S.commit('main', { 'package.json': F['package.json'] }, 'Bump version to 1.4.0', 'anna');
      S.publish('main');
      S.pipeline('main', { ago: 12 });
      S.clone('main');
    },
    steps: [
      { id: 'tag', text: 'Main готов к релизу 1.4.0. Поставь на текущий коммит <b>аннотированный</b> тег: <code>git tag -a v1.4.0 -m "Release 1.4.0"</code>.', check: (ctx) => { const w = Wd(ctx); const t = w.L.tags['v1.4.0']; return !!t && t.annotated && t.hash === w.R.heads.main; } },
      { id: 'push', text: 'Обычный <code>git push</code> теги не отправляет. Отправь тег явно: <code>git push origin v1.4.0</code>.', check: (ctx) => { const w = Wd(ctx); return !!w.R.tags['v1.4.0'] && w.R.tags['v1.4.0'].hash === w.R.heads.main; } },
      { id: 'pipeline', text: 'Тег запустил свой пайплайн. Дождись, пока джоб <code>release</code> (он работает только для тегов) станет passed.', check: (ctx) => { const w = Wd(ctx); return w.gl.pipelines.some((p) => p.tag && p.ref === 'v1.4.0' && jobOf(p, 'release') && jobOf(p, 'release').status === 'success'); } },
      { id: 'tags', text: 'Открой в GitLab <b>Code → Tags</b> и убедись, что <code>v1.4.0</code> на месте.', check: (ctx) => !!Wd(ctx).R.tags['v1.4.0'] && ctx.log.some((e, i) => e.type === 'view' && e.page === 'tags' && i > ctx.log.findIndex((x) => x.type === 'push' && x.kind === 'tag')) },
    ],
    hints: [
      'Аннотированный тег (<code>-a</code>) хранит автора, дату и сообщение — так принято отмечать релизы.',
      'Список тегов — <code>git tag</code>, содержимое — <code>git show v1.4.0</code>. Все теги разом: <code>git push --tags</code>.',
      '<code>git tag -a v1.4.0 -m "Release 1.4.0"</code> → <code>git push origin v1.4.0</code> → GitLab → Pipelines (пайплайн с меткой tag) → Code → Tags.',
    ],
  });

  const BULK = F['src/cart.js'].replace(`function subtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}`, `// Скидка 5% на позицию от 10 штук одного товара
function lineTotal(item) {
  const sum = item.price * item.qty;
  return item.qty > 10 ? Math.round(sum * 0.95) : sum;
}

function subtotal(items) {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}`).replace('module.exports = { subtotal,', 'module.exports = { lineTotal, subtotal,');
  const BULK_TEST = F['test/cart.test.js'].replace("const { subtotal, shipping, total } = require('../src/cart');", "const { lineTotal, subtotal, shipping, total } = require('../src/cart');")
    .replace("  test('total includes shipping'", "  test('no bulk discount below 10 items', () => {\n    expect(lineTotal({ price: 100, qty: 9 })).toBe(900);\n  });\n  test('applies 5% from 10 items', () => {\n    expect(lineTotal({ price: 100, qty: 10 })).toBe(950);\n  });\n  test('total includes shipping'");
  levels.push({
    id: 'git-12', title: 'Упавший пайплайн', giver: { name: 'Следопыт логов', sprite: '🔎' }, gold: 179,
    startView: 'gl',
    setup(S) {
      S.std();
      S.branch('feature/bulk-discount', 'main');
      S.commit('feature/bulk-discount', { 'src/cart.js': BULK, 'test/cart.test.js': BULK_TEST }, 'Add 5% bulk discount from 10 items', 'me');
      S.publish('feature/bulk-discount');
      S.pipeline('feature/bulk-discount', { ago: 4 });
      S.clone('main');
      S.local('feature/bulk-discount', true);
      S.checkout('feature/bulk-discount');
    },
    steps: [
      { id: 'log', text: 'Пайплайн ветки <code>feature/bulk-discount</code> упал. В GitLab открой этот пайплайн, кликни по упавшему джобу и прочитай лог.', check: (ctx) => viewed(ctx, (e) => e.page === 'job' && e.name === 'unit-tests' && e.status === 'failed') },
      {
        id: 'which', text: 'Какой тест упал?',
        answer: { kind: 'choice', options: ['cart › sums price * qty', 'cart › no bulk discount below 10 items', 'cart › applies 5% from 10 items', 'applyDiscount › rounds to whole rubles'], accept: (v) => v === 2, wrong: 'Ищи в логе строку с ● — это имя упавшего теста.' },
      },
      {
        id: 'fix', text: 'Expected 950, Received 1000: на 10 штуках скидки нет. Исправь условие в <code>src/cart.js</code> (тест верный — его не трогай) и проверь локально <code>npm test</code>.',
        check: (ctx) => { const w = Wd(ctx); return w.L.work['test/cart.test.js'] === BULK_TEST && ctx.log.some((e) => e.type === 'npm-test' && e.ok); },
      },
      { id: 'push', text: 'Закоммить исправление и запушь — новый пайплайн должен пройти.', check: (ctx) => { const w = Wd(ctx); const h = w.R.heads['feature/bulk-discount']; const p = pipeAt(w, 'feature/bulk-discount', h); return !!p && p.status === 'success' && treeOf(w, h)['test/cart.test.js'] === BULK_TEST; } },
    ],
    hints: [
      'Лог джоба читают снизу вверх: в конце — итог «Tests: 1 failed», выше — блок с ● и сравнением Expected/Received.',
      'Build → Pipelines → красный пайплайн → джоб unit-tests. В коде сравнение <code>item.qty &gt; 10</code> не включает ровно 10 штук.',
      'Открой джоб unit-tests → ответ «applies 5% from 10 items» → в src/cart.js замени <code>item.qty &gt; 10</code> на <code>item.qty &gt;= 10</code> → <code>npm test</code> → <code>git commit -am "Fix bulk discount threshold"</code> → <code>git push</code>.',
    ],
    outro: 'Если упал тест — сначала реши, кто прав: код или тест. Подгонять тест под баг нельзя.',
  });

  const CI_E2E_BROKEN = CI_BASIC.replace('\ndeploy:', `
e2e:
  stage: tests
  scirpt:
    - npm ci
    - npm run e2e

deploy:`);
  levels.push({
    id: 'git-13', title: 'CI Lint', giver: { name: 'Знаток YAML', sprite: '🧾' }, gold: 187,
    startView: 'gl',
    setup(S) {
      S.std();
      S.branch('ci/e2e-job', 'main');
      S.commit('ci/e2e-job', { '.gitlab-ci.yml': CI_E2E_BROKEN }, 'Add e2e job to the pipeline', 'me');
      S.publish('ci/e2e-job');
      S.pipeline('ci/e2e-job', { ago: 3 });
      S.clone('main');
      S.local('ci/e2e-job', true);
      S.checkout('ci/e2e-job');
    },
    steps: [
      { id: 'see', text: 'Пайплайн ветки <code>ci/e2e-job</code> помечен <b>yaml invalid</b> — джобы даже не создались. Открой <b>Build → Pipeline editor</b>, выбери эту ветку, вкладку <b>Validate</b> и нажми <b>Validate pipeline</b>.', check: (ctx) => ctx.log.some((e) => e.type === 'lint' && !e.valid && e.branch === 'ci/e2e-job') },
      {
        id: 'fix', text: 'В конфиге две ошибки: опечатка в ключе и несуществующая стадия. Исправь их (в редакторе слева или прямо в Pipeline editor), чтобы джоб <code>e2e</code> был в стадии <code>test</code>.',
        check: (ctx) => {
          const w = Wd(ctx);
          const d = ctx.state.ui.drafts['ci/e2e-job'];
          return [w.L.work['.gitlab-ci.yml'], treeOf(w, w.R.heads['ci/e2e-job'])['.gitlab-ci.yml'], d && d.text].some((t) => { const c = okCfg(t); return c && c.jobs.e2e && c.jobs.e2e.stage === 'test' && flatList(c.jobs.e2e.script).some((s) => /npm run e2e/.test(s)); });
        },
      },
      { id: 'lint', text: 'Перепроверь в CI Lint (Validate) — должно быть <b>Syntax is correct</b>.', check: (ctx) => ctx.log.some((e) => e.type === 'lint' && e.valid) },
      { id: 'push', text: 'Закоммить и запушь исправление (или нажми <b>Commit changes</b> в Pipeline editor). Новый пайплайн должен пройти вместе с <code>e2e</code>.', check: (ctx) => { const w = Wd(ctx); const p = pipeAt(w, 'ci/e2e-job', w.R.heads['ci/e2e-job']); return !!p && p.status === 'success' && jobOf(p, 'e2e') && jobOf(p, 'e2e').status === 'success'; } },
    ],
    hints: [
      'GitLab не создаёт ни одного джоба, если .gitlab-ci.yml невалиден. Сообщения CI Lint указывают на конкретный джоб и ключ.',
      '«config contains unknown keys: scirpt» — должно быть <code>script</code>. «chosen stage tests does not exist» — в <code>stages</code> есть только build, test, deploy.',
      'Pipeline editor → Branch: ci/e2e-job → Validate → Validate pipeline. Затем в .gitlab-ci.yml: <code>stage: test</code> и <code>script:</code> → снова Validate → Commit changes (или <code>git commit -am "Fix e2e job"</code> + <code>git push</code>).',
    ],
  });

  const CI_NO_RULES = `stages:
  - test
  - deploy

default:
  image: node:20-alpine

unit-tests:
  stage: test
  script:
    - npm ci
    - npm test

lint:
  stage: test
  script:
    - npm ci
    - npm run lint

deploy:
  stage: deploy
  script:
    - ./deploy.sh production
  environment: production
`;
  levels.push({
    id: 'git-14', title: 'rules для MR-пайплайнов', giver: { name: 'Законник пайплайнов', sprite: '⚖️' }, gold: 196,
    setup(S) {
      S.std({ ci: CI_NO_RULES });
      S.clone('main');
    },
    steps: [
      {
        id: 'rules', text: 'Сейчас <code>deploy</code> выкатывает в production с <b>любой</b> ветки, а MR-пайплайны не создаются вовсе. Допиши в <code>.gitlab-ci.yml</code> <code>rules</code>: <code>unit-tests</code> и <code>lint</code> — в MR-пайплайнах и на main, <code>deploy</code> — только на main.',
        check: (ctx) => {
          const w = Wd(ctx);
          const t = w.L.work['.gitlab-ci.yml'];
          const mr = planFor(w, t, 'mr'), main = planFor(w, t, 'main'), br = planFor(w, t, 'branch');
          return !!mr && !!mr['unit-tests'] && !!mr.lint && !mr.deploy && !!main['unit-tests'] && !!main.lint && !!main.deploy && !br.deploy;
        },
      },
      {
        id: 'mr', text: 'Создай ветку, закоммить и запушь изменение, затем открой merge request в <code>main</code>.',
        check: (ctx) => { const w = Wd(ctx); return w.gl.mrs.some((m) => { const t = treeOf(w, w.R.heads[m.source] || m.sourceSha)['.gitlab-ci.yml']; const mr = planFor(w, t, 'mr'); return mr && mr['unit-tests'] && !mr.deploy; }); },
      },
      { id: 'mrpipe', text: 'Дождись <b>merge request pipeline</b>: тесты прошли, а <code>deploy</code> в нём нет.', check: (ctx) => Wd(ctx).gl.pipelines.some((p) => p.source === 'merge_request_event' && p.status === 'success' && jobOf(p, 'unit-tests') && !jobOf(p, 'deploy')) },
      {
        id: 'var', text: 'Какое условие в <code>rules:if</code> отличает пайплайн merge request от остальных?',
        answer: { kind: 'choice', options: ['$CI_COMMIT_BRANCH == "main"', '$CI_PIPELINE_SOURCE == "merge_request_event"', '$CI_COMMIT_TAG', '$CI_JOB_NAME == "mr"'], accept: (v) => v === 1, wrong: 'Источник пайплайна хранится в CI_PIPELINE_SOURCE.' },
      },
    ],
    hints: [
      'Джоб с <code>rules</code> попадает в пайплайн по первому подошедшему правилу. Не подошло ни одно — джоба нет. Без rules джоб не попадает в MR-пайплайн.',
      'Для тестов два правила: <code>- if: $CI_PIPELINE_SOURCE == "merge_request_event"</code> и <code>- if: $CI_COMMIT_BRANCH == "main"</code>. Для deploy — только второе. Проверить можно в Pipeline editor → Validate.',
      'Каждому из unit-tests и lint добавь <code>rules:</code> с двумя строками <code>- if: …</code> (отступ 2 пробела под rules), deploy — <code>rules: - if: $CI_COMMIT_BRANCH == "main"</code>. Затем <code>git switch -c ci/rules</code>, <code>git commit -am "Add rules"</code>, <code>git push -u origin ci/rules</code>, New merge request.',
    ],
  });

  const CI_ART_BROKEN = CI_MR.replace(`  artifacts:
    paths:
      - dist/
    expire_in: 1 week
`, '').replace(`  artifacts:
    reports:
      junit: junit.xml
`, '') + E2E_JOB;
  levels.push({
    id: 'git-15', title: 'Artifacts и JUnit-отчёт', giver: { name: 'Хранитель артефактов', sprite: '📦' }, gold: 205,
    setup(S) {
      S.std({ ci: CI_ART_BROKEN });
      S.branch('feature/checkout-e2e', 'main');
      S.commit('feature/checkout-e2e', { 'README.md': F['README.md'] + '\n## E2E\n\n`npm run e2e` — сценарии оформления заказа.\n' }, 'Document e2e tests', 'me');
      S.publish('feature/checkout-e2e');
      S.clone('main');
      S.local('feature/checkout-e2e', true);
      S.checkout('feature/checkout-e2e');
      const mr = S.mr({ source: 'feature/checkout-e2e', title: 'Document e2e tests' });
      S.pipeline('feature/checkout-e2e', { source: 'merge_request_event', mr: mr.iid, ago: 6 });
    },
    steps: [
      {
        id: 'paths', text: 'MR-пайплайн падает на <code>e2e</code>: «Cannot find module dist/app.js». Сборка из джоба build никуда не сохраняется. Добавь джобу <code>build</code> <code>artifacts: paths: [dist/]</code> и срок хранения <code>expire_in</code>.',
        check: (ctx) => { const c = okCfg(Wd(ctx).L.work['.gitlab-ci.yml']); const a = c && c.jobs.build && c.jobs.build.artifacts; return !!a && flatList(a.paths).some((p) => /^(\.\/)?dist\/?$/.test(String(p))) && !!a.expire_in; },
      },
      {
        id: 'junit', text: 'Чтобы результаты тестов были видны прямо в MR, добавь джобу <code>unit-tests</code> отчёт: <code>artifacts: reports: junit: junit.xml</code>.',
        check: (ctx) => { const c = okCfg(Wd(ctx).L.work['.gitlab-ci.yml']); const a = c && c.jobs['unit-tests'] && c.jobs['unit-tests'].artifacts; return !!a && isObj(a.reports) && flatList(a.reports.junit).includes('junit.xml'); },
      },
      { id: 'pipe', text: 'Закоммить, запушь и дождись зелёного MR-пайплайна: <code>e2e</code> получит <code>dist/</code> из артефактов build.', check: (ctx) => { const w = Wd(ctx); return w.gl.pipelines.some((p) => p.source === 'merge_request_event' && p.status === 'success' && jobOf(p, 'e2e') && jobOf(p, 'e2e').status === 'success' && p.sha === w.R.heads['feature/checkout-e2e']); } },
      { id: 'browse', text: 'Открой джоб <code>build</code> и посмотри его артефакты (<b>Browse</b>).', check: (ctx) => ctx.log.some((e) => e.type === 'artifacts' && e.name === 'build') },
      { id: 'tests', text: 'Открой отчёт о тестах: вкладка <b>Tests</b> пайплайна или <b>Full report</b> в виджете MR.', check: (ctx) => { const w = Wd(ctx); return ctx.log.some((e) => e.type === 'tests-tab' && w.gl.pipelines.some((p) => p.id === e.pipeline && p.jobs.some((j) => j.junit))); } },
    ],
    hints: [
      'Каждый джоб стартует в чистом контейнере. Файлы между джобами передаются только через <code>artifacts</code>; <code>cache</code> — для ускорения, не для передачи результатов.',
      'Под джобом build: <code>artifacts:</code> → <code>paths:</code> → <code>- dist/</code> и <code>expire_in: 1 week</code>. Под unit-tests: <code>artifacts:</code> → <code>reports:</code> → <code>junit: junit.xml</code>.',
      'Допиши оба блока в .gitlab-ci.yml → <code>git commit -am "Add artifacts"</code> → <code>git push</code> → дождись MR-пайплайна → джоб build → Browse → вкладка Tests пайплайна.',
    ],
  });

  const CI_AUTO_DEPLOY = CI_MR + `
deploy:
  stage: deploy
  script:
    - ./deploy.sh production
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
`;
  levels.push({
    id: 'git-16', title: 'Ручной deploy', giver: { name: 'Привратник прода', sprite: '🚦' }, gold: 214,
    setup(S) {
      S.std({ ci: CI_AUTO_DEPLOY });
      S.clone('main');
    },
    steps: [
      {
        id: 'manual', text: 'Сейчас каждый коммит в main сразу уезжает в production. Сделай deploy ручным: <code>when: manual</code> в правиле для main, и добавь <code>environment: production</code>, чтобы GitLab вёл историю выкладок.',
        check: (ctx) => { const w = Wd(ctx); const t = w.L.work['.gitlab-ci.yml']; const m = planFor(w, t, 'main'); const c = okCfg(t); const env = c && c.jobs.deploy && c.jobs.deploy.environment; return !!m && m.deploy === 'manual' && (env === 'production' || (isObj(env) && env.name === 'production')); },
      },
      { id: 'push', text: 'Закоммить и запушь в <code>main</code>. Дождись пайплайна: тесты зелёные, а <code>deploy</code> ждёт ручного запуска (⚙ manual).', check: (ctx) => { const w = Wd(ctx); return w.gl.pipelines.some((p) => p.ref === 'main' && jobOf(p, 'deploy') && jobOf(p, 'deploy').when === 'manual' && jobOf(p, 'unit-tests') && jobOf(p, 'unit-tests').status === 'success'); } },
      { id: 'play', text: 'Запусти деплой кнопкой ▶ (<b>Run</b>) и дождись успеха.', check: (ctx) => { const w = Wd(ctx); return w.gl.pipelines.some((p) => p.ref === 'main' && jobOf(p, 'deploy') && jobOf(p, 'deploy').when === 'manual' && jobOf(p, 'deploy').status === 'success'); } },
      { id: 'env', text: 'Открой <b>Operate → Environments</b>: в <code>production</code> должен быть твой коммит.', check: (ctx) => { const w = Wd(ctx); const e = w.gl.envs.production; return !!e && e.sha === w.R.heads.main && ctx.log.some((x, i) => x.type === 'view' && x.page === 'envs' && i > ctx.log.findIndex((y) => y.type === 'play')); } },
    ],
    hints: [
      '<code>when: manual</code> можно поставить прямо в правило: <code>- if: $CI_COMMIT_BRANCH == "main"</code> и строкой ниже <code>when: manual</code>.',
      'Ручной джоб в графе пайплайна — с шестерёнкой ⚙ и кнопкой ▶. Пайплайн при этом считается passed.',
      'В deploy: <code>environment: production</code>, в rules под <code>- if: …main"</code> добавь <code>  when: manual</code> → <code>git commit -am "Manual deploy"</code> → <code>git push</code> → Pipelines → ▶ у deploy → Environments.',
    ],
  });

  levels.push({
    id: 'git-17', title: 'Флаки-тест и Retry', giver: { name: 'Укротитель флаки', sprite: '🎲' }, gold: 223,
    startView: 'gl',
    setup(S, w) {
      S.std({ ci: CI_MR + E2E_JOB + DEPLOY_MANUAL });
      S.branch('feature/promo-text', 'main');
      S.commit('feature/promo-text', { 'README.md': F['README.md'].replace('Интернет-магазин гильдии', 'Интернет-магазин гильдии (осенняя распродажа!)') }, 'Update promo text in README', 'me');
      S.publish('feature/promo-text');
      S.clone('main');
      S.local('feature/promo-text', true);
      const mr = S.mr({ source: 'feature/promo-text', title: 'Update promo text in README' });
      w.gl.ci.flaky = 1;
      S.pipeline('feature/promo-text', { source: 'merge_request_event', mr: mr.iid, ago: 7 });
    },
    steps: [
      { id: 'log', text: 'MR <i>Update promo text in README</i> заблокирован: пайплайн упал на <code>e2e</code>. Открой лог упавшего джоба.', check: (ctx) => viewed(ctx, (e) => e.page === 'job' && e.name === 'e2e' && e.status === 'failed') },
      {
        id: 'what', text: 'В MR поменялся только текст в README, а упал e2e по таймауту ожидания кнопки. Что это скорее всего?',
        answer: { kind: 'choice', options: ['Баг в коде этого MR', 'Флаки-тест: нестабильный, падает независимо от изменений', 'Ошибка синтаксиса в .gitlab-ci.yml', 'Не хватает переменной DEPLOY_TOKEN'], accept: (v) => v === 1, wrong: 'Изменения не касаются кода, а тест упал на ожидании элемента — подумай о нестабильности.' },
      },
      { id: 'retry', text: 'Перезапусти только этот джоб кнопкой <b>Retry</b> и дождись результата.', check: (ctx) => { const w = Wd(ctx); return ctx.log.some((e) => e.type === 'retry' && (e.name === 'e2e' || e.all)) && w.gl.pipelines.some((p) => p.source === 'merge_request_event' && jobOf(p, 'e2e') && jobOf(p, 'e2e').attempt > 1 && jobOf(p, 'e2e').status === 'success'); } },
      { id: 'merge', text: 'Пайплайн зелёный — смёрджи MR.', check: (ctx) => Wd(ctx).gl.mrs.some((m) => m.source === 'feature/promo-text' && m.state === 'merged') },
    ],
    hints: [
      'Флаки — тест, который то проходит, то падает на одном и том же коде (таймауты, гонки, внешние сервисы).',
      'Открой пайплайн MR → джоб e2e (красный) → кнопка Retry справа сверху. Старая попытка останется в списке Attempts.',
      'Pipelines → красный MR-пайплайн → e2e → прочитай TimeoutError → ответ «Флаки-тест» → Retry → дождись passed → Merge requests → !1 → Merge.',
    ],
    outro: 'Retry — временная мера. Флаки-тест надо завести задачей и стабилизировать, иначе команда перестанет доверять красным пайплайнам.',
  });

  levels.push({
    id: 'git-18', title: 'CI/CD Variables', giver: { name: 'Хранитель секретов', sprite: '🔐' }, gold: 232,
    startView: 'gl',
    setup(S) {
      S.std({ token: false, pipeline: false, ci: CI_BASIC.replace('    - ./deploy.sh production', '    - echo "Using token $DEPLOY_TOKEN"\n    - ./deploy.sh production') });
      S.commit('main', { 'README.md': F['README.md'] + '\nДеплой выполняет джоб deploy из .gitlab-ci.yml.\n' }, 'Document deploy', 'oleg');
      S.publish('main');
      S.pipeline('main', { ago: 9 });
      S.clone('main');
    },
    steps: [
      { id: 'log', text: 'Пайплайн main упал на <code>deploy</code>. Открой лог джоба и найди причину.', check: (ctx) => viewed(ctx, (e) => e.page === 'job' && e.name === 'deploy' && e.status === 'failed') },
      {
        id: 'var', text: `Токен нельзя хранить в репозитории. Добавь в <b>Settings → CI/CD → Variables</b> переменную <code>DEPLOY_TOKEN</code> со значением <code>${DEPLOY_TOKEN}</code>, отметив <b>Masked</b> и <b>Protect variable</b>.`,
        check: (ctx) => { const w = Wd(ctx); const v = w.gl.vars.find((x) => x.key === 'DEPLOY_TOKEN'); return !!v && v.value === DEPLOY_TOKEN && v.masked && v.protected && !Object.values(w.R.heads).some((h) => (treeOf(w, h)['.gitlab-ci.yml'] || '').includes(DEPLOY_TOKEN)); },
      },
      { id: 'retry', text: 'Перезапусти упавший <code>deploy</code> (Retry) и дождись успеха.', check: (ctx) => Wd(ctx).gl.pipelines.some((p) => p.ref === 'main' && jobOf(p, 'deploy') && jobOf(p, 'deploy').status === 'success') },
      { id: 'mask', text: 'Открой лог успешного deploy. Что GitLab вывел вместо значения токена в строке <code>Using token …</code>?', answer: { kind: 'text', placeholder: 'например: ***', accept: (v) => /^\[?masked\]?$/i.test(v.trim()), wrong: 'Посмотри строку «Using token» в логе джоба deploy после Retry.' } },
    ],
    hints: [
      'Переменные проекта попадают в окружение джоба. Masked — значение заменяется в логе, Protected — переменная доступна только на защищённых ветках (main) и тегах.',
      'Settings → CI/CD → Add variable: Visibility = Masked, флаг Protect variable, Key = DEPLOY_TOKEN, Value — из задания.',
      `Открой deploy → увидишь «DEPLOY_TOKEN is not set» → Settings → CI/CD → Add variable (Masked, Protect, DEPLOY_TOKEN = ${DEPLOY_TOKEN}) → Pipelines → deploy → Retry → в логе будет <code>[MASKED]</code>.`,
    ],
    outro: 'Masked скрывает значение только в логе. Кто может менять .gitlab-ci.yml на защищённой ветке, тот может токен использовать — права на main тоже часть безопасности.',
  });

  const CI_DAG = `stages:
  - build
  - test
  - deploy

default:
  image: node:20-alpine

build-frontend:
  stage: build
  script:
    - npm ci
    - npm run build
  artifacts:
    paths:
      - dist/

build-backend:
  stage: build
  script:
    - echo "Compiling API server..."
    - sleep 200

test-frontend:
  stage: test
  script:
    - npm ci
    - npm test

test-backend:
  stage: test
  script:
    - echo "Running API tests..."
    - sleep 150

lint:
  stage: test
  script:
    - npm ci
    - npm run lint
`;
  levels.push({
    id: 'git-19', title: 'needs и DAG', giver: { name: 'Ускоритель конвейера', sprite: '⚡' }, gold: 241,
    setup(S) {
      S.std({ ci: CI_DAG });
      S.branch('ci/speedup', 'main');
      S.commit('ci/speedup', { 'README.md': F['README.md'] + '\nCI: фронтенд и бэкенд собираются параллельно.\n' }, 'Describe CI layout', 'me');
      S.publish('ci/speedup');
      S.pipeline('ci/speedup', { ago: 6 });
      S.clone('main');
      S.local('ci/speedup', true);
      S.checkout('ci/speedup');
    },
    steps: [
      {
        id: 'why', text: 'Открой пайплайн ветки <code>ci/speedup</code>. Почему <code>test-frontend</code> стартует только через ~3,5 минуты, хотя <code>build-frontend</code> собирается за минуту?',
        answer: { kind: 'choice', options: ['Раннер перегружен', 'Он ждёт завершения всей стадии build, включая долгий build-backend', 'Так задан timeout', 'Тесты фронтенда всегда стартуют последними'], accept: (v) => v === 1, wrong: 'Без needs джоб ждёт, пока завершатся все джобы предыдущих стадий.' },
      },
      {
        id: 'needs', text: 'Опиши реальные зависимости через <code>needs</code>: <code>test-frontend</code> ← <code>build-frontend</code>, <code>test-backend</code> ← <code>build-backend</code>, а <code>lint</code> ни от чего не зависит: <code>needs: []</code>.',
        check: (ctx) => {
          const c = okCfg(Wd(ctx).L.work['.gitlab-ci.yml']);
          if (!c) return false;
          const n = (j) => (c.jobs[j] && c.jobs[j].needs != null ? flatList(c.jobs[j].needs).map((x) => (isObj(x) ? x.job : x)).sort().join(',') : null);
          return n('test-frontend') === 'build-frontend' && n('test-backend') === 'build-backend' && n('lint') === '';
        },
      },
      {
        id: 'push', text: 'Закоммить, запушь и дождись пайплайна: <code>test-frontend</code> должен стартовать сразу после <code>build-frontend</code>, а <code>lint</code> — в самом начале.',
        check: (ctx) => { const w = Wd(ctx); const p = pipeAt(w, 'ci/speedup', w.R.heads['ci/speedup']); if (!p || p.status !== 'success') return false; const tf = jobOf(p, 'test-frontend'), bb = jobOf(p, 'build-backend'), li = jobOf(p, 'lint'); return !!tf && !!bb && !!li && tf.simStart < bb.simEnd && li.simStart <= 5; },
      },
      { id: 'graph', text: 'В графе пайплайна переключи <b>Group jobs by → Job dependencies</b>, чтобы увидеть DAG.', check: (ctx) => ctx.log.some((e) => e.type === 'graph-by' && e.v === 'deps') },
    ],
    hints: [
      '<code>needs</code> превращает пайплайн из «стадия за стадией» в граф: джоб стартует, как только готовы именно его зависимости. Артефакты он тоже берёт только у них.',
      'В джобе: <code>needs:</code> и ниже <code>- build-frontend</code>. Для lint — одна строка <code>needs: []</code>.',
      'test-frontend: <code>needs: [build-frontend]</code>, test-backend: <code>needs: [build-backend]</code>, lint: <code>needs: []</code> → <code>git commit -am "Use needs"</code> → <code>git push</code> → пайплайн → Job dependencies. Сравни ⏱ длительности со старым пайплайном.',
    ],
  });

  levels.push({
    id: 'git-20', title: 'Полный цикл', giver: { name: 'Архимаг релизов', sprite: '🧙' }, gold: 250,
    setup(S) {
      S.std({ ci: CI_MR + DEPLOY_MANUAL });
      S.commit('main', { 'src/discount.js': F['src/discount.js'].replace('percent > 100', 'percent >= 100') }, 'Validate discount percent', 'igor');
      S.publish('main');
      S.pipeline('main', { ago: 40 });
      S.clone('main');
      S.commit('main', { 'README.md': F['README.md'] + '\n## Поддержка\n\nБаги — в трекер гильдии.\n' }, 'Add support section', 'maria');
      S.publish('main');
      S.pipeline('main', { ago: 25 });
    },
    steps: [
      { id: 'branch', text: 'Баг-репорт: «скидка 100% (подарок) падает с ошибкой Invalid percent». Создай ветку <code>fix/…</code> от <b>свежего</b> main (локальный main отстал).', check: (ctx) => { const w = Wd(ctx); const b = featureBranch(w, 'fix/'); return !!b && isAncestor(w, w.R.heads.main, w.L.heads[b]); } },
      {
        id: 'fix', text: 'Исправь <code>applyDiscount</code>: скидка 100% должна давать цену 0. Добавь тест на этот случай в <code>test/discount.test.js</code> и прогони <code>npm test</code>.',
        check: (ctx) => {
          const w = Wd(ctx);
          const m = loadMod(w.L.work, 'src/discount.js');
          let ok = false;
          try { ok = !!m && m.applyDiscount(500, 100) === 0 && m.applyDiscount(1000, 10) === 900 && (() => { try { m.applyDiscount(100, 150); return false; } catch (e) { return true; } })(); } catch (e) { ok = false; }
          return ok && /applyDiscount\(\s*[\d.]+\s*,\s*100\s*\)/.test(w.L.work['test/discount.test.js'] || '') && ctx.log.some((e) => e.type === 'npm-test' && e.ok);
        },
      },
      { id: 'mr', text: 'Закоммить, запушь ветку и создай merge request в <code>main</code>. Дождись зелёного MR-пайплайна.', check: (ctx) => { const w = Wd(ctx); return w.gl.mrs.some((m) => m.source.startsWith('fix/') && ((mrPipeline(w, m) && mrPipeline(w, m).status === 'success' && mrPipeline(w, m).source === 'merge_request_event') || m.state === 'merged')); } },
      { id: 'merge', text: 'Смёрджи MR.', check: (ctx) => Wd(ctx).gl.mrs.some((m) => m.source.startsWith('fix/') && m.state === 'merged') },
      {
        id: 'deploy', text: 'В пайплайне <code>main</code> после мёрджа запусти ручной <code>deploy</code> и дождись, пока исправление окажется в production.',
        check: (ctx) => { const w = Wd(ctx); const e = w.gl.envs.production; if (!e || e.sha !== w.R.heads.main) return false; const m = loadMod(treeOf(w, e.sha), 'src/discount.js'); try { return !!m && m.applyDiscount(500, 100) === 0; } catch (x) { return false; } },
      },
    ],
    hints: [
      'Цикл: ветка от свежего main → фикс + тест → push → MR → зелёный пайплайн → merge → ручной deploy.',
      'Свежий main: <code>git pull</code> на main (или <code>git fetch</code> и <code>git switch -c fix/x origin/main</code>). Ошибка в условии <code>percent &gt;= 100</code>.',
      '<code>git pull</code> → <code>git switch -c fix/full-discount</code> → в discount.js <code>percent &gt; 100</code> → в тест добавь <code>test(\'100% is free\', () => { expect(applyDiscount(500, 100)).toBe(0); });</code> → <code>npm test</code> → <code>git commit -am "Allow 100% discount"</code> → <code>git push -u origin fix/full-discount</code> → New merge request → Merge → пайплайн main → ▶ deploy.',
    ],
    outro: 'Это и есть ежедневная работа: маленькая ветка, тест на баг, зелёный пайплайн, ревью, контролируемый деплой.',
  });

  window.Quest.create({ mode: 'git', icon: '🌿', title: 'Git · GitLab CI', buildSim, levels });

  // для отладки и автотестов
  window.GitSim = { parseYaml, ciConfig, runJest, merge3 };
})();
