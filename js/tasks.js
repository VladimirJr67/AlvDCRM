/* ============================================================
   js/tasks.js — канбан-доска задач, статусы, назначение задач.
   Глобальный массив задач общий; пользователь с ролью «user»
   видит только свои задачи (автор или назначенный исполнитель),
   администратор — все. Колонка «Назначенные задачи» обязательная
   и неудаляемая. 4 бизнес-статуса дашборда гарантируются.
   ============================================================ */

let tasks = [];
let taskColumns = [];

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

function saveTasks() {
  localStorage.setItem('alvid_crm_tasks', JSON.stringify(tasks));
  queueServerSave();
}

function saveTaskColumns() {
  localStorage.setItem('alvid_crm_task_columns', JSON.stringify(taskColumns));
  queueServerSave();
}

function visibleTasks() {
  if (!currentUser) return tasks;
  const uid = currentUser.id;
  if (isAdmin()) {
    // Личный канбан администратора — только собственные задачи, которые не
    // назначены другим пользователям. Назначенные задачи админ отслеживает
    // в разделе «Администрирование → Задачи».
    return tasks.filter(t => t.ownerId === uid && (!t.assignedTo || t.assignedTo === uid));
  }
  return tasks.filter(t => t.ownerId === uid || t.assignedTo === uid);
}

function updateTasksMenuBadge() {
  const badge = document.getElementById('tasksMenuBadge');
  if (!badge) return;
  const visible = visibleTasks();
  const overdue = visible.filter(t => taskOverdue(t)).length;
  badge.innerHTML =
    `<span class="menu-badge-count" title="Всего задач">${visible.length}</span>` +
    `<span class="menu-badge-count menu-badge-overdue" title="Просрочено">${overdue}</span>`;
}

function scrollTaskBoard(direction) {
  const board = document.querySelector('.task-board');
  if (!board) return;
  board.scrollBy({ left: direction * 300, behavior: 'smooth' });
}

