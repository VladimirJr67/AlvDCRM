/* ============================================================
   js/auth.js — авторизация и постоянная сессия.
   Сессия хранится в LocalStorage: при F5/перезапуске пользователь
   остаётся в системе. Выход — только кнопкой «Выйти».
   ============================================================ */

function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (s && typeof s === 'object' && s.login) return s;
  } catch (e) {}
  return null;
}

function saveSessionFor(u) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    userId: u.id, login: u.login, name: u.name, role: u.role
  }));
}

// Восстановление сессии при загрузке приложения.
function restoreSession() {
  const s = getSession();
  if (!s) return false;
  const u = findUserByLogin(s.login);
  if (!u) {
    localStorage.removeItem(SESSION_KEY);
    return false;
  }
  currentUser = u;
  return true;
}

async function doLogin() {
  const l = document.getElementById('loginInput').value.trim();
  const p = document.getElementById('passwordInput').value.trim();
  const u = findUserByLogin(l);
  if (u && u.password === p) {
    currentUser = u;
    saveSessionFor(u);
    document.getElementById('loginError').style.display = 'none';
    await enterApp();
  } else {
    document.getElementById('loginError').style.display = 'block';
  }
}

function doLogout() {
  localStorage.removeItem(SESSION_KEY);
  currentUser = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('loginError').style.display = 'none';
  // Форма входа всегда пустая: логин и пароль не подставляются.
  document.getElementById('passwordInput').value = '';
  document.getElementById('loginInput').value = '';
  document.getElementById('loginInput').focus();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('passwordInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') doLogin();
  });
});
