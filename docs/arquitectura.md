# Arquitectura

```
cliente MCP  ->  servidor MCP (stdio)  ->  tubería con nombre  ->  host nativo  ->  extensión de Firefox
```

## Las piezas

- **Servidor MCP** (`py/mcp_server.py` o `cmd/mcp`): habla JSON-RPC 2.0 por stdin/stdout con el cliente.
  Cada herramienta se traduce a una orden JSON que se manda al host por la tubería. Abre y cierra la
  conexión en cada llamada, así que varios clientes pueden turnarse el agente.
- **Tubería con nombre** (`py/winpipe.py`, `internal/pipe`): el canal entre el servidor MCP y el host. No
  se abre ningún puerto de red. La protege una DACL que solo admite al usuario actual, rechaza conexiones
  por red y crea una única instancia.
- **Host de native messaging** (`py/host.py`, `cmd/host`): lo arranca Firefox cuando carga la extensión.
  Lee la política de `policy.json`, crea la tubería y reparte: cada orden del cliente va a la extensión
  (por stdin/stdout de native messaging) y la respuesta vuelve.
- **Extensión** (`extension/`): ejecuta las órdenes. `background.js` orquesta; `page.js` reúne el código
  que se inyecta en la página (texto, árbol, buscar, entrada sintética, ocultado de secretos);
  `security.js` lleva la política interactiva; `net.js` captura la red y la consola.

## Clic y teclado reales

La entrada real (eventos con `isTrusted=true`) necesita código privilegiado. Se hace con un *WebExtension
Experiment* (`extension/experiments/input/`), que llama a la API interna de síntesis de eventos de Firefox
(la misma ruta que usa WebDriver BiDi). Solo carga en Developer Edition o Nightly, y addons.mozilla.org no
firma experimentos.

Sin el experimento, la extensión cae a **entrada sintética** desde la página (eventos con
`isTrusted=false`): clic, teclado, arrastrar, etc. Funciona en la mayoría de webs. Es la versión firmable
por AMO.

Un mismo código sirve para los dos modos: `background.js` detecta si el experimento está disponible
(`hasExperiment()`) y, si no, usa las funciones sintéticas.

## Referencias de elementos

`read_page` y `find` marcan cada elemento con el que se puede interactuar con una referencia `ref_N`,
guardada en un atributo del DOM. El contador no se reutiliza dentro de una misma página: una referencia de
una lectura anterior ya no coincide con otro elemento, así que un clic con una referencia caducada da error
en vez de pulsar lo que no es.

## Consola y red

- **Red**: la extensión observa `webRequest` y guarda por pestaña los últimos registros (método, estado,
  tipo, url). Solo metadatos, nunca el cuerpo.
- **Consola**: un script de contenido (`console-hook.js`) inyecta en la página un envoltorio de `console.*`
  y de los errores, y reenvía cada mensaje a la extensión. Se hace así porque, con el aislamiento de
  procesos de Firefox, la consola del contenido vive en su propio proceso.

## Por qué dos implementaciones

El servidor y el host están en Python y en Go. La vía Python no necesita compilar y la ejecuta un
intérprete firmado, lo que evita que Windows Smart App Control bloquee binarios propios sin firmar. La vía
Go da binarios compilados. La extensión es la misma para las dos.
