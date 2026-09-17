# 03 — Primera entrega de la etapa 2: Lanzador e integración con Pi

Fecha: 2026-09-17 · Etapa 02: implementación del entorno base (en curso) · Revisión documental: 1 · [English](../en/03-stage-2-first-delivery.md) · [Índice](../../README.md)

Este documento registra la primera entrega técnica de la etapa 2 de Forge614-Shell. La etapa 2 **no está completada en su totalidad**; esta entrega establece el lanzador ejecutable, el aislamiento de perfil e historial, la extensión de identidad y la verificación de arranque sobre Pi.

---

## 1. Resumen de la entrega

Forge614-Shell cuenta con su primer binario funcional (`forge614-shell`), construido en TypeScript sobre Bun y Node.js, que empaqueta e inicia el motor Pi (`@earendil-works/pi-coding-agent` v0.85.1) bajo una identidad propia, con un perfil de configuración y almacenamiento de sesiones completamente desacoplado del Pi habitual del usuario.

Se ejecutaron y superaron el typecheck estricto, 4 pruebas automatizadas con Bun test y la compilación a `dist/cli.js`.

---

## 2. Lo implementado por Forge614-Shell

Forge614-Shell aporta la capa de personalización, aislamiento y empaquetado descrita a continuación:

### Lanzador y empaquetado (`src/cli.ts` y `src/launcher.ts`)
- **Dependencia directa de Pi:** Pi (`@earendil-works/pi-coding-agent` y `@earendil-works/pi-tui`) está declarado como dependencia directa en `package.json`. El usuario no necesita tener Pi instalado de forma global.
- **Resolución dinámica:** El CLI localiza la raíz y el binario de Pi mediante `import.meta.resolve`, preparando el entorno de ejecución sin rutas fijas dependientes de la máquina.
- **Invocación en proceso:** Ejecuta Pi directamente vía `await import(...)`, permitiendo que Pi tome el control de la terminal interactiva (TUI) y gestione las señales de interrupción (`SIGINT`, `SIGTERM`) sin requerir un demonio ni agente en segundo plano.
- **Opciones de línea de comandos:** Soporta flags estándar (`--help` / `-h`, `--version` / `-v`), flags de sesión (`--continue` / `-c`, `--resume` / `-r`) y reenvío transparente de argumentos adicionales al motor Pi.

### Aislamiento estricto de perfil y sesiones
- **Ruta de perfil dedicada:** Por defecto en `~/.forge614-shell/agent`, configurable mediante la variable de entorno `FORGE614_SHELL_HOME` (que debe ser una ruta absoluta; de lo contrario, el lanzador falla explícitamente para evitar comportamientos impredecibles al cambiar de directorio).
- **Desacoplamiento total de Pi ambient:** Las configuraciones del usuario en `~/.pi` (proveedores, modelos y ajustes globales ajenos) no se contaminan ni se leen como perfil activo de Shell.
- **Particionado por directorio de trabajo (`cwd`):** Las sesiones se particionan automáticamente según el directorio donde se ejecuta el comando, permitiendo que cada proyecto o worktree mantenga su propio historial local.
- **Aislamiento de extensiones y temas ajenos:** El lanzador pasa automáticamente los flags `--no-extensions`, `--no-skills`, `--no-prompt-templates` y `--no-themes` a Pi, garantizando que habilidades o temas globales de Pi no interfieran con la experiencia de Forge614-Shell.

### Extensión de identidad y estado (`extensions/forge614-shell.ts`)
- **Cabecera TUI personalizada:** En modo interactivo de terminal, muestra la cabecera destacada `Forge614-Shell` y el subtítulo `Powered by Pi · /login · /resume · /model · /thinking`.
- **Título de terminal:** Asigna dinámicamente el título de la ventana o pestaña a `Forge614-Shell`.
- **Indicador de estado visual:** Monitorea el ciclo de vida del agente mediante eventos `agent_start` y `agent_settled`, exponiendo en la barra de estado:
  - `Forge614 · ready` cuando está en espera de instrucciones.
  - `Forge614 · working` mientras procesa o ejecuta herramientas.
- **Comando `/forge614-status`:** Registra un comando interactivo en el chat que reporta:
  - Proyecto actual (`cwd`).
  - Perfil de configuración activo (`PI_CODING_AGENT_DIR`).
  - Modelo seleccionado (o aviso de usar `/login` si no hay credenciales).
  - Estado de memoria persistente (*not connected (Engram deferred)*).

### Una sesión activa por instancia (modelo de uso con Orca o terminal anfitrión)
- Conforme al alcance actualizado (Revisión 2 de la etapa 01), Forge614-Shell no construye un gestor interno de proyectos, pestañas ni worktrees de Git.
- El usuario abre una pestaña o ventana en su terminal (como Orca, Ghostty, iTerm o tmux) o en su IDE para cada rama o worktree, y ejecuta `forge614-shell`. Cada instancia mantiene una sesión activa aislada para esa ruta de trabajo.

