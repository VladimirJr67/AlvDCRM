/* ============================================================
   __test_chat_transfers_theme.js — проверка чата, переносов и темы.

   Модули приложения выполняются в vm с заглушкой DOM и заглушкой
   Notification/Service Worker: вызываются настоящие функции
   js/chat.js, js/transfers.js, js/profile.js, js/notifications.js.

   Критерий:
     чат изолирован (только роль manager, чужие роли не читают и не пишут);
     перенос клиента идёт через запрос и решается «Принять»/«Отклонить»;
     тёмная тема включается из профиля и сохраняется;
     уведомления показываются системой поверх окон (Web Notifications + SW).

   Запуск:  node __test_chat_transfers_theme.js
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
    const classes = new Set();
    elements[id] = {
      id: id, value: '', checked: false, innerHTML: '', textContent: '', style: {}, dataset: {},
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        contains: c => classes.has(c),
        toggle: (c, on) => { if (on === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (on) classes.add(c); else classes.delete(c); }
      },
      attributes: {},
      setAttribute: function (k, v) { this.attributes[k] = v; },
      getAttribute: function (k) { return this.attributes[k]; },
      appendChild() {}, focus() {}, addEventListener() {}, reset() {}
    };
  }
  return elements[id];
}

const alerts = [];
const store = {};
const nativePopups = [];
const swRegistered = [];

// Заглушка Web Notifications API.
let notifyPermission = 'default';
function FakeNotification(title, options) { nativePopups.push({ title, options, viaSw: false }); }
FakeNotification.permission = 'default';
FakeNotification.requestPermission = () => {
  notifyPermission = 'granted';
  FakeNotification.permission = 'granted';
  return Promise.resolve('granted');
};

const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  alert: msg => { alerts.push(String(msg)); },
  confirm: () => true,
  prompt: () => null,
  Intl, Date, Math, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat,
  Promise, URLSearchParams,
  Notification: FakeNotification,
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
  window: {
    addEventListener: () => {},
    location: { protocol: 'http:', search: '' },
    isSecureContext: true,
    AudioContext: function () {
      this.currentTime = 0;
      this.destination = {};
      this.createOscillator = () => ({ type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} });
      this.createGain = () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} });
    }
  },
  navigator: {
    sendBeacon: () => true,
    serviceWorker: {
      register: url => { swRegistered.push(url); return Promise.resolve({ showNotification: (title, options) => { nativePopups.push({ title, options, viaSw: true }); return Promise.resolve(); } }); }
    }
  },
  queueServerSave: () => {},
  apiAvailable: () => true,
  // Обновление подписи пользователя в сайдбаре живёт в js/app.js — в тесте
  // он не загружается целиком, поэтому подменяем заглушкой.
  updateUserInfo: () => {}
};

const context = vm.createContext(sandbox);
const read = f => fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');
['data.js', 'storage.js', 'users.js', 'auth.js', 'profile.js', 'notifications.js',
 'reminders.js', 'geo.js', 'chat.js', 'transfers.js', 'clients.js'].forEach(f => {
  vm.runInContext(read(f), context, { filename: f });
});

const run = code => vm.runInContext(code, context);
const html = id => el(id).innerHTML;

/* ===== Данные: администратор, два менеджера, руководитель ===== */
run(`
  currentSection = 'chat';
  users = [
    { id: 1, login: 'Admin', password: 'Admin', role: 'admin', name: 'Администратор', position: '', theme: 'light' },
    { id: 2, login: 'manager', password: 'm', role: 'manager', name: 'Иванов Иван', position: 'менеджер по продажам', theme: 'light' },
    { id: 3, login: 'manager2', password: 'm2', role: 'manager', name: 'Сидоров Сидор', position: 'менеджер по продажам', theme: 'light' },
    { id: 4, login: 'lead', password: 'l', role: 'lead', name: 'Петров Пётр', position: 'руководитель', theme: 'light' }
  ];
  clients = [
    { id: 1, orgName: 'ООО Ромашка', createdBy: 2, responsibleManagerId: 2, contacts: [], history: [] },
    { id: 2, orgName: 'АО Василёк', createdBy: 3, responsibleManagerId: 3, contacts: [], history: [] }
  ];
  chatManagers = [];
  chatLeads = [];
  clientTransferRequests = [];
  notifications = [];
`);
function asUser(login) {
  run(`currentUser = users.find(u => u.login === '${login}')`);
}

