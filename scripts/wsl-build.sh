#!/bin/bash
# Local Android release build in WSL (Ubuntu): builds the latest commit on `main` of the Windows
# checkout with `eas build --local`, which uses the same signing key and remote build numbers as
# EAS cloud builds but not the cloud build allowance. The .aab lands in Windows Downloads.
#
#   bash scripts/wsl-build.sh [profile]      (default: production)
#
# One-off setup: scripts/wsl-build-setup.sh, then `eas login` in WSL.
# Optional: ~/.config/novel-route/build.env with `export SENTRY_AUTH_TOKEN=...` (chmod 600) so
# source maps reach Sentry. EAS "secret" variables aren't available to local builds; without it
# the upload is skipped and crash stack traces from this build stay minified.
set -euo pipefail

PROFILE="${1:-production}"
WIN_USER="$(whoami)"
WIN_REPO="/mnt/c/Users/$WIN_USER/Documents/projects/streetlibrary-catchemall"
SRC="$HOME/src/novel-route"
DOWNLOADS="/mnt/c/Users/$WIN_USER/Downloads"

export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
export JAVA_HOME="$HOME/opt/jdk-17"
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

eas whoami >/dev/null 2>&1 || { echo "Not logged in to Expo: run 'eas login' in WSL first."; exit 1; }

# A Linux-side copy of the repo (building on /mnt/c is slow and mangles line endings).
[ -d "$SRC/.git" ] || git clone -q "$WIN_REPO" "$SRC"
cd "$SRC"
git fetch -q "$WIN_REPO" main
git checkout -q --detach FETCH_HEAD
COMMIT="$(git rev-parse --short HEAD)"
echo "Building $COMMIT ($(git log -1 --format=%s)) with profile '$PROFILE'"

npm ci --no-audit --no-fund --loglevel=error

if [ -f "$HOME/.config/novel-route/build.env" ]; then
  # Accepts `SENTRY_AUTH_TOKEN=...` as Sentry's copy button gives it, with or without `export`.
  . "$HOME/.config/novel-route/build.env"
fi
if [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then
  export SENTRY_AUTH_TOKEN
else
  echo "Note: no SENTRY_AUTH_TOKEN, so source maps won't be uploaded for this build."
  export SENTRY_DISABLE_AUTO_UPLOAD=true
fi

OUT="$HOME/builds/novel-route-$PROFILE-$COMMIT.aab"
mkdir -p "$HOME/builds"
cd apps/mobile
eas build --platform android --profile "$PROFILE" --local --non-interactive --output "$OUT"

cp "$OUT" "$DOWNLOADS/"
echo "Done: $DOWNLOADS/$(basename "$OUT")"