function renderTasks() {
  const main = document.getElementById('mainContent');
  const sortedColumns = [...taskColumns].sort((a, b) => a.order - b.order);
  const boardTasks = visibleTasks();
  const canManageBoard = isAdmin();

  main.innerHTML = `
    <div style="padding:20px;height:100vh;width:100%;min-width:0;box-sizing:border-box;display:flex;flex-direction:column;background:linear-gradient(135deg,#e8edf6 0%,#dce3ef 100%);">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:15px;flex-shrink:0;">
        <h1 style="font-size:22px;font-weight:600;color:#1a3a5c;">Задачи</h1>
        <button class="btn" onclick="openTaskModal()">+ Новая задача</button>
      </div>

      <div style="position:relative;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;">
        <div class="task-board" style="display:flex;gap:12px;flex:1;min-height:0;padding-bottom:10px;min-width:0;">
          ${sortedColumns.map(col => renderTaskColumn(col, boardTasks, canManageBoard)).join('')}

          ${renderAssignedColumn(boardTasks)}

          ${canManageBoard ? `
            <div style="min-width:200px;flex-shrink:0;">
              <div style="background:#f9fafb;border:2px dashed #d1d5db;border-radius:10px;padding:12px;height:100%;display:flex;flex-direction:column;">
                <button onclick="addTaskColumn()" style="background:none;border:none;cursor:pointer;font-size:24px;color:#9ca3af;margin-bottom:8px;" title="Добавить столб">+</button>
                <div style="font-size:12px;color:#9ca3af;">Добавить столб</div>
              </div>
            </div>
          ` : ''}
        </div>

        <button class="board-scroll-btn left" onclick="scrollTaskBoard(-1)" title="Прокрутить влево">‹</button>
        <button class="board-scroll-btn right" onclick="scrollTaskBoard(1)" title="Прокрутить вправо">›</button>
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
  }

  updateTasksMenuBadge();
}

function renderTaskColumn(col, boardTasks, canManageBoard) {
  const colTasks = boardTasks.filter(t => t.status === col.id).sort((a, b) => (a.order || 0) - (b.order || 0));
  const isLocked = !!col.locked;
  const isDefault = DEFAULT_COLUMNS.find(dc => dc.id === col.id);

  return `
    <div class="task-column" style="min-width:280px;max-width:280px;flex-shrink:0;display:flex;flex-direction:column;border-radius:10px;overflow:hidden;"
         ondragover="handleColumnDragOver(event, '${col.id}')"
         ondragleave="handleColumnDragLeave(event)"
         ondrop="handleColumnDrop(event, '${col.id}')">
      <div style="padding:12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #e5e7eb;background:#fff;${canManageBoard && !isLocked ? 'cursor:grab;' : ''}"
           ${canManageBoard && !isLocked ? `draggable="true" ondragstart="handleColumnDragStart(event, '${col.id}')" ondragend="handleColumnDragEnd(event)" title="Перетащите, чтобы изменить порядок"` : ''}>
        <div style="width:4px;height:20px;border-radius:2px;background:${col.color};flex-shrink:0;"></div>
        <div style="flex:1;font-weight:600;font-size:14px;color:#1a3a5c;">${escapeHtml(col.name)}</div>
        <div style="background:#e5e7eb;color:#6b7280;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;">${colTasks.length}</div>
        <button onclick="quickAddTask('${col.id}')" style="background:none;border:none;cursor:pointer;font-size:18px;color:#9ca3af;padding:0 4px;" title="Быстрое добавление">+</button>
        ${canManageBoard && !isLocked && !isDefault ? `
          <button onclick="editTaskColumn('${col.id}')" style="background:none;border:none;cursor:pointer;font-size:14px;color:#9ca3af;" title="Редактировать">✏️</button>
        ` : ''}
        ${canManageBoard && !isLocked ? `
          <button onclick="deleteTaskColumn('${col.id}')" style="background:none;border:none;cursor:pointer;font-size:14px;color:#ef4444;" title="Удалить столб">×</button>
        ` : ''}
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
        <span title="Обязательный столбец — удалить нельзя" style="color:#c4b5fd;font-size:12px;">🔒</span>
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

function canManageAssignment(task) {
  if (!currentUser) return false;
  if (isAdmin()) return true;
  return task.assignedTo === currentUser.id;
}

function renderTaskCard(task, col) {
  const priority = TASK_PRIORITIES.find(p => p.value === task.priority) || TASK_PRIORITIES[1];
  const isOverdue = taskOverdue(task);

  const assignees = (task.assignees || []).map(a => {
    if (a.type === 'me') return { name: currentUser ? currentUser.login : 'Admin', initials: (currentUser ? currentUser.login[0] : 'A').toUpperCase() };
    const contact = contacts.find(c => c.id === a.id);
    if (contact) {
      const parts = contact.name.split(' ');
      return { name: contact.name, initials: (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase().substring(0,2) };
    }
    return null;
  }).filter(Boolean);

  const client = task.clientId ? clients.find(c => c.id === task.clientId) : null;
  const contact = task.contactId && client ? (client.contacts || []).find(ct => ct.id === task.contactId) : null;

  const assignInfo = task.assignedTo ? assignmentStatusInfo(task.assignmentStatus) : null;

  return `
    <div ${col.assigned ? '' : `draggable="true" ondragstart="handleDragStart(event, ${task.id})" ondragend="handleDragEnd(event)"`}
         onclick="openTaskModal(tasks.find(t=>t.id===${task.id}))"
         style="background:#fff;border-radius:8px;padding:12px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.08);border-left:3px solid ${col.assigned ? '#7c3aed' : priority.color};transition:all 0.15s;"
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
      </div>

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

function handleDragStart(e, taskId) {
  draggedTaskId = taskId;
  draggedColumnId = null;
  e.target.style.opacity = '0.5';
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', taskId);
}

function handleDragEnd(e) {
  e.target.style.opacity = '1';
  draggedTaskId = null;
  draggedColumnId = null;
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

  setTaskStatus(task, columnId);
  const colTasks = tasks.filter(t => t.status === columnId && t.id !== taskId);
  task.order = colTasks.length;

  if (columnId === 'completed') {
    task.completedAt = new Date().toISOString();
  } else {
    task.completedAt = null;
  }

  saveTasks();
  renderTasks();
}

function handleColumnDragStart(e, colId) {
  draggedColumnId = colId;
  draggedTaskId = null;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'col:' + colId);
}

function handleColumnDragEnd(e) {
  draggedColumnId = null;
  document.querySelectorAll('.task-column.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function handleColumnDragOver(e, colId) {
  if (!draggedColumnId || draggedColumnId === colId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function handleColumnDragLeave(e) {
  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
  e.currentTarget.classList.remove('drag-over');
}

function handleColumnDrop(e, colId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!draggedColumnId || draggedColumnId === colId) return;

  const sorted = [...taskColumns].sort((a, b) => a.order - b.order);
  const fromIdx = sorted.findIndex(c => c.id === draggedColumnId);
  const toIdx = sorted.findIndex(c => c.id === colId);
  if (fromIdx === -1 || toIdx === -1) return;

  const [moved] = sorted.splice(fromIdx, 1);
  sorted.splice(toIdx, 0, moved);
  sorted.forEach((c, i) => c.order = i);
  saveTaskColumns();
  renderTasks();
}

function addTaskColumn() {
  const name = prompt('Название нового типа задач:');
  if (!name || !name.trim()) return;

  const colors = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#ec4899', '#06b6d4', '#84cc16'];
  const color = colors[taskColumns.length % colors.length];
  const maxOrder = taskColumns.reduce((m, c) => Math.max(m, c.order), 0);

  taskColumns.push({
    id: 'col_' + Date.now(),
    name: name.trim(),
    color: color,
    order: maxOrder + 1
  });
  saveTaskColumns();
  renderTasks();
}

function editTaskColumn(colId) {
  const col = taskColumns.find(c => c.id === colId);
  if (!col || col.locked) return;

  const name = prompt('Новое название:', col.name);
  if (!name || !name.trim()) return;
  col.name = name.trim();

  const color = prompt('Цвет (hex, например #3b82f6):', col.color);
  if (color && color.trim().startsWith('#')) col.color = color.trim();

  saveTaskColumns();
  renderTasks();
}

function deleteTaskColumn(colId) {
  const col = taskColumns.find(c => c.id === colId);
  if (!col || col.locked) return;

  const colTasks = tasks.filter(t => t.status === colId);
  const remaining = taskColumns.filter(c => c.id !== colId).sort((a, b) => a.order - b.order);
  const target = remaining[0];

  let msg = `Точно удалить столб «${col.name}»?`;
  if (colTasks.length > 0) {
    msg += `\nВ столбе ${colTasks.length} задач. Они будут перенесены в «${target ? target.name : 'Новые'}».`;
  }
  if (!confirm(msg)) return;

  if (colTasks.length > 0) {
    colTasks.forEach(t => { t.status = target ? target.id : 'new'; });
    saveTasks();
  }
  taskColumns = taskColumns.filter(c => c.id !== colId);
  saveTaskColumns();
  renderTasks();
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

  const columnSelect = document.getElementById('taskColumn');
  const sortedCols = [...taskColumns].sort((a, b) => a.order - b.order);
  columnSelect.innerHTML = sortedCols.map(c =>
    `<option value="${c.id}" ${task?.status === c.id || (!task && defaultColumn === c.id) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
  ).join('');

  const meCheckbox = document.getElementById('taskAssignMe');
  const assigneesSelect = document.getElementById('taskAssignees');
  const hasMe = task?.assignees?.some(a => a.type === 'me');
  meCheckbox.checked = hasMe || false;
  assigneesSelect.innerHTML = contacts.map(c => {
    const isSelected = task?.assignees?.some(a => a.type === 'contact' && a.id === c.id);
    return `<option value="${c.id}" ${isSelected ? 'selected' : ''}>${escapeHtml(c.name)} (${escapeHtml(c.department || '—')})</option>`;
  }).join('');

  updateTaskContactSelect();

  const clientLink = document.getElementById('taskClientLink');
  const cid = task?.clientId || clientId;
  if (cid) {
    const c = clients.find(cl => cl.id === cid);
    if (c) {
      clientLink.style.display = 'block';
      clientLink.innerHTML = `🏢 <strong>${escapeHtml(c.orgName)}</strong> <button type="button" onclick="unlinkTaskFromClient()" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:12px;margin-left:6px;">✕ убрать</button>`;
    }
  } else {
    clientLink.style.display = 'none';
  }

  document.getElementById('taskModal').classList.add('active');
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

function saveTask(e) {
  e.preventDefault();
  const id = document.getElementById('taskId').value;
  const clientIdVal = document.getElementById('taskClientId').value;
  const contactIdVal = document.getElementById('taskContactSelect').value;

  const assignees = [];
  if (document.getElementById('taskAssignMe').checked) assignees.push({ type: 'me' });
  Array.from(document.getElementById('taskAssignees').selectedOptions).forEach(opt => {
    assignees.push({ type: 'contact', id: parseInt(opt.value) });
  });

  const data = {
    title: document.getElementById('taskTitle').value.trim(),
    description: document.getElementById('taskDescription').value.trim(),
    deadline: document.getElementById('taskDeadline').value,
    priority: document.getElementById('taskPriority').value,
    status: document.getElementById('taskColumn').value,
    assignees: assignees,
    clientId: clientIdVal ? parseInt(clientIdVal) : null,
    contactId: contactIdVal ? parseInt(contactIdVal) : null
  };

  if (id) {
    const idx = tasks.findIndex(t => t.id === parseInt(id));
    if (idx !== -1) {
      if (!tasks[idx].ownerId) tasks[idx].ownerId = currentUser ? currentUser.id : null;
      if (tasks[idx].status !== data.status) data.statusUpdatedAt = new Date().toISOString();
      tasks[idx] = { ...tasks[idx], ...data };
    }
  } else {
    const maxId = tasks.reduce((m, t) => Math.max(m, t.id || 0), 0);
    data.id = maxId + 1;
    data.createdAt = new Date().toISOString();
    data.statusUpdatedAt = new Date().toISOString();
    data.ownerId = currentUser ? currentUser.id : null;
    data.order = tasks.filter(t => t.status === data.status).length;
    tasks.push(data);
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
function setTaskStatus(task, status) {
  if (!task) return task;
  if (task.status !== status) {
    task.status = status;
    task.statusUpdatedAt = new Date().toISOString();
  }
  return task;
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
