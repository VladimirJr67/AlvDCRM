let contacts = [];
let currentContactsSubsection = 'internal';
let contactsDepartmentFilter = '';

function renderContacts() {
  const main = document.getElementById('mainContent');
  const filteredContacts = contacts.filter(c => c.type === currentContactsSubsection);
  const titles = { internal: 'Внутренние номера', mobile: 'Мобильные телефоны' };
  // Уникальные отделы текущего подраздела для выпадающего фильтра.
  const departments = [...new Set(filteredContacts.map(c => (c.department || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  if (!departments.includes(contactsDepartmentFilter)) contactsDepartmentFilter = '';

  main.innerHTML = `
    <div class="main-right" style="width:100%">
      <div class="main-right-header">
        <div class="contacts-header">
          <h2>${titles[currentContactsSubsection]}</h2>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-secondary" onclick="document.getElementById('contactsFileInput').click()" title="Колонки файла: ФИО, Отдел, номер, должность">Импорт из Excel</button>
            <button class="btn" onclick="openContactItemModal()">+ Добавить контакт</button>
          </div>
        </div>
        <input type="file" id="contactsFileInput" accept=".xlsx,.xls,.csv" style="display:none" onchange="importContactsFromExcel(event)">
        <div id="contactsImportResult" style="display:none;margin-bottom:12px;padding:8px 12px;border-radius:6px;font-size:13px;"></div>
        <div class="stats-bar">
          <div class="stat-card"><div class="stat-value">${filteredContacts.length}</div><div class="stat-label">Всего контактов</div></div>
          <div class="stat-card"><div class="stat-value">${departments.length}</div><div class="stat-label">Отделов</div></div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:14px;">
          <input type="text" class="search-bar" id="contactsSearch" placeholder="Поиск по имени, отделу или номеру..." oninput="renderContactsList()">
          <select class="search-bar" id="contactsDepartmentFilter" style="max-width:240px;flex-shrink:0;cursor:pointer;" onchange="onContactsDepartmentFilterChange(this.value)">
            <option value="">Все отделы</option>
            ${departments.map(d => `<option value="${escapeHtml(d)}" ${contactsDepartmentFilter === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="main-right-content" style="padding:0 20px 20px">
        <div class="contacts-list" id="contactsList"></div>
      </div>
    </div>`;
  renderContactsList();
}

function onContactsDepartmentFilterChange(value) {
  contactsDepartmentFilter = value;
  renderContactsList();
}

function renderContactsList() {
  const search = (document.getElementById('contactsSearch')?.value || '').toLowerCase();
  const dept = contactsDepartmentFilter;
  const filtered = contacts.filter(c =>
    c.type === currentContactsSubsection &&
    (!dept || c.department === dept) &&
    (c.name.toLowerCase().includes(search) ||
     (c.department || '').toLowerCase().includes(search) ||
     c.number.toLowerCase().includes(search))
  );

  const list = document.getElementById('contactsList');
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state" style="padding:60px 20px"><p>Ничего не найдено</p></div>`;
    return;
  }

  list.innerHTML = filtered.map(c => `
    <div class="contact-item">
      <div><div class="contact-name">${escapeHtml(c.name)}</div><div class="contact-position">${escapeHtml(c.position || '')}</div></div>
      <div class="contact-dept">${escapeHtml(c.department || '—')}</div>
      <div class="contact-number">${escapeHtml(c.number)}</div>
      <div class="contact-actions">
        <button class="btn btn-sm btn-secondary" onclick="editContactItem(${c.id})">Изменить</button>
        <button class="btn btn-sm btn-danger" onclick="deleteContactItem(${c.id})">Удалить</button>
      </div>
    </div>
  `).join('');
}

function openContactItemModal(contact = null) {
  document.getElementById('contactItemModalTitle').textContent = contact ? 'Редактировать контакт' : 'Добавить контакт';
  document.getElementById('contactItemId').value = contact?.id || '';
  document.getElementById('contactItemType').value = currentContactsSubsection;
  document.getElementById('dirContactName').value = contact?.name || '';
  document.getElementById('dirContactPosition').value = contact?.position || '';
  document.getElementById('dirContactDept').value = contact?.department || '';
  document.getElementById('dirContactNumber').value = contact?.number || '';
  document.getElementById('contactItemModal').classList.add('active');
}

function saveContactItem(e) {
  e.preventDefault();
  const id = document.getElementById('contactItemId').value;
  const type = document.getElementById('contactItemType').value;
  const data = {
    name: document.getElementById('dirContactName').value.trim(),
    position: document.getElementById('dirContactPosition').value.trim(),
    department: document.getElementById('dirContactDept').value.trim(),
    number: document.getElementById('dirContactNumber').value.trim(),
    type: type
  };
  // Должность пополняет общий справочник — её увидят все менеджеры.
  if (data.position) dictAdd('positions', data.position);

  if (id) {
    const idx = contacts.findIndex(c => c.id === parseInt(id));
    if (idx !== -1) contacts[idx] = { ...contacts[idx], ...data };
  } else {
    const maxId = contacts.reduce((m, c) => Math.max(m, c.id || 0), 0);
    data.id = maxId + 1;
    contacts.push(data);
  }
  saveContacts(contacts);
  closeModal('contactItemModal');
  renderContactsList();
}

function editContactItem(id) {
  const c = contacts.find(x => x.id === id);
  if (c) openContactItemModal(c);
}

function deleteContactItem(id) {
  if (!confirm('Удалить контакт?')) return;
  contacts = contacts.filter(c => c.id !== id);
  saveContacts(contacts);
  renderContactsList();
}

/* ===== Импорт контактов из Excel =====
   Формат файла: колонка А — ФИО, B — Отдел, C — номер, D — должность.
   Поддерживаются .xlsx / .xls (через SheetJS) и .csv (UTF-8 / Windows-1251,
   разделитель «;» или «,»). Импорт идёт в текущий подраздел — «Внутренние»
   или «Мобильные». */

async function importContactsFromExcel(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;

  try {
    const rows = await parseSpreadsheetFile(file);
    const imported = buildContactsFromRows(rows, currentContactsSubsection);
    if (imported.length === 0) {
      renderContacts();
      showImportResult('В файле не найдено строк в формате «ФИО, Отдел, номер, должность».', true);
      return;
    }
    contacts = contacts.concat(imported);
    saveContacts(contacts);
    renderContacts();
    showImportResult(`Импортировано контактов: ${imported.length}`, false);
  } catch (err) {
    renderContacts();
    showImportResult('Ошибка при импорте: ' + err.message, true);
  }
}

// Разбор файла таблицы в массив строк. Используется и справочником
// контактов, и импортом клиентов (js/clients.js).
async function parseSpreadsheetFile(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    if (typeof XLSX === 'undefined') {
      throw new Error('библиотека чтения Excel не загружена (js/lib/xlsx.full.min.js)');
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  }
  if (lower.endsWith('.csv')) {
    const buf = await file.arrayBuffer();
    return parseCsv(decodeCsvText(buf));
  }
  throw new Error('поддерживаются только файлы .xlsx, .xls и .csv');
}

function decodeCsvText(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3)); // UTF-8 с BOM
  }
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (utf8.includes(String.fromCharCode(0xFFFD))) {
    return new TextDecoder('windows-1251').decode(bytes); // ANSI из русского Excel
  }
  return utf8;
}

function parseCsv(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  const delim = semis > commas ? ';' : ',';

  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === delim) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}

