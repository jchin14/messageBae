# messageBae

A small macOS app for Facebook Messenger. It opens facebook.com/messages in its own window, with shortcuts, mute and a menu bar icon.

> Unofficial. Not made by or linked to Meta. May break when Facebook changes its site.

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/jchin14)

## Install
Download the `.dmg` from the [latest release](https://github.com/jchin14/messageBae/releases/latest), open it and drag messageBae into Applications. It's signed and notarised by Apple.

## Build from source
Only if you know your way around the command line. Most people should use the release above.

Needs macOS and Node.js 20+.

```sh
git clone https://github.com/jchin14/messageBae.git
cd messageBae
npm install
npm start
```

Build the app with `npm run dist`. It bumps the version first, then builds into `dist/`.

## Shortcuts
Keep your hands on the keyboard. The shortcuts work like the ones you know from iMessage and other Mac apps, so there's nothing new to learn.

**TL;DR**
- **Cmd+K** find a chat, **Cmd+L** start typing
- **Cmd+1-9** jump straight to a chat, **Ctrl+Tab** / **Ctrl+Shift+Tab** next / previous chat
- **Cmd+U** attach a photo or file (drag and drop still works too)
- Click anywhere in a chat to start typing
- **Cmd+Shift+M** toggle mute, **Cmd+N** toggle notify mode, **Cmd+B** clear badge
- Swipe with two fingers to reply, double-click or hold to react, like on your phone

| Key | Does |
| --- | --- |
| Cmd+K | Search chats |
| Cmd+L | Go to message box |
| Cmd+U | Attach a photo or file (or drag and drop) |
| Cmd+B | Clear the badge count |
| Cmd+N | Toggle notify mode (!) |
| Cmd+Shift+M | Toggle mute |
| Cmd+1-9 | Open chat 1-9 |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous chat |
| Esc ×2 | Clear the current line |
| Esc ×3 | Clear the whole message |
| Hold Esc | Leave full screen |
| Two-finger swipe sideways on a message or image | Reply to it |
| Double-click or hold a message | React to it |
| Click anywhere in a chat (not an image or button) | Start typing (jumps to the message box) |
| `:name` | Emoji list (Enter/Tab picks, Esc closes). `:fire:` swaps straight away |

## Buttons (top right)
- **+** attaches a photo or file (also Cmd+U).
- **✓** clears the badge count. New messages count up from 0.
- **!** brings the window to the front when a message comes in.
- **🔔** mutes notifications and sounds (shows a red **🔕** when on).
- **↻** reloads Messenger.
- Only one of ! and 🔔 can be on at a time.

## Reset view
- The window stays put if Messenger tries to scroll it (like clicking a quoted reply).
- If it ever shifts, a **Reset view** button shows bottom right. Click to reset, Shift-click to reload.

## Known limitations
- Clicking a quoted message in a reply makes the screen jump briefly. Messenger scrolls the window up and messageBae moves it straight back. This can't be avoided.

## Window and panels
- Resize the window like any Mac app. Messenger's own buttons (share, view profile and so on) all work.
- With both window options set, **Restore Window Size After Close** wins.
- If the saved monitor isn't connected, the window opens at the default size.
- Drag the edge of the chat list or the info panel to resize it.
- Double-click the edge to reset.
- Widths are saved between launches.

## Right-click
- **Reply** on any message or image.
- **Unsend** on your own messages and images (Messenger asks to confirm).
- **Copy Message** copies the whole message. **Copy** copies selected text.
- On images: copy, save, or copy the address.

## Links
- Facebook links open in a new messageBae window. Other links open in your browser.
- Prefer your browser for everything? Tick **View > Open Facebook Links in Browser**.

## Startup
- Opens in front, unless you switch to another app while it loads. Then it waits in the background.
- Closing the window (Cmd+W) hides it. Cmd+Q quits.

## Settings
In the **View** menu:
- **Clear Badge**: reset the unread count to 0
- **Show Badge Count**: on/off
- **Show Menu Bar Icon**: on/off
- **Open Facebook Links in Browser**: on/off
- **Restore Window Size After Close**: opens where you last left it
- **Save Current Window Size and Position for Launch**: opens at this size, on this monitor
- **Forget Saved Window Size**: back to the default
- **Open in Background on Launch**: start hidden

Change shortcuts with **Edit Settings…** (Cmd+,), then **Reload Settings**. The file is
`~/Library/Application Support/messageBae/settings.json`.

## Issues
Found a bug or something not working? [Open an issue](https://github.com/jchin14/messageBae/issues) on GitHub.

## License
[PolyForm Noncommercial 1.0.0](LICENSE.md). Free for personal use. For commercial use, email [licensing@jchin.au](mailto:licensing@jchin.au) or [open an issue](https://github.com/jchin14/messageBae/issues).
