/* ============================================================
   __test_auth.js — проверка сессии: вход, refresh, выход.

   Запуск (сервер уже поднят на PORT, по умолчанию 3100):

     node __test_auth.js phase1 <файл-с-cookie>   — вход и проверки cookie
     node __test_auth.js phase2 <файл-с-cookie>   — после перезапуска сервера
                                                    сессия жива, затем выход

   Зависимостей нет: только http из стандартной библиотеки Node.
   ============================================================ */

const http = require('http');
const fs = require('fs');

const PORT = Number(process.env.PORT) || 3100;
const HOST = '127.0.0.1';

let failures = 0;

function check(name, ok, extra) {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures++;
  console.log(`  [${mark}] ${name}${extra ? ' — ' + extra : ''}`);
}

function request(method, path, options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, opts.headers || {});
    if (opts.cookie) headers.Cookie = opts.cookie;
    let payload = null;
    if (opts.body !== undefined) {
      payload = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ host: HOST, port: PORT, method, path, headers }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = null; }
        const setCookies = res.headers['set-cookie'] || [];
        resolve({ status: res.statusCode, json, setCookies, body: data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Разбор Set-Cookie в простую карту «имя=значение» для следующих запросов.
function cookieMap(setCookies) {
  const jar = {};
  setCookies.forEach(line => {
    const pair = line.split(';')[0];
    const i = pair.indexOf('=');
    if (i < 0) return;
    jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  });
  return jar;
}

function cookieHeader(jar) {
  return Object.keys(jar).filter(k => jar[k]).map(k => k + '=' + jar[k]).join('; ');
}

async function phase1(jarPath) {
  console.log('Фаза 1 — вход и работа с cookie (сервер уже запущен)');

  // 1. Неверный пароль
  const bad = await request('POST', '/api/auth/login', { body: { login: 'manager', password: 'неверный' } });
  check('неверный пароль → 401', bad.status === 401, 'HTTP ' + bad.status);
  check('при отказе cookie не выдаются', (bad.setCookies || []).length === 0);

  // 2. Вход менеджера: роль должна прийти уже как manager (миграция 'user' → 'manager')
  const login = await request('POST', '/api/auth/login', { body: { login: 'manager', password: 'qwer1234' } });
  check('вход manager → 200', login.status === 200 && login.json && login.json.ok, 'HTTP ' + login.status);
  check('роль в ответе = manager', !!(login.json && login.json.user && login.json.user.role === 'manager'),
    login.json && login.json.user ? login.json.user.role : 'нет user');
  check('пароль не отдаётся клиенту', !!(login.json && login.json.user && login.json.user.password === undefined));

  const jar = cookieMap(login.setCookies || []);
  check('выданы alvid_sid и alvid_refresh', !!(jar.alvid_sid && jar.alvid_refresh), Object.keys(jar).join(','));
  const sidLine = (login.setCookies || []).find(l => l.indexOf('alvid_sid=') === 0) || '';
  const refreshLine = (login.setCookies || []).find(l => l.indexOf('alvid_refresh=') === 0) || '';
  check('access-cookie: HttpOnly + Path=/', /HttpOnly/i.test(sidLine) && /Path=\//i.test(sidLine), sidLine);
  check('refresh-cookie: HttpOnly + Path=/api/auth', /HttpOnly/i.test(refreshLine) && /Path=\/api\/auth/i.test(refreshLine), refreshLine);

  fs.writeFileSync(jarPath, JSON.stringify(jar), 'utf8');
  console.log('  cookie сохранены: ' + jarPath);

  // 3. Проверка сессии с полным набором cookie
  const me = await request('GET', '/api/auth/me', { cookie: cookieHeader(jar) });
  check('GET /me с обеими cookie → 200', me.status === 200 && me.json && me.json.ok, 'HTTP ' + me.status);

  // 4. Главный критерий: access истёк, refresh жив → F5 не разлогинивает
  const onlyRefresh = await request('GET', '/api/auth/me', { cookie: 'alvid_refresh=' + jar.alvid_refresh });
  check('GET /me только с refresh → 200 (access обновлён)', onlyRefresh.status === 200 && onlyRefresh.json && onlyRefresh.json.ok,
    'HTTP ' + onlyRefresh.status + ', refreshed=' + (onlyRefresh.json && onlyRefresh.json.refreshed));
  const renewed = cookieMap(onlyRefresh.setCookies || []);
  check('выдан новый access-cookie', !!renewed.alvid_sid);

  // 5. Подделанный access + живой refresh
  const tampered = await request('GET', '/api/auth/me', {
    cookie: 'alvid_sid=tampered.signature; alvid_refresh=' + jar.alvid_refresh
  });
  check('битый access + живой refresh → 200', tampered.status === 200, 'HTTP ' + tampered.status);

  // 6. Без cookie — доступа нет
  const anon = await request('GET', '/api/auth/me');
  check('GET /me без cookie → 401', anon.status === 401, 'HTTP ' + anon.status);

  // 7. Подделанный refresh не пускает
  const fake = await request('GET', '/api/auth/me', { cookie: 'alvid_refresh=not-a-real-token' });
  check('поддельный refresh → 401', fake.status === 401, 'HTTP ' + fake.status);

  // 8. Служебные файлы не отдаются как статика
  const dbFile = await request('GET', '/db.json');
  check('GET /db.json → 404 (база только через /api/db)', dbFile.status === 404, 'HTTP ' + dbFile.status);
  const sessFile = await request('GET', '/sessions.json');
  check('GET /sessions.json → 404', sessFile.status === 404, 'HTTP ' + sessFile.status);

  // 9. Сама база (как и раньше) доступна без сессии и содержит схему v6
  const db = await request('GET', '/api/db');
  check('GET /api/db → 200, схема v6', db.status === 200 && db.json && db.json.version === 6, 'HTTP ' + db.status);

  console.log(failures ? `\n  Итог фазы 1: провалов ${failures}` : '\n  Итог фазы 1: все проверки пройдены');
  return failures;
}

async function phase2(jarPath) {
  console.log('Фаза 2 — сессия после перезапуска сервера, затем выход');
  const jar = JSON.parse(fs.readFileSync(jarPath, 'utf8'));

  // 1. Сервер перезапущен, access-cookie протух вместе с процессом, refresh жив
  const me = await request('GET', '/api/auth/me', { cookie: 'alvid_refresh=' + jar.alvid_refresh });
  check('после перезапуска сервера GET /me → 200', me.status === 200 && me.json && me.json.ok,
    'HTTP ' + me.status + ', пользователь: ' + (me.json && me.json.user ? me.json.user.login : '—'));

  // 2. Явный вызов refresh
  const refreshed = await request('POST', '/api/auth/refresh', { cookie: 'alvid_refresh=' + jar.alvid_refresh });
  check('POST /api/auth/refresh → 200', refreshed.status === 200 && refreshed.json && refreshed.json.ok, 'HTTP ' + refreshed.status);

  // 3. Выход
  const logout = await request('POST', '/api/auth/logout', { cookie: cookieHeader(jar) });
  check('POST /api/auth/logout → 200', logout.status === 200 && logout.json && logout.json.ok, 'HTTP ' + logout.status);
  const cleared = cookieMap(logout.setCookies || []);
  check('cookie сбрасываются (Max-Age=0)', (logout.setCookies || []).every(l => /Max-Age=0/i.test(l)));

  // 4. После выхода refresh больше не работает
  const after = await request('GET', '/api/auth/me', { cookie: 'alvid_refresh=' + jar.alvid_refresh });
  check('после выхода GET /me → 401', after.status === 401, 'HTTP ' + after.status);

  console.log(failures ? `\n  Итог фазы 2: провалов ${failures}` : '\n  Итог фазы 2: все проверки пройдены');
  return failures;
}

(async () => {
  const phase = process.argv[2] || 'phase1';
  const jarPath = process.argv[3] || require('path').join(require('os').tmpdir(), 'alvid_test_cookies.json');
  console.log('');
  const failed = phase === 'phase2' ? await phase2(jarPath) : await phase1(jarPath);
  process.exit(failed ? 1 : 0);
})().catch(err => {
  console.error('Ошибка теста: ' + err.message);
  process.exit(1);
});
