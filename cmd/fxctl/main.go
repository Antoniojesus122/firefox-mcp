// fxctl habla con el host por la tubería. Sirve para probar el puente y la
// extensión sin pasar por MCP.
//
//	fxctl ping
//	fxctl json          lee una petición JSON de stdin y escribe la respuesta
//	fxctl prueba URL    batería de pruebas sobre una página
package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"firefox-mcp/internal/frame"
	"firefox-mcp/internal/pipe"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "uso: fxctl ping | json | prueba URL")
		os.Exit(2)
	}
	cl, err := dial()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer cl.c.Close()

	switch os.Args[1] {
	case "ping":
		var out any
		err = cl.call("ping", nil, &out)
		if err == nil {
			printJSON(out)
		}
	case "json":
		err = rawCall(cl)
	case "prueba":
		if len(os.Args) < 3 {
			err = errors.New("falta la URL de la página de pruebas")
			break
		}
		err = prueba(cl, os.Args[2])
	default:
		err = fmt.Errorf("orden desconocida: %s", os.Args[1])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

type client struct {
	c    *pipe.Conn
	next int
}

// dial solo acepta la tubería si la sirve el host.exe que está junto a fxctl:
// si otro proceso se ha quedado el nombre, no le mandamos nada.
func dial() (*client, error) {
	c, err := pipe.Dial()
	if err != nil {
		return nil, err
	}
	img, err := pipe.ImagePath(c.PeerPID)
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("no se pudo identificar al servidor de la tubería (pid %d): %v", c.PeerPID, err)
	}
	exe, err := os.Executable()
	if err != nil {
		c.Close()
		return nil, err
	}
	want := filepath.Join(filepath.Dir(exe), "host.exe")
	if !pipe.SamePath(img, want) {
		c.Close()
		return nil, fmt.Errorf("la tubería la sirve %s y se esperaba %s", img, want)
	}
	return &client{c: c}, nil
}

type reply struct {
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result"`
	Error  string          `json:"error"`
}

func (cl *client) call(cmd string, args map[string]any, out any) error {
	cl.next++
	req := map[string]any{"id": cl.next, "cmd": cmd}
	for k, v := range args {
		req[k] = v
	}
	b, err := json.Marshal(req)
	if err != nil {
		return err
	}
	if err := frame.Write(cl.c, b); err != nil {
		return err
	}
	resp, err := frame.Read(cl.c, 64<<20)
	if err != nil {
		return err
	}
	var r reply
	if err := json.Unmarshal(resp, &r); err != nil {
		return err
	}
	if !r.OK {
		return fmt.Errorf("%s: %s", cmd, r.Error)
	}
	if out != nil && len(r.Result) > 0 {
		return json.Unmarshal(r.Result, out)
	}
	return nil
}

func rawCall(cl *client) error {
	in, err := io.ReadAll(os.Stdin)
	if err != nil {
		return err
	}
	if err := frame.Write(cl.c, in); err != nil {
		return err
	}
	resp, err := frame.Read(cl.c, 64<<20)
	if err != nil {
		return err
	}
	_, err = os.Stdout.Write(append(resp, '\n'))
	return err
}

func printJSON(v any) {
	b, _ := json.MarshalIndent(v, "", "  ")
	fmt.Println(string(b))
}

type point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type event struct {
	Marco      string `json:"marco"`
	Tipo       string `json:"tipo"`
	Confiable  *bool  `json:"confiable"`
	Objetivo   string `json:"objetivo"`
	Tecla      string `json:"tecla"`
	Activacion *bool  `json:"activacion"`
	Ventana    *bool  `json:"ventana"`
}

