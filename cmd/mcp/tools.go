package main

import (
	"encoding/base64"
	"encoding/json"
	"strings"
)

type tool struct {
	build  func(args map[string]any) (cmd string, pipeArgs map[string]any, err error)
	format func(result json.RawMessage) map[string]any
}

// Extracción de argumentos. El JSON de MCP trae los números como float64.

func reqInt(args map[string]any, key string) (int, error) {
	v, ok := args[key]
	if !ok {
		return 0, fmtError("falta el argumento %q", key)
	}
	n, ok := v.(float64)
	if !ok {
		return 0, fmtError("%q debe ser un número", key)
	}
	return int(n), nil
}

func optInt(args map[string]any, key string) (int, bool) {
	if v, ok := args[key].(float64); ok {
		return int(v), true
	}
	return 0, false
}

func reqStr(args map[string]any, key string) (string, error) {
	v, ok := args[key].(string)
	if !ok || v == "" {
		return "", fmtError("falta el argumento de texto %q", key)
	}
	return v, nil
}

func reqNum(args map[string]any, key string) (float64, error) {
	v, ok := args[key].(float64)
	if !ok {
		return 0, fmtError("%q debe ser un número", key)
	}
	return v, nil
}

var tools = map[string]tool{
	"firefox_tabs": {
		build: func(a map[string]any) (string, map[string]any, error) {
			return "tabs", nil, nil
		},
		format: jsonContent,
	},

	"firefox_status": {
		build: func(a map[string]any) (string, map[string]any, error) {
			return "status", nil, nil
		},
		format: jsonContent,
	},

	"firefox_double_click": {
		build: func(a map[string]any) (string, map[string]any, error) {
			id, err := reqInt(a, "tabId")
			if err != nil {
				return "", nil, err
			}
			x, err := reqNum(a, "x")
			if err != nil {
				return "", nil, err
			}
			y, err := reqNum(a, "y")
			return "double_click", map[string]any{"tabId": id, "x": x, "y": y}, err
		},
		format: jsonContent,
	},

	"firefox_scroll": {
		build: func(a map[string]any) (string, map[string]any, error) {
			id, err := reqInt(a, "tabId")
			if err != nil {
				return "", nil, err
			}
			dx, _ := reqNum(a, "dx")
			dy, _ := reqNum(a, "dy")
			return "scroll", map[string]any{"tabId": id, "dx": dx, "dy": dy}, nil
		},
		format: jsonContent,
	},

	"firefox_open_tab": {
		build: func(a map[string]any) (string, map[string]any, error) {
			url, err := reqStr(a, "url")
			return "open", map[string]any{"url": url}, err
		},
		format: jsonContent,
	},

	"firefox_navigate": {
		build: func(a map[string]any) (string, map[string]any, error) {
			id, err := reqInt(a, "tabId")
			if err != nil {
				return "", nil, err
			}
			url, err := reqStr(a, "url")
			return "navigate", map[string]any{"tabId": id, "url": url}, err
		},
		format: jsonContent,
	},

	"firefox_close_tab": {
		build: func(a map[string]any) (string, map[string]any, error) {
			id, err := reqInt(a, "tabId")
			return "close", map[string]any{"tabId": id}, err
		},
		format: func(json.RawMessage) map[string]any { return textContent("pestaña cerrada") },
	},

	"firefox_page_text": {
		build: func(a map[string]any) (string, map[string]any, error) {
			id, err := reqInt(a, "tabId")
			args := map[string]any{"tabId": id}
			if n, ok := optInt(a, "maxChars"); ok {
				args["maxChars"] = n
			}
			return "page_text", args, err
		},
		format: func(r json.RawMessage) map[string]any {
			var v struct {
				Text string `json:"text"`
			}
			json.Unmarshal(r, &v)
			return textContent(v.Text)
		},
	},

	"firefox_read_page": {
		build: func(a map[string]any) (string, map[string]any, error) {
			id, err := reqInt(a, "tabId")
			args := map[string]any{"tabId": id}
			if f, ok := a["filter"].(string); ok {
				args["filter"] = f
			}
			if n, ok := optInt(a, "maxChars"); ok {
				args["maxChars"] = n
			}
			return "read_page", args, err
		},
		format: func(r json.RawMessage) map[string]any {
			var v struct {
				Tree  string `json:"tree"`
				Count int    `json:"count"`
			}
			json.Unmarshal(r, &v)
			return textContent(v.Tree)
		},
	},

	"firefox_find": {
		build: func(a map[string]any) (string, map[string]any, error) {
			id, err := reqInt(a, "tabId")
			if err != nil {
				return "", nil, err
			}
			q, err := reqStr(a, "query")
			args := map[string]any{"tabId": id, "query": q}
			if n, ok := optInt(a, "max"); ok {
				args["max"] = n
			}
			return "find", args, err
		},
		format: func(r json.RawMessage) map[string]any {
			var v struct {
				Matches []struct {
					Ref, Tag, Role, Name string
				} `json:"matches"`
			}
			json.Unmarshal(r, &v)
			if len(v.Matches) == 0 {
				return textContent("sin coincidencias")
			}
			var b strings.Builder
			for _, m := range v.Matches {
				b.WriteString(m.Ref + "  " + m.Tag)
				if m.Role != "" {
					b.WriteString("/" + m.Role)
				}
				if m.Name != "" {
					b.WriteString("  " + m.Name)
				}
				b.WriteString("\n")
			}
			return textContent(strings.TrimRight(b.String(), "\n"))
		},
	},

	"firefox_snapshot": {
		build: func(a map[string]any) (string, map[string]any, error) {
			id, err := reqInt(a, "tabId")
			return "snapshot", map[string]any{"tabId": id}, err
		},
		format: func(r json.RawMessage) map[string]any {
			var v struct {
				DataURL string `json:"dataUrl"`
				Width   int    `json:"width"`
				Height  int    `json:"height"`
			}
			json.Unmarshal(r, &v)
			const prefix = "data:image/png;base64,"
			data := strings.TrimPrefix(v.DataURL, prefix)
			if _, err := base64.StdEncoding.DecodeString(data); err != nil {
				return textContent("la captura no es un PNG válido")
			}
			return map[string]any{
				"content": []any{map[string]any{
					"type":     "image",
					"data":     data,
					"mimeType": "image/png",
				}},
			}
		},
	},

	"firefox_click_ref": {
		build: func(a map[string]any) (string, map[string]any, error) {
			id, err := reqInt(a, "tabId")
			if err != nil {
				return "", nil, err
			}
			ref, err := reqStr(a, "ref")
			args := map[string]any{"tabId": id, "ref": ref}
			if f, ok := a["force"].(bool); ok {
				args["force"] = f
			}
			return "click_ref", args, err
		},
		format: jsonContent,
	},

	"firefox_click_at": {
		build: func(a map[string]any) (string, map[string]any, error) {
			id, err := reqInt(a, "tabId")
			if err != nil {
				return "", nil, err
			}
			x, err := reqNum(a, "x")
			if err != nil {
				return "", nil, err
			}
			y, err := reqNum(a, "y")
			return "click_at", map[string]any{"tabId": id, "x": x, "y": y}, err
		},
		format: jsonContent,
	},

	"firefox_type": {
		build: func(a map[string]any) (string, map[string]any, error) {
			id, err := reqInt(a, "tabId")
			if err != nil {
				return "", nil, err
			}
			text, err := reqStr(a, "text")
			return "type", map[string]any{"tabId": id, "text": text}, err
		},
		format: func(json.RawMessage) map[string]any { return textContent("texto escrito") },
	},
}

