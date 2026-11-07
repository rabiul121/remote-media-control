# Input self-test. Opens a small window with a text box, types into it using each delivery
# method, and prints JSON saying which ones worked on this PC. Run with: powershell -STA -File self-test.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'Native.cs')) -Language CSharp
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'Input.cs')) -Language CSharp

$form = New-Object Windows.Forms.Form
$form.Text = 'RemoteDeck keyboard test'; $form.Width = 380; $form.Height = 120; $form.TopMost = $true
$form.StartPosition = 'CenterScreen'
$box = New-Object Windows.Forms.TextBox; $box.Dock = 'Top'; $box.Font = New-Object Drawing.Font('Segoe UI', 14)
$form.Controls.Add($box)
$form.Show()
$handle = [long]$form.Handle

function Pump([int]$ms) { $end = [DateTime]::Now.AddMilliseconds($ms); while ([DateTime]::Now -lt $end) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 15 } }
function Focus-Box { [void][WinAudio]::ActivateWindow($handle); $box.Focus(); Pump 200 }
function Attempt([string]$expected, [scriptblock]$send) {
    $box.Clear(); Focus-Box
    try { & $send; Pump 450; return [ordered]@{ ok = ($box.Text -eq $expected); got = $box.Text; error = $null } }
    catch { return [ordered]@{ ok = $false; got = $box.Text; error = $_.Exception.Message } }
}

$result = [ordered]@{}
[MouseRemote]::Configure('sendinput', 'unicode', $false)
$result.keys    = Attempt 'hi' { [MouseRemote]::KeyPress(0x48,$false,$false,$false,$false); [MouseRemote]::KeyPress(0x49,$false,$false,$false,$false) }
$result.unicode = Attempt 'ok' { [MouseRemote]::TypeText('ok') }
[MouseRemote]::Configure('legacy', 'paste', $false)
$result.legacy  = Attempt 'hi' { [MouseRemote]::KeyPress(0x48,$false,$false,$false,$false); [MouseRemote]::KeyPress(0x49,$false,$false,$false,$false) }
$result.paste   = Attempt 'ok' { [MouseRemote]::TypeText('ok') }
$form.Close()

$result.elevated = [bool][WinAudio]::SelfElevated()
$result.recommend = [ordered]@{
    keyMethod  = $(if ($result.keys.ok) { 'sendinput' } elseif ($result.legacy.ok) { 'legacy' } else { 'sendinput' })
    textMethod = $(if ($result.unicode.ok) { 'unicode' } elseif ($result.paste.ok) { 'paste' } else { 'unicode' })
}
$result.anyWorks = [bool]($result.keys.ok -or $result.legacy.ok -or $result.unicode.ok -or $result.paste.ok)
[Console]::Out.Write(($result | ConvertTo-Json -Compress -Depth 5))
