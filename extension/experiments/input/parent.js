/* global ExtensionAPI, ChromeUtils, Services, Cc, Ci */
"use strict";

// Código privilegiado: se ejecuta en el proceso principal de Firefox con
// todos los permisos. Cuanto menos haga, mejor.

const { ExtensionUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs"
);
const { ExtensionError } = ExtensionUtils;

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const NAMED_KEYS = { "\n": "Enter", "\t": "Tab", "\b": "Backspace" };

function locate(context, tabId) {
  const tab = context.extension.tabManager.get(tabId).nativeTab;
  const win = tab.ownerGlobal || tab.ownerDocument?.defaultView;
  if (!win?.gBrowser) {
    throw new ExtensionError(
      `no se encontró la ventana de la pestaña ${tabId} (${Object.prototype.toString.call(tab)})`
    );
  }
  return { tab, browser: win.gBrowser.getBrowserForTab(tab), win };
}

// Los eventos se resuelven contra lo que se ve en la ventana, así que la
// pestaña tiene que estar seleccionada y con el cambio de pestaña terminado.
async function bringToFront({ tab, win }) {
  if (win.gBrowser.selectedTab === tab) {
    return false;
  }
  const done = new Promise(resolve => {
    win.addEventListener("TabSwitchDone", resolve, { once: true });
    win.setTimeout(resolve, 2000);
  });
  win.gBrowser.selectedTab = tab;
  await done;
  return true;
}

// Pasa de coordenadas CSS de la página a coordenadas CSS de la ventana.
function toWindow(browser, x, y) {
  const r = browser.getBoundingClientRect();
  const zoom = browser.fullZoom || 1;
  return [r.left + x * zoom, r.top + y * zoom];
}

// Firefox movió la síntesis de ratón de nsIDOMWindowUtils.sendMouseEvent a
// Window.synthesizeMouseEvent. Se usa la misma ruta que WebDriver BiDi: desde
// el proceso principal, asíncrona y con aviso al terminar. Pasa por APZ, que
// es quien decide a qué proceso va el clic, así que entra en iframes de otro
// sitio. El aviso exige isDOMEventSynthesized=true; esa marca solo la ve el
// código interno de Firefox, no la página.
//
// Con la ventana minimizada Firefox no compone y APZ no puede situar el clic:
// entonces se despacha de forma síncrona, que llega a la página principal pero
// no a iframes de otro sitio.
function mouseSender(win, x, y, button = 0) {
  const source = win.MouseEvent.MOZ_SOURCE_MOUSE;
  const minimized = win.windowState === win.STATE_MINIMIZED;
  if (typeof win.synthesizeMouseEvent === "function" && minimized) {
    const send = (type, clickCount, buttons) => {
      win.synthesizeMouseEvent(
        type,
        x,
        y,
        { button, buttons, clickCount, modifiers: 0, inputSource: source },
        { isDOMEventSynthesized: false, isWidgetEventSynthesized: false, isAsyncEnabled: false }
      );
      return `${type}: síncrono`;
    };
    send.api = "synthesizeMouseEvent (síncrono)";
    return send;
  }
  if (typeof win.synthesizeMouseEvent === "function") {
    const send = (type, clickCount, buttons) =>
      new Promise(resolve => {
        win.setTimeout(() => resolve(`${type}: sin aviso`), 3000);
        win.synthesizeMouseEvent(
          type,
          x,
          y,
          { button, buttons, clickCount, modifiers: 0, inputSource: source },
          { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: true },
          () => resolve(`${type}: ok`)
        );
      });
    send.api = "synthesizeMouseEvent";
    return send;
  }
  const utils = win.windowUtils;
  if (typeof utils.sendMouseEvent === "function") {
    const send = (type, clickCount) =>
      utils.sendMouseEvent(type, x, y, button, clickCount, 0, false, 0, source, false, false);
    send.api = "sendMouseEvent";
    return send;
  }
  throw new ExtensionError("esta versión de Firefox no tiene ninguna API conocida para el ratón");
}

function focusState(win) {
  return {
    windowActive: Services.focus.activeWindow === win,
    windowState: win.windowState,
  };
}

function codeFor(key) {
  if (/^[a-z]$/i.test(key)) {
    return "Key" + key.toUpperCase();
  }
  if (/^[0-9]$/.test(key)) {
    return "Digit" + key;
  }
  if (key === " ") {
    return "Space";
  }
  return key.length > 1 ? key : "";
}

function wrap(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ExtensionError) {
        throw e;
      }
      throw new ExtensionError(String((e && e.message) || e));
    }
  };
}

