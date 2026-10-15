// Host de native messaging. Firefox lo arranca cuando la extensión conecta y
// lo cierra cuando se desconecta. Hace de puente entre la extensión
// (stdin/stdout) y un único cliente local por la tubería con nombre.
package main

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"firefox-mcp/internal/frame"
	"firefox-mcp/internal/pipe"
	"firefox-mcp/internal/policy"
)

const (
	maxFromBrowser = 64 << 20 // las capturas de pantalla vienen por aquí
	maxFromClient  = 1 << 20  // Firefox no admite mensajes de más de 1 MB hacia la extensión
	requestTimeout = 60 * time.Second
)

func main() {
	// El fichero va primero: MultiWriter se detiene en el primer error, y el
	// stderr que da Firefox no siempre admite escrituras.
	if f, err := openLog(); err == nil {
		log.SetOutput(io.MultiWriter(f, os.Stderr))
	}
	log.Printf("arranque pid=%d args=%q", os.Getpid(), os.Args[1:])

	pol := loadPolicy()
	log.Printf("política: modo=%s dominios=%v", pol.Mode, pol.AllowedDomains)

	ln, err := pipe.Listen()
	if err != nil {
		log.Fatalf("no se pudo crear la tubería: %v", err)
	}
	log.Printf("escuchando en %s", ln.Name)

	r := &router{waiting: map[int64]chan []byte{}, toBrowser: os.Stdout, policy: pol}
	go func() {
		r.readBrowser(os.Stdin)
		log.Printf("la extensión se ha desconectado")
		os.Exit(0)
	}()

	// Empujar la política a la extensión (id 0: sin respuesta esperada).
	pushPolicy(os.Stdout, pol)

	for {
		c, err := ln.Accept()
		if err != nil {
			log.Printf("accept: %v", err)
			time.Sleep(time.Second)
			continue
		}
		img, _ := pipe.ImagePath(c.PeerPID)
		log.Printf("cliente conectado pid=%d %s", c.PeerPID, img)
		// Releer la política por si cambió el fichero, y reenviarla a la
		// extensión. Un solo escritor (esta goroutine), sin carrera con forward.
		r.policy = loadPolicy()
		pushPolicy(os.Stdout, r.policy)
		r.serve(c)
		c.Close()
		log.Printf("cliente desconectado pid=%d", c.PeerPID)
	}
}

func loadPolicy() policy.Policy {
	exe, err := os.Executable()
	if err != nil {
		return policy.Default()
	}
	pol, err := policy.Load(filepath.Join(filepath.Dir(exe), "policy.json"))
	if err != nil {
		log.Printf("policy.json ilegible, uso la política por defecto: %v", err)
	}
	return pol
}

// pushPolicy manda la política a la extensión al arrancar. Id 0: la extensión
// la aplica y no se espera respuesta.
func pushPolicy(w io.Writer, pol policy.Policy) {
	msg, _ := json.Marshal(map[string]any{"id": 0, "cmd": "__policy", "policy": pol.ForExtension()})
	if err := frame.Write(w, msg); err != nil {
		log.Printf("no se pudo enviar la política a la extensión: %v", err)
	}
}

// El registro va junto al ejecutable y solo guarda metadatos: nunca el
// contenido de las páginas ni de las órdenes.
func openLog() (*os.File, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	return os.OpenFile(filepath.Join(filepath.Dir(exe), "host.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
}

type router struct {
	mu        sync.Mutex
	next      int64
	waiting   map[int64]chan []byte
	toBrowser io.Writer
	policy    policy.Policy
}

// readBrowser reparte las respuestas de la extensión según su id.
func (r *router) readBrowser(in io.Reader) {
	for {
		msg, err := frame.Read(in, maxFromBrowser)
		if err != nil {
			if !errors.Is(err, io.EOF) {
				log.Printf("lectura de la extensión: %v", err)
			}
			return
		}
		var head struct {
			ID *int64 `json:"id"`
		}
		if err := json.Unmarshal(msg, &head); err != nil || head.ID == nil {
			log.Printf("mensaje de la extensión sin id (%d bytes)", len(msg))
			continue
		}
		if *head.ID == 0 {
			continue // ack de __policy u otros mensajes empujados
		}
		r.mu.Lock()
		ch := r.waiting[*head.ID]
		delete(r.waiting, *head.ID)
		r.mu.Unlock()
		if ch == nil {
			log.Printf("respuesta %d sin nadie esperando", *head.ID)
			continue
		}
		ch <- msg
	}
}

func (r *router) serve(c io.ReadWriter) {
	for {
		req, err := frame.Read(c, maxFromClient)
		if err != nil {
			if !errors.Is(err, io.EOF) {
				log.Printf("lectura del cliente: %v", err)
			}
			return
		}
		if err := frame.Write(c, r.forward(req)); err != nil {
			log.Printf("escritura al cliente: %v", err)
			return
		}
	}
}

// forward cambia el id del cliente por uno propio, para que dos clientes
// seguidos no puedan recibir respuestas cruzadas, y lo restaura a la vuelta.
func (r *router) forward(req []byte) []byte {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(req, &m); err != nil {
		return errorReply(nil, "petición no válida: "+err.Error())
	}
	clientID := m["id"]
	var cmd string
	json.Unmarshal(m["cmd"], &cmd)

	// Política dura: solo lectura y lista blanca de navegación. Se decide aquí,
	// donde no llega ni el cliente MCP ni el contenido de las páginas.
	if d := r.policy.Check(cmd, m); !d.Allowed {
		log.Printf("orden %s bloqueada por política: %s", cmd, d.Reason)
		return errorReply(clientID, d.Reason)
	}

	ch := make(chan []byte, 1)
	r.mu.Lock()
	r.next++
	id := r.next
	r.waiting[id] = ch
	r.mu.Unlock()

	m["id"], _ = json.Marshal(id)
	out, _ := json.Marshal(m)
	log.Printf("orden %d: %s", id, cmd)
	if err := frame.Write(r.toBrowser, out); err != nil {
		r.drop(id)
		return errorReply(clientID, "no se pudo hablar con la extensión: "+err.Error())
	}

	select {
	case resp := <-ch:
		return withID(resp, clientID)
	case <-time.After(requestTimeout):
		r.drop(id)
		return errorReply(clientID, "la extensión no respondió a tiempo")
	}
}

func (r *router) drop(id int64) {
	r.mu.Lock()
	delete(r.waiting, id)
	r.mu.Unlock()
}

func withID(resp []byte, id json.RawMessage) []byte {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(resp, &m); err != nil {
		return errorReply(id, "respuesta no válida de la extensión")
	}
	if id == nil {
		delete(m, "id")
	} else {
		m["id"] = id
	}
	out, _ := json.Marshal(m)
	return out
}

func errorReply(id json.RawMessage, msg string) []byte {
	out, _ := json.Marshal(struct {
		ID    json.RawMessage `json:"id,omitempty"`
		OK    bool            `json:"ok"`
		Error string          `json:"error"`
	}{id, false, msg})
	return out
}