### Interfaz en inglés
- En esta primera entrega, la interfaz TUI, los mensajes del sistema y los comandos heredados de Pi se presentan en inglés, sin selector de idioma ES/EN implementado por el momento.

---

## 3. Lo heredado nativamente de Pi

Forge614-Shell delega deliberadamente en Pi (`@earendil-works/pi-coding-agent`) las capacidades fundacionales de asistencia técnica:

- **Bucle de agente y razonamiento:** Planificación ReAct (*Reason + Act*), gestión de turnos de conversación y niveles de razonamiento (*thinking tokens*) cuando el modelo lo soporta.
- **Herramientas nativas del sistema de archivos:**
  - Lectura de archivos (`read_file`).
  - Edición y escritura de código (`edit_file`, `write_file`).
  - Ejecución de comandos del sistema operativo (`bash`).
- **Autenticación y proveedores:** Flujo interactivo `/login` para configurar claves de API de Anthropic, OpenAI, Google Gemini y otros proveedores soportados por Pi.
- **Catálogo de comandos internos:** `/model`, `/thinking`, `/resume`, `/new`, `/quit`, etc.
- **Renderizado de terminal (TUI):** Manejo de entrada interactiva, scroll, colores y renderizado diferencial mediante `@earendil-works/pi-tui`.
- **Políticas de confianza (*Trust Controls*):** Control de ejecución y advertencias sobre proyectos no confiables heredados de Pi.

---

## 4. Verificación técnica realizada

Todas las comprobaciones se ejecutaron en un entorno macOS con Bun 1.3.8 y TypeScript 5.9.3:

1. **Typecheck estricto:**
   ```bash
   bun run typecheck # tsc --noEmit (0 errores)
   ```
2. **Pruebas automatizadas (4/4 superadas):**
   ```bash
   bun test # 4 pass, 0 fail, 27 expect() calls
   ```
   - `tests/launcher.test.ts` (3 pruebas):
     - Verifica la propagación del `cwd` del worktree seleccionado y el uso del perfil de Shell en lugar del perfil ambient de Pi.
     - Verifica la compatibilidad con perfiles absolutos personalizados (`FORGE614_SHELL_HOME`).
     - Verifica el rechazo estricto de rutas de perfil relativas para evitar derivas entre proyectos.
   - `tests/runtime.test.ts` (1 prueba de integración):
     - Inicia un subproceso real de Pi en modo RPC (`--mode rpc`) comunicándose por `stdin`/`stdout`.
     - Confirma la carga de la extensión de Forge614-Shell, el título de la ventana, la ruta de sesiones aisladas, la ausencia de extensiones o skills globales de Pi y la ejecución exitosa del comando `/forge614-status`.
     - Valida que un archivo centinela en un perfil ambient de Pi no sufra modificaciones.
3. **Compilación:**
   ```bash
   bun run build # bun build src/cli.ts --target=node --packages=external --outdir=dist -> dist/cli.js (2.86 KB)
   ```
4. **Arranque interactivo en macOS:**
   - Comprobación manual de arranque de la interfaz interactiva y salida limpia.

### Lo que NO se probó en esta entrega:
- **Autenticación real:** No se configuraron claves de API reales ni se probó el flujo `/login` con un proveedor externo.
- **Conversación con modelos:** No se realizaron llamadas a APIs de LLMs ni se consumieron tokens reales en esta etapa.

---

## 5. Aspectos pendientes (para completar la Etapa 02)

Para declarar concluida la etapa 2 de Forge614-Shell, restan las siguientes tareas técnicas:

1. **Instalador automático para el usuario final:** Crear un mecanismo de instalación sencillo (script de instalación o paquete global) que no requiera pasos manuales de build.
2. **Validación multiplataforma:** Verificar el arranque, empaquetado y tests en sistemas **Windows** y **Linux** (actualmente sólo verificado en macOS).
3. **Prueba real de autenticación y chat:** Probar de punta a punta el login con al menos un proveedor real y verificar un intercambio interactivo de chat con ejecución de herramientas.
4. **Advertencia al salir con trabajo activo:** Implementar una confirmación o alerta personalizada si el usuario intenta cerrar la sesión mientras el agente está trabajando o ejecutando herramientas.
5. **Selector bilingüe ES/EN:** Diseñar cómo ofrecer textos o avisos en español dentro de la experiencia de Shell.
6. **Integración con Forge614-Engram:** Permanece explícitamente reservada para el final, cuando la base de Shell sea completamente estable.
