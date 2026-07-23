# PLAN.md — pi-studio

Interface web pour Pi, distribuée comme package pi public (GitHub, MIT).

## Phases Build

- [x] Phase 1 : Scaffold + spike extension (`/webui` sert une page, ouvre le browser, `pi.getCommands()`, stash ctx, survie du serveur)
- [x] Phase 2 : Bridge WS (token, Origin check) + prompt → streaming text_delta dans le chat web
- [x] Phase 3 : Snapshot/resync + sélecteurs modèle/thinking + abort + steer/followUp
- [x] Phase 4 : Slash commands (autocomplete `pi.getCommands()`, expansion skill/templates par le bridge)
- [x] Phase 5 : Sessions (list/resume/new/fork depuis un message)
- [x] Phase 6 : Panneau Artifacts (fichiers touchés, preview MD, diffs, images)
- [x] Phase 7 : Thèmes dark/light (palette pi.dev), logo, i18n fr
- [x] Phase 8 : Durcissement, README fr/en, CI, tests vitest, hygiene
- [x] Post-v1 : installateurs Bash/PowerShell documentés + galerie de captures anonymisées

## Reste à faire (v2+)

- [ ] Repo GitHub public `erick-fortin/pi-studio` + push
- [ ] Fork avec navigateur d'arbre complet (`navigateTree`)
- [ ] Bridge des dialogs `ctx.ui.*` (confirm/select/input) vers le web
- [ ] Invocation des commandes d'extensions tierces depuis le web
- [ ] Upload d'images dans le composer
- [ ] Tests Playwright

## Décisions validées (plan-simple-k3 + critique K3)

- Architecture : extension pi, commande `/webui`, serveur HTTP+WS dans le processus pi
- Token aléatoire dans l'URL ouverte automatiquement + check Origin (même en localhost)
- `--lan` : bind 0.0.0.0, URL complète avec token affichée
- v1 : fork simple depuis un message, pas de navigateur d'arbre (`navigateTree` → v2)
- v1 : commandes d'extensions tierces non invoquables depuis le web (limitation documentée)
- v1 : dialogs `ctx.ui.*` d'autres extensions restent dans le TUI (documenté)
- i18n-ready, fr seul (`locales/fr.json` + hook `t()`)
- `web/dist` commité, CI vérifie la fraîcheur
- Testé contre pi 0.81.1 (peerDep `*`, compat documentée)
- ctx de commande re-stashé via `withSession` après chaque remplacement de session
