#!/usr/bin/env bash
set -euo pipefail

# Locale for this installer's own presentation text only — never for secrets, paths, or any data.
# Forge614 Shell passes its own resolved language through this exact variable when it spawns this
# script; run directly (curl | bash, or before Shell has any saved preference), only "en" or "es"
# are accepted and anything else falls back to English. Never trust FORGE614_SHELL_LOCALE for
# anything beyond picking which fixed string below to print.
case "${FORGE614_SHELL_LOCALE:-}" in
  en|es) locale="$FORGE614_SHELL_LOCALE" ;;
  *) locale="en" ;;
esac

# `t <key> [args...]` prints this installer's own message `key` in the resolved locale. Never used
# for anything Shell received from Engines/Engram/GitHub/the network — those already-external
# strings (e.g. release metadata errors) are reported with their own literal text, unwrapped.
t() {
  local key="$1"; shift || true
  case "$locale:$key" in
    en:usage) echo "Usage: install.sh [--latest | --uninstall | --archive <forge614-shell-<version>.tar.gz>]" ;;
    es:usage) echo "Uso: install.sh [--latest | --uninstall | --archive <forge614-shell-<version>.tar.gz>]" ;;
    en:platform_unsupported) echo "Forge614 Shell supports macOS and Linux only." ;;
    es:platform_unsupported) echo "Forge614 Shell solo es compatible con macOS y Linux." ;;
    en:requires_command) echo "Forge614 Shell requires $1." ;;
    es:requires_command) echo "Forge614 Shell requiere $1." ;;
    en:requires_curl_latest) echo "Forge614 Shell requires curl to download the latest release." ;;
    es:requires_curl_latest) echo "Forge614 Shell requiere curl para descargar la última versión." ;;
    en:requires_checksum_tool) echo "Forge614 Shell requires shasum or sha256sum to verify downloads." ;;
    es:requires_checksum_tool) echo "Forge614 Shell requiere shasum o sha256sum para verificar las descargas." ;;
    en:requires_node_version) echo "Forge614 Shell requires Node.js 22.19 or newer." ;;
    es:requires_node_version) echo "Forge614 Shell requiere Node.js 22.19 o más reciente." ;;
    en:engines_using_compatible) echo "Using compatible Forge614 Engines (schema v$1)." ;;
    es:engines_using_compatible) echo "Usando Forge614 Engines compatible (esquema v$1)." ;;
    en:engines_installing) echo "Installing required Forge614 Engines (schema v$1)." ;;
    es:engines_installing) echo "Instalando Forge614 Engines requerido (esquema v$1)." ;;
    en:engines_requires_curl) echo "Forge614 Shell requires curl to install Forge614 Engines." ;;
    es:engines_requires_curl) echo "Forge614 Shell requiere curl para instalar Forge614 Engines." ;;
    en:engines_download_failed) echo "Could not download the Forge614 Engines installer." ;;
    es:engines_download_failed) echo "No se pudo descargar el instalador de Forge614 Engines." ;;
    en:engines_install_failed) echo "Forge614 Engines installation failed; Forge614 Shell was not changed." ;;
    es:engines_install_failed) echo "Falló la instalación de Forge614 Engines; Forge614 Shell no se modificó." ;;
    en:engines_incompatible) echo "Installed Forge614 Engines is not compatible with Forge614 Shell; Forge614 Shell was not changed." ;;
    es:engines_incompatible) echo "El Forge614 Engines instalado no es compatible con Forge614 Shell; Forge614 Shell no se modificó." ;;
    en:uninstall_removes) echo "This removes Forge614 Shell from $1." ;;
    es:uninstall_removes) echo "Esto elimina Forge614 Shell de $1." ;;
    en:uninstall_other_tools_unchanged) echo "Engram, Atlas, and other Forge614 tools are unchanged." ;;
    es:uninstall_other_tools_unchanged) echo "Engram, Atlas y otras herramientas de Forge614 no cambian." ;;
    en:uninstall_continue_prompt) echo "Continue? [y/N] " ;;
    es:uninstall_continue_prompt) echo "¿Continuar? [y/N] " ;;
    en:uninstall_cancelled) echo "Uninstall cancelled." ;;
    es:uninstall_cancelled) echo "Desinstalación cancelada." ;;
    en:uninstall_done) echo "Forge614 Shell was uninstalled. Other Forge614 tools are unchanged." ;;
    es:uninstall_done) echo "Forge614 Shell se desinstaló. Las demás herramientas de Forge614 no cambiaron." ;;
    en:release_metadata_failed) echo "Could not download Forge614 Shell release metadata." ;;
    es:release_metadata_failed) echo "No se pudo descargar la información de la versión de Forge614 Shell." ;;
    en:release_assets_invalid) echo "Latest release is missing valid Forge614 Shell assets." ;;
    es:release_assets_invalid) echo "La última versión no tiene archivos válidos de Forge614 Shell." ;;
    en:download_failed) echo "Could not download Forge614 Shell v$1." ;;
    es:download_failed) echo "No se pudo descargar Forge614 Shell v$1." ;;
    en:checksum_download_failed) echo "Could not download the Forge614 Shell checksum." ;;
    es:checksum_download_failed) echo "No se pudo descargar la suma de verificación de Forge614 Shell." ;;
    en:checksum_failed) echo "Forge614 Shell download checksum failed." ;;
    es:checksum_failed) echo "Falló la verificación de la descarga de Forge614 Shell." ;;
    en:archive_not_found) echo "Release archive not found: $1" ;;
    es:archive_not_found) echo "No se encontró el archivo de la versión: $1" ;;
    en:archive_invalid) echo "Invalid Forge614 Shell release archive." ;;
    es:archive_invalid) echo "El archivo de la versión de Forge614 Shell no es válido." ;;
    en:version_invalid) echo "Invalid Forge614 Shell release version." ;;
    es:version_invalid) echo "La versión de Forge614 Shell no es válida." ;;
    en:already_active) echo "Forge614 Shell v$1 is already active." ;;
    es:already_active) echo "Forge614 Shell v$1 ya está activo." ;;
    en:installed) echo "Installed Forge614 Shell v$1" ;;
    es:installed) echo "Se instaló Forge614 Shell v$1" ;;
    en:configured_profile) echo "Configured $1 so forge614-shell is available in new Terminal windows." ;;
    es:configured_profile) echo "Se configuró $1 para que forge614-shell esté disponible en nuevas ventanas de Terminal." ;;
    en:close_reopen_terminal) echo "Close and reopen Terminal, then run: forge614-shell" ;;
    es:close_reopen_terminal) echo "Cierra y vuelve a abrir Terminal, luego ejecuta: forge614-shell" ;;
  esac
}

