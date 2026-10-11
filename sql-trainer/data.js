// Мир подземелья: Хроники (учебная база данных), звания мага и акты.
// Сами комнаты лежат в rooms-act1.js, rooms-act2.js, rooms-act3.js.
window.DUNGEON = {
  schemaSql: `
    CREATE TABLE guilds (
      id       INTEGER PRIMARY KEY,
      name     TEXT NOT NULL,
      city     TEXT NOT NULL,
      founded  INTEGER
    );
    CREATE TABLE heroes (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      class      TEXT NOT NULL,
      level      INTEGER NOT NULL,
      gold       INTEGER NOT NULL,
      guild_id   INTEGER REFERENCES guilds(id),
      mentor_id  INTEGER REFERENCES heroes(id),
      joined_on  TEXT
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
    CREATE TABLE ledger (
      id       INTEGER PRIMARY KEY,
      hero_id  INTEGER REFERENCES heroes(id),
      amount   INTEGER NOT NULL,
      note     TEXT
    );

    INSERT INTO guilds VALUES
      (1, 'Серебряный Клинок',      'Альтдорф',   1102),
      (2, 'Орден Пепла',            'Кхарн',       987),
      (3, 'Лесные Тени',            'Эльвенхолл', 1150),
      (4, 'Дом Совы',               'Альтдорф',   1033),
      (5, 'Братство Пустого Котла', 'Кхарн',      1201);

    INSERT INTO heroes VALUES
      (1,  'Айра',    'Маг',     7,  420, 2,    5,    '2019-05-14'),
      (2,  'Борин',   'Воин',    9,  610, 1,    9,    '2016-03-02'),
      (3,  'Велена',  'Лучник',  5,  180, 3,    8,    '2021-07-19'),
      (4,  'Гримм',   'Воин',    4,   95, 1,    2,    '2022-11-30'),
      (5,  'Даэль',   'Маг',     11, 870, 4,    NULL, '2014-01-08'),
      (6,  'Ессения', 'Жрец',    6,  300, 1,    NULL, '2018-09-23'),
      (7,  'Жорен',   'Маг',     3,   60, 2,    1,    '2023-02-11'),
      (8,  'Зира',    'Лучник',  8,  540, 3,    NULL, '2017-06-05'),
      (9,  'Ирвин',   'Воин',    12, 990, 2,    NULL, '2013-10-17'),
      (10, 'Кайра',   'Маг',     2,   25, NULL, 5,    '2024-04-01'),
      (11, 'Лотар',   'Паладин', 10, 760, 4,    9,    '2015-12-12'),
      (12, 'Мирель',  'Жрец',    5,  210, 3,    6,    '2020-08-28'),
      (13, 'Ноэль',   'Плут',    6,  455, NULL, NULL, '2019-02-03'),
      (14, 'Орвин',   'Воин',    7,  330, 1,    2,    '2021-01-15'),
      (15, 'Призма',  'Маг',     9,  650, 4,    5,    '2016-11-20');

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

    INSERT INTO ledger VALUES
      (1, 9,  900, 'Награда: Сердце вулкана'),
      (2, 2,  200, 'Награда: Мост троллей'),
      (3, 2, -150, 'Ремонт доспехов'),
      (4, 5,  350, 'Награда: Проклятый курган'),
      (5, 13, -40, 'Штраф стражи'),
      (6, 7,   25, 'Находка в погребе');
  `,

  // Раскладка ER-схемы (координаты в viewBox схемы).
  diagram: {
    width: 724,
    height: 344,
    tables: {
      artifacts: { x: 8,   y: 8,   cols: [['id', 'INT', 'pk'], ['name', 'TEXT'], ['rarity', 'TEXT'], ['power', 'INT'], ['owner_id', 'INT', 'fk']] },
      guilds:    { x: 8,   y: 160, cols: [['id', 'INT', 'pk'], ['name', 'TEXT'], ['city', 'TEXT'], ['founded', 'INT']] },
      heroes:    { x: 250, y: 28,  cols: [['id', 'INT', 'pk'], ['name', 'TEXT'], ['class', 'TEXT'], ['level', 'INT'], ['gold', 'INT'], ['guild_id', 'INT', 'fk'], ['mentor_id', 'INT', 'fk'], ['joined_on', 'TEXT']] },
      ledger:    { x: 250, y: 232, cols: [['id', 'INT', 'pk'], ['hero_id', 'INT', 'fk'], ['amount', 'INT'], ['note', 'TEXT']] },
      quest_log: { x: 492, y: 8,   cols: [['id', 'INT', 'pk'], ['hero_id', 'INT', 'fk'], ['quest_id', 'INT', 'fk'], ['completed_on', 'TEXT']] },
      quests:    { x: 492, y: 150, cols: [['id', 'INT', 'pk'], ['title', 'TEXT'], ['difficulty', 'INT'], ['reward', 'INT'], ['region', 'TEXT']] },
    },
    // from/to: [таблица, колонка, сторона]; lane — x вертикального коридора связи
    links: [
      { from: ['artifacts', 'owner_id', 'right'], to: ['heroes', 'id', 'left'], lane: 229 },
      { from: ['heroes', 'guild_id', 'left'], to: ['guilds', 'id', 'right'], lane: 229 },
      { from: ['quest_log', 'hero_id', 'left'], to: ['heroes', 'id', 'right'], lane: 471 },
      { from: ['heroes', 'mentor_id', 'right'], to: ['heroes', 'id', 'right'], lane: 471 },
      { from: ['ledger', 'hero_id', 'right'], to: ['heroes', 'id', 'right'], lane: 481 },
      { from: ['quest_log', 'quest_id', 'right'], to: ['quests', 'id', 'right'], lane: 710 },
    ],
  },

  acts: [
    { name: 'Акт I · Верхние ярусы', topic: 'Основы: SELECT, INSERT, UPDATE, DELETE', from: 0, to: 30 },
    { name: 'Акт II · Глубины', topic: 'Средний уровень: JOIN, GROUP BY, подзапросы', from: 30, to: 60 },
    { name: 'Акт III · Бездна', topic: 'Продвинутый уровень: оптимизация, транзакции, процедуры', from: 60, to: 90 },
  ],

  // Доля золота в зависимости от числа открытых подсказок. Опыт подсказки не уменьшают.
  hintMultipliers: [1, 0.7, 0.4, 0.2],

  rooms: [],

  // Сила монстров и награда растут от зала к залу. Опыт берётся из бюджета SQL в общей прогрессии.
  finalize() {
    const D = this;
    if (D.ready) return;
    D.ready = true;
    const P = (typeof Progression !== 'undefined') ? Progression : require('./progression.js');
    const weight = (i) => (30 + i * 1.5) * (D.rooms[i] && D.rooms[i].boss ? 2 : 1);
    D.rooms.forEach((r, i) => {
      r.index = i;
      r.floor = `Зал ${i + 1}`;
      r.kind = r.kind || 'query';
      r.xp = P.levelXp('sql', i, weight);
      r.gold = Math.round((25 + i * 4) * (r.boss ? 2 : 1));
      r.maxHp = Math.round((80 + i * 9) * (r.boss ? 1.6 : 1));
    });
  },

  // Урон монстра зависит от здоровья мага: обычный монстр убивает за 6 промахов, босс — за 4–5.
  attackFor(room, playerMaxHp) {
    return Math.round(playerMaxHp / (room.boss ? 4.5 : 6));
  },
};
