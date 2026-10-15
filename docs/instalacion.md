# Instalación

Solo Windows por ahora.

## Requisitos

- **Firefox Developer Edition** o **Nightly** (para el clic y el teclado reales; en Firefox normal la
  extensión funciona con eventos sintéticos). Los scripts los buscan en su ruta habitual; si está en
  otro sitio, apúntalo con la variable `FIREFOX_DEV`.
- Para la vía Python: **Python 3** de [python.org](https://www.python.org/) (no el alias de la Microsoft
  Store).
- Para la vía Go: **Go 1.21+**.

## Pasos (vía Python, recomendada)

Desde la raíz del repositorio, en PowerShell:

```powershell
scripts\instalar.ps1     # compila nada; registra el host y prepara el perfil
scripts\abrir.ps1        # abre Firefox con el perfil y la extensión
```

`instalar.ps1`:

- Genera `py\host.bat`, que arranca `host.py` con tu `python.exe`.
- Registra el host de native messaging en `HKCU\Software\Mozilla\NativeMessagingHosts\firefox_mcp`.
- Crea un perfil de Firefox en `.local\perfil` que carga la extensión desde `extension\` sin empaquetar.
- Crea `py\policy.json` a partir de la plantilla si no existe.

Mientras Firefox esté abierto así, el host está en marcha y el servidor MCP puede conectarse.

## Idioma

La extensión se traduce con el idioma de Firefox (inglés, español, francés, alemán, italiano y portugués
de Brasil; con cualquier otro cae a inglés). `instalar.ps1` deja el perfil en el idioma del sistema y, si
hace falta, descarga el paquete de idioma de Mozilla que corresponde a la versión. Para forzar otro:

```powershell
scripts\instalar.ps1 -Idioma es-ES
```

## Registrar el servidor en el cliente MCP

En la configuración de tu cliente MCP, añade un servidor por stdio que ejecute `py\mcp_server.py` con tu
`python.exe`. Por ejemplo:

```json
{
  "mcpServers": {
    "firefox": {
      "command": "C:\\ruta\\a\\python.exe",
      "args": ["C:\\ruta\\al\\repo\\py\\mcp_server.py"]
    }
  }
}
```

El servidor no necesita argumentos ni variables de entorno: encuentra el host por la tubería del usuario
actual.

## Política

El host lee `py\policy.json`. La plantilla está en `policy.ejemplo.json`:

```json
{
  "mode": "interactive",
  "allowedDomains": [],
  "confirmNewDomain": true,
  "confirmDownloads": true,
  "sessionIdleMinutes": 15,
  "startDisarmed": false,
  "testAutoApprove": false
}
```

- `mode`: `interactive` o `readonly` (solo lectura).
- `allowedDomains`: lista blanca de navegación (vacío = cualquiera, con consentimiento).
- `testAutoApprove`: **solo para pruebas**; aprueba los consentimientos sin diálogo. No usar en uso real.

## Probar sin cliente MCP

Con Firefox abierto:

```powershell
python py\pipe_cli.py '{"id":1,"cmd":"status"}'
```

Las páginas de `ejemplos\` sirven para probar clic, teclado, ocultado de secretos, consola, red y
drag-and-drop. Para usarlas, sírvelas en local, por ejemplo:

```powershell
python -m http.server 8150 --bind 127.0.0.1    # desde la carpeta ejemplos\
```

## Vía Go (alternativa)

```powershell
scripts\instalar-go.ps1
```

Compila `cmd/host`, `cmd/mcp` y `cmd/fxctl` a `bin\`, y registra el host. El servidor MCP es entonces
`bin\mcp.exe`. Nota: Windows Smart App Control puede bloquear binarios sin firmar; si pasa, usa la vía
Python.
