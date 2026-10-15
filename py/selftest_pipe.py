"""Autoprueba de la tubería sin Firefox: un servidor en un hilo y un cliente en
el mismo proceso. Valida el ctypes de winpipe y los marcos."""

import threading
import time

import frames
import winpipe


def server(ready, result):
    ln = winpipe.Listener()
    ready.set()
    conn = ln.accept()
    try:
        result["client_pid"] = conn.peer_pid
        msg = frames.read_json(conn, 1 << 20)
        frames.write_json(conn, {"echo": msg, "server": True})
    finally:
        conn.close()
        ln.close()


def main():
    print("SID:", winpipe.current_sid())
    print("tubería:", winpipe.pipe_name())
    ready = threading.Event()
    result = {}
    t = threading.Thread(target=server, args=(ready, result), daemon=True)
    t.start()
    ready.wait(5)
    time.sleep(0.2)

    conn = winpipe.dial()
    print("pid del servidor:", conn.peer_pid)
    print("ejecutable del servidor:", winpipe.image_path(conn.peer_pid))
    frames.write_json(conn, {"hola": "mundo", "n": 42})
    reply = frames.read_json(conn, 1 << 20)
    conn.close()
    t.join(5)

    ok = reply.get("echo", {}).get("n") == 42 and reply.get("server") is True
    print("respuesta:", reply)
    print("pid del cliente visto por el servidor:", result.get("client_pid"))
    print("OK" if ok else "FALLO")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
