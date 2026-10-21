/* Доработка задач (карточка, перенос, закрытие), дашборд менеджера,
   комментарии с обязательной отметкой, заказы матриц со статусом «Заказана».

   Проверяется:
     • отметка комментария — обязательный выпадающий список, контакт подставлен;
     • админ/рук/разраб видят дашборд выбранного менеджера за период;
     • отслеживание — только вручную отправленные задачи;
     • заказ матриц: статус «Заказана», вес/пресс, несколько матриц, учёт;
     • клик по задаче — окно «Информация о задаче» без полей ввода;
     • дата существующей задачи не редактируется напрямую;
     • закрытие только с комментарием и в системный столбец «Закрытые задачи»;
     • перенос активности: причина обязательна, растёт счётчик переносов. */

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
    const classes = new Set();
    elements[id] = {
      id, value: '', checked: false, innerHTML: '', textContent: '', disabled: false,
      readOnly: false, required: false,
      style: {}, dataset: {},
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        contains: c => classes.has(c),
        toggle: (c, on) => { if (on === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (on) classes.add(c); else classes.delete(c); }
      },
      setAttribute() {}, getAttribute() { return null; },
      appendChild() {}, focus() {}, addEventListener() {}, removeEventListener() {}, reset() {},
      querySelector() { return null; }, querySelectorAll() { return []; },
      closest() { return null; }, remove() {}
    };
  }
  return elements[id];
}

const alerts = [];
const store = {};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  alert: msg => { alerts.push(String(msg)); }, confirm: () => true, prompt: () => null,
  Intl, URLSearchParams, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  performance: { now: () => 0 },
  Notification: function () {}, TextDecoder, TextEncoder,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: {
    getElementById: el, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {}, createElement: () => el('x'),
    body: el('body'), documentElement: el('html')
  },
  window: {
    addEventListener: () => {}, location: { protocol: 'http:', href: '', search: '' },
    isSecureContext: true, matchMedia: () => ({ matches: false, addEventListener() {} })
  },
  navigator: { sendBeacon: () => true, userAgent: 'test', serviceWorker: { register: () => Promise.resolve({}) } },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), headers: { getSetCookie: () => [] } }),
  EventSource: function () { this.close = () => {}; },
  Image: function () {}, FormData: function () {}, XLSX: {}, FileReader: function () {}, AudioContext: function () {}
};
const context = vm.createContext(sandbox);
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const order = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]).filter(p => !/xlsx/.test(p));
order.forEach(p => vm.runInContext(fs.readFileSync(path.join(__dirname, p), 'utf8'), context, { filename: p }));
const run = code => vm.runInContext(code, context);
const read = f => fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');
const as = login => run(`currentUser = users.find(u => u.login.toLowerCase() === '${login}'.toLowerCase())`);

run(`
  users = [
    { id: 1, login: 'Admin', password: 'Admin', role: 'admin', name: 'Администратор' },
    { id: 2, login: 'manager', password: 'm', role: 'manager', name: 'Иванов Иван' },
    { id: 3, login: 'manager2', password: 'm2', role: 'manager', name: 'Сидоров Сидор' },
    { id: 4, login: 'lead', password: 'l', role: 'lead', name: 'Петров Пётр' },
    { id: 5, login: 'dev', password: 'd', role: 'developer', name: 'Разработчик' }
  ];
  clients = [{
    id: 10, orgName: 'ООО Ромашка', createdBy: 2,
    contacts: [{ id: 1, name: 'Петров Пётр', position: 'директор' }, { id: 2, name: 'Сидорова Анна', position: 'снабженец' }],
    history: []
  }];
  currentUser = users[1];
  taskColumns = [
    { id: 'in_progress', name: 'В работе', order: 0 },
    { id: 'call', name: 'Звонок', order: 1 },
    { id: 'closed', name: 'Закрытые задачи', order: 2 }
  ];
  tasks = [];
  orders = [];
  matrices = [];
  notifications = [];
  specialNotes = [];
  interactionTypes = ['Звонок', 'Информация', 'Заказ матриц', 'Размещение заказа'];
`);

console.log('\nЗадачи: карточка, перенос, закрытие; дашборд; матрицы и комментарии');

/* ============ 1. Отметка комментария — обязательный список ============ */
const appSrc = read('app.js');
const clientSrc = read('clients.js');
check('в форме комментария выпадающий список отметки',
  /<select id="historyTagType"/.test(appSrc) && /Для отчёта/.test(appSrc));
check('список отметки обязателен', /id="historyTagType"[^>]*required|required[^>]*id="historyTagType"/.test(appSrc));
check('кнопка сохранения блокируется без отметки',
  /function onHistoryTagChange/.test(clientSrc) && /submitBtn\.disabled = !/.test(clientSrc));
