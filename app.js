// ═══════════════════════════════════════════════════════
//  Grammy — Telegram-like Messenger
//  app.js — Main application logic
// ═══════════════════════════════════════════════════════

'use strict';

// ── Firebase Init ──────────────────────────────────────
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// ── Cloudinary Config ──────────────────────────────────
const CLOUDINARY_CLOUD  = 'dfvoysyio';
const CLOUDINARY_PRESET = 'copygram';
const CLOUDINARY_URL    = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/auto/upload`;

// ── Global state ──────────────────────────────────────
let currentUser   = null;   // Firebase auth user
let currentProfile = null;  // Firestore user doc
let activeChatId  = null;
let activeChatType = null;  // 'dm' | 'group' | 'channel'
let messagesUnsub  = null;
let chatListUnsub  = null;
let replyToMsg     = null;
let contextTargetMsg = null;

let voiceRecorder = null;
let voiceStream   = null;
let voiceChunks   = [];
let voiceTimerInt = null;
let voiceStartTime = 0;

let vidnoteRecorder = null;
let vidnoteStream   = null;
let vidnoteChunks   = [];
let vidnoteTimerInt = null;
let vidnoteStartTime = 0;
let vidnoteBlob     = null;
const VIDNOTE_MAX   = 60; // seconds

const ADMIN_USERNAME = 'mrzt';

// ── Utility ───────────────────────────────────────────
const $ = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);

function showToast(msg, duration = 3000) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), duration);
}

function formatTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'только что';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' мин';
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  if (diff < 86400000 * 7)
    return d.toLocaleDateString('ru', { weekday: 'short' });
  return d.toLocaleDateString('ru', { day: '2-digit', month: 'short' });
}

function formatMsgTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function generateId(len = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({length: len}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function renderAvatar(el, photoURL, name, color) {
  el.innerHTML = '';
  if (photoURL) {
    const img = document.createElement('img');
    img.src = photoURL;
    img.alt = name;
    el.appendChild(img);
  } else {
    el.textContent = (name || '?')[0].toUpperCase();
    if (color) el.style.background = color;
  }
}

function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

// Close modals on backdrop click
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', e => {
    if (e.target === m) {
      closeModal(m.id);
      if (m.id === 'comments-modal' && commentsUnsub) { commentsUnsub(); commentsUnsub = null; }
    }
  });
});
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    closeModal(btn.dataset.modal);
    if (btn.dataset.modal === 'comments-modal' && commentsUnsub) { commentsUnsub(); commentsUnsub = null; }
  });
});

// ══════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════

auth.onAuthStateChanged(async user => {
  $('loading-screen').classList.add('hidden');

  if (user) {
    currentUser = user;
    const snap = await db.collection('users').doc(user.uid).get();

    if (!snap.exists) {
      // New user — show onboarding
      showScreen('auth');
      showAuthPanel('onboarding');
    } else {
      currentProfile = snap.data();
      if (currentProfile.isBanned) {
        await auth.signOut();
        showScreen('auth');
        showAuthPanel('login');
        showToast('Аккаунт заблокирован');
        return;
      }
      initApp();
    }
  } else {
    showScreen('auth');
    showAuthPanel('login');
  }
});

function showScreen(name) {
  ['loading-screen', 'auth-screen', 'app'].forEach(id => {
    $(id).classList.add('hidden');
  });
  if (name === 'auth') $('auth-screen').classList.remove('hidden');
  else if (name === 'app') $('app').classList.remove('hidden');
}

function showAuthPanel(name) {
  ['login-panel', 'register-panel', 'onboarding-panel'].forEach(id => {
    $(id).classList.add('hidden');
  });
  $(`${name}-panel`).classList.remove('hidden');
}

// Login
$('login-btn').addEventListener('click', async () => {
  const email = $('login-email').value.trim();
  const pass  = $('login-password').value;
  if (!email || !pass) { showAuthError('login', 'Заполните все поля'); return; }
  $('login-btn').textContent = 'Входим...';
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch(e) {
    $('login-btn').textContent = 'Войти';
    showAuthError('login', firebaseErrorMsg(e));
  }
});

$('goto-register-btn').addEventListener('click', () => showAuthPanel('register'));
$('goto-login-btn').addEventListener('click', () => showAuthPanel('login'));

// Register step 1
$('reg-next-btn').addEventListener('click', async () => {
  const email = $('reg-email').value.trim();
  const pass  = $('reg-password').value;
  if (!email || !pass) { showAuthError('reg', 'Заполните все поля'); return; }
  if (pass.length < 6) { showAuthError('reg', 'Пароль минимум 6 символов'); return; }
  $('reg-next-btn').textContent = 'Загрузка...';
  try {
    await auth.createUserWithEmailAndPassword(email, pass);
    // onAuthStateChanged → onboarding
  } catch(e) {
    $('reg-next-btn').textContent = 'Далее';
    showAuthError('reg', firebaseErrorMsg(e));
  }
});

// Onboarding avatar
let onboardingAvatarFile = null;
$('onboarding-avatar-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  onboardingAvatarFile = file;
  const reader = new FileReader();
  reader.onload = ev => {
    $('onboarding-avatar-preview').innerHTML = `<img src="${ev.target.result}" alt=""/>`;
  };
  reader.readAsDataURL(file);
});

// Username live check (onboarding)
let usernameCheckTimer = null;
$('onboarding-username').addEventListener('input', () => {
  clearTimeout(usernameCheckTimer);
  const val = $('onboarding-username').value.trim().toLowerCase();
  const icon = $('username-check-icon');
  icon.textContent = '';
  icon.className = 'username-check';
  if (!val) return;
  usernameCheckTimer = setTimeout(() => checkUsernameAvailable(val, icon), 600);
});

async function checkUsernameAvailable(username, iconEl) {
  if (!/^[a-z0-9_]{3,32}$/.test(username)) {
    iconEl.textContent = '✗';
    iconEl.className = 'username-check taken';
    return false;
  }
  const snap = await db.collection('users').where('username', '==', username).get();
  if (!snap.empty && (!currentProfile || snap.docs[0].id !== currentUser.uid)) {
    iconEl.textContent = '✗';
    iconEl.className = 'username-check taken';
    return false;
  }
  iconEl.textContent = '✓';
  iconEl.className = 'username-check ok';
  return true;
}

$('onboarding-finish-btn').addEventListener('click', async () => {
  const name     = $('onboarding-name').value.trim();
  const username = $('onboarding-username').value.trim().toLowerCase();
  if (!name) { showAuthError('onboarding', 'Введите имя'); return; }
  if (!username) { showAuthError('onboarding', 'Введите @username'); return; }
  if (!/^[a-z0-9_]{3,32}$/.test(username)) {
    showAuthError('onboarding', 'Username: 3-32 символа, только a-z, 0-9, _'); return;
  }
  // Double-check username
  const existing = await db.collection('users').where('username', '==', username).get();
  if (!existing.empty) { showAuthError('onboarding', 'Этот @username уже занят'); return; }

  $('onboarding-finish-btn').textContent = 'Сохраняем...';
  try {
    let photoURL = '';
    if (onboardingAvatarFile) {
      photoURL = await uploadFile(`avatars/${currentUser.uid}`, onboardingAvatarFile);
    }
    const userData = {
      uid: currentUser.uid,
      email: currentUser.email,
      displayName: name,
      username,
      photoURL,
      bio: '',
      bannerURL: '',
      profileColor: '#5288c1',
      songURL: '',
      songName: '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      isBanned: false
    };
    await db.collection('users').doc(currentUser.uid).set(userData);
    currentProfile = userData;
    initApp();
  } catch(e) {
    $('onboarding-finish-btn').textContent = 'Начать';
    showAuthError('onboarding', e.message);
  }
});

function showAuthError(panel, msg) {
  const el = $(`${panel}-error`);
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function firebaseErrorMsg(err) {
  const map = {
    'auth/invalid-email': 'Неверный формат email',
    'auth/user-not-found': 'Пользователь не найден',
    'auth/wrong-password': 'Неверный пароль',
    'auth/email-already-in-use': 'Email уже зарегистрирован',
    'auth/weak-password': 'Слишком слабый пароль',
    'auth/too-many-requests': 'Слишком много попыток, попробуйте позже',
    'auth/invalid-credential': 'Неверный email или пароль',
  };
  return map[err.code] || err.message;
}

// ══════════════════════════════════════════════════════
//  FILE UPLOAD — Cloudinary
// ══════════════════════════════════════════════════════

async function uploadFile(path, file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_PRESET);
  formData.append('folder', path.split('/').slice(0, -1).join('/'));

  const res = await fetch(CLOUDINARY_URL, { method: 'POST', body: formData });
  if (!res.ok) throw new Error('Ошибка загрузки файла');
  const data = await res.json();
  return data.secure_url;
}

async function uploadBlob(path, blob, type) {
  const formData = new FormData();
  formData.append('file', blob);
  formData.append('upload_preset', CLOUDINARY_PRESET);
  formData.append('folder', path.split('/').slice(0, -1).join('/'));

  const res = await fetch(CLOUDINARY_URL, { method: 'POST', body: formData });
  if (!res.ok) throw new Error('Ошибка загрузки файла');
  const data = await res.json();
  return data.secure_url;
}

// ══════════════════════════════════════════════════════
//  APP INIT
// ══════════════════════════════════════════════════════

function initApp() {
  showScreen('app');
  updateDrawer();
  loadChatList();
  initEventListeners();
  initPushNotifications();

  // Show admin menu if @mrzt
  if (currentProfile.username === ADMIN_USERNAME) {
    $('drawer-admin').classList.remove('hidden');
  }
}

function updateDrawer() {
  $('drawer-name').textContent = currentProfile.displayName || '—';
  $('drawer-username').textContent = '@' + (currentProfile.username || '—');
  renderAvatar($('drawer-avatar'), currentProfile.photoURL, currentProfile.displayName, currentProfile.profileColor);
}

// ══════════════════════════════════════════════════════
//  EVENT LISTENERS
// ══════════════════════════════════════════════════════

function initEventListeners() {
  // Drawer
  $('sidebar-menu-btn').addEventListener('click', openDrawer);
  $('drawer-overlay').addEventListener('click', closeDrawer);
  $('drawer-logout').addEventListener('click', () => {
    auth.signOut();
    closeDrawer();
  });
  $('drawer-profile-btn').addEventListener('click', () => {
    closeDrawer();
    openSettingsModal();
  });
  $('drawer-settings').addEventListener('click', () => {
    closeDrawer();
    openSettingsModal();
  });
  $('drawer-favorites').addEventListener('click', () => {
    closeDrawer();
    openFavorites();
  });
  $('drawer-new-group').addEventListener('click', () => {
    closeDrawer();
    openModal('create-group-modal');
  });
  $('drawer-new-channel').addEventListener('click', () => {
    closeDrawer();
    openModal('create-channel-modal');
  });
  $('drawer-admin').addEventListener('click', () => {
    closeDrawer();
    openAdminPanel();
  });

  // Compose (new chat)
  $('compose-btn').addEventListener('click', () => openModal('new-chat-modal'));

  // Sidebar search
  $('sidebar-search').addEventListener('input', handleSidebarSearch);
  $('search-clear-btn').addEventListener('click', () => {
    $('sidebar-search').value = '';
    $('search-results').classList.add('hidden');
    $('chat-list').style.display = '';
    $('search-clear-btn').classList.add('hidden');
  });

  // Chat back button (mobile)
  $('chat-back-btn').addEventListener('click', goBackToList);
  $('channel-back-btn').addEventListener('click', goBackToList);

  // Chat header click → profile
  $('chat-header-info-btn').addEventListener('click', () => {
    if (!activeChatId) return;
    if (activeChatType === 'dm') {
      const otherId = activeChatId.split('_').find(id => id !== currentUser.uid);
      if (otherId) openUserProfileModal(otherId);
    }
  });
  // Also clicking the avatar in header
  $('chat-header-avatar').addEventListener('click', () => {
    if (!activeChatId) return;
    if (activeChatType === 'dm') {
      const otherId = activeChatId.split('_').find(id => id !== currentUser.uid);
      if (otherId) openUserProfileModal(otherId);
    }
  });

  // Message input
  const msgInput = $('message-input');
  msgInput.addEventListener('input', () => {
    const isEmpty = !msgInput.textContent.trim();
    $('send-btn').classList.toggle('hidden', isEmpty);
    $('voice-btn').classList.toggle('hidden', !isEmpty);
    $('vidnote-btn').classList.toggle('hidden', !isEmpty);
  });
  msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); }
  });
  $('send-btn').addEventListener('click', sendTextMessage);

  // Attach
  $('attach-btn').addEventListener('click', () => {
    $('attach-panel').classList.toggle('hidden');
  });
  $('attach-photo-input').addEventListener('change', e => sendMediaFile(e.target.files[0]));
  $('attach-file-input').addEventListener('change', e => sendMediaFile(e.target.files[0]));

  // Voice recording
  $('voice-btn').addEventListener('mousedown', startVoiceRecording);
  $('voice-btn').addEventListener('touchstart', e => { e.preventDefault(); startVoiceRecording(); }, { passive: false });
  document.addEventListener('mouseup', stopVoiceRecording);
  document.addEventListener('touchend', stopVoiceRecording);
  $('voice-cancel-btn').addEventListener('click', cancelVoiceRecording);

  // Video note
  $('vidnote-btn').addEventListener('click', openVidnoteRecorder);
  $('vidnote-cancel-btn').addEventListener('click', closeVidnoteRecorder);
  $('vidnote-record-btn').addEventListener('click', toggleVidnoteRecording);
  $('vidnote-send-btn').addEventListener('click', sendVidnote);

  // Reply cancel
  $('reply-cancel-btn').addEventListener('click', cancelReply);

  // New chat search
  $('search-username-input').addEventListener('input', handleUserSearch);

  // Create group
  $('create-group-btn').addEventListener('click', createGroup);

  // Create channel
  $('channel-public-toggle').addEventListener('change', e => {
    $('channel-username-group').classList.toggle('hidden', !e.target.checked);
  });
  $('create-channel-btn').addEventListener('click', createChannel);

  // Settings
  $('settings-save-btn').addEventListener('click', saveSettings);
  setupSettingsAvatarPreview();
  setupSettingsBannerPreview();
  setupSettingsSongPreview();
  setupSettingsUsernameCheck();

  // Admin ban
  $('admin-ban-btn').addEventListener('click', adminBanUser);

  // Profile modal - message button
  $('profile-message-btn').addEventListener('click', () => {
    const uid = $('profile-modal').dataset.uid;
    closeModal('profile-modal');
    if (uid) openOrCreateDM(uid);
  });

  // Song player
  $('song-play-btn').addEventListener('click', toggleSongPlay);

  // Context menu
  document.addEventListener('contextmenu', e => e.preventDefault());
  $('ctx-reply').addEventListener('click', () => {
    if (contextTargetMsg) startReply(contextTargetMsg);
    hideContextMenu();
  });
  $('ctx-react').addEventListener('click', () => {
    if (contextTargetMsg) showReactionPicker(contextTargetMsg.id, 'msg', activeChatId);
    hideContextMenu();
  });
  $('ctx-copy').addEventListener('click', () => {
    if (contextTargetMsg?.text) navigator.clipboard.writeText(contextTargetMsg.text);
    hideContextMenu();
  });
  $('ctx-delete').addEventListener('click', async () => {
    if (contextTargetMsg) await deleteMessage(contextTargetMsg);
    hideContextMenu();
  });
  document.addEventListener('click', hideContextMenu);

  // Notification banner
  $('notif-allow-btn').addEventListener('click', async () => {
    const perm = await Notification.requestPermission();
    $('notif-banner').classList.add('hidden');
    if (perm === 'granted') showToast('🔔 Уведомления включены!');
  });
  $('notif-banner-close').addEventListener('click', () => {
    $('notif-banner').classList.add('hidden');
    localStorage.setItem('notif_dismissed', '1');
  });

  // Channel post
  $('channel-post-btn').addEventListener('click', sendChannelPost);
}

// ══════════════════════════════════════════════════════
//  DRAWER
// ══════════════════════════════════════════════════════

function openDrawer() {
  $('drawer').classList.remove('hidden');
  $('drawer-overlay').classList.remove('hidden');
  requestAnimationFrame(() => $('drawer').classList.add('open'));
}
function closeDrawer() {
  $('drawer').classList.remove('open');
  setTimeout(() => {
    $('drawer').classList.add('hidden');
    $('drawer-overlay').classList.add('hidden');
  }, 250);
}

// ══════════════════════════════════════════════════════
//  SIDEBAR SEARCH
// ══════════════════════════════════════════════════════

async function handleSidebarSearch(e) {
  const q = e.target.value.trim().toLowerCase();
  if (!q) {
    $('search-results').classList.add('hidden');
    $('chat-list').style.display = '';
    $('search-clear-btn').classList.add('hidden');
    return;
  }
  $('search-clear-btn').classList.remove('hidden');
  $('chat-list').style.display = 'none';
  $('search-results').classList.remove('hidden');
  $('search-results').innerHTML = '<div style="padding:12px;color:var(--text-secondary);font-size:13px">Ищем...</div>';

  // Search users
  const qs2 = q.startsWith('@') ? q.slice(1) : q;
  const usersSnap = await db.collection('users')
    .where('username', '>=', qs2)
    .where('username', '<=', qs2 + '\uf8ff')
    .limit(8).get();

  const html = [];
  usersSnap.forEach(doc => {
    const u = doc.data();
    if (u.uid === currentUser.uid) return;
    const avatar = u.photoURL
      ? `<img src="${u.photoURL}" alt=""/>`
      : `<span style="background:${u.profileColor||'#5288c1'}">${(u.displayName||'?')[0].toUpperCase()}</span>`;
    html.push(`
      <div class="chat-item" data-uid="${u.uid}" onclick="openOrCreateDM('${u.uid}'); $('sidebar-search').value=''; $('search-results').classList.add('hidden'); $('chat-list').style.display=''; $('search-clear-btn').classList.add('hidden');">
        <div class="chat-item-avatar">${avatar}</div>
        <div class="chat-item-body">
          <div class="chat-item-top">
            <div class="chat-item-name">${escHtml(u.displayName)}</div>
          </div>
          <div class="chat-item-preview">@${escHtml(u.username)}</div>
        </div>
      </div>
    `);
  });

  // Also search channels
  const chanSnap = await db.collection('channels')
    .where('username', '>=', qs2)
    .where('username', '<=', qs2 + '\uf8ff')
    .limit(5).get();
  chanSnap.forEach(doc => {
    const c = doc.data();
    html.push(`
      <div class="chat-item" onclick="openChannel('${doc.id}')">
        <div class="chat-item-avatar" style="background:var(--bg-input);font-size:20px;color:var(--accent)"><i class="fa-solid fa-broadcast-tower"></i></div>
        <div class="chat-item-body">
          <div class="chat-item-top"><div class="chat-item-name">${escHtml(c.name)}</div></div>
          <div class="chat-item-preview">@${escHtml(c.username||'')} · Канал</div>
        </div>
      </div>
    `);
  });

  $('search-results').innerHTML = html.length ? html.join('') : '<div style="padding:16px;color:var(--text-secondary);text-align:center;font-size:13px">Ничего не найдено</div>';
}

// ══════════════════════════════════════════════════════
//  CHAT LIST
// ══════════════════════════════════════════════════════

function loadChatList() {
  if (chatListUnsub) { chatListUnsub(); chatListUnsub = null; }

  // Real-time listener: fires instantly when ANY chat doc changes where
  // current user is in participants[]. This is how @idk sees a new chat
  // the moment @mrzt sends the first message — no page reload needed.
  //
  // NOTE: This query requires a composite Firestore index:
  //   Collection: chats | Fields: participants (Arrays) + updatedAt (Desc)
  // If the index doesn't exist yet, Firestore will log a link to create it.
  // As a fallback, we catch the error and retry without orderBy.
  const query = db.collection('chats')
    .where('participants', 'array-contains', currentUser.uid)
    .orderBy('updatedAt', 'desc');

  chatListUnsub = query.onSnapshot(async snap => {
    if (snap.empty) {
      $('chat-list-empty').style.display = '';
      $('chat-list').querySelectorAll('.chat-item').forEach(e => e.remove());
      return;
    }
    await renderChatList(snap.docs);
  }, async err => {
    // Index not ready yet — fall back to unordered query (still real-time)
    if (err.code === 'failed-precondition' || err.code === 'unavailable') {
      console.warn('Composite index missing, using fallback query. Create index at:', err.message.match(/https?:\/\/\S+/)?.[0]);
      chatListUnsub = db.collection('chats')
        .where('participants', 'array-contains', currentUser.uid)
        .onSnapshot(async snap2 => {
          if (snap2.empty) {
            $('chat-list-empty').style.display = '';
            $('chat-list').querySelectorAll('.chat-item').forEach(e => e.remove());
            return;
          }
          // Sort client-side by updatedAt desc
          const sorted = snap2.docs.slice().sort((a, b) => {
            const ta = a.data().updatedAt?.toMillis?.() || 0;
            const tb = b.data().updatedAt?.toMillis?.() || 0;
            return tb - ta;
          });
          await renderChatList(sorted);
        }, e2 => console.error('Chat list fallback error:', e2));
    } else {
      console.error('Chat list listener error:', err.code, err.message);
    }
  });
}

async function renderChatList(docs) {
  if (docs.length === 0) {
    $('chat-list-empty').style.display = '';
    $('chat-list').querySelectorAll('.chat-item').forEach(e => e.remove());
    return;
  }
  $('chat-list-empty').style.display = 'none';

  // Request browser notification permission once
  if (Notification && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  const items = await Promise.all(docs.map(async doc => {
    const chat = doc.data();
    let name = '', photoURL = '', avatarColor = '#5288c1', preview = '', timeStr = '';
    timeStr = formatTime(chat.updatedAt);

    const lastMsg = chat.lastMessage;
    if (lastMsg) {
      const typeLabels = { image: '🖼 Фото', voice: '🎤 Голосовое', vidnote: '⭕ Видео-кружок', file: '📎 Файл' };
      preview = lastMsg.text || typeLabels[lastMsg.type] || '';
      // Show browser notification for incoming messages
      if (
        lastMsg.senderId &&
        lastMsg.senderId !== currentUser.uid &&
        doc.id !== activeChatId &&
        chat.updatedAt
      ) {
        const ts = chat.updatedAt.toMillis ? chat.updatedAt.toMillis() : 0;
        const lastNotifKey = `notif_${doc.id}`;
        const lastNotif = parseInt(sessionStorage.getItem(lastNotifKey) || '0');
        if (ts > lastNotif && ts > Date.now() - 10000) {
          sessionStorage.setItem(lastNotifKey, ts);
          if (Notification && Notification.permission === 'granted') {
            new Notification(name || 'Новое сообщение', {
              body: preview,
              icon: photoURL || '',
              tag: doc.id,
            });
          }
        }
      }
    }

    if (chat.type === 'dm') {
      const otherId = chat.participants.find(id => id !== currentUser.uid);
      const userSnap = await db.collection('users').doc(otherId).get();
      if (userSnap.exists) {
        const u = userSnap.data();
        name = u.displayName;
        photoURL = u.photoURL;
        avatarColor = u.profileColor || '#5288c1';
      }
    } else if (chat.type === 'favorites') {
      name = chat.name || 'Избранное';
      avatarColor = '#f0a500';
    } else if (chat.type === 'group') {
      name = chat.name || 'Группа';
      photoURL = chat.photoURL || '';
    } else if (chat.type === 'channel') {
      name = chat.name || 'Канал';
      photoURL = chat.photoURL || '';
    }

    // Fire push notification for incoming messages
    if (
      lastMsg?.senderId &&
      lastMsg.senderId !== currentUser.uid &&
      doc.id !== activeChatId &&
      chat.updatedAt
    ) {
      const ts = chat.updatedAt.toMillis ? chat.updatedAt.toMillis() : 0;
      const lastNotifKey = `notif_${doc.id}`;
      const lastNotif = parseInt(sessionStorage.getItem(lastNotifKey) || '0');
      if (ts > lastNotif && ts > Date.now() - 10000) {
        sessionStorage.setItem(lastNotifKey, ts);
        fireNotification(
          name || 'Новое сообщение',
          preview || 'Новое сообщение',
          photoURL || '',
          doc.id
        );
      }
    }

    // Unread dot
    const hasUnread = lastMsg && lastMsg.senderId && lastMsg.senderId !== currentUser.uid && doc.id !== activeChatId;
    const isPinned = (currentProfile.pinnedChats || []).includes(doc.id);

    // Avatar — favorites gets star, others get photo or letter
    let avatarContent;
    if (chat.type === 'favorites') {
      avatarContent = `<span style="background:rgba(240,165,0,0.15);color:#f0a500;font-size:20px"><i class="fa-solid fa-star"></i></span>`;
    } else if (photoURL) {
      avatarContent = `<img src="${photoURL}" alt=""/>`;
    } else {
      avatarContent = `<span style="background:${avatarColor}">${(name||'?')[0].toUpperCase()}</span>`;
    }

    return {
      isPinned,
      html: `
        <div class="chat-item${activeChatId === doc.id ? ' active' : ''}${isPinned ? ' pinned' : ''}" 
             id="chatitem-${doc.id}"
             data-chatid="${doc.id}" 
             data-type="${chat.type}"
             onclick="handleChatItemClick('${doc.id}','${chat.type}')"
             oncontextmenu="handleChatItemRightClick(event,'${doc.id}',${isPinned})">
          ${isPinned ? '<div class="pin-indicator"><i class="fa-solid fa-thumbtack"></i></div>' : ''}
          <div class="chat-item-avatar">${avatarContent}</div>
          <div class="chat-item-body">
            <div class="chat-item-top">
              <div class="chat-item-name">${escHtml(name)}</div>
              <div class="chat-item-time">${timeStr}</div>
            </div>
            <div class="chat-item-preview">${escHtml(preview)}</div>
          </div>
          ${hasUnread ? '<div class="chat-item-unread">●</div>' : ''}
        </div>
      `
    };
  }));

  // Sort: pinned first, then by updatedAt (already ordered by Firestore)
  const sorted = [...items].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return 0;
  });

  // Replace existing items
  const list = $('chat-list');
  const empty = $('chat-list-empty');
  list.innerHTML = '';
  list.appendChild(empty);
  empty.style.display = 'none';
  sorted.forEach(item => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = item.html.trim();
    if (wrapper.firstElementChild) list.appendChild(wrapper.firstElementChild);
  });
}

function handleChatItemClick(chatId, type) {
  // On mobile: sidebar slides left, main-area slides in from right
  if (window.innerWidth <= 768) {
    $('sidebar').classList.add('slide-out');
    $('main-area').classList.add('chat-open');
  }
  if (type === 'channel') {
    openChannel(chatId);
  } else {
    openChat(chatId, type);
  }
}

function goBackToList() {
  // Back button — reverse the slide animation
  $('sidebar').classList.remove('slide-out');
  $('main-area').classList.remove('chat-open');
  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
  activeChatId = null;
  activeChatType = null;
  if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }
}

function handleChatItemRightClick(e, chatId, isPinned) {
  e.preventDefault();
  e.stopPropagation();
  // Show pin context menu
  const menu = $('chat-context-menu');
  menu.classList.remove('hidden');
  const maxX = window.innerWidth - 200;
  const maxY = window.innerHeight - 100;
  menu.style.left = Math.min(e.clientX, maxX) + 'px';
  menu.style.top  = Math.min(e.clientY, maxY) + 'px';
  menu.dataset.chatid = chatId;
  menu.dataset.pinned = isPinned ? '1' : '0';
  $('chat-ctx-pin').textContent = isPinned ? '📌 Открепить' : '📌 Закрепить';
}

async function togglePinChat(chatId, currentlyPinned) {
  const userRef = db.collection('users').doc(currentUser.uid);
  if (currentlyPinned) {
    await userRef.update({ pinnedChats: firebase.firestore.FieldValue.arrayRemove(chatId) });
  } else {
    await userRef.update({ pinnedChats: firebase.firestore.FieldValue.arrayUnion(chatId) });
  }
  // Update local profile
  if (!currentProfile.pinnedChats) currentProfile.pinnedChats = [];
  if (currentlyPinned) {
    currentProfile.pinnedChats = currentProfile.pinnedChats.filter(id => id !== chatId);
  } else {
    currentProfile.pinnedChats.push(chatId);
  }
  showToast(currentlyPinned ? 'Чат откреплён' : 'Чат закреплён 📌');
}

// ══════════════════════════════════════════════════════
//  DM — Open or Create
// ══════════════════════════════════════════════════════

async function openOrCreateDM(otherUid) {
  // Check if DM already exists in either direction
  const dmId1 = `${currentUser.uid}_${otherUid}`;
  const dmId2 = `${otherUid}_${currentUser.uid}`;

  let chatId = null;
  const snap1 = await db.collection('chats').doc(dmId1).get();
  const snap2 = await db.collection('chats').doc(dmId2).get();

  if (snap1.exists) { chatId = dmId1; }
  else if (snap2.exists) { chatId = dmId2; }
  else {
    // Create new DM — both users are participants so BOTH see it in their list
    chatId = dmId1;
    await db.collection('chats').doc(chatId).set({
      type: 'dm',
      participants: [currentUser.uid, otherUid],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessage: null
    });
  }

  openChat(chatId, 'dm');
  closeModal('new-chat-modal');
  // Trigger mobile slide-in
  if (window.innerWidth <= 768) {
    $('sidebar').classList.add('slide-out');
    $('main-area').classList.add('chat-open');
  }
}

// ══════════════════════════════════════════════════════
//  OPEN CHAT
// ══════════════════════════════════════════════════════

async function openChat(chatId, type) {
  // Update active item highlight
  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
  const activeEl = $(`chatitem-${chatId}`);
  if (activeEl) activeEl.classList.add('active');

  // Ensure mobile slide is active (covers direct calls not from handleChatItemClick)
  if (window.innerWidth <= 768) {
    $('sidebar').classList.add('slide-out');
    $('main-area').classList.add('chat-open');
  }

  activeChatId = chatId;
  activeChatType = type;

  $('welcome-screen').classList.add('hidden');
  $('channel-view').classList.add('hidden');
  $('chat-view').classList.remove('hidden');

  const chatSnap = await db.collection('chats').doc(chatId).get();
  const chat = chatSnap.data();

  let name = '', photoURL = '', status = '', avatarColor = '';

  if (type === 'dm') {
    const otherId = chat.participants.find(id => id !== currentUser.uid);
    const userSnap = await db.collection('users').doc(otherId).get();
    if (userSnap.exists) {
      const u = userSnap.data();
      name = u.displayName;
      photoURL = u.photoURL;
      avatarColor = u.profileColor || '#5288c1';
      status = '@' + u.username;
    }
  } else if (type === 'favorites') {
    name = chat.name || 'Избранное';
    status = 'Сохранённые сообщения';
    avatarColor = '#f0a500';
    // Inject star emoji as avatar if no photo
    photoURL = '';
  } else if (type === 'group') {
    name = chat.name;
    photoURL = chat.photoURL;
    status = `${chat.participants?.length || 0} участников`;
  }

  $('chat-header-name').textContent = name;
  $('chat-header-status').textContent = status;
  if (type === 'favorites') {
    const av = $('chat-header-avatar');
    av.innerHTML = '<i class="fa-solid fa-star" style="color:#f0a500;font-size:18px"></i>';
    av.style.background = 'rgba(240,165,0,0.15)';
  } else {
    renderAvatar($('chat-header-avatar'), photoURL, name, avatarColor);
  }

  // Subscribe to messages
  if (messagesUnsub) messagesUnsub();
  $('messages-area').innerHTML = '<div class="messages-date-separator"><span>Сегодня</span></div>';

  messagesUnsub = db.collection('chats').doc(chatId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      snap.docChanges().forEach(change => {
        if (change.type === 'added') {
          renderMessage(change.doc.id, change.doc.data());
        } else if (change.type === 'modified') {
          // Update reactions on existing message
          const reactEl = document.querySelector(`[data-msgid="${change.doc.id}"] .msg-reactions`);
          if (reactEl) renderReactions(reactEl, change.doc.data().reactions || {}, change.doc.id, 'msg', null);
        } else if (change.type === 'removed') {
          const el = document.querySelector(`[data-msgid="${change.doc.id}"]`);
          if (el) el.closest('.message-row').remove();
        }
      });
      scrollToBottom();
    });

  // Show/hide group/channel input controls
  const isOwner = type === 'channel' && chat.ownerId === currentUser.uid;
  $('channel-input-area').classList.toggle('hidden', !isOwner);
}

function closeChatView() {
  $('chat-view').classList.add('hidden');
  $('welcome-screen').classList.remove('hidden');
  if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }
  activeChatId = null;
  activeChatType = null;
  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
}

function closeChannelView() {
  $('channel-view').classList.add('hidden');
  $('welcome-screen').classList.remove('hidden');
  if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }
  activeChatId = null;
  activeChatType = null;
  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
}

function scrollToBottom() {
  const area = $('messages-area');
  area.scrollTop = area.scrollHeight;
}

// ══════════════════════════════════════════════════════
//  RENDER MESSAGE
// ══════════════════════════════════════════════════════

async function renderMessage(msgId, msg) {
  if (document.querySelector(`[data-msgid="${msgId}"]`)) return;

  const isOut = msg.senderId === currentUser.uid;
  const row = document.createElement('div');
  row.className = `message-row ${isOut ? 'out' : 'in'}`;

  let senderName = '';
  let senderPhoto = '';
  let senderColor = '#5288c1';

  if (!isOut && activeChatType === 'group') {
    const userSnap = await db.collection('users').doc(msg.senderId).get();
    if (userSnap.exists) {
      const u = userSnap.data();
      senderName = u.displayName;
      senderPhoto = u.photoURL;
      senderColor = u.profileColor || '#5288c1';
    }
  }

  const bubbleInner = await buildMessageContent(msg, isOut, senderName, msgId);

  // In group chats show avatar next to incoming messages
  let avatarHtml = '';
  if (!isOut && activeChatType === 'group') {
    const avatarContent = senderPhoto
      ? `<img src="${senderPhoto}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
      : `<span style="font-size:12px;font-weight:600;color:#fff">${(senderName||'?')[0].toUpperCase()}</span>`;
    avatarHtml = `<div class="msg-avatar" style="background:${senderColor};cursor:pointer" onclick="openUserProfileModal('${msg.senderId}')">${avatarContent}</div>`;
  }

  row.innerHTML = avatarHtml + bubbleInner;

  // Context menu on right-click / long-press
  const bubble = row.querySelector('.message-bubble');
  if (bubble) {
    bubble.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      contextTargetMsg = { id: msgId, ...msg };
      showContextMenu(e.clientX, e.clientY);
    });

    let longPressTimer;
    bubble.addEventListener('touchstart', e => {
      longPressTimer = setTimeout(() => {
        contextTargetMsg = { id: msgId, ...msg };
        showContextMenu(e.touches[0].clientX, e.touches[0].clientY);
      }, 600);
    });
    bubble.addEventListener('touchend', () => clearTimeout(longPressTimer));
  }

  $('messages-area').appendChild(row);

  // Render initial reactions
  const reactEl = row.querySelector('.msg-reactions');
  if (reactEl && msg.reactions) renderReactions(reactEl, msg.reactions, msgId, 'msg', null);
}

