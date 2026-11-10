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
ipcRenderer.on('toggle-mode', (_e, mode) => setMode(mode, mode === 'mute' ? !muted : !alertMode));

// Let the page tell the main process a notification was clicked,
// and check whether notifications are muted.
// Notification settings from the main process: source (messenger,
// messagebae or off), silent (a custom sound replaces the macOS one) and
// silencePop (block Messenger's in-page sound).
let notify = ipcRenderer.sendSync('get-notify-config') || {};
ipcRenderer.on('notify-config', (_e, c) => { notify = c || {}; });
contextBridge.exposeInMainWorld('messagebae', {
  notificationClicked: () => ipcRenderer.send('notification-click'),
  isMuted: () => muted,
  notify: () => notify,
  // messageBae mode: hand Facebook's notification to the main process.
  forward: (id, title, body) => ipcRenderer.send('web-notification', { id, title: String(title || ''), body: String(body || '') }),
  // Messenger mode: a notification was shown, play the chosen sound.
  shown: () => ipcRenderer.send('play-notify-sound'),
  onNativeClick: (cb) => ipcRenderer.on('native-notification-click', (_e, id) => cb(id)),
  log: (m) => ipcRenderer.send('debug', String(m)),
});

// Ask the main process to show the file picker.
function attachFile() { ipcRenderer.send('attach'); }

// Hand picked files to the open chat. Try, in order: Facebook's hidden
// file input, a paste into the message box, then a drop on the chat.
ipcRenderer.on('attach-files', (_e, files) => {
  const log = (m) => ipcRenderer.send('debug', `attach: ${m}`);
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(new File([f.data], f.name, { type: f.type })));
  const box = document.querySelector('[role="main"] [contenteditable="true"]')
    || document.querySelector('div[role="textbox"][aria-label*="message" i]');
  const inputs = [...document.querySelectorAll('input[type="file"]')];
  log(`${files.length} file(s), box=${!!box}, inputs=${inputs.length}`);

  const input = inputs.find((i) => box && i.closest('form, [role="main"]')?.contains(box))
    || inputs.find((i) => i.multiple) || inputs[0];
  if (input) {
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    log('used file input');
    return;
  }
  if (!box) { log('no message box'); return; }
  box.focus();
  const paste = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  box.dispatchEvent(paste);
  if (paste.defaultPrevented) { log('pasted'); return; }
  for (const type of ['dragenter', 'dragover', 'drop']) {
    box.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }
  log('dropped (paste was ignored)');
});

// Wrap the page's Notification so clicks also bring the window forward.
// Facebook's own click handler still runs and opens the chat.
// Muted or Off: hand back a silent stand-in. messageBae mode: a stand-in
// too, and the main process shows its own notification; a click on that
// fires the stand-in's click so Facebook still opens the chat.
webFrame.executeJavaScript(`(() => {
  const mb = window.messagebae;
  if (!mb) return;
  const standIn = () => {
    const fake = new EventTarget();
    fake.close = () => {};
    fake.onclick = null;
    return fake;
  };
  const pending = new Map();
  let nextId = 1;
  mb.onNativeClick((id) => {
    const f = pending.get(id);
    if (!f) return;
    const ev = new Event('click');
    f.dispatchEvent(ev);
    if (typeof f.onclick === 'function') f.onclick(ev);
  });
  const N = window.Notification;
  if (N) {
    class Wrapped extends N {
      constructor(title, opts) {
        super(title, opts);
        this.addEventListener('click', () => mb.notificationClicked());
      }
    }
    window.Notification = new Proxy(Wrapped, {
      construct(target, [title, opts]) {
        const c = mb.notify();
        if (mb.isMuted() || c.source === 'off') return standIn();
        if (c.source === 'messagebae') {
          const fake = standIn(), id = nextId++;
          pending.set(id, fake);
          if (pending.size > 50) pending.delete(pending.keys().next().value);
          mb.forward(id, title, opts && opts.body);
          return fake;
        }
        if (c.silent) { opts = { ...opts, silent: true }; mb.shown(); }
        return Reflect.construct(target, [title, opts]);
      },
    });
  }
  const SWR = window.ServiceWorkerRegistration;
  if (SWR) {
    const show = SWR.prototype.showNotification;
    SWR.prototype.showNotification = function (title, opts) {
      const c = mb.notify();
      if (mb.isMuted() || c.source === 'off') return Promise.resolve();
      if (c.source === 'messagebae') { mb.forward(0, title, opts && opts.body); return Promise.resolve(); }
      if (c.silent) { opts = { ...opts, silent: true }; mb.shown(); }
      return show.call(this, title, opts);
    };
  }
  // Silence Messenger's pop: skip audio from Facebook's static files
  // (its UI sounds). Voice messages come from other hosts and still play.
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    const src = this.currentSrc || this.src || '';
    if (this instanceof HTMLAudioElement && mb.notify().silencePop && /^https:\\/\\/static\\.[^/]*fbcdn\\.net\\//.test(src)) {
      mb.log('silenced Messenger sound ' + src.slice(0, 100));
      return Promise.resolve();
    }
    return play.apply(this, a);
  };
})();`);

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('messagebae');
  addControls();
});