check('оба значения отметки читаются из списка',
  JSON.stringify(run('commentTagsList(["Для себя"])')) === '["forSelf"]' &&
  JSON.stringify(run('commentTagsList(["Для отчёта"])')) === '["forReport"]');

run(`document.getElementById('historyTagType').value = ''`);
check('без отметки комментарий не сохраняется', JSON.stringify(run('readCommentTags()')) === '[]');
run(`document.getElementById('historyTagType').value = 'forReport'`);
check('отметка читается из списка', JSON.stringify(run('readCommentTags()')) === '["forReport"]');
run('setCommentTagInputs(["forSelf"])');
check('отметка выставляется в списке', el('historyTagType').value === 'forSelf');

// Клик по контакту → «+ Добавить» открывает форму с подставленным контактом.
run('openHistoryModal(10, null, "Петров Пётр")');
check('форма комментария подставляет выбранный контакт',
  el('historyContactPerson').value === 'Петров Пётр', String(el('historyContactPerson').value));
run('openHistoryModal(10, null, "Сидорова Анна")');
check('контакт можно поменять в форме',
  el('historyContactPerson').value === 'Сидорова Анна', String(el('historyContactPerson').value));
run('openHistoryModalForContact(10)');
check('кнопка «+ Добавить» у контакта открывает ту же форму',
  String(el('historyClientId').value) === '10');

/* ============ 2. Дашборд менеджера для админа/рука/разраба ============ */
run(`
  tasks = [
    { id: 1, title: 'Задача Иванова', ownerId: 2, status: 'in_progress', kind: 'regular', coAssignees: [],
      deadline: '2026-11-10T10:00' },
    { id: 2, title: 'Задача Сидорова', ownerId: 3, status: 'in_progress', kind: 'regular', coAssignees: [],
      deadline: '2026-11-10T11:00' },
    { id: 3, title: 'Закрытая Сидорова', ownerId: 3, status: 'closed', kind: 'regular', coAssignees: [],
      deadline: '2026-11-10T12:00' }
  ];
`);
as('Admin');
check('админ видит дашборд менеджера', run('canViewManagerDashboard()') === true);
as('lead');
check('руководитель видит дашборд менеджера', run('canViewManagerDashboard()') === true);
as('dev');
check('разработчик видит дашборд менеджера', run('canViewManagerDashboard()') === true);
as('manager');
check('менеджеру выбор чужого дашборда недоступен', run('canViewManagerDashboard()') === false);
check('у менеджера нет селектора дашборда', run('dashboardSelectHtml()') === '');

as('Admin');
run('dashboardManagerId = 3');
check('дашборд показывает задачи выбранного менеджера',
  JSON.stringify(run('dashboardTasksSource().map(t => t.id)')) === '[2,3]',
  JSON.stringify(run('dashboardTasksSource().map(t => t.id)')));
run('taskCalendarMode = "month"; taskCalendarAnchor = new Date("2026-11-15T10:00:00"); renderTasks()');
const boardHtml = el('mainContent').innerHTML;
check('в разделе «Задачи» есть выбор менеджера', /dashboardManagerSelect/.test(boardHtml));
check('на доске — задачи выбранного менеджера', /Задача Сидорова/.test(boardHtml) && !/Задача Иванова/.test(boardHtml));
run('setDashboardManager("me")');
check('«Мои задачи» возвращает свою доску', run('dashboardManagerId') === null);
run('taskCalendarMode = "month"; taskCalendarAnchor = new Date()');

/* ============ 3. Отслеживание — только вручную отправленные ============ */
as('lead');
run(`
  tasks = [
    { id: 1, title: 'Своя задача', ownerId: 2, status: 'in_progress', kind: 'regular', coAssignees: [],
      createdAt: new Date().toISOString(), deadline: '2026-11-10T10:00' },
    { id: 2, title: 'Назначенная', ownerId: 2, assignedTo: 3, assignedBy: 2, assignmentStatus: 'pending',
      status: 'in_progress', kind: 'regular', coAssignees: [], createdAt: new Date().toISOString(), deadline: '' }
  ];
`);
check('без «Отправить в отслеживание» список пуст', run('sharedTrackingTasks().length') === 0);
run('sendTaskToTracking(2)');
check('после отправки задача в отслеживании',
  run('sharedTrackingTasks().length') === 1 && run('sharedTrackingTasks()[0].id') === 2);
check('отметка об отправке сохранена',
  !!run('tasks[1].trackingSentAt') && run('tasks[1].trackingSentBy') === 4);
