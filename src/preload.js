// Runs before Facebook's scripts (sandboxed, context-isolated).
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Mute and alert (!) mode. Only one can be on. Saved between launches.
const MUTE_KEY = 'messagebae-muted';
const ALERT_KEY = 'messagebae-alert';
const read = (key) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
let muted = read(MUTE_KEY);
let alertMode = !muted && read(ALERT_KEY);
const redraw = [];

function sync() {
  ipcRenderer.send('set-muted', muted);
  ipcRenderer.send('set-alert', alertMode);
}
function setMode(mode, on) {
  muted = mode === 'mute' && on;
  alertMode = mode === 'alert' && on;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    localStorage.setItem(ALERT_KEY, alertMode ? '1' : '0');
  } catch {}
  sync();
  redraw.forEach((f) => f());
}
sync();

// Let the page tell the main process a notification was clicked,
// and check whether notifications are muted.
contextBridge.exposeInMainWorld('messagebae', {
  notificationClicked: () => ipcRenderer.send('notification-click'),
  isMuted: () => muted,
});

// Wrap the page's Notification so clicks also bring the window forward.
// Facebook's own click handler still runs and opens the chat.
webFrame.executeJavaScript(`(() => {
  const N = window.Notification;
  if (!N) return;
  class Wrapped extends N {
    constructor(title, opts) {
      super(title, opts);
      this.addEventListener('click', () => window.messagebae.notificationClicked());
    }
  }
  // While muted, hand back a silent stand-in instead of showing anything.
  window.Notification = new Proxy(Wrapped, {
    construct(target, args) {
      if (window.messagebae.isMuted()) {
        const fake = new EventTarget();
        fake.close = () => {};
        return fake;
      }
      return Reflect.construct(target, args);
    },
  });
  const SWR = window.ServiceWorkerRegistration;
  if (SWR) {
    const show = SWR.prototype.showNotification;
    SWR.prototype.showNotification = function (...args) {
      return window.messagebae.isMuted() ? Promise.resolve() : show.apply(this, args);
    };
  }
})();`);

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('messagebae');
  addControls();
});

// Title bar controls, top right: clear badge, "!" alert mode and mute.
function addControls() {
  addTitlebar();
  const bar = document.createElement('div');
  bar.id = 'messagebae-controls';
  bar.append(clearBadgeButton(), alertButton(), muteButton());
  document.documentElement.appendChild(bar);
}

// Drag to move the window; double-click to fill / restore.
function addTitlebar() {
  const strip = document.createElement('div');
  strip.id = 'messagebae-titlebar';
  strip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    strip.setPointerCapture(e.pointerId);
    ipcRenderer.send('titlebar-drag', 'start');
  });
  const end = () => ipcRenderer.send('titlebar-drag', 'end');
  strip.addEventListener('pointerup', end);
  strip.addEventListener('pointercancel', end);
  strip.addEventListener('dblclick', () => ipcRenderer.send('titlebar-dblclick'));
  document.documentElement.appendChild(strip);
}

function clearBadgeButton() {
  const btn = document.createElement('button');
  btn.id = 'messagebae-clear';
  btn.textContent = '✓';
  btn.dataset.tip = 'Clear the badge count. To hide the badge, use View > Show Badge Count';
  btn.addEventListener('click', () => ipcRenderer.send('clear-badge'));
  return btn;
}

function alertButton() {
  const btn = document.createElement('button');
  btn.id = 'messagebae-alert';
  btn.textContent = '!';
  const render = () => {
    btn.dataset.tip = alertMode ? 'Alert mode on: new messages bring the window to the front' : 'Alert mode: bring the window to the front on new messages';
    btn.classList.toggle('on', alertMode);
  };
  btn.addEventListener('click', () => setMode('alert', !alertMode));
  redraw.push(render);
  render();
  return btn;
}

function muteButton() {
  const btn = document.createElement('button');
  btn.id = 'messagebae-mute';
  const render = () => {
    btn.textContent = muted ? '🔕 Muted' : '🔔';
    btn.dataset.tip = muted ? 'Muted. Click to turn notifications and sounds back on' : 'Mute notifications and sounds';
    btn.classList.toggle('on', muted);
  };
  btn.addEventListener('click', () => setMode('mute', !muted));
  redraw.push(render);
  render();
  return btn;
}

// Two-finger swipe sideways over a message opens a reply to it.
// The cursor is already over the message, so Messenger is showing its
// hover buttons; find the nearest Reply button above the cursor's element.
let swipeSum = 0, swipeLast = 0, swipeDone = false;
window.addEventListener('wheel', (e) => {
  const now = Date.now();
  if (now - swipeLast > 300) { swipeSum = 0; swipeDone = false; }
  swipeLast = now;
  if (swipeDone || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  swipeSum += e.deltaX;
  if (Math.abs(swipeSum) < 60) return;
  swipeDone = true;
  const btn = findReply(e.target);
  if (btn) btn.click();
}, { capture: true, passive: true });

const REPLY = '[aria-label="Reply" i], [aria-label^="Reply " i], [aria-label*="reply to" i]';
function findReply(el) {
  const main = document.querySelector('[role="main"]');
  for (let n = el; n && n !== main && n !== document.body; n = n.parentElement) {
    const btn = n.querySelector(REPLY);
    if (btn) return btn;
  }
  return null;
}

// Brief flash over the page, used by alert mode.
ipcRenderer.on('flash', () => {
  const el = document.createElement('div');
  el.id = 'messagebae-flash';
  document.documentElement.appendChild(el);
  setTimeout(() => el.remove(), 900);
});

// Esc in the message box: 1st press does nothing, 2nd clears the line
// you're on (and removes it), 3rd press in a row clears the whole box.
// Facebook's editor ignores scripted edits, so we select the text here and
// ask the main process to send real Backspace key presses.
let escCount = 0;
let skipBackspace = 0;
window.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace' && skipBackspace) {
    skipBackspace--;
    return;
  }
  const box = e.target.closest && e.target.closest('[contenteditable="true"]');
  if (e.key !== 'Escape' || !box) {
    escCount = 0;
    return;
  }
  if (!box.textContent.trim().length) return; // empty: let Facebook handle Esc
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat) return; // holding Esc shouldn't wipe the box
  escCount++;
  if (escCount === 1) return;
  if (escCount >= 3) {
    escCount = 0;
    skipBackspace++;
    ipcRenderer.send('clear-box');
    return;
  }
  const sel = getSelection();
  sel.collapseToEnd();
  // Is there a line above this one? Then also remove the emptied line.
  let block = sel.anchorNode;
  while (block && block.parentNode !== box) block = block.parentNode;
  const lineAbove = !!(block && block.previousElementSibling);
  sel.modify('move', 'backward', 'lineboundary');
  sel.modify('extend', 'forward', 'lineboundary');
  const presses = (sel.isCollapsed ? 0 : 1) + (lineAbove ? 1 : 0);
  if (!presses) return;
  skipBackspace += presses;
  ipcRenderer.send('press-backspace', presses);
}, true);
