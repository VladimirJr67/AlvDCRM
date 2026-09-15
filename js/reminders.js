let reminders = [];
let currentReminderMonth = new Date().getMonth();
let currentReminderYear = new Date().getFullYear();
let reminderDateFilter = null;

const REMINDER_COLORS = [
  { name: 'Синий', value: '#3b82f6' },
  { name: 'Красный', value: '#ef4444' },
  { name: 'Зелёный', value: '#10b981' },
  { name: 'Серый', value: '#6b7280' },
  { name: 'Оранжевый', value: '#f59e0b' }
];

function loadReminders() {
  const saved = localStorage.getItem('alvid_crm_reminders');
  reminders = saved ? JSON.parse(saved) : [];
}

function saveReminders() {
  localStorage.setItem('alvid_crm_reminders', JSON.stringify(reminders));
  // Напоминания должны попадать в общую базу (db.json), чтобы их видели
  // другие пользователи через поллинг/SSE.
  queueServerSave();
}

function renderReminders() {
  const main = document.getElementById('mainContent');
  
  let filteredReminders = reminders;
  if (reminderDateFilter) {
    filteredReminders = reminders.filter(r => r.date === reminderDateFilter);
  }
  
  const today = new Date().toISOString().split('T')[0];
  const upcoming = filteredReminders.filter(r => r.date >= today && !r.completed).sort((a, b) => new Date(a.date + 'T' + a.time) - new Date(b.date + 'T' + b.time));
  const overdue = filteredReminders.filter(r => r.date < today && !r.completed).sort((a, b) => new Date(b.date) - new Date(a.date));
  const completed = filteredReminders.filter(r => r.completed);

  main.innerHTML = `
    <div style="display:flex;gap:20px;padding:30px;max-width:1400px;margin:0 auto;">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h1 style="font-size:22px;font-weight:600;color:#1a3a5c;">🔔 Напоминания${reminderDateFilter ? ' — ' + formatDate(reminderDateFilter) : ''}</h1>
          <div style="display:flex;gap:8px;">
            ${reminderDateFilter ? '<button class="btn btn-secondary btn-sm" onclick="clearReminderDateFilter()">Сбросить дату</button>' : ''}
            <button class="btn" onclick="openReminderModal()">+ Новое напоминание</button>
          </div>
        </div>
        
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:25px;">
          <div class="stat-card"><div class="stat-value" style="color:#ef4444">${overdue.length}</div><div class="stat-label">Просрочено</div></div>
          <div class="stat-card"><div class="stat-value" style="color:#3b82f6">${upcoming.length}</div><div class="stat-label">Предстоит</div></div>
          <div class="stat-card"><div class="stat-value" style="color:#10b981">${completed.length}</div><div class="stat-label">Выполнено</div></div>
        </div>

        ${overdue.length > 0 ? `
          <div style="margin-bottom:20px;">
            <h3 style="font-size:15px;font-weight:600;color:#ef4444;margin-bottom:12px;">⚠ Просрочено</h3>
            ${overdue.map(r => renderReminderCard(r, 'overdue')).join('')}
          </div>
        ` : ''}
        
        ${upcoming.length > 0 ? `
          <div style="margin-bottom:20px;">
            <h3 style="font-size:15px;font-weight:600;color:#3b82f6;margin-bottom:12px;">📅 Предстоящие</h3>
            ${upcoming.map(r => renderReminderCard(r, 'upcoming')).join('')}
          </div>
        ` : ''}
        
        ${completed.length > 0 ? `
          <div>
            <h3 style="font-size:15px;font-weight:600;color:#10b981;margin-bottom:12px;">✅ Выполнено</h3>
            ${completed.slice(0, 10).map(r => renderReminderCard(r, 'completed')).join('')}
          </div>
        ` : ''}
        
        ${filteredReminders.length === 0 ? `
          <div style="text-align:center;padding:60px 20px;color:#9ca3af;">
            <h2 style="color:#4b5563;margin-bottom:8px;">Нет напоминаний</h2>
            <p>Создайте первое напоминание</p>
          </div>
        ` : ''}
      </div>
      
      <div style="width:280px;flex-shrink:0;">
        ${renderReminderCalendar()}
      </div>
    </div>
  `;
}