this.agentInput = class extends ExtensionAPI {
  getAPI(context) {
    return {
      agentInput: {
        click: wrap(async (tabId, x, y) => {
          const t = locate(context, tabId);
          const switched = await bringToFront(t);
          const [cx, cy] = toWindow(t.browser, x, y);
          const send = mouseSender(t.win, cx, cy);
          const sent = [
            await send("mousemove", 0, 0),
            await send("mousedown", 1, 1),
            await send("mouseup", 1, 0),
          ];
          // x,y son las coordenadas de la página (las que pidió el llamante);
          // wx,wy las de la ventana (incluyen la barra del navegador).
          return { x, y, wx: cx, wy: cy, switched, api: send.api, sent, ...focusState(t.win) };
        }),

        doubleClick: wrap(async (tabId, x, y) => {
          const t = locate(context, tabId);
          const switched = await bringToFront(t);
          const [cx, cy] = toWindow(t.browser, x, y);
          const send = mouseSender(t.win, cx, cy);
          await send("mousemove", 0, 0);
          await send("mousedown", 1, 1);
          await send("mouseup", 1, 0);
          await send("mousedown", 2, 1);
          await send("mouseup", 2, 0);
          return { x, y, wx: cx, wy: cy, switched, api: send.api, ...focusState(t.win) };
        }),

        // Botón derecho. Lanza mousedown/up secundarios y el contextmenu. Ojo:
        // si la página no hace preventDefault, abre el menú nativo de Firefox,
        // que es chrome y no se puede pulsar con las herramientas del agente.
        rightClick: wrap(async (tabId, x, y) => {
          const t = locate(context, tabId);
          const switched = await bringToFront(t);
          const [cx, cy] = toWindow(t.browser, x, y);
          const send = mouseSender(t.win, cx, cy, 2);
          await send("mousemove", 0, 0);
          await send("mousedown", 1, 2);
          await send("mouseup", 1, 0);
          await send("contextmenu", 0, 0);
          return { x, y, wx: cx, wy: cy, switched, ...focusState(t.win) };
        }),

        // Arrastre con el botón izquierdo: útil para deslizadores, lienzos,
        // mapas y reordenar. No dispara el drag-and-drop HTML5 (dragstart...).
        drag: wrap(async (tabId, x1, y1, x2, y2) => {
          const t = locate(context, tabId);
          const switched = await bringToFront(t);
          const [sx, sy] = toWindow(t.browser, x1, y1);
          const [ex, ey] = toWindow(t.browser, x2, y2);
          const steps = 10;
          await mouseSender(t.win, sx, sy)("mousemove", 0, 0);
          await mouseSender(t.win, sx, sy)("mousedown", 1, 1);
          for (let i = 1; i <= steps; i++) {
            const px = sx + ((ex - sx) * i) / steps;
            const py = sy + ((ey - sy) * i) / steps;
            await mouseSender(t.win, px, py)("mousemove", 0, 1);
          }
          await mouseSender(t.win, ex, ey)("mouseup", 1, 0);
          return { from: [x1, y1], to: [x2, y2], switched, ...focusState(t.win) };
        }),

        // Diálogo del navegador, no de la página: ni el contenido de la web ni
        // el cliente MCP pueden pulsarlo. Es el consentimiento humano real.
        confirm: wrap(async (title, message) => {
          const win = Services.wm.getMostRecentWindow("navigator:browser");
          if (!win) {
            throw new ExtensionError("no hay ventana de navegador para el diálogo");
          }
          return Services.prompt.confirm(win, title, message);
        }),

        typeText: wrap(async (tabId, text) => {
          const t = locate(context, tabId);
          const switched = await bringToFront(t);
          const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(
            Ci.nsITextInputProcessor
          );
          if (!tip.beginInputTransactionForTests(t.win)) {
            throw new ExtensionError("hay otra entrada de teclado en curso");
          }
          for (const ch of text) {
            const key = NAMED_KEYS[ch] || ch;
            const ev = new t.win.KeyboardEvent("", { key, code: codeFor(key) });
            tip.keydown(ev);
            tip.keyup(ev);
          }
          return { switched, ...focusState(t.win) };
        }),

        inspect: wrap(async (tabId, x, y) => {
          const t = locate(context, tabId);
          const sel = t.win.gBrowser.selectedTab;
          const [cx, cy] = toWindow(t.browser, x, y);
          const hit = t.win.document.elementFromPoint(cx, cy);
          const rect = el => {
            const r = el.getBoundingClientRect();
            return [r.left, r.top, r.width, r.height];
          };
          return {
            ourPos: t.tab._tPos,
            selectedPos: sel._tPos,
            same: sel === t.tab,
            ourPanel: t.tab.linkedPanel,
            selectedPanel: sel.linkedPanel,
            ourBrowserRect: rect(t.browser),
            selectedBrowserRect: rect(t.win.gBrowser.selectedBrowser),
            url: t.browser.currentURI.spec,
            zoom: t.browser.fullZoom,
            dpr: t.win.devicePixelRatio,
            point: [cx, cy],
            hit: hit ? `${hit.localName}#${hit.id}.${hit.className}` : null,
            remote: t.browser.isRemoteBrowser,
            focused: Services.focus.focusedWindow === t.win,
            hitIsOurBrowser: hit === t.browser,
            ourBrowser: `${t.browser.localName}#${t.browser.id}.${t.browser.className}`,
            hitChain: (() => {
              const chain = [];
              for (let el = hit; el && chain.length < 8; el = el.parentElement) {
                chain.push(`${el.localName}#${el.id}.${el.className}`);
              }
              return chain;
            })(),
            dialogs: [...t.win.document.querySelectorAll("browser.dialogFrame")].map(b => ({
              visible: b.checkVisibility(),
              uri: b.currentURI?.spec,
              rect: rect(b),
              text: b.contentDocument?.body?.innerText?.slice(0, 400),
              ids: [...(b.contentDocument?.querySelectorAll("[id]") || [])].slice(0, 15).map(e => e.id),
            })),
          };
        }),

        snapshot: wrap(async tabId => {
          const t = locate(context, tabId);
          const global = t.browser.browsingContext.currentWindowGlobal;
          if (!global) {
            throw new ExtensionError("la pestaña no tiene documento");
          }
          const bitmap = await global.drawSnapshot(null, 1, "white");
          const canvas = t.win.document.createElementNS(XHTML_NS, "canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext("2d").drawImage(bitmap, 0, 0);
          bitmap.close();
          return {
            selected: t.win.gBrowser.selectedTab === t.tab,
            width: canvas.width,
            height: canvas.height,
            dataUrl: canvas.toDataURL("image/png"),
          };
        }),
      },
    };
  }
};
