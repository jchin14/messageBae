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

// Rounder corners on the conversation card (the coloured panel behind the
// chat). Its classes are obfuscated, so find it from the message box: the
// first rounded, filled ancestor that takes up most of the main area.
function roundCard() {
  const main = document.querySelector('[role="main"]');
  const box = main && main.querySelector('[contenteditable="true"]');
  if (!box) return;
  for (let n = box.parentElement; n && n !== main; n = n.parentElement) {
    if (n.offsetHeight < main.offsetHeight * 0.5) continue;
    const cs = getComputedStyle(n);
    if (parseFloat(cs.borderTopLeftRadius) > 0 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      n.classList.add('messagebae-card');
      // Drop the bottom padding Facebook puts around the card, so it sits
      // as low as the chat list.
      for (let a = n.parentElement; a && a !== main.parentElement; a = a.parentElement) {
        if (parseFloat(getComputedStyle(a).paddingBottom) > 0) a.classList.add('messagebae-nopad');
      }
      evenBottom(n, main);
      return;
    }
  }
}
setInterval(roundCard, 1000);

// Make the gap under the panels match the gap at the side of the window,
// by nudging the main area's bottom margin until they're equal.
function evenBottom(card, main) {
  const r = card.getBoundingClientRect();
  const side = innerWidth - r.right;
  const diff = (innerHeight - r.bottom) - side;
  if (side <= 0 || side > 60 || Math.abs(diff) < 1) return;
  const m = parseFloat(getComputedStyle(main).marginBottom) - diff;
  if (m < -80 || m > 40) return; // safety: never push it far off
  main.style.setProperty('margin-bottom', m + 'px', 'important');
}

// Draggable panel widths: chat list (left) and chat info (right).
// Drag the edge to resize; double-click it to reset. Widths are saved.
const panels = {
  left: { key: 'messagebae-width-left', els: [], col: null, handle: null },
  right: { key: 'messagebae-width-right', els: [], col: null, handle: null },
};
const NAV = '[role="navigation"]:has(input[aria-label*="Search Messenger" i]), [role="navigation"]:has(input[placeholder*="Search Messenger" i])';
const clampW = (w) => Math.round(Math.max(220, Math.min(w, innerWidth * 0.4)));
const loadW = (p) => { try { return parseFloat(localStorage.getItem(p.key)) || 0; } catch { return 0; } };

function findColumn(side) {
  if (side === 'left') {
    const nav = document.querySelector(NAV);
    const input = nav && nav.querySelector('input');
    if (!input || !input.offsetWidth) return null; // icons-only (narrow window)
    const w = nav.getBoundingClientRect().width;
    let top = nav;
    while (top.parentElement && top.parentElement !== document.body &&
           Math.abs(top.parentElement.getBoundingClientRect().width - w) <= 16) top = top.parentElement;
    return top;
  }
  // Right: the tall panel sitting to the right of the conversation card.
  const card = document.querySelector('.messagebae-card');
  if (!card) return null;
  const cr = card.getBoundingClientRect();
  for (let n = card; n.parentElement && n.parentElement !== document.body; n = n.parentElement) {
    for (const sib of n.parentElement.children) {
      if (sib === n) continue;
      const r = sib.getBoundingClientRect();
      if (r.left >= cr.right - 2 && r.width > 150 && r.height > innerHeight * 0.4) return sib;
    }
  }
  return null;
}

