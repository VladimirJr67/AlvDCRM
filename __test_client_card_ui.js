/* Карточка клиента: поиск по ФИО, красные отметки, задачи по клиенту,
   кнопка «Перейти к клиенту» в уведомлениях, «крон» дедлайна и скролл
   раздела «Уведомления». */
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

// --- Заглушки браузерного окружения (classList хранит состояние) ---
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

function FakeNotification() {}
FakeNotification.permission = 'default';
FakeNotification.requestPermission = () => Promise.resolve('granted');

const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  alert: () => {}, confirm: () => true, prompt: () => null, Intl, URLSearchParams,
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  performance: { now: () => 0 },
  Notification: FakeNotification,
  TextDecoder, TextEncoder,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
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

run(`
  users = [
    { id: 1, login: 'Admin', password: 'Admin', role: 'admin', name: 'Администратор' },
    { id: 2, login: 'manager', password: 'm', role: 'manager', name: 'Иванов Иван' },
    { id: 3, login: 'manager2', password: 'm2', role: 'manager', name: 'Сидоров Сидор' }
  ];
  taskColumns = DEFAULT_COLUMNS.map((c, i) => Object.assign({}, c, { order: i }));
  clients = [
    { id: 10, orgName: 'Мой клиент', createdBy: 2, contacts: [{ id: 1, name: 'Пётр' }], history: [] }
  ];
  specialNotes = [
    { id: 1, clientId: 10, text: 'Важно', status: 'important', active: true },
    { id: 2, clientId: 10, text: 'Инфо', status: 'info', active: true }
  ];
  notifications = [];
  tasks = [
    { id: 1, title: 'Открытая', clientId: 10, ownerId: 2, status: 'in_progress', deadline: '' },
    { id: 2, title: 'Завершённая', clientId: 10, ownerId: 2, status: 'completed', deadline: '' },
    { id: 3, title: 'Выполненная назначенная', clientId: 10, ownerId: 2, assignedTo: 3, assignmentStatus: 'completed', status: 'in_progress', deadline: '' },
    { id: 4, title: 'Другая', clientId: 11, ownerId: 2, status: 'in_progress', deadline: '' }
  ];
`);
const as = login => run(`currentUser = users.find(u => u.login === '${login}')`);

console.log('\nКарточка клиента: поиск, отметки, задачи, уведомления');

/* ================= 1. Поиск по ФИО без логина ================= */
as('manager');
const opts = run('managerOptions("")');
const people = opts.filter(o => o.value !== 'mine' && o.value !== 'all');
check('люди в поиске менеджера — только ФИО',
  people.every(o => !o.hint && !/manager|Admin/i.test(o.label)),
  people.map(o => o.label + '|' + o.hint).join(', '));
run('renderManagerDropdown("")');
const dd = el('managerDropdown').innerHTML;
check('в выпадающем списке нет логинов', !/manager2|manager<\/span>|mo-hint">manager/i.test(dd));

/* ================= 2. Красные «Особые отметки» ================= */
as('manager');
run('updateClientNotesCount(clients[0])');
check('отметки есть: кнопка красная', el('notesBtn').classList.contains('notes-alert') === true);
check('счётчик отметок показан', String(el('notesCount').textContent) === '(2)');
run('specialNotes.forEach(n => n.active = false); updateClientNotesCount(clients[0])');
check('отметок нет: кнопка обычная', el('notesBtn').classList.contains('notes-alert') === false);
check('счётчик скрыт', String(el('notesCount').textContent) === '');

/* ================= 3. Задачи по клиенту ================= */
run('specialNotes.forEach(n => n.active = true)');
as('manager');
check('незакрытые задачи клиента считаются', run('clientOpenTasks(10).length') === 1,
  'задач: ' + run('clientOpenTasks(10).length'));
run('updateClientTasksCount(10)');
check('счётчик «Задачи по клиенту» показан', String(el('clientTasksCount').textContent) === '(1)');
run('openClientTasks(10)');
const tasksBody = el('clientTasksTableBody').innerHTML;
check('в списке только незакрытые задачи', /Открытая/.test(tasksBody) &&
  !/Завершённая/.test(tasksBody) && !/Выполненная назначенная/.test(tasksBody) && !/Другая/.test(tasksBody));
check('окно задач по клиенту открыто', el('clientTasksModal').classList.contains('active') === true);

/* ================= 4. «Крон» дедлайна (за 1 час) ================= */
as('manager');
// Дедлайн с временем задаём в местном времени — parseDeadline разбирает
// строку без зоны как локальную (так же, как поле ввода в форме задачи).
const localIsoMin = d => {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    'T' + p(d.getHours()) + ':' + p(d.getMinutes());
};
run(`
  notifications = [];
  const soon = "${localIsoMin(new Date(Date.now() + 30 * 60 * 1000))}";
  const far = "${localIsoMin(new Date(Date.now() + 3 * 60 * 60 * 1000))}";
  const past = "${localIsoMin(new Date(Date.now() - 10 * 60 * 1000))}";
  tasks = [
    { id: 1, title: 'Скоро', ownerId: 2, status: 'in_progress', deadline: soon },
    { id: 2, title: 'Далеко', ownerId: 2, status: 'in_progress', deadline: far },
    { id: 3, title: 'Просрочена', ownerId: 2, status: 'in_progress', deadline: past },
    { id: 4, title: 'Закрыта', ownerId: 2, status: 'completed', deadline: soon }
  ];
`);
const sent = run('checkTaskDeadlineReminders()');
check('уведомление за час до дедлайна', sent === 1 &&
  run('notifications').some(n => n.userId === 2 && /дедлайн/i.test(n.title) && n.taskId === 1),
  'отправлено: ' + sent);
check('повторный запуск не дублирует', run('checkTaskDeadlineReminders()') === 0);
check('отметка о напоминании сохранена', run('tasks.find(t => t.id === 1).deadlineNotifiedBy[2]') === run('tasks.find(t => t.id === 1).deadline'));

/* ================= 5. Кнопка «Перейти к клиенту» ================= */
as('manager');
run('notifications = []; notifyUser(2, "Запрос на перенос клиента", "просит передать клиента", null, { clientId: 10 })');
run('renderNotifications()');
const listHtml = el('mainContent').innerHTML;
check('в уведомлении есть кнопка «Перейти к клиенту»',
  /Перейти к клиенту/.test(listHtml) && /openNotificationClient\(/.test(listHtml));
run('openNotificationClient(notifications[0].id)');
check('карточка клиента открыта из уведомления', el('clientCardModal').classList.contains('active') === true);

/* ================= 6. Скролл раздела «Уведомления» ================= */
run('setActiveMenuState = setActiveMenuState');
as('manager');
el('mainContent').classList.remove('section-scroll');
run('renderSection("notifications")');
check('«Уведомления» получают скролл', el('mainContent').classList.contains('section-scroll') === true);
run('renderSection("clients")');
check('другие разделы скролл не получают', el('mainContent').classList.contains('section-scroll') === false);

console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки карточки клиента пройдены');
process.exitCode = failures ? 1 : 0;
