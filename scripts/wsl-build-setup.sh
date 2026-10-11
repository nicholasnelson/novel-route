#!/bin/bash
# One-off setup for local Android release builds in WSL (Ubuntu), so `eas build --local`
# can make Play Store builds without using the EAS cloud build allowance.
# Everything goes under $HOME: no sudo needed. Safe to re-run; finished steps are skipped.
# See docs/release-plan.md "Local builds".
set -euo pipefail

NODE_MAJOR=22
JDK_URL="https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip"
JDK_DIR="$HOME/opt/jdk-17"
SDK_DIR="$HOME/Android/Sdk"
WINDOWS_SDK="/mnt/c/Users/$(whoami)/AppData/Local/Android/Sdk"

# Node (nvm is already installed) and the EAS CLI.
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install "$NODE_MAJOR" >/dev/null
nvm alias default "$NODE_MAJOR" >/dev/null
command -v eas >/dev/null || npm install -g eas-cli >/dev/null
echo "node $(node --version), eas $(eas --version | head -1)"

# Java 17 (what React Native's Gradle build expects).
if [ ! -x "$JDK_DIR/bin/java" ]; then
  mkdir -p "$JDK_DIR"
  curl -fsSL "$JDK_URL" | tar -xz -C "$JDK_DIR" --strip-components=1
fi
export JAVA_HOME="$JDK_DIR"
echo "$("$JAVA_HOME/bin/java" -version 2>&1 | head -1)"

# Android command-line tools (unzip isn't installed, so Python extracts the zip).
if [ ! -x "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
  mkdir -p "$SDK_DIR/cmdline-tools"
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/tools.zip" "$CMDLINE_TOOLS_URL"
  python3 -m zipfile -e "$tmp/tools.zip" "$tmp"
  rm -rf "$SDK_DIR/cmdline-tools/latest"
  mv "$tmp/cmdline-tools" "$SDK_DIR/cmdline-tools/latest"
  chmod +x "$SDK_DIR/cmdline-tools/latest/bin/"*
  rm -rf "$tmp"
fi

# The SDK licences already accepted for the Windows Android SDK on this machine.
if [ -d "$WINDOWS_SDK/licenses" ]; then
  mkdir -p "$SDK_DIR/licenses"
  cp -n "$WINDOWS_SDK/licenses/"* "$SDK_DIR/licenses/"
fi

export ANDROID_HOME="$SDK_DIR"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36.0.0" >/dev/null
echo "Android SDK: $(ls "$SDK_DIR/platforms")"

# Environment for future shells.
if ! grep -q "# novel-route local builds" "$HOME/.bashrc"; then
  cat >> "$HOME/.bashrc" <<RC

# novel-route local builds (scripts/wsl-build-setup.sh)
export JAVA_HOME="$JDK_DIR"
export ANDROID_HOME="$SDK_DIR"
export PATH="\$JAVA_HOME/bin:\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$PATH"
RC
fi
echo "Done. Next: 'eas login' once, then scripts/wsl-build.sh."
