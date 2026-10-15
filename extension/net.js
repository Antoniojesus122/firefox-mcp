"use strict";

// Captura de red por pestaña con webRequest. Guarda los últimos NET.max
// registros de cada pestaña (url, método, estado, tipo, caché, error) y los
// reinicia al navegar a otra página. Solo metadatos, nunca el cuerpo.

const NET = { byTab: new Map(), max: 200 };

function netPush(tabId, entry) {
  if (tabId < 0) {
    return;
  }
  let list = NET.byTab.get(tabId);
  if (!list) {
    list = [];
    NET.byTab.set(tabId, list);
  }
  list.push(entry);
  if (list.length > NET.max) {
    list.shift();
  }
}

function netFind(tabId, requestId) {
  const list = NET.byTab.get(tabId);
  if (!list) {
    return null;
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].id === requestId) {
      return list[i];
    }
  }
  return null;
}

function netGet(tabId) {
  return NET.byTab.get(tabId) || [];
}

// Consola por pestaña, alimentada por el script de contenido console-hook.js.
const CONSOLE = { byTab: new Map(), max: 300 };

function consolePush(tabId, entry) {
  if (tabId < 0) {
    return;
  }
  let list = CONSOLE.byTab.get(tabId);
  if (!list) {
    list = [];
    CONSOLE.byTab.set(tabId, list);
  }
  list.push(entry);
  if (list.length > CONSOLE.max) {
    list.shift();
  }
}

function consoleGet(tabId) {
  return CONSOLE.byTab.get(tabId) || [];
}

function initNetwork() {
  const filter = { urls: ["<all_urls>"] };

  browser.webRequest.onBeforeRequest.addListener(d => {
    netPush(d.tabId, { id: d.requestId, url: d.url, method: d.method, type: d.type, t0: Math.round(d.timeStamp) });
  }, filter);

  browser.webRequest.onCompleted.addListener(d => {
    const e = netFind(d.tabId, d.requestId);
    if (e) {
      e.status = d.statusCode;
      e.fromCache = d.fromCache;
      e.t1 = Math.round(d.timeStamp);
    } else {
      netPush(d.tabId, { id: d.requestId, url: d.url, method: d.method, type: d.type, status: d.statusCode, fromCache: d.fromCache });
    }
  }, filter);

  browser.webRequest.onErrorOccurred.addListener(d => {
    const e = netFind(d.tabId, d.requestId);
    if (e) {
      e.error = d.error;
    } else {
      netPush(d.tabId, { id: d.requestId, url: d.url, method: d.method, type: d.type, error: d.error });
    }
  }, filter);

  // Mensajes de consola que reenvía el script de contenido.
  browser.runtime.onMessage.addListener((msg, sender) => {
    if (msg && msg.__console && sender.tab) {
      consolePush(sender.tab.id, msg.__console);
    }
  });

  // Red y consola por página: se reinician al empezar una navegación de nivel
  // superior.
  browser.webNavigation.onBeforeNavigate.addListener(d => {
    if (d.frameId === 0) {
      NET.byTab.delete(d.tabId);
      CONSOLE.byTab.delete(d.tabId);
    }
  });
  browser.tabs.onRemoved.addListener(id => {
    NET.byTab.delete(id);
    CONSOLE.byTab.delete(id);
  });
}
