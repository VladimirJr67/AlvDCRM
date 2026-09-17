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

// Новая запись матрицы. Общая точка входа: и для ручного добавления,
// и для активности «Заказ матриц».
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
