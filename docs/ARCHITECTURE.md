# Architecture

RemoteDeck is a small Node.js server on the Windows PC and a web page on the phone. The server turns HTTP requests into Windows actions through long-running PowerShell helpers.

```
phone (browser / Android WebView)            Windows PC
  public/index.html + public/js/*.js  --HTTP-->  server.js -> server/*
                                                   |-- windows/host.ps1          (system host: volume, windows, files, apps, power)
                                                   |-- windows/host.ps1 (2nd)    (slow requests: browse, apps, diagnostics)
                                                   `-- windows/input-worker.ps1  (mouse, keys, text)
```

## Why long-running helpers

Starting PowerShell and compiling the native C# costs 1-3 seconds. Each helper starts once, compiles once, then answers one JSON request per line, so an action takes milliseconds. Mouse, key and text input have their own helper so a slow request (listing apps, opening a browser) can never delay a keystroke. If the system host cannot start, `server/system.js` falls back to `windows/once.ps1` (one process per action).

## Server (`server/`)

| File | Responsibility |
|---|---|
| `main.js` | HTTP listener, routing, pid file |
| `config.js` | port, pairing code, paths, player and browser lists |
| `json-worker.js` | `JsonLineWorker`: start, queue, time out, restart a PowerShell helper |
| `system.js` | `ps(action, payload)` for the system hosts, with the one-shot fallback |
| `input.js` | mouse/keys/text helper, drag release safety net, last error |
| `sessions.js` | paired phones, pairing code check and rate limit |
| `settings.js` | how keys/text are delivered (`settings.json`) |
| `apps.js` | installed-apps cache; the phone only sees short ids |
| `runtime.js` | which window each page controls |
| `http-util.js` | JSON replies, static files, loopback checks |
| `routes/*.js` | `pair`, `state`, `library` (files, apps), `control`, `admin` (settings, diagnostics, typing test) |

A route is `{ method, path, auth, handler({ req, res, url, body }) }`. Errors thrown by a handler become a JSON error reply.

## Windows layer (`windows/`)

| File | Responsibility |
|---|---|
| `Native.cs` | audio (all outputs), windows, elevation, power. **C# 5 only** (see below) |
| `Input.cs` | mouse, keys (SendInput with scan codes, legacy fallback), Unicode text, clipboard paste |
| `common.ps1` | loads `Native.cs`; helpers for browsers, MPC-HC web interface, volume keys, seeking |
| `actions.ps1` | `Invoke-Action <name> <payload>`: browse, apps, state, diagnostics, control |
| `host.ps1` | the long-running loop around `Invoke-Action` |
| `once.ps1` | one-shot fallback |
| `input-worker.ps1` | the input loop and key-name table |
| `self-test.ps1` | types into its own window with every method and reports what works |

Protocol, one JSON object per line. Host: `{"id","action","payload"}` -> `{"id","ok":true,"result":"<text>"}` or `{"id","ok":false,"error"}`. Input worker: `{"id","action",...fields}` -> `{"id","ok"}`.

**C# 5:** Windows PowerShell 5.1 compiles `Add-Type` code with C# 5. No `?.`, `$"..."`, `=>` members, `out var` or expression-bodied code. `tests/windows/syntax.test.ps1` enforces this.

## Phone UI (`public/js/`)

Plain scripts that share one global scope and load in the order listed in `index.html`: `core` (state, pages, requests), `paint` (state to screen), `session` (polling, commands), then one file per page (`keyboard`, `mouse`, `playback`, `files`, `apps`, `browser`, `tools`), `ui` (chrome, lifecycle), `main` (start). Settings that belong to the phone are in `localStorage` (`remote-media-prefs`).

## Adding a control

1. Add the action name to a group in `server/routes/control.js`.
2. Handle it in `windows/actions.ps1` (or, for input, `windows/input-worker.ps1` and `Input.cs`).
3. Add a button and a handler on the phone.
4. Add tests (below).

## Tests

`npm test` (after `cd tests && npm install`) runs everything it can on the current machine and skips the rest:

- `tests/client`: the real page in jsdom against a simulated PC.
- `tests/server`: the real listener against `tests/fake-powershell` (Linux, macOS, WSL).
- `tests/windows`: the real PowerShell and C# on PowerShell 7: syntax and C# 5 compatibility, key sequences, the persistent host, the input worker against a stub `user32` (needs gcc), and `state`/`control`/power against a mock of the native layer (needs python3).

These cannot prove behaviour on a real Windows PC (window focus, elevation, the actual audio mixer), so the Tools page has a typing test and diagnostics for that.
