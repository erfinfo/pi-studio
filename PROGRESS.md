# PROGRESS.md — pi-studio

## 2026-07-24

### Fait
- Requirements + Planning validés via skill plan-simple-k3 (critique K3 intégrée)
- **Toutes les phases Build (1-8) terminées et validées par tests E2E réels**
- Validations E2E (pi réel en tmux + clients WS) :
  - serveur démarré par `/webui` dans le processus pi, token + Origin OK
  - prompt → streaming text_delta/thinking_delta, message_end, agent_end
  - 258 modèles listés, set_thinking appliqué, 170 commandes énumérées
  - 39 sessions listées, resume (6 messages restaurés), fork, new_session
  - artifacts : write tracké, read_file OK, diff disponible
  - 19 tests vitest (fidélité substituteArgs/parseCommandArgs, sécurité Origin/traversal)
- Bugs trouvés et corrigés :
  - ctx stale après remplacement de session → re-stash via `withSession`
  - `sendUserMessage` n'expanse pas les commandes → expansion skill/templates répliquée dans le bridge
- Typecheck backend + build web OK
- README.md (en) + README.fr.md + LICENSE MIT + CI GitHub Actions

### En cours
- (rien)

### Bloqué
- (rien)

### Reste
- Créer le repo GitHub public et pousser (demander confirmation pour le push)

## 2026-07-24 (suite)

### Fait
- Fixes UI : cookie assets (page blanche), menu modèle vers le bas + recherche, tri slash par préfixe, pi animé, compteur ctx rafraîchi (state_patch)
- **Bridge ask web-aware (Option A)** : fork local de pi-ask-tool (`~/projets/pi-ask-tool`) qui publie les questions sur `pi.events` ; pi-studio les affiche dans le web et renvoie la réponse sur le bus. Race TUI/web, premier arrivé gagne. Test E2E validé (question → réponse web 'Bleu' → tool résolu sans toucher au TUI).
- Bascule settings pi : `git:github.com/devkade/pi-ask-tool` → `/home/erick/projets/pi-ask-tool` (réversible avec `pi remove` + réinstall)

### Notes
- Si le web répond en premier, le dialog TUI reste affiché → Échap pour l'ignorer (limitation connue)
- pi-ask-tool est publié sous `erfinfo/pi-ask-tool` et installé depuis GitHub

## 2026-07-24 — Installation et documentation visuelle

### Fait
- Installateur Bash `scripts/install.sh` (Linux/macOS) : `-h/--help`, `--ref`, `--no-ask`, `--launch`, `--port`, `--lan`
- Installateur PowerShell `scripts/install.ps1` (Windows) avec les mêmes options
- Test réel `--launch --no-ask --port 14177` : Pi démarre et `/webui` fournit une URL tokenisée
- 6 captures réelles dans `docs/screenshots/`, projet de démonstration isolé sous `/tmp`
- README fr/en : installation sécurisée, options, captures dark/light, modèle, Ask, Artifacts
- CI : validation Bash (bash -n + ShellCheck + aide) et PowerShell (aide via pwsh)
- Validations : 19/19 tests, typecheck, build web, liens screenshots, scan secrets

## 2026-07-24 — Retour visuel du bouton Arrêter

### Diagnostic
- Route WebSocket `abort` et API Pi `ctx.abort()` fonctionnelles
- Reproduction réelle : outil `bash sleep 30` interrompu en 40 ms par client WebSocket
- Test Chrome réel : clic sur Arrêter, retour à Envoyer en 61 ms
- Cause du « n'a pas l'air de fonctionner » : aucun accusé visuel entre le clic et `agent_end`

### Correctif
- État client `isAborting` immédiat
- Libellé `Arrêt…` et bouton désactivé pour empêcher le double clic
- Réinitialisation sur fin d'agent, erreur, snapshot ou déconnexion
- 3 tests de régression pour la demande, la fin d'agent et le cas inactif
- Test Chrome du correctif : `Arrêt…` désactivé visible immédiatement, arrêt complet en 86 ms
