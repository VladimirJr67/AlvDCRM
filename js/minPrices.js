/* ============================================================
   js/minPrices.js — блок «Минимальные цены за КГ».

   Три цены по покрытиям: Анод, Сырой, Покраска. Значения общие для всех
   (коллекция minPrices в базе) и меняются только администратором.
   У каждой цены видно дату последнего изменения, а полная история правок
   открывается кнопкой «История изменения цен» (коллекция minPriceHistory).
   ============================================================ */

let minPrices = {};
let minPriceHistory = [];

// Покрытия, для которых ведём цены. Совпадают с состояниями поставки
// в заказах (Давальческий в цены не входит).
const MIN_PRICE_KEYS = ['Анод', 'Сырой', 'Покраска'];

function loadMinPrices() {
  const saved = readJson('alvid_crm_min_prices', {});
  minPrices = (saved && typeof saved === 'object' && !Array.isArray(saved)) ? saved : {};

  const history = readJson('alvid_crm_min_prices_history', []);
  minPriceHistory = Array.isArray(history) ? history : [];
}

// Запись цен и истории в LocalStorage с синхронизацией в db.json.
// Внимание: имя функции отличается от обработчика кнопки «Сохранить»
// (saveMinPrices ниже) — раньше обе назывались одинаково, из-за чего
// вторая перекрывала первую и цены не сохранялись вовсе.
function persistMinPrices() {
  localStorage.setItem('alvid_crm_min_prices', JSON.stringify(minPrices));
  localStorage.setItem('alvid_crm_min_prices_history', JSON.stringify(minPriceHistory));
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

// Короткая дата для блока в сайдбаре: 16.09.2026
function formatMinPriceShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function minPriceAuthor(updatedBy) {
  const u = updatedBy ? findUserById(updatedBy) : null;
  return u ? (u.name || u.login) : '—';
}

/* ===== Блок в боковом меню ===== */

// Блок стоит над курсами ЦБ: три цены, дата изменения и кнопка истории.
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
        <div class="min-price-main">
          <span class="min-price-name">${escapeHtml(key)}</span>
          <span class="min-price-value">${value === null ? '—' : fmtMoney(value)}</span>
        </div>
        <div class="min-price-date">${updated ? 'изменена ' + escapeHtml(formatMinPriceShortDate(updated)) : 'цена не задана'}</div>
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
    <button type="button" class="min-prices-history-btn" onclick="openMinPricesHistory()"
            title="Все изменения минимальных цен за кг">История изменения цен</button>
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
        <div class="field-hint">Последнее изменение: ${escapeHtml(formatMinPriceDate(minPriceUpdatedAt(key)))}${
          minPriceLastReason(key) ? ' · причина: ' + escapeHtml(minPriceLastReason(key)) : ''
        }</div>
      </div>
    </div>`).join('') + `
    <div class="form-row">
      <div class="form-group">
        <label>Причина изменения *</label>
        <textarea id="minPriceReason" rows="2" placeholder="Например, новый прайс поставщика"></textarea>
        <div class="field-hint">
          Обязательна при изменении цены — сохранится в «Истории изменения цен».
        </div>
      </div>
    </div>`;

  document.getElementById('minPricesModal').classList.add('active');
}

// Причина последнего изменения цены — показывается в подсказке формы.
function minPriceLastReason(key) {
  const list = (minPriceHistory || []).filter(h => h && h.key === key && h.reason);
  if (!list.length) return '';
  list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return String(list[0].reason || '');
}

function saveMinPrices() {
  if (!isAdmin()) { alert('Цены меняет администратор.'); return; }

  const inputs = document.querySelectorAll('[data-min-price]');
  const reasonEl = document.getElementById('minPriceReason');
  const reason = reasonEl ? String(reasonEl.value || '').trim() : '';
  const now = new Date().toISOString();
  const authorId = currentUser ? currentUser.id : null;

  // Сначала собираем изменения: причина обязательна, если цены меняются.
  const changes = [];
  Array.from(inputs || []).forEach(input => {
    const key = input.dataset.minPrice;
    const raw = String(input.value == null ? '' : input.value).trim();
    const value = raw === '' ? null : Number(raw);
    if (raw !== '' && (isNaN(value) || value < 0)) return;

    const previous = minPriceValue(key);
    const isChanged = (value === null && previous !== null) || (value !== null && value !== previous);
    if (!isChanged) return;
    changes.push({ key: key, value: value, previous: previous });
  });

  if (!changes.length) {
    renderMinPricesBlock();
    closeModal('minPricesModal');
    return;
  }
  if (!reason) {
    alert('Укажите причину изменения цены — без неё цена не сохраняется.');
    return;
  }

  changes.forEach(c => {
    // Каждое изменение пишем в историю: цена, причина, дата, кто изменил.
    minPriceHistory.push({
      id: minPriceHistory.reduce((m, h) => Math.max(m, h.id || 0), 0) + 1,
      key: c.key,
      value: c.value,
      previous: c.previous,
      reason: reason,
      updatedAt: now,
      updatedBy: authorId
    });

    if (c.value === null) delete minPrices[c.key];
    else minPrices[c.key] = { value: c.value, updatedAt: now, updatedBy: authorId, reason: reason };
  });

  persistMinPrices();
  closeModal('minPricesModal');
  if (currentSection === 'orders') renderOrders();
}

/* ===== История изменений ===== */

function openMinPricesHistory() {
  const content = document.getElementById('minPricesHistoryContent');
  if (!content) return;

  const list = [...minPriceHistory].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  content.innerHTML = `
    <div style="font-size:12px;color:#6b7280;margin-bottom:12px;">
      Всего записей: <strong>${list.length}</strong> · от новых к старым
    </div>
    ${list.length === 0 ? `
      <div class="empty-state" style="padding:40px 20px;"><p>Изменений цен пока не было</p></div>
    ` : `
      <div class="scrollable-table">
        <div class="table-body" style="max-height:60vh;">
          <table class="admin-table">
            <thead><tr>
              <th style="width:130px">Дата и время</th>
              <th style="width:110px">Покрытие</th>
              <th style="width:150px">Цена за кг</th>
              <th style="width:120px">Кто изменил</th>
              <th>Причина</th>
            </tr></thead>
            <tbody>
              ${list.map(h => `
                <tr style="cursor:default;">
                  <td>${escapeHtml(formatMinPriceDate(h.updatedAt))}</td>
                  <td><span class="badge">${escapeHtml(h.key)}</span></td>
                  <td>
                    ${h.value === null || h.value === undefined
                      ? '<span style="color:#9ca3af;">цена убрана</span>'
                      : '<strong>' + escapeHtml(fmtMoney(h.value)) + '</strong>'}
                    ${h.previous !== null && h.previous !== undefined
                      ? `<span style="color:#9ca3af;font-size:11px;"> было ${escapeHtml(fmtMoney(h.previous))}</span>`
                      : ''}
                  </td>
                  <td>${escapeHtml(minPriceAuthor(h.updatedBy))}</td>
                  <td>${h.reason ? escapeHtml(h.reason) : '<span style="color:#9ca3af;">—</span>'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `}
  `;

  document.getElementById('minPricesHistoryModal').classList.add('active');
}
