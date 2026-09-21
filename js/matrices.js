/* ============================================================
   js/matrices.js — вкладка «Матрицы» раздела «Заказы/Матрицы».

   Матрица — заказ с шифром и покрытием. Записи появляются двумя путями:
   комментарием с типом активности «Заказ матриц» (js/clients.js) и вручную
   кнопкой «+ Добавить матрицу». Статусы: «Поступила» и «Отписана».

   Права такие же, как у заказов: менеджер видит только свои матрицы,
   администратор — все или матрицы выбранного пользователя. У нового
   аккаунта вкладка пуста: чужие записи ему не показываются.

   Фильтры вкладки — свои, отдельно от фильтров заказов: по клиенту,
   по покрытию и по статусу.
   ============================================================ */

// Покрытия матриц — три прайсовых покрытия (те же, что в минимальных ценах).
const MATRIX_COVERAGES = ['Сырой', 'Анод', 'Покраска'];

// Статусы заказа матриц.
const MATRIX_STATUSES = ['Поступила', 'Отписана'];

const MATRICES_KEY = 'alvid_crm_matrices';

// Состояние фильтров вкладки «Матрицы».
let matricesClientFilter = '';
let matricesCoverageFilter = '';
let matricesStatusFilter = '';
let matricesUserFilter = 'all';     // для администратора: 'all' или id пользователя
let matricesDateFrom = null;
let matricesDateTo = null;

function loadMatrices() {
  const saved = localStorage.getItem(MATRICES_KEY);
  if (saved) {
    try { matrices = JSON.parse(saved); } catch (e) { matrices = []; }
  }
  if (!Array.isArray(matrices)) matrices = [];
}

function saveMatrices() {
  localStorage.setItem(MATRICES_KEY, JSON.stringify(matrices));
  queueServerSave();
}

// Новая запись матрицы. Общая точка входа: для активности «Заказ матриц»
// (source: 'order') и для ручного добавления в «Учёт матриц»/карточке клиента
// (source: 'manual').
function addMatrix(data) {
  const maxId = matrices.reduce((m, x) => Math.max(m, x.id || 0), 0);
  const status = MATRIX_STATUSES.indexOf(data.status) > -1 ? data.status : MATRIX_STATUSES[0];
  const matrix = {
    id: maxId + 1,
    cipher: (data.cipher || '').trim(),
    coating: (data.coating || '').trim(),
    status: status,
    clientId: data.clientId != null ? data.clientId : null,
    clientName: (data.clientName || '').trim(),
    date: data.date || new Date().toISOString().slice(0, 10),
    comment: (data.comment || '').trim(),
    weightPerM: (data.weightPerM || '').trim(),
    press: (data.press || '').trim(),
    source: data.source === 'order' ? 'order' : 'manual',
    createdAt: new Date().toISOString(),
    createdBy: data.createdBy !== undefined ? data.createdBy : (currentUser ? currentUser.id : null)
  };
  matrices.push(matrix);
  saveMatrices();
  return matrix;
}

/* ===== Права и фильтры ===== */

// Менеджер видит только свои матрицы; администратор — все
// или матрицы выбранного пользователя.
function visibleMatrices() {
  if (!currentUser) return [];
  if (isAdmin()) {
    if (matricesUserFilter !== 'all') {
      const uid = parseInt(matricesUserFilter, 10);
      return matrices.filter(m => m.createdBy === uid);
    }
    return matrices;
  }
  return matrices.filter(m => m.createdBy === currentUser.id);
}

function matrixInPeriod(m) {
  if (!matricesDateFrom && !matricesDateTo) return true;
  const day = String(m.date || '').slice(0, 10);
  if (!day) return true;
  if (matricesDateFrom && day < matricesDateFrom) return false;
  if (matricesDateTo && day > matricesDateTo) return false;
  return true;
}

