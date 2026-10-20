/* Права доступа: чужие клиенты, комментарии, справочник контактов, пароль.
   - менеджер видит чужих клиентов только для чтения (поля, кнопки, контакты);
   - внутренние/мобильные контакты правит только админ/руководитель/разработчик;
   - раздел называется «Телефонный справочник», пароль в форме — открытым текстом. */
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

// --- Заглушки браузерного окружения (как в __test_modules.js) ---
const elements = {};
const el = id => (elements[id] = elements[id] || {
  id, value: '', checked: false, innerHTML: '', textContent: '', disabled: false, style: {}, dataset: {},
  classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
  setAttribute() {}, getAttribute() { return null; },
  appendChild() {}, focus() {}, addEventListener() {}, removeEventListener() {}, reset() {},
  querySelector() { return null; }, querySelectorAll() { return []; }
});

function FakeNotification() {}
FakeNotification.permission = 'default';
FakeNotification.requestPermission = () => Promise.resolve('granted');

let alertCalls = [];
const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  alert: msg => alertCalls.push(String(msg)),
  confirm: () => true, prompt: () => null, Intl, URLSearchParams,
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

// Пользователи всех ролей и два клиента: свой (менеджера 2) и чужой (руководителя 3).
run(`
  users = [
    { id: 1, login: 'Admin', password: 'Admin', role: 'admin', name: 'Администратор' },
    { id: 2, login: 'manager', password: 'q', role: 'manager', name: 'Менеджер' },
    { id: 3, login: 'lead', password: 'q', role: 'lead', name: 'Руководитель' },
    { id: 4, login: 'dev', password: 'q', role: 'developer', name: 'Разработчик' }
  ];
  const now = new Date().toISOString();
  clients = [
    { id: 10, orgName: 'Мой клиент', createdBy: 2, contacts: [{ name: 'Иван', phoneWork: '1' }],
      history: [{ date: now, type: 'Звонок', manager: 'manager', authorId: 2, comment: 'мой коммент' }] },
    { id: 11, orgName: 'Чужой клиент', createdBy: 3, contacts: [{ name: 'Пётр', phoneWork: '2' }],
      history: [{ date: now, type: 'Звонок', manager: 'manager', authorId: 2, comment: 'коммент на чужом' }] }
  ];
  contacts = [
    { id: 1, type: 'internal', name: 'Секретарь', department: 'Офис', number: '100', position: '' },
    { id: 2, type: 'mobile', name: 'Водитель', department: 'Логистика', number: '200', position: '' }
  ];
`);
const as = login => run(`currentUser = users.find(u => u.login.toLowerCase() === '${login}'.toLowerCase())`);

console.log('\nПрава: чужие клиенты и справочник контактов');

/* ================= 1. Менеджер — только свои клиенты ================= */
as('manager');
check('менеджер может писать в своего клиента', run('canWriteToClient(clients.find(c => c.id === 10))') === true);
check('менеджер не может писать в чужого', run('canWriteToClient(clients.find(c => c.id === 11))') === false);

// Чужой клиент: контактные лица и история — только чтение.
run('selectedClientId = 11; renderClientContacts(11)');
const foreignPanel = elements.contactPanel ? elements.contactPanel.innerHTML : '';
check('у чужого клиента нет кнопок правки контактов', !/Изменить|Удалить/.test(foreignPanel));
check('у чужого клиента нет кнопки «+ Добавить» в истории', !/openHistoryModal/.test(foreignPanel));

run('selectedClientId = 10; renderClientContacts(10)');
const ownPanel = elements.contactPanel ? elements.contactPanel.innerHTML : '';
check('у своего клиента кнопки правки контактов есть', /Изменить/.test(ownPanel));
check('у своего клиента есть «+ Добавить» в истории', /openHistoryModal/.test(ownPanel));

