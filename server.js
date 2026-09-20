/* ============================================================
   «Алвид CRM» — локальный сервер с файловой базой данных.
   Без внешних зависимостей: раздаёт статику проекта и хранит
   все данные в файле db.json на диске.

   Запуск:  node server.js        (или npm start)
   Флаги:   --no-open  — не открывать браузер автоматически
            PORT=3100 node server.js  — другой порт
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = path.join(ROOT, 'db.json');
const TMP_DB_PATH = path.join(ROOT, 'db.json.tmp');

// Активные сессии входов. Хранятся отдельно от db.json: клиент отправляет на
// сервер полный снапшот базы, и служебные данные сессий в нём не должны
// участвовать — иначе сохранение из браузера затирало бы чужие входы.
const SESSIONS_PATH = path.join(ROOT, 'sessions.json');
const SESSIONS_TMP_PATH = path.join(ROOT, 'sessions.json.tmp');

// Срез готовности по спецификациям (интеграция с выгрузкой 1С). Данные общие
// для всех менеджеров и обновляются целиком при каждой загрузке, поэтому живут
// отдельным файлом: в db.json они бы раздували каждый снапшот из браузера.
const READINESS_PATH = path.join(ROOT, 'readiness.json');
const READINESS_TMP_PATH = path.join(ROOT, 'readiness.json.tmp');
const READINESS_SCHEMA_VERSION = 1;
const READINESS_BODY_LIMIT = 64 * 1024 * 1024;   // документ на 1100+ СП — до 64 МБ

// ===== Локальная конфигурация интеграций =====
// В этом файле хранятся API-ключи внешних сервисов. Он внесён в .gitignore
// и никогда не отдаётся как статика. Переменные окружения имеют приоритет
// над файлом, поэтому ключ можно задать и без записи на диск.
const CONFIG_PATH = path.join(ROOT, 'config.local.json');
const CONFIG_TMP_PATH = path.join(ROOT, 'config.local.json.tmp');

// Файлы, которые сервер не отдаёт клиенту ни при каких условиях.
const NEVER_SERVE = new Set([
  'config.local.json', 'config.local.json.tmp', 'db.json.tmp',
  'sessions.json', 'sessions.json.tmp',
  'readiness.json', 'readiness.json.tmp'
]);

const DADATA_URL = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs';

// Чтение JSON-файла с устойчивостью к BOM: «Блокнот» и PowerShell при
// сохранении в UTF-8 добавляют невидимый префикс, на котором JSON.parse
// падает с ошибкой — из-за этого конфиг молча выглядел пустым.
function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function loadConfig() {
  try {
    return readJsonFile(CONFIG_PATH);
  } catch (err) {
    return {};
  }
}

// Атомарная запись конфигурации — как и у БД: временный файл + переименование.
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_TMP_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(CONFIG_TMP_PATH, CONFIG_PATH);
}

// Ключ DaData: сначала переменные окружения, затем config.local.json.
function dadataToken() {
  const fromEnv = process.env.DADATA_API_KEY || process.env.DADATA_TOKEN || '';
  if (fromEnv.trim()) return fromEnv.trim();
  const cfg = loadConfig();
  return ((cfg.dadata && cfg.dadata.token) || '').trim();
}

function dadataConfigured() {
  return !!dadataToken();
}

// Запросы, меняющие конфигурацию, принимаем только с этой машины (loopback):
// полноценной авторизации у приложения нет, поэтому ключ нельзя разрешать
// записывать любому, кто дотянется до порта по сети.
function isLoopback(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// Чтение тела запроса как UTF-8 без потери многобайтовых символов.
// Критично: собирать чанки в буфер и декодировать в конце, а не делать
// «body += chunk». Последнее превращает каждый Buffer в строку по частям,
// и буква, разрезанная границей пакета, превращается в U+FFFD (�) — так
// в базе портились отдельные символы.
function readUtf8Body(req, limitBytes, cb) {
  const chunks = [];
  let size = 0;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > limitBytes) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    cb(null, Buffer.concat(chunks).toString('utf8'));
  });
}

function readJsonBody(req, cb) {
  readUtf8Body(req, 1024 * 1024, (err, body) => {
    if (err) return cb(err);
    try {
      cb(null, JSON.parse(body || '{}'));
    } catch (parseErr) {
      cb(parseErr);
    }
  });
}

// Вызов Suggestions API Дадаты. Ключ подставляется здесь, на сервере,
// поэтому в браузер он не попадает.
async function dadataCall(endpoint, payload) {
  const token = dadataToken();
  if (!token) {
    const err = new Error('Ключ DaData не задан');
    err.code = 'NO_TOKEN';
    throw err;
  }
  const res = await fetch(DADATA_URL + endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Token ' + token
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error('DaData HTTP ' + res.status + (text ? ': ' + text.slice(0, 200) : ''));
    err.code = res.status === 401 || res.status === 403 ? 'BAD_TOKEN' : 'UPSTREAM';
    throw err;
  }
  return res.json();
}

// Реквизиты организации по ИНН (или ОГРН) — приведены к плоскому виду.
async function dadataParty(query) {
  const json = await dadataCall('/findById/party', { query: query, count: 1 });
  const s = (json && Array.isArray(json.suggestions) && json.suggestions[0]) || null;
  if (!s) return null;
  const d = s.data || {};
  const addr = d.address || {};
  const addrData = addr.data || {};
  return {
    name: (d.name && (d.name.short_with_opf || d.name.short)) || s.value || '',
    fullName: (d.name && d.name.full_with_opf) || s.unrestricted_value || '',
    inn: d.inn || '',
    ogrn: d.ogrn || '',
    address: addr.value || addr.unrestricted_value || '',
    city: addrData.city || '',
    country: addrData.country_iso_code || '',
    status: (d.state && d.state.status) || '',
    management: (d.management && d.management.name) || '',
    phones: Array.isArray(d.phones) ? d.phones.slice(0, 3) : [],
    emails: Array.isArray(d.emails) ? d.emails.slice(0, 3) : []
  };
}

// Подсказки городов, ограниченные страной.
async function dadataCities(query, countryCode) {
  const payload = {
    query: query,
    count: 10,
    from_bound: { value: 'city' },
    to_bound: { value: 'city' }
  };
  if (countryCode) payload.locations = [{ country_iso_code: countryCode }];
  const json = await dadataCall('/suggest/address', payload);
  const list = (json && json.suggestions) || [];
  return list.map(s => (s.data && s.data.city) || s.value).filter(Boolean);
}

// ===== Схема базы: версия и справочные значения =====
// v6 — роли admin/manager/lead, ответственный менеджер у клиента, теги и
// служебные поля комментариев, особые отметки, столбцы по менеджерам,
// привязка активности к столбцу, матрицы, запросы на перенос, чаты.
const DB_VERSION = 6;

// Роли системы: администратор, менеджер по продажам, руководитель,
// разработчик (супер-админ — автоматически имеет все права и управляет
// матрицей доступа). Роли «technolog» в модели нет: у технологов отдельный
// контур работы, доступ в CRM им не выдаётся.
const ROLES = { ADMIN: 'admin', MANAGER: 'manager', LEAD: 'lead', DEVELOPER: 'developer' };

// Историческое значение role:'user' означало менеджера по продажам —
// при миграции приводится к 'manager'. Неизвестные значения тоже становятся
// менеджером: это наименее привилегированная рабочая роль.
const ROLE_ALIASES = {
  admin: 'admin', администратор: 'admin',
  manager: 'manager', user: 'manager', менеджер: 'manager', 'менеджер по продажам': 'manager',
  lead: 'lead', head: 'lead', руководитель: 'lead', 'руководитель отдела': 'lead',
  developer: 'developer', dev: 'developer', разработчик: 'developer', 'разработчик': 'developer'
};

function normalizeRole(role) {
  const key = String(role == null ? '' : role).trim().toLowerCase();
  return ROLE_ALIASES[key] || 'manager';
}

// Теги комментария контакта: канонические коды forSelf / forReport.
// Легаси-значения self / report приводятся к ним при миграции.
const COMMENT_TAGS = ['forSelf', 'forReport'];
const COMMENT_TAG_ALIASES = {
  self: 'forSelf', forself: 'forSelf', for_self: 'forSelf', 'для себя': 'forSelf',
  report: 'forReport', forreport: 'forReport', for_report: 'forReport', 'для отчёта': 'forReport'
};

function normalizeCommentTags(tags) {
  const src = Array.isArray(tags)
    ? tags
    : (tags && typeof tags === 'object' ? Object.keys(tags).filter(k => tags[k]) : []);
  const out = [];
  src.forEach(t => {
    const raw = String(t == null ? '' : t).trim();
    if (!raw) return;
    const canon = COMMENT_TAG_ALIASES[raw.toLowerCase()] || raw;
    if (COMMENT_TAGS.indexOf(canon) > -1 && out.indexOf(canon) < 0) out.push(canon);
  });
  return out;
}

// Статусы заказа матриц.
const MATRIX_STATUSES = ['Поступила', 'Отписана'];
const MATRIX_STATUS_DEFAULT = 'Поступила';

// Статусы запроса на перенос клиента к другому менеджеру.
const TRANSFER_STATUSES = ['pending', 'approved', 'rejected'];

// Привязка типа активности к столбцу канбана: { '<тип активности>': '<id столбца>' }.
// Карта заполняется администратором (Администрирование → Типы взаимодействий):
// это осознанная настройка, а не догадка системы. Пустая карта означает, что
// задачи по активностям не создаются — остаются только комментарии.
const DEFAULT_ACTIVITY_TO_COLUMN = {};

// Автопривязки прежних версий: активности ссылались на бизнес-статусы доски.
// Такая карта считается устаревшей и сбрасывается — администратор настроит
// привязки заново (кнопка «Создать столбцы и привязки по ТЗ»).
const LEGACY_ACTIVITY_TO_COLUMN = {
  'Звонок': 'in_progress',
  'Информация': 'in_progress',
  'Встреча': 'in_progress',
  'Письмо': 'in_progress',
  'Размещение заказа': 'order_placed'
};

function isLegacyActivityMap(map) {
  const keys = Object.keys(map || {});
  if (keys.length < 4) return false;
  return keys.every(k => !!LEGACY_ACTIVITY_TO_COLUMN[k] &&
    (map[k] === 'in_progress' || map[k] === 'order_placed'));
}

// Настройки всплывающих уведомлений по умолчанию (совпадают с js/profile.js).
const DEFAULT_NOTIFY_SETTINGS = { sound: 'short', position: 'bottom-right' };

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function plainObject(v) {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}

// Дефолтная структура БД — создаётся при первом старте.
const DEFAULT_DB = {
  version: DB_VERSION,
  users: [
    { id: 1, login: 'Admin', password: 'Admin', role: ROLES.ADMIN, name: 'Администратор', position: '', theme: 'light', substituteFor: null, substituteUntil: null },
    { id: 2, login: 'manager', password: 'manager', role: ROLES.MANAGER, name: 'Менеджер', position: '', theme: 'light', substituteFor: null, substituteUntil: null }
  ],
  clients: [],
  contacts: [],
  tasks: [],
  // Глобальные столбцы канбана (общие для всех).
  taskColumns: [],
  // Индивидуальные столбцы: { '<id пользователя>': [ столбец, ... ] }.
  // В JSON это отдельный ключ, потому что массив taskColumns не может нести
  // собственное свойство perManager (JSON.stringify теряет такие свойства).
  taskColumnsPerManager: {},
  // Привязка активности к столбцу: { '<тип активности>': '<id столбца>' }.
  activityToColumnMap: {},
  // Особые отметки — отдельно от комментариев.
  specialNotes: [],
  // Заказы матриц: шифр, покрытие, статус «Поступила»/«Отписана», клиент, дата.
  matrices: [],
  // Запросы на перенос клиента к другому менеджеру.
  clientTransferRequests: [],
  // Внутренние чаты: менеджеры и руководители.
  chatManagers: [],
  chatLeads: [],
  reminders: [],
  notifications: [],
  interactionTypes: [],
  orders: [],
  // Общие справочники: типы организаций и должности контактных лиц.
  // Заполняются менеджерами и доступны всем остальным.
  orgTypes: [],
  contactPositions: [],
  // Лента новостей и объявлений для команды.
  news: [],
  // Минимальные цены за кг по покрытиям: { 'Анод': { value, updatedAt } }.
  minPrices: {},
  // История изменений минимальных цен: кто, когда и на сколько изменил.
  minPriceHistory: [],
  // Каталог прав (id, title, group) и матрица «роль → список прав».
  // Роль developer в матрицу не пишется — она имеет все права по определению.
  permissions: [],
  rolePermissions: {}
};

// Типы взаимодействий по умолчанию — сидируются только при первом старте
// (когда в db.json ещё нет коллекции interactionTypes).
const DEFAULT_INTERACTION_TYPES = [
  'Звонок', 'Информация', 'Встреча', 'Письмо',
  'Размещение заказа', 'Отправил КП', 'Заказ матриц', 'Нерентабелен'
];

// Обязательные типы: на них держится логика активностей и их нельзя потерять.
// Список синхронизирован с PROTECTED_INTERACTION_TYPES в js/interactionTypes.js:
//   «Размещение заказа» — параметры заказа и запись в «Заказах»;
//   «Заказ матриц»      — окно шифров и покрытия, записи в matrices[];
//   «Отправил КП»       — активность отправки коммерческого предложения;
//   «Нерентабелен»      — единственное исключение из правила следующей даты.
const REQUIRED_INTERACTION_TYPES = ['Размещение заказа', 'Отправил КП', 'Заказ матриц', 'Нерентабелен'];

// Легаси-набор без «Размещения заказа» — при миграции дополняется новым типом.
const LEGACY_INTERACTION_TYPES = ['Звонок', 'Информация', 'Встреча', 'Письмо'];

// Каталог прав (id, title, group). Новые фичи регистрируют своё право здесь:
// по умолчанию его получает только роль developer, пока разработчик не выдаст
// его в разделе «Права и роли».
const PERMISSIONS = [
  { id: 'clients.create', title: 'Создание клиентов', group: 'Клиенты' },
  { id: 'clients.edit', title: 'Редактирование клиентов', group: 'Клиенты' },
  { id: 'clients.delete', title: 'Удаление клиентов', group: 'Клиенты' },
  { id: 'clients.import', title: 'Импорт клиентов', group: 'Клиенты' },
  { id: 'clients.export', title: 'Экспорт клиентов', group: 'Клиенты' },
  { id: 'clients.transfer', title: 'Перенос клиентов', group: 'Клиенты' },
  { id: 'contacts.edit', title: 'Редактирование контактов', group: 'Контакты' },
  { id: 'contacts.delete', title: 'Удаление контактов', group: 'Контакты' },
  { id: 'tasks.create', title: 'Создание задач', group: 'Задачи' },
  { id: 'tasks.assign', title: 'Назначение задач', group: 'Задачи' },
  { id: 'tasks.track', title: 'Отслеживание задач', group: 'Задачи' },
  { id: 'tasks.delete', title: 'Удаление задач', group: 'Задачи' },
  { id: 'orders.viewAll', title: 'Просмотр всех заказов', group: 'Заказы' },
  { id: 'orders.export', title: 'Экспорт заказов', group: 'Заказы' },
  { id: 'matrices.create', title: 'Создание матриц', group: 'Матрицы' },
  { id: 'matrices.updateStatus', title: 'Смена статуса матриц', group: 'Матрицы' },
  { id: 'prices.edit', title: 'Изменение минимальных цен', group: 'Цены' },
  { id: 'prices.massEdit', title: 'Массовое изменение цен', group: 'Цены' },
  { id: 'news.publish', title: 'Публикация новостей', group: 'Новости' },
  { id: 'chat.managers', title: 'Чат менеджеров', group: 'Чат' },
  { id: 'chat.leads', title: 'Чат руководителей', group: 'Чат' },
  { id: 'reports.comments', title: 'Отчёт по комментариям', group: 'Отчёты' },
  { id: 'reports.sales', title: 'Отчёт по продажам', group: 'Отчёты' },
  { id: 'admin.columns', title: 'Столбцы задач', group: 'Администрирование' },
  { id: 'admin.users', title: 'Пользователи', group: 'Администрирование' },
  { id: 'admin.permissions', title: 'Права и роли', group: 'Администрирование' },
  { id: 'admin.readiness', title: 'Готовность (1С)', group: 'Администрирование' },
  { id: 'admin.interaction-types', title: 'Типы взаимодействий', group: 'Администрирование' },
  { id: 'admin.integrations', title: 'Интеграции', group: 'Администрирование' }
];

function allPermissionIds() {
  return PERMISSIONS.map(p => p.id);
}

// Дефолтная матрица доступа (миграция для уже существующих баз): admin получает
// все прежние права, manager/lead — тот объём, что был у них до появления матрицы.
function defaultRolePermissions() {
  const manager = [
    'clients.create', 'clients.edit', 'clients.transfer',
    'contacts.edit', 'contacts.delete',
    'tasks.create',
    'matrices.create', 'matrices.updateStatus',
    'chat.managers'
  ];
  const lead = manager.concat([
    'tasks.assign', 'tasks.track', 'orders.viewAll',
    'reports.comments', 'reports.sales', 'chat.leads'
  ]);
  return {
    admin: allPermissionIds().slice(),
    manager: manager,
    lead: lead
  };
}

// ===== Миграции данных =====
// Правило простое: ничего не удаляем и не перезаписываем — только дополняем
// отсутствующие поля. Функция идемпотентна, поэтому вызывается и при загрузке
// базы, и при каждом сохранении.

// «Текущий менеджер» базы — к нему привязываются карточки клиентов, у которых
// ответственный не был указан (до появления роли manager ответственного не
// хранили вовсе). Если менеджеров несколько, берём первого по id: он и есть
// тот, кто вёл базу до разделения ролей.
function defaultManagerId(users) {
  const managers = asArray(users).filter(u => u && (u.role === ROLES.MANAGER || u.role === ROLES.LEAD));
  if (!managers.length) return null;
  return managers.reduce((best, u) => (best == null || (u.id || 0) < best ? u.id : best), null);
}

// Ответственный менеджер карточки клиента.
function resolveResponsibleManagerId(client, users, fallbackId) {
  const known = id => asArray(users).some(u => u && u.id === id);
  if (client.responsibleManagerId != null && known(client.responsibleManagerId)) {
    return client.responsibleManagerId;
  }
  // Автор карточки: если это менеджер или руководитель — он и ответственный.
  if (client.createdBy != null) {
    const author = asArray(users).find(u => u && u.id === client.createdBy);
    if (author && (author.role === ROLES.MANAGER || author.role === ROLES.LEAD)) return author.id;
  }
  return fallbackId;
}

// Комментарий (запись истории взаимодействия). Единый вид для комментариев
// контактных лиц (contacts[].comments[]) и записей карточек клиентов
// (clients[].history[]): теги «для себя»/«для отчёта», закрытие, следующая
// активность и её тип со столбцом канбана.
function normalizeCommentEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  entry.tags = normalizeCommentTags(entry.tags);
  if (!('closedAt' in entry)) entry.closedAt = null;
  if (!('nextActivityAt' in entry)) entry.nextActivityAt = null;
  if (!('activityType' in entry)) entry.activityType = String(entry.type || '');
  if (!('columnId' in entry)) entry.columnId = null;
  return entry;
}

function normalizeContactRecord(contact) {
  if (!contact || typeof contact !== 'object') return contact;
  if (!('oldBaseId' in contact)) contact.oldBaseId = null;
  contact.comments = asArray(contact.comments).map(normalizeCommentEntry);
  return contact;
}

function normalizeDb(db) {
  const d = Object.assign({}, DEFAULT_DB, db || {});

  // --- Коллекции верхнего уровня ---
  d.users = asArray(d.users);
  d.clients = asArray(d.clients);
  d.contacts = asArray(d.contacts);
  d.tasks = asArray(d.tasks);
  d.taskColumns = asArray(d.taskColumns);
  d.reminders = asArray(d.reminders);
  d.notifications = asArray(d.notifications);
  d.orders = asArray(d.orders);
  d.orgTypes = asArray(d.orgTypes);
  d.contactPositions = asArray(d.contactPositions);
  d.news = asArray(d.news);
  d.minPrices = plainObject(d.minPrices);
  d.minPriceHistory = asArray(d.minPriceHistory);
  d.interactionTypes = asArray(d.interactionTypes);
  d.specialNotes = asArray(d.specialNotes);
  d.matrices = asArray(d.matrices);
  d.clientTransferRequests = asArray(d.clientTransferRequests);
  d.chatManagers = asArray(d.chatManagers);
  d.chatLeads = asArray(d.chatLeads);
  d.taskColumnsPerManager = plainObject(d.taskColumnsPerManager);
  d.activityToColumnMap = plainObject(d.activityToColumnMap);

  // --- Права и роли ---
  // Каталог прав пополняем, если он пуст (список — системный справочник, его
  // не редактируют вручную). Матрицу rolePermissions сидируем один раз — только
  // если в базе её ещё нет: дальше ей управляет разработчик в «Права и роли».
  d.permissions = asArray(d.permissions);
  if (!d.permissions.length) d.permissions = PERMISSIONS.slice();
  if (!(db && typeof db === 'object' && 'rolePermissions' in db)) {
    d.rolePermissions = defaultRolePermissions();
  } else {
    d.rolePermissions = plainObject(d.rolePermissions);
  }

  // Легаси/fresh-базы без коллекции — наполняем дефолтами.
  if (!(db && Array.isArray(db.interactionTypes)) && !d.interactionTypes.length) {
    d.interactionTypes = DEFAULT_INTERACTION_TYPES.slice();
  } else if (d.interactionTypes.length === LEGACY_INTERACTION_TYPES.length &&
             LEGACY_INTERACTION_TYPES.every((t, i) => d.interactionTypes[i] === t)) {
    // Одноразовая миграция: старый «чистый» справочник дополняется новыми типами.
    // Если администратор уже правил справочник — его изменения не трогаем.
    d.interactionTypes = DEFAULT_INTERACTION_TYPES.slice();
  }
  // Обязательные типы активностей дописываются, если их нет: без них не
  // работают окно заказа матриц, форма заказа и исключение «Нерентабелен».
  REQUIRED_INTERACTION_TYPES.forEach(type => {
    if (!d.interactionTypes.some(t => String(t).toLowerCase() === type.toLowerCase())) {
      d.interactionTypes.push(type);
    }
  });

  // --- Пользователи: роли и профиль ---
  d.users.forEach(u => {
    if (!u || typeof u !== 'object') return;
    u.role = normalizeRole(u.role);          // 'user' → 'manager'
    if (typeof u.position !== 'string') u.position = '';
    if (typeof u.theme !== 'string' || !u.theme) u.theme = 'light';
    if (!('substituteFor' in u)) u.substituteFor = null;   // за кого замещает
    if (!('substituteUntil' in u)) u.substituteUntil = null; // до какой даты
    // Кто из руководителей отслеживает задачи сотрудника (раздел «Отслеживание»).
    u.trackedBy = asArray(u.trackedBy);
  });

  // Bootstrap: в базе всегда есть хотя бы один разработчик (супер-админ),
  // иначе матрицу прав некому редактировать. Дефолтный пароль меняют в разделе
  // «Пользователи» (правит разработчика только сам разработчик).
  if (!d.users.some(u => u && normalizeRole(u.role) === ROLES.DEVELOPER)) {
    const maxId = d.users.reduce((m, u) => Math.max(m, u && u.id || 0), 0);
    d.users.push({
      id: maxId + 1, login: 'developer', password: 'developer', role: ROLES.DEVELOPER,
      name: 'Разработчик', position: '', theme: 'light',
      substituteFor: null, substituteUntil: null, trackedBy: []
    });
  }

  const fallbackManager = defaultManagerId(d.users);

  // --- Клиенты: идентификатор в прежней базе и ответственный менеджер ---
  d.clients.forEach(c => {
    if (!c || typeof c !== 'object') return;
    if (!('oldBaseId' in c)) c.oldBaseId = null;
    c.responsibleManagerId = resolveResponsibleManagerId(c, d.users, fallbackManager);
    if (Array.isArray(c.history)) c.history.forEach(normalizeCommentEntry);
  });

  // --- Контактные лица: комментарии с тегами ---
  d.contacts.forEach(normalizeContactRecord);

  // --- Особые отметки: отдельная от комментариев сущность ---
  d.specialNotes.forEach(n => {
    if (!n || typeof n !== 'object') return;
    if (!('clientId' in n)) n.clientId = null;
    if (!('contactId' in n)) n.contactId = null;
    if (typeof n.text !== 'string') n.text = '';
    if (typeof n.color !== 'string') n.color = '';
    if (!('authorId' in n)) n.authorId = null;
    if (!('authorName' in n)) n.authorName = '';
    if (!('createdAt' in n)) n.createdAt = new Date().toISOString();
    if (!('active' in n)) n.active = true;   // снятая отметка хранится как active:false
  });

  // --- Столбцы канбана: индивидуальные наборы по менеджерам ---
  Object.keys(d.taskColumnsPerManager).forEach(userId => {
    d.taskColumnsPerManager[userId] = asArray(d.taskColumnsPerManager[userId]).map((c, i) => {
      const col = (c && typeof c === 'object') ? c : {};
      return {
        id: col.id || ('mgr_' + userId + '_' + i),
        name: typeof col.name === 'string' && col.name ? col.name : 'Столбец',
        color: typeof col.color === 'string' && col.color ? col.color : '#6b7280',
        order: typeof col.order === 'number' ? col.order : i
      };
    });
  });

  // --- Привязка активности к столбцу ---
  Object.keys(d.activityToColumnMap).forEach(type => {
    if (!d.activityToColumnMap[type]) delete d.activityToColumnMap[type];
  });
  if (isLegacyActivityMap(d.activityToColumnMap)) {
    // Прежние автопривязки сбрасываем: привязки назначает администратор.
    d.activityToColumnMap = Object.assign({}, DEFAULT_ACTIVITY_TO_COLUMN);
  }

  // --- Задачи: наблюдение, отработанная ссылка, коллега ---
  d.tasks.forEach(t => {
    if (!t || typeof t !== 'object') return;
    if (!Array.isArray(t.trackingBy)) t.trackingBy = [];     // кто следит за задачей
    if (!('linkWorkedOff' in t)) t.linkWorkedOff = false;    // ссылка отработана
    if (!('colleagueId' in t)) t.colleagueId = null;         // коллега-соисполнитель
    // Вид задачи: 'regular' — обычная, 'link' — «Отработка ссылки»
    // (закрывается только после галочки «Ссылка отработана»).
    if (t.kind !== 'link') t.kind = 'regular';
    if (typeof t.linkUrl !== 'string') t.linkUrl = '';
  });

  // --- Заказы: номер спецификации (СП) для сопоставления с готовностью ---
  d.orders.forEach(o => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.specification !== 'string') o.specification = '';
    o.specificationKey = normalizeSpecificationKey(o.specification);
  });

  // --- Уведомления: где показывать и со звуком ---
  d.notifications.forEach(n => {
    if (!n || typeof n !== 'object') return;
    if (typeof n.position !== 'string' || !n.position) n.position = DEFAULT_NOTIFY_SETTINGS.position;
    if (typeof n.sound !== 'string' || !n.sound) n.sound = DEFAULT_NOTIFY_SETTINGS.sound;
  });

  // --- Матрицы: шифр, покрытие, статус, клиент, дата ---
  d.matrices.forEach(m => {
    if (!m || typeof m !== 'object') return;
    if (typeof m.cipher !== 'string') m.cipher = '';
    if (typeof m.coating !== 'string') m.coating = '';
    if (MATRIX_STATUSES.indexOf(m.status) < 0) m.status = MATRIX_STATUS_DEFAULT;
    if (!('clientId' in m)) m.clientId = null;
    if (typeof m.clientName !== 'string') m.clientName = '';
    if (!('date' in m)) m.date = null;
    if (typeof m.comment !== 'string') m.comment = '';
    if (!('createdBy' in m)) m.createdBy = null;
  });

  // --- Запросы на перенос клиента ---
  d.clientTransferRequests.forEach(r => {
    if (!r || typeof r !== 'object') return;
    if (!('clientId' in r)) r.clientId = null;
    if (!('fromManagerId' in r)) r.fromManagerId = null;
    if (!('toManagerId' in r)) r.toManagerId = null;
    if (typeof r.reason !== 'string') r.reason = '';
    if (TRANSFER_STATUSES.indexOf(r.status) < 0) r.status = 'pending';
    if (!('createdAt' in r)) r.createdAt = new Date().toISOString();
    if (!('decidedAt' in r)) r.decidedAt = null;
    if (!('decidedBy' in r)) r.decidedBy = null;
  });

  // --- Чаты: сообщения менеджеров и руководителей ---
  [d.chatManagers, d.chatLeads].forEach(list => {
    list.forEach(m => {
      if (!m || typeof m !== 'object') return;
      if (!('authorId' in m)) m.authorId = null;
      if (typeof m.authorName !== 'string') m.authorName = '';
      if (typeof m.text !== 'string') m.text = '';
      if (!('createdAt' in m)) m.createdAt = new Date().toISOString();
      if (!Array.isArray(m.readBy)) m.readBy = [];
    });
  });

  d.version = DB_VERSION;
  return d;
}

// Полная миграция с отчётом: возвращает нормализованную базу, признак
// «что-то изменилось» и статистику для вывода в консоль/--migrate.
// Статистика считается по снимку «до» — normalizeDb правит объекты на месте,
// поэтому состояния «до» и «после» нельзя измерять на одном и том же объекте.
function migrateDb(rawDb) {
  let snapshot = {};
  try {
    snapshot = JSON.parse(JSON.stringify(rawDb || {}));
  } catch (e) {
    snapshot = {};
  }
  const before = JSON.stringify(snapshot);
  const db = normalizeDb(rawDb);
  const after = JSON.stringify(db);

  const rawUsers = asArray(snapshot.users);
  const rawClients = asArray(snapshot.clients);
  const hasTag = x => x && Array.isArray(x.tags) && x.tags.length > 0;

  return {
    db: db,
    changed: before !== after,
    stats: {
      fromVersion: snapshot.version != null ? snapshot.version : 0,
      toVersion: DB_VERSION,
      rolesChanged: rawUsers.filter(u => u && normalizeRole(u.role) !== u.role).length,
      clientsBound: rawClients.filter(c => c && !c.responsibleManagerId).length,
      contactsTouched: asArray(snapshot.contacts).length,
      commentsRetagged: asArray(snapshot.contacts).reduce((n, c) => n + asArray(c && c.comments).filter(hasTag).length, 0)
        + rawClients.reduce((n, c) => n + asArray(c && c.history).filter(hasTag).length, 0),
      defaultManagerId: defaultManagerId(db.users)
    }
  };
}

function loadDb() {
  try {
    return normalizeDb(readJsonFile(DB_PATH));
  } catch (err) {
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

// Атомарная запись: сначала во временный файл, затем переименование.
function saveDb(db) {
  fs.writeFileSync(TMP_DB_PATH, JSON.stringify(normalizeDb(db), null, 2), 'utf8');
  fs.renameSync(TMP_DB_PATH, DB_PATH);
}

// ===== Серверные события (SSE): мгновенная синхронизация клиентов =====
// При каждом сохранении БД всем подключённым браузерам отправляется сигнал,
// по которому они обновляют данные без ручной перезагрузки страницы.
// ===== Интеграция «Готовность»: срез по спецификациям =====
// Администратор каждое утро загружает через CRM JSON-документ из инструмента
// «Готовность» (формат — Спецификация_формата_для_CRM.md, схема v1). Документ
// заменяет предыдущий срез целиком и сопоставляется с размещёнными заказами по
// specificationKey: заказы не создаются, им только дописывается блок готовности.

// Ключ сопоставления: тот же номер без пробелов в верхнем регистре. Точки и
// дефисы сохраняются — «СП2125.1» и «Б/С-2» это разные спецификации.
function normalizeSpecificationKey(value) {
  return String(value == null ? '' : value).replace(/\s+/g, '').toUpperCase();
}

const READINESS_STATUSES = {
  shipped: { label: 'Отгружено', color: '#10b981' },
  ready: { label: 'Готово к отгрузке', color: '#22c55e' },
  in_progress: { label: 'В работе', color: '#f59e0b' },
  not_started: { label: 'Не начато', color: '#9ca3af' },
  no_plan: { label: 'Без плана', color: '#6b7280' }
};

function toNumber(value, fallback) {
  const n = Number(value);
  return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
}

// Сколько дней срезу (0 — данные на сегодня). Для пометки «данные устарели».
function readinessAgeDays(asOfDate) {
  const asOf = String(asOfDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.round((new Date(today + 'T00:00:00Z') - new Date(asOf + 'T00:00:00Z')) / 86400000);
  return isFinite(diff) ? diff : null;
}

function emptyReadinessStore() {
  return { schemaVersion: READINESS_SCHEMA_VERSION, uploadedAt: null, meta: null, orders: {} };
}

function loadReadiness() {
  try {
    const raw = readJsonFile(READINESS_PATH);
    const store = {
      schemaVersion: toNumber(raw.schemaVersion, READINESS_SCHEMA_VERSION),
      uploadedAt: raw.uploadedAt || null,
      meta: (raw.meta && typeof raw.meta === 'object') ? raw.meta : null,
      orders: (raw.orders && typeof raw.orders === 'object' && !Array.isArray(raw.orders)) ? raw.orders : {}
    };
    return store;
  } catch (err) {
    return emptyReadinessStore();
  }
}

function saveReadiness(store) {
  fs.writeFileSync(READINESS_TMP_PATH, JSON.stringify(store), 'utf8');
  fs.renameSync(READINESS_TMP_PATH, READINESS_PATH);
}

// Проверка документа до записи: версия схемы, наличие заказов и ключей.
function validateReadinessDocument(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, error: 'Файл не похож на документ готовности: ожидается JSON-объект' };
  }
  const version = toNumber(doc.schemaVersion, NaN);
  if (version !== READINESS_SCHEMA_VERSION) {
    return {
      ok: false,
      error: 'Версия формата ' + (isNaN(version) ? 'не указана' : version) +
        ', CRM понимает ' + READINESS_SCHEMA_VERSION + '. Обновите инструмент «Готовность».'
    };
  }
  if (!Array.isArray(doc.orders)) {
    return { ok: false, error: 'В документе нет массива orders' };
  }
  if (!doc.orders.length) {
    return { ok: false, error: 'В документе нет ни одного заказа' };
  }
  const withoutKey = doc.orders.filter(o => !normalizeSpecificationKey(o && (o.specificationKey || o.specification))).length;
  if (withoutKey) {
    return { ok: false, error: 'У ' + withoutKey + ' записей нет номера спецификации — сопоставить нельзя' };
  }
  return { ok: true };
}

// Документ → компактное хранилище: { КЛЮЧ: заказ } + метаданные.
// Заодно пересчитываем итоги и сверяем их с заявленными в файле: расхождение
// означает, что выгрузка побилась, и об этом стоит предупредить администратора.
function buildReadinessStore(doc) {
  const orders = {};
  let duplicates = 0;
  let positions = 0;
  let planQty = 0, stockQty = 0, shippedQty = 0, planWeight = 0, stockWeight = 0;

  doc.orders.forEach(raw => {
    const key = normalizeSpecificationKey(raw.specificationKey || raw.specification);
    if (!key) return;
    if (orders[key]) { duplicates++; return; }

    const list = Array.isArray(raw.positions) ? raw.positions : [];
    const record = {
      specification: raw.specification || key,
      specificationKey: key,
      client: raw.client || '',
      orderDate: raw.orderDate || null,
      planReadyDate: raw.planReadyDate || null,
      workDays: raw.workDays != null ? toNumber(raw.workDays, null) : null,
      planQty: toNumber(raw.planQty),
      stockQty: toNumber(raw.stockQty),
      shippedQty: toNumber(raw.shippedQty),
      notReadyQty: toNumber(raw.notReadyQty),
      planWeight: toNumber(raw.planWeight),
      stockWeight: toNumber(raw.stockWeight),
      shippedWeight: toNumber(raw.shippedWeight),
      readiness: raw.readiness == null ? null : toNumber(raw.readiness, null),
      status: raw.status || '',
      statusCode: READINESS_STATUSES[raw.statusCode] ? raw.statusCode : 'no_plan',
      overdueDays: toNumber(raw.overdueDays),
      positionCount: toNumber(raw.positionCount, list.length),
      positions: list.map(p => ({
        cipher: p.cipher || '',
        name: p.name || '',
        length: p.length == null ? '' : String(p.length),
        coating: p.coating || '',
        planQty: toNumber(p.planQty),
        stockQty: toNumber(p.stockQty),
        shippedQty: toNumber(p.shippedQty),
        notReadyQty: toNumber(p.notReadyQty),
        planWeight: toNumber(p.planWeight),
        stockWeight: toNumber(p.stockWeight),
        readiness: p.readiness == null ? null : toNumber(p.readiness, null),
        status: p.status || '',
        statusCode: READINESS_STATUSES[p.statusCode] ? p.statusCode : 'no_plan'
      }))
    };

    orders[key] = record;
    positions += record.positions.length;
    planQty += record.planQty;
    stockQty += record.stockQty;
    shippedQty += record.shippedQty;
    planWeight += record.planWeight;
    stockWeight += record.stockWeight;
  });

  const computed = {
    orders: Object.keys(orders).length,
    positions: positions,
    planQty: Math.round(planQty * 1000) / 1000,
    stockQty: Math.round(stockQty * 1000) / 1000,
    shippedQty: Math.round(shippedQty * 1000) / 1000,
    planWeight: Math.round(planWeight * 1000) / 1000,
    stockWeight: Math.round(stockWeight * 1000) / 1000,
    readiness: planQty > 0 ? Math.round((stockQty + shippedQty) / planQty * 1000) / 10 : null
  };

  const declared = (doc.totals && typeof doc.totals === 'object') ? doc.totals : null;
  const warnings = [];
  if (declared) {
    ['orders', 'positions', 'planQty', 'stockQty', 'shippedQty'].forEach(field => {
      if (declared[field] == null) return;
      const diff = Math.abs(toNumber(declared[field]) - computed[field]);
      if (diff > 0.5) {
        warnings.push('Итог «' + field + '» в файле ' + toNumber(declared[field]) +
          ', а по заказам ' + computed[field]);
      }
    });
  }
  if (duplicates) warnings.push('Повторяющихся номеров СП в файле: ' + duplicates + ' (оставлена первая запись)');

  const meta = {
    schemaVersion: READINESS_SCHEMA_VERSION,
    asOfDate: String(doc.asOfDate || '').slice(0, 10) || null,
    generatedAt: doc.generatedAt || null,
    sourceFile: doc.sourceFile || null,
    sheet: doc.sheet || null,
    declaredTotals: declared,
    totals: computed,
    warnings: warnings
  };

  return { store: { schemaVersion: READINESS_SCHEMA_VERSION, uploadedAt: new Date().toISOString(), meta: meta, orders: orders }, warnings: warnings };
}

// Сопоставление среза с заказами CRM: что нашли, чего нет в базе, где нет данных.
function readinessReport(store, db) {
  const orders = asArray(db && db.orders);
  const snapshotKeys = Object.keys(store.orders || {});

  const missing = snapshotKeys.filter(key =>
    !orders.some(o => normalizeSpecificationKey(o.specificationKey || o.specification) === key));

  const withoutSpec = [];
  const withoutData = [];
  orders.forEach(o => {
    const key = normalizeSpecificationKey(o.specificationKey || o.specification);
    if (!key) { withoutSpec.push({ id: o.id, clientName: o.clientName || '' }); return; }
    if (!store.orders[key]) withoutData.push({ id: o.id, specification: o.specification || key, clientName: o.clientName || '' });
  });

  return {
    snapshotOrders: snapshotKeys.length,
    matched: snapshotKeys.length - missing.length,
    missingCount: missing.length,
    missing: missing.slice(0, 300),
    ordersWithoutSpecCount: withoutSpec.length,
    ordersWithoutSpec: withoutSpec.slice(0, 300),
    ordersWithoutDataCount: withoutData.length,
    ordersWithoutData: withoutData.slice(0, 300)
  };
}

// Публичное состояние среза — то, что нужно менеджерам для подписи «данные на …».
function readinessStatus(store) {
  const meta = store.meta || null;
  const count = Object.keys(store.orders || {}).length;
  return {
    available: count > 0,
    asOfDate: meta ? meta.asOfDate : null,
    uploadedAt: store.uploadedAt || null,
    generatedAt: meta ? meta.generatedAt : null,
    sourceFile: meta ? meta.sourceFile : null,
    totals: meta ? meta.totals : null,
    warnings: meta ? (meta.warnings || []) : [],
    count: count,
    ageDays: meta ? readinessAgeDays(meta.asOfDate) : null
  };
}

// Права на сервере: роль developer имеет всё, остальные — по матрице
// rolePermissions из db.json. До применения миграции (когда матрицы ещё нет)
// admin сохраняет прежние права — это и есть «не ломать старые role==='admin'».
function hasPermissionOnServer(user, permissionId) {
  if (!user) return false;
  const role = normalizeRole(user.role);
  if (role === ROLES.DEVELOPER) return true;
  const db = loadDb();
  const map = plainObject(db.rolePermissions);
  const list = map[role];
  if (!Array.isArray(list)) return role === ROLES.ADMIN; // миграция ещё не применилась
  return list.indexOf(permissionId) > -1;
}

// Middleware проверки права: возвращает { ok, user } или { ok:false, code, error }.
function requirePermission(req, permissionId, label) {
  const session = resolveSession(req);
  if (!session) return { ok: false, code: 401, error: 'Действие доступно только из CRM под своей учётной записью' };
  const db = loadDb();
  const user = asArray(db.users).find(u => u.id === session.userId);
  if (!user) return { ok: false, code: 401, error: 'Сессия не найдена — войдите заново' };
  if (!hasPermissionOnServer(user, permissionId)) {
    return { ok: false, code: 403, error: 'Недостаточно прав' + (label ? ': ' + label : '') };
  }
  return { ok: true, user: user };
}

// Право admin.readiness закрывает загрузку «Готовности».
function requireAdminSession(req) {
  return requirePermission(req, 'admin.readiness', 'загружать готовность может администратор или разработчик');
}

// Раздел «Права и роли» и эндпоинт /api/permissions доступны ТОЛЬКО разработчику
// (супер-админу) — независимо от матрицы прав.
function requireDeveloper(req) {
  const session = resolveSession(req);
  if (!session) return { ok: false, code: 401, error: 'Действие доступно только из CRM под своей учётной записью' };
  const db = loadDb();
  const user = asArray(db.users).find(u => u.id === session.userId);
  if (!user) return { ok: false, code: 401, error: 'Сессия не найдена — войдите заново' };
  if (normalizeRole(user.role) !== ROLES.DEVELOPER) {
    return { ok: false, code: 403, error: 'Права и роли доступны только разработчику' };
  }
  return { ok: true, user: user };
}

// Тело запроса до 64 МБ — документ готовности заметно больше обычных запросов.
function readLargeJsonBody(req, cb) {
  readUtf8Body(req, READINESS_BODY_LIMIT, (err, body) => {
    if (err) return cb(err);
    try {
      cb(null, JSON.parse(body || '{}'));
    } catch (parseErr) {
      cb(parseErr);
    }
  });
}

const sseClients = new Set();

// payload: 'changed' — изменилась база, 'readiness' — обновился срез готовности.
function broadcastSse(payload) {
  const data = 'data: ' + (payload || 'changed') + '\n\n';
  sseClients.forEach(res => {
    try { res.write(data); } catch (e) { sseClients.delete(res); }
  });
}

// Дёшево вычисляемый «отпечаток» БД для опроса: изменения на диске сказываются
// и на mtime, и на размере файла, поэтому пара (mtime, size) надёжно ловит
// обновления без передачи всего содержимого db.json.
function dbFingerprint() {
  try {
    const st = fs.statSync(DB_PATH);
    return `${st.mtimeMs}:${st.size}`;
  } catch (e) {
    return '0:0';
  }
}

// ===== Сессия: вход, refresh-токен и httpOnly cookie =====
// Пароли по-прежнему лежат в db.json открытым текстом (так требует ТЗ — админ
// видит список логинов и паролей), поэтому сессия решает одну задачу: вход
// сохраняется между перезагрузками страницы и перезапуском сервера.
//
//   alvid_sid     — access-токен, httpOnly, 30 минут, HMAC-подпись секретом сервера;
//   alvid_refresh — refresh-токен, httpOnly, 90 дней, живёт только на /api/auth.
//
// Когда access истёк (вкладка была открыта давно или страницу перезагрузили
// после паузы), сервер молча выдаёт новый по refresh-токену — пользователя
// не разлогинивает. Выход — только кнопкой «Выйти».
const ACCESS_COOKIE = 'alvid_sid';
const REFRESH_COOKIE = 'alvid_refresh';
const ACCESS_TTL_MS = 30 * 60 * 1000;             // 30 минут
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;  // 90 дней
const SESSION_TOUCH_MS = 10 * 60 * 1000;          // продление не чаще раза в 10 минут

let sessionSecretCache = '';

// Секрет подписи. Сначала переменная окружения, затем config.local.json —
// файл вне git, тот же, где лежит ключ DaData.
function sessionSecret() {
  if (sessionSecretCache) return sessionSecretCache;
  const fromEnv = (process.env.ALVID_SESSION_SECRET || '').trim();
  if (fromEnv) { sessionSecretCache = fromEnv; return sessionSecretCache; }

  const cfg = loadConfig();
  const stored = (cfg.session && typeof cfg.session.secret === 'string') ? cfg.session.secret : '';
  if (stored.length >= 32) { sessionSecretCache = stored; return sessionSecretCache; }

  const secret = crypto.randomBytes(32).toString('hex');
  cfg.session = Object.assign({}, cfg.session, { secret: secret });
  try { saveConfig(cfg); } catch (e) { /* не смогли сохранить — секрет будет жить до перезапуска */ }
  sessionSecretCache = secret;
  return sessionSecretCache;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Access-токен — подписанный HMAC-конверт: сервер не хранит его состояние,
