# Versión pública para AMO

## Qué es

El mismo código de la extensión, pero **sin el experimento** (el código privilegiado que da el clic y el
teclado reales). addons.mozilla.org no firma extensiones con `experiment_apis`, así que la versión pública
usa **entrada sintética**: eventos con `isTrusted=false`. Es la misma extensión, firmable por Mozilla.

Un solo código, dos modos: `background.js` detecta si el experimento está disponible (`hasExperiment()`).
Con él, entrada real. Sin él, cae a las funciones sintéticas de `page.js`. La versión pública es el
empaquetado sin la carpeta `experiments/` y sin `experiment_apis` en el manifiesto.

## Qué cambia

- **Clic, doble clic, botón derecho, arrastrar, teclado**: sintéticos (`isTrusted=false`). Funcionan en la
  mayoría de webs; fallan donde hace falta activación de usuario (abrir ventanas, subir ficheros) o hay
  antibots.
- **Captura**: `captureVisibleTab`, solo la pestaña **activa** y visible (no pestañas en segundo plano). El
  tapado de secretos sigue.
- **Consentimiento por dominio y de descargas**: una **ventana emergente propia de la extensión**
  (`consent.html`), en vez del diálogo del sistema. Sigue sin poder pulsarla la web ni el cliente.
- Red, consola, política dura, interruptor, contenedor y ocultado de secretos: **iguales**.

## El host local no va en el .xpi

La extensión necesita el host de native messaging para hablar con el servidor MCP. Eso no va dentro del
`.xpi` (AMO solo firma la extensión). Quien la instale tiene que montar el host aparte (ver
[instalacion.md](instalacion.md)); la extensión se instala desde el `.xpi` firmado.

## Construir el paquete

```powershell
scripts\empaquetar-publico.ps1
```

Deja `dist-publico\` con los ficheros y `agente-firefox.xpi` en la raíz. El manifiesto sale sin
`experiment_apis`, con nombre y descripción de cara al público.

## Firmar: dos caminos

### 1. Autodistribución / «unlisted» (lo práctico para uso propio)

Para instalarla en el Firefox normal sin publicarla en el catálogo. Mozilla la firma sin revisión humana
(solo pasa el linter automático).

- En AMO Developer Hub (`addons.mozilla.org/developers/`): «Submit a New Add-on» -> «On your own» -> subir
  `agente-firefox.xpi` -> descargar el `.xpi` firmado.
- O por línea de comandos con `web-ext sign --channel=unlisted` y una clave de API de AMO (necesita
  Node.js).

El `.xpi` firmado se instala en el Firefox normal (desde `about:addons` o abriendo el fichero).

### 2. Listado público (catálogo de AMO)

Revisión humana completa. Antes de intentarlo conviene resolver:

- **Permisos amplios**: `nativeMessaging`, `webRequest`, `cookies`, `contextualIdentities`, `downloads` y
  `<all_urls>` juntos reciben mucho escrutinio. Hay que justificar cada uno en las notas para el revisor.
- **Código dinámico**: la extensión inyecta funciones con `tabs.executeScript({code})`. El linter de AMO lo
  marca. Para un listado limpio conviene pasar a inyección por `func`/ficheros (o `scripting` de MV3).
- **Marca**: no uses marcas registradas ajenas en el nombre ni el icono.
- **Declaración de datos**: hay que declarar en el listado que se envían capturas y texto de la página al
  host.

## Pendiente para un listado limpio

- Sustituir `executeScript({code})` por inyección por `func`/ficheros registrados.
- Valorar Manifest V3 (event page) en vez de MV2 persistente, cuidando que la conexión nativa sobreviva.
- Pedir `<all_urls>`/`cookies`/`webRequest` como opcionales donde se pueda.
