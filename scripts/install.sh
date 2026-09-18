#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--archive" || -z "${2:-}" || $# -ne 2 ]]; then
  echo "Usage: bash scripts/install.sh --archive /path/to/forge614-shell-<version>.tar.gz" >&2
  exit 64
fi

archive="$2"
if [[ ! -f "$archive" ]]; then
  echo "Release archive not found: $archive" >&2
  exit 66
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Forge614 Shell requires Node.js 22.19 or newer." >&2
  exit 69
fi

forge_home="${FORGE614_HOME:-$HOME/.forge614}"
temporary="$(mktemp -d)"
cleanup() { rm -rf "$temporary"; }
trap cleanup EXIT

tar -xzf "$archive" -C "$temporary"
release_root="$(find "$temporary" -mindepth 1 -maxdepth 1 -type d -name 'forge614-shell-*' -print -quit)"
if [[ -z "$release_root" || ! -f "$release_root/package.json" || ! -f "$release_root/dist/cli.js" ]]; then
  echo "Invalid Forge614 Shell release archive." >&2
  exit 65
fi

version="$(node -e 'console.log(require(process.argv[1]).version)' "$release_root/package.json")"
shell_root="$forge_home/shell"
target="$shell_root/$version"
staged="$shell_root/.${version}.installing"
mkdir -p "$shell_root" "$forge_home/bin"
rm -rf "$staged"
mv "$release_root" "$staged"
rm -rf "$target"
mv "$staged" "$target"
ln -sfn "$target/dist/cli.js" "$forge_home/bin/forge614-shell"

case "${SHELL##*/}" in
  zsh) profile="$HOME/.zshrc" ;;
  bash) profile="$HOME/.bashrc" ;;
  *) profile="$HOME/.profile" ;;
esac
path_line="export PATH=\"$forge_home/bin:\$PATH\""
if ! grep -Fqx "$path_line" "$profile" 2>/dev/null; then
  printf '\n# Forge614 Shell\n%s\n' "$path_line" >> "$profile"
fi

echo "Installed Forge614 Shell v$version"
echo "Configured $profile so forge614-shell is available in new Terminal windows."
echo "Close and reopen Terminal, then run: forge614-shell"
