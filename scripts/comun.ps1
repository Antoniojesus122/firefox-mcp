# Rutas y utilidades compartidas por los scripts.

$raiz   = Split-Path -Parent $PSScriptRoot
$bin    = Join-Path $raiz 'bin'
$pyDir  = Join-Path $raiz 'py'
$local  = Join-Path $raiz '.local'
$perfil = Join-Path $local 'perfil'
$hostId = 'firefox_mcp'
$extId  = 'agente@firefox-mcp'
$claveHost = "HKCU\Software\Mozilla\NativeMessagingHosts\$hostId"
# Firefox con extensiones sin firmar y experimentos: Developer Edition o
# Nightly. La variable FIREFOX_DEV fuerza la ruta si está instalado en otro
# sitio. Si no se encuentra, se deja la ruta por defecto para que el error al
# abrir sea claro.
$firefoxDev = if ($env:FIREFOX_DEV) { $env:FIREFOX_DEV } else {
  @(
    'C:\Program Files\Firefox Developer Edition\firefox.exe'
    'C:\Program Files\Firefox Nightly\firefox.exe'
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $firefoxDev) { $firefoxDev = 'C:\Program Files\Firefox Developer Edition\firefox.exe' }
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