function filteredMatrices() {
  return visibleMatrices()
    .filter(matrixInPeriod)
    .filter(m => !matricesClientFilter || String(m.clientId) === String(matricesClientFilter))
    .filter(m => !matricesCoverageFilter || (m.coating || '') === matricesCoverageFilter)
    .filter(m => !matricesStatusFilter || (m.status || '') === matricesStatusFilter);
}

function setMatricesFilter(kind, value) {
  if (kind === 'client') matricesClientFilter = value || '';
  else if (kind === 'coverage') matricesCoverageFilter = value || '';
  else if (kind === 'status') matricesStatusFilter = value || '';
  else if (kind === 'user') matricesUserFilter = value || 'all';
  else if (kind === 'from') matricesDateFrom = value || null;
  else if (kind === 'to') matricesDateTo = value || null;
  renderMatricesTab();
}

function resetMatricesFilters() {
  matricesClientFilter = '';
  matricesCoverageFilter = '';
  matricesStatusFilter = '';
  matricesUserFilter = 'all';
  matricesDateFrom = null;
  matricesDateTo = null;
  renderMatricesTab();
}

// Покрытия: три прайсовых плюс те, что уже встречаются в записях,
// чтобы старые матрицы с нестандартным покрытием тоже фильтровались.
function matrixCoverageOptions() {
  const list = MATRIX_COVERAGES.slice();
  visibleMatrices().forEach(m => {
    const c = (m.coating || '').trim();
    if (c && list.indexOf(c) === -1) list.push(c);
  });
  return list;
}

