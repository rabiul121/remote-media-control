# One-shot fallback (a new PowerShell per action). Used only if the persistent host cannot start.
param([Parameter(Mandatory=$true)][string]$Action)
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'actions.ps1')
$payloadText = [Console]::In.ReadToEnd()
$payload = if ($payloadText) { $payloadText | ConvertFrom-Json } else { [pscustomobject]@{} }
$result = @(Invoke-Action $Action $payload) | Select-Object -Last 1
if ($null -ne $result) { [Console]::Out.Write([string]$result) }
