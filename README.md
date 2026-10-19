# firefox-mcp
[![M8ven Score](https://m8ven.ai/badge/mcp/antoniojesus122-firefox-mcp-sm83hx?v=789dcd4f5fb3a17afa66819fc0b2c1f9)](https://m8ven.ai/mcp/antoniojesus122-firefox-mcp-sm83hx?s=readme)

<p align="center">
  <img alt="English" src="https://img.shields.io/badge/-English-1f6feb?style=flat-square">
  <a href="README.es.md"><img alt="Español" src="https://img.shields.io/badge/-Espa%C3%B1ol-555?style=flat-square"></a>
  <a href="README.fr.md"><img alt="Français" src="https://img.shields.io/badge/-Fran%C3%A7ais-555?style=flat-square"></a>
  <a href="README.de.md"><img alt="Deutsch" src="https://img.shields.io/badge/-Deutsch-555?style=flat-square"></a>
  <a href="README.it.md"><img alt="Italiano" src="https://img.shields.io/badge/-Italiano-555?style=flat-square"></a>
  <a href="README.pt-BR.md"><img alt="Português (BR)" src="https://img.shields.io/badge/-Portugu%C3%AAs%20%28BR%29-555?style=flat-square"></a>
</p>

An [MCP](https://modelcontextprotocol.io) server and a Firefox extension that let an MCP client drive the
browser: read pages, navigate, click, fill forms, take screenshots and read a tab's console and network. It
ships with a security layer: per-domain consent, a kill switch, secret masking and an isolated container for
the agent's session.

The idea is close to the extensions that let an assistant control Chrome, but for Firefox and with the
"brain" outside the browser: the MCP client (a command-line agent tool, for instance) runs on your machine
and the extension is only the hands.

## Quick start

Windows only, for now. You need **Firefox Developer Edition** or **Nightly** (for real clicks; regular
Firefox falls back to synthetic events) and **Python 3** from [python.org](https://www.python.org/).

From the repository root, in PowerShell:

```powershell
scripts\instalar.ps1     # registers the native host and prepares a Firefox profile
scripts\abrir.ps1        # opens Firefox with that profile and the extension
```

Then register the MCP server in your client, pointing it at `py/mcp_server.py`. If PowerShell refuses to run
the scripts, allow them for your user once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. The
full steps are in [docs/instalacion.md](docs/instalacion.md).

## How it works

```
MCP client  ->  MCP server (stdio)  ->  named pipe  ->  native host  ->  Firefox extension
```

- The **MCP server** turns the client's calls into commands and sends them over a Windows **named pipe**,
  opening no network port.
- Firefox starts the **native messaging host** when it loads the extension; the host bridges the pipe and
  the extension.
- The **extension** runs the commands in the tab.

There are two equivalent implementations of the server and the host; pick one:

- **Python** (`py/`): nothing to compile, it runs under the python.org interpreter. This is the default and
  it keeps Windows Smart App Control from blocking unsigned binaries.
- **Go** (`cmd/`, `internal/`): compiled binaries, with no third-party dependencies beyond
  `golang.org/x/sys`.

Real clicks and keystrokes (events with `isTrusted=true`) come from a *WebExtension Experiment*, which only
loads in Firefox Developer Edition or Nightly. Without it the extension falls back to synthetic events,
enough for most sites; that is the AMO-signable build (see [docs/publicar-amo.md](docs/publicar-amo.md)).

For now it is **Windows only** (the named pipe uses the Windows API).

## Language

The extension shows its text in Firefox's language (English, Spanish, French, German, Italian and Brazilian
Portuguese; anything else falls back to English). `scripts/instalar.ps1` leaves the profile in the system
language and, when needed, downloads the matching Mozilla language pack.

## Tools

The server exposes these MCP tools:

| Tool | What it does |
| --- | --- |
| `firefox_tabs` / `firefox_status` | List tabs / agent security state. |
| `firefox_open_tab` / `firefox_navigate` / `firefox_close_tab` | Open, navigate, close tabs. |
| `firefox_page_text` / `firefox_read_page` | Visible text / accessibility tree with references. |
| `firefox_find` | Find elements by text, role or name. |
| `firefox_snapshot` | PNG screenshot (with secrets masked). |
| `firefox_click_ref` / `firefox_click_at` | Click a reference or coordinates. |
| `firefox_double_click` / `firefox_right_click` | Double click / right click. |
| `firefox_type` | Type with the keyboard (time, date and similar fields included). |
| `firefox_drag` / `firefox_dnd` / `firefox_scroll` | Drag, HTML5 drag-and-drop, scroll. |
| `firefox_download` | Download a URL, with confirmation. |
| `firefox_network` / `firefox_console` | A tab's network and console. |

## Security

Two layers, each in a process that web content cannot reach:

- The **host** enforces the hard policy from `policy.json`: read-only mode and a domain allowlist.
- The **extension** carries the kill switch with a toolbar indicator, per-domain human consent, session
  expiry, the isolated container and secret masking (passwords, cards and keys) before any text or
  screenshot leaves the browser.

Details in [docs/seguridad.md](docs/seguridad.md).

## Interface

- An agent **pointer** (an arrow that glides to the spot of each action, with a ripple on every click) so
  you can see what it is doing.
- A **side panel** with the status, the kill switch, the allowed domains and an activity log.

## Project layout

- `extension/` - the extension. `experiments/input/` is the privileged code behind real clicks and
  keystrokes.
- `py/` - MCP server and host in Python.
- `cmd/`, `internal/` - the same functionality in Go.
- `scripts/` - installation and utilities (PowerShell).
- `ejemplos/` - HTML pages for testing.
- `docs/` - architecture, security, installation and publishing.

## License

MIT. See [LICENSE](LICENSE).
