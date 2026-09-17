/* ============================================================
   __test_activities.js — проверка логики активностей без браузера.

   Модули приложения выполняются в vm с заглушкой DOM: вызываются настоящие
   функции (js/clients.js, js/tasks.js, js/orders.js), а не их копии.

   Проверяется критерий:
     активность → задача в привязанном столбце;
     встреча → отдельная задача коллеге и уведомление;
     заказ матриц → записи matrices[] + комментарий в отчёт;
     закрытие активности только со следующей датой (кроме «Нерентабелен»).

   Запуск:  node __test_activities.js
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
}

/* ===== Заглушка DOM ===== */
const elements = {};
function el(id) {
  if (!elements[id]) {
    elements[id] = {
      id: id,
      value: '',
      checked: false,
      innerHTML: '',
      textContent: '',
      style: {},
      dataset: {},
      classList: { add() {}, remove() {}, contains() { return false; } },
      appendChild() {},
      focus() {},
      addEventListener() {},
      reset() {}
    };
  }
  return elements[id];
}
function resetElements(ids) {
  ids.forEach(id => {
    const e = el(id);
    e.value = '';
    e.checked = false;
  });
}

const alerts = [];
const store = {};

/* ===== Контекст модулей ===== */
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  alert: msg => { alerts.push(String(msg)); },
  confirm: () => true,
  prompt: () => null,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: {
    getElementById: el,
    querySelector: () => null,
    addEventListener: () => {},
    createElement: () => el('__created'),
    querySelectorAll: () => []
  },
  window: { addEventListener: () => {}, location: { protocol: 'http:' } },
  navigator: { sendBeacon: () => true },
  // Сохранение на сервер в тесте не нужно: проверяем состояние в памяти.
  queueServerSave: () => {},
  apiAvailable: () => true
};

const context = vm.createContext(sandbox);
const read = f => fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');
['data.js', 'storage.js', 'users.js', 'interactionTypes.js', 'dictionaries.js',
 'profile.js', 'notifications.js', 'tasks.js', 'orders.js', 'matrices.js', 'clients.js'].forEach(f => {
  vm.runInContext(read(f), context, { filename: f });
});

const run = code => vm.runInContext(code, context);

/* ===== Исходные данные ===== */
run(`
  users = [
    { id: 1, login: 'Admin', password: 'Admin', role: 'admin', name: 'Администратор', position: '' },
    { id: 2, login: 'manager', password: 'qwer1234', role: 'manager', name: 'Иванов Иван', position: 'менеджер по продажам' },
    { id: 3, login: 'lead', password: 'lead', role: 'lead', name: 'Петров Пётр', position: 'руководитель' }
  ];
  currentUser = users[1];
  interactionTypes = ['Звонок', 'Информация', 'Встреча', 'Письмо', 'Размещение заказа', 'Отправил КП', 'Заказ матриц', 'Нерентабелен'];
  clients = [{ id: 1, orgName: 'ООО Ромашка', orgInn: '402509882511', contacts: [], history: [] }];
  taskColumns = [];
  activityToColumnMap = {};
  tasks = [];
  orders = [];
  matrices = [];
  notifications = [];
`);

// Заполнить поля модалки комментария для одного сценария.
function fillCommentModal(opts) {
  resetElements(['historyType', 'historyComment', 'historyNextActivity', 'historyEditIdx',
    'historyContactPerson', 'historyTagSelf', 'historyTagReport', 'historyColleague',
    'matrixCiphers', 'matrixCoating', 'orderCondition', 'orderKg', 'orderCost']);
  el('historyClientId').value = '1';
  el('historyType').value = opts.type;
  el('historyComment').value = opts.comment || '';
  el('historyNextActivity').value = opts.next || '';
  el('historyEditIdx').value = '';
  if (opts.colleague) el('historyColleague').value = String(opts.colleague);
  if (opts.ciphers) el('matrixCiphers').value = opts.ciphers;
  if (opts.coating) el('matrixCoating').value = opts.coating;
  if (opts.kg) el('orderKg').value = String(opts.kg);
  if (opts.cost) el('orderCost').value = String(opts.cost);
  if (opts.condition) el('orderCondition').value = opts.condition;
  if (opts.forReport) el('historyTagReport').checked = true;
}

function saveComment(opts) {
  fillCommentModal(opts);
  alerts.length = 0;
  run('saveHistory({ preventDefault: function(){}, target: null })');
}

const entry = idx => run(`clients[0].history[${idx}]`);
const taskList = () => run('tasks');