// а подделка невозможна без секрета.
function signAccessToken(userId, ttlMs) {
  const body = Buffer.from(JSON.stringify({
    uid: userId,
    exp: Date.now() + (ttlMs || ACCESS_TTL_MS)
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifyAccessToken(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(parts[0]).digest('base64url');
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch (e) { return null; }
  if (!payload || !payload.uid || !payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const name = part.slice(0, i).trim();
    if (!name) return;
    const value = part.slice(i + 1).trim();
    try { out[name] = decodeURIComponent(value); } catch (e) { out[name] = value; }
  });
  return out;
}

function cookieString(name, value, opts) {
  const o = opts || {};
  let s = name + '=' + encodeURIComponent(value);
  s += '; Path=' + (o.path || '/');
  s += '; HttpOnly';
  s += '; SameSite=Lax';
  if (o.clear) s += '; Max-Age=0';
  else if (o.maxAge != null) s += '; Max-Age=' + Math.floor(o.maxAge / 1000);
  return s;
}

function accessCookieFor(userId) {
  return cookieString(ACCESS_COOKIE, signAccessToken(userId), { path: '/', maxAge: ACCESS_TTL_MS });
}

function refreshCookieFor(token) {
  return cookieString(REFRESH_COOKIE, token, { path: '/api/auth', maxAge: REFRESH_TTL_MS });
}

function clearSessionCookies() {
  return [
    cookieString(ACCESS_COOKIE, '', { path: '/', clear: true }),
    cookieString(REFRESH_COOKIE, '', { path: '/api/auth', clear: true })
  ];
}

function loadSessions() {
  try {
    const j = readJsonFile(SESSIONS_PATH);
    return { version: 1, sessions: asArray(j && j.sessions) };
  } catch (e) {
    return { version: 1, sessions: [] };
  }
}

function saveSessions(store) {
  const now = Date.now();
  store.sessions = asArray(store.sessions).filter(s => s && s.expiresAt > now);
  fs.writeFileSync(SESSIONS_TMP_PATH, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(SESSIONS_TMP_PATH, SESSIONS_PATH);
}

// Новый вход: refresh-токен случаен и хранится только в виде хеша, поэтому
// по файлу sessions.json войти нельзя.
function startSession(user, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const store = loadSessions();
  store.sessions.push({
    id: crypto.randomBytes(8).toString('hex'),
    userId: user.id,
    tokenHash: tokenHash(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + REFRESH_TTL_MS,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200)
  });
  saveSessions(store);
  return token;
}

function dropSession(refreshToken) {
  if (!refreshToken) return;
  const store = loadSessions();
  const hash = tokenHash(refreshToken);
  const before = store.sessions.length;
  store.sessions = store.sessions.filter(s => s.tokenHash !== hash);
  if (store.sessions.length !== before) saveSessions(store);
}

function dropSessionsOfUser(userId) {
  const store = loadSessions();
  const before = store.sessions.length;
  store.sessions = store.sessions.filter(s => s.userId !== userId);
  if (store.sessions.length !== before) saveSessions(store);
}

// Кто пришёл по cookie: access-токен или (если он истёк) refresh-сессия.
function resolveSession(req) {
  const cookies = parseCookies(req);
  const refreshToken = cookies[REFRESH_COOKIE] || '';
  const access = verifyAccessToken(cookies[ACCESS_COOKIE]);

  let session = null;
  if (refreshToken) {
    const hash = tokenHash(refreshToken);
    session = loadSessions().sessions.find(s => s.tokenHash === hash && s.expiresAt > Date.now()) || null;
  }

  if (access && (!session || session.userId === access.uid)) {
    return { userId: access.uid, session: session, accessValid: true, refreshToken: refreshToken };
  }
  if (session) {
    // Access истёк или потерян, refresh жив — это и есть «F5 после паузы».
    return { userId: session.userId, session: session, accessValid: false, refreshToken: refreshToken };
  }
  return null;
}

// Продление сессии: refresh-токен скользящий, поэтому активный пользователь
// не вылетает никогда, а заброшенный вход умирает через 90 дней.
function touchSession(session) {
  if (!session) return false;
  const now = Date.now();
  const stale = (now - (session.lastSeenAt || 0)) > SESSION_TOUCH_MS;
  const expiringSoon = (session.expiresAt - now) < (REFRESH_TTL_MS - SESSION_TOUCH_MS);
  if (!stale && !expiringSoon) return false;
  const store = loadSessions();
  const live = store.sessions.find(s => s.id === session.id);
  if (!live) return false;
  live.lastSeenAt = now;
  live.expiresAt = now + REFRESH_TTL_MS;
  session.lastSeenAt = now;
  session.expiresAt = live.expiresAt;
  saveSessions(store);
  return true;
}

function findUserForLogin(login, password) {
  const db = loadDb();
  const needle = String(login == null ? '' : login).trim().toLowerCase();
  if (!needle) return null;
  const user = db.users.find(u => String(u.login || '').trim().toLowerCase() === needle);
  if (!user) return null;
  const stored = String(user.password == null ? '' : user.password);
  if (stored !== String(password == null ? '' : password)) return null;
  return user;
}

// Ответ клиенту без пароля: клиентская часть пароль не получает.
function publicUser(user) {
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    role: normalizeRole(user.role),
    position: user.position || '',
    theme: user.theme || 'light',
    substituteFor: user.substituteFor != null ? user.substituteFor : null,
    substituteUntil: user.substituteUntil != null ? user.substituteUntil : null
  };
}

function sendJsonWithCookies(res, code, obj, cookies) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (cookies && cookies.length) headers['Set-Cookie'] = cookies;
  res.writeHead(code, headers);
  res.end(JSON.stringify(obj));
}

// Ответ на /me и /refresh: оживляем access-токен, если он истёк, и отдаём
// пользователя из актуальной базы (роль могла измениться администратором).
function respondWithSession(req, res, session) {
  const db = loadDb();
  const user = db.users.find(u => u.id === session.userId);
  if (!user) {
    dropSessionsOfUser(session.userId);
    sendJsonWithCookies(res, 401, { ok: false, error: 'Пользователь не найден' }, clearSessionCookies());
    return;
  }
  const cookies = [];
  if (!session.accessValid) cookies.push(accessCookieFor(user.id));
  if (touchSession(session.session)) cookies.push(refreshCookieFor(session.refreshToken));
  sendJsonWithCookies(res, 200, {
    ok: true,
    user: publicUser(user),
    accessExpiresIn: Math.floor(ACCESS_TTL_MS / 1000),
    refreshed: !session.accessValid
  }, cookies);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };

    // Файлы приложения меняются часто. Без запрета кэширования браузер может
    // показывать старую версию скриптов после обновления проекта — тогда
    // исправления «не применяются» до ручного обновления с Ctrl+F5.
    if (/\.(html?|js|css|json)$/i.test(filePath)) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }

    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (err) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  const pathname = url.pathname;

  // ---- Сессия: вход, проверка, продление и выход ----
  // Cookie httpOnly, поэтому клиентские скрипты токен не читают: сессию
  // подтверждает только сервер. Проверка сессии обязательной для остальных
  // API пока не сделана — база, как и раньше, доступна в доверенной сети.
  if (pathname === '/api/auth/login') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }
    readJsonBody(req, (err, body) => {
      if (err) {
        sendJson(res, 400, { ok: false, error: 'Некорректный JSON' });
        return;
      }
      const user = findUserForLogin(body.login, body.password);
      if (!user) {
        sendJson(res, 401, { ok: false, error: 'Неверный логин или пароль' });
        return;
      }
      const refreshToken = startSession(user, req);
      sendJsonWithCookies(res, 200, { ok: true, user: publicUser(user) }, [
        accessCookieFor(user.id),
        refreshCookieFor(refreshToken)
      ]);
    });
    return;
  }

  if (pathname === '/api/auth/me' || pathname === '/api/auth/refresh') {
    if (pathname === '/api/auth/refresh' && req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }
    const session = resolveSession(req);
    if (!session) {
      sendJsonWithCookies(res, 401, { ok: false, error: 'Сессия не найдена' }, clearSessionCookies());
      return;
    }
    respondWithSession(req, res, session);
    return;
  }

  if (pathname === '/api/auth/logout') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }
    dropSession(parseCookies(req)[REFRESH_COOKIE]);
    sendJsonWithCookies(res, 200, { ok: true }, clearSessionCookies());
    return;
  }

  // ---- API базы данных ----
  if (pathname === '/api/db') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(loadDb()));
      return;
    }
    if (req.method === 'POST') {
      readUtf8Body(req, 100 * 1024 * 1024, (err, body) => {
        if (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Слишком большой запрос' }));
          return;
        }
        try {
          const db = JSON.parse(body);

          // Защита матрицы доступа: менять permissions/rolePermissions и назначать
          // роль developer может только разработчик. Остальные правки открыты, как
          // и раньше, — так сохраняется прежнее поведение до полной миграции.
          const session = resolveSession(req);
          const actor = session ? asArray(loadDb().users).find(u => u.id === session.userId) : null;
          const isDev = actor && normalizeRole(actor.role) === ROLES.DEVELOPER;
          if (!isDev) {
            const cur = loadDb();
            const changedRights = JSON.stringify(asArray(db.permissions)) !== JSON.stringify(asArray(cur.permissions)) ||
              JSON.stringify(plainObject(db.rolePermissions)) !== JSON.stringify(plainObject(cur.rolePermissions));
            const developerTouched = () => {
              const curById = {};
              asArray(cur.users).forEach(u => { if (u && u.id != null) curById[u.id] = normalizeRole(u.role); });
              const nextIds = {};
              asArray(db.users).forEach(u => { if (u && u.id != null) nextIds[u.id] = true; });
              // Удаление разработчика.
              for (const id of Object.keys(curById)) {
                if (curById[id] === ROLES.DEVELOPER && !nextIds[id]) return true;
              }
              // Появление/повышение/понижение роли разработчика.
              return asArray(db.users).some(u => {
                if (!u || u.id == null) return false;
                const next = normalizeRole(u.role);
                const prev = curById[u.id];
                return (prev === ROLES.DEVELOPER) !== (next === ROLES.DEVELOPER);
              });
            };
            if (changedRights || developerTouched()) {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: false, error: 'Менять права, роли и разработчика может только разработчик' }));
              return;
            }
          }

          saveDb(db);
          broadcastSse(); // мгновенно уведомить остальные окна/пользователей
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
        } catch (parseErr) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: parseErr.message }));
        }
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
    return;
  }

  // Дёшево вычисляемый «отпечаток» БД — для поллинга без скачивания всего файла.
  if (pathname === '/api/db/hash') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ hash: dbFingerprint() }));
    return;
  }

  // ---- Права и роли: чтение и изменение матрицы (только разработчик) ----
  if (pathname === '/api/permissions') {
    if (req.method === 'GET') {
      const access = requireDeveloper(req);
      if (!access.ok) {
        sendJson(res, access.code, { ok: false, error: access.error });
        return;
      }
      const db = loadDb();
      sendJson(res, 200, { ok: true, permissions: asArray(db.permissions), rolePermissions: plainObject(db.rolePermissions) });
      return;
    }

    if (req.method === 'PUT') {
      const access = requireDeveloper(req);
      if (!access.ok) {
        sendJson(res, access.code, { ok: false, error: access.error });
        return;
      }
      readJsonBody(req, (err, body) => {
        if (err) {
          sendJson(res, 400, { ok: false, error: 'Некорректный JSON' });
          return;
        }
        const next = plainObject(body && body.rolePermissions);
        const db = loadDb();
        // developer не хранится в матрице и не редактируется здесь.
        ['admin', 'manager', 'lead'].forEach(role => {
          next[role] = asArray(next[role]).map(String).filter(id => allPermissionIds().indexOf(id) > -1);
        });
        db.rolePermissions = next;
        db.permissions = PERMISSIONS.slice();
        try {
          saveDb(db);
        } catch (e) {
          sendJson(res, 500, { ok: false, error: 'Не удалось сохранить матрицу: ' + e.message });
          return;
        }
        broadcastSse();
        sendJson(res, 200, { ok: true, rolePermissions: db.rolePermissions });
      });
      return;
    }

    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  // ---- Готовность: срез по спецификациям (загрузка админом, чтение всем) ----
  if (pathname === '/api/readiness') {
    if (req.method === 'GET') {
      sendJson(res, 200, { ok: true, status: readinessStatus(loadReadiness()) });
      return;
    }

    if (req.method === 'POST') {
      const access = requireAdminSession(req);
      if (!access.ok) {
        sendJson(res, access.code, { ok: false, error: access.error });
        return;
      }
      readLargeJsonBody(req, (err, doc) => {
        if (err) {
          sendJson(res, 400, { ok: false, error: 'Не удалось прочитать JSON: ' + err.message });
          return;
        }
        const valid = validateReadinessDocument(doc);
        if (!valid.ok) {
          sendJson(res, 400, { ok: false, error: valid.error });
          return;
        }
        const built = buildReadinessStore(doc);
        try {
          saveReadiness(built.store);
        } catch (e) {
          sendJson(res, 500, { ok: false, error: 'Не удалось сохранить срез: ' + e.message });
          return;
        }
        const report = readinessReport(built.store, loadDb());
        broadcastSse('readiness');   // менеджерам: срез обновился
        sendJson(res, 200, {
          ok: true,
          status: readinessStatus(built.store),
          report: report,
          warnings: built.warnings
        });
      });
      return;
    }

    if (req.method === 'DELETE') {
      const access = requireAdminSession(req);
      if (!access.ok) {
        sendJson(res, access.code, { ok: false, error: access.error });
        return;
      }
      try {
        saveReadiness(emptyReadinessStore());
      } catch (e) {
        sendJson(res, 500, { ok: false, error: 'Не удалось очистить срез: ' + e.message });
        return;
      }
      broadcastSse('readiness');
      sendJson(res, 200, { ok: true, status: readinessStatus(emptyReadinessStore()) });
      return;
    }

    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  // Точечная выборка: браузер запрашивает только те СП, которые есть в его
  // списке заказов, — весь срез на 1100+ заказов в него не гоняем.
  if (pathname === '/api/readiness/lookup') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }
    readJsonBody(req, (err, body) => {
      if (err) {
        sendJson(res, 400, { ok: false, error: 'Некорректный JSON' });
        return;
      }
      const store = loadReadiness();
      const keys = asArray(body && body.keys).map(normalizeSpecificationKey).filter(Boolean);
      const orders = {};
      const missing = [];
      keys.forEach(key => {
        if (store.orders[key]) orders[key] = store.orders[key];
        else missing.push(key);
      });
      sendJson(res, 200, {
        ok: true,
        status: readinessStatus(store),
        orders: orders,
        missing: missing
      });
    });
    return;
  }

  // ---- Интеграции: статус и настройка ключа ----
  if (pathname === '/api/integrations/status') {
    const cfg = loadConfig();
    const envToken = !!(process.env.DADATA_API_KEY || process.env.DADATA_TOKEN || '').trim();
    sendJson(res, 200, {
      ok: true,
      dadata: {
        configured: dadataConfigured(),
        source: envToken ? 'env' : ((cfg.dadata && cfg.dadata.token) ? 'config' : null)
      }
    });
    return;
  }

  if (pathname === '/api/integrations/dadata') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }
    if (!isLoopback(req)) {
      sendJson(res, 403, {
        ok: false,
        error: 'Ключ можно задать только с компьютера, на котором запущен сервер (localhost)'
      });
      return;
    }
    readJsonBody(req, (err, body) => {
      if (err) {
        sendJson(res, 400, { ok: false, error: 'Некорректный JSON' });
        return;
      }
      const token = String(body.token || '').trim();
      const cfg = loadConfig();
      if (token) cfg.dadata = { token: token };
      else delete cfg.dadata;
      try {
        saveConfig(cfg);
        sendJson(res, 200, { ok: true, configured: dadataConfigured() });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: 'Не удалось сохранить конфигурацию: ' + e.message });
      }
    });
    return;
  }

  // ---- Подсказки: реквизиты по ИНН/ОГРН и города ----
  if (pathname === '/api/suggest/party') {
    const inn = (url.searchParams.get('inn') || '').replace(/\D/g, '');
    if (!/^(\d{10}|\d{12}|\d{13}|\d{15})$/.test(inn)) {
      sendJson(res, 400, { ok: false, error: 'Укажите ИНН (10 цифр) или ОГРН (13 или 15 цифр)' });
      return;
    }
    dadataParty(inn)
      .then(party => sendJson(res, 200, { ok: true, party: party }))
      .catch(err => sendJson(res, err.code === 'NO_TOKEN' ? 503 : 502, {
        ok: false, error: err.message, code: err.code || 'UPSTREAM'
      }));
    return;
  }

  if (pathname === '/api/suggest/city') {
    const q = (url.searchParams.get('q') || '').trim();
    const country = (url.searchParams.get('country') || '').trim().toUpperCase();
    if (q.length < 2) {
      sendJson(res, 200, { ok: true, cities: [] });
      return;
    }
    dadataCities(q, country)
      .then(cities => sendJson(res, 200, { ok: true, cities: cities }))
      .catch(err => sendJson(res, err.code === 'NO_TOKEN' ? 503 : 502, {
        ok: false, error: err.message, code: err.code || 'UPSTREAM'
      }));
    return;
  }

  // Server-Sent Events: канал мгновенных уведомлений об изменении БД.
  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    // Периодический heartbeat — чтобы прокси/браузер не разрывали соединение.
    const hb = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (e) { clearInterval(hb); }
    }, 25000);
    req.on('close', () => clearInterval(hb));
    return;
  }

  // ---- Статика ----
  let filePath = pathname === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, pathname);

  // Конфигурацию с API-ключами, базу и её резервные копии как статику
  // не отдаём: db.json доступен только через /api/db.
  const baseName = path.basename(filePath);
  if (NEVER_SERVE.has(baseName) || /^db\.json/i.test(baseName) || /^sessions\.json/i.test(baseName)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  // Защита от выхода за пределы каталога проекта
  const prefix = ROOT + path.sep;
  if (filePath !== ROOT && !filePath.startsWith(prefix)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) {
      const indexFile = path.join(filePath, 'index.html');
      fs.stat(indexFile, (err2) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        serveFile(indexFile, res);
      });
      return;
    }
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    serveFile(filePath, res);
  });
});

