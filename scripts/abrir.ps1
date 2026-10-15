# Abre Firefox Developer Edition con el perfil del agente.
#
# SIN -no-remote: con Firefox 159 y el navegador normal del usuario abierto,
# -no-remote hacía que la instancia del agente se cerrara nada más arrancar. El
# perfil propio ya aísla la instancia (Firefox 67+ corre una por perfil).
param([string]$Url = 'http://127.0.0.1:8150/prueba.html')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comun.ps1')

Remove-Item (Join-Path $perfil 'parent.lock') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $perfil '.parentlock') -Force -ErrorAction SilentlyContinue

Start-Process $firefoxDev -ArgumentList "-profile `"$perfil`" $Url" | Out-Null

# El host lo arranca Firefox cuando carga la extensión; esperar a su tubería.
$limite = (Get-Date).AddSeconds(45)
while (-not ([IO.Directory]::GetFiles('\\.\pipe\') -like '*\firefox-mcp-*') -and (Get-Date) -lt $limite) {
  Start-Sleep -Milliseconds 500
}
if (-not ([IO.Directory]::GetFiles('\\.\pipe\') -like '*\firefox-mcp-*')) {
  throw 'Firefox no arrancó el host en 45 s'
}
