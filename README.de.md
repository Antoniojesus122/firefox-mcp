# firefox-mcp

<p align="center">
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/-English-555?style=flat-square"></a>
  <a href="README.es.md"><img alt="Español" src="https://img.shields.io/badge/-Espa%C3%B1ol-555?style=flat-square"></a>
  <a href="README.fr.md"><img alt="Français" src="https://img.shields.io/badge/-Fran%C3%A7ais-555?style=flat-square"></a>
  <img alt="Deutsch" src="https://img.shields.io/badge/-Deutsch-1f6feb?style=flat-square">
  <a href="README.it.md"><img alt="Italiano" src="https://img.shields.io/badge/-Italiano-555?style=flat-square"></a>
  <a href="README.pt-BR.md"><img alt="Português (BR)" src="https://img.shields.io/badge/-Portugu%C3%AAs%20%28BR%29-555?style=flat-square"></a>
</p>

Ein [MCP](https://modelcontextprotocol.io)-Server und eine Firefox-Erweiterung, mit denen ein MCP-Client den
Browser steuern kann: Seiten lesen, navigieren, klicken, Formulare ausfüllen, Screenshots aufnehmen sowie
Konsole und Netzwerk eines Tabs auslesen. Dazu kommt eine Sicherheitsschicht: Freigabe pro Domain,
Not-Aus-Schalter, Maskierung von Geheimnissen und ein isolierter Container für die Sitzung des Agenten.

Die Idee ähnelt den Erweiterungen, die einen Assistenten Chrome steuern lassen, aber für Firefox und mit dem
„Gehirn" außerhalb des Browsers: Der MCP-Client (etwa ein Agentenwerkzeug für die Kommandozeile) läuft auf
deinem Rechner, und die Erweiterung ist nur die Hand.

## Schnellstart

Vorerst nur Windows. Du brauchst **Firefox Developer Edition** oder **Nightly** (für echte Klicks; das
normale Firefox weicht auf synthetische Ereignisse aus) und **Python 3** von
[python.org](https://www.python.org/).

Im Stammverzeichnis des Repositorys, in PowerShell:

```powershell
scripts\instalar.ps1     # registriert den nativen Host und richtet ein Firefox-Profil ein
scripts\abrir.ps1        # öffnet Firefox mit diesem Profil und der Erweiterung
```

Trage danach den MCP-Server in deinem Client ein und verweise auf `py/mcp_server.py`. Falls PowerShell die
Skripte nicht ausführt, erlaube sie einmalig für deinen Benutzer mit
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. Die vollständigen Schritte stehen in
[docs/instalacion.md](docs/instalacion.md).

## Funktionsweise

```
MCP-Client  ->  MCP-Server (stdio)  ->  Named Pipe  ->  nativer Host  ->  Firefox-Erweiterung
```

- Der **MCP-Server** übersetzt die Aufrufe des Clients in Befehle und schickt sie über eine Windows-**Named
  Pipe**, ganz ohne Netzwerk-Port.
- Den **Native-Messaging-Host** startet Firefox beim Laden der Erweiterung; er verbindet Pipe und
  Erweiterung.
- Die **Erweiterung** führt die Befehle im Tab aus.

Es gibt zwei gleichwertige Implementierungen von Server und Host, eine wird gewählt:

- **Python** (`py/`): nichts zu kompilieren, es läuft im Interpreter von python.org. Das ist der
  Standardweg und verhindert, dass Windows Smart App Control unsignierte Binärdateien blockiert.
- **Go** (`cmd/`, `internal/`): kompilierte Binärdateien, ohne Drittabhängigkeiten außer
  `golang.org/x/sys`.

Echte Klicks und Tastatureingaben (Ereignisse mit `isTrusted=true`) kommen von einem *WebExtension
Experiment*, das nur in Firefox Developer Edition oder Nightly lädt. Ohne es weicht die Erweiterung auf
synthetische Ereignisse aus, die für die meisten Seiten genügen; das ist die über AMO signierbare Variante
(siehe [docs/publicar-amo.md](docs/publicar-amo.md)).

Vorerst ist es **nur Windows** (die Named Pipe nutzt die Windows-API).

## Sprache

Die Erweiterung zeigt ihre Texte in der Sprache von Firefox (Englisch, Spanisch, Französisch, Deutsch,
Italienisch und brasilianisches Portugiesisch; alles andere fällt auf Englisch zurück).
`scripts/instalar.ps1` belässt das Profil in der Systemsprache und lädt bei Bedarf das passende
Mozilla-Sprachpaket herunter.

## Werkzeuge

Der Server stellt diese MCP-Werkzeuge bereit:

| Werkzeug | Zweck |
| --- | --- |
| `firefox_tabs` / `firefox_status` | Tabs auflisten / Sicherheitsstatus des Agenten. |
| `firefox_open_tab` / `firefox_navigate` / `firefox_close_tab` | Tabs öffnen, navigieren, schließen. |
| `firefox_page_text` / `firefox_read_page` | Sichtbarer Text / Barrierefreiheitsbaum mit Referenzen. |
| `firefox_find` | Elemente nach Text, Rolle oder Name suchen. |
| `firefox_snapshot` | PNG-Screenshot (mit maskierten Geheimnissen). |
| `firefox_click_ref` / `firefox_click_at` | Auf eine Referenz oder Koordinaten klicken. |
| `firefox_double_click` / `firefox_right_click` | Doppelklick / Rechtsklick. |
| `firefox_type` | Über die Tastatur schreiben (auch Zeit-, Datumsfelder u. Ä.). |
| `firefox_drag` / `firefox_dnd` / `firefox_scroll` | Ziehen, HTML5-Drag-and-drop, scrollen. |
| `firefox_download` | Eine URL herunterladen, mit Bestätigung. |
| `firefox_network` / `firefox_console` | Netzwerk und Konsole des Tabs. |

## Sicherheit

Zwei Schichten, jede in einem Prozess, den der Seiteninhalt nicht erreichen kann:

- Der **Host** setzt die harte Richtlinie aus `policy.json` durch: Nur-Lese-Modus und Domain-Whitelist.
- Die **Erweiterung** trägt den Not-Aus-Schalter mit Anzeige in der Leiste, die menschliche Freigabe pro
  Domain, den Sitzungsablauf, den isolierten Container und die Maskierung von Geheimnissen (Passwörter,
  Karten und Schlüssel), bevor Text oder Screenshots den Browser verlassen.

Einzelheiten in [docs/seguridad.md](docs/seguridad.md).

## Oberfläche

- Ein **Zeiger** des Agenten (ein Pfeil, der zur Stelle der Aktion gleitet, mit einer Welle bei jedem Klick),
  damit du siehst, was er tut.
- Ein **Seitenpanel** mit Status, Not-Aus-Schalter, den freigegebenen Domains und einem Aktivitätsprotokoll.

## Aufbau

- `extension/` - die Erweiterung. `experiments/input/` ist der privilegierte Code für echte Klicks und
  Tastatureingaben.
- `py/` - MCP-Server und Host in Python.
- `cmd/`, `internal/` - dieselbe Funktion in Go.
- `scripts/` - Installation und Hilfsskripte (PowerShell).
- `ejemplos/` - HTML-Seiten zum Testen.
- `docs/` - Architektur, Sicherheit, Installation und Veröffentlichung.

## Lizenz

MIT. Siehe [LICENSE](LICENSE).
