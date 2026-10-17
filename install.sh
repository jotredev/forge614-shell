#!/bin/sh
NODE_NAME="shell"
REPO="jotredev/forge614-shell"
set -u
locale=${FORGE614_LOCALE:-${FORGE614_SHELL_LOCALE:-es}}
if ! command -v node >/dev/null 2>&1; then
  if [ "${locale#en}" != "$locale" ]; then echo "Forge614 requires Node.js 22.19.0 or later to install. Install it with Homebrew: brew install node; on Linux, use your distribution's package manager or https://nodejs.org; on Windows, use winget install OpenJS.NodeJS.LTS or https://nodejs.org. Then run this installer again." >&2
  else echo "Forge614 necesita Node.js 22.19.0 o posterior para instalarse. Instálalo con Homebrew: brew install node; en Linux, con el gestor de paquetes de tu distribución o desde https://nodejs.org; en Windows, con winget install OpenJS.NodeJS.LTS o desde https://nodejs.org. Después vuelve a ejecutar este instalador." >&2; fi
  exit 65
fi
node -e 'const a=process.versions.node.split(".").map(Number); process.exit(a[0]>22||a[0]===22&&a[1]>=19?0:1)' || {
  if [ "${locale#en}" != "$locale" ]; then echo "Forge614 requires Node.js 22.19.0 or later to install. Install it with Homebrew: brew install node; on Linux, use your distribution's package manager or https://nodejs.org; on Windows, use winget install OpenJS.NodeJS.LTS or https://nodejs.org. Then run this installer again." >&2
  else echo "Forge614 necesita Node.js 22.19.0 o posterior para instalarse. Instálalo con Homebrew: brew install node; en Linux, con el gestor de paquetes de tu distribución o desde https://nodejs.org; en Windows, con winget install OpenJS.NodeJS.LTS o desde https://nodejs.org. Después vuelve a ejecutar este instalador." >&2; fi
  exit 65
}
tag=latest
resolve_tag() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version) [ "$#" -ge 2 ] && [ -n "$2" ] || return 64; printf '%s' "$2"; return 0 ;;
      --latest) printf latest; return 0 ;;
    esac
    shift
  done
  printf latest
}
tag=$(resolve_tag "$@")
tag_status=$?
[ "$tag_status" -eq 0 ] || { echo "invalid value for --version" >&2; exit 64; }
if [ "$tag" != latest ]; then
  case "$tag" in v*) version=${tag#v} ;; *) version=$tag ;; esac
  node -e 'process.exit(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(process.argv[1])?0:1)' "$version" || { echo "invalid version tag" >&2; exit 64; }
fi
base=${FORGE614_INSTALL_TEST_BASE_URL:-https://github.com/$REPO/releases}
if [ -n "${FORGE614_INSTALL_TEST_BASE_URL:-}" ]; then
  node -e 'const u=new URL(process.argv[1]);process.exit(u.protocol==="http:"&&(u.hostname==="127.0.0.1"||u.hostname==="[::1]")&&u.port&&!u.username&&!u.password&&u.pathname==="/"&&!u.search&&!u.hash?0:1)' "$base" || { echo "FORGE614_INSTALL_TEST_BASE_URL only accepts loopback HTTP." >&2; exit 64; }
fi
if [ "$tag" = latest ]; then
  api=${FORGE614_INSTALL_TEST_BASE_URL:+$FORGE614_INSTALL_TEST_BASE_URL/repos/$REPO/releases/latest}
  [ -n "$api" ] || api=https://api.github.com/repos/$REPO/releases/latest
  if [ -n "${FORGE614_INSTALL_TEST_BASE_URL:-}" ]; then
    tag=$(curl -fsSL "$api" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).tag_name))') || exit 66
  else
    tag=$(curl -fsSL --proto '=https' --tlsv1.2 "$api" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).tag_name))') || exit 66
  fi
fi
case "$tag" in v*) ;; *) tag=v$tag ;; esac
version=${tag#v}
node -e 'process.exit(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(process.argv[1])?0:1)' "$version" || { echo "invalid version tag" >&2; exit 64; }
download_base=$base/download/$tag
case "$base" in http://*) download_base=$base/repos/$REPO/releases/download/$tag ;; esac
tmp=$(mktemp -d "${TMPDIR:-/tmp}/.install-XXXXXX") || exit 66
trap '[ -z "${tmp:-}" ] || rm -rf "$tmp"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
fetch_file() {
  if [ -n "${FORGE614_INSTALL_TEST_BASE_URL:-}" ]; then curl -fsSL "$1" -o "$2"
  else curl -fsSL --proto '=https' --tlsv1.2 "$1" -o "$2"; fi
}
for file in install.mjs forge614.node.json SHA256SUMS; do fetch_file "$download_base/$file" "$tmp/$file" || exit 66; done
for file in install.mjs forge614.node.json; do
  expected=$(awk -v name="$file" '$2==name{print $1}' "$tmp/SHA256SUMS")
  [ "${#expected}" -eq 64 ] || { echo "invalid SHA256SUMS entry: $file" >&2; exit 66; }
  if command -v shasum >/dev/null 2>&1; then actual=$(shasum -a 256 "$tmp/$file" | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$tmp/$file" | awk '{print $1}')
  else echo "SHA-256 utility is required." >&2; exit 65; fi
  [ "$actual" = "$expected" ] || { echo "SHA-256 mismatch: $file" >&2; exit 66; }
done
FORGE614_INSTALL_REPOSITORY=$REPO FORGE614_INSTALL_NODE=$NODE_NAME node "$tmp/install.mjs" "$@"
status=$?
exit "$status"
