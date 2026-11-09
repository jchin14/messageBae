const { app, BrowserWindow, Menu, Tray, Notification, shell, session, ipcMain, screen, systemPreferences, dialog } = require('electron');
const fs = require('fs');
const { execFile, execFileSync } = require('child_process');
const path = require('path');

const HOME = 'https://www.facebook.com/messages';
const PARTITION = 'persist:messenger';
let win;
let tray;

// Track focus from launch, to tell whether the user moved on while we loaded.
// lsappinfo covers launches from Terminal, where we never become active.
const frontApp = () => {
  try { return execFileSync('lsappinfo', ['front'], { encoding: 'utf8' }).trim(); } catch { return ''; }
};
const launchFront = frontApp();
let appActive = false;
let leftAfterLaunch = false;
app.on('did-become-active', () => { appActive = true; });
app.on('did-resign-active', () => { if (appActive) leftAfterLaunch = true; appActive = false; });

// Settings: defaults.json merged with the user's settings.json in
// ~/Library/Application Support/<app>/ (created on first run).
const DEFAULTS = require('./defaults.json');
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  const file = settingsPath();
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(DEFAULTS, null, 2) + '\n');
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Ignoring invalid ${file}: ${err.message}`);
  }
  return {
    showBadge: user.showBadge ?? DEFAULTS.showBadge,
    showMenuBarIcon: user.showMenuBarIcon ?? DEFAULTS.showMenuBarIcon,
    openInBackground: user.openInBackground ?? DEFAULTS.openInBackground,
    openLinksInBrowser: user.openLinksInBrowser ?? DEFAULTS.openLinksInBrowser,
    windowBounds: user.windowBounds || null,
    rememberWindowSize: user.rememberWindowSize ?? DEFAULTS.rememberWindowSize,
    notifications: ['messenger', 'messagebae', 'off'].includes(user.notifications) ? user.notifications : DEFAULTS.notifications,
    notificationSound: user.notificationSound || DEFAULTS.notificationSound,
    silenceMessengerSound: user.silenceMessengerSound ?? DEFAULTS.silenceMessengerSound,
    lastWindowBounds: user.lastWindowBounds || null,
    shortcuts: { ...DEFAULTS.shortcuts, ...user.shortcuts },
  };
}

// Save one top-level setting without touching the rest of the file.
function saveSetting(key, value) {
  const file = settingsPath();
  let user = {};
  try { user = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  user[key] = value;
  fs.writeFileSync(file, JSON.stringify(user, null, 2) + '\n');
}

// Does a key press match an accelerator like "Cmd+Shift+M"?
function matchesAccelerator(acc, input) {
  if (!acc) return false;
  const parts = acc.toLowerCase().split('+');
  const key = parts.pop();
  const has = (...names) => names.some((n) => parts.includes(n));
  // Compare the physical key (KeyM, Digit1) too: with Cmd or Shift held,
  // input.key can come through as something else.
  const code = (input.code || '').toLowerCase().replace(/^(key|digit)/, '');
  return (input.key.toLowerCase() === key || code === key)
    && input.meta === has('cmd', 'command', 'cmdorctrl', 'commandorcontrol')
    && input.control === has('ctrl', 'control')
    && input.shift === has('shift')
    && input.alt === has('alt', 'option');
}

// Badge: unread count minus what was there at the last "Clear Badge".
// The cleared count is saved so it survives a restart.
const statePath = () => path.join(app.getPath('userData'), 'state.json');
function loadBadgeBase() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')).badgeBase || 0; } catch { return 0; }
}
function saveBadgeBase() {
  try { fs.writeFileSync(statePath(), JSON.stringify({ badgeBase }) + '\n'); } catch {}
}
let unread = 0;
let badgeBase = loadBadgeBase();
// The title shows no count while the page loads, so wait before
// treating a lower count as "messages were read".
let badgeSettled = false;
// Facebook drops the count from the title for a moment (reloads, the
// "X messaged you" title flash), so only lower the base once a lower
// count has held for 10 seconds.
let lowerTimer = null;
function updateBadge() {
  if (badgeSettled && unread < badgeBase) {
    if (!lowerTimer) lowerTimer = setTimeout(() => {
      lowerTimer = null;
      if (unread < badgeBase) { badgeBase = unread; saveBadgeBase(); updateBadge(); }
    }, 10000);
  } else if (lowerTimer) { clearTimeout(lowerTimer); lowerTimer = null; }
  const n = unread - badgeBase;
  const text = settings.showBadge && n > 0 ? String(n) : '';
  app.dock.setBadge(text);
  if (tray) tray.setTitle(text && ` ${text}`);
}
function clearBadge() {
  badgeBase = unread;
  saveBadgeBase();
  updateBadge();
}
function toggleBadge(item) {
  settings.showBadge = item.checked;
  saveSetting('showBadge', item.checked);
  updateBadge();
  buildMenu();
}
const badgeItems = () => [
  { label: 'Clear Badge', accelerator: settings.shortcuts.clearBadge, click: clearBadge },
  { label: 'Show Badge Count', type: 'checkbox', checked: settings.showBadge, click: toggleBadge },
  {
    label: 'Show Menu Bar Icon',
    type: 'checkbox',
    checked: settings.showMenuBarIcon,
    click: (item) => {
      settings.showMenuBarIcon = item.checked;
      saveSetting('showMenuBarIcon', item.checked);
      updateTray();
      buildMenu();
    },
  },
  {
    label: 'Open Facebook Links in Browser',
    type: 'checkbox',
    checked: settings.openLinksInBrowser,
    click: (item) => {
      settings.openLinksInBrowser = item.checked;
      saveSetting('openLinksInBrowser', item.checked);
      buildMenu();
    },
  },
  {
    label: 'Restore Window Size After Close',
    type: 'checkbox',
    checked: settings.rememberWindowSize,
    click: (item) => {
      settings.rememberWindowSize = item.checked;
      saveSetting('rememberWindowSize', item.checked);
      if (item.checked) rememberBounds();
      buildMenu();
    },
  },
  {
    label: 'Save Current Window Size and Position for Launch',
    click: () => {
      settings.windowBounds = win.getBounds();
      saveSetting('windowBounds', settings.windowBounds);
      buildMenu();
    },
  },
  {
    label: 'Forget Saved Window Size',
    enabled: !!settings.windowBounds,
    click: () => {
      settings.windowBounds = null;
      saveSetting('windowBounds', null);
      buildMenu();
    },
  },
  {
    label: 'Open in Background on Launch',
    type: 'checkbox',
    checked: settings.openInBackground,
    click: (item) => {
      settings.openInBackground = item.checked;
      saveSetting('openInBackground', item.checked);
      buildMenu();
    },
  },
];
let settings;

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

// Hosts allowed to load inside the app (login, checkpoints, media).
const isInternal = (url) => {
  try {
    const { hostname } = new URL(url);
    return /(^|\.)(facebook\.com|fbcdn\.net|messenger\.com|fbsbx\.com)$/.test(hostname);
  } catch {
    return false;
  }
};

function createWindow() {
  const ses = session.fromPartition(PARTITION);
  // Drop the Electron token so Facebook serves the normal Chrome site.
  ses.setUserAgent(ses.getUserAgent().replace(/\s*Electron\/\S+/, '').replace(/\s*messagebae\/\S+/i, ''));
  // Only grant notification + media permissions.
  ses.setPermissionRequestHandler((_wc, perm, cb) =>
    cb(['notifications', 'media', 'clipboard-sanitized-write'].includes(perm)));

  // Saved size and monitor, if that monitor is still connected. Remember
  // Window Size (last size used) wins over the one-off saved size.
  const saved = (settings.rememberWindowSize && settings.lastWindowBounds) || settings.windowBounds;
  const onScreen = saved && screen.getAllDisplays().some(({ workArea: a }) =>
    saved.x < a.x + a.width && saved.x + saved.width > a.x && saved.y < a.y + a.height && saved.y + saved.height > a.y);
  win = new BrowserWindow({
    ...(onScreen ? saved : (() => {
      // Default: 1280x860, shrunk to fit smaller screens.
      const a = screen.getPrimaryDisplay().workArea;
      return { width: Math.min(1280, a.width - 80), height: Math.min(860, a.height - 60) };
    })()),
    minWidth: 480,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.loadURL(HOME);

  // On launch, come to the front unless the user switched to another app while
  // we loaded (or Open in Background is on). Then stay hidden until they come
  // to us. Showing without focus still draws on top, so hiding is the only way.
  win.once('ready-to-show', () => {
    const userMoved = !appActive && (leftAfterLaunch || frontApp() !== launchFront);
    if (settings.openInBackground || userMoved) {
      if (appActive) app.hide(); // hand focus back to the previous app
      app.once('did-become-active', showWindow);
    } else {
      showWindow();
    }
  });

  // Inject custom CSS on every page load.
  const css = fs.readFileSync(path.join(__dirname, 'inject.css'), 'utf8');
  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS(css);
    if (!badgeSettled) setTimeout(() => { badgeSettled = true; updateBadge(); }, 15000);
  });

  // Unread count from page title, e.g. "(3) Messenger | Facebook".
  win.on('page-title-updated', (_e, title) => {
    const m = title.match(/^\((\d+)\)/);
    const n = m ? Number(m[1]) : 0;
    if (!m && /messaged you/i.test(title)) lastFlash = { title: title.replace(/\s*\|.*$/, ''), at: Date.now() };
    if (n > unread) onNewMessage();
    checkOwnNotification(n);
    unread = n;
    updateBadge();
  });

  // External links open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Facebook links open in a new app window, unless the user prefers their browser.
    if (isInternal(url) && !settings.openLinksInBrowser) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isInternal(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // Right-click a message or image: reply, copy, save or unsend.
  win.webContents.on('context-menu', async (_e, p) => {
    const { reply, unsend, text } = await replyCheck();
    const items = [];
    if (reply) items.push({ label: 'Reply', click: () => win.webContents.send('reply-do') });
    if (p.selectionText) items.push({ label: 'Copy', role: 'copy' });
    if (text && p.mediaType !== 'image') {
      items.push({ label: 'Copy Message', click: () => require('electron').clipboard.writeText(text) });
    }
    if (p.mediaType === 'image' && p.srcURL) {
      if (items.length) items.push({ type: 'separator' });
      items.push(
        { label: 'Copy Image', click: () => win.webContents.copyImageAt(p.x, p.y) },
        { label: 'Save Image As…', click: () => win.webContents.downloadURL(p.srcURL) },
      );
    }
    if (unsend) items.push({ type: 'separator' }, { label: 'Unsend…', click: () => win.webContents.send('unsend-do') });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Handle Ctrl+Tab here too: menu accelerators for Tab are flaky when the
  // page has focus. preventDefault stops the menu firing a second time.
  win.webContents.on('before-input-event', (e, input) => {
    // Hold Esc to leave full screen (like Safari).
    if (input.key === 'Escape' && input.type === 'keyDown' && input.isAutoRepeat && win.isFullScreen()) {
      e.preventDefault();
      win.setFullScreen(false);
      return;
    }
    // Our shortcuts win over Facebook's (e.g. Cmd+B is Meta's feedback
    // dialog). Handle them here so the page never sees the key.
    if (input.type === 'keyDown') {
      const own = [
        [settings.shortcuts.clearBadge, clearBadge],
        [settings.shortcuts.notifyMode, () => win.webContents.send('toggle-mode', 'alert')],
        [settings.shortcuts.mute, () => win.webContents.send('toggle-mode', 'mute')],
      ].find(([acc]) => matchesAccelerator(acc, input));
      if (input.meta) ipcMain.emit('debug', null, `key ${input.key} code ${input.code} shift=${input.shift} matched=${!!own}`);
      if (own) { e.preventDefault(); own[1](); return; }
    }
    const { nextChat, previousChat } = settings.shortcuts;
    const keys = input.shift ? previousChat : nextChat;
    if (keys !== (input.shift ? 'Ctrl+Shift+Tab' : 'Ctrl+Tab')) return;
    if (input.type === 'keyDown' && input.key === 'Tab' && input.control && !input.meta && !input.alt) {
      e.preventDefault();
      goToChat({ step: input.shift ? -1 : 1 });
    }
  });

  // Mac behaviour: closing the window hides it instead of quitting.
  win.on('close', (e) => {
    rememberBounds();
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

// Click the nth chat in the sidebar (0-based), or step from the open one.
// Chat links look like /messages/t/<id>, /messages/e2ee/t/<id>, or
// Marketplace equivalents; only sidebar links count (not the open chat).
function goToChat(arg) {
  win.webContents.executeJavaScript(`(() => {
    const norm = (p) => p.replace(/\\/+$/, '');
    const seen = new Set();
    const links = [...document.querySelectorAll('a[href*="/t/"]')].filter((a) => {
      if (!a.offsetParent || a.closest('[role="main"]')) return false;
      const p = norm(new URL(a.href).pathname);
      if (!/\\/t\\/[^/]+$/.test(p) || seen.has(p)) return false;
      seen.add(p);
      return true;
    });
    if (!links.length) return;
    const arg = ${JSON.stringify(arg)};
    let i = arg.index;
    if (arg.step) {
      const here = norm(location.pathname);
      let cur = links.findIndex((a) => norm(new URL(a.href).pathname) === here);
      if (cur < 0) cur = links.findIndex((a) => a.getAttribute('aria-current') === 'page');
      i = cur < 0 ? 0 : Math.min(Math.max(cur + arg.step, 0), links.length - 1);
    }
    const link = links[i];
    if (!link) return;
    link.scrollIntoView({ block: 'nearest' });
    link.click();
  })()`);
}

// Focus Facebook's chat search box in the sidebar.
function focusSearch() {
  showWindow();
  win.webContents.executeJavaScript(`(() => {
    const box = document.querySelector(
      'input[aria-label*="Search Messenger" i], input[placeholder*="Search Messenger" i], ' +
      'input[aria-label*="Search chats" i], [role="navigation"] input[type="search"]');
    if (box) { box.focus(); box.select(); }
  })()`);
}

// Focus the message composer in the open chat, cursor at the end.
function focusComposer() {
  showWindow();
  win.webContents.executeJavaScript(`(() => {
    const box = document.querySelector(
      '[role="main"] div[role="textbox"][contenteditable="true"], div[role="textbox"][aria-label*="message" i]');
    if (!box) return;
    box.focus();
    const r = document.createRange();
    r.selectNodeContents(box);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  })()`);
}

// Pick files with the macOS dialog, then hand them to the page, which
// pastes them into the open chat like a copied file.
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4',
  pdf: 'application/pdf', txt: 'text/plain', zip: 'application/zip' };
async function attachFile() {
  showWindow();
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
  if (r.canceled || !r.filePaths.length) return;
  const files = r.filePaths
    .filter((f) => fs.statSync(f).size <= 100 * 1024 * 1024)
    .map((f) => ({ name: path.basename(f), type: MIME[path.extname(f).slice(1).toLowerCase()] || '', data: fs.readFileSync(f) }));
  if (files.length) win.webContents.send('attach-files', files);
}

// Ask the page what's under the right-click: a Reply button, message text.
function replyCheck() {
  return new Promise((resolve) => {
    const done = (_e, r) => { clearTimeout(t); resolve(r || {}); };
    const t = setTimeout(() => { ipcMain.removeListener('reply-check-result', done); ipcMain.emit('debug', null, 'right-click check timed out'); resolve({}); }, 1200);
    ipcMain.once('reply-check-result', done);
    win.webContents.send('reply-check');
  });
}

function buildMenu() {
  const k = settings.shortcuts;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => checkForUpdates(true) },
        { type: 'separator' },
        { label: 'Edit Settings…', accelerator: 'Cmd+,', click: () => shell.openPath(settingsPath()) },
        { label: 'Reload Settings', click: () => { settings = loadSettings(); buildMenu(); updateBadge(); sendNotifyConfig(); } },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        ...badgeItems(),
        { type: 'separator' },
        { label: 'Notify Mode (!)', accelerator: k.notifyMode, click: () => win.webContents.send('toggle-mode', 'alert') },
        { label: 'Mute', accelerator: k.mute, click: () => win.webContents.send('toggle-mode', 'mute') },
        { type: 'separator' },
        notificationMenu(),
      ],
    },
    {
      label: 'Chats',
      submenu: [
        { label: 'Search Chats', accelerator: k.searchChats, click: focusSearch },
        { label: 'Message Box', accelerator: k.messageBox, click: focusComposer },
        { label: 'Attach File…', accelerator: k.attachFile, click: attachFile },
        { type: 'separator' },
        { label: 'Next Chat', accelerator: k.nextChat, click: () => goToChat({ step: 1 }) },
        { label: 'Previous Chat', accelerator: k.previousChat, click: () => goToChat({ step: -1 }) },
        { type: 'separator' },
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
          label: `Chat ${n}`, accelerator: k.chatNumber ? `${k.chatNumber}+${n}` : undefined, click: () => goToChat({ index: n - 1 }),
        })),
      ],
    },
    {
      role: 'windowMenu',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' },
        { role: 'close' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: 'Buy Me a Coffee…', click: () => shell.openExternal('https://buymeacoffee.com/jchin14') },
      ],
    },
  ]));
}

// Update check: compare with the latest GitHub release. Runs on launch and
// every 12 hours; Check for Updates… in the app menu runs it on demand.
const RELEASES = 'https://github.com/jchin14/messageBae/releases/latest';
const newer = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
let updateShown = null;
async function checkForUpdates(manual = false) {
  let latest;
  try {
    const r = await fetch('https://api.github.com/repos/jchin14/messageBae/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    latest = (await r.json()).tag_name.replace(/^v/, '');
  } catch (err) {
    ipcMain.emit('debug', null, `update check failed: ${err.message}`);
    if (manual) dialog.showMessageBox(win, { message: "Couldn't check for updates", detail: 'Check your connection and try again.' });
    return;
  }
  const current = app.getVersion();
  ipcMain.emit('debug', null, `update check: current ${current}, latest ${latest}`);
  if (!newer(latest, current)) {
    if (manual) dialog.showMessageBox(win, { message: "You're up to date", detail: `messageBae ${current} is the latest version.` });
    return;
  }
  if (!manual && updateShown === latest) return; // only nag once per version per launch
  updateShown = latest;
  const { response } = await dialog.showMessageBox(win, {
    message: `messageBae ${latest} is available`,
    detail: `You have ${current}. Download the new .dmg, quit messageBae, then drag it into Applications and choose Replace. Your settings stay.`,
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) shell.openExternal(RELEASES);
}

// Only one copy runs. Opening it again brings the open window forward and
// tells the user it was already running.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  if (!win) return;
  showWindow();
  dialog.showMessageBox(win, {
    message: 'messageBae is already open',
    detail: 'This is the window that was already running.',
    buttons: ['OK'],
  });
});

app.whenReady().then(() => {
  setTimeout(() => checkForUpdates(), 10000);
  setInterval(() => checkForUpdates(), 12 * 60 * 60 * 1000);
  settings = loadSettings();
  buildMenu();
  createWindow();
  updateTray();
});

// Menu bar icon: click toggles the window, shows unread count beside it.
function updateTray() {
  if (settings.showMenuBarIcon && !tray) createTray();
  if (!settings.showMenuBarIcon && tray) { tray.destroy(); tray = null; }
}
function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'assets', 'trayTemplate.png'));
  tray.setToolTip('messageBae');
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : showWindow()));
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate([
    { label: 'Show messageBae', click: showWindow },
    { type: 'separator' },
    ...badgeItems(),
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ])));
}

ipcMain.on('notification-click', showWindow);
ipcMain.on('attach', attachFile);
// Move the page's mouse to a point (a real hover, so Messenger shows its
// message buttons). The on-screen cursor doesn't move.
ipcMain.handle('hover-at', (e, x, y) => {
  e.sender.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
});
// A real left click at a point. Messenger ignores scripted clicks on some
// elements (like search results).
ipcMain.handle('click-at', (e, x, y) => {
  const at = { x: Math.round(x), y: Math.round(y) };
  e.sender.sendInputEvent({ type: 'mouseMove', ...at });
  e.sender.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...at });
  e.sender.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...at });
});
// Native sheet in place of Messenger's unsend dialog (see preload).
ipcMain.handle('unsend-confirm', async (e, { everyone, you }) => {
  const opts = [];
  if (everyone) opts.push(['Unsend for Everyone', 'everyone']);
  if (you) opts.push(['Remove for You', 'you']);
  opts.push(['Cancel', null]);
  const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender), {
    message: 'Unsend this message?',
    detail: everyone
      ? 'Unsend for Everyone removes it from the chat. Remove for You only hides it for you.'
      : 'It will be removed for you. Others in the chat can still see it.',
    buttons: opts.map((o) => o[0]),
    defaultId: 0,
    cancelId: opts.length - 1,
  });
  return opts[response][1];
});
// Debug logs print when launched from a terminal (or with MESSAGEBAE_DEBUG=1).
const DEBUG = process.stdout.isTTY || !!process.env.MESSAGEBAE_DEBUG;
ipcMain.on('debug', (_e, msg) => { if (DEBUG) console.log('[messageBae]', msg); });
let muted = false;
let alertMode = false;
ipcMain.on('set-muted', (e, m) => { muted = !!m; e.sender.setAudioMuted(muted); });
ipcMain.on('clear-badge', clearBadge);
ipcMain.on('set-alert', (_e, on) => { alertMode = !!on; });

// Notifications: who shows them (Messenger's web ones, messageBae's own or
// none) and which sound plays. See the Notification wrapper in preload.
const SYSTEM_SOUNDS = ['Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 'Hero', 'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink'];
const soundFile = (s) => (!s || s === 'default' || s === 'none' ? null
  : SYSTEM_SOUNDS.includes(s) ? `/System/Library/Sounds/${s}.aiff` : s);
function playSound(s = settings.notificationSound) {
  const file = soundFile(s);
  if (file && fs.existsSync(file)) execFile('afplay', [file], () => {});
}
const notifyConfig = () => ({
  source: settings.notifications,
  silent: settings.notificationSound !== 'default',
  silencePop: settings.silenceMessengerSound,
});
function sendNotifyConfig() { if (win) win.webContents.send('notify-config', notifyConfig()); }
function setNotifySetting(key, value) {
  settings[key] = value;
  saveSetting(key, value);
  sendNotifyConfig();
  buildMenu();
}
ipcMain.on('get-notify-config', (e) => { e.returnValue = notifyConfig(); });
ipcMain.on('play-notify-sound', () => { if (!muted) playSound(); });

async function chooseSoundFile() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose a Notification Sound',
    properties: ['openFile'],
    filters: [{ name: 'Sounds', extensions: ['aiff', 'aif', 'wav', 'mp3', 'm4a', 'caf'] }],
  });
  if (canceled || !filePaths[0]) return;
  setNotifySetting('notificationSound', filePaths[0]);
  playSound();
}

function notificationMenu() {
  const s = settings.notificationSound;
  const custom = soundFile(s) && !SYSTEM_SOUNDS.includes(s) ? s : null;
  const source = (label, value) => ({
    label, type: 'radio', checked: settings.notifications === value, click: () => setNotifySetting('notifications', value),
  });
  // Picking a sound plays it as a preview.
  const sound = (label, value) => ({
    label, type: 'radio', checked: s === value, click: () => { setNotifySetting('notificationSound', value); playSound(value); },
  });
  return {
    label: 'Notifications',
    submenu: [
      source("Messenger's Notifications", 'messenger'),
      source('messageBae Notifications', 'messagebae'),
      source('Off', 'off'),
      { type: 'separator' },
      {
        label: 'Sound',
        submenu: [
          sound('Default', 'default'),
          sound('None', 'none'),
          { type: 'separator' },
          ...SYSTEM_SOUNDS.map((n) => sound(n, n)),
          { type: 'separator' },
          ...(custom ? [sound(path.basename(custom), custom)] : []),
          { label: 'Choose File…', click: chooseSoundFile },
        ],
      },
      {
        label: "Silence Messenger's Pop Sound", type: 'checkbox', checked: settings.silenceMessengerSound,
        click: (item) => setNotifySetting('silenceMessengerSound', item.checked),
      },
    ],
  };
}

// messageBae notifications. Facebook's web notification is used when it
// sends one (it has the name and message). If it doesn't, a rise in the
// unread count shows a plain one after a short wait.
const shownNotices = [];
let lastFlash = { title: '', at: 0 };
let fallbackTimer = null, lastFallback = 0, lastWeb = 0;
let notifiedPeak = 0, peakTimer = null;
function showOwnNotification(title, body, id) {
  if (muted || settings.notifications !== 'messagebae' || !Notification.isSupported()) return;
  const n = new Notification({ title: title || 'messageBae', body: body || '', silent: settings.notificationSound !== 'default' });
  n.on('click', () => { showWindow(); if (id && win) win.webContents.send('native-notification-click', id); });
  n.show();
  playSound();
  // Keep a reference so the click handler isn't garbage collected.
  shownNotices.push(n);
  if (shownNotices.length > 20) shownNotices.shift();
}
ipcMain.on('web-notification', (_e, n) => {
  clearTimeout(fallbackTimer);
  fallbackTimer = null;
  lastWeb = Date.now();
  if (lastWeb - lastFallback < 4000) return;
  showOwnNotification(n.title, n.body, n.id);
});
// The count dips during reloads, so only count it as new once it beats the
// highest seen; the high mark drops after a lower count holds for 10s.
function checkOwnNotification(n) {
  if (n >= notifiedPeak) { clearTimeout(peakTimer); peakTimer = null; }
  else if (!peakTimer) peakTimer = setTimeout(() => { peakTimer = null; notifiedPeak = unread; }, 10000);
  if (n <= notifiedPeak) return;
  notifiedPeak = n;
  if (settings.notifications !== 'messagebae' || muted || !badgeSettled || (win && win.isFocused())) return;
  // Facebook's own notification already came in for this message.
  if (Date.now() - lastWeb < 4000) return;
  clearTimeout(fallbackTimer);
  fallbackTimer = setTimeout(() => {
    fallbackTimer = null;
    lastFallback = Date.now();
    showOwnNotification('messageBae', Date.now() - lastFlash.at < 5000 ? lastFlash.title : 'New message');
  }, 2000);
}

// Title bar drag: follow the cursor until the mouse is released.
let dragTimer = null;
ipcMain.on('titlebar-drag', (_e, phase) => {
  clearInterval(dragTimer);
  dragTimer = null;
  if (phase !== 'start' || !win) return;
  const start = screen.getCursorScreenPoint();
  const [x0, y0] = win.getPosition();
  let moving = false;
  dragTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    const dx = p.x - start.x, dy = p.y - start.y;
    if (!moving && Math.abs(dx) + Math.abs(dy) < 4) return;
    moving = true;
    win.setPosition(x0 + dx, y0 + dy);
  }, 8);
});

// Title bar double-click: follow the macOS setting, and toggle back on a second double-click.
let restoreBounds = null;
ipcMain.on('titlebar-dblclick', () => {
  if (!win) return;
  if (win.isFullScreen()) return win.setFullScreen(false);
  const action = systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string');
  if (action === 'None') return;
  if (action === 'Minimize') return win.minimize();
  if (win.isMaximized()) return win.unmaximize();
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const b = win.getBounds();
  // Loose match: macOS can nudge the size a little after a fill.
  const filled = b.width >= area.width - 40 && b.height >= area.height - 40;
  if (filled) {
    // No saved size (e.g. it opened filled): fall back to a centred default.
    const w = Math.min(1200, area.width - 100), h = Math.min(800, area.height - 100);
    const r = restoreBounds || {
      x: Math.round(area.x + (area.width - w) / 2),
      y: Math.round(area.y + (area.height - h) / 2),
      width: w, height: h,
    };
    win.setBounds(r, true);
    restoreBounds = null;
  } else {
    restoreBounds = b;
    win.setBounds(area, true);
  }
});

// Notify mode: on a new message, jump to the front and flash.
function onNewMessage() {
  if (!alertMode || !win) return;
  win.show();
  app.focus({ steal: true });
  win.focus();
  app.dock.bounce('critical');
  win.webContents.send('flash');
}

// Esc clearing (see preload): Facebook's editor only reacts to real key presses.
const pressBackspace = (wc, times = 1) => {
  for (let i = 0; i < times; i++) {
    for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode: 'Backspace' });
  }
};
ipcMain.on('press-backspace', (e, times) => pressBackspace(e.sender, Math.min(Number(times) || 1, 2)));
// Emoji names for :shortcode: typing (from emojilib), and inserting the
// chosen emoji as real typed text (Facebook ignores scripted edits).
ipcMain.handle('emoji-list', () => Object.entries(require('emojilib'))
  .map(([e, k]) => [e, k.filter((w) => /^[a-z0-9_+-]+$/.test(w))])
  .filter(([, k]) => k.length));
ipcMain.on('insert-text', (e, text) => e.sender.insertText(String(text).slice(0, 16)));
ipcMain.on('clear-box', (e) => {
  e.sender.selectAll();
  pressBackspace(e.sender);
});

app.on('activate', showWindow);
// Restore Window Size After Close: save the window's normal (not full screen) size
// and position whenever it's closed or the app quits.
function rememberBounds() {
  if (!settings.rememberWindowSize || !win || win.isDestroyed()) return;
  settings.lastWindowBounds = win.getNormalBounds();
  saveSetting('lastWindowBounds', settings.lastWindowBounds);
}
app.on('before-quit', () => {
  rememberBounds();
  app.isQuitting = true;
  // Write login cookies to disk now, so a quick quit doesn't sign you out.
  session.fromPartition(PARTITION).cookies.flushStore();
});
// Ctrl+C in the terminal: quit cleanly instead of being killed mid-write.
process.on('SIGINT', () => app.quit());
process.on('SIGTERM', () => app.quit());
