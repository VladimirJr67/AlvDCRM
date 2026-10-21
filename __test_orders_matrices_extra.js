/* Заказы и матрицы: импорт справочника матриц, разделение ручных матриц и
   заказов, редактирование заказов по ролям, фильтр «Месяц», кол-во
   обеспеченных профилей из «Готовности», поиск клиента с автокомплитом. */
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
      id, value: '', checked: false, innerHTML: '', textContent: '', style: {}, dataset: {},
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        contains: c => classes.has(c),
        toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }
      },
      appendChild() {}, focus() {}, addEventListener() {}, reset() {}
    };
  }
  return elements[id];
}

const alerts = [];
const store = {};
const saves = { server: 0 };
const xlsxFiles = [];

const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  alert: msg => { alerts.push(String(msg)); },
  confirm: () => true, prompt: () => null,
  Intl, Date, Math, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Promise,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: {
    getElementById: el, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {}, createElement: () => el('__created')
  },
  window: { addEventListener: () => {}, location: { protocol: 'http:' } },
  navigator: { sendBeacon: () => true },
  fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
  queueServerSave: () => { saves.server++; },
  apiAvailable: () => false,
  closeModal: () => {},
  XLSX: {
    utils: { json_to_sheet: rows => ({ rows }), book_new: () => ({}), book_append_sheet: () => {} },
    writeFile: (wb, name) => { xlsxFiles.push(name); }
  }
};

const context = vm.createContext(sandbox);
const read = f => fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');
['data.js', 'storage.js', 'users.js', 'interactionTypes.js', 'dictionaries.js',
 'notifications.js', 'tasks.js', 'orders.js', 'matrices.js', 'readiness.js', 'clients.js', 'minPrices.js']
  .forEach(f => vm.runInContext(read(f), context, { filename: f }));
const run = code => vm.runInContext(code, context);

