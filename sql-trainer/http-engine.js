// Движок режима «HTTP»: разбирает сырой HTTP-запрос, отправляет его в имитацию сервера «Хроники API»
// (sims/api-mock.js) и сравнивает с эталонным запросом задания.
// Формат запроса:
//   POST /heroes                       ← метод и путь (или полный URL https://api.chronicles.guild/v1/heroes)
//   Authorization: Bearer tok_7f3a9c21 ← заголовки, по одному на строку
//                                      ← пустая строка
//   {"name": "Ли", ...}                ← тело
(function (root) {
  'use strict';

  const ORIGIN = 'https://api.chronicles.guild';
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

  function parse(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    let i = 0;
    while (i < lines.length && !lines[i].trim()) i++;
    if (i >= lines.length) return { error: 'Запрос пуст: начни со строки «МЕТОД /путь», например GET /heroes.' };
    const first = lines[i].trim().split(/\s+/);
    const method = first[0].toUpperCase();
    if (!METHODS.includes(method)) return { error: `«${first[0]}» — не HTTP-метод. Первая строка: МЕТОД /путь, например GET /heroes.` };
    const target = first[1];
    if (!target) return { error: 'После метода нужен путь, например GET /heroes.' };
    if (first.length > 3 || (first[2] && !/^HTTP\/\d(\.\d)?$/i.test(first[2]))) return { error: 'В первой строке лишнее: только МЕТОД /путь (можно добавить HTTP/1.1). Пробелы в пути не допускаются.' };
    let url;
    try {
      if (/^https?:\/\//i.test(target)) url = new URL(target);
      else if (target.startsWith('/')) url = new URL((/^\/v\d(\/|$)/.test(target) ? ORIGIN : ORIGIN + '/v1') + target);
      else return { error: 'Путь начинается с «/», например /heroes, или это полный URL.' };
    } catch (e) {
      return { error: 'Не получилось разобрать URL.' };
    }
    const headers = {};
    i++;
    for (; i < lines.length && lines[i].trim(); i++) {
      const m = lines[i].match(/^\s*([A-Za-z0-9-]+)\s*:\s*(.*)$/);
      if (!m) return { error: `Строка «${lines[i].trim()}» — не заголовок. Заголовок пишется как «Имя: значение»; тело отделяется пустой строкой.` };
      headers[m[1]] = m[2].trim();
    }
    const body = lines.slice(i + 1).join('\n').trim();
    return { method, url, headers, body };
  }

  const lowerKeys = (h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
  const queryOf = (url) => [...url.searchParams.entries()].map(([k, v]) => k + '=' + v).sort();
  const pathOf = (url) => url.pathname.replace(/\/+$/, '') || '/';
  const media = (v) => String(v).split(';')[0].trim().toLowerCase();

  function sameJson(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameJson(a[k], b[k]));
  }

  function send(req) {
    const api = root.MockApi.create();
    return api.handle({ method: req.method, url: req.url.href, headers: req.headers, body: req.body });
  }

  // Сравнение с эталоном: метод, путь, параметры, нужные заголовки, тело и в конце — статус ответа.
  // Лишние безобидные заголовки (например, Accept) разрешены, если ответ сервера от них не меняется.
  function check(task, text) {
    const u = parse(text);
    if (u.error) return { ok: false, reason: u.error };
    const a = parse(task.answer);
    const res = send(u);
    const out = (ok, reason) => ({ ok, reason, req: u, res });
    if (res.networkError) return out(false, `Сервер не найден (${res.networkError}). Базовый адрес — ${ORIGIN}/v1.`);
    if (u.method !== a.method) return out(false, `Метод не тот: ${u.method}. Подумай, какое действие нужно над ресурсом.`);
    if (pathOf(u.url) !== pathOf(a.url)) return out(false, `Путь не тот: ${decodeURIComponent(pathOf(u.url))}.`);
    const uq = queryOf(u.url);
    const aq = queryOf(a.url);
    if (uq.join('&') !== aq.join('&')) {
      const miss = aq.filter((x) => !uq.includes(x));
      const extra = uq.filter((x) => !aq.includes(x));
      return out(false, miss.length ? `Параметры запроса: не хватает или неверно — ${miss.map((x) => x.split('=')[0]).join(', ')}.` : `Лишние параметры запроса: ${extra.map((x) => x.split('=')[0]).join(', ')}.`);
    }
    const uh = lowerKeys(u.headers);
    const ah = lowerKeys(a.headers);
    for (const [k, v] of Object.entries(ah)) {
      if (uh[k] === undefined) return out(false, `Не хватает заголовка ${k.replace(/(^|-)\w/g, (s) => s.toUpperCase())}.`);
      const same = k === 'content-type' || k === 'accept' ? media(uh[k]) === media(v) : uh[k] === v;
      if (!same) return out(false, `Заголовок ${k.replace(/(^|-)\w/g, (s) => s.toUpperCase())} с неверным значением.`);
    }
    if (a.body) {
      if (!u.body) return out(false, 'Не хватает тела запроса (после заголовков — пустая строка, затем JSON).');
      let aj;
      let uj;
      try { aj = JSON.parse(a.body); } catch (e) { aj = undefined; }
      if (aj !== undefined) {
        try { uj = JSON.parse(u.body); } catch (e) { return out(false, 'Тело — невалидный JSON: проверь кавычки, запятые и скобки.'); }
        if (!sameJson(aj, uj)) return out(false, 'Тело запроса не совпадает с заданием: проверь поля, значения и типы (число без кавычек).');
      } else if (u.body !== a.body) return out(false, 'Тело запроса не совпадает с заданием.');
    } else if (u.body) return out(false, 'У этого запроса не должно быть тела.');
    const want = send(a);
    if (res.status !== want.status) return out(false, `Сервер ответил ${res.status}, а по заданию ждём ${want.status}. Лишний или неверный заголовок?`);
    return out(true, '');
  }

  const HttpEngine = { ORIGIN, parse, check, send };
  if (typeof module !== 'undefined' && module.exports) module.exports = HttpEngine;
  else root.HttpEngine = HttpEngine;
})(typeof window !== 'undefined' ? window : globalThis);
