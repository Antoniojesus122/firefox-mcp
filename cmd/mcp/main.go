// Servidor MCP por stdio. Expone las herramientas de Firefox a un cliente MCP
// y las reenvía al host por la tubería.
//
// Transporte: JSON-RPC 2.0, un mensaje JSON por línea.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"

	"firefox-mcp/internal/bridge"
)

const protocolVersion = "2024-11-05"

func main() {
	if f, err := openLog(); err == nil {
		log.SetOutput(f)
	}
	cl, err := bridge.New()
	if err != nil {
		log.Fatalf("no se pudo preparar el puente: %v", err)
	}
	defer cl.Close()

	srv := &server{bridge: cl, out: json.NewEncoder(os.Stdout)}
	in := bufio.NewReaderSize(os.Stdin, 1<<20)
	for {
		line, err := readLine(in)
		if err == io.EOF {
			return
		}
		if err != nil {
			log.Printf("lectura de stdin: %v", err)
			return
		}
		if len(line) == 0 {
			continue
		}
		srv.handle(line)
	}
}

func openLog() (*os.File, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	return os.OpenFile(filepath.Join(filepath.Dir(exe), "mcp.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
}

func readLine(r *bufio.Reader) ([]byte, error) {
	line, err := r.ReadBytes('\n')
	return []byte(strings.TrimRight(string(line), "\r\n")), err
}

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type server struct {
	bridge *bridge.Client
	out    *json.Encoder
}

func (s *server) handle(line []byte) {
	var req rpcRequest
	if err := json.Unmarshal(line, &req); err != nil {
		log.Printf("JSON-RPC ilegible: %v", err)
		return
	}
	// Las notificaciones (sin id) no se responden.
	switch req.Method {
	case "initialize":
		s.reply(req.ID, map[string]any{
			"protocolVersion": protocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "firefox-mcp", "version": "0.1.0"},
		})
	case "notifications/initialized":
		// nada
	case "ping":
		s.reply(req.ID, map[string]any{})
	case "tools/list":
		s.reply(req.ID, map[string]any{"tools": toolList})
	case "tools/call":
		s.callTool(req)
	default:
		if req.ID != nil {
			s.replyError(req.ID, -32601, "método no soportado: "+req.Method)
		}
	}
}

func (s *server) reply(id json.RawMessage, result any) {
	if id == nil {
		return
	}
	s.out.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
}

func (s *server) replyError(id json.RawMessage, code int, msg string) {
	if id == nil {
		return
	}
	s.out.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": msg}})
}

// toolError devuelve el fallo como resultado con isError, que es como MCP
// espera los errores de una herramienta (no como error de protocolo).
func (s *server) toolError(id json.RawMessage, msg string) {
	s.reply(id, map[string]any{
		"content": []any{map[string]any{"type": "text", "text": msg}},
		"isError": true,
	})
}

func (s *server) callTool(req rpcRequest) {
	var params struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		s.replyError(req.ID, -32602, "parámetros ilegibles")
		return
	}
	t, ok := tools[params.Name]
	if !ok {
		s.toolError(req.ID, "herramienta desconocida: "+params.Name)
		return
	}
	cmd, args, err := t.build(params.Arguments)
	if err != nil {
		s.toolError(req.ID, err.Error())
		return
	}
	result, err := s.bridge.Call(cmd, args)
	if err != nil {
		s.toolError(req.ID, err.Error())
		return
	}
	s.reply(req.ID, t.format(result))
}

func textContent(text string) map[string]any {
	return map[string]any{"content": []any{map[string]any{"type": "text", "text": text}}}
}

func jsonContent(v json.RawMessage) map[string]any {
	var pretty any
	json.Unmarshal(v, &pretty)
	b, _ := json.MarshalIndent(pretty, "", "  ")
	return textContent(string(b))
}

func fmtError(format string, a ...any) error {
	return fmt.Errorf(format, a...)
}
