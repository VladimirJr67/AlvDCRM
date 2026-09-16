/* ============================================================
   js/profile.js — профиль пользователя и настройки уведомлений.

   Профиль: ФИО, телефон, отдел, должность, фото. Фото хранится прямо
   в базе (data-URL), но перед сохранением сжимается до 200×200 —
   иначе снимок с телефона раздувал бы db.json и замедлял сохранение.

   Настройки уведомлений: звук (несколько базовых, синтезируются
   через Web Audio — файлы не нужны) и позиция всплывающих окон.
   ============================================================ */

const PROFILE_PHOTO_SIZE = 200;        // сторона квадрата, к которой приводим фото
const PROFILE_PHOTO_QUALITY = 0.85;    // качество JPEG

// Базовые звуки уведомления: короткие сигналы, которые генерируются
// на месте, поэтому в проект не нужно класть аудиофайлы.
const NOTIFY_SOUNDS = [
  { id: 'none', name: 'Без звука' },
  { id: 'short', name: 'Короткий' },
  { id: 'double', name: 'Двойной' },
  { id: 'soft', name: 'Мягкий' },
  { id: 'alarm', name: 'Сигнал' }
];

const NOTIFY_POSITIONS = [
  { id: 'bottom-right', name: 'Правый нижний' },
  { id: 'bottom-left', name: 'Левый нижний' },
  { id: 'top-right', name: 'Правый верхний' },
  { id: 'top-left', name: 'Левый верхний' },
  { id: 'center', name: 'По центру' }
];

const DEFAULT_NOTIFY_SETTINGS = { sound: 'short', position: 'bottom-right' };

function notifySettings() {
  const s = (currentUser && currentUser.settings) || {};
  return {
    sound: NOTIFY_SOUNDS.some(x => x.id === s.sound) ? s.sound : DEFAULT_NOTIFY_SETTINGS.sound,
    position: NOTIFY_POSITIONS.some(x => x.id === s.position) ? s.position : DEFAULT_NOTIFY_SETTINGS.position
  };
}

/* ===== Звук и позиция всплывающих окон ===== */

let audioCtx = null;

// Короткие сигналы: [частота, длительность] парами.
const SOUND_PATTERNS = {
  short: [[880, 0.12]],
  double: [[880, 0.10], [1180, 0.12]],
  soft: [[520, 0.18], [660, 0.22]],
  alarm: [[990, 0.14], [0, 0.06], [990, 0.14], [0, 0.06], [1320, 0.22]]
};

function playNotifySound(soundId) {
  const id = soundId || notifySettings().sound;
  if (!id || id === 'none' || !SOUND_PATTERNS[id]) return;

  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();

    let time = audioCtx.currentTime;
    SOUND_PATTERNS[id].forEach(([freq, dur]) => {
      if (!freq) { time += dur; return; }               // пауза в узоре
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.18, time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(time);
      osc.stop(time + dur + 0.02);
      time += dur;
    });
  } catch (e) { /* звук недоступен — молча продолжаем */ }
}

// Позиция всплывающих окон: класс на контейнере, положение задаёт CSS.
function applyNotifyPosition() {
  const host = document.getElementById('toastHost');
  if (!host) return;
  const pos = notifySettings().position;
  host.className = 'toast-host pos-' + pos;
}

function ensureToastHost() {
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    document.body.appendChild(host);
  }
  host.className = 'toast-host pos-' + notifySettings().position;
  return host;
}

/* ===== Профиль ===== */

function openProfileModal() {
  if (!currentUser) return;

  document.getElementById('profileLogin').value = currentUser.login || '';
  document.getElementById('profileName').value = currentUser.name || '';
  document.getElementById('profilePhone').value = currentUser.phone || '';
  document.getElementById('profileDepartment').value = currentUser.department || '';
  document.getElementById('profileJob').value = currentUser.position || '';

  const photo = document.getElementById('profilePhoto');
  if (photo) photo.src = currentUser.photo || '';

  const settings = notifySettings();
  const soundSel = document.getElementById('profileSound');
  soundSel.innerHTML = NOTIFY_SOUNDS.map(s =>
    `<option value="${s.id}"${s.id === settings.sound ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
  const posSel = document.getElementById('profilePosition');
  if (posSel) {
    posSel.innerHTML = NOTIFY_POSITIONS.map(p =>
      `<option value="${p.id}"${p.id === settings.position ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  }

  setProfileMessage('');
  document.getElementById('profileModal').classList.add('active');
}

function setProfileMessage(text, kind) {
  const el = document.getElementById('profileMessage');
  if (!el) return;
  el.className = 'integration-msg' + (text ? (kind === 'error' ? ' err' : ' ok') : '');
  el.textContent = text || '';
}

// Фото уменьшаем на клиенте: в базу уходит небольшой data-URL.
function onProfilePhotoSelected(event) {
  const input = event && event.target;
  const file = input && input.files && input.files[0];
  if (input) input.value = '';
  if (!file) return;

  if (!/^image\//.test(file.type)) {
    setProfileMessage('Выберите файл изображения', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = PROFILE_PHOTO_SIZE;
        canvas.height = PROFILE_PHOTO_SIZE;
        const ctx = canvas.getContext('2d');
        // Квадрат по меньшей стороне — фото не растягивается.
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, PROFILE_PHOTO_SIZE, PROFILE_PHOTO_SIZE);
        const dataUrl = canvas.toDataURL('image/jpeg', PROFILE_PHOTO_QUALITY);

        const photo = document.getElementById('profilePhoto');
        if (photo) photo.src = dataUrl;
        photo.dataset.pending = dataUrl;
        setProfileMessage('Фото готово к сохранению', 'ok');
      } catch (e) {
        setProfileMessage('Не удалось обработать фото: ' + e.message, 'error');
      }
    };
    img.onerror = () => setProfileMessage('Не удалось прочитать изображение', 'error');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function clearProfilePhoto() {
  const photo = document.getElementById('profilePhoto');
  if (photo) {
    photo.src = '';
    photo.dataset.pending = '';
  }
  setProfileMessage('Фото будет удалено после сохранения', 'ok');
}

function saveProfile() {
  if (!currentUser) return;

  const live = findUserById(currentUser.id);
  if (!live) { setProfileMessage('Пользователь не найден', 'error'); return; }

  const name = document.getElementById('profileName').value.trim();
  if (!name) { setProfileMessage('Укажите ФИО', 'error'); return; }

  live.name = name;
  live.phone = document.getElementById('profilePhone').value.trim();
  live.department = document.getElementById('profileDepartment').value.trim();
  live.position = document.getElementById('profileJob').value.trim();

  const photo = document.getElementById('profilePhoto');
  if (photo) {
    if (photo.dataset.pending) live.photo = photo.dataset.pending;
    else if (photo.dataset.pending === '') live.photo = '';
    delete photo.dataset.pending;
  }

  const soundSel = document.getElementById('profileSound');
  const posSel = document.getElementById('profilePosition');
  live.settings = {
    sound: soundSel ? soundSel.value : DEFAULT_NOTIFY_SETTINGS.sound,
    position: posSel ? posSel.value : DEFAULT_NOTIFY_SETTINGS.position
  };

  currentUser = live;
  saveUsers();                    // уходит в общую базу
  saveSessionFor(live);           // сессия обновляется вместе с профилем

  updateUserInfo();
  applyNotifyPosition();
  setProfileMessage('Профиль сохранён', 'ok');
  closeModal('profileModal');
}

function testNotifySound() {
  const sel = document.getElementById('profileSound');
  playNotifySound(sel ? sel.value : null);
}