async function buildMessageContent(msg, isOut, senderName, msgId) {
  const time = formatMsgTime(msg.createdAt);
  const statusIcon = isOut ? '<i class="fa-solid fa-check-double msg-status"></i>' : '';

  let replyHtml = '';
  if (msg.replyTo) {
    replyHtml = `<div class="msg-reply">
      <div class="msg-reply-sender">${escHtml(msg.replyTo.senderName || '')}</div>
      <div class="msg-reply-text">${escHtml(msg.replyTo.text || '[медиа]')}</div>
    </div>`;
  }

  let nameHtml = senderName ? `<div class="msg-sender-name">${escHtml(senderName)}</div>` : '';

  let contentHtml = '';
  const t = msg.type || 'text';

  if (t === 'text') {
    contentHtml = `<div class="msg-text">${escHtml(msg.text)}</div>`;
  } else if (t === 'image') {
    contentHtml = `<div class="msg-image"><img src="${msg.mediaURL}" alt="Фото" loading="lazy" onclick="openImageViewer('${msg.mediaURL}')"/></div>`;
  } else if (t === 'video') {
    contentHtml = `<div class="msg-video"><video src="${msg.mediaURL}" controls preload="metadata"></video></div>`;
  } else if (t === 'voice') {
    const dur = msg.duration || 0;
    const bars = Array.from({length: 20}, (_, i) =>
      `<div class="voice-waveform-bar" style="height:${4 + Math.random() * 16}px"></div>`
    ).join('');
    contentHtml = `
      <div class="msg-voice">
        <button class="voice-play-btn" onclick="toggleVoicePlay(this,'${msg.mediaURL}')">
          <i class="fa-solid fa-play"></i>
        </button>
        <div class="voice-waveform">${bars}</div>
        <div class="voice-duration">${formatDuration(dur)}</div>
      </div>`;
  } else if (t === 'vidnote') {
    contentHtml = `
      <div class="msg-vidnote-wrap" onclick="toggleVidnotePlay(this)">
        <video src="${msg.mediaURL}" loop playsinline webkit-playsinline preload="metadata"></video>
        <div class="vidnote-play-overlay"><i class="fa-solid fa-play"></i></div>
        <div class="vidnote-ring-outer"></div>
      </div>`;
  } else if (t === 'file') {
    contentHtml = `
      <div class="msg-file">
        <div class="msg-file-icon"><i class="fa-solid fa-file"></i></div>
        <div class="msg-file-info">
          <div class="msg-file-name">${escHtml(msg.fileName || 'Файл')}</div>
          <div class="msg-file-size">${escHtml(msg.fileSize || '')}</div>
        </div>
        <a href="${msg.mediaURL}" download="${escHtml(msg.fileName||'file')}" target="_blank" style="margin-left:auto">
          <i class="fa-solid fa-download" style="color:var(--accent)"></i>
        </a>
      </div>`;
  }

  return `
    <div class="message-bubble" data-msgid="${msgId}">
      ${replyHtml}${nameHtml}${contentHtml}
      <div class="msg-meta">
        <span class="msg-time">${time}</span>
        ${statusIcon}
      </div>
      <div class="msg-reactions" id="reactions-msg-${msgId}"></div>
    </div>`;
}

