# messageBae

A small macOS app for Facebook Messenger. It opens facebook.com/messages in its own window, with shortcuts, mute and a menu bar icon.

> Unofficial. Not made by or linked to Meta. May break when Facebook changes its site.

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/jchin14)

## Install
Download the `.dmg` from the [latest release](https://github.com/jchin14/messageBae/releases/latest), open it and drag messageBae into Applications. It's signed and notarised by Apple.

## Updates
messageBae checks for a new version on launch and every 12 hours, or use **messageBae > Check for Updates…**.

- **Free:** download the new `.dmg`, quit messageBae, drag it into Applications and choose **Replace**. Your settings stay.
- **Supporters:** [donate any amount](https://buymeacoffee.com/jchin14). The thank you page shows a supporter code. Choose **messageBae > Turn On Auto Update…**, pick **Enter Code…** and paste it in. New versions download and install themselves, you just restart when asked.

The code is the same for everyone and only its hash is in the app. It's a small gate, not a licence check, so please donate before using it.

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
| Enter in search | Open the top result and jump to the message box |
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

## Notifications (View > Notifications)
- **Source:** Messenger's web notifications, messageBae's own, or Off.
- **Sound:** Default, None, any macOS sound, or Choose File… for your own. Picking one plays a preview.
- **Silence Messenger's Pop Sound** stops the in-page pop, so only your sound plays.

## Reset view
- The window stays put if Messenger tries to scroll it (like clicking a quoted reply).
- If it ever shifts, a **Reset view** button shows bottom right. Click to reset, Shift-click to reload.
- If you open a profile or other Facebook page from a chat, a **Back to Messenger** button shows bottom right.

## Known limitations
- Voice and video calls don't work yet.
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
- **Unsend** on your own messages and images, with a small Mac popup to confirm in place of Messenger's big one (also from Messenger's own ⋯ menu).
- **Spelling** on a misspelled word: macOS suggestions and Add to Dictionary.
- **Copy Message** copies the whole message. **Copy** copies selected text.
- On images: copy or save.

## Mac menus and dialogs
The app menu, right-click menus and confirmations (unsend, updates, the supporter code) are native Mac menus and sheets, not web popups.

## Links
- All links, Facebook ones included, open in your default browser.

## Startup
- Opens in front, unless you switch to another app while it loads. Then it waits in the background.
- Closing the window (Cmd+W) hides it. Cmd+Q quits.

## Settings
In the **View** menu:
- **Clear Badge**: reset the unread count to 0
- **Show Badge Count**: on/off
- **Show Menu Bar Icon**: on/off
- **Restore Window Size After Close**: opens where you last left it
- **Save Current Window Size and Position for Launch**: opens at this size, on this monitor
- **Forget Saved Window Size**: back to the default
- **Open in Background on Launch**: start hidden

Change shortcuts with **Edit Settings…** (Cmd+,), then **Reload Settings**. The file is
`~/Library/Application Support/messageBae/settings.json`.

## Issues
Found a bug or something not working? [Open an issue](https://github.com/jchin14/messageBae/issues) on GitHub.

## Support

If you find this useful and can afford to, support is appreciated: [buy me a coffee](https://buymeacoffee.com/jchin14). Just getting started, the domain, hosting, Cloudflare Workers and Apple and Google developer accounts add up to a few hundred dollars. Your support helps me keep making tools that are helpful for everyone.

## License
[PolyForm Noncommercial 1.0.0](LICENSE.md). Free for personal use. For commercial use, email [licensing@jchin.au](mailto:licensing@jchin.au) or [open an issue](https://github.com/jchin14/messageBae/issues).