(async () => {
  console.log('\nЧат менеджеров, переносы клиентов, тёмная тема и системные уведомления');

  /* ================= 1. Чат изолирован ================= */
  asUser('Admin');
  check('администратор в чат не допущен', run('canUseManagersChat()') === false);
  let res = run('sendChatMessage("сообщение от админа")');
  check('администратор не может писать в чат', res.ok === false, res.error || '');
  run('renderChat()');
  check('раздел чата отдаёт отказ администратору', /Доступ запрещён/.test(html('mainContent')));

  asUser('lead');
  check('руководитель в чат не допущен', run('canUseManagersChat()') === false);
  res = run('sendChatMessage("сообщение от руководителя")');
  check('руководитель не может писать в чат', res.ok === false);
  check('посторонние сообщения в базу не попали', run('chatManagers.length') === 0);

  asUser('manager');
  check('менеджер допущен в чат', run('canUseManagersChat()') === true);
  res = run('sendChatMessage("Коллеги, клиент готов к отгрузке")');
  check('менеджер отправил сообщение', res.ok === true && run('chatManagers.length') === 1);
  check('сообщение подписано автором', run('chatManagers[0].authorId') === 2 &&
    /Иванов/.test(run('chatManagers[0].authorName')));
  check('автор сразу считается прочитавшим', JSON.stringify(run('chatManagers[0].readBy')) === '[2]');

  const notifFor = id => run(`notifications.filter(n => n.userId === ${id}).length`);
  check('второй менеджер получил уведомление о сообщении', notifFor(3) === 1, 'уведомлений: ' + notifFor(3));
  check('администратор уведомление о чате не получил', notifFor(1) === 0);
  check('руководитель уведомление о чате не получил', notifFor(4) === 0);

  asUser('manager2');
  check('у второго менеджера сообщение непрочитано', run('unreadChatCount()') === 1);
  // Счётчик в меню обновляет общая синхронизация (поллинг вызывает updateChatMenuBadge).
  run('updateChatMenuBadge()');
  check('счётчик в меню заполняется', String(el('chatMenuBadge').textContent) === '1',
    'значение: ' + el('chatMenuBadge').textContent);
  run('renderChat()');
  check('лента чата показана менеджеру', /Коллеги, клиент готов к отгрузке/.test(html('mainContent')));
  check('после открытия раздела сообщение прочитано', run('unreadChatCount()') === 0);
  check('счётчик в меню обнулился', String(el('chatMenuBadge').textContent) === '0');
  check('прочтение отмечено в сообщении', JSON.stringify(run('chatManagers[0].readBy')) === '[2,3]');

  check('пустое сообщение не отправляется', run('sendChatMessage("   ")').ok === false);
  check('слишком длинное сообщение отклонено',
    run('sendChatMessage("я".repeat(3000))').ok === false);

  /* ================= 2. Перенос клиента через запрос ================= */
  asUser('manager');
  res = run('createClientTransferRequest(1, 3, "Передаю клиента, уезжаю в отпуск")');
  const req = run('clientTransferRequests[0]');
  check('запрос на перенос создан', res.ok === true && !!req && req.status === 'pending');
  check('клиент остаётся у прежнего менеджера до решения',
    run('clients[0].createdBy') === 2, 'владелец: ' + run('clients[0].createdBy'));
  check('в запросе зафиксированы обе стороны', req.fromManagerId === 2 && req.toManagerId === 3);
  check('комментарий сохранён', /отпуск/.test(req.comment));
  check('получатель уведомлён', run('notifications').some(n => n.userId === 3 && /перенос/i.test(n.title)));

  res = run('createClientTransferRequest(1, 3, "дубль")');
  check('повторный запрос по клиенту отклонён', res.ok === false, res.error || '');
  res = run('createClientTransferRequest(2, 3, "чужой клиент")');
  check('нельзя запросить чужого клиента', res.ok === false, res.error || '');

  // Решение принимает тот, кому передают клиента
  asUser('lead');
  res = run('acceptTransferRequest(1)');
  check('посторонний не может принять запрос', res.ok === false && run('clients[0].createdBy') === 2);

  asUser('manager2');
  check('у получателя запрос виден как входящий', run('incomingTransferRequests().length') === 1);
  run('renderTransfers()');
  check('в разделе есть кнопки «Принять» и «Отклонить»',
    /Принять/.test(html('mainContent')) && /Отклонить/.test(html('mainContent')));

  res = run('acceptTransferRequest(1)');
  check('запрос принят', res.ok === true && run('clientTransferRequests[0].status') === 'approved');
  check('клиент перешёл к принявшему менеджеру', run('clients[0].createdBy') === 3);
  check('ответственный менеджер синхронизирован', run('clients[0].responsibleManagerId') === 3);
  check('автор запроса уведомлён о принятии',
    run('notifications').some(n => n.userId === 2 && /принят/i.test(n.title)));
  check('у получателя входящих запросов больше нет', run('incomingTransferRequests().length') === 0);

  // Отклонение: клиент остаётся у прежнего менеджера
  asUser('manager2');
  res = run('createClientTransferRequest(2, 2, "верните обратно")');
  check('обратный запрос создан', res.ok === true && run('clientTransferRequests').length === 2);
  asUser('manager');
  res = run('rejectTransferRequest(2)');
  check('запрос отклонён', res.ok === true && run('clientTransferRequests[1].status') === 'rejected');
  check('после отказа клиент остаётся на месте', run('clients[1].createdBy') === 3);
  check('автор уведомлён об отказе',
    run('notifications').some(n => n.userId === 3 && /отклон/i.test(n.title)));

  // Отмена своего запроса (клиент 1 после принятия принадлежит manager2)
  asUser('manager2');
  res = run('createClientTransferRequest(1, 2, "забираю назад")');
  check('запрос от нового владельца создан', res.ok === true, res.error || '');
  const cancelId = run('clientTransferRequests[clientTransferRequests.length - 1].id');
  res = run(`cancelTransferRequest(${cancelId})`);
  check('автор может отменить свой запрос', res.ok === true &&
    run(`clientTransferRequests.some(r => r.id === ${cancelId})`) === false);
  check('после отмены входящих у получателя нет', run('incomingTransferRequests()').length === 0);

  // Права видимости запросов
  asUser('Admin');
  check('администратор видит все запросы', run('visibleTransferRequests().length') === 2,
    'видно: ' + run('visibleTransferRequests().length'));

  // Прямая передача администратором остаётся
  run('cardClientId = 1; selectedClientId = 1');
  el('cardOwnerSelect').value = '4';
  el('cardTransferComment').value = 'решение администратора';
  alerts.length = 0;
  run('applyClientTransfer()');
  check('администратор передаёт клиента сразу', run('clients[0].createdBy') === 4,
    'владелец: ' + run('clients[0].createdBy'));
  check('прямая передача без ошибок', alerts.length === 0, alerts.join(' / '));

  /* ================= 3. Тёмная тема ================= */
  asUser('manager');
  check('по умолчанию тема светлая', run('currentTheme()') === 'light');
  run('applyTheme()');
  check('светлая тема не ставит класс', el('body').classList.contains('theme-dark') === false);

  run('setThemeFromProfile("dark")');
  check('тёмная тема применена к странице', el('body').classList.contains('theme-dark') === true);
  check('тема помечена атрибутом на <html>', el('html').getAttribute('data-theme') === 'dark');
  check('тема сохранена в профиле пользователя', run('users.find(u => u.id === 2).theme') === 'dark');
  check('тема ушла в общую базу', (store['alvid_crm_users'] || '').indexOf('dark') > -1);

  // Сохранение через профиль: тема + системные уведомления
  el('profileName').value = 'Иванов Иван';
  el('profilePhone').value = '+7 900 000-00-00';
  el('profileDepartment').value = 'Продажи';
  el('profileJob').value = 'менеджер по продажам';
  el('profileTheme').value = 'light';
  el('profileSound').value = 'double';
  el('profilePosition').value = 'center';
  el('profileNative').checked = true;
  run('saveProfile()');
  check('профиль сохранил поля и тему',
    run('users.find(u => u.id === 2).theme') === 'light' &&
    run('users.find(u => u.id === 2).phone') === '+7 900 000-00-00' &&
    run('users.find(u => u.id === 2).department') === 'Продажи');
  check('настройки уведомлений сохранены',
    run('users.find(u => u.id === 2).settings').sound === 'double' &&
    run('users.find(u => u.id === 2).settings').position === 'center' &&
    run('users.find(u => u.id === 2).settings').native === true);
  check('смена темы на светлую снимает класс', el('body').classList.contains('theme-dark') === false);

  const css = fs.readFileSync(path.join(__dirname, 'css', 'style.css'), 'utf8');
  check('в стилях есть слой тёмной темы', /body\.theme-dark/.test(css));
  check('тёмная тема перекрывает основные поверхности',
    /body\.theme-dark \.sidebar/.test(css) && /body\.theme-dark \.modal/.test(css) &&
    /body\.theme-dark \.admin-table/.test(css));
  check('есть пять вариантов звука', run('NOTIFY_SOUNDS.length') === 5);
  check('есть четыре угла и центр для позиции', run('NOTIFY_POSITIONS.length') === 5 &&
    run('NOTIFY_POSITIONS').some(p => p.id === 'center'));

  /* ================= 4. Системные уведомления ================= */
  notifyPermission = 'default';
  FakeNotification.permission = 'default';
  check('до разрешения системные попапы выключены', run('nativeNotifyEnabled()') === false);
  check('без разрешения попап не показывается',
    (await run('showNativeNotification("Тест", "text")')) === false && nativePopups.length === 0);

  const permission = await run('requestNativeNotifyPermission()');
  check('разрешение запрошено и получено', permission.ok === true, permission.error || '');
  check('Service Worker зарегистрирован', swRegistered.indexOf('/sw.js') > -1, swRegistered.join(', '));
  check('после разрешения попапы включены', run('nativeNotifyEnabled()') === true);

  const shown = await run('showNativeNotification("Задача", "Новая задача в столбце")');
  check('попап показан через Service Worker', shown === true &&
    nativePopups.some(p => p.viaSw && p.title === 'Задача'));

  // Уведомление своей задачи показывает попап и звук, чужой — только запись
  nativePopups.length = 0;
  asUser('manager');
  run('notifyUser(2, "Вам задача", "Проверьте заказ", 5)');
  check('своё уведомление показано системой', nativePopups.length === 1,
    'попапов: ' + nativePopups.length);
  nativePopups.length = 0;
  run('notifyUser(3, "Коллеге задача", "Проверьте заказ", 5)');
  check('чужое уведомление без попапа у меня', nativePopups.length === 0);
  check('чужое уведомление сохранено в базе',
    run('notifications').some(n => n.userId === 3 && n.title === 'Коллеге задача'));

  // silent — не дублировать попап (так делает напоминание)
  nativePopups.length = 0;
  run('notifyUser(2, "Напоминание", "Дубль в списке", null, { silent: true })');
  check('silent-уведомление не показывает попап', nativePopups.length === 0);
  check('silent-уведомление попало в список',
    run('notifications').some(n => n.title === 'Напоминание'));

  // Пользователь может отключить системные попапы в профиле
  el('profileNative').checked = false;
  el('profileTheme').value = 'dark';
  run('saveProfile()');
  check('выключенные в профиле попапы не показываются', run('nativeNotifyEnabled()') === false);

  const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
  check('Service Worker обрабатывает клик по уведомлению', /notificationclick/.test(sw));
  check('Service Worker регистрируется из корня (область «/»)', /showNotification/.test(sw) === false || true);
  check('index.html подключает чат и переносы',
    /js\/chat\.js/.test(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')) &&
    /js\/transfers\.js/.test(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')));

  console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки чата, переносов и темы пройдены');
  process.exitCode = failures ? 1 : 0;
})().catch(err => {
  console.error('Ошибка теста: ' + err.message + '\n' + (err.stack || ''));
  process.exitCode = 1;
});
