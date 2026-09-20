/* ============================================================
   __test_admin_columns.js — проверка администрирования задач.

   Критерий:
     пункта «Задачи» в администрировании нет, назначение — из главного
     меню «Задачи» (администратор и руководитель);
     столбцы управляются: глобальные появляются у менеджеров, индивидуальные —
     только у своего менеджера, удалённые исчезают, задачи из них переезжают;
     привязка активностей к столбцам настраивается, включая «ни к какому».

   Запуск:  node __test_admin_columns.js
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
}

const elements = {};
function el(id) {
  if (!elements[id]) {
    elements[id] = {
      id, value: '', checked: false, innerHTML: '', textContent: '', style: {}, dataset: {},
      classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
      setAttribute() {}, getAttribute() { return null; },
      appendChild() {}, focus() {}, addEventListener() {}, reset() {},
      querySelector() { return null; }, querySelectorAll() { return []; }
    };
  }
  return elements[id];
}

const alerts = [];
const store = {};
const notificationsSent = [];

const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  alert: msg => { alerts.push(String(msg)); },
  confirm: () => true,
  prompt: () => null,
  Intl, Date, Math, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat,
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  performance: { now: () => 0 },
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: {
    getElementById: el,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => el('__created'),
    body: el('body'),
    documentElement: el('html')
  },
  window: { addEventListener: () => {}, location: { protocol: 'http:' }, isSecureContext: true },
  navigator: { sendBeacon: () => true },
  queueServerSave: () => {},
  apiAvailable: () => true,
  updateUserInfo: () => {},
  goToSection: () => {},
  // Живёт в js/app.js (в тесте целиком не загружается).
  initTaskClientSearch: () => {},
  selectTaskClient: () => {},
  showNativeNotification: () => false,
  playNotifySound: () => {}
};

const context = vm.createContext(sandbox);
const read = f => fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');
['data.js', 'storage.js', 'users.js', 'interactionTypes.js', 'dictionaries.js', 'profile.js',
 'notifications.js', 'geo.js', 'reminders.js', 'tasks.js', 'orders.js', 'matrices.js',
 'clients.js', 'admin.js'].forEach(f => {
  vm.runInContext(read(f), context, { filename: f });
});

const run = code => vm.runInContext(code, context);
const html = id => el(id).innerHTML;

run(`
  currentSection = 'admin-task-columns';
  users = [
    { id: 1, login: 'Admin', password: 'Admin', role: 'admin', name: 'Администратор', trackedBy: [] },
    { id: 2, login: 'manager', password: 'm', role: 'manager', name: 'Иванов Иван', position: 'менеджер по продажам', trackedBy: [] },
    { id: 3, login: 'manager2', password: 'm2', role: 'manager', name: 'Сидоров Сидор', position: 'менеджер по продажам', trackedBy: [] },
    { id: 4, login: 'lead', password: 'l', role: 'lead', name: 'Петров Пётр', position: 'руководитель', trackedBy: [] }
  ];
  clients = [];
  interactionTypes = ['Звонок', 'Информация', 'Встреча', 'Размещение заказа'];
  taskColumns = [
    { id: 'in_progress', name: 'В работе', color: '#f59e0b', order: 0, locked: true },
    { id: 'completed', name: 'Завершены', color: '#10b981', order: 1, locked: true },
    { id: 'calls', name: 'Звонки', color: '#3b82f6', order: 2 }
  ];
  taskColumnsPerManager = {};
  activityToColumnMap = {};
  tasks = [
    { id: 1, title: 'Задача в звонках', deadline: '2026-10-05T10:00', status: 'calls', ownerId: 2, trackingBy: [], kind: 'regular', order: 0 },
    { id: 2, title: 'Задача в работе', deadline: '2026-10-06T10:00', status: 'in_progress', ownerId: 2, trackingBy: [], kind: 'regular', order: 0 }
  ];
  currentUser = users.find(u => u.login === 'Admin');
`);
function asUser(login) {
  run(`currentUser = users.find(u => u.login === '${login}')`);
}

(async () => {
  console.log('\nАдминистрирование задач: раздел, назначение, столбцы, привязки');

  /* ================= 1. «Задачи» больше нет в админке ================= */
  const appSrc = read('app.js');
  const adminSrc = read('admin.js');
  check('в админском меню нет пункта «Задачи»',
    !/admin-assignments/.test(appSrc) && !/label: 'Задачи'/.test(appSrc));
  check('в админке нет обработчика раздела задач',
    !/renderAdminAssignments/.test(adminSrc) && !/renderAdminAssignments/.test(appSrc));
  check('вместо него появился раздел «Столбцы задач»',
    /section: 'admin-task-columns', label: 'Столбцы задач'/.test(appSrc));
  check('раздел открывается по своему id', /section === 'admin-task-columns'\) renderAdminTaskColumns\(\)/.test(adminSrc));
  check('старая функция раздела удалена', run('typeof renderAdminAssignments') === 'undefined');
  check('модалка назначения из админки удалена', !/adminNewTaskModal/.test(appSrc) && !/adminNewTaskModal/.test(adminSrc));

  /* ================= 2. Назначение из главного меню «Задачи» ================= */
  check('администратор может назначать', run('canAssignTasks()') === true);
  asUser('lead');
  check('руководитель может назначать', run('canAssignTasks()') === true);
  asUser('manager');
  check('менеджер назначать не может', run('canAssignTasks()') === false);

  asUser('Admin');
  run('openTaskModal(tasks.find(t => t.id === 1))');
  check('в карточке задачи есть поле назначения', /Назначить исполнителю/.test(read('app.js')) &&
    el('taskAssignRow').style.display === '');
  check('в списке исполнителей есть коллеги', /Сидоров/.test(html('taskAssignTo')),
    html('taskAssignTo').slice(0, 80));

  el('taskId').value = '1';
  el('taskTitle').value = 'Задача в звонках';
  el('taskDescription').value = '';
  el('taskDeadline').value = '2026-10-05T10:00';
  el('taskPriority').value = 'medium';
  el('taskColumn').value = 'calls';
  el('taskKind').value = 'regular';
  el('taskLinkUrl').value = '';
  el('taskClientId').value = '';
  el('taskContactSelect').value = '';
  el('taskAssignTo').value = '3';
  run('taskCoAssignees = []');
  alert_clear();
  run('saveTask({ preventDefault: function(){} })');
  const assigned = run('tasks.find(t => t.id === 1)');
  check('задача назначена из главного меню', assigned.assignedTo === 3 && assigned.assignedBy === 1,
    'assignedTo=' + assigned.assignedTo);
  check('статус назначения — «Не принято»', assigned.assignmentStatus === 'pending');
  check('время назначения записано', !!assigned.assignedAt);
  check('исполнителю ушло уведомление',
    run('notifications').some(n => n.userId === 3 && /Назначена задача/.test(n.title)));

  // Исполнитель видит задачу в столбце «Назначенные задачи»
  asUser('manager2');
  check('исполнитель видит назначенную задачу', run('visibleTasks().some(t => t.id === 1)') === true);
  run('renderTasks()');
  check('на доске исполнителя есть столбец «Назначенные задачи»', /Назначенные задачи/.test(html('mainContent')));

  // Менеджер не видит поле назначения
  asUser('manager');
  run('openTaskModal(tasks.find(t => t.id === 1))');
  check('менеджеру поле назначения скрыто', el('taskAssignRow').style.display === 'none');

  // Снятие назначения
  asUser('Admin');
  run('openTaskModal(tasks.find(t => t.id === 1))');
  el('taskAssignTo').value = '';
  run('saveTask({ preventDefault: function(){} })');
  const unassigned = run('tasks.find(t => t.id === 1)');
  check('назначение снимается', !unassigned.assignedTo && !unassigned.assignmentStatus);

  /* ================= 3. Столбцы: глобальные ================= */
  const added = run('addTaskColumnScoped("global", null, "Отправлено КП", "#6366f1")');
  check('админ добавил глобальный столбец', added.ok === true &&
    run('globalTaskColumns().some(c => c.name === "Отправлено КП")') === true);
  check('дубликат названия отклонён',
    run('addTaskColumnScoped("global", null, "Отправлено КП")').ok === false);
  check('пустое название отклонено', run('addTaskColumnScoped("global", null, "   ")').ok === false);

  asUser('manager');
  check('глобальный столбец появился у менеджера',
    run('columnsForCurrentUser().some(c => c.name === "Отправлено КП")') === true);
  run('renderTasks()');
  check('столбец виден на доске менеджера', /Отправлено КП/.test(html('mainContent')));

  asUser('Admin');
  check('глобальный столбец виден и админу',
    run('columnsForCurrentUser().some(c => c.name === "Отправлено КП")') === true);

  /* ================= 4. Столбцы: индивидуальные ================= */
  const personal = run('addTaskColumnScoped("manager", 2, "Мои КП", "#0ea5e9")');
  check('админ добавил индивидуальный столбец менеджеру', personal.ok === true);
  check('столбец попал в набор менеджера 2',
    run('managerTaskColumns(2).some(c => c.name === "Мои КП")') === true);

  asUser('manager');
  check('свой индивидуальный столбец виден', run('columnsForCurrentUser().some(c => c.name === "Мои КП")') === true);
  asUser('manager2');
  check('чужой индивидуальный столбец не виден',
    run('columnsForCurrentUser().some(c => c.name === "Мои КП")') === false);
  run('renderTasks()');
  check('на доске чужого менеджера столбца нет', !/Мои КП/.test(html('mainContent')));

  /* ================= 5. Правка, порядок и удаление ================= */
  asUser('Admin');
  const callsId = run('globalTaskColumns().find(c => c.name === "Звонки").id');
  check('переименование столбца', run(`renameTaskColumn('${callsId}', 'Звонки клиентам', '#111827')`).ok === true &&
    run(`taskColumnById('${callsId}').name`) === 'Звонки клиентам');
  check('переименование в занятое имя отклонено',
    run(`renameTaskColumn('${callsId}', 'В работе')`).ok === false);
  check('бывший «обязательный» столбец теперь можно переименовать',
    run(`renameTaskColumn('in_progress', 'Работа', '#111827')`).ok === true &&
    run(`taskColumnById('in_progress').name`) === 'Работа');
  run(`renameTaskColumn('in_progress', 'В работе', '#f59e0b')`);

  const beforeOrder = run('globalTaskColumns().map(c => c.name)');
  run(`moveTaskColumn('${callsId}', -1)`);
  const afterOrder = run('globalTaskColumns().map(c => c.name)');
  check('порядок столбцов меняется', JSON.stringify(beforeOrder) !== JSON.stringify(afterOrder),
    beforeOrder.join(' → ') + ' | ' + afterOrder.join(' → '));
  const firstId = run('globalTaskColumns()[0].id');
  check('дальше первого столбца не сдвинуть', run(`moveTaskColumn('${firstId}', -1)`).ok === false);

  // Удаление столбца с задачами: задачи переезжают в первый оставшийся
  run(`activityToColumnMap['Звонок'] = '${callsId}'`);
  const deleted = run(`deleteTaskColumnScoped('${callsId}')`);
  check('столбец удалён', deleted.ok === true && run(`taskColumnById('${callsId}')`) === null);
  check('задачи переехали в первый оставшийся столбец', deleted.moved === 1 &&
    run('tasks.find(t => t.id === 1).status') === run('globalTaskColumns()[0].id'),
    'перенос: ' + deleted.moved + ' → ' + deleted.target);
  check('привязка на удалённый столбец снята', !run("activityToColumnMap['Звонок']"));
  check('бывший «обязательный» столбец теперь можно удалить', run("deleteTaskColumnScoped('completed')").ok === true);

  // Удаление индивидуального столбца менеджера
  const personalId = run('managerTaskColumns(2).find(c => c.name === "Мои КП").id');
  const delPersonal = run(`deleteTaskColumnScoped('${personalId}')`);
  check('индивидуальный столбец удаляется', delPersonal.ok === true &&
    run('managerTaskColumns(2).length') === 0);

  /* ================= 6. Экран администрирования ================= */
  run('renderAdminTaskColumns()');
  const screen = html('mainContent');
  check('раздел «Столбцы задач» показывает глобальные столбцы',
    /Глобальные столбцы/.test(screen) && /addGlobalColumnFromAdmin/.test(screen));
  check('раздел показывает индивидуальные столбцы менеджера',
    /Индивидуальные столбцы менеджера/.test(screen) && /setAdminColumnsManager/.test(screen));
  check('в разделе есть управление строками (сохранить, порядок, удалить)',
    /saveColumnFromAdmin/.test(screen) && /moveColumnFromAdmin/.test(screen) && /deleteColumnFromAdmin/.test(screen));
  check('в разделе есть привязка активностей', /Привязка активностей к столбцам/.test(screen));
  check('в привязке есть вариант «не привязывать»', /— не привязывать \(только комментарий\) —/.test(screen));
  check('в привязке перечислены типы активностей', /Звонок/.test(screen) && /Информация/.test(screen));

  /* ================= 7. Привязка активностей ================= */
  const infoIndex = run('interactionTypes.indexOf("Информация")');
  const callsIndex = run('interactionTypes.indexOf("Звонок")');
  const workId = run('globalTaskColumns()[0].id');

  run(`setActivityColumnFromAdmin(${callsIndex}, '${workId}')`);
  check('активность привязана к столбцу', run('activityToColumnMap["Звонок"]') === workId);
  run(`setActivityColumnFromAdmin(${infoIndex}, '')`);
  check('«ни к какому» сохраняется как отсутствие привязки',
    !run('activityToColumnMap["Информация"]') && run('activityColumnId("Информация")') === null);

  run('renderAdminTaskColumns()');
  check('раздел перерисован после привязки', /Привязка активностей/.test(html('mainContent')));

  // Доска стала только для чтения
  asUser('manager');
  run('renderTasks()');
  const board = html('mainContent');
  check('на доске нет кнопок управления столбцами',
    !/addTaskColumn/.test(board) && !/editTaskColumn/.test(board) && !/deleteTaskColumn/.test(board));
  check('на доске нет блока «Добавить столб»', !/Добавить столб/.test(board));

  console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки администрирования задач пройдены');
  process.exitCode = failures ? 1 : 0;
})().catch(err => {
  console.error('Ошибка теста: ' + err.message + '\n' + (err.stack || ''));
  process.exitCode = 1;
});

function alert_clear() { alerts.length = 0; }
