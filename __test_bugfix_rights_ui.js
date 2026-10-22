/* Багфиксы по результатам тестирования: права на доп. блоки карточки,
   дубли по времени, окно клиента поверх задачи, закрытие задачи, отслеживание,
   готовность штуки/КГ, F5 без мигания логина, аналитика с фильтром. */
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
  window: { addEventListener: () => {}, location: { protocol: 'http:', href: '', search: '' }, isSecureContext: true, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  navigator: { sendBeacon: () => true, userAgent: 'test', serviceWorker: { register: () => Promise.resolve({}) } },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), headers: { getSetCookie: () => [] } }),
  EventSource: function () { this.close = () => {}; },
  Image: function () {}, FormData: function () {}, XLSX: {}, FileReader: function () {}, AudioContext: function () {}
};
const context = vm.createContext(sandbox);
const html = fs.readFileSync('index.html', 'utf8');
const order = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]).filter(p => !/xlsx/.test(p));
order.forEach(p => vm.runInContext(fs.readFileSync(p, 'utf8'), context, { filename: p }));
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
  clients = [
    { id: 10, orgName: 'Чужой клиент', createdBy: 3, contacts: [], history: [] },
    { id: 11, orgName: 'Мой клиент', createdBy: 2, contacts: [], history: [] }
  ];
  currentUser = users[1];
  taskColumns = [{ id: 'a', name: 'В работе', order: 0 }, { id: 'b', name: 'Выполнено', order: 1 }];
  tasks = [];
  specialNotes = [];
  notifications = [];
