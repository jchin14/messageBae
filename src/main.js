const { app, BrowserWindow, Menu, Tray, shell, session, ipcMain, screen, systemPreferences } = require('electron');
const fs = require('fs');
const { execFileSync } = require('child_process');
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
function updateBadge() {
  if (badgeSettled && unread < badgeBase) {
    badgeBase = unread;
    saveBadgeBase();
  }
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
  { label: 'Clear Badge', click: clearBadge },
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

  win = new BrowserWindow({
    width: 1100,
    height: 760,
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
    if (n > unread) onNewMessage();
    unread = n;
    updateBadge();
  });

  // External links open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isInternal(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
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

function buildMenu() {
  const k = settings.shortcuts;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Edit Settings…', accelerator: 'Cmd+,', click: () => shell.openPath(settingsPath()) },
        { label: 'Reload Settings', click: () => { settings = loadSettings(); buildMenu(); updateBadge(); } },
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
      ],
    },
    {
      label: 'Chats',
      submenu: [
        { label: 'Search Chats', accelerator: k.searchChats, click: focusSearch },
        { label: 'Message Box', accelerator: k.messageBox, click: focusComposer },
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
  ]));
}

app.whenReady().then(() => {
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
let muted = false;
let alertMode = false;
ipcMain.on('set-muted', (e, m) => { muted = !!m; e.sender.setAudioMuted(muted); });
ipcMain.on('clear-badge', clearBadge);
ipcMain.on('set-alert', (_e, on) => { alertMode = !!on; });

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

// Alert mode: on a new message, jump to the front and flash.
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
ipcMain.on('clear-box', (e) => {
  e.sender.selectAll();
  pressBackspace(e.sender);
});

app.on('activate', showWindow);
app.on('before-quit', () => {
  app.isQuitting = true;
  // Write login cookies to disk now, so a quick quit doesn't sign you out.
  session.fromPartition(PARTITION).cookies.flushStore();
});
// Ctrl+C in the terminal: quit cleanly instead of being killed mid-write.
process.on('SIGINT', () => app.quit());
process.on('SIGTERM', () => app.quit());
