# TASK.md — Tâche courante

## Phase 1 : Scaffold + spike extension

**Objectif** : prouver les 4 risques techniques avant d'investir dans l'UI.

1. `pi -e .` charge l'extension, `/webui` démarre le serveur et sert une page statique
2. Le serveur survit au retour du handler de commande (singleton module-level)
3. `pi.getCommands()` retourne les commandes (extensions + templates + skills)
4. Le ctx de commande stashé permet `newSession()` depuis un callback WS hors handler (guard `isIdle()`)

**Preuve attendue** : test automatisé via `pi --mode rpc -e .` → envoi `/webui` → curl de la page → WS reçoit la liste des commandes.
