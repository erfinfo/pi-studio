#!/usr/bin/env bash
set -Eeuo pipefail

REF="main"
INSTALL_ASK=1
LAUNCH=0
PORT=4173
LAN=0

usage() {
  cat <<'EOF'
pi-studio installer (Linux/macOS)

Usage:
  ./scripts/install.sh [options]

Options:
  -h, --help          Afficher cette aide
  --ref REF           Branche, tag ou commit Git (défaut: main)
  --no-ask            Ne pas installer le fork pi-ask-tool web-aware
  --launch            Lancer Pi et /webui après l'installation
  --port PORT         Port de /webui (défaut: 4173; utilisé avec --launch
                      et affiché dans les prochaines étapes)
  --lan               Bind 0.0.0.0 lors du lancement (risque réseau)

Exemples:
  ./scripts/install.sh
  ./scripts/install.sh --launch
  ./scripts/install.sh --launch --port 8080 --lan
  ./scripts/install.sh --ref v0.1.0 --no-ask

Le mode --lan expose un agent qui peut exécuter des commandes et lire/écrire
les fichiers. Ne partagez que l'URL complète générée (elle contient le token).
EOF
}

fail() {
  printf 'Erreur: %s\n' "$*" >&2
  exit 1
}

need_value() {
  [[ $# -ge 2 && -n "${2:-}" ]] || fail "Valeur manquante pour $1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --ref)
      need_value "$@"
      REF="$2"
      shift 2
      ;;
    --no-ask|--without-ask)
      INSTALL_ASK=0
      shift
      ;;
    --launch)
      LAUNCH=1
      shift
      ;;
    --port)
      need_value "$@"
      PORT="$2"
      shift 2
      ;;
    --lan)
      LAN=1
      shift
      ;;
    *)
      fail "Option inconnue: $1 (utilisez --help)"
      ;;
  esac
done

[[ "$PORT" =~ ^[0-9]+$ ]] || fail "Port invalide: $PORT"
(( PORT >= 1 && PORT <= 65535 )) || fail "Le port doit être entre 1 et 65535"
[[ "$REF" != *[[:space:]]* ]] || fail "La référence Git ne doit pas contenir d'espace"

for cmd in git node pi; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Commande requise introuvable: $cmd"
done

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || fail "Impossible de lire la version de Node.js"
(( NODE_MAJOR >= 20 )) || fail "Node.js 20+ requis (version détectée: $(node --version))"

printf '\nInstallation de pi-studio (ref: %s)\n' "$REF"
printf 'Pi: %s | Node: %s\n\n' "$(pi --version 2>/dev/null | head -n1)" "$(node --version)"

if (( INSTALL_ASK )); then
  printf '[1/2] Installation de pi-ask-tool web-aware…\n'
  pi install "git:github.com/erfinfo/pi-ask-tool@${REF}"
else
  printf '[1/2] pi-ask-tool ignoré (--no-ask)\n'
fi

printf '[2/2] Installation de pi-studio…\n'
pi install "git:github.com/erfinfo/pi-studio@${REF}"

WEBUI_COMMAND="/webui --port ${PORT}"
if (( LAN )); then
  WEBUI_COMMAND+=" --lan"
  printf '\nAVERTISSEMENT: --lan donne accès à Pi sur le réseau.\n'
  printf "Traitez l'URL complète comme un mot de passe.\n"
fi

printf '\nInstallation terminée.\n'
printf 'Dans Pi, lancez: %s\n' "$WEBUI_COMMAND"
printf 'Mise à jour future: pi update --extensions\n'

if (( LAUNCH )); then
  printf '\nLancement de Pi…\n'
  exec pi "$WEBUI_COMMAND"
fi
