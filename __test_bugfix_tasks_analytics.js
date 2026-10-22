/* Багфиксы: закрытие/карточка задачи, счётчик в меню, «Сегодня» и F5,
   отслеживание только по кнопке, ФИО и цифры в Анализе, мигание логина.

   Проверяется:
     • карточка «Информация о задаче» — без лишних полей и без крестика;
     • «Добавить следующую активность» создаёт задачу и закрывает текущую;
     • «Нерентабельный клиент» закрывает без следующей активности;
     • счётчик «просрочено» в меню уменьшается сразу при закрытии;
     • «Сегодня» открывает текущую неделю с выделенным днём, F5 помнит дату;
     • в «Отслеживании» нет колонки «Статус» и нет автоматических задач;
     • лента комментариев показывает ФИО, цифры Анализа сходятся со списком;
     • форма входа не мигает при F5 с валидной сессией. */

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
        add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
        toggle: (c, on) => { if (on === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (on) classes.add(c); else classes.delete(c); }
      },
      setAttribute() {}, getAttribute() { return null; },
      appendChild() {}, focus() {}, addEventListener() {}, removeEventListener() {}, reset() {},
      querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }, remove() {}
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
const htmlSrc = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const order = [...htmlSrc.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]).filter(p => !/xlsx/.test(p));
order.forEach(p => vm.runInContext(fs.readFileSync(path.join(__dirname, p), 'utf8'), context, { filename: p }));
const run = code => vm.runInContext(code, context);
const readSrc = f => fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');
const as = login => run(`currentUser = users.find(u => u.login.toLowerCase() === '${login}'.toLowerCase())`);

const today = new Date();
const pad = n => String(n).padStart(2, '0');
const todayISO = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
const todayDeadline = todayISO + 'T10:00';

run(`
  users = [
    { id: 1, login: 'Admin', password: 'Admin', role: 'admin', name: 'Администратор' },
    { id: 2, login: 'manager', password: 'm', role: 'manager', name: 'Иванов Иван' },
    { id: 3, login: 'Kurikov', password: 'k', role: 'manager', name: 'Владимир Куриков' },
    { id: 4, login: 'lead', password: 'l', role: 'lead', name: 'Петров Пётр' }
  ];
  clients = [{
    id: 10, orgName: 'ООО Ромашка', createdBy: 2,
    contacts: [{ id: 1, name: 'Петров Пётр', position: 'директор' }], history: []
  }];
  currentUser = users[1];
  taskColumns = [
    { id: 'in_progress', name: 'В работе', order: 0 },
    { id: 'call', name: 'Звонок', order: 1 },
    { id: 'closed', name: 'Закрытые задачи', order: 2 }
  ];
  activityToColumnMap = { 'Звонок': 'call' };
  interactionTypes = ['Звонок', 'Информация', 'Нерентабелен'];
  tasks = [];
  orders = [];
  matrices = [];
  notifications = [];
  specialNotes = [];
`);

console.log('\nБагфиксы: карточка задачи, счётчик, календарь, отслеживание, Анализ, логин');

/* ============ 1. Карточка «Информация о задаче» ============ */
run(`
  tasks = [{
    id: 1, title: 'Позвонить в Ромашку', description: 'Обсудить поставку',
    ownerId: 2, status: 'in_progress', kind: 'regular', coAssignees: [],
    priority: 'high', deadline: '${todayDeadline}', clientId: 10, contactId: 1,
    createdAt: '2026-01-01T10:00:00.000Z'
  }];
  openTaskInfo(1);
`);
const infoHtml = el('taskInfoBody').innerHTML;
check('в карточке нет строки «Приоритет»', !/Приоритет/.test(infoHtml));
check('в карточке нет строки «Колонка»', !/>Колонка</.test(infoHtml));
check('в карточке нет строки «Вид задачи»', !/Вид задачи/.test(infoHtml));
check('в карточке нет строки «Исполнитель»', !/>Исполнитель</.test(infoHtml));
check('в карточке нет строки «Комментарий к закрытию»', !/Комментарий к закрытию/.test(infoHtml));
check('комментарий задачи вынесен в блок', /task-info-block/.test(infoHtml) && /Обсудить поставку/.test(infoHtml));
check('клиент вынесен в отдельный блок', /task-info-client/.test(infoHtml) && /ООО Ромашка/.test(infoHtml));

