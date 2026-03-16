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

// ── Music Mini-Player state ───────────────────────
// Full MusicPlayer class — Spotify/Telegram style
// Supports: playlist, shuffle, repeat, Web Audio waveform, full-screen
class MusicPlayer {
  constructor() {
    this.audio        = null;
    this.playlist     = [];   // [{url, name, owner, avatar}]
    this.index        = 0;
    this.playing      = false;
    this.shuffle      = false;
    this.repeat       = 'none'; // 'none' | 'one' | 'all'
    this.fullscreen   = false;
    this.audioCtx     = null;
    this.analyser     = null;
    this.srcNode      = null;
    this.animFrame    = null;
    this.waveCanvas   = null;
  }

  // ── Load a track (or full playlist) ───────────
  load(tracks, startIndex = 0) {
    this.playlist = tracks;
    this.index    = startIndex;
    this._play();
  }

  // ── Play current index ─────────────────────────
  _play() {
    if (this.audio) { this.audio.pause(); this.audio.src = ''; }
    if (!this.playlist.length) return;

    const track = this.playlist[this.index];
    this.audio = new Audio(track.url);
    this.audio.crossOrigin = 'anonymous';

    this.audio.addEventListener('timeupdate', () => this._onTimeUpdate());
    this.audio.addEventListener('ended',      () => this._onEnded());
    this.audio.addEventListener('loadedmetadata', () => this._renderDuration());
    this.audio.play().catch(() => {});
    this.playing = true;

    this._setupAnalyser();
    this._renderBar();
    this._renderFull();
    $('music-bar')?.classList.remove('hidden');
  }

  _setupAnalyser() {
    try {
      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.srcNode) { try { this.srcNode.disconnect(); } catch {} }
      this.srcNode  = this.audioCtx.createMediaElementSource(this.audio);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 128;
      this.srcNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
      this._drawWave();
    } catch {}
  }

  _drawWave() {
    cancelAnimationFrame(this.animFrame);
    const canvas = $('music-full-wave');
    if (!canvas || !this.analyser) return;
    const ctx = canvas.getContext('2d');
    const bufLen = this.analyser.frequencyBinCount;
    const dataArr = new Uint8Array(bufLen);

    const draw = () => {
      this.animFrame = requestAnimationFrame(draw);
      this.analyser.getByteFrequencyData(dataArr);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barW = (canvas.width / bufLen) * 2.5;
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const h = (dataArr[i] / 255) * canvas.height;
        const alpha = 0.4 + (dataArr[i] / 255) * 0.6;
        ctx.fillStyle = `rgba(82,136,193,${alpha})`;
        ctx.fillRect(x, canvas.height - h, barW - 1, h);
        x += barW;
      }
    };
    draw();
  }

  _onTimeUpdate() {
    if (!this.audio?.duration) return;
    const pct = (this.audio.currentTime / this.audio.duration) * 100;
    const fill = $('music-bar-progress-fill');
    if (fill) fill.style.width = pct + '%';
    const fullFill = $('music-full-progress-fill');
    if (fullFill) fullFill.style.width = pct + '%';
    const thumb = $('music-full-progress-thumb');
    if (thumb) thumb.style.setProperty('--prog', pct + '%');
    const cur = $('music-full-current');
    if (cur) cur.textContent = formatDuration(Math.floor(this.audio.currentTime));
  }

  _onEnded() {
    if (this.repeat === 'one') {
      this.audio.currentTime = 0;
      this.audio.play();
      return;
    }
    if (this.repeat === 'all' || this.index < this.playlist.length - 1) {
      this.next();
    } else {
      this.playing = false;
      this._renderBar();
    }
  }

  _renderDuration() {
    const el = $('music-full-duration');
    if (el && this.audio?.duration) el.textContent = formatDuration(Math.floor(this.audio.duration));
  }

  // ── Controls ────────────────────────────────────
  togglePlay() {
    if (!this.audio) return;
    if (this.playing) { this.audio.pause(); this.playing = false; }
    else { this.audio.play(); this.playing = true; }
    this._renderBar();
    this._renderFull();
  }

  next() {
    if (!this.playlist.length) return;
    if (this.shuffle) {
      this.index = Math.floor(Math.random() * this.playlist.length);
    } else {
      this.index = (this.index + 1) % this.playlist.length;
    }
    this._play();
  }

  prev() {
    if (!this.playlist.length) return;
    if (this.audio && this.audio.currentTime > 3) {
      this.audio.currentTime = 0; return;
    }
    this.index = (this.index - 1 + this.playlist.length) % this.playlist.length;
    this._play();
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    const btn = $('music-full-shuffle');
    if (btn) btn.classList.toggle('active', this.shuffle);
  }

  toggleRepeat() {
    const states = ['none','one','all'];
    this.repeat = states[(states.indexOf(this.repeat) + 1) % 3];
    const btn = $('music-full-repeat');
    if (!btn) return;
    const icons = { none: 'fa-rotate-right', one: 'fa-1', all: 'fa-rotate-right' };
    btn.classList.toggle('active', this.repeat !== 'none');
    btn.title = { none: 'Повтор выкл', one: 'Повтор трека', all: 'Повтор всех' }[this.repeat];
  }

  setVolume(v) {
    if (this.audio) this.audio.volume = Math.max(0, Math.min(1, v));
  }

  seek(pct) {
    if (this.audio?.duration) {
      this.audio.currentTime = (pct / 100) * this.audio.duration;
    }
  }

  toggleFullscreen() {
    this.fullscreen = !this.fullscreen;
    const fp = $('music-full-player');
    const bar = $('music-bar');
    if (fp) fp.classList.toggle('hidden', !this.fullscreen);
    if (bar) bar.classList.toggle('hidden', this.fullscreen);
    if (this.fullscreen) this._renderFull();
    if (this.fullscreen && this.analyser) this._drawWave();
  }

  // ── UI Sync ─────────────────────────────────────
  _renderBar() {
    const track = this.playlist[this.index];
    if (!track) return;
    const titleEl  = $('music-bar-title');
    const artistEl = $('music-bar-artist');
    const playBtn  = $('music-bar-play');
    const artEl    = $('music-bar-art');
    if (titleEl)  titleEl.textContent  = track.name;
    if (artistEl) artistEl.textContent = track.owner;
    if (playBtn)  playBtn.innerHTML = this.playing
      ? '<i class="fa-solid fa-pause"></i>'
      : '<i class="fa-solid fa-play"></i>';
    if (artEl) {
      if (track.avatar) {
        artEl.innerHTML = `<img src="${track.avatar}" style="width:100%;height:100%;object-fit:cover"/>`;
      } else {
        artEl.innerHTML = '<i class="fa-solid fa-music"></i>';
      }
    }
  }

  _renderFull() {
    const track = this.playlist[this.index];
    if (!track) return;
    const titleEl  = $('music-full-title');
    const artistEl = $('music-full-artist');
    const artEl    = $('music-full-art');
    const playBtn  = $('music-full-play');
    const bgEl     = $('music-full-bg');
    if (titleEl)  titleEl.textContent  = track.name;
    if (artistEl) artistEl.textContent = track.owner;
    if (artEl) {
      if (track.avatar) {
        artEl.innerHTML = `<img src="${track.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:20px"/>`;
        // Blurred background from album art
        if (bgEl) {
          bgEl.style.backgroundImage = `url(${track.avatar})`;
          bgEl.classList.add('has-art');
        }
      } else {
        artEl.innerHTML = `<i class="fa-solid fa-music" style="font-size:64px;color:rgba(255,255,255,0.2)"></i>`;
        if (bgEl) bgEl.classList.remove('has-art');
      }
      artEl.classList.toggle('playing', this.playing);
    }
    if (playBtn) playBtn.innerHTML = this.playing
      ? '<i class="fa-solid fa-pause"></i>'
      : '<i class="fa-solid fa-play"></i>';
    // Also update the bar play button
    const barPlayBtn = $('music-bar-play');
    if (barPlayBtn) barPlayBtn.innerHTML = this.playing
      ? '<i class="fa-solid fa-pause"></i>'
      : '<i class="fa-solid fa-play"></i>';
    this._renderPlaylist();
  }

  _renderPlaylist() {
    const list = $('music-full-playlist');
    if (!list) return;
    list.innerHTML = '';
    this.playlist.forEach((t, i) => {
      const item = document.createElement('div');
      item.className = `music-playlist-item${i === this.index ? ' active' : ''}`;
      item.innerHTML = `
        <div class="music-playlist-num">${i === this.index && this.playing ? '▶' : i + 1}</div>
        <div class="music-playlist-info">
          <div class="music-playlist-name">${escHtml(t.name)}</div>
          <div class="music-playlist-artist">${escHtml(t.owner)}</div>
        </div>
      `;
      item.onclick = () => { this.index = i; this._play(); };
      list.appendChild(item);
    });
  }

  stop() {
    cancelAnimationFrame(this.animFrame);
    if (this.audio) { this.audio.pause(); this.audio.src = ''; this.audio = null; }
    this.playing = false;
    this.fullscreen = false;
    $('music-bar')?.classList.add('hidden');
    $('music-full-player')?.classList.add('hidden');
  }
}

