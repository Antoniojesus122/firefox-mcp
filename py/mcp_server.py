"""Servidor MCP por stdio en Python. Expone las herramientas de Firefox a un
cliente MCP y las reenvía al host por la tubería.

Transporte: JSON-RPC 2.0, un mensaje JSON por línea. En Python para que Smart
App Control no lo bloquee: lo ejecuta un python.exe de confianza."""

import base64
import json
import os
import sys
import threading
import time

import frames
import winpipe

PROTOCOL = "2024-11-05"
MAX_REPLY = 64 << 20
HERE = os.path.dirname(os.path.abspath(__file__))
LOG = open(os.path.join(HERE, "mcp.log"), "a", encoding="utf-8")


def log(msg):
    LOG.write(msg + "\n")
    LOG.flush()


class Bridge:
    """Cliente de la tubería. Conecta a demanda y reintenta una vez."""

    def __init__(self):
        self.next_id = 0
        self.lock = threading.Lock()

    def _dial(self):
        # Reintenta si la tubería está ocupada: el host atiende un cliente a la
        # vez, así que otro cliente puede tenerla un instante.
        last = None
        for intento in range(40):  # ~10 s
            try:
                conn = winpipe.dial()
            except OSError as e:
                if "otro cliente" in str(e):
                    last = e
                    time.sleep(0.25)
                    continue
                raise
            img = winpipe.image_path(conn.peer_pid)
            if os.path.basename(img).lower() != "python.exe":
                conn.close()
                raise OSError(f"la tubería la sirve {img}, no un python.exe")
            return conn
        raise last or OSError("no se pudo conectar con el host")

    def call(self, cmd, args):
        # Una conexión por llamada: se suelta la tubería entre órdenes para que
        # varios clientes puedan turnarse el agente.
        with self.lock:
            conn = self._dial()
            try:
                self.next_id += 1
                req = {"id": self.next_id, "cmd": cmd}
                if args:
                    req.update(args)
                frames.write_frame(conn, json.dumps(req).encode("utf-8"))
                resp = json.loads(frames.read_frame(conn, MAX_REPLY))
            finally:
                conn.close()
        if not resp.get("ok"):
            raise ToolError(resp.get("error", "error desconocido"))
        return resp.get("result")


class ToolError(Exception):
    pass


# ---- construcción de resultados MCP ----

def text_content(text):
    return {"content": [{"type": "text", "text": text}]}


def json_content(result):
    return text_content(json.dumps(result, indent=2, ensure_ascii=False))


def req_int(a, key):
    if key not in a:
        raise ToolError(f"falta el argumento {key!r}")
    try:
        return int(a[key])
    except (TypeError, ValueError):
        raise ToolError(f"{key!r} debe ser un número")


def req_str(a, key):
    v = a.get(key)
    if not isinstance(v, str) or not v:
        raise ToolError(f"falta el argumento de texto {key!r}")
    return v


def req_num(a, key):
    v = a.get(key)
    if not isinstance(v, (int, float)):
        raise ToolError(f"{key!r} debe ser un número")
    return v


# Cada herramienta: (construir args para el host, formatear el resultado).

def _fmt_snapshot(result):
    data = (result or {}).get("dataUrl", "")
    prefix = "data:image/png;base64,"
    data = data[len(prefix):] if data.startswith(prefix) else ""
    try:
        base64.b64decode(data)
    except Exception:  # noqa: BLE001
        return text_content("la captura no es un PNG válido")
    return {"content": [{"type": "image", "data": data, "mimeType": "image/png"}]}


def _fmt_find(result):
    matches = (result or {}).get("matches", [])
    if not matches:
        return text_content("sin coincidencias")
    lines = []
    for m in matches:
        line = m.get("ref", "") + "  " + m.get("tag", "")
        if m.get("role"):
            line += "/" + m["role"]
        if m.get("name"):
            line += "  " + m["name"]
        lines.append(line)
    return text_content("\n".join(lines))