// ══════════════════════════════════════════════════════
//  SEND MESSAGES
// ══════════════════════════════════════════════════════

async function sendTextMessage() {
  const input = $('message-input');
  const text = input.textContent.trim();
  if (!text || !activeChatId) return;

  input.textContent = '';
  $('send-btn').classList.add('hidden');
  $('voice-btn').classList.remove('hidden');
  $('vidnote-btn').classList.remove('hidden');

  const msgData = {
    senderId: currentUser.uid,
    senderName: currentProfile.displayName,
    type: 'text',
    text,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  if (replyToMsg) {
    msgData.replyTo = {
      msgId: replyToMsg.id,
      text: replyToMsg.text || '',
      senderName: replyToMsg.senderName || '',
    };
    cancelReply();
  }

  await sendMessage(msgData);
}

async function sendMediaFile(file) {
  if (!file || !activeChatId) return;
  $('attach-panel').classList.add('hidden');
  showToast('Загружаем файл...');

  const ext = file.name.split('.').pop();
  const path = `media/${activeChatId}/${generateId()}.${ext}`;
  const url = await uploadFile(path, file);

  let type = 'file';
  if (file.type.startsWith('image/')) type = 'image';
  else if (file.type.startsWith('video/')) type = 'video';

  const msgData = {
    senderId: currentUser.uid,
    senderName: currentProfile.displayName,
    type,
    mediaURL: url,
    fileName: file.name,
    fileSize: formatFileSize(file.size),
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  await sendMessage(msgData);
}

async function sendMessage(msgData) {
  const ref = db.collection('chats').doc(activeChatId);
  // Add message first
  await ref.collection('messages').add(msgData);
  // Update chat doc — this fires the onSnapshot listener for ALL participants
  // including the recipient, making the chat appear instantly in their list
  await ref.update({
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    lastMessage: {
      text: msgData.text || '',
      type: msgData.type,
      senderId: currentUser.uid,
    }
  });
}

async function deleteMessage(msg) {
  if (!activeChatId) return;
  const isOwner = msg.senderId === currentUser.uid;
  const isAdmin = currentProfile.username === ADMIN_USERNAME;
  if (!isOwner && !isAdmin) { showToast('Нет прав для удаления'); return; }

  await db.collection('chats').doc(activeChatId)
    .collection('messages').doc(msg.id).delete();
  showToast('Сообщение удалено');
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ══════════════════════════════════════════════════════
//  REPLY
// ══════════════════════════════════════════════════════

function startReply(msg) {
  replyToMsg = msg;
  $('reply-preview').classList.remove('hidden');
  $('reply-preview-name').textContent = msg.senderName || '';
  $('reply-preview-text').textContent = msg.text || '[медиа]';
  $('message-input').focus();
}

function cancelReply() {
  replyToMsg = null;
  $('reply-preview').classList.add('hidden');
}

// ══════════════════════════════════════════════════════
//  VOICE RECORDING
// ══════════════════════════════════════════════════════

async function startVoiceRecording() {
  if (voiceRecorder) return;
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceChunks = [];
    voiceRecorder = new MediaRecorder(voiceStream);
    voiceRecorder.ondataavailable = e => voiceChunks.push(e.data);
    voiceRecorder.start();

    voiceStartTime = Date.now();
    $('voice-recording-ui').classList.remove('hidden');
    $('input-row').style.display = 'none';

    voiceTimerInt = setInterval(() => {
      const elapsed = Math.floor((Date.now() - voiceStartTime) / 1000);
      $('voice-timer').textContent = formatDuration(elapsed);
    }, 1000);
  } catch(e) {
    showToast('Нет доступа к микрофону');
  }
}

async function stopVoiceRecording() {
  if (!voiceRecorder || voiceRecorder.state === 'inactive') return;
  voiceRecorder.stop();
  clearInterval(voiceTimerInt);
  voiceStream.getTracks().forEach(t => t.stop());

  const duration = Math.floor((Date.now() - voiceStartTime) / 1000);
  $('voice-recording-ui').classList.add('hidden');
  $('input-row').style.display = '';

  voiceRecorder.onstop = async () => {
    if (duration < 1) { voiceRecorder = null; return; }
    const blob = new Blob(voiceChunks, { type: 'audio/webm' });
    const path = `voice/${activeChatId}/${generateId()}.webm`;
    showToast('Отправляем голосовое...');
    const url = await uploadBlob(path, blob, 'audio/webm');
    const msgData = {
      senderId: currentUser.uid,
      senderName: currentProfile.displayName,
      type: 'voice',
      mediaURL: url,
      duration,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    await sendMessage(msgData);
    voiceRecorder = null;
  };
}

function cancelVoiceRecording() {
  if (!voiceRecorder) return;
  voiceRecorder.stop();
  clearInterval(voiceTimerInt);
  if (voiceStream) voiceStream.getTracks().forEach(t => t.stop());
  voiceRecorder = null;
  voiceChunks = [];
  $('voice-recording-ui').classList.add('hidden');
  $('input-row').style.display = '';
}

// ── Voice playback ──
let activeVoiceAudio = null;
function toggleVoicePlay(btn, url) {
  if (activeVoiceAudio && !activeVoiceAudio.paused) {
    activeVoiceAudio.pause();
    activeVoiceAudio = null;
    document.querySelectorAll('.voice-play-btn i').forEach(i => { i.className = 'fa-solid fa-play'; });
    return;
  }
  document.querySelectorAll('.voice-play-btn i').forEach(i => { i.className = 'fa-solid fa-play'; });
  const audio = new Audio(url);
  activeVoiceAudio = audio;
  const icon = btn.querySelector('i');
  icon.className = 'fa-solid fa-pause';
  audio.play();
  audio.onended = () => { icon.className = 'fa-solid fa-play'; activeVoiceAudio = null; };
}

// ── Video note playback ──
function toggleVidnotePlay(wrap) {
  const video = wrap.querySelector('video');
  const overlay = wrap.querySelector('.vidnote-play-overlay');
  if (video.paused) {
    video.play();
    video.muted = false;
    wrap.classList.add('playing');
  } else {
    video.pause();
    wrap.classList.remove('playing');
  }
}

// ══════════════════════════════════════════════════════
//  VIDEO NOTE RECORDER
// ══════════════════════════════════════════════════════

async function openVidnoteRecorder() {
  if (!activeChatId) return;
  try {
    vidnoteStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    $('vidnote-preview').srcObject = vidnoteStream;
    $('vidnote-overlay').classList.remove('hidden');
    $('vidnote-record-btn').innerHTML = '<i class="fa-solid fa-circle"></i>';
    $('vidnote-record-btn').classList.remove('recording');
    $('vidnote-send-btn').classList.add('hidden');
    $('vidnote-timer').textContent = '0:00';
  } catch(e) {
    showToast('Нет доступа к камере');
  }
}

function closeVidnoteRecorder() {
  if (vidnoteRecorder && vidnoteRecorder.state === 'recording') {
    vidnoteRecorder.stop();
  }
  if (vidnoteStream) {
    vidnoteStream.getTracks().forEach(t => t.stop());
    vidnoteStream = null;
  }
  clearInterval(vidnoteTimerInt);
  vidnoteRecorder = null;
  vidnoteChunks = [];
  vidnoteBlob = null;
  $('vidnote-overlay').classList.add('hidden');
  resetVidnoteCircle();
}

function resetVidnoteCircle() {
  const circle = $('vidnote-circle');
  if (circle) circle.style.strokeDashoffset = '339.3';
}

function toggleVidnoteRecording() {
  if (!vidnoteRecorder || vidnoteRecorder.state === 'inactive') {
    startVidnoteRecording();
  } else {
    stopVidnoteRecording();
  }
}

function startVidnoteRecording() {
  vidnoteChunks = [];
  vidnoteRecorder = new MediaRecorder(vidnoteStream, { mimeType: getSupportedVideoMime() });
  vidnoteRecorder.ondataavailable = e => { if (e.data.size > 0) vidnoteChunks.push(e.data); };
  vidnoteRecorder.onstop = () => {
    vidnoteBlob = new Blob(vidnoteChunks, { type: getSupportedVideoMime() });
  };
  vidnoteRecorder.start(100);

  vidnoteStartTime = Date.now();
  $('vidnote-record-btn').innerHTML = '<i class="fa-solid fa-stop"></i>';
  $('vidnote-record-btn').classList.add('recording');
  $('vidnote-send-btn').classList.add('hidden');

  const totalDash = 339.3;
  const circle = $('vidnote-circle');

  vidnoteTimerInt = setInterval(() => {
    const elapsed = (Date.now() - vidnoteStartTime) / 1000;
    $('vidnote-timer').textContent = formatDuration(Math.floor(elapsed));
    const progress = Math.min(elapsed / VIDNOTE_MAX, 1);
    circle.style.strokeDashoffset = totalDash * (1 - progress);

    if (elapsed >= VIDNOTE_MAX) stopVidnoteRecording();
  }, 100);
}

function stopVidnoteRecording() {
  if (!vidnoteRecorder || vidnoteRecorder.state !== 'recording') return;
  vidnoteRecorder.stop();
  clearInterval(vidnoteTimerInt);
  $('vidnote-record-btn').innerHTML = '<i class="fa-solid fa-redo"></i>';
  $('vidnote-record-btn').classList.remove('recording');
  $('vidnote-send-btn').classList.remove('hidden');
}

async function sendVidnote() {
  if (!vidnoteBlob || !activeChatId) return;
  showToast('Отправляем кружок...');
  const mime = getSupportedVideoMime();
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  const path = `vidnotes/${activeChatId}/${generateId()}.${ext}`;
  const url = await uploadBlob(path, vidnoteBlob, mime);
  const msgData = {
    senderId: currentUser.uid,
    senderName: currentProfile.displayName,
    type: 'vidnote',
    mediaURL: url,
    duration: Math.floor((Date.now() - vidnoteStartTime) / 1000),
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  await sendMessage(msgData);
  closeVidnoteRecorder();
}

function getSupportedVideoMime() {
  const types = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
}

// ══════════════════════════════════════════════════════
//  CHANNELS
// ══════════════════════════════════════════════════════

async function createChannel() {
  const name     = $('channel-name-input').value.trim();
  const isPublic = $('channel-public-toggle').checked;
  const username = $('channel-username-input').value.trim().toLowerCase();

  if (!name) { showModalError('create-channel-error', 'Введите название'); return; }
  if (isPublic && !username) { showModalError('create-channel-error', 'Введите @username канала'); return; }
  if (isPublic && !/^[a-z0-9_]{3,32}$/.test(username)) {
    showModalError('create-channel-error', 'Некорректный username'); return;
  }

  if (isPublic) {
    const snap = await db.collection('channels').where('username', '==', username).get();
    if (!snap.empty) { showModalError('create-channel-error', 'Username уже занят'); return; }
  }

  $('create-channel-btn').textContent = 'Создаём...';
  try {
    let photoURL = '';
    const avatarFile = $('channel-avatar-input').files[0];
    const chanId = generateId();
    if (avatarFile) photoURL = await uploadFile(`channel-avatars/${chanId}`, avatarFile);

    const inviteLink = generateId(16);
    const chanData = {
      id: chanId, name, ownerId: currentUser.uid,
      username: isPublic ? username : '',
      isPublic, photoURL,
      inviteLink,
      commentsEnabled: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      subscribersCount: 1,
    };
    await db.collection('channels').doc(chanId).set(chanData);
    // Add as a chat entry so it appears in sidebar
    await db.collection('chats').doc(chanId).set({
      type: 'channel',
      name, photoURL,
      ownerId: currentUser.uid,
      participants: [currentUser.uid],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessage: null,
    });

    closeModal('create-channel-modal');
    showToast('Канал создан!');
    openChannel(chanId);
  } catch(e) {
    showModalError('create-channel-error', e.message);
  } finally {
    $('create-channel-btn').textContent = 'Создать канал';
  }
}

async function openChannel(channelId) {
  if (window.innerWidth <= 768) {
    $('sidebar').classList.add('slide-out');
    $('main-area').classList.add('chat-open');
  }

  activeChatId = channelId;
  activeChatType = 'channel';

  $('welcome-screen').classList.add('hidden');
  $('chat-view').classList.add('hidden');
  $('channel-view').classList.remove('hidden');

  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
  const activeEl = $(`chatitem-${channelId}`);
  if (activeEl) activeEl.classList.add('active');

  const chanSnap = await db.collection('channels').doc(channelId).get();
  const chan     = chanSnap.exists ? chanSnap.data() : null;
  const chatSnap = await db.collection('chats').doc(channelId).get();
  const chat     = chatSnap.exists ? chatSnap.data() : {};

  const name      = chan?.name || chat?.name || 'Канал';
  const photoURL  = chan?.photoURL || chat?.photoURL || '';
  const isOwner   = chan?.ownerId === currentUser.uid || chat?.ownerId === currentUser.uid;
  const admins    = chan?.admins || [];
  const isAdmin   = admins.includes(currentUser.uid);
  const canPost   = isOwner || isAdmin;
  const participants = chat?.participants || [];
  const isSubscribed = participants.includes(currentUser.uid);
  const subCount  = participants.length;

  $('channel-header-name').textContent = name;
  $('channel-header-status').textContent = `${subCount} подписчиков`;
  renderAvatar($('channel-header-avatar'), photoURL, name, '#5288c1');

  // Members btn — only for owner/admin
  const membersBtn = $('channel-members-btn');
  if (membersBtn) membersBtn.classList.toggle('hidden', !canPost);

  // Input area — only for owner/admin
  $('channel-input-area').classList.toggle('hidden', !canPost);

  // Subscribe bar — show for non-subscribers who are not owner/admin
  const subBar = $('channel-subscribe-bar');
  if (subBar) {
    if (!isSubscribed && !canPost) {
      subBar.classList.remove('hidden');
      $('channel-subscribe-btn').onclick = () => subscribeToChannel(channelId);
    } else {
      subBar.classList.add('hidden');
    }
  }

  $('channel-view').dataset.channelId  = channelId;
  $('channel-view').dataset.isOwner    = isOwner ? '1' : '0';
  $('channel-view').dataset.canPost    = canPost ? '1' : '0';
  $('channel-view').dataset.commentsOn = chan?.commentsEnabled ? '1' : '0';

  // Subscribe to posts
  if (messagesUnsub) messagesUnsub();
  $('channel-posts-area').innerHTML = '';

  messagesUnsub = db.collection('channels').doc(channelId)
    .collection('posts')
    .orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      snap.docChanges().forEach(change => {
        if (change.type === 'added') {
          renderChannelPost(change.doc.id, change.doc.data(), chan?.commentsEnabled, canPost);
        }
        if (change.type === 'modified') {
          // Update reactions in existing post
          const el = document.querySelector(`[data-postid="${change.doc.id}"]`);
          if (el) {
            const reactionsEl = el.querySelector('.post-reactions');
            if (reactionsEl) renderReactions(reactionsEl, change.doc.data().reactions || {}, change.doc.id, 'post', channelId);
          }
        }
        if (change.type === 'removed') {
          const el = document.querySelector(`[data-postid="${change.doc.id}"]`);
          if (el) el.remove();
        }
      });
      $('channel-posts-area').scrollTop = $('channel-posts-area').scrollHeight;
    });

  // Add to chat list if subscribed but not yet participant
  if (isSubscribed && !chatSnap.exists) {
    await db.collection('chats').doc(channelId).set({
      type: 'channel', name, photoURL,
      ownerId: chan?.ownerId || currentUser.uid,
      participants: [currentUser.uid],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessage: null,
    });
  }
}

async function subscribeToChannel(channelId) {
  const chanSnap = await db.collection('channels').doc(channelId).get();
  const chan = chanSnap.data() || {};

  // Add to chats collection so it appears in their sidebar via onSnapshot
  await db.collection('chats').doc(channelId).set({
    type: 'channel',
    name: chan.name || 'Канал',
    photoURL: chan.photoURL || '',
    ownerId: chan.ownerId || '',
    participants: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    lastMessage: null,
  }, { merge: true });

  await db.collection('channels').doc(channelId).update({
    subscribersCount: firebase.firestore.FieldValue.increment(1),
  });

  showToast('Вы подписались на канал!');
  $('channel-subscribe-bar').classList.add('hidden');
  $('channel-input-area').classList.add('hidden'); // still read-only
}

function renderChannelPost(postId, post, commentsEnabled, canPost) {
  if (document.querySelector(`[data-postid="${postId}"]`)) return;
  const channelId = $('channel-view').dataset.channelId;
  const area = $('channel-posts-area');
  const el = document.createElement('div');
  el.className = 'channel-post';
  el.dataset.postid = postId;

  let contentHtml = '';
  if (post.type === 'image') {
    contentHtml = `<div class="msg-image" style="margin-bottom:8px"><img src="${post.mediaURL}" loading="lazy" onclick="openImageViewer('${post.mediaURL}')"/></div>`;
    if (post.text) contentHtml += `<div class="post-text">${escHtml(post.text)}</div>`;
  } else {
    contentHtml = `<div class="post-text">${escHtml(post.text || '')}</div>`;
  }

  const canDelete = canPost || currentProfile.username === ADMIN_USERNAME;
  const deleteBtn = canDelete
    ? `<button class="post-delete-btn" onclick="deleteChannelPost('${postId}')" title="Удалить"><i class="fa-solid fa-trash"></i></button>` : '';

  const commentCount = post.commentCount || 0;
  const commentsBtn = commentsEnabled
    ? `<button class="post-comments-btn" onclick="openComments('${postId}','${channelId}')">
         <i class="fa-regular fa-comment"></i> ${commentCount > 0 ? commentCount : 'Комментарии'}
       </button>` : '';

  el.innerHTML = `
    ${contentHtml}
    <div class="post-reactions" id="reactions-post-${postId}"></div>
    <div class="post-meta">
      <span class="post-time">${formatMsgTime(post.createdAt)}</span>
      <div style="display:flex;align-items:center;gap:6px">
        <button class="post-react-btn" onclick="showReactionPicker('${postId}','post','${channelId}')" title="Реакция">
          <i class="fa-regular fa-face-smile"></i>
        </button>
        ${commentsBtn}
        ${deleteBtn}
      </div>
    </div>
  `;

  area.appendChild(el);

  // Render initial reactions
  const reactionsEl = el.querySelector('.post-reactions');
  renderReactions(reactionsEl, post.reactions || {}, postId, 'post', channelId);
}

// ── Reactions ──────────────────────────────────────
const EMOJI_LIST = ['👍','❤️','😂','😮','😢','🔥','👏','🎉'];

function showReactionPicker(targetId, targetType, channelId) {
  // Remove any existing picker
  document.querySelectorAll('.reaction-picker').forEach(p => p.remove());

  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  picker.innerHTML = EMOJI_LIST.map(e =>
    `<button class="reaction-emoji-btn" onclick="addReaction('${targetId}','${targetType}','${channelId}','${e}');this.closest('.reaction-picker').remove()">${e}</button>`
  ).join('');

  // Position near the button
  const btn = document.querySelector(`[onclick*="showReactionPicker('${targetId}'"]`);
  if (btn) {
    const rect = btn.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    picker.style.left = Math.max(8, rect.left - 60) + 'px';
  }

  document.body.appendChild(picker);
  setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 50);
}

async function addReaction(targetId, targetType, channelId, emoji) {
  const uid = currentUser.uid;
  let ref;
  if (targetType === 'post') {
    ref = db.collection('channels').doc(channelId).collection('posts').doc(targetId);
  } else {
    ref = db.collection('chats').doc(activeChatId).collection('messages').doc(targetId);
  }

  const snap = await ref.get();
  const reactions = snap.data()?.reactions || {};
  const users = reactions[emoji] || [];

  if (users.includes(uid)) {
    // Toggle off
    reactions[emoji] = users.filter(u => u !== uid);
    if (reactions[emoji].length === 0) delete reactions[emoji];
  } else {
    reactions[emoji] = [...users, uid];
  }

  await ref.update({ reactions });
}

function renderReactions(container, reactions, targetId, targetType, channelId) {
  if (!container) return;
  container.innerHTML = '';
  if (!reactions || !Object.keys(reactions).length) return;

  Object.entries(reactions).forEach(([emoji, users]) => {
    if (!users.length) return;
    const isMe = users.includes(currentUser.uid);
    const btn = document.createElement('button');
    btn.className = `reaction-chip${isMe ? ' me' : ''}`;
    btn.textContent = `${emoji} ${users.length}`;
    btn.onclick = () => addReaction(targetId, targetType, channelId || activeChatId, emoji);
    container.appendChild(btn);
  });
}

// ── Comments thread ────────────────────────────────
let commentsUnsub = null;

function openComments(postId, channelId) {
  const modal = $('comments-modal');
  modal.dataset.postId    = postId;
  modal.dataset.channelId = channelId;
  openModal('comments-modal');

  const list = $('comments-list');
  list.innerHTML = '<div style="padding:12px;color:var(--text-secondary);font-size:13px">Загружаем...</div>';

  if (commentsUnsub) { commentsUnsub(); commentsUnsub = null; }

  commentsUnsub = db.collection('channels').doc(channelId)
    .collection('posts').doc(postId)
    .collection('comments')
    .orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      list.innerHTML = '';
      if (snap.empty) {
        list.innerHTML = '<div style="padding:16px;color:var(--text-secondary);font-size:13px;text-align:center">Комментариев пока нет</div>';
        return;
      }
      snap.forEach(doc => renderComment(doc.id, doc.data()));
      list.scrollTop = list.scrollHeight;
    });
}

