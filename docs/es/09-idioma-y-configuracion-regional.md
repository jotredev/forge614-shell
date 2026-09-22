# 09 — Idioma y configuración regional

Shell soporta dos idiomas de interfaz — español (`es`) e inglés (`en`) — para su propio texto de presentación: inicio, la TUI de Engram, el resultado final, y los errores y comandos/estados propios de Shell. Nunca traduce datos externos de Engines, Engram, Claude o Codex, ni traduce comandos, rutas, identificadores o nombres propios (`forge614-shell`, `forge614-engram`, `FORGE614_HOME`, `MCP`, `Codex`, `Claude Code`, …).

## Dónde se guarda el idioma

`~/.forge614/shell/preferences.json` (o `$FORGE614_HOME/shell/preferences.json`), el mismo archivo que ya guarda las preferencias propias de Shell de modelo y razonamiento para Claude/Codex:

```json
{
  "format": 1,
  "locale": "es",
  "claude": { "model": "sonnet", "effort": "medium" },
  "codex": { "model": "gpt-5.6-terra", "effort": "high" }
}
```

Un archivo antiguo que solo tiene las claves `claude`/`codex` se sigue leyendo correctamente — simplemente se trata como si todavía no tuviera preferencia de idioma. JSON corrupto, un `format` desconocido o un valor de `locale` no compatible se tratan igual: sin fallar, sin preferencia. Las escrituras son atómicas (archivo temporal en la misma carpeta y luego un rename), así que un fallo a mitad de la escritura nunca deja JSON parcial.

## Orden de resolución

1. `FORGE614_SHELL_LOCALE=es|en` — un valor válido siempre gana para esa ejecución y nunca se guarda.
2. El `locale` de `preferences.json` — la elección persistente.
3. Sin nada configurado — se ejecuta el selector bilingüe (`Elige tu idioma / Choose your language`) y guarda la elección.

El idioma del sistema (`LC_ALL`/`LC_MESSAGES`/`LANG`/`LANGUAGE`) solo decide qué opción aparece enfocada la primera vez que corre el selector (`es`, `es-MX`, `es_*` enfocan Español; cualquier otro enfoca English) — nunca resuelve el idioma por sí solo, y el selector siempre se ejecuta hasta que se guarde una elección.

El selector se ejecuta antes de cualquier otra TUI o texto visible de Shell, incluyendo el spinner que detecta motores instalados, el selector de motor e `init --product engram` — no se muestra nada, ni se ejecuta detección u otro trabajo, hasta que el idioma quede resuelto o se cancele el selector. Nunca se ejecuta para `--help`, `-h`, `--version`, `-v`, `update` ni `uninstall`: esos comandos nunca preguntan, pero sí resuelven y usan un idioma efectivo para su propio texto (`FORGE614_SHELL_LOCALE`, luego el `locale` guardado en `preferences.json`, luego inglés) — que no haya selector no significa que no haya traducción.

## Cómo cambiarlo

```bash
forge614-shell language        # selector interactivo
forge614-shell language es     # configurar y confirmar en español
forge614-shell language en     # configurar y confirmar en inglés
```

Un valor inválido (cualquier cosa distinta de `es`/`en`) no cambia nada y muestra un error claro.

## Cómo agregar un idioma nuevo

1. Agrega el nuevo locale a la unión `Locale` en `src/i18n/types.ts` (actualmente `"es" | "en"`).
2. Crea `src/i18n/<locale>.ts` exportando `const <locale>: Catalog = { ... }`. `tsc` hace fallar la compilación si falta alguna clave de la interfaz compartida `Catalog` — no hay forma de publicar un catálogo incompleto en silencio.
3. Regístralo en el mapa `catalogs` y en `SUPPORTED_LOCALES` de `src/i18n/index.ts`.
4. Sin cambios de lógica de negocio: cada pantalla ya lee sus textos del catálogo inyectado.

## Comportamiento de `FORGE614_SHELL_LOCALE`

- Válido (`es` o `en`): se usa solo para esa ejecución, nunca se escribe en `preferences.json`, y siempre gana sobre una preferencia guardada.
- Inválido o sin definir: se ignora; Shell recurre a la preferencia guardada y luego al selector de primer arranque.

## Cobertura actual

Traducido: el selector de idioma mismo; `forge614-shell language`; `--help`, `update`, `uninstall` y los errores propios de Shell a nivel de CLI; el spinner de arranque; los selectores de interfaz visual y de motor; el flujo completo de `init --product engram` (todas las pantallas, el selector de integración de memoria y su vista previa, y el resultado final), incluyendo los errores propios de `init` (terminal no interactiva, cierre real de stdin, fallo al iniciar la pantalla alterna); y la interfaz de chat nativo tanto para Claude Code como para Codex — el compositor, la paleta de comandos, las pistas de modo de trabajo, la barra lateral, la barra de estado, la telemetría de `/status`, las etiquetas de rol del chat, la burbuja de "ir al final", y los mensajes propios de cada comando (`/login`, `/logout`, `/model`, `/effort`, `/resume`, `/stop`, `/quit`, las solicitudes de permiso, etc.).

Nunca traducido por diseño: el texto crudo de Engines/Engram/Claude/Codex (catálogos de modelos, líneas de estado de sesión, salida de herramientas, mensajes del protocolo JSON-RPC), y los comandos, rutas, nombres de variables de entorno y nombres de producto (`forge614-shell`, `forge614-engram`, `MCP`, `Claude Code`, `Codex`, …).
