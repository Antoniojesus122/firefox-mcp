"use strict";

// Funciones que se inyectan en la página con tabs.executeScript. Cada una se
// serializa y se ejecuta en el sandbox de contenido, así que tienen que ser
// autónomas: nada de variables externas. El registro de referencias vive en un
// atributo del DOM (data-fxref) porque cada inyección es un sandbox nuevo y un
// WeakMap no sobreviviría entre llamadas.

const REF_ATTR = "data-fxref";

// Oculta secretos antes de que el texto salga del navegador hacia el modelo:
// números de tarjeta (validados con Luhn, para no tapar teléfonos ni ids) y
// claves de API con prefijos conocidos. Se inyecta junto a las demás funciones.
function maskSecrets(s) {
  if (!s) {
    return s;
  }
  const luhn = digits => {
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = +digits[i];
      if (alt) {
        n *= 2;
        if (n > 9) {
          n -= 9;
        }
      }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  };
  // Un dígito y 12-18 más, cada uno con un espacio o guion opcional delante; el
  // \b final obliga a terminar en dígito, así no se come el espacio siguiente.
  let out = s.replace(/\b\d(?:[ -]?\d){12,18}\b/g, m => {
    const d = m.replace(/[^\d]/g, "");
    return luhn(d) ? "[tarjeta oculta]" : m;
  });
  out = out.replace(
    /\b(sk[-_][A-Za-z0-9_-]{16,}|pk[-_](live|test)[-_][A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g,
    "[clave oculta]"
  );
  return out;
}

// Tapa con rectángulos negros los secretos visibles antes de una captura:
// contraseñas y, sobre el texto, tarjetas (Luhn) y claves de API. Se llama
// justo antes de drawSnapshot y se deshace después con unredactFn. Autónoma.
function redactSecretsFn() {
  const luhn = digits => {
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = +digits[i];
      if (alt) {
        n *= 2;
        if (n > 9) {
          n -= 9;
        }
      }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  };
  const cardRe = /\b\d(?:[ -]?\d){12,18}\b/g;
  const keyRe = /\b(sk[-_][A-Za-z0-9_-]{16,}|pk[-_](live|test)[-_][A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g;
  let count = 0;
  const box = rect => {
    if (rect.width < 1 || rect.height < 1) {
      return;
    }
    const d = document.createElement("div");
    d.setAttribute("data-fxredact", "1");
    d.style.cssText =
      "position:fixed;left:" + rect.left + "px;top:" + rect.top + "px;width:" +
      rect.width + "px;height:" + rect.height + "px;background:#000;z-index:2147483647;pointer-events:none";
    document.documentElement.appendChild(d);
    count++;
  };
  for (const el of document.querySelectorAll("input[type=password]")) {
    if (el.value) {
      box(el.getBoundingClientRect());
    }
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }
  for (const node of nodes) {
    const text = node.nodeValue;
    if (!text) {
      continue;
    }
    for (const re of [cardRe, keyRe]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (re === cardRe && !luhn(m[0].replace(/[^\d]/g, ""))) {
          continue;
        }
        try {
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          for (const r of range.getClientRects()) {
            box(r);
          }
        } catch (e) {
          // nodo cambiado bajo los pies; se ignora
        }
      }
    }
  }
  // Ocultar el puntero del agente para que no salga en la captura.
  const cur = document.getElementById("__fxcursor");
  if (cur) {
    cur.style.visibility = "hidden";
  }
  void document.documentElement.offsetHeight; // forzar maquetado antes de capturar
  return { redactions: count };
}

function unredactFn() {
  for (const el of document.querySelectorAll("[data-fxredact]")) {
    el.remove();
  }
  const cur = document.getElementById("__fxcursor");
  if (cur) {
    cur.style.visibility = "";
  }
  return true;
}

// Texto visible de la página, recortado y con los secretos ocultos.
function pageTextFn(maxChars) {
  const main = document.querySelector("main, article, [role=main]") || document.body;
  if (!main) {
    return "";
  }
  const text = maskSecrets(main.innerText || "");
  return text.length > maxChars ? text.slice(0, maxChars) + "\n[...texto recortado...]" : text;
}

// Árbol de accesibilidad aproximado. Marca cada elemento interactivo o con
// texto propio con data-fxref para poder hacer clic en él después.
function readPageFn(opts) {
  const attr = "data-fxref";
  const maxChars = opts.maxChars;
  const onlyInteractive = opts.filter === "interactive";

  // Contador que NO se reinicia entre lecturas: las referencias nunca se
  // reutilizan en la misma página, así que una referencia de una lectura
  // anterior no coincide con otra distinta y el clic da error en vez de pulsar
  // el elemento equivocado.
  let counter = parseInt(document.documentElement.getAttribute("data-fxref-seq") || "0", 10);

  // Limpia referencias de una lectura anterior.
  for (const el of document.querySelectorAll("[" + attr + "]")) {
    el.removeAttribute(attr);
  }

  const INTERACTIVE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "OPTION"]);
  const CLICK_ROLES = new Set(["button", "link", "checkbox", "radio", "tab", "menuitem", "switch", "option"]);

  function visible(el) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function role(el) {
    const explicit = el.getAttribute("role");
    if (explicit) {
      return explicit;
    }
    switch (el.tagName) {
      case "A": return el.hasAttribute("href") ? "link" : "generic";
      case "BUTTON": return "button";
      case "INPUT": {
        const t = (el.getAttribute("type") || "text").toLowerCase();
        if (t === "checkbox") return "checkbox";
        if (t === "radio") return "radio";
        if (t === "button" || t === "submit" || t === "reset") return "button";
        return "textbox";
      }
      case "SELECT": return "combobox";
      case "TEXTAREA": return "textbox";
      case "H1": case "H2": case "H3": case "H4": case "H5": case "H6": return "heading";
      case "IMG": return "img";
      case "NAV": return "navigation";
      default: return null;
    }
  }

  function name(el) {
    const label = el.getAttribute("aria-label");
    if (label) {
      return maskSecrets(label.trim());
    }
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      if ((el.getAttribute("type") || "").toLowerCase() === "password") {
        return el.getAttribute("placeholder") ? el.getAttribute("placeholder").trim() : "[contraseña]";
      }
      return maskSecrets((el.getAttribute("placeholder") || el.value || "").trim());
    }
    if (el.tagName === "IMG") {
      return (el.getAttribute("alt") || "").trim();
    }
    // Texto directo primero; si no hay (p.ej. un enlace con el texto dentro de
    // un <span>), caer en innerText para no dejar el elemento sin nombre.
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        text += node.nodeValue;
      }
    }
    text = text.trim();
    if (!text) {
      text = (el.innerText || el.textContent || "").trim();
    }
    return maskSecrets(text.replace(/\s+/g, " ").slice(0, 120));
  }

  function interactive(el) {
    if (INTERACTIVE.has(el.tagName)) {
      return true;
    }
    const r = el.getAttribute("role");
    if (r && CLICK_ROLES.has(r)) {
      return true;
    }
    return el.hasAttribute("onclick") || el.tabIndex >= 0 || el.getAttribute("draggable") === "true";
  }

  const lines = [];
  let truncated = false;

  function walk(el, depth) {
    if (truncated || depth > 20) {
      return;
    }
    if (!visible(el)) {
      return;
    }
    const r = role(el);
    const act = interactive(el);
    if (onlyInteractive && !act) {
      for (const child of el.children) {
        walk(child, depth);
      }
      return;
    }
    if (r || act) {
      const n = name(el);
      let ref = "";
      if (act) {
        ref = "ref_" + ++counter;
        el.setAttribute(attr, ref);
      }
      const parts = ["  ".repeat(depth) + "- " + (r || el.tagName.toLowerCase())];
      if (n) {
        parts.push(JSON.stringify(n));
      }
      if (ref) {
        parts.push("[" + ref + "]");
      }
      lines.push(parts.join(" "));
      if (lines.join("\n").length > maxChars) {
        truncated = true;
        lines.push("[...árbol recortado...]");
        return;
      }
      depth++;
    }
    for (const child of el.children) {
      walk(child, depth);
    }
  }

  walk(document.body, 0);
  document.documentElement.setAttribute("data-fxref-seq", counter);
  return { tree: lines.join("\n"), count: counter };
}

