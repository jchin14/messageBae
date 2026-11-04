// Runs before Facebook's scripts (sandboxed, context-isolated).
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Mute: pauses this app's notifications. Remembered between launches.
const MUTE_KEY = 'messagebae-muted';
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch {}
// Main process silences this window's audio while muted.
const syncMute = () => ipcRenderer.send('set-muted', muted);
syncMute();

// Let the page tell the main process a notification was clicked,
// and check whether notifications are muted.
contextBridge.exposeInMainWorld('messengerMac', {
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
      this.addEventListener('click', () => window.messengerMac.notificationClicked());
    }
  }
  // While muted, hand back a silent stand-in instead of showing anything.
  window.Notification = new Proxy(Wrapped, {
    construct(target, args) {
      if (window.messengerMac.isMuted()) {
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
      return window.messengerMac.isMuted() ? Promise.resolve() : show.apply(this, args);
    };
  }
})();`);

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('messagebae');
  addMuteButton();
});

// Mute toggle in the top-right corner of the title bar.
function addMuteButton() {
  const btn = document.createElement('button');
  btn.id = 'messagebae-mute';
  const render = () => {
    btn.textContent = muted ? '🔕 Muted' : '🔔';
    btn.title = muted ? 'Notifications paused. Click to unmute' : 'Mute notifications';
    btn.classList.toggle('on', muted);
  };
  btn.addEventListener('click', () => {
    muted = !muted;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch {}
    syncMute();
    render();
  });
  render();
  document.documentElement.appendChild(btn);
}

// Esc in the message box: first press clears the current line,
// a second press in a row clears the whole box.
// Facebook's editor ignores scripted edits, so we select the text here and
// ask the main process to send a real Backspace key press.
let lastKeyWasEsc = false;
let skipBackspace = 0;
window.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace' && skipBackspace) {
    skipBackspace--;
    return;
  }
  const box = e.target.closest && e.target.closest('[contenteditable="true"]');
  if (e.key !== 'Escape' || !box) {
    lastKeyWasEsc = false;
    return;
  }
  if (!box.textContent.trim().length) return; // empty: let Facebook handle Esc
  e.preventDefault();
  e.stopImmediatePropagation();
  const sel = getSelection();
  if (lastKeyWasEsc) {
    sel.selectAllChildren(box);
  } else {
    sel.collapseToEnd();
    sel.modify('move', 'backward', 'lineboundary');
    sel.modify('extend', 'forward', 'lineboundary');
  }
  lastKeyWasEsc = true;
  if (sel.isCollapsed) return; // empty line: nothing to delete
  skipBackspace++;
  ipcRenderer.send('press-backspace');
}, true);
