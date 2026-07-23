# IMPLEMENTATION_PLAN.md — Cockpit IA v2 / Activité persistante

## Décision

Construire un seul module end-to-end : le panneau **Activité** du projet courant.

L’architecture retenue est un journal local JSONL append-only, activé lorsque `/webui` démarre. Un tracker transforme les événements officiels Pi en exécutions et étapes normalisées. Le serveur conserve une vue en mémoire pour les snapshots rapides, diffuse les changements par WebSocket et persiste chaque transition après redaction. Le frontend affiche les exécutions dans un panneau latéral ouvrable.

Aucune dépendance runtime supplémentaire n’est nécessaire.

## État des exigences

Source approuvée : `specs/jtbd-09-activite-persistante.md`.

### Ajustement requis découvert pendant la planification

Pi 0.81.1 expose `agent_settled` sans verdict global de succès ou d’échec. Afin de ne pas afficher une conclusion inventée, les statuts fonctionnels seront :

- `running` — exécution active;
- `completed` — exécution clôturée sans erreur d’outil observée;
- `completed_with_errors` — exécution clôturée avec au moins une erreur d’outil observée;
- `interrupted` — interruption connue depuis le bouton Arrêter de Pi Studio ou exécution orpheline récupérée après redémarrage.

Une interruption déclenchée uniquement depuis un autre client/TUI peut ne pas être distinguable d’une fin normale par les événements publics actuels. Cette limite doit être documentée et testée honnêtement.

## Architecture détaillée

### 1. Domaine

Nouveaux fichiers :

- `src/activity/types.ts`
- `src/activity/redact.ts`
- `src/activity/store.ts`
- `src/activity/tracker.ts`

#### Modèle public

`ActivityRun` :

- identifiant stable;
- chemin canonique du projet;
- fichier de session si disponible;
- début, fin, durée;
- statut public;
- nombre d’outils et d’erreurs;
- étapes chronologiques.

`ActivityStep` :

- identifiant et type `agent | tool`;
- `toolCallId` et nom d’outil si applicable;
- début, fin, durée;
- statut;
- arguments, sortie et erreur après redaction/troncature.

#### Journal interne

Événements JSONL versionnés :

- `run_started`
- `tool_started`
- `tool_finished`
- `run_finished`
- `run_interrupted`

Chaque ligne est autonome et contient une version de schéma. La dernière ligne incomplète est ignorée au chargement. Les événements inconnus d’une future version sont ignorés sans casser les événements connus.

### 2. Stockage

Chemin :

```text
join(getAgentDir(), "pi-studio", "activity", sha256(realpath(cwd)) + ".jsonl")
```

Décisions :

- utiliser `getAgentDir()` exporté officiellement par `@earendil-works/pi-coding-agent` plutôt que coder `~/.pi/agent` en dur;
- utiliser le chemin canonique du projet pour l’identifiant et le conserver dans chaque run pour vérifier le périmètre;
- créer les dossiers avec mode `0700` et les fichiers avec mode `0600`;
- conserver une vue reconstruite en mémoire après initialisation; les snapshots ne relisent pas 100 Mo;
- sérialiser les écritures dans une Promise queue pour préserver l’ordre des événements parallèles;
- écrire en append pour le chemin normal;
- réécrire atomiquement via fichier temporaire + rename seulement pour purge/compaction;
- appeler `fsync` au moment de clôturer une exécution et avant un remplacement atomique, pas après chaque delta, afin d’éviter un coût excessif;
- limiter chaque représentation d’arguments/sortie à 64 Kio après redaction; marquer explicitement la troncature;
- conserver au maximum 100 Mo par projet et 30 jours;
- purger des exécutions complètes anciennes, jamais une moitié d’exécution;
- une exécution active reste en mémoire et dans le journal jusqu’à sa clôture;
- au chargement, une exécution sans événement final devient `interrupted` avec une raison générique.

### 3. Redaction

`redact.ts` doit être pur et testé séparément.

Protections minimales :

