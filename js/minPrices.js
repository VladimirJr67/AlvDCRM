/* ============================================================
   js/minPrices.js — блок «Минимальные цены за КГ».

   Три цены по покрытиям: Анод, Сырой, Покраска. Значения общие для
   всех (лежат в базе, коллекция minPrices) и меняются только
   администратором. При изменении цены запоминается дата, её видно
   и в подсказке блока, и в окне редактирования.
   ============================================================ */

let minPrices = {};

// Покрытия, для которых ведём цены. Совпадают с состояниями поставки
// в заказах (Давальческий в цены не входит).
const MIN_PRICE_KEYS = ['Анод', 'Сырой', 'Покраска'];

function loadMinPrices() {
  const saved = readJson('alvid_crm_min_prices', {});
  minPrices = (saved && typeof saved === 'object' && !Array.isArray(saved)) ? saved : {};
}

function saveMinPrices() {
  localStorage.setItem('alvid_crm_min_prices', JSON.stringify(minPrices));
  queueServerSave();
  renderMinPricesBlock();
}

function minPriceValue(key) {
  const item = minPrices[key];
  const value = item && item.value !== undefined && item.value !== null && item.value !== ''
    ? Number(item.value)
    : null;
  return (value === null || isNaN(value)) ? null : value;
}

function minPriceUpdatedAt(key) {
  const item = minPrices[key];
  return (item && item.updatedAt) ? item.updatedAt : '';
}

function formatMinPriceDate(iso) {
  if (!iso) return 'дата не указана';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/* ===== Блок в боковом меню ===== */

// Блок стоит над курсами ЦБ и показывает три цены с датами изменения.
function renderMinPricesBlock() {
  const host = document.getElementById('sidebarMinPrices');
  if (!host) return;

  const rows = MIN_PRICE_KEYS.map(key => {
    const value = minPriceValue(key);
    const updated = minPriceUpdatedAt(key);
    const title = 'Минимальная цена за кг — ' + key +
      (updated ? ' · изменена ' + formatMinPriceDate(updated) : ' · цена не задана');
    return `
      <div class="min-price-row" title="${escapeHtml(title)}">
        <span class="min-price-name">${escapeHtml(key)}</span>
        <span class="min-price-value">${value === null ? '—' : fmtMoney(value)}</span>
      </div>`;
  }).join('');

  host.innerHTML = `
    <div class="min-prices${isAdmin() ? ' clickable' : ''}" ${isAdmin() ? 'onclick="openMinPricesModal()" title="Нажмите, чтобы изменить цены"' : ''}>
      <div class="min-prices-head">
        <span>Мин. цены за кг</span>
        ${isAdmin() ? '<span class="min-prices-edit">изменить</span>' : ''}
      </div>
      ${rows}
    </div>
  `;
}

/* ===== Редактирование (только администратор) ===== */

function openMinPricesModal() {
  if (!isAdmin()) { alert('Цены меняет администратор.'); return; }

  const host = document.getElementById('minPricesForm');
  if (!host) return;

  host.innerHTML = MIN_PRICE_KEYS.map(key => `
    <div class="form-row">
      <div class="form-group">
        <label>${escapeHtml(key)} — цена за кг</label>
        <input type="number" min="0" step="0.01" data-min-price="${escapeHtml(key)}"
               value="${minPriceValue(key) === null ? '' : minPriceValue(key)}">
        <div class="field-hint">Изменена: ${escapeHtml(formatMinPriceDate(minPriceUpdatedAt(key)))}</div>
      </div>
    </div>`).join('');

  document.getElementById('minPricesModal').classList.add('active');
}

function saveMinPrices() {
  if (!isAdmin()) { alert('Цены меняет администратор.'); return; }

  const inputs = document.querySelectorAll('[data-min-price]');
  const now = new Date().toISOString();
  let changed = 0;

  Array.from(inputs || []).forEach(input => {
    const key = input.dataset.minPrice;
    const raw = String(input.value == null ? '' : input.value).trim();
    const value = raw === '' ? null : Number(raw);
    if (raw !== '' && (isNaN(value) || value < 0)) return;

    const previous = minPriceValue(key);
    const isChanged = (value === null && previous !== null) || (value !== null && value !== previous);
    if (!isChanged) return;

    if (value === null) delete minPrices[key];
    else minPrices[key] = { value: value, updatedAt: now, updatedBy: currentUser ? currentUser.id : null };
    changed++;
  });

  if (changed) saveMinPrices();
  else renderMinPricesBlock();

  closeModal('minPricesModal');
  if (currentSection === 'orders') renderOrders();
}