const appSrc = readSrc('app.js');
check('у окна информации нет крестика закрытия',
  !/id="taskInfoModal"[\s\S]{0,400}modal-close-icon/.test(appSrc));
check('кнопка закрытия открывает окно с комментарием',
  /Закрыть задачу<\/button>`/.test(readSrc('tasks.js')) &&
  /onclick="confirmTaskClose\(\)"/.test(appSrc));

/* ============ 2. «Добавить следующую активность» ============ */
run(`
  tasks = [{
    id: 2, title: 'Звонок по оплате', description: 'Договорились о встрече',
    ownerId: 2, status: 'in_progress', kind: 'regular', coAssignees: [],
    deadline: '${todayDeadline}', clientId: 10, contactId: 1
  }];
  clients[0].history = [];
  openTaskNextActivity(2);
`);
check('окно следующей активности открылось', el('taskNextActivityModal').classList.contains('active') === true);
check('типы задач подставлены из справочника', /Звонок/.test(el('taskNextActivityType').innerHTML));
check('без даты/комментария кнопка неактивна', el('taskNextActivitySubmit').disabled === true);
el('taskNextActivityType').value = 'Звонок';
el('taskNextActivityComment').value = 'Клиент готов к встрече';
el('taskNextActivityDate').value = todayISO + 'T15:00';
run('onTaskNextActivityInput()');
check('с датой и комментарием кнопка активна', el('taskNextActivitySubmit').disabled === false);
run('submitTaskNextActivity()');
check('текущая задача закрыта', run('tasks.find(t => t.id === 2).status') === 'closed');
check('комментарий закрытия сохранён', run('tasks.find(t => t.id === 2).closeComment') === 'Клиент готов к встрече');
const created = run('tasks.find(t => t.id !== 2)');
check('создана следующая задача', !!created && created.status === 'call' && created.deadline === todayISO + 'T15:00',
  created ? created.status + ' / ' + created.deadline : 'нет задачи');
check('новая задача привязана к клиенту', !!created && created.clientId === 10);
check('ссылка на следующую задачу записана', run('tasks.find(t => t.id === 2).nextTaskId') === (created ? created.id : -1));
const hist = run('clients[0].history[0]');
check('комментарий ушёл в отчёт по комментариям', !!hist && hist.comment === 'Клиент готов к встрече' &&
  JSON.stringify(hist.tags) === '["forReport"]');
check('в истории указан тип и клиент', !!hist && hist.type === 'Звонок');

/* ============ 3. «Нерентабельный клиент» ============ */
run(`
  tasks.push({ id: 3, title: 'Согласовать счёт', ownerId: 2, status: 'in_progress', kind: 'regular',
    coAssignees: [], deadline: '${todayDeadline}', clientId: 10 });
  clients[0].history = [];
  openTaskCloseConfirm(3, 'noprofit');
`);
check('заголовок окна — про нерентабельного', /Нерентабельный клиент/.test(el('taskCloseConfirmHeading').textContent));
check('кнопка подписана «Нерентабельный клиент»', /Нерентабельный клиент/.test(el('taskCloseConfirmSubmit').textContent));
el('taskCloseConfirmComment').value = 'Работаем в минус, отказались';
const tasksBefore = run('tasks.length');
run('confirmTaskClose()');
check('задача закрыта без следующей активности',
  run('tasks.find(t => t.id === 3).status') === 'closed' && run('tasks.length') === tasksBefore);
check('отметка «нерентабельный» поставлена', run('tasks.find(t => t.id === 3).closeKind') === 'noprofit');
const noprofitHist = run('clients[0].history[0]');
check('комментарий нерентабельности в отчёте', !!noprofitHist && noprofitHist.type === 'Нерентабелен' &&
  noprofitHist.comment === 'Работаем в минус, отказались');

/* ============ 4. Счётчик в меню уменьшается при закрытии ============ */
run(`
  taskCalendarMode = 'week';
  taskCalendarAnchor = new Date();
  taskCalendarPick = null;
  tasks = [
    { id: 11, title: 'Просроченная', ownerId: 2, status: 'in_progress', kind: 'regular', coAssignees: [], deadline: '2020-01-05T10:00' },
    { id: 12, title: 'Сегодня', ownerId: 2, status: 'in_progress', kind: 'regular', coAssignees: [], deadline: '${todayDeadline}' }
  ];
  updateTasksMenuBadge();
`);
const overdueBefore = run('visibleTasks().filter(t => !isTaskCompleted(t)).filter(taskOverdue).length');
const badgeBefore = el('tasksMenuBadge').innerHTML;
check('счётчик показывает всю просрочку', new RegExp('menu-badge-overdue[^>]*>' + overdueBefore + '<').test(badgeBefore), badgeBefore);
run(`openTaskCloseConfirm(11); document.getElementById('taskCloseConfirmComment').value = 'закрыто'; confirmTaskClose();`);
const overdueAfter = run('visibleTasks().filter(t => !isTaskCompleted(t)).filter(taskOverdue).length');
const badgeAfter = el('tasksMenuBadge').innerHTML;
check('после закрытия просрочка уменьшилась сразу',
  overdueAfter === overdueBefore - 1 && new RegExp('menu-badge-overdue[^>]*>' + overdueAfter + '<').test(badgeAfter), badgeAfter);

/* ============ 5. «Сегодня» и сохранение даты при F5 ============ */
run(`
  taskCalendarMode = 'month';
  taskCalendarAnchor = new Date('2025-03-10T12:00:00');
  taskCalendarPick = null;
  tasks = [
    { id: 21, title: 'Сегодняшняя', ownerId: 2, status: 'in_progress', kind: 'regular', coAssignees: [], deadline: '${todayDeadline}' }
  ];
  taskCalendarToday();
`);
check('«Сегодня» переключает на неделю', run('taskCalendarMode') === 'week');
check('«Сегодня» ставит текущую дату',
  run('taskCalendarAnchor').toDateString() === new Date().toDateString());
const boardHtml = el('mainContent').innerHTML;
check('сегодняшний день выделен в ленте', /task-calendar-band[^"]*is-today/.test(boardHtml));
check('на доске видна задача на сегодня', /Сегодняшняя/.test(boardHtml));

// Выбор дня и «перезагрузка страницы».
run(`pickTaskCalendarBand('w0')`);
const pickedKey = run('taskCalendarPick && taskCalendarPick.key');
const savedMode = store['alvid_crm_task_calendar_mode'];
const savedAnchor = store['alvid_crm_task_calendar_anchor'];
const savedPick = store['alvid_crm_task_calendar_pick'];
check('выбор дня сохранён', !!savedPick && !!pickedKey, String(savedPick));
run(`taskCalendarMode = 'week'; taskCalendarAnchor = new Date('2024-01-01T00:00:00'); taskCalendarPick = null;`);
run('loadTasks()');
check('после F5 восстанавливается режим', run('taskCalendarMode') === savedMode);
check('после F5 восстанавливается дата',
  run('taskCalendarAnchor').toISOString().slice(0, 10) === new Date(savedAnchor).toISOString().slice(0, 10),
  String(run('taskCalendarAnchor')));
check('после F5 восстанавливается выбранный день',
  run('taskCalendarPick && taskCalendarPick.key') === pickedKey,
  String(run('taskCalendarPick && taskCalendarPick.key')));

/* ============ 6. Отслеживание: только по кнопке, без колонки «Статус» ============ */
as('lead');
run(`
  tasks = [
    { id: 31, title: 'Задача менеджера', ownerId: 2, status: 'in_progress', kind: 'regular', coAssignees: [],
      createdAt: new Date().toISOString(), deadline: '${todayDeadline}', trackingBy: [4] },
    { id: 32, title: 'Другая задача', ownerId: 2, status: 'in_progress', kind: 'regular', coAssignees: [],
      createdAt: new Date().toISOString(), deadline: '${todayDeadline}' }
  ];
  trackingAssigneeFilter = '';
  renderTracking();
`);
check('автоматически добавленная задача в отслеживание не попадает',
  run('sharedTrackingTasks().length') === 0);
const trackingHtml = el('mainContent').innerHTML;
check('в таблице нет колонки «Статус»', !/<th>Статус<\/th>/.test(trackingHtml), '');
check('в таблице есть «Исполнитель» и «Дедлайн»', /<th>Исполнитель<\/th>/.test(trackingHtml) && /<th>Дедлайн<\/th>/.test(trackingHtml));
run('sendTaskToTracking(32)');
check('кнопка добавляет задачу в отслеживание',
  run('sharedTrackingTasks().length') === 1 && run('sharedTrackingTasks()[0].id') === 32);
run('renderTracking()');
check('задача видна в разделе', /Другая задача/.test(el('mainContent').innerHTML));

// Кнопка на дашборде выбранного менеджера.
as('Admin');
run(`
  dashboardManagerId = 2;
  taskCalendarMode = 'month';
  taskCalendarAnchor = new Date();
  taskCalendarPick = null;
  tasks = [{ id: 41, title: 'Задача менеджера Иванова', ownerId: 2, status: 'in_progress', kind: 'regular',
    coAssignees: [], deadline: '${todayDeadline}' }];
  renderTasks();
`);
check('на дашборде менеджера есть кнопка отслеживания',
  /Отправить в отслеживание/.test(el('mainContent').innerHTML));
run('setDashboardManager("me")');

/* ============ 7. Анализ: ФИО и сходящиеся цифры ============ */
as('Admin');
run(`
  tasks = [
    { id: 51, title: 'Задача Курикова', ownerId: 3, status: 'in_progress', kind: 'regular', coAssignees: [],
      deadline: '${todayDeadline}', statusUpdatedAt: '2020-01-01T10:00:00.000Z' },
    { id: 52, title: 'Просроченная Курикова', ownerId: 3, status: 'in_progress', kind: 'regular', coAssignees: [],
      deadline: '2020-01-02T10:00' },
    { id: 53, title: 'Задача Иванова', ownerId: 2, status: 'in_progress', kind: 'regular', coAssignees: [],
      deadline: '${todayDeadline}' }
  ];
  clients[0].history = [{ date: new Date().toISOString(), type: 'Звонок', manager: 'Kurikov', authorId: 3,
    comment: 'Позвонил, обсудили', tags: ['forReport'] }];
  adminAnalysisTab = 'stats';
  adminAnalysisDateFrom = '${todayISO}';
  adminAnalysisDateTo = '${todayISO}';
  adminManagerFilter = 'all';
  renderAdminAnalysis();
`);
const statsHtml = el('mainContent').innerHTML;
check('цифры считаются по сроку задачи (как на доске)',
  run('analysisManagerScoped(tasks.filter(taskInAnalysisPeriod)).length') === 2,
  String(run('tasks.filter(taskInAnalysisPeriod).length')));
check('карточка «Всего задач» кликабельна', /openAdminTaskList\([^)]*period: true/.test(statsHtml) &&
  /Всего задач/.test(statsHtml));
const totalShown = run('analysisManagerScoped(tasks.filter(taskInAnalysisPeriod)).length');
run(`openAdminTaskList(null, null, { period: true })`);
const listRows = (el('adminTasksListContent').innerHTML.match(/<tr style="cursor:default;"/g) || []).length;
check('список по «Всего задач» совпадает с цифрой', listRows === totalShown, 'строк: ' + listRows + ', цифра: ' + totalShown);

run('adminManagerFilter = "3"; renderAdminAnalysis()');
const scopedTotal = run('analysisManagerScoped(tasks.filter(taskInAnalysisPeriod)).length');
run(`openAdminTaskList(3, null, { period: true })`);
const scopedRows = (el('adminTasksListContent').innerHTML.match(/<tr style="cursor:default;"/g) || []).length;
check('фильтр по менеджеру совпадает со списком', scopedRows === scopedTotal,
  'строк: ' + scopedRows + ', цифра: ' + scopedTotal);

run('openAdminOverdueTasks()');
const overdueRows = (el('adminTasksListContent').innerHTML.match(/<tr style="cursor:default;"/g) || []).length;
const overdueShown = run('tasks.filter(taskInAnalysisPeriod).filter(t => taskMatchesManager(t, 3)).filter(t => taskOverdue(t)).length');
check('список «Просрочено» соответствует цифре', overdueRows === overdueShown,
  'строк: ' + overdueRows + ', цифра: ' + overdueShown);
run('adminManagerFilter = "all"');

const feed = run('commentsForRange()');
check('в ленте комментариев ФИО вместо логина',
  feed.length === 1 && feed[0].managerName === 'Владимир Куриков', feed.length ? feed[0].managerName : 'пусто');
run('adminAnalysisTab = "comments"; renderAdminAnalysis()');
check('в таблице ленты выводится ФИО', /Владимир Куриков/.test(el('mainContent').innerHTML) &&
  !/>Kurikov</.test(el('mainContent').innerHTML));

console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки багфиксов пройдены');
process.exitCode = failures ? 1 : 0;
