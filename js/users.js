/* ============================================================
   js/users.js — учётные записи, роли и текущий пользователь.
   Пароли хранятся открыто: система локальная, администратору
   нужен видимый список логинов/паролей (по ТЗ).
   ============================================================ */

let users = [];
let currentUser = null;

const SESSION_KEY = 'alvid_crm_session';
const USERS_KEY = 'alvid_crm_users';

const DEFAULT_USERS = [
  { id: 1, login: 'Admin', password: 'Admin', role: 'admin', name: 'Администратор', position: '' },
  { id: 2, login: 'manager', password: 'manager', role: 'user', name: 'Менеджер', position: '' }
];

function loadUsers() {
  const saved = localStorage.getItem(USERS_KEY);
  if (saved) {
    try { users = JSON.parse(saved); } catch (e) { users = []; }
  }
  if (!users.length) {
    users = DEFAULT_USERS.map(u => ({ ...u }));
    saveUsers();
  }
}

function saveUsers() {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  queueServerSave();
}

function findUserById(id) {
  return users.find(u => u.id === id);
}

function findUserByLogin(login) {
  return users.find(u => u.login.toLowerCase() === String(login).toLowerCase());
}

// Роли системы: администратор и менеджер по продажам (role === 'user').
// Отдельного значения role для менеджера нет — так модель остаётся прежней.
function userRoleLabel(u) {
  return (u && u.role === 'admin') ? 'Администратор' : 'Менеджер по продажам';
}

function isManagerRole(u) {
  return !!u && u.role !== 'admin';
}

// Должность пользователя. Если не заполнена — показываем роль,
// чтобы подпись никогда не оставалась пустой.
function userPositionLabel(u) {
  if (!u) return '';
  return (u.position || '').trim() || userRoleLabel(u);
}

// Подпись для выбора коллег: «ФИО — Должность».
function userDisplayName(u) {
  if (!u) return '';
  const name = (u.name || u.login || '').trim();
  const pos = userPositionLabel(u);
  return pos ? name + ' — ' + pos : name;
}

// Поиск пользователей по ФИО, логину и должности (выбор соисполнителя).
// excludeIds — кого не показывать (например, уже выбранных).
function searchUsers(query, excludeIds) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  const skip = excludeIds || [];
  return users.filter(u => {
    if (skip.indexOf(u.id) > -1) return false;
    if (!q) return true;
    return (u.name || '').toLowerCase().includes(q)
      || (u.login || '').toLowerCase().includes(q)
      || (u.position || '').toLowerCase().includes(q)
      || userPositionLabel(u).toLowerCase().includes(q);
  });
}

// Права определяются строго ролью из актуального массива users.
// Ни сессия, ни LocalStorage не могут «подарить» доступ: роль всегда
// перечитывается из последних данных (после поллинга/гидрации).
function isAdmin() {
  if (!currentUser) return false;
  const live = findUserById(currentUser.id) || findUserByLogin(currentUser.login);
  return !!(live && live.role === 'admin');
}

// Проверка, что изменения не сломают систему: нельзя удалить/понизить
// последнего администратора.
function countAdmins() {
  return users.filter(u => u.role === 'admin').length;
}

function addUser(data) {
  if (!data.login || !data.password) return { ok: false, error: 'Заполните логин и пароль' };
  if (findUserByLogin(data.login)) return { ok: false, error: 'Логин уже занят' };
  const maxId = users.reduce((m, u) => Math.max(m, u.id || 0), 0);
  users.push({
    id: maxId + 1,
    login: data.login.trim(),
    password: data.password,
    role: data.role === 'admin' ? 'admin' : 'user',
    name: (data.name || '').trim() || data.login.trim(),
    position: (data.position || '').trim()
  });
  saveUsers();
  return { ok: true };
}

function updateUser(id, data) {
  const u = findUserById(id);
  if (!u) return { ok: false, error: 'Пользователь не найден' };

  const newLogin = data.login.trim();
  const dup = findUserByLogin(newLogin);
  if (dup && dup.id !== id) return { ok: false, error: 'Логин уже занят' };

  const newRole = data.role === 'admin' ? 'admin' : 'user';
  // Нельзя понизить последнего администратора
  if (u.role === 'admin' && newRole !== 'admin' && countAdmins() <= 1) {
    return { ok: false, error: 'Нельзя понизить последнего администратора' };
  }

  u.login = newLogin;
  if (data.password) u.password = data.password;
  u.role = newRole;
  u.name = (data.name || '').trim() || newLogin;
  u.position = (data.position || '').trim();

  // Если правим текущего пользователя — обновляем сессию
  if (currentUser && currentUser.id === id) {
    currentUser = u;
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      userId: u.id, login: u.login, name: u.name, role: u.role
    }));
  }
  saveUsers();
  return { ok: true };
}

function deleteUser(id) {
  const u = findUserById(id);
  if (!u) return { ok: false, error: 'Пользователь не найден' };
  if (currentUser && currentUser.id === id) return { ok: false, error: 'Нельзя удалить собственную учётную запись' };
  if (u.role === 'admin' && countAdmins() <= 1) return { ok: false, error: 'Нельзя удалить последнего администратора' };

  users = users.filter(x => x.id !== id);

  // Снять назначения задач с удалённого пользователя
  tasks.forEach(t => {
    if (t.assignedTo === id) { t.assignedTo = null; t.assignedBy = null; t.assignedAt = null; t.assignmentStatus = null; }
  });
  notifications = notifications.filter(n => n.userId !== id);
  saveUsers();
  saveTasks();
  saveNotifications();
  return { ok: true };
}