const p2 = n => String(n).padStart(2, '0');
const monthStart = (() => { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-01'; })();
const monthEnd = (() => { const d = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); })();

run(`
  currentSection = 'orders';
  users = [
    { id: 1, login: 'Admin', password: 'Admin', role: 'admin', name: 'Администратор' },
    { id: 2, login: 'manager', password: 'm', role: 'manager', name: 'Иванов Иван' },
    { id: 3, login: 'lead', password: 'l', role: 'lead', name: 'Петров Пётр' }
  ];
  clients = [
    { id: 1, orgName: 'ООО Ромашка', contacts: [], history: [] },
    { id: 2, orgName: 'АО Василёк', contacts: [], history: [] }
  ];
  currentUser = users[1];
  orders = [
    { id: 1, clientId: 1, clientName: 'ООО Ромашка', kg: 1000, condition: 'Анод', avgPrice: 650, cost: 650000, date: ${JSON.stringify(monthStart)} + 'T10:00:00.000Z', createdBy: 2, specification: 'СП-1' },
    { id: 2, clientId: 2, clientName: 'АО Василёк', kg: 500, condition: 'Сырой', avgPrice: 600, cost: 300000, date: '2020-01-05T10:00:00.000Z', createdBy: 3, specification: '' }
  ];
  matrices = [
    { id: 1, cipher: 'ЗАК-1', source: 'order', status: 'Поступила', clientId: 1, clientName: 'ООО Ромашка', date: '2026-10-01', createdBy: 2 },
    { id: 2, cipher: 'РУЧ-1', source: 'manual', clientId: 1, clientName: 'ООО Ромашка', date: '2026-10-02', createdBy: 2 },
    { id: 3, cipher: 'ЛЕГ-1', clientId: 1, clientName: 'ООО Ромашка', date: '2026-10-03', createdBy: 2 }
  ];
  notifications = [];
  fetchReadinessStatus = async () => null;
  refreshReadinessForVisibleOrders = () => false;
`);
const as = login => run(`currentUser = users.find(u => u.login === '${login}')`);

(async () => {
  console.log('\nЗаказы и матрицы: импорт, разделение, редактирование, фильтры');

  /* ================= 1. Ручные матрицы не попадают в «Заказы/Матрицы» (П.15) ================= */
  as('manager');
  run('ordersTab = "matrices"; renderMatricesTab()');
  const tabHtml = el('ordersTabBody').innerHTML;
  check('заказанная матрица в «Заказах/Матрицах»', /ЗАК-1/.test(tabHtml));
  check('ручная матрица из «Учёта матриц» не показывается', !/РУЧ-1/.test(tabHtml));
  check('старая матрица без source считается заказанной', /ЛЕГ-1/.test(tabHtml));
  check('фильтр матриц считает только заказанные', run('filteredMatrices().length') === 2,
    'видно: ' + run('filteredMatrices().length'));

  /* ================= 2. Импорт матриц в «Учёт матриц» (П.5) ================= */
  const rows = [
    ['Клиент', 'Шифр', 'Вес за м/п', 'Пресс'],
    ['ООО Ромашка', 'ИМП-1', '1.2', '7'],
    ['Неизвестная фирма', 'ИМП-2', '0.9', '8'],
    ['', 'ИМП-3', '', '']
  ];
  const parsed = run(`buildMatricesFromRows(${JSON.stringify(rows)})`);
  check('строки импорта разобраны по шаблону', parsed.length === 3 &&
    parsed[0].cipher === 'ИМП-1' && parsed[0].clientId === 1 && parsed[0].weight === '1.2' && parsed[0].press === '7',
    JSON.stringify(parsed));
  check('клиент не найден — остаётся название', parsed[1].clientId === null && parsed[1].clientName === 'Неизвестная фирма');

  // Импорт целиком: подменяем чтение файла готовыми строками.
  as('lead');
  run(`parseSpreadsheetFile = async () => ${JSON.stringify(rows)};`);
  const before = run('matrices.length');
  await run(`importMatricesFromExcel({ target: { files: [{ name: 'm.xlsx' }], value: '' } })`);
  check('импорт добавил матрицы', run('matrices.length') === before + 3, 'матриц: ' + run('matrices.length'));
  check('импортированные — ручные', run('matrices.filter(m => m.cipher.indexOf("ИМП-") === 0).every(m => m.source === "manual")') === true);
  check('импортированные не попали в заказы', run('filteredMatrices().some(m => String(m.cipher).indexOf("ИМП-") === 0)') === false);

  // Менеджер импортировать не может.
  as('manager');
  const beforeMgr = run('matrices.length');
  await run(`importMatricesFromExcel({ target: { files: [{ name: 'm.xlsx' }], value: '' } })`);
  check('менеджер не импортирует матрицы', run('matrices.length') === beforeMgr);

  // Удаление шифров — только админ/рук/разраб.
  as('manager');
  const manualId = run('matrices.find(m => m.cipher === "РУЧ-1").id');
  alerts.length = 0;
  run(`deleteMatrixAccounting(${manualId})`);
  check('менеджер не удаляет шифр из «Учёта матриц»', run('matrices.some(m => m.cipher === "РУЧ-1")') === true && alerts.length === 1);
  as('lead');
  run(`deleteMatrixAccounting(${manualId})`);
  check('руководитель удаляет шифр', run('matrices.some(m => m.cipher === "РУЧ-1")') === false);

  // Шаблон скачивается.
  run('downloadMatricesTemplate()');
  check('шаблон импорта создан', xlsxFiles.indexOf('Шаблон_импорта_матриц.xlsx') > -1);

  /* ================= 3. Редактирование заказов по ролям (П.26) ================= */
  as('manager');
  check('менеджер правит свой заказ', run('canEditOrder(orders.find(o => o.id === 1))') === true);
  check('менеджер не правит чужой заказ', run('canEditOrder(orders.find(o => o.id === 2))') === false);
  alerts.length = 0;
  run('openOrderEditModal(2)');
  check('чужой заказ не открывается на правку', el('orderEditModal').classList.contains('active') === false && alerts.length === 1);

  run('openOrderEditModal(1)');
  check('свой заказ открывается на правку', el('orderEditModal').classList.contains('active') === true);
  el('orderEditKg').value = '2000';
  el('orderEditCost').value = '100000';
  el('orderEditCondition').value = 'Анод';
  el('orderEditSpecification').value = 'СП-77';
  el('orderEditClientSearch').value = 'ООО Ромашка';
  run('selectOrderEditClient(1, "ООО Ромашка")');
  run('saveOrderFromModal({ preventDefault: function(){} })');
  const edited = run('orders.find(o => o.id === 1)');
  check('заказ обновлён', edited.kg === 2000 && edited.cost === 100000 && edited.avgPrice === 50 &&
    edited.specification === 'СП-77' && edited.specificationKey === 'СП-77' && edited.clientId === 1,
    JSON.stringify({ kg: edited.kg, cost: edited.cost, avg: edited.avgPrice, spec: edited.specification }));

  as('Admin');
  check('админ правит любой заказ', run('canEditOrder(orders.find(o => o.id === 2))') === true);
  as('lead');
  check('руководитель правит любой заказ', run('canEditOrder(orders.find(o => o.id === 2))') === true);

  /* ================= 4. Фильтр «Месяц» (П.28) ================= */
  as('manager');
  run('ordersDateFrom = null; ordersDateTo = null');
  check('границы текущего месяца', JSON.stringify(run('ordersMonthBounds()')) ===
    JSON.stringify({ from: monthStart, to: monthEnd }), monthStart + '..' + monthEnd);
  run('setOrdersPeriodMonth()');
  check('фильтр «Месяц» выставлен', run('ordersDateFrom') === monthStart && run('ordersDateTo') === monthEnd);
  run('ordersTab = "orders"');
  check('заказ этого месяца в выборке', run('filteredOrders().some(o => o.id === 1)') === true);
  check('старый заказ вне выборки', run('filteredOrders().some(o => o.id === 2)') === false);
  run('resetOrdersFilters()');
  check('сброс фильтров возвращает все свои заказы', run('filteredOrders().length') === 1,
    'видно: ' + run('filteredOrders().length'));

  /* ================= 5. Обеспеченные профили из «Готовности» (П.19) ================= */
  run(`
    readinessStatus = { available: true, asOfDate: '2026-10-01', ageDays: 0 };
    readinessByKey = {
      'СП-77': { specification: 'СП-77', status: 'В работе', statusCode: 'in_progress',
                 readiness: 50, planQty: 1000, stockQty: 500, shippedQty: 0,
                 stockWeight: 125.5, shippedWeight: 24.5, positions: [], overdueDays: 0 }
    };
    readinessLookupKey = 'СП-77';
  `);
  const cell = run('orderReadinessCellHtml(orders.find(o => o.id === 1))');
  check('в ячейке готовности есть обеспечено штук (S)', /обеспечено: 500 шт/.test(cell), cell.slice(0, 160));
  check('в ячейке готовности есть обеспечено КГ (T)', /150 кг/.test(cell), cell.slice(0, 160));
  check('ячейка помечена классом readiness-qty', /readiness-qty/.test(cell));

  /* ================= 6. Поиск клиента с автокомплитом (П.20) ================= */
  as('manager');
  run('ordersTab = "orders"; ordersClientFilter = ""; renderOrdersTab()');
  check('в «Заказах» поле поиска клиента', /orderClientFilterInput/.test(el('ordersTabBody').innerHTML));
  run('onOrderClientFilterInput("Ромаш")');
  check('автокомплит находит клиента', /data-id="1"/.test(el('orderClientFilterDropdown').innerHTML));
  run('selectOrdersClientFilter(1, "ООО Ромашка")');
  check('фильтр по клиенту выбран', run('ordersClientFilter') === '1');
  check('в поле подставлено название клиента', /value="ООО Ромашка"/.test(el('ordersTabBody').innerHTML));

  run('ordersTab = "matrices"; matricesClientFilter = ""; renderMatricesTab()');
  check('в «Матрицах» поле поиска клиента', /matrixClientFilterInput/.test(el('ordersTabBody').innerHTML));
  run('onMatrixClientFilterInput("Васил")');
  check('автокомплит матриц находит клиента', /data-id="2"/.test(el('matrixClientFilterDropdown').innerHTML));
  run('selectMatricesClientFilter(2, "АО Василёк")');
  check('фильтр матриц по клиенту выбран', run('matricesClientFilter') === '2');

  console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки заказов и матриц пройдены');
  process.exitCode = failures ? 1 : 0;
})().catch(err => {
  console.error('Ошибка теста: ' + err.message + '\n' + (err.stack || ''));
  process.exitCode = 1;
});
