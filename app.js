(() => {
  const STORAGE_KEY = 'rank_tasks_v1';

  const PRESET_COLORS = [
    { name: 'Cyan',          hex: '#22D3EE' },
    { name: 'Neon Green',    hex: '#39FF14' },
    { name: 'Crimson',       hex: '#FF2D55' },
    { name: 'Electric Blue', hex: '#2979FF' },
    { name: 'Purple',        hex: '#9D4EDD' },
    { name: 'Orange',        hex: '#FF7A1A' },
  ];

  /* ---------------- date helpers (local time, YYYY-MM-DD) ---------------- */
  function toISODate(d){
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 10);
  }
  function todayISO(){ return toISODate(new Date()); }
  function addDaysISO(iso, days){
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    return toISODate(dt);
  }
  function formatDate(iso){
    const today = todayISO();
    if (iso < today) return 'Overdue';
    if (iso === today) return 'Today';
    if (iso === addDaysISO(today, 1)) return 'Tomorrow';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /* ---------------- storage ---------------- */
  function loadTasks(){
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveTasks(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); }

  let tasks = loadTasks();

  /* ---------------- rollover ---------------- */
  function runRollover(){
    const today = todayISO();
    let changed = false;
    tasks.forEach(t => {
      if (t.status === 'active' && t.date < today) {
        if (t.quantity === 'infinity') { t.date = today; changed = true; }
        // non-infinite overdue tasks stay put, waiting in the Vault to be rescheduled
      }
    });
    if (changed) saveTasks();
  }

  /* ---------------- derived views ---------------- */
  function getTodayTasks(){
    const today = todayISO();
    return tasks
      .filter(t => t.status === 'active' && t.date === today &&
        !(t.quantity === 'infinity' && t.lastDone === today))
      .sort((a, b) => a.dailyRank - b.dailyRank);
  }
  function getBankTasks(){
    const today = todayISO();
    return tasks
      .filter(t => t.status === 'active' && t.date !== today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.dailyRank - b.dailyRank);
  }
  function getArchivedTasks(){
    return tasks.filter(t => t.status === 'archived');
  }
  function maxRankFor(date){
    return tasks
      .filter(t => t.date === date && t.status === 'active')
      .reduce((m, t) => Math.max(m, t.dailyRank), 0);
  }

  /* ---------------- mutations ---------------- */
  function addTask({ title, color, date, quantity, rank }){
    tasks.forEach(t => {
      if (t.status === 'active' && t.date === date && t.dailyRank >= rank) t.dailyRank += 1;
    });
    tasks.push({
      id: (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random()),
      title: title.trim(),
      color,
      date,
      quantity: quantity === 'infinity' ? 'infinity' : Math.max(1, parseInt(quantity, 10) || 1),
      dailyRank: rank,
      status: 'active',
      lastDone: null,
    });
    saveTasks();
  }

  function markDone(id){
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    if (t.quantity === 'infinity') {
      t.lastDone = todayISO();
    } else if (t.quantity > 1) {
      t.quantity -= 1;
    } else {
      t.quantity = 0;
      t.status = 'archived';
    }
    saveTasks();
    renderAll();
  }

  function postpone(id){
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    const tomorrow = addDaysISO(todayISO(), 1);
    t.date = tomorrow;
    t.dailyRank = maxRankFor(tomorrow) + 1;
    saveTasks();
    renderAll();
  }

  function bringToToday(id){
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    const today = todayISO();
    t.date = today;
    t.dailyRank = maxRankFor(today) + 1;
    saveTasks();
    renderAll();
  }

  function restoreTask(id){
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    const today = todayISO();
    t.status = 'active';
    t.quantity = 1;
    t.date = today;
    t.dailyRank = maxRankFor(today) + 1;
    t.lastDone = null;
    saveTasks();
    renderAll();
  }

  function handleReorder(){
    const ids = [...taskListEl.querySelectorAll('.task-card')].map(el => el.dataset.id);
    ids.forEach((id, idx) => {
      const t = tasks.find(x => x.id === id);
      if (t) t.dailyRank = idx + 1;
    });
    saveTasks();
  }

  /* ---------------- render helpers ---------------- */
  function escapeHtml(str){
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  function hexToRgba(hex, alpha){
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(full, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  function buildCard(t){
    const card = document.createElement('div');
    card.className = 'task-card';
    card.dataset.id = t.id;
    card.style.borderLeftColor = t.color;
    card.style.boxShadow = `-6px 0 20px -10px ${hexToRgba(t.color, 0.6)}`;

    const qtyLabel = t.quantity === 'infinity'
      ? '<i class="fa-solid fa-infinity"></i> Everyday'
      : `${t.quantity} left`;

    card.innerHTML = `
      <div class="drag-handle" aria-hidden="true"><i class="fa-solid fa-grip-lines-vertical"></i></div>
      <div class="task-info">
        <p class="task-title" dir="auto">${escapeHtml(t.title)}</p>
        <p class="task-meta">${qtyLabel}</p>
      </div>
      <button class="icon-btn postpone-btn" aria-label="Postpone to tomorrow"><i class="fa-solid fa-forward"></i></button>
      <button class="icon-btn done-btn" aria-label="Mark done" style="background:${t.color};"><i class="fa-solid fa-check"></i></button>
    `;
    card.querySelector('.postpone-btn').addEventListener('click', () => postpone(t.id));
    card.querySelector('.done-btn').addEventListener('click', () => {
      card.classList.add('card-done');
      card.addEventListener('transitionend', () => markDone(t.id), { once: true });
    });
    return card;
  }

  function buildBankRow(t){
    const row = document.createElement('div');
    row.className = 'list-row';
    const overdue = t.date < todayISO();
    row.innerHTML = `
      <span class="dot" style="background:${t.color}"></span>
      <div class="list-info">
        <p class="list-title" dir="auto">${escapeHtml(t.title)}${t.quantity === 'infinity' ? '<span class="badge-everyday">Everyday</span>' : ''}</p>
        <p class="list-meta ${overdue ? 'overdue' : ''}">${formatDate(t.date)}</p>
      </div>
      <button class="pill-btn bring-btn">Bring to today</button>
    `;
    row.querySelector('.bring-btn').addEventListener('click', () => bringToToday(t.id));
    return row;
  }

  function buildArchiveRow(t){
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <span class="dot" style="background:${t.color}"></span>
      <div class="list-info">
        <p class="list-title" dir="auto">${escapeHtml(t.title)}</p>
        <p class="list-meta">Completed</p>
      </div>
      <button class="pill-btn restore-btn">Restore</button>
    `;
    row.querySelector('.restore-btn').addEventListener('click', () => restoreTask(t.id));
    return row;
  }

  function renderDaily(){
    const items = getTodayTasks();
    taskListEl.innerHTML = '';
    const hasItems = items.length > 0;
    taskListEl.classList.toggle('hidden', !hasItems);
    emptyStateEl.classList.toggle('hidden', hasItems);
    items.forEach(t => taskListEl.appendChild(buildCard(t)));
  }

  function renderBank(){
    const items = getBankTasks();
    bankListEl.innerHTML = '';
    if (!items.length) {
      bankListEl.innerHTML = '<p class="empty-row">Nothing waiting to be scheduled.</p>';
      return;
    }
    items.forEach(t => bankListEl.appendChild(buildBankRow(t)));
  }

  function renderArchive(){
    const items = getArchivedTasks();
    archiveListEl.innerHTML = '';
    if (!items.length) {
      archiveListEl.innerHTML = '<p class="empty-row">No completed tasks yet.</p>';
      return;
    }
    items.forEach(t => archiveListEl.appendChild(buildArchiveRow(t)));
  }

  function renderAll(){
    renderDaily();
    renderBank();
    renderArchive();
  }

  /* ---------------- DOM refs ---------------- */
  let taskListEl, emptyStateEl, bankListEl, archiveListEl, todayLabelEl;
  let addModal, taskForm, titleInput, colorSwatchesEl, customColorTrigger, customColorInput,
      dateInput, rankInput, quantityInput, infinityToggle, closeModalBtn, modalBackdrop;
  let vaultView, openVaultBtn, closeVaultBtn, navToday, navVault, fabAdd, vaultTabs, bankListWrap, archiveListWrap;

  let selectedColor = PRESET_COLORS[0].hex;

  function cacheDom(){
    taskListEl = document.getElementById('taskList');
    emptyStateEl = document.getElementById('emptyState');
    bankListEl = document.getElementById('bankList');
    archiveListEl = document.getElementById('archiveList');
    todayLabelEl = document.getElementById('todayLabel');

    addModal = document.getElementById('addModal');
    taskForm = document.getElementById('taskForm');
    titleInput = document.getElementById('titleInput');
    colorSwatchesEl = document.getElementById('colorSwatches');
    customColorTrigger = document.getElementById('customColorTrigger');
    customColorInput = document.getElementById('customColorInput');
    dateInput = document.getElementById('dateInput');
    rankInput = document.getElementById('rankInput');
    quantityInput = document.getElementById('quantityInput');
    infinityToggle = document.getElementById('infinityToggle');
    closeModalBtn = document.getElementById('closeModalBtn');
    modalBackdrop = document.getElementById('modalBackdrop');

    vaultView = document.getElementById('vaultView');
    openVaultBtn = document.getElementById('openVaultBtn');
    closeVaultBtn = document.getElementById('closeVaultBtn');
    navToday = document.getElementById('navToday');
    navVault = document.getElementById('navVault');
    fabAdd = document.getElementById('fabAdd');
    vaultTabs = [...document.querySelectorAll('.vault-tab')];
  }

  /* ---------------- color swatches ---------------- */
  function buildSwatches(){
    PRESET_COLORS.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-swatch' + (i === 0 ? ' selected' : '');
      btn.style.background = c.hex;
      btn.dataset.hex = c.hex;
      btn.setAttribute('aria-label', c.name);
      btn.title = c.name;
      colorSwatchesEl.appendChild(btn);
    });
    colorSwatchesEl.addEventListener('click', e => {
      const btn = e.target.closest('.color-swatch');
      if (!btn) return;
      selectColor(btn.dataset.hex, btn);
    });
    customColorTrigger.addEventListener('click', () => customColorInput.click());
    customColorInput.addEventListener('input', () => selectColor(customColorInput.value, customColorTrigger));
  }
  function selectColor(hex, activeEl){
    selectedColor = hex;
    [...colorSwatchesEl.children, customColorTrigger].forEach(el => el.classList.remove('selected'));
    activeEl.classList.add('selected');
    if (activeEl === customColorTrigger) customColorTrigger.style.background = hex;
  }

  /* ---------------- modal ---------------- */
  function openModal(){
    taskForm.reset();
    selectColor(PRESET_COLORS[0].hex, colorSwatchesEl.children[0]);
    dateInput.value = todayISO();
    quantityInput.value = 1;
    quantityInput.disabled = false;
    updateSuggestedRank();
    addModal.classList.remove('hidden');
    setTimeout(() => titleInput.focus(), 50);
  }
  function closeModal(){ addModal.classList.add('hidden'); }

  function updateSuggestedRank(){
    const date = dateInput.value || todayISO();
    rankInput.value = maxRankFor(date) + 1;
  }

  function handleSubmit(e){
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    const date = dateInput.value || todayISO();
    const rank = Math.max(1, parseInt(rankInput.value, 10) || 1);
    const quantity = infinityToggle.checked ? 'infinity' : quantityInput.value;
    addTask({ title, color: selectedColor, date, quantity, rank });
    closeModal();
    renderAll();
  }

  /* ---------------- vault ---------------- */
  function openVault(){
    vaultView.classList.remove('hidden');
    navVault.classList.add('active');
    navToday.classList.remove('active');
    renderBank();
    renderArchive();
  }
  function closeVault(){
    vaultView.classList.add('hidden');
    navToday.classList.add('active');
    navVault.classList.remove('active');
  }
  function switchVaultTab(tab){
    vaultTabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    bankListEl.classList.toggle('hidden', tab !== 'bank');
    archiveListEl.classList.toggle('hidden', tab !== 'archive');
  }

  /* ---------------- wiring ---------------- */
  function setupEvents(){
    fabAdd.addEventListener('click', openModal);
    closeModalBtn.addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', closeModal);
    taskForm.addEventListener('submit', handleSubmit);
    dateInput.addEventListener('change', updateSuggestedRank);
    infinityToggle.addEventListener('change', () => { quantityInput.disabled = infinityToggle.checked; });

    openVaultBtn.addEventListener('click', openVault);
    navVault.addEventListener('click', openVault);
    closeVaultBtn.addEventListener('click', closeVault);
    navToday.addEventListener('click', closeVault);

    vaultTabs.forEach(btn => btn.addEventListener('click', () => switchVaultTab(btn.dataset.tab)));
  }

  function initSortable(){
    new Sortable(taskListEl, {
      handle: '.drag-handle',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onEnd: handleReorder,
    });
  }

  function registerSW(){
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    todayLabelEl.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    runRollover();
    buildSwatches();
    setupEvents();
    initSortable();
    renderAll();
    registerSW();
  });
})();