function renderComment(commentId, comment) {
  const list = $('comments-list');
  if (document.querySelector(`[data-comment-id="${commentId}"]`)) return;
  const isMe = comment.senderId === currentUser.uid;
  const avatarBg = comment.senderColor || '#5288c1';
  const avatarContent = comment.senderPhoto
    ? `<img src="${comment.senderPhoto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
    : `<span style="color:#fff;font-weight:600;font-size:11px">${(comment.senderName||'?')[0].toUpperCase()}</span>`;

  const el = document.createElement('div');
  el.className = 'comment-item';
  el.dataset.commentId = commentId;
  el.innerHTML = `
    <div style="width:32px;height:32px;border-radius:50%;background:${avatarBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;cursor:pointer"
         onclick="openUserProfileModal('${comment.senderId}')">${avatarContent}</div>
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:3px">
        <span style="font-size:13px;font-weight:600;color:${isMe ? 'var(--accent)' : 'var(--text-primary)'}">${escHtml(comment.senderName||'—')}</span>
        <span style="font-size:11px;color:var(--text-muted)">${formatMsgTime(comment.createdAt)}</span>
      </div>
      <div style="font-size:14px;line-height:1.4;word-break:break-word">${escHtml(comment.text)}</div>
    </div>
  `;
  list.appendChild(el);
}

async function sendComment() {
  const modal  = $('comments-modal');
  const input  = $('comment-input');
  const text   = input.textContent.trim();
  const postId    = modal.dataset.postId;
  const channelId = modal.dataset.channelId;
  if (!text || !postId || !channelId) return;

  input.textContent = '';

  const commentData = {
    senderId:    currentUser.uid,
    senderName:  currentProfile.displayName,
    senderPhoto: currentProfile.photoURL || '',
    senderColor: currentProfile.profileColor || '#5288c1',
    text,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('channels').doc(channelId)
    .collection('posts').doc(postId)
    .collection('comments').add(commentData);

  // Increment comment count on post
  await db.collection('channels').doc(channelId)
    .collection('posts').doc(postId)
    .update({ commentCount: firebase.firestore.FieldValue.increment(1) });
}

async function deleteChannelPost(postId) {
  if (!activeChatId) return;
  if (!confirm('Удалить пост?')) return;
  await db.collection('channels').doc(activeChatId).collection('posts').doc(postId).delete();
  showToast('Пост удалён');
}

// ── Channel Members Modal ─────────────────────────
async function openChannelMembers() {
  const channelId = $('channel-view').dataset.channelId;
  if (!channelId) return;

  openModal('channel-members-modal');
  const list = $('channel-members-list');
  list.innerHTML = '<div style="padding:12px;color:var(--text-secondary);font-size:13px">Загружаем...</div>';

  const chatSnap = await db.collection('chats').doc(channelId).get();
  const chanSnap = await db.collection('channels').doc(channelId).get();
  const participants = chatSnap.data()?.participants || [];
  const admins = chanSnap.data()?.admins || [];
  const ownerId = chanSnap.data()?.ownerId || chatSnap.data()?.ownerId;
  const isOwner = ownerId === currentUser.uid;

  list.innerHTML = '';
  if (!participants.length) {
    list.innerHTML = '<div style="padding:12px;color:var(--text-secondary);font-size:13px">Нет участников</div>';
    return;
  }

  const userSnaps = await Promise.all(participants.map(uid => db.collection('users').doc(uid).get()));

  userSnaps.forEach(snap => {
    if (!snap.exists) return;
    const u = snap.data();
    const uid = snap.id;
    const isAdmin = admins.includes(uid);
    const isThisOwner = uid === ownerId;
    const avatarBg = u.profileColor || '#5288c1';
    const avatarContent = u.photoURL
      ? `<img src="${u.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
      : `<span style="color:#fff;font-weight:600;font-size:14px">${(u.displayName||'?')[0].toUpperCase()}</span>`;

    let roleBadge = '';
    if (isThisOwner) roleBadge = '<span class="member-role owner">Владелец</span>';
    else if (isAdmin) roleBadge = '<span class="member-role admin">Админ</span>';

    // Three-dot menu only for owner managing non-owner members
    const menuBtn = (isOwner && !isThisOwner)
      ? `<button class="icon-btn member-menu-btn" onclick="openMemberMenu(event,'${uid}','${channelId}',${isAdmin})">
           <i class="fa-solid fa-ellipsis-vertical"></i>
         </button>`
      : '';

    const item = document.createElement('div');
    item.className = 'member-item';
    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer"
           onclick="openUserProfileModal('${uid}')">
        <div style="width:42px;height:42px;border-radius:50%;background:${avatarBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">${avatarContent}</div>
        <div style="min-width:0">
          <div style="font-size:14px;font-weight:500;display:flex;align-items:center;gap:6px">
            ${escHtml(u.displayName||'—')} ${roleBadge}
          </div>
          <div style="font-size:12px;color:var(--text-secondary)">@${escHtml(u.username||'—')}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:4px">
        ${uid !== currentUser.uid ? `<button class="icon-btn" onclick="openOrCreateDM('${uid}');closeModal('channel-members-modal')" title="Написать"><i class="fa-solid fa-comment" style="font-size:14px;color:var(--accent)"></i></button>` : ''}
        ${menuBtn}
      </div>
    `;
    list.appendChild(item);
  });
}

// Three-dot member menu (make admin / remove)
function openMemberMenu(event, uid, channelId, isAdmin) {
  event.stopPropagation();
  // Remove existing popup
  document.querySelectorAll('.member-popup').forEach(p => p.remove());

  const popup = document.createElement('div');
  popup.className = 'member-popup context-menu';
  popup.innerHTML = `
    <button class="ctx-item" onclick="toggleChannelAdmin('${uid}','${channelId}',${isAdmin})">
      <i class="fa-solid fa-shield-halved"></i>
      ${isAdmin ? 'Снять администратора' : 'Сделать администратором'}
    </button>
    <button class="ctx-item ctx-delete" onclick="removeChannelMember('${uid}','${channelId}')">
      <i class="fa-solid fa-user-minus"></i> Удалить из канала
    </button>
  `;

  const rect = event.currentTarget.getBoundingClientRect();
  popup.style.position = 'fixed';
  popup.style.top  = rect.bottom + 4 + 'px';
  popup.style.right = (window.innerWidth - rect.right) + 'px';
  popup.style.left = 'auto';
  popup.style.zIndex = '600';
  document.body.appendChild(popup);

  setTimeout(() => document.addEventListener('click', () => popup.remove(), { once: true }), 10);
}

async function toggleChannelAdmin(uid, channelId, isAdmin) {
  document.querySelectorAll('.member-popup').forEach(p => p.remove());
  const ref = db.collection('channels').doc(channelId);
  if (isAdmin) {
    await ref.update({ admins: firebase.firestore.FieldValue.arrayRemove(uid) });
    showToast('Права администратора сняты');
  } else {
    await ref.update({ admins: firebase.firestore.FieldValue.arrayUnion(uid) });
    showToast('Пользователь назначен администратором');
  }
  openChannelMembers(); // refresh
}

async function removeChannelMember(uid, channelId) {
  document.querySelectorAll('.member-popup').forEach(p => p.remove());
  if (!confirm('Удалить участника из канала?')) return;
  await db.collection('chats').doc(channelId).update({
    participants: firebase.firestore.FieldValue.arrayRemove(uid)
  });
  await db.collection('channels').doc(channelId).update({
    subscribersCount: firebase.firestore.FieldValue.increment(-1)
  });
  showToast('Участник удалён');
  openChannelMembers(); // refresh
}

async function sendChannelPost() {
  const input = $('channel-post-input');
  const text = input.textContent.trim();
  if (!text || !activeChatId) return;
  input.textContent = '';

  const postData = {
    ownerId: currentUser.uid,
    type: 'text', text,
    views: 0,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  await db.collection('channels').doc(activeChatId).collection('posts').add(postData);
  await db.collection('chats').doc(activeChatId).update({
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    lastMessage: { text, type: 'text', senderId: currentUser.uid }
  });
}

// ══════════════════════════════════════════════════════
//  CHANNEL MEMBERS
// ══════════════════════════════════════════════════════

async function openChannelMembers() {
  const channelId = $('channel-view').dataset.channelId;
  const isOwner   = $('channel-view').dataset.isOwner === '1';
  if (!channelId) return;

  openModal('channel-members-modal');
  $('channel-members-list').innerHTML = '<div style="color:var(--text-secondary);padding:12px;font-size:13px">Загружаем...</div>';

  // Get participants from chat doc
  const chatSnap = await db.collection('chats').doc(channelId).get();
  const chat = chatSnap.data() || {};
  const participants = chat.participants || [];

  // Get channel admins list
  const chanSnap = await db.collection('channels').doc(channelId).get();
  const chan = chanSnap.data() || {};
  const admins = chan.admins || [];

  // Load user profiles
  const userProfiles = await Promise.all(
    participants.map(uid => db.collection('users').doc(uid).get())
  );

  const list = $('channel-members-list');
  list.innerHTML = '';

  userProfiles.forEach(doc => {
    if (!doc.exists) return;
    const u = doc.data();
    const isChannelOwner = u.uid === chan.ownerId;
    const isAdminMember  = admins.includes(u.uid);
    const isSelf         = u.uid === currentUser.uid;

    const avatarContent = u.photoURL
      ? `<img src="${u.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt=""/>`
      : `<span style="color:#fff;font-weight:600;font-size:14px">${(u.displayName||'?')[0].toUpperCase()}</span>`;

    const badge = isChannelOwner
      ? `<span class="member-badge owner">Владелец</span>`
      : isAdminMember
        ? `<span class="member-badge admin-badge">Админ</span>`
        : '';

    // Three-dot menu for owner (not on themselves)
    const menuBtn = isOwner && !isChannelOwner && !isSelf
      ? `<button class="icon-btn member-menu-btn" onclick="openMemberMenu(event,'${u.uid}','${escHtml(u.displayName)}','${channelId}',${isAdminMember})">
           <i class="fa-solid fa-ellipsis-vertical"></i>
         </button>`
      : '';

    const item = document.createElement('div');
    item.className = 'channel-member-item';
    item.innerHTML = `
      <div class="member-avatar" style="background:${u.profileColor||'#5288c1'};cursor:pointer"
           onclick="openUserProfileModal('${u.uid}')">${avatarContent}</div>
      <div class="member-info" style="cursor:pointer" onclick="openUserProfileModal('${u.uid}')">
        <div class="member-name">${escHtml(u.displayName||'—')} ${badge}</div>
        <div class="member-un">@${escHtml(u.username||'—')}</div>
      </div>
      <div style="display:flex;align-items:center;gap:4px">
        ${!isSelf && !isChannelOwner ? `<button class="icon-btn" title="Написать" onclick="openOrCreateDM('${u.uid}');closeModal('channel-members-modal')">
          <i class="fa-solid fa-comment" style="font-size:14px;color:var(--accent)"></i>
        </button>` : ''}
        ${menuBtn}
      </div>
    `;
    list.appendChild(item);
  });
}

