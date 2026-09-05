#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ST_ROOT="${1:-$HOME/SillyTavern}"
ST_USER="${2:-default-user}"
REPO="sogyboi/SillyTavern-Inspiration-Board"
BRANCH="character-gallery-studio"
EXT_NAME="Character-Gallery-Studio"
EXT_DEST="$ST_ROOT/data/$ST_USER/extensions/$EXT_NAME"
BACKUP_ROOT="$ST_ROOT/data/$ST_USER/character-gallery-extension-backups"

case "$ST_USER" in
  ''|*[!a-zA-Z0-9_.-]*|.|..)
    echo 'Invalid SillyTavern user directory name.' >&2
    exit 1
    ;;
esac

if [[ ! -f "$ST_ROOT/server.js" || ! -d "$ST_ROOT/src" ]]; then
  echo "Not a SillyTavern server directory: $ST_ROOT" >&2
  echo "Usage: bash install-termux.sh ~/SillyTavern default-user" >&2
  exit 1
fi

for command in curl tar node; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

TMP_BASE="${TMPDIR:-$HOME/.cache}"
mkdir -p "$TMP_BASE"
WORK="$(mktemp -d "$TMP_BASE/cgs-install.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
ARCHIVE="$WORK/cgs.tar.gz"
EXTRACT="$WORK/extract"
mkdir -p "$EXTRACT"

URL="https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH"
echo "Downloading Character Gallery Studio $BRANCH without Git authentication..."
curl --fail --location --silent --show-error "$URL" --output "$ARCHIVE"

tar -xzf "$ARCHIVE" -C "$EXTRACT"
SOURCE="$(find "$EXTRACT" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [[ -z "$SOURCE" || ! -f "$SOURCE/manifest.json" || ! -f "$SOURCE/index.js" ]]; then
  echo 'Downloaded archive did not contain a valid Character Gallery Studio extension.' >&2
  exit 1
fi

node --check "$SOURCE/index.js"
node --check "$SOURCE/server-plugin/character-gallery-api/index.mjs"

mkdir -p "$(dirname "$EXT_DEST")"
if [[ -e "$EXT_DEST" ]]; then
  mkdir -p "$BACKUP_ROOT"
  BACKUP="$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)-$$"
  mv "$EXT_DEST" "$BACKUP"
  echo "Previous extension code backed up to $BACKUP"
fi

cp -R "$SOURCE" "$EXT_DEST"
rm -rf "$EXT_DEST/.git" "$EXT_DEST/.github"

bash "$EXT_DEST/tools/install-plugin.sh" "$ST_ROOT" "$ST_USER"

printf '\nCharacter Gallery Studio installed without a Git clone.\n'
grep '"version"' "$EXT_DEST/manifest.json" | head -n 1 || true
echo "Extension: $EXT_DEST"
echo "Server plugin: $ST_ROOT/plugins/character-gallery-api"
echo 'Fully stop and restart SillyTavern, then reload the app/browser.'
