/* ============================================================
   __test_client_matrices.js — «Матрицы клиента» в карточке клиента.

   Проверяет: справочник прессов (5/7/8/7/8), добавление матрицы с
   привязкой к clientId, счётчик, фильтр по клиенту, открытие модалки
   и удаление.

   Запуск:  node __test_client_matrices.js
   ============================================================ */

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
      id, value: '', innerHTML: '', textContent: '', style: {},
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        contains: c => classes.has(c),
        toggle: c => { classes.has(c) ? classes.delete(c) : classes.add(c); }
      },
      appendChild() {}, focus() {}, addEventListener() {}
    };
  }
  return elements[id];
}

const alerts = [];
const store = {};
const sandbox = {
  console, alert: m => alerts.push(String(m)), confirm: () => true,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: {
    getElementById: el, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {}, createElement: () => el('__c')
  },
  queueServerSave: () => {},
  escapeHtml: s => String(s == null ? '' : s)
};

const context = vm.createContext(sandbox);
['data.js', 'matrices.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', f), 'utf8'), context, { filename: f }));

const run = code => vm.runInContext(code, context);

run(`
  clients = [{ id: 1, orgName: 'ООО Ромашка' }];
  currentUser = { id: 2, login: 'manager', role: 'manager' };
  clientMatrices = [];
`);

(async () => {
  console.log('\n«Матрицы клиента»');

  check('прессы: 5/7/8/7/8', JSON.stringify(run('CLIENT_MATRIX_PRESSES')) === JSON.stringify(['5', '7', '8', '7/8']));

  el('clientMatricesClientId').value = '1';
  el('clientMatrixCipher').value = 'ШФ-101';
  el('clientMatrixWeight').value = '12';
  el('clientMatrixPress').value = '7';
  run('addClientMatrix({ preventDefault(){} })');
  check('матрица добавлена с clientId', run('matrices.length') === 1 && run('matrices[0].clientId') === 1);
  check('поля сохранены (шифр/вес/пресс)',
    run('matrices[0].cipher') === 'ШФ-101' && run('matrices[0].weightPerM') === '12' && run('matrices[0].press') === '7');
  check('источник — ручной', run('matrices[0].source') === 'manual');
  check('счётчик обновился', String(el('clientMatricesCount').textContent) === '(1)', el('clientMatricesCount').textContent);

  el('clientMatrixCipher').value = '   ';
  alerts.length = 0;
  run('addClientMatrix({ preventDefault(){} })');
  check('пустой шифр отклонён', alerts.length === 1 && run('matrices.length') === 1);

  check('фильтр по клиенту', run('clientMatricesFor(1).length') === 1 && run('clientMatricesFor(999).length') === 0);

  run('openClientMatrices(1)');
  check('модалка открыта', el('clientMatricesModal').classList.contains('active'));
  check('заголовок с клиентом', /Ромашка/.test(el('clientMatricesModalTitle').textContent));

  const id = run('matrices[0].id');
  run(`deleteClientMatrix(${id})`);
  check('матрица удалена', run('matrices.length') === 0);
  check('счётчик обнулился', el('clientMatricesCount').textContent === '');

  console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки матриц клиента пройдены');
  process.exitCode = failures ? 1 : 0;
})().catch(err => {
  console.error('Ошибка теста: ' + err.message + '\n' + (err.stack || ''));
  process.exitCode = 1;
});
