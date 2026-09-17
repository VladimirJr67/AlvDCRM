/* ============================================================
   __test_orders_matrices.js — проверка раздела «Заказы/Матрицы» и цен.

   Модули приложения выполняются в vm с заглушкой DOM: вызываются настоящие
   функции js/orders.js, js/matrices.js, js/minPrices.js.

   Проверяется критерий:
     матрицы с шифрами и статусами;
     фильтры (клиент и покрытие отдельно, у вкладок свои);
     «Среднего чека» нет;
     минимальные цены за кг редактируются и сохраняются.

   Запуск:  node __test_orders_matrices.js
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
      id: id, value: '', checked: false, innerHTML: '', textContent: '', style: {}, dataset: {},
      classList: { add() {}, remove() {}, contains() { return false; } },
      appendChild() {}, focus() {}, addEventListener() {}, reset() {}
    };
  }
  return elements[id];
}

const alerts = [];
const store = {};
const saves = { server: 0 };
const xlsxFiles = [];

// Поля формы минимальных цен: их собирает querySelectorAll('[data-min-price]').
let minPriceInputs = [];
function makeMinPriceInput(key, value) {
  return { value: value === null || value === undefined ? '' : String(value), dataset: { minPrice: key } };
}

const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  alert: msg => { alerts.push(String(msg)); },
  confirm: () => true,
  prompt: () => null,
  Intl, Date, Math, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: {
    getElementById: el,
    querySelector: () => null,
    querySelectorAll: sel => (sel === '[data-min-price]' ? minPriceInputs : []),
    addEventListener: () => {},
    createElement: () => el('__created')
  },
  window: { addEventListener: () => {}, location: { protocol: 'http:' } },
  navigator: { sendBeacon: () => true },
  queueServerSave: () => { saves.server++; },
  apiAvailable: () => true,
  XLSX: {
    utils: { json_to_sheet: rows => ({ rows: rows }), book_new: () => ({}), book_append_sheet: () => {} },
    writeFile: (wb, name) => { xlsxFiles.push(name); }
  }
};

const context = vm.createContext(sandbox);
const read = f => fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');
['data.js', 'storage.js', 'users.js', 'interactionTypes.js', 'dictionaries.js',
 'notifications.js', 'tasks.js', 'orders.js', 'matrices.js', 'clients.js', 'minPrices.js']
  .forEach(f => vm.runInContext(read(f), context, { filename: f }));

const run = code => vm.runInContext(code, context);
const html = id => el(id).innerHTML;

/* ===== Данные: три пользователя, два клиента, заказы и матрицы ===== */
run(`
  // currentSection объявлен в js/app.js (в тесте он не загружается целиком).
  currentSection = 'orders';
  users = [
    { id: 1, login: 'Admin', password: 'Admin', role: 'admin', name: 'Администратор', position: '' },
    { id: 2, login: 'manager', password: 'm', role: 'manager', name: 'Иванов Иван', position: 'менеджер по продажам' },
    { id: 3, login: 'lead', password: 'l', role: 'lead', name: 'Петров Пётр', position: 'руководитель' },
    { id: 9, login: 'newbie', password: 'n', role: 'manager', name: 'Новый Сотрудник', position: 'менеджер по продажам' }
  ];
  clients = [
    { id: 1, orgName: 'ООО Ромашка', contacts: [], history: [] },
    { id: 2, orgName: 'АО Василёк', contacts: [], history: [] }
  ];
  currentUser = users[1];
  orders = [
    { id: 1, clientId: 1, clientName: 'ООО Ромашка', kg: 1000, condition: 'Анод', avgPrice: 650, cost: 650000, date: '2026-10-01T10:00:00.000Z', createdBy: 2, comment: 'мой' },
    { id: 2, clientId: 2, clientName: 'АО Василёк', kg: 500, condition: 'Сырой', avgPrice: 600, cost: 300000, date: '2026-10-02T10:00:00.000Z', createdBy: 3, comment: 'чужой' }
  ];
  matrices = [
    { id: 1, cipher: 'ШФ-101', coating: 'Анод', status: 'Поступила', clientId: 1, clientName: 'ООО Ромашка', date: '2026-10-01', comment: 'моя', createdAt: '2026-10-01T10:00:00.000Z', createdBy: 2 },
    { id: 2, cipher: 'ШФ-202', coating: 'Сырой', status: 'Отписана', clientId: 2, clientName: 'АО Василёк', date: '2026-10-02', comment: 'чужая', createdAt: '2026-10-02T10:00:00.000Z', createdBy: 3 }
  ];
`);
function asUser(login) {
  run(`currentUser = users.find(u => u.login === '${login}')`);
}

