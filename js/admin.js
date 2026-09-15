/* ============================================================
   js/admin.js — модуль «Администрирование» (только для админа):
   — Анализ: агрегированная статистика по задачам, срез по
     менеджерам, детализация по клику, экспорт в Excel;
   — Пользователи: CRUD учётных записей (логин, пароль, роль);
   — Задачи: назначение любой задачи любому пользователю с
     дедлайном и статусами «Принято / Не принято / В работе / Выполнено».
   ============================================================ */

const ADMIN_STATUS_NAMES = ['В работе', 'Проблема', 'Работа с чертежами', 'Выставлен счет', 'Счет на согласование', 'Размещен заказ'];

// Менеджер задачи: назначенный исполнитель → автор → администратор.
function taskManager(task) {
  if (task.assignedTo) {
    const u = findUserById(task.assignedTo);
    if (u) return u;
  }
  if (task.ownerId) {
    const u = findUserById(task.ownerId);
    if (u) return u;
  }
  return users.find(u => u.role === 'admin') || { id: null, login: 'Admin', name: 'Администратор' };
}

function requiredColumnId(name) {
  const c = taskColumns.find(col => col.name === name);
  return c ? c.id : null;
}

function renderAdminSection(section) {
  injectAdminModals();
  if (section === 'admin-analysis') renderAdminAnalysis();
  else if (section === 'admin-users') renderAdminUsers();
  else if (section === 'admin-assignments') renderAdminAssignments();
  else if (section === 'admin-interaction-types') renderAdminInteractionTypes();
  else if (section === 'admin-integrations') renderAdminIntegrations();
}

/* ===================== Интеграции ===================== */

// Ключ внешнего сервиса живёт на сервере (config.local.json вне git),
// поэтому эта форма шлёт его на /api/integrations/dadata, а не в db.json.
async function renderAdminIntegrations() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  main.innerHTML = `
    <div style="padding:25px;max-width:820px;margin:0 auto;height:100%;box-sizing:border-box;overflow-y:auto;">
      <div style="margin-bottom:20px;">
        <h1 style="font-size:22px;font-weight:600;color:#1a3a5c;">🔌 Интеграции</h1>
      </div>

      <div class="integration-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
          <div>
            <div style="font-size:15px;font-weight:600;color:#1a3a5c;">Дадата — реквизиты по ИНН и подсказки городов</div>
            <div style="font-size:12px;color:#6b7280;margin-top:4px;max-width:540px;line-height:1.5;">
              По ИНН заполняет название, адрес, город и ОГРН, а при вводе города показывает подсказки.
              Ключ хранится на сервере в файле <code>config.local.json</code> (внесён в .gitignore)
              и в браузер не передаётся.
            </div>
          </div>
          <div id="dadataStatusBox" class="integration-status"><span class="integration-dot off"></span><span>проверяю…</span></div>
        </div>

        <form onsubmit="saveDadataToken(event)" style="margin-top:16px;">
          <div class="form-row">
            <div class="form-group">
              <label>API-ключ Дадаты</label>
              <input type="password" id="dadataTokenInput" placeholder="Вставьте ключ из личного кабинета dadata.ru" autocomplete="off">
            </div>
          </div>
          <div style="display:flex;gap:8px;">
            <button type="submit" class="btn">Сохранить ключ</button>
            <button type="button" class="btn btn-secondary" onclick="clearDadataToken()">Удалить ключ</button>
          </div>
          <div style="font-size:11px;color:#9ca3af;margin-top:8px;line-height:1.5;">
            Ключ можно задать и переменной окружения <code>DADATA_API_KEY</code> — она имеет приоритет над файлом.
            Сохранить ключ можно только с компьютера, на котором запущен сервер.
          </div>
        </form>

        <div id="dadataMsg" class="integration-msg"></div>
      </div>

      <div class="integration-card">
        <div style="font-size:15px;font-weight:600;color:#1a3a5c;">Встроенный справочник</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;line-height:1.5;">
          Пока ключ не задан, подсказки городов работают по локальному списку из <code>js/geo.js</code>
          (46 стран, 566 городов). Кнопка «Заполнить по ИНН» в карточке клиента сообщит,
          что сервис не настроен. Новые города можно просто дописать в массив <code>CITY_FALLBACK</code>.
        </div>
      </div>
    </div>`;

  // Статус читаем с сервера принудительно: ключ мог быть изменён только что.
  const status = await dadataStatus(true);
  const box = document.getElementById('dadataStatusBox');
  if (box) {
    box.innerHTML = status.configured
      ? `<span class="integration-dot on"></span><span>подключена${
          status.source === 'env' ? ' (ключ из переменной окружения)' : ''}</span>`
      : '<span class="integration-dot off"></span><span>ключ не задан — работает встроенный справочник</span>';
  }
}