`);

console.log('\nБагфиксы: права, задачи, отслеживание, готовность, аналитика');

/* ================= 1. Права: доп. блоки карточки клиента ================= */
check('владелец видит матрицы/задачи клиента', run('canViewClientExtras(clients[1])') === true);
check('чужому менеджеру доп. блоки недоступны', run('canViewClientExtras(clients[0])') === false);
as('Admin');
check('админ видит доп. блоки любого клиента', run('canViewClientExtras(clients[0])') === true);
as('lead');
check('руководитель видит доп. блоки любого клиента', run('canViewClientExtras(clients[0])') === true);
as('dev');
check('разработчик видит доп. блоки любого клиента', run('canViewClientExtras(clients[0])') === true);

as('manager');
run('selectedClientId = 10; renderClientContacts(10)');
check('кнопка «Матрицы клиента» заблокирована у чужого', el('matricesBtn').disabled === true);
check('кнопка «Задачи по клиенту» заблокирована у чужого', el('tasksBtn').disabled === true);
run('selectedClientId = 11; renderClientContacts(11)');
check('у своего клиента кнопки доступны', el('matricesBtn').disabled === false && el('tasksBtn').disabled === false);
alerts.length = 0;
run('openClientMatrices(10)');
run('openClientTasks(10)');
check('открытие окон чужого клиента блокируется', alerts.length === 2, alerts.join(' / '));

/* ================= 2. Дубли по времени (П.10, минуты) ================= */
as('manager');
run(`tasks = [{ id: 1, title: 'Занято', ownerId: 2, status: 'a', deadline: '2026-11-10T09:30', kind: 'regular', coAssignees: [] }]`);
check('занятое время находится с точностью до минуты', run('taskAtSameTime("2026-11-10T09:30")') !== null);
check('другая минута свободна', run('taskAtSameTime("2026-11-10T09:31")') === null);
run(`tasks[0].status = 'b'`);
check('закрытая задача время не занимает', run('taskAtSameTime("2026-11-10T09:30")') === null);

/* ================= 3. Карточка клиента поверх окна задачи (П.9) ================= */
check('клик по клиенту в задаче закрывает окно задачи',
  /closeModal\('taskModal'\);\s*openClientCard\(/.test(read('tasks.js')));

/* ================= 4. Период запоминает дату (П.23) ================= */
run('taskCalendarMode = "day"; taskCalendarAnchor = new Date("2026-10-05T12:00:00")');
run('saveTaskCalendarState()');
run('taskCalendarAnchor = new Date()');
run('loadTasks()');
check('при F5 восстанавливается конкретный день',
  run('taskCalendarAnchor').toISOString().slice(0, 10) === '2026-10-05' && run('taskCalendarMode') === 'day',
  String(run('taskCalendarAnchor')));

/* ================= 5. Закрытие задачи (П.7) ================= */
// В реальной базе столбцы называются «Выполнено» / «Закрытые задачи».
run(`taskColumns = [
  { id: 'a', name: 'В работе', order: 0 },
  { id: 'b', name: 'Выполнено', order: 1 },
  { id: 'c', name: 'Закрытые задачи', order: 2 }
]`);
check('завершающие столбцы находятся по именам',
  JSON.stringify(run('taskCompletedColumnIds()')) === '["b","c"]', JSON.stringify(run('taskCompletedColumnIds()')));
run(`taskColumns = [{ id: 'x', name: 'Новые', order: 0 }, { id: 'y', name: 'Финиш', order: 1 }]`);
check('запасной вариант — последний столбец', JSON.stringify(run('taskCompletedColumnIds()')) === '["y"]');
run(`taskColumns = [{ id: 'a', name: 'В работе', order: 0 }, { id: 'b', name: 'Выполнено', order: 1 }]`);

run(`tasks = [{ id: 1, title: 'Закрыть', ownerId: 2, status: 'a', kind: 'regular', coAssignees: [] }]`);
run('openTaskCloseConfirm(1)');
el('taskCloseConfirmComment').value = 'сделано';
run('confirmTaskClose()');
check('по подтверждению задача закрывается', run('tasks[0].status') === 'b' && run('tasks[0].closeComment') === 'сделано');

run(`tasks = [{ id: 2, title: 'Назначенная', ownerId: 1, assignedTo: 2, assignedBy: 1,
  assignmentStatus: 'pending', status: 'a', kind: 'regular', coAssignees: [], statusHistory: [] }]`);
run('openTaskCloseModal(2)');
el('taskCloseModalComment').value = 'готово';
run('submitTaskClose()');
check('назначенная задача тоже уходит в завершающий столбец',
  run('tasks[0].status') === 'b' && run('tasks[0].assignmentStatus') === 'completed');

/* ================= 6. Отслеживание (П.16) ================= */
as('manager');
check('менеджер не видит раздел отслеживания', run('isTaskTracker()') === false);
as('lead');
check('руководитель — отслеживающий', run('isTaskTracker()') === true);
as('Admin');
run(`tasks = [{ id: 1, ownerId: 3, assignedTo: 4, assignedBy: 1, status: 'a', kind: 'regular', coAssignees: [], createdAt: new Date().toISOString() }]`);
check('админу задачи не попадают в отслеживание автоматически', run('sharedTrackingTasks().length') === 0);
run('sendTaskToTracking(1)');
check('после «Отправить в отслеживание» задача появляется', run('sharedTrackingTasks().length') === 1);

/* ================= 7. F5 без мигания логина (П.6а) ================= */
const appSrc = read('app.js');
const htmlSrc = fs.readFileSync('index.html', 'utf8');
const cssSrc = fs.readFileSync('css/style.css', 'utf8');
check('форма входа скрывается до восстановления сессии',
  /hadLocalSession/.test(appSrc) && /loginScreen'\)\.style\.display = 'none'/.test(appSrc));
check('метка сессии ставится до отрисовки страницы',
  /has-session/.test(htmlSrc) && /alvid_crm_session/.test(htmlSrc));
check('с меткой сессии форма входа не показывается',
  /html\.has-session \.login-screen\s*\{\s*display:\s*none/.test(cssSrc));
check('при отсутствии сессии форма возвращается',
  /hadLocalSession\) \{[\s\S]{0,500}loginScreen'\)\.style\.display = 'flex'/.test(appSrc));
check('черновики форм клиента/контакта включены',
  /saveClientDraft|saveContactDraft/.test(appSrc) &&
  /function saveClientDraft|function saveContactDraft/.test(read('clients.js')));

/* ================= 8. Аналитика (П.25 / П.18) ================= */
as('Admin');
run(`
  tasks = [
    { id: 1, title: 'Моя задача Сидорова', ownerId: 3, status: 'a', kind: 'regular', coAssignees: [],
      createdAt: '2026-10-01T10:00:00.000Z', statusUpdatedAt: '2026-10-01T10:00:00.000Z', deadline: '' },
    { id: 2, title: 'Задача Иванова', ownerId: 2, status: 'a', kind: 'regular', coAssignees: [],
      createdAt: '2026-10-01T11:00:00.000Z', statusUpdatedAt: '2026-10-01T11:00:00.000Z', deadline: '' }
  ];
  adminAnalysisTab = 'stats';
  adminAnalysisDateFrom = '2026-10-01';
  adminAnalysisDateTo = '2026-10-01';
  adminManagerFilter = 'all';
  renderAdminAnalysis();
