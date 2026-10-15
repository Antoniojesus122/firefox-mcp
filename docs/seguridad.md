# Seguridad

El principio: el agente no puede saltarse las reglas, ni por una instrucción escondida en una página ni por
su cuenta. La protección está en dos procesos que el contenido de las webs no toca.

## Capa dura: el host

El host lee `policy.json` y decide antes de reenviar nada. Se relee en cada conexión, así que cambiar la
política no exige reiniciar Firefox.

- `mode: "readonly"` cierra toda orden de escritura (clic, teclado, navegar, descargar...). Las lecturas
  siguen.
- `allowedDomains`: si no está vacío, `open` y `navigate` solo pueden ir a esos dominios o sus subdominios.

## Capa interactiva: la extensión

- **Interruptor e indicador.** Un botón en la barra con una insignia (activo / solo lectura / detenido).
  Pulsarlo detiene o reactiva el agente al instante. Con `startDisarmed` arranca detenido.
- **Consentimiento por dominio.** Antes de actuar en un dominio nuevo o de navegar a él, pide permiso. Con
  el experimento, con un diálogo del propio Firefox; sin él, con una ventana propia de la extensión. En los
  dos casos es algo que ni el contenido de la web ni el cliente MCP pueden pulsar: solo una persona.
  Aprobado, el dominio vale para el resto de la sesión. Es la defensa contra una página que intente
  exfiltrar datos llevando al agente a otro sitio.
- **Caducidad.** Tras `sessionIdleMinutes` sin actividad se olvidan los dominios aprobados.
- **Contenedor propio.** Las pestañas que abre el agente usan un contenedor con sus cookies, separado de
  las sesiones del usuario.

## Ocultado de secretos

Antes de que el texto o las capturas salgan del navegador hacia el modelo:

- **Contraseñas**: el valor de un `input[type=password]` nunca se envía.
- **Tarjetas**: números de 13-19 dígitos validados con Luhn (para no tapar teléfonos ni ids).
- **Claves de API**: prefijos conocidos (`sk-`, `AKIA...`, `ghp_...`, tokens de Slack, JWT).

Se aplica al texto (`page_text`, `read_page`, `find`) y a las capturas (se tapan con un rectángulo negro).
Es heurístico: cubre lo común, no lo garantiza todo.

## La tubería

- DACL que solo admite al usuario actual, deniega el acceso por red y no hereda permisos.
- Una sola instancia: un segundo host con el mismo nombre no arranca.
- El cliente abre la tubería sin permitir suplantación y comprueba qué proceso la sirve.

Esto no sustituye a la defensa contra malware que ya corre como tu usuario; reduce la superficie y evita
dejar una puerta abierta (ningún puerto de red).

## testAutoApprove

La política tiene una opción `testAutoApprove` que aprueba los consentimientos sin diálogo. Es **solo para
pruebas automáticas** y nunca debe estar activa en uso real. La plantilla la trae en `false`.
