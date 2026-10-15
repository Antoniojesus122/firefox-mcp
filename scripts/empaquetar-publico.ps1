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

# Traducciones (nombre, descripción y textos de la interfaz).
Copy-Item (Join-Path $ext '_locales') (Join-Path $dist '_locales') -Recurse

# Manifiesto sin experiment_apis. El nombre y la descripción salen de _locales.
$m = Get-Content (Join-Path $ext 'manifest.json') -Raw | ConvertFrom-Json
if ($m.PSObject.Properties['experiment_apis']) { $m.PSObject.Properties.Remove('experiment_apis') }
$json = $m | ConvertTo-Json -Depth 30
# ConvertTo-Json escapa < > & como < etc.; se devuelven a su forma normal.
$json = $json.Replace('<', '<').Replace('>', '>').Replace('&', '&')
[IO.File]::WriteAllText((Join-Path $dist 'manifest.json'), $json, (New-Object Text.UTF8Encoding $false))

# Empaquetar como .xpi (zip con el manifiesto en la raíz). Las rutas internas
# llevan barra normal: el formato zip no admite la barra invertida de Windows y
# Firefox no encontraría las traducciones de _locales si fuera de otro modo.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$xpi = Join-Path $raiz 'agente-firefox.xpi'
if (Test-Path $xpi) { Remove-Item $xpi -Force }
$zip = [IO.Compression.ZipFile]::Open($xpi, 'Create')
try {
  $base = (Resolve-Path $dist).Path.TrimEnd('\') + '\'
  foreach ($item in Get-ChildItem $dist -Recurse -File) {
    $rel = $item.FullName.Substring($base.Length).Replace('\', '/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $item.FullName, $rel) | Out-Null
  }
} finally {
  $zip.Dispose()
}

Write-Output "versión pública en: $dist"
Write-Output "paquete: $xpi"
Write-Output "ficheros:"
Get-ChildItem $dist -Name | ForEach-Object { "  $_" }
