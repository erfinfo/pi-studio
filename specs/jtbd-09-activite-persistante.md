# JTBD-09 — Activité persistante des exécutions

## Intention

Quand Pi travaille dans un projet, l’utilisateur veut voir ce qui se passe réellement, pendant et après l’exécution, afin de comprendre l’état courant, repérer les erreurs et vérifier le travail sans interpréter tout le fil de conversation.

## Périmètre de la première tranche

Créer un panneau latéral **Activité** ouvrable comme les panneaux Sessions et Artifacts.

Le panneau présente les exécutions du projet courant, regroupées par exécution et ordonnées de la plus récente à la plus ancienne. Chaque exécution contient une chronologie technique réelle issue des événements Pi.

### Inclus

- État courant : en cours, terminé, terminé avec erreurs ou interrompu.
- Heure de début et de fin, durée totale.
- Étapes techniques réelles : démarrage d’agent, appels d’outils, résultats et fin d’agent.
- Pour chaque outil : nom, arguments, sortie, statut, heure et durée.
- Mise à jour en direct par WebSocket.
- Historique persistant entre les sessions Pi pour le projet courant.
- Conservation de 30 jours.
- Limite de 100 Mo par projet, avec suppression des exécutions les plus anciennes.
- Stockage local côté Pi, disponible à tous les navigateurs autorisés par le token Pi Studio.
- Fichiers de stockage avec permissions `0600`.
- Redaction automatique des motifs sensibles connus avant écriture.
- Avertissement visible : la redaction automatique ne garantit pas la détection de tous les secrets inconnus.
- Bouton d’effacement de l’historique du projet avec confirmation.
- Résumés d’exécution repliables; l’exécution active est ouverte par défaut.

### Exclu

- Phases métier ou étapes de plan inventées à partir du texte.
- Vue globale regroupant plusieurs projets.
- Synchronisation réseau ou cloud de l’historique.
- Recherche plein texte avancée.
- Modification ou relance d’un outil depuis l’historique.
- Orchestration de sous-agents.
- Panneaux Contexte, Validation, Sécurité ou Coûts.

## Source de vérité

Les étapes affichées proviennent uniquement des événements Pi disponibles :

- `agent_start`
- `tool_execution_start`
- `tool_execution_update` (si utile pour le direct, sans créer de doublons persistants)
- `tool_execution_end`
- `agent_end`
- `agent_settled`

Une « exécution » commence à `agent_start` et se clôt à `agent_settled`. `agent_end` indique la fin d’un cycle bas niveau, mais ne clôt pas nécessairement l’exécution puisqu’un retry, une compaction ou un follow-up peut continuer.

## Data flow attendu

```text
Source : événements officiels Pi
  → Capture : extensions/studio.ts + src/bridge.ts
  → Normalisation : modèle ActivityRun / ActivityStep
  → Redaction : arguments et sorties avant persistance
  → Stockage : ~/.pi/agent/pi-studio/activity/<identifiant-projet>.jsonl
  → Lecture/actions : src/server/actions.ts
  → Transport : src/server/index.ts via snapshot + messages WebSocket dédiés
  → Store client : web/src/ws.ts
  → Écran : web/src/components/ActivityPanel.tsx
  → Affichage : bouton Activité dans TopBar + panneau latéral repliable
```

L’identifiant de projet doit être dérivé de façon déterministe du chemin canonique du projet, sans exposer le chemin complet dans le nom de fichier. Le chemin canonique demeure dans les données pour vérifier le périmètre du projet.

## Modèle fonctionnel minimal

### ActivityRun

- `id`
- `projectPath`
- `sessionFile` si disponible
- `startedAt`
- `endedAt` si terminé
- `durationMs`
- `status`: `running | completed | completed_with_errors | interrupted`
- `errorCount`
- `steps[]`

### ActivityStep

- `id`
- `kind`: `agent | tool`
- `toolCallId` si outil
- `toolName` si outil
- `startedAt`
- `endedAt` si terminé
- `durationMs`
- `status`: `running | completed | failed | interrupted`
- `arguments` redigés
- `output` redigé
- `error` redigée si applicable

## Sécurité et confidentialité

