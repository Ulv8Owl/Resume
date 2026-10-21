// Осада, бой «Штурм стены»: задания для мини-Postman. Игрок свободно шлёт запросы (бесплатно), а кнопкой
// «Сдать» проверяется результат по истории запросов, переменным окружения, тестам и ответу в поле «Ответ».
// check(ctx) → true или текст, чего не хватает. ctx: { history, env, answer }, где запись истории:
// { method, url (URL после подстановки), rawUrl, headers (имена в нижнем регистре), raw (как написано, с {{…}}),
//   body, json (тело как объект или null), res: { status, headers, body, json }, tests: [{ name, pass }], testsCode }.
(function () {
  'use strict';

  const M = window.MockApi;
  const ENV = () => [{ key: 'baseUrl', value: 'https://api.chronicles.guild/v1' }, { key: 'token', value: '' }];
  const path = (e) => e.url.pathname.replace(/^\/v1/, '').replace(/\/$/, '');
  const q = (e, k) => e.url.searchParams.get(k);
  const ok = (e) => e.res && e.res.status;
  const testsGreen = (e) => e.tests.length > 0 && e.tests.every((t) => t.pass);
  const find = (ctx, fn) => ctx.history.filter((e) => ok(e) && fn(e)).pop();

  window.SIEGE_PM = [
    {
      q: 'Через вкладку <b>Params</b> (а не руками в URL) запроси предметы редкости <code>epic</code> по 2 на страницу: <code>rarity=epic</code>, <code>limit=2</code>. Сколько всего эпических предметов в базе? Ответ найди во вкладке <b>Headers</b> ответа и впиши в поле «Ответ».',
      hint: 'Сервер отдаёт только 2 предмета, но общее количество сообщает заголовком X-Total-Count.',
      solution: 'GET {{baseUrl}}/items, Params: rarity = epic, limit = 2 → Send. В Headers ответа X-Total-Count: 5. Ответ: 5.',
      answerLabel: 'Сколько всего эпических предметов',
      env: ENV(),
      check(ctx) {
        const e = find(ctx, (x) => x.method === 'GET' && path(x) === '/items' && q(x, 'rarity') === 'epic' && q(x, 'limit') === '2' && x.res.status === 200);
        if (!e) return 'Нет успешного GET /items с параметрами rarity=epic и limit=2.';
        if (ctx.answer.trim() !== String(e.res.headers['x-total-count'])) return 'Ответ не совпадает с тем, что сообщил сервер. Загляни во вкладку Headers ответа.';
        return true;
      },
    },
    {
      q: 'Настрой авторизацию как в реальном проекте. 1) Залогинься: <code>POST {{baseUrl}}/auth/login</code>, тело <code>{"login": "mage", "password": "chronicles"}</code>, а во вкладке <b>Tests</b> сохрани токен из ответа в переменную окружения <code>token</code>. 2) Запроси <code>GET {{baseUrl}}/me</code>, указав во вкладке <b>Authorization</b> тип Bearer Token и значение <code>{{token}}</code> (не вставляй токен руками).',
      hint: 'В Tests: pm.environment.set("token", pm.response.json().token); — после Send переменная появится в окружении (кнопка 👁).',
      solution: 'Login → Tests: pm.environment.set("token", pm.response.json().token); → Send. Затем GET {{baseUrl}}/me, Authorization: Bearer Token = {{token}} → Send (200, role tester).',
      env: ENV(),
      check(ctx) {
        if (ctx.env.token !== M.TOKEN) return 'В окружении нет переменной token с токеном мага: сохрани её скриптом в Tests после логина.';
        const e = find(ctx, (x) => x.method === 'GET' && path(x) === '/me' && x.res.status === 200 && /\{\{\s*token\s*\}\}/.test(x.raw.auth || ''));
        if (!e) return 'Нет успешного GET /me, где во вкладке Authorization стоит {{token}}.';
        return true;
      },
    },
    {
      q: 'Создай гильдию «Стражи Шара»: <code>POST {{baseUrl}}/guilds</code>, тело <code>{"name": "Стражи Шара", "motto": "Шар не погаснет"}</code>, токен — в окружении (<code>{{token}}</code>). Во вкладке <b>Tests</b> напиши два теста: статус ответа <code>201</code> и что в теле есть поле <code>id</code>. Оба теста должны пройти.',
      hint: 'pm.test("201", () => pm.response.to.have.status(201)); pm.test("Есть id", () => pm.expect(pm.response.json()).to.have.property("id"));',
      solution: 'POST {{baseUrl}}/guilds, Authorization: Bearer {{token}}, Body raw JSON → Tests:\npm.test("201", () => pm.response.to.have.status(201));\npm.test("Есть id", () => pm.expect(pm.response.json()).to.have.property("id"));',
      env: [{ key: 'baseUrl', value: 'https://api.chronicles.guild/v1' }, { key: 'token', value: M.TOKEN }],
      check(ctx) {
        const e = find(ctx, (x) => x.method === 'POST' && path(x) === '/guilds' && x.res.status === 201 && x.json && x.json.name === 'Стражи Шара');
        if (!e) return 'Гильдия «Стражи Шара» ещё не создана (нужен ответ 201).';
        if (e.tests.length < 2) return 'В Tests нужно минимум два теста pm.test.';
        if (!testsGreen(e)) return 'Не все тесты зелёные — открой Test Results.';
        if (!/201/.test(e.testsCode) || !/\bid\b/.test(e.testsCode)) return 'Тесты должны проверять статус 201 и поле id.';
        return true;
      },
    },
    {
      q: 'По документации цена предмета <code>price</code> — от 1 до 10000. Проверь <b>верхнюю границу</b> на <code>POST {{baseUrl}}/items</code> (токен в окружении): отправь предмет с ценой ровно 10000 и с ценой 10001, остальные поля — <code>"name": "Щит осады", "rarity": "rare"</code>. Какой статус вернул сервер на 10001? Впиши код в поле «Ответ» — и подумай, баг ли это.',
      hint: 'Граница проверяется парой: значение на границе (10000) и сразу за ней (10001). За границей сервер обязан отказать.',
      solution: 'Два POST /items с Bearer {{token}}: price 10000 → 201, price 10001 → 201. Ответ: 201 — это баг, должно быть 422.',
      answerLabel: 'Код ответа на price = 10001',
      env: [{ key: 'baseUrl', value: 'https://api.chronicles.guild/v1' }, { key: 'token', value: M.TOKEN }],
      bugs: { priceNoMax: true },
      done: 'Сервер принял 10001 — это баг: верхняя граница не проверяется. В отчёте: ожидали 422, получили 201.',
      check(ctx) {
        const post = (p) => find(ctx, (x) => x.method === 'POST' && path(x) === '/items' && x.json && x.json.price === p && x.json.name === 'Щит осады' && x.json.rarity === 'rare');
        const a = post(10000);
        const b = post(10001);
        if (!a || !b) return 'Нужны оба запроса: price = 10000 и price = 10001 (число, не строка), name «Щит осады», rarity rare.';
        if (ctx.answer.trim() !== String(b.res.status)) return 'Код в поле «Ответ» не совпадает с ответом сервера на 10001.';
        return true;
      },
    },
    {
      q: 'Проверь права ролей. Залогинься читателем (<code>{"login": "scribe", "password": "quill"}</code>) и в Tests сохрани его токен в переменную окружения <code>reader</code>. Затем попробуй удалить предмет: <code>DELETE {{baseUrl}}/items/3</code> с Bearer <code>{{reader}}</code> и тестом, что сервер отвечает <code>403</code>. Тест должен пройти.',
      hint: 'Логин читателя: pm.environment.set("reader", pm.response.json().token); Удаление: Authorization → Bearer Token = {{reader}}, Tests: pm.response.to.have.status(403).',
      solution: 'POST /auth/login (scribe/quill), Tests: pm.environment.set("reader", pm.response.json().token);\nDELETE {{baseUrl}}/items/3, Authorization: Bearer {{reader}}, Tests: pm.test("403", () => pm.response.to.have.status(403));',
      env: ENV(),
      check(ctx) {
        if (ctx.env.reader !== M.READER_TOKEN) return 'В окружении нет переменной reader с токеном читателя.';
        const e = find(ctx, (x) => x.method === 'DELETE' && path(x) === '/items/3' && /\{\{\s*reader\s*\}\}/.test(x.raw.auth || ''));
        if (!e) return 'Нет запроса DELETE /items/3 с {{reader}} во вкладке Authorization.';
        if (e.res.status !== 403) return `Сервер ответил ${e.res.status}, а ждём 403.`;
        if (!testsGreen(e) || !/403/.test(e.testsCode)) return 'Нужен зелёный тест на статус 403.';
        return true;
      },
    },
    {
      q: 'Получи открытые квесты северного региона на английском: <code>GET {{baseUrl}}/quests</code>, параметр <code>status=open</code>, заголовки <code>X-Realm: north</code> и <code>Accept-Language: en</code> (вкладка <b>Headers</b>). Как по-английски называется квест с наградой 450? Впиши название в поле «Ответ».',
      hint: 'Без X-Realm сервер ответит 400. Accept-Language переключает язык названий.',
      solution: 'GET {{baseUrl}}/quests?status=open, Headers: X-Realm = north, Accept-Language = en → квест с reward 450: Heart of the Blizzard.',
      answerLabel: 'Название квеста',
      env: ENV(),
      check(ctx) {
        const e = find(ctx, (x) => x.method === 'GET' && path(x) === '/quests' && q(x, 'status') === 'open' && x.headers['x-realm'] === 'north' && /^en/i.test(x.headers['accept-language'] || '') && x.res.status === 200);
        if (!e) return 'Нет успешного GET /quests?status=open с заголовками X-Realm: north и Accept-Language: en.';
        const quest = (e.res.json || []).find((x) => x.reward === 450);
        if (!quest || ctx.answer.trim().toLowerCase() !== quest.title.toLowerCase()) return 'Название в поле «Ответ» не совпадает с ответом сервера.';
        return true;
      },
    },
  ];
})();
