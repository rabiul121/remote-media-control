# RemoteDeck

A lightweight Windows tray host with a responsive phone remote for media, files, browser, windows, mouse, and keyboard control. No .NET SDK is required.

## Start

1. Install Node.js 18 or newer on the Windows PC.
2. In this folder, run `setup.bat` and choose **1. Install and start**. The receiver runs without a terminal window in the system tray.
3. On the Windows PC, right-click the tray icon and choose **Show pairing QR...**.
4. On Android, tap **Scan pairing QR** and scan the code. This fills the Wi-Fi IP and port, pairs the phone, and opens the remote.

## Windows tray and shortcuts

`setup.bat` has install/start, uninstall, and disable-startup options. Install creates RemoteDeck shortcuts on the Desktop, in the Start menu, and in per-user Windows Startup, and installs the QR generator dependency. The receiver starts hidden in the tray when you sign in. Right-click its tray icon to show the pairing QR, view the Wi-Fi address and pairing code, open the local remote, restart the listener, or exit. The tray receiver keeps the server running if Node exits. `start.bat` also starts the receiver through a hidden launcher.

Choose **3. Disable automatic startup only** to keep the quick-launch shortcuts while preventing automatic start at sign-in. Uninstall stops the listener and removes shortcuts, while keeping project files and the APK.

## Android app

The native Android project is in `android/`. Build a debug APK with `android\build-apk.bat`; the APK is written to `android\app\build\outputs\apk\debug\app-debug.apk`. Install it on the phone and scan the QR on the Windows PC. The app remembers the PC address and pairing token. Manual connection also has separate IP and port boxes and displays a retry/change-address message if the host cannot be reached.

Windows may ask whether Node.js can accept connections on private networks; allow it for your home/private network. The host binds to all network interfaces on port 8765 by default. Set `PORT` to use another port.

## Controls

- Play/pause, previous, and next send the standard Windows media keys to the current media session.
- Seek buttons bring the selected player window forward and send its seek shortcut: Shift+Arrow for VLC, Arrow for PotPlayer and MPC-HC. MusicBee uses Left/Right; if those keys are assigned differently, change the seek hotkeys in MusicBee preferences.
- System volume changes the default Windows output device.
- Player volume and mute use the Windows per-app audio mixer and require an active audio session.
- Volume step buttons raise or lower system or player volume by 5 points.
- Seek controls offer 5-second and 30-second jumps. The 30-second action repeats the player's short-jump shortcut six times; set the short jump to 5 seconds in player preferences for exact 30-second jumps. For K-Lite, select MPC-HC.
- Full screen is available for VLC, PotPlayer, and MPC-HC. The selected video player is focused before its fullscreen shortcut is sent.
- The Files section browses Windows drives, folders, and files. Audio and video open in the selected player; other file types, including images, documents, and PDFs, open with their Windows default app. The default-app controls send Page Up/Down for scrolling, Left/Right for previous/next image, F11 for full screen, and provide maximize, restore, and close actions.
- The remote is organized into Playback, Files, Browser, Window, Mouse, and Keyboard tabs. Opening a non-media file from Files takes you to Window controls for that app. Window sizing controls act directly on the opened window; keyboard shortcuts can vary between default apps.
- Phone pairing tokens are saved by the Android app and Windows host, survive listener restarts, and renew while used. A device remains paired for up to one year without use before it needs to scan the QR again.
- Browser supports the Windows default browser, Edge, Chrome, Firefox, and Brave when installed. Use the address box, choose Google/Bing/DuckDuckGo/Yahoo for web searches, or tap YouTube, Facebook, and Google. Browser controls include navigation, window sizing, fullscreen, arrows, Page Up/Down, Tab, Enter, and Escape.
- The Mouse tab provides a touchpad for cursor movement, left/right/double/middle click, selection by dragging while selection is active, and scrolling. Two-finger vertical swipes scroll and pinch gestures zoom the active Windows app. Pointer movement is handled by a persistent Windows input worker for responsive control.
- The Keyboard tab fits the standard keyboard to phone width, includes arrow and navigation keys, and can open a floating numpad. Modifier buttons support shortcuts such as Ctrl+C and Alt+F4.
- Use the sun/moon button to switch between dark and light themes. Buttons use larger touch targets for phone use.
- Use Open player and Close player below the player list to manage the selected player from the phone.
- VLC, MusicBee, PotPlayer, MPC-HC, and Windows Media Player are recognized for per-app mixer volume. Start playback for the app mixer control to appear. The playback keys target the current Windows media session.

The pairing code changes each time the host starts. Paired device tokens are stored on the PC and expire after a year of inactivity. This is intended for a trusted local network.

## Troubleshooting

- If the phone cannot open the page, check that both devices are on the same Wi-Fi and Windows Firewall allows Node.js on a private network.
- If a player seek button behaves differently, update that player's keyboard shortcut mapping; the remote sends the keys listed above.
- If the app volume slider is unavailable, start audio in the player and tap refresh.
