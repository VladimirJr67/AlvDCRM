/* ============================================================
   js/interactionTypes.js — типы взаимодействий (комментарии).
   Справочник создаёт/редактирует только администратор (раздел
   «Администрирование → Типы взаимодействий»). Обычные пользователи
   видят его в выпадающем списке формы «+ Добавить» комментарий.
   Данные лежат в LocalStorage и синхронизируются в db.json.

   Ряд типов обязателен для работы логики и не удаляется:
     «Размещение заказа» — форма параметров заказа и запись в «Заказах»;
     «Заказ матриц»      — окно шифров и покрытия, записи в matrices[];
     «Отправил КП»       — активность отправки коммерческого предложения;
     «Нерентабелен»      — единственное исключение из правила
                           «активность закрывается только со следующей датой».
   ============================================================ */

let interactionTypes = [];

const INTERACTION_TYPES_KEY = 'alvid_crm_interaction_types';

// Дефолтный справочник — сидируется только при первом запуске
// (когда в хранилище ещё нет ключа interactionTypes).
const DEFAULT_INTERACTION_TYPES = [
  'Звонок', 'Информация', 'Встреча', 'Письмо',
  'Размещение заказа', 'Отправил КП', 'Заказ матриц', 'Нерентабелен'
];

// Типы, которые нельзя удалить: на них опирается логика активностей.
// Список синхронизирован с REQUIRED_INTERACTION_TYPES в server.js.
const PROTECTED_INTERACTION_TYPES = ['Размещение заказа', 'Отправил КП', 'Заказ матриц', 'Нерентабелен'];

function isProtectedInteractionType(name) {
  const needle = String(name == null ? '' : name).trim().toLowerCase();
  return PROTECTED_INTERACTION_TYPES.some(t => t.toLowerCase() === needle);
}

// Дописать недостающие обязательные типы (для баз, созданных до их появления).
// Ничего не удаляем и не переименовываем — только добавляем.
function ensureInteractionTypes() {
  let changed = false;
  PROTECTED_INTERACTION_TYPES.forEach(type => {
    if (!interactionTypes.some(t => String(t).toLowerCase() === type.toLowerCase())) {
      interactionTypes.push(type);
      changed = true;
    }
  });
  if (changed) saveInteractionTypes();
  return changed;
}

function loadInteractionTypes() {
  const raw = localStorage.getItem(INTERACTION_TYPES_KEY);
  if (raw) {
    try {
      interactionTypes = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
    } catch (e) {
      interactionTypes = [];
    }
  } else {
    interactionTypes = DEFAULT_INTERACTION_TYPES.slice();
    saveInteractionTypes();
  }
  ensureInteractionTypes();
}

function saveInteractionTypes() {
  localStorage.setItem(INTERACTION_TYPES_KEY, JSON.stringify(interactionTypes));
  queueServerSave();
}

function addInteractionType(name) {
  name = (name || '').trim();
  if (!name) return { ok: false, error: 'Введите название типа' };
  if (interactionTypes.some(t => t.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: 'Такой тип уже существует' };
  }
  interactionTypes.push(name);
  saveInteractionTypes();
  return { ok: true };
}

function renameInteractionType(index, name) {
  name = (name || '').trim();
  if (!name) return { ok: false, error: 'Введите название типа' };
  if (interactionTypes.some((t, i) => i !== index && t.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: 'Такой тип уже существует' };
  }
  if (index >= 0 && index < interactionTypes.length) {
    const wasProtected = isProtectedInteractionType(interactionTypes[index]);
    if (wasProtected && !isProtectedInteractionType(name)) {
      return { ok: false, error: 'Этот тип обязателен для работы активностей: переименовать его нельзя' };
    }
    interactionTypes[index] = name;
    saveInteractionTypes();
    return { ok: true };
  }
  return { ok: false, error: 'Тип не найден' };
}

function deleteInteractionType(index) {
  if (index < 0 || index >= interactionTypes.length) return { ok: false, error: 'Тип не найден' };
  if (isProtectedInteractionType(interactionTypes[index])) {
    return { ok: false, error: 'Обязательный тип: на нём держится логика активностей, удалить нельзя' };
  }
  interactionTypes.splice(index, 1);
  saveInteractionTypes();
  return { ok: true };
}