// Member context menu (make admin / remove admin / kick)
let memberMenuTarget = null;
function openMemberMenu(e, uid, name, channelId, isAdmin) {
  e.stopPropagation();
  memberMenuTarget = { uid, name, channelId, isAdmin };

  // Build a small dropdown next to the button
  const existing = $('member-ctx-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'member-ctx-menu';
  menu.className = 'context-menu';
  menu.style.position = 'fixed';
  menu.style.zIndex = '600';

  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.top  = rect.bottom + 4 + 'px';
  menu.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';

  menu.innerHTML = `
    <button class="ctx-item" onclick="memberToggleAdmin('${uid}','${channelId}',${isAdmin})">
      <i class="fa-solid fa-${isAdmin ? 'user-minus' : 'user-shield'}"></i>
      ${isAdmin ? 'Снять админа' : 'Сделать админом'}
    </button>
    <button class="ctx-item" onclick="openOrCreateDM('${uid}');closeModal('channel-members-modal');removeMemberCtxMenu()">
      <i class="fa-solid fa-comment"></i> Написать
    </button>
    <button class="ctx-item ctx-delete" onclick="memberKick('${uid}','${channelId}')">
      <i class="fa-solid fa-user-xmark"></i> Исключить
    </button>
  `;

  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', removeMemberCtxMenu, { once: true }), 10);
}

function removeMemberCtxMenu() {
  const m = $('member-ctx-menu');
  if (m) m.remove();
}

async function memberToggleAdmin(uid, channelId, currentlyAdmin) {
  removeMemberCtxMenu();
  const field = firebase.firestore.FieldValue;
  await db.collection('channels').doc(channelId).update({
    admins: currentlyAdmin ? field.arrayRemove(uid) : field.arrayUnion(uid)
  });
  showToast(currentlyAdmin ? 'Права администратора сняты' : 'Пользователь стал администратором');
  openChannelMembers(); // refresh
}

async function memberKick(uid, channelId) {
  removeMemberCtxMenu();
  await db.collection('chats').doc(channelId).update({
    participants: firebase.firestore.FieldValue.arrayRemove(uid)
  });
  await db.collection('channels').doc(channelId).update({
    subscribersCount: firebase.firestore.FieldValue.increment(-1)
  });
  showToast('Пользователь исключён из канала');
  openChannelMembers(); // refresh
}

async function createGroup() {
  const name = $('group-name-input').value.trim();
  if (!name) { showModalError('create-group-error', 'Введите название группы'); return; }

  $('create-group-btn').textContent = 'Создаём...';
  try {
    let photoURL = '';
    const avatarFile = $('group-avatar-input').files[0];
    const groupId = generateId();

    if (avatarFile) photoURL = await uploadFile(`group-avatars/${groupId}`, avatarFile);

    const inviteLink = generateId(16);
    const groupData = {
      id: groupId, name, ownerId: currentUser.uid,
      photoURL, inviteLink,
      participants: [currentUser.uid],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessage: null,
      type: 'group',
    };
    await db.collection('chats').doc(groupId).set(groupData);

    closeModal('create-group-modal');
    showToast(`Группа "${name}" создана!\nСсылка: ${location.origin}${location.pathname}?join=${inviteLink}`);
    openChat(groupId, 'group');
  } catch(e) {
    showModalError('create-group-error', e.message);
  } finally {
    $('create-group-btn').textContent = 'Создать группу';
  }
}

// Handle invite links on page load
async function handleInviteLink() {
  const params = new URLSearchParams(location.search);
  const joinCode = params.get('join');
  if (!joinCode || !currentUser) return;

  // Find group with this invite link
  const snap = await db.collection('chats')
    .where('inviteLink', '==', joinCode)
    .where('type', '==', 'group')
    .limit(1).get();

  if (snap.empty) { showToast('Ссылка недействительна'); return; }
  const doc = snap.docs[0];
  const group = doc.data();

  if (!group.participants.includes(currentUser.uid)) {
    await db.collection('chats').doc(doc.id).update({
      participants: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
    });
    showToast(`Вы вступили в группу "${group.name}"`);
  }
  // Clean URL
  history.replaceState({}, '', location.pathname);
  openChat(doc.id, 'group');
}

// ══════════════════════════════════════════════════════
//  USER PROFILE
// ══════════════════════════════════════════════════════

async function openUserProfileModal(uid) {
  if (!uid) return;
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return;
  const u = snap.data();

  $('profile-modal').dataset.uid = uid;

  // Banner — use uploaded image OR solid color gradient as background
  const banner = $('profile-banner-view');
  const profileColor = u.profileColor || '#5288c1';
  if (u.bannerURL) {
    banner.style.backgroundImage = `url(${u.bannerURL})`;
    banner.style.background = '';
  } else {
    banner.style.backgroundImage = '';
    // Rich gradient using their chosen profile color
    banner.style.background = `linear-gradient(135deg, ${profileColor}cc 0%, ${profileColor}44 50%, #0e1621 100%)`;
  }

  // Avatar with color ring
  const avatarEl = $('profile-avatar-view');
  renderAvatar(avatarEl, u.photoURL, u.displayName, profileColor);
  avatarEl.style.setProperty('--profile-accent', profileColor);
  if (u.photoURL) {
    avatarEl.classList.add('has-color');
  } else {
    avatarEl.classList.remove('has-color');
    // Color background on avatar letter
    avatarEl.style.background = profileColor;
    avatarEl.style.color = '#fff';
  }

  $('profile-name-view').textContent = u.displayName || '';
  $('profile-username-view').textContent = '@' + (u.username || '');
  $('profile-bio-view').textContent = u.bio || '';
  // Hide bio if empty
  $('profile-bio-view').style.display = u.bio ? '' : 'none';

  // Song player
  if (u.songURL) {
    $('profile-song-player').classList.remove('hidden');
    $('song-title-view').textContent = u.songName || 'Любимая песня';
    $('profile-audio-player').src = u.songURL;
    $('song-progress-fill').style.width = '0%';
    $('song-play-btn').innerHTML = '<i class="fa-solid fa-play"></i>';
  } else {
    $('profile-song-player').classList.add('hidden');
  }

  // Hide message button for own profile
  $('profile-actions-view').style.display = uid === currentUser.uid ? 'none' : '';

  openModal('profile-modal');
}

// Song toggle
let songPlaying = false;
function toggleSongPlay() {
  const audio = $('profile-audio-player');
  const btn = $('song-play-btn');
  if (audio.paused) {
    audio.play();
    btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    songPlaying = true;
    audio.ontimeupdate = () => {
      if (audio.duration) {
        const pct = (audio.currentTime / audio.duration) * 100;
        $('song-progress-fill').style.width = pct + '%';
      }
    };
    audio.onended = () => {
      btn.innerHTML = '<i class="fa-solid fa-play"></i>';
      $('song-progress-fill').style.width = '0%';
    };
  } else {
    audio.pause();
    btn.innerHTML = '<i class="fa-solid fa-play"></i>';
  }
}

// ══════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════

function openSettingsModal() {
  if (!currentProfile) return;
  $('settings-name').value = currentProfile.displayName || '';
  $('settings-username').value = currentProfile.username || '';
  $('settings-bio').value = currentProfile.bio || '';
  $('settings-color').value = currentProfile.profileColor || '#5288c1';

  renderAvatar($('settings-avatar-preview'), currentProfile.photoURL, currentProfile.displayName, currentProfile.profileColor);
  $('settings-avatar-preview').classList.add('large');

  if (currentProfile.bannerURL) {
    $('settings-banner-preview').style.backgroundImage = `url(${currentProfile.bannerURL})`;
    $('settings-banner-preview').classList.remove('hidden');
  } else {
    $('settings-banner-preview').classList.add('hidden');
  }

  if (currentProfile.songURL) {
    $('settings-song-name').textContent = '🎵 ' + (currentProfile.songName || 'Загружено');
    $('settings-song-name').classList.remove('hidden');
  }

  openModal('settings-modal');
}

function setupSettingsAvatarPreview() {
  $('settings-avatar-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      $('settings-avatar-preview').innerHTML = `<img src="${ev.target.result}" alt=""/>`;
    };
    reader.readAsDataURL(file);
  });
}

