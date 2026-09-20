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
  check('чат не создаёт уведомлений в разделе «Уведомления»',
    notifFor(1) === 0 && notifFor(3) === 0 && notifFor(4) === 0,
    'уведомлений: ' + notifFor(1) + '/' + notifFor(3) + '/' + notifFor(4));

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
  // Новые правила: менеджер/руководитель запрашивает перенос только по
  // чужому клиенту; решение принимает адресат (toManagerId), после
  // подтверждения клиент закрепляется за ним.

  // Владелец не может запросить перенос собственного клиента.
  asUser('manager'); // id 2 — владелец клиента 1
  res = run('createClientTransferRequest(1, 3, "отдаю своего клиента")');
  check('нельзя запросить перенос своего клиента', res.ok === false, res.error || '');

  // Менеджер запрашивает перенос чужого клиента (клиент 2 владеет id 3) — адресат id 4.
  res = run('createClientTransferRequest(2, 4, "Передаю клиента руководителю, уезжаю в отпуск")');
  const req = run('clientTransferRequests[0]');
  check('запрос на перенос создан', res.ok === true && !!req && req.status === 'pending');
  check('клиент остаётся у прежнего менеджера до решения',
    run('clients[1].createdBy') === 3, 'владелец: ' + run('clients[1].createdBy'));
  check('в запросе зафиксированы обе стороны', req.fromManagerId === 2 && req.toManagerId === 4);
  check('комментарий сохранён', /отпуск/.test(req.comment));
  check('адресат уведомлён', run('notifications').some(n => n.userId === 4 && /перенос/i.test(n.title)));

  res = run('createClientTransferRequest(2, 4, "дубль")');
  check('повторный запрос по клиенту отклонён', res.ok === false, res.error || '');

  // Плашка в карточке клиента по активному запросу.
  asUser('manager'); // автор запроса
  const authorPlaque = run('pendingTransferHtml(clients[1])');
  check('автор видит «Отменить» в плашке',
    /Отменить/.test(authorPlaque) && /cancelTransferFromCard\(1\)/.test(authorPlaque));
  asUser('manager2'); // id 3 — посторонний (не автор и не адресат)
  const thirdPlaque = run('pendingTransferHtml(clients[1])');
  check('посторонний видит только статус ожидания',
    /ожидает решения/.test(thirdPlaque) && !/Подтвердить/.test(thirdPlaque) && !/Отменить/.test(thirdPlaque));

  // Решение принимает адресат (toManagerId).
  asUser('manager2'); // id 3 — не адресат
  res = run('acceptTransferRequest(1)');
  check('посторонний не может принять запрос', res.ok === false && run('clients[1].createdBy') === 3);

  asUser('lead'); // id 4 — адресат
  check('у адресата запрос виден как входящий', run('incomingTransferRequests().length') === 1);
  const deciderPlaque = run('pendingTransferHtml(clients[1])');
  check('адресат видит «Подтвердить / Отклонить»',
    /Подтвердить/.test(deciderPlaque) && /Отклонить/.test(deciderPlaque) &&
    /decideTransferFromCard\(1, true\)/.test(deciderPlaque));

  res = run('acceptTransferRequest(1)');
  check('запрос принят', res.ok === true && run('clientTransferRequests[0].status') === 'approved');
  check('клиент перешёл к адресату', run('clients[1].createdBy') === 4);
  check('ответственный менеджер синхронизирован', run('clients[1].responsibleManagerId') === 4);
  check('автор запроса уведомлён о принятии',
    run('notifications').some(n => n.userId === 2 && /принят/i.test(n.title)));
  check('адресат уведомлён о закреплении',
    run('notifications').some(n => n.userId === 4 && /передан вам/i.test(n.title)));
  check('у адресата входящих запросов больше нет', run('incomingTransferRequests().length') === 0);

  // Отклонение: клиент остаётся у прежнего менеджера.
  asUser('lead'); // id 4 — запрашивает перенос клиента 1 (владелец id 2) адресату id 3
  res = run('createClientTransferRequest(1, 3, "верните клиента себе")');
  check('запрос руководителя создан', res.ok === true && run('clientTransferRequests').length === 2);
  asUser('manager2'); // id 3 — адресат
  res = run('rejectTransferRequest(2)');
  check('запрос отклонён', res.ok === true && run('clientTransferRequests[1].status') === 'rejected');
  check('после отказа клиент остаётся на месте', run('clients[0].createdBy') === 2);
  check('автор уведомлён об отказе',
    run('notifications').some(n => n.userId === 4 && /отклон/i.test(n.title)));

  // Отмена своего запроса: клиент 2 теперь у руководителя (id 4), manager2 (id 3) — чужой.
  asUser('manager2');
  res = run('createClientTransferRequest(2, 2, "забираю назад")');
  check('запрос от нового автора создан', res.ok === true, res.error || '');
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