// Busca elementos cuyo texto, rol o nombre contenga la consulta.
function findFn(query, max) {
  const attr = "data-fxref";
  const q = query.toLowerCase();
  const out = [];
  // Mismo contador persistente que read_page: referencias que no se reutilizan.
  let counter = parseInt(document.documentElement.getAttribute("data-fxref-seq") || "0", 10);
  for (const el of document.querySelectorAll("[" + attr + "]")) {
    el.removeAttribute(attr);
  }
  const candidates = document.querySelectorAll(
    "a, button, input, select, textarea, summary, [role], [onclick], [tabindex], [draggable=true]"
  );
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      continue;
    }
    const isPassword = (el.getAttribute("type") || "").toLowerCase() === "password";
    const value = isPassword ? "" : el.value || "";
    const hay = [
      el.getAttribute("aria-label") || "",
      el.getAttribute("placeholder") || "",
      el.getAttribute("title") || "",
      el.getAttribute("role") || "",
      value,
      el.innerText || el.textContent || "",
    ].join(" ").toLowerCase();
    if (!hay.includes(q)) {
      continue;
    }
    const ref = "ref_" + ++counter;
    el.setAttribute(attr, ref);
    const rawName = el.getAttribute("aria-label") || el.innerText || value || "";
    out.push({
      ref,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || "",
      name: maskSecrets(rawName.trim().replace(/\s+/g, " ").slice(0, 100)),
    });
    if (out.length >= max) {
      break;
    }
  }
  document.documentElement.setAttribute("data-fxref-seq", counter);
  return out;
}