- clés d’objet sensibles sans tenir compte de la casse ni des séparateurs : token, password, passwd, secret, api key, authorization, cookie et variantes;
- chaînes Bearer;
- blocs PEM privés;
- assignations usuelles de variables sensibles;
- paramètres d’URL connus contenant des secrets;
- redaction récursive des objets/tableaux;
- profondeur maximale et détection des références circulaires;
- représentation sûre des valeurs non sérialisables;
- redaction avant troncature et avant toute écriture disque;
- même objet redigé envoyé au navigateur, afin que disque et UI concordent.

Limite assumée et visible : la redaction est au mieux; un secret au format inconnu peut subsister.

### 4. Tracker

`ActivityTracker` possède l’exécution active et l’index des outils actifs par `toolCallId`.

Mapping :

```text
agent_start          → run_started
outil start          → tool_started
tool_execution_end   → tool_finished
agent_settled        → run_finished
abort depuis le web  → marqueur interruption demandée, finalisé à agent_settled
```

Règles :

- `agent_end` ne clôt jamais l’exécution;
- les outils parallèles sont corrélés uniquement par `toolCallId`;
- une fin d’outil sans début crée une étape récupérée avec durée inconnue;
- un second `agent_start` alors qu’un run est actif interrompt d’abord l’ancien run pour éviter deux runs actifs;
- le tracker est activé explicitement dans `launch()` avant le démarrage du serveur;
- tant que `/webui` n’a jamais été lancé dans le processus, aucune journalisation Activity n’est faite;
- lors d’un remplacement de session, `restash()` rebascule le tracker vers le `cwd` frais avant les prochains événements;
- une erreur de stockage met l’historique en état dégradé mais ne casse jamais l’agent.

### 5. Bridge et protocole WebSocket

Fichiers modifiés :

- `extensions/studio.ts`
- `src/bridge.ts`
- `src/server/actions.ts`
- `src/server/index.ts`

Ajouts :

- initialisation/switch du tracker;
- capture des événements Activity avant broadcast;
- `activity` inclus dans le snapshot initial;
- message serveur `activity_update` après chaque transition utile;
- action client `clear_activity`;
- réponse `activity_cleared` ou erreur explicite;
- état `activityPersistenceError` dans snapshot/update si le stockage est dégradé;
- `abort()` marque l’interruption demandée avant d’appeler `ctx.abort()`;
- effacement refusé pendant une exécution active pour éviter un journal incohérent;
- après changement de session/projet, le snapshot frais contient uniquement l’historique du nouveau `cwd`.

Le token et le contrôle Origin existants protègent ces routes comme le reste de Pi Studio.

### 6. Store React et interface

Fichiers ajoutés/modifiés :

- `web/src/components/ActivityPanel.tsx`
- `web/src/ws.ts`
- `web/src/App.tsx`
- `web/src/components/TopBar.tsx`
- `web/src/locales/fr.json`
- `web/src/theme.css`

Comportement :

- bouton `Activité` dans TopBar;
- ouverture exclusive avec Sessions et Artifacts;
- exécution active ouverte par défaut;
- anciennes exécutions repliées;
- résumé : statut textuel, date/heure fr-CA, durée, outils, erreurs;
- étapes chronologiques;
- arguments et sorties dans des détails repliés par défaut;
- avertissement de confidentialité permanent mais compact;
- bouton Effacer avec `window.confirm`, désactivé pendant une exécution active;
- état vide et erreur de persistance explicites;
- statut jamais communiqué uniquement par couleur;
- focus visible, libellés ARIA et navigation clavier;
- panneau plein écran sur mobile selon le pattern existant;
- respect du thème dark/light et de `prefers-reduced-motion`.

## Phases Build atomiques

### Phase 1 — Domaine et persistance

Objectif : obtenir un journal fiable et testable sans toucher encore au protocole ou à l’UI.

Tests d’abord :

- redaction récursive et insensible à la casse;
- Bearer, PEM, variables et paramètres URL;
- références circulaires et profondeur maximale;
- redaction avant troncature;
- reconstruction d’un journal valide;
- dernière ligne JSON invalide ignorée;
- permissions dossier/fichier;
- exécution orpheline marquée interrompue;
- événements futurs inconnus ignorés;
- outils parallèles corrélés;
- fin d’outil sans début;
- purge 30 jours;
- limite de taille testée avec seuil injectable, sans créer 100 Mo de fixtures;
- ordre des écritures concurrentes.

