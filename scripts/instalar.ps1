# Registra el host de native messaging (Python) en el HKCU real y prepara un
# perfil de Firefox Developer Edition que carga la extensión desde el código
# fuente.
#
# Se usa Python, no los binarios de Go, porque Smart App Control bloquea
# ejecutables propios sin firmar pero no los scripts que ejecuta un python.exe
# de confianza. Los binarios de Go siguen en el repo como alternativa
# (scripts/instalar-go.ps1).
param(
  # Idioma del perfil del agente. Por defecto, el del sistema. La extensión se
  # traduce con el idioma de Firefox; con un idioma sin traducción cae a inglés.
  [string]$Idioma = (Get-UICulture).Name
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comun.ps1')

$python = Find-Python
Write-Output "python: $python"

# Lanzador que arranca Firefox: ejecuta host.py con el python de confianza y le
# pasa los argumentos de native messaging. Es el patrón .bat que recomienda la
# propia documentación de Firefox para hosts en Python.
$hostBat = Join-Path $pyDir 'host.bat'
$bat = "@echo off`r`n`"$python`" -u `"%~dp0host.py`" %*`r`n"
[IO.File]::WriteAllText($hostBat, $bat, (New-Object Text.ASCIIEncoding))

# Política por defecto para las pruebas: interactiva y con auto-aprobación de
# consentimientos, para no depender del diálogo humano. Para uso real, copiar
# policy.ejemplo.json a py\policy.json (testAutoApprove a false). No se pisa si
# ya existe.
$policy = Join-Path $pyDir 'policy.json'
if (-not (Test-Path $policy)) {
  $pol = [ordered]@{
    mode               = 'interactive'
    allowedDomains     = @()
    confirmNewDomain   = $true
    confirmDownloads   = $true
    sessionIdleMinutes = 15
    startDisarmed      = $false
    testAutoApprove    = $true
  } | ConvertTo-Json
  [IO.File]::WriteAllText($policy, $pol, $utf8)
}

$manifiesto = Join-Path $pyDir "$hostId.json"
$json = [ordered]@{
  name               = $hostId
  description        = 'Puente local entre Firefox y el servidor MCP'
  path               = $hostBat
  type               = 'stdio'
  allowed_extensions = @($extId)
} | ConvertTo-Json
[IO.File]::WriteAllText($manifiesto, $json, $utf8)

New-Item -Path ('Registry::' + $claveHost) -Force | Out-Null
Set-ItemProperty -Path ('Registry::' + $claveHost) -Name '(default)' -Value $manifiesto
$registrado = (Get-ItemProperty -Path ('Registry::' + $claveHost) -ErrorAction SilentlyContinue).'(default)'
if ($registrado -ne $manifiesto) { throw "el host no quedó registrado en $claveHost" }

New-Item -ItemType Directory -Force (Join-Path $perfil 'extensions') | Out-Null

# Paquete de idioma. La extensión se traduce con el idioma de Firefox, pero la
# build viene en inglés; para otro idioma se instala el paquete de Mozilla que
# corresponde a la versión. El rango del paquete abarca toda la rama (p. ej.
# "159.*"), así que vale para cualquier build de esa versión; tras un salto de
# versión mayor, este bloque descarga el nuevo. Se prueba el código completo
# (es-ES) y luego el corto (fr, de...), que es como Mozilla nombra algunos. Sin
# red, se avisa y la instalación sigue; el inglés no necesita paquete.
function Obtener-VersionLangpack($xpi) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($xpi)
  try {
    $e = $zip.Entries | Where-Object { $_.FullName -eq 'manifest.json' }
    $sr = New-Object IO.StreamReader($e.Open())
    try { ($sr.ReadToEnd() | ConvertFrom-Json).version } finally { $sr.Close() }
  } finally { $zip.Dispose() }
}

