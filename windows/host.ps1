# Persistent system host: compiles the native helpers once, then answers JSON-line requests
#   in : {"id":"1","action":"state","payload":{...}}
#   out: {"id":"1","ok":true,"result":"<text>"}  or  {"id":"1","ok":false,"error":"<message>"}
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'actions.ps1')
[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
    $id = $null
    try {
        $request = $line | ConvertFrom-Json
        $id = $request.id
        $payload = if ($null -ne $request.payload) { $request.payload } else { [pscustomobject]@{} }
        $result = @(Invoke-Action ([string]$request.action) $payload) | Select-Object -Last 1
        @{id=$id;ok=$true;result=$(if ($null -ne $result) { [string]$result } else { '' })} | ConvertTo-Json -Compress | ForEach-Object { [Console]::Out.WriteLine($_) }
    } catch {
        @{id=$id;ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress | ForEach-Object { [Console]::Out.WriteLine($_) }
    }
}
