"use strict";

const params = new URLSearchParams(location.search);
const id = Number(params.get("id"));

document.getElementById("titulo").textContent = params.get("t") || "Permiso del agente";
document.getElementById("mensaje").textContent = params.get("m") || "";

function answer(allow) {
  browser.runtime.sendMessage({ __consent: { id, allow } });
}

document.getElementById("si").addEventListener("click", () => answer(true));
document.getElementById("no").addEventListener("click", () => answer(false));
