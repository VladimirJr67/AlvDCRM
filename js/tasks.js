/* ============================================================
   js/tasks.js — канбан-доска задач, статусы, назначение задач.
   Глобальный массив задач общий; пользователь с ролью «user»
   видит только свои задачи (автор или назначенный исполнитель),
   администратор — все. Колонка «Назначенные задачи» обязательная
   и неудаляемая. 4 бизнес-статуса дашборда гарантируются.
   ============================================================ */

let tasks = [];
let taskColumns = [];

// Соисполнители, выбранные в открытой форме задачи (id пользователей).
let taskCoAssignees = [];

const DEFAULT_COLUMNS = [
  { id: 'new', name: 'Новые', color: '#3b82f6' },
  { id: 'in_progress', name: 'В работе', color: '#f59e0b' },
  { id: 'review', name: 'На проверке', color: '#8b5cf6' },
  { id: 'completed', name: 'Завершены', color: '#10b981' }
];

// Статусы, которые обязаны быть на доске (для дашборда администратора).
const REQUIRED_COLUMNS = [
  { name: 'В работе', fallbackId: 'in_progress', color: '#f59e0b' },
  { name: 'Проблема', fallbackId: 'problem', color: '#ef4444' },
  { name: 'Работа с чертежами', fallbackId: 'drawings', color: '#8b5cf6' },
  { name: 'Выставлен счет', fallbackId: 'invoiced', color: '#10b981' },
  { name: 'Счет на согласование', fallbackId: 'invoice_approval', color: '#06b6d4' },
  { name: 'Размещен заказ', fallbackId: 'order_placed', color: '#84cc16' }
];

const TASK_PRIORITIES = [
  { name: 'Низкий', value: 'low', color: '#6b7280' },
  { name: 'Средний', value: 'medium', color: '#d97706' },
  { name: 'Высокий', value: 'high', color: '#dc2626' },
  { name: 'Критический', value: 'critical', color: '#7c3aed' }
];

// Статусы назначенных задач (колонка «Назначенные задачи»).
const ASSIGNMENT_STATUSES = [
  { value: 'pending', label: 'Не принято', color: '#6b7280' },
  { value: 'accepted', label: 'Принято', color: '#3b82f6' },
  { value: 'in_progress', label: 'В работе', color: '#f59e0b' },
  { value: 'completed', label: 'Выполнено', color: '#10b981' }
];

function loadTasks() {
  const saved = localStorage.getItem('alvid_crm_tasks');
  tasks = saved ? JSON.parse(saved) : [];

  const savedColumns = localStorage.getItem('alvid_crm_task_columns');
  if (savedColumns) {
    taskColumns = JSON.parse(savedColumns);
  } else {
    taskColumns = DEFAULT_COLUMNS.map((c, i) => ({ ...c, order: i }));
    saveTaskColumns();
  }

  ensureRequiredTaskColumns();
}

// Гарантировать наличие 4 бизнес-статусов. Недостающие добавляются,
// существующие помечаются locked (не удаляются и не переименовываются).
function ensureRequiredTaskColumns() {
  let changed = false;
  REQUIRED_COLUMNS.forEach(req => {
    const existing = taskColumns.find(c => c.name === req.name);
    if (existing) {
      if (!existing.locked) { existing.locked = true; changed = true; }
    } else {
      let id = req.fallbackId;
      if (taskColumns.find(c => c.id === id)) id = req.fallbackId + '_' + Date.now();
      const maxOrder = taskColumns.reduce((m, c) => Math.max(m, c.order || 0), -1);
      taskColumns.push({ id, name: req.name, color: req.color, order: maxOrder + 1, locked: true });
      changed = true;
    }
  });
  if (changed) saveTaskColumns();
}

/* ===== Привязка активностей к столбцам =====
   Активность, отмеченная в комментарии, автоматически создаёт задачу в том
   столбце, который администратор выбрал в разделе «Администрирование → Типы
   взаимодействий». Карта привязок — activityToColumnMap вида
   { '<тип активности>': '<id столбца>' }.

   Если у активности столбец не назначен, задача не создаётся: остаётся только
   комментарий. Так работает «Информация» — её привязывать не нужно. */

// Рекомендуемые привязки из ТЗ. Используются только как подсказки в админке
// и в кнопке «Создать столбцы и привязки»: сами столбцы система не создаёт —
// это осознанное действие администратора.
const ACTIVITY_COLUMN_RECOMMENDED = [
  { type: 'Звонок', column: 'Звонки' },
  { type: 'Отправил КП', column: 'Отправлено КП' },
  { type: 'Встреча', column: 'Встреча' },
  { type: 'Размещение заказа', column: 'Заказы' },
  { type: 'Заказ матриц', column: 'Заказы/Матрицы' }
];

// Цвета рекомендуемых столбцов — чтобы новые столбцы не сливались с доской.
const ACTIVITY_COLUMN_COLORS = {
  'Звонки': '#3b82f6',
  'Отправлено КП': '#6366f1',
  'Встреча': '#14b8a6',
  'Заказы': '#f59e0b',
  'Заказы/Матрицы': '#8b5cf6'
};

function taskColumnByName(name) {
  const needle = String(name == null ? '' : name).trim().toLowerCase();
  if (!needle) return null;
  return taskColumns.find(c => String(c.name == null ? '' : c.name).trim().toLowerCase() === needle) || null;
}

// Столбец, привязанный к активности. null — привязки нет или столбец удалён.
function activityColumnId(activityType) {
  const key = String(activityType == null ? '' : activityType);
  const id = activityToColumnMap ? activityToColumnMap[key] : null;
  if (!id) return null;
  return taskColumns.some(c => c.id === id) ? id : null;
}

function saveActivityToColumnMap() {
  if (typeof queueServerSave === 'function') queueServerSave();
}

// Назначить или снять привязку активности к столбцу (вызывает админка).
function setActivityColumn(activityType, columnId) {
  const key = String(activityType == null ? '' : activityType).trim();
  if (!key) return { ok: false, error: 'Не выбран тип активности' };
  activityToColumnMap = activityToColumnMap || {};
  if (columnId) {
    if (!taskColumns.some(c => c.id === columnId)) return { ok: false, error: 'Столбец не найден' };
    activityToColumnMap[key] = columnId;
  } else {
    delete activityToColumnMap[key];
  }
  saveActivityToColumnMap();
  return { ok: true };
}

// Создать столбец без диалогов — для кнопки в админке.
function addTaskColumnByName(name, color) {
  const clean = String(name == null ? '' : name).trim();
  if (!clean) return null;
  const existing = taskColumnByName(clean);
  if (existing) return existing;
  const maxOrder = taskColumns.reduce((m, c) => Math.max(m, c.order || 0), -1);
  const col = {
    id: 'activity_' + Date.now() + '_' + taskColumns.length,
    name: clean,
    color: color || '#6b7280',
    order: maxOrder + 1,
    locked: false
  };
  taskColumns.push(col);
  saveTaskColumns();
  return col;
}

// Применить рекомендуемые привязки: создать недостающие столбцы и связать их
// с активностями. Вызывается кнопкой администратора — само ничего не создаёт.
function applyRecommendedActivityBindings() {
  const report = { columns: [], bindings: [] };
  ACTIVITY_COLUMN_RECOMMENDED.forEach(rec => {
    let col = taskColumnByName(rec.column);
    if (!col) {
      col = addTaskColumnByName(rec.column, ACTIVITY_COLUMN_COLORS[rec.column]);
      if (col) report.columns.push(col.name);
    }
    if (!col) return;
    setActivityColumn(rec.type, col.id);
    report.bindings.push(rec.type + ' → ' + col.name);
  });
  return report;
}

/* ===== Задачи, созданные активностью ===== */

// Создать задачу без формы (активность, автодействие). Возвращает задачу.
function addAutoTask(data) {
  const now = new Date().toISOString();
  const maxId = tasks.reduce((m, t) => Math.max(m, t.id || 0), 0);
  const task = {
    id: maxId + 1,
    title: data.title || 'Активность',
    description: data.description || '',
    deadline: data.deadline || '',
    priority: data.priority || 'medium',
    status: data.status,
    coAssignees: Array.isArray(data.coAssignees) ? data.coAssignees.slice() : [],
    clientId: data.clientId != null ? data.clientId : null,
    contactId: data.contactId != null ? data.contactId : null,
    ownerId: data.ownerId != null ? data.ownerId : (currentUser ? currentUser.id : null),
    createdAt: now,
    statusUpdatedAt: now,
    order: tasks.filter(t => t.status === data.status).length,
    completedAt: null,
    colleagueId: data.colleagueId != null ? data.colleagueId : null,
    trackingBy: Array.isArray(data.trackingBy) ? data.trackingBy.slice() : [],
    linkWorkedOff: false,
    source: data.source || 'activity'
  };
  tasks.push(task);
  // Руководители, отслеживающие исполнителя, попадают в наблюдатели задачи.
  syncTrackingForTask(task);
  saveTasks();
  return task;
}

// Задача по активности: столбец берётся из привязки. Если активность не
// привязана — задачи нет, возвращается null (комментарий остаётся как есть).
function createActivityTask(data) {
  const columnId = activityColumnId(data.activityType);
  if (!columnId) return null;
  return addAutoTask(Object.assign({}, data, { status: columnId }));
}

