# Changelog

## 1.3.0

- Fixed: seeking in a maximized player (MusicBee and others) shrank the window. Only minimized windows are restored now.
- Player volume: all active audio outputs are searched (not only the default one); MPC-HC / K-Lite can be controlled through its web interface; players whose own volume Windows cannot see get - / + buttons that press the player's volume keys, with an explanation, instead of a dead slider.
- Keyboard: key events now carry hardware scan codes; if Windows rejects simulated input the keys fall back to the legacy method and text falls back to clipboard paste (the clipboard is restored); the real error is shown instead of a silent failure.
- Keyboard: **Test and fix typing** (Tools, and a Test button on the Keyboard page) tries every method in a small window and switches to what works. Apps running as administrator, which Windows protects from simulated input, are called out with what to do.
- Keyboard: Quick keys row (Alt+Tab, Win+D, Win+S, copy/paste/undo, Alt+F4, Task Manager, and more).
- Mouse page redesigned: a larger touchpad, and controls grouped as Click (left, double, right, drag), Scroll (up, down, Top = Ctrl+Home, Bottom = Ctrl+End) and Zoom.
- New Tools page: power (lock, sleep, screen off, restart, shut down with a 15 second Cancel), pointer and scroll speed, natural scrolling, vibration, keep screen on, reopen last page, typing settings, diagnostics, sign out other phones.
- Faster: Windows actions run in long-running PowerShell hosts instead of a new process each time (one for status/control, one for slow file and app requests, one for input).
- Code: the server is split into modules (`server/`), the Windows scripts into `windows/`, the phone UI into feature files (`public/js/`); see docs/ARCHITECTURE.md. New automated tests (`npm test`).

## 1.2.1

- Browser: a browser that was opened by hand, or that opened behind other windows, is now found by process instead of only by "which window came to the front", so controls no longer report it as not detected. The default browser is named in the list (for example "Default browser (Brave)"), a newly opened browser is brought to the front, and new **Bring to front** and **Address bar** buttons were added.
- Keyboard: key presses and typed text now use the persistent input worker instead of starting PowerShell for every key, so typing is fast and arrives in order.
- Keyboard: new phone-keyboard typing box that sends text as you type (Bengali, accents and emoji included, backspace and autocorrect handled, Enter presses Enter).
- Keyboard: a **Typing into** line shows which window receives the keys.
- Keyboard: Ctrl, Alt, Shift and Win are now one-shot (double-tap to lock), clearly highlighted, shown in a status line, and clear themselves after 10 seconds. Before, an armed modifier had no visual state and stayed latched, so a stray Alt tap turned Esc into Alt+Esc, which cycles through apps. Any Ctrl/Alt/Shift/Win that is stuck down on the PC is released before the next key.
- Keyboard: the right-hand "Alt" key now arms Alt instead of sending a lone Alt tap.
- Keyboard: zoom the layout with −, +, Fit or a two-finger pinch; the size is remembered.

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
