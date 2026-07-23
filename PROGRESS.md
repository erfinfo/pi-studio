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
