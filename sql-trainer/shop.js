// Лавка: зелья и свитки заклинаний за золото. Купленное лежит в сумке (Core.state.items)
// и тратится в Подземелье SQL в любой момент боя — как обычные расходники, без отката.
(function () {
  'use strict';

  const Core = window.Core;
  const esc = Core.esc;

  const ITEMS = [
    { id: 'hp', icon: '🧪', name: 'Зелье жизни', price: 40, text: 'Восстанавливает половину запаса здоровья.' },
    { id: 'mana', icon: '💧', name: 'Зелье маны', price: 30, text: 'Восстанавливает 60% запаса маны.' },
    { id: 'scroll1', icon: '📜', name: 'Малый свиток заклинания', price: 25, text: 'Подсказка-направление: с чего начать заклинание.' },
    { id: 'scroll2', icon: '📜', name: 'Свиток заклинания', price: 60, text: 'Подсказка подробнее: какие части запроса нужны.' },
    { id: 'scroll3', icon: '📜', name: 'Великий свиток заклинания', price: 120, text: 'Почти готовое заклинание.' },
  ];
  const item = (id) => ITEMS.find((i) => i.id === id);

  function bag() {
    if (!Core.state.items) Core.state.items = {};
    return Core.state.items;
  }
  const count = (id) => bag()[id] || 0;

  function buy(id, n) {
    const it = item(id);
    const total = it.price * n;
    if (Core.state.gold < total) return false;
    Core.state.gold -= total;
    bag()[id] = count(id) + n;
    Core.save();
    Core.renderHud();
    return true;
  }

  // Потратить предмет из сумки. Что он делает — решает режим (SQL): здесь только учёт.
  function take(id) {
    if (count(id) < 1) return false;
    bag()[id] = count(id) - 1;
    Core.save();
    return true;
  }

  const screen = document.querySelector('.screen[data-screen="shop"]');
  let note = '';

  function render() {
    screen.innerHTML = `
      <div class="sim-head">
        <button class="ghost-btn" type="button" data-home>← К выбору режима</button>
        <h2 class="sim-title"><span aria-hidden="true">🧪</span> Лавка</h2>
        <span class="chip gold">🪙 <b>${Core.state.gold}</b></span>
      </div>
      <p class="shop-note">Зелья и свитки тратятся в Подземелье SQL прямо во время боя — сколько угодно раз и в любом порядке.</p>
      ${note ? `<p class="shop-msg" aria-live="polite">${esc(note)}</p>` : ''}
      <div class="shop-grid">${ITEMS.map((it) => `
        <div class="shop-item">
          <div class="shop-head"><span class="shop-ico" aria-hidden="true">${it.icon}</span><b>${esc(it.name)}</b></div>
          <p class="shop-text">${esc(it.text)}</p>
          <p class="shop-have">В сумке: <b>${count(it.id)}</b></p>
          <div class="shop-buy">
            <button class="btn attack" type="button" data-buy="${it.id}" data-n="1" ${Core.state.gold >= it.price ? '' : 'disabled'}>Купить · ${it.price} 🪙</button>
            <button class="btn" type="button" data-buy="${it.id}" data-n="5" ${Core.state.gold >= it.price * 5 ? '' : 'disabled'}>×5 · ${it.price * 5} 🪙</button>
          </div>
        </div>`).join('')}
      </div>`;
    screen.querySelector('[data-home]').addEventListener('click', () => Core.go('home'));
    screen.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => {
      const it = item(b.dataset.buy);
      const n = +b.dataset.n;
      note = buy(it.id, n) ? `Куплено: ${it.name} ×${n}.` : 'Не хватает золота.';
      render();
    }));
  }

  Core.registerMode('shop', { open: () => { note = ''; render(); }, refresh: () => render() });

  window.Shop = { ITEMS, item, count, take, buy };
})();