// Клиенты, по которым есть видимые матрицы.
function matrixClientOptions() {
  const map = {};
  visibleMatrices().forEach(m => {
    if (m.clientId) map[m.clientId] = m.clientName || ('Клиент #' + m.clientId);
  });
  return Object.keys(map)
    .map(id => ({ id: id, name: map[id] }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/* ===== Вкладка «Матрицы» ===== */

function renderMatricesTab() {
  const host = document.getElementById('ordersTabBody');
  if (!host) return;

  const list = filteredMatrices().sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
  // Считаем по доступным пользователю записям: у нового аккаунта база не пуста,
  // но его собственных матриц в ней нет.
  const mine = visibleMatrices();
  const periodSet = !!(matricesDateFrom || matricesDateTo);
  const filtersSet = periodSet || !!matricesClientFilter || !!matricesCoverageFilter ||
    !!matricesStatusFilter || matricesUserFilter !== 'all';
  const received = list.filter(m => m.status === 'Поступила').length;
  const writtenOff = list.filter(m => m.status === 'Отписана').length;

  const clientOpts = matrixClientOptions().map(c =>
    `<option value="${c.id}"${String(matricesClientFilter) === String(c.id) ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  const coverageOpts = matrixCoverageOptions().map(c =>
    `<option value="${escapeHtml(c)}"${matricesCoverageFilter === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
  const userOpts = users.map(u =>
    `<option value="${u.id}"${String(matricesUserFilter) === String(u.id) ? ' selected' : ''}>${escapeHtml(u.name || u.login)}</option>`).join('');

  host.innerHTML = `
    <div class="orders-filters">
      ${isAdmin() ? `
        <label>Пользователь
          <select onchange="setMatricesFilter('user', this.value)">
            <option value="all"${matricesUserFilter === 'all' ? ' selected' : ''}>Все пользователи</option>
            ${userOpts}
          </select>
        </label>` : ''}
      <label>Клиент
        <select onchange="setMatricesFilter('client', this.value)">
          <option value="">Все клиенты</option>
          ${clientOpts}
        </select>
      </label>
      <label>Покрытие
        <select onchange="setMatricesFilter('coverage', this.value)">
          <option value="">Все покрытия</option>
          ${coverageOpts}
        </select>
      </label>
      <label>Статус
        <select onchange="setMatricesFilter('status', this.value)">
          <option value="">Все статусы</option>
          ${MATRIX_STATUSES.map(s => `<option value="${escapeHtml(s)}"${matricesStatusFilter === s ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('')}
        </select>
      </label>
      <label>Период с
        <input type="date" value="${escapeHtml(matricesDateFrom || '')}" onchange="setMatricesFilter('from', this.value)">
      </label>
      <label>по
        <input type="date" value="${escapeHtml(matricesDateTo || '')}" onchange="setMatricesFilter('to', this.value)">
      </label>
      ${filtersSet ? '<button class="btn btn-sm btn-secondary" onclick="resetMatricesFilters()">Сбросить</button>' : ''}
      <button class="btn btn-sm" onclick="openMatrixModal()">+ Добавить матрицу</button>
      ${isAdmin() ? '<button class="btn btn-sm btn-secondary" onclick="exportMatricesExcel()">Экспорт в Excel</button>' : ''}
    </div>

    <div class="orders-stats">
      <div class="stat-card"><div class="stat-value" style="color:#1a3a5c">${list.length}</div><div class="stat-label">Всего матриц</div></div>
      <div class="stat-card"><div class="stat-value" style="color:#10b981">${received}</div><div class="stat-label">Поступила</div></div>
      <div class="stat-card"><div class="stat-value" style="color:#6b7280">${writtenOff}</div><div class="stat-label">Отписана</div></div>
    </div>

    ${list.length === 0 ? `
      <div class="empty-state" style="padding:60px 20px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
        <p>${mine.length === 0 ? 'Матриц пока нет.' : 'По выбранным фильтрам матриц нет.'}</p>
        ${mine.length === 0 ? `<p style="font-size:12px;color:#9ca3af;margin-top:6px;">
          Добавьте комментарий клиенту с типом «Заказ матриц» или нажмите «+ Добавить матрицу».
        </p>` : ''}
      </div>
    ` : `
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:auto;">
        <div class="table-body" style="max-height:calc(100vh - 470px);">
          <table class="admin-table">
            <thead><tr>
              <th>Дата</th><th>Клиент</th><th>Шифр</th><th>Покрытие</th><th>Статус</th>${isAdmin() ? '<th>Менеджер</th>' : ''}<th>Комментарий</th><th style="text-align:right;">Действия</th>
            </tr></thead>
            <tbody>
              ${list.map(m => {
                const clientCell = m.clientId
                  ? `<a href="#" onclick="event.preventDefault();goToClient(${m.clientId});">${escapeHtml(m.clientName || '—')}</a>`
                  : escapeHtml(m.clientName || '—');
                const owner = m.createdBy ? findUserById(m.createdBy) : null;
                const canEdit = isAdmin() || (currentUser && m.createdBy === currentUser.id);
                return `<tr style="cursor:default;">
                  <td>${escapeHtml(String(m.date || '—'))}</td>
                  <td>${clientCell}</td>
                  <td><strong>${escapeHtml(m.cipher || '—')}</strong></td>
                  <td>${escapeHtml(m.coating || '—')}</td>
                  <td>
                    <select onchange="setMatrixStatus(${m.id}, this.value)" ${canEdit ? '' : 'disabled'}
                            style="padding:4px 6px;border:1px solid ${m.status === 'Отписана' ? '#d1d5db' : '#10b981'};border-radius:5px;font-size:12px;">
                      ${MATRIX_STATUSES.map(s => `<option value="${escapeHtml(s)}"${m.status === s ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('')}
                    </select>
                  </td>
                  ${isAdmin() ? `<td>${escapeHtml(owner ? (owner.name || owner.login) : '—')}</td>` : ''}
                  <td style="max-width:240px;">${escapeHtml(m.comment || '—')}</td>
                  <td style="text-align:right;white-space:nowrap;">
                    ${canEdit ? `<button class="btn-icon-btn" onclick="openMatrixModal(${m.id})" title="Изменить">Изменить</button>
                    <button class="btn-icon-btn" onclick="deleteMatrix(${m.id})" title="Удалить">Удалить</button>` : ''}
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `}
  `;
}

/* ===== Добавление и правка (окно) ===== */

function matrixClientSelectOptions(selectedId) {
  return `<option value="">— не выбран —</option>` + clients
    .slice()
    .sort((a, b) => String(a.orgName || '').localeCompare(String(b.orgName || ''), 'ru'))
    .map(c => `<option value="${c.id}"${String(selectedId) === String(c.id) ? ' selected' : ''}>${escapeHtml(c.orgName || ('Клиент #' + c.id))}</option>`)
    .join('');
}

function openMatrixModal(id) {
  const m = id ? matrices.find(x => x.id === id) : null;
  if (id && !m) return;
  if (m && !isAdmin() && (!currentUser || m.createdBy !== currentUser.id)) {
    alert('Чужую матрицу менять может только администратор.');
    return;
  }

  const title = document.getElementById('matrixModalTitle');
  if (title) title.textContent = m ? 'Матрица №' + m.id : 'Новая матрица';

  document.getElementById('matrixId').value = m ? m.id : '';
  document.getElementById('matrixCipher').value = m ? (m.cipher || '') : '';
  document.getElementById('matrixClient').innerHTML = matrixClientSelectOptions(m ? m.clientId : '');
  document.getElementById('matrixCoatingInput').innerHTML = '<option value="">—</option>' +
    matrixCoverageOptions().map(c => `<option value="${escapeHtml(c)}"${m && m.coating === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
  document.getElementById('matrixStatus').innerHTML = MATRIX_STATUSES
    .map(s => `<option value="${escapeHtml(s)}"${m && m.status === s ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('');
  document.getElementById('matrixDate').value = m ? String(m.date || '').slice(0, 10) : new Date().toISOString().slice(0, 10);
  document.getElementById('matrixComment').value = m ? (m.comment || '') : '';

  document.getElementById('matrixModal').classList.add('active');
}

function saveMatrixFromModal(e) {
  if (e && e.preventDefault) e.preventDefault();
  const idRaw = document.getElementById('matrixId').value;
  const cipher = String(document.getElementById('matrixCipher').value || '').trim();
  if (!cipher) { alert('Укажите шифр матрицы'); return; }

  const clientIdRaw = document.getElementById('matrixClient').value;
  const clientId = clientIdRaw ? parseInt(clientIdRaw, 10) : null;
  const client = clientId ? clients.find(c => c.id === clientId) : null;
  const data = {
    cipher: cipher,
    clientId: clientId,
    clientName: client ? (client.orgName || '') : '',
    coating: String(document.getElementById('matrixCoatingInput').value || '').trim(),
    status: document.getElementById('matrixStatus').value,
    date: document.getElementById('matrixDate').value || new Date().toISOString().slice(0, 10),
    comment: String(document.getElementById('matrixComment').value || '').trim()
  };

  if (idRaw) {
    const m = matrices.find(x => x.id === parseInt(idRaw, 10));
    if (!m) return;
    if (!isAdmin() && (!currentUser || m.createdBy !== currentUser.id)) {
      alert('Чужую матрицу менять может только администратор.');
      return;
    }
    Object.assign(m, data);
    saveMatrices();
  } else {
    addMatrix(data);
  }

  closeModal('matrixModal');
  renderMatricesTab();
}

function setMatrixStatus(id, status) {
  const m = matrices.find(x => x.id === id);
  if (!m) return;
  if (!isAdmin() && (!currentUser || m.createdBy !== currentUser.id)) {
    alert('Менять статус чужой матрицы может только администратор.');
    renderMatricesTab();
    return;
  }
  if (MATRIX_STATUSES.indexOf(status) < 0) return;
  m.status = status;
  saveMatrices();
  renderMatricesTab();
}

function deleteMatrix(id) {
  const m = matrices.find(x => x.id === id);
  if (!m) return;
  if (!isAdmin() && (!currentUser || m.createdBy !== currentUser.id)) {
    alert('Удалять чужие матрицы может только администратор.');
    return;
  }
  if (!confirm(`Удалить матрицу «${m.cipher || '—'}»?`)) return;
  matrices = matrices.filter(x => x.id !== id);
  saveMatrices();
  renderMatricesTab();
}

/* ============================================================
   «Матрицы клиента» — список матриц, привязанных к карточке клиента.
   Отдельно от заказов матриц (matrices[]): это простой справочник
   Шифр / Вес м/п / Пресс (5, 7, 8, 7/8) конкретного клиента.
   ============================================================ */

const CLIENT_MATRIX_PRESSES = ['5', '7', '8', '7/8'];

function clientMatricesFor(clientId) {
  return (matrices || []).filter(m => m && String(m.clientId) === String(clientId));
}

function saveClientMatrices() {
  saveMatrices();
}

function updateClientMatricesCount(clientId) {
  const el = document.getElementById('clientMatricesCount');
  if (!el) return;
  const count = clientId != null ? clientMatricesFor(clientId).length : 0;
  el.textContent = count ? `(${count})` : '';
}

function openClientMatrices(clientId) {
  const client = clients.find(c => c.id === clientId);
  if (!client) { alert('Сначала выберите клиента'); return; }
  document.getElementById('clientMatricesClientId').value = clientId;
  document.getElementById('clientMatricesModalTitle').textContent = 'Матрицы клиента — ' + (client.orgName || '');
  resetClientMatrixForm();
  renderClientMatricesList(clientId);
  document.getElementById('clientMatricesModal').classList.add('active');
}

function resetClientMatrixForm() {
  const cipher = document.getElementById('clientMatrixCipher');
  if (cipher) cipher.value = '';
  const weight = document.getElementById('clientMatrixWeight');
  if (weight) weight.value = '';
  const press = document.getElementById('clientMatrixPress');
  if (press) press.value = CLIENT_MATRIX_PRESSES[0];
  const editId = document.getElementById('clientMatrixEditId');
  if (editId) editId.value = '';
}

function renderClientMatricesList(clientId) {
  const tbody = document.getElementById('clientMatricesTableBody');
  const modalCount = document.getElementById('clientMatricesModalCount');
  const list = clientMatricesFor(clientId).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  if (modalCount) modalCount.textContent = list.length ? `(${list.length})` : '';
  updateClientMatricesCount(clientId);
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#9ca3af;padding:24px;">Матриц пока нет</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(m => `
    <tr>
      <td><strong>${escapeHtml(m.cipher || '—')}</strong></td>
      <td>${escapeHtml(m.weightPerM || '—')}</td>
      <td>${escapeHtml(m.press || '—')}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn-icon-btn" onclick="editClientMatrix(${m.id})" title="Изменить матрицу">Изменить</button>
        <button class="btn-icon-btn" onclick="deleteClientMatrix(${m.id})" title="Удалить матрицу">Удалить</button>
      </td>
    </tr>`).join('');
}

function editClientMatrix(id) {
  const m = (matrices || []).find(x => x.id === id);
  if (!m) return;
  document.getElementById('clientMatrixEditId').value = m.id;
  document.getElementById('clientMatrixCipher').value = m.cipher || '';
  document.getElementById('clientMatrixWeight').value = m.weightPerM || '';
  document.getElementById('clientMatrixPress').value = m.press || CLIENT_MATRIX_PRESSES[0];
}

function addClientMatrix(e) {
  if (e && e.preventDefault) e.preventDefault();
  const clientIdRaw = document.getElementById('clientMatricesClientId').value;
  const clientId = clientIdRaw ? parseInt(clientIdRaw, 10) : null;
  if (!clientId) { alert('Сначала выберите клиента'); return; }
  const client = clients.find(c => c.id === clientId);

  const cipher = String(document.getElementById('clientMatrixCipher').value || '').trim();
  if (!cipher) { alert('Укажите шифр матрицы'); return; }
  const weightPerM = String(document.getElementById('clientMatrixWeight').value || '').trim();
  const press = document.getElementById('clientMatrixPress').value;
  const editIdRaw = document.getElementById('clientMatrixEditId').value;
  const editId = editIdRaw ? parseInt(editIdRaw, 10) : null;

  if (editId) {
    const m = (matrices || []).find(x => x.id === editId);
    if (!m) { alert('Матрица не найдена'); return; }
    m.cipher = cipher;
    m.weightPerM = weightPerM;
    m.press = press;
    saveMatrices();
  } else {
    addMatrix({
      cipher: cipher,
      weightPerM: weightPerM,
      press: press,
      clientId: clientId,
      clientName: client ? (client.orgName || '') : '',
      source: 'manual',
      createdBy: currentUser ? currentUser.id : null
    });
  }
  resetClientMatrixForm();
  renderClientMatricesList(clientId);
}

function deleteClientMatrix(id) {
  const m = (matrices || []).find(x => x.id === id);
  if (!m) return;
  if (!confirm(`Удалить матрицу «${m.cipher || '—'}»?`)) return;
  matrices = (matrices || []).filter(x => x.id !== id);
  saveMatrices();
  renderClientMatricesList(m.clientId);
}

/* ============================================================
   «Учёт матриц» — общий список всех матриц: и созданные активностью
   «Заказ матриц» (source: 'order'), и добавленные вручную (source: 'manual').
   Одна коллекция matrices — та же, что в карточке клиента.
   ============================================================ */

let matrixAccountingSearch = '';

function matrixAccountingList() {
  const q = String(matrixAccountingSearch || '').trim().toLowerCase();
  return [...matrices]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .filter(m => {
      if (!q) return true;
      const clientName = String(m.clientName || '').toLowerCase();
      const cipher = String(m.cipher || '').toLowerCase();
      const weight = String(m.weightPerM || '').toLowerCase();
      return clientName.includes(q) || cipher.includes(q) || weight.includes(q);
    });
}

function setMatrixAccountingSearch(value) {
  matrixAccountingSearch = value || '';
  renderMatrixAccounting();
}

function renderMatrixAccounting() {
  const main = document.getElementById('mainContent');
  if (!main) return;
  const canAdd = isAdmin() || (typeof can === 'function' && can('matrices.create'));
  const list = matrixAccountingList();

  main.innerHTML = `
    <div class="orders-page">
      <div class="orders-head">
        <h1>Учёт матриц</h1>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <input type="text" class="search-bar" placeholder="Поиск по шифру, клиенту, весу…" value="${escapeHtml(matrixAccountingSearch)}" oninput="setMatrixAccountingSearch(this.value)" style="width:300px;max-width:100%;margin-bottom:0;">
          ${canAdd ? '<button class="btn" onclick="openMatrixAccountingModal()">+ Добавить матрицу</button>' : ''}
        </div>
      </div>

      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:auto;">
        <table class="admin-table">
          <thead><tr>
            <th style="width:30%;">Клиент</th>
            <th style="width:20%;">Шифр</th>
            <th style="width:15%;">Вес за м/п</th>
            <th style="width:15%;">Пресс</th>
            <th style="width:20%;text-align:right;">Действия</th>
          </tr></thead>
          <tbody>
            ${list.length ? list.map(m => {
              const c = m.clientId ? clients.find(x => x.id === m.clientId) : null;
              const clientName = c ? (c.orgName || c.name || '') : '';
              return `
              <tr style="cursor:default;">
                <td style="padding-left:16px;">${m.clientId && clientName
                  ? `<a href="#" onclick="event.preventDefault();goToClient(${m.clientId});">${escapeHtml(clientName)}</a>`
                  : '—'}</td>
                <td><strong>${escapeHtml(m.cipher || '—')}</strong></td>
                <td>${escapeHtml(m.weightPerM || '—')}</td>
                <td>${escapeHtml(m.press || '—')}</td>
                <td style="text-align:right;white-space:nowrap;">
                  ${canAdd ? `<button class="btn-icon-btn" onclick="openMatrixAccountingModal(${m.id})" title="Изменить матрицу">Изменить</button>
                  <button class="btn-icon-btn" onclick="deleteMatrixAccounting(${m.id})" title="Удалить матрицу">Удалить</button>` : ''}
                </td>
              </tr>`;
            }).join('') : `<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:40px;">Список пуст</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function openMatrixAccountingModal(id) {
  const modal = document.getElementById('matrixAccountingModal');
  if (!modal) return;
  const m = id ? (matrices || []).find(x => x.id === id) : null;
  const title = document.getElementById('matrixAccountingModalTitle');
  if (title) title.textContent = m ? 'Редактировать матрицу' : 'Новая матрица';
  document.getElementById('matrixAccountingId').value = m ? m.id : '';
  document.getElementById('matrixAccountingCipher').value = m ? (m.cipher || '') : '';
  document.getElementById('matrixAccountingWeight').value = m ? (m.weightPerM || '') : '';
  document.getElementById('matrixAccountingPress').value = (m && m.press) ? m.press : CLIENT_MATRIX_PRESSES[0];
  document.getElementById('matrixAccountingClient').innerHTML = matrixClientSelectOptions(m ? m.clientId : '');
  modal.classList.add('active');
}

function saveMatrixAccounting(e) {
  if (e && e.preventDefault) e.preventDefault();
  const cipher = String(document.getElementById('matrixAccountingCipher').value || '').trim();
  if (!cipher) { alert('Укажите шифр матрицы'); return; }
  const clientIdRaw = document.getElementById('matrixAccountingClient').value;
  const clientId = clientIdRaw ? parseInt(clientIdRaw, 10) : null;
  const client = clientId ? clients.find(c => c.id === clientId) : null;
  const weightPerM = String(document.getElementById('matrixAccountingWeight').value || '').trim();
  const press = document.getElementById('matrixAccountingPress').value;
  const idRaw = document.getElementById('matrixAccountingId').value;
  const id = idRaw ? parseInt(idRaw, 10) : null;

  if (id) {
    const m = (matrices || []).find(x => x.id === id);
    if (!m) { alert('Матрица не найдена'); return; }
    m.cipher = cipher;
    m.clientId = clientId;
    m.clientName = client ? (client.orgName || '') : '';
    m.weightPerM = weightPerM;
    m.press = press;
    saveMatrices();
  } else {
    addMatrix({
      cipher: cipher,
      clientId: clientId,
      clientName: client ? (client.orgName || '') : '',
      weightPerM: weightPerM,
      press: press,
      source: 'manual',
      createdBy: currentUser ? currentUser.id : null
    });
  }
  closeModal('matrixAccountingModal');
  renderMatrixAccounting();
}

function deleteMatrixAccounting(id) {
  const m = (matrices || []).find(x => x.id === id);
  if (!m) return;
  if (!confirm(`Удалить матрицу «${m.cipher || '—'}»?`)) return;
  matrices = (matrices || []).filter(x => x.id !== id);
  saveMatrices();
  renderMatrixAccounting();
}

// Экспорт в Excel — только администратор; выгружается текущая выборка.
function exportMatricesExcel() {
  if (!isAdmin()) { alert('Экспорт матриц доступен администратору.'); return; }
  if (typeof XLSX === 'undefined') {
    alert('Библиотека экспорта Excel не загружена.');
    return;
  }
  const list = filteredMatrices().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const rows = list.map(m => {
    const owner = m.createdBy ? findUserById(m.createdBy) : null;
    return {
      'Дата': m.date || '—',
      'Клиент': m.clientName || '—',
      'Шифр': m.cipher || '—',
      'Покрытие': m.coating || '—',
      'Статус': m.status || '—',
      'Менеджер': owner ? (owner.name || owner.login) : '—',
      'Комментарий': m.comment || '—'
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Матрицы');
  const today = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `Матрицы_${today}.xlsx`);
}
