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
  return users.find(u => normalizeRole(u.role) === ROLE_ADMIN) || { id: null, login: 'Admin', name: 'Администратор' };
}

function requiredColumnId(name) {
  const c = taskColumns.find(col => col.name === name);
  return c ? c.id : null;
}

function renderAdminSection(section) {
  injectAdminModals();
  if (section === 'admin-analysis') renderAdminAnalysis();
  else if (section === 'admin-users') renderAdminUsers();
  else if (section === 'admin-task-columns') renderAdminTaskColumns();
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
        <h1 style="font-size:22px;font-weight:600;color:#1a3a5c;">Интеграции</h1>
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
    <div style="padding:25px;max-width:860px;margin:0 auto;height:100%;box-sizing:border-box;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;gap:10px;">
        <h1 style="font-size:22px;font-weight:600;color:#1a3a5c;">Типы взаимодействий</h1>
        <button class="btn btn-secondary" onclick="goToSection('admin-task-columns')">Столбцы и привязки</button>
      </div>
      <p style="font-size:12px;color:#9ca3af;margin-bottom:15px;">
        Справочник типов для комментариев в карточках клиентов. Столбец задачи для каждого типа
        назначается в разделе «Столбцы задач»; если столбец не выбран, задача не создаётся —
        комментарий остаётся как есть (так работает «Информация»).
      </p>
      <p style="font-size:12px;color:#9ca3af;margin-bottom:15px;">
        Активность закрывается только вместе со следующей датой активности — она же становится
        сроком задачи. Исключение: тип «Нерентабелен». Обязательные типы не удаляются.
      </p>
      <form onsubmit="addInteractionTypeFromAdmin(event)" style="display:flex;gap:8px;margin-bottom:20px;">
        <input type="text" id="newInteractionTypeInput" placeholder="Название типа (например, «Звонок»)" style="flex:1;padding:8px 10px;border:1px solid #d0d5dd;border-radius:5px;font-size:13px;outline:none;">
        <button type="submit" class="btn">+ Добавить</button>
      </form>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:auto;">
        <table class="admin-table">
          <thead><tr>
            <th>Тип взаимодействия</th><th>Столбец задачи</th><th style="text-align:right;">Действия</th>
          </tr></thead>
          <tbody>
            ${interactionTypes.length ? interactionTypes.map((t, i) => {
              const boundId = activityColumnId(t);
              const boundCol = boundId ? taskColumnById(boundId) : null;
              const staleBind = !!activityToColumnMap[t] && !boundCol;
              const protectedType = isProtectedInteractionType(t);
              return `
              <tr style="cursor:default;">
                <td>
                  <span class="badge">${escapeHtml(t)}</span>
                  ${protectedType ? '<span title="Обязательный тип" style="margin-left:6px;color:#9ca3af;">обязательный</span>' : ''}
                </td>
                <td>
                  ${boundCol
                    ? `<span class="badge" style="background:${escapeHtml(boundCol.color || '#6b7280')};color:#fff;">${escapeHtml(boundCol.name)}</span>`
                    : '<span style="color:#9ca3af;font-size:12px;">не привязан — только комментарий</span>'}
                  ${staleBind ? '<div class="field-hint" style="color:#b45309;">Столбец привязки удалён — выберите новый в «Столбцах задач».</div>' : ''}
                </td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn-icon-btn" onclick="renameInteractionTypeFromAdmin(${i})" title="Переименовать">Изменить</button>
                  ${protectedType ? '' : `<button class="btn-icon-btn" onclick="deleteInteractionTypeFromAdmin(${i})" title="Удалить">Удалить</button>`}
                </td>
              </tr>`;
            }).join('') : `
              <tr><td colspan="3" style="text-align:center;color:#9ca3af;padding:30px;">Типы не добавлены</td></tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ===================== Столбцы задач =====================
   Администратор настраивает доску целиком:
     • глобальные столбцы — их видят все менеджеры;
     • индивидуальные — попадают только на доску выбранного менеджера;
     • привязку активностей к столбцам, включая «ни к какому» (как «Информация»).
   На самой доске кнопок правки нет: там столбцы только показываются. */

let adminColumnsManagerId = null;

function columnsOwnerLabel(ownerId) {
  const u = ownerId != null ? findUserById(ownerId) : null;
  return u ? (u.name || u.login) : (ownerId != null ? 'менеджер #' + ownerId : '');
}

// Варианты выбора столбца для привязки активности: глобальные и индивидуальные
// (у индивидуальных подписан владелец — они видны только ему).
function bindingColumnOptionsHtml(selectedId) {
  const global = globalTaskColumns().map(c =>
    `<option value="${c.id}"${c.id === selectedId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('');

  let individual = '';
  Object.keys(taskColumnsPerManager || {}).forEach(uid => {
    managerTaskColumns(uid).forEach(c => {
      individual += `<option value="${c.id}"${c.id === selectedId ? ' selected' : ''}>` +
        `${escapeHtml(c.name)} — ${escapeHtml(columnsOwnerLabel(Number(uid)))}</option>`;
    });
  });

  return `<option value=""${selectedId ? '' : ' selected'}>— не привязывать (только комментарий) —</option>` +
    (global ? `<optgroup label="Глобальные столбцы">${global}</optgroup>` : '') +
    (individual ? `<optgroup label="Индивидуальные столбцы">${individual}</optgroup>` : '');
}

function columnRowHtml(col) {
  const used = tasks.filter(t => t.status === col.id).length;
  const disabled = col.locked ? 'disabled' : '';
  const owner = taskColumnOwner(col.id);
  return `
    <tr style="cursor:default;">
      <td>
        <input type="text" id="colName_${col.id}" value="${escapeHtml(col.name)}" ${disabled}
               style="width:100%;padding:5px 7px;border:1px solid ${col.locked ? '#e5e7eb' : '#d0d5dd'};border-radius:5px;font-size:12.5px;">
        ${col.locked ? '<div class="field-hint">Обязательный столбец: переименовать и удалить нельзя</div>' : ''}
        ${owner ? `<div class="field-hint">Только для: ${escapeHtml(columnsOwnerLabel(Number(owner)))}</div>` : ''}
      </td>
      <td><input type="color" id="colColor_${col.id}" value="${escapeHtml(col.color || '#6b7280')}" ${disabled}
                 style="width:44px;height:28px;padding:0;border:1px solid #d0d5dd;border-radius:5px;background:#fff;"></td>
      <td style="text-align:center;">${used}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn-icon-btn" onclick="moveColumnFromAdmin('${col.id}', -1)" title="Переместить влево" ${disabled}>‹</button>
        <button class="btn-icon-btn" onclick="moveColumnFromAdmin('${col.id}', 1)" title="Переместить вправо" ${disabled}>›</button>
        <button class="btn-icon-btn" onclick="saveColumnFromAdmin('${col.id}')" title="Сохранить название и цвет" ${disabled}>Сохранить</button>
        <button class="btn-icon-btn" onclick="deleteColumnFromAdmin('${col.id}')" title="Удалить столбец" ${disabled}>Удалить</button>
      </td>
    </tr>`;
}

function columnsTableHtml(list) {
  if (!list.length) {
    return '<tr><td colspan="4" style="text-align:center;color:#9ca3af;padding:24px;">Столбцов нет</td></tr>';
  }
  return list.map(columnRowHtml).join('');
}

function renderAdminTaskColumns() {
  const main = document.getElementById('mainContent');
  if (!main) return;

  const managers = users.filter(u => isManagerRole(u));
  if (adminColumnsManagerId == null || !findUserById(adminColumnsManagerId)) {
    adminColumnsManagerId = managers.length ? managers[0].id : null;
  }

  const globalList = globalTaskColumns();
  const ownList = adminColumnsManagerId ? managerTaskColumns(adminColumnsManagerId) : [];
  const globalUsed = globalList.reduce((sum, c) => sum + tasks.filter(t => t.status === c.id).length, 0);
  const ownUsed = ownList.reduce((sum, c) => sum + tasks.filter(t => t.status === c.id).length, 0);

  main.innerHTML = `
    <div style="padding:25px;max-width:1000px;margin:0 auto;height:100%;box-sizing:border-box;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:16px;">
        <h1 style="font-size:22px;font-weight:600;color:#1a3a5c;">Столбцы задач</h1>
        <button class="btn btn-secondary" onclick="applyRecommendedBindingsFromAdmin()">Создать столбцы и привязки по ТЗ</button>
      </div>
      <p style="font-size:12px;color:#9ca3af;margin-bottom:20px;">
        Глобальные столбцы появляются у всех менеджеров, индивидуальные — только на доске
        выбранного менеджера. Удалённый столбец исчезает с доски, а его задачи переезжают
        в первый оставшийся. Обязательные столбцы (В работе, Завершены и другие статусы
        дашборда) переименовать и удалить нельзя.
      </p>

      <h3 class="orders-analysis-title">Глобальные столбцы (${globalList.length}, задач: ${globalUsed})</h3>
      <form onsubmit="addGlobalColumnFromAdmin(event)" style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        <input type="text" id="newGlobalColumnName" placeholder="Название нового столбца" style="flex:1;min-width:200px;padding:8px 10px;border:1px solid #d0d5dd;border-radius:5px;font-size:13px;">
        <input type="color" id="newGlobalColumnColor" value="#3b82f6" title="Цвет столбца" style="width:52px;height:36px;padding:0;border:1px solid #d0d5dd;border-radius:5px;background:#fff;">
        <button type="submit" class="btn">Добавить глобальный</button>
      </form>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:auto;margin-bottom:26px;">
        <table class="admin-table">
          <thead><tr><th>Название</th><th>Цвет</th><th>Задач</th><th style="text-align:right;">Действия</th></tr></thead>
          <tbody>${columnsTableHtml(globalList)}</tbody>
        </table>
      </div>

      <h3 class="orders-analysis-title">Индивидуальные столбцы менеджера (${ownList.length}, задач: ${ownUsed})</h3>
      <div class="tracking-add" style="margin-bottom:12px;">
        <select id="adminColumnsManager" onchange="setAdminColumnsManager(this.value)">
          ${managers.length ? managers.map(u =>
            `<option value="${u.id}"${u.id === adminColumnsManagerId ? ' selected' : ''}>${escapeHtml(u.name || u.login)} (${escapeHtml(userPositionLabel(u))})</option>`).join('')
            : '<option value="">— нет менеджеров —</option>'}
        </select>
        <span class="field-hint">Столбцы видны только выбранному менеджеру.</span>
      </div>
      ${adminColumnsManagerId ? `
        <form onsubmit="addManagerColumnFromAdmin(event)" style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
          <input type="text" id="newManagerColumnName" placeholder="Название личного столбца" style="flex:1;min-width:200px;padding:8px 10px;border:1px solid #d0d5dd;border-radius:5px;font-size:13px;">
          <input type="color" id="newManagerColumnColor" value="#0ea5e9" title="Цвет столбца" style="width:52px;height:36px;padding:0;border:1px solid #d0d5dd;border-radius:5px;background:#fff;">
          <button type="submit" class="btn">Добавить для менеджера</button>
        </form>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:auto;margin-bottom:26px;">
          <table class="admin-table">
            <thead><tr><th>Название</th><th>Цвет</th><th>Задач</th><th style="text-align:right;">Действия</th></tr></thead>
            <tbody>${columnsTableHtml(ownList)}</tbody>
          </table>
        </div>
      ` : '<div class="empty-state" style="padding:22px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:26px;">Менеджеров пока нет — сначала создайте пользователя в разделе «Пользователи».</div>'}

      <h3 class="orders-analysis-title">Привязка активностей к столбцам</h3>
      <p style="font-size:12px;color:#9ca3af;margin-bottom:12px;">
        Активность с привязанным столбцом создаёт задачу в нём. «Не привязывать» оставляет
        только комментарий — так работает «Информация».
      </p>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:auto;">
        <table class="admin-table">
          <thead><tr><th>Тип активности</th><th>Столбец задачи</th></tr></thead>
          <tbody>
            ${interactionTypes.length ? interactionTypes.map((t, i) => {
              const boundId = activityColumnId(t);
              const stale = !!activityToColumnMap[t] && !boundId;
              const rec = ACTIVITY_COLUMN_RECOMMENDED.find(r => r.type === t);
              return `
                <tr style="cursor:default;">
                  <td>
                    <span class="badge">${escapeHtml(t)}</span>
                    ${rec ? `<div class="field-hint">Рекомендуется: «${escapeHtml(rec.column)}»</div>` : ''}
                  </td>
                  <td>
                    <select onchange="setActivityColumnFromAdmin(${i}, this.value)"
                            style="padding:5px 8px;border:1px solid #d0d5dd;border-radius:5px;font-size:12px;">
                      ${bindingColumnOptionsHtml(boundId)}
                    </select>
                    ${stale ? '<div class="field-hint" style="color:#b45309;">Столбец привязки удалён — выберите новый.</div>' : ''}
                  </td>
                </tr>`;
            }).join('') : '<tr><td colspan="2" style="text-align:center;color:#9ca3af;padding:24px;">Типы не добавлены</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function setAdminColumnsManager(value) {
  adminColumnsManagerId = value ? parseInt(value, 10) : null;
  renderAdminTaskColumns();
}

function addGlobalColumnFromAdmin(e) {
  if (e && e.preventDefault) e.preventDefault();
  const nameEl = document.getElementById('newGlobalColumnName');
  const colorEl = document.getElementById('newGlobalColumnColor');
  const res = addTaskColumnScoped('global', null, nameEl ? nameEl.value : '', colorEl ? colorEl.value : '');
  if (!res.ok) { alert(res.error); return; }
  renderAdminTaskColumns();
}

function addManagerColumnFromAdmin(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (!adminColumnsManagerId) { alert('Выберите менеджера'); return; }
  const nameEl = document.getElementById('newManagerColumnName');
  const colorEl = document.getElementById('newManagerColumnColor');
  const res = addTaskColumnScoped('manager', adminColumnsManagerId, nameEl ? nameEl.value : '', colorEl ? colorEl.value : '');
  if (!res.ok) { alert(res.error); return; }
  renderAdminTaskColumns();
}

function saveColumnFromAdmin(colId) {
  const nameEl = document.getElementById('colName_' + colId);
  const colorEl = document.getElementById('colColor_' + colId);
  const res = renameTaskColumn(colId, nameEl ? nameEl.value : '', colorEl ? colorEl.value : '');
  if (!res.ok) { alert(res.error); return; }
  renderAdminTaskColumns();
}

function moveColumnFromAdmin(colId, delta) {
  const res = moveTaskColumn(colId, delta);
  if (!res.ok) { alert(res.error); return; }
  renderAdminTaskColumns();
}

function deleteColumnFromAdmin(colId) {
  const ref = columnScopeRef(colId);
  if (!ref) return;
  if (ref.column.locked) { alert('Обязательный столбец удалить нельзя'); return; }

  const used = tasks.filter(t => t.status === colId).length;
  let msg = 'Удалить столбец «' + ref.column.name + '»?';
  if (used) msg += '\nЗадачи (' + used + ') переедут в первый оставшийся столбец.';
  if (!confirm(msg)) return;

  const res = deleteTaskColumnScoped(colId);
  if (!res.ok) { alert(res.error); return; }
  if (res.moved) {
    console.log('Столбец «' + ref.column.name + '» удалён, задач перенесено: ' + res.moved + ' → «' + res.target + '»');
  }
  renderAdminTaskColumns();
}

// Назначение столбца для активности из админки (индекс строки справочника).
function setActivityColumnFromAdmin(index, columnId) {
  const type = interactionTypes[index];
  if (type === undefined) return;
  const res = setActivityColumn(type, columnId || null);
  if (!res.ok) { alert(res.error); }
  renderAdminTaskColumns();
}

// Кнопка «Создать столбцы и привязки по ТЗ»: администратор одним действием
// заводит рабочие столбцы и связывает с ними активности. Автоматически
// ничего не создаётся — только по нажатию.
function applyRecommendedBindingsFromAdmin() {
  const report = applyRecommendedActivityBindings();
  renderAdminTaskColumns();
  const lines = [];
  lines.push('Созданы столбцы: ' + (report.columns.length ? report.columns.join(', ') : 'новые не потребовались'));
  lines.push('Привязки активностей:');
  report.bindings.forEach(b => lines.push('  • ' + b));
  lines.push('');
  lines.push('Задачи по этим активностям будут падать в указанные столбцы.');
  alert(lines.join('\n'));
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
  const res = deleteInteractionType(index);
  if (!res.ok) { alert(res.error); return; }
  renderAdminInteractionTypes();
}

/* ===================== Анализ ===================== */

let adminAnalysisTab = 'stats';   // 'stats' | 'comments'
let adminCommentTagFilter = 'all'; // 'all' | 'forSelf' | 'forReport' — фильтр по отметке
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
      ${adminAnalysisTab === 'comments' ? `
        <span style="font-size:13px;color:#4b5563;font-weight:500;margin-left:8px;">Отметка:</span>
        <select onchange="setAdminCommentTagFilter(this.value)" style="padding:6px 9px;border:1px solid #d0d5dd;border-radius:5px;font-size:12px;outline:none;">
          <option value="all"${adminCommentTagFilter === 'all' ? ' selected' : ''}>Все комментарии</option>
          <option value="forSelf"${adminCommentTagFilter === 'forSelf' ? ' selected' : ''}>Для себя</option>
          <option value="forReport"${adminCommentTagFilter === 'forReport' ? ' selected' : ''}>Для отчёта</option>
        </select>` : ''}
      ${(from || to) ? `<span style="font-size:12px;color:#9ca3af;">Показаны данные за период</span>` : ''}
    </div>`;

  main.innerHTML = `
    <div style="padding:25px;max-width:1100px;margin:0 auto;height:100%;box-sizing:border-box;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h1 style="font-size:22px;font-weight:600;color:#1a3a5c;">Анализ</h1>
        ${adminAnalysisTab === 'comments'
          ? '<button class="btn" onclick="exportCommentsExcel()">Выгрузить комментарии в Excel</button>'
          : '<button class="btn" onclick="exportAdminReport()">Экспорт в Excel</button>'}
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
// Фильтр по отметке: «Для себя» / «Для отчёта» / все.
function commentsForRange() {
  const result = [];
  clients.forEach(c => {
    (c.history || []).forEach(h => {
      if (!inAnalysisRange(h.date)) return;
      const tags = commentTagsList(h.tags);
      if (adminCommentTagFilter !== 'all' && tags.indexOf(adminCommentTagFilter) === -1) return;
      result.push({
        manager: h.manager || '',
        type: h.type || '',
        company: c.orgName || '',
        comment: h.comment || '',
        date: h.date || '',
        tags: tags,
        order: h.order || null
      });
    });
  });
  return result.sort((a, b) => new Date(b.date) - new Date(a.date));
}

function setAdminCommentTagFilter(value) {
  adminCommentTagFilter = value || 'all';
  renderAdminAnalysis();
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
              <th>Менеджер</th><th>Тип взаимодействия</th><th>Компания</th><th>Комментарий</th><th>Отметки</th><th>Дата/Время</th>
            </tr></thead>
            <tbody>
              ${comments.map(h => `
                <tr style="cursor:default;">
                  <td><strong>${escapeHtml(h.manager || '—')}</strong></td>
                  <td><span class="badge">${escapeHtml(h.type || '—')}</span></td>
                  <td>${escapeHtml(h.company)}</td>
                  <td><div class="history-comment">${escapeHtml(h.comment || '—')}</div></td>
                  <td>${commentTagsHtml(h.tags) || '<span style="color:#9ca3af;">—</span>'}</td>
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
    'Отметки': commentTagLabels(h.tags) || '—',
    'Кол-во кг': h.order && h.order.kg !== null && h.order.kg !== undefined ? h.order.kg : '—',
    'Состояние': h.order && h.order.condition ? h.order.condition : '—',
    'Стоимость за кг': h.order && h.order.avgPrice !== null && h.order.avgPrice !== undefined ? h.order.avgPrice : '—',
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

// Цветная метка роли в списке пользователей: администратор, руководитель,
// менеджер по продажам.
function roleBadgeHtml(u) {
  const role = normalizeRole(u && u.role);
  const styles = {
    admin: 'background:#dbeafe;color:#1e40af;',
    lead: 'background:#ede9fe;color:#5b21b6;',
    manager: 'background:#f3f4f6;color:#4b5563;'
  };
  return '<span class="badge" style="' + (styles[role] || styles.manager) + '">' +
    escapeHtml(userRoleLabel(u)) + '</span>';
}

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
            <th>Логин</th><th>ФИО</th><th>Должность</th><th>Пароль</th><th>Роль</th><th style="text-align:right;">Действия</th>
          </tr></thead>
          <tbody>
            ${users.map(u => `
              <tr style="cursor:default;">
                <td><strong>${escapeHtml(u.login)}</strong></td>
                <td>${escapeHtml(u.name || '—')}</td>
                <td>${escapeHtml((u.position || '').trim() || '—')}</td>
                <td><span style="font-family:'Courier New',monospace;">${escapeHtml(u.password)}</span></td>
                <td>${roleBadgeHtml(u)}</td>
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
  document.getElementById('userPosition').value = u ? (u.position || '') : '';
  const pwdInput = document.getElementById('userPassword');
  pwdInput.value = u ? u.password : ''; // существующий пароль не сбрасываем
  pwdInput.placeholder = u ? 'Введите новый, если хотите сменить' : 'Пароль';
  document.getElementById('userRole').value = u ? normalizeRole(u.role) : ROLE_MANAGER;
  document.getElementById('userModal').classList.add('active');
}

function saveUser(e) {
  e.preventDefault();
  const id = document.getElementById('userId').value;
  const data = {
    login: document.getElementById('userLogin').value,
    name: document.getElementById('userName').value,
    position: document.getElementById('userPosition').value,
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

// Форма назначения новой задачи конкретному менеджеру.
/* ===== Автоподбор компании в форме назначения задачи ===== */

// Чекбокс «Ссылка на обработку новой компании»: активен, пока компания не выбрана.
/* ===================== Модальные окна админ-модуля ===================== */

function injectAdminModals() {
  if (document.getElementById('adminTasksModal')) return;

  const html = `
    <div class="modal-overlay" id="adminTasksModal" onclick="if(event.target===this)closeModal('adminTasksModal')">
      <div class="modal" style="width:820px;max-width:94vw;">
        <div style="display:flex;justify-content:flex-end;margin-bottom:6px;">
          <button type="button" class="btn btn-sm btn-secondary" onclick="closeModal('adminTasksModal')">Закрыть</button>
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
            <div class="form-row"><div class="form-group"><label>Должность</label>
              <input type="text" id="userPosition" placeholder="Например, менеджер по продажам">
            </div></div>
            <div class="form-row"><div class="form-group"><label>Пароль *</label><input type="password" id="userPassword" required></div></div>
            <div class="form-row">
              <div class="form-group"><label>Роль</label>
                <select id="userRole">
                  <option value="manager">Менеджер по продажам</option>
                  <option value="lead">Руководитель</option>
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

      `;
  document.body.insertAdjacentHTML('beforeend', html);
}
