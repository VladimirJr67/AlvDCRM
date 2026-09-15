/* ============================================================
   js/dictionaries.js — общие справочники и справочные списки.

   Типы организаций и должности контактных лиц — общие для всех
   менеджеров: значение, введённое одним, сохраняется в db.json и
   появляется в подсказках у остальных (как типы взаимодействий).

   Здесь же лежат фиксированные списки: мессенджеры и состояния
   поставки для заказов — их достаточно дополнить в этом файле.
   ============================================================ */

let orgTypes = [];
let contactPositions = [];

const ORG_TYPES_KEY = 'alvid_crm_org_types';
const CONTACT_POSITIONS_KEY = 'alvid_crm_contact_positions';

// Мессенджеры, которые можно отметить у контактного лица.
const MESSENGERS = [
  { id: 'telegram', name: 'Telegram', short: 'TG' },
  { id: 'whatsapp', name: 'WhatsApp', short: 'WA' },
  { id: 'max', name: 'МАКС', short: 'MAX' },
  { id: 'viber', name: 'Viber', short: 'VB' }
];

// Состояние поставки в заказе.
const ORDER_CONDITIONS = ['Покраска', 'Сырой', 'Анод', 'Давальческий'];

function messengerName(id) {
  const m = MESSENGERS.find(x => x.id === id);
  return m ? m.name : '';
}

function messengerShort(id) {
  const m = MESSENGERS.find(x => x.id === id);
  return m ? m.short : '';
}

function loadDictionaries() {
  const o = readJson(ORG_TYPES_KEY, []);
  const p = readJson(CONTACT_POSITIONS_KEY, []);
  orgTypes = Array.isArray(o) ? o.filter(v => typeof v === 'string') : [];
  contactPositions = Array.isArray(p) ? p.filter(v => typeof v === 'string') : [];
}

function saveDictionaries() {
  localStorage.setItem(ORG_TYPES_KEY, JSON.stringify(orgTypes));
  localStorage.setItem(CONTACT_POSITIONS_KEY, JSON.stringify(contactPositions));
  queueServerSave();
}

function dictList(kind) {
  return kind === 'positions' ? contactPositions : orgTypes;
}

function dictTitle(kind) {
  return kind === 'positions' ? 'должность' : 'тип организации';
}

function dictNormalize(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

function dictHas(kind, value) {
  const name = dictNormalize(value).toLowerCase();
  if (!name) return false;
  return dictList(kind).some(v => v.toLowerCase() === name);
}

// Добавление без записи — чтобы при массовом переносе не сохранять каждый раз.
function dictAddSilent(kind, value) {
  const name = dictNormalize(value);
  if (!name) return false;
  const list = dictList(kind);
  if (list.some(v => v.toLowerCase() === name.toLowerCase())) return false;
  list.push(name);
  list.sort((a, b) => a.localeCompare(b, 'ru'));
  return true;
}

// Добавить значение в общий справочник (используется подсказкой и формами).
function dictAdd(kind, value) {
  const name = dictNormalize(value);
  if (!name) return { ok: false, added: false, error: 'Пустое значение' };
  const added = dictAddSilent(kind, name);
  if (added) saveDictionaries();
  return { ok: true, added: added };
}

// Поиск для подсказок: сначала совпадения с начала строки.
function dictItems(kind, query, limit) {
  const list = dictList(kind);
  const max = limit || 8;
  const q = dictNormalize(query).toLowerCase();
  if (!q) return list.slice(0, max);
  const starts = [];
  const contains = [];
  list.forEach(v => {
    const low = v.toLowerCase();
    if (low.startsWith(q)) starts.push(v);
    else if (low.includes(q)) contains.push(v);
  });
  return starts.concat(contains).slice(0, max);
}

// Перенос уже введённых значений в справочники: у клиентов и их контактов
// могли быть типы организации и должности, набранные до появления подсказок.
function seedDictionariesFromData() {
  let changed = false;
  const list = (typeof clients !== 'undefined' && clients) ? clients : [];
  list.forEach(c => {
    if (dictAddSilent('orgTypes', c.orgDirection)) changed = true;
    (c.contacts || []).forEach(ct => {
      if (dictAddSilent('positions', ct.position)) changed = true;
    });
  });
  if (changed) saveDictionaries();
  return changed;
}

/* ===== Комбобокс со справочником =====
   Поле с подсказками из общего справочника и пунктом «+ Добавить».
   Разметка поля: input[data-dict] внутри .client-typeahead-group. */

function dictDropdownFor(input) {
  return input && input.parentNode
    ? input.parentNode.querySelector('.client-typeahead-dropdown')
    : null;
}

function hideDictDropdown(input) {
  const dd = dictDropdownFor(input);
  if (dd) dd.style.display = 'none';
}

function renderDictDropdown(input) {
  if (!input) return;
  const dd = dictDropdownFor(input);
  if (!dd) return;

  const kind = input.dataset.dict || 'orgTypes';
  const query = (input.value || '').trim();
  const items = dictItems(kind, query);

  let html = items.map(v =>
    `<div class="client-typeahead-item" data-dict-value="${escapeHtml(v)}">${escapeHtml(v)}</div>`
  ).join('');

  // Значения нет в справочнике — предлагаем сразу его добавить.
  if (query && !dictHas(kind, query)) {
    html += `<div class="client-typeahead-item dict-add" data-dict-add="${escapeHtml(query)}">+ Добавить «${escapeHtml(query)}» в справочник</div>`;
  }
  if (!html) html = `<div class="manager-option-empty">Справочник пуст — введите ${dictTitle(kind)}</div>`;

  dd.innerHTML = html;
  dd.style.display = 'block';
}

function onDictFocus(input) {
  if (!input) return;
  if (input.select) input.select();
  renderDictDropdown(input);
}

function onDictInput(input) {
  renderDictDropdown(input);
}

// Клик по подсказке справочника: подставляем значение,
// а для пункта «+ Добавить» — сразу сохраняем его в общий справочник.
document.addEventListener('click', (e) => {
  if (!e.target || !e.target.closest) return;
  const item = e.target.closest('[data-dict-value], [data-dict-add]');
  if (!item) return;

  const group = item.closest('.client-typeahead-group');
  const input = group ? group.querySelector('input[data-dict]') : null;
  if (!input) return;

  const value = item.dataset.dictValue || item.dataset.dictAdd;
  if (item.dataset.dictAdd) dictAdd(input.dataset.dict, value);
  input.value = value;
  hideDictDropdown(input);

  // Даём формам возможность отреагировать (например, пересчитать что-то).
  if (typeof input.onchange === 'function') input.onchange();
});
