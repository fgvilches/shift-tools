#!/usr/bin/env bash
# Release build with the updater signing key.
#
# `createUpdaterArtifacts` is on, so an unsigned build fails at bundle time.
# The key never goes on the command line (it would show up in `ps`): it is read
# from a file and exported for this process only.
set -euo pipefail

KEY_FILE="${TAURI_KEY_FILE:-$HOME/.tauri/shift-tools.key}"
PASS_FILE="${TAURI_KEY_PASSWORD_FILE:-$HOME/.tauri/shift-tools.key.password}"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "missing signing key: $KEY_FILE" >&2
  echo "generate one with: npx tauri signer generate -w \"$KEY_FILE\"" >&2
  exit 1
fi

export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_FILE")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
if [[ -f "$PASS_FILE" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$PASS_FILE")"
fi

npx tauri build "$@"

# Tauri writes the updater tarball but does not always emit its .sig, and a
# stale .sig is worse than none: every install fails verification. Sign the
# tarball the build just produced, overwriting whatever was there.
shopt -s nullglob
for f in src-tauri/target/release/bundle/macos/*.app.tar.gz \
         src-tauri/target/*/release/bundle/macos/*.app.tar.gz; do
  [[ -f "$f" ]] || continue
  echo "signing $f"
  npx tauri signer sign "$f" > /dev/null
done
