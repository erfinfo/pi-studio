# pi-studio

Une interface web pour [Pi](https://pi.dev) (le harness d'agent minimal), distribuée comme package pi. Discutez avec pi depuis votre navigateur : streaming, slash commands, sélecteurs de modèle et de thinking, gestion des sessions et panneau d'artifacts — aux couleurs de pi.

> 🇬🇧 [English version](README.md)

![Chat pi-studio en mode dark](docs/screenshots/02-chat-complete-dark.png)

## Fonctionnalités

- **Chat complet** avec streaming (`text_delta`, blocs de réflexion repliables, cartes d'appels d'outils)
- **Slash commands** — `/` ouvre l'autocomplete (`pi.getCommands()`) ; `/skill:*` et les templates de prompts sont expansés par le bridge ; les commandes d'extensions tierces doivent être lancées dans le TUI (limitation v1)
- **Sélecteur de modèle** (tous les modèles authentifiés) et de **thinking level** (`off` → `max`)
- **Sessions** : liste des sessions passées, reprise, nouvelle, fork depuis un message
- **Outil ask dans le navigateur** — avec le fork pi-ask-tool web-aware, les questions structurées se répondent dans l'UI web
- **Panneau Artifacts** : fichiers touchés par pi (write/edit/read), aperçu markdown, diffs des edits, aperçu d'images
- **Thèmes dark / light** selon la palette [pi.dev](https://pi.dev), logo pi
- **Interface i18n-ready** (locale française incluse)
- **Sécurité locale** : token aléatoire dans l'URL à chaque démarrage + vérification `Origin` du WebSocket

## Installation

Prérequis : Pi, Git et Node.js 20+.

### Linux / macOS (recommandé)

Téléchargez et inspectez l'installateur avant de l'exécuter :

```bash
curl -fsSL https://raw.githubusercontent.com/erfinfo/pi-studio/main/scripts/install.sh -o install-pi-studio.sh
less install-pi-studio.sh
chmod +x install-pi-studio.sh
./install-pi-studio.sh
```

### Windows PowerShell

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/erfinfo/pi-studio/main/scripts/install.ps1 -OutFile install-pi-studio.ps1
Get-Content .\install-pi-studio.ps1
powershell -ExecutionPolicy Bypass -File .\install-pi-studio.ps1
```

Options disponibles :

| Option | Description |
|---|---|
| `-h`, `--help` | Affiche l'aide intégrée |
| `--ref REF` | Installe une branche, un tag ou un commit (`main` par défaut) |
| `--no-ask` | N'installe pas l'extension Ask web-aware |
| `--launch` | Lance Pi et `/webui` après l'installation |
| `--port PORT` | Choisit le port du serveur web (4173 par défaut) |
| `--lan` | Bind sur `0.0.0.0` — lire l'avertissement de sécurité plus bas |

Exemple :

```bash
./install-pi-studio.sh --launch --port 8080
```

### Installation manuelle

```bash
# Optionnel, mais requis pour les dialogs Ask dans le navigateur
pi install git:github.com/erfinfo/pi-ask-tool@main

pi install git:github.com/erfinfo/pi-studio@main
```

## Utilisation

Dans pi :

```
/webui                # démarre le serveur (127.0.0.1:4173) et ouvre le navigateur
/webui --port 8080    # port personnalisé
/webui --lan          # bind 0.0.0.0 — partagez l'URL COMPLÈTE affichée (elle contient le token)
/webui --no-open      # ne pas ouvrir le navigateur
/studio               # alias
```

**Questions interactives (outil ask)** : avec le fork web-aware [erfinfo/pi-ask-tool](https://github.com/erfinfo/pi-ask-tool), les questions `ask` s'affichent directement dans l'interface web (la question est publiée sur le bus d'événements partagé de pi ; le TUI et le web répondent en compétition — le premier gagne). Les dialogs des autres extensions (permissions, etc.) restent dans le TUI.

## Captures d'écran

| Agent au travail (dark) | Recherche de modèle |
|---|---|
| ![Agent en streaming, thème dark](docs/screenshots/01-chat-streaming-dark.png) | ![Menu de recherche des modèles](docs/screenshots/03-model-search.png) |

| Dialog Ask | Aperçu d'un Artifact |
|---|---|
| ![Dialog Ask dans le navigateur](docs/screenshots/04-ask-dialog.png) | ![Aperçu Markdown rendu](docs/screenshots/05-artifacts-preview.png) |

![Thème light](docs/screenshots/06-light-theme.png)

Toutes les captures proviennent d'un projet de démonstration isolé et ne contiennent aucune donnée de session privée.

## Modèle de sécurité

- Bind `127.0.0.1` par défaut. `--lan` bind `0.0.0.0`.
- Un token aléatoire est généré à chaque démarrage et inclus dans l'URL ouverte automatiquement — rien à taper, mais les pages web que vous visitez ne peuvent pas piloter l'agent (les navigateurs n'appliquent pas la same-origin policy aux WebSockets ; le token + la vérification `Origin` ferment cette brèche).
- Toute personne ayant l'URL complète a le contrôle total de l'agent (bash, fichiers). Traitez l'URL comme un mot de passe, surtout avec `--lan`.

## Compatibilité

Testé avec pi **0.81.1** (API pré-1.0). Node ≥ 20.

## Développement

```bash
git clone https://github.com/erfinfo/pi-studio
cd pi-studio
npm install
cd web && npm install && npm run build   # construit web/dist (commité)
cd ..

# essai sans installation :
pi -e ./pi-studio
# puis dans pi : /webui
```

- `npm run typecheck` — types backend
- `npm test` — tests unitaires vitest
- `web/dist` est **commité** (pi installe les packages avec `npm install --omit=dev`) ; la CI vérifie qu'il est à jour

## Fonctionnement

Le package enregistre une commande `/webui`. Celle-ci démarre un serveur HTTP + WebSocket **dans le processus pi** et relie l'interface web à l'API d'extensions de pi : les événements de session (`message_update`, `tool_execution_*`, …) sont streamés au navigateur ; le navigateur envoie des actions (`sendUserMessage`, `setModel`, `setThinkingLevel`, contrôle de session via le contexte de commande). Le serveur est un singleton qui survit aux remplacements de session (`/new`, `/resume`, `/fork`) ; le contexte de commande est rafraîchi via `withSession` après chaque remplacement.

## Licence

MIT — voir [LICENSE](LICENSE). Le logo et la palette pi proviennent de [pi.dev](https://pi.dev) (earendil-works/pi, MIT).