// Centro de una referencia en coordenadas del viewport, y qué elemento queda
// realmente bajo ese punto (para no hacer clic a ciegas si algo lo tapa).
function resolveRefFn(ref) {
  const el = document.querySelector("[" + "data-fxref" + "=" + JSON.stringify(ref) + "]");
  if (!el) {
    return { found: false };
  }
  // Solo desplazar si no se ve entero; si ya está en el viewport, no recentrar.
  let r = el.getBoundingClientRect();
  const inView = r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  if (!inView) {
    el.scrollIntoView({ block: "center", inline: "center" });
    r = el.getBoundingClientRect();
  }
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  const covered = !(hit === el || el.contains(hit) || (hit && hit.contains(el)));
  function describe(node) {
    if (!node) {
      return null;
    }
    return node.tagName.toLowerCase() + (node.id ? "#" + node.id : "") +
      (node.className && typeof node.className === "string" ? "." + node.className.trim().split(/\s+/).join(".") : "");
  }
  return {
    found: true,
    x, y,
    inView: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
    covered,
    coveredBy: covered ? describe(hit) : null,
    target: describe(el),
  };
}

// Puntero visible del agente: una flecha que se desliza hasta el punto de la
// acción y una onda en cada clic, para ver qué hace. pointer-events:none, así
// que no estorba. Se oculta durante las capturas (redactSecretsFn).
function showPointerFn(x, y, action) {
  const ID = "__fxcursor";
  let c = document.getElementById(ID);
  if (!c) {
    c = document.createElement("div");
    c.id = ID;
    c.style.cssText =
      "position:fixed;z-index:2147483646;pointer-events:none;width:24px;height:24px;" +
      "margin:-3px 0 0 -3px;transition:left .22s ease,top .22s ease;left:0;top:0;" +
      "filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))";
    c.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 14.5 L11.5 21 L14.5 19.7 L11.5 13.3 L18 13.3 Z" fill="#c62828" stroke="#fff" stroke-width="1.3"/></svg>';
    document.documentElement.appendChild(c);
  }
  c.style.left = x + "px";
  c.style.top = y + "px";
  if (action && action !== "move") {
    const r = document.createElement("div");
    r.className = "__fxripple";
    const color = action === "right" ? "#1565c0" : "#c62828";
    r.style.cssText =
      "position:fixed;z-index:2147483645;pointer-events:none;left:" + x + "px;top:" + y + "px;" +
      "width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;border:2px solid " + color + ";" +
      "opacity:.9;transition:width .5s ease,height .5s ease,margin .5s ease,opacity .5s ease";
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => {
      r.style.width = "40px";
      r.style.height = "40px";
      r.style.margin = "-20px 0 0 -20px";
      r.style.opacity = "0";
    });
    setTimeout(() => r.remove(), 560);
  }
  return true;
}

