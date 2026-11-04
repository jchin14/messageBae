const { app, BrowserWindow, Menu, Tray, shell, session, ipcMain } = require('electron');
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
  return { shortcuts: { ...DEFAULTS.shortcuts, ...user.shortcuts } };
}
let settings;

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

  // Launch politely: come to the front, unless the user moved to another app
  // while we loaded. Then stay hidden until they switch to us (dock, Cmd+Tab,
  // menu bar icon). macOS's "show without focus" still draws on top, so hiding
  // is the only way to not interrupt them.
  win.once('ready-to-show', () => {
    const userMoved = !appActive && (leftAfterLaunch || frontApp() !== launchFront);
    if (userMoved) app.once('did-become-active', showWindow);
    else showWindow();
  });

  // Inject custom CSS on every page load.
  const css = fs.readFileSync(path.join(__dirname, 'inject.css'), 'utf8');
  win.webContents.on('did-finish-load', () => win.webContents.insertCSS(css));

  // Unread count from page title, e.g. "(3) Messenger | Facebook".
  win.on('page-title-updated', (_e, title) => {
    const m = title.match(/^\((\d+)\)/);
    app.dock.setBadge(m ? m[1] : '');
    if (tray) tray.setTitle(m ? ` ${m[1]}` : '');
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
        { label: 'Edit Shortcuts…', accelerator: 'Cmd+,', click: () => shell.openPath(settingsPath()) },
        { label: 'Reload Shortcuts', click: () => { settings = loadSettings(); buildMenu(); } },
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
    { role: 'windowMenu' },
  ]));
}

app.whenReady().then(() => {
  settings = loadSettings();
  buildMenu();
  createWindow();
  createTray();
});
function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

// Menu bar icon: click toggles the window, shows unread count beside it.
function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'assets', 'trayTemplate.png'));
  tray.setToolTip('messageBae');
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : showWindow()));
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate([
    { label: 'Show messageBae', click: showWindow },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ])));
}

ipcMain.on('notification-click', showWindow);
ipcMain.on('set-muted', (e, muted) => e.sender.setAudioMuted(!!muted));
ipcMain.on('press-backspace', (e) => {
  for (const type of ['keyDown', 'keyUp']) e.sender.sendInputEvent({ type, keyCode: 'Backspace' });
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