const gramMusicPlayer = new MusicPlayer();

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
  listenForCalls();
  initPresence();

  if (currentProfile.username === ADMIN_USERNAME) {
    $('drawer-admin').classList.remove('hidden');
  }
}

// ══════════════════════════════════════════════════════
//  PRESENCE — Online / Last seen
// ══════════════════════════════════════════════════════
function initPresence() {
  if (!currentUser) return;
  const userRef = db.collection('users').doc(currentUser.uid);

  // Mark online
  const setOnline = () => userRef.update({
    online: true,
    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(() => {});

  const setOffline = () => userRef.update({
    online: false,
    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(() => {});

  setOnline();

  // Update on visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setOnline();
    else setOffline();
  });

  // Mark offline on unload
  window.addEventListener('beforeunload', () => setOffline());

  // Keep alive every 2 minutes
  setInterval(setOnline, 120000);
}

function formatPresence(u) {
  if (u.online) return '🟢 В сети';
  if (!u.lastSeen) return 'Был(а) давно';
  const d = u.lastSeen.toDate ? u.lastSeen.toDate() : new Date(u.lastSeen);
  const diff = Date.now() - d.getTime();
  if (diff < 60000)     return 'Был(а) только что';
  if (diff < 3600000)   return `Был(а) ${Math.floor(diff/60000)} мин назад`;
  if (diff < 86400000)  return `Был(а) сегодня в ${d.toLocaleTimeString('ru', {hour:'2-digit',minute:'2-digit'})}`;
  if (diff < 172800000) return `Был(а) вчера в ${d.toLocaleTimeString('ru', {hour:'2-digit',minute:'2-digit'})}`;
  return `Был(а) ${d.toLocaleDateString('ru', {day:'2-digit',month:'short'})}`;
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
  $('ctx-forward').addEventListener('click', () => {
    if (contextTargetMsg) openForwardModal(contextTargetMsg);
    hideContextMenu();
  });
  $('ctx-save').addEventListener('click', () => {
    if (contextTargetMsg) saveToFavorites(contextTargetMsg);
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

  // Channel more-button — dropdown for settings (comments toggle, etc.)
  $('channel-more-btn').addEventListener('click', e => {
    e.stopPropagation();
    openChannelMenu();
  });

  // Typing indicator
  let typingTimer;
  const msgInput2 = $('message-input');
  if (msgInput2) {
    msgInput2.addEventListener('input', () => {
      if (!activeChatId || activeChatType !== 'dm') return;
      clearTimeout(typingTimer);
      db.collection('chats').doc(activeChatId).update({
        [`typing.${currentUser.uid}`]: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(() => {});
      typingTimer = setTimeout(() => {
        db.collection('chats').doc(activeChatId).update({
          [`typing.${currentUser.uid}`]: firebase.firestore.FieldValue.delete()
        }).catch(() => {});
      }, 3000);
    });
  }
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
      if (chat.isSupportBot) {
        // Support Bot chat
        name = chat.botName || 'Поддержка Grammy';
        avatarColor = '#5288c1';
      } else {
        const otherId = chat.participants.find(id => id !== currentUser.uid);
        if (otherId) {
          const userSnap = await db.collection('users').doc(otherId).get();
          if (userSnap.exists) {
            const u = userSnap.data();
            name = u.displayName;
            photoURL = u.photoURL;
            avatarColor = u.profileColor || '#5288c1';
          }
        }
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
    const isPinned  = (currentProfile.pinnedChats || []).includes(doc.id);
    // Get this user's pin timestamp from chat doc for ordering pinned chats
    const pinnedAt  = chat.pinnedBy?.[currentUser.uid]?.toMillis?.() || (isPinned ? 1 : 0);

    // Avatar — favorites gets star, support bot gets headset, others get photo or letter
    let avatarContent;
    if (chat.type === 'favorites') {
      avatarContent = `<span style="background:rgba(240,165,0,0.15);color:#f0a500;font-size:20px"><i class="fa-solid fa-star"></i></span>`;
    } else if (chat.isSupportBot) {
      avatarContent = `<span style="background:rgba(82,136,193,0.2);color:var(--accent);font-size:18px"><i class="fa-solid fa-headset"></i></span>`;
    } else if (photoURL) {
      avatarContent = `<img src="${photoURL}" alt=""/>`;
    } else {
      avatarContent = `<span style="background:${avatarColor}">${(name||'?')[0].toUpperCase()}</span>`;
    }

    return {
      isPinned,
      pinnedAt,
      updatedAt: chat.updatedAt?.toMillis?.() || 0,
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

  // Sort: pinned first (most recently pinned first), then by updatedAt desc
  const sorted = [...items].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    if (a.isPinned && b.isPinned) return b.pinnedAt - a.pinnedAt;
    return b.updatedAt - a.updatedAt;
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
  const chatRef = db.collection('chats').doc(chatId);

  if (currentlyPinned) {
    // Unpin — remove from user's array and clear isPinned on chat doc
    await userRef.update({ pinnedChats: firebase.firestore.FieldValue.arrayRemove(chatId) });
  } else {
    // Pin — add to user's array and write isPinned+pinnedAt to chat doc
    await userRef.update({ pinnedChats: firebase.firestore.FieldValue.arrayUnion(chatId) });
    // Store per-user pin metadata. Since chats can be pinned by different users
    // we store it in a sub-map: pinnedBy.{uid} = timestamp
    await chatRef.update({
      [`pinnedBy.${currentUser.uid}`]: firebase.firestore.FieldValue.serverTimestamp()
    });
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
      status = formatPresence(u);
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
  updateCallButtons(type);

  // Typing indicator — only for DMs
  if (type === 'dm') {
    const otherId = chat.participants.find(id => id !== currentUser.uid);
    if (otherId) {
      db.collection('chats').doc(chatId).onSnapshot(snap => {
        if (snap.id !== activeChatId) return;
        const typing = snap.data()?.typing || {};
        const otherTyping = typing[otherId];
        if (otherTyping) {
          const age = Date.now() - (otherTyping.toMillis?.() || 0);
          if (age < 4000) {
            $('chat-header-status').textContent = '✏️ печатает...';
            return;
          }
        }
        $('chat-header-status').textContent = status;
      });
    }
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
          const data = change.doc.data();
          // Update reactions on existing message
          const reactEl = document.querySelector(`[data-msgid="${change.doc.id}"] .msg-reactions`);
          if (reactEl) renderReactions(reactEl, data.reactions || {}, change.doc.id, 'msg', null);
          // Update poll votes in real-time
          if (data.type === 'poll') {
            const pollContainer = document.querySelector(`#poll-opts-${change.doc.id}`);
            if (pollContainer) {
              const bubble = pollContainer.closest('.message-bubble');
              if (bubble) {
                const pollWrap = bubble.querySelector('.msg-poll');
                if (pollWrap) pollWrap.outerHTML = renderPollBubble(data, change.doc.id);
              }
            }
          }
        } else if (change.type === 'removed') {
          const el = document.querySelector(`[data-msgid="${change.doc.id}"]`);
          if (el) el.closest('.message-row').remove();
        }
      });
      scrollToBottom();
    });

  // Mark chat as read when opened
  markChatRead(chatId);

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

  // Support bot messages always appear as 'in' regardless of sender
  const isBot = !!msg.isBot;
  const isOut = !isBot && msg.senderId === currentUser.uid;
  const row = document.createElement('div');
  row.className = `message-row ${isOut ? 'out' : 'in'}`;

  let senderName = '';
  let senderPhoto = '';
  let senderColor = '#5288c1';

  if (isBot) {
    senderName  = msg.senderName || 'Поддержка Grammy';
    senderColor = '#5288c1';
  } else if (!isOut && activeChatType === 'group') {
    const userSnap = await db.collection('users').doc(msg.senderId).get();
    if (userSnap.exists) {
      const u = userSnap.data();
      senderName = u.displayName;
      senderPhoto = u.photoURL;
      senderColor = u.profileColor || '#5288c1';
    }
  }

  const bubbleInner = await buildMessageContent(msg, isOut, senderName, msgId, isBot);

  // Show avatar for group chats and bot messages
  let avatarHtml = '';
  if (!isOut && (activeChatType === 'group' || isBot)) {
    const avatarContent = isBot
      ? `<i class="fa-solid fa-headset" style="color:#fff;font-size:14px"></i>`
      : senderPhoto
        ? `<img src="${senderPhoto}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
        : `<span style="font-size:12px;font-weight:600;color:#fff">${(senderName||'?')[0].toUpperCase()}</span>`;
    const clickHandler = isBot ? '' : `onclick="openUserProfileModal('${msg.senderId}')"`;
    avatarHtml = `<div class="msg-avatar" style="background:${senderColor};cursor:${isBot?'default':'pointer'}" ${clickHandler}>${avatarContent}</div>`;
  }

  row.innerHTML = avatarHtml + bubbleInner;

  // Context menu on right-click / long-press (not on bot messages)
  if (!isBot) {
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
  }

  $('messages-area').appendChild(row);

  // Render initial reactions
  const reactEl = row.querySelector('.msg-reactions');
  if (reactEl && msg.reactions) renderReactions(reactEl, msg.reactions, msgId, 'msg', null);
}

async function buildMessageContent(msg, isOut, senderName, msgId, isBot = false) {
  const time = formatMsgTime(msg.createdAt);
  const statusIcon = isOut ? '<i class="fa-solid fa-check-double msg-status"></i>' : '';

  let replyHtml = '';
  if (msg.replyTo) {
    replyHtml = `<div class="msg-reply">
      <div class="msg-reply-sender">${escHtml(msg.replyTo.senderName || '')}</div>
      <div class="msg-reply-text">${escHtml(msg.replyTo.text || '[медиа]')}</div>
    </div>`;
  }

  let nameHtml = '';
  if (senderName) {
    const verifiedIcon = (isBot || msg.isVerified)
      ? ' <i class="fa-solid fa-circle-check" style="color:#5288c1;font-size:11px"></i>'
      : '';
    nameHtml = `<div class="msg-sender-name">${escHtml(senderName)}${verifiedIcon}</div>`;
  }

  // Forwarded message header
  let forwardHtml = '';
  if (msg.forwardedFrom) {
    forwardHtml = `<div class="msg-forwarded">
      <i class="fa-solid fa-share" style="font-size:10px;opacity:0.6"></i>
      Переслано от <span style="color:var(--accent)">${escHtml(msg.forwardedFrom)}</span>
    </div>`;
  }

  let contentHtml = '';
  const t = msg.type || 'text';

  if (t === 'text') {
    // Convert unicode emoji to JoyPixels Apple-style images
    const safeText = escHtml(msg.text);
    const richText = (typeof joypixels !== 'undefined')
      ? joypixels.toImage(safeText)
      : safeText;
    contentHtml = `<div class="msg-text">${richText}</div>`;
  } else if (t === 'image') {
    contentHtml = `<div class="msg-image"><img src="${msg.mediaURL}" alt="Фото" loading="lazy" onclick="openImageViewer('${msg.mediaURL}')"/></div>`;
  } else if (t === 'video') {
    contentHtml = `<div class="msg-video"><video src="${msg.mediaURL}" controls preload="metadata"></video></div>`;
  } else if (t === 'audio') {
    // Sleek music track bubble with waveform bars
    const trackName = msg.fileName?.replace(/\.(mp3|wav|ogg|aac|m4a)$/i, '') || 'Трек';
    const bars = Array.from({length: 32}, () =>
      `<div class="audio-bar" style="height:${4 + Math.random()*22}px"></div>`
    ).join('');
    contentHtml = `
      <div class="msg-audio-track" onclick="openMusicPlayer('${msg.mediaURL}','${escHtml(trackName)}','${escHtml(msg.senderName||'')}','')">
        <div class="msg-audio-play"><i class="fa-solid fa-play"></i></div>
        <div class="msg-audio-info">
          <div class="msg-audio-name">${escHtml(trackName)}</div>
          <div class="msg-audio-wave">${bars}</div>
        </div>
        <div class="msg-audio-dur">${msg.duration ? formatDuration(msg.duration) : ''}</div>
      </div>`;
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
  } else if (t === 'poll') {
    contentHtml = renderPollBubble(msg, msgId);
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
      ${replyHtml}${forwardHtml}${nameHtml}${contentHtml}
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
  else if (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|aac|m4a|flac)$/i.test(file.name)) type = 'audio';

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
  await ref.collection('messages').add(msgData);
  await ref.update({
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    lastMessage: {
      text: msgData.text || '',
      type: msgData.type,
      senderId: currentUser.uid,
    }
  });
  // Mark message as read immediately for the sender
  await ref.update({
    [`readBy.${currentUser.uid}`]: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(() => {});
}

// ── Save message to Favorites ──────────────────────
async function saveToFavorites(msg) {
  const favId = `favorites_${currentUser.uid}`;
  const ref = db.collection('chats').doc(favId);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      type: 'favorites', ownerId: currentUser.uid,
      participants: [currentUser.uid],
      name: 'Избранное',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessage: null,
    });
  }
  await ref.collection('messages').add({
    senderId: currentUser.uid,
    senderName: currentProfile.displayName,
    type: msg.type || 'text',
    text: msg.text || '',
    mediaURL: msg.mediaURL || '',
    fileName: msg.fileName || '',
    forwardedFrom: msg.senderName || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await ref.update({
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    lastMessage: { text: msg.text || '[медиа]', type: msg.type || 'text', senderId: currentUser.uid }
  });
  showToast('⭐ Сохранено в Избранное');
}

// ── Forward message modal ──────────────────────────
let forwardMsgData = null;
async function openForwardModal(msg) {
  forwardMsgData = msg;
  // Build list of recent chats to forward to
  const snap = await db.collection('chats')
    .where('participants', 'array-contains', currentUser.uid)
    .orderBy('updatedAt', 'desc')
    .limit(20).get();

  const existing = $('forward-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'forward-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:380px">
      <div class="modal-header">
        <h3><i class="fa-solid fa-share"></i> Переслать в...</h3>
        <button class="icon-btn" onclick="document.getElementById('forward-modal').remove()"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="modal-body" style="padding:8px 12px 16px;gap:4px">
        <div id="forward-list" style="display:flex;flex-direction:column;gap:4px;max-height:340px;overflow-y:auto"></div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const list = modal.querySelector('#forward-list');
  const items = await Promise.all(snap.docs.map(async doc => {
    const chat = doc.data();
    if (chat.type === 'channel') return null; // can't forward to channels
    let name = '', photoURL = '', avatarColor = '#5288c1';
    if (chat.type === 'dm') {
      const otherId = chat.participants.find(id => id !== currentUser.uid);
      if (otherId) {
        const u = await db.collection('users').doc(otherId).get();
        if (u.exists) { name = u.data().displayName; photoURL = u.data().photoURL; avatarColor = u.data().profileColor || '#5288c1'; }
      }
    } else if (chat.type === 'favorites') {
      name = 'Избранное'; avatarColor = '#f0a500';
    } else {
      name = chat.name || 'Группа';
    }
    return { id: doc.id, name, photoURL, avatarColor, type: chat.type };
  }));

  items.filter(Boolean).forEach(item => {
    const div = document.createElement('div');
    div.className = 'chat-item';
    div.style.cssText = 'cursor:pointer;padding:8px 10px;border-radius:10px';
    const avatarEl = item.photoURL
      ? `<img src="${item.photoURL}" style="width:100%;height:100%;object-fit:cover"/>`
      : `<span style="background:${item.avatarColor}">${item.name[0]?.toUpperCase()}</span>`;
    div.innerHTML = `
      <div class="chat-item-avatar">${avatarEl}</div>
      <div class="chat-item-body">
        <div class="chat-item-top"><div class="chat-item-name">${escHtml(item.name)}</div></div>
      </div>`;
    div.onclick = () => forwardTo(item.id, item.name);
    list.appendChild(div);
  });
}

async function forwardTo(chatId, chatName) {
  if (!forwardMsgData) return;
  document.getElementById('forward-modal')?.remove();
  const prevChatId = activeChatId;
  activeChatId = chatId;
  await sendMessage({
    senderId: currentUser.uid,
    senderName: currentProfile.displayName,
    type: forwardMsgData.type || 'text',
    text: forwardMsgData.text || '',
    mediaURL: forwardMsgData.mediaURL || '',
    fileName: forwardMsgData.fileName || '',
    forwardedFrom: forwardMsgData.senderName || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  activeChatId = prevChatId;
  showToast(`✉️ Переслано в ${chatName}`);
  forwardMsgData = null;
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

  const isVerified = chan?.isVerified || false;
  const verifiedBadge = isVerified
    ? ' <i class="fa-solid fa-circle-check channel-verified-icon"></i>'
    : '';
  $('channel-header-name').innerHTML   = escHtml(name) + verifiedBadge;
  $('channel-header-status').textContent = `${subCount} подписчиков`;
  renderAvatar($('channel-header-avatar'), photoURL, name, '#5288c1');

  // Members btn — only for owner/admin
  const membersBtn = $('channel-members-btn');
  if (membersBtn) membersBtn.classList.toggle('hidden', !canPost);

  // Verify btn — only for @mrzt
  const verifyBtn = $('channel-verify-btn');
  if (verifyBtn) {
    if (currentProfile.username === ADMIN_USERNAME) {
      verifyBtn.classList.remove('hidden');
      verifyBtn.title = isVerified ? 'Убрать верификацию канала' : 'Верифицировать канал';
      verifyBtn.querySelector('i').style.opacity = isVerified ? '1' : '0.4';
    } else {
      verifyBtn.classList.add('hidden');
    }
  }

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

  // Always ensure the channel owner has a chat doc entry so it appears in their sidebar
  if (isOwner && !chatSnap.exists) {
    await db.collection('chats').doc(channelId).set({
      type: 'channel', name, photoURL,
      ownerId: chan?.ownerId || currentUser.uid,
      participants: [currentUser.uid],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessage: null,
    });
  } else if (isOwner && chatSnap.exists && !participants.includes(currentUser.uid)) {
    // Owner was somehow removed from participants — add them back
    await db.collection('chats').doc(channelId).update({
      participants: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
    });
  }

  // Add to chat list if subscribed but not yet a participant
  if (!isOwner && isSubscribed && !chatSnap.exists) {
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

  // Check if user is banned from this channel
  if ((chan.bannedUsers || []).includes(currentUser.uid)) {
    showToast('Вы заблокированы в этом канале');
    return;
  }

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
    <button class="ctx-item ctx-delete" onclick="banFromChannel('${uid}','${channelId}')">
      <i class="fa-solid fa-ban"></i> Заблокировать в канале
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

async function banFromChannel(uid, channelId) {
  removeMemberCtxMenu();
  // Remove from participants and add to channelBans array
  await db.collection('chats').doc(channelId).update({
    participants: firebase.firestore.FieldValue.arrayRemove(uid)
  });
  await db.collection('channels').doc(channelId).update({
    bannedUsers: firebase.firestore.FieldValue.arrayUnion(uid),
    subscribersCount: firebase.firestore.FieldValue.increment(-1)
  });
  showToast('Пользователь заблокирован в канале');
  openChannelMembers();
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

  const privacy    = u.privacy || {};
  const isOwnProfile = uid === currentUser.uid;
  const isAdmin    = currentProfile.username === ADMIN_USERNAME;
  const canSeeAll  = isOwnProfile || isAdmin;
  const viewerId   = currentUser.uid;
  // Granular: privacy.blockedUsers = { avatar:[uid,...], bio:[...], music:[...], banner:[...] }
  const blocked    = privacy.blockedUsers || {};
  const hiddenFor  = field =>
    !canSeeAll && (
      !!privacy[`hide${field[0].toUpperCase()}${field.slice(1)}`] ||
      (blocked[field] || []).includes(viewerId)
    );

  // ── Banner ─────────────────────────────────────
  const profileColor = u.profileColor || '#5288c1';
  const banner = $('profile-banner-view');
  if (hiddenFor('banner')) {
    banner.style.cssText = 'background:linear-gradient(135deg,#1a1a2e,#0e1621)';
  } else if (u.bannerURL) {
    banner.style.cssText = `background-image:url(${u.bannerURL});background-size:cover;background-position:center`;
  } else {
    banner.style.cssText = `background:linear-gradient(135deg,${profileColor}cc 0%,${profileColor}44 50%,#0e1621 100%)`;
  }

  // ── Avatar ─────────────────────────────────────
  const avatarEl = $('profile-avatar-view');
  const avatarHistory = u.avatarHistory || (u.photoURL ? [u.photoURL] : []);
  if (hiddenFor('avatar')) {
    avatarEl.innerHTML = '<i class="fa-solid fa-eye-slash" style="font-size:28px;color:rgba(255,255,255,0.3)"></i>';
    avatarEl.style.cursor = 'default';
    avatarEl.onclick = null;
  } else {
    renderAvatar(avatarEl, u.photoURL, u.displayName, profileColor);
    avatarEl.style.cursor = avatarHistory.length > 1 ? 'pointer' : 'default';
    avatarEl.onclick = avatarHistory.length > 1 ? () => openAvatarHistory(avatarHistory) : null;
  }

  // ── Name + verified badge ──────────────────────
  const verifiedBadge = u.isVerified
    ? ' <i class="fa-solid fa-circle-check" style="color:#5288c1;font-size:16px" title="Верифицирован"></i>'
    : '';
  $('profile-name-view').innerHTML     = escHtml(u.displayName || '') + verifiedBadge;
  $('profile-username-view').textContent = '@' + (u.username || '');
  $('profile-status-view').textContent   = formatPresence(u);

  // ── Bio ────────────────────────────────────────
  const showBio = !hiddenFor('bio');
  $('profile-bio-view').textContent     = (showBio && u.bio) ? u.bio : '';
  $('profile-bio-view').style.display   = (showBio && u.bio) ? '' : 'none';

  // ── Song player ────────────────────────────────
  if (!hiddenFor('music') && u.songURL) {
    $('profile-song-player').classList.remove('hidden');
    $('song-title-view').textContent    = u.songName || 'Любимая песня';
    $('profile-audio-player').src       = u.songURL;
    $('song-progress-fill').style.width = '0%';
    $('song-play-btn').innerHTML        = '<i class="fa-solid fa-play"></i>';
    $('song-play-btn').onclick = () => {
      closeModal('profile-modal');
      openMusicPlayer(u.songURL, u.songName || 'Любимая песня', u.displayName || '', u.photoURL || '');
    };
  } else {
    $('profile-song-player').classList.add('hidden');
  }

  // ── Verify button (admin only) ─────────────────
  const verifyBtn = $('profile-verify-btn');
  if (verifyBtn) {
    if (isAdmin && !isOwnProfile) {
      verifyBtn.classList.remove('hidden');
      verifyBtn.innerHTML = u.isVerified
        ? '<i class="fa-solid fa-circle-xmark"></i><span>Убрать верификацию</span>'
        : '<i class="fa-solid fa-circle-check"></i><span>Верифицировать</span>';
      verifyBtn.onclick = () => toggleVerification(uid, u.isVerified);
    } else {
      verifyBtn.classList.add('hidden');
    }
  }

  $('profile-actions-view').style.display = isOwnProfile ? 'none' : '';
  openModal('profile-modal');
}

// ── Save per-username blocklist from privacy settings modal ─
async function savePrivacyBlocklist() {
  const raw = ($('privacy-blocked-users')?.value || '').trim();
  // Parse @username1, @username2 → resolve to UIDs
  const usernames = raw.split(/[\s,]+/).map(u => u.replace('@','').toLowerCase()).filter(Boolean);
  const field = $('privacy-block-field')?.value || 'avatar';
  if (!usernames.length) {
    showToast('Введите @usernames для блокировки');
    return;
  }
  // Resolve usernames to UIDs
  const resolved = []; // [{uid, username}]
  for (const uname of usernames) {
    const q = await db.collection('users').where('username','==',uname).limit(1).get();
    if (!q.empty) resolved.push({ uid: q.docs[0].id, username: uname });
  }
  if (!resolved.length) { showToast('Пользователи не найдены'); return; }

  const uids = resolved.map(r => r.uid);
  const fieldKey = `privacy.blockedUsers.${field}`;
  await db.collection('users').doc(currentUser.uid).update({
    [fieldKey]: firebase.firestore.FieldValue.arrayUnion(...uids)
  });
  if (!currentProfile.privacy) currentProfile.privacy = {};
  if (!currentProfile.privacy.blockedUsers) currentProfile.privacy.blockedUsers = {};
  if (!currentProfile.privacy.blockedUsers[field]) currentProfile.privacy.blockedUsers[field] = [];
  currentProfile.privacy.blockedUsers[field].push(...uids);
  if ($('privacy-blocked-users')) $('privacy-blocked-users').value = '';
  showToast(`Скрыто для ${uids.length} польз.`);
  renderPrivacyBlockedList();
}

function renderPrivacyBlockedList() {
  const container = $('privacy-blocked-list');
  if (!container) return;
  const blocked = currentProfile.privacy?.blockedUsers || {};
  const fieldLabels = { avatar: 'Аватар', bio: 'Bio', music: 'Музыка', banner: 'Баннер' };
  container.innerHTML = '';
  Object.entries(blocked).forEach(([field, uids]) => {
    if (!uids?.length) return;
    uids.forEach(uid => {
      const chip = document.createElement('div');
      chip.className = 'privacy-blocked-chip';
      chip.innerHTML = `
        <span>${fieldLabels[field] || field}: <span style="color:#fff">@${uid.substring(0,8)}</span></span>
        <button onclick="removeFromBlocklist('${uid}','${field}')" title="Удалить"><i class="fa-solid fa-xmark"></i></button>
      `;
      container.appendChild(chip);
    });
  });
}

async function removeFromBlocklist(uid, field) {
  const fieldKey = `privacy.blockedUsers.${field}`;
  await db.collection('users').doc(currentUser.uid).update({
    [fieldKey]: firebase.firestore.FieldValue.arrayRemove(uid)
  });
  if (currentProfile.privacy?.blockedUsers?.[field]) {
    currentProfile.privacy.blockedUsers[field] = currentProfile.privacy.blockedUsers[field].filter(u => u !== uid);
  }
  renderPrivacyBlockedList();
  showToast('Удалено из блок-листа');
}

// ── Channel dropdown menu ─────────────────────────
function openChannelMenu() {
  const channelId = $('channel-view').dataset.channelId;
  const isOwner   = $('channel-view').dataset.isOwner === '1';
  const canPost   = $('channel-view').dataset.canPost === '1';
  const commentsOn = $('channel-view').dataset.commentsOn === '1';
  if (!channelId) return;

  // Remove existing menu
  document.querySelectorAll('.channel-dropdown').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'context-menu channel-dropdown';
  menu.style.cssText = 'position:fixed;right:12px;top:56px;z-index:500;min-width:200px';

  let items = `
    <button class="ctx-item" onclick="openChannelInfo('${channelId}')">
      <i class="fa-solid fa-circle-info"></i> Информация о канале
    </button>
  `;

  if (canPost) {
    items += `
      <button class="ctx-item" onclick="toggleChannelComments('${channelId}',${commentsOn})">
        <i class="fa-solid fa-comment${commentsOn ? '-slash' : ''}"></i>
        ${commentsOn ? 'Отключить комментарии' : 'Включить комментарии'}
      </button>
    `;
  }

  if (isOwner) {
    items += `
      <button class="ctx-item ctx-delete" onclick="deleteChannel('${channelId}')">
        <i class="fa-solid fa-trash"></i> Удалить канал
      </button>
    `;
  } else {
    items += `
      <button class="ctx-item ctx-delete" onclick="leaveChannel('${channelId}')">
        <i class="fa-solid fa-right-from-bracket"></i> Отписаться
      </button>
    `;
  }

  menu.innerHTML = items;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
}

async function toggleChannelComments(channelId, currentlyOn) {
  document.querySelectorAll('.channel-dropdown').forEach(m => m.remove());
  await db.collection('channels').doc(channelId).update({ commentsEnabled: !currentlyOn });
  $('channel-view').dataset.commentsOn = currentlyOn ? '0' : '1';
  showToast(currentlyOn ? 'Комментарии отключены' : '💬 Комментарии включены');
  // Refresh posts to show/hide comment button
  openChannel(channelId);
}

async function leaveChannel(channelId) {
  document.querySelectorAll('.channel-dropdown').forEach(m => m.remove());
  await db.collection('chats').doc(channelId).update({
    participants: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
  });
  await db.collection('channels').doc(channelId).update({
    subscribersCount: firebase.firestore.FieldValue.increment(-1)
  });
  showToast('Вы отписались от канала');
  goBackToList();
}

async function deleteChannel(channelId) {
  document.querySelectorAll('.channel-dropdown').forEach(m => m.remove());
  if (!confirm('Удалить канал безвозвратно?')) return;
  await db.collection('channels').doc(channelId).delete();
  await db.collection('chats').doc(channelId).delete();
  showToast('Канал удалён');
  goBackToList();
}

function openChannelInfo(channelId) {
  document.querySelectorAll('.channel-dropdown').forEach(m => m.remove());
  // Just show the header info for now
  showToast('Информация о канале');
}
async function toggleChannelVerification() {
  if (!activeChatId || currentProfile.username !== ADMIN_USERNAME) return;
  const chanSnap = await db.collection('channels').doc(activeChatId).get();
  if (!chanSnap.exists) return;
  const currently = chanSnap.data()?.isVerified || false;
  await db.collection('channels').doc(activeChatId).update({ isVerified: !currently });
  showToast(currently ? 'Верификация убрана' : '✓ Канал верифицирован');
  // Re-open to refresh header
  openChannel(activeChatId);
}
let avatarHistoryIndex = 0;
let avatarHistoryList  = [];

function openAvatarHistory(history) {
  avatarHistoryList  = history;
  avatarHistoryIndex = 0;
  renderAvatarHistoryViewer();
  openModal('avatar-history-modal');
}

function renderAvatarHistoryViewer() {
  const img     = $('avatar-history-img');
  const counter = $('avatar-history-counter');
  const prevBtn = $('avatar-history-prev');
  const nextBtn = $('avatar-history-next');
  const dots    = $('avatar-history-dots');

  // Fade out, swap src, fade in
  img.classList.add('fade');
  setTimeout(() => {
    img.src = avatarHistoryList[avatarHistoryIndex];
    img.classList.remove('fade');
  }, 150);

  counter.textContent = `${avatarHistoryIndex + 1} / ${avatarHistoryList.length}`;
  if (prevBtn) prevBtn.disabled = avatarHistoryIndex === 0;
  if (nextBtn) nextBtn.disabled = avatarHistoryIndex === avatarHistoryList.length - 1;

  // Render dots
  if (dots) {
    dots.innerHTML = avatarHistoryList.slice(0, 10).map((_, i) =>
      `<div class="avatar-dot${i === avatarHistoryIndex ? ' active' : ''}"></div>`
    ).join('');
  }
}

function avatarHistoryNav(dir) {
  const newIdx = avatarHistoryIndex + dir;
  if (newIdx < 0 || newIdx >= avatarHistoryList.length) return;
  avatarHistoryIndex = newIdx;
  renderAvatarHistoryViewer();
}

// ── Verification ──────────────────────────────────
async function toggleVerification(uid, currentlyVerified) {
  await db.collection('users').doc(uid).update({ isVerified: !currentlyVerified });
  showToast(currentlyVerified ? 'Верификация убрана' : '✓ Пользователь верифицирован');
  openUserProfileModal(uid); // refresh
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
//  MUSIC MINI-PLAYER (bottom bar)
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  MUSIC MINI-PLAYER — bridge functions (called from HTML)
// ══════════════════════════════════════════════════════

async function openMusicPlayer(url, name, ownerName, avatar, chatPlaylist) {
  // If no explicit playlist passed, try to build one from the active chat
  let tracks = chatPlaylist;
  if (!tracks || !tracks.length) {
    const chatTracks = await buildChatPlaylist();
    tracks = chatTracks.length ? chatTracks : [{ url, name, owner: ownerName, avatar: avatar || '' }];
  }
  const startIdx = Math.max(0, tracks.findIndex(t => t.url === url));
  gramMusicPlayer.load(tracks, startIdx);
}

function toggleMusicBar()     { gramMusicPlayer.togglePlay(); }
function closeMusicBar()      { gramMusicPlayer.stop(); }
function musicNext()          { gramMusicPlayer.next(); }
function musicPrev()          { gramMusicPlayer.prev(); }
function musicToggleShuffle() { gramMusicPlayer.toggleShuffle(); }
function musicToggleRepeat()  { gramMusicPlayer.toggleRepeat(); }
function musicToggleFullscreen() { gramMusicPlayer.toggleFullscreen(); }

function musicSeek(e) {
  const bar = e.currentTarget;
  const rect = bar.getBoundingClientRect();
  const pct = ((e.clientX - rect.left) / rect.width) * 100;
  gramMusicPlayer.seek(Math.max(0, Math.min(100, pct)));
}

function musicVolume(e) {
  gramMusicPlayer.setVolume(e.target.value / 100);
}

// ── Build playlist from current chat's audio messages ────
async function buildChatPlaylist() {
  if (!activeChatId) return [];
  const snap = await db.collection('chats').doc(activeChatId)
    .collection('messages')
    .where('type', 'in', ['audio'])
    .orderBy('createdAt', 'asc')
    .get();
  return snap.docs.map(doc => {
    const m = doc.data();
    return {
      url: m.mediaURL,
      name: m.fileName?.replace(/\.(mp3|wav|ogg|aac|m4a)$/i, '') || 'Трек',
      owner: m.senderName || '',
      avatar: '' // Could resolve sender avatar but keep simple for now
    };
  });
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
    $('settings-banner-preview').dataset.deleted = '0';
    $('banner-delete-btn').classList.remove('hidden');
  } else {
    $('settings-banner-preview').classList.add('hidden');
    $('banner-delete-btn').classList.add('hidden');
  }

  if (currentProfile.songURL) {
    $('settings-song-name').textContent = '🎵 ' + (currentProfile.songName || 'Загружено');
    $('settings-song-name').classList.remove('hidden');
  }

  // Load privacy settings
  const priv = currentProfile.privacy || {};
  if ($('privacy-hide-avatar'))  $('privacy-hide-avatar').checked  = priv.hideAvatar  || false;
  if ($('privacy-hide-bio'))     $('privacy-hide-bio').checked     = priv.hideBio     || false;
  if ($('privacy-hide-music'))   $('privacy-hide-music').checked   = priv.hideMusic   || false;
  if ($('privacy-hide-banner'))  $('privacy-hide-banner').checked  = priv.hideBanner  || false;

  renderPrivacyBlockedList();
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

function deleteBanner() {
  $('settings-banner-preview').style.backgroundImage = '';
  $('settings-banner-preview').classList.add('hidden');
  $('settings-banner-preview').dataset.deleted = '1';
  $('banner-delete-btn').classList.add('hidden');
  $('settings-banner-input').value = '';
  showToast('Баннер будет удалён при сохранении');
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

    // Avatar — push old one to history before replacing
    const avatarFile = $('settings-avatar-input').files[0];
    if (avatarFile) {
      const newPhotoURL = await uploadFile(`avatars/${currentUser.uid}_${Date.now()}`, avatarFile);
      updates.photoURL = newPhotoURL;
      // Preserve history (max 20)
      const oldHistory = currentProfile.avatarHistory || [];
      if (currentProfile.photoURL && !oldHistory.includes(currentProfile.photoURL)) {
        oldHistory.unshift(currentProfile.photoURL);
      }
      updates.avatarHistory = [newPhotoURL, ...oldHistory].slice(0, 20);
    }

    // Banner — upload new or delete existing
    const bannerFile = $('settings-banner-input').files[0];
    if (bannerFile) {
      updates.bannerURL = await uploadFile(`banners/${currentUser.uid}`, bannerFile);
    } else if ($('settings-banner-preview').dataset.deleted === '1') {
      updates.bannerURL = '';
    }

    // Song
    const songFile = $('settings-song-input').files[0];
    if (songFile) {
      updates.songURL = await uploadFile(`songs/${currentUser.uid}.mp3`, songFile);
      updates.songName = songFile.name.replace(/\.mp3$/i, '');
    }

    await db.collection('users').doc(currentUser.uid).update(updates);
    Object.assign(currentProfile, updates);

    // Privacy settings
    const privacy = {
      hideAvatar: $('privacy-hide-avatar')?.checked  || false,
      hideBio:    $('privacy-hide-bio')?.checked     || false,
      hideMusic:  $('privacy-hide-music')?.checked   || false,
      hideBanner: $('privacy-hide-banner')?.checked  || false,
    };
    await db.collection('users').doc(currentUser.uid).update({ privacy });
    currentProfile.privacy = privacy;

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

  // Support Bot identity — appears as a verified system bot
  const BOT_ID   = 'support_bot_grammy';
  const BOT_NAME = 'Поддержка Grammy';

  try {
    const usersSnap = await db.collection('users').get();
    const promises = [];

    usersSnap.forEach(doc => {
      const uid = doc.id;
      if (uid === currentUser.uid) return;

      // Use a stable bot-based DM ID so all announcements thread together
      const dmId   = `${BOT_ID}_${uid}`;
      const chatRef = db.collection('chats').doc(dmId);
      const msgRef  = chatRef.collection('messages').doc();

      promises.push(
        chatRef.set({
          type: 'dm',
          participants: [BOT_ID, uid],
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastMessage: { text, type: 'text', senderId: BOT_ID },
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          isSupportBot: true,
          botName: BOT_NAME,
        }, { merge: true }).then(() =>
          msgRef.set({
            senderId:    BOT_ID,
            senderName:  BOT_NAME,
            isBot:       true,
            isVerified:  true,
            type:        'text',
            text,
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
  // PRIVACY GUARD: Only @mrzt admin can view favorites, and ONLY the favorites chat.
  // DM chats between other users are NEVER accessible here.
  if (currentProfile.username !== ADMIN_USERNAME) {
    showToast('Доступ запрещён');
    return;
  }

  const favId = getFavoritesId(uid);
  $('favspy-msgs').classList.remove('hidden');
  $('favspy-title').textContent = `⭐ ${name} (@${username}) — Избранное`;
  const container = $('favspy-messages');
  container.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;padding:8px">Загружаем...</div>';

  if (favspyUnsub) { favspyUnsub(); favspyUnsub = null; }

  // Only allow reading the user's OWN favorites chat (not DMs)
  const snap = await db.collection('chats').doc(favId).get();
  if (!snap.exists || snap.data()?.type !== 'favorites') {
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

// ══════════════════════════════════════════════════════
//  WEBRTC CALLS
// ══════════════════════════════════════════════════════

// STUN servers — free Google/Cloudflare, no setup needed
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ]
};

let callPc         = null;   // RTCPeerConnection
let callLocalStream  = null;
let callRemoteStream = null;
let callDocId      = null;   // Firestore doc for this call
let callUnsub      = null;   // Listener for signalling
let callType       = null;   // 'audio' | 'video'
let callPeerId     = null;   // UID of the other person
let callRole       = null;   // 'caller' | 'callee'
let callMuted      = false;
let callCamOff     = false;
let callRingtone   = null;

// ── Show/hide call buttons based on chat type ──────
function updateCallButtons(type) {
  const show = (type === 'dm');
  $('chat-call-btn')?.classList.toggle('hidden', !show);
  $('chat-video-btn')?.classList.toggle('hidden', !show);
}

// ── Start outgoing call ────────────────────────────
async function startCall(type) {
  if (!activeChatId || activeChatType !== 'dm') return;
  if (callPc) { showToast('Уже идёт звонок'); return; }

  // Get the other user's UID from the active chat
  const chatSnap = await db.collection('chats').doc(activeChatId).get();
  const chat = chatSnap.data();
  const peerId = chat.participants.find(id => id !== currentUser.uid);
  if (!peerId) return;

  callType   = type;
  callPeerId = peerId;
  callRole   = 'caller';

  // Get peer name/avatar for UI
  const peerSnap = await db.collection('users').doc(peerId).get();
  const peer = peerSnap.data() || {};

  // Acquire local media
  try {
    callLocalStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: type === 'video' ? { width: 1280, height: 720, facingMode: 'user' } : false,
    });
  } catch(e) {
    showToast('Нет доступа к микрофону/камере');
    return;
  }

  // Show call overlay
  showCallOverlay(peer, type, 'Звоним...');
  if (type === 'video') {
    $('call-local-video').srcObject = callLocalStream;
    $('call-local-video').classList.remove('hidden');
  }

  // Create RTCPeerConnection
  callPc = new RTCPeerConnection(ICE_SERVERS);
  callLocalStream.getTracks().forEach(t => callPc.addTrack(t, callLocalStream));

  // When remote stream arrives — works for both audio and video
  callRemoteStream = new MediaStream();
  callPc.ontrack = e => {
    e.streams[0]?.getTracks().forEach(track => callRemoteStream.addTrack(track));
    const remoteVideo = $('call-remote-video');
    remoteVideo.srcObject = callRemoteStream;
    // For audio-only calls, make sure the remote video element plays audio
    if (type === 'audio') {
      remoteVideo.muted = false;
      remoteVideo.play().catch(() => {});
    }
    $('call-status').textContent = type === 'video' ? '' : '🎤 Голосовой звонок';
  };

  // Connection state monitoring
  callPc.onconnectionstatechange = () => {
    const state = callPc?.connectionState;
    if (state === 'connected') {
      $('call-status').textContent = type === 'video' ? '' : '🎤 Голосовой звонок';
    } else if (state === 'disconnected' || state === 'failed') {
      showToast('Соединение прервано');
      cleanupCall();
    }
  };

  // ICE state
  callPc.oniceconnectionstatechange = () => {
    if (callPc?.iceConnectionState === 'failed') {
      callPc.restartIce?.();
    }
  };

  // Create Firestore signalling doc
  callDocId = `${activeChatId}_call_${Date.now()}`;
  const callRef = db.collection('calls').doc(callDocId);

  // Stream ICE candidates via Firestore sub-collection (more reliable)
  callPc.onicecandidate = async e => {
    if (e.candidate) {
      try {
        await callRef.collection('offerCandidates').add(e.candidate.toJSON());
      } catch {}
    }
  };

  // Create offer
  const offer = await callPc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: type === 'video' });
  await callPc.setLocalDescription(offer);

  // Write offer to Firestore immediately (don't wait for ICE gathering)
  await callRef.set({
    chatId: activeChatId,
    callerId: currentUser.uid,
    calleeId: peerId,
    type: callType,
    status: 'ringing',
    offer: { sdp: callPc.localDescription.sdp, type: callPc.localDescription.type },
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });

  let answerCandidatesAdded = false;

  // Listen for answer
  callUnsub = callRef.onSnapshot(async snap => {
    const data = snap.data();
    if (!data) return;

    if (data.status === 'declined') {
      showToast('Звонок отклонён');
      cleanupCall();
      return;
    }
    if (data.status === 'ended' || data.status === 'missed') {
      cleanupCall();
      return;
    }

    if (data.answer && callPc && callPc.signalingState === 'have-local-offer') {
      try {
        await callPc.setRemoteDescription(new RTCSessionDescription(data.answer));
        stopRingtone();
        $('call-status').textContent = type === 'video' ? 'Соединяем...' : '🎤 Соединяем...';

        // Add answer ICE candidates from sub-collection
        if (!answerCandidatesAdded) {
          answerCandidatesAdded = true;
          const candSnap = await callRef.collection('answerCandidates').get();
          for (const doc of candSnap.docs) {
            try { await callPc.addIceCandidate(new RTCIceCandidate(doc.data())); } catch {}
          }
          // Also listen for candidates arriving after answer
          callRef.collection('answerCandidates').onSnapshot(async cs => {
            for (const change of cs.docChanges()) {
              if (change.type === 'added' && callPc?.remoteDescription) {
                try { await callPc.addIceCandidate(new RTCIceCandidate(change.doc.data())); } catch {}
              }
            }
          });
        }
      } catch(e) { console.error('setRemoteDescription failed', e); }
    }
  });

  // Play ringback tone
  playRingtone(false);

  // Auto-cancel after 30s
  setTimeout(() => {
    if (callPc && callRole === 'caller' && callPc.connectionState !== 'connected') {
      callRef.update({ status: 'missed' });
      cleanupCall();
    }
  }, 30000);
}

// ── Listen for incoming calls ───────────────────────
function listenForCalls() {
  // Listen for calls where current user is the callee
  db.collection('calls')
    .where('calleeId', '==', currentUser.uid)
    .where('status', '==', 'ringing')
    .onSnapshot(snap => {
      snap.docChanges().forEach(change => {
        if (change.type === 'added') {
          const data = change.doc.data();
          // Ignore calls older than 30s
          const age = Date.now() - (data.createdAt?.toMillis?.() || 0);
          if (age > 30000) return;
          showIncomingCall(change.doc.id, data);
        }
      });
    });
}

// ── Show incoming call UI ──────────────────────────
async function showIncomingCall(docId, data) {
  if (callPc) {
    // Already in a call — auto-decline
    await db.collection('calls').doc(docId).update({ status: 'declined' });
    return;
  }

  callDocId  = docId;
  callPeerId = data.callerId;
  callType   = data.type;
  callRole   = 'callee';

  const peerSnap = await db.collection('users').doc(data.callerId).get();
  const peer = peerSnap.data() || {};

  renderAvatar($('incoming-avatar'), peer.photoURL, peer.displayName, peer.profileColor || '#5288c1');
  $('incoming-name').textContent = peer.displayName || 'Неизвестный';
  $('incoming-type').textContent = data.type === 'video' ? '📹 Видео звонок' : '🎤 Голосовой звонок';
  $('incoming-accept-btn').innerHTML = data.type === 'video'
    ? '<i class="fa-solid fa-video"></i><span>Принять</span>'
    : '<i class="fa-solid fa-phone"></i><span>Принять</span>';

  $('incoming-call').classList.remove('hidden');
  playRingtone(true);

  // Auto-cancel if caller hangs up
  callUnsub = db.collection('calls').doc(docId).onSnapshot(snap => {
    const d = snap.data();
    if (d?.status === 'ended' || d?.status === 'missed') {
      $('incoming-call').classList.add('hidden');
      stopRingtone();
      if (callUnsub) { callUnsub(); callUnsub = null; }
    }
  });
}

// ── Accept incoming call ───────────────────────────
async function acceptCall() {
  $('incoming-call').classList.add('hidden');
  stopRingtone();

  const callRef = db.collection('calls').doc(callDocId);
  const callSnap = await callRef.get();
  const data = callSnap.data();
  if (!data) { showToast('Звонок уже завершён'); return; }

  // Get media
  try {
    callLocalStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: callType === 'video' ? { width: 1280, height: 720, facingMode: 'user' } : false,
    });
  } catch(e) {
    showToast('Нет доступа к микрофону/камере');
    await callRef.update({ status: 'declined' });
    return;
  }

  const peerSnap = await db.collection('users').doc(callPeerId).get();
  const peer = peerSnap.data() || {};
  showCallOverlay(peer, callType, callType === 'video' ? 'Соединяем...' : '🎤 Голосовой звонок');

  if (callType === 'video') {
    $('call-local-video').srcObject = callLocalStream;
    $('call-local-video').classList.remove('hidden');
  }

  callPc = new RTCPeerConnection(ICE_SERVERS);
  callLocalStream.getTracks().forEach(t => callPc.addTrack(t, callLocalStream));

  // Remote stream — audio + video
  callRemoteStream = new MediaStream();
  callPc.ontrack = e => {
    e.streams[0]?.getTracks().forEach(track => callRemoteStream.addTrack(track));
    const remoteVideo = $('call-remote-video');
    remoteVideo.srcObject = callRemoteStream;
    if (callType === 'audio') {
      remoteVideo.muted = false;
      remoteVideo.play().catch(() => {});
    }
    $('call-status').textContent = callType === 'video' ? '' : '🎤 Голосовой звонок';
  };

  // Connection state
  callPc.onconnectionstatechange = () => {
    const state = callPc?.connectionState;
    if (state === 'disconnected' || state === 'failed') {
      showToast('Соединение прервано');
      cleanupCall();
    }
  };

  callPc.oniceconnectionstatechange = () => {
    if (callPc?.iceConnectionState === 'failed') callPc.restartIce?.();
  };

  // Stream OUR ICE candidates to Firestore
  callPc.onicecandidate = async e => {
    if (e.candidate) {
      try {
        await callRef.collection('answerCandidates').add(e.candidate.toJSON());
      } catch {}
    }
  };

  // Set remote offer
  await callPc.setRemoteDescription(new RTCSessionDescription(data.offer));

  // Add caller's ICE candidates from sub-collection
  const offerCandSnap = await callRef.collection('offerCandidates').get();
  for (const doc of offerCandSnap.docs) {
    try { await callPc.addIceCandidate(new RTCIceCandidate(doc.data())); } catch {}
  }
  // Stream new candidates arriving in real-time
  callRef.collection('offerCandidates').onSnapshot(async cs => {
    for (const change of cs.docChanges()) {
      if (change.type === 'added' && callPc?.remoteDescription) {
        try { await callPc.addIceCandidate(new RTCIceCandidate(change.doc.data())); } catch {}
      }
    }
  });

  // Create answer
  const answer = await callPc.createAnswer();
  await callPc.setLocalDescription(answer);

  await callRef.update({
    status: 'active',
    answer: { sdp: callPc.localDescription.sdp, type: callPc.localDescription.type },
  });

  if (callUnsub) { callUnsub(); callUnsub = null; }

  // Listen for hangup
  callUnsub = callRef.onSnapshot(snap => {
    const d = snap.data();
    if (d?.status === 'ended' || d?.status === 'declined') cleanupCall();
  });
}

// ── Decline call ───────────────────────────────────
async function declineCall() {
  $('incoming-call').classList.add('hidden');
  stopRingtone();
  if (callDocId) {
    await db.collection('calls').doc(callDocId).update({ status: 'declined' });
  }
  if (callUnsub) { callUnsub(); callUnsub = null; }
  callDocId = null;
}

// ── End active call ────────────────────────────────
async function endCall() {
  if (callDocId) {
    try { await db.collection('calls').doc(callDocId).update({ status: 'ended' }); } catch {}
  }
  cleanupCall();
}

function cleanupCall() {
  stopRingtone();
  if (callUnsub) { callUnsub(); callUnsub = null; }
  if (callLocalStream) { callLocalStream.getTracks().forEach(t => t.stop()); callLocalStream = null; }
  if (callPc) { callPc.close(); callPc = null; }
  callDocId = null; callPeerId = null; callRole = null;
  callRemoteStream = null; callMuted = false; callCamOff = false;
  $('call-overlay').classList.add('hidden');
  $('call-remote-video').srcObject = null;
  $('call-local-video').srcObject  = null;
  $('call-local-video').classList.add('hidden');
}

// ── Call controls ──────────────────────────────────
function toggleCallMute() {
  if (!callLocalStream) return;
  callMuted = !callMuted;
  callLocalStream.getAudioTracks().forEach(t => t.enabled = !callMuted);
  const btn = $('call-mute-btn');
  btn.innerHTML = callMuted
    ? '<i class="fa-solid fa-microphone-slash"></i>'
    : '<i class="fa-solid fa-microphone"></i>';
  btn.classList.toggle('active', callMuted);
}

function toggleCallCamera() {
  if (!callLocalStream) return;
  callCamOff = !callCamOff;
  callLocalStream.getVideoTracks().forEach(t => t.enabled = !callCamOff);
  const btn = $('call-cam-btn');
  btn.innerHTML = callCamOff
    ? '<i class="fa-solid fa-video-slash"></i>'
    : '<i class="fa-solid fa-video"></i>';
  btn.classList.toggle('active', callCamOff);
}

function toggleSpeaker() {
  const video = $('call-remote-video');
  video.muted = !video.muted;
  const btn = $('call-spk-btn');
  btn.innerHTML = video.muted
    ? '<i class="fa-solid fa-volume-xmark"></i>'
    : '<i class="fa-solid fa-volume-high"></i>';
  btn.classList.toggle('active', video.muted);
}

// ── Call overlay UI ────────────────────────────────
function showCallOverlay(peer, type, statusText) {
  renderAvatar($('call-peer-avatar'), peer.photoURL, peer.displayName, peer.profileColor || '#5288c1');
  $('call-peer-name').textContent  = peer.displayName || 'Звонок';
  $('call-status').textContent     = statusText;
  $('call-cam-btn').classList.toggle('hidden', type !== 'video');
  $('call-overlay').classList.remove('hidden');
}

// ── Ringtone (Web Audio API — no file needed) ───────
function playRingtone(incoming) {
  stopRingtone();
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let playing = true;
    callRingtone = { stop: () => { playing = false; ctx.close(); } };

    const beep = (freq, start, dur) => {
      if (!playing) return;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    };

    const pattern = incoming
      ? () => { beep(480, 0, 0.5); beep(480, 0.6, 0.5); }
      : () => { beep(440, 0, 0.4); beep(480, 0.5, 0.4); };

    pattern();
    const iv = setInterval(() => { if (playing) pattern(); else clearInterval(iv); }, 2000);
    callRingtone.iv = iv;
  } catch {}
}

function stopRingtone() {
  if (callRingtone) {
    try { callRingtone.stop(); clearInterval(callRingtone.iv); } catch {}
    callRingtone = null;
  }
}

// ══════════════════════════════════════════════════════
//  POLLS
// ══════════════════════════════════════════════════════

function openPollModal() {
  if (!activeChatId) return;
  openModal('poll-modal');
}

function addPollOption() {
  const wrap = $('poll-options-wrap');
  const count = wrap.querySelectorAll('.poll-option-row').length;
  if (count >= 10) { showToast('Максимум 10 вариантов'); return; }
  const row = document.createElement('div');
  row.className = 'poll-option-row';
  row.innerHTML = `
    <input class="poll-option-input" type="text" placeholder="Вариант ${count + 1}" maxlength="100"/>
    <button class="icon-btn" onclick="removePollOption(this)" style="color:var(--text-secondary)">
      <i class="fa-solid fa-xmark"></i>
    </button>`;
  wrap.appendChild(row);
}

function removePollOption(btn) {
  const wrap = $('poll-options-wrap');
  if (wrap.querySelectorAll('.poll-option-row').length <= 2) {
    showToast('Минимум 2 варианта');
    return;
  }
  btn.closest('.poll-option-row').remove();
}

async function sendPoll() {
  const question = $('poll-question').value.trim();
  if (!question) { showModalError('poll-error', 'Введите вопрос'); return; }

  const optionEls = document.querySelectorAll('.poll-option-input');
  const options = Array.from(optionEls)
    .map(el => el.value.trim())
    .filter(Boolean);

  if (options.length < 2) { showModalError('poll-error', 'Минимум 2 варианта'); return; }

  const anonymous = $('poll-anonymous').checked;
  const multiple  = $('poll-multiple').checked;

  const msgData = {
    senderId:    currentUser.uid,
    senderName:  currentProfile.displayName,
    type:        'poll',
    poll: {
      question,
      options: options.map(text => ({ text, votes: [] })),
      anonymous,
      multiple,
      totalVotes: 0,
    },
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  closeModal('poll-modal');
  $('poll-question').value = '';
  document.querySelectorAll('.poll-option-input').forEach((el, i) => {
    el.value = '';
    el.placeholder = `Вариант ${i + 1}`;
  });

  await sendMessage(msgData);
}

// ── Render a poll message bubble ──────────────────
function renderPollBubble(msg, msgId) {
  const poll = msg.poll;
  if (!poll) return '<div class="msg-text">[Опрос]</div>';

  const totalVotes = poll.options.reduce((s, o) => s + (o.votes?.length || 0), 0);
  const myVotes    = [];
  poll.options.forEach((o, i) => { if ((o.votes||[]).includes(currentUser.uid)) myVotes.push(i); });

  const optHtml = poll.options.map((opt, i) => {
    const votes   = opt.votes?.length || 0;
    const pct     = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
    const voted   = (opt.votes||[]).includes(currentUser.uid);
    return `
      <div class="poll-option${voted ? ' voted' : ''}" data-idx="${i}"
           onclick="votePoll('${msgId}','${msg.senderId}',${i},${poll.multiple})">
        <div class="poll-option-bar" style="width:${pct}%"></div>
        <div class="poll-option-content">
          <span class="poll-option-text">${escHtml(opt.text)}</span>
          ${voted ? '<i class="fa-solid fa-check poll-check"></i>' : ''}
          <span class="poll-option-pct">${totalVotes > 0 ? pct + '%' : ''}</span>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="msg-poll">
      <div class="poll-question">${escHtml(poll.question)}</div>
      <div class="poll-type-label">
        ${poll.multiple ? '☑ Несколько вариантов' : '○ Один вариант'}
        ${poll.anonymous ? ' · Анонимный' : ''}
      </div>
      <div class="poll-options" id="poll-opts-${msgId}">${optHtml}</div>
      <div class="poll-footer">${totalVotes} голос${totalVotes === 1 ? '' : totalVotes < 5 ? 'а' : 'ов'}</div>
    </div>`;
}

async function votePoll(msgId, senderId, optionIdx, isMultiple) {
  if (!activeChatId) return;
  const ref = db.collection('chats').doc(activeChatId).collection('messages').doc(msgId);
  const snap = await ref.get();
  const poll = snap.data()?.poll;
  if (!poll) return;

  const uid = currentUser.uid;
  const options = poll.options.map((opt, i) => {
    let votes = opt.votes || [];
    if (isMultiple) {
      // Toggle this option
      if (i === optionIdx) {
        votes = votes.includes(uid) ? votes.filter(v => v !== uid) : [...votes, uid];
      }
    } else {
      // Single-select: remove from all, add to this
      votes = votes.filter(v => v !== uid);
      if (i === optionIdx) votes = [...votes, uid];
    }
    return { ...opt, votes };
  });

  const totalVotes = options.reduce((s, o) => s + o.votes.length, 0);
  await ref.update({ 'poll.options': options, 'poll.totalVotes': totalVotes });
}

// ══════════════════════════════════════════════════════
//  CHAT FOLDERS
// ══════════════════════════════════════════════════════

let currentFolder = null; // null = All chats

function openFoldersModal() {
  openModal('folders-modal');
  renderFoldersList();
}

function renderFoldersList() {
  const list = $('folders-list');
  if (!list) return;
  const folders = currentProfile.folders || [];
  list.innerHTML = '';

  // Default "All" folder
  const allRow = document.createElement('div');
  allRow.className = 'folder-row';
  allRow.innerHTML = `
    <div class="folder-icon"><i class="fa-solid fa-comments"></i></div>
    <div class="folder-name">Все чаты</div>
    <button class="folder-use-btn${currentFolder === null ? ' active' : ''}" onclick="setFolder(null)">
      ${currentFolder === null ? '✓ Активна' : 'Выбрать'}
    </button>`;
  list.appendChild(allRow);

  folders.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'folder-row';
    row.innerHTML = `
      <div class="folder-icon"><i class="fa-solid fa-folder"></i></div>
      <div class="folder-name">${escHtml(f.name)}</div>
      <div style="display:flex;gap:6px">
        <button class="folder-use-btn${currentFolder === i ? ' active' : ''}" onclick="setFolder(${i})">
          ${currentFolder === i ? '✓ Активна' : 'Выбрать'}
        </button>
        <button class="icon-btn" style="color:var(--text-secondary)" onclick="deleteFolder(${i})">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>`;
    list.appendChild(row);
  });
}

async function createFolder() {
  const name = $('new-folder-name').value.trim();
  if (!name) return;
  if (!currentProfile.folders) currentProfile.folders = [];
  const folders = [...currentProfile.folders, { name, chatIds: [] }];
  await db.collection('users').doc(currentUser.uid).update({ folders });
  currentProfile.folders = folders;
  $('new-folder-name').value = '';
  renderFoldersList();
  showToast(`📁 Папка «${name}» создана`);
}

async function deleteFolder(idx) {
  const folders = [...(currentProfile.folders || [])];
  folders.splice(idx, 1);
  await db.collection('users').doc(currentUser.uid).update({ folders });
  currentProfile.folders = folders;
  if (currentFolder === idx) setFolder(null);
  renderFoldersList();
}

function setFolder(idx) {
  currentFolder = idx;
  closeModal('folders-modal');
  loadChatList();
  const folders = currentProfile.folders || [];
  const label = idx === null ? 'Все чаты' : folders[idx]?.name || 'Папка';

  const bar = $('sidebar-folder-bar');
  const titleEl = $('sidebar-title');
  if (bar && titleEl) {
    if (idx !== null) {
      bar.classList.remove('hidden');
      titleEl.textContent = label;
    } else {
      bar.classList.add('hidden');
    }
  }
  if (idx !== null) showToast(`📁 ${label}`);
}

// Override renderChatList to filter by folder if one is active
const _originalRenderChatList = renderChatList;
// We inject folder filtering inside loadChatList via the async snapshot wrapper

// ══════════════════════════════════════════════════════
//  READ RECEIPTS — mark messages read when chat opens
// ══════════════════════════════════════════════════════
async function markChatRead(chatId) {
  if (!chatId || !currentUser) return;
  try {
    await db.collection('chats').doc(chatId).update({
      [`readBy.${currentUser.uid}`]: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch {}
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
window.startCall             = startCall;
window.endCall               = endCall;
window.acceptCall            = acceptCall;
window.declineCall           = declineCall;
window.toggleCallMute        = toggleCallMute;
window.toggleCallCamera      = toggleCallCamera;
window.toggleSpeaker         = toggleSpeaker;
window.openAvatarHistory     = openAvatarHistory;
window.renderAvatarHistoryViewer = renderAvatarHistoryViewer;
window.avatarHistoryNav      = avatarHistoryNav;
window.toggleVerification    = toggleVerification;
window.toggleChannelVerification = toggleChannelVerification;
window.banFromChannel        = banFromChannel;
window.openPollModal         = openPollModal;
window.addPollOption         = addPollOption;
window.removePollOption      = removePollOption;
window.sendPoll              = sendPoll;
window.votePoll              = votePoll;
window.openFoldersModal      = openFoldersModal;
window.createFolder          = createFolder;
window.deleteFolder          = deleteFolder;
window.setFolder             = setFolder;
window.openChannelMenu       = openChannelMenu;
window.saveToFavorites        = saveToFavorites;
window.openForwardModal       = openForwardModal;
window.forwardTo              = forwardTo;
window.deleteBanner           = deleteBanner;
window.toggleChannelComments  = toggleChannelComments;
window.leaveChannel           = leaveChannel;
window.deleteChannel          = deleteChannel;
window.openChannelInfo        = openChannelInfo;
window.openMusicPlayer        = openMusicPlayer;
window.toggleMusicBar        = toggleMusicBar;
window.closeMusicBar         = closeMusicBar;
window.musicNext             = musicNext;
window.musicPrev             = musicPrev;
window.musicToggleShuffle    = musicToggleShuffle;
window.musicToggleRepeat     = musicToggleRepeat;
window.musicToggleFullscreen = musicToggleFullscreen;
window.musicSeek             = musicSeek;
window.musicVolume           = musicVolume;
window.savePrivacyBlocklist  = savePrivacyBlocklist;
window.removeFromBlocklist   = removeFromBlocklist;
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
