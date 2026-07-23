# pi-studio

Une interface web pour [Pi](https://pi.dev) (le harness d'agent minimal), distribuée comme package pi. Discutez avec pi depuis votre navigateur : streaming, slash commands, sélecteurs de modèle et de thinking, gestion des sessions et panneau d'artifacts — aux couleurs de pi.

> 🇬🇧 [English version](README.md)

## Fonctionnalités

- **Chat complet** avec streaming (`text_delta`, blocs de réflexion repliables, cartes d'appels d'outils)
- **Slash commands** — `/` ouvre l'autocomplete (`pi.getCommands()`) ; `/skill:*` et les templates de prompts sont expansés par le bridge ; les commandes d'extensions tierces doivent être lancées dans le TUI (limitation v1)
- **Sélecteur de modèle** (tous les modèles authentifiés) et de **thinking level** (`off` → `max`)
- **Sessions** : liste des sessions passées, reprise, nouvelle, fork depuis un message
- **Panneau Artifacts** : fichiers touchés par pi (write/edit/read), aperçu markdown, diffs des edits, aperçu d'images
- **Thèmes dark / light** selon la palette [pi.dev](https://pi.dev), logo pi
- **Interface i18n-ready** (locale française incluse)
- **Sécurité locale** : token aléatoire dans l'URL à chaque démarrage + vérification `Origin` du WebSocket

## Installation

```bash
pi install git:github.com/erick-fortin/pi-studio
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

Gardez le terminal visible : les confirmations des autres extensions (dialogs de permissions, etc.) s'affichent toujours dans le TUI (limitation v1).

## Modèle de sécurité

- Bind `127.0.0.1` par défaut. `--lan` bind `0.0.0.0`.
- Un token aléatoire est généré à chaque démarrage et inclus dans l'URL ouverte automatiquement — rien à taper, mais les pages web que vous visitez ne peuvent pas piloter l'agent (les navigateurs n'appliquent pas la same-origin policy aux WebSockets ; le token + la vérification `Origin` ferment cette brèche).
- Toute personne ayant l'URL complète a le contrôle total de l'agent (bash, fichiers). Traitez l'URL comme un mot de passe, surtout avec `--lan`.

## Compatibilité

Testé avec pi **0.81.1** (API pré-1.0). Node ≥ 20.

## Développement

```bash
git clone https://github.com/erick-fortin/pi-studio
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
