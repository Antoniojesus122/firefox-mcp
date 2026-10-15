"use strict";

const HOST = "firefox_mcp";

let port = null;
let retryDelay = 1000;

function connect() {
  port = browser.runtime.connectNative(HOST);
  port.onMessage.addListener(onRequest);
  port.onDisconnect.addListener(p => {
    console.warn("host desconectado:", p.error && p.error.message);
    port = null;
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60000);
  });
}

async function onRequest(msg) {
  let reply;
  try {
    const run = commands[msg.cmd];
    if (!run) {
      throw new Error(`orden desconocida: ${msg.cmd}`);
    }
    // El interruptor y el consentimiento por dominio se comprueban antes de
    // ejecutar cualquier acción.
    await guardAction(msg.cmd, msg);
    reply = { id: msg.id, ok: true, result: await run(msg) };
    logIfInteresting(msg.cmd, msg);
    retryDelay = 1000;
  } catch (e) {
    reply = { id: msg.id, ok: false, error: (e && e.message) || String(e) };
  }
  if (port) {
    port.postMessage(reply);
  }
}

const commands = {
  async ping() {
    return { pong: true, userAgent: navigator.userAgent };
  },

  // La política la empuja el host al conectar (id 0).
  async __policy({ policy }) {
    applyPolicy(policy);
    return true;
  },

  // Lectura del estado de seguridad, para que el cliente sepa si puede actuar.
  async status() {
    return {
      active: security.active,
      mode: security.policy.mode,
      approvedDomains: [...security.approved],
      container: Boolean(security.containerId),
    };
  },

  async tabs() {
    const tabs = await browser.tabs.query({});
    return tabs.map(t => ({ id: t.id, windowId: t.windowId, active: t.active, url: t.url, title: t.title }));
  },

  async open({ url }) {
    const opts = { url };
    if (security.containerId) {
      opts.cookieStoreId = security.containerId;
    }
    const created = await browser.tabs.create(opts);
    const done = loaded(created.id);
    await done;
    const tab = await browser.tabs.get(created.id);
    return { id: tab.id, url: tab.url, title: tab.title, container: tab.cookieStoreId };
  },

  async navigate({ tabId, url }) {
    // Armar la espera ANTES de lanzar la navegación, para no perderse el
    // onCompleted si la página carga enseguida.
    const done = loaded(tabId);
    await browser.tabs.update(tabId, { url });
    await done;
    const tab = await browser.tabs.get(tabId);
    return { id: tab.id, url: tab.url, title: tab.title };
  },

  async close({ tabId }) {
    await browser.tabs.remove(tabId);
    return true;
  },

  async eval({ tabId, code, allFrames }) {
    const results = await browser.tabs.executeScript(tabId, { code, allFrames: Boolean(allFrames) });
    return allFrames ? results : results[0];
  },

  async page_text({ tabId, maxChars }) {
    const code = injectable(pageTextFn, `${maxChars || 50000}`);
    const [text] = await browser.tabs.executeScript(tabId, { code });
    return { text: text || "" };
  },

  async read_page({ tabId, maxChars, filter }) {
    const code = injectable(readPageFn, JSON.stringify({ maxChars: maxChars || 40000, filter: filter || "all" }));
    const [result] = await browser.tabs.executeScript(tabId, { code });
    return result;
  },

  async find({ tabId, query, max }) {
    const code = injectable(findFn, `${JSON.stringify(query)}, ${max || 20}`);
    const [matches] = await browser.tabs.executeScript(tabId, { code });
    return { matches: matches || [] };
  },

  // Clic en una referencia obtenida de read_page o find. Antes de pulsar
  // comprueba que el elemento no está tapado por otra cosa de la página; el
  // experimento comprueba además los diálogos del propio Firefox.
  async click_ref({ tabId, ref, force }) {
    const [pos] = await browser.tabs.executeScript(tabId, { code: `(${resolveRefFn})(${JSON.stringify(ref)})` });
    if (!pos || !pos.found) {
      throw new Error(`no existe la referencia ${ref} (relee la página)`);
    }
    if (pos.covered && !force) {
      throw new Error(`${ref} (${pos.target}) está tapado por ${pos.coveredBy}; usa force para pulsar igualmente`);
    }
    await pointer(tabId, pos.x, pos.y, "click");
    if (hasExperiment()) {
      const info = await browser.agentInput.click(tabId, pos.x, pos.y);
      return { ...info, ref, target: pos.target, covered: pos.covered };
    }
    return runOne(tabId, synthClickCode(clickRefSynthFn, `${JSON.stringify(ref)}, 0, 1`));
  },

  // Clic por coordenadas del viewport, diciendo antes qué hay bajo el punto.
  async click_at({ tabId, x, y }) {
    const [under] = await browser.tabs.executeScript(tabId, { code: `(${inspectPointFn})(${x}, ${y})` });
    await pointer(tabId, x, y, "click");
    if (hasExperiment()) {
      const info = await browser.agentInput.click(tabId, x, y);
      return { ...info, under };
    }
    const r = await runOne(tabId, synthClickCode(clickPointSynthFn, `${x}, ${y}, 0, 1`));
    return { ...r, under };
  },

  async click({ tabId, x, y }) {
    await pointer(tabId, x, y, "click");
    if (hasExperiment()) {
      return browser.agentInput.click(tabId, x, y);
    }
    return runOne(tabId, synthClickCode(clickPointSynthFn, `${x}, ${y}, 0, 1`));
  },

  async double_click({ tabId, x, y }) {
    await pointer(tabId, x, y, "dblclick");
    if (hasExperiment()) {
      return browser.agentInput.doubleClick(tabId, x, y);
    }
    return runOne(tabId, synthClickCode(clickPointSynthFn, `${x}, ${y}, 0, 2`));
  },

  async right_click({ tabId, x, y }) {
    await pointer(tabId, x, y, "right");
    if (hasExperiment()) {
      return browser.agentInput.rightClick(tabId, x, y);
    }
    return runOne(tabId, synthClickCode(clickPointSynthFn, `${x}, ${y}, 2, 1`));
  },

  async drag({ tabId, x1, y1, x2, y2 }) {
    await pointer(tabId, x1, y1, "click");
    await pointer(tabId, x2, y2, "move");
    if (hasExperiment()) {
      return browser.agentInput.drag(tabId, x1, y1, x2, y2);
    }
    return runOne(tabId, `(${dragSynthFn})(${x1}, ${y1}, ${x2}, ${y2})`);
  },

  async type({ tabId, text, replace }) {
    // Campos nativos (hora, fecha, color...): se rellenan por valor, no por
    // teclado. Si el foco es uno de ellos, se resuelve aquí (el valor sustituye
    // al anterior de todos modos).
    const [sp] = await browser.tabs.executeScript(tabId, { code: `(${fillSpecialFn})(${JSON.stringify(text)})` });
    if (sp && sp.handled) {
      if (!sp.ok) {
        throw new Error(sp.reason || "no se pudo rellenar el campo");
      }
      return sp;
    }
    if (hasExperiment()) {
      // Con teclado real no hay setter: para reemplazar, se vacía el campo con
      // Ctrl+A y Supr antes de escribir.
      if (replace) {
        await browser.agentInput.key(tabId, "a", { ctrl: true });
        await browser.agentInput.key(tabId, "Delete", {});
      }
      return browser.agentInput.typeText(tabId, text);
    }
    return runOne(tabId, `(${typeSynthFn})(${JSON.stringify(text)}, ${replace ? "true" : "false"})`);
  },

  // Pulsa una tecla con modificadores sobre el elemento con el foco: Ctrl+A,
  // Supr, Retroceso, Enter, Tab, Escape, flechas... Entrada real con el
  // experimento; sintética en la versión pública.
  async key({ tabId, key, ctrl, shift, alt, meta }) {
    const mods = { ctrl: !!ctrl, shift: !!shift, alt: !!alt, meta: !!meta };
    if (hasExperiment()) {
      return browser.agentInput.key(tabId, key, mods);
    }
    return runOne(tabId, `(${keySynthFn})(${JSON.stringify(key)}, ${JSON.stringify(mods)})`);
  },

  // Pasa el ratón por encima (sin pulsar) de una referencia o de un punto, para
  // revelar tooltips y menús que solo salen al apuntar.
  async hover({ tabId, ref, x, y }) {
    let px = x;
    let py = y;
    if (ref) {
      const [pos] = await browser.tabs.executeScript(tabId, { code: `(${resolveRefFn})(${JSON.stringify(ref)})` });
      if (!pos || !pos.found) {
        throw new Error(`no existe la referencia ${ref} (relee la página)`);
      }
      px = pos.x;
      py = pos.y;
    }
    if (typeof px !== "number" || typeof py !== "number") {
      throw new Error("hover necesita una referencia o coordenadas x,y");
    }
    await pointer(tabId, px, py, "move");
    if (hasExperiment()) {
      return browser.agentInput.hover(tabId, px, py);
    }
    return runOne(tabId, `var describeEl=(${describeEl});(${hoverSynthFn})(${px}, ${py})`);
  },

  inspect: ({ tabId, x, y }) => browser.agentInput.inspect(tabId, x || 0, y || 0),

  // Captura con los secretos tapados: se ponen rectángulos negros sobre
  // contraseñas, tarjetas y claves, se captura y se quitan. redact:false la
  // desactiva. Sin el experimento usa captureVisibleTab (solo la pestaña
  // activa).
  async snapshot({ tabId, redact }) {
    const doRedact = redact !== false;
    if (doRedact) {
      await browser.tabs.executeScript(tabId, { code: `(${redactSecretsFn})()`, allFrames: true }).catch(() => {});
    }
    try {
      if (hasExperiment()) {
        return await browser.agentInput.snapshot(tabId);
      }
      const tab = await browser.tabs.get(tabId);
      if (!tab.active) {
        await browser.tabs.update(tabId, { active: true });
      }
      const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      return { dataUrl, width: 0, height: 0, selected: true };
    } finally {
      if (doRedact) {
        await browser.tabs.executeScript(tabId, { code: `(${unredactFn})()`, allFrames: true }).catch(() => {});
      }
    }
  },

  // Desplazamiento por script: no necesita evento real y es fiable. Con x,y
  // desplaza el elemento con barra que haya bajo el punto; si no, la ventana.
  async scroll({ tabId, dx, dy, x, y }) {
    const code = `(${scrollFn})(${Number(dx) || 0}, ${Number(dy) || 0}, ${x === undefined ? "null" : Number(x)}, ${y === undefined ? "null" : Number(y)})`;
    const [pos] = await browser.tabs.executeScript(tabId, { code });
    return pos;
  },

  // Red de la pestaña (metadatos, nunca el cuerpo). La captura la lleva net.js.
  async network({ tabId, limit, urlPattern }) {
    let list = netGet(tabId);
    if (urlPattern) {
      list = list.filter(e => e.url.includes(urlPattern));
    }
    return { requests: list.slice(-(limit || 50)) };
  },

  // Consola de la pestaña (console.* y errores), recogida por el script de
  // contenido console-hook.js.
  async console({ tabId, limit }) {
    const list = consoleGet(tabId);
    return { messages: list.slice(-(limit || 200)) };
  },

  // Drag-and-drop HTML5: del origen (referencia) al destino (referencia o punto).
  async dnd({ tabId, from, to, x, y }) {
    const code = `(${dndFn})(${JSON.stringify(from)}, ${JSON.stringify(to || null)}, ${x === undefined ? "null" : Number(x)}, ${y === undefined ? "null" : Number(y)})`;
    const [r] = await browser.tabs.executeScript(tabId, { code });
    if (!r || !r.ok) {
      throw new Error((r && r.reason) || "no se pudo arrastrar");
    }
    return r;
  },

  // Descarga una URL, con confirmación humana del navegador salvo que la
  // política la salte. El consentimiento por dominio ya lo aplica guardAction.
  async download({ url }) {
    const p = security.policy;
    const ok = p.testAutoApprove || !p.confirmDownloads ||
      await askConsent(i18n("downloadTitle"), i18n("downloadMessage", url));
    if (!ok) {
      throw new Error(i18n("errDownloadDenied"));
    }
    const id = await browser.downloads.download({ url });
    return { id };
  },
};