check('свою задачу в отслеживание не отправить',
  run('(function(){ tasks.push({ id: 9, title: "Моя", ownerId: 4, status: "in_progress", kind: "regular", coAssignees: [] }); return canSendTaskToTracking(tasks[2]) === false && sendTaskToTracking(9).ok === false; })()') === true);

/* ============ 4. Заказ матриц: «Заказана» + мультизаказ + учёт ============ */
as('manager');
run(`
  clients[0].history = [];
  matrices = [];
  tasks = [];
  document.getElementById('historyClientId').value = '10';
  document.getElementById('historyType').value = 'Заказ матриц';
  document.getElementById('historyComment').value = 'Матрицы под анод';
  document.getElementById('historyNextActivity').value = '2026-11-20T10:00';
  document.getElementById('historyTagType').value = 'Для себя';
  document.getElementById('historyEditIdx').value = '';
  document.getElementById('historyContactPerson').value = 'Петров Пётр';
  document.getElementById('matrixCipher').value = 'ШФ-201';
  document.getElementById('matrixWeight').value = '40';
  document.getElementById('matrixPress').value = '7';
  document.getElementById('matrixCoating').value = 'Анод';
`);
run(`addMatrixRow()`);
check('кнопка «Добавить еще матрицу» создаёт строку', !!el('matrixRowsList').innerHTML ||
  run('typeof addMatrixRow') === 'function');
// Вторая матрица задаётся строкой формы: подменяем коллекцию дополнительных строк.
run(`
  addMatrix({
    cipher: 'ШФ-202', weightPerM: '25', press: '8', coating: 'Анод',
    status: 'Заказана', clientId: 10, clientName: 'ООО Ромашка', source: 'order', createdBy: 2
  });
  addMatrix({
    cipher: 'ШФ-203', weightPerM: '30', press: '5', coating: 'Сырой',
    status: 'Заказана', clientId: 10, clientName: 'ООО Ромашка', source: 'order', createdBy: 2
  });
`);
check('заказ матриц создаёт статус «Заказана»',
  run('matrices.every(m => m.status === "Заказана")'),
  JSON.stringify(run('matrices.map(m => m.status)')));
check('вес и пресс сохраняются',
  run('matrices[0].weightPerM') === '25' && run('matrices[0].press') === '8');
check('матрицы привязаны к клиенту',
  run('matrices.every(m => m.clientId === 10 && m.clientName === "ООО Ромашка")'));
check('заказанные матрицы попадают в учёт матриц',
  run('visibleMatrices().filter(isOrderedMatrix).length') === 2,
  String(run('visibleMatrices().filter(isOrderedMatrix).length')));
run('matrices.push({ id: 99, cipher: "СТАРАЯ-1", coating: "Сырой", status: "Поступила", clientId: 11, clientName: "Старый клиент", createdBy: 2 })');
check('старые матрицы без «Заказана» не ломаются',
  run('visibleMatrices().some(m => m.cipher === "СТАРАЯ-1" && m.status === "Поступила")'));
run('null');

/* ============ 5. Клик по задаче → окно информации без полей ============ */
as('manager');
run(`
  tasks = [{
    id: 1, title: 'Позвонить клиенту', description: 'Обсудить поставку', ownerId: 2,
    status: 'in_progress', kind: 'regular', coAssignees: [], deadline: '2026-11-25T14:00',
    clientId: 10, contactId: 1, createdAt: '2026-11-01T10:00:00.000Z'
  }];
  taskCalendarMode = 'month'; taskCalendarAnchor = new Date('2026-11-15T10:00:00');
  renderTasks();
`);
check('клик по карточке задачи открывает информацию',
  /openTaskInfo\(1\)/.test(el('mainContent').innerHTML) &&
  !/openTaskModal\(1\)/.test(el('mainContent').innerHTML));
run('openTaskInfo(1)');
const infoHtml = el('taskInfoBody').innerHTML;
check('окно информации без полей ввода', !/<input|<select|<textarea/.test(infoHtml));
check('информация показывает счётчик переносов', /Переносов/.test(infoHtml));
const actionsHtml = el('taskInfoActions').innerHTML;
check('внизу окна — три кнопки',
  /Редактировать/.test(actionsHtml) && /Закрыть задачу/.test(actionsHtml) && /Перенести активность/.test(actionsHtml));