- Ne jamais persister la valeur brute d’un secret reconnu.
- Rediger au minimum les valeurs associées à des clés telles que `token`, `password`, `passwd`, `secret`, `apiKey`, `api_key`, `authorization`, `cookie` et variantes de casse.
- Rediger les motifs usuels dans les chaînes : Bearer tokens, clés privées PEM, assignations de variables sensibles et URLs contenant un paramètre d’authentification connu.
- Appliquer la redaction récursivement aux objets et tableaux.
- Tronquer chaque argument ou sortie individuelle à une limite documentée afin qu’un seul événement ne puisse monopoliser les 100 Mo.
- Écriture atomique ou stratégie JSONL tolérante à une dernière ligne incomplète.
- Créer les dossiers avec permissions restrictives et le fichier avec mode `0600`.
- Le bouton d’effacement ne supprime que l’historique du projet courant.
- L’interface doit expliquer que la redaction est une protection au mieux, pas une garantie absolue.

## Rétention

À la lecture et après chaque écriture :

1. supprimer les exécutions âgées de plus de 30 jours;
2. si le fichier dépasse 100 Mo, supprimer les exécutions complètes les plus anciennes jusqu’au retour sous la limite;
3. ne jamais couper volontairement une exécution JSON au milieu;
4. conserver l’exécution active même si la limite est atteinte, puis compacter après sa clôture.

## Comportement UI

- Nouveau bouton `Activité` dans la barre supérieure.
- Ouvrir Activité ferme Sessions et Artifacts; ouvrir l’un de ceux-ci ferme Activité.
- Panneau opaque et plein écran sur mobile, conforme aux panneaux existants.
- En-tête avec état actif et action d’effacement.
- Une carte par exécution : statut, début, durée, nombre d’outils et erreurs.
- Une exécution dépliée affiche les étapes chronologiques.
- Les arguments et sorties détaillés sont repliés par défaut.
- Les statuts ne reposent pas uniquement sur la couleur.
- Focus clavier visible et boutons dotés de libellés accessibles.
- Respect de `prefers-reduced-motion`.
- Interface en français pour cette tranche, selon la convention actuelle du projet.

## Cas limites

- Reconnexion WebSocket pendant une exécution : le snapshot restaure l’exécution active et l’historique.
- Redémarrage brutal de Pi : une exécution restée `running` est marquée `interrupted` au prochain chargement, avec une raison générique.
- Pi 0.81.1 ne fournit pas de verdict global à `agent_settled`; une exécution est donc `completed_with_errors` si au moins un outil a échoué, sans prétendre que l’objectif global a échoué.
- `tool_execution_end` sans début connu : créer une étape complète avec durée inconnue plutôt que perdre l’événement.
- Deux outils parallèles : les corréler par `toolCallId`; ne pas supposer un ordre de fin identique à l’ordre de départ.
- Sortie circulaire ou non sérialisable : produire une représentation sûre au lieu de casser l’agent.
- Fichier absent, vide ou dernière ligne incomplète : récupérer les entrées valides et continuer.
- Erreur de stockage : ne jamais casser l’agent; signaler l’indisponibilité de la persistance dans le panneau.
- Changement de session dans le même projet : conserver l’historique et démarrer une nouvelle exécution au prochain `agent_start`.
- Changement de projet après remplacement de session : charger l’historique correspondant au nouveau `cwd`.

## Critères d’acceptation

### Succès technique

- Tests unitaires du modèle, de la redaction, de la rétention et des cas JSONL corrompus.
- Tests du bridge et du protocole WebSocket.
- Tests React/store du panneau et des mises à jour en direct.
- `npm test`, typecheck backend et build web réussissent.
- `web/dist` est régénéré et frais.

### Succès fonctionnel

- Une vraie exécution Pi apparaît en direct dans Activité.
- Les outils parallèles sont correctement corrélés.
- Les durées et statuts se stabilisent à la fin.
- Après une nouvelle session ou un redémarrage de Pi Studio, l’exécution reste visible pour le même projet.
- Une reconnexion navigateur récupère l’état par snapshot.
- L’effacement confirmé retire uniquement l’historique du projet courant.
- Un secret de test connu est redigé sur disque et dans l’interface.
- La purge de 30 jours et la limite de taille sont démontrées par tests.

### Succès métier

- L’utilisateur peut répondre sans lire toute la conversation : « Pi travaille-t-il encore? », « quel outil a échoué? », « combien de temps cela a pris? » et « qu’a exécuté Pi lors d’une session précédente? ».
- La validation humaine d’Erick confirme que le panneau est lisible, utile et à son goût avant toute fusion vers `main`.
