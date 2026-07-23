# Rapport de phase — Cockpit IA v2

## Build 1 — Domaine et persistance Activity

### Fichiers ajoutés

- `src/activity/types.ts`
- `src/activity/redact.ts`
- `src/activity/store.ts`
- `src/activity/tracker.ts`
- `tests/activity-redact.test.ts`
- `tests/activity-store.test.ts`

### Capacités validées

- Modèle d’exécution et d’étapes techniques.
- Journal JSONL versionné et tolérant à une dernière ligne invalide.
- Redaction récursive avant persistance.
- Limite de 64 Kio par arguments/sortie.
- Queue d’écriture pour événements concurrents.
- Synchronisation disque à la clôture et réécriture atomique lors des purges.
- Conservation 30 jours et limite 100 Mo par projet.
- Dossiers `0700` et fichiers `0600`.
- Corrélation des outils parallèles par `toolCallId`.
- Récupération des exécutions orphelines et interruptions.

### Validation

- `npm test` : 40/40 tests réussis.
- `npm run typecheck` : réussi.
- `web/npm run build` : réussi.
- Smoke test avec vrai fichier JSONL temporaire : réussi.
- Secret de test vérifié absent du disque.
- Modes réellement observés : dossier `0700`, fichier `0600`.

### Statuts de succès

- **Technique : réussi** — tests, typage, build et disque réels validés.
- **Fonctionnel Build 1 : réussi** — le journal reconstruit correctement une exécution complète et redigée.
- **Métier : à vérifier plus tard** — aucun panneau utilisateur n’existe avant le Build 3.

### Risques restants

- La redaction demeure une protection au mieux pour les formats de secrets inconnus.
- La consommation mémoire avec un historique approchant 100 Mo devra être mesurée pendant l’intégration réelle.

## Build 2 — Bridge Pi et WebSocket

### Fichiers ajoutés ou modifiés

- `src/activity/runtime.ts`
- `extensions/studio.ts`
- `src/bridge.ts`
- `src/server/actions.ts`
- `src/server/index.ts`
- `web/src/ws.ts`
- `tests/activity-runtime.test.ts`
- `tests/ws.test.ts`

### Validation

- Activation explicite après `/webui`.
- Capture d’un run, outils parallèles, erreur et interruption.
- Isolation entre projets et effacement protégé.
- Snapshot et mises à jour WebSocket réels.
- Smoke serveur : snapshot reçu, 4 mises à jour, un outil, statut final `completed`.

### Statuts de succès

- **Technique : réussi** — protocole, stockage et store React validés.
- **Fonctionnel Build 2 : réussi** — le flux traverse Pi → disque → WebSocket → état client.

## Build 3 — Panneau et validation réelle

### Fichiers ajoutés ou modifiés

- `web/src/components/ActivityPanel.tsx`
- `web/src/components/ActivityPanel.test.ts`
- `web/src/App.tsx`
- `web/src/components/TopBar.tsx`
- `web/src/locales/fr.json`
- `web/src/theme.css`
- `src/bridge.ts`
- `tests/bridge.test.ts`
- `tests/ws.test.ts`
- `README.md` et `README.fr.md`
- `docs/screenshots/07-activity-panel-dark.png`

### Validation réelle

- Pi 0.81.1 lancé avec la branche dans un agent dir isolé.
- État En cours observé pendant `sleep 5`, bouton Effacer désactivé et indicateur actif.
- Run terminé avec deux outils et une erreur volontaire correctement affiché.
- Reconnexion navigateur : historique restauré par snapshot.
- Redémarrage complet de Pi : historique du projet restauré.
- Secret factice redigé dans le journal et absent en clair.
- Effacement confirmé : panneau vide et journal de 0 octet.
- Chrome dark/light à 1440 × 900.
- Chrome mobile à 390 × 844, panneau 390 px et aucun débordement horizontal.
- Message fantôme de stream après reconnexion reproduit, corrigé et couvert par test.

### Statuts de succès

- **Technique : réussi** — tests, typechecks, build, WebSocket et runtime Pi réels validés.
- **Fonctionnel : réussi** — activité en direct, persistance, reconnexion, redaction et effacement fonctionnent.
- **Métier : prêt pour validation humaine** — le panneau est ouvert visuellement, mais seul Erick décide s’il est à son goût avant merge.