// Title bar controls, top right: clear badge, "!" notify mode and mute.
function addControls() {
  addTitlebar();
  const bar = document.createElement('div');
  bar.id = 'messagebae-controls';
  bar.append(attachButton(), reloadButton(), clearBadgeButton(), alertButton(), muteButton());
  document.documentElement.appendChild(bar);
  document.documentElement.appendChild(resetViewButton());
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

// Title bar icons: one line style (Lucide-like), drawn in the button's colour.
const ICON_PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  reload: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M12 4v10"/><path d="M12 19.5v.01"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  bellOff: '<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
};
function setIcon(btn, name, label = '') {
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>${label ? `<span>${label}</span>` : ''}`;
}

function attachButton() {
  const btn = document.createElement('button');
  btn.id = 'messagebae-attach';
  setIcon(btn, 'plus');
  btn.dataset.tip = 'Attach a photo or file (Cmd+U)';
  btn.addEventListener('click', attachFile);
  return btn;
}

function reloadButton() {
  const btn = document.createElement('button');
  btn.id = 'messagebae-reload';
  setIcon(btn, 'reload');
  btn.dataset.tip = 'Reload Messenger to fix a stuck or shifted view (Cmd+R)';
  btn.addEventListener('click', () => location.reload());
  return btn;
}

// Bottom-right, only shown when the view has shifted: click snaps it back, Shift-click reloads.
function resetViewButton() {
  const btn = document.createElement('button');
  btn.id = 'messagebae-resetview';
  btn.textContent = '⤒ Reset view';
  btn.title = 'Put the view back if it has shifted. Shift-click to reload Messenger';
  btn.addEventListener('click', (e) => {
    if (btn.classList.contains('back')) location.assign('https://www.facebook.com/messages');
    else if (e.shiftKey) location.reload();
    else { resetView(); btn.classList.remove('shown'); }
  });
  return btn;
}

function clearBadgeButton() {
  const btn = document.createElement('button');
  btn.id = 'messagebae-clear';
  setIcon(btn, 'check');
  btn.dataset.tip = 'Clear the badge count (Cmd+B). To hide the badge, use View > Show Badge Count';
  btn.addEventListener('click', () => ipcRenderer.send('clear-badge'));
  return btn;
}

function alertButton() {
  const btn = document.createElement('button');
  btn.id = 'messagebae-alert';
  setIcon(btn, 'alert');
  const render = () => {
    btn.dataset.tip = alertMode ? 'Notify mode on: new messages bring the window to the front' : 'Notify mode: bring the window to the front on new messages (Cmd+N)';
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
    setIcon(btn, muted ? 'bellOff' : 'bell');
    btn.dataset.tip = muted ? 'Muted. Click to turn notifications and sounds back on' : 'Mute notifications and sounds (Cmd+Shift+M)';
    btn.classList.toggle('on', muted);
  };
  btn.addEventListener('click', () => setMode('mute', !muted));
  redraw.push(render);
  render();
  return btn;
}

// Two-finger swipe sideways over a message or image opens a reply to it.
// The bubble follows the fingers with a rubber band, snaps out once the
// pull is far enough, then springs back, like iMessage on the Mac.
let swipeSum = 0, swipeLast = 0, swipeDone = false, swipeBubble = null, swipeEnd = 0, swipeFresh = false;
const SWIPE_LIMIT = 160, SWIPE_FIRE = 100;
// The message bubble (or image) under a point: the widest ancestor that's
// still clearly narrower than the chat, so it's not the whole row.
function bubbleAt(x, y) {
  const main = document.querySelector('[role="main"]');
  const log = main && (main.querySelector('[role="log"]') || main);
  if (!log) return null;
  // Overlays can sit on top, so take the first element inside the chat.
  let el = document.elementsFromPoint(x, y).find((e) => log.contains(e));
  if (!el || el.closest('[contenteditable="true"]')) return null;
  const max = log.getBoundingClientRect().width * 0.9;
  if (el.getBoundingClientRect().width >= max) return null;
  while (el.parentElement && log.contains(el.parentElement) && el.parentElement.getBoundingClientRect().width < max) el = el.parentElement;
  return el;
}
function swipeRelease() {
  const b = swipeBubble;
  swipeBubble = null;
  if (!b) return;
  b.style.transition = 'transform 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.2)';
  b.style.transform = '';
  setTimeout(() => { if (b !== swipeBubble) b.style.transition = ''; }, 650);
}
function swipeReset() {
  clearTimeout(swipeEnd);
  swipeRelease();
  swipeSum = 0; swipeDone = false; swipeFresh = false;
}
// Trackpad gesture phases from the main process. Fingers lifting springs
// the bubble back at once (momentum events would otherwise hold it out),
// and a new touch starts a fresh swipe, so the same message can be swiped
// again straight away. A begin right after an end is the momentum phase.
let gestureEndAt = 0;
ipcRenderer.on('gesture', (_e, type) => {
  const now = Date.now();
  if (type === 'gestureScrollEnd') { gestureEndAt = now; if (!swipeDone) swipeRelease(); }
  if (type === 'gestureScrollBegin' && now - gestureEndAt > 50) swipeFresh = true;
});
window.addEventListener('wheel', (e) => {
  const now = Date.now();
  // A quiet gap also means a new gesture, in case the phases don't arrive.
  if (swipeFresh || now - swipeLast > 150) swipeReset();
  swipeLast = now;
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) && !swipeSum) return;
  if (!swipeSum && !swipeDone) swipeBubble = bubbleAt(e.clientX, e.clientY);
  // After the reply fires, the rest of this gesture (and its momentum) is ignored.
  if (swipeDone) return;
  clearTimeout(swipeEnd);
  swipeEnd = setTimeout(swipeRelease, 150);
  swipeSum += e.deltaX;
  if (swipeBubble) {
    // Moves with the fingers at first, then eases towards the limit.
    // A short transition smooths the steps between wheel events.
    const d = Math.sign(-swipeSum) * SWIPE_LIMIT * (1 - Math.exp(-Math.abs(swipeSum) / SWIPE_LIMIT));
    swipeBubble.style.transition = 'transform 0.08s ease-out';
    swipeBubble.style.transform = `translateX(${d.toFixed(1)}px)`;
  }
  if (Math.abs(swipeSum) < SWIPE_FIRE) return;
  swipeDone = true;
  clearTimeout(swipeEnd);
  // Commit: glide out to the full pull, hold a moment, then spring back.
  if (swipeBubble) {
    swipeBubble.style.transition = 'transform 0.08s ease-out';
    swipeBubble.style.transform = `translateX(${Math.sign(-swipeSum) * SWIPE_LIMIT * 0.75}px)`;
    swipeEnd = setTimeout(swipeRelease, 120);
  }
  // Only this bubble's own buttons count: buttons left showing on a
  // neighbour (say an image just above) sit within the usual band slack.
  const r = swipeBubble && swipeBubble.getBoundingClientRect();
  const band = r ? [r.top - 8, r.bottom + 8, (r.top + r.bottom) / 2] : undefined;
  replyAt(e.clientX, e.clientY, band).then((ok) => {
    ipcRenderer.send('debug', `swipe reply at ${e.clientX},${e.clientY} ok=${ok}`);
    // Opening a reply can scroll the whole page; put it back.
    setTimeout(() => { document.documentElement.scrollTop = document.documentElement.scrollLeft = 0; document.body.scrollTop = document.body.scrollLeft = 0; }, 100);
  });
}, { capture: true, passive: true });

// Reply to the message under a point. Text messages show a Reply button
// on hover; images only have Reply inside the More actions menu.
async function replyAt(x, y, band) {
  return clickReply(await replyButtonAt(x, y, REPLY_OR_MORE, band));
}
async function clickReply(btn) {
  if (!btn) return false;
  btn.click();
  if (btn.matches(REPLY)) return true;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((m) => /^reply$/i.test(m.innerText.trim()));
    if (item) { item.click(); return true; }
  }
  ipcRenderer.send('debug', 'reply: no Reply item in the More menu');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return false;
}

// Find the Reply button for the message under a point. Messenger shows it
// on hover. Images can sit under overlays, so check every element at the
// point, and nudge a hover if the buttons aren't showing yet.
const REPLY = '[aria-label="Reply" i], [aria-label^="Reply " i], [aria-label*="reply to" i]';
const REPLY_OR_MORE = `${REPLY}, [aria-label="More" i], [aria-label^="More " i]`;
// The vertical band of the message under an element: its row if
// Messenger marks one, otherwise the element itself (e.g. the image).
// A row can hold several messages, so the band is the hovered element
// itself (the image or the text), with a little slack for padding.
function messageBand(el) {
  const r = el.getBoundingClientRect();
  return [r.top - 40, r.bottom + 40, (r.top + r.bottom) / 2];
}
// Only accept a Reply button that sits level with that message, so a
// button left showing on a neighbouring message is never used.
function inBand(btn, [top, bottom]) {
  const r = btn.getBoundingClientRect();
  const cy = r.top + r.height / 2;
  return r.height > 0 && cy >= top && cy <= bottom;
}
function findReply(el, band, sel = REPLY) {
  const main = document.querySelector('[role="main"]');
  if (!main || !main.contains(el)) return null;
  const row = el.closest('[role="row"]');
  const scope = row && main.contains(row) ? row : main;
  // If more than one fits, take the one closest to the message's middle.
  const mid = (b) => { const r = b.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - band[2]); };
  return [...scope.querySelectorAll(sel)].filter((b) => inBand(b, band)).sort((a, b) => mid(a) - mid(b))[0] || null;
}
// band: optional [top, bottom, mid] to use in place of each element's own.
function replyButtonNow(x, y, sel = REPLY, band) {
  for (const el of document.elementsFromPoint(x, y)) {
    const btn = findReply(el, band || messageBand(el), sel);
    if (btn) return btn;
  }
  return null;
}
async function replyButtonAt(x, y, sel = REPLY, band) {
  const btn = replyButtonNow(x, y, sel, band);
  if (btn) return btn;
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  // Messenger only shows the buttons on a real hover. Images don't always
  // trigger it, so also hover the empty space beside the image in its row.
  const spots = [[x, y]];
  const img = el.closest('img, [role="img"]') || el.querySelector('img');
  const main = document.querySelector('[role="main"]');
  if (img && main) {
    const r = img.getBoundingClientRect(), m = main.getBoundingClientRect();
    const cy = Math.round(r.top + r.height / 2);
    if (r.left - m.left > 60) spots.push([Math.round(r.left - 30), cy]);
    if (m.right - r.right > 60) spots.push([Math.round(r.right + 30), cy]);
  }
  for (const [hx, hy] of spots) {
    await ipcRenderer.invoke('hover-at', hx, hy);
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const found = findReply(el, band || messageBand(el), sel);
      if (found) return found;
    }
  }
  return null;
}

// Double-click or press-and-hold a message to open its reactions.
const REACT = '[aria-label="React" i], [aria-label^="React " i]';
function reactTarget(e) {
  const main = document.querySelector('[role="main"]');
  const t = e.target;
  if (!main || !main.contains(t)) return false;
  return !t.closest('[contenteditable="true"], input, textarea, button, a, [role="button"], [role="menu"], [role="dialog"]');
}
function openReacts(x, y) {
  ipcRenderer.send('debug', `react try at ${x},${y} over <${document.elementFromPoint(x, y)?.tagName.toLowerCase()}> buttons=${document.querySelectorAll(REACT).length}`);
  replyButtonAt(x, y, REACT).then((btn) => {
    ipcRenderer.send('debug', `react at ${x},${y} button=${btn ? btn.getAttribute('aria-label') : 'none'}`);
    if (btn) { window.getSelection()?.removeAllRanges(); btn.click(); }
  });
}
window.addEventListener('dblclick', (e) => {
  if (reactTarget(e)) openReacts(e.clientX, e.clientY);
}, true);
// Press and hold, then let go: the picker opens on release, so the
// release itself can't close it (opening it mid-press didn't stick).
let holdStart = null, holdAt = 0, holdFired = false;
window.addEventListener('pointerdown', (e) => {
  holdStart = null; holdFired = false;
  if (e.button !== 0 || !reactTarget(e)) return;
  holdStart = [e.clientX, e.clientY]; holdAt = Date.now();
}, true);
window.addEventListener('pointermove', (e) => {
  if (holdStart && Math.hypot(e.clientX - holdStart[0], e.clientY - holdStart[1]) > 10) holdStart = null;
}, true);
window.addEventListener('pointercancel', () => { holdStart = null; }, true);
// A hold that started a drag (text or image) would never release here; stop the drag.
window.addEventListener('dragstart', (e) => { if (holdStart) e.preventDefault(); }, true);
const holdSwallow = (e) => {
  if (e.type === 'pointerup' && holdStart) {
    const held = Date.now() - holdAt, at = holdStart;
    holdStart = null;
    ipcRenderer.send('debug', `hold released after ${held}ms`);
    if (held >= 300) { holdFired = true; setTimeout(() => openReacts(...at), 30); }
  }
  if (!holdFired) return;
  e.stopImmediatePropagation(); e.preventDefault();
  if (e.type === 'click') holdFired = false;
};
for (const t of ['pointerup', 'mouseup', 'click']) window.addEventListener(t, holdSwallow, true);

// Right-click Reply: remember where the menu opened, tell the main
// process if there's a message there, and click its Reply when chosen.
let ctxPoint = null, ctxReply = null;
// Start looking for the buttons straight away, before the main process asks.
let ctxLookup = null;
window.addEventListener('contextmenu', (e) => {
  ctxPoint = [e.clientX, e.clientY];
  const t0 = Date.now();
  ctxLookup = replyButtonAt(...ctxPoint, REPLY_OR_MORE).then((btn) => {
    ipcRenderer.send('debug', `right-click lookup took ${Date.now() - t0}ms`);
    return btn;
  });
}, true);
// Unsend goes through the message's More button, then Messenger's own
// Unsend menu item and confirm dialog (swapped for a native sheet below). Only your messages (right side).
const MORE = '[aria-label="More" i], [aria-label^="More " i]';
let ctxMore = null;
function isOwnAt(x, y) {
  const main = document.querySelector('[role="main"]');
  if (!main) return false;
  const el = document.elementsFromPoint(x, y).find((e) => main.contains(e) && e.closest('[dir="auto"], img, [role="img"]'));
  const b = el ? el.closest('[dir="auto"], img, [role="img"]').getBoundingClientRect() : { left: x, right: x };
  const m = main.getBoundingClientRect();
  return (b.left + b.right) / 2 > m.left + m.width / 2;
}
ipcRenderer.on('reply-check', async () => {
  ctxReply = ctxLookup ? await ctxLookup : null;
  // Images may show no Reply button, so look for More on its own.
  ctxMore = ctxPoint && isOwnAt(...ctxPoint) ? (replyButtonNow(...ctxPoint, MORE) || await replyButtonAt(...ctxPoint, MORE)) : null;
  if (!ctxReply && ctxPoint) {
    const els = document.elementsFromPoint(...ctxPoint).slice(0, 6).map((e) => `${e.tagName.toLowerCase()}${e.getAttribute('role') ? '[' + e.getAttribute('role') + ']' : ''}${e.getAttribute('aria-label') ? '"' + e.getAttribute('aria-label').slice(0, 20) + '"' : ''}`);
    const vis = (sel) => [...document.querySelectorAll(sel)].filter((b) => b.getBoundingClientRect().height > 0).map((b) => Math.round(b.getBoundingClientRect().top));
    const main = document.querySelector('[role="main"]');
    const y = ctxPoint[1];
    const near = main ? [...main.querySelectorAll('[aria-label]')].filter((b) => { const r = b.getBoundingClientRect(); return r.height > 0 && r.height < 60 && Math.abs(r.top + r.height / 2 - y) < 250; }).map((b) => `"${b.getAttribute('aria-label').slice(0, 30)}"@${Math.round(b.getBoundingClientRect().top)}`) : [];
    ipcRenderer.send('debug', `right-click miss at ${ctxPoint.map(Math.round)} under=${els.join(' > ')} near=${near.join(', ')}`);
  }
  ipcRenderer.send('debug', `right-click reply=${!!ctxReply} unsend=${!!ctxMore}`);
  ipcRenderer.send('reply-check-result', { reply: !!ctxReply, unsend: !!ctxMore, text: ctxPoint ? messageTextAt(...ctxPoint) : '' });
});

// The full text of the message bubble under a point. Messenger puts
// message text in dir="auto" elements; the bubble padding sits just above.
function messageTextAt(x, y) {
  const main = document.querySelector('[role="main"]');
  for (const el of document.elementsFromPoint(x, y)) {
    if (!main || !main.contains(el) || el.closest('[contenteditable="true"]')) continue;
    let t = el.closest('[dir="auto"]');
    if (!t) {
      const r = el.getBoundingClientRect();
      if (r.height < 400) t = el.querySelector('[dir="auto"]');
    }
    const text = t && t.innerText.trim();
    if (text) return text;
  }
  return '';
}
ipcRenderer.on('reply-do', () => { clickReply(ctxReply); ctxReply = null; });
ipcRenderer.on('unsend-do', async () => {
  const more = ctxMore; ctxMore = null;
  if (!more) return;
  more.click();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((m) => /^unsend$/i.test(m.innerText.trim()));
    if (item) { item.click(); return; }
  }
  ipcRenderer.send('debug', 'unsend: no Unsend item in the menu');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
});

// Unsend confirm: Messenger's big "who do you want to unsend this for?"
// dialog is hidden and a native macOS sheet asks instead. Works for both
// right-click Unsend and Messenger's own ... menu. If the dialog's parts
// can't be found, or our clicks don't close it, Messenger's dialog shows.
const unsendSeen = new WeakSet();
let unsendQueued = false;
new MutationObserver(() => {
  if (unsendQueued) return;
  unsendQueued = true;
  // Checked once per frame, before paint, so the dialog never flashes up.
  requestAnimationFrame(() => { unsendQueued = false; findUnsendDialog(); });
}).observe(document, { childList: true, subtree: true });

const labelOf = (el) => (el.innerText || el.getAttribute('aria-label') || '').trim();
// The option text next to a radio: the nearest ancestor with any text.
function radioText(r) {
  for (let el = r, i = 0; el && i < 6; el = el.parentElement, i++) {
    const t = labelOf(el);
    if (t) return t;
  }
  return '';
}
function findUnsendDialog() {
  for (const d of document.querySelectorAll('[role="dialog"]')) {
    if (unsendSeen.has(d) || !/unsend/i.test(d.innerText || '')) continue;
    const radios = [...d.querySelectorAll('[role="radio"], input[type="radio"]')];
    if (!radios.length) continue;
    unsendSeen.add(d);
    handleUnsendDialog(d, radios);
  }
}
// The dialog's outer layer (with its dark backdrop), below <body>.
function dialogLayer(d) {
  let el = d;
  while (el.parentElement && el.parentElement !== document.body && !el.parentElement.querySelector('[role="main"]')) el = el.parentElement;
  return el;
}
// A real click in the middle of el. If something else is on top there (or
// el has no size, like a hidden radio input), use a scripted click instead,
// so a miss never lands on the backdrop and closes the dialog.
function realClick(el, name) {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const hit = r.width && r.height && document.elementFromPoint(x, y);
  const ok = hit && (el.contains(hit) || hit.contains(el));
  ipcRenderer.send('debug', `unsend dialog: ${name} at ${Math.round(x)},${Math.round(y)} ${ok ? 'real click' : 'scripted click, hit ' + (hit ? hit.tagName + '"' + labelOf(hit).slice(0, 20) + '"' : 'nothing')}`);
  if (!ok) { el.click(); return Promise.resolve(); }
  return ipcRenderer.invoke('click-at', x, y);
}
// The clickable row around a radio (the radio input itself can be tiny or hidden).
function radioRow(r) {
  for (let el = r, i = 0; el && i < 6; el = el.parentElement, i++) {
    if (labelOf(el) && el.getBoundingClientRect().height > 0) return el;
  }
  return r;
}
async function handleUnsendDialog(d, radios) {
  const everyone = radios.find((r) => /everyone/i.test(radioText(r)));
  const you = radios.find((r) => /for you/i.test(radioText(r)));
  // Messenger puts a hidden copy of each button's label inside the other
  // button so both end up the same width. Skip those: the first "Remove"
  // in the DOM is the hidden copy inside Cancel, and clicking it does nothing.
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"]');
  };
  const buttons = [...d.querySelectorAll('[role="button"], button')].filter(shown);
  const confirm = buttons.find((b) => /^(remove|unsend)$/i.test(labelOf(b)));
  const cancel = buttons.find((b) => /^(cancel|close)$/i.test(labelOf(b)));
  ipcRenderer.send('debug', `unsend dialog: buttons ${buttons.map((b) => labelOf(b).slice(0, 12)).join('/')} radios ${radios.map((r) => radioText(r).slice(0, 20)).join('/')}`);
  if (!confirm || (!everyone && !you)) {
    return ipcRenderer.send('debug', `unsend dialog: parts missing (everyone=${!!everyone} you=${!!you} confirm=${!!confirm}), showing Messenger's`);
  }
  const layer = dialogLayer(d);
  layer.classList.add('messagebae-hidden');
  const choice = await ipcRenderer.invoke('unsend-confirm', { everyone: !!everyone, you: !!you });
  ipcRenderer.send('debug', `unsend dialog: chose ${choice || 'cancel'}`);
  if (!choice) {
    if (cancel) await realClick(cancel, 'cancel');
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  } else {
    const radio = choice === 'everyone' ? everyone : you;
    await realClick(radioRow(radio), choice);
    await new Promise((r) => setTimeout(r, 150));
    const checked = radio.getAttribute('aria-checked') === 'true' || radio.checked;
    ipcRenderer.send('debug', `unsend dialog: ${choice} picked=${checked}`);
    if (!checked) await realClick(radio, choice + ' radio');
    await new Promise((r) => setTimeout(r, 150));
    await realClick(confirm, 'confirm');
  }
  ipcRenderer.send('debug', `unsend dialog: ${d.isConnected ? 'open' : 'closed'} after clicks`);
  // The layer outlives the dialog and holds the next one, so always unhide
  // it. Still open after a moment? Messenger's dialog shows to finish by hand.
  if (!d.isConnected) layer.classList.remove('messagebae-hidden');
  setTimeout(() => {
    if (d.isConnected) ipcRenderer.send('debug', 'unsend dialog: still open, showing it');
    layer.classList.remove('messagebae-hidden');
  }, 1500);
}