Livrables : `types.ts`, `redact.ts`, `store.ts`, `tracker.ts`, tests dédiés.

Validation : tests ciblés, suite complète, typecheck, inspection d’un journal temporaire réel, repo hygiene, commit.

### Phase 2 — Bridge et protocole end-to-end serveur

Objectif : faire circuler l’activité réelle jusqu’au store React, sans panneau visuel final.

Tests d’abord :

- activation seulement après `/webui`;
- run start → outil start/end → settled;
- statut `completed_with_errors`;
- interruption demandée depuis le web;
- snapshot après reconnexion;
- `activity_update` diffusé;
- effacement du projet courant;
- effacement refusé pendant un run;
- changement de session avec même projet;
- changement de `cwd` sans fuite d’historique entre projets;
- panne de stockage non fatale;
- store React traite snapshot/update/clear.

Livrables : intégration extension/bridge/actions/server/ws.

Validation : tests ciblés, suite complète, typecheck backend, build web, smoke WebSocket automatisé, commit.

### Phase 3 — Interface et validation réelle

Objectif : livrer le module complet utilisable et visuellement validé.

Tests d’abord lorsque pertinent :

- exclusivité des panneaux;
- cartes et statuts textuels;
- détails repliables;
- confirmation/effacement;
- bouton désactivé pendant activité;
- état vide et erreur de persistance.

Implémentation : ActivityPanel, TopBar, App, traductions, CSS responsive.

Validation réelle :

1. démarrer Pi réel avec l’extension;
2. lancer `/webui`;
3. exécuter un outil réussi, un outil en erreur et deux outils parallèles;
4. vérifier l’actualisation en direct et les durées;
5. reconnecter le navigateur et vérifier le snapshot;
6. créer/reprendre une session et vérifier l’historique du même projet;
7. redémarrer Pi Studio et vérifier la persistance;
8. injecter uniquement des secrets de test et confirmer leur redaction sur disque et dans Chrome;
9. vérifier l’effacement confirmé;
10. valider Chrome dark/light, desktop et mobile 390 × 844;
11. vérifier absence de débordement horizontal, focus clavier et libellés;
12. exécuter tests, typecheck et build de production;
13. régénérer `web/dist`;
14. mettre à jour README fr/en, PLAN, PROGRESS et TASK;
15. supprimer les données et artefacts de preuve temporaires;
16. commit atomique de fin de phase.

## Rollback

- `main` reste intacte jusqu’à approbation explicite de merge.
- Branche de sauvegarde : `backup/avant-cockpit-ia-20260723-100001`.
- Chaque phase Build possède son propre commit réversible.
- Le stockage Activity est isolé sous le dossier de données Pi Studio.
- L’effacement des fichiers Activity n’affecte ni les sessions Pi ni les projets.
- Aucune migration de données existantes et aucune nouvelle dépendance runtime.

## Risques restants

1. **Secrets inconnus** — mitigation : redaction connue, permissions 0600, avertissement; risque résiduel accepté explicitement.
2. **Volume mémoire** — la vue en mémoire peut approcher 100 Mo; mesurer pendant Phase 1. Si le coût est excessif, paginer les anciennes exécutions sans changer le format public.
3. **Écriture interrompue** — JSONL tolère une dernière ligne incomplète; la purge utilise rename atomique.
4. **Statut global ambigu** — ne jamais afficher « réussi » ou « échoué » sans signal public; utiliser les statuts honnêtes définis plus haut.
5. **TUI vs web abort** — seule l’interruption web est assurément identifiable; documenter la limite.
6. **API Pi pré-1.0** — tests réels contre la version installée 0.81.1 et types officiels locaux.

## Documentation consultée

- Pi 0.81.1 : `/usr/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- Pi packages : `/usr/lib/node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
- Types officiels : `dist/core/extensions/types.d.ts`
- Export officiel `getAgentDir()` : `dist/index.d.ts` et `dist/config.d.ts`
- Architecture et tests actuels du dépôt pi-studio.

## Critique indépendante

La critique Kimi K3 prévue n’a pas été obtenue : l’API a retourné `403 access_terminated_error` parce que le quota du cycle est atteint. Aucun avis K3 n’est donc revendiqué. Le plan demeure à valider par Erick avant toute implémentation.
