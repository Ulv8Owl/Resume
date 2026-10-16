// Режим «Теория»: карточки с вопросами собеседования. Игрок отвечает про себя и честно сверяется с ключевыми пунктами.
(function () {
  'use strict';

  const Core = window.Core;
  const P = window.Progression;
  const T = window.THEORY;
  const esc = Core.esc;
  const HINT_MULT = [1, 0.7, 0.4, 0.2];
  const CARD_GOLD = 12;
  const TOPIC_GOLD = 40;

  // Порядковый номер карточки среди всех тем: от него берётся опыт из бюджета теории.
  const allCards = [];
  T.topics.forEach((t) => t.cards.forEach((c) => { c.topic = t.id; c.index = allCards.length; allCards.push(c); }));
  const cardXp = (c) => P.levelXp('theory', c.index, () => 1);

  const screen = document.querySelector('.screen[data-screen="theory"]');
  let session = null;

  function S() {
    const st = Core.state;
    if (!st.theory || !st.theory.cards) st.theory = { cards: {}, topics: {}, bestStreak: 0 };
    return st.theory;
  }
  function cardState(id) {
    const th = S();
    if (!th.cards[id]) th.cards[id] = { known: false, box: 0, wrongs: 0 };
    return th.cards[id];
  }
  const knownIn = (topic) => topic.cards.filter((c) => S().cards[c.id] && S().cards[c.id].known).length;

  screen.innerHTML = `
    <div class="sim-head">
      <button class="ghost-btn" type="button" data-home>← К выбору режима</button>
      <h2 class="sim-title"><span aria-hidden="true">🔮</span> Теория</h2>
    </div>
    <div class="th-board">
      <aside class="panel th-side">
        <div class="th-stats"></div>
        <p class="eyebrow">Темы</p>
        <ul class="th-topics"></ul>
      </aside>
      <section class="th-stage"></section>
    </div>`;
  screen.querySelector('[data-home]').addEventListener('click', () => Core.go('home'));
  const $ = (s) => screen.querySelector(s);

  function renderSide() {
    const th = S();
    const totalKnown = allCards.filter((c) => th.cards[c.id] && th.cards[c.id].known).length;
    $('.th-stats').innerHTML = `
      <span class="chip">Знаю: <b>${totalKnown}</b> из ${allCards.length}</span>
      <span class="chip">🔥 Серия: <b>${session ? session.streak : 0}</b></span>
      <span class="chip">Рекорд серии: <b>${th.bestStreak || 0}</b></span>`;
    $('.th-topics').innerHTML = T.topics.map((t) => {
      const ready = t.cards.length > 0;
      const k = knownIn(t);
      const cleared = th.topics && th.topics[t.id] && th.topics[t.id].cleared;
      return `<li><button type="button" class="th-topic${session && session.topic === t ? ' active' : ''}${ready ? '' : ' soon'}" data-topic="${t.id}" ${ready ? '' : 'disabled'}>
        <span class="th-ico" aria-hidden="true">${t.icon}</span><span class="th-name">${esc(t.name)}</span>
        <span class="th-prog">${ready ? (cleared ? `✓ ${k}/${t.cards.length}` : `${k}/${t.cards.length}`) : 'скоро'}</span></button></li>`;
    }).join('');
    screen.querySelectorAll('[data-topic]:not([disabled])').forEach((b) => b.addEventListener('click', () => startTopic(T.topics.find((t) => t.id === b.dataset.topic))));
  }

  // Текст ответа: абзацы через пустую строку, строки «• …» — пункты списка.
  function rich(text) {
    return String(text).split(/\n\s*\n/).map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every((l) => l.startsWith('• '))) return `<ul>${lines.map((l) => `<li>${esc(l.slice(2))}</li>`).join('')}</ul>`;
      return lines.map((l) => (l.startsWith('• ') ? `<ul><li>${esc(l.slice(2))}</li></ul>` : `<p>${esc(l)}</p>`)).join('');
    }).join('');
  }

  // Колода: сначала карточки, которые ещё не знаешь. В пройденной теме — повторение всех карточек.
  function startTopic(topic) {
    const th = S();
    const review = !!(th.topics[topic.id] && th.topics[topic.id].cleared);
    const ids = topic.cards.map((c) => c.id).filter((id) => review || !cardState(id).known);
    session = { topic, review, queue: shuffle(ids), streak: 0, phase: 'front', hints: 0, total: ids.length, done: 0, result: null };
    renderSide();
    renderStage();
  }

  function shuffle(a) {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
    return r;
  }

  // На лицевой стороне — первая карточка колоды; на обороте — та, что только что перевернули.
  const current = () => session && session.topic.cards.find((c) => c.id === (session.phase === 'front' ? session.queue[0] : session.showing));

  function renderStage() {
    const stage = $('.th-stage');
    if (!session) {
      stage.innerHTML = '<div class="panel th-empty"><p>Выбери тему слева.</p></div>';
      return;
    }
    const card = current();
    if (!card) { finishTopic(); return; }
    const cs = cardState(card.id);
    const mult = HINT_MULT[session.hints];
    const combo = 1 + 0.25 * Math.min(session.streak, 4);
    const back = session.phase !== 'front';
    const known = cs.known;
    const reward = session.review ? 'повторение · без опыта' : `🪙 ${Math.round(CARD_GOLD * mult * combo)} ${known ? '' : `· ✦ ${cardXp(card)} XP`}`;

    let backContent = '';
    if (back) {
      const list = card.points.map((p, i) => session.phase === 'check'
        ? `<label class="pt"><input type="checkbox" data-pt="${i}"> <span>${esc(p)}</span></label>`
        : `<li>${esc(p)}</li>`).join('');
      backContent = `<p class="card-label">Ответ</p><div class="card-answer">${rich(card.answer)}</div>
        ${card.example ? `<p class="card-label">Пример</p><div class="card-answer card-example">${rich(card.example)}</div>` : ''}
        ${card.terms && card.terms.length ? `<p class="card-label">Словарик</p><dl class="card-terms">${card.terms.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>` : ''}
        <p class="card-label">${session.phase === 'check' ? 'Отметь пункты, которые ты назвал в своём ответе' : 'Ключевые пункты'}</p>
        ${session.phase === 'check' ? `<div class="pts">${list}</div>` : `<ul class="pts">${list}</ul>`}`;
    }

    stage.innerHTML = `
      <div class="th-top">
        <span>${esc(session.topic.icon + ' ' + session.topic.name)}${session.review ? ' · повторение' : ''}</span>
        <span>Осталось в колоде: <b>${session.queue.length}</b></span>
        <span class="combo${session.streak ? ' on' : ''}">🔥 ×${combo.toFixed(2).replace(/0$/, '')}</span>
      </div>
      <div class="card3d${back ? ' flipped' : ''}">
        <div class="card-inner">
          <div class="card-face front">
            <p class="card-label">Вопрос · мастерство ${'●'.repeat(Math.min(cs.box, 3))}${'○'.repeat(3 - Math.min(cs.box, 3))}</p>
            <p class="card-q">${esc(card.q)}</p>
            <p class="card-reward">${reward}</p>
          </div>
          <div class="card-face back">${backContent}</div>
        </div>
      </div>
      ${session.result ? `<p class="th-result ${session.result.ok ? 'ok' : 'bad'}">${esc(session.result.text)}</p>` : ''}
      <div class="th-actions">${actions()}</div>
      ${session.phase === 'front' ? `<div class="scrolls"><p class="eyebrow">Свитки подсказок <span>открыто ${session.hints} из 3</span></p><div class="hints">${hintsHtml(card)}</div></div>` : ''}`;
    bindStage(card);
  }

  function hintsHtml(card) {
    const open = card.hints.slice(0, session.hints).map((h, i) => `<div class="hint open"><span class="lvl">${'I'.repeat(i + 1)}</span><span class="body">${esc(h)}</span></div>`).join('');
    const next = session.hints < 3
      ? `<button class="hint" type="button" data-hint><span class="lvl">${'I'.repeat(session.hints + 1)}</span><span>Сломать печать свитка</span><span class="cost">${session.review ? 'бесплатно' : `золото → ${Math.round(HINT_MULT[session.hints + 1] * 100)}%`}</span></button>`
      : '';
    return open + next;
  }

  function actions() {
    if (session.phase === 'front') {
      return `<button class="btn attack" type="button" data-know>Знаю ответ — проверить себя</button>
        <button class="btn" type="button" data-dunno>Не знаю — перевернуть</button>`;
    }
    if (session.phase === 'check') return '<button class="btn attack" type="button" data-confirm>Сверил — засчитать</button>';
    return '<button class="btn attack" type="button" data-next>Следующий вопрос</button>';
  }

  function bindStage(card) {
    const on = (sel, fn) => { const b = screen.querySelector(sel); if (b) b.addEventListener('click', fn); };
    on('[data-hint]', () => { session.hints++; renderStage(); });
    on('[data-know]', () => { session.showing = card.id; session.phase = 'check'; session.result = null; renderStage(); });
    on('[data-dunno]', () => { markUnknown(card, 'Честность — тоже навык. Прочитай ответ, я спрошу ещё раз позже.'); });
    on('[data-confirm]', () => {
      const got = screen.querySelectorAll('[data-pt]:checked').length;
      const need = Math.ceil(card.points.length / 2);
      if (got >= need) markKnown(card, got);
      else markUnknown(card, `Назвал ${got} из ${card.points.length} ключевых пунктов, а нужно хотя бы ${need}. Вернёмся к этому вопросу.`);
    });
    on('[data-next]', () => {
      session.phase = 'front';
      session.hints = 0;
      session.result = null;
      renderStage();
    });
  }

  function markKnown(card, got) {
    session.showing = card.id;
    const cs = cardState(card.id);
    const first = !cs.known;
    const before = Core.rank();
    const combo = 1 + 0.25 * Math.min(session.streak, 4);
    const gold = session.review ? 0 : Math.round(CARD_GOLD * HINT_MULT[session.hints] * combo);
    cs.known = true;
    cs.box = Math.min(cs.box + 1, 5);
    Core.track('theory-card', { id: card.id });
    session.streak++;
    S().bestStreak = Math.max(S().bestStreak || 0, session.streak);
    Core.state.gold += gold;
    session.queue.shift();
    session.done++;
    session.phase = 'result';
    const xpText = first && !session.review ? ` +${cardXp(card)} XP.` : '';
    session.result = { ok: true, text: `Засчитано: ${got} из ${card.points.length} пунктов.${gold ? ` +${gold} золота.` : ''}${xpText}` };
    const up = Core.rankUp(before);
    Core.save();
    Core.renderHud();
    renderSide();
    renderStage();
    if (up.rank) {
      Core.modal(`<div class="big"><img class="modal-avatar" src="${Core.avatar(up.rank)}" alt=""></div><h3>Новое звание</h3><ul class="loot">${up.lines.join('')}</ul>
        <button class="btn attack" id="modal-close" type="button">Продолжить</button>`);
    }
  }

  function markUnknown(card, text) {
    session.showing = card.id;
    const cs = cardState(card.id);
    cs.wrongs++;
    cs.box = 0;
    session.streak = 0;
    // карточка вернётся через три вопроса (или в конец колоды, если она короче)
    const id = session.queue.shift();
    session.queue.splice(Math.min(3, session.queue.length), 0, id);
    session.phase = 'learn';
    session.result = { ok: false, text };
    Core.save();
    renderSide();
    renderStage();
  }

  function finishTopic() {
    const th = S();
    const t = session.topic;
    const allKnown = t.cards.every((c) => cardState(c.id).known);
    const firstClear = allKnown && !(th.topics[t.id] && th.topics[t.id].cleared);
    if (allKnown) th.topics[t.id] = { cleared: true };
    if (firstClear) Core.state.gold += TOPIC_GOLD;
    Core.save();
    Core.renderHud();
    const done = session;
    session = null;
    renderSide();
    renderStage();
    Core.modal(`
      <div class="big">🔮</div>
      <h3>${firstClear ? 'Тема пройдена' : 'Колода пройдена'}</h3>
      <ul class="loot">
        <li><span>Вопросов в колоде</span><span>${done.total}</span></li>
        <li><span>Знаю в теме</span><span>${knownIn(t)} / ${t.cards.length}</span></li>
        ${firstClear ? `<li><span>Награда за тему</span><span>+${TOPIC_GOLD}</span></li>` : ''}
        <li><span>Рекорд серии</span><span>${th.bestStreak || 0}</span></li>
      </ul>
      <p class="modal-tip">Опыт за карточку даётся один раз, а мастерство растёт с каждым повторением темы.</p>
      <button class="btn attack" id="modal-next" type="button">К выбору режима</button>
      <button class="btn" id="modal-close" type="button">Остаться</button>`, { onNext: () => Core.go('home') });
  }

  Core.registerMode('theory', {
    icon: '🔮',
    xpOf: (state) => {
      const cards = (state.theory && state.theory.cards) || {};
      return allCards.reduce((sum, c) => sum + (cards[c.id] && cards[c.id].known ? cardXp(c) : 0), 0);
    },
    progressOf: (state) => {
      const cards = (state.theory && state.theory.cards) || {};
      return { done: allCards.filter((c) => cards[c.id] && cards[c.id].known).length, available: allCards.length };
    },
    open: () => {
      renderSide();
      renderStage();
    },
    refresh: () => { renderSide(); renderStage(); },
  });
})();
