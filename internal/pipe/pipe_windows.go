// Package pipe implementa la tubería con nombre entre el host nativo y sus
// clientes locales.
//
// Medidas de seguridad:
//   - DACL protegida: solo el usuario actual, y nadie que entre por red.
//   - PIPE_REJECT_REMOTE_CLIENTS: la tubería no se sirve a otras máquinas.
//   - Una sola instancia creada con FILE_FLAG_FIRST_PIPE_INSTANCE: si otro
//     proceso se adelanta con el mismo nombre, el host no arranca en vez de
//     compartir el nombre con él.
//   - El cliente abre con SECURITY_IDENTIFICATION para que el servidor no
//     pueda suplantarle, y comprueba qué ejecutable hay al otro lado.
package pipe

import (
	"errors"
	"fmt"
	"io"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const bufSize = 64 << 10

// Name devuelve el nombre de la tubería del usuario actual.
func Name() (string, error) {
	sid, err := currentSID()
	if err != nil {
		return "", err
	}
	return `\\.\pipe\firefox-mcp-` + sid, nil
}

func currentSID() (string, error) {
	u, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return "", err
	}
	return u.User.Sid.String(), nil
}

// Listener es la única instancia de la tubería. Se reutiliza entre clientes
// para que el nombre no quede libre en ningún momento.
type Listener struct {
	h    windows.Handle
	Name string
}

func Listen() (*Listener, error) {
	name, err := Name()
	if err != nil {
		return nil, err
	}
	sid, err := currentSID()
	if err != nil {
		return nil, err
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(D;;GA;;;NU)(A;;GA;;;" + sid + ")")
	if err != nil {
		return nil, err
	}
	sa := &windows.SecurityAttributes{SecurityDescriptor: sd}
	sa.Length = uint32(unsafe.Sizeof(*sa))

	h, err := windows.CreateNamedPipe(
		windows.StringToUTF16Ptr(name),
		windows.PIPE_ACCESS_DUPLEX|windows.FILE_FLAG_FIRST_PIPE_INSTANCE,
		windows.PIPE_TYPE_BYTE|windows.PIPE_READMODE_BYTE|windows.PIPE_WAIT|windows.PIPE_REJECT_REMOTE_CLIENTS,
		1, bufSize, bufSize, 0, sa)
	if err != nil {
		if errors.Is(err, windows.ERROR_ACCESS_DENIED) || errors.Is(err, windows.ERROR_PIPE_BUSY) {
			return nil, fmt.Errorf("%s ya existe: otro proceso tiene la tubería", name)
		}
		return nil, err
	}
	return &Listener{h: h, Name: name}, nil
}

// Accept espera a un cliente. Mientras dure la conexión no se acepta otro.
func (l *Listener) Accept() (*Conn, error) {
	err := windows.ConnectNamedPipe(l.h, nil)
	if err != nil && !errors.Is(err, windows.ERROR_PIPE_CONNECTED) {
		return nil, err
	}
	var pid uint32
	if err := windows.GetNamedPipeClientProcessId(l.h, &pid); err != nil {
		windows.DisconnectNamedPipe(l.h)
		return nil, err
	}
	return &Conn{h: l.h, PeerPID: pid, server: true}, nil
}

func (l *Listener) Close() error {
	return windows.CloseHandle(l.h)
}

// Dial conecta con el host y devuelve también el ejecutable que lo sirve,
// para que el llamante decida si se fía de él.
func Dial() (*Conn, error) {
	name, err := Name()
	if err != nil {
		return nil, err
	}
	h, err := windows.CreateFile(
		windows.StringToUTF16Ptr(name),
		windows.GENERIC_READ|windows.GENERIC_WRITE,
		0, nil, windows.OPEN_EXISTING,
		windows.SECURITY_SQOS_PRESENT|windows.SECURITY_IDENTIFICATION, 0)
	switch {
	case errors.Is(err, windows.ERROR_FILE_NOT_FOUND):
		return nil, errors.New("no hay host escuchando: ¿está Firefox abierto con la extensión?")
	case errors.Is(err, windows.ERROR_PIPE_BUSY):
		return nil, errors.New("el host ya atiende a otro cliente")
	case err != nil:
		return nil, err
	}
	var pid uint32
	if err := windows.GetNamedPipeServerProcessId(h, &pid); err != nil {
		windows.CloseHandle(h)
		return nil, err
	}
	return &Conn{h: h, PeerPID: pid}, nil
}

// Conn es un extremo conectado. Los handles son síncronos: una lectura
// pendiente bloquea las escrituras del mismo handle, así que cada lado debe
// alternar petición y respuesta desde una sola goroutine.
type Conn struct {
	h       windows.Handle
	PeerPID uint32
	server  bool
}

func (c *Conn) Read(p []byte) (int, error) {
	var n uint32
	err := windows.ReadFile(c.h, p, &n, nil)
	if errors.Is(err, windows.ERROR_BROKEN_PIPE) || errors.Is(err, windows.ERROR_PIPE_NOT_CONNECTED) {
		return int(n), io.EOF
	}
	return int(n), err
}

func (c *Conn) Write(p []byte) (int, error) {
	var n uint32
	err := windows.WriteFile(c.h, p, &n, nil)
	return int(n), err
}

// Close en el servidor desconecta al cliente y deja la instancia lista para el
// siguiente; en el cliente cierra el handle.
func (c *Conn) Close() error {
	if c.server {
		windows.FlushFileBuffers(c.h)
		return windows.DisconnectNamedPipe(c.h)
	}
	return windows.CloseHandle(c.h)
}

// ImagePath devuelve la ruta del ejecutable de un proceso.
func ImagePath(pid uint32) (string, error) {
	p, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(p)
	buf := make([]uint16, windows.MAX_LONG_PATH)
	n := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(p, 0, &buf[0], &n); err != nil {
		return "", err
	}
	return windows.UTF16ToString(buf[:n]), nil
}

// SamePath compara rutas de Windows sin distinguir mayúsculas.
func SamePath(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}