// Заголовок задачи по активности: «Звонок: ООО Ромашка» и т.п.
function activityTaskTitle(activityType, clientName, extra) {
  const parts = [String(activityType || 'Активность')];
  if (clientName) parts.push(String(clientName));
  let title = parts.join(': ');
  if (extra) title += ' — ' + extra;
  return title;
}

/* ===== Столбцы доски: глобальные и индивидуальные =====
   Глобальные столбцы (taskColumns) видят все менеджеры; индивидуальные лежат
   в taskColumnsPerManager = { '<id пользователя>': [ столбец, ... ] } и попадают
   только на доску своего менеджера. Настраивает и то и другое администратор
   в разделе «Администрирование → Столбцы задач». */

function saveTaskColumnsPerManager() {
  if (typeof queueServerSave === 'function') queueServerSave();
}

function globalTaskColumns() {
  return [...taskColumns].sort((a, b) => (a.order || 0) - (b.order || 0));
}

// Индивидуальные столбцы конкретного менеджера.
function managerTaskColumns(userId) {
  const key = String(userId == null ? '' : userId);
  const list = (taskColumnsPerManager && taskColumnsPerManager[key]) || [];
  return Array.isArray(list) ? list.slice().sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
}

// Столбцы, которые видит пользователь на своей доске: глобальные + свои.
function columnsForManager(userId) {
  const own = managerTaskColumns(userId);
  // Индивидуальные идут после глобальных, чтобы не разрывать общий порядок.
  const maxOrder = globalTaskColumns().reduce((m, c) => Math.max(m, c.order || 0), -1);
  return globalTaskColumns().concat(
    own.map((c, i) => Object.assign({}, c, { order: typeof c.order === 'number' ? c.order : maxOrder + 1 + i, individual: true }))
  );
}

function columnsForCurrentUser() {
  return columnsForManager(currentUser ? currentUser.id : null);
}

function taskColumnById(columnId) {
  return taskColumns.find(c => c.id === columnId) || null;
}

// Поиск индивидуального столбца по всем менеджерам (нужен для подписи в админке).
function taskColumnOwner(columnId) {
  const map = taskColumnsPerManager || {};
  return Object.keys(map).find(uid => (map[uid] || []).some(c => c.id === columnId)) || null;
}

// Все столбцы системы — для настроек администратора.
function allTaskColumnsWithScope() {
  const list = globalTaskColumns().map(c => ({ column: c, scope: 'global', ownerId: null }));
  Object.keys(taskColumnsPerManager || {}).forEach(uid => {
    managerTaskColumns(uid).forEach(c => list.push({ column: c, scope: 'manager', ownerId: Number(uid) }));
  });
  return list;
}

/* ===== Изменение столбцов (админка) ===== */

function nextColumnOrder(scope, ownerId) {
  const list = scope === 'manager' ? managerTaskColumns(ownerId) : globalTaskColumns();
  return list.reduce((m, c) => Math.max(m, c.order || 0), -1) + 1;
}

// Добавить столбец: scope = 'global' (видят все) или 'manager' (только он).
function addTaskColumnScoped(scope, ownerId, name, color) {
  const clean = String(name == null ? '' : name).trim();
  if (!clean) return { ok: false, error: 'Введите название столбца' };

  const target = scope === 'manager' ? managerTaskColumns(ownerId) : globalTaskColumns();
  if (target.some(c => String(c.name).trim().toLowerCase() === clean.toLowerCase())) {
    return { ok: false, error: 'Столбец с таким названием уже есть' };
  }

  const column = {
    id: (scope === 'manager' ? 'mgr_' : 'col_') + Date.now() + '_' + Math.floor(Math.random() * 1000),
    name: clean,
    color: color || '#6b7280',
    order: nextColumnOrder(scope, ownerId)
  };

  if (scope === 'manager') {
    const key = String(ownerId);
    taskColumnsPerManager[key] = (taskColumnsPerManager[key] || []).concat([column]);
    saveTaskColumnsPerManager();
  } else {
    taskColumns.push(column);
    saveTaskColumns();
  }
  return { ok: true, column: column };
}

// Найти столбец вместе с его списком (глобальным или индивидуальным).
function columnScopeRef(columnId) {
  const global = taskColumns.find(c => c.id === columnId);
  if (global) return { scope: 'global', ownerId: null, list: taskColumns, column: global };
  const map = taskColumnsPerManager || {};
  for (const uid of Object.keys(map)) {
    const found = (map[uid] || []).find(c => c.id === columnId);
    if (found) return { scope: 'manager', ownerId: Number(uid), list: map[uid], column: found };
  }
  return null;
}

function renameTaskColumn(columnId, name, color) {
  const ref = columnScopeRef(columnId);
  if (!ref) return { ok: false, error: 'Столбец не найден' };
  if (ref.column.locked) return { ok: false, error: 'Обязательный столбец переименовать нельзя' };

  const clean = String(name == null ? '' : name).trim();
  if (!clean) return { ok: false, error: 'Введите название столбца' };
  const clash = ref.list.some(c => c.id !== columnId && String(c.name).trim().toLowerCase() === clean.toLowerCase());
  if (clash) return { ok: false, error: 'Столбец с таким названием уже есть' };

  ref.column.name = clean;
  if (color && String(color).trim().startsWith('#')) ref.column.color = String(color).trim();
  ref.scope === 'manager' ? saveTaskColumnsPerManager() : saveTaskColumns();
  return { ok: true };
}

// Порядок столбца: -1 — влево, +1 — вправо.
function moveTaskColumn(columnId, delta) {
  const ref = columnScopeRef(columnId);
  if (!ref) return { ok: false, error: 'Столбец не найден' };
  const sorted = ref.list.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = sorted.findIndex(c => c.id === columnId);
  const swapIdx = idx + delta;
  if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return { ok: false, error: 'Дальше двигать некуда' };

  const tmp = sorted[idx];
  sorted[idx] = sorted[swapIdx];
  sorted[swapIdx] = tmp;
  sorted.forEach((c, i) => { c.order = i; });
  ref.scope === 'manager' ? saveTaskColumnsPerManager() : saveTaskColumns();
  return { ok: true };
}

// Удалить столбец. Задачи из него переезжают в первый оставшийся столбец
// той же области видимости — удалённый исчезает, задачи не теряются.
function deleteTaskColumnScoped(columnId) {
  const ref = columnScopeRef(columnId);
  if (!ref) return { ok: false, error: 'Столбец не найден' };
  if (ref.column.locked) return { ok: false, error: 'Обязательный столбец удалить нельзя' };

  const remaining = ref.list
    .filter(c => c.id !== columnId)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  // Задачи переносим в первый оставшийся столбец. У индивидуального набора
  // он может быть пустым — тогда берём первый глобальный: он есть на доске
  // этого менеджера, поэтому задачи остаются видимыми.
  let target = remaining[0] || null;
  if (!target && ref.scope === 'manager') target = globalTaskColumns()[0] || null;
  const moved = tasks.filter(t => t.status === columnId).length;

  if (!target) return { ok: false, error: 'Нельзя удалить последний столбец' };

  tasks.forEach(t => { if (t.status === columnId) t.status = target.id; });
  if (moved) saveTasks();

  if (ref.scope === 'manager') {
    const key = String(ref.ownerId);
    taskColumnsPerManager[key] = (taskColumnsPerManager[key] || []).filter(c => c.id !== columnId);
    saveTaskColumnsPerManager();
  } else {
    taskColumns = taskColumns.filter(c => c.id !== columnId);
    saveTaskColumns();
  }

  // Привязка активности на удалённый столбец больше не работает — снимаем.
  let bindingsCleared = 0;
  Object.keys(activityToColumnMap || {}).forEach(type => {
    if (activityToColumnMap[type] === columnId) { delete activityToColumnMap[type]; bindingsCleared++; }
  });
  if (bindingsCleared) saveActivityToColumnMap();

  return { ok: true, moved: moved, target: target.name, bindingsCleared: bindingsCleared };
}

/* ===== Назначение задачи исполнителю =====
   Назначать может администратор и руководитель — из главного меню «Задачи»
   (в карточке задачи). Исполнитель видит задачу в столбце «Назначенные задачи»
   и меняет статус назначения сам. */

function canAssignTasks() {
  return isAdmin() || isLead();
}

function assignmentCandidates() {
  return users.filter(u => u && u.id !== (currentUser ? currentUser.id : null));
}

// Применить назначение к задаче: пусто — снять назначение.
function applyTaskAssignment(task, assignedToId) {
  if (!task) return { ok: false, error: 'Задача не найдена' };
  const targetId = assignedToId ? parseInt(assignedToId, 10) : null;
  const changed = targetId !== (task.assignedTo || null);

  if (!targetId) {
    task.assignedTo = null;
    task.assignedBy = null;
    task.assignedAt = null;
    task.assignmentStatus = null;
    return { ok: true, assigned: false, changed: changed };
  }

  const target = findUserById(targetId);
  if (!target) return { ok: false, error: 'Пользователь не найден' };

  task.assignedTo = target.id;
  task.assignedBy = currentUser ? currentUser.id : null;
  task.assignedAt = new Date().toISOString();
  task.assignmentStatus = changed ? 'pending' : (task.assignmentStatus || 'pending');
  return { ok: true, assigned: true, changed: changed, user: target };
}

function saveTasks() {
  localStorage.setItem('alvid_crm_tasks', JSON.stringify(tasks));
  queueServerSave();
}

