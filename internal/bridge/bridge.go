// Package bridge es el cliente de la tubería que usan el servidor MCP y fxctl:
// conecta con el host, comprueba que es el ejecutable esperado y hace una
// petición cada vez.
package bridge

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"firefox-mcp/internal/frame"
	"firefox-mcp/internal/pipe"
)

const maxReply = 64 << 20

type Client struct {
	mu   sync.Mutex
	conn *pipe.Conn
	next int64
	exe  string // ejecutable que debe servir la tubería
}

// New prepara el cliente. No conecta todavía; la conexión se abre en la
// primera llamada y se rehace si se cae.
func New() (*Client, error) {
	self, err := os.Executable()
	if err != nil {
		return nil, err
	}
	return &Client{exe: filepath.Join(filepath.Dir(self), "host.exe")}, nil
}

func (c *Client) dial() error {
	conn, err := pipe.Dial()
	if err != nil {
		return err
	}
	img, err := pipe.ImagePath(conn.PeerPID)
	if err != nil {
		conn.Close()
		return fmt.Errorf("no se pudo identificar al host (pid %d): %w", conn.PeerPID, err)
	}
	if !pipe.SamePath(img, c.exe) {
		conn.Close()
		return fmt.Errorf("la tubería la sirve %s y se esperaba %s", img, c.exe)
	}
	c.conn = conn
	return nil
}

// Call manda una orden y devuelve el campo result de la respuesta. args puede
// ser nil.
func (c *Client) Call(cmd string, args map[string]any) (json.RawMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	resp, err := c.roundtrip(cmd, args)
	if err != nil {
		// La conexión pudo caerse al reiniciarse Firefox; un reintento.
		if c.conn != nil {
			c.conn.Close()
			c.conn = nil
		}
		resp, err = c.roundtrip(cmd, args)
	}
	if err != nil {
		return nil, err
	}

	var r struct {
		OK     bool            `json:"ok"`
		Result json.RawMessage `json:"result"`
		Error  string          `json:"error"`
	}
	if err := json.Unmarshal(resp, &r); err != nil {
		return nil, fmt.Errorf("respuesta ilegible: %w", err)
	}
	if !r.OK {
		return nil, errors.New(r.Error)
	}
	return r.Result, nil
}

func (c *Client) roundtrip(cmd string, args map[string]any) ([]byte, error) {
	if c.conn == nil {
		if err := c.dial(); err != nil {
			return nil, err
		}
	}
	c.next++
	req := map[string]any{"id": c.next, "cmd": cmd}
	for k, v := range args {
		req[k] = v
	}
	b, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	if err := frame.Write(c.conn, b); err != nil {
		return nil, err
	}
	return frame.Read(c.conn, maxReply)
}

func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}
}
