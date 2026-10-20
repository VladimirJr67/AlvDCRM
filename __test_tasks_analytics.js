/* Задачи: запрет дублей по времени, кликабельный клиент, запоминание периода,
   счётчик по периоду, закрытие с подтверждением, аналитика «Дней до задачи»
   и новое «Отслеживание» (только свои назначения + «В отслеживание»). */
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const pattern = new RegExp('<script src="(js/[^"]+)"', 'g');
const order = [...html.matchAll(pattern)].map(m => m[1]).filter(p => !/xlsx/.test(p));

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
}

// --- Заглушки браузерного окружения (localStorage и classList с состоянием) ---
const elements = {};
function el(id) {
  if (!elements[id]) {
    const classes = new Set();
    elements[id] = {
      id, value: '', checked: false, innerHTML: '', textContent: '', disabled: false,
      style: {}, dataset: {},
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        contains: c => classes.has(c),
        toggle: (c, on) => { if (on === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (on) classes.add(c); else classes.delete(c); }
      },
      setAttribute() {}, getAttribute() { return null; },
      appendChild() {}, focus() {}, addEventListener() {}, removeEventListener() {}, reset() {},
      querySelector() { return null; }, querySelectorAll() { return []; }
    };
  }
  return elements[id];
}
const store = {};
const alerts = [];
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
    isSecureContext: true,
    matchMedia: () => ({ matches: false, addEventListener() {} })
  },
  navigator: { sendBeacon: () => true, userAgent: 'test', serviceWorker: { register: () => Promise.resolve({}) } },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), headers: { getSetCookie: () => [] } }),
  EventSource: function () { this.close = () => {}; },
  Image: function () {}, FormData: function () {}, XLSX: {}, FileReader: function () {},
  AudioContext: function () {}
};
const context = vm.createContext(sandbox);
order.forEach(p => vm.runInContext(fs.readFileSync(p, 'utf8'), context, { filename: p }));
const run = code => vm.runInContext(code, context);
const as = login => run(`currentUser = users.find(u => u.login.toLowerCase() === '${login}'.toLowerCase())`);

const p2 = n => String(n).padStart(2, '0');
const local = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
const daysFromNow = n => { const d = new Date(); d.setHours(10, 0, 0, 0); d.setDate(d.getDate() + n); return local(d); };

console.log('\nЗадачи: дубли, период, счётчик, закрытие, аналитика, отслеживание');

/* ================= 1. Период запоминается (П.23) ================= */
run('setTaskCalendarMode("month")');
check('выбранный период сохранён', store['alvid_crm_task_calendar_mode'] === 'month');
run('taskCalendarMode = "week"');
run('loadTasks()');
check('при повторном входе открывается тот же период', run('taskCalendarMode') === 'month');
run('setTaskCalendarMode("week")');

/* ================= 2. Данные ================= */
run(`
  users = [
    { id: 1, login: 'Admin', password: 'Admin', role: 'admin', name: 'Администратор', trackedBy: [] },
    { id: 2, login: 'manager', password: 'm', role: 'manager', name: 'Иванов Иван', trackedBy: [] },
    { id: 3, login: 'manager2', password: 'm2', role: 'manager', name: 'Сидоров Сидор', trackedBy: [] },
    { id: 4, login: 'lead', password: 'l', role: 'lead', name: 'Петров Пётр', trackedBy: [] }
  ];
  taskColumns = [
    { id: 'in_progress', name: 'В работе', color: '#f59e0b', order: 0 },
    { id: 'completed', name: 'Завершены', color: '#10b981', order: 1 }
  ];
  clients = [{ id: 10, orgName: 'ООО Ромашка', createdBy: 2, contacts: [], history: [] }];
  notifications = [];
  trackingAssigneeFilter = ''; trackingStatusFilter = '';
`);

/* ================= 3. Дубли по времени (П.10) ================= */
as('manager');
const mkTask = (deadline, extra) => `
  tasks = [{ id: 1, title: 'Звонок', ownerId: 2, status: 'in_progress', deadline: ${JSON.stringify(deadline)},
    priority: 'medium', kind: 'regular', coAssignees: [], clientId: 10, createdAt: new Date().toISOString() }];
`;
run(mkTask(daysFromNow(0)));
const fillTaskForm = (deadline) => {
  el('taskId').value = '';
  el('taskTitle').value = 'Вторая задача';
  el('taskDeadline').value = deadline;
  el('taskPriority').value = 'medium';
  el('taskColumn').value = 'in_progress';
  el('taskKind').value = 'regular';
  el('taskLinkUrl').value = '';
  el('taskClientId').value = '10';
  el('taskContactSelect').value = '';
  run('taskCoAssignees = []');
  alerts.length = 0;
  run('saveTask({ preventDefault(){} })');
};
fillTaskForm(daysFromNow(0));
check('задача на занятое время не создаётся', run('tasks.length') === 1, 'задач: ' + run('tasks.length'));
check('показана подсказка про занятое время',
  alerts.some(a => /уже есть задача на это время/i.test(a)), alerts.join(' / '));
fillTaskForm(daysFromNow(0).replace('T10:', 'T11:'));
check('задача на другое время создаётся', run('tasks.length') === 2);

