/* ============================================================
   js/transfers.js — перенос клиента между менеджерами через запрос.

   Менеджер не забирает чужого клиента сам: он отправляет запрос, а решение
   принимает тот, кому клиента передают, — «Принять» или «Отклонить».
   Пока решение не принято, клиент остаётся за прежним менеджером.
   Администратор, как и раньше, может передать клиента сразу, без запроса
   (кнопка «Передать сразу» в карточке клиента).

   Запросы лежат в коллекции clientTransferRequests (db.json):
   { id, clientId, clientName, fromManagerId, toManagerId, comment,
     status: 'pending' | 'approved' | 'rejected', createdAt, decidedAt, decidedBy }
   ============================================================ */

const TRANSFER_STATUS_LABELS = {
  pending: 'Ожидает решения',
  approved: 'Принят',
  rejected: 'Отклонён'
};

const TRANSFER_STATUS_COLORS = {
  pending: '#f59e0b',
  approved: '#10b981',
  rejected: '#ef4444'
};

function transferStatusInfo(status) {
  return {
    label: TRANSFER_STATUS_LABELS[status] || '—',
    color: TRANSFER_STATUS_COLORS[status] || '#9ca3af'
  };
}

function saveClientTransferRequests() {
  if (typeof queueServerSave === 'function') queueServerSave();
}

function transferRequestsList() {
  return Array.isArray(clientTransferRequests) ? clientTransferRequests : [];
}

function transferManagerName(id) {
  const u = id ? findUserById(id) : null;
  return u ? (u.name || u.login) : '—';
}

// Активный (ещё не решённый) запрос по клиенту — чтобы не плодить дубли.
function pendingTransferForClient(clientId) {
  return transferRequestsList().find(r =>
    r && r.status === 'pending' && String(r.clientId) === String(clientId)) || null;
}

// Запросы, адресованные текущему пользователю (он решает).
function incomingTransferRequests() {
  if (!currentUser) return [];
  return transferRequestsList().filter(r => r && r.status === 'pending' && r.toManagerId === currentUser.id);
}

// Запросы, отправленные текущим пользователем.
function outgoingTransferRequests() {
  if (!currentUser) return [];
  return transferRequestsList().filter(r => r && r.fromManagerId === currentUser.id);
}

// Что показывает раздел: администратор — все запросы, остальные — свои.
function visibleTransferRequests() {
  const all = transferRequestsList().slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  if (isAdmin()) return all;
  if (!currentUser) return [];
  return all.filter(r => r.fromManagerId === currentUser.id || r.toManagerId === currentUser.id);
}

function unreadTransferCount() {
  return incomingTransferRequests().length;
}

function updateTransfersMenuBadge() {
  const badge = document.getElementById('transfersMenuBadge');
  if (!badge) return;
  const count = unreadTransferCount();
  badge.style.display = count > 0 ? 'flex' : 'none';
  badge.textContent = count;
  badge.title = count > 0 ? `Запросов на перенос: ${count}` : '';
}

/* ===== Создание запроса ===== */

// Кто может инициировать перенос: администратор — любого клиента,
// менеджер/руководитель — любого чужого клиента. Свой клиент менеджер
// не «отдаёт» запросом — передачу делает администратор или коллега,
// а решение принимает адресат (тот, кому клиента передают).
function canRequestClientTransfer(client) {
  if (!currentUser || !client) return false;
  if (isAdmin()) return true;
  return isManagerRole(currentUser) && client.createdBy !== currentUser.id;
}