mode="latest"
archive=""
if [[ $# -eq 0 || ( $# -eq 1 && "$1" == "--latest" ) ]]; then
  mode="latest"
elif [[ $# -eq 1 && "$1" == "--uninstall" ]]; then
  mode="uninstall"
elif [[ $# -eq 2 && "$1" == "--archive" ]]; then
  mode="archive"; archive="$2"
else
  t usage >&2; exit 64
fi
case "$(uname -s)" in Darwin|Linux) ;; *) t platform_unsupported >&2; exit 69 ;; esac
for command in node tar; do command -v "$command" >/dev/null 2>&1 || { t requires_command "$command" >&2; exit 69; }; done
[[ "$mode" != "latest" ]] || command -v curl >/dev/null 2>&1 || { t requires_curl_latest >&2; exit 69; }
command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1 || { t requires_checksum_tool >&2; exit 69; }
[[ "$(node -p 'const [a,b]=process.versions.node.split(".").map(Number); a>22||(a===22&&b>=19)?"ok":"old"')" == "ok" ]] || { t requires_node_version >&2; exit 69; }

forge_home="${FORGE614_HOME:-$HOME/.forge614}"
temporary="$(mktemp -d)"
cleanup() { rm -rf "$temporary"; }
trap cleanup EXIT

engines_schema_version=1
engines_binary="$forge_home/engines/bin/forge614-engines"

engines_is_compatible() {
  [[ -x "$engines_binary" ]] || return 1
  local report
  report="$("$engines_binary" detect 2>/dev/null)" || return 1
  printf '%s' "$report" | node -e '
let report;
try { report = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { process.exit(1); }
const expected = Number(process.argv[1]);
if (report?.schemaVersion !== expected || !Array.isArray(report?.agents)) process.exit(1);
' "$engines_schema_version"
}

ensure_engines() {
  if engines_is_compatible; then
    t engines_using_compatible "$engines_schema_version"
    return 0
  fi

  local installer_url installer
  installer_url="${FORGE614_ENGINES_INSTALLER_URL:-https://github.com/jotredev/forge614-engines/releases/latest/download/install.sh}"
  installer="$temporary/forge614-engines-install.sh"
  t engines_installing "$engines_schema_version"
  command -v curl >/dev/null 2>&1 || { t engines_requires_curl >&2; return 69; }
  curl --fail --silent --show-error --location --output "$installer" "$installer_url" || { t engines_download_failed >&2; return 65; }
  FORGE614_HOME="$forge_home" FORGE614_SHELL_LOCALE="$locale" bash "$installer" --latest || { t engines_install_failed >&2; return 65; }
  engines_is_compatible || { t engines_incompatible >&2; return 65; }
}

if [[ "$mode" == "uninstall" ]]; then
  shell_root="$forge_home/shell"
  case "${SHELL##*/}" in zsh) profile="$HOME/.zshrc" ;; bash) profile="$HOME/.bashrc" ;; *) profile="$HOME/.profile" ;; esac
  path_line="export PATH=\"$shell_root/bin:\$PATH\""
  t uninstall_removes "$shell_root"
  t uninstall_other_tools_unchanged
  printf '%s' "$(t uninstall_continue_prompt)"
  if ! read -r answer || [[ "$answer" != "y" && "$answer" != "Y" ]]; then t uninstall_cancelled; exit 0; fi
  rm -rf "$shell_root"
  if [[ -f "$profile" ]]; then
    node - "$profile" "$path_line" <<'NODE'
const fs = require("fs");
const [profile, line] = process.argv.slice(2);
const lines = fs.readFileSync(profile, "utf8").split("\n");
const index = lines.indexOf(line);
if (index >= 0) {
  lines.splice(index, 1);
  if (index > 0 && lines[index - 1] === "# Forge614 Shell") lines.splice(index - 1, 1);
  fs.writeFileSync(profile, lines.join("\n"));
}
NODE
  fi
  t uninstall_done
  exit 0
fi

if [[ "$mode" == "latest" ]]; then
  api_url="${FORGE614_RELEASE_API_URL:-https://api.github.com/repos/jotredev/forge614-shell/releases/latest}"
  if ! release_json="$(curl --fail --silent --show-error --location "$api_url")"; then t release_metadata_failed >&2; exit 65; fi
  if ! release_info="$(printf '%s' "$release_json" | node -e '
let r; try { r=JSON.parse(require("fs").readFileSync(0,"utf8")); } catch { process.exit(1); }
const v=typeof r.tag_name==="string"?r.tag_name.replace(/^v/,""):"";
if(!/^\d+\.\d+\.\d+$/.test(v)||!Array.isArray(r.assets))process.exit(1);
const n=`forge614-shell-${v}.tar.gz`, pick=x=>r.assets.filter(a=>a&&a.name===x);
const a=pick(n), c=pick(`${n}.sha256`); if(a.length!==1||c.length!==1)process.exit(1);
const ok=u=>{try{const p=new URL(u);return p.protocol==="https:"||(process.env.FORGE614_RELEASE_API_URL&&p.protocol==="http:");}catch{return false;}};
if(!ok(a[0].browser_download_url)||!ok(c[0].browser_download_url))process.exit(1);
process.stdout.write(`${v}\t${a[0].browser_download_url}\t${c[0].browser_download_url}`);
  ')"; then t release_assets_invalid >&2; exit 65; fi
  IFS=$'\t' read -r version archive_url checksum_url <<< "$release_info"
  [[ -n "$version" && -n "$archive_url" && -n "$checksum_url" ]] || { t release_assets_invalid >&2; exit 65; }
  archive="$temporary/forge614-shell-$version.tar.gz"; checksum="$archive.sha256"
  curl --fail --silent --show-error --location --output "$archive" "$archive_url" || { t download_failed "$version" >&2; exit 65; }
  curl --fail --silent --show-error --location --output "$checksum" "$checksum_url" || { t checksum_download_failed >&2; exit 65; }
  if command -v shasum >/dev/null 2>&1; then (cd "$temporary" && shasum -a 256 -c "$(basename "$checksum")") || { t checksum_failed >&2; exit 65; }; else (cd "$temporary" && sha256sum -c "$(basename "$checksum")") || { t checksum_failed >&2; exit 65; }; fi
elif [[ ! -f "$archive" ]]; then
  t archive_not_found "$archive" >&2; exit 66
fi

ensure_engines || exit $?

extracted="$temporary/extracted"; mkdir -p "$extracted"
tar -xzf "$archive" -C "$extracted" || { t archive_invalid >&2; exit 65; }
release_root="$(find "$extracted" -mindepth 1 -maxdepth 1 -type d -name 'forge614-shell-*' -print -quit)"
[[ -n "$release_root" && -f "$release_root/package.json" && -f "$release_root/dist/cli.js" ]] || { t archive_invalid >&2; exit 65; }
version="$(node -e 'console.log(require(process.argv[1]).version)' "$release_root/package.json")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { t version_invalid >&2; exit 65; }
shell_root="$forge_home/shell"; target="$shell_root/$version"; active_link="$shell_root/bin/forge614-shell"
if [[ -L "$active_link" && "$(readlink "$active_link")" == "$target/dist/cli.js" ]]; then t already_active "$version"; exit 0; fi
staged="$shell_root/.${version}.installing"; mkdir -p "$shell_root" "$shell_root/bin"; rm -rf "$staged"; mv "$release_root" "$staged"; rm -rf "$target"; mv "$staged" "$target"; ln -sfn "$target/dist/cli.js" "$active_link"
case "${SHELL##*/}" in zsh) profile="$HOME/.zshrc" ;; bash) profile="$HOME/.bashrc" ;; *) profile="$HOME/.profile" ;; esac
path_line="export PATH=\"$shell_root/bin:\$PATH\""
old_path_line="export PATH=\"$forge_home/bin:\$PATH\""
if [[ -f "$profile" ]]; then
  node - "$profile" "$old_path_line" <<'NODE'
const fs = require("fs");
const [profile, line] = process.argv.slice(2);
const lines = fs.readFileSync(profile, "utf8").split("\n");
const index = lines.indexOf(line);
if (index >= 0) {
  lines.splice(index, 1);
  if (index > 0 && lines[index - 1] === "# Forge614 Shell") lines.splice(index - 1, 1);
  fs.writeFileSync(profile, lines.join("\n"));
}
NODE
fi
legacy_link="$forge_home/bin/forge614-shell"
if [[ -L "$legacy_link" || -f "$legacy_link" ]]; then rm -f "$legacy_link"; fi
rmdir "$forge_home/bin" 2>/dev/null || true
grep -Fqx "$path_line" "$profile" 2>/dev/null || printf '\n# Forge614 Shell\n%s\n' "$path_line" >> "$profile"
t installed "$version"
t configured_profile "$profile"
t close_reopen_terminal
