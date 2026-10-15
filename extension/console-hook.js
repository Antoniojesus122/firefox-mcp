"use strict";

// Captura de consola desde el proceso de contenido (donde de verdad ocurre la
// consola de la página, por Fission). Inyecta en el mundo de la página un
// envoltorio de console.* y los errores, que reenvía cada mensaje a la
// extensión. Limitación: en páginas con CSP estricto la inyección del <script>
// puede bloquearse.

(function () {
  function pageHook() {
    const emit = detail => {
      try {
        window.dispatchEvent(new CustomEvent("__fxconsole", { detail }));
      } catch (e) {
        // nada
      }
    };
    const fmt = args =>
      Array.prototype.map
        .call(args, a => {
          if (typeof a === "string") {
            return a;
          }
          try {
            return JSON.stringify(a);
          } catch (e) {
            return String(a);
          }
        })
        .join(" ");
    for (const level of ["log", "info", "warn", "error", "debug"]) {
      const orig = console[level];
      console[level] = function () {
        emit({ level, text: fmt(arguments), ts: Date.now() });
        return orig.apply(console, arguments);
      };
    }
    window.addEventListener("error", e => {
      emit({ level: "error", text: String(e.message || "error"), source: e.filename, line: e.lineno, ts: Date.now() });
    });
    window.addEventListener("unhandledrejection", e => {
      emit({ level: "error", text: "promesa no gestionada: " + String(e.reason), ts: Date.now() });
    });
  }

  try {
    const s = document.createElement("script");
    s.textContent = "(" + pageHook.toString() + ")();";
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  } catch (e) {
    // CSP u otro: la consola de esta página no se capturará
  }

  window.addEventListener(
    "__fxconsole",
    e => {
      const d = e.detail || {};
      try {
        browser.runtime.sendMessage({
          __console: { level: d.level, text: d.text, source: d.source, line: d.line, ts: d.ts },
        });
      } catch (x) {
        // la extensión puede no estar lista
      }
    },
    true
  );
})();
