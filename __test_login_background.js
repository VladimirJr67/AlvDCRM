/* ============================================================
   __test_login_background.js — фон страницы входа (server side).

   Требует запущенного сервера:
     PORT=3100 node server.js --no-open
     PORT=3100 node __test_login_background.js

   Проверяет инъекцию window.__LOGIN_BACKGROUND__ в index.html:
   пустой конфиг → null (стандартный фон), заданный путь → путь.
   Конфиг config.local.json восстанавливается после теста.
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3100;
const HOST = '127.0.0.1';
const CONFIG = path.join(__dirname, 'config.local.json');

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
}

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, method: 'GET', path: pathname }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  console.log('\nФон страницы входа');

  // Резервная копия конфига (если есть).
  let original = null;
  try { original = fs.readFileSync(CONFIG, 'utf8'); } catch (e) { original = null; }

  try {
    // 1. Пустой конфиг → null (текущий стандартный фон).
    let cfg = {};
    try { cfg = JSON.parse(original || '{}'); } catch (e) { cfg = {}; }
    delete cfg.loginBackground;
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), 'utf8');

    let r = await get('/');
    check('index.html отдаётся', r.status === 200 && /loginScreen/.test(r.body));
    check('пустой конфиг → __LOGIN_BACKGROUND__=null', /window\.__LOGIN_BACKGROUND__=null/.test(r.body));

    // 2. Заданный путь → инъекция пути.
    cfg.loginBackground = '/assets/login/photo.jpg';
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), 'utf8');
    r = await get('/');
    check('заданный путь → инъекция пути',
      /window\.__LOGIN_BACKGROUND__="\/assets\/login\/photo\.jpg"/.test(r.body),
      (r.body.match(/__LOGIN_BACKGROUND__=[^;]+/) || [''])[0]);

    // 3. MIME для фоновых файлов (webp/mp4/webm) объявлены в карте сервера.
    const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    check('MIME: webp объявлен', /'\.webp':\s*'image\/webp'/.test(serverSrc));
    check('MIME: mp4 объявлен', /'\.mp4':\s*'video\/mp4'/.test(serverSrc));
    check('MIME: webm объявлен', /'\.webm':\s*'video\/webm'/.test(serverSrc));
  } finally {
    // Восстановить конфиг в исходное состояние.
    if (original === null) {
      try { fs.unlinkSync(CONFIG); } catch (e) {}
    } else {
      fs.writeFileSync(CONFIG, original, 'utf8');
    }
  }

  console.log(failures ? `\n  Провалов: ${failures}` : '\n  Все проверки фона входа пройдены');
  process.exit(failures ? 1 : 0);
})().catch(err => {
  console.error('Ошибка теста: ' + err.message);
  process.exit(1);
});
