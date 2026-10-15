"""Cliente de pruebas de la tubería (como fxctl json, pero en Python, que SAC no
bloquea). Lee una petición JSON de argv[1] o de stdin y escribe la respuesta."""

import json
import sys
import time

import frames
import winpipe


def dial_retry():
    for _ in range(40):
        try:
            return winpipe.dial()
        except OSError as e:
            if "otro cliente" in str(e):
                time.sleep(0.25)
                continue
            raise
    raise OSError("la tubería sigue ocupada por otro cliente")


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
    conn = dial_retry()
    try:
        frames.write_frame(conn, raw.strip().encode("utf-8"))
        resp = frames.read_frame(conn, 64 << 20)
    finally:
        conn.close()
    sys.stdout.write(resp.decode("utf-8") + "\n")


if __name__ == "__main__":
    main()