function createClientTransferRequest(clientId, toManagerId, comment) {
  if (!currentUser) return { ok: false, error: 'Нужно войти в систему' };
  const client = clients.find(c => c.id === clientId);
  if (!client) return { ok: false, error: 'Клиент не найден' };
  if (!canRequestClientTransfer(client)) {
    return { ok: false, error: 'Запросить перенос можно только по чужому клиенту' };
  }

  const targetId = parseInt(toManagerId, 10);
  const target = findUserById(targetId);
  if (!target || !isManagerRole(target)) return { ok: false, error: 'Выберите менеджера' };
  if (target.id === client.createdBy) {
    return { ok: false, error: 'Этот клиент уже закреплён за выбранным менеджером' };
  }
  const pending = pendingTransferForClient(client.id);
  if (pending) {
    return { ok: false, error: 'По этому клиенту уже есть запрос — дождитесь решения' };
  }

  const maxId = transferRequestsList().reduce((m, r) => Math.max(m, r.id || 0), 0);
  const request = {
    id: maxId + 1,
    clientId: client.id,
    clientName: client.orgName || ('Клиент #' + client.id),
    fromManagerId: currentUser.id,
    fromManagerName: currentUser.name || currentUser.login || '',
    toManagerId: target.id,
    toManagerName: target.name || target.login || '',
    comment: String(comment == null ? '' : comment).trim(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null
  };
  clientTransferRequests.push(request);
  saveClientTransferRequests();

  notifyUser(
    target.id,
    'Запрос на перенос клиента',
    (request.fromManagerName || 'Менеджер') + ' передаёт вам клиента «' + request.clientName + '»' +
      (request.comment ? '. Комментарий: ' + request.comment : ''),
    null
  );
  updateTransfersMenuBadge();
  return { ok: true, request: request };
}

/* ===== Решение по запросу ===== */

function canDecideTransfer(request) {
  if (!currentUser || !request || request.status !== 'pending') return false;
  return isAdmin() || request.toManagerId === currentUser.id;
}

// Принять: клиент переходит к тому, кому его передавали.
function acceptTransferRequest(id) {
  const r = transferRequestsList().find(x => x.id === id);
  if (!r) return { ok: false, error: 'Запрос не найден' };
  if (!canDecideTransfer(r)) return { ok: false, error: 'Решает тот, кому передают клиента' };

  const client = clients.find(c => c.id === r.clientId);
  if (client) {
    client.createdBy = r.toManagerId;
    client.responsibleManagerId = r.toManagerId;   // поле схемы v6 — держим в синхроне
    saveClients(clients);
  }

  r.status = 'approved';
  r.decidedAt = new Date().toISOString();
  r.decidedBy = currentUser.id;
  saveClientTransferRequests();

  // Обе стороны получают уведомление: инициатор — что перенос принят,
  // новый владелец — что клиент теперь закреплён за ним.
  notifyUser(
    r.fromManagerId,
    'Перенос клиента принят',
    'Клиент «' + r.clientName + '» передан менеджеру ' + transferManagerName(r.toManagerId),
    null
  );
  notifyUser(
    r.toManagerId,
    'Клиент передан вам',
    '«' + r.clientName + '» теперь закреплён за вами',
    null
  );
  updateTransfersMenuBadge();
  refreshAfterTransfer();
  return { ok: true };
}

// Отклонить: клиент остаётся за прежним менеджером.
function rejectTransferRequest(id) {
  const r = transferRequestsList().find(x => x.id === id);
  if (!r) return { ok: false, error: 'Запрос не найден' };
  if (!canDecideTransfer(r)) return { ok: false, error: 'Решает тот, кому передают клиента' };

  r.status = 'rejected';
  r.decidedAt = new Date().toISOString();
  r.decidedBy = currentUser.id;
  saveClientTransferRequests();

  notifyUser(
    r.fromManagerId,
    'Перенос клиента отклонён',
    'Клиент «' + r.clientName + '» остаётся за вами',
    null
  );
  updateTransfersMenuBadge();
  refreshAfterTransfer();
  return { ok: true };
}

// Отменить свой ещё не решённый запрос.
function cancelTransferRequest(id) {
  const r = transferRequestsList().find(x => x.id === id);
  if (!r) return { ok: false, error: 'Запрос не найден' };
  if (r.status !== 'pending') return { ok: false, error: 'Запрос уже решён' };
  if (!currentUser || (r.fromManagerId !== currentUser.id && !isAdmin())) {
    return { ok: false, error: 'Отменить запрос может только его автор' };
  }

  clientTransferRequests = transferRequestsList().filter(x => x.id !== id);
  saveClientTransferRequests();
  notifyUser(r.toManagerId, 'Запрос на перенос отменён',
    'Клиент «' + r.clientName + '» остаётся за ' + transferManagerName(r.fromManagerId), null);
  updateTransfersMenuBadge();
  refreshAfterTransfer();
  return { ok: true };
}

// Перерисовать карточку клиента после решения по запросу (раздела «Переносы»
// больше нет — решение принимается прямо в карточке).
function refreshAfterTransfer() {
  const target = (typeof cardClientId !== 'undefined' && cardClientId) || selectedClientId;
  if (typeof renderClientCard === 'function' && target) renderClientCard(target);
  if (typeof renderClientContacts === 'function' && selectedClientId) renderClientContacts(selectedClientId);
  if (typeof renderClientsTable === 'function') renderClientsTable();
}

/* ===== Перенос прямо из карточки клиента ===== */

// Плашка в карточке клиента по активному запросу: адресат видит кнопки
// «Подтвердить / Отклонить», инициатор — «Отменить», остальные — статус.
function pendingTransferHtml(client) {
  const r = pendingTransferForClient(client.id);
  if (!r) return '';
  const me = currentUser ? currentUser.id : null;
  const canDecide = canDecideTransfer(r);
  const canCancel = me && (r.fromManagerId === me || isAdmin());

  if (canDecide) {
    return `
      <div class="transfer-pending">
        <span>Запрос на перенос: <strong>${escapeHtml(transferManagerName(r.fromManagerId))}</strong> → <strong>вам</strong> · требуется ваше решение</span>
        <span style="white-space:nowrap;">
          <button type="button" class="btn btn-sm" onclick="decideTransferFromCard(${r.id}, true)">Подтвердить</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="decideTransferFromCard(${r.id}, false)">Отклонить</button>
        </span>
      </div>`;
  }

  if (canCancel) {
    return `
      <div class="transfer-pending">
        <span>Запрос на перенос: <strong>${escapeHtml(transferManagerName(r.fromManagerId))}</strong> → <strong>${escapeHtml(transferManagerName(r.toManagerId))}</strong> · ожидает решения</span>
        <button type="button" class="btn-icon-btn" onclick="cancelTransferFromCard(${r.id})" title="Отменить запрос">Отменить</button>
      </div>`;
  }

  return `
    <div class="transfer-pending">
      <span>Запрос на перенос: <strong>${escapeHtml(transferManagerName(r.fromManagerId))}</strong> → <strong>${escapeHtml(transferManagerName(r.toManagerId))}</strong> · ожидает решения</span>
    </div>`;
}

// Открыть модалку запроса: выбираем, кому передать чужого клиента.
function openTransferRequestModal(clientId) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return;
  if (!canRequestClientTransfer(client)) {
    alert('Запросить перенос можно только по чужому клиенту');
    return;
  }

  document.getElementById('transferRequestClientId').value = clientId;
  const select = document.getElementById('transferRequestManager');
  select.innerHTML = users
    .filter(u => isManagerRole(u) && u.id !== (currentUser ? currentUser.id : null) && u.id !== client.createdBy)
    .map(u => `<option value="${u.id}">${escapeHtml(u.name || u.login)} (${escapeHtml(userPositionLabel(u))})</option>`)
    .join('');
  if (!select.options || !select.options.length) {
    alert('Нет менеджеров, которым можно передать клиента');
    return;
  }

  const comment = document.getElementById('transferRequestComment');
  if (comment) comment.value = '';
  document.getElementById('transferRequestModal').classList.add('active');
}