(async () => {
  console.log('\nЛогика активностей: активность → задача в столбце, встреча → коллеге, матрицы → matrices[]');

  /* ---- 0. Привязки: админ создаёт столбцы и связи (кнопка в админке) ---- */
  const report = run('applyRecommendedActivityBindings()');
  check('созданы столбцы для активностей', report.columns.length === 5, report.columns.join(', '));
  check('назначены 5 привязок', report.bindings.length === 5, report.bindings.join(' | '));
  check('карта привязок заполнена', Object.keys(run('activityToColumnMap')).length === 5,
    JSON.stringify(run('activityToColumnMap')));
  check('«Информация» не привязана', run("activityColumnId('Информация')") === null);

  /* ---- 1. Форма открывается и подставляет элементы ---- */
  let openFailed = null;
  try { run('openHistoryModal(1)'); } catch (e) { openFailed = e.message; }
  check('окно комментария открывается', openFailed === null, openFailed || '');
  check('поле следующей активности очищено', el('historyNextActivity').value === '');

  /* ---- 2. Активность без следующей даты не закрывается ---- */
  saveComment({ type: 'Звонок', comment: 'Позвонил, обсудили поставку' });
  check('«Звонок» без даты: сохранение заблокировано', run('clients[0].history.length') === 0 &&
    alerts.length === 1, alerts[0] ? alerts[0].split('\n')[0] : 'нет предупреждения');
  check('«Звонок» без даты: задача не создана', taskList().length === 0);

  /* ---- 3. Звонок с датой → задача в «Звонки» ---- */
  saveComment({ type: 'Звонок', comment: 'Позвонил, обсудили поставку', next: '2026-10-01T10:30' });
  let e0 = entry(0);
  let callsColumn = run("taskColumnByName('Звонки').id");
  check('«Звонок» сохранён в комментариях', run('clients[0].history.length') === 1);
  check('активность закрыта', !!e0.closedAt && e0.nextActivityAt === '2026-10-01T10:30',
    'closedAt=' + (e0.closedAt ? 'да' : 'нет'));
  check('в записи указан столбец активности', e0.columnId === callsColumn);
  check('создана задача в столбце «Звонки»', taskList().length === 1 && taskList()[0].status === callsColumn,
    taskList()[0] ? taskList()[0].status : 'задач нет');
  check('срок задачи = дата следующей активности', taskList()[0].deadline === '2026-10-01T10:30');
  check('задача привязана к клиенту и автору', taskList()[0].clientId === 1 && taskList()[0].ownerId === 2);
  check('заголовок задачи понятный', /Звонок/.test(taskList()[0].title) && /Ромашка/.test(taskList()[0].title),
    taskList()[0].title);
  check('комментарий ссылается на задачу', e0.taskId === taskList()[0].id);

  /* ---- 4. «Отправил КП» → «Отправлено КП» ---- */
  saveComment({ type: 'Отправил КП', comment: 'Отправил КП на анод', next: '2026-10-05T09:00' });
  const kpColumn = run("taskColumnByName('Отправлено КП').id");
  check('«Отправил КП» → задача в «Отправлено КП»',
    taskList().length === 2 && taskList()[1].status === kpColumn, taskList()[1] ? taskList()[1].status : 'нет');

  /* ---- 5. Встреча + коллега → отдельная задача коллеге ---- */
  saveComment({ type: 'Встреча', comment: 'Встреча в офисе клиента', next: '2026-10-07T14:00', colleague: 3 });
  const meetingColumn = run("taskColumnByName('Встреча').id");
  const afterMeeting = taskList();
  const mine = afterMeeting[2];
  const colleague = afterMeeting[3];
  check('встреча: задача автору в столбце «Встреча»', !!mine && mine.status === meetingColumn && mine.ownerId === 2);
  check('встреча: отдельная задача коллеге', !!colleague && colleague.status === meetingColumn && colleague.ownerId === 3,
    colleague ? 'ownerId=' + colleague.ownerId : 'нет задачи');
  check('встреча: задачи связаны colleagueId', !!mine && !!colleague &&
    mine.colleagueId === 3 && colleague.colleagueId === 2);
  check('встреча: срок задачи коллеге совпадает', !!colleague && colleague.deadline === '2026-10-07T14:00');
  const notes = run('notifications');
  check('встреча: коллеге отправлено уведомление', notes.some(n => n.userId === 3 && /Встреча/.test(n.title)),
    notes.length + ' уведомлений');
  check('встреча: задача в записи комментария', !!entry(2).taskId);

  /* ---- 6. Заказ матриц → matrices[] + задача + комментарий в отчёт ---- */
  saveComment({
    type: 'Заказ матриц', comment: 'Нужны матрицы под анод',
    next: '2026-10-10T11:00', ciphers: 'ШФ-101, ШФ-102', coating: 'Анод'
  });
  const matrixRecords = run('matrices');
  const matrixColumn = run("taskColumnByName('Заказы/Матрицы').id");
  const matrixTask = taskList().find(t => t.status === matrixColumn);
  check('матрицы: две записи по шифрам', matrixRecords.length === 2 &&
    matrixRecords[0].cipher === 'ШФ-101' && matrixRecords[1].cipher === 'ШФ-102',
    matrixRecords.map(m => m.cipher).join(', '));
  check('матрицы: статус «Поступила» и покрытие', matrixRecords.every(m => m.status === 'Поступила' && m.coating === 'Анод'));
  check('матрицы: привязаны к клиенту и автору', matrixRecords.every(m => m.clientId === 1 && m.createdBy === 2));
  check('матрицы: задача в «Заказы/Матрицы»', !!matrixTask, matrixTask ? matrixTask.title : 'нет');
  check('матрицы: шифры в заголовке задачи', !!matrixTask && /ШФ-101/.test(matrixTask.title), matrixTask && matrixTask.title);
  const matrixEntry = entry(3);
  check('матрицы: комментарий уходит в отчёт', matrixEntry.tags.indexOf('forReport') > -1,
    JSON.stringify(matrixEntry.tags));

  /* ---- 7. Размещение заказа → «Заказы» + запись заказа + комментарий ---- */
  saveComment({
    type: 'Размещение заказа', comment: 'Заказ на сырой',
    next: '2026-10-12T12:00', kg: 1200, cost: 780000, condition: 'Сырой'
  });
  const ordersColumn = run("taskColumnByName('Заказы').id");
  const orderTask = taskList().find(t => t.status === ordersColumn);
  const orderRecords = run('orders');
  check('заказ: запись в «Заказах» создана', orderRecords.length === 1 && orderRecords[0].kg === 1200,
    orderRecords[0] ? 'кг=' + orderRecords[0].kg + ', цена/кг=' + orderRecords[0].avgPrice : 'нет записи');
  check('заказ: задача в столбце «Заказы»', !!orderTask, orderTask ? orderTask.title : 'нет');
  const orderEntry = entry(4);
  check('заказ: комментарий остаётся в комментариях', !!orderEntry && /Заказ на сырой/.test(orderEntry.comment));
  check('заказ: параметры заказа сохранены в записи', !!orderEntry.order && orderEntry.order.cost === 780000);

  /* ---- 8. «Информация» не привязана → только комментарий ---- */
  const beforeInfo = taskList().length;
  saveComment({ type: 'Информация', comment: 'Клиент сменил директора', next: '2026-10-15T09:00' });
  check('«Информация»: задача не создаётся', taskList().length === beforeInfo, 'задач было ' + beforeInfo);
  check('«Информация»: комментарий сохранён', run('clients[0].history.length') === 6);
  check('«Информация»: активность закрыта датой', !!entry(5).closedAt && entry(5).columnId === null);

  /* ---- 9. «Нерентабелен» — исключение: закрывается без даты ---- */
  const beforeNoProfit = taskList().length;
  saveComment({ type: 'Нерентабелен', comment: 'Работаем ниже себестоимости, отказались' });
  const noProfit = entry(6);
  check('«Нерентабелен»: сохраняется без следующей даты', run('clients[0].history.length') === 7 &&
    alerts.length === 0, alerts[0] || '');
  check('«Нерентабелен»: активность закрыта', !!noProfit.closedAt && noProfit.nextActivityAt === null);
  check('«Нерентабелен»: задача не создаётся', taskList().length === beforeNoProfit);

  /* ---- 10. Отметка в «Особых отметках» подчиняется тем же правилам ---- */
  resetElements(['noteType', 'noteText', 'noteNextActivity', 'noteEditIdx', 'noteTagSelf', 'noteTagReport']);
  el('notesClientId').value = '1';
  el('noteType').value = 'Звонок';
  el('noteText').value = 'Отметка через особые отметки';
  alerts.length = 0;
  run('saveClientNote()');
  check('отметка без даты: блокируется', alerts.length === 1 && run('clients[0].history.length') === 7);
  el('noteNextActivity').value = '2026-10-20T15:00';
  const beforeNote = taskList().length;
  run('saveClientNote()');
  check('отметка с датой: задача создана', taskList().length === beforeNote + 1 &&
    taskList()[taskList().length - 1].status === callsColumn);

  /* ---- 11. Служебные типы защищены от удаления ---- */
  const protectedIdx = run("interactionTypes.indexOf('Нерентабелен')");
  const delRes = run(`deleteInteractionType(${protectedIdx})`);
  check('обязательный тип не удаляется', delRes.ok === false && run("interactionTypes.indexOf('Нерентабелен')") > -1,
    delRes.error || '');

  console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки логики активностей пройдены');
  process.exitCode = failures ? 1 : 0;
})().catch(err => {
  console.error('Ошибка теста: ' + err.message + '\n' + (err.stack || ''));
  process.exitCode = 1;
});
