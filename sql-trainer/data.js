// Мир подземелья: Хроники (учебная база данных) и комнаты с монстрами (задачи).
window.DUNGEON = {
  schemaSql: `
    CREATE TABLE guilds (
      id    INTEGER PRIMARY KEY,
      name  TEXT NOT NULL,
      city  TEXT NOT NULL
    );
    CREATE TABLE heroes (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      class      TEXT NOT NULL,
      level      INTEGER NOT NULL,
      gold       INTEGER NOT NULL,
      guild_id   INTEGER REFERENCES guilds(id),
      mentor_id  INTEGER REFERENCES heroes(id)
    );
    CREATE TABLE quests (
      id          INTEGER PRIMARY KEY,
      title       TEXT NOT NULL,
      difficulty  INTEGER NOT NULL,
      reward      INTEGER NOT NULL,
      region      TEXT NOT NULL
    );
    CREATE TABLE quest_log (
      id            INTEGER PRIMARY KEY,
      hero_id       INTEGER REFERENCES heroes(id),
      quest_id      INTEGER REFERENCES quests(id),
      completed_on  TEXT NOT NULL
    );
    CREATE TABLE artifacts (
      id        INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      rarity    TEXT NOT NULL,
      power     INTEGER NOT NULL,
      owner_id  INTEGER REFERENCES heroes(id)
    );

    INSERT INTO guilds VALUES
      (1, 'Серебряный Клинок',      'Альтдорф'),
      (2, 'Орден Пепла',            'Кхарн'),
      (3, 'Лесные Тени',            'Эльвенхолл'),
      (4, 'Дом Совы',               'Альтдорф'),
      (5, 'Братство Пустого Котла', 'Кхарн');

    INSERT INTO heroes VALUES
      (1,  'Айра',    'Маг',     7,  420, 2,    5),
      (2,  'Борин',   'Воин',    9,  610, 1,    9),
      (3,  'Велена',  'Лучник',  5,  180, 3,    8),
      (4,  'Гримм',   'Воин',    4,   95, 1,    2),
      (5,  'Даэль',   'Маг',     11, 870, 4,    NULL),
      (6,  'Ессения', 'Жрец',    6,  300, 1,    NULL),
      (7,  'Жорен',   'Маг',     3,   60, 2,    1),
      (8,  'Зира',    'Лучник',  8,  540, 3,    NULL),
      (9,  'Ирвин',   'Воин',    12, 990, 2,    NULL),
      (10, 'Кайра',   'Маг',     2,   25, NULL, 5),
      (11, 'Лотар',   'Паладин', 10, 760, 4,    9),
      (12, 'Мирель',  'Жрец',    5,  210, 3,    6),
      (13, 'Ноэль',   'Плут',    6,  455, NULL, NULL),
      (14, 'Орвин',   'Воин',    7,  330, 1,    2),
      (15, 'Призма',  'Маг',     9,  650, 4,    5);

    INSERT INTO quests VALUES
      (1, 'Крысы в погребе',     1,  50, 'Альтдорф'),
      (2, 'Мост троллей',        3, 200, 'Кхарн'),
      (3, 'Проклятый курган',    4, 350, 'Эльвенхолл'),
      (4, 'Сердце вулкана',      5, 900, 'Кхарн'),
      (5, 'Тропа волков',        2, 120, 'Эльвенхолл'),
      (6, 'Тень над башней',     4, 400, 'Альтдорф'),
      (7, 'Проклятие мельника',  2,  90, 'Альтдорф');

    INSERT INTO quest_log VALUES
      (1,  1,  1, '2026-03-02'),
      (2,  2,  2, '2026-03-05'),
      (3,  9,  4, '2026-03-11'),
      (4,  5,  3, '2026-03-12'),
      (5,  8,  2, '2026-03-20'),
      (6,  2,  3, '2026-04-01'),
      (7,  6,  1, '2026-04-03'),
      (8,  11, 6, '2026-04-10'),
      (9,  15, 6, '2026-04-15'),
      (10, 3,  5, '2026-04-18'),
      (11, 9,  2, '2026-04-22');

    INSERT INTO artifacts VALUES
      (1, 'Посох бури',      'Эпический',   80, 5),
      (2, 'Кольцо искры',    'Обычный',     10, 7),
      (3, 'Щит рассвета',    'Редкий',      45, 2),
      (4, 'Лук ветра',       'Редкий',      40, 8),
      (5, 'Амулет тишины',   'Легендарный', 95, NULL),
      (6, 'Кинжал полуночи', 'Редкий',      35, 13),
      (7, 'Том забвения',    'Эпический',   70, 15),
      (8, 'Молот предков',   'Легендарный', 90, 9),
      (9, 'Свеча пророка',   'Обычный',     15, NULL);
  `,

  // Раскладка ER-схемы (координаты в viewBox схемы).
  diagram: {
    width: 724,
    height: 290,
    tables: {
      artifacts: { x: 8,   y: 8,   cols: [['id', 'INT', 'pk'], ['name', 'TEXT'], ['rarity', 'TEXT'], ['power', 'INT'], ['owner_id', 'INT', 'fk']] },
      guilds:    { x: 8,   y: 160, cols: [['id', 'INT', 'pk'], ['name', 'TEXT'], ['city', 'TEXT']] },
      heroes:    { x: 250, y: 28,  cols: [['id', 'INT', 'pk'], ['name', 'TEXT'], ['class', 'TEXT'], ['level', 'INT'], ['gold', 'INT'], ['guild_id', 'INT', 'fk'], ['mentor_id', 'INT', 'fk']] },
      quest_log: { x: 492, y: 8,   cols: [['id', 'INT', 'pk'], ['hero_id', 'INT', 'fk'], ['quest_id', 'INT', 'fk'], ['completed_on', 'TEXT']] },
      quests:    { x: 492, y: 150, cols: [['id', 'INT', 'pk'], ['title', 'TEXT'], ['difficulty', 'INT'], ['reward', 'INT'], ['region', 'TEXT']] },
    },
    // from/to: [таблица, колонка, сторона]; lane — x вертикального коридора связи
    links: [
      { from: ['artifacts', 'owner_id', 'right'], to: ['heroes', 'id', 'left'], lane: 229 },
      { from: ['heroes', 'guild_id', 'left'], to: ['guilds', 'id', 'right'], lane: 229 },
      { from: ['quest_log', 'hero_id', 'left'], to: ['heroes', 'id', 'right'], lane: 471 },
      { from: ['heroes', 'mentor_id', 'right'], to: ['heroes', 'id', 'right'], lane: 471 },
      { from: ['quest_log', 'quest_id', 'right'], to: ['quests', 'id', 'right'], lane: 710 },
    ],
  },

  // Звания мага: с какого уровня даются.
  ranks: [
    [1, 'Ученик'],
    [3, 'Адепт'],
    [5, 'Чародей'],
    [8, 'Магистр'],
    [11, 'Архимаг'],
  ],

  // Множитель добычи в зависимости от числа открытых подсказок.
  hintMultipliers: [1, 0.7, 0.4, 0.2],

  rooms: [
    {
      id: 'rat', monster: 'Крыса-трупоед', sprite: '🐀', spell: 'Призыв Имён', topic: 'SELECT',
      intro: 'Из-под груды костей выползает крыса размером с волка. Она голодна, и ты пахнешь едой. Первое заклинание любого ученика — Призыв Имён: вызови из Хроник имена павших героев, и их память отгонит тварь.',
      task: 'Выведи имя (<code>name</code>) и класс (<code>class</code>) всех героев.',
      tables: ['heroes'], ordered: false,
      solution: 'SELECT name, class FROM heroes',
      starter: 'SELECT * FROM heroes;',
      hints: [
        'После <code>SELECT</code> перечисляют нужные колонки через запятую, после <code>FROM</code> — таблицу.',
        'Колонки уже названы в задании: <code>name</code> и <code>class</code>. Таблица — <code>heroes</code>.',
        '<code>SELECT name, class FROM heroes</code>',
      ],
      taunts: ['Крыса вгрызается тебе в сапог.', 'Тварь пищит и бросается снова.'],
    },
    {
      id: 'skeleton', monster: 'Скелет-страж', sprite: '💀', spell: 'Печать Отбора', topic: 'WHERE',
      intro: 'Скелет в ржавом доспехе поднимает меч и шагает к тебе. Мёртвые боятся лишь магов. Призови из Хроник всех магов, и кости рассыплются в прах.',
      task: 'Выведи имя (<code>name</code>) и уровень (<code>level</code>) всех героев класса <b>Маг</b>.',
      tables: ['heroes'], ordered: false,
      solution: "SELECT name, level FROM heroes WHERE class = 'Маг'",
      starter: 'SELECT * FROM heroes;',
      hints: [
        'Отбирать строки помогает <code>WHERE</code>. Строки в SQL пишут в одинарных кавычках, регистр букв важен.',
        '<code>SELECT name, level FROM heroes WHERE …</code>',
        "Условие целиком: <code>WHERE class = 'Маг'</code>",
      ],
      taunts: ['Ржавый клинок задевает плечо.', 'Кости скрипят: «Ты станешь одним из нас».'],
    },
    {
      id: 'ghoul', monster: 'Гуль', sprite: '🧟', spell: 'Двойная Печать', topic: 'AND, сравнение чисел',
      intro: 'Гуль учуял кровь и ползёт к тебе на четвереньках. Его отпугивает дух закалённых, но не жадных: тех, кто силён, но не набил карманы.',
      task: 'Выведи имя, уровень и золото героев, у которых уровень <b>не ниже 8</b> и золота <b>меньше 800</b>.',
      tables: ['heroes'], ordered: false,
      solution: 'SELECT name, level, gold FROM heroes WHERE level >= 8 AND gold < 800',
      starter: 'SELECT name, level, gold FROM heroes;',
      hints: [
        'Два условия одновременно соединяют через <code>AND</code>. Для чисел есть <code>&gt;=</code>, <code>&lt;</code> и другие сравнения.',
        '<code>WHERE level … 8 AND gold … 800</code>',
        '<code>WHERE level &gt;= 8 AND gold &lt; 800</code>',
      ],
      taunts: ['Когти гуля рвут мантию.', 'Гуль облизывается: «Ещё немного…»'],
    },
    {
      id: 'goblin', monster: 'Гоблин-мародёр', sprite: '👺', spell: 'Строй и Предел', topic: 'ORDER BY, LIMIT',
      intro: 'Гоблин с ножом в зубах прыгает со стены. Он видит только блеск золота. Ослепи его сиянием трёх самых богатых кошельков подземелья.',
      task: 'Выведи имя и золото <b>трёх</b> самых богатых героев, от самого богатого.',
      tables: ['heroes'], ordered: true,
      solution: 'SELECT name, gold FROM heroes ORDER BY gold DESC LIMIT 3',
      starter: 'SELECT name, gold FROM heroes;',
      hints: [
        '<code>ORDER BY</code> сортирует, <code>DESC</code> — по убыванию. <code>LIMIT</code> оставляет первые N строк.',
        '<code>SELECT name, gold FROM heroes ORDER BY … LIMIT …</code>',
        '<code>ORDER BY gold DESC LIMIT 3</code>',
      ],
      taunts: ['Нож гоблина чиркает по рёбрам.', 'Гоблин хохочет и метит в горло.'],
    },
    {
      id: 'witch', monster: 'Болотная ведьма', sprite: '🧙‍♀️', spell: 'Круг Света', topic: 'IN',
      intro: 'Ведьма шепчет проклятие, и у тебя немеют пальцы. Её чары рвёт лишь свет служителей храма: жрецов и паладинов. Призови их.',
      task: 'Выведи имя и класс всех героев класса <b>Жрец</b> или <b>Паладин</b>.',
      tables: ['heroes'], ordered: false,
      solution: "SELECT name, class FROM heroes WHERE class IN ('Жрец', 'Паладин')",
      starter: 'SELECT name, class FROM heroes;',
      hints: [
        'Проверить «одно из нескольких значений» можно через <code>OR</code> или короче через <code>IN (…)</code>.',
        "<code>WHERE class IN ('…', '…')</code>",
        "<code>WHERE class IN ('Жрец', 'Паладин')</code>",
      ],
      taunts: ['Проклятие жжёт кожу.', 'Ведьма визжит: «Твои кости пойдут в котёл!»'],
    },
    {
      id: 'ghost', monster: 'Призрак', sprite: '👻', spell: 'Зеркало Отражений', topic: 'LIKE',
      intro: 'Призрак проходит сквозь стену и тянет к тебе ледяные руки. Он привязан к проклятым местам. Назови их, и он вернётся туда навсегда.',
      task: 'Выведи названия (<code>title</code>) заданий, в названии которых есть <b>«Проклят»</b>.',
      tables: ['quests'], ordered: false,
      solution: "SELECT title FROM quests WHERE title LIKE '%Проклят%'",
      starter: 'SELECT * FROM quests;',
      hints: [
        'Поиск по шаблону — <code>LIKE</code>. Знак <code>%</code> означает «любые символы».',
        "<code>WHERE title LIKE '…Проклят…'</code>",
        "<code>WHERE title LIKE '%Проклят%'</code>",
      ],
      taunts: ['Ледяное касание вытягивает тепло.', 'Призрак стонет прямо у тебя в голове.'],
    },
    {
      id: 'shade', monster: 'Тень-душительница', sprite: '🌑', spell: 'Зов Пустоты', topic: 'IS NULL',
      intro: 'Тень отделяется от стены и гасит твой факел. Она охотится на одиночек. Отдай ей имена тех, за кем не стоит ни одна гильдия, и она отвернётся от тебя.',
      task: 'Выведи имя и золото героев, у которых <b>нет гильдии</b>.',
      tables: ['heroes'], ordered: false,
      solution: 'SELECT name, gold FROM heroes WHERE guild_id IS NULL',
      starter: 'SELECT name, gold, guild_id FROM heroes;',
      hints: [
        'Пустое значение в SQL — <code>NULL</code>. Сравнение <code>= NULL</code> не работает никогда.',
        'Для проверки на пустоту есть особая форма: <code>IS NULL</code>.',
        '<code>WHERE guild_id IS NULL</code>',
      ],
      taunts: ['Тень сжимает горло холодными пальцами.', 'Тьма шепчет: «Ты тоже один».'],
    },
    {
      id: 'mimic', monster: 'Мимик', sprite: '📦', spell: 'Очищение', topic: 'DISTINCT',
      intro: 'Сундук распахивает пасть, полную зубов. Мимик повторяет всё, что видит, и от повторов только сильнее. Назови каждую редкость артефактов ровно один раз.',
      task: 'Выведи все виды редкости (<code>rarity</code>) артефактов <b>без повторов</b>.',
      tables: ['artifacts'], ordered: false,
      solution: 'SELECT DISTINCT rarity FROM artifacts',
      starter: 'SELECT * FROM artifacts;',
      hints: [
        'Убрать повторяющиеся строки помогает <code>DISTINCT</code> сразу после <code>SELECT</code>.',
        '<code>SELECT DISTINCT … FROM artifacts</code>',
        '<code>SELECT DISTINCT rarity FROM artifacts</code>',
      ],
      taunts: ['Крышка захлопывается на твоей руке.', 'Мимик передразнивает твой голос.'],
    },
    {
      id: 'ogre', monster: 'Огр', sprite: '👹', spell: 'Великий Счёт', topic: 'COUNT, MAX, SUM',
      intro: 'Огр крушит дубиной колонну, и с потолка сыплются камни. Грубую силу ломает точное знание. Одним заклинанием измерь всю мощь Хроник.',
      task: 'Одной строкой выведи: сколько всего героев, их <b>максимальный уровень</b> и <b>сумму золота</b> всех героев.',
      tables: ['heroes'], ordered: false,
      solution: 'SELECT COUNT(*), MAX(level), SUM(gold) FROM heroes',
      starter: 'SELECT * FROM heroes;',
      hints: [
        'Агрегатные функции сворачивают много строк в одну: <code>COUNT</code>, <code>MAX</code>, <code>SUM</code>, <code>AVG</code>, <code>MIN</code>.',
        '<code>SELECT COUNT(…), MAX(…), SUM(…) FROM heroes</code>',
        '<code>SELECT COUNT(*), MAX(level), SUM(gold) FROM heroes</code>',
      ],
      taunts: ['Дубина огра выбивает воздух из груди.', 'Огр ревёт и топчет пол.'],
    },
    {
      id: 'troll', boss: true, monster: 'Тролль-вожак', sprite: '🧌', spell: 'Сплетение', topic: 'GROUP BY',
      intro: 'Тролль-вожак регенерирует быстрее, чем ты успеваешь ранить. Остановит его лишь Сплетение: заклинание, что разбивает толпу на отряды и считает каждый.',
      task: 'Посчитай героев в каждом классе. Выведи класс и количество. Отсортируй по количеству <b>по убыванию</b>, при равенстве — по классу <b>по алфавиту</b>.',
      tables: ['heroes'], ordered: true,
      solution: 'SELECT class, COUNT(*) AS cnt FROM heroes GROUP BY class ORDER BY cnt DESC, class',
      starter: 'SELECT class FROM heroes;',
      hints: [
        'Чтобы считать по группам, используют <code>GROUP BY</code> вместе с <code>COUNT</code>. Сортировать можно по нескольким колонкам через запятую.',
        '<code>SELECT class, COUNT(*) FROM heroes GROUP BY … ORDER BY …, …</code>',
        '<code>GROUP BY class ORDER BY COUNT(*) DESC, class</code>',
      ],
      taunts: ['Тролль швыряет тебя об стену.', 'Раны тролля затягиваются на глазах.'],
    },
    {
      id: 'imp', monster: 'Бес-насмешник', sprite: '👿', spell: 'Клятва Силы', topic: 'HAVING',
      intro: 'Бес хохочет и бросает в тебя пригоршню адского пламени. Он презирает слабых. Покажи ему только те классы, что сильны в среднем, и его смех оборвётся.',
      task: 'Выведи классы, у которых <b>средний уровень больше 7</b>, и сам средний уровень.',
      tables: ['heroes'], ordered: false,
      solution: 'SELECT class, AVG(level) FROM heroes GROUP BY class HAVING AVG(level) > 7',
      starter: 'SELECT class, level FROM heroes;',
      hints: [
        '<code>WHERE</code> фильтрует строки до группировки, а <code>HAVING</code> фильтрует уже готовые группы.',
        '<code>SELECT class, AVG(level) FROM heroes GROUP BY class HAVING …</code>',
        '<code>HAVING AVG(level) &gt; 7</code>',
      ],
      taunts: ['Адское пламя опаляет мантию.', 'Бес кривляется: «Слабо, ученик!»'],
    },
    {
      id: 'vampire', monster: 'Вампир', sprite: '🧛', spell: 'Узы Крови', topic: 'JOIN',
      intro: 'Вампир возникает из стаи летучих мышей прямо у тебя за спиной. Его сила — в крови, слабость — в клятвах. Свяжи каждого героя с его гильдией, и узы обожгут его.',
      task: 'Выведи имя героя и <b>название его гильдии</b>. Героев без гильдии не выводи.',
      tables: ['heroes', 'guilds'], ordered: false,
      solution: 'SELECT h.name, g.name FROM heroes h JOIN guilds g ON g.id = h.guild_id',
      starter: 'SELECT name, guild_id FROM heroes;',
      hints: [
        '<code>JOIN</code> склеивает строки двух таблиц по условию в <code>ON</code>. Таблицам удобно давать короткие псевдонимы.',
        '<code>SELECT h.name, g.name FROM heroes h JOIN guilds g ON …</code>',
        '<code>ON g.id = h.guild_id</code>',
      ],
      taunts: ['Клыки вампира находят твою шею.', 'Вампир шепчет: «Твоя кровь сладка».'],
    },
    {
      id: 'banshee', monster: 'Банши', sprite: '🌫️', spell: 'Тёмные Узы', topic: 'LEFT JOIN',
      intro: 'Вопль банши раскалывает камни. Она оплакивает забытых. Назови все гильдии, даже ту, где не осталось ни одного живого, и её плач умолкнет.',
      task: 'Выведи название <b>каждой</b> гильдии и число героев в ней. Гильдии без героев тоже нужны, с числом 0.',
      tables: ['guilds', 'heroes'], ordered: false,
      solution: 'SELECT g.name, COUNT(h.id) FROM guilds g LEFT JOIN heroes h ON h.guild_id = g.id GROUP BY g.id, g.name',
      starter: 'SELECT * FROM guilds;',
      hints: [
        'Обычный <code>JOIN</code> теряет гильдии без героев. <code>LEFT JOIN</code> сохраняет все строки левой таблицы. <code>COUNT(колонка)</code> не считает <code>NULL</code>.',
        '<code>SELECT g.name, COUNT(h.id) FROM guilds g LEFT JOIN heroes h ON … GROUP BY …</code>',
        '<code>ON h.guild_id = g.id GROUP BY g.id, g.name</code>',
      ],
      taunts: ['Вопль банши разрывает барабанные перепонки.', 'Из глаз банши течёт туман и душит тебя.'],
    },
    {
      id: 'golem', boss: true, monster: 'Каменный голем', sprite: '🗿', spell: 'Печать Казны', topic: 'JOIN + GROUP BY + HAVING',
      intro: 'Голем выламывает себя из стены, и пол дрожит под его шагами. Его сердце выковано из золота гильдий. Узнай, какие казны питают его, и сердце треснет.',
      task: 'Для каждой гильдии посчитай суммарное золото её героев. Выведи название гильдии и сумму, только где сумма <b>больше 1000</b>. Отсортируй по сумме <b>по убыванию</b>.',
      tables: ['guilds', 'heroes'], ordered: true,
      solution: 'SELECT g.name, SUM(h.gold) AS total FROM guilds g JOIN heroes h ON h.guild_id = g.id GROUP BY g.id, g.name HAVING SUM(h.gold) > 1000 ORDER BY total DESC',
      starter: 'SELECT * FROM guilds;',
      hints: [
        'Золото хранится в <code>heroes</code>, названия — в <code>guilds</code>. Соедини их, сгруппируй по гильдии, а условие на сумму поставь в <code>HAVING</code>.',
        '<code>SELECT g.name, SUM(h.gold) FROM guilds g JOIN heroes h ON h.guild_id = g.id GROUP BY … HAVING … ORDER BY …</code>',
        '<code>GROUP BY g.id, g.name HAVING SUM(h.gold) &gt; 1000 ORDER BY SUM(h.gold) DESC</code>',
      ],
      taunts: ['Каменный кулак отбрасывает тебя на три шага.', 'Голем гудит, и стены трескаются.'],
    },
    {
      id: 'necro', monster: 'Некромант', sprite: '☠️', spell: 'Тройные Узы', topic: 'JOIN трёх таблиц',
      intro: 'Некромант поднимает павших одного за другим. Сорви ритуал: назови живых героев, что прошли самые опасные задания, и мёртвые лягут обратно.',
      task: 'Выведи имя героя и название задания для всех выполненных заданий со сложностью <b>4 и выше</b>.',
      tables: ['heroes', 'quest_log', 'quests'], ordered: false,
      solution: 'SELECT h.name, q.title FROM quest_log l JOIN heroes h ON h.id = l.hero_id JOIN quests q ON q.id = l.quest_id WHERE q.difficulty >= 4',
      starter: 'SELECT * FROM quest_log;',
      hints: [
        '<code>quest_log</code> — связующая таблица: в ней есть и герой, и задание. Присоедини к ней обе таблицы двумя <code>JOIN</code>.',
        '<code>FROM quest_log l JOIN heroes h ON … JOIN quests q ON … WHERE …</code>',
        '<code>JOIN heroes h ON h.id = l.hero_id JOIN quests q ON q.id = l.quest_id WHERE q.difficulty &gt;= 4</code>',
      ],
      taunts: ['Мёртвые руки хватают тебя за ноги.', 'Некромант смеётся: «Ты встанешь в мой строй».'],
    },
    {
      id: 'minotaur', monster: 'Минотавр', sprite: '🐂', spell: 'Малый Круг', topic: 'Подзапрос',
      intro: 'Минотавр мчится на тебя по коридору лабиринта, опустив рога. Лабиринт отпускает лишь тех, кто знает меру. Найди тех, кто богаче среднего, и стены расступятся.',
      task: 'Выведи имя и золото героев, у которых золота <b>больше среднего</b> по всем героям.',
      tables: ['heroes'], ordered: false,
      solution: 'SELECT name, gold FROM heroes WHERE gold > (SELECT AVG(gold) FROM heroes)',
      starter: 'SELECT AVG(gold) FROM heroes;',
      hints: [
        'Внутри условия можно выполнить ещё один запрос в скобках. Это подзапрос.',
        '<code>WHERE gold &gt; (SELECT … FROM heroes)</code>',
        '<code>WHERE gold &gt; (SELECT AVG(gold) FROM heroes)</code>',
      ],
      taunts: ['Рога минотавра пробивают твой щит.', 'Минотавр ревёт, и эхо сбивает тебя с ног.'],
    },
    {
      id: 'lich', monster: 'Лич', sprite: '⚰️', spell: 'Отрицание', topic: 'NOT EXISTS / NOT IN',
      intro: 'Лич поднимается из саркофага, и свечи гаснут. Его филактерия видит каждого, кто держит артефакт. Найди тех, у кого нет ни одного, — только их лич не может проклясть.',
      task: 'Выведи имена героев, у которых <b>нет ни одного артефакта</b>.',
      tables: ['heroes', 'artifacts'], ordered: false,
      solution: 'SELECT name FROM heroes h WHERE NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.owner_id = h.id)',
      starter: 'SELECT * FROM artifacts;',
      hints: [
        'Подойдёт <code>NOT EXISTS</code> или <code>NOT IN</code>. Осторожно: если в подзапросе для <code>NOT IN</code> есть <code>NULL</code>, результат будет пустым.',
        '<code>WHERE NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.owner_id = …)</code>',
        '<code>SELECT name FROM heroes h WHERE NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.owner_id = h.id)</code>',
      ],
      taunts: ['Лич выпивает часть твоей души.', 'Ледяной голос: «Вечность терпелива».'],
    },
    {
      id: 'chimera', monster: 'Химера', sprite: '🦁', spell: 'Развилка Судеб', topic: 'CASE',
      intro: 'Три головы химеры бьют одновременно: лев, козёл и змея. Каждая голова видит своё. Дай каждому герою звание, и головы перегрызутся между собой.',
      task: 'Для каждого героя выведи имя и звание: <b>Ветеран</b> (уровень 10+), <b>Опытный</b> (5–9), <b>Новичок</b> (ниже 5).',
      tables: ['heroes'], ordered: false,
      solution: "SELECT name, CASE WHEN level >= 10 THEN 'Ветеран' WHEN level >= 5 THEN 'Опытный' ELSE 'Новичок' END FROM heroes",
      starter: 'SELECT name, level FROM heroes;',
      hints: [
        'Выбор значения по условиям — <code>CASE WHEN … THEN … ELSE … END</code>. Условия проверяются сверху вниз.',
        "<code>CASE WHEN level &gt;= 10 THEN 'Ветеран' WHEN … THEN 'Опытный' ELSE … END</code>",
        "<code>SELECT name, CASE WHEN level &gt;= 10 THEN 'Ветеран' WHEN level &gt;= 5 THEN 'Опытный' ELSE 'Новичок' END FROM heroes</code>",
      ],
      taunts: ['Змеиная голова жалит в руку.', 'Львиный рык сотрясает подземелье.'],
    },
    {
      id: 'doppel', monster: 'Двойник', sprite: '🎭', spell: 'Зеркальные Узы', topic: 'Self JOIN',
      intro: 'Из зеркала выходит твоё отражение и улыбается твоей улыбкой. Двойника побеждает знание связей внутри одного рода. Назови каждого ученика и его наставника.',
      task: 'Выведи имя героя и <b>имя его наставника</b>. Героев без наставника не выводи.',
      tables: ['heroes'], ordered: false,
      solution: 'SELECT s.name, m.name FROM heroes s JOIN heroes m ON m.id = s.mentor_id',
      starter: 'SELECT name, mentor_id FROM heroes;',
      hints: [
        'Таблицу можно соединить саму с собой, если дать ей два разных псевдонима: ученик и наставник.',
        '<code>FROM heroes s JOIN heroes m ON …</code>',
        '<code>SELECT s.name, m.name FROM heroes s JOIN heroes m ON m.id = s.mentor_id</code>',
      ],
      taunts: ['Двойник повторяет твоё заклинание против тебя.', 'Отражение шепчет: «Я — лучшая версия тебя».'],
    },
    {
      id: 'dragon', boss: true, monster: 'Дракон Агрегатор', sprite: '🐉', spell: 'Око Дракона', topic: 'Оконные функции / CTE',
      intro: 'Древний дракон просыпается на горе золота, и пламя заливает зал. Пробить его чешую может лишь запретное заклинание: найти сильнейшего в каждом роду.',
      task: 'Для каждой гильдии найди <b>самого богатого героя</b>. Выведи его имя, название гильдии и золото. Отсортируй по золоту <b>по убыванию</b>.',
      tables: ['heroes', 'guilds'], ordered: true,
      solution: 'WITH r AS (SELECT h.name, g.name AS guild, h.gold, ROW_NUMBER() OVER (PARTITION BY g.id ORDER BY h.gold DESC) AS rn FROM heroes h JOIN guilds g ON g.id = h.guild_id) SELECT name, guild, gold FROM r WHERE rn = 1 ORDER BY gold DESC',
      starter: 'SELECT h.name, g.name, h.gold FROM heroes h JOIN guilds g ON g.id = h.guild_id;',
      hints: [
        'Можно пронумеровать героев внутри каждой гильдии оконной функцией <code>ROW_NUMBER() OVER (PARTITION BY … ORDER BY …)</code> и оставить первых. Или сравнить золото с <code>MAX</code> по гильдии через подзапрос.',
        '<code>WITH r AS (SELECT …, ROW_NUMBER() OVER (PARTITION BY g.id ORDER BY h.gold DESC) AS rn FROM … ) SELECT … FROM r WHERE rn = 1 ORDER BY …</code>',
        '<code>WITH r AS (SELECT h.name, g.name AS guild, h.gold, ROW_NUMBER() OVER (PARTITION BY g.id ORDER BY h.gold DESC) AS rn FROM heroes h JOIN guilds g ON g.id = h.guild_id) SELECT name, guild, gold FROM r WHERE rn = 1 ORDER BY gold DESC</code>',
      ],
      taunts: ['Драконье пламя охватывает тебя целиком.', 'Хвост дракона сносит колонну рядом с тобой.'],
    },
  ],
};

// Сила монстров и награда растут от комнаты к комнате.
const TROPHIES = ['Крысиный хвост', 'Ржавый шлем', 'Коготь гуля', 'Нож гоблина', 'Ведьмин амулет', 'Призрачная цепь',
  'Осколок тьмы', 'Зуб мимика', 'Дубина огра', 'Сердце тролля', 'Рог беса', 'Клык вампира', 'Слеза банши',
  'Золотое сердце голема', 'Посох некроманта', 'Рог минотавра', 'Филактерия лича', 'Грива химеры', 'Осколок зеркала',
  'Чешуя Агрегатора'];
window.DUNGEON.rooms.forEach((r, i) => {
  r.floor = r.boss ? `Логово · ${i + 1}` : `Зал ${i + 1}`;
  r.maxHp = 80 + i * 20 + (r.boss ? 60 : 0);
  r.attack = Math.round((10 + i * 1.8) * (r.boss ? 1.3 : 1));
  r.gold = 40 + i * 20 + (r.boss ? 100 : 0);
  r.xp = 30 + i * 12 + (r.boss ? 60 : 0);
  r.trophy = { name: TROPHIES[i], icon: r.sprite };
});