function sendTransferRequestFromModal(e) {
  if (e && e.preventDefault) e.preventDefault();
  const clientId = parseInt(document.getElementById('transferRequestClientId').value, 10);
  const targetId = document.getElementById('transferRequestManager').value;
  const comment = document.getElementById('transferRequestComment').value.trim();
  if (!targetId) { alert('Выберите менеджера'); return; }

  const res = createClientTransferRequest(clientId, targetId, comment);
  if (!res.ok) { alert(res.error); return; }

  closeModal('transferRequestModal');
  alert('Запрос отправлен: ' + transferManagerName(parseInt(targetId, 10)) +
    ' получит уведомление и подтвердит перенос.');
  const id = (typeof cardClientId !== 'undefined' && cardClientId) || selectedClientId;
  if (id) renderClientCard(id);
}

// «Подтвердить» / «Отклонить» из карточки клиента.
function decideTransferFromCard(requestId, accept) {
  const res = accept ? acceptTransferRequest(requestId) : rejectTransferRequest(requestId);
  if (!res.ok) { alert(res.error); }
}

/* ===== Раздел «Переносы клиентов» ===== */

function transferRowHtml(r, actions) {
  const info = transferStatusInfo(r.status);
  const client = clients.find(c => c.id === r.clientId);
  const clientLink = client
    ? `<a href="#" onclick="event.preventDefault();openClientCard(${client.id});">${escapeHtml(r.clientName || '—')}</a>`
    : escapeHtml(r.clientName || '—');
  return `
    <tr style="cursor:default;">
      <td>${clientLink}</td>
      <td>${escapeHtml(transferManagerName(r.fromManagerId))}</td>
      <td>${escapeHtml(transferManagerName(r.toManagerId))}</td>
      <td>${escapeHtml(r.comment || '—')}</td>
      <td><span class="badge" style="background:${info.color}1f;color:${info.color};">${escapeHtml(info.label)}</span></td>
      <td style="text-align:right;white-space:nowrap;">${actions || ''}</td>
    </tr>`;
}