/* ================= 4. Клиент в карточке кликабелен (П.9) ================= */
const cardTask = run('tasks.find(t => t.clientId === 10)');
const cardHtml = run(`renderTaskCard(tasks.find(t => t.id === ${cardTask.id}), { id: 'in_progress', name: 'В работе', color: '#f59e0b' })`);
check('название клиента в карточке кликабельно', /openClientCard\(10\)/.test(cardHtml), cardHtml.slice(0, 0));

/* ================= 5. Счётчик за период (П.4) ================= */
as('manager');
run(`
  taskCalendarMode = 'week';
  taskCalendarAnchor = new Date();
  tasks = [
    { id: 1, title: 'В периоде', ownerId: 2, status: 'in_progress', deadline: ${JSON.stringify(daysFromNow(0))}, kind: 'regular', coAssignees: [] },
    { id: 2, title: 'Вне периода', ownerId: 2, status: 'in_progress', deadline: ${JSON.stringify(daysFromNow(20))}, kind: 'regular', coAssignees: [] },
    { id: 3, title: 'Без срока', ownerId: 2, status: 'in_progress', deadline: '', kind: 'regular', coAssignees: [] }
  ];
`);
run('updateTasksMenuBadge()');
const badge = el('tasksMenuBadge').innerHTML;
check('счётчик меню считает только задачи периода', /menu-badge-count[^>]*>1</.test(badge), badge);

/* ================= 6. Закрытие с подтверждением (П.7) ================= */
run('tasks.push({ id: 4, title: "Обычная", ownerId: 2, status: "in_progress", deadline: "", kind: "regular", coAssignees: [] })');
run('openTaskCloseConfirm(4)');
check('открылась модалка закрытия', el('taskCloseConfirmModal').classList.contains('active') === true);
el('taskCloseConfirmComment').value = 'сделано';
run('confirmTaskClose()');
check('задача закрыта', run('tasks.find(t => t.id === 4).status') === 'completed');
check('комментарий закрытия сохранён', run('tasks.find(t => t.id === 4).closeComment') === 'сделано');

// Задачу-ссылку без галочки закрыть нельзя
run('tasks.push({ id: 5, title: "Ссылка", ownerId: 2, status: "in_progress", deadline: "", kind: "link", linkWorkedOff: false, coAssignees: [] })');
alerts.length = 0;
run('openTaskCloseConfirm(5)');
check('задача-ссылка без галочки не закрывается', alerts.length > 0 &&
  run('tasks.find(t => t.id === 5).status') === 'in_progress');

/* ================= 7. Аналитика: «Дней до задачи» (П.25) ================= */
as('Admin');
run(`
  tasks = [
    { id: 1, title: 'Просрочена', ownerId: 3, status: 'in_progress', deadline: ${JSON.stringify(daysFromNow(-2))}, kind: 'regular', coAssignees: [] },
    { id: 2, title: 'Скоро', ownerId: 3, status: 'in_progress', deadline: ${JSON.stringify(daysFromNow(2))}, kind: 'regular', coAssignees: [] },
    { id: 3, title: 'Далеко', ownerId: 3, status: 'in_progress', deadline: ${JSON.stringify(daysFromNow(10))}, kind: 'regular', coAssignees: [] }
  ];
`);
const daysLeft = run('tasks.map(t => taskDaysLeft(t))');
check('«Дней до задачи» считается верно', JSON.stringify(daysLeft) === '[-2,2,10]', JSON.stringify(daysLeft));
check('просрочено — красная заливка', /#fee2e2/.test(run('taskDaysCellHtml(tasks.find(t => t.id === 1))')));
check('1-2 дня — жёлтая заливка', /#fef9c3/.test(run('taskDaysCellHtml(tasks.find(t => t.id === 2))')));
check('больше — зелёная заливка', /#dcfce7/.test(run('taskDaysCellHtml(tasks.find(t => t.id === 3))')));

run('openAdminOverdueTasks()');
check('по «Просрочено» открывается список', el('adminTasksModalTitle').textContent === 'Просроченные задачи' &&
  /Просрочена/.test(el('adminTasksListContent').innerHTML) &&
  !/Скоро/.test(el('adminTasksListContent').innerHTML));
check('в списке есть столбец «Дней до задачи»', /Дней до задачи/.test(el('adminTasksListContent').innerHTML));

/* ================= 8. Отслеживание по новой логике (П.16) ================= */
as('Admin');
check('админ отправляет задачу менеджера в отслеживание', run('sendTaskToTracking(1)').ok === true &&
  run('tasks.find(t => t.id === 1).trackingBy').indexOf(1) > -1);
check('задача попала в моё отслеживание', run('sharedTrackingTasks().some(t => t && t.id === 1)') === true);
check('повторно отправить нельзя', run('sendTaskToTracking(1)').ok === false);
run('renderTracking()');
check('раздел отслеживания показывает задачу', /Просрочена/.test(el('mainContent').innerHTML));
check('кнопки «Взять на отслеживание» больше нет', !/Взять на отслеживание/.test(el('mainContent').innerHTML));
check('менеджер не может отправить в отслеживание', (() => {
  as('manager');
  return run('sendTaskToTracking(1)').ok === false;
})());

console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки задач (дубли, период, аналитика) пройдены');
process.exitCode = failures ? 1 : 0;
