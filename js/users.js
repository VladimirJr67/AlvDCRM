/* ============================================================
   js/users.js — учётные записи, роли и текущий пользователь.
   Пароли хранятся открыто: система локальная, администратору
   нужен видимый список логинов/паролей (по ТЗ).

   Роли: admin (администратор), manager (менеджер по продажам),
   lead (руководитель). Роли «technolog» в системе нет — у технологов
   отдельный контур работы, доступ в CRM им не выдаётся.
   ============================================================ */

let users = [];
let currentUser = null;

const SESSION_KEY = 'alvid_crm_session';
const USERS_KEY = 'alvid_crm_users';

// Коды ролей и их подписи. Значение 'user' — историческое обозначение
// менеджера: такие записи приводятся к 'manager' при загрузке.
// developer — супер-админ: имеет все права и управляет матрицей доступа.
const ROLE_ADMIN = 'admin';
const ROLE_MANAGER = 'manager';
const ROLE_LEAD = 'lead';
const ROLE_DEVELOPER = 'developer';

const ROLE_LABELS = {
  admin: 'Администратор',
  manager: 'Менеджер по продажам',
  lead: 'Руководитель',
  developer: 'Разработчик'
};

const ROLE_ALIASES = {
  admin: 'admin', 'администратор': 'admin',
  manager: 'manager', user: 'manager', 'менеджер': 'manager', 'менеджер по продажам': 'manager',
  lead: 'lead', head: 'lead', 'руководитель': 'lead', 'руководитель отдела': 'lead',
  developer: 'developer', dev: 'developer', 'разработчик': 'developer', 'разработчик': 'developer'
};

function normalizeRole(role) {
  const key = String(role == null ? '' : role).trim().toLowerCase();
  return ROLE_ALIASES[key] || ROLE_MANAGER;
}

const DEFAULT_USERS = [
  { id: 1, login: 'Admin', password: 'Admin', role: ROLE_ADMIN, name: 'Администратор', position: '', theme: 'light', substituteFor: null, substituteUntil: null, trackedBy: [] },
  { id: 2, login: 'manager', password: 'manager', role: ROLE_MANAGER, name: 'Менеджер', position: '', theme: 'light', substituteFor: null, substituteUntil: null, trackedBy: [] }
];

function loadUsers() {
  const saved = localStorage.getItem(USERS_KEY);
  if (saved) {
    try { users = JSON.parse(saved); } catch (e) { users = []; }
  }
  // Роли из старых локальных данных приводим к актуальным кодам.
  if (Array.isArray(users)) {
    users.forEach(u => {
      if (!u) return;
      u.role = normalizeRole(u.role);
      // trackedBy — список руководителей, отслеживающих задачи сотрудника.
      if (!Array.isArray(u.trackedBy)) u.trackedBy = [];
    });
  } else {
    users = [];
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

/* ===== Короткое имя «Фамилия И.О.» =====
   В базе ФИО записано по-разному («Владимир Куриков», «Шестернев Андрей»),
   а логин почти всегда совпадает с фамилией латиницей (Kurikov ↔ Куриков).
   Поэтому фамилию ищем по логину (через транслитерацию), а если не нашли —
   берём последнее слово (в CRM чаще «Имя Фамилия»). */

const TRANSLIT_RU = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya'
};

// Транслитерация для сравнения с логином: только латиница в нижнем регистре.
function translitRu(value) {
  return String(value == null ? '' : value).toLowerCase()
    .split('').map(ch => (ch in TRANSLIT_RU) ? TRANSLIT_RU[ch] : ch).join('')
    .replace(/[^a-z]/g, '');
}

// Фамилия по логину: «Kurikov» → «Куриков» из «Владимир Куриков».
function personSurnameIndex(parts, login) {
  const need = translitRu(login);
  if (!need) return -1;
  return parts.findIndex(p => {
    const t = translitRu(p);
    if (!t) return false;
    if (t === need) return true;
    // Логин может быть с хвостом (kurikov1, kurikov_a) — сравниваем основу.
    return t.length >= 4 && (need.indexOf(t) === 0 || t.indexOf(need) === 0);
  });
}

// «Фамилия И.О.» — компактное имя для таблиц и профиля.
function personShortName(name, login) {
  const raw = String(name == null ? '' : name).trim();
  if (!raw) return String(login == null ? '' : login);
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];

  let idx = personSurnameIndex(parts, login);
  if (idx === -1) {
    // Отчество (…ич / …вна) на последнем месте — фамилия тогда первая.
    const last = parts[parts.length - 1].toLowerCase();
    const patronymic = /(ич|вна|чна)$/.test(last) && parts.length >= 3;
    idx = patronymic ? 0 : parts.length - 1;
  }
  const surname = parts[idx];
  const initials = parts
    .filter((p, i) => i !== idx)
    .map(p => p[0].toUpperCase() + '.')
    .join('');
  return initials ? surname + ' ' + initials : surname;
}

// Вторая, мелкая строка под ФИО: должность, иначе логин.
function personSubLine(user) {
  if (!user) return '';
  const position = String(user.position || '').trim();
  if (position) return position;
  return String(user.login || '');
}

// Роли системы: администратор, менеджер по продажам, руководитель.
function userRoleLabel(u) {
  if (!u) return ROLE_LABELS[ROLE_MANAGER];
  return ROLE_LABELS[normalizeRole(u.role)] || ROLE_LABELS[ROLE_MANAGER];
}

// Менеджерская работа: и менеджер по продажам, и руководитель.
function isManagerRole(u) {
  if (!u) return false;
  const role = normalizeRole(u.role);
  return role === ROLE_MANAGER || role === ROLE_LEAD;
}

