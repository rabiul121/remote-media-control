# RemoteDeck

RemoteDeck is an Android remote and a Windows tray receiver for media playback, files, browser, windows, pointer, and keyboard control over a trusted local network.

## Requirements

- Windows 10 or 11 with Node.js 18 or newer.
- Android phone on the same Wi-Fi or local network as the Windows PC.
- Android SDK installed to build the APK. No .NET SDK is required.

## Install and pair

1. Run `setup.bat` and choose **1. Install and start**. This installs the Node dependency and creates Desktop, Start menu, and sign-in Startup shortcuts. The receiver runs in the system tray without an open terminal.
2. Right-click the RemoteDeck tray icon and choose **Show pairing QR...**.
3. Install the Android APK and tap **Scan pairing QR**. Manual connection is also available with separate IP and port fields.
4. Keep the phone and PC on the same network. Allow Node.js through Windows Firewall on a private network if prompted.

The tray menu can show the current IP and pairing code, open the local remote, restart the listener, or exit. The pairing code changes when the receiver starts. Paired devices are remembered by the phone and host, and remain paired for up to a year without use.

`setup.bat` also provides **Uninstall**, **Disable automatic startup only**, **Start the listener now**, and **Exit**. Disabling startup keeps the Desktop and Start menu shortcuts. Uninstall removes shortcuts and stops the receiver while leaving project files and the APK intact.

## Android APK

Build a debug APK with:

```bat
android\build-apk.bat
```

The APK is written to `android\app\build\outputs\apk\debug\app-debug.apk`. Android remembers the PC address and pairing token between launches. The bundled QR scanner can pair directly from the tray QR page.

## Features

### Playback

- Play/pause, previous/next, 5-second and 30-second seeks, player volume and mute, and Windows system volume.
- Volume step buttons adjust by 5 points.
- Supported players: VLC, MusicBee, PotPlayer, K-Lite Codec Pack (MPC-HC), and Windows Media Player. Open/close player and fullscreen controls are available where supported.
- Per-player volume requires an active audio session. The 30-second seek repeats the player’s short-jump shortcut six times; configure that shortcut as 5 seconds in the player for an exact 30-second jump.

### Files and windows

- Browse drives, folders, and files from the phone. Media opens in the selected player; other files open in their Windows default app.
- Use Explorer arrow, Tab, Shift+Tab, Enter, and close controls while browsing.
- Control the active default-app window with arrows, Home/End, Page Up/Down, minimize, maximize, fullscreen, restore, and close.

### Apps

- The Apps page lists the programs and Store apps in the Windows Start menu, grouped A to Z. Type in the search box to filter (case and accent insensitive, several words in any order), tap an app to open it, or press Go/Enter on the keyboard to open the best match.
- The list is cached on the PC for five minutes; the reload button fetches it again. "Uninstall" shortcuts are hidden. The phone can only start apps that appear in the list.
- After an app opens, the Window page controls follow it automatically.

### Browser

- Open the Windows default browser, Edge, Chrome, Firefox, or Brave when installed.
- Enter a web address, search with Google, Bing, DuckDuckGo, or Yahoo, or open YouTube, Facebook, and Google with one tap.
- Browser controls include back/forward/reload/home, arrows, Page Up/Down, Tab/Shift+Tab, Enter, Escape, close tab, close browser, fullscreen, minimize, maximize, and restore.

### Mouse and keyboard

- The Mouse page provides touchpad pointer movement. Tap to click, double-tap for a double click, and long-press for right click. Tap and then touch again and slide (or hold) to drag, for example a window's scroll bar. For precise drags use **Hold & drag**: place the pointer, tap the toggle, move the touchpad, then tap the toggle again to release. Two-finger swipes scroll. Pinch and Zoom buttons send Ctrl+wheel to the foreground app. A **Ctrl+Home** bar sits above the touchpad and a **Ctrl+End** bar below it, jumping the foreground app to the top or bottom. Reset reverses the zoom steps RemoteDeck sent to the same foreground window during the current listener session, avoiding app-specific reset shortcuts. Zoom only works in apps that implement Ctrl+wheel zoom; Windows has no universal app-content zoom command.
- The Keyboard page has a full-size layout with shifted punctuation and live Caps Lock, Num Lock, and Scroll Lock indicators. Swipe over the keyboard to scroll vertically and horizontally on phone displays.
- Mouse and Keyboard pages link directly to each other. All control sections also provide quick links to them.

### Appearance

- Switch between dark and light themes from the theme button.
- The Home page provides shortcuts to Playback, Files, Apps, Browser, Window, Mouse, and Keyboard.

## Configuration

The receiver listens on port `8765` on the local network by default. Set the `PORT` environment variable before starting it to use another port. The pairing QR and the tray menu links follow the selected port.

After 8 wrong pairing codes a device is locked out for 5 minutes.

## Troubleshooting

- If the phone cannot connect, verify the PC’s current IP and port in the tray menu, confirm both devices are on the same network, and allow Node.js through Windows Firewall on a private network.
- If the Apps list is empty or fails to load, reload it once; listing needs Windows 10 or 11.
- If the listener will not start, check `%LOCALAPPDATA%\RemoteMediaControl\listener-error.log`; "port already in use" means another copy is running.
- If browser controls appear unavailable, open the browser from the Browser page so RemoteDeck can register its window.
- If player seeking differs from the expected jump, check the selected player’s keyboard shortcut settings.
- If per-player volume is unavailable, start audio in that player and refresh its status.

## Release history

See [CHANGELOG.md](CHANGELOG.md) for release notes.
