# Cierra SOLO el Firefox Developer Edition del agente (el que usa el perfil de
# .local\perfil), nunca el Firefox del usuario. El host muere al cerrarse su
# entrada estándar.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comun.ps1')

# Procesos de Firefox Dev cuya línea de comandos usa el perfil del agente. Se
# incluyen los procesos de contenido: Firefox los lanza con el ejecutable pero
# sin la ruta del perfil en su línea, así que se toma todo el árbol a partir del
# proceso padre que sí la lleva.
function AgentProcs {
  $padres = Get-CimInstance Win32_Process -Filter "Name='firefox.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($perfil) -and $_.CommandLine -notlike '*-contentproc*' }
  $ids = @($padres.ProcessId)
  if ($ids.Count) {
    $hijos = Get-CimInstance Win32_Process -Filter "Name='firefox.exe'" | Where-Object { $ids -contains $_.ParentProcessId }
    $ids += @($hijos.ProcessId)
  }
  $ids | Sort-Object -Unique | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
}

foreach ($p in AgentProcs) { [void]$p.CloseMainWindow() }
$limite = (Get-Date).AddSeconds(10)
while ((AgentProcs) -and (Get-Date) -lt $limite) {
  Start-Sleep -Milliseconds 300
}
$restos = AgentProcs
if ($restos) {
  $restos | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
}
if (AgentProcs) {
  throw 'el Firefox del agente sigue abierto'
}
