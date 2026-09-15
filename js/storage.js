/* ============================================================
   js/storage.js — локальное хранилище и миграции.
   Данные пишутся в LocalStorage (быстрый синхронный канал) и
   дополнительно уходят на сервер в db.json через js/api.js.
   ============================================================ */

const STORAGE_KEYS = {
  clients: 'alvid_crm_clients',
  contacts: 'alvid_crm_contacts',
  tasks: 'alvid_crm_tasks',
  taskColumns: 'alvid_crm_task_columns',
  reminders: 'alvid_crm_reminders',
  users: 'alvid_crm_users',
  notifications: 'alvid_crm_notifications',
  interactionTypes: 'alvid_crm_interaction_types',
  dataVersion: 'alvid_crm_data_version'
};

// Текущая версия структуры данных.
const DATA_VERSION = 4;

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function loadData() {
  const storedVersion = parseInt(localStorage.getItem(STORAGE_KEYS.dataVersion) || '1', 10);

  let clients = readJson(STORAGE_KEYS.clients, []);
  let contacts = [];

  // Пошаговая миграция: каждая версия выполняет только свой шаг,
  // существующие данные пользователя не затираются.
  if (storedVersion < 2) {
    // v1 -> v2: справочник контактов очищается — контакты теперь
    // заполняются только через импорт из Excel.
    contacts = [];
  } else {
    contacts = readJson(STORAGE_KEYS.contacts, []);
  }
  // v2 -> v3: новые коллекции (users, notifications) сидятся в своих
  // модулях (js/users.js, js/notifications.js) при первом обращении.

  localStorage.setItem(STORAGE_KEYS.dataVersion, String(DATA_VERSION));
  return { clients, contacts };
}

function saveClients(clients) {
  localStorage.setItem(STORAGE_KEYS.clients, JSON.stringify(clients));
  queueServerSave();
}

function saveContacts(contacts) {
  localStorage.setItem(STORAGE_KEYS.contacts, JSON.stringify(contacts));
  queueServerSave();
}