if ($Idioma -and -not $Idioma.StartsWith('en')) {
  $ffMajor = ([version](Get-Item $firefoxDev).VersionInfo.ProductVersion).Major
  $extDir  = Join-Path $perfil 'extensions'
  $viejo   = Get-ChildItem $extDir -Filter 'langpack-*.xpi' -ErrorAction SilentlyContinue | Select-Object -First 1
  $lpMajor = if ($viejo) { try { ([version](Obtener-VersionLangpack $viejo.FullName)).Major } catch { 0 } } else { 0 }
  if ($lpMajor -ne $ffMajor) {
    try {
      $relBase = 'https://ftp.mozilla.org/pub/devedition/releases'
      $codigos = @($Idioma); if ($Idioma.Contains('-')) { $codigos += $Idioma.Split('-')[0] }
      $url = $null; $codigo = $null
      foreach ($c in $codigos) {
        foreach ($n in 1..20) {
          $cand = "$relBase/$ffMajor.0b$n/win64/xpi/$c.xpi"
          try { Invoke-WebRequest $cand -Method Head -TimeoutSec 15 -UseBasicParsing | Out-Null; $url = $cand; $codigo = $c } catch {}
        }
        if ($url) { break }
      }
      if (-not $url) { throw "sin paquete de idioma '$Idioma' para Firefox $ffMajor" }
      if ($viejo) { Remove-Item $viejo.FullName -Force }
      $lpXpi = Join-Path $extDir "langpack-$codigo@devedition.mozilla.org.xpi"
      Invoke-WebRequest $url -OutFile $lpXpi -TimeoutSec 60 -UseBasicParsing
      Write-Output "paquete de idioma: $url"
    } catch {
      Write-Warning "no se instaló el paquete de idioma '$Idioma': $($_.Exception.Message)"
    }
  }
}

$prefs = @(
  'user_pref("xpinstall.signatures.required", false);'
  'user_pref("extensions.experiments.enabled", true);'
  'user_pref("extensions.autoDisableScopes", 0);'
  'user_pref("extensions.enabledScopes", 15);'
  'user_pref("extensions.startupScanScopes", 1);'
  'user_pref("browser.shell.checkDefaultBrowser", false);'
  'user_pref("browser.aboutwelcome.enabled", false);'
  'user_pref("browser.startup.homepage_override.mstone", "ignore");'
  'user_pref("startup.homepage_welcome_url", "");'
  'user_pref("datareporting.policy.dataSubmissionEnabled", false);'
  'user_pref("datareporting.healthreport.uploadEnabled", false);'
  'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);'
  'user_pref("browser.tabs.warnOnClose", false);'
  'user_pref("browser.preonboarding.enabled", false);'
  'user_pref("browser.startup.upgradeDialog.enabled", false);'
  'user_pref("trailhead.firstrun.didSeeAboutWelcome", true);'
  'user_pref("browser.shell.skipDefaultBrowserCheckOnFirstRun", true);'
  'user_pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons", false);'
  'user_pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features", false);'
  'user_pref("messaging-system.rsexperimentloader.enabled", false);'
  'user_pref("app.normandy.enabled", false);'
  'user_pref("app.shield.optoutstudies.enabled", false);'
  'user_pref("browser.uitour.enabled", false);'
  # Barra lateral (el panel del agente) a la derecha.
  'user_pref("sidebar.position_start", false);'
  'user_pref("sidebar.revamp", false);'
  # Con la ventana tapada Firefox deja de componerla y APZ no sabe dónde cae
  # un clic. Cuesta algo de GPU con la ventana oculta.
  'user_pref("widget.windows.window_occlusion_tracking.enabled", false);'
  # La extensión muestra sus textos en el idioma de Firefox; el perfil se fija
  # al idioma elegido (su paquete se instala más arriba; el inglés no lo pide).
  "user_pref(`"intl.locale.requested`", `"$Idioma`");"
)
[IO.File]::WriteAllLines((Join-Path $perfil 'user.js'), $prefs, $utf8)

# Fichero proxy: Firefox carga la extensión desde esta carpeta sin empaquetar.
[IO.File]::WriteAllText((Join-Path $perfil "extensions\$extId"), (Join-Path $raiz 'extension') + '\', $utf8)

Write-Output "host (python) registrado: $claveHost -> $manifiesto"
Write-Output "lanzador: $hostBat"
Write-Output "perfil listo: $perfil"