// Brief flash over the page, used by notify mode.
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
  if (emojiOpen()) return; // the emoji list handles its own keys
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
// The containers around the conversation are set to overflow: clip, which
// can't scroll at all, so Messenger (focus, dialogs, quoted replies) can't
// shift the view.
function lockScroll() {
  const onChats = /^\/(messages|t)(\/|$)/.test(location.pathname);
  document.documentElement.classList.toggle('messagebae-lock', onChats);
  const outer = onChats ? new Set(outerScrollers().slice(2)) : new Set();
  document.querySelectorAll('.messagebae-clip').forEach((el) => { if (!outer.has(el)) el.classList.remove('messagebae-clip'); });
  outer.forEach((el) => el.classList.add('messagebae-clip'));
}
setInterval(lockScroll, 500);
window.addEventListener('DOMContentLoaded', lockScroll);

// Some links (e.g. the quoted message in a reply) call scrollIntoView,
// which can scroll the page's outer containers even with overflow hidden,
// shifting the whole view up. On chat screens, undo that straight away.
// The chat list and conversation scroll inside [role="main"] / the nav,
// so only the containers around them are reset.
function outerScrollers() {
  const main = document.querySelector('[role="main"]');
  const els = [document.documentElement, document.body];
  for (let el = main && main.parentElement; el && el !== document.body; el = el.parentElement) els.push(el);
  return els;
}
function resetView() {
  for (const el of outerScrollers()) if (el.scrollTop || el.scrollLeft) el.scrollTop = el.scrollLeft = 0;
}
// Shifted if an outer container has scrolled, or the conversation no
// longer reaches the bottom of the window.
function viewShifted() {
  if (!document.documentElement.classList.contains('messagebae-lock')) return false;
  if (outerScrollers().some((el) => el.scrollTop || el.scrollLeft)) return true;
  const main = document.querySelector('[role="main"]');
  return !!main && main.getBoundingClientRect().bottom < window.innerHeight - 60;
}
// Off the chat screens (e.g. a profile opened from a chat), the button
// becomes "Back to Messenger". Only once chats have loaded this session,
// so it stays hidden on the login pages.
function offChats() {
  const onChats = /^\/(messages|t)(\/|$)/.test(location.pathname);
  try {
    if (onChats) sessionStorage.setItem('messagebae-chats', '1');
    return !onChats && sessionStorage.getItem('messagebae-chats') === '1';
  } catch { return false; }
}
setInterval(() => {
  const btn = document.getElementById('messagebae-resetview');
  if (!btn) return;
  const back = offChats();
  if (back !== btn.classList.contains('back')) {
    btn.classList.toggle('back', back);
    btn.textContent = back ? '← Back to Messenger' : '⤒ Reset view';
    btn.title = back ? 'Go back to your chats' : 'Put the view back if it has shifted. Shift-click to reload Messenger';
  }
  btn.classList.toggle('shown', back || viewShifted());
}, 500);
window.addEventListener('scroll', (e) => {
  if (!document.documentElement.classList.contains('messagebae-lock')) return;
  const t = e.target === document ? document.documentElement : e.target;
  if (outerScrollers().includes(t) && (t.scrollTop || t.scrollLeft)) {
    ipcRenderer.send('debug', `view shifted on <${t.tagName.toLowerCase()}>, resetting`);
    t.scrollTop = t.scrollLeft = 0;
  }
}, true);