// Facebook sets widths on several nested wrappers, so size the column and
// every same-width descendant, keeping each one's offset from the column.
function applyWidth(p, w) {
  const tw = p.col.getBoundingClientRect().width;
  const found = [];
  const walk = (el, depth) => {
    const d = tw - el.getBoundingClientRect().width;
    if (Math.abs(d) > 16) return;
    found.push([el, d]);
    if (depth < 8) for (const c of el.children) walk(c, depth + 1);
  };
  walk(p.col, 0);
  clearWidth(p);
  for (const [el, d] of found) {
    for (const prop of ['width', 'min-width', 'max-width']) {
      el.style.setProperty(prop, (w - d) + 'px', 'important');
    }
    // flex-basis only means width in a row; in a column it sets the height,
    // which collapses the chat list. So only touch it for row children.
    const pcs = el.parentElement && getComputedStyle(el.parentElement);
    if (pcs && pcs.display.includes('flex') && pcs.flexDirection.startsWith('row')) {
      el.style.setProperty('flex-basis', (w - d) + 'px', 'important');
      el.style.setProperty('flex-shrink', '0', 'important');
    }
  }
  p.els = found.map(([el]) => el);
}

function clearWidth(p) {
  for (const el of p.els) {
    for (const prop of ['width', 'min-width', 'max-width', 'flex-basis', 'flex-shrink']) el.style.removeProperty(prop);
  }
  p.els = [];
}

function placeHandle(side) {
  const p = panels[side];
  if (!p.col) { p.handle.style.display = 'none'; return; }
  const r = p.col.getBoundingClientRect();
  let x = side === 'left' ? r.right : r.left;
  // Centre the handle in the gap between the panel and the conversation card.
  const card = document.querySelector('.messagebae-card');
  if (card) {
    const c = card.getBoundingClientRect();
    const nav = side === 'left' && document.querySelector(NAV);
    const edge = nav ? nav.getBoundingClientRect().right : x;
    const mid = side === 'left' ? (edge + c.left) / 2 : (c.right + r.left) / 2;
    if (Math.abs(mid - x) < 40) x = mid;
  }
  Object.assign(p.handle.style, { display: 'block', left: (x - 4.5) + 'px', top: r.top + 'px', height: r.height + 'px' });
}

function makeHandle(side) {
  const p = panels[side];
  const h = document.createElement('div');
  h.className = 'messagebae-resize';
  h.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !p.col) return;
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    h.classList.add('dragging');
    document.documentElement.classList.add('messagebae-resizing');
    const r = p.col.getBoundingClientRect();
    let w = 0;
    const move = (ev) => {
      w = clampW(side === 'left' ? ev.clientX - r.left : r.right - ev.clientX);
      applyWidth(p, w);
      placeHandle(side);
    };
    const end = () => {
      h.removeEventListener('pointermove', move);
      h.classList.remove('dragging');
      document.documentElement.classList.remove('messagebae-resizing');
      if (w) try { localStorage.setItem(p.key, String(w)); } catch {}
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', end, { once: true });
    h.addEventListener('pointercancel', end, { once: true });
  });
  h.addEventListener('dblclick', () => {
    try { localStorage.removeItem(p.key); } catch {}
    clearWidth(p);
    requestAnimationFrame(() => placeHandle(side));
  });
  document.documentElement.appendChild(h);
  return h;
}

function layoutPanels() {
  if (!document.documentElement.classList.contains('messagebae')) return;
  for (const side of ['left', 'right']) {
    const p = panels[side];
    if (!p.handle) p.handle = makeHandle(side);
    if (p.handle.classList.contains('dragging')) continue;
    p.col = findColumn(side);
    if (!p.col) { clearWidth(p); placeHandle(side); continue; }
    const saved = loadW(p);
    if (saved && Math.abs(p.col.getBoundingClientRect().width - clampW(saved)) > 1) applyWidth(p, clampW(saved));
    placeHandle(side);
  }
}
setInterval(layoutPanels, 1000);
window.addEventListener('resize', layoutPanels);

// No page scroll on the Messenger screens (the chat list and conversation
// scroll on their own). Other pages, like a profile, can still scroll.
function lockScroll() {
  const onChats = /^\/(messages|t)(\/|$)/.test(location.pathname);
  document.documentElement.classList.toggle('messagebae-lock', onChats);
}
setInterval(lockScroll, 500);
window.addEventListener('DOMContentLoaded', lockScroll);
