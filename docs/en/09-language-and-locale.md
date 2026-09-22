# 09 — Language and locale

Shell supports two interface languages — Spanish (`es`) and English (`en`) — for its own presentation text: startup, the Engram TUI, the final result, and Shell's own errors and commands/states. It never translates external data from Engines, Engram, Claude, or Codex, and never translates commands, paths, identifiers, or proper names (`forge614-shell`, `forge614-engram`, `FORGE614_HOME`, `MCP`, `Codex`, `Claude Code`, …).

## Where the language is stored

`~/.forge614/shell/preferences.json` (or `$FORGE614_HOME/shell/preferences.json`), the same file that already holds Shell's own Claude/Codex model and reasoning preferences:

```json
{
  "format": 1,
  "locale": "es",
  "claude": { "model": "sonnet", "effort": "medium" },
  "codex": { "model": "gpt-5.6-terra", "effort": "high" }
}
```

An older file that only has `claude`/`codex` keys still reads correctly — it is simply treated as having no language preference yet. Corrupt JSON, an unrecognized `format`, or an unsupported `locale` value are all treated the same way: no crash, no preference. Writes are atomic (a temp file in the same directory, then a rename), so a crash mid-write never leaves partial JSON.

## Resolution order

1. `FORGE614_SHELL_LOCALE=es|en` — a valid value always wins for that run and is never saved.
2. `preferences.json`'s `locale` — the persisted choice.
3. Nothing configured — the bilingual selector (`Elige tu idioma / Choose your language`) runs and saves the choice.

The system locale (`LC_ALL`/`LC_MESSAGES`/`LANG`/`LANGUAGE`) only decides which option starts focused on that first-run selector (`es`, `es-MX`, `es_*` focus Español; anything else focuses English) — it never resolves the language by itself, and the selector always runs once until a choice is saved.

The selector runs before any other Shell TUI or visible text, including the spinner that detects installed engines, the engine picker, and `init --product engram` — nothing is shown, and no detection or other work runs, until a locale is settled or the selector is cancelled. It never runs for `--help`, `-h`, `--version`, `-v`, `update`, or `uninstall`: those commands never prompt, but they still resolve and use an effective locale for their own text (`FORGE614_SHELL_LOCALE`, then a saved `preferences.json` locale, then English) — no selector does not mean no translation.

## Changing it

```bash
forge614-shell language        # interactive selector
forge614-shell language es     # set and confirm in Spanish
forge614-shell language en     # set and confirm in English
```

An invalid value (anything other than `es`/`en`) changes nothing and reports a clear error.

## Adding a new language

1. Add the new locale to `src/i18n/types.ts`'s `Locale` union (currently `"es" | "en"`).
2. Create `src/i18n/<locale>.ts` exporting `const <locale>: Catalog = { ... }`. `tsc` fails the build if any key from the shared `Catalog` interface is missing — there is no way to ship an incomplete catalog silently.
3. Register it in `src/i18n/index.ts`'s `catalogs` map and `SUPPORTED_LOCALES`.
4. No business logic changes: every screen already reads its strings from the injected catalog.

## `FORGE614_SHELL_LOCALE` behavior

- Valid (`es` or `en`): used for this run only, never written to `preferences.json`, and always wins over a saved preference.
- Invalid or unset: ignored; Shell falls back to the saved preference, then to the first-run selector.

## Current coverage

Translated: the language selector itself; `forge614-shell language`; `--help`, `update`, `uninstall`, and Shell's own top-level CLI errors; the startup spinner; the visual-interface and engine pickers; the full `init --product engram` flow (all screens, the memory-integration picker and preview, and the final result), including `init`'s own errors (non-interactive terminal, stdin closing for real, a failed alternate-screen start); and the native chat UI for both Claude Code and Codex — the composer, command palette, work-mode hints, sidebar, status bar, `/status` telemetry, chat role labels, the jump-to-latest pill, and every command's own messages (`/login`, `/logout`, `/model`, `/effort`, `/resume`, `/stop`, `/quit`, permission prompts, and so on).

Never translated by design: raw text from Engines/Engram/Claude/Codex (model catalogs, session status lines, tool output, JSON-RPC protocol messages), and commands, paths, environment variable names, and product names (`forge614-shell`, `forge614-engram`, `MCP`, `Claude Code`, `Codex`, …).