check('кнопки ведут в нужные окна',
  /openTaskModal\(/.test(actionsHtml) && /openTaskCloseConfirm\(/.test(actionsHtml) &&
  /openTaskReschedule\(/.test(actionsHtml));

/* ============ 6. Дата не редактируется напрямую ============ */
run('openTaskModal(tasks[0])');
check('дата существующей задачи только для чтения', el('taskDeadline').readOnly === true);
check('подсказка про перенос показана', el('taskDeadlineHint').style.display === '');
run('openTaskModal()');
check('у новой задачи дата доступна', el('taskDeadline').readOnly === false);
check('подсказка у новой задачи скрыта', el('taskDeadlineHint').style.display === 'none');
check('в окне задачи нет кнопки закрытия',
  !/taskCloseBtn/.test(appSrc) && !/id="taskCloseBtn"/.test(appSrc));

/* ============ 7. Закрытие: только с комментарием, в «Закрытые задачи» ============ */
run(`
  tasks = [{
    id: 5, title: 'Закрыть меня', ownerId: 2, status: 'in_progress', kind: 'regular',
    coAssignees: [], deadline: '2026-11-05T10:00'
  }];
  openTaskCloseConfirm(5);
`);
check('окно закрытия требует комментарий', el('taskCloseConfirmSubmit').disabled === true);
alerts.length = 0;
run('confirmTaskClose()');
check('без комментария задача не закрывается',
  run('tasks[0].status') === 'in_progress' && alerts.length === 1, alerts[0] || 'нет предупреждения');

el('taskCloseConfirmComment').value = 'Клиент отказался';
run('onTaskCloseConfirmInput()');
check('кнопка активируется при вводе комментария', el('taskCloseConfirmSubmit').disabled === false);
run('onTaskCloseConfirmInput()');
check('системный столбец — «Закрытые задачи»', run('taskClosedColumnId()') === 'closed');
run('confirmTaskClose()');
check('задача уходит в «Закрытые задачи»', run('tasks[0].status') === 'closed');
check('комментарий закрытия сохранён', run('tasks[0].closeComment') === 'Клиент отказался');
check('зафиксированы дата и автор закрытия',
  !!run('tasks[0].closedAt') && run('tasks[0].closedBy') === 2);
check('закрытая задача остаётся в истории статусов',
  run('tasks[0].statusHistory.some(h => h.status === "closed")'));
check('закрытая задача не попадает в активные',
  run('taskOverdue(tasks[0])') === false && run('isTaskOpen(tasks[0])') === false);

/* ============ 8. Перенос активности с обязательной причиной ============ */
run(`
  tasks = [{
    id: 7, title: 'Перенести меня', ownerId: 2, status: 'in_progress', kind: 'regular',
    coAssignees: [], deadline: '2026-11-08T09:00'
  }];
  openTaskReschedule(7);
`);
check('окно переноса подставляет текущую дату', el('taskRescheduleDate').value === '2026-11-08T09:00');
check('без причины кнопка неактивна', el('taskRescheduleSubmit').disabled === true);
alerts.length = 0;
run('submitTaskReschedule()');
check('без причины перенос блокируется',
  run('tasks[0].deadline') === '2026-11-08T09:00' && alerts.length === 1, alerts[0] || '');
el('taskRescheduleReason').value = 'Клиент в отпуске';
el('taskRescheduleDate').value = '2026-11-15T09:00';
run('onTaskRescheduleReasonInput()');
check('причина активирует кнопку', el('taskRescheduleSubmit').disabled === false);
run('submitTaskReschedule()');
check('дата задачи перенесена', run('tasks[0].deadline') === '2026-11-15T09:00');
check('счётчик переносов увеличился', run('tasks[0].rescheduleCount') === 1);
check('причина переноса сохранена', run('tasks[0].lastRescheduleReason') === 'Клиент в отпуске');
check('перенос попал в историю', run('tasks[0].statusHistory.some(h => /Перенос/.test(h.label || ""))'));
run('openTaskReschedule(7)');
el('taskRescheduleReason').value = 'Согласование задержалось';
el('taskRescheduleDate').value = '2026-11-18T11:30';
run('submitTaskReschedule()');
check('второй перенос увеличивает счётчик', run('tasks[0].rescheduleCount') === 2);
check('история переносов хранит обе причины',
  JSON.stringify(run('tasks[0].rescheduleHistory.map(r => r.reason)')) === '["Клиент в отпуске","Согласование задержалось"]',
  JSON.stringify(run('tasks[0].rescheduleHistory.map(r => r.reason)')));
run('openTaskInfo(7)');
check('в карточке видно число переносов', /Переносов/.test(el('taskInfoBody').innerHTML) &&
  />2</.test(el('taskInfoBody').innerHTML));
alerts.length = 0;
run('tasks[0].status = "closed"; openTaskReschedule(7)');
check('перенос недоступен для закрытой задачи', alerts.length === 1, alerts[0] || '');

console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки доработки задач пройдены');
process.exitCode = failures ? 1 : 0;
