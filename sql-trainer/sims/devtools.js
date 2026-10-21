// Симулятор Chrome DevTools: веб-приложение со сценарием на каждый уровень
// и панели Elements, Console, Sources, Network, Application + Device Toolbar.
(function () {
  'use strict';

  const Core = window.Core;
  const esc = Core.esc;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const base = (p) => String(p).split('/').pop();

  /* ======================= Виртуальный DOM страницы ======================= */
  let uid = 0;
  // h(tag, attrs, kids|text, opt): opt.k — ключ узла, act — обработчик клика, inp — обработчик ввода,
  // ev — список event listeners (для вкладки Event Listeners), box — размеры по умолчанию, emoji — картинка.
  function h(tag, a, kids, opt) {
    const o = opt || {};
    const n = { k: o.k || (a && a.id) || 'n' + (++uid), tag, a: Object.assign({}, a || {}), kids: [], text: null,
      act: o.act || null, inp: o.inp || null, enter: o.enter || null, ev: o.ev || null, box: o.box || null,
      emoji: o.emoji || null, broken: !!o.broken, collapsed: !!o.collapsed, p: null, val: null, checked: false };
    if (typeof kids === 'string') n.text = kids;
    else if (kids) kids.forEach((c) => {
      if (c == null || c === false) return;
      const x = typeof c === 'string' ? { k: 'n' + (++uid), tag: '#text', text: c, a: {}, kids: [] } : c;
      x.p = n;
      n.kids.push(x);
    });
    if (n.a.value !== undefined) n.val = String(n.a.value);
    if (n.a.checked !== undefined) n.checked = true;
    return n;
  }
  function walk(n, fn) { fn(n); n.kids.forEach((c) => walk(c, fn)); }
  function textOf(n) { return n.tag === '#text' ? n.text : (n.text || '') + n.kids.map(textOf).join(''); }
  const HIDE_CLS = '__web-inspector-hide-shortcut__';

  /* ======================= Селекторы ======================= */
  function parseCompound(s) {
    const c = { tag: null, id: null, cls: [], attrs: [], pseudo: [] };
    let m = s.match(/^(\*|[a-zA-Z][\w-]*)?/);
    if (m[0] && m[0] !== '*') c.tag = m[0].toLowerCase();
    let i = m[0].length;
    while (i < s.length) {
      const rest = s.slice(i);
      if ((m = rest.match(/^#([\w-]+)/))) c.id = m[1];
      else if ((m = rest.match(/^\.([\w-]+)/))) c.cls.push(m[1]);
      else if ((m = rest.match(/^\[\s*([\w-]+)\s*(?:([*^$~]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/))) {
        c.attrs.push({ n: m[1].toLowerCase(), op: m[2] || null, v: m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] });
      } else if ((m = rest.match(/^::?([\w-]+)/))) c.pseudo.push(m[1]);
      else throw new SyntaxError('bad selector');
      i += m[0].length;
    }
    return c;
  }
  function parseSelector(src) {
    return String(src).split(',').map((alt) => {
      const parts = alt.trim().replace(/\s*>\s*/g, ' ').split(/\s+/).filter(Boolean);
      if (!parts.length) throw new SyntaxError('bad selector');
      return parts.map(parseCompound);
    });
  }
  function matchCompound(n, c, st) {
    if (!n || n.tag === '#text') return false;
    if (c.tag && n.tag !== c.tag) return false;
    if (c.id && n.a.id !== c.id) return false;
    if (c.cls.length) {
      const cl = String(n.a.class || '').split(/\s+/);
      if (!c.cls.every((x) => cl.includes(x))) return false;
    }
    for (const at of c.attrs) {
      if (!own(n.a, at.n)) return false;
      const v = String(n.a[at.n]);
      if (at.op === '=' && v !== at.v) return false;
      if (at.op === '*=' && !v.includes(at.v)) return false;
      if (at.op === '^=' && !v.startsWith(at.v)) return false;
      if (at.op === '$=' && !v.endsWith(at.v)) return false;
      if (at.op === '~=' && !v.split(/\s+/).includes(at.v)) return false;
    }
    for (const p of c.pseudo) {
      if (p === 'hover') { if (!st || !st.hover(n)) return false; }
      else if (p === 'disabled') { if (!own(n.a, 'disabled')) return false; }
      else if (p === 'checked') { if (!n.checked) return false; }
      else if (p === 'first-child') { if (!n.p || n.p.kids.filter((x) => x.tag !== '#text')[0] !== n) return false; }
      else return false;
    }
    return true;
  }
  function matchAlt(n, alt, st) {
    if (!matchCompound(n, alt[alt.length - 1], st)) return false;
    let i = alt.length - 2;
    let p = n.p;
    while (i >= 0 && p) {
      if (matchCompound(p, alt[i], st)) i--;
      p = p.p;
    }
    return i < 0;
  }
  const matchSel = (n, parsed, st) => parsed.some((alt) => matchAlt(n, alt, st));

  /* ======================= CSS-декларации ======================= */
  // Разбор style="…": закомментированные свойства (/* … */) — выключенные в DevTools.
  function parseDecls(str) {
    const out = [];
    const re = /\/\*\s*([\s\S]*?)\s*\*\/|([^;]+)/g;
    let m;
    while ((m = re.exec(str || ''))) {
      const off = m[1] !== undefined;
      String(off ? m[1] : m[2]).split(';').forEach((part) => {
        const i = part.indexOf(':');
        if (i > 0) out.push({ p: part.slice(0, i).trim().toLowerCase(), v: part.slice(i + 1).trim(), off });
      });
    }
    return out;
  }
  const declStr = (ds) => ds.map((d) => (d.off ? `/* ${d.p}: ${d.v}; */` : `${d.p}: ${d.v};`)).join(' ');
  function hexRgb(v) {
    const s = String(v).trim().toLowerCase();
    const named = { white: '#ffffff', black: '#000000', red: '#ff0000', transparent: null };
    const x = named[s] !== undefined ? named[s] : s;
    if (x === null) return 'rgba(0, 0, 0, 0)';
    let m = x.match(/^#([0-9a-f]{3})$/);
    if (m) return `rgb(${m[1].split('').map((c) => parseInt(c + c, 16)).join(', ')})`;
    m = x.match(/^#([0-9a-f]{6})$/);
    if (m) return `rgb(${[0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).join(', ')})`;
    return v;
  }
  const isWhite = (v) => /^rgb\(255, 255, 255\)$/.test(hexRgb(v)) || /^rgba\(255, 255, 255/.test(v);
  function sides(v) {
    const p = String(v || '0').split(/\s+/).map((x) => parseFloat(x) || 0);
    const [t, r = t, b = t, l = r] = p;
    return { t, r, b, l };
  }
  const UA = {
    block: ['div', 'form', 'header', 'nav', 'main', 'section', 'footer', 'p', 'h1', 'h2', 'h3', 'ul', 'body', 'html', 'aside', 'article'],
    inline: ['a', 'span', 'label', 'b', 'small', 'strong', 'em', 'img', 'i'],
    ib: ['button', 'input', 'select', 'textarea'],
    none: ['head', 'script', 'link', 'meta', 'title', 'style'],
  };
  function uaDisplay(tag) {
    if (UA.none.includes(tag)) return 'none';
    if (UA.inline.includes(tag)) return 'inline';
    if (UA.ib.includes(tag)) return 'inline-block';
    if (tag === 'li') return 'list-item';
    return 'block';
  }
  function uaRule(tag) {
    const d = [{ p: 'display', v: uaDisplay(tag) }];
    if (tag === 'a') d.push({ p: 'color', v: '-webkit-link' }, { p: 'cursor', v: 'pointer' }, { p: 'text-decoration', v: 'underline' });
    if (tag === 'h1') d.push({ p: 'font-size', v: '2em' }, { p: 'margin-block', v: '0.67em' }, { p: 'font-weight', v: 'bold' });
    if (tag === 'button') d.push({ p: 'padding-block', v: '1px' }, { p: 'padding-inline', v: '6px' }, { p: 'text-align', v: 'center' }, { p: 'cursor', v: 'default' });
    if (tag === 'input') d.push({ p: 'padding-block', v: '1px' }, { p: 'padding-inline', v: '2px' }, { p: 'writing-mode', v: 'horizontal-tb' });
    if (tag === 'body') d.push({ p: 'margin', v: '8px' });
    if (tag === 'ul') d.push({ p: 'list-style-type', v: 'disc' }, { p: 'padding-inline-start', v: '40px' });
    return d;
  }
  const INHERITED = ['color', 'font-size', 'font-family', 'font-weight', 'line-height', 'visibility', 'cursor'];

  /* ======================= Мини-интерпретатор консоли ======================= */
  const META = new WeakMap();
  const BLOCKED = new Set(['__proto__', 'constructor', 'prototype', '__defineGetter__', '__defineSetter__', '__lookupGetter__', 'valueOf']);
  const STR_M = ['includes', 'indexOf', 'slice', 'split', 'toUpperCase', 'toLowerCase', 'trim', 'startsWith', 'endsWith', 'substring', 'charAt', 'replace', 'at', 'padStart'];
  const ARR_M = ['join', 'includes', 'indexOf', 'slice', 'at'];
  function nat(name, fn) { META.set(fn, { kind: 'fn', name }); return fn; }
  class JsError extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } }

  function tokenize(src) {
    const t = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (/[A-Za-z_$]/.test(ch)) {
        let j = i;
        while (j < src.length && /[\w$]/.test(src[j])) j++;
        t.push({ t: 'id', v: src.slice(i, j) });
        i = j;
        continue;
      }
      if (/[0-9]/.test(ch)) {
        const m = src.slice(i).match(/^\d+(\.\d+)?/);
        t.push({ t: 'num', v: Number(m[0]) });
        i += m[0].length;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        let j = i + 1;
        let s = '';
        while (j < src.length && src[j] !== ch) {
          if (src[j] === '\\' && j + 1 < src.length) { const e = src[j + 1]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e; j += 2; } else s += src[j++];
        }
        if (j >= src.length) throw new JsError('SyntaxError', 'Invalid or unexpected token');
        t.push({ t: 'str', v: s });
        i = j + 1;
        continue;
      }
      const op = ['===', '!==', '=>', '==', '!=', '<=', '>=', '&&', '||'].find((o) => src.startsWith(o, i));
      if (op) { t.push({ t: 'op', v: op }); i += op.length; continue; }
      if ('.()[]{},:;=+-*/%!<>?'.includes(ch)) { t.push({ t: 'op', v: ch }); i++; continue; }
      throw new JsError('SyntaxError', 'Invalid or unexpected token');
    }
    return t;
  }

  function parseProgram(src) {
    const toks = tokenize(src);
    let i = 0;
    const peek = (v) => toks[i] && toks[i].t === 'op' && toks[i].v === v;
    const unexpected = () => {
      if (i >= toks.length) throw new JsError('SyntaxError', 'Unexpected end of input');
      const x = toks[i];
      throw new JsError('SyntaxError', x.t === 'op' ? `Unexpected token '${x.v}'` : x.t === 'str' ? 'Unexpected string' : x.t === 'num' ? 'Unexpected number' : `Unexpected identifier '${x.v}'`);
    };
    const eat = (v) => { if (!peek(v)) unexpected(); i++; };
    function primary() {
      const x = toks[i];
      if (!x) unexpected();
      if (x.t === 'num' || x.t === 'str') { i++; return { k: 'lit', v: x.v }; }
      if (x.t === 'id') {
        i++;
        if (x.v === 'true') return { k: 'lit', v: true };
        if (x.v === 'false') return { k: 'lit', v: false };
        if (x.v === 'null') return { k: 'lit', v: null };
        if (x.v === 'function' || x.v === 'new' || x.v === 'class' || x.v === 'await') { i--; unexpected(); }
        return { k: 'id', v: x.v };
      }
      if (peek('(')) { i++; const e = expr(); eat(')'); if (peek('=>')) unexpected(); return e; }
      if (peek('[')) {
        i++;
        const items = [];
        while (!peek(']')) { items.push(expr()); if (!peek(']')) eat(','); }
        i++;
        return { k: 'arr', items };
      }
      if (peek('{')) {
        i++;
        const props = [];
        while (!peek('}')) {
          const key = toks[i];
          if (!key || (key.t !== 'id' && key.t !== 'str' && key.t !== 'num')) unexpected();
          i++;
          eat(':');
          props.push([String(key.v), expr()]);
          if (!peek('}')) eat(',');
        }
        i++;
        return { k: 'obj', props };
      }
      return unexpected();
    }
    function postfix() {
      let e = primary();
      for (;;) {
        if (peek('.')) {
          i++;
          const x = toks[i];
          if (!x || x.t !== 'id') unexpected();
          i++;
          e = { k: 'mem', o: e, p: { k: 'lit', v: x.v }, dot: true };
        } else if (peek('[')) { i++; const p = expr(); eat(']'); e = { k: 'mem', o: e, p }; }
        else if (peek('(')) {
          i++;
          const args = [];
          while (!peek(')')) { args.push(expr()); if (!peek(')')) eat(','); }
          i++;
          e = { k: 'call', f: e, args };
        } else return e;
      }
    }
    function unary() {
      if (peek('!') || peek('-') || peek('+')) { const op = toks[i++].v; return { k: 'un', op, x: unary() }; }
      if (toks[i] && toks[i].t === 'id' && toks[i].v === 'typeof') { i++; return { k: 'typeof', x: unary() }; }
      return postfix();
    }
    const LEVELS = [['||'], ['&&'], ['===', '!==', '==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
    function bin(lv) {
      if (lv >= LEVELS.length) return unary();
      let l = bin(lv + 1);
      while (toks[i] && toks[i].t === 'op' && LEVELS[lv].includes(toks[i].v)) { const op = toks[i++].v; l = { k: 'bin', op, l, r: bin(lv + 1) }; }
      return l;
    }
    function expr() {
      const l = bin(0);
      if (peek('?')) { i++; const a = expr(); eat(':'); return { k: 'cond', c: l, a, b: expr() }; }
      if (peek('=')) {
        if (l.k !== 'id' && l.k !== 'mem') throw new JsError('SyntaxError', 'Invalid left-hand side in assignment');
        i++;
        return { k: 'asg', t: l, v: expr() };
      }
      if (peek('=>')) unexpected();
      return l;
    }
    function statement() {
      const x = toks[i];
      if (x && x.t === 'id' && (x.v === 'let' || x.v === 'const' || x.v === 'var')) {
        i++;
        const name = toks[i];
        if (!name || name.t !== 'id') unexpected();
        i++;
        if (peek('=')) { i++; return { k: 'decl', name: name.v, v: expr() }; }
        return { k: 'decl', name: name.v, v: { k: 'lit', v: undefined } };
      }
      return expr();
    }
    const body = [];
    while (i < toks.length) {
      if (peek(';')) { i++; continue; }
      body.push(statement());
      if (i < toks.length && !peek(';')) unexpected();
    }
    return body;
  }
  function srcOf(e) {
    if (e.k === 'id') return e.v;
    if (e.k === 'mem') return srcOf(e.o) + (e.dot ? '.' + e.p.v : '[…]');
    if (e.k === 'call') return srcOf(e.f) + '(…)';
    return '(intermediate value)';
  }

  /* ---------- форматирование значений, как в консоли Chrome ---------- */
  function elShort(n) {
    return n.tag + (n.a.id ? '#' + n.a.id : '') + (n.a.class ? '.' + String(n.a.class).trim().split(/\s+/).join('.') : '');
  }
  function elTag(n) {
    const at = Object.keys(n.a).map((k) => (n.a[k] === '' ? ` ${k}` : ` ${k}="${n.a[k]}"`)).join('');
    const tx = textOf(n).trim();
    if (['input', 'img', 'meta', 'link'].includes(n.tag)) return `<${n.tag}${at}>`;
    return `<${n.tag}${at}>${tx.length > 40 ? tx.slice(0, 40) + '…' : tx}</${n.tag}>`;
  }
  function fmt(v, depth) {
    const d = depth || 0;
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (typeof v === 'string') return d === 0 ? `'${v}'` : `'${v.length > 60 ? v.slice(0, 60) + '…' : v}'`;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    const m = META.get(v);
    if (typeof v === 'function') return `ƒ ${(m && m.name) || 'anonymous'}() { [native code] }`;
    if (m) {
      if (m.kind === 'el') return d === 0 ? elTag(m.n) : elShort(m.n);
      if (m.kind === 'list') return `NodeList(${v.length}) [${v.slice(0, 6).map((x) => fmt(x, d + 1)).join(', ')}${v.length > 6 ? ', …' : ''}]`;
      if (m.kind === 'storage') {
        const mp = m.map();
        return `Storage {${[...mp.entries()].map(([k, x]) => `${k}: ${fmt(x, 1)}`).join(', ')}${mp.size ? ', ' : ''}length: ${mp.size}}`;
      }
      if (m.kind === 'opaque') return m.label;
    }
    if (Array.isArray(v)) return d > 1 ? `Array(${v.length})` : `(${v.length}) [${v.map((x) => fmt(x, d + 1)).join(', ')}]`;
    if (d > 1) return '{…}';
    return `{${Object.keys(v).map((k) => `${k}: ${fmt(v[k], d + 1)}`).join(', ')}}`;
  }

  function getProp(o, p, ex) {
    if (o === null || o === undefined) throw new JsError('TypeError', `Cannot read properties of ${o === null ? 'null' : 'undefined'} (reading '${p}')`);
    const key = String(p);
    if (BLOCKED.has(key)) return undefined;
    if (typeof o === 'string') {
      if (key === 'length') return o.length;
      if (/^\d+$/.test(key)) return o[+key];
      if (STR_M.includes(key)) return nat(key, (...a) => String.prototype[key].apply(o, a.map((x) => (typeof x === 'function' ? String(x) : x))));
      return undefined;
    }
    if (typeof o === 'number') {
      if (key === 'toFixed') return nat(key, (n) => o.toFixed(n));
      if (key === 'toString') return nat(key, () => String(o));
      return undefined;
    }
    if (typeof o === 'boolean') return undefined;
    if (Array.isArray(o)) {
      if (key === 'length') return o.length;
      if (/^\d+$/.test(key)) return o[+key];
      if (ARR_M.includes(key)) return nat(key, (...a) => Array.prototype[key].apply(o, a));
      return undefined;
    }
    const m = META.get(o);
    if (m && m.kind === 'storage' && !own(o, key)) { const mp = m.map(); return mp.has(key) ? mp.get(key) : undefined; }
    if (m && m.kind === 'window') return ex.lookup(key, true);
    return own(o, key) ? o[key] : undefined;
  }
  function setProp(o, p, v, ex) {
    if (o === null || o === undefined) throw new JsError('TypeError', `Cannot set properties of ${o === null ? 'null' : 'undefined'} (setting '${p}')`);
    const key = String(p);
    if (BLOCKED.has(key) || typeof o !== 'object') return v;
    const m = META.get(o);
    if (m && m.kind === 'storage' && !own(o, key)) { o.setItem(key, v); return v; }
    if (m && m.kind === 'window') { ex.vars.set(key, v); return v; }
    if (Array.isArray(o) && !/^\d+$/.test(key)) return v;
    const desc = Object.getOwnPropertyDescriptor(o, key);
    if (desc && desc.get && !desc.set) return v;
    o[key] = v;
    return v;
  }
  function evalNode(e, ex) {
    switch (e.k) {
      case 'lit': return e.v;
      case 'id': return ex.lookup(e.v);
      case 'arr': return e.items.map((x) => evalNode(x, ex));
      case 'obj': { const o = {}; e.props.forEach(([k, x]) => { if (!BLOCKED.has(k)) o[k] = evalNode(x, ex); }); return o; }
      case 'mem': return getProp(evalNode(e.o, ex), evalNode(e.p, ex), ex);
      case 'call': {
        const fn = evalNode(e.f, ex);
        if (typeof fn !== 'function') throw new JsError('TypeError', `${srcOf(e.f)} is not a function`);
        return fn(...e.args.map((x) => evalNode(x, ex)));
      }
      case 'un': { const x = evalNode(e.x, ex); return e.op === '!' ? !x : e.op === '-' ? -x : +x; }
      case 'typeof': {
        let x;
        try { x = evalNode(e.x, ex); } catch (err) { if (err.kind === 'ReferenceError') return 'undefined'; throw err; }
        return x === null ? 'object' : typeof x;
      }
      case 'cond': return evalNode(e.c, ex) ? evalNode(e.a, ex) : evalNode(e.b, ex);
      case 'bin': {
        if (e.op === '&&') { const l = evalNode(e.l, ex); return l ? evalNode(e.r, ex) : l; }
        if (e.op === '||') { const l = evalNode(e.l, ex); return l ? l : evalNode(e.r, ex); }
        const l = evalNode(e.l, ex);
        const r = evalNode(e.r, ex);
        const prim = (x) => (x !== null && typeof x === 'object' ? (Array.isArray(x) ? x.join(',') : '[object Object]') : x);
        switch (e.op) {
          case '+': return prim(l) + prim(r);
          case '-': return l - r;
          case '*': return l * r;
          case '/': return l / r;
          case '%': return l % r;
          case '===': return l === r;
          case '!==': return l !== r;
          case '==': return l == r; // eslint-disable-line eqeqeq
          case '!=': return l != r; // eslint-disable-line eqeqeq
          case '<': return l < r;
          case '>': return l > r;
          case '<=': return l <= r;
          default: return l >= r;
        }
      }
      case 'asg': {
        const v = evalNode(e.v, ex);
        if (e.t.k === 'id') {
          if (!ex.vars.has(e.t.v) && ex.has(e.t.v)) return v;
          ex.vars.set(e.t.v, v);
          return v;
        }
        return setProp(evalNode(e.t.o, ex), evalNode(e.t.p, ex), v, ex);
      }
      case 'decl': { const v = evalNode(e.v, ex); ex.vars.set(e.name, v); return undefined; }
      default: return undefined;
    }
  }

  /* ======================= Сеть: справочники ======================= */
  const STATUS_TEXT = { 200: 'OK', 201: 'Created', 204: 'No Content', 302: 'Found', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 422: 'Unprocessable Content', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable' };
  const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
  const DEVICES = [
    ['Responsive', 400, 700], ['iPhone SE', 375, 667], ['iPhone 12 Pro', 390, 844], ['iPhone 14 Pro Max', 430, 932],
    ['Pixel 7', 412, 915], ['Samsung Galaxy S8+', 360, 740], ['iPad Mini', 768, 1024],
  ];
  const THROTTLE = { none: 'No throttling', fast3g: 'Fast 3G', slow3g: 'Slow 3G', offline: 'Offline' };
  const NET_TYPES = [['all', 'All'], ['xhr', 'Fetch/XHR'], ['doc', 'Doc'], ['css', 'CSS'], ['js', 'JS'], ['font', 'Font'], ['img', 'Img'], ['media', 'Media'], ['other', 'Other']];
  function resKind(path) {
    if (/\.css$/.test(path)) return ['css', 'stylesheet', 'text/css'];
    if (/\.js$/.test(path)) return ['js', 'script', 'application/javascript'];
    if (/\.woff2$/.test(path)) return ['font', 'font', 'font/woff2'];
    const m = path.match(/\.(png|svg|webp|jpg|gif|ico)$/);
    if (m) return ['img', m[1] === 'svg' ? 'svg+xml' : m[1], 'image/' + (m[1] === 'svg' ? 'svg+xml' : m[1])];
    return ['other', 'other', 'text/plain'];
  }
  const kb = (bytes) => (bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' kB');
  const ms = (t) => (t >= 1000 ? (t / 1000).toFixed(2) + ' s' : Math.round(t) + ' ms');
  const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

  /* ======================= Симулятор ======================= */
  function buildSim(el, ctx, level) {
    const SC = SCEN[(level && level.setup) || 'login'];
    const S = ctx.state;
    const emit = (type, data) => { if (!S.booting) ctx.emit(Object.assign({ type }, data || {})); };
    Object.assign(S, {
      sc: SC, booting: true, path: SC.start, hist: [], panel: SC.panel || 'elements',
      net: [], reqSeq: 0, netSel: null, netTab: 'headers', netType: 'all', netQ: '', preserve: false, noCache: false,
      throttle: 'none', blocked: [], blockOn: true, cacheSeen: new Set(),
      con: [], conSeq: 0, conLevels: { verbose: false, info: true, warn: true, error: true }, conQ: '', lvOpen: false, conHist: [], conHistI: 0, conVars: new Map(),
      dom: null, elSel: null, elTab: 'styles', hov: new Set(), hovOpen: false, realHover: null, pick: false, edit: null, elQ: '', elHits: [], elHit: -1, collapsed: new Set(),
      device: false, devName: 'iPhone SE', devW: 375, devH: 667,
      srcFile: null, srcLine: null, bps: new Map(), paused: null,
      appSec: 'local', appSel: null, appEdit: null,
      ls: new Map(Object.entries(SC.local || {})), ss: new Map(Object.entries(SC.session || {})),
      cookies: (SC.cookies || []).map((c) => Object.assign({ path: '/', expires: 'Session', httpOnly: false, secure: false, sameSite: '', priority: 'Medium' }, c)),
      css: (BASE_CSS.concat(SC.css || [])).map(([sel, src, decls, o]) => ({ sel, src, decls: parseDecls(decls), media: o && o.media, parsed: parseSelector(sel) })),
      app: {}, loads: 0, menu: null, toast: null, dialog: null, offlinePage: false, lastRes: {},
    });
    const host = SC.origin.replace(/^https?:\/\//, '');

    el.innerHTML = `
      <div class="dx">
        <div class="dx-browser">
          <div class="dx-bar">
            <span class="dx-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <button type="button" class="dx-nav" data-a="back" title="Назад">←</button>
            <button type="button" class="dx-nav" data-a="reload" title="Перезагрузить страницу (F5)">⟳</button>
            <div class="dx-url"><span aria-hidden="true">🔒</span> <span class="dx-url-t"></span></div>
          </div>
          <div class="dx-view">
            <div class="dx-devbar" hidden></div>
            <div class="dx-frame-wrap"><div class="dx-frame"><div class="dx-page"></div><div class="dx-over"></div></div></div>
          </div>
        </div>
        <div class="dx-dt">
          <div class="dx-dt-top">
            <button type="button" class="dx-ico" data-a="pick" title="Select an element in the page to inspect it">⬚</button>
            <button type="button" class="dx-ico" data-a="device" title="Toggle device toolbar">📱</button>
            <div class="dx-tabs" role="tablist">${['elements', 'console', 'sources', 'network', 'application'].map((p) => `<button type="button" role="tab" data-a="panel" data-v="${p}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div>
            <button type="button" class="dx-counters" data-a="panel" data-v="console" title="Открыть Console"></button>
          </div>
          <div class="dx-pane"></div>
          <div class="dx-toast" hidden></div>
        </div>
        <div class="dx-menu-layer" hidden></div>
      </div>`;
    const root = el.querySelector('.dx');
    const $ = (s) => root.querySelector(s);
    const pageEl = $('.dx-page');

    /* ---------- DOM-модель ---------- */
    function allNodes() { const out = []; if (S.dom) walk(S.dom, (n) => { if (n.tag !== '#text') out.push(n); }); return out; }
    S.n = (k) => allNodes().find((n) => n.k === k) || null;
    S.val = (k) => { const n = S.n(k); return n ? (n.val == null ? '' : n.val) : ''; };
    S.body = () => S.dom && S.dom.kids.find((x) => x.tag === 'body');
    const hoverState = { hover: (n) => S.hov.has(n.k) || isRealHover(n) };
    function isRealHover(n) {
      if (!S.realHover) return false;
      for (let x = S.n(S.realHover); x; x = x.p) if (x === n) return true;
      return false;
    }
    const vw = () => (S.device ? S.devW : 1280);
    function rulesFor(n) {
      if (n.tag === '#text') return [];
      return S.css.filter((r) => (r.media == null || vw() <= r.media) && matchSel(n, r.parsed, hoverState));
    }
    function cascade(n) {
      const out = {};
      rulesFor(n).forEach((r) => r.decls.forEach((d) => { if (!d.off) out[d.p] = d.v; }));
      parseDecls(n.a.style).forEach((d) => { if (!d.off) out[d.p] = d.v; });
      return out;
    }
    S.cascade = (k) => { const n = S.n(k); return n ? cascade(n) : {}; };
    function comp(n) {
      const c = { display: uaDisplay(n.tag), position: 'static', 'box-sizing': 'content-box', opacity: '1', 'z-index': 'auto', 'pointer-events': 'auto' };
      const par = n.p && n.p.tag !== '#document' ? comp(n.p) : { color: 'rgb(0, 0, 0)', 'font-size': '16px', 'font-family': 'Times New Roman', visibility: 'visible', cursor: 'auto', 'font-weight': '400', 'line-height': 'normal' };
      INHERITED.forEach((p) => { c[p] = par[p]; });
      if (n.tag === 'a') { c.color = 'rgb(0, 0, 238)'; c.cursor = 'pointer'; }
      if (own(n.a, 'hidden')) c.display = 'none';
      const cs = cascade(n);
      Object.keys(cs).forEach((p) => {
        const v = cs[p];
        if (p === 'background') { if (/^(#|rgb|[a-z]+$)/.test(v)) c['background-color'] = v; }
        else if (p === 'padding' || p === 'margin') { const s = sides(v); c[p + '-top'] = s.t + 'px'; c[p + '-right'] = s.r + 'px'; c[p + '-bottom'] = s.b + 'px'; c[p + '-left'] = s.l + 'px'; }
        else if (p === 'inset') { const s = sides(v); c.top = s.t + 'px'; c.right = s.r + 'px'; c.bottom = s.b + 'px'; c.left = s.l + 'px'; }
        else if (p === 'border') { const m = v.match(/(\d+)px/); c['border-width'] = (m ? m[1] : 0) + 'px'; }
        else c[p] = v;
      });
      if (String(n.a.class || '').includes(HIDE_CLS)) c.visibility = 'hidden';
      ['color', 'background-color'].forEach((p) => { if (c[p]) c[p] = hexRgb(c[p]); });
      return c;
    }
    S.comp = (k) => { const n = S.n(k); return n ? comp(n) : {}; };
    S.isVisible = (k) => {
      const n = S.n(k);
      if (!n) return false;
      for (let x = n; x; x = x.p) {
        const c = cascade(x);
        if (c.display === 'none' || (own(x.a, 'hidden') && !c.display) || c.visibility === 'hidden' || String(x.a.class || '').includes(HIDE_CLS)) return false;
      }
      return true;
    };
    // Итоговые размеры элемента для Box model (content-box по умолчанию).
    function boxOf(n) {
      const c = cascade(n);
      const pad = sides(c.padding);
      const mar = sides(c.margin);
      const bw = c.border ? (parseFloat((c.border.match(/(\d+)px/) || [0, 0])[1]) || 0) : 0;
      const px = (v) => (v && /^-?\d+(\.\d+)?px$/.test(v.trim()) ? parseFloat(v) : null);
      let w = px(c.width);
      let hh = px(c.height);
      if (w == null) w = n.box ? (n.box.auto ? n.box.auto(vw()) : n.box.w) : null;
      if (hh == null) hh = n.box ? n.box.h : null;
      if (w != null && c['box-sizing'] === 'border-box' && px(c.width) != null) w = w - pad.l - pad.r - 2 * bw;
      return { pad, mar, bw, w, h: hh, total: w == null ? null : w + pad.l + pad.r + 2 * bw };
    }
    S.box = (k) => { const n = S.n(k); return n ? boxOf(n) : null; };

    function setAttr(n, name, value, silent) {
      if (value === null || value === undefined) delete n.a[name];
      else n.a[name] = String(value);
      if (name === 'value') n.val = value == null ? '' : String(value);
      if (name === 'checked') n.checked = value != null;
      renderPage();
      if (S.panel === 'elements') renderPane();
      if (!silent) emit('attr', { k: n.k, name, value: value == null ? null : String(value) });
    }
    S.attr = (k, name, value) => { const n = S.n(k); if (n) setAttr(n, name, value, true); };
    S.setText = (k, t) => { const n = S.n(k); if (!n) return; n.kids = []; n.text = t; changed(); };
    S.setKids = (k, kids) => {
      const n = S.n(k);
      if (!n) return;
      n.text = null;
      n.kids = [];
      kids.forEach((c) => { if (!c) return; const x = typeof c === 'string' ? h('span', {}, c) : c; x.p = n; n.kids.push(x); });
      changed();
    };
    S.act = (name, data) => emit('app', Object.assign({ name }, data || {}));
    function changed() { renderPage(); if (S.panel === 'elements') renderPane(); }

    /* ---------- Console: запись сообщений ---------- */
    S.log = (lvl, text, src) => {
      const last = S.con[S.con.length - 1];
      if (last && last.lvl === lvl && last.text === text && last.src === src) last.n++;
      else S.con.push({ id: ++S.conSeq, lvl, text, src: src || '', n: 1 });
      if (S.con.length > 400) S.con.shift();
      renderCounters();
      if (S.panel === 'console') renderPane();
    };

    /* ---------- Network ---------- */
    function timingOf(total, lat, first) {
      const t = { queue: 1.2, stalled: 2.1, dns: first ? 12 : 0, connect: first ? 18 : 0, ssl: first ? 11 : 0, sent: 0.3 };
      const rest = Math.max(1, total - (t.queue + t.stalled + t.dns + t.connect + t.sent));
      t.wait = Math.round(rest * 0.72 + lat * 0.5);
      t.download = Math.max(0.4, total - t.queue - t.stalled - t.dns - t.connect - t.sent - t.wait);
      return t;
    }
    function throttleTime(base, bytes) {
      if (S.throttle === 'slow3g') return { total: base + 2000 + (bytes / 1024) * 200, lat: 2000 };
      if (S.throttle === 'fast3g') return { total: base + 560 + (bytes / 1024) * 6, lat: 560 };
      return { total: base, lat: 0 };
    }
    function reqHeadersFor(o, url) {
      const hd = { accept: o.type === 'document' ? 'text/html,application/xhtml+xml' : 'application/json, text/plain, */*', 'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8' };
      Object.assign(hd, SC.headers ? SC.headers(S, o) : {});
      if (o.body != null) hd['content-type'] = 'application/json';
      const ck = S.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      if (ck) hd.cookie = ck;
      hd.origin = SC.origin;
      hd.referer = SC.origin + S.path;
      hd['user-agent'] = S.device ? UA_MOBILE : UA_DESKTOP;
      Object.assign(hd, o.headers || {});
      if (S.noCache) { hd['cache-control'] = 'no-cache'; hd.pragma = 'no-cache'; }
      return hd;
    }
    const isBlocked = (url) => S.blockOn && S.blocked.some((b) => b.on && url.replace(/^https?:\/\//, '').includes(b.pat));
    function findHandler(method, path) {
      const srv = SC.server || {};
      for (const key of Object.keys(srv)) {
        const [m, p] = key.split(' ');
        if (m !== method) continue;
        const ps = p.split('/');
        const xs = path.split('/');
        if (ps.length !== xs.length) continue;
        const params = {};
        if (ps.every((s, i) => (s[0] === ':' ? (params[s.slice(1)] = decodeURIComponent(xs[i]), true) : s === xs[i]))) return { fn: srv[key], params };
      }
      return null;
    }
    function normInit(init) {
      if (!init) return null;
      if (typeof init === 'string') return { src: init, stack: [['(anonymous)', init]] };
      return init;
    }
    // Запрос страницы к API: o = { method, path, body, headers, init, tag, done(res), quiet }
    S.api = (o) => {
      const method = o.method || 'GET';
      const url = (o.origin || SC.origin) + o.path;
      const u = new URL(url);
      const query = {};
      u.searchParams.forEach((v, k) => { query[k] = v; });
      const r = {
        id: ++S.reqSeq, o, url, method, name: (u.pathname.split('/').pop() || u.host) + u.search, type: o.type || 'fetch', kind: 'xhr',
        status: null, pending: true, init: normInit(o.init), tag: o.tag || null, payload: o.body == null ? null : o.body,
        query: Object.keys(query).length ? query : null, reqHeaders: reqHeadersFor(o, url), resHeaders: {}, size: 0, time: 0,
      };
      S.net.push(r);
      const finish = (res, total, lat) => {
        r.pending = false;
        if (res.failed) {
          r.failed = res.failed;
          r.status = 0;
          r.time = total;
          r.timing = timingOf(total, lat, false);
          S.log('error', `${method} ${url} net::${res.failed}`, r.init ? base(r.init.src) : '');
        } else {
          r.status = res.status;
          r.statusText = STATUS_TEXT[res.status] || '';
          r.response = res.body;
          r.resText = res.body == null ? '' : typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
          r.size = r.resText.length + 310;
          r.time = total;
          r.timing = timingOf(total, lat, r.id === 1);
          r.resHeaders = Object.assign({ 'content-type': 'application/json; charset=utf-8', 'content-length': String(r.resText.length), date: 'Sun, 11 Oct 2026 09:41:07 GMT', server: 'nginx/1.25.3', 'x-request-id': 'req_' + (7341 + r.id) }, res.headers || {});
          if (res.status >= 400 && !o.quiet) S.log('error', `${method} ${url} ${res.status} (${r.statusText})`, r.init ? r.init.src : '');
        }
        renderNetIfOpen();
        if (o.done) o.done({ ok: !res.failed && res.status < 400, status: r.status, body: r.response, failed: r.failed, req: r });
      };
      renderNetIfOpen();
      if (isBlocked(url)) {
        r.blocked = true;
        setTimeout(() => finish({ failed: 'ERR_BLOCKED_BY_CLIENT' }, 0, 0), 30);
        return r;
      }
      if (S.throttle === 'offline') { setTimeout(() => finish({ failed: 'ERR_INTERNET_DISCONNECTED' }, 0, 0), 30); return r; }
      const hd = findHandler(method, u.pathname);
      const res = hd ? hd.fn({ method, path: u.pathname, query, body: o.body, headers: r.reqHeaders, params: hd.params }, S) : { status: 404, body: { error: 'Not Found', path: u.pathname } };
      const bytes = (typeof res.body === 'string' ? res.body.length : JSON.stringify(res.body || '').length) + 310;
      const tt = throttleTime(res.time || 60 + (r.id * 37) % 90, bytes);
      const real = S.throttle === 'none' ? Math.min(tt.total, o.realMax || 300) : tt.total;
      setTimeout(() => finish(res, tt.total, tt.lat), real);
      return r;
    };
    S.req = (tag) => S.net.filter((r) => r.tag === tag);
    S.selReq = () => S.net.find((r) => r.id === S.netSel) || null;

    function addRes(spec, docName, first) {
      const sp = typeof spec === 'string' ? { path: spec } : spec;
      const [kind, type, mime] = resKind(sp.path);
      const url = SC.origin + '/' + sp.path;
      const bytes = sp.size || { css: 14200, js: 48300, img: 6100, font: 23400 }[kind] || 2000;
      const r = { id: ++S.reqSeq, url, method: 'GET', name: base(sp.path), type, kind, status: sp.status || 200, init: { src: docName, stack: [] }, initDoc: true,
        tag: sp.path, payload: null, query: null, reqHeaders: reqHeadersFor({ type: kind }, url), file: sp.path, pending: false };
      r.statusText = STATUS_TEXT[r.status];
      const blocked = isBlocked(url);
      const cached = !S.noCache && r.status === 200 && !blocked && (S.cacheSeen.has(sp.path) || sp.cache);
      if (blocked) { r.failed = 'ERR_BLOCKED_BY_CLIENT'; r.blocked = true; r.status = 0; r.time = 0; r.size = 0; }
      else if (cached) { r.fromCache = S.cacheSeen.has(sp.path) ? 'memory cache' : 'disk cache'; r.size = 0; r.time = 0; r.timing = null; }
      else {
        const tt = throttleTime(20 + (r.id * 13) % 60, bytes);
        r.size = r.status === 200 ? bytes : 380;
        r.time = tt.total;
        r.timing = timingOf(tt.total, tt.lat, first);
      }
      if (r.status === 200 && !blocked) S.cacheSeen.add(sp.path);
      r.resHeaders = Object.assign({ 'content-type': mime, 'cache-control': 'public, max-age=31536000, immutable', etag: '"' + (9e7 + r.id * 7919).toString(16) + '"', 'last-modified': 'Mon, 05 Oct 2026 18:02:11 GMT', server: 'nginx/1.25.3' }, sp.headers || {});
      if (r.status === 404) r.resHeaders['content-type'] = 'text/html';
      S.net.push(r);
      S.lastRes[sp.path] = r;
      if (r.status === 404) S.log('error', 'Failed to load resource: the server responded with a status of 404 (Not Found)', base(sp.path) + ':1');
      if (blocked) S.log('error', `GET ${url} net::ERR_BLOCKED_BY_CLIENT`, docName);
      return r;
    }

    /* ---------- Загрузка страниц и навигация ---------- */
    function pageOf(path) { return SC.pages[path.split('?')[0]] || SC.pages[Object.keys(SC.pages)[0]]; }
    function load(path, reason) {
      const pg = pageOf(path);
      if (S.paused) S.paused = null;
      S.dialog = null;
      S.realHover = null;
      S.edit = null;
      if (!S.preserve) { S.net = []; S.con = []; S.netSel = null; }
      else S.log('info', `Navigated to ${SC.origin}${path}`, '');
      S.path = path;
      const docName = path === '/' ? host : path.split('?')[0].split('/').pop();
      const doc = { id: ++S.reqSeq, url: SC.origin + path, method: 'GET', name: docName + (path.includes('?') ? '?' + path.split('?')[1] : ''), type: 'document', kind: 'doc', init: { src: 'Other', stack: [] }, initDoc: true, tag: 'doc', payload: null, query: null, pending: false };
      doc.reqHeaders = reqHeadersFor({ type: 'document' }, doc.url);
      if (S.throttle === 'offline') {
        Object.assign(doc, { status: 0, failed: 'ERR_INTERNET_DISCONNECTED', time: 0, size: 0 });
        S.net.push(doc);
        S.offlinePage = true;
        S.dom = { k: 'html', tag: 'html', a: {}, kids: [], p: null };
        renderAll();
        emit('load', { path, reason, offline: true });
        return;
      }
      S.offlinePage = false;
      const tt = throttleTime(84, 6200);
      Object.assign(doc, { status: 200, statusText: 'OK', size: 6200, time: tt.total, timing: timingOf(tt.total, tt.lat, true),
        resHeaders: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', server: 'nginx/1.25.3', 'strict-transport-security': 'max-age=63072000' } });
      S.net.push(doc);
      const first = S.loads === 0;
      (pg.res || []).forEach((r) => addRes(r, docName, first));
      // DOM документа: head (стили, title) + body (содержимое страницы и скрипты).
      const head = h('head', {}, [h('meta', { charset: 'utf-8' }), h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }), h('title', {}, pg.title)]
        .concat((pg.res || []).map((r) => (typeof r === 'string' ? r : r.path)).filter((p) => /\.css$/.test(p)).map((p) => h('link', { rel: 'stylesheet', href: '/' + p })))
        .concat(pg.head ? pg.head(S) : []), { k: 'head', collapsed: true });
      const scripts = (pg.res || []).map((r) => (typeof r === 'string' ? r : r.path)).filter((p) => /\.js$/.test(p)).map((p) => h('script', { src: '/' + p, defer: '' }));
      const body = h('body', pg.bodyAttrs || {}, pg.body(S).concat(scripts), { k: 'body' });
      S.dom = h('html', { lang: 'ru' }, [head, body], { k: 'html' });
      S.dom.p = null;
      S.collapsed = new Set();
      walk(S.dom, (n) => { if (n.collapsed) S.collapsed.add(n.k); });
      S.elSel = pg.sel && S.n(pg.sel) ? pg.sel : 'body';
      S.loads++;
      renderAll();
      if (pg.load) pg.load(S, reason);
      renderAll();
      emit('load', { path, reason });
    }
    S.navigate = (path) => {
      S.hist.push(S.path);
      load(path, 'navigate');
    };
    S.reload = (why) => { emit('reload', { why: why || 'button', noCache: S.noCache }); load(S.path, 'reload'); };

    /* ---------- Отладчик: выполнение «по строкам» с точками останова ---------- */
    // trace: [{ line, scope: { имя: значение } }]; done вызывается после последней строки.
    S.exec = (path, trace, done, stack) => run({ path, trace, done, stack: stack || [] }, 0, false);
    function run(p, i, stepping) {
      const bps = S.bps.get(p.path) || new Set();
      for (; i < p.trace.length; i++) {
        if (stepping || bps.has(p.trace[i].line)) {
          S.paused = Object.assign({}, p, { i });
          S.srcFile = p.path;
          S.srcLine = p.trace[i].line;
          S.panel = 'sources';
          renderAll();
          emit('paused', { file: base(p.path), line: p.trace[i].line });
          return;
        }
      }
      S.paused = null;
      renderAll();
      if (p.done) p.done();
    }
    function resume(step) {
      const p = S.paused;
      if (!p) return;
      S.paused = null;
      emit(step ? 'step' : 'resume', { file: base(p.path) });
      run(p, p.i + 1, step);
    }

    S.confirm = (text, ok) => {
      S.dialog = { text, ok };
      renderOver();
      S.act('confirm');
    };
    function toast(text, pre) {
      S.toast = { text, pre };
      renderToast();
      clearTimeout(S.toastT);
      S.toastT = setTimeout(() => { S.toast = null; renderToast(); }, 5000);
    }

    /* ======================= Рендер страницы ======================= */
    const PAGE_TAGS = new Set(['div', 'span', 'p', 'h1', 'h2', 'h3', 'header', 'nav', 'main', 'section', 'footer', 'form', 'label', 'ul', 'li', 'b', 'small', 'strong', 'em', 'i', 'table', 'tr', 'td', 'th', 'tbody', 'thead', 'aside', 'article']);
    const NO_RENDER = new Set(['head', 'script', 'link', 'meta', 'title', 'style']);
    const INPUT_TYPES = new Set(['text', 'email', 'password', 'checkbox', 'tel', 'search', 'number']);
    function styleAttr(n) {
      const c = cascade(n);
      let s = Object.keys(c).filter((p) => !/url\(|expression|javascript/i.test(c[p])).map((p) => `${p}:${c[p]}`).join(';');
      if (String(n.a.class || '').includes(HIDE_CLS)) s += ';visibility:hidden';
      return s;
    }
    function pageHtml(n) {
      if (n.tag === '#text') return esc(n.text);
      if (NO_RENDER.has(n.tag)) return '';
      const inner = (n.text != null ? esc(n.text) : '') + n.kids.map(pageHtml).join('');
      let cls = String(n.a.class || '');
      if (n.tag === 'img') cls += ' dx-img';
      if (n.tag === 'body') cls += ' dx-body';
      const st = styleAttr(n);
      let at = ` data-k="${esc(n.k)}"`;
      if (cls.trim()) at += ` class="${esc(cls.trim())}"`;
      if (st) at += ` style="${esc(st)}"`;
      if (own(n.a, 'hidden')) at += ' hidden';
      if (own(n.a, 'title')) at += ` title="${esc(n.a.title)}"`;
      const dis = own(n.a, 'disabled') ? ' disabled' : '';
      switch (n.tag) {
        case 'body': return `<div${at}>${inner}</div>`;
        case 'input': {
          const t = INPUT_TYPES.has(n.a.type) ? n.a.type : 'text';
          if (t === 'checkbox') return `<input${at} type="checkbox"${n.checked ? ' checked' : ''}${dis}>`;
          const ml = own(n.a, 'maxlength') && /^\d+$/.test(n.a.maxlength) ? ` maxlength="${n.a.maxlength}"` : '';
          const ph = own(n.a, 'placeholder') ? ` placeholder="${esc(n.a.placeholder)}"` : '';
          return `<input${at} type="${t}" value="${esc(n.val == null ? '' : n.val)}"${ph}${ml}${dis} autocomplete="off" spellcheck="false">`;
        }
        case 'button': return `<button type="button"${at}${dis}>${inner}</button>`;
        case 'a': return `<a href="#"${at}>${inner}</a>`;
        case 'img': return `<span${at} role="img" aria-label="${esc(n.a.alt || '')}">${n.broken ? '<i class="dx-broken" aria-hidden="true">⛶</i>' : esc(n.emoji || '🖼')}</span>`;
        case 'select': return `<select${at}${dis}>${n.kids.filter((o) => o.tag === 'option').map((o) => `<option value="${esc(o.a.value || '')}"${(o.a.value || '') === n.val ? ' selected' : ''}>${esc(textOf(o))}</option>`).join('')}</select>`;
        default: { const t = PAGE_TAGS.has(n.tag) ? n.tag : 'div'; return `<${t}${at}>${inner}</${t}>`; }
      }
    }
    function renderPage() {
      const ae = document.activeElement;
      let fk = null;
      let ss = null;
      let se = null;
      if (ae && pageEl.contains(ae) && ae.dataset.k) { fk = ae.dataset.k; try { ss = ae.selectionStart; se = ae.selectionEnd; } catch (e) { /* не текстовое поле */ } }
      if (S.offlinePage) {
        pageEl.innerHTML = '<div class="dx-offline"><div class="dx-dino" aria-hidden="true">🦖</div><h2>Нет подключения к Интернету</h2><p>ERR_INTERNET_DISCONNECTED</p></div>';
      } else {
        const b = S.body();
        pageEl.innerHTML = b ? pageHtml(b) : '';
      }
      if (fk) {
        const x = pageEl.querySelector(`[data-k="${CSS.escape(fk)}"]`);
        if (x) { x.focus({ preventScroll: true }); try { if (ss != null) x.setSelectionRange(ss, se); } catch (e) { /* ignore */ } }
      }
      renderOver();
    }
    function renderOver() {
      const ov = $('.dx-over');
      let html = '';
      if (S.paused) html += '<div class="dx-paused"><span>Paused in debugger</span><button type="button" data-a="resume" title="Resume script execution (F8)">▶</button><button type="button" data-a="step" title="Step over next function call (F10)">⤼</button></div>';
      if (S.dialog) html += `<div class="dx-dialog" role="dialog"><div class="dx-dialog-box"><p class="dx-dialog-h">${esc(host)} says</p><p>${esc(S.dialog.text)}</p><div class="dx-dialog-btns"><button type="button" data-a="dlg" data-v="ok" class="dx-dlg-ok">OK</button><button type="button" data-a="dlg" data-v="cancel">Cancel</button></div></div></div>`;
      if (S.pick) html += '<div class="dx-pickmask" data-pickmask></div>';
      ov.innerHTML = html;
      ov.classList.toggle('on', !!(S.paused || S.dialog || S.pick));
    }
    function renderChrome() {
      $('.dx-url-t').textContent = SC.origin + S.path;
      $('[data-a="back"]').disabled = !S.hist.length;
      root.classList.toggle('dx-is-device', S.device);
      const db = $('.dx-devbar');
      db.hidden = !S.device;
      if (S.device) {
        db.innerHTML = `<label>Dimensions: <select data-in="dev">${DEVICES.map(([nm]) => `<option${nm === S.devName ? ' selected' : ''}>${nm}</option>`).join('')}</select></label>
          <input type="number" data-in="devw" value="${S.devW}" min="240" max="1400" aria-label="Width"${S.devName === 'Responsive' ? '' : ' readonly'}> × <input type="number" value="${S.devH}" readonly aria-label="Height">`;
      }
      const fr = $('.dx-frame');
      fr.style.width = S.device ? S.devW + 'px' : '';
      $('[data-a="pick"]').classList.toggle('on', S.pick);
      $('[data-a="device"]').classList.toggle('on', S.device);
    }
    function renderAll() { renderChrome(); renderPage(); renderDT(); }

    /* ======================= DevTools: общий рендер ======================= */
    function renderCounters() {
      const e = S.con.filter((m) => m.lvl === 'error').reduce((s, m) => s + m.n, 0);
      const w = S.con.filter((m) => m.lvl === 'warn').reduce((s, m) => s + m.n, 0);
      const c = $('.dx-counters');
      c.innerHTML = (e ? `<span class="dx-cnt-e">⛔ ${e}</span>` : '') + (w ? `<span class="dx-cnt-w">⚠ ${w}</span>` : '');
      c.hidden = !e && !w;
    }
    function renderToast() {
      const t = $('.dx-toast');
      t.hidden = !S.toast;
      if (S.toast) t.innerHTML = `<b>${esc(S.toast.text)}</b>${S.toast.pre ? `<pre>${esc(S.toast.pre)}</pre>` : ''}`;
    }
    function renderDT() {
      root.querySelectorAll('.dx-tabs [data-a="panel"]').forEach((b) => { b.classList.toggle('on', b.dataset.v === S.panel); b.setAttribute('aria-selected', b.dataset.v === S.panel); });
      renderCounters();
      renderPane();
      renderMenu();
      renderToast();
    }
    function renderNetIfOpen() { renderCounters(); if (S.panel === 'network') renderPane(); }
    // Перерисовка панели с сохранением фокуса, выделения и прокрутки.
    function renderPane() {
      const pane = $('.dx-pane');
      const ae = document.activeElement;
      let fk = null;
      let ss = null;
      let se = null;
      if (ae && pane.contains(ae) && ae.dataset.focus) { fk = ae.dataset.focus; try { ss = ae.selectionStart; se = ae.selectionEnd; } catch (e) { /* ignore */ } }
      const scroll = {};
      pane.querySelectorAll('[data-scroll]').forEach((x) => { scroll[x.dataset.scroll] = [x.scrollTop, x.scrollLeft, x.scrollHeight - x.clientHeight - x.scrollTop < 4]; });
      pane.className = 'dx-pane dx-p-' + S.panel;
      pane.innerHTML = { elements: paneElements, console: paneConsole, sources: paneSources, network: paneNetwork, application: paneApp }[S.panel]();
      pane.querySelectorAll('[data-scroll]').forEach((x) => {
        const s = scroll[x.dataset.scroll];
        if (x.dataset.scroll === 'con' && (!s || s[2])) x.scrollTop = x.scrollHeight;
        else if (s) { x.scrollTop = s[0]; x.scrollLeft = s[1]; }
      });
      const sel = pane.querySelector('.dx-node.sel, .dx-code-line.cur, .dx-code-line.flash');
      if (sel && S.scrollTo) { sel.scrollIntoView({ block: 'nearest' }); S.scrollTo = false; }
      const ed = pane.querySelector('[data-focus="edit"]');
      if (ed && !fk) { ed.focus(); ed.select(); }
      if (fk) {
        const x = pane.querySelector(`[data-focus="${fk}"]`);
        if (x) { x.focus({ preventScroll: true }); try { if (ss != null) x.setSelectionRange(ss, se); } catch (e) { /* ignore */ } }
      }
    }

    /* ---------- Elements ---------- */
    const VOID = new Set(['input', 'img', 'meta', 'link']);
    function attrsHtml(n) {
      const edit = S.edit && S.edit.k === n.k ? S.edit : null;
      let out = Object.keys(n.a).map((k) => {
        if (edit && edit.at === k) return ` <input class="dx-edit" data-focus="edit" data-in="edit" value="${esc(n.a[k] === '' ? k : `${k}="${n.a[k]}"`)}" aria-label="Атрибут">`;
        const v = n.a[k];
        return ` <span class="dx-at" data-at="${esc(k)}" data-k="${esc(n.k)}"><span class="an">${esc(k)}</span>${v === '' && ['disabled', 'hidden', 'novalidate', 'defer', 'checked', 'required'].includes(k) ? '' : `="<span class="av">${esc(v)}</span>"`}</span>`;
      }).join('');
      if (edit && edit.at === '') out += ' <input class="dx-edit" data-focus="edit" data-in="edit" value="" placeholder="name=&quot;value&quot;" aria-label="Новый атрибут">';
      return out;
    }
    function nodeLines(n, d) {
      const pad = `style="padding-left:${d * 12 + 18}px"`;
      if (n.tag === '#text') {
        if (!n.text.trim()) return '';
        if (S.edit && S.edit.k === n.k) return `<div class="dx-node" ${pad}><input class="dx-edit" data-focus="edit" data-in="edit" value="${esc(n.text)}"></div>`;
        return `<div class="dx-node dx-txt" data-k="${esc(n.k)}" data-tx="1" ${pad}>"${esc(n.text)}"</div>`;
      }
      const sel = S.elSel === n.k;
      const hasKids = n.kids.some((c) => c.tag !== '#text' || c.text.trim());
      const coll = S.collapsed.has(n.k);
      const tw = hasKids ? `<span class="dx-tw" data-a="tw" data-v="${esc(n.k)}">${coll ? '▸' : '▾'}</span>` : '';
      const more = sel ? `<button type="button" class="dx-more" data-a="node-menu" data-v="${esc(n.k)}" title="Действия с элементом">⋯</button>` : '';
      const open = `&lt;<span class="tg">${n.tag}</span>${attrsHtml(n)}&gt;`;
      const close = `&lt;/<span class="tg">${n.tag}</span>&gt;`;
      const mark = sel ? ' <span class="dx-eq">== $0</span>' : '';
      const cls = `dx-node${sel ? ' sel' : ''}${String(n.a.class || '').includes(HIDE_CLS) ? ' hid' : ''}`;
      const textEdit = S.edit && S.edit.k === n.k && S.edit.at === '#text';
      if (VOID.has(n.tag)) return `<div class="${cls}" data-k="${esc(n.k)}" ${pad}>${more}${open}${mark}</div>`;
      if (!hasKids) {
        const tx = textEdit ? `<input class="dx-edit" data-focus="edit" data-in="edit" value="${esc(n.text || '')}">` : n.text ? `<span class="tx" data-tx="1">${esc(n.text)}</span>` : '';
        return `<div class="${cls}" data-k="${esc(n.k)}" ${pad}>${more}${open}${tx}${close}${mark}</div>`;
      }
      if (coll) return `<div class="${cls}" data-k="${esc(n.k)}" ${pad}>${tw}${more}${open}<span class="dx-ell">…</span>${close}${mark}</div>`;
      return `<div class="${cls}" data-k="${esc(n.k)}" ${pad}>${tw}${more}${open}${mark}</div>` +
        (n.text ? `<div class="dx-node dx-txt" style="padding-left:${(d + 1) * 12 + 18}px">"${esc(n.text)}"</div>` : '') +
        n.kids.map((c) => nodeLines(c, d + 1)).join('') + `<div class="dx-node dx-close" data-k="${esc(n.k)}" ${pad}>${close}</div>`;
    }
    function paneElements() {
      const n = S.n(S.elSel) || S.body();
      const crumbs = [];
      for (let x = n; x; x = x.p) crumbs.unshift(x);
      const hits = S.elHits.length ? `${S.elHit + 1} of ${S.elHits.length}` : S.elQ ? '0 results' : '';
      return `<div class="dx-el">
        <div class="dx-el-main">
          <div class="dx-bar2"><span aria-hidden="true">🔍</span><input class="dx-in" data-in="elq" data-focus="elq" placeholder="Find by string, selector, or XPath" value="${esc(S.elQ)}" aria-label="Поиск по DOM"><span class="dx-muted">${hits}</span>
            <button type="button" class="dx-btn" data-a="elq-next" title="Следующее совпадение">⌄</button></div>
          <div class="dx-dom" data-scroll="dom" tabindex="0">${S.dom ? nodeLines(S.dom, 0) : ''}</div>
          <div class="dx-crumbs">${crumbs.map((x) => `<button type="button" data-a="sel" data-v="${esc(x.k)}">${esc(elShort(x))}</button>`).join('')}</div>
        </div>
        <div class="dx-side">
          <div class="dx-subtabs">${[['styles', 'Styles'], ['computed', 'Computed'], ['listeners', 'Event Listeners']].map(([v, t]) => `<button type="button" data-a="eltab" data-v="${v}" class="${S.elTab === v ? 'on' : ''}">${t}</button>`).join('')}</div>
          <div class="dx-side-body" data-scroll="side">${n ? (S.elTab === 'computed' ? computedHtml(n) : S.elTab === 'listeners' ? listenersHtml(n) : stylesHtml(n)) : ''}</div>
        </div>
      </div>`;
    }
    function stylesHtml(n) {
      const rules = rulesFor(n);
      const inl = parseDecls(n.a.style);
      // Победившие объявления: последнее включённое по каскаду, инлайн — сильнее всех.
      const win = {};
      rules.forEach((r) => r.decls.forEach((d) => { if (!d.off) win[d.p] = d; }));
      inl.forEach((d) => { if (!d.off) win[d.p] = d; });
      const declHtml = (d, rid, i) => {
        const ed = S.edit && S.edit.t === 'decl' && S.edit.r === rid && S.edit.d === i;
        const v = ed ? `<input class="dx-edit" data-focus="edit" data-in="edit" value="${esc(d.v)}" aria-label="Значение ${esc(d.p)}">` : `<span class="pv" data-a="dval" data-r="${rid}" data-d="${i}" title="Изменить значение">${esc(d.v)}</span>`;
        return `<div class="dx-decl${d.off ? ' off' : ''}${!d.off && win[d.p] !== d ? ' ovr' : ''}"><input type="checkbox" data-a="decl" data-r="${rid}" data-d="${i}"${d.off ? '' : ' checked'} aria-label="${esc(d.p)}"> <span class="pn">${esc(d.p)}</span>: ${v};</div>`;
      };
      const hovs = [':active', ':hover', ':focus', ':focus-within', ':focus-visible', ':target'];
      let out = `<div class="dx-st-bar"><span class="dx-muted">Filter</span><span class="dx-sp"></span><button type="button" class="dx-btn${S.hovOpen ? ' on' : ''}" data-a="hov" title="Toggle Element State">:hov</button><button type="button" class="dx-btn" disabled>.cls</button></div>`;
      if (S.hovOpen) out += `<div class="dx-hovs"><p class="dx-muted">Force element state</p>${hovs.map((x) => `<label><input type="checkbox" data-a="force" data-v="${x}"${(x === ':hover' ? S.hov.has(n.k) : (S.forced || new Set()).has(n.k + x)) ? ' checked' : ''}> ${x}</label>`).join('')}</div>`;
      out += `<div class="dx-rule"><div class="dx-rule-h"><span class="sel">element.style</span> {</div>${inl.map((d, i) => declHtml(d, 'i', i)).join('')}<div>}</div></div>`;
      rules.slice().reverse().forEach((r) => {
        const rid = S.css.indexOf(r);
        out += `<div class="dx-rule">${r.media ? `<div class="dx-media">@media (max-width: ${r.media}px)</div>` : ''}<div class="dx-rule-h"><span class="sel">${esc(r.sel)}</span> {<button type="button" class="dx-link" data-a="src" data-v="${esc(r.src)}">${esc(r.src)}</button></div>${r.decls.map((d, i) => declHtml(d, rid, i)).join('')}<div>}</div></div>`;
      });
      out += `<div class="dx-rule ua"><div class="dx-rule-h"><span class="sel">${n.tag}</span> {<span class="dx-muted">user agent stylesheet</span></div>${uaRule(n.tag).map((d) => `<div class="dx-decl ro"><span class="pn">${d.p}</span>: ${esc(d.v)};</div>`).join('')}<div>}</div></div>`;
      return out;
    }
    function computedHtml(n) {
      const c = comp(n);
      const b = boxOf(n);
      const sd = (s) => ({ t: s.t || '‒', r: s.r || '‒', b: s.b || '‒', l: s.l || '‒' });
      const m = sd(b.mar);
      const p = sd(b.pad);
      const bw = b.bw || '‒';
      const content = `${b.w == null ? 'auto' : Math.round(b.w)} × ${b.h == null ? 'auto' : Math.round(b.h)}`;
      const box = `<div class="dx-box">
        <div class="bm-m"><span class="bm-l">margin</span><i class="t">${m.t}</i><i class="r">${m.r}</i><i class="b">${m.b}</i><i class="l">${m.l}</i>
          <div class="bm-b"><span class="bm-l">border</span><i class="t">${bw}</i><i class="r">${bw}</i><i class="b">${bw}</i><i class="l">${bw}</i>
            <div class="bm-p"><span class="bm-l">padding</span><i class="t">${p.t}</i><i class="r">${p.r}</i><i class="b">${p.b}</i><i class="l">${p.l}</i>
              <div class="bm-c">${content}</div></div></div></div></div>`;
      if (b.w != null) c.width = Math.round(b.w) + 'px';
      if (b.h != null) c.height = Math.round(b.h) + 'px';
      const keys = Object.keys(c).filter((k) => c[k] != null).sort();
      return box + `<div class="dx-comp">${keys.map((k) => `<div><span class="pn">${esc(k)}</span>: <span class="pv">${esc(c[k])}</span>;</div>`).join('')}</div>`;
    }
    function listenersHtml(n) {
      const items = [];
      for (let x = n; x; x = x.p) (x.ev || []).forEach((e) => items.push(Object.assign({ on: x }, e)));
      if (!items.length) return '<p class="dx-empty">No event listeners</p>';
      const types = [...new Set(items.map((i) => i.type))];
      return types.map((t) => `<div class="dx-lst"><p class="dx-lst-h">▾ ${esc(t)}</p>${items.filter((i) => i.type === t).map((i) => `<div class="dx-lst-i"><span>${esc(elShort(i.on))}</span> <span class="dx-muted">${esc(i.fn)}</span> <button type="button" class="dx-link" data-a="src" data-v="${esc(i.src)}">${esc(i.src)}</button></div>`).join('')}</div>`).join('');
    }
    function selectNode(k, via) {
      const n = S.n(k);
      if (!n) return;
      // Повторный клик по уже выбранному узлу не перерисовывает дерево (иначе ломается двойной клик).
      if (S.elSel === k && S.panel === 'elements' && !S.edit && via === 'tree') { emit('el-select', { k, via }); return; }
      S.elSel = k;
      S.edit = null;
      for (let x = n.p; x; x = x.p) S.collapsed.delete(x.k);
      S.scrollTo = true;
      if (S.panel !== 'elements') { S.panel = 'elements'; renderDT(); } else renderPane();
      emit('el-select', { k, via: via || 'tree' });
    }
    function elSearch(next) {
      const q = S.elQ.trim();
      S.elHits = [];
      if (q) {
        let parsed = null;
        try { parsed = parseSelector(q); } catch (e) { parsed = null; }
        const ql = q.toLowerCase();
        S.elHits = allNodes().filter((n) => (parsed && matchSel(n, parsed, null)) || elTag(n).toLowerCase().includes(ql)).map((n) => n.k);
      }
      if (!S.elHits.length) { S.elHit = -1; renderPane(); emit('el-search', { q, found: 0 }); return; }
      S.elHit = next ? (S.elHit + 1) % S.elHits.length : 0;
      emit('el-search', { q, found: S.elHits.length, k: S.elHits[S.elHit] });
      selectNode(S.elHits[S.elHit], 'search');
    }
    function deleteNode(n) {
      if (!n || !n.p || ['html', 'head', 'body'].includes(n.tag)) return;
      const par = n.p;
      par.kids = par.kids.filter((x) => x !== n);
      if (S.elSel === n.k) S.elSel = par.k;
      changed();
      emit('el-delete', { k: n.k });
    }
    function toggleHide(n) {
      const cl = String(n.a.class || '').split(/\s+/).filter(Boolean);
      const i = cl.indexOf(HIDE_CLS);
      if (i >= 0) cl.splice(i, 1); else cl.push(HIDE_CLS);
      setAttr(n, 'class', cl.length ? cl.join(' ') : null);
      emit('el-hide', { k: n.k, on: i < 0 });
    }
    function commitEdit(value, cancel) {
      const ed = S.edit;
      S.edit = null;
      if (!ed || cancel) { renderPane(); return; }
      if (ed.t === 'decl') {
        const v = value.trim();
        if (ed.r === 'i') {
          const n = S.n(ed.k);
          const ds = parseDecls(n.a.style);
          if (v) ds[ed.d].v = v; else ds.splice(ed.d, 1);
          setAttr(n, 'style', ds.length ? declStr(ds) : null);
          emit('style', { k: n.k, sel: 'element.style', p: (ds[ed.d] || {}).p, value: v });
        } else {
          const r = S.css[ed.r];
          const d = r.decls[ed.d];
          if (v) d.v = v; else d.off = true;
          changed();
          emit('style', { k: S.elSel, sel: r.sel, p: d.p, value: v, on: !d.off });
        }
        return;
      }
      if (ed.t === 'app') { appCommit(ed, value); return; }
      const n = S.n(ed.k);
      if (!n) { renderPane(); return; }
      if (ed.at === '#text') {
        if (n.tag === '#text') n.text = value; else { n.kids = []; n.text = value; }
        changed();
        emit('el-text', { k: n.k, text: value });
        return;
      }
      const v = value.trim();
      if (!v) { if (ed.at) setAttr(n, ed.at, null); else renderPane(); return; }
      const m = v.match(/^([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?$/);
      if (!m) { renderPane(); return; }
      const name = m[1].toLowerCase();
      const val = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
      if (ed.at && ed.at !== name) delete n.a[ed.at];
      setAttr(n, name, val);
    }

    /* ---------- Console ---------- */
    const LV_OF = { error: 'error', warn: 'warn', info: 'info', log: 'info', verbose: 'verbose', cmd: null, res: null };
    function conVisible(m) {
      const lv = LV_OF[m.lvl];
      if (lv && !S.conLevels[lv]) return false;
      if (S.conQ && !(m.text + ' ' + m.src).toLowerCase().includes(S.conQ.toLowerCase())) return false;
      return true;
    }
    function lvLabel() {
      const l = S.conLevels;
      if (l.info && l.warn && l.error && !l.verbose) return 'Default levels';
      if (l.info && l.warn && l.error && l.verbose) return 'All levels';
      if (l.error && !l.info && !l.warn && !l.verbose) return 'Errors only';
      return 'Custom levels';
    }
    function paneConsole() {
      const shown = S.con.filter(conVisible);
      const hidden = S.con.length - shown.length;
      const ico = { error: '⛔', warn: '⚠️', info: '', log: '', verbose: '', cmd: '›', res: '‹' };
      return `<div class="dx-con">
        <div class="dx-bar2"><button type="button" class="dx-btn" data-a="con-clear" title="Clear console">🚫</button><span class="dx-ctx">top ▾</span>
          <input class="dx-in" data-in="conq" data-focus="conq" placeholder="Filter" value="${esc(S.conQ)}" aria-label="Фильтр консоли">
          <span class="dx-lv-wrap"><button type="button" class="dx-btn" data-a="lv">${lvLabel()} ▾</button>
          ${S.lvOpen ? `<div class="dx-pop">${[['verbose', 'Verbose'], ['info', 'Info'], ['warn', 'Warnings'], ['error', 'Errors']].map(([k, t]) => `<label><input type="checkbox" data-a="lvset" data-v="${k}"${S.conLevels[k] ? ' checked' : ''}> ${t}</label>`).join('')}</div>` : ''}</span>
          ${hidden ? `<span class="dx-muted">${hidden} hidden</span>` : ''}</div>
        <div class="dx-con-list" data-scroll="con">${shown.map((m) => `<div class="dx-msg ${m.lvl}"><span class="dx-mi" aria-hidden="true">${ico[m.lvl]}</span>${m.n > 1 ? `<span class="dx-rep">${m.n}</span>` : ''}<pre>${esc(m.text)}</pre>${m.src ? (fileOf(m.src) ? `<button type="button" class="dx-link" data-a="src" data-v="${esc(m.src)}" data-from="console">${esc(m.src)}</button>` : `<span class="dx-muted">${esc(m.src)}</span>`) : ''}</div>`).join('')}
          <div class="dx-prompt"><span aria-hidden="true">›</span><textarea rows="1" data-in="conin" data-focus="conin" class="dx-con-in" aria-label="Console prompt" spellcheck="false" autocomplete="off"></textarea></div>
        </div>
      </div>`;
    }
    function storeW(area) {
      const w = {};
      META.set(w, { kind: 'storage', map: () => S[area] });
      const name = area === 'ls' ? 'local' : 'session';
      w.getItem = nat('getItem', (k) => (S[area].has(String(k)) ? S[area].get(String(k)) : null));
      w.setItem = nat('setItem', (k, v) => { S[area].set(String(k), String(v)); emit('storage-set', { area: name, key: String(k), value: String(v), via: 'console' }); return undefined; });
      w.removeItem = nat('removeItem', (k) => { S[area].delete(String(k)); emit('storage-del', { area: name, key: String(k) }); });
      w.clear = nat('clear', () => { S[area].clear(); emit('storage-clear', { area: name }); });
      w.key = nat('key', (i) => [...S[area].keys()][i] || null);
      Object.defineProperty(w, 'length', { get: () => S[area].size, enumerable: false });
      return w;
    }
    function qsa(sel, rootNode, method) {
      let parsed;
      try { parsed = parseSelector(sel); } catch (e) { throw new JsError('SyntaxError', `Failed to execute '${method}' on 'Document': '${sel}' is not a valid selector.`); }
      const out = [];
      if (rootNode) walk(rootNode, (n) => { if (n !== rootNode && n.tag !== '#text' && matchSel(n, parsed, null)) out.push(n); });
      return out;
    }
    function listW(nodes) { const a = nodes.map(elW); META.set(a, { kind: 'list' }); return a; }
    function setInline(n, p, v) {
      const ds = parseDecls(n.a.style).filter((d) => d.p !== p);
      if (v !== '' && v != null) ds.push({ p, v: String(v), off: false });
      setAttr(n, 'style', ds.length ? declStr(ds) : null);
    }
    function elW(n) {
      if (!n) return null;
      const w = {};
      META.set(w, { kind: 'el', n });
      const acc = (k, get, set) => Object.defineProperty(w, k, { get, set, enumerable: true });
      acc('tagName', () => n.tag.toUpperCase());
      acc('id', () => n.a.id || '', (v) => setAttr(n, 'id', String(v)));
      acc('className', () => n.a.class || '', (v) => setAttr(n, 'class', String(v)));
      acc('value', () => (n.val == null ? '' : n.val), (v) => { n.val = String(v); renderPage(); });
      ['textContent', 'innerText'].forEach((k) => acc(k, () => textOf(n), (v) => { n.kids = []; n.text = String(v); changed(); }));
      acc('disabled', () => own(n.a, 'disabled'), (v) => setAttr(n, 'disabled', v ? '' : null));
      acc('hidden', () => own(n.a, 'hidden'), (v) => setAttr(n, 'hidden', v ? '' : null));
      acc('checked', () => n.checked, (v) => { n.checked = !!v; renderPage(); });
      acc('maxLength', () => (own(n.a, 'maxlength') ? Number(n.a.maxlength) : -1), (v) => setAttr(n, 'maxlength', String(v)));
      acc('type', () => n.a.type || (n.tag === 'button' ? 'submit' : n.tag === 'input' ? 'text' : ''));
      acc('placeholder', () => n.a.placeholder || '');
      acc('href', () => (own(n.a, 'href') ? SC.origin + n.a.href : ''));
      acc('children', () => listW(n.kids.filter((x) => x.tag !== '#text')));
      acc('parentElement', () => (n.p ? elW(n.p) : null));
      acc('outerHTML', () => elTag(n));
      acc('style', () => {
        const st = {};
        const cs = cascade(n);
        ['display', 'color', 'background', 'backgroundColor', 'visibility', 'opacity', 'width', 'height', 'pointerEvents', 'zIndex', 'padding', 'margin', 'fontSize', 'boxSizing'].forEach((cc) => {
          const p = cc.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
          Object.defineProperty(st, cc, { get: () => (parseDecls(n.a.style).find((d) => d.p === p && !d.off) || {}).v || '', set: (v) => setInline(n, p, v), enumerable: !!cs[p] });
        });
        return st;
      });
      w.getAttribute = nat('getAttribute', (k) => (own(n.a, String(k).toLowerCase()) ? String(n.a[String(k).toLowerCase()]) : null));
      w.setAttribute = nat('setAttribute', (k, v) => { setAttr(n, String(k).toLowerCase(), String(v)); });
      w.removeAttribute = nat('removeAttribute', (k) => { setAttr(n, String(k).toLowerCase(), null); });
      w.hasAttribute = nat('hasAttribute', (k) => own(n.a, String(k).toLowerCase()));
      w.click = nat('click', () => { activate(n); });
      w.remove = nat('remove', () => { deleteNode(n); });
      w.focus = nat('focus', () => undefined);
      w.querySelector = nat('querySelector', (s) => elW(qsa(String(s), n, 'querySelector')[0]));
      w.querySelectorAll = nat('querySelectorAll', (s) => listW(qsa(String(s), n, 'querySelectorAll')));
      return w;
    }
    function opaque(label, obj) { META.set(obj, { kind: 'opaque', label }); return obj; }
    function plain(v) {
      if (v && typeof v === 'object') {
        const m = META.get(v);
        if (m && m.kind === 'el') return {};
        if (m && m.kind === 'storage') return Object.fromEntries(m.map());
        if (Array.isArray(v)) return v.map(plain);
        const o = {};
        Object.keys(v).forEach((k) => { o[k] = plain(v[k]); });
        return o;
      }
      return v;
    }
    function consoleEnv() {
      const doc = opaque('#document', {});
      Object.defineProperty(doc, 'cookie', {
        enumerable: true,
        get: () => S.cookies.filter((c) => !c.httpOnly).map((c) => `${c.name}=${c.value}`).join('; '),
        set: (v) => {
          const [pair] = String(v).split(';');
          const i = pair.indexOf('=');
          if (i < 1) return;
          const name = pair.slice(0, i).trim();
          const value = pair.slice(i + 1).trim();
          const ex = S.cookies.find((c) => c.name === name);
          if (ex && ex.httpOnly) return;
          if (ex) ex.value = value; else S.cookies.push({ name, value, domain: host, path: '/', expires: 'Session', httpOnly: false, secure: false, sameSite: '', priority: 'Medium' });
          emit('cookie-set', { name, value, via: 'console' });
        },
      });
      Object.defineProperty(doc, 'title', { enumerable: true, get: () => pageOf(S.path).title });
      Object.defineProperty(doc, 'URL', { enumerable: true, get: () => SC.origin + S.path });
      Object.defineProperty(doc, 'body', { enumerable: true, get: () => elW(S.body()) });
      doc.readyState = 'complete';
      doc.querySelector = nat('querySelector', (s) => elW(qsa(String(s), S.dom, 'querySelector')[0]));
      doc.querySelectorAll = nat('querySelectorAll', (s) => listW(qsa(String(s), S.dom, 'querySelectorAll')));
      doc.getElementById = nat('getElementById', (id) => elW(allNodes().find((n) => n.a.id === String(id))));
      doc.getElementsByClassName = nat('getElementsByClassName', (c) => listW(qsa('.' + String(c).trim().split(/\s+/).join('.'), S.dom, 'getElementsByClassName')));
      const loc = opaque(`Location {href: '${SC.origin + S.path}', …}`, {
        href: SC.origin + S.path, origin: SC.origin, host, hostname: host, protocol: 'https:',
        pathname: S.path.split('?')[0], search: S.path.includes('?') ? '?' + S.path.split('?')[1] : '',
        reload: nat('reload', () => { setTimeout(() => S.reload('console'), 0); }),
      });
      doc.location = loc;
      const nav = opaque('Navigator {…}', { userAgent: S.device ? UA_MOBILE : UA_DESKTOP, language: 'ru-RU', onLine: S.throttle !== 'offline', cookieEnabled: true, platform: S.device ? 'iPhone' : 'Win32' });
      const out = (lvl) => nat(lvl, (...a) => { S.log(lvl === 'debug' ? 'verbose' : lvl, a.map((x) => (typeof x === 'string' ? x : fmt(x, 1))).join(' '), `VM${300 + S.conSeq}:1`); });
      const con = opaque('console {…}', { log: out('log'), info: out('info'), warn: out('warn'), error: out('error'), debug: out('debug'), table: out('log'), clear: nat('clear', () => { S.con = []; S.log('verbose', 'Console was cleared', ''); }) });
      const json = opaque('JSON {…}', {
        parse: nat('parse', (s) => { try { return JSON.parse(String(s)); } catch (e) { throw new JsError('SyntaxError', e.message); } }),
        stringify: nat('stringify', (v, r, sp) => JSON.stringify(plain(v), null, sp)),
      });
      const math = opaque('Math {…}', { PI: Math.PI });
      ['round', 'floor', 'ceil', 'max', 'min', 'abs', 'random', 'pow', 'sqrt'].forEach((k) => { math[k] = nat(k, (...a) => Math[k](...a)); });
      const objW = opaque('ƒ Object() { [native code] }', { keys: nat('keys', (o) => Object.keys(plain(o) || {})), values: nat('values', (o) => Object.values(plain(o) || {})), entries: nat('entries', (o) => Object.entries(plain(o) || {})) });
      const win = opaque(`Window {window: Window, document: document, location: Location, …}`, {});
      const env = {
        document: doc, window: win, self: win, globalThis: win, location: loc, navigator: nav, console: con, JSON: json, Math: math, Object: objW,
        localStorage: storeW('ls'), sessionStorage: storeW('ss'),
        Number: nat('Number', (v) => Number(v)), String: nat('String', (v) => String(plain(v))), Boolean: nat('Boolean', (v) => !!v),
        parseInt: nat('parseInt', (v, r) => parseInt(v, r)), parseFloat: nat('parseFloat', (v) => parseFloat(v)), isNaN: nat('isNaN', (v) => isNaN(v)),
        undefined, NaN, Infinity,
        $: nat('$', (s) => doc.querySelector(s)), $$: nat('$$', (s) => qsa(String(s), S.dom, 'querySelectorAll').map(elW)), $0: elW(S.n(S.elSel)),
        clear: nat('clear', () => { S.con = []; S.log('verbose', 'Console was cleared', ''); }),
        copy: nat('copy', (v) => { const t = typeof v === 'string' ? v : JSON.stringify(plain(v), null, 2); clip(t); toast('Скопировано в буфер обмена', t); emit('copy', { text: t }); }),
        innerWidth: vw(),
      };
      Object.assign(env, SC.globals ? SC.globals(S) : {});
      const ex = {
        vars: S.conVars,
        has: (k) => own(env, k),
        lookup(k, soft) {
          if (ex.vars.has(k)) return ex.vars.get(k);
          if (own(env, k)) return env[k];
          if (soft) return undefined;
          throw new JsError('ReferenceError', `${k} is not defined`);
        },
      };
      return ex;
    }
    function runConsole(code) {
      if (!code.trim()) return;
      S.conHist.push(code);
      S.conHistI = S.conHist.length;
      S.log('cmd', code, '');
      let ok = true;
      let raw;
      let text;
      try {
        const prog = parseProgram(code);
        const ex = consoleEnv();
        let v;
        prog.forEach((st) => { v = evalNode(st, ex); });
        text = fmt(v);
        raw = v !== null && typeof v === 'object' ? text : v;
        S.log('res', text, '');
      } catch (err) {
        ok = false;
        const kind = err.kind || 'Error';
        text = `Uncaught ${kind}: ${err.message}`;
        S.log('error', text, `VM${300 + S.conSeq}:1`);
      }
      emit('console-eval', { code, ok, raw, text });
    }
    function clip(t) { try { if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {}); } catch (e) { /* буфер недоступен */ } }

    /* ---------- Sources ---------- */
    function fileOf(src) {
      const b = String(src).split(':')[0];
      return Object.keys(SC.files || {}).find((p) => base(p) === b) || null;
    }
    function openSrc(src, from) {
      const path = fileOf(src);
      if (!path) return;
      S.srcFile = path;
      S.srcLine = Number(String(src).split(':')[1]) || null;
      S.scrollTo = true;
      S.panel = 'sources';
      renderDT();
      emit('src-open', { file: base(path), line: S.srcLine, from: from || 'nav' });
    }
    function hl(line) {
      const re = /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|\b(const|let|var|function|return|if|else|await|async|export|import|from|new|throw|try|catch|for|of|null|undefined|true|false|this|document|window)\b|\b(\d+)\b/g;
      let out = '';
      let last = 0;
      let m;
      while ((m = re.exec(line))) {
        out += esc(line.slice(last, m.index));
        const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'k' : 'n';
        out += `<span class="hl-${cls}">${esc(m[0])}</span>`;
        last = m.index + m[0].length;
      }
      return out + esc(line.slice(last));
    }
    function paneSources() {
      const files = Object.keys(SC.files || {});
      const dirs = {};
      files.forEach((p) => { const d = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''; (dirs[d] = dirs[d] || []).push(p); });
      const nav = `<div class="dx-srcnav"><p class="dx-sub">Page</p><div class="dx-tree"><div>▾ <span aria-hidden="true">▭</span> top</div><div class="i1">▾ <span aria-hidden="true">☁</span> ${esc(host)}</div>
        ${Object.keys(dirs).sort().map((d) => `${d ? `<div class="i2">▾ <span aria-hidden="true">📁</span> ${esc(d)}</div>` : ''}${dirs[d].map((p) => `<button type="button" class="${d ? 'i3' : 'i2'}${S.srcFile === p ? ' on' : ''}" data-a="open-file" data-v="${esc(p)}"><span aria-hidden="true">📄</span> ${esc(base(p))}</button>`).join('')}`).join('')}</div></div>`;
      let editor = '<div class="dx-editor"><p class="dx-empty">Выбери файл слева — его код откроется здесь.</p></div>';
      if (S.srcFile) {
        const lines = SC.files[S.srcFile].split('\n');
        const bps = S.bps.get(S.srcFile) || new Set();
        const cur = S.paused && S.paused.path === S.srcFile ? S.paused.trace[S.paused.i].line : null;
        editor = `<div class="dx-editor"><div class="dx-ed-tabs"><span>${esc(base(S.srcFile))}</span></div><div class="dx-code" data-scroll="code">${lines.map((ln, i) => {
          const no = i + 1;
          return `<div class="dx-code-line${cur === no ? ' cur' : ''}${!cur && S.srcLine === no ? ' flash' : ''}"><button type="button" class="dx-gut${bps.has(no) ? ' bp' : ''}" data-a="bp" data-v="${no}" title="Поставить или снять breakpoint">${no}</button><code>${hl(ln) || ' '}</code></div>`;
        }).join('')}</div></div>`;
      }
      const p = S.paused;
      const allBps = [];
      S.bps.forEach((set, f) => set.forEach((ln) => allBps.push([f, ln])));
      const scope = p ? Object.entries(p.trace[p.i].scope || {}).map(([k, v]) => `<div class="dx-var"><span class="pn">${esc(k)}</span>: <span class="pv">${esc(fmt(v, 1))}</span></div>`).join('') : '';
      const dbg = `<div class="dx-dbg">
        <div class="dx-dbg-bar"><button type="button" class="dx-btn" data-a="resume" ${p ? '' : 'disabled'} title="Resume script execution (F8)">▶</button><button type="button" class="dx-btn" data-a="step" ${p ? '' : 'disabled'} title="Step over next function call (F10)">⤼</button>${p ? '<span class="dx-paused-l">Paused on breakpoint</span>' : ''}</div>
        <p class="dx-sub">▾ Breakpoints</p>${allBps.length ? allBps.map(([f, ln]) => `<div class="dx-bpi"><span>☑ ${esc(base(f))}:${ln}</span><code>${esc((SC.files[f].split('\n')[ln - 1] || '').trim().slice(0, 40))}</code></div>`).join('') : '<p class="dx-empty">No breakpoints</p>'}
        <p class="dx-sub">▾ Scope</p>${p ? `<p class="dx-scope-h">Local</p>${scope}<p class="dx-scope-h">Global <span class="dx-muted">Window</span></p>` : '<p class="dx-empty">Not paused</p>'}
        <p class="dx-sub">▾ Call Stack</p>${p ? [[p.trace[p.i].fn || '(anonymous)', `${base(p.path)}:${p.trace[p.i].line}`]].concat(p.stack).map(([fn, s], i) => `<div class="dx-stack${i ? '' : ' on'}"><span>${esc(fn)}</span><span class="dx-muted">${esc(s)}</span></div>`).join('') : '<p class="dx-empty">Not paused</p>'}
      </div>`;
      return `<div class="dx-src">${nav}${editor}${dbg}</div>`;
    }

    /* ---------- Network ---------- */
    function netVisible(r) {
      if (S.netType !== 'all' && r.kind !== S.netType) return false;
      const q = S.netQ.trim();
      if (!q) return true;
      return q.split(/\s+/).every((part) => {
        let neg = false;
        let t = part;
        if (t[0] === '-' && t.length > 1) { neg = true; t = t.slice(1); }
        let ok;
        const m = t.match(/^(status-code|method|domain):(.*)$/i);
        if (m) {
          const key = m[1].toLowerCase();
          ok = key === 'status-code' ? String(r.status) === m[2] : key === 'method' ? r.method.toLowerCase() === m[2].toLowerCase() : r.url.includes(m[2]);
        } else ok = r.url.toLowerCase().includes(t.toLowerCase());
        return neg ? !ok : ok;
      });
    }
    function statusCell(r) {
      if (r.pending) return '<span class="dx-muted">(pending)</span>';
      if (r.blocked) return '<span class="dx-err">(blocked:devtools)</span>';
      if (r.failed) return '<span class="dx-err">(failed)</span>';
      return String(r.status);
    }
    function sizeCell(r) {
      if (r.pending) return '';
      if (r.fromCache) return `<span class="dx-muted">(${r.fromCache})</span>`;
      return kb(r.size || 0);
    }
    function paneNetwork() {
      const rows = S.net.filter(netVisible);
      const sel = S.selReq();
      const total = S.net.reduce((s, r) => s + (r.size || 0), 0);
      const fin = S.net.reduce((s, r) => Math.max(s, r.time || 0), 0);
      const table = `<div class="dx-net-tbl" data-scroll="net"><table><thead><tr><th>Name</th><th>Method</th><th>Status</th><th>Type</th><th>Initiator</th><th>Size</th><th>Time</th></tr></thead><tbody>
        ${rows.map((r) => `<tr data-a="req" data-v="${r.id}" data-tag="${esc(r.tag || '')}" class="${r.id === S.netSel ? 'sel' : ''}${r.failed || r.status >= 400 ? ' bad' : ''}" title="${esc(r.url)}">
          <td class="nm"><span aria-hidden="true">${{ doc: '📄', css: '🎨', js: '📜', img: '🖼', font: '🔤', xhr: '⇅' }[r.kind] || '•'}</span> ${esc(r.name)}</td><td>${r.method}</td><td>${statusCell(r)}</td><td>${esc(r.type)}</td>
          <td>${r.init && !r.initDoc ? `<span class="dx-linkish">${esc(base(r.init.src))}</span>` : `<span class="dx-muted">${esc(r.init ? r.init.src : 'Other')}</span>`}</td><td>${sizeCell(r)}</td><td>${r.pending ? '<span class="dx-muted">(pending)</span>' : ms(r.time || 0)}</td></tr>`).join('')}
        </tbody></table>${rows.length ? '' : '<p class="dx-empty">Recording network activity… Выполни запрос или перезагрузи страницу (⟳).</p>'}</div>`;
      const tabs = sel ? [['headers', 'Headers']].concat(sel.payload != null || sel.query ? [['payload', 'Payload']] : []).concat([['preview', 'Preview'], ['response', 'Response'], ['initiator', 'Initiator'], ['timing', 'Timing']]) : [];
      const detail = sel ? `<div class="dx-req">
        <div class="dx-subtabs"><button type="button" data-a="req-close" title="Close">✕</button>${tabs.map(([v, t]) => `<button type="button" data-a="ntab" data-v="${v}" class="${S.netTab === v ? 'on' : ''}">${t}</button>`).join('')}<button type="button" class="dx-kebab" data-a="req-menu" data-v="${sel.id}" title="Действия с запросом (как правый клик)">⋮</button></div>
        <div class="dx-req-body" data-scroll="req">${reqBody(sel)}</div></div>` : '';
      const blocking = S.blocked.length ? `<div class="dx-block"><div class="dx-block-h"><label><input type="checkbox" data-a="block-all"${S.blockOn ? ' checked' : ''}> Enable network request blocking</label><span class="dx-muted">Network request blocking</span></div>
        ${S.blocked.map((b, i) => `<div class="dx-block-i"><label><input type="checkbox" data-a="block-one" data-v="${i}"${b.on ? ' checked' : ''}> ${esc(b.pat)}</label><button type="button" class="dx-btn" data-a="block-rm" data-v="${i}" title="Remove">✕</button></div>`).join('')}</div>` : '';
      return `<div class="dx-net">
        <div class="dx-bar2 wrap">
          <span class="dx-rec" title="Recording network log" aria-hidden="true">●</span>
          <button type="button" class="dx-btn" data-a="net-clear" title="Clear network log">🚫</button>
          <input class="dx-in" data-in="netq" data-focus="netq" placeholder="Filter" value="${esc(S.netQ)}" aria-label="Фильтр запросов">
          <label class="dx-chk"><input type="checkbox" data-a="preserve"${S.preserve ? ' checked' : ''}> Preserve log</label>
          <label class="dx-chk"><input type="checkbox" data-a="nocache"${S.noCache ? ' checked' : ''}> Disable cache</label>
          <select data-in="throttle" aria-label="Throttling">${Object.keys(THROTTLE).map((k) => `<option value="${k}"${S.throttle === k ? ' selected' : ''}>${THROTTLE[k]}</option>`).join('')}</select>
        </div>
        <div class="dx-bar2 dx-types">${NET_TYPES.map(([v, t]) => `<button type="button" data-a="ntype" data-v="${v}" class="${S.netType === v ? 'on' : ''}">${t}</button>`).join('')}</div>
        <div class="dx-net-main${sel ? ' split' : ''}">${table}${detail}</div>
        ${blocking}
        <div class="dx-net-foot">${rows.length} / ${S.net.length} requests | ${kb(total)} transferred | Finish: ${ms(fin)}</div>
      </div>`;
    }
    function kvTable(o) { return `<table class="dx-kv">${Object.keys(o).map((k) => `<tr><td>${esc(k)}</td><td>${esc(o[k])}</td></tr>`).join('')}</table>`; }
    function jsonTree(v, d) {
      const dd = d || 0;
      if (v === null || typeof v !== 'object') return `<span class="j-${v === null ? 'n' : typeof v}">${esc(JSON.stringify(v))}</span>`;
      const arr = Array.isArray(v);
      const keys = Object.keys(v);
      return `${arr ? `[${keys.length}]` : '{…}'}<div class="dx-jt">${keys.map((k) => `<div><span class="j-k">${esc(k)}</span>: ${jsonTree(v[k], dd + 1)}</div>`).join('')}</div>`;
    }
    function reqBody(r) {
      const noData = '<p class="dx-empty">This request has no response data available.</p>';
      if (S.netTab === 'payload') {
        let out = '';
        if (r.query) out += `<p class="dx-sub">Query String Parameters</p>${kvTable(r.query)}`;
        if (r.payload != null) out += `<p class="dx-sub">Request Payload</p><div class="dx-pre">${jsonTree(r.payload)}</div>`;
        return out || noData;
      }
      if (S.netTab === 'preview') {
        if (r.pending || r.failed) return noData;
        if (r.kind === 'img') return `<div class="dx-imgprev">${r.status === 404 ? '⛶' : '🖼'}<span class="dx-muted">${esc(r.name)}</span></div>`;
        if (r.response != null && typeof r.response === 'object') return `<div class="dx-pre">${jsonTree(r.response)}</div>`;
        return resText(r) ? `<pre class="dx-pre">${esc(resText(r))}</pre>` : noData;
      }
      if (S.netTab === 'response') {
        if (r.pending || r.failed) return noData;
        return `<pre class="dx-pre dx-raw">${esc(resText(r) || '')}</pre>`;
      }
      if (S.netTab === 'initiator') {
        if (!r.init || r.initDoc) return `<p class="dx-sub">Request initiator chain</p><div class="dx-muted">${esc(SC.origin + S.path)}</div><div class="dx-ind">${esc(r.url)}</div>`;
        return `<p class="dx-sub">Request call stack</p>${r.init.stack.map(([fn, s]) => `<div class="dx-stack"><span>${esc(fn)}</span><button type="button" class="dx-link" data-a="src" data-v="${esc(s)}">${esc(s)}</button></div>`).join('')}`;
      }
      if (S.netTab === 'timing') {
        if (r.fromCache) return '<p class="dx-empty">Ресурс взят из кэша — запроса к серверу не было (Size: ' + r.fromCache + ').</p>';
        if (!r.timing) return r.pending ? '<p class="dx-empty">Запрос ещё выполняется…</p>' : noData;
        const t = r.timing;
        const rowsT = [['Queueing', t.queue], ['Stalled', t.stalled], ['DNS Lookup', t.dns], ['Initial connection', t.connect], ['SSL', t.ssl], ['Request sent', t.sent], ['Waiting for server response', t.wait], ['Content Download', t.download]];
        const sum = r.time || 1;
        return `<p class="dx-sub">Queued at ${(r.id * 3.7).toFixed(1)} ms · Started at ${(r.id * 3.7 + 1.2).toFixed(1)} ms</p><table class="dx-timing">${rowsT.map(([nm, v]) => `<tr><td>${nm}</td><td><span class="dx-tbar${nm.startsWith('Waiting') ? ' w' : nm.startsWith('Content') ? ' d' : ''}" style="width:${Math.max(1, Math.min(100, (v / sum) * 100))}%"></span></td><td>${ms(v)}</td></tr>`).join('')}<tr class="tot"><td>Total</td><td></td><td>${ms(sum)}</td></tr></table>`;
      }
      const st = r.pending ? '(pending)' : r.blocked ? '(blocked:devtools)' : r.failed ? `(failed) net::${r.failed}` : `${r.status} ${r.statusText || ''}`;
      const dot = r.pending || r.failed || r.status >= 400 ? 'dx-err' : 'dx-ok';
      return `<p class="dx-sub">▾ General</p><table class="dx-kv">
          <tr><td>Request URL</td><td>${esc(r.url)}</td></tr><tr><td>Request Method</td><td>${r.method}</td></tr>
          <tr><td>Status Code</td><td><span class="${dot}">●</span> ${esc(st)}${r.fromCache ? ` (from ${r.fromCache})` : ''}</td></tr>
          <tr><td>Remote Address</td><td>185.12.44.10:443</td></tr><tr><td>Referrer Policy</td><td>strict-origin-when-cross-origin</td></tr></table>
        ${r.resHeaders && Object.keys(r.resHeaders).length ? `<p class="dx-sub">▾ Response Headers</p>${kvTable(r.resHeaders)}` : ''}
        <p class="dx-sub">▾ Request Headers</p>${kvTable(r.reqHeaders || {})}`;
    }
    function resText(r) {
      if (r.resText != null) return r.resText;
      if (r.file && SC.files && SC.files['src/' + r.file]) return SC.files['src/' + r.file];
      if (r.file && SC.files && SC.files[r.file]) return SC.files[r.file];
      if (r.kind === 'css') return '/* ' + r.name + ' */\n.top{display:flex;align-items:center}…';
      if (r.kind === 'js') return '!function(){"use strict";var e=window.__APP__||{};…}();';
      if (r.kind === 'doc') return '<!DOCTYPE html>\n<html lang="ru">\n<head>…</head>\n<body>…</body>\n</html>';
      return '';
    }
    function curlOf(r) {
      const parts = [`curl ${shq(r.url)}`];
      if (r.method !== 'GET' && !(r.method === 'POST' && r.payload != null)) parts.push(`-X ${shq(r.method)}`);
      Object.keys(r.reqHeaders || {}).forEach((k) => { if (k === 'cookie') parts.push(`-b ${shq(r.reqHeaders[k])}`); else parts.push(`-H ${shq(k + ': ' + r.reqHeaders[k])}`); });
      if (r.payload != null) parts.push(`--data-raw ${shq(typeof r.payload === 'string' ? r.payload : JSON.stringify(r.payload))}`);
      return parts.join(' \\\n  ');
    }
    function reqMenuAction(r, what) {
      if (what === 'curl') {
        const t = curlOf(r);
        clip(t);
        toast('Copy as cURL (bash): скопировано в буфер обмена', t);
        emit('copy-curl', { tag: r.tag, id: r.id, text: t });
      } else if (what === 'url') {
        clip(r.url);
        toast('Скопирован URL', r.url);
        emit('copy-url', { tag: r.tag, id: r.id });
      } else if (what === 'resp') {
        clip(resText(r));
        toast('Скопирован ответ', resText(r));
        emit('copy-resp', { tag: r.tag, id: r.id });
      } else if (what === 'replay') {
        const o = Object.assign({}, r.o, { done: null, replay: true });
        const nr = S.api(o);
        nr.replayOf = r.id;
        const orig = r.o.onReplay;
        nr.o.done = (res) => { emit('replay', { tag: r.tag, id: nr.id, status: res.status }); if (orig) orig(S, res); };
        emit('replay-start', { tag: r.tag });
      } else if (what === 'block') {
        const u = new URL(r.url);
        const pat = u.host + u.pathname;
        if (!S.blocked.some((b) => b.pat === pat)) S.blocked.push({ pat, on: true });
        S.blockOn = true;
        renderPane();
        emit('block', { pat, tag: r.tag });
      } else if (what === 'block-domain') {
        const pat = new URL(r.url).host;
        if (!S.blocked.some((b) => b.pat === pat)) S.blocked.push({ pat, on: true });
        renderPane();
        emit('block', { pat, tag: r.tag, domain: true });
      } else if (what === 'open') openSrc(r.name + ':1', 'network');
    }

    /* ---------- Application ---------- */
    const AREA = { local: 'ls', session: 'ss' };
    function paneApp() {
      const it = (sec, label, d, ico) => `<button type="button" class="dx-app-i d${d}${S.appSec === sec ? ' on' : ''}" data-a="app-sec" data-v="${sec}"><span aria-hidden="true">${ico}</span> ${label}</button>`;
      const side = `<div class="dx-app-side">
        <p class="dx-sub">Application</p>${it('manifest', 'Manifest', 1, '📄')}${it('sw', 'Service workers', 1, '⚙')}${it('storage', 'Storage', 1, '🗄')}
        <p class="dx-sub">Storage</p>
        <div class="dx-app-g">▾ <span aria-hidden="true">▤</span> Local storage</div>${it('local', SC.origin, 2, '▤')}
        <div class="dx-app-g">▾ <span aria-hidden="true">▤</span> Session storage</div>${it('session', SC.origin, 2, '▤')}
        ${it('idb', 'IndexedDB', 1, '🛢')}
        <div class="dx-app-g">▾ <span aria-hidden="true">🍪</span> Cookies</div>${it('cookies', SC.origin, 2, '🍪')}
        ${it('cache', 'Cache storage', 1, '🗃')}
      </div>`;
      let main = '';
      if (AREA[S.appSec]) main = storeTable(S.appSec);
      else if (S.appSec === 'cookies') main = cookieTable();
      else if (S.appSec === 'storage') {
        const used = [...S.ls, ...S.ss].reduce((s, [k, v]) => s + k.length + v.length, 0) * 2 + S.cookies.length * 60;
        main = `<div class="dx-app-pad"><h4>Storage</h4><p class="dx-muted">${esc(SC.origin)}</p><p>Usage: <b>${kb(used)}</b> used out of 296 GB storage quota</p>
          <div class="dx-clear-list"><label><input type="checkbox" checked disabled> Unregister service workers</label><label><input type="checkbox" checked disabled> Local and session storage</label><label><input type="checkbox" checked disabled> IndexedDB</label><label><input type="checkbox" checked disabled> Cookies</label><label><input type="checkbox" checked disabled> Cache storage</label></div>
          <button type="button" class="dx-btn dx-primary" data-a="clear-site">Clear site data</button></div>`;
      } else if (S.appSec === 'manifest') main = '<p class="dx-empty">No manifest detected</p>';
      else if (S.appSec === 'sw') main = '<p class="dx-empty">Service workers не зарегистрированы для этого origin.</p>';
      else main = '<p class="dx-empty">Нет данных для этого origin.</p>';
      return `<div class="dx-app">${side}<div class="dx-app-main">${main}</div></div>`;
    }
    function storeTable(sec) {
      const mp = S[AREA[sec]];
      const keys = [...mp.keys()];
      const ed = S.edit && S.edit.t === 'app' ? S.edit : null;
      const cell = (key, col, val) => (ed && ed.sec === sec && ed.key === key && ed.col === col
        ? `<input class="dx-edit" data-focus="edit" data-in="edit" value="${esc(val)}">`
        : `<span data-a="app-cell" data-key="${esc(key)}" data-col="${col}">${esc(val)}</span>`);
      const selV = S.appSel != null && mp.has(S.appSel) ? mp.get(S.appSel) : null;
      let preview = '';
      if (selV != null) {
        let parsed = null;
        try { parsed = JSON.parse(selV); } catch (e) { parsed = null; }
        preview = parsed && typeof parsed === 'object' ? `<div class="dx-pre">${jsonTree(parsed)}</div>` : `<pre class="dx-pre">${esc(selV)}</pre>`;
      }
      return `<div class="dx-bar2"><button type="button" class="dx-btn" data-a="app-refresh" title="Refresh">⟳</button><input class="dx-in" placeholder="Filter" disabled aria-label="Filter"><button type="button" class="dx-btn" data-a="app-clear" title="Clear All">🚫</button><button type="button" class="dx-btn" data-a="app-del" title="Delete Selected"${S.appSel != null ? '' : ' disabled'}>✕</button></div>
        <div class="dx-app-tbl" data-scroll="app"><table class="dx-grid"><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>
        ${keys.map((k) => `<tr class="${S.appSel === k ? 'sel' : ''}" data-a="app-row" data-key="${esc(k)}"><td>${cell(k, 'key', k)}</td><td>${cell(k, 'value', mp.get(k))}</td></tr>`).join('')}
        <tr class="dx-newrow"><td>${ed && ed.sec === sec && ed.key === null ? '<input class="dx-edit" data-focus="edit" data-in="edit" value="" placeholder="key">' : '<span data-a="app-new">＋ двойной клик, чтобы добавить</span>'}</td><td></td></tr></tbody></table></div>
        <div class="dx-app-prev">${preview || '<p class="dx-empty">Выбери строку, чтобы увидеть значение. Повторный клик (или двойной) по ячейке — редактирование.</p>'}</div>`;
    }
    function cookieTable() {
      const ed = S.edit && S.edit.t === 'app' && S.edit.sec === 'cookies' ? S.edit : null;
      const sel = S.cookies.find((c) => c.name === S.appSel);
      return `<div class="dx-bar2"><button type="button" class="dx-btn" data-a="app-refresh" title="Refresh">⟳</button><input class="dx-in" placeholder="Filter" disabled aria-label="Filter"><button type="button" class="dx-btn" data-a="app-clear" title="Clear all cookies">🚫</button><button type="button" class="dx-btn" data-a="app-del" title="Delete Selected"${sel ? '' : ' disabled'}>✕</button></div>
        <div class="dx-app-tbl" data-scroll="app"><table class="dx-grid"><thead><tr><th>Name</th><th>Value</th><th>Domain</th><th>Path</th><th>Expires / Max-Age</th><th>Size</th><th>HttpOnly</th><th>Secure</th><th>SameSite</th><th>Priority</th></tr></thead><tbody>
        ${S.cookies.map((c) => `<tr class="${S.appSel === c.name ? 'sel' : ''}" data-a="app-row" data-key="${esc(c.name)}"><td>${esc(c.name)}</td><td>${ed && ed.key === c.name ? `<input class="dx-edit" data-focus="edit" data-in="edit" value="${esc(c.value)}">` : `<span data-a="app-cell" data-key="${esc(c.name)}" data-col="value">${esc(c.value)}</span>`}</td><td>${esc(c.domain || host)}</td><td>${esc(c.path)}</td><td>${esc(c.expires)}</td><td>${c.name.length + c.value.length}</td><td>${c.httpOnly ? '✓' : ''}</td><td>${c.secure ? '✓' : ''}</td><td>${esc(c.sameSite)}</td><td>${esc(c.priority)}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="dx-app-prev">${sel ? `<p class="dx-sub">Cookie Value</p><pre class="dx-pre">${esc(sel.value)}</pre>` : '<p class="dx-empty">Выбери cookie, чтобы увидеть значение.</p>'}</div>`;
    }
    function appCommit(ed, value) {
      if (ed.sec === 'cookies') {
        const c = S.cookies.find((x) => x.name === ed.key);
        if (c) { c.value = value; emit('cookie-set', { name: c.name, value }); }
        renderPane();
        return;
      }
      const mp = S[AREA[ed.sec]];
      if (ed.key === null) {
        const k = value.trim();
        if (k && !mp.has(k)) { mp.set(k, ''); S.appSel = k; emit('storage-set', { area: ed.sec, key: k, value: '' }); }
        renderPane();
        return;
      }
      if (ed.col === 'key') {
        const k = value.trim();
        if (k && k !== ed.key) {
          const entries = [...mp.entries()].map(([kk, v]) => (kk === ed.key ? [k, v] : [kk, v]));
          mp.clear();
          entries.forEach(([kk, v]) => mp.set(kk, v));
          S.appSel = k;
          emit('storage-set', { area: ed.sec, key: k, value: mp.get(k) });
        }
      } else {
        mp.set(ed.key, value);
        emit('storage-set', { area: ed.sec, key: ed.key, value });
      }
      renderPane();
    }

    /* ---------- Контекстные меню ---------- */
    function renderMenu() {
      const layer = $('.dx-menu-layer');
      const m = S.menu;
      layer.hidden = !m;
      if (!m) { layer.innerHTML = ''; return; }
      let items = '';
      if (m.t === 'req') {
        const r = S.net.find((x) => x.id === m.id);
        if (!r) { S.menu = null; layer.hidden = true; return; }
        items = (r.kind === 'xhr' ? '<button type="button" data-a="mi" data-v="replay">Replay XHR</button>' : '') +
          (r.kind === 'js' || r.kind === 'css' ? '<button type="button" data-a="mi" data-v="open">Open in Sources panel</button>' : '') +
          '<hr><p class="dx-mh">Copy</p><button type="button" data-a="mi" data-v="url">Copy URL</button><button type="button" data-a="mi" data-v="curl">Copy as cURL (bash)</button><button type="button" data-a="mi" data-v="resp">Copy response</button>' +
          '<hr><button type="button" data-a="mi" data-v="block">Block request URL</button><button type="button" data-a="mi" data-v="block-domain">Block request domain</button>';
      } else {
        const n = S.n(m.k);
        if (!n) { S.menu = null; layer.hidden = true; return; }
        items = '<button type="button" data-a="mi" data-v="add">Add attribute</button>' +
          (n.text != null || !n.kids.length ? '<button type="button" data-a="mi" data-v="text">Edit text</button>' : '') +
          `<button type="button" data-a="mi" data-v="hov">${S.hov.has(n.k) ? '✓ ' : ''}Force state :hover</button>` +
          `<button type="button" data-a="mi" data-v="hide">${String(n.a.class || '').includes(HIDE_CLS) ? 'Show element' : 'Hide element'}</button>` +
          (['html', 'head', 'body'].includes(n.tag) ? '' : '<button type="button" data-a="mi" data-v="del">Delete element</button>') +
          (Object.keys(n.a).length ? '<hr><p class="dx-mh">Attributes</p>' + Object.keys(n.a).map((k) => `<div class="dx-mi-at"><span>${esc(k)}</span><button type="button" data-a="mi" data-v="edit:${esc(k)}">Edit</button><button type="button" data-a="mi" data-v="rm:${esc(k)}">Delete</button></div>`).join('') : '');
      }
      layer.innerHTML = `<div class="dx-menu" role="menu" style="left:${m.x}px;top:${m.y}px">${items}</div>`;
      const box = layer.querySelector('.dx-menu');
      const lw = root.clientWidth;
      if (m.x + box.offsetWidth > lw - 4) box.style.left = Math.max(4, lw - box.offsetWidth - 4) + 'px';
      const lh = root.clientHeight;
      if (m.y + box.offsetHeight > lh - 4) box.style.top = Math.max(4, lh - box.offsetHeight - 4) + 'px';
    }
    function openMenu(t, idOrK, ev) {
      const rr = root.getBoundingClientRect();
      const tr = ev.target.getBoundingClientRect ? ev.target.getBoundingClientRect() : { left: 0, bottom: 0 };
      const x = (ev.clientX || tr.left) - rr.left;
      const y = (ev.clientY && ev.type === 'contextmenu' ? ev.clientY : tr.bottom) - rr.top;
      S.menu = t === 'req' ? { t, id: idOrK, x, y } : { t, k: idOrK, x, y };
      renderMenu();
    }
    function menuAction(v) {
      const m = S.menu;
      S.menu = null;
      renderMenu();
      if (!m) return;
      if (m.t === 'req') { const r = S.net.find((x) => x.id === m.id); if (r) reqMenuAction(r, v); return; }
      const n = S.n(m.k);
      if (!n) return;
      if (v === 'add') { S.edit = { k: n.k, at: '' }; renderPane(); }
      else if (v === 'text') { S.edit = { k: n.k, at: '#text' }; renderPane(); }
      else if (v === 'hov') { if (S.hov.has(n.k)) S.hov.delete(n.k); else S.hov.add(n.k); changed(); emit('force', { k: n.k, state: ':hover', on: S.hov.has(n.k) }); }
      else if (v === 'hide') toggleHide(n);
      else if (v === 'del') deleteNode(n);
      else if (v.startsWith('edit:')) { S.edit = { k: n.k, at: v.slice(5) }; renderPane(); }
      else if (v.startsWith('rm:')) setAttr(n, v.slice(3), null);
    }

    /* ======================= События ======================= */
    // Клик по элементу страницы: ищем обработчик вверх по дереву (как всплытие события).
    function activate(n) {
      for (let x = n; x; x = x.p) {
        if (['button', 'input', 'select'].includes(x.tag) && own(x.a, 'disabled')) return;
        if (x.act) { const f = SC.acts[x.act]; if (f) f(S, x, n); return; }
      }
    }
    function setPanel(p) {
      S.panel = p;
      S.menu = null;
      S.lvOpen = false;
      renderDT();
      emit('panel', { panel: p });
    }
    function pickAt(x, y) {
      const els = document.elementsFromPoint(x, y);
      const t = els.find((e) => pageEl.contains(e) && e.dataset && e.dataset.k);
      return t ? S.n(t.dataset.k) : null;
    }

    pageEl.addEventListener('click', (e) => {
      if (e.target.closest('a')) e.preventDefault();
      if (S.paused) return;
      const t = e.target.closest('[data-k]');
      if (!t) return;
      const n = S.n(t.dataset.k);
      if (n && n.tag !== 'input' && n.tag !== 'select') activate(n);
      else if (n && n.tag === 'input' && n.a.type === 'checkbox') activate(n);
    });
    pageEl.addEventListener('input', (e) => {
      const t = e.target;
      const n = t.dataset.k && S.n(t.dataset.k);
      if (!n) return;
      if (n.a.type === 'checkbox') return;
      let v = t.value;
      if (own(n.a, 'maxlength') && /^\d+$/.test(n.a.maxlength) && v.length > +n.a.maxlength) { v = v.slice(0, +n.a.maxlength); t.value = v; }
      n.val = v;
      if (n.inp && SC.acts[n.inp]) SC.acts[n.inp](S, n);
    });
    pageEl.addEventListener('change', (e) => {
      const t = e.target;
      const n = t.dataset.k && S.n(t.dataset.k);
      if (!n) return;
      if (n.a.type === 'checkbox') { n.checked = t.checked; if (n.inp && SC.acts[n.inp]) SC.acts[n.inp](S, n); } else n.val = t.value;
    });
    pageEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const n = e.target.dataset && e.target.dataset.k && S.n(e.target.dataset.k);
      if (n && n.enter && SC.acts[n.enter] && !S.paused) { e.preventDefault(); SC.acts[n.enter](S, n); }
    });
    // Настоящее наведение мыши — только если в стилях сценария есть :hover-правила.
    const hasHover = S.css.some((r) => /:hover/.test(r.sel));
    pageEl.addEventListener('mouseover', (e) => {
      if (!hasHover || S.pick) return;
      const t = e.target.closest('[data-k]');
      const k = t ? t.dataset.k : null;
      if (k !== S.realHover) { S.realHover = k; renderPage(); }
    });
    pageEl.addEventListener('mouseleave', () => { if (hasHover && S.realHover) { S.realHover = null; renderPage(); } });

    // Режим выбора элемента: маска поверх страницы, подсветка под курсором.
    const over = $('.dx-over');
    over.addEventListener('pointermove', (e) => {
      if (!S.pick) return;
      const n = pickAt(e.clientX, e.clientY);
      pageEl.querySelectorAll('.dx-hl').forEach((x) => x.classList.remove('dx-hl'));
      if (n) { const x = pageEl.querySelector(`[data-k="${CSS.escape(n.k)}"]`); if (x) x.classList.add('dx-hl'); }
    });
    over.addEventListener('click', (e) => {
      if (S.pick && e.target.closest('[data-pickmask]')) {
        const n = pickAt(e.clientX, e.clientY);
        S.pick = false;
        pageEl.querySelectorAll('.dx-hl').forEach((x) => x.classList.remove('dx-hl'));
        renderChrome();
        renderOver();
        if (n) { emit('pick', { k: n.k }); selectNode(n.k, 'pick'); }
      }
    });

    function onAction(a, t, e) {
      const v = t.dataset.v;
      switch (a) {
        case 'back': if (S.hist.length) load(S.hist.pop(), 'back'); break;
        case 'reload': S.reload('button'); break;
        case 'panel': setPanel(v); break;
        case 'pick': S.pick = !S.pick; renderChrome(); renderOver(); emit('pick-mode', { on: S.pick }); break;
        case 'device':
          S.device = !S.device;
          renderAll();
          emit('device', { on: S.device, w: S.devW });
          break;
        case 'resume': resume(false); break;
        case 'step': resume(true); break;
        case 'dlg': {
          const d = S.dialog;
          S.dialog = null;
          renderOver();
          if (d && v === 'ok') d.ok(S);
          break;
        }
        // Elements
        case 'tw': if (S.collapsed.has(v)) S.collapsed.delete(v); else S.collapsed.add(v); renderPane(); break;
        case 'sel': selectNode(v, 'crumbs'); break;
        case 'node-menu': openMenu('node', v, e); break;
        case 'eltab': S.elTab = v; renderPane(); emit('el-tab', { tab: v, k: S.elSel }); break;
        case 'hov': S.hovOpen = !S.hovOpen; renderPane(); break;
        case 'force': {
          if (v === ':hover') { if (S.hov.has(S.elSel)) S.hov.delete(S.elSel); else S.hov.add(S.elSel); changed(); emit('force', { k: S.elSel, state: v, on: S.hov.has(S.elSel) }); }
          else { S.forced = S.forced || new Set(); const key = S.elSel + v; if (S.forced.has(key)) S.forced.delete(key); else S.forced.add(key); renderPane(); emit('force', { k: S.elSel, state: v }); }
          break;
        }
        case 'decl': {
          const n = S.n(S.elSel);
          if (t.dataset.r === 'i') {
            const ds = parseDecls(n.a.style);
            const d = ds[+t.dataset.d];
            d.off = !d.off;
            setAttr(n, 'style', declStr(ds), true);
            emit('style', { k: n.k, sel: 'element.style', p: d.p, on: !d.off });
          } else {
            const r = S.css[+t.dataset.r];
            const d = r.decls[+t.dataset.d];
            d.off = !d.off;
            changed();
            emit('style', { k: n.k, sel: r.sel, p: d.p, on: !d.off });
          }
          break;
        }
        case 'dval': S.edit = { t: 'decl', r: t.dataset.r === 'i' ? 'i' : +t.dataset.r, d: +t.dataset.d, k: S.elSel }; renderPane(); break;
        case 'elq-next': elSearch(true); break;
        case 'src': openSrc(v, t.dataset.from || 'link'); break;
        // Console
        case 'con-clear': S.con = []; S.log('verbose', 'Console was cleared', ''); emit('console-clear'); break;
        case 'lv': S.lvOpen = !S.lvOpen; renderPane(); break;
        case 'lvset': S.conLevels[v] = !S.conLevels[v]; renderPane(); emit('console-levels', { levels: Object.assign({}, S.conLevels) }); break;
        // Sources
        case 'open-file': S.srcFile = v; S.srcLine = null; renderPane(); emit('src-open', { file: base(v), from: 'nav' }); break;
        case 'bp': {
          const ln = +v;
          const set = S.bps.get(S.srcFile) || new Set();
          if (set.has(ln)) set.delete(ln); else set.add(ln);
          S.bps.set(S.srcFile, set);
          renderPane();
          emit('bp', { file: base(S.srcFile), line: ln, on: set.has(ln) });
          break;
        }
        // Network
        case 'req': {
          const r = S.net.find((x) => x.id === +v);
          S.netSel = +v;
          const tabs = ['headers', 'preview', 'response', 'initiator', 'timing'].concat(r && (r.payload != null || r.query) ? ['payload'] : []);
          if (!tabs.includes(S.netTab)) S.netTab = 'headers';
          renderPane();
          if (r) emit('net-select', { id: r.id, tag: r.tag, method: r.method, status: r.status, tab: S.netTab, init: r.init && r.init.src, fromCache: !!r.fromCache });
          break;
        }
        case 'req-close': S.netSel = null; renderPane(); break;
        case 'ntab': {
          S.netTab = v;
          renderPane();
          const r = S.selReq();
          if (r) emit('net-tab', { id: r.id, tag: r.tag, tab: v, init: r.init && r.init.src, status: r.status });
          break;
        }
        case 'req-menu': openMenu('req', +v, e); break;
        case 'ntype': S.netType = v; renderPane(); emit('net-type', { kind: v }); break;
        case 'net-clear': S.net = []; S.netSel = null; renderPane(); emit('net-clear'); break;
        case 'preserve': S.preserve = t.checked; emit('preserve', { on: S.preserve }); break;
        case 'nocache': S.noCache = t.checked; emit('nocache', { on: S.noCache }); break;
        case 'block-all': S.blockOn = t.checked; renderPane(); emit('block-toggle', { on: S.blockOn }); break;
        case 'block-one': S.blocked[+v].on = t.checked; renderPane(); emit('block-toggle', { pat: S.blocked[+v].pat, on: t.checked }); break;
        case 'block-rm': { const b = S.blocked.splice(+v, 1)[0]; renderPane(); emit('unblock', { pat: b && b.pat }); break; }
        case 'mi': menuAction(v); break;
        // Application
        case 'app-sec': S.appSec = v; S.appSel = null; S.edit = null; renderPane(); emit('app-open', { sec: v }); break;
        case 'app-row':
        case 'app-cell': {
          const key = t.dataset.key;
          const cellEl = e.target.closest('[data-a="app-cell"]');
          if (S.appSel === key && cellEl) { S.edit = { t: 'app', sec: S.appSec, key, col: cellEl.dataset.col }; renderPane(); break; }
          S.appSel = key;
          S.edit = null;
          renderPane();
          emit('app-row', { sec: S.appSec, key });
          break;
        }
        case 'app-new': S.edit = { t: 'app', sec: S.appSec, key: null, col: 'key' }; renderPane(); break;
        case 'app-refresh': renderPane(); break;
        case 'app-clear':
          if (S.appSec === 'cookies') { S.cookies = []; emit('cookie-clear'); } else if (AREA[S.appSec]) { S[AREA[S.appSec]].clear(); emit('storage-clear', { area: S.appSec }); }
          S.appSel = null;
          renderPane();
          break;
        case 'app-del':
          if (S.appSel == null) break;
          if (S.appSec === 'cookies') { S.cookies = S.cookies.filter((c) => c.name !== S.appSel); emit('cookie-del', { name: S.appSel }); } else if (AREA[S.appSec]) { S[AREA[S.appSec]].delete(S.appSel); emit('storage-del', { area: S.appSec, key: S.appSel }); }
          S.appSel = null;
          renderPane();
          break;
        case 'clear-site':
          S.ls.clear();
          S.ss.clear();
          S.cookies = [];
          toast('Данные сайта очищены', '');
          renderPane();
          emit('clear-site-data');
          break;
        default: break;
      }
    }

    root.addEventListener('click', (e) => {
      if (S.menu && !e.target.closest('.dx-menu')) {
        S.menu = null;
        renderMenu();
        if (e.target.closest('.dx-menu-layer')) return;
      }
      if (S.lvOpen && !e.target.closest('.dx-lv-wrap')) { S.lvOpen = false; const pop = root.querySelector('.dx-pop'); if (pop) pop.remove(); }
      const t = e.target.closest('[data-a]');
      if (t && root.contains(t)) {
        if (t.dataset.a === 'req' && e.target.closest('.dx-linkish')) {
          const r = S.net.find((x) => x.id === +t.dataset.v);
          if (r && r.init) { openSrc(r.init.src, 'network'); return; }
        }
        onAction(t.dataset.a, t, e);
        return;
      }
      // Клик по узлу дерева Elements
      const node = e.target.closest('.dx-dom [data-k]');
      if (node && !e.target.closest('.dx-edit')) {
        if (S.edit) { const inp = root.querySelector('.dx-edit'); if (inp) commitEdit(inp.value); }
        selectNode(node.dataset.k, 'tree');
      }
    });
    root.addEventListener('dblclick', (e) => {
      const at = e.target.closest('.dx-at');
      if (at) { S.elSel = at.dataset.k; S.edit = { k: at.dataset.k, at: at.dataset.at }; renderPane(); return; }
      const tx = e.target.closest('[data-tx]');
      if (tx) { const n = tx.closest('[data-k]'); if (n) { S.elSel = n.dataset.k; S.edit = { k: n.dataset.k, at: '#text' }; renderPane(); } return; }
      const cell = e.target.closest('[data-a="app-cell"]');
      if (cell) { S.appSel = cell.dataset.key; S.edit = { t: 'app', sec: S.appSec, key: cell.dataset.key, col: cell.dataset.col }; renderPane(); return; }
      if (e.target.closest('[data-a="app-new"]')) { S.edit = { t: 'app', sec: S.appSec, key: null, col: 'key' }; renderPane(); }
    });
    root.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('tr[data-a="req"]');
      if (row) { e.preventDefault(); S.netSel = +row.dataset.v; renderPane(); openMenu('req', +row.dataset.v, e); return; }
      const node = e.target.closest('.dx-dom [data-k]');
      if (node && !node.classList.contains('dx-txt')) { e.preventDefault(); S.elSel = node.dataset.k; renderPane(); openMenu('node', node.dataset.k, e); }
    });
    root.addEventListener('input', (e) => {
      const t = e.target;
      const k = t.dataset && t.dataset.in;
      if (!k) return;
      if (k === 'netq') { S.netQ = t.value; renderPane(); emit('net-filter', { q: S.netQ }); }
      else if (k === 'conq') { S.conQ = t.value; renderPane(); emit('console-filter', { q: S.conQ }); }
      else if (k === 'elq') { S.elQ = t.value; S.elHits = []; S.elHit = -1; }
      else if (k === 'devw') { const w = parseInt(t.value, 10); if (w >= 240 && w <= 1400) { S.devW = w; renderChrome(); renderPage(); emit('device-size', { w, name: S.devName }); } }
    });
    root.addEventListener('change', (e) => {
      const t = e.target;
      const k = t.dataset && t.dataset.in;
      if (k === 'throttle') { S.throttle = t.value; emit('throttle', { value: S.throttle }); }
      else if (k === 'dev') {
        const d = DEVICES.find((x) => x[0] === t.value);
        S.devName = d[0];
        S.devW = d[1];
        S.devH = d[2];
        renderAll();
        emit('device-size', { w: S.devW, name: S.devName });
      }
    });
    root.addEventListener('keydown', (e) => {
      const t = e.target;
      const k = t.dataset && t.dataset.in;
      if (k === 'edit') {
        if (e.key === 'Enter') { e.preventDefault(); commitEdit(t.value); }
        else if (e.key === 'Escape') { e.preventDefault(); commitEdit('', true); }
        return;
      }
      if (k === 'elq' && e.key === 'Enter') { e.preventDefault(); elSearch(S.elHits.length > 0); return; }
      if (k === 'conin') {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const code = t.value; t.value = ''; runConsole(code); }
        else if (e.key === 'ArrowUp' && S.conHist.length && !t.value.includes('\n')) { e.preventDefault(); S.conHistI = Math.max(0, S.conHistI - 1); t.value = S.conHist[S.conHistI] || ''; }
        else if (e.key === 'ArrowDown' && S.conHist.length) { e.preventDefault(); S.conHistI = Math.min(S.conHist.length, S.conHistI + 1); t.value = S.conHist[S.conHistI] || ''; }
        return;
      }
      if (e.key === 'Escape' && S.menu) { S.menu = null; renderMenu(); return; }
      if (t.classList && t.classList.contains('dx-dom') && S.elSel) {
        const n = S.n(S.elSel);
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteNode(n); }
        else if (e.key === 'h' || e.key === 'H') { e.preventDefault(); toggleHide(n); }
      }
      if (e.key === 'F8' && S.paused) { e.preventDefault(); resume(false); }
      if (e.key === 'F10' && S.paused) { e.preventDefault(); resume(true); }
    });
    root.addEventListener('focusout', (e) => {
      const t = e.target;
      // Как в DevTools: правка применяется и при потере фокуса.
      if (t.dataset && t.dataset.in === 'edit' && S.edit && !S.committing) {
        S.committing = true;
        setTimeout(() => { if (S.edit && document.activeElement !== t && root.contains(t)) commitEdit(t.value); S.committing = false; }, 0);
      }
    });

    // Первая загрузка страницы уровня (без событий в журнал испытания).
    load(SC.start, 'init');
    if (SC.init) SC.init(S);
    renderAll();
    S.booting = false;
    return {};
  }

  /* ======================= Сценарии уровней ======================= */
  // Общая таблица стилей сайтов (app.css): правила применяются к странице и видны в Styles.
  const BASE_CSS = [
    ['body', 'app.css:1', 'margin: 0; font-family: system-ui, -apple-system, Segoe UI, sans-serif; font-size: 13px; color: #1f2933; background: #f4f6fb'],
    ['.top', 'app.css:8', 'display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; background: #ffffff; border-bottom: 1px solid #e3e6ef; flex-wrap: wrap'],
    ['.logo', 'app.css:18', 'font-weight: 700; color: #2a3a8f'],
    ['.wrap', 'app.css:22', 'padding: 14px; display: grid; gap: 12px'],
    ['.card', 'app.css:28', 'background: #ffffff; border-radius: 10px; padding: 14px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08)'],
    ['.form', 'app.css:35', 'display: grid; gap: 10px; max-width: 320px'],
    ['label', 'app.css:41', 'display: grid; gap: 4px; font-size: 12px; color: #555555'],
    ['input', 'app.css:48', 'padding: 7px 9px; border: 1px solid #ccccdd; border-radius: 6px; font-size: 13px; background: #ffffff; color: #1f2933'],
    ['select', 'app.css:56', 'padding: 6px 8px; border: 1px solid #ccccdd; border-radius: 6px; background: #ffffff; color: #1f2933'],
    ['.btn', 'app.css:62', 'background: #3b5bdb; color: #ffffff; border: 0; border-radius: 6px; padding: 9px 14px; font-weight: 600; cursor: pointer'],
    ['.btn:disabled', 'app.css:72', 'opacity: 0.5; cursor: not-allowed'],
    ['.btn.ghost', 'app.css:76', 'background: #eef1fb; color: #2a3a8f'],
    ['.muted', 'app.css:80', 'color: #6b7280; font-size: 12px'],
    ['.alert', 'app.css:85', 'padding: 8px 10px; border-radius: 6px; background: #fdecea; color: #a50e0e; font-size: 12px'],
    ['.alert.ok', 'app.css:92', 'background: #e6f4ea; color: #137333'],
    ['h1', 'app.css:96', 'font-size: 18px; margin: 0'],
    ['h2', 'app.css:100', 'font-size: 15px; margin: 0'],
    ['p', 'app.css:104', 'margin: 0'],
    ['ul', 'app.css:107', 'margin: 0; padding-left: 18px'],
    ['.row', 'app.css:111', 'display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap'],
    ['.grid', 'app.css:118', 'display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px'],
    ['.nav', 'app.css:124', 'display: flex; gap: 4px; flex-wrap: wrap'],
    ['.nav-link', 'app.css:129', 'padding: 6px 10px; border-radius: 6px; color: #2a3a8f; text-decoration: none'],
    ['.product-card', 'app.css:136', 'background: #ffffff; border-radius: 10px; padding: 10px; display: grid; gap: 4px; justify-items: center; text-align: center; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08)'],
    ['.price', 'app.css:146', 'font-weight: 700; color: #137333'],
    ['.badge', 'app.css:150', 'display: inline-block; padding: 2px 8px; border-radius: 10px; background: #eef1fb; color: #2a3a8f; font-size: 11px'],
  ];
  const card = (k, emoji, name, price, extra) => h('div', { class: 'product-card', 'data-id': k }, [
    h('img', { src: `/img/${k}.png`, alt: name, width: '48', height: '48' }, null, { emoji, broken: extra === 'broken' }),
    h('p', { class: 'name' }, name),
    h('p', { class: 'price' }, price),
  ], { k: 'card-' + k });
  const field = (label, a, opt) => h('label', { for: a.id }, [label, h('input', a, null, opt)]);
  const L = (lines) => lines.join('\n');

  const SCEN = {};

  /* ---------- 1. Вход: ошибка в ответе со статусом 200 ---------- */
  SCEN.login = {
    origin: 'https://guild-portal.app', start: '/login',
    css: [
      ['#login-form', 'login.css:4', 'width: 300px; max-width: 100%'],
      ['.btn-login', 'login.css:12', 'width: 100%'],
      ['.forgot-link', 'login.css:18', 'color: #7c5cff; font-size: 13px'],
    ],
    files: {
      'js/login.js': L([
        '// login.js — форма входа Портала Гильдии',
        "import { api } from './api.js';",
        "console.log('Портал Гильдии v2.8.1 загружен');",
        '',
        'const form = document.querySelector(\'#login-form\');',
        "const status = document.querySelector('.status');",
        '',
        "api.get('/api/config').then(applyConfig);",
        '',
        'function applyConfig(cfg) {',
        '  document.documentElement.lang = cfg.locale;',
        '}',
        '',
        'function setLoading(on) {',
        "  const btn = form.querySelector('.btn-login');",
        '  btn.disabled = on;',
        "  btn.textContent = on ? 'Вход…' : 'Войти';",
        '}',
        '',
        'function saveSession(token, user) {',
        "  localStorage.setItem('token', token);",
        "  status.textContent = `Добро пожаловать, ${user.name}!`;",
        '}',
        '',
        '// TODO: показать ошибку валидации пользователю',
        'function showError(err) {',
        '  status.textContent = err.message;',
        '}',
        '',
        'async function handleLogin(event) {',
        '  event.preventDefault();',
        '  setLoading(true);',
        '  const body = {',
        '    email: form.email.value,',
        '    password: form.password.value,',
        '  };',
        "  const res = await api.post('/api/login', body);",
        '  setLoading(false);',
        '  // сервер всегда отвечает 200, ошибка лежит в res.error',
        '  // но здесь её никто не проверяет:',
        '',
        '  const token = res.data.token;',
        '  saveSession(token, res.data.user);',
        '}',
        '',
        '',
        '',
        '',
        '',
        '',
        "form.addEventListener('submit', handleLogin);",
      ]),
    },
    pages: {
      '/login': {
        title: 'Портал Гильдии — вход', sel: 'login-form',
        res: ['css/app.css', 'css/login.css', 'js/login.js', 'img/logo.svg'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🛡️ Портал Гильдии')]),
          h('main', { class: 'wrap' }, [
            h('form', { id: 'login-form', class: 'card form', novalidate: '' }, [
              h('h1', {}, 'Вход'),
              field('Email', { id: 'email', type: 'email', name: 'email', value: 'mage@guild' }),
              field('Пароль', { id: 'password', type: 'password', name: 'password', value: 'chronicles' }),
              h('button', { class: 'btn btn-login', type: 'submit' }, 'Войти', { k: 'btn', act: 'login', ev: [{ type: 'submit', fn: 'handleLogin', src: 'login.js:51' }] }),
              h('a', { class: 'forgot-link', href: '/restore', style: 'display: none;' }, 'Забыли пароль?', { k: 'forgot' }),
              h('p', { class: 'muted status', role: 'status' }, '', { k: 'status' }),
            ]),
          ]),
        ],
        load: (S) => {
          S.log('log', 'Портал Гильдии v2.8.1 загружен', 'login.js:3');
          S.log('warn', 'DevTools failed to load source map: Could not load content for https://guild-portal.app/js/login.js.map: HTTP error: status code 404, net::ERR_HTTP_RESPONSE_CODE_FAILURE', '');
          S.api({ method: 'GET', path: '/api/config', init: { src: 'login.js:8', stack: [['(anonymous)', 'login.js:8']] }, tag: 'config' });
        },
      },
    },
    server: {
      'GET /api/config': () => ({ status: 200, body: { locale: 'ru', features: { sso: false, captcha: false } } }),
      'POST /api/login': (q) => (/@[^@\s]+\.[a-z]{2,}$/i.test(q.body.email)
        ? { status: 200, body: { data: { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjd9.x8Kq', user: { id: 7, name: 'Ивар' } }, error: null } }
        : { status: 200, body: { data: null, error: { code: 'INVALID_EMAIL', message: 'Email должен содержать домен, например name@guild.app' } } }),
    },
    acts: {
      login: (S) => {
        S.setText('btn', 'Вход…');
        S.attr('btn', 'disabled', '');
        S.api({
          method: 'POST', path: '/api/login', body: { email: S.val('email'), password: S.val('password') }, tag: 'login',
          init: { src: 'login.js:37', stack: [['handleLogin', 'login.js:37'], ['HTMLFormElement.handleLogin', 'login.js:51']] },
          done: (res) => {
            S.setText('btn', 'Войти');
            S.attr('btn', 'disabled', null);
            if (res.body && res.body.data) { S.setText('status', 'Добро пожаловать, Ивар!'); S.ls.set('token', res.body.data.token); S.act('login-ok'); }
            else S.log('error', "Uncaught (in promise) TypeError: Cannot read properties of null (reading 'token')\n    at handleLogin (login.js:42:31)", 'login.js:42');
            S.act('login');
          },
        });
      },
    },
  };

  /* ---------- 2. Каталог: уровни логов и фильтр ---------- */
  const CATALOG = [
    { id: 11, name: 'Зелье здоровья', emoji: '🧪', offer: { price: 490 } },
    { id: 12, name: 'Синее зелье', emoji: '🫙', offer: { price: 650 }, broken: true },
    { id: 13, name: 'Эликсир удачи', emoji: '🍀' },
    { id: 14, name: 'Пыль фей', emoji: '✨', offer: { price: 1200 } },
  ];
  SCEN.catalog = {
    origin: 'https://potion-shop.app', start: '/catalog', panel: 'console',
    css: [['.catalog-title', 'catalog.css:3', 'display: flex; gap: 8px; align-items: baseline']],
    files: {
      'js/catalog.js': L([
        '// catalog.js — витрина Лавки зелий',
        "import { api } from './api.js';",
        "import { track } from './analytics.js';",
        '',
        "const grid = document.querySelector('.grid');",
        '',
        'export async function loadCatalog() {',
        "  const res = await api.get('/api/products?category=potions');",
        "  console.log(`Каталог: получено ${res.items.length} товара`);",
        '  renderCatalog(res.items);',
        '}',
        '',
        'function formatPrice(value) {',
        "  return value.toLocaleString('ru-RU') + ' ₽';",
        '}',
        '',
        'function imageUrl(item) {',
        '  return `/img/${item.slug}.png`;',
        '}',
        '',
        'function badge(item) {',
        "  if (item.isNew) return '<span class=\"badge\">new</span>';",
        "  return '';",
        '}',
        '',
        'function cardTemplate(item, price) {',
        '  return `',
        '    <div class="product-card" data-id="${item.id}">',
        '      <img src="${imageUrl(item)}" alt="${item.name}">',
        '      <p class="name">${item.name} ${badge(item)}</p>',
        '      <p class="price">${price}</p>',
        '    </div>`;',
        '}',
        '',
        'function trackImpressions(items) {',
        "  items.forEach((it) => track('impression', { product_id: it.id }));",
        '}',
        '',
        'function clearGrid() {',
        "  grid.innerHTML = '';",
        '}',
        '',
        'function setCount(n) {',
        "  document.querySelector('.count').textContent = `(${n})`;",
        '}',
        '',
        'export function renderCatalog(items) {',
        '  clearGrid();',
        '  setCount(items.length);',
        '  items.forEach((item) => renderCard(item));',
        '  trackImpressions(items);',
        '}',
        '',
        'function renderCard(item) {',
        '  // у части товаров нет блока offer (нет в наличии),',
        '  // но код этого не учитывает',
        '',
        '  const price = formatPrice(item.offer.price);',
        "  grid.insertAdjacentHTML('beforeend', cardTemplate(item, price));",
        '}',
      ]),
    },
    pages: {
      '/catalog': {
        title: 'Лавка зелий — каталог',
        res: ['css/app.css', 'css/catalog.css', 'js/vendor.js', 'js/catalog.js', 'img/potion-red.png', { path: 'img/potion-blue.png', status: 404 }, 'img/hero.webp'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🧪 Лавка зелий'), h('nav', { class: 'nav' }, [h('a', { class: 'nav-link', href: '/catalog' }, 'Каталог'), h('a', { class: 'nav-link', href: '/cart' }, 'Корзина')])]),
          h('main', { class: 'wrap' }, [
            h('h1', { class: 'catalog-title' }, ['Зелья ', h('span', { class: 'muted count' }, '(4)')]),
            h('div', { class: 'grid' }, [card('potion-red', '🧪', 'Зелье здоровья', '490 ₽'), card('potion-blue', '🫙', 'Синее зелье', '650 ₽', 'broken')]),
          ]),
        ],
        load: (S) => {
          S.log('verbose', '[HMR] Waiting for update signal from WDS...', 'vendor.js:2');
          S.log('info', 'Лавка зелий build 3.2.0', 'vendor.js:14');
          S.log('verbose', '[analytics] session started', 'vendor.js:88');
          S.log('warn', "[Deprecation] Listener added for a 'DOMNodeInserted' mutation event. Support for this event type has been removed.", 'vendor.js:120');
          S.log('warn', 'Image with src "https://potion-shop.app/img/hero.webp" has either width or height modified, but not the other.', 'vendor.js:301');
          S.api({
            method: 'GET', path: '/api/products?category=potions', tag: 'products', init: { src: 'catalog.js:8', stack: [['loadCatalog', 'catalog.js:8']] },
            done: () => {
              S.log('log', 'Каталог: получено 4 товара', 'catalog.js:9');
              for (let i = 0; i < 4; i++) S.log('verbose', '[analytics] event: impression', 'vendor.js:91');
              S.log('error', "Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'price')\n    at renderCard (catalog.js:57:39)\n    at Array.forEach (<anonymous>)\n    at renderCatalog (catalog.js:49:9)\n    at loadCatalog (catalog.js:10:3)", 'catalog.js:57');
              S.log('log', '[analytics] page_view /catalog', 'vendor.js:91');
              S.log('warn', '[Violation] \'setTimeout\' handler took 62ms', 'vendor.js:204');
            },
          });
        },
      },
    },
    server: { 'GET /api/products': () => ({ status: 200, body: { total: 4, items: CATALOG.map((c) => Object.assign({ id: c.id, name: c.name, slug: c.emoji === '🫙' ? 'potion-blue' : 'p' + c.id }, c.offer ? { offer: c.offer } : {})) } }) },
    acts: {},
  };

  /* ---------- 3. Поиск: выражения в консоли ---------- */
  const SEARCH_ITEMS = ['Зелье здоровья', 'Зелье маны', 'Зелье невидимости', 'Зелье силы', 'Зелье скорости', 'Зелье огнестойкости', 'Зелье ночного зрения', 'Зелье прыгучести', 'Зелье дыхания', 'Зелье регенерации', 'Зелье удачи'];
  SCEN.search = {
    origin: 'https://potion-shop.app', start: '/search?q=зелье', panel: 'console',
    globals: () => ({ __APP_CONFIG__: { env: 'production', build: '3.2.0', apiUrl: 'https://api.stage.potion-shop.app', sentryDsn: 'https://7c1f@sentry.io/41', features: { newCheckout: false, reviews: true } } }),
    files: {},
    pages: {
      '/search': {
        title: 'Поиск: зелье — Лавка зелий',
        res: ['css/app.css', 'js/vendor.js', 'js/search.js'],
        head: () => [h('script', {}, 'window.__APP_CONFIG__ = {env:"production",build:"3.2.0",apiUrl:"https://api.stage.potion-shop.app",…}', { k: 'cfg-script' })],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🧪 Лавка зелий'), h('input', { class: 'search', type: 'search', value: 'зелье', 'aria-label': 'Поиск' })]),
          h('main', { class: 'wrap' }, [
            h('h1', { class: 'results-title' }, 'Найдено 12 товаров'),
            h('div', { class: 'grid' }, SEARCH_ITEMS.map((n, i) => card('s' + i, '🧪', n, (390 + i * 40) + ' ₽'))),
          ]),
        ],
        load: (S) => {
          S.log('info', 'Лавка зелий build 3.2.0 (production)', 'vendor.js:14');
          S.api({ method: 'GET', path: '/api/search?q=' + encodeURIComponent('зелье'), tag: 'search', init: { src: 'search.js:21', stack: [['runSearch', 'search.js:21']] } });
        },
      },
    },
    server: { 'GET /api/search': () => ({ status: 200, body: { total: 12, items: SEARCH_ITEMS.map((n, i) => ({ id: 100 + i, name: n })).concat([{ id: 111, name: 'Зелье полёта', hidden: true }]) } }) },
    acts: {},
  };

  /* ---------- 4. Кабинет торговца: 500 и cURL ---------- */
  SCEN.merchant = {
    origin: 'https://merchant.guild.app', start: '/orders', panel: 'network',
    headers: () => ({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtZXJjaGFudF8xOCJ9.q1W' }),
    css: [['.orders-empty', 'orders.css:7', 'text-align: center; padding: 18px']],
    files: {},
    pages: {
      '/orders': {
        title: 'Заказы — Кабинет торговца',
        res: ['css/app.css', 'css/orders.css', 'js/vendor.js', 'js/app.js', 'fonts/inter.woff2', 'img/logo.png'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🏪 Кабинет торговца'), h('span', { class: 'muted', id: 'me' }, 'Загрузка…')]),
          h('main', { class: 'wrap' }, [
            h('h1', {}, 'Заказы'),
            h('div', { class: 'card orders-empty', id: 'orders' }, [h('p', { class: 'muted' }, 'Загружаем заказы…')]),
          ]),
        ],
        load: (S) => {
          const init = (src, fn) => ({ src, stack: [[fn, src], ['(anonymous)', 'app.js:12']] });
          S.api({ method: 'GET', path: '/api/me', tag: 'me', init: init('app.js:31', 'loadProfile'), done: (r) => { if (r.ok) S.setText('me', 'Торговец Бруно'); } });
          S.api({
            method: 'GET', path: '/api/orders?page=1&size=20', tag: 'orders', init: init('app.js:88', 'fetchOrders'),
            done: (r) => {
              if (!r.ok) {
                S.setKids('orders', [h('div', { class: 'alert' }, 'Не удалось загрузить заказы. Попробуйте позже.')]);
                S.log('log', '[orders] request failed, showing fallback', 'app.js:93');
              }
            },
          });
          S.api({ method: 'GET', path: '/api/notifications?unread=1', tag: 'notif', init: init('app.js:140', 'pollNotifications') });
          S.api({ method: 'POST', path: '/collect', body: { event: 'page_view', page: '/orders' }, tag: 'collect', init: { src: 'vendor.js:91', stack: [['send', 'vendor.js:91']] } });
        },
      },
    },
    server: {
      'GET /api/me': () => ({ status: 200, body: { id: 18, name: 'Торговец Бруно', role: 'merchant' } }),
      'GET /api/orders': () => ({ status: 500, time: 412, body: { timestamp: '2026-10-11T09:41:07.512Z', status: 500, error: 'Internal Server Error', message: 'could not execute statement; constraint [orders_customer_id_fkey]', path: '/api/orders', traceId: 'a91f3c7e2b' } }),
      'GET /api/notifications': () => ({ status: 200, body: { unread: 2 } }),
      'POST /collect': () => ({ status: 204, body: '' }),
    },
    acts: {},
  };

  /* ---------- 5. Профиль: что ушло в Payload ---------- */
  SCEN.profile = {
    origin: 'https://guild-portal.app', start: '/profile', panel: 'network',
    headers: () => ({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjd9.x8Kq' }),
    files: {},
    pages: {
      '/profile': {
        title: 'Профиль — Портал Гильдии',
        res: ['css/app.css', 'js/vendor.js', 'js/profile.js', 'img/avatar-7.png'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🛡️ Портал Гильдии'), h('span', { class: 'badge' }, 'Ивар')]),
          h('main', { class: 'wrap' }, [
            h('form', { class: 'card form', id: 'profile-form' }, [
              h('h1', {}, 'Профиль'),
              field('Имя', { id: 'name', name: 'name', value: 'Ивар' }),
              field('Телефон', { id: 'phone', type: 'tel', name: 'phone', value: '+7 900 000-00-00' }),
              h('label', { for: 'city' }, ['Город', h('select', { id: 'city', name: 'city', value: 'spb' }, [h('option', { value: 'msk' }, 'Москва'), h('option', { value: 'spb' }, 'Санкт-Петербург'), h('option', { value: 'kzn' }, 'Казань')])]),
              h('button', { class: 'btn', type: 'submit' }, 'Сохранить', { k: 'save', act: 'save' }),
              h('p', { class: 'muted', id: 'saved' }, ''),
            ]),
          ]),
        ],
        load: (S) => {
          S.app.phone0 = '+7 900 000-00-00';
          S.api({ method: 'GET', path: '/api/profile', tag: 'profile-get', init: 'profile.js:12' });
          S.api({ method: 'GET', path: '/api/cities', tag: 'cities', init: 'profile.js:18' });
          S.api({ method: 'GET', path: '/api/notifications?unread=1', tag: 'notif', init: 'vendor.js:140' });
          S.api({ method: 'POST', path: '/api/envelope', body: { sdk: 'sentry.javascript.browser', type: 'session' }, tag: 'sentry', init: 'vendor.js:301' });
        },
      },
    },
    server: {
      'GET /api/profile': () => ({ status: 200, body: { id: 7, name: 'Ивар', phone: '+7 900 000-00-00', city: 'spb' } }),
      'GET /api/cities': () => ({ status: 200, body: ['msk', 'spb', 'kzn'] }),
      'GET /api/notifications': () => ({ status: 200, body: { unread: 0 } }),
      'POST /api/envelope': () => ({ status: 200, body: { id: 'f3a1' } }),
      'PUT /api/profile': (q) => ({ status: 200, body: { ok: true, profile: Object.assign({ id: 7 }, q.body) } }),
    },
    acts: {
      save: (S) => {
        // Баг фронтенда: телефон берётся из исходных данных, а не из поля формы.
        const body = { name: S.val('name'), phone: S.app.phone0, city: S.val('city') };
        const changed = S.val('phone') !== S.app.phone0;
        S.api({
          method: 'PUT', path: '/api/profile', body, tag: 'profile-put', init: { src: 'profile.js:47', stack: [['saveProfile', 'profile.js:47'], ['HTMLFormElement.onSubmit', 'profile.js:60']] },
          done: (r) => { if (r.ok) S.setText('saved', 'Изменения сохранены ✓'); S.act('save', { changed }); },
        });
      },
    },
  };

  /* ---------- 6. Библиотека: гонка запросов на медленной сети ---------- */
  const BOOKS = ['Древние руны', 'Дружина севера', 'Дракон и рыцарь', 'Драконья кузня', 'Дракон-хранитель', 'Драгоценные камни', 'Дремучий лес', 'Драккары викингов', 'Дриады и друиды'];
  SCEN.library = {
    origin: 'https://library.guild.app', start: '/', panel: 'network',
    css: [['.results', 'library.css:10', 'display: grid; gap: 6px']],
    files: {
      'js/search.js': L([
        '// search.js — живой поиск по каталогу библиотеки',
        "const input = document.querySelector('#q');",
        "const results = document.querySelector('.results');",
        '',
        "input.addEventListener('input', () => {",
        '  const q = input.value.trim();',
        '  if (q.length < 2) return;',
        '  search(q);',
        '});',
        '',
        'async function search(q) {',
        '  // нет отмены предыдущего запроса (AbortController)',
        '  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);',
        '  const data = await res.json();',
        '  render(data); // рисуем любой пришедший ответ',
        '}',
      ]),
    },
    pages: {
      '/': {
        title: 'Библиотека Гильдии',
        res: ['css/app.css', 'css/library.css', 'js/search.js'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '📚 Библиотека Гильдии')]),
          h('main', { class: 'wrap' }, [
            h('label', { for: 'q' }, ['Поиск книги', h('input', { id: 'q', type: 'search', placeholder: 'Начни вводить название…', value: '' }, null, { inp: 'search' })]),
            h('p', { class: 'muted', id: 'res-title' }, 'Введи минимум 2 буквы'),
            h('div', { class: 'results card', id: 'results' }, [h('p', { class: 'muted' }, 'Здесь появятся книги')]),
          ]),
        ],
      },
    },
    server: {
      'GET /api/search': (q) => {
        const s = String(q.query.q || '').toLowerCase();
        const total = Math.max(1, 40 - 7 * s.length);
        let pool = BOOKS.filter((b) => b.toLowerCase().startsWith(s.slice(0, 2))).filter((b) => s.length < 4 || b.toLowerCase().includes(s));
        if (!pool.length) pool = ['Дракон и рыцарь'];
        // Широкий запрос — тяжёлый ответ: на медленной сети он приходит позже узкого.
        const items = Array.from({ length: total }, (x, i) => ({ id: 500 + i, title: pool[i % pool.length], annotation: 'Старинный фолиант из хранилища гильдии. '.repeat(9) }));
        return { status: 200, time: 40 + total * 3, body: { query: q.query.q, total, items } };
      },
    },
    acts: {
      search: (S, n) => {
        const q = n.val.trim();
        if (q.length < 2) return;
        S.app.sent = (S.app.sent || 0) + 1;
        S.api({
          method: 'GET', path: '/api/search?q=' + encodeURIComponent(q), tag: 'search', realMax: 2000,
          init: { src: 'search.js:13', stack: [['search', 'search.js:13'], ['HTMLInputElement.<anonymous>', 'search.js:8']] },
          done: (r) => {
            if (!r.ok) return;
            const cur = S.val('q').trim();
            if (r.body.query === cur) S.app.freshShown = true;
            else if (S.app.freshShown) { S.app.race = true; S.act('race', { shown: r.body.query, typed: cur }); }
            S.setText('res-title', `Результаты по запросу «${r.body.query}»: ${r.body.total}`);
            S.setKids('results', [...new Set(r.body.items.map((b) => b.title))].slice(0, 5).map((b) => h('p', { class: 'book' }, '📖 ' + b)));
          },
        });
      },
    },
  };

  /* ---------- 7. Оплата с редиректом: Preserve log ---------- */
  SCEN.pay = {
    origin: 'https://potion-shop.app', start: '/checkout', panel: 'network',
    headers: () => ({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjQ0fQ.pQ2' }),
    files: {},
    pages: {
      '/checkout': {
        title: 'Оплата — Лавка зелий',
        res: ['css/app.css', 'js/vendor.js', 'js/checkout.js'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🧪 Лавка зелий')]),
          h('main', { class: 'wrap' }, [h('div', { class: 'card form' }, [
            h('h1', {}, 'Оплата заказа №7731'),
            h('div', { class: 'row' }, [h('span', {}, 'Зелье маны × 2'), h('b', {}, '1 200 ₽')]),
            h('div', { class: 'row' }, [h('span', {}, 'Доставка'), h('b', {}, '290 ₽')]),
            h('div', { class: 'row' }, [h('span', {}, 'Карта'), h('span', { class: 'muted' }, '•••• 4417')]),
            h('button', { class: 'btn', id: 'pay' }, 'Оплатить 1 490 ₽', { act: 'pay' }),
          ])]),
        ],
        load: (S) => { S.api({ method: 'GET', path: '/api/orders/7731', tag: 'order', init: 'checkout.js:9' }); },
      },
      '/cart': {
        title: 'Корзина — Лавка зелий',
        res: ['css/app.css', 'js/vendor.js', 'js/cart.js'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🧪 Лавка зелий')]),
          h('main', { class: 'wrap' }, [h('div', { class: 'card form' }, [
            h('div', { class: 'alert' }, 'Что-то пошло не так. Попробуйте ещё раз.'),
            h('h1', {}, 'Корзина'),
            h('div', { class: 'row' }, [h('span', {}, 'Зелье маны × 2'), h('b', {}, '1 200 ₽')]),
            h('button', { class: 'btn', id: 'to-pay' }, 'Перейти к оплате', { act: 'toPay' }),
          ])]),
        ],
        load: (S) => { S.api({ method: 'GET', path: '/api/cart', tag: 'cart', init: 'cart.js:5' }); },
      },
    },
    server: {
      'GET /api/orders/:id': () => ({ status: 200, body: { id: 7731, amount: 1490, status: 'awaiting_payment' } }),
      'GET /api/cart': () => ({ status: 200, body: { items: [{ sku: 'mana', qty: 2 }] } }),
      'POST /api/payments': () => ({ status: 402, time: 380, body: { error: { code: 'PAYMENT_DECLINED', reason: 'CARD_EXPIRED', message: 'Срок действия карты истёк' }, orderId: 7731 } }),
    },
    acts: {
      pay: (S) => {
        S.attr('pay', 'disabled', '');
        S.api({
          method: 'POST', path: '/api/payments', body: { orderId: 7731, amount: 1490, card: 'tok_4417_visa' }, tag: 'pay',
          init: { src: 'checkout.js:34', stack: [['payOrder', 'checkout.js:34'], ['HTMLButtonElement.onclick', 'checkout.js:52']] },
          done: () => setTimeout(() => { S.navigate('/cart?payment=failed'); S.act('redirected'); }, 250),
        });
      },
      toPay: (S) => S.navigate('/checkout'),
    },
  };

  /* ---------- 8. Вестник: кэш и Disable cache ---------- */
  SCEN.herald = {
    origin: 'https://herald.guild.app', start: '/', panel: 'network',
    files: {},
    pages: {
      '/': {
        title: 'Вестник Гильдии',
        res: ['css/app.3f9a1c.css', { path: 'js/app.js', cache: 'disk', headers: { 'cache-control': 'public, max-age=31536000' } }, 'img/banner.webp'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '📰 Вестник Гильдии'), h('span', { class: 'badge', id: 'ver' }, '…')]),
          h('main', { class: 'wrap' }, [
            h('div', { class: 'card' }, [h('h2', {}, 'Турнир магов перенесён на субботу'), h('p', { class: 'muted' }, 'Регистрация открыта до пятницы.')]),
            h('div', { class: 'card', id: 'subscribe' }, [h('p', {}, 'Подписка на новости'), h('button', { class: 'btn', id: 'sub-btn' }, 'Подписаться', { act: 'sub' }), h('p', { class: 'muted', id: 'sub-msg' }, '')]),
          ]),
        ],
        load: (S) => {
          const r = S.lastRes['js/app.js'];
          if (r && !r.fromCache) S.app.fresh = true;
          S.app.ver = S.app.fresh ? '1.5.0' : '1.4.0';
          S.setText('ver', 'v' + S.app.ver);
          S.log('info', `Вестник build ${S.app.ver}`, 'app.js:2');
          S.act('version', { ver: S.app.ver });
        },
      },
    },
    server: { 'POST /api/subscribe': () => ({ status: 201, body: { ok: true } }) },
    acts: {
      sub: (S) => {
        if (S.app.ver === '1.4.0') { S.log('error', "Uncaught TypeError: Cannot read properties of undefined (reading 'email')\n    at subscribe (app.js:57:22)", 'app.js:57'); return; }
        S.api({ method: 'POST', path: '/api/subscribe', body: { email: 'mage@guild.app' }, tag: 'sub', init: 'app.js:61', done: () => S.setText('sub-msg', 'Готово! Проверь почту.') });
      },
    },
  };

  /* ---------- 9. Настройки гильдии: disabled на фронте, 403 на бэке ---------- */
  SCEN.guild = {
    origin: 'https://guild-portal.app', start: '/guild/42/settings', panel: 'elements',
    headers: () => ({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjcsInJvbGUiOiJtZW1iZXIifQ.m3m' }),
    css: [['.danger', 'guild.css:14', 'background: #c92a2a'], ['.danger-zone', 'guild.css:20', 'border: 1px solid #f1aeb5']],
    files: {},
    pages: {
      '/guild/42/settings': {
        title: 'Настройки гильдии — Портал Гильдии',
        res: ['css/app.css', 'css/guild.css', 'js/guild.js'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🛡️ Портал Гильдии'), h('span', { class: 'badge' }, 'Ивар · участник')]),
          h('main', { class: 'wrap' }, [
            h('div', { class: 'card' }, [h('h1', {}, 'Гильдия «Северные волки»'), h('p', { class: 'muted' }, '18 участников · глава: Сигрид')]),
            h('div', { class: 'card danger-zone' }, [
              h('h2', {}, 'Опасная зона'),
              h('p', { class: 'muted' }, 'Удалить гильдию может только её глава.'),
              h('button', { class: 'btn danger', id: 'delete-guild', disabled: '', title: 'Только глава гильдии может удалить гильдию' }, 'Удалить гильдию', { act: 'del' }),
              h('p', { class: 'alert', id: 'del-msg', hidden: '' }, ''),
            ]),
          ]),
        ],
      },
    },
    server: { 'DELETE /api/guilds/:id': () => ({ status: 403, body: { error: 'FORBIDDEN', message: 'Недостаточно прав: требуется роль guild_leader' } }) },
    acts: {
      del: (S) => S.confirm('Удалить гильдию «Северные волки» безвозвратно?', () => {
        S.api({
          method: 'DELETE', path: '/api/guilds/42', tag: 'del', init: { src: 'guild.js:28', stack: [['deleteGuild', 'guild.js:28'], ['HTMLButtonElement.onclick', 'guild.js:40']] },
          done: (r) => {
            S.attr('del-msg', 'hidden', null);
            S.setText('del-msg', r.ok ? 'Гильдия удалена' : 'Недостаточно прав');
            S.act('deleted', { status: r.status });
          },
        });
      }),
    },
  };

  /* ---------- 10. Регистрация: валидация только на фронте ---------- */
  SCEN.register = {
    origin: 'https://heroes.guild.app', start: '/register', panel: 'elements',
    files: {},
    pages: {
      '/register': {
        title: 'Регистрация героя',
        res: ['css/app.css', 'js/register.js'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '⚔️ Герои Гильдии')]),
          h('main', { class: 'wrap' }, [h('form', { class: 'card form', id: 'register-form' }, [
            h('h1', {}, 'Новый герой'),
            field('Никнейм (до 16 символов)', { id: 'nickname', name: 'nickname', maxlength: '16', placeholder: 'например, Рагнар', value: '' }),
            field('Email', { id: 'hero-email', type: 'email', name: 'email', value: 'hero@guild.app' }),
            h('button', { class: 'btn', type: 'submit' }, 'Создать героя', { k: 'create', act: 'create' }),
            h('p', { class: 'muted', id: 'reg-msg' }, ''),
          ])]),
        ],
      },
    },
    server: { 'POST /api/heroes': (q) => ({ status: 201, body: { id: 1043, nickname: q.body.nickname, email: q.body.email, createdAt: '2026-10-11T09:44:02Z' } }) },
    acts: {
      create: (S) => {
        const nick = S.val('nickname').trim();
        if (!nick) { S.setText('reg-msg', 'Введите никнейм'); return; }
        S.api({
          method: 'POST', path: '/api/heroes', body: { nickname: nick, email: S.val('hero-email') }, tag: 'hero', init: { src: 'register.js:22', stack: [['createHero', 'register.js:22']] },
          done: (r) => { S.setText('reg-msg', r.ok ? `Герой «${nick}» создан (id ${r.body.id})` : 'Ошибка'); S.act('created', { len: nick.length, status: r.status }); },
        });
      },
    },
  };

  /* ---------- 11. Восстановление пароля: невидимая ошибка ---------- */
  SCEN.restore = {
    origin: 'https://guild-portal.app', start: '/restore', panel: 'elements',
    css: [['.field-error', 'restore.css:9', 'color: #ffffff; font-size: 12px; min-height: 16px']],
    files: {},
    pages: {
      '/restore': {
        title: 'Восстановление пароля',
        res: ['css/app.css', 'css/restore.css', 'js/restore.js'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🛡️ Портал Гильдии')]),
          h('main', { class: 'wrap' }, [h('form', { class: 'card form', id: 'restore-form' }, [
            h('h1', {}, 'Восстановление пароля'),
            field('Email', { id: 'r-email', type: 'email', name: 'email', value: '' }),
            h('span', { class: 'field-error', role: 'alert' }, '', { k: 'err' }),
            h('button', { class: 'btn', type: 'submit' }, 'Отправить ссылку', { k: 'send', act: 'send' }),
          ])]),
        ],
      },
    },
    server: { 'POST /api/restore': () => ({ status: 200, body: { sent: true } }) },
    acts: {
      send: (S) => {
        const v = S.val('r-email').trim();
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) { S.setText('err', 'Введите корректный email'); S.act('invalid'); return; }
        S.setText('err', '');
        S.api({ method: 'POST', path: '/api/restore', body: { email: v }, tag: 'restore', init: 'restore.js:19', done: () => S.act('sent') });
      },
    },
  };

  /* ---------- 12. Меню квестов: баг в :hover ---------- */
  SCEN.quests = {
    origin: 'https://quests.guild.app', start: '/', panel: 'elements',
    css: [
      ['.menu', 'quests.css:3', 'background: #ffffff; border-radius: 8px; padding: 6px'],
      ['.nav-link:hover', 'quests.css:22', 'color: #ffffff; background: #f1f3f9'],
    ],
    files: {},
    pages: {
      '/': {
        title: 'Доска квестов',
        res: ['css/app.css', 'css/quests.css', 'js/quests.js'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '📜 Доска квестов'), h('nav', { class: 'nav menu' }, [
            h('a', { class: 'nav-link', href: '/quests' }, 'Квесты', { k: 'nav1' }),
            h('a', { class: 'nav-link', href: '/rating' }, 'Рейтинг', { k: 'nav2' }),
            h('a', { class: 'nav-link', href: '/tavern' }, 'Таверна', { k: 'nav3' }),
          ])]),
          h('main', { class: 'wrap' }, [
            h('div', { class: 'card' }, [h('h2', {}, 'Победить тролля под мостом'), h('p', { class: 'muted' }, 'Награда: 120 🪙')]),
            h('div', { class: 'card' }, [h('h2', {}, 'Найти потерянный амулет'), h('p', { class: 'muted' }, 'Награда: 80 🪙')]),
          ]),
        ],
      },
    },
    server: {},
    acts: {},
  };

  /* ---------- 13. Лендинг: невидимый оверлей перехватывает клики ---------- */
  SCEN.scrolls = {
    origin: 'https://scrolls.guild.app', start: '/', panel: 'elements',
    css: [
      ['body', 'landing.css:1', 'position: relative'],
      ['.hero', 'landing.css:6', 'text-align: center; display: grid; gap: 8px; justify-items: center'],
      ['.cookie-backdrop', 'landing.css:31', 'position: absolute; inset: 0; background: #000000; opacity: 0; z-index: 50'],
      ['.cookie-banner', 'landing.css:40', 'position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 51'],
    ],
    files: {},
    pages: {
      '/': {
        title: 'Свитки телепортации',
        res: ['css/app.css', 'css/landing.css', 'js/landing.js', 'js/cookie-consent.js'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🌀 Свитки телепортации')]),
          h('main', { class: 'wrap' }, [h('div', { class: 'card hero' }, [
            h('img', { src: '/img/scroll.png', alt: 'Свиток', width: '64', height: '64' }, null, { emoji: '📜' }),
            h('h1', {}, 'Свиток телепортации'),
            h('p', { class: 'price' }, '990 ₽'),
            h('button', { class: 'btn', id: 'buy' }, 'Купить свиток', { act: 'buy', ev: [{ type: 'click', fn: 'addToCart', src: 'landing.js:14' }] }),
            h('p', { class: 'muted', id: 'buy-msg' }, ''),
          ])]),
          h('div', { class: 'cookie-banner card', style: 'display: none;' }, [h('p', {}, 'Мы используем cookie 🍪'), h('button', { class: 'btn ghost' }, 'Принять')], { k: 'banner' }),
          h('div', { class: 'cookie-backdrop' }, null, { k: 'backdrop', act: 'backdrop', box: { w: 1012, h: 330 }, ev: [{ type: 'click', fn: 'stopPropagation', src: 'cookie-consent.js:48' }] }),
        ],
      },
    },
    server: { 'POST /api/cart': () => ({ status: 200, body: { cartId: 'c_19', items: 1 } }) },
    acts: {
      backdrop: (S) => S.act('blocked-click'),
      buy: (S) => S.api({ method: 'POST', path: '/api/cart', body: { sku: 'scroll-teleport', qty: 1 }, tag: 'cart', init: 'landing.js:14', done: () => { S.setText('buy-msg', 'Добавлено в корзину ✓'); S.act('bought'); } }),
    },
  };

  /* ---------- 14. Корзина на мобильном: Device Toolbar и Box model ---------- */
  SCEN.mobile = {
    origin: 'https://potion-shop.app', start: '/cart', panel: 'elements',
    css: [
      ['.cart', 'cart.css:4', 'max-width: 560px'],
      ['.checkout-btn', 'cart.css:27', 'width: 380px; padding: 12px 20px; box-sizing: content-box'],
      ['.wrap', 'cart.css:52', 'padding: 16px'],
    ].map((r, i) => (i === 2 ? r.concat([{ media: 480 }]) : r)),
    files: {},
    pages: {
      '/cart': {
        title: 'Корзина — Лавка зелий',
        res: ['css/app.css', 'css/cart.css', 'js/cart.js'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🧪 Лавка зелий'), h('span', { class: 'badge' }, '🛒 2')]),
          h('main', { class: 'wrap' }, [h('div', { class: 'card cart form' }, [
            h('h1', {}, 'Корзина'),
            h('div', { class: 'row' }, [h('span', {}, '🧪 Зелье маны × 2'), h('b', {}, '1 200 ₽')]),
            h('div', { class: 'row' }, [h('span', {}, '📜 Свиток'), h('b', {}, '800 ₽')]),
            h('div', { class: 'row' }, [h('span', {}, 'Итого'), h('b', {}, '2 000 ₽')]),
            h('button', { class: 'btn checkout-btn' }, 'Оформить заказ', { k: 'checkout', act: 'checkout', box: { h: 18, auto: (v) => Math.min(560, v - 32) - 28 - 40 } }),
          ])]),
        ],
      },
    },
    server: {},
    acts: { checkout: (S) => S.act('checkout') },
  };

  /* ---------- 15. Таверна: роль в localStorage ---------- */
  const USERS = [{ id: 1, name: 'Сигрид', email: 'sigrid@guild.app', role: 'admin' }, { id: 7, name: 'Ивар', email: 'ivar@guild.app', role: 'member' }, { id: 9, name: 'Бруно', email: 'bruno@guild.app', role: 'member' }];
  const roleOf = (S) => { try { return JSON.parse(S.ls.get('user') || '{}').role || 'guest'; } catch (e) { return 'guest'; } };
  SCEN.tavern = {
    origin: 'https://tavern.guild.app', start: '/', panel: 'application',
    local: { user: '{"id":7,"name":"Ивар","role":"member"}', access_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjcsImV4cCI6MTc5MTUwMDAwMH0.T4v3rn', theme: 'light', i18nextLng: 'ru' },
    headers: (S) => ({ authorization: 'Bearer ' + (S.ls.get('access_token') || ''), 'x-user-role': roleOf(S) }),
    files: {},
    pages: {
      '/': {
        title: 'Таверна — личный кабинет',
        res: ['css/app.css', 'js/tavern.js'],
        body: (S) => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🍺 Таверна'), h('nav', { class: 'nav' }, [
            h('a', { class: 'nav-link', href: '/' }, 'Главная'),
            h('a', { class: 'nav-link', href: '/quests' }, 'Квесты'),
            roleOf(S) === 'admin' ? h('a', { class: 'nav-link', href: '/admin', id: 'admin-link' }, '⚙️ Админка', { act: 'admin' }) : null,
          ])]),
          h('main', { class: 'wrap' }, [h('div', { class: 'card' }, [h('h1', {}, 'Привет, Ивар!'), h('p', { class: 'muted' }, ['Роль: ', h('span', { class: 'badge', id: 'role' }, roleOf(S))])])]),
        ],
        load: (S) => { S.api({ method: 'GET', path: '/api/me', tag: 'me', init: 'tavern.js:9' }); S.act('loaded', { role: roleOf(S) }); },
      },
      '/admin': {
        title: 'Админка — Таверна',
        res: ['css/app.css', 'js/tavern.js', 'js/admin.js'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🍺 Таверна · Админка')]),
          h('main', { class: 'wrap' }, [h('div', { class: 'card', id: 'users' }, [h('p', { class: 'muted' }, 'Загрузка пользователей…')])]),
        ],
        load: (S) => {
          S.api({
            method: 'GET', path: '/api/admin/users', tag: 'admin-users', init: { src: 'admin.js:17', stack: [['loadUsers', 'admin.js:17']] },
            done: (r) => {
              if (r.ok) { S.setKids('users', [h('h1', {}, 'Пользователи')].concat(r.body.users.map((u) => h('div', { class: 'row' }, [h('span', {}, u.name), h('span', { class: 'muted' }, u.email), h('span', { class: 'badge' }, u.role)])))); S.act('admin-loaded'); }
              else S.setKids('users', [h('div', { class: 'alert' }, 'Нет доступа')]);
            },
          });
        },
      },
    },
    server: {
      'GET /api/me': () => ({ status: 200, body: { id: 7, name: 'Ивар', role: 'member' } }),
      // Баг бэкенда: права проверяются по заголовку от клиента, а не по токену.
      'GET /api/admin/users': (q) => (q.headers['x-user-role'] === 'admin' ? { status: 200, body: { users: USERS } } : { status: 403, body: { error: 'FORBIDDEN' } }),
    },
    acts: { admin: (S) => { S.navigate('/admin'); S.act('admin-open'); } },
  };

  /* ---------- 16. Банк: флаги cookie ---------- */
  SCEN.bank = {
    origin: 'https://bank.guild.app', start: '/', panel: 'application',
    cookies: [
      { name: 'session_id', value: 's%3A9f2c71d04be1.aGVsbG8', domain: 'bank.guild.app', expires: '2027-10-11T09:40:12.000Z', httpOnly: false, secure: true, sameSite: 'Lax', priority: 'High' },
      { name: 'csrftoken', value: 'Xk29fLq0sPz71aB', domain: 'bank.guild.app', expires: '2027-10-11T09:40:12.000Z', secure: true, sameSite: 'Strict' },
      { name: '_ga', value: 'GA1.1.551203611.1791100000', domain: '.guild.app', expires: '2028-11-15T09:40:12.000Z' },
      { name: 'lang', value: 'ru', domain: 'bank.guild.app' },
    ],
    files: {},
    pages: {
      '/': {
        title: 'Банк Гильдии',
        res: ['css/app.css', 'js/bank.js'],
        body: (S) => (S.cookies.some((c) => c.name === 'session_id')
          ? [h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🏦 Банк Гильдии'), h('span', { class: 'badge' }, 'Ивар')]),
            h('main', { class: 'wrap' }, [h('div', { class: 'card' }, [h('p', { class: 'muted' }, 'Баланс'), h('h1', { id: 'balance' }, '…')]), h('div', { class: 'card' }, [h('p', {}, '− 120 🪙 Таверна «Пьяный гном»'), h('p', {}, '+ 500 🪙 Награда за квест')])])]
          : [h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🏦 Банк Гильдии')]),
            h('main', { class: 'wrap' }, [h('form', { class: 'card form' }, [h('div', { class: 'alert' }, 'Сессия истекла. Войдите снова.'), field('Логин', { id: 'b-login', value: '' }), h('button', { class: 'btn' }, 'Войти')])])]),
        load: (S) => {
          if (!S.cookies.some((c) => c.name === 'session_id')) { S.act('logged-out'); return; }
          S.api({ method: 'GET', path: '/api/balance', tag: 'balance', init: 'bank.js:12', done: (r) => { if (r.ok) S.setText('balance', r.body.balance + ' 🪙'); } });
        },
      },
    },
    server: { 'GET /api/balance': (q) => (/session_id=/.test(q.headers.cookie || '') ? { status: 200, body: { balance: 1250, currency: 'GLD' } } : { status: 401, body: { error: 'UNAUTHORIZED' } }) },
    acts: {},
  };

  /* ---------- 17. Лавка: фичефлаг в sessionStorage, Clear site data ---------- */
  SCEN.flags = {
    origin: 'https://potion-shop.app', start: '/', panel: 'application',
    local: { onboarding_done: 'true', cart: '[{"sku":"mana","qty":2}]', i18nextLng: 'ru' },
    session: { ff_new_checkout: 'false', utm_source: 'newsletter' },
    cookies: [{ name: 'sid', value: 'p7Qx0', domain: 'potion-shop.app', httpOnly: true, secure: true, sameSite: 'Lax' }],
    css: [['.onboarding', 'home.css:40', 'border: 2px solid #7c5cff']],
    files: {},
    pages: {
      '/': {
        title: 'Лавка зелий',
        res: ['css/app.css', 'js/vendor.js', 'js/home.js'],
        body: (S) => {
          const newCo = S.ss.get('ff_new_checkout') === 'true';
          const onb = S.ls.get('onboarding_done') !== 'true';
          return [
            h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🧪 Лавка зелий'), h('span', { class: 'badge' }, '🛒 ' + (S.ls.has('cart') ? 2 : 0))]),
            h('main', { class: 'wrap' }, [
              onb ? h('div', { class: 'card onboarding', id: 'onboarding' }, [h('h2', {}, '👋 Добро пожаловать в Лавку!'), h('p', { class: 'muted' }, 'Шаг 1 из 3: выбери любимую категорию зелий.')]) : null,
              h('div', { class: 'card' }, [h('h1', {}, 'Корзина'), h('p', { class: 'muted' }, 'Зелье маны × 2 — 1 200 ₽'),
                h('button', { class: 'btn', id: 'checkout' }, newCo ? '⚡ Купить в 1 клик' : 'Оформить заказ')]),
            ]),
          ];
        },
        load: (S) => S.act('loaded', { newCheckout: S.ss.get('ff_new_checkout') === 'true', onboarding: S.ls.get('onboarding_done') !== 'true' }),
      },
    },
    server: {},
    acts: {},
  };

  /* ---------- 18. Корзина: отладка в Sources ---------- */
  SCEN.debug = {
    origin: 'https://potion-shop.app', start: '/cart', panel: 'elements',
    files: {
      'js/cart.js': L([
        '// cart.js — корзина и промокоды',
        "import { api } from './api.js';",
        "import { renderTotals } from './render.js';",
        '',
        'export function calcSubtotal(items) {',
        '  return items.reduce((sum, it) => sum + it.price * it.qty, 0);',
        '}',
        '',
        'export async function applyPromo(code) {',
        '  const promo = await api.get(`/api/promo/${code}`);',
        '  const subtotal = calcSubtotal(cart.items);',
        '  const discount = promo.value;',
        '  const total = subtotal - discount;',
        '  renderTotals({ subtotal, discount, total });',
        "  analytics.track('promo_applied', { code });",
        '}',
      ]),
      'js/render.js': L([
        '// render.js — вывод сумм',
        "const fmt = (n) => n.toLocaleString('ru-RU') + ' ₽';",
        '',
        'export function renderTotals({ subtotal, discount, total }) {',
        "  document.querySelector('#subtotal').textContent = fmt(subtotal);",
        "  document.querySelector('#discount').textContent = '−' + fmt(discount);",
        "  document.querySelector('#total').textContent = fmt(total);",
        '}',
      ]),
    },
    pages: {
      '/cart': {
        title: 'Корзина — Лавка зелий',
        res: ['css/app.css', 'js/vendor.js', 'js/cart.js', 'js/render.js'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🧪 Лавка зелий')]),
          h('main', { class: 'wrap' }, [h('div', { class: 'card form' }, [
            h('h1', {}, 'Корзина'),
            h('div', { class: 'row' }, [h('span', {}, '🧪 Зелье маны × 2'), h('b', {}, '1 200 ₽')]),
            h('div', { class: 'row' }, [h('span', {}, '📜 Свиток'), h('b', {}, '800 ₽')]),
            h('label', { for: 'promo' }, ['Промокод', h('input', { id: 'promo', value: 'MAGIC15' }, null, { enter: 'promo' })]),
            h('button', { class: 'btn ghost', id: 'apply' }, 'Применить', { act: 'promo', ev: [{ type: 'click', fn: 'onApplyClick', src: 'cart.js:10' }] }),
            h('div', { class: 'row' }, [h('span', {}, 'Сумма'), h('b', { id: 'subtotal' }, '2 000 ₽')]),
            h('div', { class: 'row' }, [h('span', {}, 'Скидка'), h('b', { id: 'discount' }, '—')]),
            h('div', { class: 'row' }, [h('span', {}, 'Итого'), h('b', { id: 'total' }, '2 000 ₽')]),
          ])]),
        ],
      },
    },
    server: {
      'GET /api/promo/:code': (q) => (q.params.code.toUpperCase() === 'MAGIC15' ? { status: 200, body: { code: 'MAGIC15', type: 'percent', value: 15 } } : { status: 404, body: { error: 'PROMO_NOT_FOUND' } }),
    },
    acts: {
      promo: (S) => {
        const code = S.val('promo').trim();
        S.api({
          method: 'GET', path: '/api/promo/' + encodeURIComponent(code), tag: 'promo', init: { src: 'cart.js:10', stack: [['applyPromo', 'cart.js:10']] },
          done: (r) => {
            if (!r.ok) { S.setText('discount', 'промокод не найден'); return; }
            const promo = r.body;
            const items = [{ sku: 'mana', price: 600, qty: 2 }, { sku: 'scroll', price: 800, qty: 1 }];
            const base0 = { code, promo };
            const tr = [
              { line: 11, fn: 'applyPromo', scope: Object.assign({}, base0, { subtotal: undefined, discount: undefined, total: undefined }) },
              { line: 12, fn: 'applyPromo', scope: Object.assign({}, base0, { subtotal: 2000, discount: undefined, total: undefined }) },
              { line: 13, fn: 'applyPromo', scope: Object.assign({}, base0, { subtotal: 2000, discount: 15, total: undefined }) },
              { line: 14, fn: 'applyPromo', scope: Object.assign({}, base0, { subtotal: 2000, discount: 15, total: 1985 }) },
              { line: 15, fn: 'applyPromo', scope: Object.assign({}, base0, { subtotal: 2000, discount: 15, total: 1985 }) },
            ];
            S.app.items = items;
            S.exec('js/cart.js', tr, () => {
              S.setText('subtotal', '2 000 ₽');
              S.setText('discount', '−15 ₽');
              S.setText('total', '1 985 ₽');
              S.act('promo-applied');
            }, [['HTMLButtonElement.onApplyClick', 'cart.js:10']]);
          },
        });
      },
    },
  };

  /* ---------- 19. Карточка товара: блокировка запроса ---------- */
  SCEN.product = {
    origin: 'https://potion-shop.app', start: '/product/17', panel: 'network',
    files: {},
    pages: {
      '/product/17': {
        title: 'Эликсир силы — Лавка зелий',
        res: ['css/app.css', 'js/vendor.js', 'js/product.js', 'img/elixir.png'],
        body: () => [
          h('div', { id: 'root' }, [
            h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🧪 Лавка зелий')]),
            h('main', { class: 'wrap' }, [
              h('div', { class: 'card hero' }, [h('img', { src: '/img/elixir.png', alt: 'Эликсир' }, null, { emoji: '⚗️' }), h('h1', {}, 'Эликсир силы'), h('p', { class: 'price' }, '1 450 ₽'), h('button', { class: 'btn' }, 'В корзину')]),
              h('section', { class: 'card', id: 'recs' }, [h('h2', {}, 'Вам может понравиться'), h('p', { class: 'muted' }, 'Загрузка…')]),
            ]),
          ]),
        ],
        load: (S) => {
          S.api({
            method: 'GET', path: '/api/recommendations?product=17', tag: 'recs', init: { src: 'product.js:66', stack: [['loadRecs', 'product.js:66'], ['mountProduct', 'product.js:41']] },
            done: (r) => {
              if (r.ok) {
                S.setKids('recs', [h('h2', {}, 'Вам может понравиться')].concat(r.body.items.map((x) => h('p', {}, '⭐ ' + x.name))));
                if (S.app.crashed) { S.app.crashed = false; S.act('recovered'); }
                return;
              }
              // Фронт не обрабатывает ошибку виджета — падает всё приложение.
              S.setKids('root', []);
              S.log('error', "Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'map')\n    at renderRecs (product.js:73:28)\n    at loadRecs (product.js:68:5)", 'product.js:73');
              S.log('error', 'The above error occurred in the <Recommendations> component. Consider adding an error boundary to your tree.', 'vendor.js:1204');
              S.app.crashed = true;
              S.act('crashed');
            },
          });
        },
      },
    },
    server: { 'GET /api/recommendations': () => ({ status: 200, body: { items: [{ id: 21, name: 'Зелье выносливости' }, { id: 22, name: 'Перчатки силача' }] } }) },
    acts: {},
  };

  /* ---------- 20. Оформление заказа: комплексное расследование ---------- */
  SCEN.checkout = {
    origin: 'https://potion-shop.app', start: '/checkout', panel: 'elements',
    headers: () => ({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjQ0fQ.pQ2' }),
    files: {
      'js/checkout.js': L([
        '// checkout.js — новое оформление заказа',
        "import { api } from './api.js';",
        '',
        "const btn = document.querySelector('#confirm-order');",
        '',
        'function orderPayload() {',
        '  return { cartId: 991, items: [{ sku: "mana", qty: 2 }, { sku: "scroll", qty: 1 }], amount: 2380 };',
        '}',
        '',
        'export function initCheckout() {',
        "  btn.addEventListener('click', handleSubmit);",
        '}',
        '',
        'function showDone(order) {',
        "  document.querySelector('#result').textContent = `Заказ №${order.orderId} оформлен`;",
        '}',
        '',
        'async function handleSubmit() {',
        '  btn.disabled = true;',
        "  const order = await api.post('/api/orders', orderPayload());",
        '  showDone(order);',
        '}',
      ]),
      'js/legacy-checkout.js': L([
        '// legacy-checkout.js — старое оформление (должно было быть удалено)',
        "console.log('[legacy-checkout] v0.9 init');",
        '',
        "const button = document.querySelector('#confirm-order');",
        "button.addEventListener('click', onConfirm);",
        '',
        'function onConfirm() {',
        "  const payload = JSON.parse(localStorage.getItem('checkout_draft'));",
        '  sendOrder(payload);',
        '}',
        '',
        "function sendOrder(p) { return fetch('/api/orders', { method: 'POST', body: JSON.stringify(p) }); }",
      ]),
    },
    local: { checkout_draft: '{"cartId":991,"items":[{"sku":"mana","qty":2},{"sku":"scroll","qty":1}],"amount":2380}' },
    pages: {
      '/checkout': {
        title: 'Оформление заказа — Лавка зелий',
        res: ['css/app.css', 'js/vendor.js', 'js/checkout.js', 'js/legacy-checkout.js'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🧪 Лавка зелий')]),
          h('main', { class: 'wrap' }, [h('div', { class: 'card form' }, [
            h('h1', {}, 'Оформление заказа'),
            h('div', { class: 'row' }, [h('span', {}, 'Зелье маны × 2'), h('b', {}, '1 200 ₽')]),
            h('div', { class: 'row' }, [h('span', {}, 'Свиток'), h('b', {}, '800 ₽')]),
            h('div', { class: 'row' }, [h('span', {}, 'Доставка'), h('b', {}, '380 ₽')]),
            h('button', { class: 'btn', id: 'confirm-order' }, 'Подтвердить заказ · 2 380 ₽', { act: 'order', ev: [{ type: 'click', fn: 'handleSubmit', src: 'checkout.js:11' }, { type: 'click', fn: 'onConfirm', src: 'legacy-checkout.js:5' }] }),
            h('p', { class: 'muted', id: 'result' }, ''),
          ])]),
        ],
        load: (S) => {
          S.log('log', '[legacy-checkout] v0.9 init', 'legacy-checkout.js:2');
          S.log('warn', '[Deprecation] legacy-checkout.js: модуль помечен на удаление с версии 4.0', 'legacy-checkout.js:2');
        },
      },
    },
    server: {
      'POST /api/orders': (q, S) => {
        S.app.orderSeq = (S.app.orderSeq || 5000) + 1;
        return { status: 201, time: 180, body: { orderId: S.app.orderSeq, status: 'created', amount: (q.body && q.body.amount) || 2380 } };
      },
    },
    acts: {
      order: (S) => {
        if (S.app.ordering) return;
        S.app.ordering = true;
        S.attr('confirm-order', 'disabled', '');
        const body = { cartId: 991, items: [{ sku: 'mana', qty: 2 }, { sku: 'scroll', qty: 1 }], amount: 2380 };
        let left = 2;
        const fin = (r) => { if (r.ok && r.body.orderId) S.setText('result', `Заказ №${r.body.orderId} оформлен`); if (--left === 0) S.act('ordered'); };
        S.api({ method: 'POST', path: '/api/orders', body, tag: 'order', init: { src: 'checkout.js:20', stack: [['handleSubmit', 'checkout.js:20'], ['HTMLButtonElement.handleSubmit', 'checkout.js:11']] }, done: fin });
        S.api({ method: 'POST', path: '/api/orders', body, tag: 'order', init: { src: 'legacy-checkout.js:12', stack: [['sendOrder', 'legacy-checkout.js:12'], ['onConfirm', 'legacy-checkout.js:9'], ['HTMLButtonElement.onConfirm', 'legacy-checkout.js:5']] }, done: fin });
      },
    },
  };

  /* ---------- 21. Избранное: «кнопка не работает» — ошибка в Console ---------- */
  SCEN.favorites = {
    origin: 'https://potion-shop.app', start: '/product/23', panel: 'elements',
    files: {
      'js/favorites.js': L([
        '// favorites.js — кнопка «В избранное» на карточке товара',
        "import { api } from './api.js';",
        '',
        "const btn = document.querySelector('#fav-btn');",
        '',
        "btn.addEventListener('click', toggleFavorite);",
        '',
        'async function toggleFavorite() {',
        '  const productId = Number(btn.dataset.id);',
        "  await api.post('/api/favorites', { productId });",
        "  track('favorite_add', { productId });",
        '  // обновляем счётчик в шапке',
        "  const counter = document.querySelector('#fav-counter');",
        '  counter.textContent = Number(counter.textContent) + 1;',
        "  btn.textContent = '♥ В избранном';",
        "  btn.classList.add('active');",
        '}',
      ]),
    },
    pages: {
      '/product/23': {
        title: 'Зелье ночного зрения — Лавка зелий',
        res: ['css/app.css', 'js/vendor.js', 'js/favorites.js', 'img/night-vision.png'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🧪 Лавка зелий'), h('span', { class: 'badge' }, ['♥ Избранное: ', h('b', { id: 'fav-count' }, '2')])]),
          h('main', { class: 'wrap' }, [h('div', { class: 'card hero' }, [
            h('img', { src: '/img/night-vision.png', alt: 'Зелье ночного зрения', width: '64', height: '64' }, null, { emoji: '🌙' }),
            h('h1', {}, 'Зелье ночного зрения'),
            h('p', { class: 'price' }, '720 ₽'),
            h('button', { class: 'btn ghost', id: 'fav-btn', 'data-id': '23' }, '♡ В избранное', { act: 'fav', ev: [{ type: 'click', fn: 'toggleFavorite', src: 'favorites.js:6' }] }),
          ])]),
        ],
        load: (S) => { S.log('info', 'Лавка зелий build 3.2.0', 'vendor.js:14'); },
      },
    },
    server: { 'POST /api/favorites': (q) => ({ status: 201, body: { productId: q.body && q.body.productId, favorites: 3 } }) },
    acts: {
      fav: (S) => S.api({
        method: 'POST', path: '/api/favorites', body: { productId: 23 }, tag: 'fav', init: { src: 'favorites.js:10', stack: [['toggleFavorite', 'favorites.js:10'], ['HTMLButtonElement.toggleFavorite', 'favorites.js:6']] },
        done: () => {
          // Запрос прошёл, а код упал на обновлении счётчика: кнопка «не реагирует».
          S.log('error', "Uncaught (in promise) TypeError: Cannot read properties of null (reading 'textContent')\n    at toggleFavorite (favorites.js:14:40)", 'favorites.js:14');
          S.act('fav-click');
        },
      }),
    },
  };

  /* ---------- 22. Запись на турнир: 422, Response и Payload ---------- */
  SCEN.tournament = {
    origin: 'https://arena.guild.app', start: '/signup', panel: 'elements',
    headers: () => ({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjd9.x8Kq' }),
    files: {},
    pages: {
      '/signup': {
        title: 'Запись на турнир — Арена Гильдии',
        res: ['css/app.css', 'js/vendor.js', 'js/signup.js'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🏟️ Арена Гильдии')]),
          h('main', { class: 'wrap' }, [h('form', { class: 'card form', id: 'signup-form' }, [
            h('h1', {}, 'Осенний кубок: запись'),
            field('Имя героя', { id: 't-name', name: 'heroName', value: 'Ивар' }),
            field('Дата рождения', { id: 't-birth', name: 'birthDate', placeholder: 'ДД.ММ.ГГГГ', value: '21.10.1998' }),
            field('Email', { id: 't-email', type: 'email', name: 'email', value: 'ivar@guild.app' }),
            h('button', { class: 'btn', type: 'submit' }, 'Записаться', { k: 'signup', act: 'signup' }),
            h('p', { class: 'alert', id: 't-msg', hidden: '' }, ''),
          ])]),
        ],
      },
    },
    server: {
      'POST /api/tournaments/:id/registrations': (q) => (/^\d{4}-\d{2}-\d{2}$/.test(String(q.body.birthDate || '').trim())
        ? { status: 201, body: { registrationId: 'reg_3307', tournament: q.params.id, status: 'confirmed' } }
        : { status: 422, time: 140, body: { error: 'VALIDATION_ERROR', message: 'Request validation failed', fields: [{ field: 'birthDate', code: 'INVALID_FORMAT', message: 'Ожидается дата в формате YYYY-MM-DD', rejected: q.body.birthDate }] } }),
    },
    acts: {
      signup: (S) => {
        const body = { heroName: S.val('t-name'), birthDate: S.val('t-birth'), email: S.val('t-email'), tournament: 'autumn-cup' };
        S.api({
          method: 'POST', path: '/api/tournaments/autumn-cup/registrations', body, tag: 'signup',
          init: { src: 'signup.js:27', stack: [['submitSignup', 'signup.js:27'], ['HTMLFormElement.onSubmit', 'signup.js:40']] },
          done: (r) => {
            S.attr('t-msg', 'hidden', null);
            if (r.ok) { S.attr('t-msg', 'class', 'alert ok'); S.setText('t-msg', 'Вы записаны на турнир ✓'); S.act('signup-ok'); }
            else { S.attr('t-msg', 'class', 'alert'); S.setText('t-msg', 'Что-то пошло не так. Попробуйте позже.'); S.act('signup-failed', { status: r.status }); }
          },
        });
      },
    },
  };

  /* ---------- 23. Выход из аккаунта: localStorage и HttpOnly-cookie ---------- */
  const OLD_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjcsImlhdCI6MTc5MTEwMDAwMH0.a1Old';
  const NEW_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjcsImlhdCI6MTc5MTEwMzYwMH0.R2new';
  const cabinetView = () => [h('div', { class: 'card' }, [
    h('h1', {}, 'Личный кабинет'),
    h('p', { class: 'muted' }, 'Ивар · торговец · 1 250 🪙'),
    h('button', { class: 'btn ghost', id: 'logout' }, 'Выйти', { act: 'logout' }),
  ])];
  const signedOutView = () => [h('div', { class: 'card form' }, [
    h('div', { class: 'alert ok' }, 'Вы вышли из аккаунта'),
    h('h1', {}, 'Вход'),
    field('Email', { id: 'l-email', type: 'email', value: '' }),
    h('button', { class: 'btn' }, 'Войти'),
  ])];
  // Экран входа при монтировании пытается «тихо» продлить сессию по refresh-cookie.
  function silentRefresh(S) {
    S.api({
      method: 'POST', path: '/api/auth/refresh', tag: 'refresh', init: { src: 'auth.js:31', stack: [['silentRefresh', 'auth.js:31'], ['onLoginScreenMount', 'auth.js:12']] },
      done: (r) => {
        if (r.ok) { S.ls.set('token', r.body.access_token); S.ls.set('user', '{"id":7,"name":"Ивар"}'); S.setKids('main', cabinetView()); S.act('auto-login'); }
        else S.act('stay-out');
      },
    });
  }
  SCEN.logout = {
    origin: 'https://market.guild.app', start: '/', panel: 'network',
    local: { token: OLD_TOKEN, user: '{"id":7,"name":"Ивар"}', theme: 'dark' },
    cookies: [
      { name: 'refresh_token', value: 'rt_8f31c0a9e2d74b1f', domain: 'market.guild.app', expires: '2026-11-20T09:40:12.000Z', httpOnly: true, secure: true, sameSite: 'Strict', priority: 'High' },
      { name: '_ga', value: 'GA1.1.551203611.1791100000', domain: '.guild.app', expires: '2028-11-15T09:40:12.000Z' },
      { name: 'lang', value: 'ru', domain: 'market.guild.app' },
    ],
    headers: (S) => (S.ls.has('token') ? { authorization: 'Bearer ' + S.ls.get('token') } : {}),
    files: {},
    pages: {
      '/': {
        title: 'Рынок Гильдии — кабинет',
        res: ['css/app.css', 'js/vendor.js', 'js/auth.js', 'js/cabinet.js'],
        body: (S) => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '⚖️ Рынок Гильдии')]),
          h('main', { class: 'wrap' }, S.ls.has('token') ? cabinetView() : signedOutView(), { k: 'main' }),
        ],
        load: (S) => {
          if (S.ls.has('token')) S.api({ method: 'GET', path: '/api/me', tag: 'me', init: 'cabinet.js:9' });
          else silentRefresh(S);
        },
      },
    },
    server: {
      'GET /api/me': () => ({ status: 200, body: { id: 7, name: 'Ивар', role: 'merchant', balance: 1250 } }),
      // Баг бэкенда: logout не отзывает refresh-токен и не стирает cookie.
      'POST /api/logout': () => ({ status: 204, body: '' }),
      'POST /api/auth/refresh': (q) => (/refresh_token=/.test(q.headers.cookie || '')
        ? { status: 200, body: { access_token: NEW_TOKEN, token_type: 'Bearer', expires_in: 900 } }
        : { status: 401, body: { error: 'NO_REFRESH_TOKEN', message: 'Refresh token is missing' } }),
    },
    acts: {
      logout: (S) => {
        if (S.app.busy) return;
        S.app.busy = true;
        S.api({
          method: 'POST', path: '/api/logout', tag: 'logout', init: { src: 'auth.js:48', stack: [['logout', 'auth.js:48'], ['HTMLButtonElement.onclick', 'cabinet.js:22']] },
          done: () => {
            S.ls.delete('token');
            S.ls.delete('user');
            S.setKids('main', signedOutView());
            S.app.busy = false;
            S.act('logout');
            silentRefresh(S);
          },
        });
      },
    },
  };

  /* ---------- 24. Мои заказы: пустое состояние вместо загрузки на Slow 3G ---------- */
  SCEN.history = {
    origin: 'https://potion-shop.app', start: '/orders', panel: 'network',
    headers: () => ({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjQ0fQ.pQ2' }),
    files: {},
    pages: {
      '/orders': {
        title: 'Мои заказы — Лавка зелий',
        res: ['css/app.css', 'js/vendor.js', 'js/orders.js'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🧪 Лавка зелий'), h('span', { class: 'badge' }, 'Ивар')]),
          h('main', { class: 'wrap' }, [
            h('h1', {}, 'Мои заказы'),
            // Баг фронта: до ответа сервера рисуется пустой список, индикатора загрузки нет.
            h('div', { class: 'card form', id: 'orders-list' }, [h('p', { class: 'muted', id: 'empty' }, '🙁 У вас пока нет заказов'), h('button', { class: 'btn ghost' }, 'Перейти в каталог')]),
          ]),
        ],
        load: (S) => {
          S.api({
            method: 'GET', path: '/api/orders/history?page=1', tag: 'history',
            init: { src: 'orders.js:18', stack: [['loadOrders', 'orders.js:18'], ['mountOrders', 'orders.js:7']] },
            done: (r) => {
              if (!r.ok) return;
              S.setKids('orders-list', r.body.items.map((o) => h('div', { class: 'row' }, [h('span', {}, `№${o.id} · ${o.date}`), h('span', { class: 'badge' }, o.status), h('b', {}, o.total)])));
              S.act(r.req.time >= 1000 ? 'slow-load' : 'fast-load', { time: Math.round(r.req.time) });
            },
          });
        },
      },
    },
    server: {
      'GET /api/orders/history': () => ({ status: 200, time: 120, body: { total: 3, items: [
        { id: 7731, date: '2 октября', status: 'доставлен', total: '1 490 ₽' },
        { id: 7518, date: '14 сентября', status: 'доставлен', total: '2 380 ₽' },
        { id: 7302, date: '29 августа', status: 'отменён', total: '650 ₽' },
      ] } }),
    },
    acts: {},
  };

  /* ---------- 25. Отзыв без сети: Offline и Replay XHR ---------- */
  SCEN.review = {
    origin: 'https://potion-shop.app', start: '/reviews/new', panel: 'network',
    headers: () => ({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjQ0fQ.pQ2' }),
    files: {},
    pages: {
      '/reviews/new': {
        title: 'Новый отзыв — Лавка зелий',
        res: ['css/app.css', 'js/vendor.js', 'js/review.js'],
        body: () => [
          h('header', { class: 'top' }, [h('span', { class: 'logo' }, '🧪 Лавка зелий')]),
          h('main', { class: 'wrap' }, [h('form', { class: 'card form', id: 'review-form' }, [
            h('h1', {}, 'Отзыв: Эликсир силы'),
            h('label', { for: 'rev-rating' }, ['Оценка', h('select', { id: 'rev-rating', value: '5' }, ['5', '4', '3', '2', '1'].map((v) => h('option', { value: v }, '★'.repeat(+v))))]),
            field('Отзыв', { id: 'rev-text', placeholder: 'Пара слов о зелье', value: '' }),
            h('button', { class: 'btn', id: 'rev-send' }, 'Отправить отзыв', { act: 'send' }),
            h('p', { class: 'muted', id: 'rev-msg' }, ''),
          ])]),
        ],
      },
    },
    server: { 'POST /api/reviews': (q) => ({ status: 201, body: { id: 'rv_9120', productId: 17, rating: q.body.rating, status: 'published' } }) },
    acts: {
      send: (S) => {
        const text = S.val('rev-text').trim();
        if (!text) { S.setText('rev-msg', 'Напиши хотя бы пару слов'); return; }
        if (S.app.sending) return;
        S.app.sending = true;
        S.setText('rev-send', 'Отправка…');
        S.attr('rev-send', 'disabled', '');
        S.setText('rev-msg', '');
        S.api({
          method: 'POST', path: '/api/reviews', body: { productId: 17, rating: Number(S.val('rev-rating')) || 5, text }, tag: 'review',
          init: { src: 'review.js:21', stack: [['sendReview', 'review.js:21'], ['HTMLButtonElement.onclick', 'review.js:34']] },
          onReplay: (S2, res) => { if (res.ok) S2.setText('rev-msg', 'Отзыв опубликован (повтор запроса) ✓'); },
          done: (r) => {
            if (r.ok) {
              S.app.sending = false;
              S.setText('rev-send', 'Отправить отзыв');
              S.attr('rev-send', 'disabled', null);
              S.setText('rev-msg', 'Спасибо! Отзыв опубликован ✓');
              S.act('sent');
              return;
            }
            // Баг фронта: сетевую ошибку никто не ловит — кнопка навсегда остаётся в «Отправка…».
            S.log('error', 'Uncaught (in promise) TypeError: Failed to fetch\n    at sendReview (review.js:21:21)', 'review.js:21');
            S.act('send-failed', { failed: r.failed });
          },
        });
      },
    },
  };

  /* ======================= Уровни ======================= */
  const has =(c, type, f) => c.log.some((e) => e.type === type && (!f || f(e)));
  const app = (c, name, f) => has(c, 'app', (e) => e.name === name && (!f || f(e)));
  // Сейчас в Network выбран запрос с меткой tag и открыта вкладка tab.
  const viewing = (c, tag, tab) => {
    const r = c.state.selReq && c.state.selReq();
    return !!r && r.tag === tag && c.state.netTab === tab && c.state.panel === 'network';
  };
  const declOf = (c, sel, p) => { const r = c.state.css.find((x) => x.sel === sel); return r && r.decls.find((d) => d.p === p); };
  const GOLD = [80, 90, 100, 105, 115, 125, 135, 145, 150, 160, 170, 180, 185, 195, 205, 215, 225, 230, 240, 250, 255, 260, 270, 280, 290];
  const G = (i) => GOLD[i - 1];

  const LEVELS = [
    {
      id: 'dt-1', setup: 'login', title: 'Ошибка в ответе со статусом 200',
      giver: { name: 'Призрак консоли', sprite: '👻' }, gold: G(1),
      outro: 'В баг-репорт идут три факта: статус и URL запроса, тело ответа и ошибка из Console.',
      steps: [
        { id: 'console', text: 'Нажми <b>«Войти»</b> на странице и открой вкладку <b>Console</b>. Что там появилось?',
          check: (c) => app(c, 'login') && c.state.panel === 'console',
          success: 'В Console ошибка: TypeError при чтении token в login.js:42. Фронтенд упал, но почему?' },
        { id: 'net', text: 'Открой <b>Network</b> и выбери запрос авторизации, который ушёл после нажатия кнопки.',
          check: (c) => has(c, 'net-select', (e) => e.tag === 'login'),
          success: 'Это POST /api/login. Статус 200 OK — вроде бы всё хорошо?' },
        { id: 'resp', text: 'Посмотри, что сервер ответил на самом деле: вкладка <b>Response</b> (или <b>Preview</b>) у этого запроса.',
          check: (c) => viewing(c, 'login', 'response') || viewing(c, 'login', 'preview'),
          success: 'В ответе data: null и ошибка INVALID_EMAIL. Сервер вернул ошибку, но со статусом 200.' },
        { id: 'cause', text: 'Сформулируй причину для баг-репорта. Что на самом деле происходит?',
          answer: {
            kind: 'choice',
            options: [
              'Сервер упал с ошибкой 500, и вход недоступен.',
              'Сервер вернул ошибку валидации email со статусом 200, а фронтенд не обработал её и упал на чтении token.',
              'Кнопка «Войти» заблокирована атрибутом disabled.',
              'В браузере не загрузился файл login.js.',
            ],
            accept: (v) => v === 1,
            wrong: 'Сверь с фактами: какой статус в Network, что в Response и что в Console?',
          },
          success: 'Точно. Здесь два бага: сервер отдаёт ошибку со статусом 200 вместо 400, а фронтенд не показывает пользователю ошибку валидации.' },
        { id: 'style', text: 'На странице есть ссылка <b>«Забыли пароль?»</b>, но её не видно. Найди её в <b>Elements</b> и отключи мешающий стиль в <b>Styles</b>.',
          check: (c) => c.state.isVisible('forgot'),
          success: 'Ссылка появилась. Так проверяют гипотезы о вёрстке прямо в браузере, не трогая код.' },
      ],
      hints: [
        'Сначала воспроизведи баг (нажми «Войти»), потом смотри Console и Network: ошибки и запросы появляются в момент действия.',
        'В Network нужен запрос <code>login</code> с методом POST. У выбранного запроса есть вкладки Headers, Payload, Preview, Response. Ссылка в Elements — узел <code>a.forgot-link</code>, её стили справа в Styles.',
        'Console → Network → строка POST <code>login</code> → вкладка Response → в ответе ошибка при статусе 200 → второй вариант. Затем Elements → <code>&lt;a class="forgot-link"…&gt;</code> → в <code>element.style</code> сними галочку у <code>display: none</code>.',
      ],
    },
    {
      id: 'dt-2', setup: 'catalog', title: 'Console: уровни логов и стек ошибки',
      giver: { name: 'Алхимик Мира', sprite: '⚗️' }, gold: G(2),
      outro: 'Шум из логов аналитики и предупреждений прячет главное — фильтр уровней экономит минуты на каждом баге.',
      steps: [
        { id: 'levels', text: 'В каталоге 4 зелья, а на витрине два. В <b>Console</b> много шума: в списке <b>Default levels</b> оставь только <b>Errors</b>.',
          check: (c) => { const l = c.state.conLevels; return c.state.panel === 'console' && l.error && !l.warn && !l.info && !l.verbose; },
          success: 'Остались только ошибки: TypeError и 404 на картинку.' },
        { id: 'src', text: 'Кликни по ссылке на источник у <b>TypeError</b> (справа в строке), чтобы открыть код в Sources.',
          check: (c) => has(c, 'src-open', (e) => e.file === 'catalog.js'),
          success: 'Строка 57: <code>item.offer.price</code>. Стек показывает цепочку: loadCatalog → renderCatalog → renderCard.' },
        { id: 'what', text: 'Что сломало витрину?',
          answer: {
            kind: 'choice',
            options: [
              'Сервер вернул 500 на список товаров.',
              'renderCard читает price у undefined: у одного из товаров нет поля offer, и отрисовка обрывается на нём.',
              'Не загрузился catalog.js, поэтому витрина пустая.',
              'Ошибку вызвало предупреждение о DOMNodeInserted.',
            ],
            accept: (v) => v === 1,
            wrong: 'Прочитай текст ошибки: «Cannot read properties of undefined (reading \'price\')» и строку кода, на которую она указывает.',
          },
          success: 'Верно. Хороший баг-репорт: «у товара без offer витрина падает» + ответ /api/products + стек из Console.' },
        { id: '404', text: 'Вторая ошибка — <b>404</b> на картинку. Впиши имя файла, который не загрузился.',
          answer: { kind: 'text', placeholder: 'имя файла', accept: (v) => /potion-blue\.png/i.test(v), wrong: 'Смотри строку «Failed to load resource… 404» — имя файла справа, или найди красную строку в Network.' },
          success: 'potion-blue.png — 404. Это отдельный баг: битая ссылка на изображение.' },
      ],
      hints: [
        'Уровни логов переключаются в выпадающем списке справа от поля Filter (по умолчанию «Default levels»).',
        'Открой список <b>Default levels ▾</b> и сними галочки Info и Warnings (Verbose и так выключен). Ссылка <code>catalog.js:57</code> — справа в строке TypeError.',
        'Console → Default levels ▾ → оставь только Errors → клик по <code>catalog.js:57</code> → второй вариант ответа → впиши <code>potion-blue.png</code>.',
      ],
    },
    {
      id: 'dt-3', setup: 'search', title: 'Console: выражения и данные страницы',
      giver: { name: 'Счетовод Тимо', sprite: '🧮' }, gold: G(3),
      outro: 'Консоль — быстрый способ посчитать элементы, прочитать конфиг и проверить гипотезу без правки кода.',
      steps: [
        { id: 'count', text: 'Заголовок обещает 12 товаров. Посчитай карточки через консоль: выполни <code>document.querySelectorAll(\'.product-card\').length</code>.',
          check: (c) => has(c, 'console-eval', (e) => e.ok && e.raw === 11 && /product-card/.test(e.code)),
          success: 'Консоль вернула 11.' },
        { id: 'count-ans', text: 'Сколько карточек на самом деле на странице?',
          answer: { kind: 'text', placeholder: 'число', accept: (v) => v.replace(/\D/g, '') === '11', wrong: 'Посмотри результат выражения в консоли.' },
          success: 'Счётчик и список расходятся: фронт показывает total из API, а один товар отфильтрован (hidden: true).' },
        { id: 'config', text: 'Проверь, на какой бэкенд смотрит сборка: выведи в консоли глобальный объект <code>__APP_CONFIG__</code>.',
          check: (c) => has(c, 'console-eval', (e) => e.ok && /__APP_CONFIG__/.test(e.code) && e.raw !== undefined),
          success: 'Конфиг на виду: env, build, apiUrl.' },
        { id: 'env', text: 'Что не так с конфигом?',
          answer: {
            kind: 'choice',
            options: [
              'Всё в порядке: production-сборка.',
              'Production-сборка ходит в API стенда stage (apiUrl: api.stage…) — ошибка конфигурации окружения.',
              'Выключен фичефлаг newCheckout — это баг.',
              'Номер сборки 3.2.0 устарел.',
            ],
            accept: (v) => v === 1,
            wrong: 'Сравни env и apiUrl.',
          },
          success: 'Да: прод смотрит в stage — данные пользователей уходят не туда. Критичный баг конфигурации.' },
      ],
      hints: [
        'Внизу Console есть строка ввода со знаком ›. Туда пишут JavaScript и жмут Enter.',
        'Скопируй выражение из задания в строку ввода консоли. Глобальные переменные страницы выводятся просто по имени: <code>__APP_CONFIG__</code> (или <code>window.__APP_CONFIG__</code>).',
        '<code>document.querySelectorAll(\'.product-card\').length</code> → 11 → впиши 11 → <code>__APP_CONFIG__</code> → apiUrl указывает на stage → второй вариант.',
      ],
    },
    {
      id: 'dt-4', setup: 'merchant', title: 'Network: ошибка 500 и Copy as cURL',
      giver: { name: 'Торговец Бруно', sprite: '🏪' }, gold: G(4),
      outro: 'cURL из DevTools воспроизводит запрос один в один — разработчику не нужно гадать, что именно ушло на сервер.',
      steps: [
        { id: 'xhr', text: 'Заказы не грузятся. В <b>Network</b> оставь только запросы к API — фильтр <b>Fetch/XHR</b>.',
          check: (c) => c.state.netType === 'xhr' && c.state.panel === 'network',
          success: 'Картинки, скрипты и стили скрыты — остались вызовы API.' },
        { id: 'sel', text: 'Найди упавший запрос заказов (красная строка) и выбери его.',
          check: (c) => has(c, 'net-select', (e) => e.tag === 'orders'),
          success: 'GET /api/orders?page=1&size=20 — статус 500.' },
        { id: 'resp', text: 'Открой <b>Response</b>: что сообщил сервер?',
          check: (c) => viewing(c, 'orders', 'response') || viewing(c, 'orders', 'preview'),
          success: 'Сервер упал на SQL-ограничении внешнего ключа; в ответе есть traceId — его ищут в логах бэкенда.' },
        { id: 'curl', text: 'Скопируй запрос для баг-репорта: правый клик по строке (или ⋮ в панели запроса) → <b>Copy as cURL (bash)</b>.',
          check: (c) => has(c, 'copy-curl', (e) => e.tag === 'orders'),
          success: 'cURL скопирован: URL, заголовки с токеном — разработчик повторит запрос в терминале.' },
        { id: 'who', text: 'Кому назначить баг?',
          answer: {
            kind: 'choice',
            options: [
              'Фронтенду: он неправильно собрал запрос.',
              'Бэкенду: 5xx — ошибка на стороне сервера, запрос корректный, а сервер упал на своей логике.',
              'Никому: это временный сбой сети.',
              'Дизайнеру: плашка ошибки некрасивая.',
            ],
            accept: (v) => v === 1,
            wrong: '4xx обычно — проблема запроса клиента, 5xx — сервера. Какой здесь статус?',
          },
          success: 'Верно: 500 + исключение в ответе + traceId = баг бэкенда.' },
      ],
      hints: [
        'Фильтры типов — строка кнопок над таблицей Network: All, Fetch/XHR, Doc, CSS, JS…',
        'Нажми <b>Fetch/XHR</b>, выбери красную строку <code>orders?page=1…</code>. Меню запроса открывается правым кликом по строке или кнопкой ⋮ справа от вкладок.',
        'Fetch/XHR → строка orders (500) → Response → ⋮ → Copy as cURL (bash) → второй вариант.',
      ],
    },
    {
      id: 'dt-5', setup: 'profile', title: 'Network: поиск запроса и Payload',
      giver: { name: 'Писарь Олаф', sprite: '🪶' }, gold: G(5),
      outro: 'Payload — главный аргумент в споре «фронт или бэк»: видно, что именно клиент отправил на сервер.',
      steps: [
        { id: 'edit', text: 'Пользователи жалуются: новый телефон не сохраняется. Измени телефон в форме и нажми <b>«Сохранить»</b>.',
          check: (c) => app(c, 'save', (e) => e.changed),
          success: 'Страница пишет «Изменения сохранены». Проверим, правда ли.' },
        { id: 'search', text: 'Запросов много. Введи в поле <b>Filter</b> вкладки Network слово <code>profile</code>.',
          check: (c) => c.state.panel === 'network' && /profile/i.test(c.state.netQ),
          success: 'Остались только запросы с profile в URL: GET и PUT.' },
        { id: 'payload', text: 'Выбери <b>PUT</b>-запрос и открой вкладку <b>Payload</b>.',
          check: (c) => viewing(c, 'profile-put', 'payload'),
          success: 'В Payload phone — старый номер, хотя в поле был новый.' },
        { id: 'verdict', text: 'Чей это баг?',
          answer: {
            kind: 'choice',
            options: [
              'Бэкенда: сервер получил новый телефон, но не сохранил его.',
              'Фронтенда: в запросе уходит старое значение phone, сервер честно сохраняет то, что прислали.',
              'Это не баг: телефон обновится после перезагрузки.',
              'Сети: запрос не дошёл до сервера.',
            ],
            accept: (v) => v === 1,
            wrong: 'Сравни значение в поле формы и phone в Payload.',
          },
          success: 'Да: фронт отправляет не то, что ввёл пользователь. Payload — доказательство в баг-репорте.' },
      ],
      hints: [
        'Сначала воспроизведи сценарий: поменяй телефон и сохрани. Потом найди запрос сохранения в Network.',
        'Filter в Network ищет по URL. После ввода <code>profile</code> выбери строку с методом PUT и переключись на вкладку Payload.',
        'Измени телефон → Сохранить → Network → Filter: <code>profile</code> → строка PUT profile → Payload → phone старый → второй вариант.',
      ],
    },
    {
      id: 'dt-6', setup: 'library', title: 'Throttling и Timing: гонка запросов',
      giver: { name: 'Библиотекарь Эйра', sprite: '📚' }, gold: G(6),
      outro: 'Многие баги видны только на медленной сети. Троттлинг — обязательная проверка живого поиска, форм и спиннеров.',
      steps: [
        { id: 'throttle', text: 'У пользователей с мобильным интернетом поиск показывает чужие результаты. В Network включи троттлинг <b>Slow 3G</b> (список <b>No throttling</b>).',
          check: (c) => c.state.throttle === 'slow3g',
          success: 'Сеть замедлена: задержка ~2 с и низкая скорость загрузки.' },
        { id: 'race', text: 'Медленно (по букве) набери в поиске слово <b>дракон</b> и дождись, пока все запросы завершатся. Сравни запрос в поле и результаты.',
          check: (c) => app(c, 'race'),
          success: 'В поле «дракон», а на экране результаты по «др…»: старый ответ пришёл последним и затёр правильный.' },
        { id: 'timing', text: 'Выбери один из запросов <code>search</code> и открой вкладку <b>Timing</b>: где тратится время?',
          check: (c) => viewing(c, 'search', 'timing'),
          success: 'Waiting for server response и Content Download: широкий запрос отдаёт тяжёлый ответ и грузится дольше узкого.' },
        { id: 'cause', text: 'В чём причина бага?',
          answer: {
            kind: 'choice',
            options: [
              'Сервер ищет неправильно: по «дракон» возвращает лишние книги.',
              'Гонка запросов: ответы приходят не по порядку, а фронт рисует любой пришедший ответ и не отменяет устаревшие запросы.',
              'Пользователь печатает слишком быстро.',
              'Включён кэш браузера.',
            ],
            accept: (v) => v === 1,
            wrong: 'Посмотри колонку Time у запросов и порядок, в котором они завершились.',
          },
          success: 'Это race condition на фронте. Фикс: отменять старые запросы (AbortController) или игнорировать ответы не на текущий запрос.' },
      ],
      hints: [
        'Троттлинг — выпадающий список в панели инструментов Network.',
        'Выбери Slow 3G, кликни в поле поиска и печатай по букве. Каждая буква (от двух) отправляет запрос. Колонка Time покажет, кто ответил позже.',
        'Network → Slow 3G → набери «дракон» → подожди ~5 секунд → выбери любой search → Timing → второй вариант.',
      ],
    },
    {
      id: 'dt-7', setup: 'pay', title: 'Preserve log при редиректе',
      giver: { name: 'Казначей Хельга', sprite: '💳' }, gold: G(7),
      outro: 'Если после действия страница уходит на другой URL, включай Preserve log заранее — иначе улики пропадут.',
      steps: [
        { id: 'repro', text: 'Нажми <b>«Оплатить»</b>. После неудачи страница перебросит в корзину. Посмотри Network — запрос оплаты на месте?',
          check: (c) => app(c, 'redirected'),
          success: 'После перехода на /cart журнал очистился — запроса оплаты не видно.' },
        { id: 'preserve', text: 'Включи <b>Preserve log</b> в панели Network.',
          check: (c) => c.state.preserve,
          success: 'Теперь журнал переживёт навигацию.' },
        { id: 'again', text: 'Вернись к оплате (<b>«Перейти к оплате»</b>), повтори оплату и выбери запрос <code>payments</code>.',
          check: (c) => has(c, 'net-select', (e) => e.tag === 'pay' && e.status === 402) && c.state.preserve,
          success: 'POST /api/payments — 402 Payment Required.' },
        { id: 'reason', text: 'Открой ответ сервера. Что произошло?',
          answer: {
            kind: 'choice',
            options: [
              'Сервер упал (5xx), оплата недоступна.',
              'Сервер отклонил оплату с причиной CARD_EXPIRED, а фронт показал общее «Что-то пошло не так» без причины.',
              'Запрос оплаты не отправлялся.',
              'Оплата прошла, но редирект сломан.',
            ],
            accept: (v) => v === 1,
            wrong: 'Посмотри Response запроса payments.',
          },
          success: 'Сервер прислал понятную причину, но фронт её потерял. Это UX-баг: пользователь не знает, что заменить карту.' },
      ],
      hints: [
        'Network очищается при каждой навигации — пока не включён Preserve log.',
        'Галочка Preserve log — в верхней панели Network. После этого пройди путь ещё раз: «Перейти к оплате» → «Оплатить».',
        'Оплатить → Preserve log ✓ → Перейти к оплате → Оплатить → строка payments (402) → Response: CARD_EXPIRED → второй вариант.',
      ],
    },
    {
      id: 'dt-8', setup: 'herald', title: 'Кэш и Disable cache',
      giver: { name: 'Глашатай Фрей', sprite: '📯' }, gold: G(8),
      outro: '«У меня работает» часто означает «у меня свежий файл». Проверяй с Disable cache и смотри Cache-Control.',
      steps: [
        { id: 'size', text: 'Фикс кнопки «Подписаться» выкатили, а на сайте версия 1.4.0. В Network посмотри колонку <b>Size</b> и выбери <code>app.js</code>, пришедший из кэша.',
          check: (c) => has(c, 'net-select', (e) => e.tag === 'js/app.js' && e.fromCache),
          success: 'app.js взят из disk cache — браузер даже не спросил сервер.' },
        { id: 'maxage', text: 'В <b>Response Headers</b> у app.js найди <code>cache-control</code>. Сколько секунд файл считается свежим (max-age)?',
          answer: { kind: 'text', placeholder: 'число секунд', accept: (v) => v.replace(/\D/g, '') === '31536000', wrong: 'Смотри значение max-age в заголовке cache-control.' },
          success: '31536000 секунд — целый год.' },
        { id: 'nocache', text: 'Включи <b>Disable cache</b> и перезагрузи страницу (⟳). Какая версия загрузилась?',
          check: (c) => has(c, 'app', (e) => e.name === 'version' && e.ver === '1.5.0'),
          success: 'С Disable cache пришёл свежий app.js — версия 1.5.0.' },
        { id: 'why', text: 'Почему у пользователей старая версия?',
          answer: {
            kind: 'choice',
            options: [
              'Деплой не прошёл, на сервере старый файл.',
              'app.js отдаётся без хеша в имени и с max-age на год — браузеры держат старый файл; нужен хеш в имени (как у app.3f9a1c.css) или короткий кэш.',
              'Пользователи не обновили браузер.',
              'Виноват Service Worker.',
            ],
            accept: (v) => v === 1,
            wrong: 'Сравни имя и заголовки app.js и app.3f9a1c.css.',
          },
          success: 'Верно: это баг сборки/деплоя. CSS с хешем обновляется, JS без хеша — нет.' },
      ],
      hints: [
        'Size «(disk cache)» или «(memory cache)» значит: запрос к серверу не уходил.',
        'Выбери строку app.js → вкладка Headers → блок Response Headers → cache-control. Галочка Disable cache — в панели Network; работает, пока DevTools открыты.',
        'app.js (disk cache) → Headers: max-age=31536000 → впиши 31536000 → Disable cache ✓ → ⟳ → версия v1.5.0 → второй вариант.',
      ],
    },
    {
      id: 'dt-9', setup: 'guild', title: 'Elements: обойти disabled',
      giver: { name: 'Страж Ульф', sprite: '🛡️' }, gold: G(9),
      outro: 'Кнопка disabled — только удобство интерфейса. Защита должна быть на сервере, и ты это проверил.',
      steps: [
        { id: 'find', text: 'Ты обычный участник, кнопка «Удалить гильдию» неактивна. Найди её в <b>Elements</b> и выбери.',
          check: (c) => has(c, 'el-select', (e) => e.k === 'delete-guild'),
          success: 'У кнопки атрибут disabled.' },
        { id: 'enable', text: 'Убери у кнопки атрибут <code>disabled</code>.',
          check: (c) => { const n = c.state.n('delete-guild'); return !!n && !Object.prototype.hasOwnProperty.call(n.a, 'disabled'); },
          success: 'Кнопка стала активной — на клиенте ограничения больше нет.' },
        { id: 'click', text: 'Нажми кнопку на странице и подтверди удаление.',
          check: (c) => app(c, 'deleted'),
          success: 'Запрос DELETE /api/guilds/42 ушёл на сервер.' },
        { id: 'status', text: 'Какой статус вернул сервер? (Network)',
          answer: { kind: 'text', placeholder: 'код статуса', accept: (v) => v.trim().startsWith('403'), wrong: 'Посмотри колонку Status у запроса 42 в Network.' },
          success: '403 Forbidden — сервер проверил роль.' },
        { id: 'verdict', text: 'Есть ли здесь баг безопасности?',
          answer: {
            kind: 'choice',
            options: [
              'Да: кнопку можно включить через DevTools — критичный баг.',
              'Нет: сервер проверил права и вернул 403; disabled — только подсказка в интерфейсе.',
              'Да: сервер должен был вернуть 200.',
              'Нет, потому что нужно было подтверждение.',
            ],
            accept: (v) => v === 1,
            wrong: 'Важно не то, что можно сделать в браузере, а что ответил сервер.',
          },
          success: 'Верно. Баг был бы, если бы сервер ответил 2xx.' },
      ],
      hints: [
        'Выбрать элемент можно в дереве Elements, через поиск (селектор <code>#delete-guild</code>) или инструментом ⬚ — кликом по кнопке на странице.',
        'Двойной клик по атрибуту в дереве открывает редактирование; пустое значение удаляет атрибут. Или кнопка ⋯ у выбранного узла → Attributes → disabled → Delete.',
        'Elements → <code>button#delete-guild</code> → ⋯ → disabled: Delete → «Удалить гильдию» → OK → Network: 403 → впиши 403 → второй вариант.',
      ],
    },
    {
      id: 'dt-10', setup: 'register', title: 'Валидация только на фронте',
      giver: { name: 'Летописец Рун', sprite: '📖' }, gold: G(10),
      outro: 'Любое ограничение в HTML (maxlength, required, disabled) обходится за секунду. Сервер обязан проверять всё сам.',
      steps: [
        { id: 'find', text: 'Никнейм должен быть до 16 символов. Найди поле <b>Никнейм</b> в Elements.',
          check: (c) => has(c, 'el-select', (e) => e.k === 'nickname'),
          success: 'Ограничение задано атрибутом maxlength="16" — только в браузере.' },
        { id: 'remove', text: 'Сними ограничение: удали атрибут <code>maxlength</code> (или поставь большое значение).',
          check: (c) => { const n = c.state.n('nickname'); return !!n && (!Object.prototype.hasOwnProperty.call(n.a, 'maxlength') || +n.a.maxlength > 16); },
          success: 'Теперь поле примет любую длину.' },
        { id: 'submit', text: 'Введи ник длиннее 16 символов (например, 30) и нажми <b>«Создать героя»</b>.',
          check: (c) => app(c, 'created', (e) => e.len > 16),
          success: 'Запрос ушёл с длинным ником.' },
        { id: 'verdict', text: 'Посмотри статус ответа в Network. Какой вывод?',
          answer: {
            kind: 'choice',
            options: [
              'Всё хорошо: сервер ответил 201, герой создан.',
              'Баг бэкенда: сервер принял ник длиннее 16 символов (201 Created), хотя должен вернуть 400 — валидация есть только на фронте.',
              'Баг фронтенда: maxlength не работает.',
              'Не баг: в DevTools можно всё что угодно.',
            ],
            accept: (v) => v === 1,
            wrong: 'Какой статус вернул POST /api/heroes и каким он должен быть для невалидных данных?',
          },
          success: 'Да. Ожидаемо 400 Bad Request с ошибкой валидации; фактически 201 и мусор в базе.' },
      ],
      hints: [
        'Ограничения длины поля обычно задаются атрибутом maxlength. Атрибуты редактируются прямо в Elements.',
        'Выбери <code>input#nickname</code>, нажми ⋯ → Attributes → maxlength → Delete (или двойной клик по атрибуту). Потом печатай в поле длинный ник.',
        'Elements → input#nickname → удалить maxlength → ввести 30 символов → «Создать героя» → Network: 201 → второй вариант.',
      ],
    },
    {
      id: 'dt-11', setup: 'restore', title: 'Elements: поиск и Computed',
      giver: { name: 'Чародейка Ингрид', sprite: '🔮' }, gold: G(11),
      outro: 'Элемент может быть в DOM, но не виден: проверяй Computed — color, display, visibility, opacity, размеры.',
      steps: [
        { id: 'submit', text: 'Нажми <b>«Отправить ссылку»</b> с пустым email. Сообщение об ошибке видно?',
          check: (c) => app(c, 'invalid'),
          success: 'Ошибки не видно, но форма не отправилась.' },
        { id: 'search', text: 'В Elements найди элемент ошибки через поиск по селектору <code>.field-error</code> и выбери его.',
          check: (c) => has(c, 'el-select', (e) => e.k === 'err'),
          success: 'Текст «Введите корректный email» в DOM есть.' },
        { id: 'computed', text: 'Открой вкладку <b>Computed</b> у этого элемента.',
          check: (c) => c.state.elTab === 'computed' && c.state.elSel === 'err' && c.state.panel === 'elements',
          success: 'Смотри на color.' },
        { id: 'why', text: 'Почему текст ошибки не виден?',
          answer: {
            kind: 'choice',
            options: [
              'display: none.',
              'color: rgb(255, 255, 255) — белый текст на белом фоне карточки.',
              'visibility: hidden.',
              'Элемента нет в DOM.',
            ],
            accept: (v) => v === 1,
            wrong: 'Проверь в Computed значение color и фон карточки.',
          },
          success: 'Белое на белом.' },
        { id: 'fix', text: 'Проверь фикс на лету: в <b>Styles</b> отключи или измени <code>color</code> у <code>.field-error</code>, чтобы текст стал виден.',
          check: (c) => { const col = c.state.comp('err').color; return c.state.isVisible('err') && !!col && !/255, 255, 255/.test(col); },
          success: 'Текст ошибки виден. В баг-репорт: селектор, файл restore.css:9 и предлагаемый цвет.' },
      ],
      hints: [
        'Сначала воспроизведи: пустой email → «Отправить ссылку». Поиск по DOM — строка 🔍 над деревом Elements, принимает текст и CSS-селекторы.',
        'Введи <code>.field-error</code> в поиск и нажми Enter. Справа переключись на Computed. В Styles можно снять галочку у свойства или кликнуть по значению и вписать своё.',
        'Отправить → поиск <code>.field-error</code> → Enter → Computed: color rgb(255,255,255) → второй вариант → Styles: сними галочку у <code>color: #ffffff</code>.',
      ],
    },
    {
      id: 'dt-12', setup: 'quests', title: 'Состояние :hover',
      giver: { name: 'Глава квестов Бьорн', sprite: '📜' }, gold: G(12),
      outro: 'Force state (:hover, :focus, :active) фиксирует состояние элемента, чтобы спокойно изучить его стили.',
      steps: [
        { id: 'select', text: 'При наведении пункты меню «исчезают». Выбери в Elements одну из ссылок меню (<code>a.nav-link</code>).',
          check: (c) => has(c, 'el-select', (e) => /^nav\d$/.test(e.k)),
          success: 'Обычные стили ссылки в порядке.' },
        { id: 'hov', text: 'Включи принудительное состояние <b>:hover</b>: кнопка <b>:hov</b> в Styles → галочка :hover.',
          check: (c) => ['nav1', 'nav2', 'nav3'].some((k) => c.state.hov.has(k)),
          success: 'Появилось правило .nav-link:hover, и ссылка на странице «пропала».' },
        { id: 'which', text: 'Какое свойство ломает пункт меню при наведении?',
          answer: {
            kind: 'choice',
            options: ['background: #f1f3f9', 'color: #ffffff — белый текст на светлом фоне', 'padding: 6px 10px', 'text-decoration: none'],
            accept: (v) => v === 1,
            wrong: 'Посмотри правило .nav-link:hover в Styles.',
          },
          success: 'Да, белый текст на почти белом фоне.' },
        { id: 'fix', text: 'Отключи это свойство в правиле <code>.nav-link:hover</code> (или задай читаемый цвет) и убедись, что текст виден.',
          check: (c) => { const d = declOf(c, '.nav-link:hover', 'color'); return !!d && (d.off || !isWhite(d.v)); },
          success: 'Пункт меню читается. Фикс для разработчика: quests.css:22.' },
      ],
      hints: [
        'Стили для :hover видны в Styles, только когда элемент в этом состоянии. DevTools умеет включать его принудительно.',
        'Выбери <code>a.nav-link</code>, в Styles нажми <b>:hov</b> и отметь <b>:hover</b>. Появится правило <code>.nav-link:hover</code>.',
        'Elements → a.nav-link → :hov → :hover ✓ → второй вариант → сними галочку у <code>color: #ffffff</code> в .nav-link:hover.',
      ],
    },
    {
      id: 'dt-13', setup: 'scrolls', title: 'Инспектор: невидимый оверлей',
      giver: { name: 'Торговка Сольвейг', sprite: '🌀' }, gold: G(13),
      outro: 'Когда кнопка «не нажимается», проверь инспектором, что лежит сверху: прозрачные слои — частая причина.',
      steps: [
        { id: 'click', text: 'Нажми <b>«Купить свиток»</b>. Что-нибудь происходит?',
          check: (c) => app(c, 'blocked-click'),
          success: 'Ничего: ни запроса в Network, ни ошибки в Console.' },
        { id: 'pick', text: 'Включи инструмент выбора элемента (<b>⬚</b> в левом углу DevTools) и кликни по кнопке на странице.',
          check: (c) => has(c, 'pick', (e) => e.k === 'backdrop'),
          success: 'Выбралась не кнопка, а div.cookie-backdrop — прозрачный слой поверх страницы (opacity: 0, z-index: 50).' },
        { id: 'hide', text: 'Убери мешающий слой: <b>Delete element</b>, <b>Hide element</b> (меню ⋯) или отключи его стили.',
          check: (c) => { const n = c.state.n('backdrop'); if (!n || !c.state.isVisible('backdrop')) return true; const cs = c.state.cascade('backdrop'); return cs['pointer-events'] === 'none' || cs.position !== 'absolute'; },
          success: 'Слой убран.' },
        { id: 'buy', text: 'Снова нажми <b>«Купить свиток»</b>.',
          check: (c) => app(c, 'bought'),
          success: 'Товар добавлен в корзину — причина найдена.' },
        { id: 'verdict', text: 'Что написать в баг-репорте?',
          answer: {
            kind: 'choice',
            options: [
              'Бэкенд не принимает запрос корзины.',
              'Фронтенд: после закрытия cookie-баннера остаётся прозрачный div.cookie-backdrop на всю страницу и перехватывает клики.',
              'Кнопка disabled.',
              'Медленная сеть.',
            ],
            accept: (v) => v === 1,
            wrong: 'Вспомни, какой элемент выбрал инспектор при клике по кнопке.',
          },
          success: 'Верно. Запроса не было — значит, клик до кода кнопки не дошёл.' },
      ],
      hints: [
        'Если по клику нет ни запроса, ни ошибки, проверь, какой элемент на самом деле получает клик.',
        'Кнопка ⬚ слева от вкладок DevTools — Select an element. Кликни ею по «Купить свиток» на странице. У выбранного узла кнопка ⋯ открывает Delete element / Hide element.',
        'Купить → ⬚ → клик по кнопке → выбран div.cookie-backdrop → ⋯ → Delete element → Купить → второй вариант.',
      ],
    },
    {
      id: 'dt-14', setup: 'mobile', title: 'Device Toolbar и Box model',
      giver: { name: 'Гонец Лейф', sprite: '📱' }, gold: G(14),
      outro: 'Минимальный набор ширин для проверки адаптива: 360, 375, 390, 414 и планшет 768.',
      steps: [
        { id: 'device', text: 'Корзину проверяют на мобильном. Включи <b>Device Toolbar</b> (📱) и выбери <b>iPhone SE</b> (375 px).',
          check: (c) => c.state.device && c.state.devW <= 414,
          success: 'Кнопка «Оформить заказ» вылезает за край экрана — появилась горизонтальная прокрутка.' },
        { id: 'select', text: 'Выбери кнопку <b>«Оформить заказ»</b> в Elements (или инструментом ⬚).',
          check: (c) => has(c, 'el-select', (e) => e.k === 'checkout'),
          success: 'В Styles: .checkout-btn { width: 380px; padding: 12px 20px }.' },
        { id: 'computed', text: 'Открой вкладку <b>Computed</b> и посмотри на Box model.',
          check: (c) => c.state.elTab === 'computed' && c.state.elSel === 'checkout',
          success: 'Content 380, padding по 20 слева и справа, box-sizing: content-box.' },
        { id: 'width', text: 'Какая итоговая ширина кнопки вместе с padding (в px)?',
          answer: { kind: 'text', placeholder: 'ширина в px', accept: (v) => v.replace(/\D/g, '') === '420', wrong: 'Сложи ширину контента и padding слева и справа.' },
          success: '420 px при экране 375 px — кнопка не помещается.' },
        { id: 'fix', text: 'Проверь фикс: отключи фиксированную <code>width</code> у <code>.checkout-btn</code> (или поставь <code>100%</code>) — кнопка должна поместиться.',
          check: (c) => { const b = c.state.box('checkout'); return c.state.device && c.state.devW <= 414 && (b.total == null || b.total <= c.state.devW - 32); },
          success: 'Кнопка помещается. Фикс: width: 100% или box-sizing: border-box с max-width.' },
      ],
      hints: [
        'Кнопка 📱 рядом с ⬚ включает эмуляцию устройства, ширину выбирают в списке Dimensions над страницей.',
        'Выбери <code>button.checkout-btn</code>, справа вкладка Computed — диаграмма Box model: content, padding, border, margin.',
        '📱 → iPhone SE → Elements: button.checkout-btn → Computed → 380 + 20 + 20 = 420 → Styles: сними галочку у <code>width: 380px</code>.',
      ],
    },
    {
      id: 'dt-15', setup: 'tavern', title: 'Local Storage: токен и роль',
      giver: { name: 'Трактирщик Гуннар', sprite: '🍺' }, gold: G(15),
      outro: 'Данные в localStorage пользователь меняет сам, поэтому права всегда проверяет сервер, а не интерфейс.',
      steps: [
        { id: 'open', text: 'Открой <b>Application → Local storage →</b> origin таверны и посмотри, что хранит сайт.',
          check: (c) => has(c, 'app-open', (e) => e.sec === 'local'),
          success: 'Тут объект user с ролью, токен доступа и настройки.' },
        { id: 'token', text: 'Проверь, доступен ли токен скриптам страницы: выполни в Console <code>localStorage.getItem(\'access_token\')</code>.',
          check: (c) => has(c, 'console-eval', (e) => e.ok && typeof e.raw === 'string' && e.raw.startsWith('eyJ')),
          success: 'Токен читается любым JS на странице. Это замечание для ревью безопасности: при XSS его легко унести, надёжнее HttpOnly-cookie.' },
        { id: 'edit', text: 'Проверь, кто решает, что показывать: в значении <code>user</code> поменяй <code>role</code> с member на <code>admin</code>. Двойной клик по значению открывает редактирование.',
          check: (c) => { try { return JSON.parse(c.state.ls.get('user')).role === 'admin'; } catch (e) { return false; } },
          success: 'Значение изменено только в твоём браузере.' },
        { id: 'admin', text: 'Перезагрузи страницу. Появился пункт <b>«Админка»</b>? Открой его.',
          check: (c) => app(c, 'admin-loaded'),
          success: 'Сервер отдал список пользователей с email участнику без прав.' },
        { id: 'headers', text: 'В Network выбери запрос <code>users</code> и открой <b>Headers</b>. Посмотри Request Headers: по какому заголовку сервер узнаёт роль?',
          check: (c) => viewing(c, 'admin-users', 'headers'),
          success: 'Заголовок x-user-role собирается фронтом из localStorage.' },
        { id: 'verdict', text: 'Какой вывод в баг-репорте?',
          answer: {
            kind: 'choice',
            options: [
              'Баг фронтенда: пункт «Админка» не должен появляться.',
              'Критичный баг бэкенда: сервер доверяет роли из заголовка, который присылает клиент. Права нужно проверять на сервере по токену/сессии.',
              'Не баг: пользователь сам поменял данные.',
              'Баг в localStorage браузера.',
            ],
            accept: (v) => v === 1,
            wrong: 'Важно, что ответил сервер на запрос без реальных прав.',
          },
          success: 'Верно. Скрытие пунктов меню — косметика; отказ должен приходить с сервера (403).' },
      ],
      hints: [
        'Application — вкладка DevTools с хранилищами сайта: Local storage, Session storage, Cookies.',
        'Выбери строку user, кликни по значению ещё раз (или дважды) и поменяй "member" на "admin", Enter. Затем ⟳ и клик по «Админка». В Network у запроса users открой Headers → Request Headers.',
        'Application → Local storage → origin → Console: <code>localStorage.getItem(\'access_token\')</code> → user: role "admin" → ⟳ → Админка → Network: users → Headers (x-user-role) → второй вариант.',
      ],
    },
    {
      id: 'dt-16', setup: 'bank', title: 'Cookies: флаги и сессия',
      giver: { name: 'Банкир Эрик', sprite: '🏦' }, gold: G(16),
      outro: 'Чек-лист сессионной cookie: HttpOnly, Secure, SameSite и разумный срок жизни.',
      steps: [
        { id: 'open', text: 'Открой <b>Application → Cookies →</b> origin банка. Посмотри колонки HttpOnly, Secure, SameSite и Expires.',
          check: (c) => has(c, 'app-open', (e) => e.sec === 'cookies'),
          success: 'У session_id нет галочки HttpOnly.' },
        { id: 'js', text: 'Проверь, видит ли JavaScript сессионную cookie: выполни в Console <code>document.cookie</code>.',
          check: (c) => has(c, 'console-eval', (e) => e.ok && /document\.cookie/.test(e.code) && typeof e.raw === 'string' && /session_id=/.test(e.raw)),
          success: 'session_id есть в document.cookie — значит, её может прочитать любой скрипт на странице.' },
        { id: 'flag', text: 'Какого флага не хватает у <code>session_id</code>?',
          answer: {
            kind: 'choice',
            options: ['Secure', 'HttpOnly', 'SameSite', 'Path'],
            accept: (v) => v === 1,
            wrong: 'Какой флаг скрывает cookie от JavaScript?',
          },
          success: 'HttpOnly. Без него сессию проще украсть через XSS. Ещё замечание: срок жизни год, хотя «Запомнить меня» не выбирали.' },
        { id: 'logout', text: 'Проверь, что сессия держится на этой cookie: удали <code>session_id</code> (выбери строку → ✕) и перезагрузи страницу.',
          check: (c) => app(c, 'logged-out'),
          success: 'Без cookie банк просит войти заново: сессия действительно в session_id.' },
      ],
      hints: [
        'Cookies лежат в Application → Cookies. Флаги — колонки с галочками.',
        'В Console выполни <code>document.cookie</code>: HttpOnly-cookie туда не попадают. Удалить cookie: выбери строку и нажми ✕ (Delete Selected).',
        'Application → Cookies → Console: <code>document.cookie</code> → ответ HttpOnly → Application: session_id → ✕ → ⟳.',
      ],
    },
    {
      id: 'dt-17', setup: 'flags', title: 'Session Storage и Clear site data',
      giver: { name: 'Лавочница Астрид', sprite: '🧪' }, gold: G(17),
      outro: 'Перед проверкой сценария «новый пользователь» очищай данные сайта, иначе тестируешь со старым состоянием.',
      steps: [
        { id: 'session', text: 'Новое оформление спрятано за фичефлагом. Открой <b>Application → Session storage</b> и поставь <code>ff_new_checkout</code> = <code>true</code>.',
          check: (c) => c.state.ss.get('ff_new_checkout') === 'true',
          success: 'Флаг включён для этой вкладки.' },
        { id: 'reload', text: 'Перезагрузи страницу: появилась кнопка «Купить в 1 клик»?',
          check: (c) => app(c, 'loaded', (e) => e.newCheckout),
          success: 'Новое оформление включилось.' },
        { id: 'clear', text: 'Теперь проверь онбординг нового пользователя: <b>Application → Storage → Clear site data</b>, затем перезагрузи страницу.',
          check: (c) => app(c, 'loaded', (e) => e.onboarding),
          success: 'Онбординг показался: onboarding_done больше нет в localStorage.' },
        { id: 'diff', text: 'Чем sessionStorage отличается от localStorage?',
          answer: {
            kind: 'choice',
            options: [
              'Ничем, это синонимы.',
              'sessionStorage живёт в пределах вкладки и очищается при её закрытии; localStorage хранится, пока его не очистят.',
              'sessionStorage отправляется на сервер с каждым запросом.',
              'localStorage очищается при перезагрузке.',
            ],
            accept: (v) => v === 1,
            wrong: 'Подумай, что будет с данными после закрытия вкладки.',
          },
          success: 'Верно. А на сервер с запросами уходят только cookie.' },
      ],
      hints: [
        'Session storage — рядом с Local storage в Application. Значение правится повторным (или двойным) кликом по ячейке.',
        'Выбери строку ff_new_checkout, кликни по значению и введи true, Enter, затем ⟳. Пункт Storage в разделе Application содержит кнопку Clear site data.',
        'Session storage → ff_new_checkout = true → ⟳ → Storage → Clear site data → ⟳ → второй вариант.',
      ],
    },
    {
      id: 'dt-18', setup: 'debug', title: 'Sources: breakpoint и Scope',
      giver: { name: 'Механик Торвальд', sprite: '⚙️' }, gold: G(18),
      outro: 'Breakpoint показывает реальные значения переменных — гадать по коду больше не нужно.',
      steps: [
        { id: 'promo', text: 'Промокод MAGIC15 даёт 15%. Нажми <b>«Применить»</b> и посмотри на скидку.',
          check: (c) => app(c, 'promo-applied'),
          success: 'Скидка −15 ₽ вместо −300 ₽ (15% от 2 000).' },
        { id: 'open', text: 'Открой <b>Sources</b> и в дереве файлов выбери <code>cart.js</code>.',
          check: (c) => has(c, 'src-open', (e) => e.file === 'cart.js'),
          success: 'Функция applyPromo считает скидку.' },
        { id: 'bp', text: 'Поставь breakpoint на строке 13 (<code>const total = …</code>): клик по номеру строки.',
          check: (c) => { const s = c.state.bps.get('js/cart.js'); return !!s && [12, 13, 14].some((l) => s.has(l)); },
          success: 'Точка останова стоит.' },
        { id: 'pause', text: 'Снова нажми <b>«Применить»</b> — выполнение остановится. Посмотри панель <b>Scope</b>.',
          check: (c) => has(c, 'paused', (e) => e.file === 'cart.js'),
          success: 'Paused on breakpoint. В Scope видны code, promo, subtotal, discount.' },
        { id: 'value', text: 'Чему равна <code>discount</code> в момент остановки на строке 13?',
          answer: { kind: 'text', placeholder: 'значение', accept: (v) => v.trim() === '15', wrong: 'Посмотри Scope → Local. Если остановка на строке 12, нажми Step over (⤼).' },
          success: 'discount = 15, а promo.type = "percent".' },
        { id: 'cause', text: 'В чём ошибка в коде?',
          answer: {
            kind: 'choice',
            options: [
              'Сервер вернул неверный промокод.',
              'Процент вычитается как сумма: discount = promo.value (15), а должно быть subtotal * promo.value / 100 при type = "percent".',
              'Неправильно посчитан subtotal.',
              'Ошибка в форматировании цены.',
            ],
            accept: (v) => v === 1,
            wrong: 'Сравни значения в Scope: subtotal, promo.type, discount.',
          },
          success: 'Верно. Не забудь снять паузу (▶ Resume), чтобы страница ожила.' },
      ],
      hints: [
        'Breakpoint ставится кликом по номеру строки в Sources. Код остановится, когда дойдёт до этой строки.',
        'Sources → cart.js → клик по «13» → «Применить» на странице. Справа в Scope → Local видны значения. ⤼ — Step over, ▶ — Resume.',
        'Применить → Sources → cart.js → breakpoint на 13 → Применить → Scope: discount 15 → впиши 15 → второй вариант.',
      ],
    },
    {
      id: 'dt-19', setup: 'product', title: 'Block request URL',
      giver: { name: 'Смотритель Рагна', sprite: '🧱' }, gold: G(19),
      outro: 'Блокировка запроса — дешёвый способ проверить устойчивость: отказ второстепенного сервиса не должен ронять страницу.',
      steps: [
        { id: 'sel', text: 'Проверим, как страница переживёт недоступность рекомендаций. В Network выбери запрос <code>recommendations</code>.',
          check: (c) => has(c, 'net-select', (e) => e.tag === 'recs'),
          success: 'GET /api/recommendations?product=17 — второстепенный виджет.' },
        { id: 'block', text: 'Заблокируй его: правый клик (или ⋮) → <b>Block request URL</b>.',
          check: (c) => c.state.blocked.some((b) => b.on && /recommendations/.test(b.pat)),
          success: 'Внизу появилась панель Network request blocking.' },
        { id: 'reload', text: 'Перезагрузи страницу (⟳).',
          check: (c) => app(c, 'crashed'),
          success: 'Белый экран! В Network запрос (blocked:devtools), в Console TypeError.' },
        { id: 'verdict', text: 'Как оформить результат?',
          answer: {
            kind: 'choice',
            options: [
              'Не баг: блокировку сделал тестировщик.',
              'Баг фронтенда: при ошибке запроса рекомендаций падает вся страница. Ожидание — товар доступен, виджет скрыт или показывает заглушку.',
              'Баг бэкенда: рекомендации недоступны.',
              'Баг браузера.',
            ],
            accept: (v) => v === 1,
            wrong: 'Сервис рекомендаций однажды правда упадёт. Что тогда должен увидеть покупатель?',
          },
          success: 'Верно: нет обработки ошибки (error boundary) у второстепенного виджета.' },
        { id: 'unblock', text: 'Сними блокировку (✕ или галочка в Network request blocking) и перезагрузи — страница снова работает.',
          check: (c) => app(c, 'recovered'),
          success: 'Всё вернулось. Не оставляй блокировки включёнными после проверки.' },
      ],
      hints: [
        'Меню запроса открывается правым кликом по строке Network или кнопкой ⋮ рядом с вкладками выбранного запроса.',
        'После Block request URL перезагрузи страницу. Убрать блокировку: в панели Network request blocking сними галочку или нажми ✕.',
        'Network → recommendations → ⋮ → Block request URL → ⟳ → второй вариант → ✕ у блокировки → ⟳.',
      ],
    },
    {
      id: 'dt-20', setup: 'checkout', title: 'Расследование: двойной заказ',
      giver: { name: 'Архимаг Гильдии', sprite: '🧙' }, gold: G(20),
      outro: 'Полное расследование: воспроизведение, доказательства из Network, источник в коде, проверка бэкенда и чёткий вывод.',
      steps: [
        { id: 'repro', text: 'Покупатели жалуются на двойные списания. Нажми <b>«Подтвердить заказ»</b> один раз.',
          check: (c) => app(c, 'ordered'),
          success: 'На экране один номер заказа. Проверим, что ушло на сервер.' },
        { id: 'find', text: 'В Network найди запросы <code>orders</code> (Filter в помощь) и выбери один из них.',
          check: (c) => has(c, 'net-select', (e) => e.tag === 'order'),
          success: 'На один клик ушло два POST /api/orders, оба 201 Created.' },
        { id: 'initiator', text: 'Открой вкладку <b>Initiator</b> и посмотри её у <b>обоих</b> запросов: откуда они отправлены?',
          check: (c) => new Set(c.log.filter((e) => (e.type === 'net-select' || e.type === 'net-tab') && e.tag === 'order' && e.tab === 'initiator').map((e) => e.init)).size >= 2,
          success: 'Один из checkout.js, второй из legacy-checkout.js: на кнопке два обработчика click (видно и в Elements → Event Listeners).' },
        { id: 'curl', text: 'Скопируй один из запросов как cURL для баг-репорта.',
          check: (c) => has(c, 'copy-curl', (e) => e.tag === 'order'),
          success: 'cURL готов.' },
        { id: 'replay', text: 'Проверь бэкенд: повтори запрос через <b>Replay XHR</b>. Создаст ли сервер ещё один заказ?',
          check: (c) => has(c, 'replay', (e) => e.tag === 'order'),
          success: 'Повтор вернул 201 и новый orderId: сервер не защищён от повторной отправки.' },
        { id: 'verdict', text: 'Итог расследования?',
          answer: {
            kind: 'choice',
            options: [
              'Пользователь кликнул дважды.',
              'Только бэкенд: он создаёт дубли.',
              'Два бага. Фронт: на кнопке два обработчика (checkout.js и legacy-checkout.js) — два POST на клик. Бэкенд: нет идемпотентности — повтор того же запроса создаёт новый заказ.',
              'Только фронт: нужно убрать старый скрипт.',
            ],
            accept: (v) => v === 2,
            wrong: 'Учти и Initiator, и результат Replay XHR.',
          },
          success: 'Блестяще! Фронту — убрать legacy-checkout.js, бэкенду — ключ идемпотентности для POST /api/orders.' },
      ],
      hints: [
        'Начни с воспроизведения и Network: сколько запросов уходит на один клик? Initiator покажет, какой код отправил запрос.',
        'Filter: <code>orders</code>. Выбери первый запрос → Initiator, затем второй (вкладка останется той же). Меню ⋮ — Copy as cURL и Replay XHR.',
        'Подтвердить → Network: orders → Initiator у обоих (checkout.js:20 и legacy-checkout.js:12) → ⋮ Copy as cURL → ⋮ Replay XHR (201, новый id) → третий вариант.',
      ],
    },
    {
      id: 'dt-21', setup: 'favorites', title: 'Кнопка не работает: ошибка в Console',
      giver: { name: 'Травница Хильда', sprite: '🌿' }, gold: G(21),
      outro: '«Кнопка не работает» — сначала Console и Network: упал ли код, ушёл ли запрос и что ответил сервер.',
      steps: [
        { id: 'console', text: 'Жалоба: «Кнопка <b>В избранное</b> не работает». Нажми её на странице и открой вкладку <b>Console</b>.',
          check: (c) => app(c, 'fav-click') && c.state.panel === 'console',
          success: 'На странице ничего не изменилось, зато в Console — Uncaught TypeError: Cannot read properties of null (reading \'textContent\').' },
        { id: 'src', text: 'Кликни по ссылке на источник справа в строке ошибки, чтобы открыть код в Sources.',
          check: (c) => has(c, 'src-open', (e) => e.file === 'favorites.js'),
          success: 'Строка 14: <code>counter.textContent</code>, а counter ищется строкой выше по селектору <code>#fav-counter</code>.' },
        { id: 'null', text: 'Проверь гипотезу в Console: выполни <code>document.querySelector(\'#fav-counter\')</code>.',
          check: (c) => has(c, 'console-eval', (e) => e.ok && e.raw === null && /fav-counter/.test(e.code)),
          success: 'null — элемента с таким id на странице нет.' },
        { id: 'id', text: 'Найди счётчик избранного в шапке (Elements или инструмент ⬚). Какой у него <b>id</b> на самом деле?',
          answer: { kind: 'text', placeholder: 'id элемента', accept: (v) => /^#?fav-count$/i.test(v.trim()), wrong: 'Выбери в Elements элемент с цифрой 2 в шапке и посмотри атрибут id.' },
          success: 'fav-count: при редизайне id поменяли, а селектор в favorites.js остался старым.' },
        { id: 'net', text: 'А запрос до сервера дошёл? Выбери в <b>Network</b> запрос <code>favorites</code>.',
          check: (c) => has(c, 'net-select', (e) => e.tag === 'fav'),
          success: 'POST /api/favorites — 201 Created: товар в избранное добавлен, упало только обновление интерфейса.' },
        { id: 'verdict', text: 'Что написать в баг-репорте?',
          answer: {
            kind: 'choice',
            options: [
              'Бэкенд не сохраняет избранное.',
              'Фронтенд: после успешного POST /api/favorites (201) код падает с TypeError — селектор #fav-counter не находит счётчик (id fav-count), и кнопка не обновляется.',
              'Кнопка заблокирована атрибутом disabled.',
              'Не загрузился файл favorites.js.',
            ],
            accept: (v) => v === 1,
            wrong: 'Сопоставь: статус запроса в Network, текст ошибки в Console и строку кода в Sources.',
          },
          success: 'Верно. В репорт: шаги, ошибка со стеком из Console, статус 201 из Network и строка favorites.js:14.' },
      ],
      hints: [
        'Если по клику ничего не происходит, смотри Console (упал ли JS) и Network (ушёл ли запрос). Счётчик ⛔ справа вверху DevTools подсказывает, что ошибки есть.',
        'Ссылка <code>favorites.js:14</code> — справа в строке TypeError. Строка ввода консоли — внизу, со знаком ›. Счётчик в шапке — <code>&lt;b id="…"&gt;2&lt;/b&gt;</code> внутри span.badge.',
        'В избранное → Console → клик по <code>favorites.js:14</code> → Console: <code>document.querySelector(\'#fav-counter\')</code> → null → впиши <code>fav-count</code> → Network: favorites (201) → второй вариант.',
      ],
    },
    {
      id: 'dt-22', setup: 'tournament', title: 'Network: статус, Response и Payload',
      giver: { name: 'Распорядитель арены Кнут', sprite: '🏟️' }, gold: G(22),
      outro: 'Упавший запрос разбирают в три шага: статус — чья сторона, Response — что не понравилось серверу, Payload — что на самом деле отправил клиент.',
      steps: [
        { id: 'repro', text: 'Герои не могут записаться на турнир. Нажми <b>«Записаться»</b>.',
          check: (c) => app(c, 'signup-failed'),
          success: 'Страница пишет «Что-то пошло не так» — без подробностей. Разберёмся в Network.' },
        { id: 'status', text: 'Найди в <b>Network</b> запрос записи (красная строка). Какой у него статус?',
          answer: { kind: 'text', placeholder: 'код статуса', accept: (v) => v.trim().startsWith('422'), wrong: 'Посмотри колонку Status у запроса registrations или Status Code во вкладке Headers.' },
          success: '422 Unprocessable Content: сервер жив и понял запрос, но данные не прошли валидацию. 4xx — сначала смотрим, что отправил клиент.' },
        { id: 'resp', text: 'Открой <b>Response</b> (или <b>Preview</b>) этого запроса: что не понравилось серверу?',
          check: (c) => viewing(c, 'signup', 'response') || viewing(c, 'signup', 'preview'),
          success: 'VALIDATION_ERROR: поле birthDate, код INVALID_FORMAT — ожидается дата в формате YYYY-MM-DD.' },
        { id: 'payload', text: 'Теперь вкладка <b>Payload</b>: в каком виде ушла дата рождения?',
          check: (c) => viewing(c, 'signup', 'payload'),
          success: 'birthDate: "21.10.1998" — фронт отправил дату так, как её ввёл пользователь.' },
        { id: 'fix', text: 'Проверь гипотезу: впиши в поле дату в формате <code>1998-10-21</code> и снова нажми <b>«Записаться»</b>.',
          check: (c) => app(c, 'signup-ok'),
          success: '201 Created — с датой в формате API запись проходит.' },
        { id: 'verdict', text: 'Чей это баг и что в нём главное?',
          answer: {
            kind: 'choice',
            options: [
              'Бэкенд: сервер должен принимать дату в любом формате и отвечать 200.',
              'Фронтенд: поле подсказывает ДД.ММ.ГГГГ, но дата не конвертируется в формат API (YYYY-MM-DD); вдобавок вместо текста ошибки из ответа показывается общее «Что-то пошло не так».',
              'Сеть: запрос не дошёл до сервера.',
              'Пользователь ввёл неправильную дату.',
            ],
            accept: (v) => v === 1,
            wrong: 'Сравни, что требует сервер в Response, и что ушло в Payload.',
          },
          success: 'Верно. В репорт: URL и метод, статус 422, тело ответа с полем birthDate и Payload с отправленным значением.' },
      ],
      hints: [
        'Сначала воспроизведи баг, потом в Network выбери красную строку. У выбранного запроса есть вкладки Headers, Payload, Preview, Response.',
        'Статус — колонка Status или Headers → General → Status Code. Response — сырое тело ответа, Payload — тело запроса, которое отправил браузер.',
        'Записаться → Network: registrations → впиши 422 → Response: birthDate YYYY-MM-DD → Payload: "21.10.1998" → в поле <code>1998-10-21</code> → Записаться (201) → второй вариант.',
      ],
    },
    {
      id: 'dt-23', setup: 'logout', title: 'Cookies и Local Storage: выход из аккаунта',
      giver: { name: 'Привратник Сигурд', sprite: '🚪' }, gold: G(23),
      outro: 'Проверка выхода: access-токен удалён из хранилищ, refresh-cookie стёрта сервером, а повторный запрос с ней получает 401.',
      steps: [
        { id: 'repro', text: 'Жалоба: «Нажимаю <b>Выйти</b>, а через секунду снова в кабинете». Нажми «Выйти» и посмотри, что произойдёт.',
          check: (c) => app(c, 'auto-login'),
          success: 'На мгновение появилась форма входа — и снова кабинет.' },
        { id: 'ls', text: 'Открой <b>Application → Local storage</b> и выбери строку <code>token</code>. Токен удалился при выходе?',
          check: (c) => c.state.panel === 'application' && c.state.appSec === 'local' && c.state.appSel === 'token',
          success: 'Токен на месте, но другой — его записали заново уже после выхода. Значит, фронт удалил его, а кто-то выдал новый.' },
        { id: 'resp', text: 'В <b>Network</b> найди запрос, который вернул новый токен, и открой его <b>Response</b>.',
          check: (c) => viewing(c, 'refresh', 'response') || viewing(c, 'refresh', 'preview'),
          success: 'POST /api/auth/refresh — 200 и свежий access_token. Его отправил экран входа (Initiator: auth.js).' },
        { id: 'cookie-name', text: 'Посмотри <b>Headers → Request Headers</b> этого запроса: по какой cookie сервер выдал новый токен? Впиши её имя.',
          answer: { kind: 'text', placeholder: 'имя cookie', accept: (v) => /^refresh_token$/i.test(v.trim()), wrong: 'Смотри заголовок cookie в Request Headers запроса refresh.' },
          success: 'refresh_token: браузер сам прикладывает её к запросу.' },
        { id: 'cookies', text: 'Открой <b>Application → Cookies</b> и выбери <code>refresh_token</code>. Посмотри флаги и срок жизни.',
          check: (c) => c.state.panel === 'application' && c.state.appSec === 'cookies' && c.state.appSel === 'refresh_token',
          success: 'HttpOnly ✓ и Secure ✓, живёт месяц. JavaScript её не видит и стереть не может, а в ответе /api/logout нет Set-Cookie, который бы её удалил.' },
        { id: 'check', text: 'Проверь гипотезу: удали <code>refresh_token</code> (выбери строку → ✕) и снова нажми <b>«Выйти»</b>.',
          check: (c) => app(c, 'stay-out') && !c.state.cookies.some((k) => k.name === 'refresh_token'),
          success: 'Без cookie refresh отвечает 401, и пользователь остаётся на экране входа. Причина подтверждена.' },
        { id: 'verdict', text: 'Какой вывод в баг-репорте?',
          answer: {
            kind: 'choice',
            options: [
              'Фронтенд: при выходе не удаляется токен из localStorage.',
              'Бэкенд: /api/logout не отзывает refresh-токен и не стирает HttpOnly-cookie refresh_token (нет Set-Cookie с Max-Age=0), поэтому экран входа тут же получает новый access-токен.',
              'Браузер закэшировал страницу кабинета.',
              'Не баг: так работает «Запомнить меня».',
            ],
            accept: (v) => v === 1,
            wrong: 'Вспомни: токен из localStorage фронт удалил, а новый выдал /api/auth/refresh по cookie, которую logout не тронул.',
          },
          success: 'Верно. Ожидание: logout инвалидирует refresh-токен на сервере и удаляет cookie, повторный refresh — 401.' },
      ],
      hints: [
        'Local storage и Cookies — в разделе Storage вкладки Application. Network показывает, какие запросы ушли после клика «Выйти».',
        'Нужен запрос <code>refresh</code>: Response — тело ответа, Headers → Request Headers → строка cookie. Удалить cookie: выбери строку в Application → Cookies и нажми ✕ (Delete Selected).',
        'Выйти → Application → Local storage → token → Network: refresh → Response → Headers: впиши <code>refresh_token</code> → Application → Cookies → refresh_token → ✕ → Выйти → второй вариант.',
      ],
    },
    {
      id: 'dt-24', setup: 'history', title: 'Slow 3G: баг состояния загрузки',
      giver: { name: 'Курьер Альрик', sprite: '🐎' }, gold: G(24),
      outro: 'Индикаторы загрузки, пустые состояния и спиннеры проверяют на Slow 3G: на быстрой сети промежуточное состояние просто не успеть увидеть.',
      steps: [
        { id: 'throttle', text: 'Пользователи с плохой связью пишут: «Мои заказы пропали!», а потом заказы появляются. На офисной сети не воспроизводится. Включи в Network троттлинг <b>Slow 3G</b>.',
          check: (c) => c.state.throttle === 'slow3g',
          success: 'Сеть замедлена, как у пользователя в дороге.' },
        { id: 'reload', text: 'Перезагрузи страницу (⟳) и следи за списком заказов, пока идёт запрос.',
          check: (c) => app(c, 'slow-load'),
          success: 'Пару секунд на экране «У вас пока нет заказов», и только потом появился список.' },
        { id: 'timing', text: 'Выбери запрос <code>history</code> и открой вкладку <b>Timing</b>: сколько длится ожидание?',
          check: (c) => viewing(c, 'history', 'timing'),
          success: 'Больше двух секунд. Всё это время пользователь видит ложное пустое состояние.' },
        { id: 'cause', text: 'В чём баг?',
          answer: {
            kind: 'choice',
            options: [
              'Сервер медленно отвечает — это баг бэкенда.',
              'Фронт не различает «загружается» и «пусто»: до ответа сервера показывает пустое состояние «У вас пока нет заказов» вместо индикатора загрузки.',
              'Заказы удаляются и восстанавливаются на сервере.',
              'Не баг: у пользователя просто плохая связь.',
            ],
            accept: (v) => v === 1,
            wrong: 'Что видно на экране, пока запрос ещё в статусе (pending)?',
          },
          success: 'Верно. Ожидание: скелетон или спиннер до ответа, пустое состояние — только если сервер вернул пустой список.' },
        { id: 'restore', text: 'Верни <b>No throttling</b> и перезагрузи страницу — не оставляй троттлинг включённым после проверки.',
          check: (c) => { const ev = c.log.filter((e) => e.type === 'app' && /-load$/.test(e.name)); const last = ev[ev.length - 1]; return c.state.throttle === 'none' && !!last && last.name === 'fast-load'; },
          success: 'Обычная скорость вернулась. В репорт: условия (Slow 3G), шаги и что видно до ответа сервера.' },
      ],
      hints: [
        'Троттлинг — выпадающий список «No throttling» в панели инструментов Network. Он действует на запросы, пока DevTools открыты.',
        'Выбери Slow 3G, нажми ⟳ над страницей и смотри на блок заказов, пока у запроса history статус (pending). Timing — последняя вкладка у выбранного запроса.',
        'Slow 3G → ⟳ → «У вас пока нет заказов» на 2+ секунды → Network: history → Timing → второй вариант → No throttling → ⟳.',
      ],
    },
    {
      id: 'dt-25', setup: 'review', title: 'Offline и Replay XHR',
      giver: { name: 'Сказительница Тора', sprite: '📝' }, gold: G(25),
      outro: 'Проверка без сети: запрос падает с net::ERR_INTERNET_DISCONNECTED, и интерфейс должен сообщить об ошибке и дать повторить, а не зависнуть.',
      steps: [
        { id: 'offline', text: 'Пользователи в метро жалуются, что отзыв «отправляется вечно». Выбери в Network троттлинг <b>Offline</b>.',
          check: (c) => c.state.throttle === 'offline',
          success: 'Сеть выключена.' },
        { id: 'send', text: 'Напиши пару слов в поле <b>Отзыв</b> и нажми <b>«Отправить отзыв»</b>.',
          check: (c) => app(c, 'send-failed'),
          success: 'Кнопка застыла в «Отправка…» и неактивна. Пользователь не узнаёт, что отзыв не ушёл.' },
        { id: 'headers', text: 'Выбери в Network запрос <code>reviews</code> и посмотри <b>Headers</b>: какой у него статус?',
          check: (c) => { const r = c.state.selReq(); return viewing(c, 'review', 'headers') && !!r && !!r.failed; },
          success: '(failed) net::ERR_INTERNET_DISCONNECTED: ответа сервера нет вообще, вкладка Response пустая. В Console — Failed to fetch.' },
        { id: 'verdict', text: 'В чём баг?',
          answer: {
            kind: 'choice',
            options: [
              'Бэкенд не принимает отзывы.',
              'Фронт не обрабатывает сетевую ошибку: кнопка навсегда остаётся в «Отправка…», пользователю не показано сообщение и нельзя повторить отправку.',
              'Не баг: без интернета ничего и не должно работать.',
              'Отзыв слишком короткий.',
            ],
            accept: (v) => v === 1,
            wrong: 'Без сети запрос и должен упасть. Вопрос в том, что после этого видит пользователь.',
          },
          success: 'Верно. Ожидание: понятное сообщение «Нет соединения», кнопка снова активна или повтор при появлении сети.' },
        { id: 'replay', text: 'Убедись, что сервер в порядке: верни <b>No throttling</b> и повтори упавший запрос через <b>Replay XHR</b> (правый клик или ⋮).',
          check: (c) => has(c, 'replay', (e) => e.tag === 'review' && e.status === 201),
          success: '201 Created — отзыв принят. Значит, бэкенд работает, а баг только в обработке ошибки на фронте.' },
      ],
      hints: [
        'Режим Offline — в том же списке троттлинга, что и Slow 3G. Запросы падают сразу, а страница не перезагружается, пока ты сам её не обновишь.',
        'Упавший запрос в таблице — красная строка со статусом (failed). Меню запроса — правый клик по строке или ⋮ справа от вкладок; Replay XHR повторяет запрос с тем же телом.',
        'Offline → текст отзыва → Отправить → Network: reviews → Headers: (failed) → второй вариант → No throttling → ⋮ → Replay XHR (201).',
      ],
    },
  ];

  Quest.create({ mode: 'devtools', icon: '🔍', title: 'DevTools', buildSim, levels: LEVELS });
})();
