#!/usr/bin/env bash
set -euo pipefail

mode="latest"
archive=""
if [[ $# -eq 0 || ( $# -eq 1 && "$1" == "--latest" ) ]]; then
  mode="latest"
elif [[ $# -eq 2 && "$1" == "--archive" ]]; then
  mode="archive"; archive="$2"
else
  echo "Usage: install.sh [--latest | --archive <forge614-shell-<version>.tar.gz>]" >&2; exit 64
fi
case "$(uname -s)" in Darwin|Linux) ;; *) echo "Forge614 Shell supports macOS and Linux only." >&2; exit 69 ;; esac
for command in node tar; do command -v "$command" >/dev/null 2>&1 || { echo "Forge614 Shell requires $command." >&2; exit 69; }; done
[[ "$mode" != "latest" ]] || command -v curl >/dev/null 2>&1 || { echo "Forge614 Shell requires curl to download the latest release." >&2; exit 69; }
command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1 || { echo "Forge614 Shell requires shasum or sha256sum to verify downloads." >&2; exit 69; }
[[ "$(node -p 'const [a,b]=process.versions.node.split(".").map(Number); a>22||(a===22&&b>=19)?"ok":"old"')" == "ok" ]] || { echo "Forge614 Shell requires Node.js 22.19 or newer." >&2; exit 69; }

forge_home="${FORGE614_HOME:-$HOME/.forge614}"
temporary="$(mktemp -d)"
cleanup() { rm -rf "$temporary"; }
trap cleanup EXIT

if [[ "$mode" == "latest" ]]; then
  api_url="${FORGE614_RELEASE_API_URL:-https://api.github.com/repos/jotredev/forge614-shell/releases/latest}"
  if ! release_json="$(curl --fail --silent --show-error --location "$api_url")"; then echo "Could not download Forge614 Shell release metadata." >&2; exit 65; fi
  if ! release_info="$(printf '%s' "$release_json" | node -e '
let r; try { r=JSON.parse(require("fs").readFileSync(0,"utf8")); } catch { process.exit(1); }
const v=typeof r.tag_name==="string"?r.tag_name.replace(/^v/,""):"";
if(!/^\d+\.\d+\.\d+$/.test(v)||!Array.isArray(r.assets))process.exit(1);
const n=`forge614-shell-${v}.tar.gz`, pick=x=>r.assets.filter(a=>a&&a.name===x);
const a=pick(n), c=pick(`${n}.sha256`); if(a.length!==1||c.length!==1)process.exit(1);
const ok=u=>{try{const p=new URL(u);return p.protocol==="https:"||(process.env.FORGE614_RELEASE_API_URL&&p.protocol==="http:");}catch{return false;}};
if(!ok(a[0].browser_download_url)||!ok(c[0].browser_download_url))process.exit(1);
process.stdout.write(`${v}\t${a[0].browser_download_url}\t${c[0].browser_download_url}`);
  ')"; then echo "Latest release is missing valid Forge614 Shell assets." >&2; exit 65; fi
  IFS=$'\t' read -r version archive_url checksum_url <<< "$release_info"
  [[ -n "$version" && -n "$archive_url" && -n "$checksum_url" ]] || { echo "Latest release is missing valid Forge614 Shell assets." >&2; exit 65; }
  archive="$temporary/forge614-shell-$version.tar.gz"; checksum="$archive.sha256"
  curl --fail --silent --show-error --location --output "$archive" "$archive_url" || { echo "Could not download Forge614 Shell v$version." >&2; exit 65; }
  curl --fail --silent --show-error --location --output "$checksum" "$checksum_url" || { echo "Could not download the Forge614 Shell checksum." >&2; exit 65; }
  if command -v shasum >/dev/null 2>&1; then (cd "$temporary" && shasum -a 256 -c "$(basename "$checksum")") || { echo "Forge614 Shell download checksum failed." >&2; exit 65; }; else (cd "$temporary" && sha256sum -c "$(basename "$checksum")") || { echo "Forge614 Shell download checksum failed." >&2; exit 65; }; fi
elif [[ ! -f "$archive" ]]; then
  echo "Release archive not found: $archive" >&2; exit 66
fi

extracted="$temporary/extracted"; mkdir -p "$extracted"
tar -xzf "$archive" -C "$extracted" || { echo "Invalid Forge614 Shell release archive." >&2; exit 65; }
release_root="$(find "$extracted" -mindepth 1 -maxdepth 1 -type d -name 'forge614-shell-*' -print -quit)"
[[ -n "$release_root" && -f "$release_root/package.json" && -f "$release_root/dist/cli.js" ]] || { echo "Invalid Forge614 Shell release archive." >&2; exit 65; }
version="$(node -e 'console.log(require(process.argv[1]).version)' "$release_root/package.json")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid Forge614 Shell release version." >&2; exit 65; }
shell_root="$forge_home/shell"; target="$shell_root/$version"; active_link="$forge_home/bin/forge614-shell"
if [[ -L "$active_link" && "$(readlink "$active_link")" == "$target/dist/cli.js" ]]; then echo "Forge614 Shell v$version is already active."; exit 0; fi
staged="$shell_root/.${version}.installing"; mkdir -p "$shell_root" "$forge_home/bin"; rm -rf "$staged"; mv "$release_root" "$staged"; rm -rf "$target"; mv "$staged" "$target"; ln -sfn "$target/dist/cli.js" "$active_link"
case "${SHELL##*/}" in zsh) profile="$HOME/.zshrc" ;; bash) profile="$HOME/.bashrc" ;; *) profile="$HOME/.profile" ;; esac
path_line="export PATH=\"$forge_home/bin:\$PATH\""
grep -Fqx "$path_line" "$profile" 2>/dev/null || printf '\n# Forge614 Shell\n%s\n' "$path_line" >> "$profile"
echo "Installed Forge614 Shell v$version"
echo "Configured $profile so forge614-shell is available in new Terminal windows."
echo "Close and reopen Terminal, then run: forge614-shell"
