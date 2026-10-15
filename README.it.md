# firefox-mcp

<p align="center">
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/-English-555?style=flat-square"></a>
  <a href="README.es.md"><img alt="Español" src="https://img.shields.io/badge/-Espa%C3%B1ol-555?style=flat-square"></a>
  <a href="README.fr.md"><img alt="Français" src="https://img.shields.io/badge/-Fran%C3%A7ais-555?style=flat-square"></a>
  <a href="README.de.md"><img alt="Deutsch" src="https://img.shields.io/badge/-Deutsch-555?style=flat-square"></a>
  <img alt="Italiano" src="https://img.shields.io/badge/-Italiano-1f6feb?style=flat-square">
  <a href="README.pt-BR.md"><img alt="Português (BR)" src="https://img.shields.io/badge/-Portugu%C3%AAs%20%28BR%29-555?style=flat-square"></a>
</p>

Un server [MCP](https://modelcontextprotocol.io) e un'estensione per Firefox che permettono a un client MCP
di guidare il browser: leggere pagine, navigare, fare clic, compilare moduli, catturare schermate e leggere
la console e la rete di una scheda. Con sopra uno strato di sicurezza: autorizzazione per dominio,
interruttore, mascheramento dei segreti e un contenitore isolato per la sessione dell'agente.

L'idea è simile alle estensioni che lasciano a un assistente il controllo di Chrome, ma per Firefox e con il
"cervello" fuori dal browser: il client MCP (per esempio uno strumento d'agente da riga di comando) gira sul
tuo computer e l'estensione è solo le mani.

## Avvio rapido

Per ora solo Windows. Servono **Firefox Developer Edition** o **Nightly** (per il clic reale; il Firefox
normale ripiega su eventi sintetici) e **Python 3** da [python.org](https://www.python.org/).

Dalla radice del repository, in PowerShell:

```powershell
scripts\instalar.ps1     # registra l'host nativo e prepara un profilo di Firefox
scripts\abrir.ps1        # apre Firefox con quel profilo e l'estensione
```

Poi registra il server MCP nel tuo client puntandolo a `py/mcp_server.py`. Se PowerShell si rifiuta di
eseguire gli script, abilitali per il tuo utente una volta con
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. I passi completi sono in
[docs/instalacion.md](docs/instalacion.md).

## Come funziona

```
client MCP  ->  server MCP (stdio)  ->  pipe con nome  ->  host nativo  ->  estensione di Firefox
```

- Il **server MCP** traduce le chiamate del client in comandi e le invia tramite una **pipe con nome** di
  Windows, senza aprire alcuna porta di rete.
- L'**host di native messaging** viene avviato da Firefox al caricamento dell'estensione e fa da ponte tra
  la pipe e l'estensione.
- L'**estensione** esegue i comandi nella scheda.

Ci sono due implementazioni equivalenti del server e dell'host, se ne sceglie una:

- **Python** (`py/`): niente da compilare, lo esegue l'interprete di python.org. È la via predefinita ed
  evita che Windows Smart App Control blocchi i binari non firmati.
- **Go** (`cmd/`, `internal/`): binari compilati, senza dipendenze di terze parti oltre a
  `golang.org/x/sys`.

Il clic e la tastiera "reali" (eventi con `isTrusted=true`) arrivano da un *WebExtension Experiment*, che si
carica solo in Firefox Developer Edition o Nightly. Senza di esso l'estensione ripiega su eventi sintetici,
sufficienti per la maggior parte dei siti; è la versione firmabile da AMO (vedi
[docs/publicar-amo.md](docs/publicar-amo.md)).

Per ora è **solo Windows** (la pipe con nome usa l'API di Windows).

## Lingua

L'estensione mostra i suoi testi nella lingua di Firefox (inglese, spagnolo, francese, tedesco, italiano e
portoghese del Brasile; con qualunque altra ripiega sull'inglese). `scripts/instalar.ps1` lascia il profilo
nella lingua del sistema e, se serve, scarica il pacchetto lingua di Mozilla corrispondente.

## Strumenti

Il server espone questi strumenti MCP:

| Strumento | Cosa fa |
| --- | --- |
| `firefox_tabs` / `firefox_status` | Elenca le schede / stato di sicurezza dell'agente. |
| `firefox_open_tab` / `firefox_navigate` / `firefox_close_tab` | Aprire, navigare, chiudere schede. |
| `firefox_page_text` / `firefox_read_page` | Testo visibile / albero di accessibilità con riferimenti. |
| `firefox_find` | Cercare elementi per testo, ruolo o nome. |
| `firefox_snapshot` | Schermata PNG (con i segreti coperti). |
| `firefox_click_ref` / `firefox_click_at` | Clic su un riferimento o su coordinate. |
| `firefox_double_click` / `firefox_right_click` | Doppio clic / clic destro. |
| `firefox_type` | Scrivere con la tastiera (anche campi ora, data, ecc.). |
| `firefox_drag` / `firefox_dnd` / `firefox_scroll` | Trascinare, drag-and-drop HTML5, scorrere. |
| `firefox_download` | Scaricare un URL, con conferma. |
| `firefox_network` / `firefox_console` | Rete e console della scheda. |

## Sicurezza

Due strati, ciascuno in un processo che il contenuto delle pagine non può toccare:

- L'**host** applica la politica rigida di `policy.json`: modalità sola lettura ed elenco di domini
  consentiti.
- L'**estensione** porta l'interruttore con indicatore nella barra, il consenso umano per dominio, la
  scadenza della sessione, il contenitore isolato e il mascheramento dei segreti (password, carte e chiavi)
  prima che il testo o le schermate lascino il browser.

Dettagli in [docs/seguridad.md](docs/seguridad.md).

## Interfaccia

- Un **puntatore** dell'agente (una freccia che scivola fino al punto dell'azione, con un'onda a ogni clic)
  per vedere cosa fa.
- Un **pannello laterale** con lo stato, l'interruttore, i domini autorizzati e un registro dell'attività.

## Struttura

- `extension/` - l'estensione. `experiments/input/` è il codice privilegiato del clic e della tastiera
  reali.
- `py/` - server MCP e host in Python.
- `cmd/`, `internal/` - le stesse funzioni in Go.
- `scripts/` - installazione e utilità (PowerShell).
- `ejemplos/` - pagine HTML per le prove.
- `docs/` - architettura, sicurezza, installazione e pubblicazione.

## Licenza

MIT. Vedi [LICENSE](LICENSE).
