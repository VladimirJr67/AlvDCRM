/* ============================================================
   js/api.js — мост между LocalStorage и файловой БД на сервере.
   При открытии через http:// сервер доступен — состояние
   приложения гидратируется из db.json и сохраняется туда с
   debounce. При открытии через file:// (двойной клик по
   index.html) работает только LocalStorage.
   ============================================================ */

let serverDb = null;          // последний снапшот с сервера
let serverKey = '';           // строковый ключ для сравнения
let serverHash = '';          // «отпечаток» БД на сервере (для дешёвого поллинга)
let serverAvailable = false;  // сервер доступен
let saveTimer = null;
let sseSource = null;         // EventSource для мгновенных уведомлений

function apiAvailable() {
  return !!(window.location && window.location.protocol !== 'file:');
}

// Инициализация: получить БД с сервера и наполнить глобалы приложения.
async function apiInit() {
  if (!apiAvailable()) return false;
  try {
    const res = await fetch('/api/db', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const db = await res.json();
    serverDb = db;
    serverKey = JSON.stringify(db);
    serverAvailable = true;
    rehydrateAll(db);
    connectSse();
    fetchServerHash().then(h => { serverHash = h || ''; }).catch(() => {});
    return true;
  } catch (err) {
    serverAvailable = false;
    return false;
  }
}

// Гидратация глобалов модулей из снапшота сервера.
function rehydrateAll(db) {
  users = db.users || [];
  clients = db.clients || [];
  contacts = db.contacts || [];
  tasks = db.tasks || [];
  taskColumns = db.taskColumns || [];
  taskColumnsPerManager = db.taskColumnsPerManager || {};
  activityToColumnMap = db.activityToColumnMap || {};
  specialNotes = db.specialNotes || [];
  matrices = db.matrices || [];
  clientTransferRequests = db.clientTransferRequests || [];
  chatManagers = db.chatManagers || [];
  chatLeads = db.chatLeads || [];
  reminders = db.reminders || [];
  notifications = db.notifications || [];
  interactionTypes = db.interactionTypes || [];
  orders = db.orders || [];
  orgTypes = db.orgTypes || [];
  contactPositions = db.contactPositions || [];
  newsItems = db.news || [];
  minPrices = (db.minPrices && typeof db.minPrices === 'object' && !Array.isArray(db.minPrices)) ? db.minPrices : {};
  minPriceHistory = Array.isArray(db.minPriceHistory) ? db.minPriceHistory : [];
}

// Собрать полный снапшот из глобалов приложения.
function assembleDb() {
  return {
    version: 6,
    users: users || [],
    clients: clients || [],
    contacts: contacts || [],
    tasks: tasks || [],
    taskColumns: taskColumns || [],
    taskColumnsPerManager: taskColumnsPerManager || {},
    activityToColumnMap: activityToColumnMap || {},
    specialNotes: specialNotes || [],
    matrices: matrices || [],
    clientTransferRequests: clientTransferRequests || [],
    chatManagers: chatManagers || [],
    chatLeads: chatLeads || [],
    reminders: reminders || [],
    notifications: notifications || [],
    interactionTypes: interactionTypes || [],
    orders: orders || [],
    orgTypes: orgTypes || [],
    contactPositions: contactPositions || [],
    news: newsItems || [],
    minPrices: minPrices || {},
    minPriceHistory: minPriceHistory || []
  };
}

// Получить «отпечаток» БД (mtime+size) — дёшево, без скачивания данных.
async function fetchServerHash() {
  const res = await fetch('/api/db/hash', { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  return (j && j.hash) || '';
}

// Обновить локальный «отпечаток» после собственного сохранения — чтобы
// следующий поллинг не считал собственную запись «чужим» изменением.
function refreshServerHash() {
  fetchServerHash().then(h => { serverHash = h || serverHash; }).catch(() => {});
}

// Отложенное сохранение полного снапшота на сервер.
function queueServerSave() {
  if (!serverAvailable) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!serverAvailable) return;
    const db = assembleDb();
    const key = JSON.stringify(db);
    if (key === serverKey) return; // на сервере уже актуальные данные
    fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: key
    }).then(res => {
      if (res.ok) {
        serverDb = db;
        serverKey = key;
        refreshServerHash();
      }
    }).catch(() => { serverAvailable = false; });
  }, 400);
}

