# Changelog

## 1.2.0

- Mouse page: click-and-drag now works (scroll bars, window edges, text selection). Tap, then touch again and slide or hold; or use the new **Hold & drag** toggle, move the touchpad, and tap the toggle again to release. The button is always released if you leave the page, background the app, or lose the connection for 30 s.
- Added an Apps page: browse every Start-menu app, search it, and open it from the phone.
- Mouse page: Ctrl+Home now sits above the touchpad and Ctrl+End below it.
- Navigation keys (Home, End, arrows, PgUp/PgDn, Ins/Del, Win) are sent as extended keys so apps no longer mistake them for numeric-keypad keys.
- Security: pairing codes are rate limited (8 failures, 5 minute lockout) and compared in constant time; a code that is not exactly six digits is replaced by a random one (an empty code used to pair anyone); the QR endpoint rejects non-loopback Host headers (DNS rebinding).
- Reliability: a malformed URL such as `/%` no longer crashes the listener; mouse-worker pipe errors and hung PowerShell/mouse calls time out instead of crashing or hanging; a second copy started on a busy port no longer deletes the running copy's pid file; the tray backs off instead of respawning a failing listener every 2.5 s and honours `PORT`.
- Pairing with the code now loads files and starts status updates immediately (previously only after a reload); an expired session returns to the pairing screen.
- Performance: folder browsing skips the native-code compile; browser detection is cached for five minutes; status polling no longer overlaps or runs while the phone is in the background.
- Removed a stray mouse-up sent every time the page was hidden.

## 1.1.0

- Added modular Home, Playback, Files, Browser, Window, Mouse, and Keyboard pages with quick navigation.
- Expanded browser controls, including address and provider search, tab navigation, close tab, and close browser.
- Added Explorer navigation and controls for default applications.
- Reworked the keyboard into a full-size layout with shifted legends and lock-state indicators.
- Improved touchpad gestures and vertical/horizontal keyboard scrolling on phones.
- Added light and dark themes and removed routine success toasts while retaining error feedback.
- Improved tray startup and window targeting; paired devices remain paired across receiver restarts.
- Removed unused Android WebView imports/settings and the redundant `start.bat` launcher.
