/* ══════════════════════════════════════════════════════════════════════════
   LUMINARY READER — App Logic
   ══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  library:      [],
  currentBook:  null,
  currentPage:  0,
  totalPages:   0,
  zoom:         1.0,
  fitMode:      'width',   // 'width' | 'height' | 'original'
  epubChapters: [],
  mangaPages:   [],
  spreadMode:   false,
  epubSpreadMode: false,
  rtlMode:      false,
  filter:       'all',
  search:       '',
  contextTarget: null,
};

// ── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const bookGrid        = $('bookGrid');
const emptyLibrary    = $('emptyLibrary');
const bookCountEl     = $('bookCount');
const searchInput     = $('searchInput');
const readerTitle     = $('readerTitle');
const readerPageInfo  = $('readerPageInfo');
const pageContainer   = $('pageContainer');
const readerProgress  = $('readerProgress');
const pageJumpInput   = $('pageJumpInput');
const pageJumpTotal   = $('pageJumpTotal');
const brightnessSlider = $('brightnessSlider');
const brightnessOverlay= $('brightnessOverlay');
const tocPanel        = $('tocPanel');
const tocList         = $('tocList');
const contextMenu     = $('contextMenu');
const addModal        = $('addModal');
const dropZone        = $('dropZone');
const pathInput       = $('pathInput');
const addStatus       = $('addStatus');
const zoomLevelEl     = $('zoomLevel');

// ── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  loadLibrary();
  setupListeners();
});

// ══════════════════════════════════════════════════════════════════════════════
// LIBRARY
// ══════════════════════════════════════════════════════════════════════════════

async function loadLibrary() {
  const res  = await fetch('/api/library');
  state.library = await res.json();
  renderLibrary();
}

function renderLibrary() {
  const q    = state.search.toLowerCase();
  const type = state.filter;
  let items  = state.library.filter(b => {
    const matchQ = !q || b.title.toLowerCase().includes(q);
    const matchT = type === 'all' || b.type === type;
    return matchQ && matchT;
  });

  bookGrid.innerHTML = '';
  bookCountEl.textContent = `${items.length} book${items.length !== 1 ? 's' : ''}`;

  if (!items.length) {
    emptyLibrary.style.display = 'flex';
    return;
  }
  emptyLibrary.style.display = 'none';

  items.forEach((book, idx) => {
    const pct  = book.total > 0 ? Math.round((book.progress / book.total) * 100) : 0;
    const icon = book.type === 'pdf' ? '📄' : book.type === 'epub' ? '📖' : '📚';
    const card = document.createElement('div');
    card.className = 'book-card';
    card.dataset.id = book.id;
    card.style.animationDelay = `${idx * 0.04}s`;

    card.innerHTML = `
      <div id="cover-${book.id}">
        <div class="book-cover-placeholder">${icon}</div>
      </div>
      <div class="book-info">
        <div class="book-title" title="${esc(book.title)}">${esc(book.title)}</div>
        <span class="book-type-badge badge-${book.type}">${book.type.toUpperCase()}</span>
        <div class="book-progress-bar">
          <div class="book-progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="book-progress-label">${pct}% complete${book.total ? ` · ${book.progress}/${book.total}` : ''}</div>
      </div>
      <div class="book-card-menu">
        <button class="menu-dot" data-id="${book.id}" title="Options">⋮</button>
      </div>
    `;
    bookGrid.appendChild(card);

    // Load cover lazily
    loadCover(book.id);
  });
}

async function loadCover(bid) {
  const wrapper = document.getElementById(`cover-${bid}`);
  if (!wrapper) return;
  try {
    const res = await fetch(`/api/cover/${bid}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    wrapper.innerHTML = `<img class="book-cover" src="${url}" alt="cover" loading="lazy"/>`;
  } catch {}
}

// ══════════════════════════════════════════════════════════════════════════════
// OPEN BOOK
// ══════════════════════════════════════════════════════════════════════════════

async function openBook(bid) {
  const book = state.library.find(b => b.id === bid);
  if (!book) return;
  state.currentBook    = book;
  state.currentPage    = book.progress || 0;
  state.zoom           = 1.0;
  state.spreadMode     = false;
  state.epubSpreadMode = false;
  state.epubChapters   = [];
  state.mangaPages     = [];
  tocList.innerHTML    = '';
  tocPanel.classList.add('hidden');
  // Reset epub spread button appearance
  const esBtn = $('epubSpreadToggle');
  if (esBtn) { esBtn.classList.remove('active-toggle'); esBtn.title = 'Two-page spread'; }

  showView('reader');
  readerTitle.textContent = book.title;
  $('mangaControls').classList.add('hidden');
  $('epubControls').classList.add('hidden');

  if (book.type === 'pdf') {
    await openPDF(book);
  } else if (book.type === 'epub') {
    $('epubControls').classList.remove('hidden');
    await openEPUB(book);
  } else if (book.type === 'manga') {
    await openManga(book);
  }
}

// ─── PDF ─────────────────────────────────────────────────────────────────────
async function openPDF(book) {
  const info = await (await fetch(`/api/pdf/info?path=${enc(book.path)}`)).json();
  state.totalPages = info.pages;
  updatePageUI();
  await renderPDFPage();
}

async function renderPDFPage() {
  pageContainer.innerHTML = `<div class="spinner"></div>`;
  const p    = state.currentPage;
  const book = state.currentBook;
  const scale = state.zoom * 1.5;
  const url  = `/api/pdf/page?path=${enc(book.path)}&page=${p}&scale=${scale}`;
  const img  = new Image();
  img.className = 'reader-page loading';
  img.onload    = () => { img.classList.remove('loading'); };
  img.src       = url;
  pageContainer.innerHTML = '';
  pageContainer.appendChild(img);
  applyZoom();
  saveProgress();
}

// ─── EPUB ─────────────────────────────────────────────────────────────────────
async function openEPUB(book) {
  const data = await (await fetch(`/api/epub/chapters?path=${enc(book.path)}`)).json();
  if (data.error) { pageContainer.innerHTML = `<p style="color:var(--text2);padding:40px">${data.error}</p>`; return; }
  state.epubChapters = data.chapters;
  state.totalPages   = data.total;
  updatePageUI();
  // TOC
  tocList.innerHTML = data.chapters.map((ch, i) =>
    `<li class="toc-item" data-index="${i}">${esc(ch.title)}</li>`
  ).join('');
  tocList.querySelectorAll('.toc-item').forEach(li => {
    li.addEventListener('click', () => {
      state.currentPage = parseInt(li.dataset.index);
      renderEPUBChapter();
    });
  });
  await renderEPUBChapter();
}

async function renderEPUBChapter() {
  pageContainer.innerHTML = '<div class="spinner"></div>';
  const book = state.currentBook;
  const idx  = state.currentPage;

  if (state.epubSpreadMode) {
    // Fetch two chapters at once
    const data = await (await fetch(`/api/epub/chapter_pair?path=${enc(book.path)}&index=${idx}`)).json();
    if (data.error) { pageContainer.innerHTML = `<p>${data.error}</p>`; return; }

    const wrapper = document.createElement('div');
    wrapper.className = 'epub-spread-wrapper';

    function makePane(chData) {
      if (!chData) {
        const empty = document.createElement('div');
        empty.className = 'epub-content epub-spread-pane epub-spread-empty';
        return empty;
      }
      const div = document.createElement('div');
      div.className = 'epub-content epub-spread-pane';
      div.innerHTML = chData.html;
      div.querySelectorAll('a').forEach(a => a.addEventListener('click', e => e.preventDefault()));
      return div;
    }

    wrapper.appendChild(makePane(data.left));
    if (data.right) wrapper.appendChild(makePane(data.right));
    pageContainer.innerHTML = '';
    pageContainer.appendChild(wrapper);
  } else {
    // Single chapter
    const data = await (await fetch(`/api/epub/chapter?path=${enc(book.path)}&index=${idx}`)).json();
    if (data.error) { pageContainer.innerHTML = `<p>${data.error}</p>`; return; }
    const div = document.createElement('div');
    div.className = 'epub-content';
    div.innerHTML = data.html;
    div.querySelectorAll('a').forEach(a => a.addEventListener('click', e => e.preventDefault()));
    pageContainer.innerHTML = '';
    pageContainer.appendChild(div);
  }

  // Highlight TOC
  tocList.querySelectorAll('.toc-item').forEach(li => {
    li.classList.toggle('active', parseInt(li.dataset.index) === idx);
  });
  updatePageUI();
  saveProgress();
  document.querySelector('.reader-canvas').scrollTop = 0;
}

// ─── MANGA ─────────────────────────────────────────────────────────────────
async function openManga(book) {
  const data = await (await fetch(`/api/manga/pages?path=${enc(book.path)}`)).json();
  state.mangaPages  = data.pages;
  state.totalPages  = data.total;
  $('mangaControls').classList.remove('hidden');
  updatePageUI();
  await renderMangaPage();
}

async function renderMangaPage() {
  pageContainer.innerHTML = `<div class="spinner"></div>`;
  const book = state.currentBook;
  const p    = state.currentPage;

  if (state.spreadMode && p + 1 < state.totalPages) {
    const i1 = state.rtlMode ? p + 1 : p;
    const i2 = state.rtlMode ? p     : p + 1;
    const [img1, img2] = await Promise.all([loadMangaImg(book.path, i1), loadMangaImg(book.path, i2)]);
    const spread = document.createElement('div');
    spread.className = 'manga-spread';
    if (state.rtlMode) { spread.appendChild(img2); spread.appendChild(img1); }
    else               { spread.appendChild(img1); spread.appendChild(img2); }
    pageContainer.innerHTML = '';
    pageContainer.appendChild(spread);
  } else {
    const img = await loadMangaImg(book.path, p);
    pageContainer.innerHTML = '';
    pageContainer.appendChild(img);
  }
  applyZoom();
  saveProgress();
}

function loadMangaImg(path, index) {
  return new Promise(resolve => {
    const img = new Image();
    img.className = 'reader-page';
    img.src = `/api/manga/page?path=${enc(path)}&index=${index}`;
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(img);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════

function goToPage(n) {
  n = Math.max(0, Math.min(n, state.totalPages - 1));
  if (n === state.currentPage) return;
  state.currentPage = n;
  renderCurrentPage();
  updatePageUI();
}

function pageStep() {
  // How many pages/chapters to advance per press
  const type = state.currentBook?.type;
  if (type === 'epub'  && state.epubSpreadMode) return 2;
  if (type === 'manga' && state.spreadMode)     return 2;
  return 1;
}

function renderCurrentPage() {
  const type = state.currentBook?.type;
  if (type === 'pdf')   renderPDFPage();
  if (type === 'epub')  renderEPUBChapter();
  if (type === 'manga') renderMangaPage();
}

function updatePageUI() {
  const p = state.currentPage;
  const t = state.totalPages;
  const displayPage = p + 1;
  const label = state.currentBook?.type === 'epub' ? 'Chapter' : 'Page';
  readerPageInfo.textContent = `${label} ${displayPage} / ${t}`;
  pageJumpInput.value = displayPage;
  pageJumpTotal.textContent = `/ ${t}`;
  const pct = t > 0 ? (p / (t - 1)) * 100 : 0;
  readerProgress.style.width = pct + '%';
  $('prevPage').disabled = p <= 0;
  $('nextPage').disabled = p >= t - 1;
}

async function saveProgress() {
  const book = state.currentBook;
  if (!book) return;
  await fetch('/api/library/progress', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ id: book.id, page: state.currentPage })
  });
  // Update in-memory library
  const idx = state.library.findIndex(b => b.id === book.id);
  if (idx !== -1) state.library[idx].progress = state.currentPage;
}

// ══════════════════════════════════════════════════════════════════════════════
// ZOOM
// ══════════════════════════════════════════════════════════════════════════════

function applyZoom() {
  pageContainer.style.transform = `scale(${state.zoom})`;
  pageContainer.style.transformOrigin = 'top center';
  zoomLevelEl.textContent = Math.round(state.zoom * 100) + '%';
}

// ══════════════════════════════════════════════════════════════════════════════
// ADD BOOK
// ══════════════════════════════════════════════════════════════════════════════

async function addByPath(path) {
  // Strip surrounding quotes people sometimes paste with paths
  path = path.trim().replace(/^["']|["']$/g, '');
  if (!path) return;
  addStatus.innerHTML = 'Checking: <code style="font-size:11px;color:var(--text3)">' + esc(path) + '</code>';
  addStatus.className = 'add-status';
  try {
    const res  = await fetch('/api/library/add', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (data.error) {
      addStatus.innerHTML = 'Error: ' + esc(data.error)
        + (data.tip ? '<br><small style="color:var(--text3);display:block;margin-top:4px">Tip: ' + esc(data.tip) + '</small>' : '');
      addStatus.className = 'add-status err';
    } else {
      addStatus.textContent = 'Added: ' + data.title;
      addStatus.className   = 'add-status ok';
      pathInput.value       = '';
      await loadLibrary();
    }
  } catch (err) {
    addStatus.textContent = 'Network error: ' + err.message;
    addStatus.className   = 'add-status err';
  }
}

// Upload actual file bytes to server → server saves to uploads/ → absolute path
async function uploadFiles(files) {
  for (const file of files) {
    addStatus.innerHTML = 'Uploading: <code style="font-size:11px;color:var(--text3)">' + esc(file.name) + '</code>';
    addStatus.className = 'add-status';
    const form = new FormData();
    form.append('file', file);
    try {
      const res  = await fetch('/api/library/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (data.error) {
        addStatus.innerHTML = 'Error: ' + esc(data.error);
        addStatus.className = 'add-status err';
      } else {
        addStatus.textContent = 'Added: ' + data.title;
        addStatus.className   = 'add-status ok';
        await loadLibrary();
      }
    } catch (err) {
      addStatus.textContent = 'Upload failed: ' + err.message;
      addStatus.className   = 'add-status err';
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VIEWS
// ══════════════════════════════════════════════════════════════════════════════

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.view === name || (name === 'reader' && n.dataset.view === 'library'));
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// THEME
// ══════════════════════════════════════════════════════════════════════════════

function setTheme(name) {
  document.body.dataset.theme = name;
  localStorage.setItem('luminary-theme', name);
  document.querySelectorAll('.theme-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.theme === name);
  });
}

function loadTheme() {
  const saved = localStorage.getItem('luminary-theme') || 'dark';
  setTheme(saved);
}

// ══════════════════════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ══════════════════════════════════════════════════════════════════════════════

function setupListeners() {

  // Sidebar toggle
  $('sidebarToggle').addEventListener('click', () => {
    $('sidebar').classList.toggle('collapsed');
  });

  // Nav items
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      if (v) showView(v);
    });
  });

  // Theme pills
  document.querySelectorAll('.theme-pill').forEach(pill => {
    pill.addEventListener('click', () => setTheme(pill.dataset.theme));
  });

  // Brightness
  brightnessSlider.addEventListener('input', () => {
    const val = parseInt(brightnessSlider.value);
    brightnessOverlay.style.opacity = (100 - val) / 100 * 0.7;
  });

  // Search
  searchInput.addEventListener('input', e => {
    state.search = e.target.value;
    renderLibrary();
  });

  // Filter tabs
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.filter = tab.dataset.filter;
      renderLibrary();
    });
  });

  // Add book buttons
  ['addBookBtn','addBookBtn2'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('click', () => openModal());
  });

  // Book grid clicks (open + context)
  bookGrid.addEventListener('click', e => {
    const card = e.target.closest('.book-card');
    const menuBtn = e.target.closest('.menu-dot');
    if (menuBtn) {
      e.stopPropagation();
      showContextMenu(menuBtn.dataset.id, e.clientX, e.clientY);
      return;
    }
    if (card) openBook(card.dataset.id);
  });

  // Back to library
  $('backToLibrary').addEventListener('click', () => {
    showView('library');
    loadLibrary(); // refresh progress
  });

  // Navigation buttons
  $('prevPage').addEventListener('click', () => goToPage(state.currentPage - pageStep()));
  $('nextPage').addEventListener('click', () => goToPage(state.currentPage + pageStep()));

  // Page jump
  pageJumpInput.addEventListener('change', e => {
    goToPage(parseInt(e.target.value) - 1);
  });

  // Keyboard nav
  document.addEventListener('keydown', e => {
    if (!state.currentBook) return;
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
      e.preventDefault(); goToPage(state.currentPage + pageStep());
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault(); goToPage(state.currentPage - pageStep());
    }
    if (e.key === 'Escape') {
      if (!tocPanel.classList.contains('hidden')) { tocPanel.classList.add('hidden'); return; }
      showView('library'); loadLibrary();
    }
    if (e.key === '+' || e.key === '=') { state.zoom = Math.min(3.0, state.zoom + 0.1); applyZoom(); }
    if (e.key === '-')                   { state.zoom = Math.max(0.3, state.zoom - 0.1); applyZoom(); }
    if (e.key === '0')                   { state.zoom = 1.0; applyZoom(); }
  });

  // Zoom controls
  $('zoomIn').addEventListener('click',  () => { state.zoom = Math.min(3.0, state.zoom + 0.15); applyZoom(); });
  $('zoomOut').addEventListener('click', () => { state.zoom = Math.max(0.2, state.zoom - 0.15); applyZoom(); });

  // Fit toggle
  $('fitToggleBtn').addEventListener('click', () => {
    const modes = ['width','height','original'];
    const i     = modes.indexOf(state.fitMode);
    state.fitMode = modes[(i+1) % modes.length];
    applyZoom();
  });

  // TOC
  $('tocToggleBtn').addEventListener('click', () => tocPanel.classList.toggle('hidden'));
  $('tocClose').addEventListener('click',     () => tocPanel.classList.add('hidden'));

  // Manga controls
  $('spreadToggle').addEventListener('click', () => {
    state.spreadMode = !state.spreadMode;
    renderMangaPage();
  });
  $('dirToggle').addEventListener('click', () => {
    state.rtlMode = !state.rtlMode;
    $('mangaReadDir').textContent = state.rtlMode ? 'RTL' : 'LTR';
    renderMangaPage();
  });

  // Modal
  $('modalClose').addEventListener('click', closeModal);
  addModal.addEventListener('click', e => { if (e.target === addModal) closeModal(); });
  $('addPathBtn').addEventListener('click', () => addByPath(pathInput.value));
  pathInput.addEventListener('keydown', e => { if (e.key === 'Enter') addByPath(pathInput.value); });

  // Browse files — upload actual bytes, get back absolute server path
  $('browseBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', e => {
    const files = Array.from(e.target.files);
    if (files.length) uploadFiles(files);
    e.target.value = ''; // reset so same file can be re-selected
  });

  // Drag & drop on drop zone — upload bytes too
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave',() => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files);
    if (files.length) uploadFiles(files);
  });

  // EPUB two-page spread toggle
  $('epubSpreadToggle').addEventListener('click', () => {
    state.epubSpreadMode = !state.epubSpreadMode;
    const btn = $('epubSpreadToggle');
    btn.classList.toggle('active-toggle', state.epubSpreadMode);
    btn.title = state.epubSpreadMode ? 'Single page' : 'Two-page spread';
    if (state.currentBook?.type === 'epub') renderEPUBChapter();
  });

  // Context menu
  $('ctxOpen').addEventListener('click',   () => { closeContextMenu(); if (state.contextTarget) openBook(state.contextTarget); });
  $('ctxRemove').addEventListener('click', () => {
    if (state.contextTarget) {
      fetch(`/api/library/remove/${state.contextTarget}`, { method: 'DELETE' })
        .then(() => { closeContextMenu(); loadLibrary(); });
    }
  });
  document.addEventListener('click', closeContextMenu);

  // Touch swipe for reader
  let touchStartX = 0;
  $('readerCanvas').addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; });
  $('readerCanvas').addEventListener('touchend',   e => {
    const dx   = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 60) {
      if (dx < 0) goToPage(state.currentPage + pageStep());
      else        goToPage(state.currentPage - pageStep());
    }
  });
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal() {
  addModal.classList.remove('hidden');
  addStatus.textContent = '';
  pathInput.value = '';
  setTimeout(() => pathInput.focus(), 50);
}
function closeModal() {
  addModal.classList.add('hidden');
}

// ── Context menu helpers ──────────────────────────────────────────────────────
function showContextMenu(bid, x, y) {
  state.contextTarget = bid;
  contextMenu.classList.remove('hidden');
  // Position within viewport
  contextMenu.style.left = Math.min(x, window.innerWidth  - 200) + 'px';
  contextMenu.style.top  = Math.min(y, window.innerHeight - 100) + 'px';
}
function closeContextMenu() {
  contextMenu.classList.add('hidden');
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function enc(s) { return encodeURIComponent(s); }