// Канал мгновенных уведомлений (SSE): сервер сигналит при любом изменении БД,
// и мы сразу опрашиваем полные данные. EventSource сам переподключается.
function connectSse() {
  if (typeof EventSource === 'undefined' || sseSource) return;
  try {
    sseSource = new EventSource('/api/events');
    let lastRefresh = 0;
    sseSource.onmessage = (event) => {
      const kind = event && event.data ? String(event.data).trim() : 'changed';
      // Срез готовности сервер обновляет отдельно от базы: перечитываем его
      // и перерисовываем заказы, не дёргая полный снапшот базы.
      if (kind === 'readiness') {
        if (typeof onReadinessUpdated === 'function') onReadinessUpdated();
        return;
      }
      const now = Date.now();
      if (now - lastRefresh < 500) return; // защита от лавины событий
      lastRefresh = now;
      refreshFromServer();
    };
    sseSource.onerror = () => {
      // Соединение оборвалось — поллинг 5 с остаётся запасным каналом.
    };
  } catch (e) { /* не критично */ }
}

// Принудительно забрать свежие данные с сервера и перерендерить интерфейс.
async function refreshFromServer() {
  if (!serverAvailable) return false;
  try {
    const res = await fetch('/api/db', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const db = await res.json();
    const key = JSON.stringify(db);
    serverHash = (await fetchServerHash().catch(() => serverHash)) || serverHash;
    if (key === serverKey) return false;

    serverDb = db;
    serverKey = key;
    rehydrateAll(db);

    // Перерендер откладываем, если пользователь в процессе ввода или перетаскивания.
    const activeModal = document.querySelector('.modal-overlay.active');
    if (activeModal) return false;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return false;
    if (typeof draggedTaskId !== 'undefined' && draggedTaskId !== null) return false;
    if (typeof draggedColumnId !== 'undefined' && draggedColumnId !== null) return false;
    return true;
  } catch (err) {
    serverAvailable = false;
    return false;
  }
}

// Опрос сервера — запасной канал «реального времени» (раз в 5 с).
// Возвращает true, если данные изменились (нужен перерендер).
async function apiPoll() {
  if (!serverAvailable) return false;
  try {
    const hash = await fetchServerHash();
    if (hash === serverHash) return false;
    serverHash = hash;
    return await refreshFromServer();
  } catch (err) {
    serverAvailable = false;
    return false;
  }
}

// Сброс после смены пользователя (иначе currentUser останется чужим).
function resolveCurrentUserAfterHydrate() {
  if (!currentUser) return;
  const found = users.find(u => u.id === currentUser.id) || users.find(u => u.login === currentUser.login);
  if (found) currentUser = found;
  else {
    // Пользователь удалён на сервере — разлогиниваем: гасим и локальную
    // копию сессии, и серверную (иначе cookie останется жить).
    currentUser = null;
    localStorage.removeItem('alvid_crm_session');
    if (typeof endServerSession === 'function') endServerSession();
    location.reload();
  }
}

// Принудительное сохранение при уходе со страницы (F5/закрытие) —
// чтобы последние изменения не терялись, даже если debounce не успел.
function flushServerSave() {
  if (!serverAvailable) return;
  clearTimeout(saveTimer);
  const db = assembleDb();
  const key = JSON.stringify(db);
  if (key === serverKey) return;
  if (navigator.sendBeacon) {
    try {
      navigator.sendBeacon('/api/db', new Blob([key], { type: 'application/json' }));
      serverKey = key;
      return;
    } catch (e) { /* пробуем fetch */ }
  }
  try {
    fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: key,
      keepalive: true
    });
    serverKey = key;
  } catch (e) { /* не критично */ }
}

window.addEventListener('pagehide', flushServerSave);
window.addEventListener('beforeunload', flushServerSave);
