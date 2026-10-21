// Режим «Конспект»: свои каталоги и текстовые файлы. Хранятся в сохранении игрока (и в облаке).
// Каталоги вкладываются друг в друга сколько угодно; каталог или файл можно перенести в любой другой каталог
// (кнопкой ↕ или перетаскиванием на каталог/на путь вверху). Корень — сам Core.state.notes: { folders, files }.
// Награды — золото: за новый каталог и новый файл, а при выходе из файла — по монете за каждое новое слово.
// Чтобы награду нельзя было «накрутить», платим только сверх рекорда: paidFolders / paidFiles — сколько каталогов
// и файлов уже оплачено (удалить и создать заново — без награды), у файла paid — сколько его слов уже оплачено.
(function () {
  'use strict';

  const Core = window.Core;
  const esc = Core.esc;
  const FOLDER_GOLD = 10;
  const FILE_GOLD = 5;

  // у старых сохранений каталоги были только одного уровня и без вложенных — дополняем
  function fix(node) {
    if (!Array.isArray(node.folders)) node.folders = [];
    if (!Array.isArray(node.files)) node.files = [];
    node.folders.forEach(fix);
    return node;
  }
  function N() {
    const st = Core.state;
    if (!st.notes || typeof st.notes !== 'object') st.notes = { paidFolders: 0, paidFiles: 0 };
    return fix(st.notes);
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const wordsIn = (text) => String(text || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const allFolders = (node = N()) => node.folders.flatMap((f) => [f, ...allFolders(f)]);
  const allFiles = () => [N(), ...allFolders()].flatMap((f) => f.files);
  const totalWords = () => allFiles().reduce((s, f) => s + wordsIn(f.text), 0);
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
  const wordsText = (n) => `${n} ${plural(n, 'слово', 'слова', 'слов')}`;

  // путь от корня до каталога id: [корень, …, каталог]; null — нет такого
  function chain(id, node = N()) {
    if (!id) return [node];
    for (const f of node.folders) {
      if (f.id === id) return [node, f];
      const sub = chain(id, f);
      if (sub) return [node, ...sub];
    }
    return null;
  }
  // где лежит элемент: { parent, list, item, kind }
  function locate(kind, id) {
    for (const node of [N(), ...allFolders()]) {
      const list = kind === 'folder' ? node.folders : node.files;
      const item = list.find((x) => x.id === id);
      if (item) return { parent: node, list, item, kind };
    }
    return null;
  }

  const screen = document.querySelector('.screen[data-screen="notes"]');
  let folderId = null; // открытый каталог (null — корень)
  let fileId = null;
  let note = '';
  let saveTimer = null;

  const here = () => { const c = chain(folderId); if (!c) folderId = null; return (c || [N()]).slice(-1)[0]; };
  const file = () => { const at = fileId && locate('file', fileId); return at ? at.item : null; };

  function pay(gold, text) {
    Core.state.gold += gold;
    note = text;
    Core.save();
    Core.renderHud();
  }

  // Выход из файла: оплатить слова сверх рекорда этого файла (стёр и написал заново — платится только прирост).
  function leaveFile() {
    if (!fileId) return;
    clearTimeout(saveTimer);
    const f = file();
    fileId = null;
    const words = f ? wordsIn(f.text) : 0;
    if (f && words > (f.paid || 0)) {
      const gain = words - (f.paid || 0);
      f.paid = words;
      Core.track('notes-words', { n: gain }); // для очков «Протокола фокуса»
      pay(gain, `+${gain} 🪙 за ${gain} ${plural(gain, 'новое слово', 'новых слова', 'новых слов')}.`);
    } else {
      note = '';
      Core.save();
    }
  }

  function createFolder(name) {
    const n = N();
    here().folders.push({ id: uid(), name, folders: [], files: [] });
    const count = allFolders().length;
    if (count > (n.paidFolders || 0)) {
      n.paidFolders = count;
      pay(FOLDER_GOLD, `Каталог «${name}» создан: +${FOLDER_GOLD} 🪙.`);
    } else { note = `Каталог «${name}» создан.`; Core.save(); }
  }

  function createFile(name) {
    const n = N();
    const f = { id: uid(), name, text: '', paid: 0 };
    here().files.push(f);
    const count = allFiles().length;
    if (count > (n.paidFiles || 0)) {
      n.paidFiles = count;
      pay(FILE_GOLD, `Файл «${name}» создан: +${FILE_GOLD} 🪙.`);
    } else { note = `Файл «${name}» создан.`; Core.save(); }
    return f;
  }

  // Перенос каталога или файла в каталог targetId (null — в корень). Каталог нельзя положить в самого себя или в свой подкаталог.
  function move(kind, id, targetId) {
    const at = locate(kind, id);
    const dest = chain(targetId);
    if (!at || !dest) return;
    const target = dest[dest.length - 1];
    if (kind === 'folder' && dest.some((x) => x.id === id)) { note = 'Каталог нельзя положить в самого себя или в свой подкаталог.'; return render(); }
    if (target === at.parent) return;
    at.list.splice(at.list.indexOf(at.item), 1);
    (kind === 'folder' ? target.folders : target.files).push(at.item);
    note = `${kind === 'folder' ? 'Каталог' : 'Файл'} «${at.item.name}» перенесён в «${target === N() ? 'Конспект' : target.name}».`;
    Core.save();
    render();
  }

  function moveDialog(kind, id) {
    const at = locate(kind, id);
    if (!at) return;
    const row = (node, depth) => {
      const banned = kind === 'folder' && (node.id === id);
      const isRoot = node === N();
      return `<li style="--depth:${depth}"><button type="button" class="notes-dest" data-dest="${isRoot ? '' : node.id}" ${banned || node === at.parent ? 'disabled' : ''}>
          ${isRoot ? '📚 Конспект (верхний уровень)' : `📁 ${esc(node.name)}`}${node === at.parent ? ' <small>— сейчас здесь</small>' : ''}</button></li>
        ${banned ? '' : node.folders.map((f) => row(f, depth + 1)).join('')}`;
    };
    const close = Core.modal(`<div class="notes-move"><h3>Куда перенести ${kind === 'folder' ? 'каталог' : 'файл'} «${esc(at.item.name)}»?</h3>
      <ul class="notes-tree">${row(N(), 0)}</ul>
      <button class="btn" id="modal-close" type="button">Отмена</button></div>`);
    document.querySelectorAll('.notes-dest:not(:disabled)').forEach((b) => b.addEventListener('click', () => {
      close();
      move(kind, id, b.dataset.dest || null);
    }));
  }

  const crumbs = () => {
    const c = chain(folderId) || [N()];
    const x = file();
    return `<nav class="notes-crumbs" aria-label="Путь">${c.map((node, i) => {
      const root = i === 0;
      return `${root ? '' : '<span>/</span>'}<button type="button" class="link-btn" data-to="${root ? '' : node.id}" data-drop="${root ? '' : node.id}">${root ? '📚 Конспект' : `📁 ${esc(node.name)}`}</button>`;
    }).join('')}${x ? `<span>/</span><b>📄 ${esc(x.name)}</b>` : ''}</nav>`;
  };

  function newForm(kind) {
    return `<form class="notes-new" data-new="${kind}">
      <input type="text" maxlength="60" required placeholder="${kind === 'folder' ? 'Новый каталог, например «Безопасность»' : 'Новый файл, например «Коды ответов»'}" aria-label="${kind === 'folder' ? 'Название каталога' : 'Название файла'}">
      <button class="btn${kind === 'folder' ? ' attack' : ''}" type="submit">${kind === 'folder' ? '+ Каталог' : '+ Файл'} <small>(${kind === 'folder' ? FOLDER_GOLD : FILE_GOLD} 🪙)</small></button></form>`;
  }

  const itemRow = (kind, it) => {
    const info = kind === 'folder'
      ? `${it.folders.length ? `${it.folders.length} ${plural(it.folders.length, 'каталог', 'каталога', 'каталогов')} · ` : ''}${it.files.length} ${plural(it.files.length, 'файл', 'файла', 'файлов')}`
      : wordsText(wordsIn(it.text));
    return `<li draggable="true" data-drag="${kind}:${it.id}">
      <button type="button" class="notes-item" data-${kind}="${it.id}" ${kind === 'folder' ? `data-drop="${it.id}"` : ''}>${kind === 'folder' ? '📁' : '📄'} <span>${esc(it.name)}</span><small>${info}</small></button>
      <button type="button" class="ghost-btn" data-move="${kind}:${it.id}" title="Перенести в другой каталог" aria-label="Перенести ${esc(it.name)}">↕</button>
      <button type="button" class="ghost-btn" data-del="${kind}:${it.id}" title="Удалить" aria-label="Удалить ${esc(it.name)}">🗑</button></li>`;
  };

  function body() {
    const x = file();
    if (x) {
      return `<div class="notes-editor">
        <textarea class="notes-text" spellcheck="true" aria-label="Текст конспекта" placeholder="Пиши конспект. За каждое новое слово — монета, когда выйдешь из файла.">${esc(x.text)}</textarea>
        <div class="notes-bar"><span class="notes-count">${wordsText(wordsIn(x.text))}</span>
          <button class="btn" type="button" data-close-file>Готово — выйти из файла</button></div></div>`;
    }
    const node = here();
    const items = node.folders.map((f) => itemRow('folder', f)).concat(node.files.map((f) => itemRow('file', f)));
    return `<div class="notes-forms">${newForm('folder')}${newForm('file')}</div>
      ${items.length ? `<ul class="notes-list">${items.join('')}</ul>` : `<p class="notes-empty">${node === N() ? 'Создай первый каталог — например, по теме, которую сейчас учишь.' : 'Каталог пуст.'}</p>`}
      ${items.length ? '<p class="notes-tip">Перенести каталог или файл: кнопка ↕ или перетащи его на каталог либо на путь вверху.</p>' : ''}`;
  }

  function render() {
    screen.innerHTML = `
      <div class="sim-head">
        <button class="ghost-btn" type="button" data-home>← К выбору режима</button>
        <h2 class="sim-title"><span aria-hidden="true">📝</span> Конспект</h2>
        <label class="music-toggle notes-music"><input type="checkbox" data-music ${window.Music && window.Music.inNotes ? 'checked' : ''}> Музыка в Конспекте</label>
        <span class="chip gold">🪙 <b>${Core.state.gold}</b></span>
      </div>
      ${crumbs()}
      ${note ? `<p class="shop-msg" aria-live="polite">${esc(note)}</p>` : ''}
      ${body()}`;
    bind();
  }

  function remove(kind, id) {
    const at = locate(kind, id);
    if (!at) return;
    const inside = kind === 'folder' && (at.item.folders.length || at.item.files.length);
    const ask = kind === 'folder'
      ? `Удалить каталог «${at.item.name}»${inside ? ' вместе со всем содержимым' : ''}?`
      : `Удалить файл «${at.item.name}»? Текст пропадёт.`;
    if (!window.confirm(ask)) return;
    at.list.splice(at.list.indexOf(at.item), 1);
    note = `${kind === 'folder' ? 'Каталог' : 'Файл'} «${at.item.name}» удалён.`;
    Core.save();
    render();
  }

  function bind() {
    screen.querySelector('[data-home]').addEventListener('click', () => Core.go('home'));
    screen.querySelector('[data-music]').addEventListener('change', (e) => window.Music && window.Music.toggleNotes(e.target.checked));
    screen.querySelectorAll('[data-to]').forEach((b) => b.addEventListener('click', () => {
      leaveFile();
      folderId = b.dataset.to || null;
      render();
    }));
    screen.querySelectorAll('[data-new]').forEach((form) => form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.querySelector('input').value.trim();
      if (!name) return;
      if (form.dataset.new === 'folder') createFolder(name);
      else fileId = createFile(name).id;
      render();
      const ta = screen.querySelector('.notes-text');
      if (ta) ta.focus();
    }));
    screen.querySelectorAll('[data-folder]').forEach((b) => b.addEventListener('click', () => { folderId = b.dataset.folder; note = ''; render(); }));
    screen.querySelectorAll('[data-file]').forEach((b) => b.addEventListener('click', () => { fileId = b.dataset.file; note = ''; render(); }));
    screen.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => { const [k, id] = b.dataset.move.split(':'); moveDialog(k, id); }));
    screen.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { const [k, id] = b.dataset.del.split(':'); remove(k, id); }));

    // перетаскивание: элемент списка → каталог в списке или каталог в пути сверху
    screen.querySelectorAll('[data-drag]').forEach((li) => li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', li.dataset.drag);
      e.dataTransfer.effectAllowed = 'move';
    }));
    screen.querySelectorAll('[data-drop]').forEach((t) => {
      t.addEventListener('dragover', (e) => { e.preventDefault(); t.classList.add('drop-on'); });
      t.addEventListener('dragleave', () => t.classList.remove('drop-on'));
      t.addEventListener('drop', (e) => {
        e.preventDefault();
        t.classList.remove('drop-on');
        const [k, id] = (e.dataTransfer.getData('text/plain') || '').split(':');
        if (k && id && id !== t.dataset.drop) move(k, id, t.dataset.drop || null);
      });
    });

    const ta = screen.querySelector('.notes-text');
    if (ta) {
      const count = screen.querySelector('.notes-count');
      ta.addEventListener('input', () => {
        const f = file();
        if (!f) return;
        f.text = ta.value;
        count.textContent = wordsText(wordsIn(ta.value));
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => Core.save(), 1500); // текст сохраняется сам, награда — при выходе из файла
      });
    }
    const close = screen.querySelector('[data-close-file]');
    if (close) close.addEventListener('click', () => { leaveFile(); render(); });
  }

  // закрыл вкладку посреди файла — текст сохраним, а слова оплатятся при следующем выходе из файла
  window.addEventListener('pagehide', () => { if (fileId) Core.save(); });

  Core.registerMode('notes', {
    icon: '📝',
    xpOf: () => 0,
    progressOf: () => ({ done: totalWords(), available: 0 }),
    open: () => { note = ''; render(); },
    close: () => leaveFile(),
    // облачная синхронизация не должна перерисовывать открытый файл — иначе собьётся курсор
    refresh: () => { if (!fileId) render(); },
  });
})();
