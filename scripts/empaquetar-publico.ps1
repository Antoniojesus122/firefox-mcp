# Arma la versión PÚBLICA de la extensión (firmable por AMO): el mismo código
# sin el experimento (código privilegiado que AMO no firma). Produce un .xpi.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comun.ps1')

$ext  = Join-Path $raiz 'extension'
$dist = Join-Path $raiz 'dist-publico'
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force $dist | Out-Null

# Ficheros compartidos (todo menos la carpeta del experimento).
$files = 'background.js', 'security.js', 'net.js', 'page.js', 'console-hook.js',
         'consent.html', 'consent.js', 'sidebar.html', 'sidebar.js'
foreach ($f in $files) { Copy-Item (Join-Path $ext $f) (Join-Path $dist $f) }

# Manifiesto sin experiment_apis, con nombre y descripción de cara al público.
$m = Get-Content (Join-Path $ext 'manifest.json') -Raw | ConvertFrom-Json
if ($m.PSObject.Properties['experiment_apis']) { $m.PSObject.Properties.Remove('experiment_apis') }
$m.name = 'Agente para Firefox'
$m.description = 'Deja que un asistente maneje Firefox por MCP: leer páginas, navegar, rellenar y hacer clic, con permiso por dominio, interruptor y ocultado de secretos. Requiere el host local.'
$json = $m | ConvertTo-Json -Depth 30
# ConvertTo-Json escapa < > & como < etc.; se devuelven a su forma normal.
$json = $json.Replace('<', '<').Replace('>', '>').Replace('&', '&')
[IO.File]::WriteAllText((Join-Path $dist 'manifest.json'), $json, (New-Object Text.UTF8Encoding $false))

# Empaquetar como .xpi (zip con el manifiesto en la raíz). El fichero va FUERA
# de la carpeta que se comprime, para no incluirse a sí mismo.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$xpi = Join-Path $raiz 'agente-firefox.xpi'
if (Test-Path $xpi) { Remove-Item $xpi -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($dist, $xpi)

Write-Output "versión pública en: $dist"
Write-Output "paquete: $xpi"
Write-Output "ficheros:"
Get-ChildItem $dist -Name | ForEach-Object { "  $_" }