function saveTaskColumns() {
  localStorage.setItem('alvid_crm_task_columns', JSON.stringify(taskColumns));
  queueServerSave();
}

// Задачи, где текущий пользователь — соисполнитель (помощник).
function isCoAssignee(task, uid) {
  if (!task || !uid) return false;
  return (task.coAssignees || []).indexOf(uid) > -1;
}

function visibleTasks() {
  if (!currentUser) return tasks;
  const uid = currentUser.id;
  if (isAdmin()) {
    // Личный канбан администратора — только собственные задачи, которые не
    // назначены другим пользователям, плюс задачи, где он соисполнитель.
    // Назначенные задачи админ отслеживает в разделе «Администрирование → Задачи».
    return tasks.filter(t =>
      (t.ownerId === uid && (!t.assignedTo || t.assignedTo === uid)) || isCoAssignee(t, uid));
  }
  return tasks.filter(t => t.ownerId === uid || t.assignedTo === uid || isCoAssignee(t, uid));
}

// Столбцы, задачи из которых считаются завершёнными.
function taskCompletedColumnIds() {
  return taskColumns
    .filter(c => c.id === 'completed' || c.name === 'Завершены')
    .map(c => c.id);
}

function isTaskCompleted(task) {
  if (!task) return false;
  return taskCompletedColumnIds().indexOf(task.status) > -1;
}

// Счётчик показывает активные задачи: завершённые в него не попадают,
// иначе он не отражает объём незакрытой работы.
function updateTasksMenuBadge() {
  const badge = document.getElementById('tasksMenuBadge');
  if (!badge) return;
  const visible = visibleTasks();
  const active = visible.filter(t => !isTaskCompleted(t));
  const done = visible.length - active.length;
  const overdue = active.filter(t => taskOverdue(t)).length;
  badge.innerHTML =
    `<span class="menu-badge-count" title="Активных задач: ${active.length}. Завершено: ${done}">${active.length}</span>` +
    `<span class="menu-badge-count menu-badge-overdue" title="Просрочено">${overdue}</span>`;
}

/* ===== Прокрутка доски стрелками =====
   Всё движение считается в requestAnimationFrame: короткое нажатие — плавный
   сдвиг на одну колонку с замедлением в конце (ease-out), удержание —
   непрерывная прокрутка с разгоном. CSS-анимация (scroll-behavior) не
   используется: на время движения она отключается, иначе браузер подмешивает
   своё сглаживание и кадры «дрожат». */

const ARROW_HOLD_DELAY = 260;   // через сколько мс после нажатия начинается «удержание»
const ARROW_STEP_START = 7;     // сдвиг за кадр в начале удержания
const ARROW_STEP_MAX = 26;      // максимальный сдвиг за кадр после разгона
const ARROW_RAMP_MS = 520;      // за сколько мс выходим на максимальную скорость
const ARROW_CLICK_MS = 320;     // длительность плавного сдвига по клику

let arrowHoldTimer = null;
let arrowRafId = null;
let arrowDirection = 0;
let arrowStartedAt = 0;
let boardClickRafId = null;

// Плавный сдвиг доски на заданное расстояние: кадры считает rAF,
// скорость гасится по кривой ease-out — движение заканчивается мягко.
function animateBoardScroll(distance, duration) {
  const board = document.querySelector('.task-board');
  if (!board || !distance) return;
  if (boardClickRafId) cancelAnimationFrame(boardClickRafId);

  const startLeft = board.scrollLeft;
  const startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const total = duration || ARROW_CLICK_MS;
  board.style.scrollBehavior = 'auto';

  const frame = (now) => {
    const stamp = typeof now === 'number' ? now : Date.now();
    const progress = Math.min(1, (stamp - startedAt) / total);
    const eased = 1 - Math.pow(1 - progress, 3);      // ease-out cubic
    board.scrollLeft = startLeft + distance * eased;
    if (progress < 1) {
      boardClickRafId = requestAnimationFrame(frame);
    } else {
      boardClickRafId = null;
      board.style.scrollBehavior = '';
    }
  };
  boardClickRafId = requestAnimationFrame(frame);
}

// Ширина одной колонки со зазором — шаг прокрутки по клику.
function boardStepWidth() {
  const board = document.querySelector('.task-board');
  if (!board) return 300;
  const col = board.querySelector('.task-column');
  if (!col) return 300;
  const gap = 12;
  return Math.round(col.getBoundingClientRect().width + gap);
}

// Одиночный клик по стрелке — плавный сдвиг на ширину колонки.
function scrollTaskBoard(direction) {
  animateBoardScroll(direction * boardStepWidth(), ARROW_CLICK_MS);
}

// Кадр непрерывной прокрутки при удержании: скорость растёт от ARROW_STEP_START
// до ARROW_STEP_MAX, поэтому старт мягкий, а дальше доска «разгоняется».
function arrowScrollFrame() {
  const board = document.querySelector('.task-board');
  if (!board) { stopBoardArrowScroll(); return; }
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const elapsed = now - arrowStartedAt;
  const ramp = Math.min(1, elapsed / ARROW_RAMP_MS);
  const step = ARROW_STEP_START + (ARROW_STEP_MAX - ARROW_STEP_START) * ramp;
  board.scrollLeft += arrowDirection * step;
  arrowRafId = requestAnimationFrame(arrowScrollFrame);
}

function startBoardArrowScroll(direction) {
  stopBoardArrowScroll();
  arrowDirection = direction;
  // Плавная прокрутка мешает непрерывному движению — на время удержания
  // она отключается.
  const board = document.querySelector('.task-board');
  if (board) board.style.scrollBehavior = 'auto';
  arrowHoldTimer = setTimeout(() => {
    arrowHoldTimer = null;
    arrowStartedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    arrowRafId = requestAnimationFrame(arrowScrollFrame);
  }, ARROW_HOLD_DELAY);
}

function stopBoardArrowScroll() {
  if (arrowHoldTimer) {
    clearTimeout(arrowHoldTimer);
    arrowHoldTimer = null;
  }
  if (arrowRafId) {
    cancelAnimationFrame(arrowRafId);
    arrowRafId = null;
  }
  const board = document.querySelector('.task-board');
  if (board) board.style.scrollBehavior = '';
}

/* ===== Задача-ссылка («Отработка ссылки») =====
   Такую задачу нельзя закрыть, пока не отмечена галочка «Ссылка отработана»:
   ни перетаскиванием в завершающий столбец, ни сохранением карточки. */

const TASK_KINDS = [
  { value: 'regular', name: 'Обычная' },
  { value: 'link', name: 'Отработка ссылки' }
];

function taskKindName(task) {
  const kind = TASK_KINDS.find(k => k.value === (task && task.kind));
  return (kind || TASK_KINDS[0]).name;
}

function isLinkTask(task) {
  return !!task && task.kind === 'link';
}

// Столбец считается завершающим (по нему задача закрывается).
function isCompletedColumnId(columnId) {
  return taskCompletedColumnIds().indexOf(columnId) > -1;
}

// Можно ли закрывать задачу: для «Отработки ссылки» нужна галочка.
function taskCanBeClosed(task) {
  return !isLinkTask(task) || !!task.linkWorkedOff;
}

function taskClosureBlockMessage(task) {
  if (!isLinkTask(task)) return '';
  return 'Задача «Отработка ссылки» закрывается только после отметки «Ссылка отработана».\n' +
    'Поставьте галочку на карточке задачи — тогда её можно перевести в завершающий столбец.';
}

// Галочка «Ссылка отработана» на карточке задачи.
function toggleLinkWorkedOff(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return { ok: false, error: 'Задача не найдена' };
  task.linkWorkedOff = !task.linkWorkedOff;
  task.linkWorkedOffAt = task.linkWorkedOff ? new Date().toISOString() : null;
  saveTasks();
  refreshAfterTaskChange();
  return { ok: true, linkWorkedOff: task.linkWorkedOff };
}

/* ===== Календарь задач: пласты по периоду =====
   Над доской — лента пластов: день (по часам), неделя (7 дней) или месяц
   (дни месяца). В каждом пласте показано количество задач, попадающих в его
   срок; клик по пласту оставляет на доске только задачи этого периода. */

const TASK_CALENDAR_MODES = [
  { id: 'day', name: 'День' },
  { id: 'week', name: 'Неделя' },
  { id: 'month', name: 'Месяц' }
];

const DOW_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTH_NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

let taskCalendarMode = 'week';
let taskCalendarAnchor = new Date();
let taskCalendarPick = null;    // { key, from, to, label } — выбранный пласт

function taskCalendarStartOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function taskCalendarAddDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Понедельник недели, в которую попадает дата.
function taskCalendarStartOfWeek(d) {
  const x = taskCalendarStartOfDay(d);
  const dow = (x.getDay() + 6) % 7;
  return taskCalendarAddDays(x, -dow);
}

function taskCalendarStartOfMonth(d) {
  const x = taskCalendarStartOfDay(d);
  x.setDate(1);
  return x;
}

function taskCalendarEndOfMonth(d) {
  const x = taskCalendarStartOfMonth(d);
  x.setMonth(x.getMonth() + 1);
  return x;
}

