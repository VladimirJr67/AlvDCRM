/* ============================================================
   __test_tasks_calendar.js — проверка доски задач.

   Модули выполняются в vm с заглушкой DOM: вызываются настоящие функции
   js/tasks.js и js/reminders.js.

   Критерий:
     календарь задач с пластами по периоду (день/неделя/месяц) и количеством;
     отслеживание задач руководителем работает (прогресс сотрудника);
     задача-ссылка «Отработка ссылки» закрывается только после галочки;
     прокрутка доски стрелками плавная (кадры requestAnimationFrame).

   Запуск:  node __test_tasks_calendar.js
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
}

/* ===== Заглушки DOM, анимации и времени ===== */
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

// Доска: объект с scrollLeft и колонкой известной ширины.
const board = {
  scrollLeft: 0,
  style: {},
  children: [],
  querySelector: () => ({ getBoundingClientRect: () => ({ width: 268 }) }),
  getBoundingClientRect: () => ({ left: 0, right: 1000, width: 1000 }),
  addEventListener() {},
  querySelectorAll: () => []
};

// Кадры анимации считаем вручную, а время — управляемое.
let now = 1000;
const frames = [];
function requestAnimationFrame(cb) { frames.push(cb); return frames.length; }
function cancelAnimationFrame() {}
function runFrames(maxFrames) {
  let runs = 0;
  while (frames.length && runs < (maxFrames || 500)) {
    const cb = frames.shift();
    now += 16;                       // каждый кадр — примерно 16 мс
    cb(now);
    runs++;
  }
  return runs;
}

// Тост напоминания: собираем «элемент» так, чтобы можно было нажать кнопки.
function makeToastElement() {
  const buttons = {};
  return {
    className: '', style: {}, innerHTML: '', parentNode: null,
    querySelector(sel) {
      if (!buttons[sel]) buttons[sel] = { onclick: null };
      return buttons[sel];
    },
    remove() { this.parentNode = null; },
    __buttons: buttons
  };
}
let lastCreatedElement = null;

const alerts = [];
const store = {};
const toastHost = el('toastHost');

const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  alert: msg => { alerts.push(String(msg)); },
  confirm: () => true,
  prompt: () => null,
  Intl, Date, Math, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat,
  requestAnimationFrame, cancelAnimationFrame,
  performance: { now: () => now },
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: {
    getElementById: el,
    querySelector: sel => (sel === '.task-board' ? board : null),
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => (lastCreatedElement = makeToastElement()),
    body: el('body'),
    documentElement: el('html')
  },
  window: { addEventListener: () => {}, location: { protocol: 'http:' }, isSecureContext: true },
  navigator: { sendBeacon: () => true },
  queueServerSave: () => {},
  apiAvailable: () => true,
  updateUserInfo: () => {}
};
sandbox.goToSection = () => { sandbox.goToSection.calls = (sandbox.goToSection.calls || 0) + 1; };
sandbox.showNativeNotification = () => false;
sandbox.playNotifySound = () => {};

const context = vm.createContext(sandbox);
const read = f => fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');
['data.js', 'storage.js', 'users.js', 'interactionTypes.js', 'dictionaries.js', 'profile.js',
 'notifications.js', 'geo.js', 'reminders.js', 'tasks.js', 'orders.js', 'matrices.js', 'clients.js']
  .forEach(f => vm.runInContext(read(f), context, { filename: f }));

const run = code => vm.runInContext(code, context);
const html = id => el(id).innerHTML;

