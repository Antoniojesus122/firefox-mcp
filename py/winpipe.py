"""Tubería con nombre de Windows por ctypes, con las mismas protecciones que la
versión en Go: DACL solo para el usuario actual, rechazo de clientes por red,
una sola instancia y comprobación del ejecutable al otro lado.

Se usa Python porque Smart App Control bloquea ejecutables propios sin firmar
pero no controla los scripts que ejecuta un python.exe de confianza.
"""

import ctypes
from ctypes import wintypes

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
a32 = ctypes.WinDLL("advapi32", use_last_error=True)

INVALID_HANDLE_VALUE = wintypes.HANDLE(-1).value
GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
OPEN_EXISTING = 3
PIPE_ACCESS_DUPLEX = 0x3
FILE_FLAG_FIRST_PIPE_INSTANCE = 0x00080000
PIPE_TYPE_BYTE = 0x0
PIPE_READMODE_BYTE = 0x0
PIPE_WAIT = 0x0
PIPE_REJECT_REMOTE_CLIENTS = 0x8
SECURITY_SQOS_PRESENT = 0x00100000
SECURITY_IDENTIFICATION = 0x00010000  # SecurityIdentification (1) << 16
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
TOKEN_QUERY = 0x0008
TokenUser = 1
SDDL_REVISION_1 = 1

ERROR_FILE_NOT_FOUND = 2
ERROR_ACCESS_DENIED = 5
ERROR_BROKEN_PIPE = 109
ERROR_PIPE_BUSY = 231
ERROR_PIPE_NOT_CONNECTED = 233
ERROR_PIPE_CONNECTED = 535
BUF = 64 * 1024


class SECURITY_ATTRIBUTES(ctypes.Structure):
    _fields_ = [
        ("nLength", wintypes.DWORD),
        ("lpSecurityDescriptor", wintypes.LPVOID),
        ("bInheritHandle", wintypes.BOOL),
    ]


class SID_AND_ATTRIBUTES(ctypes.Structure):
    _fields_ = [("Sid", wintypes.LPVOID), ("Attributes", wintypes.DWORD)]


class TOKEN_USER(ctypes.Structure):
    _fields_ = [("User", SID_AND_ATTRIBUTES)]


k32.CreateNamedPipeW.restype = wintypes.HANDLE
k32.CreateNamedPipeW.argtypes = [
    wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
    wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
]
k32.CreateFileW.restype = wintypes.HANDLE
k32.CreateFileW.argtypes = [
    wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
    wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
]
k32.ConnectNamedPipe.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
k32.DisconnectNamedPipe.argtypes = [wintypes.HANDLE]
k32.FlushFileBuffers.argtypes = [wintypes.HANDLE]
k32.CloseHandle.argtypes = [wintypes.HANDLE]
k32.ReadFile.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
k32.WriteFile.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
k32.GetNamedPipeClientProcessId.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
k32.GetNamedPipeServerProcessId.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
k32.OpenProcess.restype = wintypes.HANDLE
k32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
k32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
k32.GetCurrentProcess.restype = wintypes.HANDLE

a32.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
a32.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
a32.ConvertSidToStringSidW.argtypes = [wintypes.LPVOID, ctypes.POINTER(wintypes.LPWSTR)]
a32.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
    wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(wintypes.LPVOID), ctypes.POINTER(wintypes.DWORD)
]
k32.LocalFree.argtypes = [wintypes.HLOCAL]


def _err(msg):
    return OSError(f"{msg}: error de Windows {ctypes.get_last_error()}")


def current_sid():
    tok = wintypes.HANDLE()
    if not a32.OpenProcessToken(k32.GetCurrentProcess(), TOKEN_QUERY, ctypes.byref(tok)):
        raise _err("OpenProcessToken")
    try:
        size = wintypes.DWORD(0)
        a32.GetTokenInformation(tok, TokenUser, None, 0, ctypes.byref(size))
        buf = ctypes.create_string_buffer(size.value)
        if not a32.GetTokenInformation(tok, TokenUser, buf, size, ctypes.byref(size)):
            raise _err("GetTokenInformation")
        tu = ctypes.cast(buf, ctypes.POINTER(TOKEN_USER)).contents
        s = wintypes.LPWSTR()
        if not a32.ConvertSidToStringSidW(tu.User.Sid, ctypes.byref(s)):
            raise _err("ConvertSidToStringSid")
        try:
            return s.value
        finally:
            k32.LocalFree(s)
    finally:
        k32.CloseHandle(tok)


