#!/usr/bin/env bash
# FakeMuteDeafen installer for Equicord (Linux / macOS)
#
# Installs the plugin as an ADDITIONAL userplugin: clones Equicord's source,
# adds the plugin folder next to any other userplugins, builds it and patches
# the Discord client with the result. Re-run the script to update the plugin.
#
# Usage:
#   bash install.sh
#   EQUICORD_DIR="/path/to/Equicord" bash install.sh
#
# Prefer the ready-made zip from GitHub Releases if you don't want to build.

set -euo pipefail

PLUGIN_REPO="https://github.com/welpyfr/FakeMuteDeafen.git"
PLUGIN_DIR_NAME="fakeMuteDeafen"
EQUICORD_DIR="${EQUICORD_DIR:-$HOME/Equicord}"
EQUICORD_REPO="https://github.com/Equicord/Equicord.git"

step() { printf "\n==> %s\n" "$1"; }
die()  { printf "ERROR: %s\n" "$1" >&2; exit 1; }

step "Checking prerequisites"
command -v git  >/dev/null 2>&1 || die "git is not installed (https://git-scm.com)"
command -v node >/dev/null 2>&1 || die "node is not installed (https://nodejs.org)"
if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm not found, enabling via corepack..."
    corepack enable || die "could not enable pnpm. Install it manually: npm install -g pnpm"
    command -v pnpm >/dev/null 2>&1 || die "pnpm is still not available"
fi

step "Getting Equicord source ($EQUICORD_DIR)"
if [ -d "$EQUICORD_DIR/.git" ]; then
    echo "Existing clone found, pulling latest changes..."
    git -C "$EQUICORD_DIR" pull --recurse-submodules
else
    git clone --recurse-submodules "$EQUICORD_REPO" "$EQUICORD_DIR"
fi

step "Adding the plugin as a userplugin"
TARGET="$EQUICORD_DIR/src/userplugins/$PLUGIN_DIR_NAME"
if [ -d "$TARGET/.git" ]; then
    echo "Existing plugin found, pulling latest version..."
    git -C "$TARGET" pull
elif [ -d "$TARGET" ]; then
    rm -rf "$TARGET"
    git clone "$PLUGIN_REPO" "$TARGET"
else
    git clone "$PLUGIN_REPO" "$TARGET"
fi

cd "$EQUICORD_DIR"

step "Installing dependencies (may take a few minutes)"
pnpm install --frozen-lockfile

step "Building Equicord (may take a few minutes)"
pnpm build

step "Patching Discord"
if pgrep -x "Discord" >/dev/null 2>&1 || pgrep -x "discord" >/dev/null 2>&1; then
    echo "Discord appears to be running. Close it fully, then press Enter."
    read -r -p "Press Enter when Discord is closed "
fi
pnpm inject

cat <<'EOF'

Done! Start Discord, then:
  1. Settings -> Plugins -> enable FakeMuteDeafen
  2. Fully restart Discord once more (required - the panel buttons appear after it)

To update the plugin later, just run this script again.
EOF
