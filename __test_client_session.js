/* ============================================================
   __test_client_session.js — проверка клиентской логики сессии
   (js/auth.js) без браузера: модуль выполняется в vm, запросы идут
   на реально запущенный сервер, cookie хранит заглушка fetch.

   Запуск:  PORT=3100 node __test_client_session.js
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PORT = Number(process.env.PORT) || 3100;
const BASE = 'http://127.0.0.1:' + PORT;

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
}

// --- Заглушки браузерного окружения ---
const jar = {};
const store = {};
const elements = {
  loginInput: { value: '', style: {}, focus() {}, addEventListener() {} },
  passwordInput: { value: '', style: {}, focus() {}, addEventListener() {} },
  loginError: { style: {}, textContent: '' },
  app: { style: {} },
  loginScreen: { style: {} }
};

const sandbox = {
  console,
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: {
    getElementById: id => elements[id] || null,
    querySelector: () => ({ disabled: false }),
    addEventListener: () => {}
  },
  window: { addEventListener: () => {}, location: { protocol: 'http:' } },
  apiAvailable: () => true,
  enterAppCalls: 0
};
sandbox.enterApp = async () => { sandbox.enterAppCalls++; };

// fetch с ручным «cookie-jar»: Node сам cookie не хранит, браузер хранит.
sandbox.fetch = async (url, options) => {
  const opts = options || {};
  const headers = Object.assign({}, opts.headers || {});
  const cookie = Object.keys(jar).filter(k => jar[k]).map(k => k + '=' + jar[k]).join('; ');
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + url, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body
  });
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.raw ? res.headers.raw()['set-cookie'] || [] : []);
  setCookies.forEach(line => {
    const pair = line.split(';')[0];
    const i = pair.indexOf('=');
    if (i < 0) return;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (!value || /Max-Age=0/i.test(line)) delete jar[name];
    else jar[name] = value;
  });
  let json = null;
  try { json = await res.clone().json(); } catch (e) { json = null; }
  return { status: res.status, ok: res.ok, json: async () => json };
};

const context = vm.createContext(sandbox);
const read = f => fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');

// Порядок тот же, что в index.html: сначала учётные записи, затем авторизация.
vm.runInContext(read('users.js'), context, { filename: 'users.js' });
vm.runInContext(read('auth.js'), context, { filename: 'auth.js' });

// Пользователи, как после гидратации базы (роль менеджера — уже 'manager').
vm.runInContext(`
  users = [
    { id: 1, login: 'Admin', password: 'Admin', role: 'admin', name: 'Администратор' },
    { id: 2, login: 'manager', password: 'qwer1234', role: 'manager', name: 'Менеджер' }
  ];
  currentUser = null;
`, context);

const run = code => vm.runInContext(code, context);

(async () => {
  console.log('\nКлиентская логика сессии (js/auth.js) против сервера на ' + BASE);

  // 1. Неверный пароль
  elements.loginInput.value = 'manager';
  elements.passwordInput.value = 'не тот пароль';
  await run('doLogin()');
  check('неверный пароль: вход не выполнен', run('currentUser') === null, 'currentUser=' + (run('currentUser') && run('currentUser').login));
  check('неверный пароль: показана ошибка', elements.loginError.style.display === 'block');

  // 2. Верный пароль — вход через сервер
  elements.passwordInput.value = 'qwer1234';
  await run('doLogin()');
  const user = run('currentUser');
  check('верный пароль: вход выполнен', !!user && user.login === 'manager', user ? user.login + '/' + user.role : 'нет пользователя');
  check('верный пароль: enterApp вызван', sandbox.enterAppCalls === 1, 'вызовов: ' + sandbox.enterAppCalls);
  check('cookie получены сервером', !!(jar.alvid_sid && jar.alvid_refresh), Object.keys(jar).join(','));
  check('пароль не сохранён в объекте пользователя', user && user.password === undefined);
  check('локальная копия сессии записана', !!store.alvid_crm_session && JSON.parse(store.alvid_crm_session).role === 'manager');

  // 3. F5: access-cookie протух (браузер её выбрасывает), refresh остался
  delete jar.alvid_sid;
  run('currentUser = null');
  const restored = await run('restoreSession()');
  check('F5 с истёкшим access: вход сохраняется', restored === true);
  check('F5: выдан новый access-cookie', !!jar.alvid_sid);
  check('F5: пользователь восстановлен', (run('currentUser') || {}).login === 'manager');

  // 4. Полный выход
  await run('doLogout()');
  check('выход: currentUser сброшен', run('currentUser') === null);
  check('выход: cookie сняты', !jar.alvid_sid && !jar.alvid_refresh, Object.keys(jar).join(',') || 'пусто');
  check('выход: локальная копия удалена', !store.alvid_crm_session);
  check('выход: форма входа пустая', elements.loginInput.value === '' && elements.passwordInput.value === '');
  check('выход: экран входа показан', elements.loginScreen.style.display === 'flex');

  // 5. Загрузка страницы без сессии
  const restoredAnon = await run('restoreSession()');
  check('без сессии: показан экран входа', restoredAnon === false);

  console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки клиентской сессии пройдены');
  // Код возврата выставляем без process.exit(): в этом тесте глобальные
  // таймеры подменены заглушками, и принудительный выход роняет процесс Node.
  process.exitCode = failures ? 1 : 0;
})().catch(err => {
  console.error('Ошибка теста: ' + err.message);
  process.exitCode = 1;
});