def pipe_name():
    return r"\\.\pipe\firefox-mcp-" + current_sid()


def image_path(pid):
    h = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        raise _err("OpenProcess")
    try:
        size = wintypes.DWORD(32768)
        buf = ctypes.create_unicode_buffer(size.value)
        if not k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            raise _err("QueryFullProcessImageName")
        return buf.value
    finally:
        k32.CloseHandle(h)


def same_path(a, b):
    return (a or "").strip().lower() == (b or "").strip().lower()


class Conn:
    def __init__(self, handle, peer_pid, server):
        self.h = handle
        self.peer_pid = peer_pid
        self.server = server

    def read(self, n):
        buf = ctypes.create_string_buffer(n)
        got = wintypes.DWORD(0)
        ok = k32.ReadFile(self.h, buf, n, ctypes.byref(got), None)
        if not ok:
            e = ctypes.get_last_error()
            if e in (ERROR_BROKEN_PIPE, ERROR_PIPE_NOT_CONNECTED):
                return b""
            raise _err("ReadFile")
        return buf.raw[: got.value]

    def read_exact(self, n):
        chunks = []
        left = n
        while left > 0:
            part = self.read(left)
            if not part:
                raise EOFError("la tubería se cerró")
            chunks.append(part)
            left -= len(part)
        return b"".join(chunks)

    def write(self, data):
        wrote = wintypes.DWORD(0)
        if not k32.WriteFile(self.h, data, len(data), ctypes.byref(wrote), None):
            raise _err("WriteFile")
        return wrote.value

    def close(self):
        if self.server:
            k32.FlushFileBuffers(self.h)
            k32.DisconnectNamedPipe(self.h)
        else:
            k32.CloseHandle(self.h)


class Listener:
    def __init__(self):
        self.name = pipe_name()
        sid = current_sid()
        sddl = "D:P(D;;GA;;;NU)(A;;GA;;;" + sid + ")"
        sd = wintypes.LPVOID()
        if not a32.ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl, SDDL_REVISION_1, ctypes.byref(sd), None
        ):
            raise _err("ConvertStringSecurityDescriptor")
        sa = SECURITY_ATTRIBUTES()
        sa.nLength = ctypes.sizeof(sa)
        sa.lpSecurityDescriptor = sd
        sa.bInheritHandle = False
        self.h = k32.CreateNamedPipeW(
            self.name,
            PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1, BUF, BUF, 0, ctypes.byref(sa),
        )
        k32.LocalFree(sd)
        if self.h == INVALID_HANDLE_VALUE:
            e = ctypes.get_last_error()
            if e in (ERROR_ACCESS_DENIED, ERROR_PIPE_BUSY):
                raise OSError(f"{self.name} ya existe: otro proceso tiene la tubería")
            raise _err("CreateNamedPipe")

    def accept(self):
        if not k32.ConnectNamedPipe(self.h, None):
            e = ctypes.get_last_error()
            if e != ERROR_PIPE_CONNECTED:
                raise _err("ConnectNamedPipe")
        pid = wintypes.DWORD(0)
        if not k32.GetNamedPipeClientProcessId(self.h, ctypes.byref(pid)):
            k32.DisconnectNamedPipe(self.h)
            raise _err("GetNamedPipeClientProcessId")
        return Conn(self.h, pid.value, server=True)

    def close(self):
        k32.CloseHandle(self.h)


def dial():
    name = pipe_name()
    h = k32.CreateFileW(
        name, GENERIC_READ | GENERIC_WRITE, 0, None, OPEN_EXISTING,
        SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, None,
    )
    if h == INVALID_HANDLE_VALUE:
        e = ctypes.get_last_error()
        if e == ERROR_FILE_NOT_FOUND:
            raise OSError("no hay host escuchando: ¿está Firefox abierto con la extensión?")
        if e == ERROR_PIPE_BUSY:
            raise OSError("el host ya atiende a otro cliente")
        raise _err("CreateFile")
    pid = wintypes.DWORD(0)
    if not k32.GetNamedPipeServerProcessId(h, ctypes.byref(pid)):
        k32.CloseHandle(h)
        raise _err("GetNamedPipeServerProcessId")
    return Conn(h, pid.value, server=False)