// --- Entrada sintética (versión pública, sin el experimento) ---
// Los eventos van con isTrusted=false. Funcionan en la mayoría de webs; fallan
// donde hace falta activación de usuario (abrir ventanas, subir ficheros) o hay
// antibots. Es el precio de una extensión firmable por AMO.

function synthDispatch(el, x, y, button, clickCount) {
  const base = {
    bubbles: true, cancelable: true, composed: true, view: window,
    clientX: x, clientY: y, button: button || 0,
    buttons: button === 2 ? 2 : 1, detail: clickCount || 1,
  };
  const up = Object.assign({}, base, { buttons: 0 });
  el.dispatchEvent(new PointerEvent("pointerdown", base));
  el.dispatchEvent(new MouseEvent("mousedown", base));
  if (el.focus) {
    try {
      el.focus();
    } catch (e) {
      // algunos elementos no son enfocables
    }
  }
  el.dispatchEvent(new PointerEvent("pointerup", up));
  el.dispatchEvent(new MouseEvent("mouseup", up));
  if (button === 2) {
    el.dispatchEvent(new MouseEvent("contextmenu", base));
  } else {
    el.dispatchEvent(new MouseEvent("click", base));
    if ((clickCount || 1) >= 2) {
      el.dispatchEvent(new MouseEvent("dblclick", Object.assign({}, base, { detail: 2 })));
    }
  }
}

function describeEl(el) {
  return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "");
}

function clickRefSynthFn(ref, button, clickCount) {
  const el = document.querySelector("[data-fxref=" + JSON.stringify(ref) + "]");
  if (!el) {
    return { ok: false, reason: "referencia no encontrada (relee la página)" };
  }
  const r = el.getBoundingClientRect();
  const inView = r.top >= 0 && r.bottom <= innerHeight;
  if (!inView) {
    el.scrollIntoView({ block: "center" });
  }
  const r2 = el.getBoundingClientRect();
  synthDispatch(el, r2.left + r2.width / 2, r2.top + r2.height / 2, button, clickCount);
  return { ok: true, target: describeEl(el), synthetic: true };
}

function clickPointSynthFn(x, y, button, clickCount) {
  const el = document.elementFromPoint(x, y);
  if (!el) {
    return { ok: false, reason: "nada bajo el punto" };
  }
  synthDispatch(el, x, y, button, clickCount);
  return { ok: true, target: describeEl(el), synthetic: true };
}