// Колонки определяем по заголовку, а не по порядку: шаблоны отличаются
// («ФИО, Отдел, Номер, Должность» против «Имя, Отдел, Должность, Номер»),
// и при позиционном разборе номер попадал в должность, а должность — в номер.
const CONTACT_COLUMN_ALIASES = {
  name: ['фио', 'ф.и.о.', 'ф и о', 'имя', 'фамилия', 'name', 'fio', 'контактное лицо'],
  department: ['отдел', 'департамент', 'подразделение', 'department'],
  number: ['номер', 'телефон', 'тел', 'телефон номер', 'phone', 'номер телефона'],
  position: ['должность', 'позиция', 'position']
};

function resolveContactColumns(headerRow) {
  const headers = (headerRow || []).map(v => cleanCell(v).toLowerCase());
  const map = {};
  Object.keys(CONTACT_COLUMN_ALIASES).forEach(key => {
    const idx = headers.findIndex(h => h && CONTACT_COLUMN_ALIASES[key].indexOf(h) > -1);
    if (idx > -1) map[key] = idx;
  });
  return map;
}

function buildContactsFromRows(rows, type) {
  const result = [];
  let maxId = contacts.reduce((m, c) => Math.max(m, c.id || 0), 0);
  if (!rows.length) return result;

  const map = resolveContactColumns(rows[0]);
  // Заголовок распознан, если нашлась хотя бы одна известная колонка.
  const hasHeader = Object.keys(map).length > 0 || isHeaderRow(rows[0]);
  const start = hasHeader ? 1 : 0;
  // Незнакомые колонки берём по прежнему порядку.
  const col = {
    name: map.name !== undefined ? map.name : 0,
    department: map.department !== undefined ? map.department : 1,
    number: map.number !== undefined ? map.number : 2,
    position: map.position !== undefined ? map.position : 3
  };

  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    const name = cleanCell(row[col.name]);
    const department = cleanCell(row[col.department]);
    const number = cleanCell(row[col.number]);
    const position = cleanCell(row[col.position]);
    if (!name && !number) continue; // пустая строка

    result.push({
      id: ++maxId,
      type: type,
      name: name || 'Без имени',
      department: department,
      number: number,
      position: position
    });
  }
  return result;
}

function cleanCell(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim().replace(/\s+/g, ' ');
}

function isHeaderRow(row) {
  if (!row || !row.length) return false;
  const first = cleanCell(row[0]).toLowerCase();
  return /^(фио|ф\.и\.о\.|ф и о|имя|фамилия|name|fio)$/.test(first);
}

function showImportResult(text, isError) {
  const el = document.getElementById('contactsImportResult');
  if (!el) return;
  el.style.display = 'block';
  el.style.background = isError ? '#fee2e2' : '#d1fae5';
  el.style.color = isError ? '#991b1b' : '#065f46';
  el.textContent = text;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.display = 'none'; }, 6000);
}