run(`
  currentSection = 'tasks';
  users = [
    { id: 1, login: 'Admin', password: 'Admin', role: 'admin', name: 'Администратор', trackedBy: [] },
    { id: 2, login: 'manager', password: 'm', role: 'manager', name: 'Иванов Иван', position: 'менеджер по продажам', trackedBy: [] },
    { id: 3, login: 'manager2', password: 'm2', role: 'manager', name: 'Сидоров Сидор', position: 'менеджер по продажам', trackedBy: [] },
    { id: 4, login: 'lead', password: 'l', role: 'lead', name: 'Петров Пётр', position: 'руководитель', trackedBy: [] }
  ];
  clients = [];
  taskColumns = [
    { id: 'in_progress', name: 'В работе', color: '#f59e0b', order: 0, locked: true },
    { id: 'completed', name: 'Завершены', color: '#10b981', order: 1, locked: true }
  ];
  tasks = [
    { id: 1, title: 'Звонок Ромашке', deadline: '2026-10-07T09:30', status: 'in_progress', ownerId: 2, trackingBy: [], kind: 'regular', order: 0 },
    { id: 2, title: 'Встреча с Васильком', deadline: '2026-10-07T14:00', status: 'in_progress', ownerId: 2, trackingBy: [], kind: 'regular', order: 1 },
    { id: 3, title: 'КП отправлено', deadline: '2026-10-06T10:00', status: 'completed', ownerId: 2, trackingBy: [], kind: 'regular', order: 0, completedAt: '2026-10-06T12:00:00.000Z' },
    { id: 4, title: 'Задача коллеги', deadline: '2026-10-20T10:00', status: 'in_progress', ownerId: 3, trackingBy: [], kind: 'regular', order: 0 },
    { id: 5, title: 'Просроченный звонок', deadline: '2026-09-10T10:00', status: 'in_progress', ownerId: 2, trackingBy: [], kind: 'regular', order: 2 }
  ];
  taskCalendarAnchor = new Date('2026-10-07T12:00:00');
  taskCalendarMode = 'week';
  taskCalendarPick = null;
  currentUser = users.find(u => u.login === 'manager');
`);
function asUser(login) {
  run(`currentUser = users.find(u => u.login === '${login}')`);
}

