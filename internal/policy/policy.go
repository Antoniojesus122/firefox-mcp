// Package policy carga y aplica la política dura del agente. La lee el host,
// que es el primer punto de confianza entre el cliente MCP y el navegador. Lo
// que decide aquí no lo puede cambiar ni el cliente ni el contenido de una
// página: solo el fichero en disco.
package policy

import (
	"encoding/json"
	"net/url"
	"os"
	"strings"
)

type Mode string

const (
	// Interactive: se permiten acciones, con el consentimiento que pida la
	// extensión. Readonly: solo lectura, ninguna acción que cambie nada.
	Interactive Mode = "interactive"
	Readonly    Mode = "readonly"
)

type Policy struct {
	Mode Mode `json:"mode"`
	// AllowedDomains, si no está vacío, es la lista blanca de navegación: open
	// y navigate solo pueden ir a estos dominios o sus subdominios. Vacío =
	// cualquier dominio (la extensión aún puede pedir consentimiento).
	AllowedDomains []string `json:"allowedDomains"`
	// Opciones que la extensión también necesita; el host las reenvía.
	ConfirmNewDomain bool `json:"confirmNewDomain"`
	ConfirmDownloads bool `json:"confirmDownloads"`
	SessionIdleMin   int  `json:"sessionIdleMinutes"`
	// StartDisarmed arranca el agente detenido: hasta que el usuario lo active
	// desde el botón de la barra, ninguna acción se ejecuta.
	StartDisarmed bool `json:"startDisarmed"`
	// Solo para pruebas: aprueba los consentimientos sin diálogo. Nunca debe
	// estar activo en uso real, y solo se puede poner desde este fichero en
	// disco, no desde MCP.
	TestAutoApprove bool `json:"testAutoApprove"`
}

// Default es la política si no hay fichero: interactiva, sin lista blanca,
// confirmar dominios nuevos y descargas.
func Default() Policy {
	return Policy{
		Mode:             Interactive,
		ConfirmNewDomain: true,
		ConfirmDownloads: true,
		SessionIdleMin:   15,
	}
}

// Load lee el fichero; si no existe devuelve la política por defecto.
func Load(path string) (Policy, error) {
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return Default(), nil
	}
	if err != nil {
		return Default(), err
	}
	p := Default()
	if err := json.Unmarshal(b, &p); err != nil {
		return Default(), err
	}
	if p.Mode != Readonly {
		p.Mode = Interactive
	}
	return p, nil
}

// writeCommands son las órdenes que cambian algo: cerradas en modo solo
// lectura. eval y click_synth entran aquí porque pueden tener efectos.
var writeCommands = map[string]bool{
	"open": true, "navigate": true, "close": true,
	"click": true, "click_ref": true, "click_at": true, "type": true,
	"double_click": true, "right_click": true, "scroll": true,
	"eval": true, "click_synth": true, "download": true,
}

func IsWrite(cmd string) bool { return writeCommands[cmd] }

// Decision explica por qué se bloquea algo, para devolvérselo al cliente.
type Decision struct {
	Allowed bool
	Reason  string
}

// Check aplica la parte dura: modo solo lectura y lista blanca de navegación.
// El consentimiento interactivo lo resuelve la extensión aparte.
func (p Policy) Check(cmd string, args map[string]json.RawMessage) Decision {
	if p.Mode == Readonly && IsWrite(cmd) {
		return Decision{false, "política en modo solo lectura: la orden " + cmd + " no está permitida"}
	}
	if (cmd == "open" || cmd == "navigate") && len(p.AllowedDomains) > 0 {
		var target string
		if raw, ok := args["url"]; ok {
			json.Unmarshal(raw, &target)
		}
		if !p.domainAllowed(target) {
			return Decision{false, "dominio fuera de la lista blanca: " + target}
		}
	}
	return Decision{Allowed: true}
}

func (p Policy) domainAllowed(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	for _, d := range p.AllowedDomains {
		d = strings.ToLower(strings.TrimSpace(d))
		if d == "" {
			continue
		}
		if host == d || strings.HasSuffix(host, "."+d) {
			return true
		}
	}
	return false
}

// ForExtension es lo que el host empuja a la extensión al conectar.
func (p Policy) ForExtension() map[string]any {
	return map[string]any{
		"mode":             string(p.Mode),
		"allowedDomains":   p.AllowedDomains,
		"confirmNewDomain": p.ConfirmNewDomain,
		"confirmDownloads": p.ConfirmDownloads,
		"sessionIdleMin":   p.SessionIdleMin,
		"startDisarmed":    p.StartDisarmed,
		"testAutoApprove":  p.TestAutoApprove,
	}
}
