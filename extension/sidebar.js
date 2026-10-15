"use strict";

const port = browser.runtime.connect({ name: "panel" });

const el = id => document.getElementById(id);

function hora(t) {
  const d = new Date(t);
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function render(s) {
  const punto = el("punto");
  const readonly = s.mode === "readonly";
  punto.className = "punto " + (!s.active ? "" : readonly ? "ro" : "on");
  el("estado").textContent = !s.active
    ? "Detenido"
    : "Activo" + (readonly ? " (solo lectura)" : "");
  const t = el("toggle");
  t.textContent = s.active ? "Detener" : "Activar";
  t.className = s.active ? "stop" : "";
  el("cont").textContent = s.container ? "Contenedor propio del agente" : "";

  const dom = el("dominios");
  dom.textContent = "";
  if (!s.approved || !s.approved.length) {
    const d = document.createElement("span");
    d.className = "chip vacio";
    d.textContent = "ninguno todavía";
    dom.appendChild(d);
  } else {
    for (const d of s.approved) {
      const c = document.createElement("span");
      c.className = "chip";
      c.textContent = d;
      dom.appendChild(c);
    }
  }

  const log = el("log");
  log.textContent = "";
  const entries = (s.log || []).slice().reverse();
  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "vacio";
    li.textContent = "sin acciones todavía";
    log.appendChild(li);
  }
  for (const e of entries) {
    const li = document.createElement("li");
    const h = document.createElement("span");
    h.className = "hora";
    h.textContent = hora(e.t);
    const txt = document.createElement("span");
    txt.textContent = e.text;
    li.appendChild(h);
    li.appendChild(txt);
    log.appendChild(li);
  }
}

port.onMessage.addListener(render);
el("toggle").addEventListener("click", () => port.postMessage({ cmd: "toggle" }));
el("limpiar").addEventListener("click", () => port.postMessage({ cmd: "clearlog" }));
