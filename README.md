# messageBae

A small macOS app for Facebook Messenger. It opens facebook.com/messages in its own window, with shortcuts, mute and a menu bar icon.

> Unofficial. Not made by or linked to Meta. May break when Facebook changes its site.

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/jchin14)

## Install
Needs macOS and Node.js 20+.

```sh
git clone https://github.com/jchin14/messageBae.git
cd messageBae
npm install
npm start
```

Build the app with `npm run dist`. It bumps the version first, then builds into `dist/`.

## Shortcuts
| Key | Does |
| --- | --- |
| Cmd+K | Search chats |
| Cmd+L | Go to message box |
| Cmd+1–9 | Open chat 1–9 |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous chat |
| Esc ×2 | Clear the current line |
| Esc ×3 | Clear the whole message |
| Hold Esc | Leave full screen |
| Two-finger swipe sideways on a message | Reply to it |

## Buttons (top right)
- **✓** clears the badge count. New messages count up from 0.
- **!** brings the window to the front when a message comes in.
- **🔔** mutes notifications and sounds.
- Only one of ! and 🔔 can be on at a time.

## Panels
- Drag the edge of the chat list or the info panel to resize it.
- Double-click the edge to reset.
- Widths are saved between launches.

## Startup
- Opens in front, unless you switch to another app while it loads. Then it waits in the background.
- Closing the window (Cmd+W) hides it. Cmd+Q quits.

## Settings
In the **View** menu:
- **Clear Badge**: reset the unread count to 0
- **Show Badge Count**: on/off
- **Show Menu Bar Icon**: on/off
- **Open in Background on Launch**: start hidden

Change shortcuts with **Edit Settings…** (Cmd+,), then **Reload Settings**. The file is
`~/Library/Application Support/messageBae/settings.json`.

## License
[PolyForm Noncommercial 1.0.0](LICENSE.md). Free for personal use. For commercial use, email messageBae@jchin.au.