function setupSettingsBannerPreview() {
  $('settings-banner-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      $('settings-banner-preview').style.backgroundImage = `url(${ev.target.result})`;
      $('settings-banner-preview').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });
}

function setupSettingsSongPreview() {
  $('settings-song-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    $('settings-song-name').textContent = '🎵 ' + file.name;
    $('settings-song-name').classList.remove('hidden');
  });
}

function setupSettingsUsernameCheck() {
  let timer;
  $('settings-username').addEventListener('input', () => {
    clearTimeout(timer);
    const val = $('settings-username').value.trim().toLowerCase();
    const icon = $('settings-username-check');
    icon.textContent = ''; icon.className = 'username-check';
    if (val === currentProfile.username) { icon.textContent = '✓'; icon.className = 'username-check ok'; return; }
    timer = setTimeout(() => checkUsernameAvailable(val, icon), 600);
  });
}

async function saveSettings() {
  const name     = $('settings-name').value.trim();
  const username = $('settings-username').value.trim().toLowerCase();
  const bio      = $('settings-bio').value.trim();
  const color    = $('settings-color').value;

  if (!name) { showModalError('settings-error', 'Введите имя'); return; }
  if (!username || !/^[a-z0-9_]{3,32}$/.test(username)) {
    showModalError('settings-error', 'Некорректный username'); return;
  }

  // Check username uniqueness if changed
  if (username !== currentProfile.username) {
    const snap = await db.collection('users').where('username', '==', username).get();
    if (!snap.empty && snap.docs[0].id !== currentUser.uid) {
      showModalError('settings-error', 'Username уже занят'); return;
    }
  }

  $('settings-save-btn').textContent = 'Сохраняем...';
  try {
    const updates = { displayName: name, username, bio, profileColor: color };

    // Avatar
    const avatarFile = $('settings-avatar-input').files[0];
    if (avatarFile) updates.photoURL = await uploadFile(`avatars/${currentUser.uid}`, avatarFile);

    // Banner
    const bannerFile = $('settings-banner-input').files[0];
    if (bannerFile) updates.bannerURL = await uploadFile(`banners/${currentUser.uid}`, bannerFile);

    // Song
    const songFile = $('settings-song-input').files[0];
    if (songFile) {
      updates.songURL = await uploadFile(`songs/${currentUser.uid}.mp3`, songFile);
      updates.songName = songFile.name.replace(/\.mp3$/i, '');
    }

    await db.collection('users').doc(currentUser.uid).update(updates);
    Object.assign(currentProfile, updates);
    updateDrawer();
    closeModal('settings-modal');
    showToast('Профиль обновлён!');
  } catch(e) {
    showModalError('settings-error', e.message);
  } finally {
    $('settings-save-btn').textContent = 'Сохранить';
  }
}