// Руководитель — отдельная роль: те же рабочие инструменты, но с обзором
// по менеджерам (перенос клиентов, столбцы канбана, чат руководителей).
function isLeadRole(u) {
  return !!u && normalizeRole(u.role) === ROLE_LEAD;
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
// Разработчик — супер-админ: isAdmin() для него тоже true, чтобы он видел
// весь административный интерфейс; isDeveloper() выделяет его отдельно.
function isAdmin() {
  if (!currentUser) return false;
  const live = findUserById(currentUser.id) || findUserByLogin(currentUser.login);
  const role = normalizeRole(live && live.role);
  return role === ROLE_ADMIN || role === ROLE_DEVELOPER;
}

// Текущий пользователь — разработчик (супер-админ).
function isDeveloper() {
  if (!currentUser) return false;
  const live = findUserById(currentUser.id) || findUserByLogin(currentUser.login);
  return !!(live && normalizeRole(live.role) === ROLE_DEVELOPER);
}

// Текущий пользователь — руководитель.
function isLead() {
  if (!currentUser) return false;
  const live = findUserById(currentUser.id) || findUserByLogin(currentUser.login);
  return !!(live && normalizeRole(live.role) === ROLE_LEAD);
}

// Есть ли у пользователя право permissionId. developer имеет всё.
// До применения миграции (когда матрицы rolePermissions ещё нет) admin
// сохраняет прежние права — чтобы не ломать старые проверки role==='admin'.
function hasPermission(user, permissionId) {
  const u = user || currentUser;
  if (!u) return false;
  const role = normalizeRole(u.role);
  if (role === ROLE_DEVELOPER) return true;
  const list = rolePermissions && rolePermissions[role];
  if (!Array.isArray(list)) return role === ROLE_ADMIN;
  return list.indexOf(permissionId) > -1;
}

// Удобная проверка для текущего пользователя (по актуальной роли).
function can(permissionId) {
  if (!currentUser) return false;
  const live = findUserById(currentUser.id) || findUserByLogin(currentUser.login);
  return hasPermission(live, permissionId);
}

// Проверка, что изменения не сломают систему: нельзя удалить/понизить
// последнего администратора.
function countAdmins() {
  return users.filter(u => normalizeRole(u.role) === ROLE_ADMIN).length;
}

function countDevelopers() {
  return users.filter(u => normalizeRole(u.role) === ROLE_DEVELOPER).length;
}

function addUser(data) {
  if (!data.login || !data.password) return { ok: false, error: 'Заполните логин и пароль' };
  if (findUserByLogin(data.login)) return { ok: false, error: 'Логин уже занят' };
  const newRole = normalizeRole(data.role);
  if (newRole === ROLE_DEVELOPER && !isDeveloper()) {
    return { ok: false, error: 'Назначить роль «Разработчик» может только разработчик' };
  }
  const maxId = users.reduce((m, u) => Math.max(m, u.id || 0), 0);
  users.push({
    id: maxId + 1,
    login: data.login.trim(),
    password: data.password,
    role: newRole,
    name: (data.name || '').trim() || data.login.trim(),
    position: (data.position || '').trim(),
    theme: data.theme || 'light',
    substituteFor: data.substituteFor != null ? data.substituteFor : null,
    substituteUntil: data.substituteUntil != null ? data.substituteUntil : null,
    trackedBy: Array.isArray(data.trackedBy) ? data.trackedBy.slice() : []
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

  const newRole = normalizeRole(data.role);
  // Разработчика (и роль разработчика) меняет только разработчик.
  const editingDeveloper = normalizeRole(u.role) === ROLE_DEVELOPER || newRole === ROLE_DEVELOPER;
  if (editingDeveloper && !isDeveloper()) {
    return { ok: false, error: 'Роль «Разработчик» может менять только разработчик' };
  }
  // Нельзя понизить последнего администратора
  if (normalizeRole(u.role) === ROLE_ADMIN && newRole !== ROLE_ADMIN && countAdmins() <= 1) {
    return { ok: false, error: 'Нельзя понизить последнего администратора' };
  }
  // Нельзя понизить последнего разработчика
  if (normalizeRole(u.role) === ROLE_DEVELOPER && newRole !== ROLE_DEVELOPER && countDevelopers() <= 1) {
    return { ok: false, error: 'Нельзя понизить последнего разработчика' };
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
  if (normalizeRole(u.role) === ROLE_DEVELOPER && !isDeveloper()) {
    return { ok: false, error: 'Разработчика может удалить только разработчик' };
  }
  if (normalizeRole(u.role) === ROLE_DEVELOPER && countDevelopers() <= 1) {
    return { ok: false, error: 'Нельзя удалить последнего разработчика' };
  }
  if (normalizeRole(u.role) === ROLE_ADMIN && countAdmins() <= 1) return { ok: false, error: 'Нельзя удалить последнего администратора' };

  users = users.filter(x => x.id !== id);

  // Снять назначения задач с удалённого пользователя
  tasks.forEach(t => {
    if (t.assignedTo === id) { t.assignedTo = null; t.assignedBy = null; t.assignedAt = null; t.assignmentStatus = null; }
    if (Array.isArray(t.trackingBy)) t.trackingBy = t.trackingBy.filter(x => x !== id);
    if (t.colleagueId === id) t.colleagueId = null;
  });
  notifications = notifications.filter(n => n.userId !== id);
  saveUsers();
  saveTasks();
  saveNotifications();
  return { ok: true };
}