function renderTransfers() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  const list = visibleTransferRequests();
  const incoming = list.filter(r => r.status === 'pending' && currentUser && r.toManagerId === currentUser.id);
  const rest = list.filter(r => incoming.indexOf(r) === -1);
  const emptyText = incoming.length || rest.length ? null : 'Запросов пока нет.';

  main.innerHTML = `
    <div class="orders-page">
      <div class="orders-head">
        <h1>Переносы клиентов</h1>
        ${isAdmin() ? '<span class="chat-badge">видны все запросы</span>' : ''}
      </div>

      <h3 class="orders-analysis-title">Входящие запросы${incoming.length ? ' (' + incoming.length + ')' : ''}</h3>
      ${incoming.length === 0 ? `
        <div class="empty-state" style="padding:26px 20px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
          <p>${emptyText || 'Вам пока не передают клиентов.'}</p>
        </div>
      ` : `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:auto;margin-bottom:24px;">
          <table class="admin-table">
            <thead><tr><th>Клиент</th><th>От кого</th><th>Кому</th><th>Комментарий</th><th>Статус</th><th style="text-align:right;">Решение</th></tr></thead>
            <tbody>
              ${incoming.map(r => transferRowHtml(r,
                `<button class="btn btn-sm" onclick="decideTransfer(${r.id}, true)">Принять</button>
                 <button class="btn btn-sm btn-secondary" onclick="decideTransfer(${r.id}, false)">Отклонить</button>`
              )).join('')}
            </tbody>
          </table>
        </div>
      `}

      <h3 class="orders-analysis-title">${isAdmin() ? 'Все запросы' : 'Мои запросы'}${rest.length ? ' (' + rest.length + ')' : ''}</h3>
      ${rest.length === 0 ? `
        <div class="empty-state" style="padding:26px 20px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
          <p>${emptyText || 'Здесь появятся отправленные и решённые запросы.'}</p>
        </div>
      ` : `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:auto;">
          <table class="admin-table">
            <thead><tr><th>Клиент</th><th>От кого</th><th>Кому</th><th>Комментарий</th><th>Статус</th><th style="text-align:right;">Действия</th></tr></thead>
            <tbody>
              ${rest.map(r => transferRowHtml(r,
                (r.status === 'pending' && (isAdmin() || (currentUser && r.fromManagerId === currentUser.id)))
                  ? `<button class="btn-icon-btn" onclick="cancelTransfer(${r.id})" title="Отменить запрос">✕</button>`
                  : ''
              )).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

// Кнопки раздела: решение по запросу и отмена своего запроса.
function decideTransfer(id, accept) {
  const res = accept ? acceptTransferRequest(id) : rejectTransferRequest(id);
  if (!res.ok) { alert(res.error); return; }
  renderTransfers();
}

function cancelTransfer(id) {
  if (!confirm('Отменить запрос на перенос?')) return;
  const res = cancelTransferRequest(id);
  if (!res.ok) { alert(res.error); return; }
  renderTransfers();
}
