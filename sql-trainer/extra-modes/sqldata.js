// SQL для тестировщика: подготовка и проверка тестовых данных. Источники:
// https://habr.com/en/articles/816537
// https://www.atlassian.com/fr/data/sql/how-to-find-duplicate-values-in-a-sql-table
// https://taggd.in/blogs/sql-query-interview-questions/
// https://jobcannon.io/ru/tests/sql-test
// https://dataford.io/questions/write-an-sql-query-to-find-duplicate-records-in-a-table-and-return-the-duplicated-values-with-their-counts
window.EXTRA = window.EXTRA || {};
window.EXTRA.sqldata = {
  icon: '🗄️', name: 'SQL: тестовые данные', tagline: 'Подготовить данные, проверить запись после действия в UI, найти дубли и «сирот»', sql: true,
  tasks: [
    {
      title: 'Подготовить тестового пользователя',
      brief: 'Хроники здесь играют роль базы приложения: <code>heroes</code> — пользователи, <code>ledger</code> — операции по балансу. ' +
        'Тест-кейс: «Новый пользователь без гильдии и без золота не может купить товар в магазине». Через UI такого пользователя ' +
        'создать долго, поэтому тестировщик готовит его прямо в базе.',
      room: {
        id: 'xsql-1',
        kind: 'change',
        task: 'Добавь в <code>heroes</code> пользователя <b>qa_buyer_01</b>: класс <b>Плут</b>, уровень <b>1</b>, золото <b>0</b>, ' +
          'без гильдии и без наставника (<code>NULL</code>), дата регистрации <b>2026-10-21</b>. <code>id</code> можно не указывать.',
        tables: ['heroes'],
        check: `SELECT name, class, level, gold, guild_id, mentor_id, joined_on FROM heroes ORDER BY name, joined_on`,
        show: `SELECT * FROM heroes ORDER BY id DESC LIMIT 5`,
        solution: `INSERT INTO heroes (name, class, level, gold, guild_id, mentor_id, joined_on) VALUES ('qa_buyer_01', 'Плут', 1, 0, NULL, NULL, '2026-10-21')`,
        require: [{ re: /\bINSERT\b/, msg: 'Тестовые данные готовим через INSERT.' }],
        hints: [
          'Нужна одна новая строка в <code>heroes</code>. Если перечислить колонки, <code>id</code> база выдаст сама.',
          '<code>INSERT INTO heroes (name, class, level, gold, guild_id, mentor_id, joined_on) VALUES (…)</code>',
          "<code>INSERT INTO heroes (name, class, level, gold, guild_id, mentor_id, joined_on) VALUES ('qa_buyer_01', 'Плут', 1, 0, NULL, NULL, '2026-10-21')</code>",
        ],
      },
      why: 'Подготовка данных через SQL экономит время и даёт точное предусловие тест-кейса. Узнаваемое имя вроде <code>qa_buyer_01</code> помогает потом найти и удалить эти данные. Перечислять колонки надёжнее, чем полагаться на их порядок в таблице.',
    },
    {
      title: 'Проверить запись после покупки в UI',
      brief: 'Ты прошёл сценарий в UI: пользователь <b>Айра</b> (<code>hero_id = 1</code>) купила в магазине <b>Зелье маны</b> за <b>120</b> золота. ' +
        'Интерфейс показал «Покупка успешна». Теперь нужно убедиться, что приложение записало операцию в <code>ledger</code> ' +
        'с правильным пользователем, суммой и описанием. В таблице уже есть похожие покупки других пользователей.',
      room: {
        id: 'xsql-2',
        task: 'Выведи из <code>ledger</code> только запись об этой покупке: колонки <code>id, hero_id, amount, note</code>. ' +
          'Списание хранится с минусом, описание — <code>Покупка: Зелье маны</code>.',
        tables: ['ledger', 'heroes'],
        setup: `INSERT INTO ledger VALUES
          (7, 3, -120, 'Покупка: Зелье маны'),
          (8, 1, -45, 'Покупка: Факел'),
          (9, 1, -120, 'Покупка: Зелье маны'),
          (10, 12, -120, 'Покупка: Зелье маны');`,
        solution: `SELECT id, hero_id, amount, note FROM ledger WHERE hero_id = 1 AND amount = -120 AND note = 'Покупка: Зелье маны'`,
        hints: [
          'Ищи по всем признакам сразу: кто купил, сколько списано и что куплено. Одного признака мало.',
          '<code>SELECT id, hero_id, amount, note FROM ledger WHERE hero_id = … AND note = …</code>',
          "<code>SELECT id, hero_id, amount, note FROM ledger WHERE hero_id = 1 AND amount = -120 AND note = 'Покупка: Зелье маны'</code>",
        ],
      },
      why: 'После действия в UI тестировщик ищет созданную запись по всем ожидаемым полям. Запись должна найтись ровно одна, с верной суммой и знаком. Если по фильтру нашлось ноль строк или две, это повод для баг-репорта: запись не сохранилась или задублировалась.',
    },
    {
      title: 'Двойной клик: найти дубли',
      brief: 'Баг из продакшена: если быстро дважды нажать «Сдать квест», награда начисляется дважды. ' +
        'Перед заведением бага нужно оценить масштаб: у каких пользователей одно и то же задание записано в <code>quest_log</code> больше одного раза.',
      room: {
        id: 'xsql-3',
        task: 'Выведи пары, которые встречаются в <code>quest_log</code> больше одного раза: <code>hero_id, quest_id</code> и число записей ' +
          '<code>cnt</code>. Отсортируй по <code>hero_id</code>, затем по <code>quest_id</code>.',
        tables: ['quest_log'],
        ordered: true,
        setup: `INSERT INTO quest_log VALUES
          (12, 2, 2, '2026-03-05'),
          (13, 9, 4, '2026-03-11'),
          (14, 9, 4, '2026-03-11'),
          (15, 3, 6, '2026-04-25');`,
        solution: `SELECT hero_id, quest_id, COUNT(*) AS cnt FROM quest_log GROUP BY hero_id, quest_id HAVING COUNT(*) > 1 ORDER BY hero_id, quest_id`,
        require: [{ re: /\bHAVING\b/, msg: 'Условие на число записей в группе ставится в HAVING.' }],
        hints: [
          'Дубль — это группа из одинаковых <code>hero_id</code> и <code>quest_id</code>, в которой больше одной строки.',
          '<code>SELECT hero_id, quest_id, COUNT(*) AS cnt FROM quest_log GROUP BY … HAVING …</code>',
          '<code>SELECT hero_id, quest_id, COUNT(*) AS cnt FROM quest_log GROUP BY hero_id, quest_id HAVING COUNT(*) &gt; 1 ORDER BY hero_id, quest_id</code>',
        ],
      },
      why: 'Дубли ищут через <code>GROUP BY</code> по бизнес-ключу и <code>HAVING COUNT(*) &gt; 1</code>. <code>WHERE</code> здесь не подходит: он фильтрует строки до группировки. Число дублей в <code>cnt</code> показывает масштаб бага. Хорошо ещё предложить разработчикам уникальный индекс по паре полей.',
    },
    {
      title: 'Записи-«сироты» после удаления',
      brief: 'Администратор удалил пользователя <b>Ноэль</b> (id 13) через админку, а импорт платежей загрузил операцию для несуществующего <code>hero_id = 99</code>. ' +
        'Внешние ключи в базе не включены, поэтому операции остались без владельца. ' +
        'Записи с <code>hero_id = NULL</code> — это системные операции казны, они не ошибка.',
      room: {
        id: 'xsql-4',
        task: 'Выведи операции <code>ledger</code>, у которых <code>hero_id</code> указан, но такого пользователя нет в <code>heroes</code>: ' +
          'колонки <code>id, hero_id, amount</code>, по возрастанию <code>id</code>.',
        tables: ['ledger', 'heroes'],
        ordered: true,
        setup: `DELETE FROM heroes WHERE id = 13;
          INSERT INTO ledger VALUES
          (7, 99, 500, 'Импорт: Награда'),
          (8, NULL, 1000, 'Пополнение казны'),
          (9, 4, 30, 'Награда: Крысы в погребе');`,
        solution: `SELECT l.id, l.hero_id, l.amount FROM ledger l LEFT JOIN heroes h ON h.id = l.hero_id WHERE l.hero_id IS NOT NULL AND h.id IS NULL ORDER BY l.id`,
        hints: [
          'Присоедини <code>heroes</code> так, чтобы операции без пары не потерялись, и оставь те, где пары не нашлось. Не забудь про системные операции.',
          '<code>… FROM ledger l LEFT JOIN heroes h ON h.id = l.hero_id WHERE h.id IS NULL AND …</code>',
          '<code>SELECT l.id, l.hero_id, l.amount FROM ledger l LEFT JOIN heroes h ON h.id = l.hero_id WHERE l.hero_id IS NOT NULL AND h.id IS NULL ORDER BY l.id</code>',
        ],
      },
      why: 'Строки-«сироты» ищут через <code>LEFT JOIN … WHERE parent.id IS NULL</code> или <code>NOT EXISTS</code>. Ловушка в том, что строка с <code>hero_id = NULL</code> тоже не найдёт пару, поэтому её исключают отдельно. Такая находка — баг каскадного удаления или валидации импорта.',
    },
    {
      title: 'Убрать за собой тестовые данные',
      brief: 'После регресса на стенде остались операции, созданные автотестами и ручными проверками. Все они помечены префиксом <b>QA_</b> в начале <code>note</code>. ' +
        'Стенд общий, на нём работают другие команды. Удалить нужно только тестовые записи. Настоящая операция, где «QA_» стоит в середине текста, должна остаться.',
      room: {
        id: 'xsql-5',
        kind: 'change',
        task: 'Удали из <code>ledger</code> все записи, у которых <code>note</code> <b>начинается</b> с <code>QA_</code>. Остальные записи трогать нельзя.',
        tables: ['ledger'],
        setup: `INSERT INTO ledger VALUES
          (7, 1, 100, 'QA_ пополнение для теста'),
          (8, 3, -50, 'QA_ списание для теста'),
          (9, 7, 10, 'QA_ проверка округления'),
          (10, 5, 300, 'Компенсация по обращению QA_отдела');`,
        check: `SELECT * FROM ledger ORDER BY id`,
        solution: `DELETE FROM ledger WHERE note LIKE 'QA\\_%' ESCAPE '\\'`,
        require: [
          { re: /\bDELETE\b/, msg: 'Чистим данные через DELETE.' },
          { re: /\bWHERE\b/, msg: 'DELETE без WHERE на общем стенде удалит чужие данные.' },
        ],
        hints: [
          'Сначала проверь условие через <code>SELECT</code>, потом подставь его в <code>DELETE</code>. Важно слово «начинается».',
          "<code>DELETE FROM ledger WHERE note LIKE 'QA…'</code>: знак <code>%</code> ставь только в конце.",
          "<code>DELETE FROM ledger WHERE note LIKE 'QA_%'</code> (строже: <code>LIKE 'QA\\_%' ESCAPE '\\'</code>, ведь <code>_</code> в LIKE означает любой символ)",
        ],
      },
      why: 'Безопасная очистка: сначала проверить условие через <code>SELECT</code> с тем же <code>WHERE</code>, потом выполнить <code>DELETE</code>. <code>%QA_%</code> зацепило бы настоящую запись. В <code>LIKE</code> знак <code>_</code> означает любой символ, поэтому строгий вариант экранирует его. На общем стенде удаляют только свои, помеченные данные.',
    },
  ],
};