// Opening a chat puts the cursor in the message box, ready to type.
let chatPath = location.pathname;
function focusBox(tries) {
  const box = document.querySelector('[role="main"] [contenteditable="true"]');
  if (box && document.activeElement !== box) box.focus();
  if ((!box || document.activeElement !== box) && tries > 0) setTimeout(() => focusBox(tries - 1), 100);
}
setInterval(() => {
  if (location.pathname === chatPath) return;
  chatPath = location.pathname;
  if (/\/t\/[^/]+/.test(chatPath)) setTimeout(() => focusBox(20), 150);
}, 150);

// Arrow keys in the chat search box. Messenger's own highlight wraps and
// jumps to the bottom, so we keep our own: first Up or Down picks the top
// result, Up stops at the top, Down stops at the last result.
let searchIdx = -1;
function searchInput(el) {
  return el && el.matches && el.matches('input') && el.closest('[role="navigation"]') && el.value.trim() ? el : null;
}
function searchResults(input) {
  // Search results live in a listbox outside the chat list (found through
  // aria-controls). The normal chat list stays in the page underneath, so
  // only use its links when there's no results list.
  const id = input.getAttribute('aria-controls');
  const box = (id && document.getElementById(id)) || document.querySelector('[role="listbox"]');
  const shown = (el) => el.getClientRects().length && el.offsetHeight;
  if (box) return [...box.querySelectorAll('[role="option"]')].filter(shown);
  const nav = input.closest('[role="navigation"]');
  return [...nav.querySelectorAll('a[href*="/t/"]')].filter((el) => shown(el) &&
    (input.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
}
// The highlight is our own box drawn on top, as Facebook's styles and
// clipping hide outlines on the result rows.
function searchRing() {
  const ring = document.getElementById('messagebae-searchring');
  const el = document.querySelector('.messagebae-searchpick');
  if (!ring) return;
  if (!el || !el.isConnected) { ring.style.display = 'none'; return; }
  const r = el.getBoundingClientRect();
  Object.assign(ring.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
}
function searchMark(results) {
  document.querySelectorAll('.messagebae-searchpick').forEach((el) => el.classList.remove('messagebae-searchpick'));
  const el = results && results[searchIdx];
  if (el) {
    el.classList.add('messagebae-searchpick');
    el.scrollIntoView({ block: 'nearest' });
    if (!document.getElementById('messagebae-searchring')) {
      const ring = document.createElement('div');
      ring.id = 'messagebae-searchring';
      document.documentElement.appendChild(ring);
    }
  }
  searchRing();
}
document.addEventListener('scroll', searchRing, true);
window.addEventListener('resize', searchRing);
function searchReset() { searchIdx = -1; searchMark(null); }
document.addEventListener('input', (e) => { if (e.target.closest && e.target.closest('[role="navigation"]')) searchReset(); }, true);
document.addEventListener('focusout', (e) => { if (e.target.closest && e.target.closest('[role="navigation"]')) searchReset(); }, true);
window.addEventListener('keydown', (e) => {
  if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.shiftKey || e.metaKey || e.altKey || e.ctrlKey) return;
  const input = searchInput(e.target);
  if (!input) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const results = searchResults(input);
  if (!results.length) return;
  if (searchIdx < 0) searchIdx = 0;
  else searchIdx = Math.max(0, Math.min(searchIdx + (e.key === 'ArrowDown' ? 1 : -1), results.length - 1));
  ipcRenderer.send('debug', `search ${e.key}: now on ${searchIdx} of ${results.length}`);
  searchMark(results);
}, true);

// Enter in the chat search box opens the highlighted result (or the first
// one), then puts the cursor in the message box.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.metaKey || e.altKey || e.ctrlKey) return;
  const input = e.target;
  if (!input.matches || !input.matches('input') || !input.closest('[role="navigation"]') || !input.value.trim()) return;
  const picked = document.querySelector('.messagebae-searchpick');
  const pick = (picked && picked.isConnected && picked) || searchResults(input)[0];
  if (!pick) return ipcRenderer.send('debug', 'search Enter: no result found');
  e.preventDefault();
  e.stopImmediatePropagation();
  const link = pick.matches('a') ? pick : pick.querySelector('a[href*="/t/"]') || pick;
  ipcRenderer.send('debug', `search Enter: opening ${pick.getAttribute('aria-label') || link.getAttribute('href')}`);
  pick.scrollIntoView({ block: 'nearest' });
  const r = pick.getBoundingClientRect();
  ipcRenderer.invoke('click-at', r.left + Math.min(r.width / 2, 120), r.top + r.height / 2)
    .then(() => setTimeout(() => focusBox(20), 300)); // also covers the chat that's already open
}, true);

