# Instalación alternativa con los binarios de Go (cmd/host, cmd/mcp, cmd/fxctl).
# Ojo: Smart App Control puede bloquear estos .exe sin firmar (sobre todo mcp.exe).
# La vía recomendada en este equipo es instalar.ps1 (Python).
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comun.ps1')

$go = 'C:\Program Files\Go\bin\go.exe'
Push-Location $raiz
try {
  & $go build -o (Join-Path $bin 'host.exe') ./cmd/host
  if ($LASTEXITCODE) { throw 'falló la compilación del host' }
  & $go build -o (Join-Path $bin 'fxctl.exe') ./cmd/fxctl
  if ($LASTEXITCODE) { throw 'falló la compilación de fxctl' }
  & $go build -o (Join-Path $bin 'mcp.exe') ./cmd/mcp
  if ($LASTEXITCODE) { throw 'falló la compilación del servidor MCP' }
} finally {
  Pop-Location
}

$policy = Join-Path $bin 'policy.json'
if (-not (Test-Path $policy)) {
  Copy-Item (Join-Path $raiz 'policy.ejemplo.json') $policy
}

$manifiesto = Join-Path $bin "$hostId.json"
$json = [ordered]@{
  name               = $hostId
  description        = 'Puente local entre Firefox y el servidor MCP'
  path               = (Join-Path $bin 'host.exe')
  type               = 'stdio'
  allowed_extensions = @($extId)
} | ConvertTo-Json
[IO.File]::WriteAllText($manifiesto, $json, $utf8)

New-Item -Path ('Registry::' + $claveHost) -Force | Out-Null
Set-ItemProperty -Path ('Registry::' + $claveHost) -Name '(default)' -Value $manifiesto
Write-Output "host (go) registrado: $claveHost -> $manifiesto"
