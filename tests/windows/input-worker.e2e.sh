#!/usr/bin/env bash
# Runs the REAL windows/input-worker.ps1 on Linux against a stub user32 that logs what it receives.
# Proves: struct size, scan codes, the legacy/paste fallbacks and error reporting. Needs gcc and PowerShell 7.
# usage: input-worker.e2e.sh <path-to-pwsh> <work-dir>
set -u
PWSH="$1"; WORK="$2"; HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
export STUB_DIR="$WORK" DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
mkdir -p "$WORK/win" && cp "$REPO"/windows/*.ps1 "$REPO"/windows/*.cs "$WORK/win/"
gcc -shared -fPIC -o "$WORK/libuser32.so" "$HERE/user32-stub.c" 2>/dev/null || { echo "SKIP no C compiler"; exit 0; }
# .NET cannot probe native libraries for an in-memory assembly on Linux, so point the imports at the stub by absolute path.
sed -i "s#\"user32.dll\"#\"$WORK/libuser32.so\"#g; s#\"kernel32.dll\"#\"$WORK/libuser32.so\"#g" "$WORK/win/Input.cs"
pass=0; fail=0
run() { rm -f "$WORK/calls.log"; printf '%s\n' "$@" | timeout 90 "$PWSH" -NoProfile -File "$WORK/win/input-worker.ps1" 2>&1; }
seen() { grep -q -- "$1" "$WORK/calls.log" 2>/dev/null; }
# A reply is one JSON line; PowerShell does not promise key order, so look for each part separately.
reply() { echo "$1" | grep "\"id\":\"$2\"" | grep -q "$3"; }
ok() { if [ "$1" = 0 ]; then pass=$((pass+1)); echo "PASS $2"; else fail=$((fail+1)); echo "FAIL $2"; fi; }
rm -f "$WORK/fail_sendinput"

out=$(run '{"id":"1","action":"keyboardPress","key":"S","modifiers":{"ctrl":false,"alt":false,"shift":false,"win":true}}' '{"id":"2","action":"keyboardPress","key":"ESCAPE","modifiers":{}}')
reply "$out" 1 '"ok":true'; ok $? "Win+S answered ok"
seen "cbSize=40"; ok $? "INPUT struct is 40 bytes (what Windows expects on 64-bit)"
seen "KEY vk=0x5B scan=0x005B flags=1"; ok $? "Win key: extended flag and scan code"
seen "KEY vk=0x53 scan=0x0053 flags=0"; ok $? "S key down carries its scan code"
seen "KEY vk=0x1B scan=0x0001 flags=0"; ok $? "Esc carries scan code 0x01 like a real keyboard"
[ "$(grep -c 'KEY vk=0x5B' "$WORK/calls.log")" = 2 ]; ok $? "Win pressed once and released once"

out=$(run '{"id":"1","action":"typeText","text":"Hi"}')
seen "KEY vk=0x00 scan=0x0048 flags=4"; ok $? "text 'H' sent as a Unicode key event"

run '{"id":"1","action":"configure","keyMethod":"legacy","textMethod":"unicode","fallback":true}' '{"id":"2","action":"keyboardPress","key":"A","modifiers":{"ctrl":true}}' >/dev/null
seen "keybd_event vk=0x11"; ok $? "legacy method uses keybd_event (Ctrl down)"
! seen "SendInput"; ok $? "legacy method does not touch SendInput"

touch "$WORK/fail_sendinput"
out=$(run '{"id":"1","action":"keyboardPress","key":"A","modifiers":{}}')
echo "$out" | grep -q '"ok":true'; ok $? "Windows rejects SendInput: the key is still delivered"
seen "SendInput REJECTED"; ok $? "...after the rejection was seen"
seen "keybd_event vk=0x41"; ok $? "...through the legacy fallback"
out=$(run '{"id":"1","action":"typeText","text":"Hello"}')
echo "$out" | grep -q '"ok":true'; ok $? "SendInput rejected: typed text still delivered"
seen "SetClipboardData len=5"; ok $? "...by pasting"
seen "keybd_event vk=0x56"; ok $? "...with Ctrl+V sent through the legacy path"
out=$(run '{"id":"1","action":"configure","keyMethod":"sendinput","textMethod":"unicode","fallback":false}' '{"id":"2","action":"keyboardPress","key":"A","modifiers":{}}')
reply "$out" 2 '"ok":false'; ok $? "fallback off: the failure is reported, not hidden"
echo "$out" | grep -q 'Windows accepted 0 of'; ok $? "...with a readable message"
rm -f "$WORK/fail_sendinput"

run '{"id":"1","action":"configure","keyMethod":"sendinput","textMethod":"paste","fallback":true}' '{"id":"2","action":"typeText","text":"Hello বাংলা"}' >/dev/null
seen "SetClipboardData len=11"; ok $? "paste method: Bengali text placed on the clipboard (11 characters)"
seen "KEY vk=0x56"; ok $? "paste method: Ctrl+V sent"
echo; echo "$pass passed, $fail failed"; [ "$fail" = 0 ]
