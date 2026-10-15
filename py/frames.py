"""Mensajes JSON con prefijo de longitud (4 bytes little-endian): el formato de
native messaging de Firefox, que también usa la tubería."""

import json
import struct


def read_frame(conn, maximum):
    head = conn.read_exact(4)
    (n,) = struct.unpack("<I", head)
    if n > maximum:
        raise ValueError(f"mensaje de {n} bytes, el máximo es {maximum}")
    return conn.read_exact(n) if n else b""


def write_frame(conn, data):
    conn.write(struct.pack("<I", len(data)) + data)


def read_json(conn, maximum):
    return json.loads(read_frame(conn, maximum))


def write_json(conn, obj):
    write_frame(conn, json.dumps(obj, separators=(",", ":")).encode("utf-8"))


# Variante sobre descriptores binarios (stdin/stdout), para el host.
def read_frame_fd(stream, maximum):
    head = _read_exact_fd(stream, 4)
    (n,) = struct.unpack("<I", head)
    if n > maximum:
        raise ValueError(f"mensaje de {n} bytes, el máximo es {maximum}")
    return _read_exact_fd(stream, n) if n else b""


def write_frame_fd(stream, data):
    stream.write(struct.pack("<I", len(data)) + data)
    stream.flush()


def _read_exact_fd(stream, n):
    chunks = []
    left = n
    while left > 0:
        part = stream.read(left)
        if not part:
            raise EOFError("flujo cerrado")
        chunks.append(part)
        left -= len(part)
    return b"".join(chunks)