`);
const statsHtml = el('mainContent').innerHTML;
check('в срезе по менеджерам — русские имена', /manager-name[^>]*>Сидоров Сидор</.test(statsHtml));
check('в срезе не используется логин как имя', !/manager-name[^>]*>manager2</.test(statsHtml));
check('есть фильтр по менеджерам', /adminManagerFilter/.test(statsHtml) && /Все задачи/.test(statsHtml));

run('setAdminManagerFilter("3")');
const scopedHtml = el('mainContent').innerHTML;
check('цифры карточек пересчитываются под менеджера',
  /Всего задач \(Сидоров Сидор\)/.test(scopedHtml) && run('analysisManagerScoped(tasks.filter(t => inAnalysisRange(taskRangeDate(t)))).length') === 1);
run('resetAdminManagerFilter()');
check('«Все задачи» сбрасывает фильтр', run('adminManagerFilter') === 'all');

// Лента комментариев: тот же фильтр.
run(`
  clients[0].history = [{ date: '2026-10-01T10:00:00.000Z', type: 'Звонок', manager: 'manager2', comment: 'чужой', authorId: 3 }];
  clients[1].history = [{ date: '2026-10-01T11:00:00.000Z', type: 'Звонок', manager: 'manager', comment: 'мой', authorId: 2 }];
  adminManagerFilter = '3';
`);
const feed = run('commentsForRange()');
check('лента комментариев фильтруется по менеджеру',
  feed.length === 1 && feed[0].manager === 'manager2', JSON.stringify(feed.map(f => f.manager)));
run('adminManagerFilter = "all"');

// Список задач менеджера: период + фильтр клиента.
run(`
  tasks.push({ id: 3, title: 'Вне периода', ownerId: 3, status: 'a', kind: 'regular', coAssignees: [],
    clientId: 10, createdAt: '2020-01-01T10:00:00.000Z', statusUpdatedAt: '2020-01-01T10:00:00.000Z', deadline: '' });
  tasks[0].clientId = 10;
  tasks[1].clientId = 11;
`);
run('openAdminTaskList(3, null, { period: true })');
const modalHtml = el('adminTasksListContent').innerHTML;
check('в списке задач только за выбранный период', /Моя задача Сидорова/.test(modalHtml) && !/Вне периода/.test(modalHtml));
check('в окне задач есть фильтр по клиенту', /adminTaskListClientInput/.test(modalHtml));
run('setAdminTaskListClientFilter(10)');
const clientFiltered = el('adminTasksListContent').innerHTML;
check('фильтр по клиенту сужает список',
  /Моя задача Сидорова/.test(clientFiltered) && /Все клиенты/.test(clientFiltered));
run('resetAdminManagerFilter()');

console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки багфиксов пройдены');
process.exitCode = failures ? 1 : 0;