function taskCalendarPeriodRange(mode, anchor) {
  const base = anchor || new Date();
  if (mode === 'day') {
    const from = taskCalendarStartOfDay(base);
    return { from: from, to: taskCalendarAddDays(from, 1) };
  }
  if (mode === 'month') {
    return { from: taskCalendarStartOfMonth(base), to: taskCalendarEndOfMonth(base) };
  }
  const from = taskCalendarStartOfWeek(base);
  return { from: from, to: taskCalendarAddDays(from, 7) };
}

function taskCalendarLabel(mode, anchor) {
  const d = taskCalendarStartOfDay(anchor || new Date());
  if (mode === 'day') return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
  if (mode === 'month') return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
  const from = taskCalendarStartOfWeek(d);
  const to = taskCalendarAddDays(from, 6);
  return from.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) +
    ' — ' + to.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

// Пласты выбранного масштаба: границы периода, короткая подпись и подсказка.
function taskCalendarBands() {
  const anchor = taskCalendarAnchor || new Date();
  const bands = [];

  if (taskCalendarMode === 'day') {
    const day = taskCalendarStartOfDay(anchor);
    for (let h = 0; h < 24; h++) {
      const from = new Date(day); from.setHours(h);
      const to = new Date(day); to.setHours(h + 1);
      bands.push({ key: 'h' + h, label: String(h).padStart(2, '0'), hint: String(h).padStart(2, '0') + ':00', from: from, to: to });
    }
    return bands;
  }

  if (taskCalendarMode === 'month') {
    const from = taskCalendarStartOfMonth(anchor);
    const days = Math.round((taskCalendarEndOfMonth(anchor) - from) / 86400000);
    for (let i = 0; i < days; i++) {
      const d = taskCalendarAddDays(from, i);
      bands.push({
        key: 'd' + i,
        label: String(d.getDate()),
        hint: d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' }),
        from: d, to: taskCalendarAddDays(d, 1)
      });
    }
    return bands;
  }

  const from = taskCalendarStartOfWeek(anchor);
  for (let i = 0; i < 7; i++) {
    const d = taskCalendarAddDays(from, i);
    bands.push({
      key: 'w' + i,
      label: DOW_SHORT[i] + ' ' + String(d.getDate()).padStart(2, '0'),
      hint: d.toLocaleDateString('ru-RU', { weekday: 'long', day: '2-digit', month: 'long' }),
      from: d, to: taskCalendarAddDays(d, 1)
    });
  }
  return bands;
}

function taskInRange(task, from, to) {
  const dl = parseDeadline(task && task.deadline);
  if (!dl) return false;
  return dl >= from && dl < to;
}

function taskCalendarBandTasks(band, list) {
  const source = list || visibleTasks();
  return source.filter(t => taskInRange(t, band.from, band.to));
}

// Пласты с количеством задач (счётчики считаются по всем видимым задачам,
// а не по уже отфильтрованным — иначе цифры «схлопывались» бы после клика).
function taskCalendarBandsWithCounts() {
  const source = visibleTasks();
  return taskCalendarBands().map(band => {
    const items = taskCalendarBandTasks(band, source);
    return Object.assign({}, band, {
      count: items.length,
      overdue: items.filter(t => taskOverdue(t)).length
    });
  });
}

function setTaskCalendarMode(mode) {
  taskCalendarMode = TASK_CALENDAR_MODES.some(m => m.id === mode) ? mode : 'week';
  taskCalendarPick = null;
  renderTasks();
}

function shiftTaskCalendar(delta) {
  const anchor = new Date(taskCalendarAnchor || new Date());
  if (taskCalendarMode === 'day') anchor.setDate(anchor.getDate() + delta);
  else if (taskCalendarMode === 'month') anchor.setMonth(anchor.getMonth() + delta);
  else anchor.setDate(anchor.getDate() + delta * 7);
  taskCalendarAnchor = anchor;
  taskCalendarPick = null;
  renderTasks();
}

function taskCalendarToday() {
  taskCalendarAnchor = new Date();
  taskCalendarPick = null;
  renderTasks();
}

// Клик по пласту: показать только его задачи (повторный клик — снять).
function pickTaskCalendarBand(key) {
  const band = taskCalendarBandsWithCounts().find(b => b.key === key);
  if (!band) return;
  if (taskCalendarPick && taskCalendarPick.key === key) {
    taskCalendarPick = null;
  } else {
    taskCalendarPick = { key: band.key, from: band.from, to: band.to, label: band.hint };
  }
  renderTasks();
}

function clearTaskCalendarPick() {
  taskCalendarPick = null;
  renderTasks();
}

// Фильтр доски по выбранному пласту.
function taskCalendarFilter(list) {
  if (!taskCalendarPick) return list;
  return list.filter(t => taskInRange(t, taskCalendarPick.from, taskCalendarPick.to));
}

function renderTaskCalendarHtml() {
  const bands = taskCalendarBandsWithCounts();
  const period = taskCalendarPeriodRange(taskCalendarMode, taskCalendarAnchor);
  const all = visibleTasks();
  const periodTasks = all.filter(t => taskInRange(t, period.from, period.to));
  const withDeadline = all.filter(t => !!parseDeadline(t.deadline)).length;

  return `
    <div class="task-calendar">
      <div class="task-calendar-head">
        <div class="task-calendar-modes">
          ${TASK_CALENDAR_MODES.map(m =>
            `<button type="button" class="btn btn-sm ${taskCalendarMode === m.id ? '' : 'btn-secondary'}"
                     onclick="setTaskCalendarMode('${m.id}')">${m.name}</button>`).join('')}
        </div>
        <button type="button" class="btn btn-sm btn-secondary" onclick="shiftTaskCalendar(-1)" title="Предыдущий период">‹</button>
        <div class="task-calendar-title">
          ${escapeHtml(taskCalendarLabel(taskCalendarMode, taskCalendarAnchor))}
          <span class="task-calendar-total">задач в периоде: <strong>${periodTasks.length}</strong></span>
        </div>
        <button type="button" class="btn btn-sm btn-secondary" onclick="shiftTaskCalendar(1)" title="Следующий период">›</button>
        <button type="button" class="btn btn-sm btn-secondary" onclick="taskCalendarToday()">Сегодня</button>
        ${taskCalendarPick ? `<button type="button" class="btn btn-sm" onclick="clearTaskCalendarPick()">Показать все задачи</button>` : ''}
      </div>
      <div class="task-calendar-bands">
        ${bands.map(b => `
          <button type="button"
                  class="task-calendar-band${b.count ? ' has-tasks' : ''}${b.overdue ? ' has-overdue' : ''}${taskCalendarPick && taskCalendarPick.key === b.key ? ' active' : ''}"
                  onclick="pickTaskCalendarBand('${b.key}')"
                  title="${escapeHtml(b.hint)}: задач ${b.count}${b.overdue ? ', просрочено ' + b.overdue : ''}">
            <span class="task-calendar-count">${b.count}</span>
            <span class="task-calendar-label">${escapeHtml(b.label)}</span>
          </button>`).join('')}
      </div>
      ${withDeadline === 0
        ? '<div class="task-calendar-hint">У задач не заполнены сроки — пласты пока пустые. Срок задаётся в карточке задачи.</div>'
        : ''}
      ${taskCalendarPick
        ? `<div class="task-calendar-pick">На доске только задачи периода: <strong>${escapeHtml(taskCalendarPick.label)}</strong></div>`
        : ''}
    </div>
  `;
}

/* ===== Отслеживание задач руководителем =====
   Руководитель (или администратор) берёт сотрудника на отслеживание: попадает
   в trackingBy всех его текущих задач, а новые задачи сотрудника получают его
   автоматически. Раздел показывает прогресс: всего, в работе, завершено,
   просрочено и по столбцам. */

function isTaskTracker() {
  return isLead() || isAdmin();
}

function trackedUserIds(trackerId) {
  const me = trackerId != null ? trackerId : (currentUser ? currentUser.id : null);
  return users.filter(u => (u.trackedBy || []).indexOf(me) > -1).map(u => u.id);
}

function trackedUsers(trackerId) {
  const me = trackerId != null ? trackerId : (currentUser ? currentUser.id : null);
  return users.filter(u => (u.trackedBy || []).indexOf(me) > -1);
}

// Кто следит за сотрудником — нужно при создании новых задач.
// trackedBy хранится у сотрудника: это список руководителей, которые за ним
// наблюдают, поэтому возвращаем именно их id.
function trackersForUser(userId) {
  const target = findUserById(userId);
  if (!target || !Array.isArray(target.trackedBy)) return [];
  return target.trackedBy.filter(id => !!findUserById(id));
}

function isUserTrackedBy(userId, trackerId) {
  const me = trackerId != null ? trackerId : (currentUser ? currentUser.id : null);
  const u = findUserById(userId);
  return !!u && (u.trackedBy || []).indexOf(me) > -1;
}

// Добавить отслеживание: и в профиль сотрудника, и в его текущие задачи.
function startTrackingUser(userId) {
  if (!isTaskTracker()) return { ok: false, error: 'Отслеживание доступно руководителю' };
  const target = findUserById(parseInt(userId, 10));
  if (!target) return { ok: false, error: 'Пользователь не найден' };
  const me = currentUser.id;
  if (target.id === me) return { ok: false, error: 'Себя отслеживать не нужно' };

  target.trackedBy = Array.isArray(target.trackedBy) ? target.trackedBy : [];
  if (target.trackedBy.indexOf(me) === -1) target.trackedBy.push(me);

  let touched = 0;
  tasks.forEach(t => {
    if (t.ownerId !== target.id && t.assignedTo !== target.id) return;
    if (!Array.isArray(t.trackingBy)) t.trackingBy = [];
    if (t.trackingBy.indexOf(me) === -1) { t.trackingBy.push(me); touched++; }
  });

  saveUsers();
  saveTasks();
  return { ok: true, tasks: touched };
}