// ══════════════════════════════════════════════════════
//  USER SEARCH (New Chat Modal)
// ══════════════════════════════════════════════════════

let userSearchTimer;
async function handleUserSearch(e) {
  clearTimeout(userSearchTimer);
  const q = e.target.value.trim().replace('@', '').toLowerCase();
  const container = $('user-search-results');
  if (!q) { container.innerHTML = ''; return; }

  container.innerHTML = '<div style="padding:8px;color:var(--text-secondary);font-size:13px">Ищем...</div>';
  userSearchTimer = setTimeout(async () => {
    const snap = await db.collection('users')
      .where('username', '>=', q)
      .where('username', '<=', q + '\uf8ff')
      .limit(10).get();

    if (snap.empty) {
      container.innerHTML = '<div style="padding:8px;color:var(--text-secondary);font-size:13px">Не найдено</div>';
      return;
    }
    container.innerHTML = '';
    snap.forEach(doc => {
      const u = doc.data();
      if (u.uid === currentUser.uid) return;
      const item = document.createElement('div');
      item.className = 'user-result-item';
      const avatarHtml = u.photoURL
        ? `<img src="${u.photoURL}" alt=""/>`
        : `<span style="background:${u.profileColor||'#5288c1'};color:#fff;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-weight:600">${(u.displayName||'?')[0].toUpperCase()}</span>`;
      item.innerHTML = `
        <div class="user-result-avatar">${avatarHtml}</div>
        <div>
          <div class="user-result-name">${escHtml(u.displayName)}</div>
          <div class="user-result-username">@${escHtml(u.username)}</div>
        </div>
      `;
      item.addEventListener('click', () => openOrCreateDM(u.uid));
      container.appendChild(item);
    });
  }, 400);
}

// ══════════════════════════════════════════════════════
//  CONTEXT MENU
// ══════════════════════════════════════════════════════

function showContextMenu(x, y) {
  const menu = $('context-menu');
  menu.classList.remove('hidden');
  const maxX = window.innerWidth - 180;
  const maxY = window.innerHeight - 150;
  menu.style.left = Math.min(x, maxX) + 'px';
  menu.style.top  = Math.min(y, maxY) + 'px';
}
function hideContextMenu() {
  $('context-menu').classList.add('hidden');
}

// ══════════════════════════════════════════════════════
//  DEVELOPER PANEL (@mrzt only)
// ══════════════════════════════════════════════════════

let adminCurrentTab = 'stats';

async function openAdminPanel() {
  if (currentProfile.username !== ADMIN_USERNAME) return;
  openModal('admin-modal');
  adminSwitchTab('stats');
}

function adminSwitchTab(tab) {
  adminCurrentTab = tab;
  // Update tab buttons
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  // Show correct section
  document.querySelectorAll('.admin-tab-section').forEach(sec => {
    sec.classList.toggle('hidden', sec.dataset.section !== tab);
  });
  // Load data for the tab
  if (tab === 'stats')    adminLoadStats();
  if (tab === 'users')    adminLoadUsers();
  if (tab === 'announce') adminSetupAnnounce();
  if (tab === 'log')      adminLoadLog();
  if (tab === 'chats')    adminLoadChats();
  if (tab === 'favspy')   adminLoadFavspy();
}

// ── Stats tab ──────────────────────────────────────
async function adminLoadStats() {
  const [usersSnap, chatsSnap, chansSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('chats').get(),
    db.collection('channels').get(),
  ]);

  $('admin-users-count').textContent  = usersSnap.size;
  $('admin-chats-count').textContent  = chatsSnap.size;
  $('admin-channels-count').textContent = chansSnap.size;

  // Count banned users
  let banned = 0;
  usersSnap.forEach(d => { if (d.data().isBanned) banned++; });
  $('admin-banned-count').textContent = banned;

  // Activity chart: count messages per day for last 7 days
  const days = [];
  const counts = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toLocaleDateString('ru', { weekday: 'short', day: 'numeric' }));
    counts.push(0);
  }

  // Sample from a few chats (Firestore limits, so we sample)
  try {
    const msgsSnap = await db.collectionGroup('messages')
      .orderBy('createdAt', 'desc')
      .limit(200).get();
    msgsSnap.forEach(doc => {
      const ts = doc.data().createdAt;
      if (!ts) return;
      const d = ts.toDate();
      const daysAgo = Math.floor((now - d) / 86400000);
      if (daysAgo >= 0 && daysAgo < 7) counts[6 - daysAgo]++;
    });
  } catch(e) { /* collectionGroup may need index */ }

  renderAdminChart(days, counts);
}

function renderAdminChart(labels, data) {
  const canvas = $('admin-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width  = canvas.offsetWidth  || 400;
  const H = canvas.height = 140;
  const pad = { top: 16, right: 16, bottom: 32, left: 36 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top  - pad.bottom;
  const max = Math.max(...data, 1);

  ctx.clearRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
  }

  // Bars
  const barW = chartW / labels.length * 0.55;
  const gap   = chartW / labels.length;

  labels.forEach((label, i) => {
    const x = pad.left + gap * i + gap * 0.225;
    const barH = (data[i] / max) * chartH;
    const y = pad.top + chartH - barH;

    // Gradient bar
    const grad = ctx.createLinearGradient(0, y, 0, y + barH);
    grad.addColorStop(0, '#5288c1');
    grad.addColorStop(1, 'rgba(82,136,193,0.3)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [3, 3, 0, 0]);
    ctx.fill();

    // Value label
    if (data[i] > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(data[i], x + barW / 2, y - 4);
    }

    // Day label
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + barW / 2, H - 8);
  });
}

// ── Users tab ──────────────────────────────────────
let adminUsersAll = [];
async function adminLoadUsers() {
  const snap = await db.collection('users').orderBy('createdAt', 'desc').get();
  adminUsersAll = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  adminRenderUsers(adminUsersAll);

  $('admin-user-search').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = q
      ? adminUsersAll.filter(u => (u.username||'').includes(q) || (u.displayName||'').toLowerCase().includes(q))
      : adminUsersAll;
    adminRenderUsers(filtered);
  };
}

