"use strict";

const params = new URLSearchParams(location.search);
const id = Number(params.get("id"));
const msg = key => browser.i18n.getMessage(key);

document.title = msg("consentTitle");
document.getElementById("titulo").textContent = params.get("t") || msg("consentTitle");
document.getElementById("mensaje").textContent = params.get("m") || "";
document.getElementById("si").textContent = msg("consentAllow");
document.getElementById("no").textContent = msg("consentDeny");

function answer(allow) {
  browser.runtime.sendMessage({ __consent: { id, allow } });
}

document.getElementById("si").addEventListener("click", () => answer(true));
document.getElementById("no").addEventListener("click", () => answer(false));
