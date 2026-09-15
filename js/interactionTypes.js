/* ============================================================
   js/interactionTypes.js — типы взаимодействий (комментарии).
   Справочник создаёт/редактирует только администратор (раздел
   «Администрирование → Типы взаимодействий»). Обычные пользователи
   видят его в выпадающем списке формы «+ Добавить» комментарий.
   Данные лежат в LocalStorage и синхронизируются в db.json.
   ============================================================ */

let interactionTypes = [];

const INTERACTION_TYPES_KEY = 'alvid_crm_interaction_types';

// Дефолтный справочник — сидируется только при первом запуске
// (когда в хранилище ещё нет ключа interactionTypes).
// «Размещение заказа» — обязательный тип: при его выборе в комментарии
// открывается форма параметров заказа и создаётся запись в «Заказах».
const DEFAULT_INTERACTION_TYPES = ['Звонок', 'Информация', 'Встреча', 'Письмо', 'Размещение заказа'];

function loadInteractionTypes() {
  const raw = localStorage.getItem(INTERACTION_TYPES_KEY);
  if (raw) {
    try {
      interactionTypes = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
    } catch (e) {
      interactionTypes = [];
    }
    return;
  }
  interactionTypes = DEFAULT_INTERACTION_TYPES.slice();
  saveInteractionTypes();
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
    interactionTypes[index] = name;
    saveInteractionTypes();
    return { ok: true };
  }
  return { ok: false, error: 'Тип не найден' };
}

function deleteInteractionType(index) {
  if (index >= 0 && index < interactionTypes.length) {
    interactionTypes.splice(index, 1);
    saveInteractionTypes();
    return { ok: true };
  }
  return { ok: false, error: 'Тип не найден' };
}