(async () => {
  console.log('\nЗадачи: календарь пластами, отслеживание, задача-ссылка, плавный скролл');

  /* ================= 1. Календарь с пластами ================= */
  check('режимы календаря: день/неделя/месяц',
    JSON.stringify(run('TASK_CALENDAR_MODES.map(m => m.id)')) === JSON.stringify(['day', 'week', 'month']));

  check('неделя: 7 пластов', run('taskCalendarMode = "week"; taskCalendarBands().length') === 7);
  check('день: 24 пласта', run('taskCalendarMode = "day"; taskCalendarBands().length') === 24);
  check('месяц: пластов по числу дней', run('taskCalendarMode = "month"; taskCalendarBands().length') === 31,
    'октябрь 2026: ' + run('taskCalendarBands().length'));

  run('taskCalendarMode = "week"');
  const weekCounts = run('taskCalendarBandsWithCounts().map(b => b.count)');
  check('количество задач по пластам недели', JSON.stringify(weekCounts) === JSON.stringify([0, 1, 2, 0, 0, 0, 0]),
    'счётчики: ' + JSON.stringify(weekCounts));
  const monthBands = run('taskCalendarMode = "month"; taskCalendarBandsWithCounts()');
  const day7 = monthBands.find(b => b.label === '7');
  const day6 = monthBands.find(b => b.label === '6');
  check('в месяце 7 октября — 2 задачи', !!day7 && day7.count === 2, day7 ? 'задач: ' + day7.count : 'пласт не найден');
  check('в месяце 6 октября — 1 задача', !!day6 && day6.count === 1);

  run('taskCalendarMode = "week"; taskCalendarPick = null');
  check('сумма по пластам недели совпадает с задачами периода',
    run('taskCalendarBandsWithCounts().reduce((s,b) => s + b.count, 0)') === 3);

  // Клик по пласту фильтрует доску
  run("pickTaskCalendarBand('w2')");
  const picked = run('taskCalendarFilter(visibleTasks()).map(t => t.title)');
  check('клик по пласту оставляет задачи этого дня', picked.length === 2 && /Звонок/.test(picked.join(' ')),
    picked.join(', '));
  check('выбранный период подписан', run('taskCalendarPick.label').length > 0, run('taskCalendarPick.label'));
  run('clearTaskCalendarPick()');
  check('снятие фильтра возвращает все задачи', run('taskCalendarFilter(visibleTasks()).length') === 4,
    'видимых задач: ' + run('taskCalendarFilter(visibleTasks()).length'));

  // Навигация по периодам
  run('shiftTaskCalendar(-1)');
  check('переход на предыдущую неделю', run('taskCalendarLabel(taskCalendarMode, taskCalendarAnchor)') === '28.09 — 04.10',
    run('taskCalendarLabel(taskCalendarMode, taskCalendarAnchor)'));
  run('shiftTaskCalendar(1); setTaskCalendarMode("month")');
  check('переключение режима сбрасывает фильтр и подпись', run('taskCalendarMode') === 'month' &&
    run('taskCalendarPick') === null && /октябрь 2026/.test(run('taskCalendarLabel("month", taskCalendarAnchor)')));
  run('shiftTaskCalendar(1)');
  check('переход на следующий месяц', /ноябрь 2026/.test(run('taskCalendarLabel("month", taskCalendarAnchor)')));
  run('taskCalendarToday()');
  check('кнопка «Сегодня» возвращает текущий период',
    run('taskCalendarLabel("day", taskCalendarAnchor)') ===
    new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }));

  run('taskCalendarMode = "week"; taskCalendarAnchor = new Date("2026-10-07T12:00:00")');
  run('renderTasks()');
  check('доска рисует ленту пластов', /task-calendar-band/.test(html('mainContent')) &&
    /Всего|задач в периоде/.test(html('mainContent')));
  check('в ленте видны счётчики', /task-calendar-count/.test(html('mainContent')));

  /* ================= 2. Отслеживание руководителем ================= */
  asUser('lead');
  check('руководитель — отслеживающий', run('isTaskTracker()') === true);
  asUser('manager');
  check('менеджер не отслеживает', run('isTaskTracker()') === false);
  run('renderTracking()');
  check('менеджеру раздел отслеживания закрыт', /Доступ запрещён/.test(html('mainContent')));
  check('менеджер не может взять сотрудника на отслеживание', run('startTrackingUser(3)').ok === false);

  asUser('lead');
  const started = run('startTrackingUser(2)');
  check('руководитель взял сотрудника на отслеживание', started.ok === true, JSON.stringify(started));
  check('сотрудник отмечен в профиле', JSON.stringify(run('users.find(u => u.id === 2).trackedBy')) === '[4]');
  check('взяты все текущие задачи сотрудника',
    run('tasks.filter(t => t.ownerId === 2).every(t => t.trackingBy.indexOf(4) > -1)') === true);
  check('чужие задачи не затронуты', run('tasks.find(t => t.id === 4).trackingBy.length') === 0);
  check('список отслеживаемых сотрудников', JSON.stringify(run('trackedUsers().map(u => u.id)')) === '[2]');

  // Новые задачи сотрудника получают наблюдателя автоматически
  run(`addAutoTask({ title: 'Новая задача сотрудника', status: 'in_progress', ownerId: 2 })`);
  const autoTask = run('tasks[tasks.length - 1]');
  check('новая задача сотрудника сразу с наблюдателем',
    autoTask.trackingBy.indexOf(4) > -1, 'trackingBy=' + JSON.stringify(autoTask.trackingBy));

  // Прогресс
  const progress = run('userTaskProgress(2)');
  check('прогресс: всего задач', progress.total === 5, 'всего: ' + progress.total);
  check('прогресс: завершено и в работе', progress.done === 1 && progress.active === 4,
    'выполнено ' + progress.done + ', в работе ' + progress.active);
  check('прогресс: просрочено', progress.overdue === 1, 'просрочено: ' + progress.overdue);
  check('прогресс: процент выполнения', progress.percent === 20, 'процент: ' + progress.percent);
  check('прогресс: разбивка по столбцам', progress.byColumn.length === 2 &&
    progress.byColumn[0].name === 'В работе' && progress.byColumn[0].count === 4,
    JSON.stringify(progress.byColumn.map(c => c.name + ':' + c.count)));

  run('renderTracking()');
  check('раздел показывает прогресс сотрудника', /Иванов Иван/.test(html('mainContent')) &&
    /выполнено 1 из 5/.test(html('mainContent')) && /Просрочено/.test(html('mainContent')));

  const stopped = run('stopTrackingUser(2)');
  check('отслеживание снимается', stopped.ok === true &&
    JSON.stringify(run('users.find(u => u.id === 2).trackedBy')) === '[]');
  check('наблюдатели убраны из задач',
    run('tasks.every(t => t.trackingBy.indexOf(4) === -1)') === true);

  /* ================= 3. Задача-ссылка «Отработка ссылки» ================= */
  asUser('manager');
  check('виды задач объявлены', JSON.stringify(run('TASK_KINDS.map(k => k.value)')) === JSON.stringify(['regular', 'link']));

  // Создание задачи-ссылки через форму
  el('taskId').value = '';
  el('taskTitle').value = 'Отработать ссылку на тендер';
  el('taskDescription').value = '';
  el('taskDeadline').value = '2026-10-15T12:00';
  el('taskPriority').value = 'medium';
  el('taskColumn').value = 'in_progress';
  el('taskKind').value = 'link';
  el('taskLinkUrl').value = 'https://zakupki.example/ tender';
  el('taskClientId').value = '';
  el('taskContactSelect').value = '';
  run('taskCoAssignees = []');
  alerts.length = 0;
  run('saveTask({ preventDefault: function(){} })');
  const linkTask = run('tasks[tasks.length - 1]');
  check('задача-ссылка создана', linkTask.kind === 'link' && /тендер/.test(linkTask.title),
    'вид: ' + linkTask.kind);
  check('ссылка сохранена', linkTask.linkUrl === 'https://zakupki.example/ tender');
  check('схема ссылки дополняется при открытии',
    run('normalizeTaskLink("zakupki.example/x")') === 'https://zakupki.example/x');
  check('галочка изначально снята', linkTask.linkWorkedOff === false);

  // Закрытие без галочки запрещено
  const blocked = run(`setTaskStatus(tasks.find(t => t.id === ${linkTask.id}), 'completed')`);
  check('перевод в «Завершены» без галочки запрещён', blocked.ok === false, blocked.error || '');
  check('статус задачи не изменился', run(`tasks.find(t => t.id === ${linkTask.id}).status`) === 'in_progress');

  // Перетаскивание в завершающий столбец тоже отклоняется
  run(`window.__dropEvent = {
    preventDefault: function(){},
    currentTarget: { style: {} },
    dataTransfer: { getData: function(){ return '${linkTask.id}'; } }
  };`);
  run('draggedColumnId = null');
  alerts.length = 0;
  run("handleDrop(window.__dropEvent, 'completed')");
  check('перетаскивание в «Завершены» без галочки отклонено', alerts.length === 1 &&
    run(`tasks.find(t => t.id === ${linkTask.id}).status`) === 'in_progress',
    alerts[0] ? alerts[0].split('\n')[0] : 'нет предупреждения');
  check('сохранение в завершающем столбце через форму запрещено', (() => {
    el('taskId').value = String(linkTask.id);
    el('taskColumn').value = 'completed';
    el('taskKind').value = 'link';
    alerts.length = 0;
    run('saveTask({ preventDefault: function(){} })');
    return alerts.length === 1 && run(`tasks.find(t => t.id === ${linkTask.id}).status`) === 'in_progress';
  })(), alerts[0] ? alerts[0].split('\n')[0] : 'нет предупреждения');

  // Галочка открывает закрытие
  const toggled = run(`toggleLinkWorkedOff(${linkTask.id})`);
  check('галочка «Ссылка отработана» ставится', toggled.ok === true && toggled.linkWorkedOff === true);
  check('время отметки сохранено', !!run(`tasks.find(t => t.id === ${linkTask.id}).linkWorkedOffAt`));
  const allowed = run(`setTaskStatus(tasks.find(t => t.id === ${linkTask.id}), 'completed')`);
  check('после галочки задача закрывается', allowed.ok === true &&
    run(`tasks.find(t => t.id === ${linkTask.id}).status`) === 'completed');

  // Обычные задачи закрываются как раньше
  const regular = run('tasks.find(t => t.kind !== "link")');
  check('обычная задача закрывается без галочки',
    run(`setTaskStatus(tasks.find(t => t.id === ${regular.id}), 'completed')`).ok === true);

  run('renderTasks()');
  check('на карточке есть галочка отработки', /Ссылка отработана/.test(html('mainContent')));

  /* ================= 4. Плавный скролл стрелками ================= */
  const tasksSrc = read('tasks.js');
  check('прокрутка доски больше не через scrollBy',
    !/scrollBy\(\{/.test(tasksSrc) && /requestAnimationFrame\(frame\)/.test(tasksSrc));
  check('шаг прокрутки считает ширину колонки', /function boardStepWidth/.test(tasksSrc));

  board.scrollLeft = 0;
  frames.length = 0;
  now = 1000;
  run('scrollTaskBoard(1)');
  check('клик по стрелке запускает кадры, а не мгновенный сдвиг', frames.length > 0 && board.scrollLeft === 0);
  const totalFrames = runFrames(200);
  check('сдвиг происходит кадрами от 0 до ширины колонки', totalFrames > 5 && Math.round(board.scrollLeft) === 280,
    'кадров: ' + totalFrames + ', scrollLeft: ' + Math.round(board.scrollLeft));

  board.scrollLeft = 1000;
  frames.length = 0;
  now = 1000;
  run('scrollTaskBoard(-1)');
  runFrames(200);
  check('стрелка влево прокручивает назад', Math.round(board.scrollLeft) === 720, String(Math.round(board.scrollLeft)));

  // Разгон при удержании: шаг растёт со временем
  run('arrowDirection = 1; arrowStartedAt = 0');
  board.scrollLeft = 0;
  now = 0;
  run('arrowScrollFrame()');
  const firstStep = board.scrollLeft;
  frames.length = 0;
  now = 600;
  board.scrollLeft = 0;
  run('arrowScrollFrame()');
  const fastStep = board.scrollLeft;
  check('при удержании скорость растёт', fastStep > firstStep,
    'первый шаг ' + firstStep + ', после разгона ' + fastStep);

  const css = fs.readFileSync(path.join(__dirname, 'css', 'style.css'), 'utf8');
  check('стрелки по центру рабочей зоны', /\.board-scroll-btn\s*\{[^}]*top:\s*50%/.test(css) &&
    /translateY\(-50%\)/.test(css));
  check('центр учитывает полосу прокрутки', /\.board-scroll-btn\s*\{\s*top:\s*calc\(50% - 5px\)/.test(css));

  /* ================= 5. Попап напоминания ================= */
  run('reminders = [{ id: 1, title: "Позвонить", description: "обсудить", date: todayISO(), time: "00:00", color: "#f59e0b", scope: "self", clientId: null, completed: false, createdBy: 2, notifiedAt: null }]');
  let completeCalls = 0;
  run('toggleReminderComplete = function(){ __testCompleteCalls = (__testCompleteCalls || 0) + 1; };');
  run('showReminderPopup(reminders[0])');

  const popup = lastCreatedElement;
  const reminderSrc = read('reminders.js');
  check('в попапе кнопка «Закрыть»', /toast-close-action">Закрыть/.test(reminderSrc));
  check('кнопки «Выполнено» в попапе больше нет', !/toast-done/.test(reminderSrc));

  // Нажатие кнопки закрывает попап, но не отмечает напоминание выполненным
  const hostChildren = [];
  popup.parentNode = { removeChild() {} };
  popup.__buttons['.toast-close-action'].onclick();
  check('кнопка закрывает попап', popup.parentNode === null);
  check('напоминание остаётся невыполненным',
    run('reminders[0].completed') === false &&
    run('typeof __testCompleteCalls === "number" ? __testCompleteCalls : 0') === 0);
  check('отметка «выполнено» доступна в разделе', run('typeof toggleReminderComplete') === 'function');

  console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки доски задач пройдены');
  process.exitCode = failures ? 1 : 0;
})().catch(err => {
  console.error('Ошибка теста: ' + err.message + '\n' + (err.stack || ''));
  process.exitCode = 1;
});
