/* Чистка интерфейса: удалённые «Напоминания» (П.30), чистый комментарий (П.14),
   скролл админки (П.17). */
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
      appendChild() {}, focus() {}, addEventListener() {}, reset() {},
      querySelector() { return null; }, querySelectorAll() { return []; }
    };
  }
  return elements[id];
}
function resetElements(ids) {
  ids.forEach(id => { const e = el(id); e.value = ''; e.checked = false; });
}

const alerts = [];
const store = {};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  alert: msg => { alerts.push(String(msg)); },
  confirm: () => true, prompt: () => null,
  Intl, Date, Math, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat,
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
    body: el('body'), documentElement: el('html')
  },
  window: { addEventListener: () => {}, location: { protocol: 'http:' } },
  navigator: { sendBeacon: () => true },
  queueServerSave: () => {},
  apiAvailable: () => false
};

const context = vm.createContext(sandbox);
const read = f => fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');
['data.js', 'storage.js', 'users.js', 'interactionTypes.js', 'dictionaries.js', 'profile.js',
 'notifications.js', 'tasks.js', 'orders.js', 'matrices.js', 'clients.js'].forEach(f => {
  vm.runInContext(read(f), context, { filename: f });
});
const run = code => vm.runInContext(code, context);

console.log('\nЧистка интерфейса: напоминания, комментарий, скролл админки');

/* ================= 1. «Напоминания» удалены полностью (П.30) ================= */
const indexSrc = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const appSrc = read('app.js');
const clientsSrc = read('clients.js');
const apiSrc = read('api.js');

check('в index.html нет модуля напоминаний', !/reminders\.js/.test(indexSrc));
check('модуль js/reminders.js удалён', !fs.existsSync(path.join(__dirname, 'js', 'reminders.js')));
check('в меню нет пункта «Напоминания»', !/addItem\('reminders'/.test(appSrc) && !/renderReminders\b/.test(appSrc));
check('нет запуска наблюдателя напоминаний', !/startReminderWatcher/.test(appSrc) && !/loadReminders\(/.test(appSrc));
check('в маршрутах нет раздела reminders', !/reminders/.test(appSrc));
check('в карточке клиента нет кнопки «+ Напоминание»', !/\+ Напоминание/.test(clientsSrc) &&
  !/openCardReminderModal/.test(clientsSrc));
check('в карточке клиента нет индикатора напоминаний', !/clientReminder/.test(clientsSrc));
check('напоминания не уходят в базу', !/reminders/.test(apiSrc));

// Функции старого модуля не определены.
check('функции напоминаний недоступны', run('typeof renderReminders') === 'undefined' &&
  run('typeof showReminderPopup') === 'undefined' && run('typeof openReminderModal') === 'undefined');

/* ================= 2. Комментарий открывается чистым (П.14) ================= */
run(`
  currentUser = { id: 2, login: 'manager', role: 'manager', name: 'Иванов Иван' };
  clients = [{ id: 1, orgName: 'ООО Тест', createdBy: 2, contacts: [{ id: 1, name: 'Пётр' }],
               history: [{ date: new Date().toISOString(), type: 'Звонок', manager: 'manager', authorId: 2, comment: 'старый комментарий' }] }];
  interactionTypes = ['Звонок', 'Информация'];
`);
el('historyComment').value = 'мусор из прошлого открытия';
run('openHistoryModal(1)');
check('новый комментарий: поле чистое', el('historyComment').value === '');

// После редактирования существующего комментария новое окно снова чистое.
run('openHistoryModal(1, 0)');
check('правка комментария подставляет его текст', el('historyComment').value === 'старый комментарий');
run('openHistoryModal(1)');
check('после правки новое окно чистое', el('historyComment').value === '');

/* ================= 3. Скролл админского раздела (П.17) ================= */
const css = fs.readFileSync(path.join(__dirname, 'css', 'style.css'), 'utf8');
check('скролл админки — на всей рабочей области',
  /#mainContent\.admin-scroll\s*\{[^}]*overflow-y:\s*auto/.test(css));
check('высота контента в админке не зажата флексом',
  /#mainContent\.admin-scroll\s*\{[^}]*display:\s*block/.test(css));
check('есть отступ до самого низа',
  /#mainContent\.admin-scroll\s*\{[^}]*padding-bottom:\s*\d+px/.test(css));

console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки чистки интерфейса пройдены');
process.exitCode = failures ? 1 : 0;