function renderReminderCalendar() {
  const year = currentReminderYear;
  const month = currentReminderMonth;
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDay = firstDay.getDay() || 7;
  
  const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  
  let html = `
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:15px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <button onclick="changeReminderMonth(-1)" style="background:none;border:none;cursor:pointer;font-size:18px;color:#6b7280;">‹</button>
        <span style="font-weight:600;font-size:14px;color:#1a3a5c;">${monthNames[month]} ${year}</span>
        <button onclick="changeReminderMonth(1)" style="background:none;border:none;cursor:pointer;font-size:18px;color:#6b7280;">›</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center;">
  `;
  
  ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(d => {
    html += `<div style="font-size:11px;color:#9ca3af;padding:4px;font-weight:500;">${d}</div>`;
  });
  
  for (let i = 1; i < startDay; i++) html += '<div></div>';
  
  const today = new Date().toISOString().split('T')[0];
  
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dayReminders = reminders.filter(r => r.date === dateStr && !r.completed);
    const isSelected = reminderDateFilter === dateStr;
    const isToday = dateStr === today;
    
    html += `<div onclick="filterRemindersByDate('${dateStr}')" style="cursor:pointer;padding:4px 2px;border-radius:4px;min-height:38px;${isSelected ? 'background:#eff6ff;' : ''}">
      <div style="font-size:12px;color:${isToday ? '#3b82f6' : '#374151'};${isToday ? 'font-weight:700;' : ''}">${day}</div>
      <div style="display:flex;gap:2px;justify-content:center;flex-wrap:wrap;margin-top:2px;">
        ${dayReminders.slice(0,4).map(r => {
          const color = REMINDER_COLORS.find(c => c.value === r.color)?.value || '#6b7280';
          return `<div style="width:5px;height:5px;border-radius:50%;background:${color};"></div>`;
        }).join('')}
      </div>
    </div>`;
  }
  
  html += '</div></div>';
  return html;
}

function changeReminderMonth(delta) {
  currentReminderMonth += delta;
  if (currentReminderMonth > 11) { currentReminderMonth = 0; currentReminderYear++; }
  if (currentReminderMonth < 0) { currentReminderMonth = 11; currentReminderYear--; }
  renderReminders();
}

function filterRemindersByDate(dateStr) {
  reminderDateFilter = reminderDateFilter === dateStr ? null : dateStr;
  renderReminders();
}

function clearReminderDateFilter() {
  reminderDateFilter = null;
  renderReminders();
}

function renderReminderCard(reminder, status) {
  const color = REMINDER_COLORS.find(c => c.value === reminder.color) || REMINDER_COLORS[0];
  const isOverdue = status === 'overdue';
  const isCompleted = status === 'completed';
  
  const assignedContacts = (reminder.assignees || []).map(a => {
    if (a.type === 'me') return `${currentUser ? currentUser.login : 'Admin'} (Я)`;
    const contact = contacts.find(c => c.id === a.id);
    return contact ? contact.name : null;
  }).filter(Boolean);

  const client = reminder.clientId ? clients.find(c => c.id === reminder.clientId) : null;

  return `
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:10px;${isOverdue ? 'border-left:3px solid #ef4444;' : `border-left:3px solid ${color.value};`}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div style="display:flex;align-items:flex-start;gap:10px;flex:1;min-width:0;">
          <input type="checkbox" ${isCompleted ? 'checked' : ''} onchange="toggleReminderComplete(${reminder.id})" style="width:16px;height:16px;cursor:pointer;margin-top:2px;flex-shrink:0;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:500;color:#111;${isCompleted ? 'text-decoration:line-through;opacity:0.6;' : ''};word-break:break-word;">${escapeHtml(reminder.title)}</div>
            ${reminder.description ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;line-height:1.4;">${escapeHtml(reminder.description)}</div>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px;">
          <button class="btn-icon-btn" onclick="editReminder(${reminder.id})" title="Редактировать">✏️</button>
          <button class="btn-icon-btn" onclick="deleteReminder(${reminder.id})" title="Удалить">🗑</button>
        </div>
      </div>
      
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;color:#6b7280;margin-top:8px;">
        <span style="${isOverdue ? 'color:#ef4444;font-weight:500;' : ''}">📅 ${formatDate(reminder.date)}</span>
        <span style="color:#d1d5db;">·</span>
        <span>🕐 ${reminder.time}</span>
        ${client ? `<span style="color:#d1d5db;">·</span><span style="color:#3b82f6;cursor:pointer;" onclick="goToClient(${client.id})"> ${escapeHtml(client.orgName)}</span>` : ''}
      </div>
      
      ${assignedContacts.length > 0 ? `
        <div style="font-size:12px;color:#6b7280;margin-top:6px;"> ${assignedContacts.join(', ')}</div>
      ` : ''}
    </div>
  `;
}

function goToClient(id) {
  document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
  document.querySelector('[data-section="clients"]').classList.add('active');
  document.getElementById('contactsSubmenu').classList.remove('show');
  renderSection('clients');
  setTimeout(() => selectClient(id), 50);
}