// Снять отслеживание: убираем и из профиля, и из задач.
function stopTrackingUser(userId) {
  if (!isTaskTracker()) return { ok: false, error: 'Отслеживание доступно руководителю' };
  const target = findUserById(parseInt(userId, 10));
  if (!target) return { ok: false, error: 'Пользователь не найден' };
  const me = currentUser.id;

  target.trackedBy = (target.trackedBy || []).filter(id => id !== me);
  tasks.forEach(t => {
    if (!Array.isArray(t.trackingBy)) return;
    t.trackingBy = t.trackingBy.filter(id => id !== me);
  });

  saveUsers();
  saveTasks();
  return { ok: true };
}

// Новая задача сотрудника: руководители, которые его отслеживают, попадают
// в trackingBy автоматически.
function syncTrackingForTask(task) {
  if (!task) return task;
  const ownerId = task.ownerId != null ? task.ownerId : (currentUser ? currentUser.id : null);
  if (ownerId == null) return task;
  const watchers = trackersForUser(ownerId);
  if (!watchers.length) return task;
  task.trackingBy = Array.isArray(task.trackingBy) ? task.trackingBy : [];
  watchers.forEach(id => { if (task.trackingBy.indexOf(id) === -1) task.trackingBy.push(id); });
  return task;
}

// Прогресс сотрудника по задачам: сводка и разбивка по столбцам.
function userTaskProgress(userId) {
  const uid = parseInt(userId, 10);
  const list = tasks.filter(t => t.ownerId === uid || t.assignedTo === uid);
  const done = list.filter(t => isTaskCompleted(t));
  const active = list.filter(t => !isTaskCompleted(t));
  const overdue = active.filter(t => taskOverdue(t));
  const sortedCols = [...taskColumns].sort((a, b) => (a.order || 0) - (b.order || 0));

  return {
    total: list.length,
    done: done.length,
    active: active.length,
    overdue: overdue.length,
    percent: list.length ? Math.round(done.length / list.length * 100) : 0,
    byColumn: sortedCols.map(col => ({
      id: col.id,
      name: col.name,
      color: col.color,
      count: list.filter(t => t.status === col.id).length
    })).filter(c => c.count > 0),
    tasks: list
  };
}

function renderTracking() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  if (!isTaskTracker()) {
    main.innerHTML = `<div class="placeholder"><h2>Доступ запрещён</h2><p>Отслеживание задач доступно руководителю и администратору</p></div>`;
    return;
  }

  const tracked = trackedUsers();
  const candidates = users.filter(u => u.id !== (currentUser ? currentUser.id : null) &&
    (u.trackedBy || []).indexOf(currentUser.id) === -1);

  const cardHtml = u => {
    const p = userTaskProgress(u.id);
    return `
      <div class="tracking-card">
        <div class="tracking-card-head">
          <div>
            <div class="tracking-name">${escapeHtml(u.name || u.login)}</div>
            <div class="tracking-role">${escapeHtml(userPositionLabel(u))}</div>
          </div>
          <button type="button" class="btn btn-sm btn-secondary" onclick="stopTrackingFromUi(${u.id})">Снять отслеживание</button>
        </div>
        <div class="tracking-progress">
          <div class="tracking-bar"><span style="width:${p.percent}%;"></span></div>
          <div class="tracking-percent">выполнено ${p.done} из ${p.total} · ${p.percent}%</div>
        </div>
        <div class="tracking-stats">
          <span>Всего: <strong>${p.total}</strong></span>
          <span>В работе: <strong>${p.active}</strong></span>
          <span class="${p.overdue ? 'tracking-overdue' : ''}">Просрочено: <strong>${p.overdue}</strong></span>
        </div>
        ${p.byColumn.length ? `<div class="tracking-columns">
          ${p.byColumn.map(c => `<span class="tracking-column-chip" style="border-color:${c.color};"><i style="background:${c.color};"></i>${escapeHtml(c.name)}: <strong>${c.count}</strong></span>`).join('')}
        </div>` : '<div class="field-hint">Задач у сотрудника пока нет.</div>'}
      </div>`;
  };

  main.innerHTML = `
    <div class="orders-page">
      <div class="orders-head">
        <h1>Отслеживание задач</h1>
        <div class="tracking-add">
          <select id="trackingUserSelect">
            <option value="">— выберите сотрудника —</option>
            ${candidates.map(u => `<option value="${u.id}">${escapeHtml(u.name || u.login)} (${escapeHtml(userPositionLabel(u))})</option>`).join('')}
          </select>
          <button type="button" class="btn" onclick="startTrackingFromUi()">Взять на отслеживание</button>
        </div>
      </div>
      <p class="field-hint" style="margin-bottom:16px;">
        Руководитель видит прогресс по сотруднику: сколько задач всего, что в работе
        и что просрочено. Отслеживаемый сотрудник попадает в список наблюдателей
        своих текущих и будущих задач.
      </p>
      ${tracked.length === 0 ? `
        <div class="empty-state" style="padding:60px 20px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
          <p>Пока никто не отслеживается.</p>
          <p style="font-size:12px;color:#9ca3af;margin-top:6px;">Выберите сотрудника выше и нажмите «Взять на отслеживание».</p>
        </div>
      ` : tracked.map(cardHtml).join('')}
    </div>
  `;
}

function startTrackingFromUi() {
  const select = document.getElementById('trackingUserSelect');
  const userId = select ? select.value : '';
  if (!userId) { alert('Выберите сотрудника'); return; }
  const res = startTrackingUser(userId);
  if (!res.ok) { alert(res.error); return; }
  renderTracking();
}

function stopTrackingFromUi(userId) {
  const res = stopTrackingUser(userId);
  if (!res.ok) { alert(res.error); return; }
  renderTracking();
}