// toolList es el esquema que ve el cliente. El orden importa poco; se genera
// una vez al arrancar.
var toolList = buildToolList()

func buildToolList() []map[string]any {
	tabId := map[string]any{"type": "integer", "description": "Id de la pestaña (de firefox_tabs)."}
	schema := func(props map[string]any, required ...string) map[string]any {
		return map[string]any{"type": "object", "properties": props, "required": required}
	}
	return []map[string]any{
		{
			"name":        "firefox_tabs",
			"description": "Lista las pestañas abiertas con su id, url y título.",
			"inputSchema": schema(map[string]any{}),
		},
		{
			"name":        "firefox_open_tab",
			"description": "Abre una pestaña nueva en la url dada y espera a que cargue.",
			"inputSchema": schema(map[string]any{"url": map[string]any{"type": "string"}}, "url"),
		},
		{
			"name":        "firefox_navigate",
			"description": "Lleva una pestaña existente a otra url y espera a que cargue.",
			"inputSchema": schema(map[string]any{"tabId": tabId, "url": map[string]any{"type": "string"}}, "tabId", "url"),
		},
		{
			"name":        "firefox_close_tab",
			"description": "Cierra una pestaña.",
			"inputSchema": schema(map[string]any{"tabId": tabId}, "tabId"),
		},
		{
			"name":        "firefox_page_text",
			"description": "Devuelve el texto visible de la página.",
			"inputSchema": schema(map[string]any{"tabId": tabId, "maxChars": map[string]any{"type": "integer"}}, "tabId"),
		},
		{
			"name":        "firefox_read_page",
			"description": "Árbol de accesibilidad de la página. Cada elemento con el que se puede interactuar lleva una referencia [ref_N] para usar con firefox_click_ref. Las referencias valen hasta la siguiente lectura de la misma pestaña (read_page o find las renumera).",
			"inputSchema": schema(map[string]any{
				"tabId":    tabId,
				"filter":   map[string]any{"type": "string", "enum": []string{"all", "interactive"}, "description": "'interactive' deja solo lo pulsable."},
				"maxChars": map[string]any{"type": "integer"},
			}, "tabId"),
		},
		{
			"name":        "firefox_find",
			"description": "Busca elementos cuyo texto, rol o nombre contenga la consulta. Devuelve referencias para firefox_click_ref, válidas hasta la siguiente lectura de la pestaña.",
			"inputSchema": schema(map[string]any{
				"tabId": tabId,
				"query": map[string]any{"type": "string"},
				"max":   map[string]any{"type": "integer"},
			}, "tabId", "query"),
		},
		{
			"name":        "firefox_snapshot",
			"description": "Captura PNG de la pestaña, aunque no esté seleccionada.",
			"inputSchema": schema(map[string]any{"tabId": tabId}, "tabId"),
		},
		{
			"name":        "firefox_click_ref",
			"description": "Hace clic real en una referencia de read_page o find. Falla si otro elemento la tapa, salvo que pases force=true.",
			"inputSchema": schema(map[string]any{
				"tabId": tabId,
				"ref":   map[string]any{"type": "string", "description": "Referencia tipo ref_N."},
				"force": map[string]any{"type": "boolean"},
			}, "tabId", "ref"),
		},
		{
			"name":        "firefox_click_at",
			"description": "Hace clic real en coordenadas CSS del viewport e informa de qué había bajo el punto.",
			"inputSchema": schema(map[string]any{
				"tabId": tabId,
				"x":     map[string]any{"type": "number"},
				"y":     map[string]any{"type": "number"},
			}, "tabId", "x", "y"),
		},
		{
			"name":        "firefox_type",
			"description": "Escribe texto con el teclado sobre el elemento que tiene el foco.",
			"inputSchema": schema(map[string]any{"tabId": tabId, "text": map[string]any{"type": "string"}}, "tabId", "text"),
		},
		{
			"name":        "firefox_double_click",
			"description": "Doble clic real en coordenadas CSS del viewport.",
			"inputSchema": schema(map[string]any{"tabId": tabId, "x": map[string]any{"type": "number"}, "y": map[string]any{"type": "number"}}, "tabId", "x", "y"),
		},
		{
			"name":        "firefox_scroll",
			"description": "Desplaza la página dx/dy píxeles.",
			"inputSchema": schema(map[string]any{"tabId": tabId, "dx": map[string]any{"type": "number"}, "dy": map[string]any{"type": "number"}}, "tabId"),
		},
		{
			"name":        "firefox_status",
			"description": "Estado de seguridad del agente: activo o detenido, modo, dominios aprobados y si usa contenedor.",
			"inputSchema": schema(map[string]any{}),
		},
	}
}
