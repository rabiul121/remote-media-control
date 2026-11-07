$ErrorActionPreference='Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # repository root
$pass=0;$fail=0
function Ok($c,$m){ if($c){$script:pass++;"PASS $m"}else{$script:fail++;"FAIL $m"} }

# Key sequences, key-name mapping and default-browser detection (needs PowerShell 7 on Linux/macOS)
Add-Type -TypeDefinition (Get-Content -Raw "$root/windows/Input.cs") -Language CSharp
$bf=[Reflection.BindingFlags]'NonPublic,Static'
function Decode($arr){ ($arr | % {
  $u=$_.GetType().GetField('value').GetValue($_); $k=$u.GetType().GetField('keyboard').GetValue($u)
  $vk=$k.GetType().GetField('virtualKey').GetValue($k); $sc=$k.GetType().GetField('scanCode').GetValue($k); $fl=$k.GetType().GetField('flags').GetValue($k)
  $dir= if($fl -band 2){'^'}else{'v'}
  if($fl -band 4){ "U+{0:X4}{1}" -f $sc,$dir } else { "{0:X2}{1}{2}" -f $vk,$dir,$(if($fl -band 1){'e'}else{''}) } }) -join ' ' }
$kp=[MouseRemote].GetMethod('KeyPressInputs',$bf)
function KP($vk,$c,$s,$a,$w,$sc=$false,$ss=$false,$sa=$false,$sw=$false){ Decode ($kp.Invoke($null,@([byte]$vk,$c,$s,$a,$w,$sc,$ss,$sa,$sw))) }
Ok ((KP 0x1B $false $false $false $false) -eq '1Bv 1B^') "plain Esc = Esc down, Esc up (no modifiers)"
Ok ((KP 0x1B $false $false $false $false $false $false $true) -eq '12^ A4^ A5^ 1Bv 1B^') "Esc while Alt is stuck on the PC: Alt released FIRST, then plain Esc"
Ok ((KP 0x43 $true $false $false $false) -eq '11v 43v 43^ 11^') "Ctrl+C order"
Ok ((KP 0x1B $true $true $false $false) -eq '11v 10v 1Bv 1B^ 10^ 11^') "Ctrl+Shift+Esc order (modifiers released in reverse)"
Ok ((KP 0x24 $false $false $false $false) -eq '24ve 24^e') "Home carries the extended-key flag"
Ok ((KP 0x41 $false $true $false $false) -eq '10v 41v 41^ 10^') "Shift+A"
$ti=[MouseRemote].GetMethod('TextInputs',$bf)
Ok ((Decode ($ti.Invoke($null,@('Hi')))) -eq 'U+0048v U+0048^ U+0069v U+0069^') "typeText 'Hi' sent as Unicode key events"
Ok ((Decode ($ti.Invoke($null,@("a`nb")))) -eq 'U+0061v U+0061^ 0Dv 0D^ U+0062v U+0062^') "newline becomes Enter key"
$bn=[string]::new([char[]]@(0x09AC,0x09BE,0x0982,0x09B2,0x09BE))   # Bengali
Ok ((Decode ($ti.Invoke($null,@($bn)))).Split(' ').Count -eq 10) "Bengali text -> 5 chars x down/up"
$emoji=[char]::ConvertFromUtf32(0x1F600)
Ok ((Decode ($ti.Invoke($null,@($emoji)))) -eq 'U+D83Dv U+D83D^ U+DE00v U+DE00^') "emoji sent as surrogate pair (down,up per half)"

# ---------- Resolve-Vk, extracted from the worker ----------
$tokens=$null;$errs=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile("$root/windows/input-worker.ps1",[ref]$tokens,[ref]$errs)
$fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Resolve-Vk'},$true)
. ([scriptblock]::Create($fn.Extent.Text))
Ok ((Resolve-Vk 'A') -eq 65 -and (Resolve-Vk '7') -eq 55) "letters/digits map to their virtual keys"
Ok ((Resolve-Vk 'ESCAPE') -eq 0x1B -and (Resolve-Vk 'F12') -eq 0x7B -and (Resolve-Vk 'NUM5') -eq 0x65) "Esc, F12, Numpad5"
Ok ((Resolve-Vk 'BACKSPACE') -eq 8 -and (Resolve-Vk 'LEFT') -eq 0x25 -and (Resolve-Vk 'ALTGR') -eq 0xA5) "Backspace, Left, AltGr"
try { Resolve-Vk 'EVIL'; Ok $false 'unknown key rejected' } catch { Ok ($_.Exception.Message -match 'Unsupported') 'unknown key rejected' }

# ---------- browser helpers, extracted from windows.ps1 ----------
$ast=[System.Management.Automation.Language.Parser]::ParseFile("$root/windows/common.ps1",[ref]$tokens,[ref]$errs)
foreach($name in 'Get-DefaultBrowserKey','Find-BrowserWindow'){ $f=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true); . ([scriptblock]::Create($f.Extent.Text)) }
$script:BrowserProcessNames=@{brave=@('brave');chrome=@('chrome');edge=@('msedge');firefox=@('firefox')}
$script:AllBrowserProcessNames=@('brave','chrome','msedge','firefox','opera','vivaldi')
foreach($case in @(@('BraveHTML','brave'),@('ChromeHTML','chrome'),@('MSEdgeHTM','edge'),@('FirefoxURL-308046B0AF4A39CB','firefox'),@('SomethingElse',''))){
  $script:prog=$case[0]; function Get-ItemProperty { [pscustomobject]@{ProgId=$script:prog} }
  Ok ((Get-DefaultBrowserKey) -eq $case[1]) ("default browser ProgId {0} -> '{1}'" -f $case[0],$case[1])
}
function Get-ItemProperty { throw 'no key' }
Ok ((Get-DefaultBrowserKey) -eq '') "missing registry key -> '' (no crash)"
# process lookup: Brave has a window, Chrome processes exist but have no window
function Get-Process { param($Name,$ErrorAction)
  switch($Name){
    'brave'  { [pscustomobject]@{MainWindowHandle=[IntPtr]4242;MainWindowTitle='YouTube - Brave'} }
    'chrome' { [pscustomobject]@{MainWindowHandle=[IntPtr]::Zero;MainWindowTitle=''} }
    default  { } } }
function Get-ItemProperty { [pscustomobject]@{ProgId='BraveHTML'} }
Ok ((Find-BrowserWindow 'brave') -eq 4242) "explicit Brave -> finds its window by process (the case that used to be 'not detected')"
Ok ((Find-BrowserWindow 'default') -eq 4242) "default browser (Brave) -> finds Brave's window"
Ok ((Find-BrowserWindow 'chrome') -eq 0) "Chrome with no window -> 0, not a wrong window"
function Get-ItemProperty { [pscustomobject]@{ProgId='ChromeHTML'} }
Ok ((Find-BrowserWindow 'default') -eq 4242) "default is Chrome (no window) -> falls through to the browser that has one"
"`n$pass passed, $fail failed"; if($fail){exit 1}
