# firefox-mcp

<p align="center">
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/-English-555?style=flat-square"></a>
  <a href="README.es.md"><img alt="Español" src="https://img.shields.io/badge/-Espa%C3%B1ol-555?style=flat-square"></a>
  <a href="README.fr.md"><img alt="Français" src="https://img.shields.io/badge/-Fran%C3%A7ais-555?style=flat-square"></a>
  <a href="README.de.md"><img alt="Deutsch" src="https://img.shields.io/badge/-Deutsch-555?style=flat-square"></a>
  <a href="README.it.md"><img alt="Italiano" src="https://img.shields.io/badge/-Italiano-555?style=flat-square"></a>
  <img alt="Português (BR)" src="https://img.shields.io/badge/-Portugu%C3%AAs%20%28BR%29-1f6feb?style=flat-square">
</p>

Um servidor [MCP](https://modelcontextprotocol.io) e uma extensão do Firefox que permitem a um cliente MCP
controlar o navegador: ler páginas, navegar, clicar, preencher formulários, tirar capturas e ler o console e
a rede de uma aba. Com uma camada de segurança por cima: permissão por domínio, interruptor, ocultação de
segredos e um contêiner isolado para a sessão do agente.

A ideia é parecida com as extensões que deixam um assistente controlar o Chrome, mas para o Firefox e com o
"cérebro" fora do navegador: o cliente MCP (por exemplo, uma ferramenta de agente de linha de comando) roda
na sua máquina e a extensão é só as mãos.

## Início rápido

Por enquanto, só Windows. É preciso **Firefox Developer Edition** ou **Nightly** (para o clique real; o
Firefox comum recai em eventos sintéticos) e **Python 3** de [python.org](https://www.python.org/).

Na raiz do repositório, no PowerShell:

```powershell
scripts\instalar.ps1     # registra o host nativo e prepara um perfil do Firefox
scripts\abrir.ps1        # abre o Firefox com esse perfil e a extensão
```

Depois, registre o servidor MCP no seu cliente apontando para `py/mcp_server.py`. Se o PowerShell recusar
executar os scripts, libere-os para o seu usuário uma vez com
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. Os passos completos estão em
[docs/instalacion.md](docs/instalacion.md).

## Como funciona

```
cliente MCP  ->  servidor MCP (stdio)  ->  named pipe  ->  host nativo  ->  extensão do Firefox
```

- O **servidor MCP** traduz as chamadas do cliente em comandos e as envia por uma **named pipe** do Windows,
  sem abrir nenhuma porta de rede.
- O **host de native messaging** é iniciado pelo Firefox quando ele carrega a extensão, e faz a ponte entre
  a pipe e a extensão.
- A **extensão** executa os comandos na aba.

Há duas implementações equivalentes do servidor e do host, escolhe-se uma:

- **Python** (`py/`): nada a compilar, roda no interpretador de python.org. É o caminho padrão e evita que o
  Windows Smart App Control bloqueie binários não assinados.
- **Go** (`cmd/`, `internal/`): binários compilados, sem dependências de terceiros além de
  `golang.org/x/sys`.

O clique e o teclado "de verdade" (eventos com `isTrusted=true`) vêm de um *WebExtension Experiment*, que só
carrega no Firefox Developer Edition ou Nightly. Sem ele, a extensão recai em eventos sintéticos,
suficientes para a maioria dos sites; essa é a versão assinável pela AMO (veja
[docs/publicar-amo.md](docs/publicar-amo.md)).

Por enquanto é **só Windows** (a named pipe usa a API do Windows).

## Idioma

A extensão mostra seus textos no idioma do Firefox (inglês, espanhol, francês, alemão, italiano e português
do Brasil; com qualquer outro recai no inglês). `scripts/instalar.ps1` deixa o perfil no idioma do sistema
e, se necessário, baixa o pacote de idioma da Mozilla correspondente.

## Ferramentas

O servidor expõe estas ferramentas MCP:

| Ferramenta | O que faz |
| --- | --- |
| `firefox_tabs` / `firefox_status` | Lista as abas / estado de segurança do agente. |
| `firefox_open_tab` / `firefox_navigate` / `firefox_close_tab` | Abrir, navegar, fechar abas. |
| `firefox_page_text` / `firefox_read_page` | Texto visível / árvore de acessibilidade com referências. |
| `firefox_find` | Procurar elementos por texto, papel ou nome. |
| `firefox_snapshot` | Captura PNG (com os segredos cobertos). |
| `firefox_click_ref` / `firefox_click_at` | Clicar em uma referência ou em coordenadas. |
| `firefox_double_click` / `firefox_right_click` | Clique duplo / clique direito. |
| `firefox_type` | Escrever com o teclado (campos de hora, data, etc. incluídos). |
| `firefox_drag` / `firefox_dnd` / `firefox_scroll` | Arrastar, drag-and-drop HTML5, rolar. |
| `firefox_download` | Baixar uma URL, com confirmação. |
| `firefox_network` / `firefox_console` | Rede e console da aba. |

## Segurança

Duas camadas, cada uma em um processo que o conteúdo das páginas não pode tocar:

- O **host** aplica a política rígida de `policy.json`: modo somente leitura e lista de domínios permitidos.
- A **extensão** carrega o interruptor com indicador na barra, o consentimento humano por domínio, a
  expiração da sessão, o contêiner isolado e a ocultação de segredos (senhas, cartões e chaves) antes que o
  texto ou as capturas saiam do navegador.

Detalhes em [docs/seguridad.md](docs/seguridad.md).

## Interface

- Um **ponteiro** do agente (uma seta que desliza até o ponto da ação, com uma onda a cada clique) para ver
  o que ele faz.
- Um **painel lateral** com o estado, o interruptor, os domínios permitidos e um registro da atividade.

## Estrutura

- `extension/` - a extensão. `experiments/input/` é o código privilegiado do clique e do teclado reais.
- `py/` - servidor MCP e host em Python.
- `cmd/`, `internal/` - a mesma funcionalidade em Go.
- `scripts/` - instalação e utilitários (PowerShell).
- `ejemplos/` - páginas HTML para testar.
- `docs/` - arquitetura, segurança, instalação e publicação.

## Licença

MIT. Veja [LICENSE](LICENSE).