function adminRenderUsers(users) {
  const list = $('admin-users-list');
  list.innerHTML = '';
  if (!users.length) {
    list.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;padding:12px">Нет пользователей</div>';
    return;
  }
  users.forEach(u => {
    const item = document.createElement('div');
    item.className = 'admin-user-item';
    const avatarBg = u.profileColor || '#5288c1';
    const avatarContent = u.photoURL
      ? `<img src="${u.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt=""/>`
      : `<span style="color:#fff;font-weight:600;font-size:13px">${(u.displayName||'?')[0].toUpperCase()}</span>`;
    const regDate = u.createdAt?.toDate
      ? u.createdAt.toDate().toLocaleDateString('ru', { day:'2-digit', month:'short', year:'2-digit' })
      : '—';

    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer"
           onclick="openUserProfileModal('${u.uid||u.id}')">
        <div style="width:36px;height:36px;border-radius:50%;background:${avatarBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">${avatarContent}</div>
        <div style="min-width:0">
          <div class="admin-user-name">${escHtml(u.displayName||'—')}</div>
          <div class="admin-user-un">@${escHtml(u.username||'—')} · ${regDate}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        ${u.isBanned
          ? `<button class="admin-action-btn unban" onclick="adminUnban('${u.uid||u.id}')">Разбанить</button>`
          : `<button class="admin-action-btn ban" onclick="adminBanByUid('${u.uid||u.id}')">Бан</button>`
        }
      </div>
    `;
    list.appendChild(item);
  });
}

// ── Announce tab ──────────────────────────────────
function adminSetupAnnounce() {
  // nothing to load, just UI
}

async function adminSendAnnouncement() {
  const text = $('admin-announce-text').value.trim();
  if (!text) { showToast('Введите текст объявления'); return; }

  const btn = $('admin-announce-btn');
  btn.textContent = 'Отправляем...';
  btn.disabled = true;

  try {
    // Get all users
    const usersSnap = await db.collection('users').get();
    const batch = db.batch();

    // Create a special "system" DM from mrzt to each user
    const promises = [];
    usersSnap.forEach(doc => {
      const uid = doc.id;
      if (uid === currentUser.uid) return;

      const dmId = `${currentUser.uid}_${uid}`;
      const chatRef = db.collection('chats').doc(dmId);
      const msgRef = chatRef.collection('messages').doc();

      promises.push(
        chatRef.set({
          type: 'dm',
          participants: [currentUser.uid, uid],
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastMessage: { text: '📢 ' + text, type: 'text', senderId: currentUser.uid },
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true }).then(() =>
          msgRef.set({
            senderId: currentUser.uid,
            senderName: '📢 Grammy',
            type: 'text',
            text: '📢 ' + text,
            isAnnouncement: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          })
        )
      );
    });

    await Promise.all(promises);
    $('admin-announce-text').value = '';
    showToast(`✅ Объявление отправлено ${usersSnap.size - 1} пользователям`);
  } catch(e) {
    showToast('Ошибка: ' + e.message);
  } finally {
    btn.textContent = 'Отправить всем';
    btn.disabled = false;
  }
}

// ── Log tab ────────────────────────────────────────
async function adminLoadLog() {
  const logList = $('admin-log-list');
  logList.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;padding:8px">Загружаем...</div>';

  const snap = await db.collection('users')
    .orderBy('createdAt', 'desc')
    .limit(30).get();

  logList.innerHTML = '';
  if (snap.empty) {
    logList.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;padding:8px">Нет данных</div>';
    return;
  }

  snap.forEach(doc => {
    const u = doc.data();
    const regDate = u.createdAt?.toDate
      ? u.createdAt.toDate().toLocaleString('ru', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
      : '—';
    const item = document.createElement('div');
    item.className = 'admin-log-item';
    item.innerHTML = `
      <div class="admin-log-icon"><i class="fa-solid fa-user-plus"></i></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500">${escHtml(u.displayName||'—')} <span style="color:var(--accent)">@${escHtml(u.username||'—')}</span></div>
        <div style="font-size:11px;color:var(--text-secondary)">Регистрация · ${regDate}</div>
      </div>
      ${u.isBanned ? '<span class="admin-ban-chip">Забанен</span>' : ''}
    `;
    logList.appendChild(item);
  });
}

// ── Ban / Unban helpers ────────────────────────────
async function adminBanUser() {
  const username = $('admin-ban-username').value.trim().toLowerCase();
  if (!username) return;
  await banUserByUsername(username);
}

async function adminBanByUid(uid) {
  await db.collection('users').doc(uid).update({ isBanned: true });
  showToast('Пользователь заблокирован');
  adminLoadUsers();
}

async function adminUnban(uid) {
  await db.collection('users').doc(uid).update({ isBanned: false });
  showToast('Пользователь разблокирован');
  adminLoadUsers();
}

async function banUserByUsername(username) {
  const snap = await db.collection('users').where('username', '==', username).get();
  if (snap.empty) {
    $('admin-ban-msg').textContent = 'Пользователь не найден';
    $('admin-ban-msg').classList.remove('hidden');
    return;
  }
  const uid = snap.docs[0].id;
  await db.collection('users').doc(uid).update({ isBanned: true });
  $('admin-ban-msg').textContent = `@${username} заблокирован`;
  $('admin-ban-msg').style.color = '#4caf50';
  $('admin-ban-msg').classList.remove('hidden');
  showToast(`@${username} заблокирован`);
  adminLoadUsers();
}

// ══════════════════════════════════════════════════════
//  ADMIN — CHATS READER & PROFILE PREVIEW
// ══════════════════════════════════════════════════════

async function adminLoadChats() {
  const list = $('admin-chats-list');
  list.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;padding:8px">Загружаем...</div>';

  const snap = await db.collection('chats')
    .where('type', '==', 'dm')
    .orderBy('updatedAt', 'desc')
    .limit(40).get();

  list.innerHTML = '';
  if (snap.empty) {
    list.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;padding:8px">Нет переписок</div>';
    return;
  }

  const items = await Promise.all(snap.docs.map(async doc => {
    const chat = doc.data();
    const participants = chat.participants || [];
    const names = await Promise.all(participants.map(async uid => {
      const u = await db.collection('users').doc(uid).get();
      return u.exists ? u.data().displayName + ' (@' + u.data().username + ')' : uid;
    }));
    const lastText = chat.lastMessage?.text || '[медиа]';
    const timeStr = formatTime(chat.updatedAt);
    return { id: doc.id, names, lastText, timeStr };
  }));

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'admin-chat-item';
    el.innerHTML = `
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${escHtml(item.names[0]||'?')} ↔ ${escHtml(item.names[1]||'?')}
        </div>
        <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${escHtml(item.lastText)} · ${item.timeStr}
        </div>
      </div>
      <button class="admin-action-btn unban" onclick="adminOpenChat('${item.id}')">Читать</button>
    `;
    list.appendChild(el);
  });
}

let adminChatUnsub = null;
async function adminOpenChat(chatId) {
  $('admin-chat-viewer').classList.remove('hidden');
  $('admin-chat-messages').innerHTML = '';

  if (adminChatUnsub) adminChatUnsub();
  adminChatUnsub = db.collection('chats').doc(chatId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .limit(100)
    .onSnapshot(snap => {
      const container = $('admin-chat-messages');
      container.innerHTML = '';
      snap.forEach(doc => {
        const msg = doc.data();
        const time = formatMsgTime(msg.createdAt);
        const el = document.createElement('div');
        el.style.cssText = 'padding:6px 10px;border-radius:8px;background:var(--bg-input);margin-bottom:6px';
        el.innerHTML = `
          <div style="font-size:11px;color:var(--accent);font-weight:600;margin-bottom:2px">
            ${escHtml(msg.senderName||'—')} <span style="color:var(--text-muted);font-weight:400">${time}</span>
          </div>
          <div style="font-size:13px;word-break:break-word">${msg.type === 'text' ? escHtml(msg.text||'') : '[' + escHtml(msg.type||'?') + ']'}</div>
        `;
        container.appendChild(el);
      });
      container.scrollTop = container.scrollHeight;
    });
}

function adminCloseChat() {
  $('admin-chat-viewer').classList.add('hidden');
  if (adminChatUnsub) { adminChatUnsub(); adminChatUnsub = null; }
}

// ── Profile Preview ────────────────────────────────
function openProfilePreview() {
  if (!currentProfile) return;
  openUserProfileModal(currentUser.uid);
}

// ══════════════════════════════════════════════════════
//  IMAGE VIEWER
// ══════════════════════════════════════════════════════

function openImageViewer(url) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:1000;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  const img = document.createElement('img');
  img.src = url;
  img.style.cssText = 'max-width:95vw;max-height:95vh;border-radius:8px;object-fit:contain';
  overlay.appendChild(img);
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

// ══════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showModalError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ══════════════════════════════════════════════════════
//  PUSH NOTIFICATIONS
// ══════════════════════════════════════════════════════

function initPushNotifications() {
  if (!('Notification' in window)) return;

  // Already granted — no banner needed, just use it
  if (Notification.permission === 'granted') {
    registerServiceWorker();
    return;
  }

  // Already denied — don't ask again
  if (Notification.permission === 'denied') return;

  // User dismissed our banner before — don't show again
  if (localStorage.getItem('notif_dismissed')) return;

  // Show our friendly banner (better UX than browser prompt immediately)
  setTimeout(() => {
    $('notif-banner').classList.remove('hidden');
  }, 3000);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('sw.js');
  } catch(e) {
    // SW not found — that's fine, we'll use regular Web Notifications
  }
}

// Called when a new incoming message arrives — fires a Web Notification
function fireNotification(title, body, icon, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // Don't notify about own messages or currently open chat
  const notif = new Notification(title, {
    body,
    icon: icon || '/favicon.ico',
    tag,        // deduplicates: one notif per chat
    renotify: true,
    badge: '/favicon.ico',
  });

  notif.onclick = () => {
    window.focus();
    notif.close();
  };
}

// ══════════════════════════════════════════════════════
//  FAVORITES
// ══════════════════════════════════════════════════════

function getFavoritesId(uid) {
  return `favorites_${uid}`;
}

async function openFavorites(targetUid) {
  // targetUid: if set, opens someone else's favorites (admin spy mode)
  // otherwise opens own favorites
  const uid       = targetUid || currentUser.uid;
  const favChatId = getFavoritesId(uid);
  const isMine    = uid === currentUser.uid;

  // Ensure the favorites chat doc exists
  const ref = db.collection('chats').doc(favChatId);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      type: 'favorites',
      ownerId: uid,
      participants: [uid],
      name: isMine ? 'Избранное' : `Избранное @${(await db.collection('users').doc(uid).get()).data()?.username || uid}`,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessage: null,
    });
  }

  openChat(favChatId, 'favorites');
}

// ══════════════════════════════════════════════════════
//  ADMIN — FAVSPY TAB
// ══════════════════════════════════════════════════════

let favspyUnsub = null;
let favspyAllUsers = [];

async function adminLoadFavspy() {
  const snap = await db.collection('users').orderBy('displayName').get();
  favspyAllUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  favspyRenderUsers(favspyAllUsers);

  $('favspy-search').oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = q
      ? favspyAllUsers.filter(u => (u.username||'').includes(q) || (u.displayName||'').toLowerCase().includes(q))
      : favspyAllUsers;
    favspyRenderUsers(filtered);
  };
}

function favspyRenderUsers(users) {
  const list = $('favspy-users-list');
  list.innerHTML = '';
  users.forEach(u => {
    const item = document.createElement('div');
    item.className = 'admin-user-item';
    item.style.cursor = 'pointer';
    item.innerHTML = `
      <div style="flex:1">
        <div class="admin-user-name">${escHtml(u.displayName||'—')}</div>
        <div class="admin-user-un">@${escHtml(u.username||'—')}</div>
      </div>
      <button class="admin-action-btn unban" onclick="favspyOpen('${u.uid||u.id}','${escHtml(u.displayName||'')}','${escHtml(u.username||'')}')">
        <i class="fa-solid fa-star"></i> Смотреть
      </button>
    `;
    list.appendChild(item);
  });
}

async function favspyOpen(uid, name, username) {
  const favId = getFavoritesId(uid);
  $('favspy-msgs').classList.remove('hidden');
  $('favspy-title').textContent = `⭐ ${name} (@${username}) — Избранное`;
  const container = $('favspy-messages');
  container.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;padding:8px">Загружаем...</div>';

  if (favspyUnsub) { favspyUnsub(); favspyUnsub = null; }

  // Check if chat exists
  const snap = await db.collection('chats').doc(favId).get();
  if (!snap.exists) {
    container.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;padding:8px">Нет сохранённых сообщений</div>';
    return;
  }

  favspyUnsub = db.collection('chats').doc(favId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .limit(50)
    .onSnapshot(msgs => {
      container.innerHTML = '';
      if (msgs.empty) {
        container.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;padding:8px">Нет сообщений</div>';
        return;
      }
      msgs.forEach(doc => {
        const m = doc.data();
        const time = formatMsgTime(m.createdAt);
        const el = document.createElement('div');
        el.style.cssText = 'padding:6px 10px;border-radius:8px;background:var(--bg-input);font-size:13px;word-break:break-word';
        el.innerHTML = `
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">${time}</div>
          <div>${m.type === 'text' ? escHtml(m.text||'') : '<span style="color:var(--text-secondary)">['+escHtml(m.type||'файл')+']</span>'}</div>
        `;
        container.appendChild(el);
      });
      container.scrollTop = container.scrollHeight;
    });
}

function favspyClose() {
  $('favspy-msgs').classList.add('hidden');
  if (favspyUnsub) { favspyUnsub(); favspyUnsub = null; }
}

// Make some functions global (called from inline HTML handlers)
window.openOrCreateDM        = openOrCreateDM;
window.openChannel           = openChannel;
window.toggleVoicePlay       = toggleVoicePlay;
window.toggleVidnotePlay     = toggleVidnotePlay;
window.openImageViewer       = openImageViewer;
window.openUserProfileModal  = openUserProfileModal;
window.adminBanByUid         = adminBanByUid;
window.adminUnban            = adminUnban;
window.adminSwitchTab        = adminSwitchTab;
window.adminSendAnnouncement = adminSendAnnouncement;
window.adminOpenChat         = adminOpenChat;
window.adminCloseChat        = adminCloseChat;
window.adminBanUser          = adminBanUser;
window.togglePinChat         = togglePinChat;
window.openProfilePreview    = openProfilePreview;
window.handleChatItemClick   = handleChatItemClick;
window.handleChatItemRightClick = handleChatItemRightClick;
window.goBackToList          = goBackToList;
window.openPostComments      = openComments;
window.openComments          = openComments;
window.sendComment           = sendComment;
window.deleteChannelPost     = deleteChannelPost;
window.openChannelMembers    = openChannelMembers;
window.openMemberMenu        = openMemberMenu;
window.memberToggleAdmin     = memberToggleAdmin;
window.memberKick            = memberKick;
window.removeMemberCtxMenu   = removeMemberCtxMenu;
window.toggleChannelAdmin    = toggleChannelAdmin;
window.removeChannelMember   = removeChannelMember;
window.openFavorites         = openFavorites;
window.favspyOpen            = favspyOpen;
window.favspyClose           = favspyClose;
window.addReaction           = addReaction;
window.subscribeToChannel    = subscribeToChannel;
window.$                     = $;

// Close chat context menu on outside click
document.addEventListener('click', e => {
  const menu = $('chat-context-menu');
  if (menu && !menu.contains(e.target)) menu.classList.add('hidden');
});