// Desplaza el elemento con barra bajo (x,y), o la ventana si no hay punto.
function scrollFn(dx, dy, x, y) {
  let target = null;
  if (x !== null && y !== null) {
    let el = document.elementFromPoint(x, y);
    while (el) {
      const s = getComputedStyle(el);
      if ((el.scrollHeight > el.clientHeight && /auto|scroll/.test(s.overflowY)) ||
          (el.scrollWidth > el.clientWidth && /auto|scroll/.test(s.overflowX))) {
        target = el;
        break;
      }
      el = el.parentElement;
    }
  }
  if (target) {
    target.scrollBy(dx, dy);
    return { x: target.scrollLeft, y: target.scrollTop, elemento: true };
  }
  window.scrollBy(dx, dy);
  return { x: window.scrollX, y: window.scrollY, elemento: false };
}

// Prepara el código para executeScript: declara maskSecrets (de page.js) antes
// de la función, porque cada inyección es un sandbox nuevo y la función la usa
// para ocultar secretos.
function injectable(fn, argsStr) {
  return `var maskSecrets=(${maskSecrets});(${fn})(${argsStr})`;
}

// El experimento (código privilegiado, entrada real) solo está en la versión
// privada. Si no está, la extensión cae a entrada sintética (versión pública
// firmable por AMO).
function hasExperiment() {
  return !!(browser.agentInput && typeof browser.agentInput.click === "function");
}