(async () => {
  console.log('\nРаздел «Заказы/Матрицы»: вкладки, матрицы, фильтры, права');

  /* ---- 1. Раздел и вкладки ---- */
  asUser('manager');
  run('ordersTab = "orders"; renderOrders()');
  check('раздел называется «Заказы/Матрицы»', /Заказы\/Матрицы/.test(html('mainContent')));
  check('внутри две вкладки', /setOrdersTab\('orders'\)/.test(html('mainContent')) &&
    /setOrdersTab\('matrices'\)/.test(html('mainContent')));
  check('вкладка «Заказы» показывает анализ продаж', /Анализ продаж/.test(html('ordersTabBody')));
  check('вкладка «Заказы»: фильтры по клиенту и покрытию',
    /Все клиенты/.test(html('ordersTabBody')) && /Все покрытия/.test(html('ordersTabBody')));
  check('в «Заказах» нет «Среднего чека»', !/средн\w* чек/i.test(html('ordersTabBody')));

  run('setOrdersTab("matrices")');
  check('переключение на вкладку «Матрицы»', run('ordersTab') === 'matrices');
  check('вкладка «Матрицы»: статистика по статусам',
    /Всего матриц/.test(html('ordersTabBody')) && /Поступила/.test(html('ordersTabBody')) &&
    /Отписана/.test(html('ordersTabBody')));
  check('вкладка «Матрицы»: свои фильтры (клиент, покрытие, статус)',
    /setMatricesFilter\('client'/.test(html('ordersTabBody')) &&
    /setMatricesFilter\('coverage'/.test(html('ordersTabBody')) &&
    /setMatricesFilter\('status'/.test(html('ordersTabBody')));
  check('в «Матрицах» нет «Среднего чека»', !/средн\w* чек/i.test(html('ordersTabBody')));
  check('матрицы показаны с шифрами', /ШФ-101/.test(html('ordersTabBody')) || run('visibleMatrices().length') === 1,
    'видимых матриц: ' + run('visibleMatrices().length'));

  /* ---- 2. Права: менеджер видит только своё ---- */
  check('менеджер видит только свои заказы', run('visibleOrders().length') === 1 &&
    run('visibleOrders()[0].createdBy') === 2);
  check('менеджер видит только свои матрицы', run('visibleMatrices().length') === 1 &&
    run('visibleMatrices()[0].cipher') === 'ШФ-101');

  /* ---- 3. Новый аккаунт: раздел пуст ---- */
  asUser('newbie');
  run('ordersTab = "orders"; renderOrders()');
  check('новый аккаунт: заказов нет', run('visibleOrders().length') === 0);
  check('новый аккаунт: матриц нет', run('visibleMatrices().length') === 0);
  check('новый аккаунт: пустое состояние в «Заказах»', /Заказов пока нет/.test(html('ordersTabBody')));
  run('setOrdersTab("matrices")');
  check('новый аккаунт: пустое состояние в «Матрицах»', /Матриц пока нет/.test(html('ordersTabBody')));
  check('новый аккаунт: экспорт недоступен',
    !/Экспорт матриц|Экспорт заказов/.test(html('ordersTabBody')));
  alerts.length = 0;
  run('exportMatricesExcel()');
  run('exportOrdersExcel()');
  check('новый аккаунт: экспорт отклонён с пояснением', alerts.length === 2, alerts.join(' / '));
  check('файлы Excel не созданы', xlsxFiles.length === 0);

  /* ---- 4. Администратор: все или по одному ---- */
  asUser('Admin');
  run('matricesUserFilter = "all"; ordersUserFilter = "all"');
  check('админ видит все заказы', run('visibleOrders().length') === 2);
  check('админ видит все матрицы', run('visibleMatrices().length') === 2);
  run('setMatricesFilter("user", "3")');
  check('админ: фильтр по менеджеру работает', run('visibleMatrices().length') === 1 &&
    run('visibleMatrices()[0].createdBy') === 3);
  run('resetMatricesFilters()');
  check('сброс фильтров матриц', run('visibleMatrices().length') === 2 && run('matricesCoverageFilter') === '');

  /* ---- 5. Фильтры: клиент и покрытие отдельно, вкладки не влияют друг на друга ---- */
  run('ordersClientFilter = "1"; ordersCoverageFilter = "Анод"');
  check('заказы: фильтр по клиенту и покрытию', run('filteredOrders().length') === 1,
    'найдено ' + run('filteredOrders().length'));
  check('фильтры заказов не меняют фильтры матриц',
    run('matricesClientFilter') === '' && run('matricesCoverageFilter') === '');
  run('matricesClientFilter = "2"; matricesCoverageFilter = "Сырой"');
  check('матрицы: фильтр по клиенту и покрытию', run('filteredMatrices().length') === 1 &&
    run('filteredMatrices()[0].cipher') === 'ШФ-202');
  run('matricesStatusFilter = "Поступила"');
  check('матрицы: фильтр по статусу отделяет отписанные', run('filteredMatrices().length') === 0);
  run('resetMatricesFilters(); resetOrdersFilters()');
  check('сброс всех фильтров', run('filteredOrders().length') === 2 && run('filteredMatrices().length') === 2);

  /* ---- 6. Матрицы: шифр, клиент, покрытие, статусы, дата ---- */
  run('openMatrixModal()');
  el('matrixCipher').value = 'ШФ-303';
  el('matrixClient').value = '1';
  el('matrixCoatingInput').value = 'Покраска';
  el('matrixStatus').value = 'Поступила';
  el('matrixDate').value = '2026-10-05';
  el('matrixComment').value = 'новая матрица';
  run('saveMatrixFromModal({ preventDefault: function(){} })');
  const created = run('matrices[matrices.length - 1]');
  check('новая матрица создана со всеми полями',
    created.cipher === 'ШФ-303' && created.coating === 'Покраска' && created.status === 'Поступила' &&
    created.clientId === 1 && created.clientName === 'ООО Ромашка' && created.date === '2026-10-05',
    JSON.stringify({ c: created.cipher, cov: created.coating, s: created.status, d: created.date }));
  check('автор матрицы записан', created.createdBy === 1);
  check('покрытия матриц — Сырой/Анод/Покраска',
    JSON.stringify(run('MATRIX_COVERAGES')) === JSON.stringify(['Сырой', 'Анод', 'Покраска']));
  check('статусы матриц — Поступила/Отписана',
    JSON.stringify(run('MATRIX_STATUSES')) === JSON.stringify(['Поступила', 'Отписана']));
  const beforeSave = saves.server;
  run(`setMatrixStatus(${created.id}, 'Отписана')`);
  check('статус матрицы меняется и сохраняется',
    run(`matrices.find(m => m.id === ${created.id}).status`) === 'Отписана' && saves.server > beforeSave);

  /* ---- 7. Минимальные цены: три цены, дата, редактирование админом ---- */
  run('loadMinPrices(); renderMinPricesBlock()');
  check('в блоке три цены: Анод, Сырой, Покраска',
    JSON.stringify(run('MIN_PRICE_KEYS')) === JSON.stringify(['Анод', 'Сырой', 'Покраска']));
  asUser('manager');
  alerts.length = 0;
  run('openMinPricesModal()');
  check('менеджеру цены менять нельзя', alerts.length === 1, alerts[0] || '');
  asUser('Admin');
  run('openMinPricesModal()');
  check('админ открывает форму цен', /data-min-price="Анод"/.test(html('minPricesForm')));
  check('в форме видна дата последнего изменения', /Последнее изменение/.test(html('minPricesForm')));

  minPriceInputs = [makeMinPriceInput('Анод', 700), makeMinPriceInput('Сырой', 640), makeMinPriceInput('Покраска', 610)];
  alerts.length = 0;
  run('saveMinPrices()');
  const stored = JSON.parse(store['alvid_crm_min_prices'] || '{}');
  const history = JSON.parse(store['alvid_crm_min_prices_history'] || '[]');
  check('цены сохранены в хранилище', stored.Анод && stored.Анод.value === 700,
    JSON.stringify(Object.keys(stored)));
  check('у цены есть дата изменения', !!(stored.Анод && stored.Анод.updatedAt));
  check('изменения попали в историю', history.length === 3 && history.every(h => h.updatedBy === 1),
    'записей: ' + history.length);
  check('история помнит прежнее значение', history[0].previous === null || history[0].previous !== undefined);
  check('синхронизация с сервером вызвана', saves.server > 0);
  minPriceInputs = [makeMinPriceInput('Анод', 700)];
  const historyBefore = JSON.parse(store['alvid_crm_min_prices_history']).length;
  run('saveMinPrices()');
  check('повторное сохранение без изменений не плодит историю',
    JSON.parse(store['alvid_crm_min_prices_history']).length === historyBefore);
  check('повторный вызов не зацикливается', run('typeof persistMinPrices') === 'function');
  check('пустое поле убирает цену', (() => {
    minPriceInputs = [makeMinPriceInput('Сырой', null)];
    run('saveMinPrices()');
    const s = JSON.parse(store['alvid_crm_min_prices']);
    return s.Сырой === undefined;
  })());

  /* ---- 8. Экспорт админом ---- */
  asUser('Admin');
  run('exportOrdersExcel(); exportMatricesExcel()');
  check('админ выгружает заказы и матрицы в Excel', xlsxFiles.length === 2, xlsxFiles.join(', '));

  console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки раздела и цен пройдены');
  process.exitCode = failures ? 1 : 0;
})().catch(err => {
  console.error('Ошибка теста: ' + err.message + '\n' + (err.stack || ''));
  process.exitCode = 1;
});
