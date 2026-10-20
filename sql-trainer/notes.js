// Режим «Конспект»: свои каталоги и текстовые файлы. Хранятся в сохранении игрока (и в облаке).
// Награды — золото: за новый каталог и новый файл, а при выходе из файла — по монете за каждое новое слово.
// Чтобы награду нельзя было «накрутить», платим только сверх рекорда: paidFolders / paidFiles — сколько каталогов
// и файлов уже оплачено (удалить и создать заново — без награды), у файла paid — сколько его слов уже оплачено.
(function () {
  'use strict';

  const Core = window.Core;
  const esc = Core.esc;
  const FOLDER_GOLD = 10;
  const FILE_GOLD = 5;

  function N() {
    const st = Core.state;
    if (!st.notes || !Array.isArray(st.notes.folders)) st.notes = Object.assign({ folders: [], paidFolders: 0, paidFiles: 0 }, st.notes, { folders: [] });
    return st.notes;
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const wordsIn = (text) => String(text || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const allFiles = () => N().folders.flatMap((f) => f.files);
  const totalWords = () => allFiles().reduce((s, f) => s + wordsIn(f.text), 0);
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };

  const screen = document.querySelector('.screen[data-screen="notes"]');
  let folderId = null;
  let fileId = null;
  let note = '';
  let saveTimer = null;

  const folder = () => N().folders.find((f) => f.id === folderId) || null;
  const file = () => { const f = folder(); return f ? f.files.find((x) => x.id === fileId) || null : null; };

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
      pay(gain, `+${gain} 🪙 за ${gain} ${plural(gain, 'новое слово', 'новых слова', 'новых слов')}.`);
    } else {
      note = '';
      Core.save();
    }
  }

  function createFolder(name) {
    const n = N();
    n.folders.push({ id: uid(), name, files: [] });
    if (n.folders.length > (n.paidFolders || 0)) {
      n.paidFolders = n.folders.length;
      pay(FOLDER_GOLD, `Каталог «${name}» создан: +${FOLDER_GOLD} 🪙.`);
    } else { note = `Каталог «${name}» создан.`; Core.save(); }
  }

  function createFile(name) {
    const n = N();
    const f = { id: uid(), name, text: '', paid: 0 };
    folder().files.push(f);
    const count = allFiles().length;
    if (count > (n.paidFiles || 0)) {
      n.paidFiles = count;
      pay(FILE_GOLD, `Файл «${name}» создан: +${FILE_GOLD} 🪙.`);
    } else { note = `Файл «${name}» создан.`; Core.save(); }
    return f;
  }

  const crumbs = () => {
    const f = folder();
    const x = file();
    return `<nav class="notes-crumbs" aria-label="Путь">
      <button type="button" class="link-btn" data-to="root">📚 Конспект</button>
      ${f ? `<span>/</span><button type="button" class="link-btn" data-to="folder">📁 ${esc(f.name)}</button>` : ''}
      ${x ? `<span>/</span><b>📄 ${esc(x.name)}</b>` : ''}</nav>`;
  };

  function newForm(kind) {
    return `<form class="notes-new" data-new="${kind}">
      <input type="text" maxlength="60" required placeholder="${kind === 'folder' ? 'Название каталога, например «HTTP»' : 'Название файла, например «Коды ответов»'}" aria-label="Название">
      <button class="btn attack" type="submit">${kind === 'folder' ? '+ Каталог' : '+ Файл'} <small>(${kind === 'folder' ? FOLDER_GOLD : FILE_GOLD} 🪙)</small></button></form>`;
  }

  function body() {
    const f = folder();
    const x = file();
    if (x) {
      return `<div class="notes-editor">
        <textarea class="notes-text" spellcheck="true" aria-label="Текст конспекта" placeholder="Пиши конспект. За каждое новое слово — монета, когда выйдешь из файла.">${esc(x.text)}</textarea>
        <div class="notes-bar"><span class="notes-count">${wordsIn(x.text)} ${plural(wordsIn(x.text), 'слово', 'слова', 'слов')}</span>
          <button class="btn" type="button" data-close-file>Готово — выйти из файла</button></div></div>`;
    }
    if (f) {
      return `${newForm('file')}
        ${f.files.length ? `<ul class="notes-list">${f.files.map((it) => `<li><button type="button" class="notes-item" data-file="${it.id}">📄 <span>${esc(it.name)}</span><small>${wordsIn(it.text)} ${plural(wordsIn(it.text), 'слово', 'слова', 'слов')}</small></button>
          <button type="button" class="ghost-btn" data-del-file="${it.id}" title="Удалить файл" aria-label="Удалить файл ${esc(it.name)}">🗑</button></li>`).join('')}</ul>` : '<p class="notes-empty">В каталоге пока нет файлов.</p>'}
        <button type="button" class="ghost-btn notes-del" data-del-folder>🗑 Удалить каталог</button>`;
    }
    const n = N();
    return `${newForm('folder')}
      ${n.folders.length ? `<ul class="notes-list">${n.folders.map((it) => `<li><button type="button" class="notes-item" data-folder="${it.id}">📁 <span>${esc(it.name)}</span><small>${it.files.length} ${plural(it.files.length, 'файл', 'файла', 'файлов')}</small></button></li>`).join('')}</ul>` : '<p class="notes-empty">Создай первый каталог — например, по теме, которую сейчас учишь.</p>'}`;
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

  function bind() {
    screen.querySelector('[data-home]').addEventListener('click', () => Core.go('home'));
    screen.querySelector('[data-music]').addEventListener('change', (e) => window.Music && window.Music.toggleNotes(e.target.checked));
    screen.querySelectorAll('[data-to]').forEach((b) => b.addEventListener('click', () => {
      leaveFile();
      if (b.dataset.to === 'root') folderId = null;
      render();
    }));
    const form = screen.querySelector('[data-new]');
    if (form) form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.querySelector('input').value.trim();
      if (!name) return;
      if (form.dataset.new === 'folder') createFolder(name);
      else fileId = createFile(name).id;
      render();
      const ta = screen.querySelector('.notes-text');
      if (ta) ta.focus();
    });
    screen.querySelectorAll('[data-folder]').forEach((b) => b.addEventListener('click', () => { folderId = b.dataset.folder; note = ''; render(); }));
    screen.querySelectorAll('[data-file]').forEach((b) => b.addEventListener('click', () => { fileId = b.dataset.file; note = ''; render(); }));
    screen.querySelectorAll('[data-del-file]').forEach((b) => b.addEventListener('click', () => {
      const f = folder();
      const it = f.files.find((x) => x.id === b.dataset.delFile);
      if (!it || !window.confirm(`Удалить файл «${it.name}»? Текст пропадёт.`)) return;
      f.files = f.files.filter((x) => x !== it);
      note = `Файл «${it.name}» удалён.`;
      Core.save();
      render();
    }));
    const delFolder = screen.querySelector('[data-del-folder]');
    if (delFolder) delFolder.addEventListener('click', () => {
      const f = folder();
      if (!window.confirm(`Удалить каталог «${f.name}» вместе с файлами (${f.files.length})?`)) return;
      N().folders = N().folders.filter((x) => x !== f);
      folderId = null;
      note = `Каталог «${f.name}» удалён.`;
      Core.save();
      render();
    });
    const ta = screen.querySelector('.notes-text');
    if (ta) {
      const count = screen.querySelector('.notes-count');
      ta.addEventListener('input', () => {
        file().text = ta.value;
        const w = wordsIn(ta.value);
        count.textContent = `${w} ${plural(w, 'слово', 'слова', 'слов')}`;
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