// Ejecuta una función sintética en la página y propaga su error si falló.
async function runOne(tabId, fnExpr) {
  const [r] = await browser.tabs.executeScript(tabId, { code: fnExpr });
  if (r && r.ok === false) {
    throw new Error(r.reason || "la acción sintética no se pudo hacer");
  }
  return r;
}

// Los clics sintéticos (clickRefSynthFn/clickPointSynthFn) usan helpers que hay
// que declarar en el mismo sandbox inyectado.
function synthClickCode(fn, argsStr) {
  return `var describeEl=(${describeEl});var synthDispatch=(${synthDispatch});(${fn})(${argsStr})`;
}

// Muestra el puntero del agente en (x,y). Best-effort (falla en about: y pdf).
async function pointer(tabId, x, y, action) {
  try {
    await browser.tabs.executeScript(tabId, {
      code: `(${showPointerFn})(${Number(x) || 0}, ${Number(y) || 0}, ${JSON.stringify(action || "move")})`,
    });
  } catch (e) {
    // página sin inyección posible
  }
}

// Lo que puede hacer una extensión normal: eventos creados por script, que la
// página recibe con isTrusted=false.
function syntheticClick(selector) {
  const el = document.querySelector(selector);
  if (!el) {
    return false;
  }
  const r = el.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2,
  };
  el.dispatchEvent(new PointerEvent("pointerdown", init));
  el.dispatchEvent(new MouseEvent("mousedown", init));
  el.dispatchEvent(new PointerEvent("pointerup", init));
  el.dispatchEvent(new MouseEvent("mouseup", init));
  el.dispatchEvent(new MouseEvent("click", init));
  return true;
}