function setDadataMsg(text, kind) {
  const el = document.getElementById('dadataMsg');
  if (!el) return;
  el.className = 'integration-msg' + (text ? (kind === 'error' ? ' err' : ' ok') : '');
  el.textContent = text || '';
}

async function saveDadataToken(e) {
  e.preventDefault();
  const input = document.getElementById('dadataTokenInput');
  const token = ((input && input.value) || '').trim();
  if (!token) {
    setDadataMsg('Вставьте ключ или нажмите «Удалить ключ»', 'error');
    return;
  }
  try {
    const res = await fetch('/api/integrations/dadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.ok) {
      setDadataMsg((j && j.error) || ('Не удалось сохранить ключ (HTTP ' + res.status + ')'), 'error');
      return;
    }
    await renderAdminIntegrations();
    setDadataMsg('Ключ сохранён — автозаполнение по ИНН доступно.', 'ok');
  } catch (err) {
    setDadataMsg('Нет связи с сервером', 'error');
  }
}

async function clearDadataToken() {
  if (!confirm('Удалить сохранённый ключ Дадаты?')) return;
  try {
    const res = await fetch('/api/integrations/dadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '' })
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.ok) {
      setDadataMsg((j && j.error) || 'Не удалось удалить ключ', 'error');
      return;
    }
    await renderAdminIntegrations();
    setDadataMsg('Ключ удалён.', 'ok');
  } catch (err) {
    setDadataMsg('Нет связи с сервером', 'error');
  }
}

/* ===================== Типы взаимодействий ===================== */

function renderAdminInteractionTypes() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  main.innerHTML = `
    <div style="padding:25px;max-width:700px;margin:0 auto;height:100%;box-sizing:border-box;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h1 style="font-size:22px;font-weight:600;color:#1a3a5c;">🏷️ Типы взаимодействий</h1>
      </div>
      <p style="font-size:12px;color:#9ca3af;margin-bottom:15px;">
        Справочник типов для комментариев в карточках клиентов. Эти типы видит каждый пользователь
        при добавлении взаимодействия; создавать и изменять их может только администратор.
      </p>
      <form onsubmit="addInteractionTypeFromAdmin(event)" style="display:flex;gap:8px;margin-bottom:20px;">
        <input type="text" id="newInteractionTypeInput" placeholder="Название типа (например, «Звонок»)" style="flex:1;padding:8px 10px;border:1px solid #d0d5dd;border-radius:5px;font-size:13px;outline:none;">
        <button type="submit" class="btn">+ Добавить</button>
      </form>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:auto;">
        <table class="admin-table">
          <thead><tr>
            <th>Тип взаимодействия</th><th style="text-align:right;">Действия</th>
          </tr></thead>
          <tbody>
            ${interactionTypes.length ? interactionTypes.map((t, i) => `
              <tr style="cursor:default;">
                <td><span class="badge">${escapeHtml(t)}</span></td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn-icon-btn" onclick="renameInteractionTypeFromAdmin(${i})" title="Переименовать">✏️</button>
                  <button class="btn-icon-btn" onclick="deleteInteractionTypeFromAdmin(${i})" title="Удалить">🗑</button>
                </td>
              </tr>
            `).join('') : `
              <tr><td colspan="2" style="text-align:center;color:#9ca3af;padding:30px;">Типы не добавлены</td></tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function addInteractionTypeFromAdmin(e) {
  e.preventDefault();
  const input = document.getElementById('newInteractionTypeInput');
  const res = addInteractionType(input.value);
  if (!res.ok) { alert(res.error); return; }
  renderAdminInteractionTypes();
}

function renameInteractionTypeFromAdmin(index) {
  const current = interactionTypes[index];
  if (current === undefined) return;
  const name = prompt('Новое название типа:', current);
  if (name === null) return;
  const res = renameInteractionType(index, name);
  if (!res.ok) { alert(res.error); return; }
  renderAdminInteractionTypes();
}

function deleteInteractionTypeFromAdmin(index) {
  const current = interactionTypes[index];
  if (current === undefined) return;
  if (!confirm(`Удалить тип «${current}»?\nСуществующие комментарии сохранятся.`)) return;
  deleteInteractionType(index);
  renderAdminInteractionTypes();
}