TOOLS = {
    "firefox_tabs": (lambda a: ("tabs", None), json_content),
    "firefox_status": (lambda a: ("status", None), json_content),
    "firefox_open_tab": (lambda a: ("open", {"url": req_str(a, "url")}), json_content),
    "firefox_navigate": (lambda a: ("navigate", {"tabId": req_int(a, "tabId"), "url": req_str(a, "url")}), json_content),
    "firefox_close_tab": (lambda a: ("close", {"tabId": req_int(a, "tabId")}), lambda r: text_content("pestaña cerrada")),
    "firefox_page_text": (
        lambda a: ("page_text", _with_opt({"tabId": req_int(a, "tabId")}, a, "maxChars", int)),
        lambda r: text_content((r or {}).get("text", "")),
    ),
    "firefox_read_page": (
        lambda a: ("read_page", _read_page_args(a)),
        lambda r: text_content((r or {}).get("tree", "")),
    ),
    "firefox_find": (
        lambda a: ("find", _with_opt({"tabId": req_int(a, "tabId"), "query": req_str(a, "query")}, a, "max", int)),
        _fmt_find,
    ),
    "firefox_snapshot": (
        lambda a: ("snapshot", {"tabId": req_int(a, "tabId"),
                                **({"redact": False} if a.get("redact") is False else {})}),
        _fmt_snapshot,
    ),
    "firefox_click_ref": (
        lambda a: ("click_ref", _click_ref_args(a)),
        json_content,
    ),
    "firefox_click_at": (
        lambda a: ("click_at", {"tabId": req_int(a, "tabId"), "x": req_num(a, "x"), "y": req_num(a, "y")}),
        json_content,
    ),
    "firefox_double_click": (
        lambda a: ("double_click", {"tabId": req_int(a, "tabId"), "x": req_num(a, "x"), "y": req_num(a, "y")}),
        json_content,
    ),
    "firefox_right_click": (
        lambda a: ("right_click", {"tabId": req_int(a, "tabId"), "x": req_num(a, "x"), "y": req_num(a, "y")}),
        json_content,
    ),
    "firefox_drag": (
        lambda a: ("drag", {"tabId": req_int(a, "tabId"), "x1": req_num(a, "x1"), "y1": req_num(a, "y1"),
                            "x2": req_num(a, "x2"), "y2": req_num(a, "y2")}),
        json_content,
    ),
    "firefox_scroll": (
        lambda a: ("scroll", _scroll_args(a)),
        json_content,
    ),
    "firefox_download": (
        lambda a: ("download", {"url": req_str(a, "url")}),
        json_content,
    ),
    "firefox_network": (
        lambda a: ("network", _network_args(a)),
        lambda r: _fmt_network(r),
    ),
    "firefox_console": (
        lambda a: ("console", {"tabId": req_int(a, "tabId")}),
        lambda r: _fmt_console(r),
    ),
    "firefox_dnd": (
        lambda a: ("dnd", _dnd_args(a)),
        lambda r: text_content("arrastrado"),
    ),
    "firefox_type": (
        lambda a: ("type", {"tabId": req_int(a, "tabId"), "text": req_str(a, "text")}),
        lambda r: text_content("texto escrito"),
    ),
}


def _scroll_args(a):
    args = {"tabId": req_int(a, "tabId"), "dx": a.get("dx", 0), "dy": a.get("dy", 0)}
    for k in ("x", "y"):
        if isinstance(a.get(k), (int, float)):
            args[k] = a[k]
    return args


def _dnd_args(a):
    args = {"tabId": req_int(a, "tabId"), "from": req_str(a, "from")}
    if isinstance(a.get("to"), str):
        args["to"] = a["to"]
    elif isinstance(a.get("x"), (int, float)) and isinstance(a.get("y"), (int, float)):
        args["x"], args["y"] = a["x"], a["y"]
    else:
        raise ToolError("firefox_dnd necesita 'to' (referencia) o 'x' e 'y' del destino")
    return args


def _network_args(a):
    args = {"tabId": req_int(a, "tabId")}
    if isinstance(a.get("limit"), int):
        args["limit"] = a["limit"]
    if isinstance(a.get("urlPattern"), str):
        args["urlPattern"] = a["urlPattern"]
    return args


def _fmt_network(r):
    reqs = (r or {}).get("requests", [])
    if not reqs:
        return text_content("sin peticiones")
    lines = []
    for q in reqs:
        status = q.get("error") or q.get("status", "")
        cache = " (caché)" if q.get("fromCache") else ""
        lines.append(f"{q.get('method', ''):4} {status} {q.get('type', '')}  {q.get('url', '')}{cache}")
    return text_content("\n".join(lines))


def _fmt_console(r):
    msgs = (r or {}).get("messages", [])
    if not msgs:
        return text_content("sin mensajes")
    lines = []
    for m in msgs:
        where = ""
        if m.get("source"):
            where = f"  ({m['source']}:{m.get('line', '')})"
        lines.append(f"[{m.get('level', '')}] {m.get('text', '')}{where}")
    return text_content("\n".join(lines))


