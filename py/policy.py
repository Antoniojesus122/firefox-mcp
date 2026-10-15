"""Política dura del agente, leída por el host. Equivale a internal/policy en
Go. Lo que decide aquí no lo cambian ni el cliente MCP ni las páginas."""

import json
import os
from urllib.parse import urlparse

WRITE_COMMANDS = {
    "open", "navigate", "close", "click", "click_ref", "click_at", "type",
    "double_click", "right_click", "scroll", "drag", "dnd", "eval",
    "click_synth", "download",
}


def is_write(cmd):
    return cmd in WRITE_COMMANDS


def default():
    return {
        "mode": "interactive",
        "allowedDomains": [],
        "confirmNewDomain": True,
        "confirmDownloads": True,
        "sessionIdleMinutes": 15,
        "startDisarmed": False,
        "testAutoApprove": False,
    }


def load(path):
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
    except FileNotFoundError:
        return default()
    except (ValueError, OSError):
        return default()
    pol = default()
    pol.update({k: v for k, v in data.items() if k in pol})
    if pol["mode"] != "readonly":
        pol["mode"] = "interactive"
    return pol


def _domain_allowed(allowed, raw_url):
    try:
        host = (urlparse(raw_url).hostname or "").lower()
    except ValueError:
        host = ""
    if not host:
        return False
    for d in allowed:
        d = str(d).strip().lower()
        if d and (host == d or host.endswith("." + d)):
            return True
    return False


def check(pol, cmd, msg):
    """Devuelve (permitido, motivo)."""
    if pol["mode"] == "readonly" and is_write(cmd):
        return False, f"política en modo solo lectura: la orden {cmd} no está permitida"
    if cmd in ("open", "navigate") and pol.get("allowedDomains"):
        target = msg.get("url", "")
        if not _domain_allowed(pol["allowedDomains"], target):
            return False, "dominio fuera de la lista blanca: " + str(target)
    return True, ""


def for_extension(pol):
    return {
        "mode": pol["mode"],
        "allowedDomains": pol["allowedDomains"],
        "confirmNewDomain": pol["confirmNewDomain"],
        "confirmDownloads": pol["confirmDownloads"],
        "sessionIdleMin": pol["sessionIdleMinutes"],
        "startDisarmed": pol["startDisarmed"],
        "testAutoApprove": pol["testAutoApprove"],
    }
