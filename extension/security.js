"use strict";

// Capa de seguridad de la extensión. Lo que decide aquí protege de dos cosas
// distintas:
//   - El agente parado: el interruptor de la barra lo detiene al instante.
//   - Instrucciones escondidas en una página que quieran exfiltrar datos: antes
//     de actuar en un dominio nuevo o de ir a él, pide consentimiento con un
//     diálogo del propio Firefox que ni el cliente ni la página pueden pulsar.

const security = {
  policy: {
    mode: "interactive",
    allowedDomains: [],
    confirmNewDomain: true,
    confirmDownloads: true,
    sessionIdleMin: 15,
    testAutoApprove: false,
  },
  active: true,
  approved: new Set(),
  lastActivity: Date.now(),
  containerId: null, // cookieStoreId del contenedor del agente
};

const WRITE = new Set([
  "open", "navigate", "close", "click", "click_ref", "click_at",
  "type", "double_click", "right_click", "scroll", "drag", "dnd", "download",
]);

let policyApplied = false;

function applyPolicy(policy) {
  Object.assign(security.policy, policy);
  // startDisarmed solo cuenta en el primer arranque; si no, cada reconexión
  // del cliente volvería a parar un agente que el usuario ya activó.
  if (!policyApplied && policy.startDisarmed) {
    security.active = false;
  }
  policyApplied = true;
  // El modo solo lectura ya lo aplica el host; aquí sirve para el indicador.
  updateBadge();
}

function setActive(on) {
  security.active = on;
  if (on) {
    security.lastActivity = Date.now();
  }
  updateBadge();
  if (typeof notifyPanels === "function") {
    notifyPanels();
  }
}

function i18n(key, ...subs) {
  return browser.i18n.getMessage(key, subs.length ? subs : undefined);
}

function updateBadge() {
  if (!browser.browserAction) {
    return;
  }
  const readonly = security.policy.mode === "readonly";
  const text = !security.active ? "" : readonly ? "RO" : "ON";
  const color = !security.active ? "#777777" : readonly ? "#1565c0" : "#c62828";
  const title = !security.active
    ? i18n("badgeTitleStopped")
    : readonly ? i18n("badgeTitleReadonly") : i18n("badgeTitleActive");
  browser.browserAction.setBadgeText({ text });
  browser.browserAction.setBadgeBackgroundColor({ color });
  browser.browserAction.setTitle({ title });
}

// touch marca actividad y caduca el consentimiento si estuvo parado mucho rato.
function touch() {
  const idleMs = (security.policy.sessionIdleMin || 15) * 60000;
  if (Date.now() - security.lastActivity > idleMs) {
    security.approved.clear();
  }
  security.lastActivity = Date.now();
}

function domainOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function inAllowlist(domain) {
  const list = security.policy.allowedDomains || [];
  if (list.length === 0) {
    return true;
  }
  return list.some(d => {
    d = String(d).toLowerCase().trim();
    return d && (domain === d || domain.endsWith("." + d));
  });
}

// Pide consentimiento humano para actuar en un dominio, salvo que ya esté
// aprobado en esta sesión o la política no lo exija. El diálogo lo muestra el
// experimento con Services.prompt: es del navegador, no de la página.
async function ensureDomainAllowed(domain, action) {
  if (!domain) {
    return;
  }
  if (!inAllowlist(domain)) {
    throw new Error(i18n("errNotAllowlisted", domain));
  }
  if (security.approved.has(domain)) {
    return;
  }
  if (!security.policy.confirmNewDomain) {
    security.approved.add(domain);
    return;
  }
  if (security.policy.testAutoApprove) {
    console.warn(`[prueba] auto-aprobado ${domain} para ${action}`);
    security.approved.add(domain);
    return;
  }
  const ok = await askConsent(i18n("consentTitle"), i18n("consentMessage", action, domain));
  if (!ok) {
    throw new Error(i18n("errDenied", domain));
  }
  security.approved.add(domain);
}

// Consentimiento humano. Con el experimento, un diálogo del navegador
// (Services.prompt). Sin él (versión pública), una ventana emergente propia de
// la extensión: no la puede pulsar ni la web ni el cliente MCP.
let consentSeq = 0;
const consentPending = new Map();

if (browser.runtime && browser.runtime.onMessage) {
  browser.runtime.onMessage.addListener(msg => {
    if (msg && msg.__consent && consentPending.has(msg.__consent.id)) {
      consentPending.get(msg.__consent.id)(!!msg.__consent.allow);
    }
  });
}

async function askConsent(title, message) {
  if (browser.agentInput && typeof browser.agentInput.confirm === "function") {
    return browser.agentInput.confirm(title, message);
  }
  const id = ++consentSeq;
  const url = browser.runtime.getURL("consent.html") +
    "?id=" + id + "&t=" + encodeURIComponent(title) + "&m=" + encodeURIComponent(message);
  let win;
  try {
    win = await browser.windows.create({ url, type: "popup", width: 440, height: 260 });
  } catch (e) {
    return false;
  }
  return new Promise(resolve => {
    const finish = allow => {
      consentPending.delete(id);
      browser.windows.onRemoved.removeListener(onClosed);
      try {
        browser.windows.remove(win.id);
      } catch (e) {
        // ya cerrada
      }
      resolve(allow);
    };
    const onClosed = closedId => {
      if (closedId === win.id && consentPending.has(id)) {
        finish(false); // cerrar sin responder = denegar
      }
    };
    consentPending.set(id, finish);
    browser.windows.onRemoved.addListener(onClosed);
  });
}

// Puerta que pasa toda acción. tabId se usa para saber el dominio actual
// cuando la orden no trae url (clic, teclado).
async function guardAction(cmd, msg) {
  if (!WRITE.has(cmd)) {
    return;
  }
  if (!security.active) {
    throw new Error(i18n("errStopped"));
  }
  touch();

  let domain = "";
  let verb = i18n("verbAct");
  if (cmd === "open" || cmd === "navigate") {
    domain = domainOf(msg.url);
    verb = i18n("verbNavigate");
  } else if (cmd === "download") {
    domain = domainOf(msg.url);
    verb = i18n("verbDownloadFrom");
  } else if (typeof msg.tabId === "number") {
    const tab = await browser.tabs.get(msg.tabId);
    domain = domainOf(tab.url);
    verb = i18n(cmd === "type" ? "verbType" : "verbClick");
  }
  // Las páginas internas (about:, moz-extension:) no tienen dominio: se dejan.
  if (domain) {
    await ensureDomainAllowed(domain, verb);
  }
}

// Contenedor propio del agente: sus cookies, sin las sesiones del usuario.
async function ensureContainer() {
  if (!browser.contextualIdentities) {
    return;
  }
  try {
    const existing = await browser.contextualIdentities.query({ name: "Agente" });
    const ident = existing[0] || await browser.contextualIdentities.create({
      name: "Agente",
      color: "red",
      icon: "circle",
    });
    security.containerId = ident.cookieStoreId;
  } catch (e) {
    console.warn("no se pudo preparar el contenedor del agente:", e.message);
  }
}

function initSecurity() {
  ensureContainer();
  updateBadge();
  if (browser.browserAction) {
    browser.browserAction.onClicked.addListener(() => setActive(!security.active));
  }
}