// Rellena los inputs nativos que NO son de texto (hora, fecha, color, rango):
// no aceptan una cadena escrita porque tienen subcampos, así que se les pone el
// valor en formato ISO y se avisa con input/change, igual que hacen Playwright
// y compañía. Devuelve {handled:false} si el foco no es uno de estos.
function fillSpecialFn(text) {
  const el = document.activeElement;
  if (!el || el.tagName !== "INPUT") {
    return { handled: false };
  }
  const type = (el.getAttribute("type") || "").toLowerCase();
  const special = ["time", "date", "datetime-local", "month", "week", "color", "range", "number"];
  if (!special.includes(type)) {
    return { handled: false };
  }
  let v = String(text).trim();
  if (type === "time") {
    const m = v.replace(/\s+/g, " ").match(/(\d{1,2})[:.h ]?(\d{2})\s*(a\.?m?\.?|p\.?m?\.?)?/i);
    if (m) {
      let h = +m[1];
      const min = +m[2];
      const ap = (m[3] || "").toLowerCase();
      if (ap[0] === "p" && h < 12) {
        h += 12;
      }
      if (ap[0] === "a" && h === 12) {
        h = 0;
      }
      v = h <= 23 && min <= 59 ? String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0") : "";
    } else {
      v = "";
    }
  }
  if (!v) {
    return { handled: true, ok: false, reason: "no entendí el valor para un campo " + type };
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { handled: true, ok: el.value === v, value: el.value, tipo: type };
}

// Escribe en el elemento con el foco: inputs/textarea por value + evento input;
// contentEditable con insertText.
function typeSynthFn(text) {
  const el = document.activeElement;
  if (!el || el === document.body) {
    return { ok: false, reason: "ningún campo tiene el foco" };
  }
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") {
    const proto = tag === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    for (const ch of text) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
      setter.call(el, el.value + ch);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, synthetic: true };
  }
  if (el.isContentEditable) {
    el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, data: text, inputType: "insertText" }));
    document.execCommand("insertText", false, text);
    return { ok: true, synthetic: true };
  }
  return { ok: false, reason: "el elemento con foco no es editable" };
}

// Arrastre sintético con el botón izquierdo (deslizadores, lienzos, mapas).
function dragSynthFn(x1, y1, x2, y2) {
  const el = document.elementFromPoint(x1, y1);
  if (!el) {
    return { ok: false, reason: "nada en el punto de inicio" };
  }
  const ev = (type, x, y, buttons) =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, buttons }));
  ev("mousemove", x1, y1, 0);
  ev("mousedown", x1, y1, 1);
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    ev("mousemove", x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps, 1);
  }
  ev("mouseup", x2, y2, 0);
  return { ok: true, synthetic: true };
}

// Drag-and-drop HTML5 entre dos referencias (listas ordenables, kanban...).
// Dispara dragstart/dragover/drop/dragend con un DataTransfer compartido. Son
// eventos de script (isTrusted=false), pero las librerías de DnD suelen
// funcionar igual. No sirve para soltar ficheros del sistema.
function dndFn(srcRef, tgtRef, x, y) {
  const q = ref => document.querySelector("[data-fxref=" + JSON.stringify(ref) + "]");
  const src = q(srcRef);
  // El destino puede ser una referencia o un punto (muchas zonas de soltar son
  // divs sin referencia posible).
  const tgt = tgtRef ? q(tgtRef) : document.elementFromPoint(x, y);
  if (!src) {
    return { ok: false, reason: "origen no encontrado (relee la página)" };
  }
  if (!tgt) {
    return { ok: false, reason: "destino no encontrado" };
  }
  const dt = new DataTransfer();
  const center = el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const fire = (el, type, p) => {
    el.dispatchEvent(new DragEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      dataTransfer: dt, clientX: p.x, clientY: p.y,
    }));
  };
  const pt = tgtRef ? center(tgt) : { x, y };
  fire(src, "dragstart", center(src));
  fire(tgt, "dragenter", pt);
  fire(tgt, "dragover", pt);
  fire(tgt, "drop", pt);
  fire(src, "dragend", pt);
  return { ok: true };
}

// Qué hay bajo un punto del viewport, en coordenadas de la página.
function inspectPointFn(x, y) {
  const hit = document.elementFromPoint(x, y);
  if (!hit) {
    return { hit: null };
  }
  return {
    hit: hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : ""),
    text: (hit.innerText || hit.value || "").trim().slice(0, 80),
    ref: hit.closest("[data-fxref]")?.getAttribute("data-fxref") || null,
  };
}