function renderTasks() {
  const main = document.getElementById('mainContent');
  // Доска показывает глобальные столбцы плюс индивидуальные столбцы этого
  // менеджера (их набор настраивает администратор).
  const sortedColumns = columnsForCurrentUser();
  // Доска показывает задачи с учётом выбранного пласта календаря: клик по
  // периоду оставляет только задачи этого срока.
  const boardTasks = taskCalendarFilter(visibleTasks());

  main.innerHTML = `
    <div style="padding:20px;height:100vh;width:100%;min-width:0;box-sizing:border-box;display:flex;flex-direction:column;background:linear-gradient(135deg,#e8edf6 0%,#dce3ef 100%);">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-shrink:0;">
        <h1 style="font-size:22px;font-weight:600;color:#1a3a5c;">Задачи</h1>
        <button class="btn" onclick="openTaskModal()">Новая задача</button>
        ${isTaskTracker() ? '<button class="btn btn-secondary" onclick="goToSection(\'tracking\')">Отслеживание задач</button>' : ''}
      </div>

      ${renderTaskCalendarHtml()}

      <div style="position:relative;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;">
        <div class="task-board" style="display:flex;gap:12px;flex:1;min-height:0;padding-bottom:10px;min-width:0;">
          ${sortedColumns.map(col => renderTaskColumn(col, boardTasks)).join('')}

          ${renderAssignedColumn(boardTasks)}

          ${renderCoopColumn(boardTasks)}
        </div>

        <button class="board-scroll-btn left" type="button"
                onmousedown="startBoardArrowScroll(-1)" onmouseup="stopBoardArrowScroll()"
                onmouseleave="stopBoardArrowScroll()" onblur="stopBoardArrowScroll()"
                onclick="scrollTaskBoard(-1)" title="Прокрутить влево (удерживайте для непрерывной прокрутки)">‹</button>
        <button class="board-scroll-btn right" type="button"
                onmousedown="startBoardArrowScroll(1)" onmouseup="stopBoardArrowScroll()"
                onmouseleave="stopBoardArrowScroll()" onblur="stopBoardArrowScroll()"
                onclick="scrollTaskBoard(1)" title="Прокрутить вправо (удерживайте для непрерывной прокрутки)">›</button>
      </div>
    </div>
  `;

  const board = document.querySelector('.task-board');
  if (board) {
    // Вертикальное колесо над колонкой прокручивает саму колонку (native),
    // над остальным полем доски — прокручивает доску по горизонтали.
    board.addEventListener('wheel', (e) => {
      if (e.target.closest && e.target.closest('.task-column')) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        board.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    // Позиция курсора нужна автопрокрутке во время перетаскивания.
    board.addEventListener('dragover', (e) => { boardPointerX = e.clientX; });
  }

  updateTasksMenuBadge();
}

// Столбец доски. Доска одинакова для всех: управление столбцами —
// в администрировании, поэтому кнопок правки здесь нет.
function renderTaskColumn(col, boardTasks) {
  const colTasks = boardTasks.filter(t => t.status === col.id).sort((a, b) => (a.order || 0) - (b.order || 0));
  const individual = !!col.individual;

  return `
    <div class="task-column" style="min-width:280px;max-width:280px;flex-shrink:0;display:flex;flex-direction:column;border-radius:10px;overflow:hidden;">
      <div style="padding:12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #e5e7eb;background:#fff;"
           ${individual ? 'title="Индивидуальный столбец — виден только вам"' : ''}>
        <div style="width:4px;height:20px;border-radius:2px;background:${col.color};flex-shrink:0;"></div>
        <div style="flex:1;font-weight:600;font-size:14px;color:#1a3a5c;">${escapeHtml(col.name)}</div>
        <div style="background:#e5e7eb;color:#6b7280;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;">${colTasks.length}</div>
        <button onclick="quickAddTask('${col.id}')" style="background:none;border:none;cursor:pointer;font-size:18px;color:#9ca3af;padding:0 4px;" title="Быстрое добавление">+</button>
      </div>

      <div style="flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:10px;display:flex;flex-direction:column;gap:10px;"
           ondragover="handleDragOver(event)"
           ondrop="handleDrop(event, '${col.id}')"
           ondragleave="handleDragLeave(event)">
        ${colTasks.map(t => renderTaskCard(t, col)).join('')}
      </div>
    </div>
  `;
}

// Обязательная неудаляемая колонка «Назначенные задачи».
// Это фильтр-представление: показывает задачи, назначенные текущему
// пользователю, независимо от их основной колонки.
function renderAssignedColumn(boardTasks) {
  const uid = currentUser ? currentUser.id : null;
  const colTasks = boardTasks.filter(t => t.assignedTo === uid).sort((a, b) => (a.order || 0) - (b.order || 0));
  const fakeCol = { id: 'assigned', name: 'Назначенные задачи', assigned: true };

  return `
    <div class="task-column assigned-column" style="min-width:280px;max-width:280px;flex-shrink:0;display:flex;flex-direction:column;border-radius:10px;overflow:hidden;">
      <div style="padding:12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #e5e7eb;background:#fff;">
        <div style="width:4px;height:20px;border-radius:2px;background:#7c3aed;flex-shrink:0;"></div>
        <div style="flex:1;font-weight:600;font-size:14px;color:#1a3a5c;">Назначенные задачи</div>
        <div style="background:#ede9fe;color:#6d28d9;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;">${colTasks.length}</div>
        <span title="Обязательный столбец — удалить нельзя" style="color:#c4b5fd;font-size:11px;">обязательный</span>
      </div>

      <div style="flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:10px;display:flex;flex-direction:column;gap:10px;">
        ${colTasks.length === 0
          ? '<div style="font-size:12px;color:#9ca3af;text-align:center;padding:20px 10px;">Нет назначенных задач</div>'
          : colTasks.map(t => renderTaskCard(t, fakeCol)).join('')}
      </div>
    </div>
  `;
}

function assignmentStatusInfo(status) {
  return ASSIGNMENT_STATUSES.find(s => s.value === status) || ASSIGNMENT_STATUSES[0];
}

// Обязательная колонка «Совместные задачи»: задачи, где текущий пользователь
// выбран соисполнителем. Как и «Назначенные задачи», это представление-фильтр,
// а не отдельный статус: задача остаётся в своей колонке, но видна помощнику
// отдельным столбцом — он есть у всех пользователей по умолчанию.
function renderCoopColumn(boardTasks) {
  const uid = currentUser ? currentUser.id : null;
  const colTasks = boardTasks
    .filter(t => isCoAssignee(t, uid))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const fakeCol = { id: 'coop', name: 'Совместные задачи', coop: true };

  return `
    <div class="task-column coop-column" style="min-width:280px;max-width:280px;flex-shrink:0;display:flex;flex-direction:column;border-radius:10px;overflow:hidden;">
      <div style="padding:12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #e5e7eb;background:#fff;">
        <div style="width:4px;height:20px;border-radius:2px;background:#0ea5e9;flex-shrink:0;"></div>
        <div style="flex:1;font-weight:600;font-size:14px;color:#1a3a5c;">Совместные задачи</div>
        <div style="background:#e0f2fe;color:#075985;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;">${colTasks.length}</div>
        <span title="Задачи, где вы соисполнитель" style="color:#7dd3fc;font-size:11px;">совместные</span>
      </div>

      <div style="flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:10px;display:flex;flex-direction:column;gap:10px;">
        ${colTasks.length === 0
          ? '<div style="font-size:12px;color:#9ca3af;text-align:center;padding:20px 10px;">Нет совместных задач</div>'
          : colTasks.map(t => renderTaskCard(t, fakeCol)).join('')}
      </div>
    </div>
  `;
}

// Инициалы из ФИО: «Иванов Иван» → «ИИ».
function userInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

function canManageAssignment(task) {
  if (!currentUser) return false;
  if (isAdmin()) return true;
  return task.assignedTo === currentUser.id;
}

// Автор задачи — для подписи «от кого» в колонке совместных задач.
function taskOwnerName(task) {
  const u = task && task.ownerId ? findUserById(task.ownerId) : null;
  return u ? (u.name || u.login) : '—';
}

// Ссылка задачи: дописываем схему, чтобы ссылка открывалась из карточки.
function normalizeTaskLink(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
}

function renderTaskCard(task, col) {
  const priority = TASK_PRIORITIES.find(p => p.value === task.priority) || TASK_PRIORITIES[1];
  const isOverdue = taskOverdue(task);

  // Соисполнители (помощники) — пользователи системы, а не контакты клиента.
  const assignees = (task.coAssignees || []).map(id => {
    const u = findUserById(id);
    if (!u) return null;
    return { name: userDisplayName(u), initials: userInitials(u.name || u.login) };
  }).filter(Boolean);

  const client = task.clientId ? clients.find(c => c.id === task.clientId) : null;
  const contact = task.contactId && client ? (client.contacts || []).find(ct => ct.id === task.contactId) : null;

  const assignInfo = task.assignedTo ? assignmentStatusInfo(task.assignmentStatus) : null;

  return `
    <div ${col.assigned ? '' : `draggable="true" ondragstart="handleDragStart(event, ${task.id})" ondragend="handleDragEnd(event)"`}
         onclick="openTaskModal(tasks.find(t=>t.id===${task.id}))"
         style="background:#fff;border-radius:8px;padding:12px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.08);border-left:3px solid ${col.assigned ? '#7c3aed' : (col.coop ? '#0ea5e9' : priority.color)};transition:all 0.15s;"
         onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.12)'"
         onmouseout="this.style.boxShadow='0 1px 3px rgba(0,0,0,0.08)'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;">
        <div style="flex:1;min-width:0;font-size:13px;font-weight:500;color:#111;line-height:1.4;${task.status === 'completed' ? 'text-decoration:line-through;opacity:0.6;' : ''}">
          ${escapeHtml(task.title)}
        </div>
        <button onclick="event.stopPropagation(); deleteTask(${task.id})" title="Удалить задачу"
                style="background:none;border:none;cursor:pointer;font-size:12px;color:#9ca3af;padding:2px 5px;border-radius:4px;flex-shrink:0;line-height:1;"
                onmouseover="this.style.color='#ef4444';this.style.background='#f3f4f6'"
                onmouseout="this.style.color='#9ca3af';this.style.background='transparent'">✕</button>
      </div>

      ${task.description ? `<div style="font-size:11px;color:#6b7280;margin-bottom:8px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(task.description)}</div>` : ''}

      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
        ${task.deadline ? `<span style="font-size:11px;color:${isOverdue ? '#ef4444' : '#6b7280'};font-weight:${isOverdue ? '600' : '400'};">${formatDate(task.deadline)}</span>` : ''}
        ${client ? `<span style="font-size:11px;color:#3b82f6;">${escapeHtml(client.orgName)}</span>` : ''}
        ${col.coop ? `<span style="font-size:11px;color:#0ea5e9;">от ${escapeHtml(taskOwnerName(task))}</span>` : ''}
      </div>

      ${isLinkTask(task) ? `
        <div class="task-link-block${task.linkWorkedOff ? ' done' : ''}">
          <label class="task-link-check" onclick="event.stopPropagation()">
            <input type="checkbox" ${task.linkWorkedOff ? 'checked' : ''}
                   onclick="event.stopPropagation()"
                   onchange="toggleLinkWorkedOff(${task.id})">
            <span>Ссылка отработана</span>
          </label>
          ${task.linkUrl ? `<a href="${escapeHtml(normalizeTaskLink(task.linkUrl))}" target="_blank" rel="noopener"
                                onclick="event.stopPropagation()">${escapeHtml(task.linkUrl)}</a>` : ''}
          <div class="task-link-hint">
            ${task.linkWorkedOff
              ? 'Галочка стоит — задачу можно закрывать.'
              : 'Тип «Отработка ссылки»: закрыть задачу можно только после галочки.'}
          </div>
        </div>
      ` : ''}

      ${assignInfo ? `
        <div style="display:flex;align-items:center;gap:6px;margin-top:8px;padding-top:8px;border-top:1px dashed #e5e7eb;">
          <span style="font-size:11px;color:#9ca3af;flex-shrink:0;">Статус:</span>
          <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:${assignInfo.color};color:#fff;flex-shrink:0;">${assignInfo.label}</span>
          ${canManageAssignment(task) ? `
            <select onclick="event.stopPropagation()" onchange="setAssignmentStatus(${task.id}, this.value)"
                    style="margin-left:auto;font-size:11px;padding:3px 4px;border:1px solid #d0d5dd;border-radius:4px;background:#fff;color:#374151;max-width:110px;">
              ${ASSIGNMENT_STATUSES.map(s => `<option value="${s.value}" ${s.value === task.assignmentStatus ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>
          ` : ''}
        </div>
      ` : ''}

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
        <div style="display:flex;gap:4px;">
          ${assignees.slice(0, 3).map(a => `<div style="width:22px;height:22px;border-radius:50%;background:#3b82f6;color:#fff;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;" title="${escapeHtml(a.name)}">${a.initials}</div>`).join('')}
          ${assignees.length > 3 ? `<div style="width:22px;height:22px;border-radius:50%;background:#e5e7eb;color:#6b7280;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;">+${assignees.length-3}</div>` : ''}
        </div>
        ${contact ? `<div style="font-size:10px;color:#9ca3af;">${escapeHtml(contact.name.split(' ')[0])}</div>` : ''}
      </div>
    </div>
  `;
}

let draggedTaskId = null;
let draggedColumnId = null;

/* ===== Автопрокрутка доски при перетаскивании =====
   Без неё задача не попадает в столбцы за пределами видимой области:
   зона приёма физически недостижима — курсор упирается в край окна.
   Пока идёт перетаскивание, доска прокручивается, когда курсор у края. */

const BOARD_EDGE_PX = 90;    // ширина «горячей» зоны у краёв доски
const BOARD_SCROLL_STEP = 22;

let boardAutoScrollTimer = null;
let boardPointerX = 0;

function boardAutoScrollTick() {
  const board = document.querySelector('.task-board');
  if (!board) return;
  const rect = board.getBoundingClientRect();
  if (boardPointerX - rect.left < BOARD_EDGE_PX) board.scrollLeft -= BOARD_SCROLL_STEP;
  else if (rect.right - boardPointerX < BOARD_EDGE_PX) board.scrollLeft += BOARD_SCROLL_STEP;
}

function startBoardAutoScroll(clientX) {
  if (typeof clientX === 'number') boardPointerX = clientX;
  if (boardAutoScrollTimer) return;
  const board = document.querySelector('.task-board');
  // Плавная прокрутка мешает точному позиционированию во время перетаскивания.
  if (board) board.style.scrollBehavior = 'auto';
  boardAutoScrollTimer = setInterval(boardAutoScrollTick, 16);
}

function stopBoardAutoScroll() {
  if (boardAutoScrollTimer) {
    clearInterval(boardAutoScrollTimer);
    boardAutoScrollTimer = null;
  }
  const board = document.querySelector('.task-board');
  if (board) board.style.scrollBehavior = '';
}

function handleDragStart(e, taskId) {
  draggedTaskId = taskId;
  draggedColumnId = null;
  e.target.style.opacity = '0.5';
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', taskId);
  startBoardAutoScroll(e.clientX);
}

function handleDragEnd(e) {
  e.target.style.opacity = '1';
  draggedTaskId = null;
  draggedColumnId = null;
  stopBoardAutoScroll();
  document.querySelectorAll('[ondragover]').forEach(el => el.style.background = '');
  document.querySelectorAll('.task-column.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function handleDragOver(e) {
  if (draggedColumnId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.style.background = '#e0f2fe';
}

function handleDragLeave(e) {
  e.currentTarget.style.background = '';
}

function handleDrop(e, columnId) {
  if (draggedColumnId) return;
  e.preventDefault();
  e.currentTarget.style.background = '';

  const taskId = parseInt(e.dataTransfer.getData('text/plain'));
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  // Задача-ссылка не закрывается, пока не отмечена галочка: перетаскивание
  // в завершающий столбец отклоняем и объясняем причину.
  const moved = setTaskStatus(task, columnId);
  if (!moved.ok) {
    alert(moved.error);
    renderTasks();
    return;
  }

  const colTasks = tasks.filter(t => t.status === columnId && t.id !== taskId);
  task.order = colTasks.length;

  if (isCompletedColumnId(columnId)) {
    task.completedAt = new Date().toISOString();
  } else {
    task.completedAt = null;
  }

  saveTasks();
  renderTasks();
}

// Поле ссылки показываем только для типа «Отработка ссылки».
function onTaskKindChange() {
  const kindEl = document.getElementById('taskKind');
  const row = document.getElementById('taskLinkRow');
  if (!row) return;
  row.style.display = (kindEl && kindEl.value === 'link') ? '' : 'none';
}

function quickAddTask(columnId) {
  openTaskModal(null, null, columnId);
}

function openTaskModal(task = null, clientId = null, defaultColumn = null) {
  document.getElementById('taskModalTitle').textContent = task ? 'Редактировать задачу' : 'Новая задача';
  document.getElementById('taskId').value = task?.id || '';
  document.getElementById('taskTitle').value = task?.title || '';
  document.getElementById('taskDescription').value = task?.description || '';
  document.getElementById('taskDeadline').value = task?.deadline || '';
  document.getElementById('taskClientId').value = task?.clientId || clientId || '';
  initTaskClientSearch();

  const prioritySelect = document.getElementById('taskPriority');
  prioritySelect.innerHTML = TASK_PRIORITIES.map(p =>
    `<option value="${p.value}" ${task?.priority === p.value ? 'selected' : ''}>${p.name}</option>`
  ).join('');

  // Тип задачи: обычная или «Отработка ссылки» (закрывается по галочке).
  const kindSelect = document.getElementById('taskKind');
  if (kindSelect) {
    const kind = (task && task.kind) || 'regular';
    kindSelect.innerHTML = TASK_KINDS.map(k =>
      `<option value="${k.value}"${kind === k.value ? ' selected' : ''}>${escapeHtml(k.name)}</option>`).join('');
  }
  const linkInput = document.getElementById('taskLinkUrl');
  if (linkInput) linkInput.value = (task && task.linkUrl) || '';
  onTaskKindChange();

  // Назначение исполнителю: поле видят только администратор и руководитель.
  const assignRow = document.getElementById('taskAssignRow');
  const assignSelect = document.getElementById('taskAssignTo');
  if (assignRow && assignSelect) {
    const canAssign = canAssignTasks();
    assignRow.style.display = canAssign ? '' : 'none';
    if (canAssign) {
      assignSelect.innerHTML = '<option value="">— не назначать —</option>' +
        assignmentCandidates().map(u =>
          `<option value="${u.id}"${task && task.assignedTo === u.id ? ' selected' : ''}>` +
          `${escapeHtml(u.name || u.login)} (${escapeHtml(userRoleLabel(u))})</option>`).join('');
      assignSelect.value = (task && task.assignedTo) ? String(task.assignedTo) : '';
    }
  }

  const columnSelect = document.getElementById('taskColumn');
  const sortedCols = [...taskColumns].sort((a, b) => a.order - b.order);
  columnSelect.innerHTML = sortedCols.map(c =>
    `<option value="${c.id}" ${task?.status === c.id || (!task && defaultColumn === c.id) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
  ).join('');

  // Соисполнители: подсказки берутся из списка пользователей системы.
  taskCoAssignees = (task?.coAssignees || []).slice();
  const coInput = document.getElementById('coAssigneeSearch');
  if (coInput) coInput.value = '';
  hideCoAssigneeDropdown();
  renderCoAssigneeChips();

  updateTaskContactSelect();

  const clientLink = document.getElementById('taskClientLink');
  const cid = task?.clientId || clientId;
  const linkedClient = cid ? clients.find(cl => cl.id === cid) : null;

  // Поле «Клиент (компания)» показываем только там, где клиента ещё нет:
  // «Быстрая задача» или создание из раздела «Задачи». Если задача открыта
  // из карточки клиента или правится существующая — поле скрыто.
  setTaskClientFieldLocked(linkedClient);

  // Привязанного клиента показываем подписью, а не строкой со ссылкой:
  // ссылку «убрать» выводит выбор клиента в открытом поле.
  clientLink.style.display = 'none';

  document.getElementById('taskModal').classList.add('active');
}

// Скрыть выбор клиента и показать его подписью (клиент уже известен).
function setTaskClientFieldLocked(client) {
  const group = document.getElementById('taskClientGroup');
  const fixed = document.getElementById('taskClientFixed');
  if (group) group.style.display = client ? 'none' : '';
  if (fixed) {
    fixed.style.display = client ? 'block' : 'none';
    fixed.innerHTML = client ? `Клиент: <strong>${escapeHtml(client.orgName)}</strong>` : '';
  }
}

function updateTaskContactSelect() {
  const clientId = parseInt(document.getElementById('taskClientId').value);
  const contactSelect = document.getElementById('taskContactSelect');
  const contactRow = document.getElementById('taskContactRow');

  if (!clientId) {
    contactRow.style.display = 'none';
    contactSelect.innerHTML = '';
    return;
  }

  const client = clients.find(c => c.id === clientId);
  if (!client || !client.contacts || client.contacts.length === 0) {
    contactRow.style.display = 'none';
    contactSelect.innerHTML = '';
    return;
  }

  contactRow.style.display = 'block';
  contactSelect.innerHTML = '<option value="">— Не выбрано —</option>' +
    client.contacts.map(ct => `<option value="${ct.id}">${escapeHtml(ct.name)}${ct.position ? ' (' + escapeHtml(ct.position) + ')' : ''}</option>`).join('');
}

function unlinkTaskFromClient() {
  document.getElementById('taskClientId').value = '';
  document.getElementById('taskClientLink').style.display = 'none';
  selectedTaskClientId = null;
  const input = document.getElementById('taskClientSearch');
  if (input) input.value = '';
  updateTaskContactSelect();
}

/* ===== Соисполнители (помощники) =====
   Выбираются из пользователей системы — с ФИО и должностью и поиском по ним,
   а не из контактов клиента. Выбранному коллеге уходит уведомление, а задача
   появляется в его колонке «Совместные задачи». */

function hideCoAssigneeDropdown() {
  const dd = document.getElementById('coAssigneeDropdown');
  if (dd) dd.style.display = 'none';
}

// Плашки выбранных помощников с возможностью убрать.
function renderCoAssigneeChips() {
  const box = document.getElementById('coAssigneeChips');
  if (!box) return;
  if (!taskCoAssignees.length) {
    box.innerHTML = '<span class="coassignee-empty">Помощники не выбраны</span>';
    return;
  }
  box.innerHTML = taskCoAssignees.map(id => {
    const u = findUserById(id);
    if (!u) return '';
    return `<span class="coassignee-chip" title="${escapeHtml(userPositionLabel(u))}">
      ${escapeHtml(userDisplayName(u))}
      <button type="button" onclick="removeCoAssignee(${id})" title="Убрать помощника">✕</button>
    </span>`;
  }).join('');
}

function onCoAssigneeSearch() {
  const input = document.getElementById('coAssigneeSearch');
  const dd = document.getElementById('coAssigneeDropdown');
  if (!input || !dd) return;

  const found = searchUsers(input.value, taskCoAssignees).slice(0, 12);
  if (!found.length) {
    dd.innerHTML = '<div class="manager-option-empty">Коллеги не найдены</div>';
    dd.style.display = 'block';
    return;
  }
  dd.innerHTML = found.map(u => `
    <div class="client-typeahead-item" data-coassignee="${u.id}">
      <strong>${escapeHtml(u.name || u.login)}</strong>
      <span class="coassignee-hint">${escapeHtml(userPositionLabel(u))}</span>
    </div>`).join('');
  dd.style.display = 'block';
}

function addCoAssignee(id) {
  const uid = parseInt(id, 10);
  if (!uid || taskCoAssignees.indexOf(uid) > -1) return;
  taskCoAssignees.push(uid);
  const input = document.getElementById('coAssigneeSearch');
  if (input) { input.value = ''; input.focus(); }
  hideCoAssigneeDropdown();
  renderCoAssigneeChips();
}

function removeCoAssignee(id) {
  const uid = parseInt(id, 10);
  taskCoAssignees = taskCoAssignees.filter(x => x !== uid);
  renderCoAssigneeChips();
}

// Клик по подсказке в списке коллег.
document.addEventListener('click', (e) => {
  if (!e.target || !e.target.closest) return;
  const item = e.target.closest('[data-coassignee]');
  if (item) addCoAssignee(item.dataset.coassignee);
});

function saveTask(e) {
  e.preventDefault();
  const id = document.getElementById('taskId').value;
  const clientIdVal = document.getElementById('taskClientId').value;
  const contactIdVal = document.getElementById('taskContactSelect').value;
  const kindEl = document.getElementById('taskKind');
  const linkEl = document.getElementById('taskLinkUrl');
  const kind = (kindEl && kindEl.value === 'link') ? 'link' : 'regular';

  const data = {
    title: document.getElementById('taskTitle').value.trim(),
    description: document.getElementById('taskDescription').value.trim(),
    deadline: document.getElementById('taskDeadline').value,
    priority: document.getElementById('taskPriority').value,
    status: document.getElementById('taskColumn').value,
    coAssignees: taskCoAssignees.slice(),
    clientId: clientIdVal ? parseInt(clientIdVal) : null,
    contactId: contactIdVal ? parseInt(contactIdVal) : null,
    kind: kind,
    linkUrl: kind === 'link' ? (linkEl ? linkEl.value.trim() : '') : ''
  };

  // Задачу-ссылку нельзя закрыть, пока не отмечена галочка на карточке.
  const current = id ? tasks.find(t => t.id === parseInt(id)) : null;
  const linkWorkedOff = current ? !!current.linkWorkedOff : false;
  if (kind === 'link' && isCompletedColumnId(data.status) && !linkWorkedOff) {
    alert('Задача «Отработка ссылки» закрывается только после отметки «Ссылка отработана».\n' +
      'Сохраните задачу в рабочий столбец и поставьте галочку на карточке.');
    return;
  }
  data.linkWorkedOff = linkWorkedOff;
  if (kind !== 'link') data.linkWorkedOff = false;

  let task = null;
  let previousCoAssignees = [];

  if (id) {
    const idx = tasks.findIndex(t => t.id === parseInt(id));
    if (idx !== -1) {
      previousCoAssignees = (tasks[idx].coAssignees || []).slice();
      if (!tasks[idx].ownerId) tasks[idx].ownerId = currentUser ? currentUser.id : null;
      if (tasks[idx].status !== data.status) data.statusUpdatedAt = new Date().toISOString();
      tasks[idx] = { ...tasks[idx], ...data };
      task = syncTrackingForTask(tasks[idx]);
    }
  } else {
    const maxId = tasks.reduce((m, t) => Math.max(m, t.id || 0), 0);
    data.id = maxId + 1;
    data.createdAt = new Date().toISOString();
    data.statusUpdatedAt = new Date().toISOString();
    data.ownerId = currentUser ? currentUser.id : null;
    data.order = tasks.filter(t => t.status === data.status).length;
    tasks.push(data);
    task = syncTrackingForTask(data);
  }

  // Назначение исполнителю — прямо из главного меню «Задачи».
  if (task && canAssignTasks()) {
    const assignEl = document.getElementById('taskAssignTo');
    if (assignEl) {
      const assigned = applyTaskAssignment(task, assignEl.value);
      if (!assigned.ok) {
        alert(assigned.error);
      } else if (assigned.assigned && assigned.changed && assigned.user) {
        notifyUser(
          assigned.user.id,
          'Назначена задача «' + task.title + '»',
          'Задача появилась у вас в столбце «Назначенные задачи».',
          task.id
        );
      }
    }
  }

  // Новым соисполнителям уходит уведомление (себе — не отправляем).
  if (task) {
    const meId = currentUser ? currentUser.id : null;
    data.coAssignees.forEach(uid => {
      if (uid === meId) return;
      if (previousCoAssignees.indexOf(uid) > -1) return;
      notifyUser(
        uid,
        'Вы соисполнитель задачи «' + data.title + '»',
        'Задача появилась у вас в столбце «Совместные задачи».',
        task.id
      );
    });
  }

  saveTasks();
  closeModal('taskModal');
  renderTasks();
}

function editTask(id) {
  const t = tasks.find(x => x.id === id);
  if (t) openTaskModal(t);
}

// Перерисовать текущий раздел после изменения задачи:
// на канбане — доску, в админ-разделе — соответствующий подраздел.
function refreshAfterTaskChange() {
  if (typeof currentSection === 'string' && currentSection.startsWith('admin')) {
    renderAdminSection(currentSection);
  } else {
    renderTasks();
  }
}

function deleteTask(id) {
  if (!confirm('Удалить задачу?')) return;
  tasks = tasks.filter(t => t.id !== id);
  saveTasks();
  refreshAfterTaskChange();
}

// Изменение статуса назначенной задачи (исполнитель или администратор).
function setAssignmentStatus(taskId, status) {
  const t = tasks.find(x => x.id === taskId);
  if (!t || !canManageAssignment(t)) return;
  t.assignmentStatus = status;
  saveTasks();
  refreshAfterTaskChange();
}

/* ===== Дедлайны с временем ===== */

// Парсинг дедлайна с учётом времени. Поддерживает "YYYY-MM-DD" (только дата —
// просроченность считается по концу дня) и "YYYY-MM-DDTHH:mm" (точное время).
function parseDeadline(deadline) {
  if (!deadline) return null;
  const s = String(deadline);
  let d;
  if (s.includes('T')) {
    d = new Date(s);
  } else {
    d = new Date(s + 'T23:59:59');
  }
  if (isNaN(d.getTime())) return null;
  return d;
}

// Задача просрочена: дедлайн наступил (с учётом времени), задача не завершена.
function taskOverdue(task) {
  if (!task || task.status === 'completed') return false;
  const dl = parseDeadline(task.deadline);
  if (!dl) return false;
  return dl < new Date();
}

// Установка статуса задачи с фиксацией момента перехода (для аналитики по датам).
// Задачу типа «Отработка ссылки» нельзя перевести в завершающий столбец, пока
// не отмечена галочка «Ссылка отработана».
function setTaskStatus(task, status) {
  if (!task) return { ok: false, error: 'Задача не найдена' };
  if (task.status !== status && isCompletedColumnId(status) && !taskCanBeClosed(task)) {
    return { ok: false, error: taskClosureBlockMessage(task) };
  }
  if (task.status !== status) {
    task.status = status;
    task.statusUpdatedAt = new Date().toISOString();
  }
  return { ok: true };
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';

  const datePart = String(dateStr).slice(0, 10); // YYYY-MM-DD
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const hasTime = /T\d{2}:\d{2}/.test(String(dateStr));
  const timeStr = hasTime ? ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';

  if (datePart === today.toISOString().split('T')[0]) return 'Сегодня' + timeStr;
  if (datePart === tomorrow.toISOString().split('T')[0]) return 'Завтра' + timeStr;

  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) + timeStr;
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
