package policy

import "encoding/json"

import "testing"

func args(kv map[string]string) map[string]json.RawMessage {
	m := map[string]json.RawMessage{}
	for k, v := range kv {
		b, _ := json.Marshal(v)
		m[k] = b
	}
	return m
}

func TestReadonlyBlocksWrites(t *testing.T) {
	p := Policy{Mode: Readonly}
	for _, cmd := range []string{"click", "type", "navigate", "eval", "download"} {
		if d := p.Check(cmd, nil); d.Allowed {
			t.Errorf("%s debería estar bloqueado en solo lectura", cmd)
		}
	}
	for _, cmd := range []string{"tabs", "page_text", "read_page", "find", "snapshot", "ping"} {
		if d := p.Check(cmd, nil); !d.Allowed {
			t.Errorf("%s debería permitirse en solo lectura: %s", cmd, d.Reason)
		}
	}
}

func TestInteractiveAllowsWrites(t *testing.T) {
	p := Default()
	if d := p.Check("click", nil); !d.Allowed {
		t.Errorf("click debería permitirse en modo interactivo: %s", d.Reason)
	}
}

func TestAllowlist(t *testing.T) {
	p := Policy{Mode: Interactive, AllowedDomains: []string{"example.com", "ejemplo.org"}}
	cases := []struct {
		url  string
		want bool
	}{
		{"https://example.com/x", true},
		{"https://sub.example.com/x", true},
		{"https://ejemplo.org", true},
		{"https://evil.com", false},
		{"https://notexample.com", false},   // no es subdominio
		{"https://example.com.evil.com", false},
		{"", false},
	}
	for _, c := range cases {
		d := p.Check("navigate", args(map[string]string{"url": c.url}))
		if d.Allowed != c.want {
			t.Errorf("navigate %q: permitido=%v, esperado=%v (%s)", c.url, d.Allowed, c.want, d.Reason)
		}
	}
}

func TestEmptyAllowlistPermitsNavigation(t *testing.T) {
	p := Default() // sin lista blanca
	if d := p.Check("navigate", args(map[string]string{"url": "https://cualquiera.com"})); !d.Allowed {
		t.Errorf("sin lista blanca, navigate debería pasar la capa dura: %s", d.Reason)
	}
}