// :emoji: shortcodes. Typing ":" plus 2+ letters shows a list of matches;
// arrows move, Enter/Tab/click picks, Esc closes. A full ":fire:" swaps
// straight away.
let emojiList = null, emojiPop = null, emojiItems = [], emojiSel = 0, emojiQuery = null;
const emojiOpen = () => !!(emojiPop && emojiPop.style.display === 'block');

function emojiSearch(q, max = 8) {
  const out = [];
  for (const [e, k] of emojiList) {
    let score = -1;
    if (k[0] === q) score = 0;
    else if (k.includes(q)) score = 1;
    else if (k[0].startsWith(q)) score = 2;
    else if (k.some((w) => w.startsWith(q))) score = 3;
    else if (k[0].includes(q)) score = 4;
    if (score >= 0) out.push([score, k[0].length, e, k[0]]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out.slice(0, max).map(([, , e, name]) => ({ e, name }));
}

// The ":query" right before the cursor, if any.
function emojiContext() {
  const sel = getSelection();
  const node = sel.anchorNode;
  if (!sel.isCollapsed || !node || node.nodeType !== 3) return null;
  const before = node.textContent.slice(0, sel.anchorOffset);
  const done = before.match(/(?:^|\s):([a-z0-9_+-]+):$/i);
  if (done) return { node, end: sel.anchorOffset, len: done[1].length + 2, q: done[1].toLowerCase(), done: true };
  const m = before.match(/(?:^|\s):([a-z0-9_+-]{2,})$/i);
  return m ? { node, end: sel.anchorOffset, len: m[1].length + 1, q: m[1].toLowerCase() } : null;
}

function emojiInsert(e) {
  const c = emojiQuery;
  emojiClose();
  if (!c || !c.node.isConnected) return;
  const r = document.createRange();
  r.setStart(c.node, c.end - c.len);
  r.setEnd(c.node, c.end);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  ipcRenderer.send('insert-text', e);
}

function emojiClose() {
  if (emojiPop) emojiPop.style.display = 'none';
  emojiQuery = null;
}

function emojiRender() {
  emojiPop.replaceChildren(...emojiItems.map((it, i) => {
    const row = document.createElement('div');
    row.className = 'item' + (i === emojiSel ? ' sel' : '');
    row.innerHTML = '<span class="e"></span><span class="n"></span>';
    row.firstChild.textContent = it.e;
    row.lastChild.textContent = ':' + it.name + ':';
    row.addEventListener('mousedown', (ev) => { ev.preventDefault(); emojiInsert(it.e); });
    return row;
  }));
}

async function emojiUpdate() {
  const c = emojiContext();
  if (!c) return emojiClose();
  if (!emojiList) emojiList = await ipcRenderer.invoke('emoji-list');
  const items = emojiSearch(c.q);
  if (c.done) {
    emojiQuery = c;
    const exact = items.find((it) => it.name === c.q) || (items[0] && emojiSearch(c.q, 1)[0]);
    if (exact && emojiList.some(([e, k]) => e === exact.e && k.includes(c.q))) return emojiInsert(exact.e);
    return emojiClose();
  }
  if (!items.length) return emojiClose();
  emojiQuery = c;
  emojiItems = items;
  emojiSel = 0;
  if (!emojiPop) {
    emojiPop = document.createElement('div');
    emojiPop.id = 'messagebae-emoji';
    document.documentElement.appendChild(emojiPop);
  }
  emojiRender();
  const r = getSelection().getRangeAt(0).getBoundingClientRect();
  emojiPop.style.display = 'block';
  emojiPop.style.left = Math.min(r.left, innerWidth - emojiPop.offsetWidth - 8) + 'px';
  emojiPop.style.top = Math.max(8, r.top - emojiPop.offsetHeight - 8) + 'px';
}

document.addEventListener('input', (e) => {
  if (e.target.closest && e.target.closest('[contenteditable="true"]')) emojiUpdate();
}, true);
document.addEventListener('focusout', () => setTimeout(() => {
  if (!document.activeElement || !document.activeElement.closest('[contenteditable="true"]')) emojiClose();
}, 0), true);
window.addEventListener('keydown', (e) => {
  if (!emojiOpen()) return;
  const k = e.key;
  if (k === 'ArrowDown' || k === 'ArrowUp') {
    emojiSel = (emojiSel + (k === 'ArrowDown' ? 1 : -1) + emojiItems.length) % emojiItems.length;
    emojiRender();
  } else if (k === 'Enter' || k === 'Tab') {
    emojiInsert(emojiItems[emojiSel].e);
  } else if (k === 'Escape') {
    emojiClose();
  } else return;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

// Click a message or the chat background: put the cursor in the message box.
// Capture phase, as Messenger stops some clicks before they reach window.
window.addEventListener('click', (e) => {
  if (e.button !== 0 || holdFired || !reactTarget(e)) return;
  const { clientX: x, clientY: y } = e;
  const skip = (why) => ipcRenderer.send('debug', `background click at ${x},${y} on <${e.target.tagName.toLowerCase()}> skipped: ${why}`);
  if (!window.getSelection()?.isCollapsed) return skip('text selected');
  if (document.elementsFromPoint(x, y).some((el) => el.matches('img, video, svg, canvas, [role="img"], [role="link"]'))) return skip('media');
  const box = document.querySelector('[role="main"] div[role="textbox"][contenteditable="true"]');
  if (!box) return skip('no message box');
  if (box.contains(e.target)) return;
  ipcRenderer.send('debug', `background click at ${x},${y} on <${e.target.tagName.toLowerCase()}>, focusing box`);
  setTimeout(() => {
    box.focus();
    const r = document.createRange();
    r.selectNodeContents(box); r.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }, 0);
}, true);