/* ===================== Анализ ===================== */

let adminAnalysisTab = 'stats';   // 'stats' | 'comments'
let adminAnalysisDateFrom = null; // начало периода фильтра по датам
let adminAnalysisDateTo = null;   // конец периода фильтра по датам

// Фильтр по периоду для задач и комментариев: сравнивается дата (YYYY-MM-DD).
function inAnalysisRange(dateStr) {
  if (!adminAnalysisDateFrom && !adminAnalysisDateTo) return true;
  const day = (dateStr || '').slice(0, 10);
  if (!day) return true;
  if (adminAnalysisDateFrom && day < adminAnalysisDateFrom) return false;
  if (adminAnalysisDateTo && day > adminAnalysisDateTo) return false;
  return true;
}

// Дата перехода задачи в текущий статус (для старой БД — дата создания).
function taskRangeDate(t) {
  return t.statusUpdatedAt || t.createdAt || '';
}

function renderAdminAnalysis() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  const today = new Date().toISOString().split('T')[0];
  const from = adminAnalysisDateFrom || '';
  const to = adminAnalysisDateTo || '';

  const tabs = `
    <div class="analysis-tabs">
      <button class="btn ${adminAnalysisTab === 'stats' ? '' : 'btn-secondary'}" onclick="setAdminAnalysisTab('stats')">Статистика</button>
      <button class="btn ${adminAnalysisTab === 'comments' ? '' : 'btn-secondary'}" onclick="setAdminAnalysisTab('comments')">Лента комментариев</button>
    </div>`;

  const dateBar = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;flex-wrap:wrap;">
      <span style="font-size:13px;color:#4b5563;font-weight:500;">Период:</span>
      <label style="font-size:12px;color:#6b7280;">С</label>
      <input type="date" id="adminDateFrom" value="${escapeHtml(from)}" onchange="setAdminAnalysisDateRange(this.value, document.getElementById('adminDateTo').value)"
             style="padding:6px 9px;border:1px solid #d0d5dd;border-radius:5px;font-size:12px;outline:none;">
      <label style="font-size:12px;color:#6b7280;">По</label>
      <input type="date" id="adminDateTo" value="${escapeHtml(to)}" onchange="setAdminAnalysisDateRange(document.getElementById('adminDateFrom').value, this.value)"
             style="padding:6px 9px;border:1px solid #d0d5dd;border-radius:5px;font-size:12px;outline:none;">
      <button class="btn btn-sm btn-secondary" onclick="setAdminAnalysisDateRange('${today}','${today}')">Сегодня</button>
      ${(from || to) ? `<button class="btn btn-sm btn-secondary" onclick="setAdminAnalysisDateRange('','')">Сбросить</button>` : ''}
      ${(from || to) ? `<span style="font-size:12px;color:#9ca3af;">Показаны данные за период</span>` : ''}
    </div>`;

  main.innerHTML = `
    <div style="padding:25px;max-width:1100px;margin:0 auto;height:100%;box-sizing:border-box;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h1 style="font-size:22px;font-weight:600;color:#1a3a5c;">Анализ</h1>
        ${adminAnalysisTab === 'comments'
          ? '<button class="btn" onclick="exportCommentsExcel()">⬇ Выгрузить комментарии в Excel</button>'
          : '<button class="btn" onclick="exportAdminReport()">⬇ Экспорт в Excel</button>'}
      </div>
      ${tabs}
      ${dateBar}
      ${adminAnalysisTab === 'comments' ? renderAdminCommentsFeed() : renderAdminStats()}
    </div>
  `;
}

function setAdminAnalysisTab(tab) {
  adminAnalysisTab = tab;
  // Лента комментариев по умолчанию показывает сегодняшний день.
  if (tab === 'comments' && !adminAnalysisDateFrom && !adminAnalysisDateTo) {
    const today = new Date().toISOString().split('T')[0];
    adminAnalysisDateFrom = today;
    adminAnalysisDateTo = today;
  }
  renderAdminAnalysis();
}

function setAdminAnalysisDateRange(from, to) {
  adminAnalysisDateFrom = from || null;
  adminAnalysisDateTo = to || null;
  renderAdminAnalysis();
}

// Статистика по задачам (срез по менеджерам). При заданном периоде учитываются
// задачи, перешедшие в текущий статус (или созданные) в этом периоде.
function renderAdminStats() {
  const all = tasks.filter(t => inAnalysisRange(taskRangeDate(t)));
  const total = all.length;
  const overdue = all.filter(t => taskOverdue(t)).length;

  const statusCols = ADMIN_STATUS_NAMES.map(name => ({ name, id: requiredColumnId(name) }));

  const managerRows = users.map(u => {
    const managed = all.filter(t => taskManager(t).id === u.id);
    return {
      user: u,
      counts: statusCols.map(sc => managed.filter(t => t.status === sc.id).length)
    };
  });

  return `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:25px;">
      <div class="stat-card"><div class="stat-value" style="color:#1a3a5c">${total}</div><div class="stat-label">Всего задач (все пользователи)</div></div>
      <div class="stat-card"><div class="stat-value" style="color:#ef4444">${overdue}</div><div class="stat-label">Просрочено (дедлайн &lt; сегодня)</div></div>
    </div>

    <h3 style="font-size:15px;font-weight:600;color:#374151;margin-bottom:12px;">Срез по менеджерам</h3>
    <p style="font-size:12px;color:#9ca3af;margin-bottom:12px;">Кликните по цифре, чтобы увидеть задачи менеджера.</p>
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:auto;">
      <table class="admin-table">
        <thead><tr>
          <th>Менеджер</th>
          ${ADMIN_STATUS_NAMES.map(n => `<th>${escapeHtml(n)}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${managerRows.length ? managerRows.map(r => `
            <tr>
              <td class="manager-name" onclick="openAdminTaskList(${r.user.id})" title="Все задачи менеджера">${escapeHtml(r.user.login)}</td>
              ${r.counts.map((c, i) => `
                <td class="stat-cell" onclick="openAdminTaskList(${r.user.id}, '${escapeHtml(ADMIN_STATUS_NAMES[i])}')" title="${escapeHtml(ADMIN_STATUS_NAMES[i])}">${c}</td>
              `).join('')}
            </tr>
          `).join('') : `
            <tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:30px;">Пользователи не созданы</td></tr>
          `}
        </tbody>
      </table>
    </div>
  `;
}

// Лента комментариев: комментарии за выбранный период (по умолчанию — сегодня).
function commentsForRange() {
  const result = [];
  clients.forEach(c => {
    (c.history || []).forEach(h => {
      if (!inAnalysisRange(h.date)) return;
      result.push({
        manager: h.manager || '',
        type: h.type || '',
        company: c.orgName || '',
        comment: h.comment || '',
        date: h.date || '',
        order: h.order || null
      });
    });
  });
  return result.sort((a, b) => new Date(b.date) - new Date(a.date));
}

function renderAdminCommentsFeed() {
  const comments = commentsForRange();

  return `
    ${comments.length === 0 ? `
      <div class="empty-state" style="padding:60px 20px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;">
        <p>${(adminAnalysisDateFrom || adminAnalysisDateTo)
          ? 'На выбранный период комментариев нет'
          : 'Комментариев пока нет'}</p>
      </div>
    ` : `
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:auto;">
        <div class="table-body" style="max-height:60vh;">
          <table class="admin-table">
            <thead><tr>
              <th>Менеджер</th><th>Тип взаимодействия</th><th>Компания</th><th>Комментарий</th><th>Дата/Время</th>
            </tr></thead>
            <tbody>
              ${comments.map(h => `
                <tr style="cursor:default;">
                  <td><strong>${escapeHtml(h.manager || '—')}</strong></td>
                  <td><span class="badge">${escapeHtml(h.type || '—')}</span></td>
                  <td>${escapeHtml(h.company)}</td>
                  <td><div class="history-comment">${escapeHtml(h.comment || '—')}</div></td>
                  <td>${formatDateAdmin(h.date)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `}
  `;
}

// Выгрузка комментариев за выбранный период в Excel. Для «Размещения заказа»
// добавляются параметры заказа (кол-во кг, состояние, цена, стоимость).
function exportCommentsExcel() {
  if (typeof XLSX === 'undefined') {
    alert('Библиотека экспорта Excel не загружена.');
    return;
  }
  const comments = commentsForRange();
  const rows = comments.map(h => ({
    'Менеджер': h.manager || '—',
    'Тип взаимодействия': h.type || '—',
    'Компания': h.company || '—',
    'Комментарий': (h.comment || '').replace(/\s+/g, ' ').trim(),
    'Кол-во кг': h.order && h.order.kg !== null && h.order.kg !== undefined ? h.order.kg : '—',
    'Состояние': h.order && h.order.condition ? h.order.condition : '—',
    'Средняя цена': h.order && h.order.avgPrice !== null && h.order.avgPrice !== undefined ? h.order.avgPrice : '—',
    'Стоимость заказа': h.order && h.order.cost !== null && h.order.cost !== undefined ? h.order.cost : '—',
    'Дата/Время': formatDateAdmin(h.date)
  }));
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Комментарии');
  const periodLabel = adminAnalysisDateFrom && adminAnalysisDateTo ? `${adminAnalysisDateFrom}_${adminAnalysisDateTo}` : 'все';
  XLSX.writeFile(wb, `Комментарии_${periodLabel}.xlsx`);
}

function formatDateAdmin(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Модалка со списком задач конкретного менеджера (опционально по статусу).
function openAdminTaskList(managerId, statusName) {
  const manager = findUserById(managerId);
  if (!manager) return;
  const content = document.getElementById('adminTasksListContent');
  if (!content) return;

  let list = tasks.filter(t => taskManager(t).id === managerId);
  let filterLabel = 'Все задачи';
  if (statusName) {
    const col = taskColumns.find(c => c.name === statusName);
    if (col) list = list.filter(t => t.status === col.id);
    filterLabel = statusName;
  }
  list.sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''));

  content.innerHTML = `
    <div style="margin-bottom:12px;font-size:13px;color:#6b7280;">
      Менеджер: <strong>${escapeHtml(manager.login)}</strong> · Тип: <strong>${escapeHtml(filterLabel)}</strong> · Задач: ${list.length}
    </div>
    ${list.length === 0 ? `
      <div class="empty-state" style="padding:40px 20px;"><p>Нет задач</p></div>
    ` : `
      <div class="scrollable-table" style="max-height:50vh;">
        <div class="table-body" style="max-height:50vh;">
          <table>
            <thead><tr>
              <th>Менеджер</th><th>Клиент</th><th>Тип задачи</th><th>Комментарий</th><th>Дедлайн</th>
            </tr></thead>
            <tbody>
              ${list.map(t => {
                const client = t.clientId ? clients.find(c => c.id === t.clientId) : null;
                const col = taskColumns.find(c => c.id === t.status);
                const isOverdue = taskOverdue(t);
                return `<tr style="cursor:default;" onclick="event.stopPropagation()">
                  <td><strong>${escapeHtml(taskManager(t).login)}</strong></td>
                  <td>${escapeHtml(client ? client.orgName : '—')}</td>
                  <td>${escapeHtml(col ? col.name : '—')}</td>
                  <td><div class="history-comment">${escapeHtml(t.description || t.title || '—')}</div></td>
                  <td style="color:${isOverdue ? '#ef4444' : '#6b7280'};font-weight:${isOverdue ? '600' : '400'};">${t.deadline ? formatDate(t.deadline) : '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `}
  `;
  document.getElementById('adminTasksModal').classList.add('active');
}

// Экспорт всех задач в Excel (XLSX) в реальном времени.
function exportAdminReport() {
  if (typeof XLSX === 'undefined') {
    alert('Библиотека экспорта Excel не загружена.');
    return;
  }
  const rows = tasks.map(t => {
    const client = t.clientId ? clients.find(c => c.id === t.clientId) : null;
    const col = taskColumns.find(c => c.id === t.status);
    return {
      'Менеджер': taskManager(t).login,
      'Клиент': client ? client.orgName : '—',
      'Тип задачи': col ? col.name : '—',
      'Комментарий': (t.description || t.title || '').replace(/\s+/g, ' ').trim(),
      'Дедлайн': t.deadline ? formatDate(t.deadline) : '—',
      'Просрочена': taskOverdue(t) ? 'Да' : 'Нет'
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Задачи');
  const today = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `Отчет_по_задачам_${today}.xlsx`);
}

/* ===================== Пользователи ===================== */

function renderAdminUsers() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  main.innerHTML = `
    <div style="padding:25px;max-width:1000px;margin:0 auto;height:100%;box-sizing:border-box;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h1 style="font-size:22px;font-weight:600;color:#1a3a5c;">Пользователи</h1>
        <button class="btn" onclick="openUserModal()">+ Добавить пользователя</button>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:auto;">
        <table class="admin-table">
          <thead><tr>
            <th>Логин</th><th>Имя</th><th>Пароль</th><th>Роль</th><th style="text-align:right;">Действия</th>
          </tr></thead>
          <tbody>
            ${users.map(u => `
              <tr style="cursor:default;">
                <td><strong>${escapeHtml(u.login)}</strong></td>
                <td>${escapeHtml(u.name || '—')}</td>
                <td><span style="font-family:'Courier New',monospace;">${escapeHtml(u.password)}</span></td>
                <td>${u.role === 'admin'
                  ? '<span class="badge" style="background:#dbeafe;color:#1e40af;">Администратор</span>'
                  : '<span class="badge" style="background:#f3f4f6;color:#4b5563;">Пользователь</span>'}</td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn-icon-btn" style="font-size:12px;" onclick="openUserModal(${u.id})" title="Редактировать">Изменить</button>
                  <button class="btn-icon-btn" style="font-size:12px;color:#e53e3e;" onclick="removeUser(${u.id})" title="Удалить">Удалить</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function openUserModal(id = null) {
  const u = id ? findUserById(id) : null;
  document.getElementById('userModalTitle').textContent = u ? 'Редактировать пользователя' : 'Новый пользователь';
  document.getElementById('userId').value = u ? u.id : '';
  document.getElementById('userLogin').value = u ? u.login : '';
  document.getElementById('userName').value = u ? (u.name || '') : '';
  const pwdInput = document.getElementById('userPassword');
  pwdInput.value = u ? u.password : ''; // существующий пароль не сбрасываем
  pwdInput.placeholder = u ? 'Введите новый, если хотите сменить' : 'Пароль';
  document.getElementById('userRole').value = u ? u.role : 'user';
  document.getElementById('userModal').classList.add('active');
}

function saveUser(e) {
  e.preventDefault();
  const id = document.getElementById('userId').value;
  const data = {
    login: document.getElementById('userLogin').value,
    name: document.getElementById('userName').value,
    password: document.getElementById('userPassword').value,
    role: document.getElementById('userRole').value
  };
  const res = id ? updateUser(parseInt(id), data) : addUser(data);
  if (!res.ok) { alert(res.error); return; }
  closeModal('userModal');
  renderAdminUsers();
  // Если поменяли собственную роль/права — мгновенно перестроить меню и раздел.
  if (id && parseInt(id) === currentUser.id) {
    buildSidebar();
    updateUserInfo();
    renderSection(currentSection);
  }
}

function removeUser(id) {
  const u = findUserById(id);
  if (!u) return;
  if (!confirm(`Удалить пользователя «${u.login}»?`)) return;
  const res = deleteUser(id);
  if (!res.ok) { alert(res.error); return; }
  renderAdminUsers();
}

/* ===================== Назначение задач ===================== */

function renderAdminAssignments() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  // Иерархия «Менеджер → список его задач». Показываем задачи,
  // назначенные конкретному пользователю (без списка компаний).
  const groups = users.map(u => ({
    user: u,
    list: tasks.filter(t => t.assignedTo === u.id)
      .sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''))
  }));

  main.innerHTML = `
    <div style="padding:25px;max-width:1100px;margin:0 auto;height:100%;box-sizing:border-box;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h1 style="font-size:22px;font-weight:600;color:#1a3a5c;">📋 Задачи менеджеров</h1>
      </div>
      <p style="font-size:12px;color:#9ca3af;margin-bottom:15px;">
        Выберите менеджера и нажмите «Добавить задачу». Задачи группируются под своим менеджером;
        статусы всех задач видны здесь в реальном времени.
      </p>
      ${groups.map(g => `
        <div class="manager-group">
          <div class="manager-group-header">
            <div class="manager-group-title">
              <div class="user-avatar" style="width:28px;height:28px;font-size:12px;">${escapeHtml((g.user.login[0] || '?').toUpperCase())}</div>
              <strong>${escapeHtml(g.user.login)}</strong>
              <span class="manager-group-count">${g.list.length}</span>
            </div>
            <button class="btn btn-sm" onclick="openAdminNewTaskModal(${g.user.id})">+ Добавить задачу</button>
          </div>
          ${g.list.length === 0 ? `
            <div class="manager-group-empty">Нет назначенных задач</div>
          ` : `
            <div class="scrollable-table" style="max-height:320px;">
              <div class="table-body" style="max-height:320px;">
                <table>
                  <thead><tr>
                    <th>Тип задачи</th><th>Компания</th><th>Дедлайн</th><th>Комментарий</th><th>Статус назначения</th><th style="text-align:right;">Действия</th>
                  </tr></thead>
                  <tbody>
                    ${g.list.map(t => {
                      const client = t.clientId ? clients.find(c => c.id === t.clientId) : null;
                      const col = taskColumns.find(c => c.id === t.status);
                      const st = assignmentStatusInfo(t.assignmentStatus);
                      const isOverdue = taskOverdue(t);
                      return `<tr style="cursor:default;" onclick="event.stopPropagation()">
                        <td><span class="badge" style="background:${col ? col.color : '#e5e7eb'};color:#fff;">${escapeHtml(col ? col.name : '—')}</span></td>
                        <td>${client
                          ? escapeHtml(client.orgName)
                          : '<span class="badge" style="background:#fef3c7;color:#92400e;">Новая компания</span>'}</td>
                        <td style="color:${isOverdue ? '#ef4444' : '#6b7280'};font-weight:${isOverdue ? '600' : '400'};">${t.deadline ? formatDate(t.deadline) : '—'}</td>
                        <td><div class="history-comment">${escapeHtml(t.description || '—')}</div></td>
                        <td>
                          <span class="assign-status" style="background:${st.color};color:#fff;">${st.label}</span>
                          <select onclick="event.stopPropagation()" onchange="setAssignmentStatus(${t.id}, this.value)"
                                  style="font-size:11px;padding:3px 4px;border:1px solid #d0d5dd;border-radius:4px;background:#fff;color:#374151;max-width:110px;margin-left:6px;">
                            ${ASSIGNMENT_STATUSES.map(s => `<option value="${s.value}" ${s.value === t.assignmentStatus ? 'selected' : ''}>${s.label}</option>`).join('')}
                          </select>
                        </td>
                        <td style="text-align:right;white-space:nowrap;">
                          <button class="btn-icon-btn" onclick="unassignTask(${t.id})" title="Снять назначение">➖</button>
                          <button class="btn-icon-btn" onclick="deleteTask(${t.id})" title="Удалить задачу">🗑</button>
                        </td>
                      </tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `}
        </div>
      `).join('')}
      ${users.length === 0 ? '<div class="empty-state" style="padding:40px 20px;"><p>Пользователи не созданы</p></div>' : ''}
    </div>
  `;
}

// Форма назначения новой задачи конкретному менеджеру.
function openAdminNewTaskModal(userId) {
  const content = document.getElementById('adminNewTaskModal');
  if (!content) return;

  document.getElementById('adminNewTaskId').value = '';

  const userSelect = document.getElementById('adminTaskUserSelect');
  userSelect.innerHTML = users.map(u =>
    `<option value="${u.id}" ${u.id === userId ? 'selected' : ''}>${escapeHtml(u.login)} (${userRoleLabel(u)})</option>`
  ).join('');

  // Тип задачи — предустановленный список (колонки канбана).
  const typeSelect = document.getElementById('adminTaskType');
  const sortedCols = [...taskColumns].sort((a, b) => a.order - b.order);
  typeSelect.innerHTML = sortedCols.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

  // Компания — необязательное поле.
  const clientSelect = document.getElementById('adminTaskClient');
  clientSelect.innerHTML = '<option value="">— Без компании —</option>' +
    clients.map(c => `<option value="${c.id}">${escapeHtml(c.orgName)}</option>`).join('');

  document.getElementById('adminTaskComment').value = '';
  document.getElementById('adminTaskDeadline').value = '';
  syncAdminTaskNoClient();
  content.classList.add('active');
}

// Чекбокс «Ссылка на обработку новой компании»: активен, пока компания не выбрана.
function syncAdminTaskNoClient() {
  const clientSelect = document.getElementById('adminTaskClient');
  const noClient = document.getElementById('adminTaskNoClient');
  const note = document.getElementById('adminTaskNoClientNote');
  const hasCompany = !!(clientSelect && clientSelect.value);
  if (noClient) noClient.checked = !hasCompany;
  if (note) {
    note.textContent = hasCompany
      ? 'Задача привязана к выбранной компании.'
      : 'Задача не привязана к существующему клиенту — в обработке новая компания.';
  }
}

function saveAdminNewTask(e) {
  e.preventDefault();
  const userId = parseInt(document.getElementById('adminTaskUserSelect').value);
  const typeId = document.getElementById('adminTaskType').value;
  const clientIdVal = document.getElementById('adminTaskClient').value;
  const comment = document.getElementById('adminTaskComment').value.trim();
  const noClient = document.getElementById('adminTaskNoClient').checked;

  if (!userId) { alert('Выберите менеджера (пользователя)'); return; }
  if (!typeId) { alert('Выберите тип задачи'); return; }

  const col = taskColumns.find(c => c.id === typeId);
  const clientId = clientIdVal ? parseInt(clientIdVal) : null;

  const maxId = tasks.reduce((m, t) => Math.max(m, t.id || 0), 0);
  const task = {
    id: maxId + 1,
    title: col ? col.name : 'Задача',
    description: comment,
    deadline: document.getElementById('adminTaskDeadline').value || null,
    status: typeId,
    statusUpdatedAt: new Date().toISOString(),
    assignees: [],
    ownerId: currentUser ? currentUser.id : null,
    assignedTo: userId,
    assignedBy: currentUser ? currentUser.id : null,
    assignedAt: new Date().toISOString(),
    assignmentStatus: 'pending', // «Не принято»
    clientId: clientId,
    newClient: !clientId && noClient,
    order: tasks.filter(t => t.status === typeId).length,
    createdAt: new Date().toISOString()
  };
  tasks.push(task);
  saveTasks();

  const target = findUserById(userId);
  if (target) {
    notifyUser(userId, `Назначена задача «${task.title}»`, comment || 'Новая задача в работе', task.id);
  }
  closeModal('adminNewTaskModal');
  renderAdminAssignments();
}

function unassignTask(taskId) {
  const t = tasks.find(x => x.id === taskId);
  if (!t) return;
  if (!confirm('Снять назначение задачи?')) return;
  t.assignedTo = null;
  t.assignedBy = null;
  t.assignedAt = null;
  t.assignmentStatus = null;
  saveTasks();
  renderAdminAssignments();
}

/* ===================== Модальные окна админ-модуля ===================== */

function injectAdminModals() {
  if (document.getElementById('adminTasksModal')) return;

  const html = `
    <div class="modal-overlay" id="adminTasksModal" onclick="if(event.target===this)closeModal('adminTasksModal')">
      <div class="modal" style="width:820px;max-width:94vw;">
        <div style="display:flex;justify-content:flex-end;margin-bottom:6px;">
          <button type="button" class="btn btn-sm btn-secondary" onclick="closeModal('adminTasksModal')">✕ Закрыть</button>
        </div>
        <h2 style="margin-bottom:15px;">Задачи менеджера</h2>
        <div id="adminTasksListContent"></div>
      </div>
    </div>

    <div class="modal-overlay" id="userModal">
      <div class="modal">
        <h2 id="userModalTitle">Новый пользователь</h2>
        <form onsubmit="saveUser(event)">
          <input type="hidden" id="userId">
          <div class="form-section">
            <div class="form-row"><div class="form-group"><label>Логин *</label><input type="text" id="userLogin" required></div></div>
            <div class="form-row"><div class="form-group"><label>Имя (отображаемое)</label><input type="text" id="userName"></div></div>
            <div class="form-row"><div class="form-group"><label>Пароль *</label><input type="password" id="userPassword" required></div></div>
            <div class="form-row">
              <div class="form-group"><label>Роль</label>
                <select id="userRole">
                  <option value="user">Пользователь</option>
                  <option value="admin">Администратор</option>
                </select>
              </div>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" onclick="closeModal('userModal')">Отмена</button>
            <button type="submit" class="btn">Сохранить</button>
          </div>
        </form>
      </div>
    </div>

    <div class="modal-overlay" id="adminNewTaskModal">
      <div class="modal">
        <h2>Назначить задачу</h2>
        <form onsubmit="saveAdminNewTask(event)">
          <input type="hidden" id="adminNewTaskId">
          <div class="form-section">
            <div class="form-row">
              <div class="form-group"><label>Менеджер (пользователь) *</label><select id="adminTaskUserSelect"></select></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Тип задачи *</label><select id="adminTaskType"></select></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Дедлайн</label><input type="datetime-local" id="adminTaskDeadline"></div>
              <div class="form-group">
                <label>Компания (необязательно)</label>
                <select id="adminTaskClient" onchange="syncAdminTaskNoClient()"></select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group" style="padding:8px 10px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;">
                <label style="display:flex;align-items:center;gap:8px;margin:0;cursor:pointer;">
                  <input type="checkbox" id="adminTaskNoClient" style="width:16px;height:16px;" onchange="document.getElementById('adminTaskNoClientNote').textContent = this.checked ? 'Задача не привязана к существующему клиенту — в обработке новая компания.' : 'Задача привязана к выбранной компании.';">
                  <span style="font-size:12px;color:#92400e;font-weight:500;">Ссылка на обработку новой компании</span>
                </label>
                <div id="adminTaskNoClientNote" style="font-size:11px;color:#92400e;margin-top:4px;"></div>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Комментарий</label><textarea id="adminTaskComment" rows="4"></textarea></div>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" onclick="closeModal('adminNewTaskModal')">Отмена</button>
            <button type="submit" class="btn">Назначить</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
}