// ===== Миграция базы при старте =====
// Схема обновляется один раз: если после нормализации база отличается от
// файла, актуальный вариант записывается на диск, а прежний сохраняется
// рядом как резервная копия (откат — вернуть копию на место db.json).
function runStartupMigration() {
  let raw;
  try {
    raw = readJsonFile(DB_PATH);
  } catch (err) {
    console.log('  База не найдена: db.json будет создан при первом сохранении (схема v' + DB_VERSION + ')');
    return { changed: false, stats: null };
  }

  const res = migrateDb(raw);

  // Проверка на артефакты повреждённой кодировки. U+FFFD (�) появляется, если
  // многобайтный символ когда-то декодировался по частям; исходный символ уже
  // не восстановить, но мы обязаны хотя бы сообщить о нём при старте.
  try {
    const rawText = fs.readFileSync(DB_PATH, 'utf8');
    const bad = (rawText.match(/\uFFFD/g) || []).length;
    if (bad > 0) {
      console.log('  ВНИМАНИЕ: в базе найдены повреждённые символы U+FFFD (�): ' + bad + ' шт.');
      console.log('  Это след прежних сохранений. Автоматически не чинится — верните значения');
      console.log('  из резервной копии (db.json.v*.bak) или исправьте вручную.');
    }
  } catch (e) { /* файл не читается — не критично */ }

  if (!res.changed) {
    console.log('  Схема базы: v' + res.stats.toVersion + ' — миграция не требуется');
    return res;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = 'db.json.v' + res.stats.fromVersion + '.' + stamp + '.bak';
  try {
    fs.copyFileSync(DB_PATH, path.join(ROOT, backupName));
  } catch (e) {
    console.log('  Не удалось создать резервную копию базы: ' + e.message);
  }

  saveDb(res.db);

  const s = res.stats;
  console.log('  Миграция схемы базы: v' + s.fromVersion + ' → v' + s.toVersion);
  console.log('    • ролей приведено к admin/manager/lead: ' + s.rolesChanged);
  console.log('    • клиентов привязано к менеджеру (id ' + s.defaultManagerId + '): ' + s.clientsBound);
  console.log('    • комментариев с тегами нормализовано: ' + s.commentsRetagged);
  console.log('    • резервная копия: ' + backupName);
  return res;
}

// Флаг --migrate: выполнить миграцию базы и выйти, не поднимая сервер.
// Нужен, чтобы обновить db.json до новой схемы отдельным шагом.
if (process.argv.includes('--migrate')) {
  console.log('');
  console.log('  Алвид CRM — миграция схемы базы');
  const res = runStartupMigration();
  console.log('  Версия схемы на диске: v' + DB_VERSION);
  console.log('  Записано в db.json: ' + (res.changed ? 'да' : 'нет (база уже по актуальной схеме)'));
  console.log('');
  process.exit(0);
}

runStartupMigration();

server.listen(PORT, () => {
  console.log('');
  console.log('  Алвид CRM');
  console.log(`  Откройте: http://localhost:${PORT}`);
  console.log('  Файл БД: ' + DB_PATH);
  console.log('');

  if (!process.argv.includes('--no-open')) {
    try {
      const cmd = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      require('child_process').exec(cmd + ' http://localhost:' + PORT);
    } catch (e) { /* браузер не открылся — не критично */ }
  }
});
