/* ============================================================
   js/auth.js — авторизация и постоянная сессия.

   Сессия серверная: при входе сервер выдаёт httpOnly cookie
   (access на 30 минут + refresh на 90 дней), поэтому F5, долгая
   пауза и даже перезапуск сервера пользователя не разлогинивают —
   access-токен обновляется по refresh-токену автоматически.
   Выход — только кнопкой «Выйти».

   LocalStorage остаётся запасным каналом: он нужен, когда приложение
   открыто как файл (file://) или сервер недоступен.

   Файлы cookie клиентскому коду не видны — это и есть смысл httpOnly:
   сессию подтверждает только сервер (см. /api/auth/* в server.js).
   ============================================================ */

let sessionKeepAliveTimer = null;  // продление сессии, пока окно открыто

const SESSION_KEEP_ALIVE_MS = 20 * 60 * 1000; // раз в 20 минут

/* ===== Запасной локальный канал (file:// или сервер недоступен) ===== */

function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (s && typeof s === 'object' && s.login) return s;
  } catch (e) {}
  return null;
}

function saveSessionFor(u) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    userId: u.id, login: u.login, name: u.name, role: normalizeRole(u.role)
  }));
}

function clearLocalSession() {
  localStorage.removeItem(SESSION_KEY);
}

/* ===== Серверная сессия ===== */

// Ответ сервера приводим к трём понятным состояниям:
//   'ok'      — сессия есть, user заполнен;
//   'none'    — сервер жив и явно сказал, что сессии нет (401);
//   'denied'  — сервер отказал во входе (неверный логин или пароль);
//   'offline' — сервер недоступен (file:// или нет связи).
async function authRequest(path, options) {
  const opts = Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options || {});
  try {
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401) return { status: (data && data.error === 'Неверный логин или пароль') ? 'denied' : 'none' };
    if (!res.ok) return { status: 'offline', error: (data && data.error) || ('HTTP ' + res.status) };
    if (data && data.ok && data.user) return { status: 'ok', user: data.user };
    if (data && data.ok) return { status: 'ok', user: null };
    return { status: 'none' };
  } catch (e) {
    return { status: 'offline' };
  }
}

function serverLogin(login, password) {
  return authRequest('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: login, password: password })
  });
}

function serverSession() {
  return authRequest('/api/auth/me');
}

function serverRefresh() {
  return authRequest('/api/auth/refresh', { method: 'POST' });
}

// Завершение сессии на сервере. keepalive — чтобы запрос успел уйти,
// даже если сразу после него страница перезагружается.
async function endServerSession() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', keepalive: true });
  } catch (e) { /* сервер недоступен — cookie всё равно перезапишутся при следующем входе */ }
}

/* ===== Восстановление сессии при загрузке страницы ===== */

// Вызывается из js/app.js до enterApp(). Возвращает true, если пользователь
// уже вошёл: после F5 вход не теряется ни при истёкшем access-токене, ни
// после перезапуска сервера.
async function restoreSession() {
  const result = await serverSession();

  if (result.status === 'ok' && result.user) {
    // Серверная сессия главнее локальной копии: синхронизируем её.
    currentUser = result.user;
    saveSessionFor(result.user);
    return true;
  }
  if (result.status === 'none') {
    // Сервер жив, сессии нет (истёк refresh, отозвали вход) — нужен логин.
    clearLocalSession();
    return false;
  }

  // Сервер недоступен: работаем на локальной сессии (режим file://).
  const s = getSession();
  if (!s) return false;
  const u = findUserByLogin(s.login);
  if (!u) {
    clearLocalSession();
    return false;
  }
  currentUser = u;
  return true;
}

/* ===== Вход и выход ===== */

function loginError(show) {
  const box = document.getElementById('loginError');
  if (box) box.style.display = show ? 'block' : 'none';
}

function clearLoginForm() {
  const login = document.getElementById('loginInput');
  const password = document.getElementById('passwordInput');
  if (password) password.value = '';
  if (login) login.value = '';
}

async function doLogin() {
  const loginInput = document.getElementById('loginInput');
  const passwordInput = document.getElementById('passwordInput');
  const button = document.querySelector('#loginForm button');
  const l = loginInput ? loginInput.value.trim() : '';
  const p = passwordInput ? passwordInput.value : '';

  if (button) button.disabled = true;
  try {
    // 1. Вход через сервер: cookie httpOnly, вход живёт между перезагрузками.
    const result = await serverLogin(l, p);

    if (result.status === 'ok') {
      const user = result.user || findUserByLogin(l);
      if (!user) { loginError(true); return; }
      currentUser = user;
      saveSessionFor(user);
      loginError(false);
      clearLoginForm();
      await enterApp();
      startSessionKeepAlive();
      return;
    }

    if (result.status === 'denied') {
      loginError(true);
      return;
    }

    // 2. Сервер недоступен (file://) — проверяем пароль по локальным данным.
    const u = findUserByLogin(l);
    if (u && u.password === p) {
      currentUser = u;
      saveSessionFor(u);
      loginError(false);
      clearLoginForm();
      await enterApp();
      return;
    }
    loginError(true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function doLogout() {
  // Сначала гасим серверную сессию, затем локальную копию и интерфейс.
  await endServerSession();
  stopSessionKeepAlive();
  clearLocalSession();
  currentUser = null;

  document.getElementById('app').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  loginError(false);
  // Форма входа всегда пустая: логин и пароль не подставляются.
  clearLoginForm();
  const loginInput = document.getElementById('loginInput');
  if (loginInput) loginInput.focus();
}

/* ===== Продление сессии ===== */

// Пока окно открыто, раз в 20 минут подтверждаем сессию: сервер продлевает
// refresh-токен и обновляет access-cookie. Если сервер сообщил, что сессии
// больше нет, — выходим (вход отозван администратором или истёк).
function startSessionKeepAlive() {
  if (sessionKeepAliveTimer) return;
  sessionKeepAliveTimer = setInterval(async () => {
    if (!currentUser) return;
    if (!apiAvailable()) return;
    const result = await serverRefresh();
    if (result.status === 'none') doLogout();
  }, SESSION_KEEP_ALIVE_MS);
}

function stopSessionKeepAlive() {
  if (!sessionKeepAliveTimer) return;
  clearInterval(sessionKeepAliveTimer);
  sessionKeepAliveTimer = null;
}

/* ===== Мелкие обработчики формы ===== */

document.addEventListener('DOMContentLoaded', () => {
  const passwordInput = document.getElementById('passwordInput');
  if (passwordInput) {
    passwordInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') doLogin();
    });
  }
  // Форма входа при открытии всегда пустая, даже если браузер восстановил
  // страницу из кэша (bfcache) с прежними значениями.
  clearLoginForm();
});

window.addEventListener('pageshow', event => {
  if (!currentUser) clearLoginForm();
  // Возврат из bfcache: проверяем, жива ли серверная сессия.
  if (event.persisted && currentUser) serverSession();
});
