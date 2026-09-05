#!/usr/bin/env bash
# Installs only Character Gallery's server plugin. Gallery data and keys stay untouched.
set -euo pipefail
ST_ROOT="${1:-$HOME/SillyTavern}"
ST_USER="${2:-default-user}"
case "$ST_USER" in ''|*[!a-zA-Z0-9_.-]*|.|..) echo 'Invalid SillyTavern user directory name.' >&2; exit 1;; esac
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../server-plugin/character-gallery-api" && pwd)"
if [[ ! -f "$ST_ROOT/server.js" || ! -d "$ST_ROOT/src" ]]; then
  echo "Not a SillyTavern server directory: $ST_ROOT" >&2
  exit 1
fi
node --check "$SOURCE/index.mjs"
DEST="$ST_ROOT/plugins/character-gallery-api"
BACKUPS="$ST_ROOT/data/$ST_USER/character-gallery-plugin-backups"
mkdir -p "$ST_ROOT/plugins"
if [[ -e "$DEST" ]]; then
  mkdir -p "$BACKUPS"
  BACKUP="$BACKUPS/$(date +%Y%m%d-%H%M%S)-$$"
  mv "$DEST" "$BACKUP"
  if ! cp -R "$SOURCE" "$DEST"; then
    rm -rf "$DEST"
    mv "$BACKUP" "$DEST"
    echo 'Installation failed; the previous plugin was restored.' >&2
    exit 1
  fi
  echo "Previous plugin code backed up to $BACKUP"
else
  cp -R "$SOURCE" "$DEST"
fi
printf '\nInstalled Character Gallery API.\n'
grep 'VERSION =' "$DEST/core.mjs"
if ! grep -Eq '^enableServerPlugins:[[:space:]]*true' "$ST_ROOT/config.yaml"; then
  echo 'Set enableServerPlugins: true in config.yaml.'
fi
echo 'Fully stop and restart the SillyTavern server, then reload the app/browser.'
