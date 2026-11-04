# messageBae

A small macOS app for Facebook Messenger chats. It wraps facebook.com/messages in its own window and adds keyboard shortcuts, a mute toggle and a menu bar icon.

> Unofficial. Not affiliated with or endorsed by Meta. It may break when Facebook changes its site.

## Features
- Own window with no Facebook top bar
- Stays logged in between launches
- Unread count on the dock icon and in the menu bar
- Notifications; clicking one brings the window forward
- Mute toggle to pause notifications and sounds
- Keyboard shortcuts you can change
- Links outside Facebook open in your default browser

## Install
Requires macOS and Node.js 20+.

```sh
git clone <repo-url>
cd messagebae
npm install
npm start
```

- If `npm start` says Electron failed to install, run `npx install-electron --no` (npm 11 can skip its download step).
- To build an app: `npm run dist`. The `.dmg` ends up in `dist/`.

## Shortcuts
| Key | Action |
| --- | --- |
| Cmd+K | Search chats |
| Cmd+L | Jump to message box |
| Esc (in message box) | Clear current line |
| Esc Esc | Clear whole message |
| Cmd+1–9 | Open chat 1–9 in the sidebar |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous chat |

### Changing shortcuts
- Choose **Edit Shortcuts…** (Cmd+,) from the app menu.
- Edit `~/Library/Application Support/messagebae/settings.json`. Key names follow [Electron accelerators](https://www.electronjs.org/docs/latest/api/accelerator).
- Choose **Reload Shortcuts**.
- Defaults live in `src/defaults.json`.

## Tips
- Closing the window hides it. Use Cmd+Q to quit.
- Menu bar icon: click to show or hide, right-click for Quit.
- Bell at top right: mute this app's notifications and sounds. Stays on until you click it again.

## Project layout
- `src/main.js`: window, menu, shortcuts, dock badge, tray
- `src/preload.js`: notification clicks, Esc handling
- `src/inject.css`: layout tweaks to Facebook's page
- `src/defaults.json`: default shortcuts
- `scripts/make-icons.js`: regenerates icons (`npm run icons`)
- `scripts/release.sh`: publishes a release (`npm run release 0.2.0`)

## When something breaks
Facebook changes its page often. If a shortcut or style stops working:
- Open **View → Toggle Developer Tools**.
- Inspect the element that changed.
- Update the selector in `src/main.js`, `src/preload.js` or `src/inject.css`.

## License
[PolyForm Noncommercial 1.0.0](LICENSE.md). Source-available, not open source.
- Free for personal and other noncommercial use.
- Commercial use: email messageBae@jchin.au.
