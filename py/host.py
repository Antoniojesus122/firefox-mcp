"""Host de native messaging en Python. Firefox lo arranca (vía host.cmd) cuando
la extensión conecta. Hace de puente entre la extensión (stdin/stdout, marcos
de native messaging) y un único cliente local por la tubería con nombre.

En Python porque Smart App Control bloquea ejecutables propios sin firmar pero
no los scripts que ejecuta un python.exe de confianza."""

import json
import os
import queue
import sys
import threading
import time

import frames
import policy
import winpipe

MAX_FROM_BROWSER = 64 << 20
MAX_FROM_CLIENT = 1 << 20
REQUEST_TIMEOUT = 60.0
# Órdenes que pueden abrir la ventana de consentimiento por dominio: esperan a
# que una persona responda, así que se les da mucho más margen que al resto.
CONSENT_TIMEOUT = 300.0
CONSENT_CMDS = {
    "open", "navigate", "click", "click_ref", "click_at", "double_click",
    "right_click", "type", "key", "hover", "scroll", "drag", "dnd", "download",
}

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = open(os.path.join(HERE, "host.log"), "a", encoding="utf-8")


def log(msg):
    LOG.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
    LOG.flush()


def make_binary(stream):
    # Evita que Windows traduzca CRLF y corrompa los marcos binarios.
    import msvcrt

    msvcrt.setmode(stream.fileno(), os.O_BINARY)


class Router:
    def __init__(self, out):
        self.out = out               # buffer binario hacia la extensión
        self.lock = threading.Lock()
        self.waiting = {}            # id interno -> queue
        self.next_id = 0
        self.pol = policy.default()

    def read_browser(self):
        try:
            while True:
                raw = frames.read_frame_fd(sys.stdin.buffer, MAX_FROM_BROWSER)
                try:
                    msg = json.loads(raw)
                except ValueError:
                    log("mensaje de la extensión ilegible")
                    continue
                mid = msg.get("id")
                if mid in (None, 0):
                    continue  # ack de __policy u otros empujados
                with self.lock:
                    q = self.waiting.pop(mid, None)
                if q is None:
                    log(f"respuesta {mid} sin nadie esperando")
                    continue
                q.put(raw)
        except EOFError:
            log("la extensión se ha desconectado")
            os._exit(0)
        except Exception as e:  # noqa: BLE001
            log(f"lectura de la extensión: {e}")
            os._exit(0)

    def push_policy(self, pol):
        with self.lock:
            frames.write_frame(_OutConn(self.out), json.dumps(
                {"id": 0, "cmd": "__policy", "policy": policy.for_extension(pol)}
            ).encode("utf-8"))

    def serve(self, conn):
        while True:
            try:
                req = frames.read_frame(conn, MAX_FROM_CLIENT)
            except EOFError:
                return
            except OSError as e:
                log(f"lectura del cliente: {e}")
                return
            if not req:
                return
            try:
                frames.write_frame(conn, self.forward(req))
            except OSError as e:
                log(f"escritura al cliente: {e}")
                return

    def forward(self, req):
        try:
            m = json.loads(req)
        except ValueError as e:
            return error_reply(None, "petición no válida: " + str(e))
        client_id = m.get("id")
        cmd = m.get("cmd", "")

        allowed, reason = policy.check(self.pol, cmd, m)
        if not allowed:
            log(f"orden {cmd} bloqueada por política: {reason}")
            return error_reply(client_id, reason)

        q = queue.Queue(maxsize=1)
        with self.lock:
            self.next_id += 1
            internal = self.next_id
            self.waiting[internal] = q
        m["id"] = internal
        log(f"orden {internal}: {cmd}")
        try:
            with self.lock:
                frames.write_frame(_OutConn(self.out), json.dumps(m).encode("utf-8"))
        except OSError as e:
            with self.lock:
                self.waiting.pop(internal, None)
            return error_reply(client_id, "no se pudo hablar con la extensión: " + str(e))

        timeout = CONSENT_TIMEOUT if cmd in CONSENT_CMDS else REQUEST_TIMEOUT
        try:
            resp = q.get(timeout=timeout)
        except queue.Empty:
            with self.lock:
                self.waiting.pop(internal, None)
            if cmd in CONSENT_CMDS:
                return error_reply(
                    client_id,
                    "la extensión no respondió: ¿hay una ventana de permiso del "
                    "agente esperando tu respuesta en Firefox?",
                )
            return error_reply(client_id, "la extensión no respondió a tiempo")
        return with_id(resp, client_id)


class _OutConn:
    """Adapta el buffer binario de stdout a la interfaz write() de frames."""

    def __init__(self, out):
        self.out = out

    def write(self, data):
        self.out.write(data)
        self.out.flush()
        return len(data)


def with_id(resp, client_id):
    try:
        m = json.loads(resp)
    except ValueError:
        return error_reply(client_id, "respuesta no válida de la extensión")
    if client_id is None:
        m.pop("id", None)
    else:
        m["id"] = client_id
    return json.dumps(m, separators=(",", ":")).encode("utf-8")


def error_reply(client_id, msg):
    obj = {"ok": False, "error": msg}
    if client_id is not None:
        obj["id"] = client_id
    return json.dumps(obj, separators=(",", ":")).encode("utf-8")


def load_policy():
    return policy.load(os.path.join(HERE, "policy.json"))


def main():
    make_binary(sys.stdin)
    make_binary(sys.stdout)
    log(f"arranque pid={os.getpid()} args={sys.argv[1:]}")

    pol = load_policy()
    log(f"política: modo={pol['mode']} dominios={pol['allowedDomains']}")

    router = Router(sys.stdout.buffer)
    router.pol = pol

    threading.Thread(target=router.read_browser, daemon=True).start()
    router.push_policy(pol)

    try:
        ln = winpipe.Listener()
    except OSError as e:
        log(f"no se pudo crear la tubería: {e}")
        return 1
    log(f"escuchando en {ln.name}")

    while True:
        try:
            conn = ln.accept()
        except OSError as e:
            log(f"accept: {e}")
            time.sleep(1)
            continue
        try:
            img = winpipe.image_path(conn.peer_pid)
        except OSError:
            img = "?"
        log(f"cliente conectado pid={conn.peer_pid} {img}")
        router.pol = load_policy()
        router.push_policy(router.pol)
        router.serve(conn)
        conn.close()
        log(f"cliente desconectado pid={conn.peer_pid}")


if __name__ == "__main__":
    raise SystemExit(main())