// prueba recorre los casos que deciden si el experimento sirve: clic
// sintético frente a clic real, teclado, iframe de otro sitio y capturas.
func prueba(cl *client, url string) error {
	var tab struct {
		ID int `json:"id"`
	}
	if err := cl.call("open", map[string]any{"url": url}, &tab); err != nil {
		return err
	}
	id := tab.ID
	time.Sleep(time.Second)

	eval := func(code string, out any) error {
		return cl.call("eval", map[string]any{"tabId": id, "code": code}, out)
	}
	reset := func() error {
		return eval(`document.getElementById("registro").textContent = ""; document.getElementById("campo").value = ""; true`, nil)
	}
	center := func(sel string) (point, error) {
		var p *point
		err := eval(fmt.Sprintf(`(() => {
			const el = document.querySelector(%q);
			if (!el) return null;
			el.scrollIntoView({ block: "center" });
			const r = el.getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		})()`, sel), &p)
		if err == nil && p == nil {
			err = fmt.Errorf("no está %s en la página", sel)
		}
		if p == nil {
			return point{}, err
		}
		return *p, err
	}
	click := func(p point) error {
		var info map[string]any
		if err := cl.call("click", map[string]any{"tabId": id, "x": p.X, "y": p.Y}, &info); err != nil {
			return err
		}
		fmt.Printf("   experimento: %v\n", info)
		return nil
	}
	show := func() error {
		time.Sleep(400 * time.Millisecond)
		var text string
		if err := eval(`document.getElementById("registro").textContent`, &text); err != nil {
			return err
		}
		printEvents(text)
		return nil
	}

	step("1. Clic sintético desde un content script")
	if err := reset(); err != nil {
		return err
	}
	if err := cl.call("click_synth", map[string]any{"tabId": id, "selector": "#boton"}, nil); err != nil {
		return err
	}
	if err := show(); err != nil {
		return err
	}

	step("2. Clic real (experimento) en el botón")
	reset()
	p, err := center("#boton")
	if err != nil {
		return err
	}
	if err := click(p); err != nil {
		return err
	}
	if err := show(); err != nil {
		return err
	}

	step("3. Clic real en el campo y escritura")
	reset()
	if p, err = center("#campo"); err != nil {
		return err
	}
	if err := click(p); err != nil {
		return err
	}
	var info map[string]any
	if err := cl.call("type", map[string]any{"tabId": id, "text": "Hola ñ€ 123"}, &info); err != nil {
		return err
	}
	fmt.Printf("   experimento: %v\n", info)
	if err := show(); err != nil {
		return err
	}
	var value string
	eval(`document.getElementById("campo").value`, &value)
	fmt.Printf("   valor del campo: %q\n", value)

	step("4. Clic real dentro de un iframe de otro sitio")
	reset()
	var box *point
	if err := eval(`(() => {
		const f = document.getElementById("marco");
		f.scrollIntoView({ block: "center" });
		const r = f.getBoundingClientRect();
		return { x: r.left + f.clientLeft, y: r.top + f.clientTop };
	})()`, &box); err != nil || box == nil {
		return fmt.Errorf("no se pudo situar el iframe: %v", err)
	}
	var frames []*point
	if err := cl.call("eval", map[string]any{"tabId": id, "allFrames": true, "code": `(() => {
		const el = document.getElementById("boton-marco");
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	})()`}, &frames); err != nil {
		return err
	}
	var inner *point
	for _, f := range frames {
		if f != nil {
			inner = f
		}
	}
	if inner == nil {
		fmt.Println("   no se encontró el botón dentro del iframe")
	} else {
		if err := click(point{box.X + inner.X, box.Y + inner.Y}); err != nil {
			return err
		}
		if err := show(); err != nil {
			return err
		}
	}

	step("5. Captura de la pestaña activa")
	if err := snapshot(cl, id, "captura-activa.png"); err != nil {
		fmt.Printf("   fallo: %v\n", err)
	}

	step("6. Captura de la pestaña en segundo plano")
	var blank struct {
		ID int `json:"id"`
	}
	if err := cl.call("open", map[string]any{"url": "about:blank"}, &blank); err != nil {
		return err
	}
	if err := snapshot(cl, id, "captura-fondo.png"); err != nil {
		fmt.Printf("   fallo: %v\n", err)
	}
	cl.call("close", map[string]any{"tabId": blank.ID}, nil)
	return nil
}

func step(title string) {
	fmt.Printf("\n%s\n", title)
}

// printEvents agrupa los eventos repetidos para que la salida se pueda leer.
func printEvents(text string) {
	type key struct {
		marco, tipo, objetivo string
		confiable             string
	}
	var order []key
	count := map[key]int{}
	for _, line := range strings.Split(strings.TrimSpace(text), "\n") {
		if line == "" {
			continue
		}
		var e event
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			fmt.Printf("   ? %s\n", line)
			continue
		}
		if e.Tipo == "accion" {
			fmt.Printf("   [%s] activación de usuario=%s ventana emergente=%s\n", e.Marco, flag(e.Activacion), flag(e.Ventana))
			continue
		}
		k := key{e.Marco, e.Tipo, e.Objetivo, flag(e.Confiable)}
		if count[k] == 0 {
			order = append(order, k)
		}
		count[k]++
	}
	if len(order) == 0 {
		fmt.Println("   (ningún evento)")
	}
	for _, k := range order {
		fmt.Printf("   [%s] %-11s isTrusted=%-5s en %-12s x%d\n", k.marco, k.tipo, k.confiable, k.objetivo, count[k])
	}
}

func flag(b *bool) string {
	if b == nil {
		return "?"
	}
	if *b {
		return "sí"
	}
	return "no"
}

func snapshot(cl *client, tabID int, name string) error {
	var shot struct {
		Selected bool   `json:"selected"`
		Width    int    `json:"width"`
		Height   int    `json:"height"`
		DataURL  string `json:"dataUrl"`
	}
	if err := cl.call("snapshot", map[string]any{"tabId": tabID}, &shot); err != nil {
		return err
	}
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(shot.DataURL, prefix) {
		return errors.New("la captura no es un PNG")
	}
	png, err := base64.StdEncoding.DecodeString(shot.DataURL[len(prefix):])
	if err != nil {
		return err
	}
	exe, _ := os.Executable()
	path := filepath.Join(filepath.Dir(exe), "..", ".local", name)
	if err := os.WriteFile(path, png, 0o600); err != nil {
		return err
	}
	fmt.Printf("   %dx%d, pestaña seleccionada=%v, %d KB en %s\n", shot.Width, shot.Height, shot.Selected, len(png)/1024, filepath.Clean(path))
	return nil
}