function openReminderModal(reminder = null, clientId = null) {
  document.getElementById('reminderModalTitle').textContent = reminder ? 'Редактировать напоминание' : 'Новое напоминание';
  document.getElementById('reminderId').value = reminder?.id || '';
  document.getElementById('reminderTitle').value = reminder?.title || '';
  document.getElementById('reminderDescription').value = reminder?.description || '';
  document.getElementById('reminderDate').value = reminder?.date || new Date().toISOString().split('T')[0];
  document.getElementById('reminderTime').value = reminder?.time || '09:00';
  document.getElementById('reminderClientId').value = reminder?.clientId || clientId || '';
  initReminderClientSearch();

  const colorSelect = document.getElementById('reminderColor');
  colorSelect.innerHTML = REMINDER_COLORS.map(c => 
    `<option value="${c.value}" ${reminder?.color === c.value ? 'selected' : ''}>${c.name}</option>`
  ).join('');
  
  const meCheckbox = document.getElementById('reminderAssignMe');
  const assigneesSelect = document.getElementById('reminderAssignees');
  
  const hasMe = reminder?.assignees?.some(a => a.type === 'me');
  meCheckbox.checked = hasMe || false;
  
  assigneesSelect.innerHTML = contacts.map(c => {
    const isSelected = reminder?.assignees?.some(a => a.type === 'contact' && a.id === c.id);
    return `<option value="${c.id}" ${isSelected ? 'selected' : ''}>${escapeHtml(c.name)} (${escapeHtml(c.department || '—')})</option>`;
  }).join('');
  
  const clientLink = document.getElementById('reminderClientLink');
  const cid = reminder?.clientId || clientId;
  if (cid) {
    const c = clients.find(cl => cl.id === cid);
    if (c) {
      clientLink.style.display = 'block';
      clientLink.innerHTML = `🏢 <strong>${escapeHtml(c.orgName)}</strong> <button type="button" onclick="unlinkReminderFromClient()" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:12px;margin-left:6px;">✕ убрать</button>`;
    }
  } else {
    clientLink.style.display = 'none';
  }
  
  document.getElementById('reminderModal').classList.add('active');
}

function unlinkReminderFromClient() {
  document.getElementById('reminderClientId').value = '';
  document.getElementById('reminderClientLink').style.display = 'none';
}

function saveReminder(e) {
  e.preventDefault();
  const id = document.getElementById('reminderId').value;
  const clientIdVal = document.getElementById('reminderClientId').value;
  const assignees = [];
  
  if (document.getElementById('reminderAssignMe').checked) {
    assignees.push({ type: 'me' });
  }
  Array.from(document.getElementById('reminderAssignees').selectedOptions).forEach(opt => {
    assignees.push({ type: 'contact', id: parseInt(opt.value) });
  });
  
  const data = {
    title: document.getElementById('reminderTitle').value.trim(),
    description: document.getElementById('reminderDescription').value.trim(),
    date: document.getElementById('reminderDate').value,
    time: document.getElementById('reminderTime').value,
    color: document.getElementById('reminderColor').value,
    assignees: assignees,
    clientId: clientIdVal ? parseInt(clientIdVal) : null
  };

  if (id) {
    const idx = reminders.findIndex(r => r.id === parseInt(id));
    if (idx !== -1) reminders[idx] = { ...reminders[idx], ...data };
  } else {
    const maxId = reminders.reduce((m, r) => Math.max(m, r.id || 0), 0);
    data.id = maxId + 1;
    data.completed = false;
    data.createdAt = new Date().toISOString();
    reminders.push(data);
  }
  
  saveReminders();
  closeModal('reminderModal');
  
  const currentSection = document.querySelector('.menu-item.active')?.dataset.section;
  if (currentSection === 'reminders') renderReminders();
}

function editReminder(id) {
  const r = reminders.find(x => x.id === id);
  if (r) openReminderModal(r);
}

function deleteReminder(id) {
  if (!confirm('Удалить напоминание?')) return;
  reminders = reminders.filter(r => r.id !== id);
  saveReminders();
  renderReminders();
}

function toggleReminderComplete(id) {
  const r = reminders.find(x => x.id === id);
  if (!r) return;
  r.completed = !r.completed;
  r.completedAt = r.completed ? new Date().toISOString() : null;
  saveReminders();
  renderReminders();
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  if (dateStr === today.toISOString().split('T')[0]) return 'Сегодня';
  if (dateStr === tomorrow.toISOString().split('T')[0]) return 'Завтра';
  
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatDateTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}