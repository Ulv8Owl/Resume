// Мир подземелья: учебная база данных и комнаты (задачи).
window.DUNGEON = {
  schemaSql: `
    CREATE TABLE guilds (
      id    INTEGER PRIMARY KEY,
      name  TEXT NOT NULL,
      city  TEXT NOT NULL
    );
    CREATE TABLE heroes (
      id        INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      class     TEXT NOT NULL,
      level     INTEGER NOT NULL,
      gold      INTEGER NOT NULL,
      guild_id  INTEGER REFERENCES guilds(id)
    );
    CREATE TABLE quests (
      id          INTEGER PRIMARY KEY,
      title       TEXT NOT NULL,
      difficulty  INTEGER NOT NULL,
      reward      INTEGER NOT NULL
    );
    CREATE TABLE quest_log (
      id            INTEGER PRIMARY KEY,
      hero_id       INTEGER REFERENCES heroes(id),
      quest_id      INTEGER REFERENCES quests(id),
      completed_on  TEXT NOT NULL
    );

    INSERT INTO guilds VALUES
      (1, 'Серебряный Клинок', 'Альтдорф'),
      (2, 'Орден Пепла',       'Кхарн'),
      (3, 'Лесные Тени',       'Эльвенхолл'),
      (4, 'Дом Совы',          'Альтдорф');

    INSERT INTO heroes VALUES
      (1,  'Айра',    'Маг',    7,  420, 2),
      (2,  'Борин',   'Воин',   9,  610, 1),
      (3,  'Велена',  'Лучник', 5,  180, 3),
      (4,  'Гримм',   'Воин',   4,   95, 1),
      (5,  'Даэль',   'Маг',    11, 870, 4),
      (6,  'Ессения', 'Жрец',   6,  300, 1),
      (7,  'Жорен',   'Маг',    3,   60, 2),
      (8,  'Зира',    'Лучник', 8,  540, 3),
      (9,  'Ирвин',   'Воин',   12, 990, 2),
      (10, 'Кайра',   'Маг',    2,   25, NULL);

    INSERT INTO quests VALUES
      (1, 'Крысы в погребе',   1,  50),
      (2, 'Мост троллей',      3, 200),
      (3, 'Проклятый курган',  4, 350),
      (4, 'Сердце вулкана',    5, 900);

    INSERT INTO quest_log VALUES
      (1, 1, 1, '2026-03-02'),
      (2, 2, 2, '2026-03-05'),
      (3, 9, 4, '2026-03-11'),
      (4, 5, 3, '2026-03-12'),
      (5, 8, 2, '2026-03-20'),
      (6, 2, 3, '2026-04-01'),
      (7, 6, 1, '2026-04-03');
  `,

  // Раскладка ER-схемы (координаты в viewBox схемы).
  diagram: {
    width: 680,
    height: 282,
    tables: {
      guilds:    { x: 8,   y: 8,   cols: [['id', 'INT', 'pk'], ['name', 'TEXT'], ['city', 'TEXT']] },
      heroes:    { x: 236, y: 8,   cols: [['id', 'INT', 'pk'], ['name', 'TEXT'], ['class', 'TEXT'], ['level', 'INT'], ['gold', 'INT'], ['guild_id', 'INT', 'fk']] },
      quest_log: { x: 464, y: 8,   cols: [['id', 'INT', 'pk'], ['hero_id', 'INT', 'fk'], ['quest_id', 'INT', 'fk'], ['completed_on', 'TEXT']] },
      quests:    { x: 236, y: 166, cols: [['id', 'INT', 'pk'], ['title', 'TEXT'], ['difficulty', 'INT'], ['reward', 'INT']] },
    },
    links: [
      ['heroes', 'guild_id', 'guilds', 'id'],
      ['quest_log', 'hero_id', 'heroes', 'id'],
      ['quest_log', 'quest_id', 'quests', 'id'],
    ],
  },

  rooms: [
    {
      id: 'archive',
      floor: 'Этаж I',
      monster: 'Скелет-архивариус',
      sprite: '💀',
      maxHp: 100,
      attack: 15,
      gold: 60,
      xp: 40,
      trophy: { name: 'Пыльный каталог', icon: '📜' },
      intro: 'Скелет охраняет списки гильдий. Он рассыплется, если назвать ему всех магов подземелья.',
      task: 'Выведи имя (<code>name</code>) и уровень (<code>level</code>) всех героев класса <b>Маг</b>. Порядок строк не важен.',
      tables: ['heroes'],
      ordered: false,
      solution: "SELECT name, level FROM heroes WHERE class = 'Маг'",
      starter: 'SELECT * FROM heroes;',
      hints: [
        'Отбирать строки помогает <code>WHERE</code>. Строки в SQL пишут в одинарных кавычках, и регистр букв важен.',
        'Нужна одна таблица и две колонки:<br><code>SELECT name, level FROM heroes WHERE …</code>',
        "Условие целиком: <code>WHERE class = 'Маг'</code>",
      ],
      taunts: ['Кости скрипят: «Это не все маги…»', 'Скелет теряет пару рёбер, но держится.'],
    },
    {
      id: 'counting',
      floor: 'Этаж II',
      monster: 'Гоблин-счетовод',
      sprite: '👺',
      maxHp: 140,
      attack: 20,
      gold: 110,
      xp: 70,
      trophy: { name: 'Счёты гоблина', icon: '🧮' },
      intro: 'Гоблин ведёт перепись и путается в цифрах. Сосчитай героев быстрее него.',
      task: 'Посчитай, сколько героев в каждом классе. Выведи класс (<code>class</code>) и количество. Отсортируй по количеству <b>по убыванию</b>.',
      tables: ['heroes'],
      ordered: true,
      solution: 'SELECT class, COUNT(*) AS cnt FROM heroes GROUP BY class ORDER BY cnt DESC',
      starter: 'SELECT class FROM heroes;',
      hints: [
        'Чтобы считать по группам, используют <code>GROUP BY</code> вместе с агрегатной функцией <code>COUNT</code>.',
        'Скелет запроса:<br><code>SELECT class, COUNT(*) FROM heroes GROUP BY … ORDER BY …</code>',
        'Почти готово: <code>GROUP BY class ORDER BY COUNT(*) DESC</code>',
      ],
      taunts: ['Гоблин хихикает: «Посчитал, да не так!»', 'Гоблин роняет пару костяшек со счётов.'],
    },
    {
      id: 'dragon',
      floor: 'Логово',
      boss: true,
      monster: 'Дракон Агрегатор',
      sprite: '🐉',
      maxHp: 220,
      attack: 30,
      gold: 250,
      xp: 150,
      trophy: { name: 'Чешуя Агрегатора', icon: '🛡️' },
      intro: 'Дракон спит на золоте гильдий. Узнай, у каких гильдий казна богаче всего, и он лишится силы.',
      task: 'Для каждой гильдии посчитай суммарное золото её героев. Выведи название гильдии и сумму, но только для гильдий, где сумма <b>больше 1000</b>. Отсортируй по сумме <b>по убыванию</b>.',
      tables: ['guilds', 'heroes'],
      ordered: true,
      solution: 'SELECT g.name, SUM(h.gold) AS total FROM guilds g JOIN heroes h ON h.guild_id = g.id GROUP BY g.id, g.name HAVING SUM(h.gold) > 1000 ORDER BY total DESC',
      starter: 'SELECT * FROM guilds;',
      hints: [
        'Золото хранится в <code>heroes</code>, названия в <code>guilds</code>. Соедини их через <code>JOIN</code> по <code>guild_id</code>. Условие на сумму пишут в <code>HAVING</code>, а не в <code>WHERE</code>.',
        'Скелет запроса:<br><code>SELECT g.name, SUM(h.gold) FROM guilds g JOIN heroes h ON h.guild_id = g.id GROUP BY … HAVING … ORDER BY …</code>',
        'Хвост запроса: <code>GROUP BY g.id, g.name HAVING SUM(h.gold) &gt; 1000 ORDER BY SUM(h.gold) DESC</code>',
      ],
      taunts: ['Дракон выдыхает дым: «Мои сокровища посчитаны неверно!»', 'Чешуя трескается, но пламя ещё горит.'],
    },
  ],

  // Комнаты-заглушки на карте, чтобы было видно, что подземелье продолжается.
  lockedTeasers: ['Склеп подзапросов', 'Башня оконных функций'],

  // Множитель добычи в зависимости от числа открытых подсказок.
  hintMultipliers: [1, 0.7, 0.4, 0.2],
};
