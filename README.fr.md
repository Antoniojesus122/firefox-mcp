# firefox-mcp

<p align="center">
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/-English-555?style=flat-square"></a>
  <a href="README.es.md"><img alt="Español" src="https://img.shields.io/badge/-Espa%C3%B1ol-555?style=flat-square"></a>
  <img alt="Français" src="https://img.shields.io/badge/-Fran%C3%A7ais-1f6feb?style=flat-square">
  <a href="README.de.md"><img alt="Deutsch" src="https://img.shields.io/badge/-Deutsch-555?style=flat-square"></a>
  <a href="README.it.md"><img alt="Italiano" src="https://img.shields.io/badge/-Italiano-555?style=flat-square"></a>
  <a href="README.pt-BR.md"><img alt="Português (BR)" src="https://img.shields.io/badge/-Portugu%C3%AAs%20%28BR%29-555?style=flat-square"></a>
</p>

Un serveur [MCP](https://modelcontextprotocol.io) et une extension Firefox qui permettent à un client MCP de
piloter le navigateur : lire des pages, naviguer, cliquer, remplir des formulaires, prendre des captures et
lire la console et le réseau d'un onglet. Le tout avec une couche de sécurité : autorisation par domaine,
interrupteur d'arrêt, masquage des secrets et un conteneur isolé pour la session de l'agent.

L'idée est proche des extensions qui laissent un assistant contrôler Chrome, mais pour Firefox et avec le
« cerveau » en dehors du navigateur : le client MCP (par exemple un outil d'agent en ligne de commande)
tourne sur votre machine et l'extension n'est que les mains.

## Démarrage rapide

Pour l'instant, Windows uniquement. Il faut **Firefox Developer Edition** ou **Nightly** (pour le clic
réel ; le Firefox normal se rabat sur des événements synthétiques) et **Python 3** de
[python.org](https://www.python.org/).

Depuis la racine du dépôt, dans PowerShell :

```powershell
scripts\instalar.ps1     # enregistre l'hôte natif et prépare un profil Firefox
scripts\abrir.ps1        # ouvre Firefox avec ce profil et l'extension
```

Ensuite, déclarez le serveur MCP dans votre client en le pointant vers `py/mcp_server.py`. Si PowerShell
refuse d'exécuter les scripts, autorisez-les pour votre utilisateur une fois avec
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. Les étapes complètes sont dans
[docs/instalacion.md](docs/instalacion.md).

## Fonctionnement

```
client MCP  ->  serveur MCP (stdio)  ->  tube nommé  ->  hôte natif  ->  extension Firefox
```

- Le **serveur MCP** traduit les appels du client en commandes et les envoie par un **tube nommé** de
  Windows, sans ouvrir aucun port réseau.
- L'**hôte de native messaging** est lancé par Firefox au chargement de l'extension ; il fait le pont entre
  le tube et l'extension.
- L'**extension** exécute les commandes dans l'onglet.

Il existe deux implémentations équivalentes du serveur et de l'hôte, au choix :

- **Python** (`py/`) : rien à compiler, c'est l'interpréteur de python.org qui l'exécute. C'est la voie par
  défaut et elle évite que Windows Smart App Control bloque les binaires non signés.
- **Go** (`cmd/`, `internal/`) : des binaires compilés, sans dépendances tierces au-delà de
  `golang.org/x/sys`.

Le clic et la frappe « réels » (événements avec `isTrusted=true`) proviennent d'un *WebExtension
Experiment*, qui ne se charge que dans Firefox Developer Edition ou Nightly. Sans lui, l'extension se rabat
sur des événements synthétiques, suffisants pour la plupart des sites ; c'est la version signable par AMO
(voir [docs/publicar-amo.md](docs/publicar-amo.md)).

Pour l'instant, c'est **Windows uniquement** (le tube nommé utilise l'API Windows).

## Langue

L'extension affiche ses textes dans la langue de Firefox (anglais, espagnol, français, allemand, italien et
portugais du Brésil ; tout le reste se rabat sur l'anglais). `scripts/instalar.ps1` laisse le profil dans la
langue du système et, au besoin, télécharge le pack de langue Mozilla correspondant.

## Outils

Le serveur expose ces outils MCP :

| Outil | Rôle |
| --- | --- |
| `firefox_tabs` / `firefox_status` | Liste les onglets / état de sécurité de l'agent. |
| `firefox_open_tab` / `firefox_navigate` / `firefox_close_tab` | Ouvrir, naviguer, fermer des onglets. |
| `firefox_page_text` / `firefox_read_page` | Texte visible / arbre d'accessibilité avec références. |
| `firefox_find` | Chercher des éléments par texte, rôle ou nom. |
| `firefox_snapshot` | Capture PNG (secrets masqués). |
| `firefox_click_ref` / `firefox_click_at` | Cliquer sur une référence ou des coordonnées. |
| `firefox_double_click` / `firefox_right_click` | Double-clic / clic droit. |
| `firefox_type` | Saisir au clavier (champs heure, date, etc. compris). |
| `firefox_drag` / `firefox_dnd` / `firefox_scroll` | Glisser, glisser-déposer HTML5, faire défiler. |
| `firefox_download` | Télécharger une URL, avec confirmation. |
| `firefox_network` / `firefox_console` | Réseau et console de l'onglet. |

## Sécurité

Deux couches, chacune dans un processus que le contenu des pages ne peut pas atteindre :

- L'**hôte** applique la politique stricte de `policy.json` : mode lecture seule et liste blanche de
  domaines.
- L'**extension** porte l'interrupteur d'arrêt avec un indicateur dans la barre, le consentement humain par
  domaine, l'expiration de la session, le conteneur isolé et le masquage des secrets (mots de passe, cartes
  et clés) avant que le texte ou les captures ne quittent le navigateur.

Détails dans [docs/seguridad.md](docs/seguridad.md).

## Interface

- Un **pointeur** de l'agent (une flèche qui glisse jusqu'au point de l'action, avec une onde à chaque clic)
  pour voir ce qu'il fait.
- Un **panneau latéral** avec l'état, l'interrupteur, les domaines autorisés et un journal d'activité.

## Structure

- `extension/` - l'extension. `experiments/input/` est le code privilégié du clic et de la frappe réels.
- `py/` - serveur MCP et hôte en Python.
- `cmd/`, `internal/` - les mêmes fonctions en Go.
- `scripts/` - installation et utilitaires (PowerShell).
- `ejemplos/` - pages HTML pour les tests.
- `docs/` - architecture, sécurité, installation et publication.

## Licence

MIT. Voir [LICENSE](LICENSE).
