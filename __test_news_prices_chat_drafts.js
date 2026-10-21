/* Новости, цены, чат, мультиспецификации заказа и черновики форм (П.2, П.3,
   П.21, П.27, П.29). */
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
      querySelector: () => null, querySelectorAll: () => []
    };
  }
  return elements[id];
}

// Блоки дополнительных спецификаций заказа для collectOrderSpecs().
let orderSpecBlocks = [];

const alerts = [];
const store = {};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  alert: msg => { alerts.push(String(msg)); },
  confirm: () => true,
  prompt: () => 'обновлённый текст',
  Intl, Date, Math, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Promise,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: {
    getElementById: el,
    querySelector: () => null,
    querySelectorAll: sel => (sel === '.order-spec-block' ? orderSpecBlocks : []),
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
['data.js', 'storage.js', 'users.js', 'interactionTypes.js', 'dictionaries.js',
 'profile.js', 'notifications.js', 'tasks.js', 'orders.js', 'matrices.js',
 'clients.js', 'news.js', 'chat.js', 'minPrices.js']
  .forEach(f => vm.runInContext(read(f), context, { filename: f }));
const run = code => vm.runInContext(code, context);

run(`
  currentSection = 'news';
  users = [
    { id: 1, login: 'Admin', password: 'Admin', role: 'admin', name: 'Администратор', position: '' },
    { id: 2, login: 'manager', password: 'm', role: 'manager', name: 'Иванов Иван', position: 'менеджер' },
    { id: 3, login: 'manager2', password: 'm2', role: 'manager', name: 'Сидоров Сидор', position: 'менеджер' }
  ];
  currentUser = users[1];
  clients = [{ id: 1, orgName: 'ООО Тест', createdBy: 2, contacts: [], history: [] }];
  taskColumns = [];
  activityToColumnMap = {};
  tasks = [];
  orders = [];
  matrices = [];
  notifications = [];
  specialNotes = [];
`);

(async () => {
  console.log('\nНовости, цены, чат, мультиспецификации и черновики');

  /* ================= 1. Новости: скролл и «Свернуть» (П.3) ================= */
  run(`
    newsItems = [{ id: 1, title: 'Новость', html: '<p>Длинный текст новости</p>', createdAt: new Date().toISOString(), readBy: [] }];
    expandedNewsIds = [1];
  `);
  run('renderNews()');
  const newsHtml = el('mainContent').innerHTML;
  check('развёрнутая новость показана', /news-item-body/.test(newsHtml));
  check('кнопка «Свернуть» вынесена в отдельный ряд', /news-collapse-row/.test(newsHtml) && /Свернуть/.test(newsHtml));
  const css = fs.readFileSync(path.join(__dirname, 'css', 'style.css'), 'utf8');
  check('у развёрнутой новости вертикальный скролл',
    /\.news-item-body\s*\{[^}]*max-height:\s*60vh[^}]*overflow-y:\s*auto/.test(css));
  check('ряд «Свернуть» отцентрован', /\.news-collapse-row\s*\{[^}]*text-align:\s*center/.test(css));

  /* ================= 2. Цены: причина изменения (П.2) ================= */
  run(`
    minPrices = { Анод: { value: 700, updatedAt: new Date().toISOString(), updatedBy: 1 } };
    minPriceHistory = [{ id: 1, key: 'Анод', value: 700, previous: 650, reason: 'новый прайс поставщика',
                         updatedAt: new Date().toISOString(), updatedBy: 1 }];
  `);
  run('openMinPricesHistory()');
  const historyHtml = el('minPricesHistoryContent').innerHTML;
  check('в истории есть колонка «Причина»', /Причина/.test(historyHtml));
  check('причина выводится в истории', /новый прайс поставщика/.test(historyHtml));

  run('currentUser = users[0]');   // цены меняет администратор
  run('openMinPricesModal()');
  check('в форме есть обязательное поле причины', /minPriceReason/.test(el('minPricesForm').innerHTML));
  run('currentUser = users[1]');

  /* ================= 3. Чат: правка и удаление своих сообщений (П.21) ================= */
  run(`
    chatManagers = [
      { id: 1, authorId: 2, authorName: 'Иванов Иван', text: 'моё сообщение', createdAt: new Date().toISOString(), readBy: [2] },
      { id: 2, authorId: 3, authorName: 'Сидоров Сидор', text: 'чужое сообщение', createdAt: new Date().toISOString(), readBy: [2] }
    ];
  `);
  run('renderChat()');
  const chatHtml = el('mainContent').innerHTML;
  check('кнопки правки/удаления — только у своего сообщения',
    (chatHtml.match(/editChatMessage\(/g) || []).length === 1 &&
    (chatHtml.match(/deleteChatMessage\(/g) || []).length === 1);

  let res = run('editChatMessage(1)');
  check('своё сообщение редактируется', res.ok === true &&
    run('chatManagers.find(m => m.id === 1).text') === 'обновлённый текст' &&
    !!run('chatManagers.find(m => m.id === 1).editedAt'));
  res = run('editChatMessage(2)');
  check('чужое сообщение редактировать нельзя', res.ok === false &&
    run('chatManagers.find(m => m.id === 2).text') === 'чужое сообщение');
  res = run('deleteChatMessage(2)');
  check('чужое сообщение удалить нельзя', res.ok === false && run('chatManagers.length') === 2);
  res = run('deleteChatMessage(1)');
  check('своё сообщение удаляется', res.ok === true && run('chatManagers.length') === 1);

  /* ================= 4. Размещение заказа: несколько спецификаций (П.27) ================= */
  const specValues = [
    { '.order-spec-kg': '300', '.order-spec-cost': '150000', '.order-spec-condition': 'Анод', '.order-spec-specification': 'СП-2' },
    { '.order-spec-kg': '', '.order-spec-cost': '', '.order-spec-condition': '', '.order-spec-specification': '' }
  ];
  orderSpecBlocks = specValues.map(values => ({
    querySelector: sel => ({ value: values[sel] === undefined ? '' : values[sel] })
  }));

  run(`
    chatManagers = [];
    clients[0].history = [];
    orders = [];
    document.getElementById('historyClientId').value = '1';
    document.getElementById('historyType').value = 'Размещение заказа';
    document.getElementById('historyComment').value = '';
    document.getElementById('historyNextActivity').value = '2026-11-01T10:00';
    document.getElementById('historyEditIdx').value = '';
    document.getElementById('orderKg').value = '1200';
    document.getElementById('orderCost').value = '780000';
    document.getElementById('orderCondition').value = 'Сырой';
    document.getElementById('orderSpecification').value = 'СП-1';
  `);
  run('saveHistory({ preventDefault: function(){}, target: null })');

  const orderRecords = run('orders');
  check('по двум спецификациям созданы два заказа', orderRecords.length === 2,
    'заказов: ' + orderRecords.length);
  check('первый заказ — из основной формы', orderRecords[0].kg === 1200 && orderRecords[0].specification === 'СП-1');
  check('второй заказ — из дополнительной спецификации',
    orderRecords[1].kg === 300 && orderRecords[1].specification === 'СП-2' && orderRecords[1].condition === 'Анод',
    JSON.stringify(orderRecords[1]));
  const histEntry = run('clients[0].history[0]');
  check('в записи истории — список спецификаций', Array.isArray(histEntry.orders) && histEntry.orders.length === 2);
  check('комментарий содержит обе спецификации',
    /СП-1/.test(histEntry.comment) && /СП-2/.test(histEntry.comment));

  /* ================= 5. Черновики форм (П.29) ================= */
  run('clearDraftValue(DRAFT_CLIENT_KEY)');
  el('clientId').value = '';
  el('orgName').value = 'Новая фирма';
  el('orgCity').value = 'Москва';
  el('orgPhones').value = '+7 900 000-00-00';
  el('orgOldBase').checked = true;
  el('oldBaseId').value = '10457';
  run('saveClientDraft()');
  check('черновик клиента сохранён', !!store['alvid_crm_draft_client']);

  el('orgName').value = '';
  el('orgCity').value = '';
  el('orgPhones').value = '';
  el('oldBaseId').value = '';
  el('orgOldBase').checked = false;
  run('restoreClientDraft()');
  check('после перезагрузки поля клиента восстановлены',
    el('orgName').value === 'Новая фирма' && el('orgCity').value === 'Москва' &&
    el('orgPhones').value === '+7 900 000-00-00' && el('oldBaseId').value === '10457' &&
    el('orgOldBase').checked === true);

  run('clearDraftValue(DRAFT_CLIENT_KEY)');
  check('после сохранения клиента черновик очищен', !store['alvid_crm_draft_client']);
  el('clientId').value = '5';
  el('orgName').value = 'Редактируемая фирма';
  run('saveClientDraft()');
  check('при редактировании существующего клиента черновик не пишется', !store['alvid_crm_draft_client']);

  // Контактное лицо
  el('contactClientId').value = '1';
  el('editContactIdx').value = '';
  el('newContactName').value = 'Иванов Иван';
  el('newContactPosition').value = 'Директор';
  el('newContactPhoneWork').value = '+7 495 111-11-11';
  el('newContactPhoneMobile').value = '+7 916 222-22-22';
  el('newContactEmail').value = 'ivanov@example.ru';
  run('saveContactDraft()');
  check('черновик контакта сохранён', !!store['alvid_crm_draft_contact_1']);

  el('newContactName').value = '';
  el('newContactPosition').value = '';
  el('newContactPhoneMobile').value = '';
  el('newContactEmail').value = '';
  run('restoreContactDraft(1)');
  check('после перезагрузки поля контакта восстановлены',
    el('newContactName').value === 'Иванов Иван' && el('newContactPosition').value === 'Директор' &&
    el('newContactPhoneMobile').value === '+7 916 222-22-22');
  run('clearDraftValue(contactDraftKey(1))');

  console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки новостей, цен, чата, заказов и черновиков пройдены');
  process.exitCode = failures ? 1 : 0;
})().catch(err => {
  console.error('Ошибка теста: ' + err.message + '\n' + (err.stack || ''));
  process.exitCode = 1;
});