// Действия напрямую тоже блокируются.
run(`clients.find(c => c.id === 11).contacts.length = 1`);
run('deleteContact(11, 0)');
check('менеджер не удаляет контакт чужого клиента', run('clients.find(c => c.id === 11).contacts.length') === 1);
alertCalls = [];
run('openContactModal(11)');
check('менеджеру не открывается форма контакта чужого клиента', el('contactClientId').value === '' && alertCalls.length > 0);

// Комментарии: автор комментария — менеджер, но клиент чужой.
const foreignEntry = `clients.find(c => c.id === 11).history[0]`;
const ownEntry = `clients.find(c => c.id === 10).history[0]`;
check('менеджер не правит свой комментарий у чужого клиента',
  run(`canEditComment(${foreignEntry}, clients.find(c => c.id === 11))`) === false);
check('менеджер правит свой комментарий у своего клиента',
  run(`canEditComment(${ownEntry}, clients.find(c => c.id === 10))`) === true);

// Администратор и разработчик — могут всё.
as('Admin');
check('администратор правит любого клиента', run('canWriteToClient(clients.find(c => c.id === 11))') === true);
check('администратор правит любой комментарий',
  run(`canEditComment(${foreignEntry}, clients.find(c => c.id === 11))`) === true);
as('dev');
check('разработчик правит любого клиента', run('canWriteToClient(clients.find(c => c.id === 11))') === true);

/* ================= 2. Справочник контактов — только админ/руководитель/разработчик ================= */
const roles = { manager: false, lead: true, admin: true, dev: true };
Object.keys(roles).forEach(login => {
  as(login);
  check(`права на справочник у «${login}»`, run('canManageDirectoryContacts()') === roles[login]);
});

// Менеджеру кнопки не показываются.
as('manager');
run('renderContacts()');
const mgrHtml = elements.mainContent ? elements.mainContent.innerHTML : '';
check('менеджеру не видна кнопка «Импорт из Excel»', !/Импорт из Excel/.test(mgrHtml));
check('менеджеру не видна кнопка «+ Добавить контакт»', !/\+ Добавить контакт/.test(mgrHtml));
run('renderContactsList()');
const mgrList = elements.contactsList ? elements.contactsList.innerHTML : '';
check('менеджеру не видно кнопок правки/удаления контакта', !/Изменить|Удалить/.test(mgrList));
alertCalls = [];
run('openContactItemModal()');
check('менеджеру не открывается форма контакта справочника', el('contactItemId').value === '' && alertCalls.length > 0);
const before = run('contacts.length');
run('deleteContactItem(1)');
check('менеджер не удаляет контакт справочника', run('contacts.length') === before);

// Руководитель и админ — видят кнопки.
as('lead');
run('renderContacts()');
const leadHtml = elements.mainContent ? elements.mainContent.innerHTML : '';
check('руководителю видна кнопка «Импорт из Excel»', /Импорт из Excel/.test(leadHtml));
check('руководителю видна кнопка «+ Добавить контакт»', /\+ Добавить контакт/.test(leadHtml));
run('renderContactsList()');
const leadList = elements.contactsList ? elements.contactsList.innerHTML : '';
check('руководителю видны кнопки правки/удаления', /Изменить/.test(leadList) && /Удалить/.test(leadList));

/* ================= 3. Переименование раздела ================= */
as('manager');
run('renderContacts()');
check('раздел называется «Телефонный справочник»',
  /Телефонный справочник/.test(elements.mainContent.innerHTML));

/* ================= 4. Пароль в форме пользователя — открытым текстом ================= */
const adminSrc = fs.readFileSync('js/admin.js', 'utf8');
const pwdLine = (adminSrc.match(/<input[^>]*id="userPassword"[^>]*>/) || [''])[0];
check('поле пароля пользователя без type="password"', pwdLine.includes('type="text"'), pwdLine.trim());

console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки прав пройдены');
process.exitCode = failures ? 1 : 0;