def _with_opt(args, a, key, cast):
    if key in a:
        try:
            args[key] = cast(a[key])
        except (TypeError, ValueError):
            pass
    return args


def _read_page_args(a):
    args = {"tabId": req_int(a, "tabId")}
    if isinstance(a.get("filter"), str):
        args["filter"] = a["filter"]
    _with_opt(args, a, "maxChars", int)
    return args


def _click_ref_args(a):
    args = {"tabId": req_int(a, "tabId"), "ref": req_str(a, "ref")}
    if isinstance(a.get("force"), bool):
        args["force"] = a["force"]
    return args


def _schema(props, required=None):
    return {"type": "object", "properties": props, "required": required or []}


_TAB = {"type": "integer", "description": "Id de la pestaña (de firefox_tabs)."}
_NUM = {"type": "number"}

TOOL_LIST = [
    {"name": "firefox_tabs", "description": "Lista las pestañas abiertas con su id, url y título.", "inputSchema": _schema({})},
    {"name": "firefox_status", "description": "Estado de seguridad del agente: activo o detenido, modo, dominios aprobados y si usa contenedor.", "inputSchema": _schema({})},
    {"name": "firefox_open_tab", "description": "Abre una pestaña nueva en la url dada y espera a que cargue.", "inputSchema": _schema({"url": {"type": "string"}}, ["url"])},
    {"name": "firefox_navigate", "description": "Lleva una pestaña existente a otra url y espera a que cargue.", "inputSchema": _schema({"tabId": _TAB, "url": {"type": "string"}}, ["tabId", "url"])},
    {"name": "firefox_close_tab", "description": "Cierra una pestaña.", "inputSchema": _schema({"tabId": _TAB}, ["tabId"])},
    {"name": "firefox_page_text", "description": "Devuelve el texto visible de la página.", "inputSchema": _schema({"tabId": _TAB, "maxChars": {"type": "integer"}}, ["tabId"])},
    {"name": "firefox_read_page", "description": "Árbol de accesibilidad de la página. Cada elemento pulsable lleva una referencia [ref_N] para firefox_click_ref, válida hasta la siguiente lectura de la pestaña.", "inputSchema": _schema({"tabId": _TAB, "filter": {"type": "string", "enum": ["all", "interactive"]}, "maxChars": {"type": "integer"}}, ["tabId"])},
    {"name": "firefox_find", "description": "Busca elementos cuyo texto, rol o nombre contenga la consulta. Devuelve referencias para firefox_click_ref.", "inputSchema": _schema({"tabId": _TAB, "query": {"type": "string"}, "max": {"type": "integer"}}, ["tabId", "query"])},
    {"name": "firefox_snapshot", "description": "Captura PNG de la pestaña, aunque no esté seleccionada. Tapa con negro contraseñas, tarjetas y claves salvo redact=false.", "inputSchema": _schema({"tabId": _TAB, "redact": {"type": "boolean"}}, ["tabId"])},
    {"name": "firefox_click_ref", "description": "Clic real en una referencia de read_page o find. Falla si otro elemento la tapa, salvo force=true.", "inputSchema": _schema({"tabId": _TAB, "ref": {"type": "string"}, "force": {"type": "boolean"}}, ["tabId", "ref"])},
    {"name": "firefox_click_at", "description": "Clic real en coordenadas CSS del viewport e informa de qué había bajo el punto.", "inputSchema": _schema({"tabId": _TAB, "x": _NUM, "y": _NUM}, ["tabId", "x", "y"])},
    {"name": "firefox_double_click", "description": "Doble clic real en coordenadas CSS del viewport.", "inputSchema": _schema({"tabId": _TAB, "x": _NUM, "y": _NUM}, ["tabId", "x", "y"])},
    {"name": "firefox_right_click", "description": "Clic derecho real. Si la página no usa menú propio, abre el menú nativo de Firefox (no manejable por el agente).", "inputSchema": _schema({"tabId": _TAB, "x": _NUM, "y": _NUM}, ["tabId", "x", "y"])},
    {"name": "firefox_drag", "description": "Arrastra con el botón izquierdo de (x1,y1) a (x2,y2): deslizadores, lienzos, mapas. No dispara el drag-and-drop HTML5.", "inputSchema": _schema({"tabId": _TAB, "x1": _NUM, "y1": _NUM, "x2": _NUM, "y2": _NUM}, ["tabId", "x1", "y1", "x2", "y2"])},
    {"name": "firefox_scroll", "description": "Desplaza dx/dy píxeles. Con x,y desplaza el elemento con barra bajo ese punto; si no, la ventana.", "inputSchema": _schema({"tabId": _TAB, "dx": _NUM, "dy": _NUM, "x": _NUM, "y": _NUM}, ["tabId"])},
    {"name": "firefox_download", "description": "Descarga una URL a la carpeta de descargas, con confirmación del usuario en el navegador.", "inputSchema": _schema({"url": {"type": "string"}}, ["url"])},
    {"name": "firefox_network", "description": "Peticiones de red de la pestaña (método, estado, tipo, url). Solo metadatos, nunca el cuerpo. Se reinicia al navegar.", "inputSchema": _schema({"tabId": _TAB, "limit": {"type": "integer"}, "urlPattern": {"type": "string"}}, ["tabId"])},
    {"name": "firefox_console", "description": "Mensajes de consola (console.*) y errores de script de la pestaña.", "inputSchema": _schema({"tabId": _TAB}, ["tabId"])},
    {"name": "firefox_dnd", "description": "Drag-and-drop HTML5 desde la referencia 'from' hasta 'to' (otra referencia) o hasta el punto x,y (muchas zonas de soltar no tienen referencia). Listas ordenables, kanban. No sirve para soltar ficheros del sistema.", "inputSchema": _schema({"tabId": _TAB, "from": {"type": "string"}, "to": {"type": "string"}, "x": _NUM, "y": _NUM}, ["tabId", "from"])},
    {"name": "firefox_type", "description": "Escribe texto con el teclado sobre el elemento que tiene el foco.", "inputSchema": _schema({"tabId": _TAB, "text": {"type": "string"}}, ["tabId", "text"])},
]


