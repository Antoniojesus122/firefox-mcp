# firefox-mcp

<p align="center">
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/-English-555?style=flat-square"></a>
  <img alt="Español" src="https://img.shields.io/badge/-Espa%C3%B1ol-1f6feb?style=flat-square">
  <a href="README.fr.md"><img alt="Français" src="https://img.shields.io/badge/-Fran%C3%A7ais-555?style=flat-square"></a>
  <a href="README.de.md"><img alt="Deutsch" src="https://img.shields.io/badge/-Deutsch-555?style=flat-square"></a>
  <a href="README.it.md"><img alt="Italiano" src="https://img.shields.io/badge/-Italiano-555?style=flat-square"></a>
  <a href="README.pt-BR.md"><img alt="Português (BR)" src="https://img.shields.io/badge/-Portugu%C3%AAs%20%28BR%29-555?style=flat-square"></a>
</p>

Un servidor [MCP](https://modelcontextprotocol.io) y una extensión de Firefox que permiten a un cliente
MCP manejar el navegador: leer páginas, navegar, hacer clic, rellenar formularios, tomar capturas y leer la
consola y la red de una pestaña. Lleva encima una capa de seguridad: permiso por dominio, interruptor,
ocultado de secretos y un contenedor aislado para la sesión del agente.

La idea es parecida a las extensiones que dejan a un asistente controlar Chrome, pero para Firefox y con el
"cerebro" fuera del navegador: el cliente MCP (por ejemplo una herramienta de agente por línea de comandos)
vive en tu equipo y la extensión solo son las manos.

## Inicio rápido

De momento, solo Windows. Hace falta **Firefox Developer Edition** o **Nightly** (para el clic real; el
Firefox normal cae a eventos sintéticos) y **Python 3** de [python.org](https://www.python.org/).

Desde la raíz del repositorio, en PowerShell:

```powershell
scripts\instalar.ps1     # registra el host nativo y prepara un perfil de Firefox
scripts\abrir.ps1        # abre Firefox con ese perfil y la extensión
```

Después, registra el servidor MCP en tu cliente apuntando a `py/mcp_server.py`. Si PowerShell no deja
ejecutar los scripts, habilítalos para tu usuario una vez con `Set-ExecutionPolicy -Scope CurrentUser
RemoteSigned`. Los pasos completos están en [docs/instalacion.md](docs/instalacion.md).

## Cómo funciona

```
cliente MCP  ->  servidor MCP (stdio)  ->  tubería con nombre  ->  host nativo  ->  extensión de Firefox
```

- El **servidor MCP** traduce las llamadas del cliente a órdenes y las manda por una **tubería con nombre**
  de Windows, sin abrir ningún puerto de red.
- El **host de native messaging** lo arranca Firefox cuando carga la extensión, y hace de puente entre la
  tubería y la extensión.
- La **extensión** ejecuta las órdenes en la pestaña.

Hay dos implementaciones equivalentes del servidor y el host, se elige una:

- **Python** (`py/`): no hay que compilar nada; lo ejecuta el intérprete de python.org. Es la vía por
  defecto y evita que Windows Smart App Control bloquee binarios sin firmar.
- **Go** (`cmd/`, `internal/`): binarios compilados, sin dependencias de terceros más allá de
  `golang.org/x/sys`.

El clic y el teclado "de verdad" (eventos con `isTrusted=true`) se consiguen con un *WebExtension
Experiment*, que solo carga en Firefox Developer Edition o Nightly. Sin él, la extensión cae a eventos
sintéticos, suficientes para la mayoría de webs; esa es la versión firmable por AMO (ver
[docs/publicar-amo.md](docs/publicar-amo.md)).

De momento es **solo Windows** (la tubería con nombre usa la API de Windows).

## Idioma

La extensión muestra sus textos en el idioma de Firefox (inglés, español, francés, alemán, italiano y
portugués de Brasil; con cualquier otro cae a inglés). `scripts/instalar.ps1` deja el perfil en el idioma
del sistema y, si hace falta, descarga el paquete de idioma de Mozilla que corresponde.

## Herramientas

El servidor expone estas herramientas MCP:

| Herramienta | Qué hace |
| --- | --- |
| `firefox_tabs` / `firefox_status` | Lista las pestañas / estado de seguridad del agente. |
| `firefox_open_tab` / `firefox_navigate` / `firefox_close_tab` | Abrir, navegar, cerrar pestañas. |
| `firefox_page_text` / `firefox_read_page` | Texto visible / árbol de accesibilidad con referencias. |
| `firefox_find` | Buscar elementos por texto, rol o nombre. |
| `firefox_snapshot` | Captura PNG (con los secretos tapados). |
| `firefox_click_ref` / `firefox_click_at` | Clic en una referencia o en coordenadas. |
| `firefox_double_click` / `firefox_right_click` | Doble clic / clic derecho. |
| `firefox_type` | Escribir con el teclado (también campos de hora, fecha, etc.). |
| `firefox_drag` / `firefox_dnd` / `firefox_scroll` | Arrastrar, drag-and-drop HTML5, desplazar. |
| `firefox_download` | Descargar una URL con confirmación. |
| `firefox_network` / `firefox_console` | Red y consola de la pestaña. |

## Seguridad

Dos capas, cada una en un proceso que el contenido de las webs no puede tocar:

- El **host** aplica la política dura de `policy.json`: modo solo lectura y lista blanca de dominios.
- La **extensión** lleva el interruptor con indicador en la barra, el consentimiento humano por dominio, la
  caducidad de la sesión, el contenedor aislado y el ocultado de secretos (contraseñas, tarjetas y claves)
  antes de que el texto o las capturas salgan del navegador.

Detalle en [docs/seguridad.md](docs/seguridad.md).

## Interfaz

- Un **puntero** del agente (una flecha que se desliza al punto de la acción, con una onda en cada clic)
  para ver qué hace.
- Un **panel lateral** con el estado, el interruptor, los dominios con permiso y un registro de la
  actividad.

## Estructura

- `extension/` - la extensión. `experiments/input/` es el código privilegiado del clic y el teclado reales.
- `py/` - servidor MCP y host en Python.
- `cmd/`, `internal/` - la misma funcionalidad en Go.
- `scripts/` - instalación y utilidades (PowerShell).
- `ejemplos/` - páginas HTML para probar.
- `docs/` - arquitectura, seguridad, instalación y publicación.

## Licencia

MIT. Ver [LICENSE](LICENSE).