// Espera a que el marco principal de la pestaña termine de cargar. Usa
// webNavigation.onCompleted (frameId 0), que señala el fin de la navegación en
// curso y no se confunde con la página anterior ya cargada.
function loaded(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      browser.webNavigation.onCompleted.removeListener(listener);
      reject(new Error("la página no terminó de cargar en 30 s"));
    }, 30000);
    function listener(details) {
      if (details.tabId !== tabId || details.frameId !== 0) {
        return;
      }
      clearTimeout(timer);
      browser.webNavigation.onCompleted.removeListener(listener);
      resolve();
    }
    browser.webNavigation.onCompleted.addListener(listener);
  });
}

// --- Panel lateral de seguimiento y control ---
const panel = { ports: new Set(), log: [], max: 40 };

function panelState() {
  return {
    active: security.active,
    mode: security.policy.mode,
    approved: [...security.approved],
    container: !!security.containerId,
    log: panel.log,
  };
}

function notifyPanels() {
  const s = panelState();
  for (const p of panel.ports) {
    try {
      p.postMessage(s);
    } catch (e) {
      // puerto cerrado
    }
  }
}

function logAction(text) {
  panel.log.push({ t: Date.now(), text });
  if (panel.log.length > panel.max) {
    panel.log.shift();
  }
  notifyPanels();
}

// Describe la acción para el registro. No incluye el texto escrito ni contenido
// de la página, para no filtrar secretos al panel.
function logIfInteresting(cmd, msg) {
  const d = {
    open: () => i18n("logOpen", msg.url || ""),
    navigate: () => i18n("logNavigate", msg.url || ""),
    close: () => i18n("logClose"),
    click: () => i18n("logClick"),
    click_ref: () => i18n("logClickRef", msg.ref || ""),
    click_at: () => i18n("logClickAt", String(Math.round(msg.x)), String(Math.round(msg.y))),
    double_click: () => i18n("logDoubleClick"),
    right_click: () => i18n("logRightClick"),
    drag: () => i18n("logDrag"),
    dnd: () => i18n("logDnd"),
    type: () => i18n("logType", String(String(msg.text || "").length)),
    key: () => i18n("logKey", msg.key || ""),
    hover: () => i18n("logHover"),
    scroll: () => i18n("logScroll"),
    download: () => i18n("logDownload", msg.url || ""),
    snapshot: () => i18n("logSnapshot"),
  }[cmd];
  if (d) {
    logAction(d());
  }
}

function initPanel() {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== "panel") {
      return;
    }
    panel.ports.add(port);
    try {
      port.postMessage(panelState());
    } catch (e) {
      // nada
    }
    port.onMessage.addListener(msg => {
      if (msg && msg.cmd === "toggle") {
        setActive(!security.active);
        notifyPanels();
      } else if (msg && msg.cmd === "clearlog") {
        panel.log = [];
        notifyPanels();
      }
    });
    port.onDisconnect.addListener(() => panel.ports.delete(port));
  });
}

initSecurity();
initNetwork();
initPanel();
connect();
