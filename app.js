(() => {
  const STORAGE_KEY = 'rank_tasks_v1';
  const MUTE_KEY = 'rank_muted_v1';

  const PRESET_COLORS = [
    { name: 'Cyan',          hex: '#22D3EE' },
    { name: 'Neon Green',    hex: '#39FF14' },
    { name: 'Crimson',       hex: '#FF2D55' },
    { name: 'Electric Blue', hex: '#2979FF' },
    { name: 'Purple',        hex: '#9D4EDD' },
    { name: 'Orange',        hex: '#FF7A1A' },
  ];

  /* ================= Sound Engine (Web Audio API, synthesized, no files) ================= */
  const SoundEngine = (() => {
    let ctx = null;
    let muted = localStorage.getItem(MUTE_KEY) === '1';

    function ensureCtx(){
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function tone(ac, freq, startTime, duration, peakGain, type){
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(gain).connect(ac.destination);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.03);
    }

    function tick(){
      if (muted) return;
      const ac = ensureCtx();
      if (!ac) return;
      tone(ac, 720, ac.currentTime, 0.05, 0.05, 'square');
    }

    function chime(){
      if (muted) return;
      const ac = ensureCtx();
      if (!ac) return;
      const now = ac.currentTime;
      tone(ac, 880, now, 0.16, 0.09, 'sine');
      tone(ac, 1318.5, now + 0.07, 0.24, 0.08, 'sine');
    }

    function isMuted(){ return muted; }
    function setMuted(v){
      muted = v;
      localStorage.setItem(MUTE_KEY, v ? '1' : '0');
    }
    function toggle(){ setMuted(!muted); return muted; }

    return { tick, chime, isMuted, setMuted, toggle };
  })();

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
      if (t.status === 'active' && t.date && t.date < today) {
        if (t.quantity === 'infinity') { t.date = today; changed = true; }
        // non-infinite overdue tasks stay put, waiting in All Tasks to be rescheduled
      }
    });
    if (changed) saveTasks();
  }

  /* ---------------- derived views ---------------- */
  // Rank 1 is always top priority and must render first — ascending sort by dailyRank.
  function getTodayTasks(){
    const today = todayISO();
    return tasks
      .filter(t => t.status === 'active' && t.date === today &&
        !(t.quantity === 'infinity' && t.lastDone === today))
      .sort((a, b) => a.dailyRank - b.dailyRank);
  }

  // Every active task in the system, dated or not. Unscheduled tasks surface first
  // (they need attention), then scheduled tasks ordered by date, then by rank.
  function getAllActiveTasks(){
    return tasks
      .filter(t => t.status === 'active')
      .sort((a, b) => {
        if (!a.date && !b.date) return a.dailyRank - b.dailyRank;
        if (!a.date) return -1;
        if (!b.date) return 1;
        return a.date.localeCompare(b.date) || a.dailyRank - b.dailyRank;
      });
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
    let finalRank = date ? rank : 0;
    if (date) {
      // Rank 1 always sits on top. If the requested rank is already taken,
      // the existing task KEEPS its rank and the new task is inserted just below it,
      // with everything from that point on shifted down by one.
      const collision = tasks.some(t => t.status === 'active' && t.date === date && t.dailyRank === rank);
      if (collision) {
        finalRank = rank + 1;
        tasks.forEach(t => {
          if (t.status === 'active' && t.date === date && t.dailyRank >= finalRank) t.dailyRank += 1;
        });
      }
    }
    tasks.push({
      id: (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random()),
      title: title.trim(),
      color,
      date: date || null,
      quantity: quantity === 'infinity' ? 'infinity' : Math.max(1, parseInt(quantity, 10) || 1),
      dailyRank: finalRank,
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

  function assignDate(id, dateStr){
    const t = tasks.find(x => x.id === id);
    if (!t || !dateStr) return;
    t.date = dateStr;
    t.dailyRank = maxRankFor(dateStr) + 1;
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

  // Drag-and-drop reorder: top-to-bottom DOM order becomes rank 1, 2, 3...
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
    card.style.setProperty('--card-border', hexToRgba(t.color, 0.55));
    card.style.setProperty('--card-tint-strong', hexToRgba(t.color, 0.30));
    card.style.setProperty('--card-tint-soft', hexToRgba(t.color, 0.09));
    card.style.setProperty('--card-glow', hexToRgba(t.color, 0.45));

    card.innerHTML = `
      <div class="drag-handle" aria-hidden="true"><i class="fa-solid fa-grip-lines-vertical"></i></div>
      <div class="task-info">
        <p class="task-title" dir="auto">${escapeHtml(t.title)}</p>
      </div>
      <div class="card-actions">
        <button class="icon-btn postpone-btn" aria-label="Postpone to tomorrow"><i class="fa-solid fa-forward"></i></button>
        <button class="icon-btn done-btn" aria-label="Mark done"><i class="fa-solid fa-check"></i></button>
      </div>
    `;
    card.querySelector('.postpone-btn').addEventListener('click', () => {
      SoundEngine.tick();
      postpone(t.id);
    });
    card.querySelector('.done-btn').addEventListener('click', () => {
      SoundEngine.chime();
      card.classList.add('card-done');
      card.addEventListener('transitionend', () => markDone(t.id), { once: true });
    });
    return card;
  }

  function buildAllTasksRow(t){
    const row = document.createElement('div');
    row.className = 'list-row';
    const unscheduled = !t.date;
    const overdue = !unscheduled && t.date < todayISO();
    const isToday = t.date === todayISO();

    row.innerHTML = `
      <span class="dot" style="background:${t.color}"></span>
      <div class="list-info">
        <p class="list-title" dir="auto">${escapeHtml(t.title)}${t.quantity === 'infinity' ? '<span class="badge-everyday">Everyday</span>' : ''}</p>
        <p class="list-meta ${overdue ? 'overdue' : ''}">${unscheduled ? 'Unscheduled' : formatDate(t.date)}</p>
      </div>
      <button class="icon-btn reschedule-btn" aria-label="Pick a date" style="width:38px;height:38px;background:rgba(255,255,255,0.06);color:var(--text-secondary);">
        <i class="fa-solid fa-calendar"></i>
      </button>
      ${isToday ? '<span class="badge-everyday">Today</span>' : '<button class="pill-btn today-btn">Add to today</button>'}
      <input type="date" class="hidden-date-input" tabindex="-1">
    `;

    const dateInputEl = row.querySelector('.hidden-date-input');
    row.querySelector('.reschedule-btn').addEventListener('click', () => {
      dateInputEl.value = t.date || todayISO();
      if (dateInputEl.showPicker) dateInputEl.showPicker();
      else dateInputEl.click();
    });
    dateInputEl.addEventListener('change', (e) => {
      SoundEngine.tick();
      assignDate(t.id, e.target.value);
    });
    const todayBtn = row.querySelector('.today-btn');
    if (todayBtn) todayBtn.addEventListener('click', () => { SoundEngine.tick(); bringToToday(t.id); });

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
    row.querySelector('.restore-btn').addEventListener('click', () => { SoundEngine.tick(); restoreTask(t.id); });
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

  function renderAllTasks(){
    const items = getAllActiveTasks();
    allTasksListEl.innerHTML = '';
    if (!items.length) {
      allTasksListEl.innerHTML = '<p class="empty-row">No tasks yet. Add one to get started.</p>';
      return;
    }
    items.forEach(t => allTasksListEl.appendChild(buildAllTasksRow(t)));
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
    renderAllTasks();
    renderArchive();
  }

  /* ---------------- DOM refs ---------------- */
  let taskListEl, emptyStateEl, allTasksListEl, archiveListEl, todayLabelEl;
  let addModal, taskForm, titleInput, colorSwatchesEl, customColorTrigger, customColorInput,
      scheduleToggle, scheduleFieldsEl, unscheduledNoteEl,
      dateInput, rankInput, quantityInput, infinityToggle, closeModalBtn, modalBackdrop;
  let allTasksView, archiveView, openArchiveBtn, closeArchiveBtn, closeAllTasksBtn;
  let navToday, navAllTasks, fabAdd, soundToggleBtn;

  let selectedColor = PRESET_COLORS[0].hex;

  function cacheDom(){
    taskListEl = document.getElementById('taskList');
    emptyStateEl = document.getElementById('emptyState');
    allTasksListEl = document.getElementById('allTasksList');
    archiveListEl = document.getElementById('archiveList');
    todayLabelEl = document.getElementById('todayLabel');

    addModal = document.getElementById('addModal');
    taskForm = document.getElementById('taskForm');
    titleInput = document.getElementById('titleInput');
    colorSwatchesEl = document.getElementById('colorSwatches');
    customColorTrigger = document.getElementById('customColorTrigger');
    customColorInput = document.getElementById('customColorInput');
    scheduleToggle = document.getElementById('scheduleToggle');
    scheduleFieldsEl = document.getElementById('scheduleFields');
    unscheduledNoteEl = document.getElementById('unscheduledNote');
    dateInput = document.getElementById('dateInput');
    rankInput = document.getElementById('rankInput');
    quantityInput = document.getElementById('quantityInput');
    infinityToggle = document.getElementById('infinityToggle');
    closeModalBtn = document.getElementById('closeModalBtn');
    modalBackdrop = document.getElementById('modalBackdrop');

    allTasksView = document.getElementById('allTasksView');
    archiveView = document.getElementById('archiveView');
    openArchiveBtn = document.getElementById('openArchiveBtn');
    closeArchiveBtn = document.getElementById('closeArchiveBtn');
    closeAllTasksBtn = document.getElementById('closeAllTasksBtn');
    navToday = document.getElementById('navToday');
    navAllTasks = document.getElementById('navAllTasks');
    fabAdd = document.getElementById('fabAdd');
    soundToggleBtn = document.getElementById('soundToggleBtn');
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
  function updateScheduleVisibility(){
    const on = scheduleToggle.checked;
    scheduleFieldsEl.classList.toggle('hidden', !on);
    unscheduledNoteEl.classList.toggle('hidden', on);
    dateInput.required = on;
    rankInput.required = on;
  }

  function openModal(){
    taskForm.reset();
    selectColor(PRESET_COLORS[0].hex, colorSwatchesEl.children[0]);
    scheduleToggle.checked = true;
    dateInput.value = todayISO();
    quantityInput.value = 1;
    quantityInput.disabled = false;
    updateScheduleVisibility();
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
    const scheduled = scheduleToggle.checked;
    const date = scheduled ? (dateInput.value || todayISO()) : null;
    const rank = scheduled ? Math.max(1, parseInt(rankInput.value, 10) || 1) : 0;
    const quantity = infinityToggle.checked ? 'infinity' : quantityInput.value;
    addTask({ title, color: selectedColor, date, quantity, rank });
    SoundEngine.tick();
    closeModal();
    renderAll();
  }

  /* ---------------- overlays ---------------- */
  function openAllTasks(){
    allTasksView.classList.remove('hidden');
    navAllTasks.classList.add('active');
    navToday.classList.remove('active');
    renderAllTasks();
  }
  function closeAllTasks(){
    allTasksView.classList.add('hidden');
    navToday.classList.add('active');
    navAllTasks.classList.remove('active');
  }
  function openArchive(){
    archiveView.classList.remove('hidden');
    renderArchive();
  }
  function closeArchive(){
    archiveView.classList.add('hidden');
  }

  /* ---------------- sound toggle ---------------- */
  function updateSoundIcon(){
    const icon = soundToggleBtn.querySelector('i');
    icon.className = SoundEngine.isMuted() ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high';
  }

  /* ---------------- wiring ---------------- */
  function setupEvents(){
    fabAdd.addEventListener('click', () => { SoundEngine.tick(); openModal(); });
    closeModalBtn.addEventListener('click', () => { SoundEngine.tick(); closeModal(); });
    modalBackdrop.addEventListener('click', closeModal);
    taskForm.addEventListener('submit', handleSubmit);
    dateInput.addEventListener('change', updateSuggestedRank);
    scheduleToggle.addEventListener('change', updateScheduleVisibility);
    infinityToggle.addEventListener('change', () => { quantityInput.disabled = infinityToggle.checked; });

    navAllTasks.addEventListener('click', () => { SoundEngine.tick(); openAllTasks(); });
    closeAllTasksBtn.addEventListener('click', () => { SoundEngine.tick(); closeAllTasks(); });
    navToday.addEventListener('click', () => { SoundEngine.tick(); closeAllTasks(); closeArchive(); });

    openArchiveBtn.addEventListener('click', () => { SoundEngine.tick(); openArchive(); });
    closeArchiveBtn.addEventListener('click', () => { SoundEngine.tick(); closeArchive(); });

    soundToggleBtn.addEventListener('click', () => {
      const wasMuted = SoundEngine.isMuted();
      SoundEngine.toggle();
      updateSoundIcon();
      if (wasMuted) SoundEngine.tick(); // audible confirmation only when turning sound back on
    });
  }

  function initSortable(){
    new Sortable(taskListEl, {
      handle: '.drag-handle',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onStart: () => SoundEngine.tick(),
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
    updateSoundIcon();
    setupEvents();
    initSortable();
    renderAll();
    registerSW();
  });
})();
