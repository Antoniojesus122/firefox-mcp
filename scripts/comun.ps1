# Rutas y utilidades compartidas por los scripts.

$raiz   = Split-Path -Parent $PSScriptRoot
$bin    = Join-Path $raiz 'bin'
$pyDir  = Join-Path $raiz 'py'
$local  = Join-Path $raiz '.local'
$perfil = Join-Path $local 'perfil'
$hostId = 'firefox_mcp'
$extId  = 'agente@firefox-mcp'
$claveHost = "HKCU\Software\Mozilla\NativeMessagingHosts\$hostId"
$firefoxDev = 'C:\Program Files\Firefox Developer Edition\firefox.exe'
$utf8 = New-Object Text.UTF8Encoding $false

# python.exe de python.org, no el alias de la Microsoft Store (que no ejecuta
# nada, solo abre la ficha de la tienda).
function Find-Python {
  $c = Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python*\python.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if ($c) { return $c.FullName }
  $g = Get-Command python.exe -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike '*WindowsApps*' } | Select-Object -First 1
  if ($g) { return $g.Source }
  throw 'no se encontró un python.exe de python.org'
}
