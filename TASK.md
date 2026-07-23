# Tâche terminée — Modernisation visuelle

## Objectif
Moderniser pi-studio dans un style sobre inspiré de pi.dev, sans modifier les workflows ni le protocole WebSocket.

## Périmètre
- Hiérarchie visuelle, palette, typographie, espacements
- Topbar, chat, outils, composer, panneaux et dialogs
- Dark/light, focus clavier, reduced-motion et responsive mobile

## Preuves obtenues
- Typecheck et 22 tests verts
- Build `web/dist` frais
- Validation Chrome dark/light, desktop/mobile
- Smoke E2E : prompt, Arrêter (83 ms), modèle, Sessions, Artifacts et Ask
- Aucun débordement horizontal à 390 px
