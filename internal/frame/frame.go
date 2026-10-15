// Package frame lee y escribe mensajes JSON precedidos de su longitud: el
// formato de native messaging de Firefox, que también usa la tubería.
package frame

import (
	"encoding/binary"
	"fmt"
	"io"
)

// Read devuelve el siguiente mensaje. Rechaza los que pasan de max bytes para
// que un extremo roto o malicioso no obligue a reservar memoria sin límite.
func Read(r io.Reader, max uint32) ([]byte, error) {
	var head [4]byte
	if _, err := io.ReadFull(r, head[:]); err != nil {
		return nil, err
	}
	n := binary.LittleEndian.Uint32(head[:])
	if n > max {
		return nil, fmt.Errorf("mensaje de %d bytes, el máximo es %d", n, max)
	}
	msg := make([]byte, n)
	if _, err := io.ReadFull(r, msg); err != nil {
		return nil, err
	}
	return msg, nil
}

// Write manda cabecera y cuerpo en una sola escritura.
func Write(w io.Writer, msg []byte) error {
	buf := make([]byte, 4+len(msg))
	binary.LittleEndian.PutUint32(buf, uint32(len(msg)))
	copy(buf[4:], msg)
	_, err := w.Write(buf)
	return err
}