class Server:
    def __init__(self):
        self.bridge = Bridge()
        self.out = sys.stdout.buffer

    def send(self, obj):
        # ASCII con escapes \uXXXX: JSON válido y sin depender de cómo lea el
        # cliente la codificación de la tubería.
        self.out.write((json.dumps(obj) + "\n").encode("ascii"))
        self.out.flush()

    def reply(self, rid, result):
        if rid is not None:
            self.send({"jsonrpc": "2.0", "id": rid, "result": result})

    def reply_error(self, rid, code, msg):
        if rid is not None:
            self.send({"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": msg}})

    def tool_error(self, rid, msg):
        self.reply(rid, {"content": [{"type": "text", "text": msg}], "isError": True})

    def handle(self, line):
        try:
            req = json.loads(line)
        except ValueError:
            return
        method = req.get("method")
        rid = req.get("id")
        if method == "initialize":
            self.reply(rid, {
                "protocolVersion": PROTOCOL,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "firefox-mcp", "version": "0.1.0"},
            })
        elif method == "notifications/initialized":
            pass
        elif method == "ping":
            self.reply(rid, {})
        elif method == "tools/list":
            self.reply(rid, {"tools": TOOL_LIST})
        elif method == "tools/call":
            self.call_tool(req)
        elif rid is not None:
            self.reply_error(rid, -32601, "método no soportado: " + str(method))

    def call_tool(self, req):
        rid = req.get("id")
        params = req.get("params") or {}
        name = params.get("name")
        args = params.get("arguments") or {}
        tool = TOOLS.get(name)
        if tool is None:
            self.tool_error(rid, "herramienta desconocida: " + str(name))
            return
        build, fmt = tool
        try:
            cmd, pipe_args = build(args)
        except ToolError as e:
            self.tool_error(rid, str(e))
            return
        try:
            result = self.bridge.call(cmd, pipe_args)
        except ToolError as e:
            self.tool_error(rid, str(e))
            return
        except (OSError, EOFError) as e:
            self.tool_error(rid, str(e))
            return
        self.reply(rid, fmt(result))


def main():
    # El JSON-RPC de MCP es UTF-8. Sin esto, en Windows Python decodifica el
    # stdin con la página de códigos local (cp1252) y los acentos y la ñ que
    # manda el cliente llegan rotos ("ñ" -> "Ã±"), rompiendo type y find.
    try:
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    srv = Server()
    for line in sys.stdin:
        line = line.strip()
        if line:
            srv.handle(line)


if __name__ == "__main__":
    main()
