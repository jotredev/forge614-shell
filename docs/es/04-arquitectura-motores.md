# 04 — Arquitectura, soporte multimotor y gestión de sesiones

Fecha: 2026-09-19 · Etapa 02: arquitectura, adaptadores multimotor, integración con Engines y control de sesión · Revisión documental: 3 · [English](../en/04-architecture-engines.md) · [Índice](../../README.md)

Este documento detalla la reestructuración técnica de Forge614-Shell, evolucionando desde un lanzador monomotor hacia una **arquitectura en capas (Layered Architecture)** con adaptadores modulares para motores de inteligencia artificial. Detalla la **integración real con Forge614 Engines** como dependencia interna no interactiva para la detección de agentes locales bajo contrato público versionado (`schemaVersion: 1`), los adaptadores de chat activos (Claude Code y OpenAI Codex), el modelo de **autenticación y perfiles compartidos**, el comando interactivo de **desconexión local (`/logout`)**, la **reconexión con cuenta existente (`/login`)**, la **guía de diagnóstico sin fallback local** y los límites reales de verificación automatizada (133 pruebas pasando en 35 archivos, 597 aserciones).

---

## 1. La Analogía Maestra: El Tablero de Diagnóstico Multimarca con Módulo de Detección Interno

Imagina una consola de diagnóstico automotriz profesional en un taller mecánico de alta tecnología:

- **El Tablero Unificado (La capa UI y App):** El mecánico tiene una única pantalla táctil con controles estandarizados (el selector de interfaz visual "Basic" y los comandos interactivos `/login`, `/logout`, `/model`, `/effort`, `/resume`, `/status`, `/stop`, `/quit`). La experiencia visual es uniforme y predecible.
- **El Escáner Interno de Diagnóstico (Forge614 Engines):** En lugar de que el mecánico salga al estacionamiento a buscar manualmente qué autos están aparcados inspeccionando a ciegas las matrículas (la detección local en `PATH`), la consola se conecta a un módulo electrónico interno (`~/.forge614/engines/bin/forge614-engines detect`). Este escáner habla un protocolo oficial estricto (`schemaVersion: 1`) y entrega un reporte verificado de los vehículos listos.
- **Los Cables Adaptadores por Marca (La capa Engines y Chat Adapters):** Para que un vehículo detectado aparezca en la pantalla de inicio, la consola debe disponer del cable adaptador compatible específico:
  - El cable de **Claude Code** se comunica directamente con la computadora de a bordo de Anthropic mediante su SDK oficial (`@anthropic-ai/claude-agent-sdk`).
  - El cable de **Codex** enlaza con el servidor interno de OpenAI (*App Server*) a través de un canal bidireccional (*JSON-RPC sobre stdio*).
  - Si el escáner detecta un vehículo como **Cursor**, la consola reconoce su presencia física pero **no lo muestra en el selector de arranque** porque el cable adaptador de chat para Cursor todavía está en fase de diseño.
  - Motores de esquemas anteriores o experimentales (como **Antigravity CLI**) ya no forman parte de este selector inicial gobernado por Engines, pues pertenecían a la búsqueda local antigua en disco.
- **La Alarma de Integridad sin Sustitutos Caseros (Regla de No-Fallback):** Si el escáner interno de diagnóstico está desconectado, dañado o devuelve un protocolo incompatible, la consola se niega rotundamente a improvisar adivinando qué autos hay mediante lecturas ruidosas de cables sueltos. Muestra un aviso claro indicando que se debe reparar reinstalando la consola (`Forge614 Shell`).
- **El Taller Compartido frente a las Mesas Aisladas (Perfiles de Autenticación):** El taller comparte las mismas herramientas globales, manuales de servicio y credenciales maestras que ya utiliza el mecánico en su estación principal (como ADE Orca u otras terminales). Desconectar una herramienta del tablero (*logout local*) simplemente retira la llave del contacto en esa consola específica; no destruye la cuenta bancaria del taller, no cambia las cerraduras del edificio ni apaga los otros vehículos en los boxes vecinos. Tras usar la consola para configurar o ajustar el motor, el mecánico puede apagar la pantalla y continuar trabajando directamente con sus herramientas nativas en Orca o su terminal habitual.
- **La Protección Eléctrica (Infraestructura y Sanitización de Entorno):** Antes de encender el motor, el tablero comprueba que no haya sobrevoltajes ni variables cruzadas (rechaza tajantemente variables de entorno de facturación por API en modo suscripción) y gestiona los enlaces oficiales de inicio de sesión con el navegador de forma aislada y segura.

---

## 2. Arquitectura y estructura del sistema

Forge614-Shell adopta estrictamente un patrón de **Arquitectura en Capas (Layered Architecture)** con adaptadores especializados por motor e infraestructura de consulta de contratos.

> [!IMPORTANT]
> **Delimitación conceptual estricta:** Esta arquitectura **NO** es Clean Architecture ni Arquitectura Hexagonal pura. No existe una capa de entidades puras de dominio ni una abstracción universal donde todos los motores sean idénticos o intercambiables en caliente sin fricción. Se trata de un desacoplamiento pragmático y jerárquico donde las capas superiores consumen las inferiores, y cada motor conserva sus particularidades de protocolo nativo.

```
┌─────────────────────────────────────────────────────────────┐
│                         src/cli.ts                          │
│        (Punto de entrada, parser CLI y selector TUI)        │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│          src/app/            │ │          src/ui/           │
│  - options.ts (argumentos)   │ │  - startup/ (pickers TUI)  │
│  - native-chat.ts (composición│ │  - basic/native.ts (chat)  │
│    raíz: Codex, agy, Gemini) │ │  - basic/claude.ts (Claude)│
└──────────────┬───────────────┘ └─────────────┬──────────────┘
               │                               │
               ▼                               │
┌──────────────────────────────────────────────┴──────────────┐
│                        src/engines/                         │
│  - types.ts (contratos de sesión, modelos y eventos)        │
│  - process.ts (arranque seguro y desinfección de entorno)    │
│  - logout.ts (helper de confirmación de desconexión local)  │
│  - discovery.ts (detector local en PATH heredado)           │
│  ┌────────────┬─────────────┬──────────────┬──────────────┐ │
│  │ claude/    │ codex/      │ antigravity/ │ gemini/ & pi │ │
│  │ SDK + CLI  │ App Server  │ agy stream   │ ACP / Legacy │ │
│  └────────────┴─────────────┴──────────────┴──────────────┘ │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    src/infrastructure/                      │
│  - forge614-engines.ts (contrato público Engines detect v1) │
│  - browser.ts (lanzador seguro de navegador para OAuth)      │
│  - rpc.ts (JsonRpcPeer: transporte bidireccional sobre stdio)│
│  - project-info.ts (inspección Git no bloqueante)           │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
               ~/.forge614/engines/bin/forge614-engines detect
                     (Componente interno, NO en PATH)
```

### Reglas de dependencia entre capas

La prueba arquitectónica automatizada (`tests/architecture/layers.test.ts`) garantiza:
1. Las capas `engines/` e `infrastructure/` no importan código de `ui/` ni de `app/`.
2. Cada motor nativo soportado (`claude`, `codex`, `antigravity`, `gemini`) es dueño de su propia implementación de sesión (`session.ts`).
3. La consulta de agentes seleccionables para el selector de inicio se delega en `src/infrastructure/forge614-engines.ts`, consumiendo el contrato oficial de Forge614 Engines.

### Módulos principales

| Módulo | Ruta | Propósito técnico |
| --- | --- | --- |
| **CLI Entry** | `src/cli.ts` | Analiza los argumentos de inicio, procesa banderas inmediatas (`--help`, `--version`), verifica terminal TTY interactiva, consulta los motores disponibles mediante `discoverSelectableEngines` e invoca los selectores visuales o el arranque legacy de Pi. |
| **App Options** | `src/app/options.ts` | Valida y extrae el argumento `--engine` (`claude`, `codex`, `antigravity`, `gemini`, `pi`). |
| **App Native Chat** | `src/app/native-chat.ts` | Raíz de composición (*composition root*): instancia el subproceso, enlaza el transporte RPC o de flujos, y monta `CodexSession`, `AntigravitySession` o `GeminiSession` en la interfaz sin que la UI conozca los detalles de proceso. |
| **Engines Types** | `src/engines/types.ts` | Define las interfaces canónicas: `NativeSession` (ciclo de vida, `logout?()`, `login()`), `NativeModel`, `NativeEvent`, `Approve` y `Emit`. |
| **Engines Process** | `src/engines/process.ts` | Configura el entorno de subproceso, rechaza variables conflictivas de facturación por API (`OPENAI_API_KEY`, `GEMINI_API_KEY`, etc.) y arranca el transporte `JsonRpcPeer`. |
| **Engines Logout** | `src/engines/logout.ts` | Función compartida `confirmedLogout`: solicita confirmación interactiva informando que la desconexión es exclusiva de la sesión actual de Shell. |
| **Engines Discovery (Heredado)** | `src/engines/discovery.ts` | Detector local en `PATH` heredado. **Ya no se utiliza para poblar el selector de arranque**; el selector interactivo se abastece exclusivamente mediante el contrato público de Forge614 Engines. |
| **Engine Claude** | `src/engines/claude/` | Integración oficial con Claude Code vía SDK; maneja preflight de suscripción (`auth.ts`), ciclo de turnos (`session.ts`) y telemetría de cuotas y tokens (`telemetry.ts`). |
| **Engine Codex** | `src/engines/codex/` | Conecta con `codex app-server` mediante JSON-RPC sobre stdio, con soporte de catálogo de modelos, streaming, `/login` y `/logout` local. |
| **Engine Antigravity** | `src/engines/antigravity/` | Implementación interna para el CLI de Antigravity (`agy`) en modo `stream-json` (`process.ts`) y sesión interactiva (`session.ts`). No forma parte del selector inicial de Engines. |
| **Engine Gemini** | `src/engines/gemini/` | Conecta con Gemini CLI vía ACP v1 (`--acp --approval-mode default`) y captura controlada de `stderr` (`login-feedback.ts`). |
| **Engine Pi** | `src/engines/pi/` | Conector heredado (*legacy*) que encapsula `@earendil-works/pi-coding-agent`, manteniendo aislamiento de perfil en `~/.forge614-shell/agent`. |
| **UI Startup** | `src/ui/startup/` | Selectores de interfaz visual (`visual-picker.ts`) y de motor (`engine-picker.ts`). Muestra los motores provistos por Engines y soportados por Shell. |
| **UI Basic** | `src/ui/basic/` | Experiencia AI-first dividida en terminal: workspace (`workspace.ts`), barra lateral contextual (`sidebar.ts`), compositor enmarcado (`composer.ts`), tarjetas de actividad (`transcript.ts`), métricas braille (`metrics.ts`), estado de sesión (`shell-state.ts`), barra de estado condensada (`status-bar.ts`) y paleta Forge614 (`theme.ts`). Detallado en [05-interfaz-basic-panel-cuotas.md](05-interfaz-basic-panel-cuotas.md). |
| **Infrastructure Engines** | `src/infrastructure/forge614-engines.ts` | Invoca el contrato público `~/.forge614/engines/bin/forge614-engines detect`, valida `schemaVersion: 1`, descarta agentes sin adaptador de chat y aplica la regla de no-fallback ante fallos. |
| **Infrastructure Browser** | `src/infrastructure/browser.ts` | Abre el navegador del sistema operativo de forma segura solo para endpoints oficiales (`auth.openai.com` y `accounts.google.com`) sin interpolación en shell. |
| **Infrastructure Project** | `src/infrastructure/project-info.ts` | Consulta no bloqueante de rama y archivos modificados vía Git, con detección de entornos sin Git. |
| **Infrastructure RPC** | `src/infrastructure/rpc.ts` | `JsonRpcPeer`: transporte JSON-RPC bidireccional sobre `stdin`/`stdout` con manejo de timeouts, fragmentación y cancelación. |

---

## 3. Relación Shell ↔ Forge614 Engines, flujo de inicio y guía de diagnóstico

Conforme al contrato de arquitectura del ecosistema (`FORGE614_ECOSYSTEM_CONTRACT.md`), la relación entre Shell y Engines está rígidamente delimitada:

### 3.1 Engines como dependencia interna y aislamiento estricto de PATH
- **Componente interno desacoplado:** `forge614-engines` es una dependencia interna no interactiva para la detección e inspección segura de clientes de IA locales. No posee interfaz de usuario (TUI) ni lógica de chat interactivo.
- **Ruta de instalación:** Se instala y aloja de forma automática bajo `~/.forge614/engines/bin/forge614-engines`.
- **Aislamiento estricto del PATH:** `forge614-shell` es el **único comando agregado a la variable `PATH`** del usuario (apuntando a `~/.forge614/shell/bin/`). Por diseño deliberado, `forge614-engines` **nunca se agrega al PATH** y la persona usuaria **no debe ejecutarlo directamente** en su terminal.
- **Invocación interna:** Shell es el único componente que invoca programáticamente el binario de Engines mediante subprocesos desacoplados (`src/infrastructure/forge614-engines.ts`).

### 3.2 Flujo de inicio y consulta del contrato público (`schemaVersion: 1`)
Cuando el usuario ejecuta `forge614-shell`, se activa el flujo de arranque interactivo:

1. **Selector de interfaz visual:**
   - La terminal presenta en primer lugar `Choose your visual interface`, donde se selecciona la interfaz `Basic` (la opción `Full` permanece deshabilitada para entregas posteriores).
2. **Consulta del contrato público de Engines (`detect`):**
   - Para poblar el selector `Choose your AI engine`, Shell **ya no utiliza su detector local en PATH** (`src/engines/discovery.ts`).
   - En su lugar, Shell invoca de forma desacoplada el binario interno de Engines:
     ```bash
     ~/.forge614/engines/bin/forge614-engines detect
     ```
   - Engines devuelve un reporte estandarizado en formato JSON con `schemaVersion: 1`:
     ```json
     {
       "schemaVersion": 1,
       "agents": [
         { "id": "claude-code", "label": "Claude Code", "installed": true, "executable": "/usr/local/bin/claude" },
         { "id": "codex", "label": "Codex", "installed": true, "executable": "/usr/local/bin/codex" },
         { "id": "cursor", "label": "Cursor", "installed": true, "executable": "/Applications/Cursor.app/Contents/MacOS/Cursor" }
       ]
     }
     ```
3. **Mapeo estricto a adaptadores de chat soportados:**
   - Shell procesa el reporte y filtra **únicamente** los agentes con `installed: true` para los cuales Shell ya tiene implementado un adaptador de chat interactivo:
     - `claude-code` se mapea al adaptador de chat `claude` (Claude Code).
     - `codex` se mapea al adaptador de chat `codex` (OpenAI Codex).
   - **Caso Cursor:** Aunque Engines reporte a Cursor como detectado e instalado (`id: "cursor"`), **Cursor no aparece en el selector** de Shell porque Shell todavía no dispone de un adaptador de chat para Cursor.
   - **Caso Antigravity CLI:** Antigravity CLI **ya no aparece en el selector inicial**. Pertenecía al detector local en PATH heredado y no forma parte de los agentes seleccionables en el selector oficial gobernado por Engines. Si bien el código de sesión y subproceso en `src/engines/antigravity/` se conserva internamente para compatibilidad especializada, el selector de inicio interactivo no lo expone.

### 3.3 Guía de diagnóstico: regla de No-Fallback ante fallos de Engines
Si Forge614 Engines falta, se corrompe o devuelve un esquema incompatible, Shell aplica una política rigurosa de integridad técnica: **Shell no realiza fallback a detección local en PATH**.

| Estado de Engines | Causa técnica | Comportamiento y mensaje de Shell | Acción de reparación requerida |
| :--- | :--- | :--- | :--- |
| **Ausente o no ejecutable** (`status !== 0`) | El binario no existe en `~/.forge614/engines/bin/forge614-engines`, tiene permisos erróneos o falló al arrancar. | Lanza excepción fatal e interrumpe el arranque:<br>`Forge614 Engines is unavailable. Reinstall Forge614 Shell to repair its required dependency.` | Reinstalar Forge614 Shell mediante el instalador oficial (`curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh \| bash`). El instalador descargará y configurará automáticamente la versión correcta de Engines. |
| **Versión de esquema incompatible** (`schemaVersion !== 1`) | La versión de Engines instalada utiliza una versión de esquema diferente (ej. 2) no soportada por esta versión de Shell. | Lanza excepción fatal e interrumpe el arranque:<br>`Forge614 Engines is incompatible with this Shell version. Reinstall Forge614 Shell to repair its required dependency.` | Reinstalar Forge614 Shell para sincronizar versiones compatibles del ecosistema. |
| **Salida malformada o JSON corrupto** | La salida de `forge614-engines detect` no es JSON válido o el campo `agents` no es un arreglo. | Lanza excepción fatal:<br>`Forge614 Engines returned an invalid detection result.` | Reinstalar Forge614 Shell para reparar la instalación dañada. |
| **Sin agentes compatibles instalados** (`agents` vacío o ninguno con adaptador) | Engines detectó cero agentes instalados con adaptador de chat en Shell. | Informa amablemente en terminal:<br>`Forge614 Engines found no Shell-compatible AI engines. Install Claude Code or Codex, then restart Forge614-Shell.` | Instalar Claude Code (`npm i -g @anthropic-ai/claude-code`) o Codex e iniciar sesión. |
| **Invocación manual por el usuario** | El usuario escribe `forge614-engines` en su terminal. | La terminal devuelve:<br>`forge614-engines: command not found` | Comportamiento previsto: Engines es un componente interno no expuesto en el PATH. Toda interacción visual se realiza a través de `forge614-shell`. |

### 3.4 Libertad de trabajo en clientes nativos tras la instalación
Forge614 Shell es una herramienta de empoderamiento visual, no una barrera operativa:
- Shell actúa como cabina de mando para el setup inicial, configuración de perfiles, confirmación de cambios y chat unificado.
- Tras completar la instalación o configuración en Shell, el usuario **puede continuar trabajando directamente desde ADE Orca, Claude Code, OpenAI Codex u otras terminales nativas**. Shell no sustituye ni encierra a esos clientes.

---

## 4. Autenticación y decisión sobre perfiles compartidos

Durante el desarrollo se investigó en profundidad la viabilidad de aislar por completo las credenciales de Shell respecto de otras aplicaciones (como Orca):

### La investigación técnica realizada
- **Claude Code:** Admite la variable `CLAUDE_CONFIG_DIR`, la cual segrega tanto los archivos locales de configuración e historial como la entrada en el llavero de macOS (*Keychain*). Esto permite ejecutar dos perfiles con cuentas independientes en paralelo.
- **Codex:** Admite la variable `CODEX_HOME` y el ajuste `cli_auth_credentials_store="file"`, permitiendo almacenar credenciales en un archivo `auth.json` dedicado.
- **Antigravity:** Utiliza el almacén seguro del sistema operativo (*keyring*). No se identificó ningún mecanismo documentado que permita segregar las entradas del llavero por aplicación.

### La decisión arquitectónica acordada
Se decidió **NO implementar perfiles aislados (`CLAUDE_CONFIG_DIR` o `CODEX_HOME`) y mantener el perfil nativo compartido del sistema**:
1. **Unificación del ecosistema:** El usuario desea que las habilidades (*skills*), herramientas de contexto (*MCP servers*), configuraciones y autorizaciones globales configuradas en el entorno nativo estén disponibles tanto en Forge614-Shell como en Orca y la terminal habitual, en lugar de mantener islas de configuración desincronizadas.
2. **Sin alteración de variables globales:** Shell no modifica variables de entorno globales, ni altera credenciales del sistema, ni manipula cookies del navegador.
3. **Consecuencia técnica aceptada:** Forge614-Shell **no ofrece cambio de cuenta independiente** respecto a otras herramientas que compartan el mismo perfil nativo. Desconectar la cuenta en el proveedor afectaría a todas las herramientas; por ello, la solución requerida y adoptada es la **desconexión local de Shell**.

> [!NOTE]
> **Distinción conceptual obligatoria:**
> - **Desconexión local de Shell:** Estado en memoria dentro de la sesión de Forge614-Shell que bloquea el envío de mensajes y limpia la sesión activa, sin tocar archivos ni revocar tokens.
> - **Credenciales del motor nativo:** Archivos o entradas de llavero administradas por los CLIs oficiales (`~/.claude`, `~/.codex`, llavero de macOS/Linux/Windows).
> - **Sesión y cookies del navegador:** Estado de sesión web en Google, Anthropic u OpenAI, que reside en el navegador del usuario y determina si el portal web solicita credenciales o inicia sesión automáticamente.

---

## 5. El comando `/logout` local de Forge614-Shell

Implementado de manera consistente para **Claude Code**, **Codex** y **Antigravity CLI**:

### Comportamiento operativo
1. **Confirmación obligatoria:** Al escribir `/logout`, el sistema solicita consentimiento explícito:
   ```
   Disconnect <engine> only in this Forge614-Shell session? Your native account, Orca, other terminals and saved chats will not be changed. Use /login here to reconnect with your existing account.
   /yes = allow once · /no = deny
   ```
2. **Alcance estrictamente local:**
   - **NO** ejecuta `claude auth logout`, ni `codex logout`, ni `agy /logout`.
   - **NO** revoca tokens OAuth ni borra credenciales en disco o llavero.
   - **NO** cierra la sesión en Orca, Ghostty, iTerm, VS Code ni en el navegador.
   - **NO** elimina los historiales de chat guardados ni archivos del proyecto.
3. **Efectos inmediatos en la sesión:**
   - Pone el estado interno en `disconnected` (o `signedOut`).
   - La barra de estado refleja: `Disconnected locally · use /login to reconnect Shell. Native account unchanged.`
   - Bloquea cualquier intento de enviar texto al modelo (`send()` rechaza con error: *"Use /login to reconnect this Shell session before sending a message"*).
   - Limpia el catálogo de modelos en memoria, la telemetría acumulada y el identificador de sesión activa.
4. **Protección contra operaciones en vuelo:** Si hay un turno de conversación activo o un flujo de login en curso, el sistema exige terminarlo o cancelarlo con `/stop` antes de desconectar.
5. **No persistencia:** Al cerrar Shell y volver a abrirlo, el sistema arranca comprobando el estado de la autenticación nativa existente en el equipo.

---

## 6. Reconexión mediante `/login`

El comando `/login` reactiva la sesión en Forge614-Shell con validaciones rigurosas:

### Flujo de reconexión
1. **Comprobación no invasiva de cuenta existente:** Shell consulta el estado de autenticación del motor nativo sin abrir ventanas:
   - **Codex:** Ejecuta `account/read` sobre el App Server.
   - **Claude Code:** Invoca `claude auth status --json` mediante `claudeLoginState()`.
   - **Antigravity:** Ejecuta una sonda de estado mediante `antigravityLoginState()`.
2. **Reutilización transparente:** Si el motor nativo ya cuenta con una sesión válida, Shell la reconecta inmediatamente:
   - Restablece el flag `disconnected = false`.
   - Emite el mensaje explicativo: *"Connected to <engine> in Shell using your existing account. No new login is needed."*
   - No abre el navegador ni fuerza al usuario a reintroducir contraseñas innecesariamente.
3. **Ausencia de efectos colaterales:** Reconectar mediante `/login` **no envía mensajes al modelo** ni reanuda tareas pendientes de forma automática.
4. **Fallo en la verificación:** Si la sonda de autenticación devuelve estado desconocido (*unknown*) o falla, Shell informa que no pudo verificar la cuenta y no finge una conexión exitosa.
5. **Flujo interactivo cuando se requiere autenticación real:**
   - **Claude Code:** Suspende el TUI e invoca `claude auth login` con terminal heredada (`stdio: inherit`). Al regresar, verifica el estado y restaura el TUI.
   - **Codex:** Inicia el flujo OAuth mediante `account/login/start` y abre el navegador seguro (`openLoginBrowser`), permitiendo cancelar con `/stop`.
   - **Antigravity:** Dado que `agy` solo ofrece login interactivo en su interfaz nativa, Shell solicita confirmación explícita (*"Google sign-in is required. Antigravity only offers interactive login through native agy. Open it temporarily?..."*), suspende el TUI, ejecuta `agy`, y al salir restaura Shell y comprueba la cuenta.

---

## 7. Confirmación, cancelación y seguridad

1. **Control de cancelación:**
   - Escribir `/no` en el diálogo de confirmación de `/logout` cancela la desconexión y mantiene la sesión intacta.
   - Escribir `/stop` interrumpe operaciones de autenticación pendientes.
   - Si una comprobación de cuenta en segundo plano fue abortada por `/stop` o cancelación de señal, una respuesta tardía del subproceso no puede reactivar la sesión de manera espuria.
2. **Protección de datos confidenciales:**
   - Los subprocesos de comprobación de cuenta se ejecutan con streams aislados (`stdio: ["ignore", "pipe", "pipe"]` en `account-command.ts`).
   - Las salidas de error (`stderr`) no se imprimen directamente en la pantalla de chat si contienen tokens o datos privados.
3. **Claridad hacia el usuario:** Todos los avisos diferencian explícitamente entre la desconexión de la ventana de Shell y el estado de la cuenta en el proveedor de IA.

---

## 8. Pruebas y verificación técnica (*Colocated Tests*)

### Distribución de la suite de pruebas (35 archivos coubicados)

```
src/
├── app/
│   ├── options.test.ts
│   └── native-chat.ts
├── engines/
│   ├── discovery.test.ts
│   ├── process.test.ts
│   ├── logout.ts
│   ├── logout.test.ts                # Consentimiento de logout, cancelación y límites
│   ├── claude/
│   │   ├── auth.test.ts              # Preflight, estados de login y cancelación segura
│   │   ├── catalog.test.ts           # Consulta de modelos y cuota sin emitir prompts
│   │   ├── session.test.ts           # Turnos, stream de contexto y bloqueo concurrente
│   │   └── telemetry.test.ts
│   ├── codex/
│   │   ├── session.test.ts           # Logout local, reconexión, cuotas /refresh y visual state
│   │   └── skills.test.ts            # Descubrimiento de SKILL.md de proyecto, usuario y plugins
│   ├── antigravity/
│   │   ├── account-command.test.ts   # Sondas de cuenta sin TTY y límites de buffer
│   │   ├── process.test.ts           # Protocolo stream-json, cuota /usage y cancelación
│   │   └── session.test.ts           # Logout local, reconexión agy y bloqueo de mensajes
│   ├── gemini/
│   │   ├── config.test.ts
│   │   ├── login-feedback.test.ts
│   │   └── session.test.ts
│   └── pi/
│       └── launcher.test.ts
├── infrastructure/
│   ├── browser.test.ts
│   ├── forge614-engines.test.ts      # Contrato público detect schema v1 y regla de no-fallback
│   ├── project-info.test.ts          # Consulta Git no bloqueante y fallback sin repo
│   ├── rpc.test.ts
│   └── updater.test.ts
└── ui/
    ├── basic/
    │   ├── claude.test.ts            # Consentimiento de logout en Claude y reconexión
    │   ├── metrics.test.ts           # Cuotas neutrales, límites de barra y anillo braille
    │   ├── native.test.ts            # Bucle de comandos, /logout local y /login
    │   ├── shell-state.test.ts       # Limpieza de estado en desconexión y aislamiento
    │   ├── sidebar.test.ts           # Deduplicación de /refresh, telemetría y grupos
    │   ├── transcript.test.ts        # Rol, hora y tarjetas colapsables de herramientas
    │   └── workspace-chrome.test.ts  # Scroll independiente, scrollbars ocultos y compositor
    └── startup/
        ├── engine-picker.test.ts
        └── visual-picker.test.ts
tests/
├── architecture/
│   └── layers.test.ts                # Fronteras entre capas y propiedad de session.ts
├── integration/
│   ├── public-installer.test.ts      # Instalador público y bootstrap de Engines
│   ├── release-bundle.test.ts        # Instalación aislada de bundle tarball y reporte de versión
│   └── runtime.test.ts               # Integración real con subproceso Pi
└── support/
    └── rpc-fixture.ts
```

### Estado de verificación ejecutado

```bash
bun run check
# Equivale a: bun run typecheck && bun test && bun run build
```

- **Typecheck estricto:** `tsc --noEmit` completado sin errores.
- **Pruebas automatizadas:** **133 pruebas superadas en 35 archivos** (0 fallos, 597 aserciones `expect()`).
- **Compilación de producción:** `dist/cli.js` generado correctamente.

> [!WARNING]
> **Límite de verificación:** Estas 133 pruebas automatizadas validan con rigor los contratos lógicos, contratos públicos de Engines, máquinas de estado, desconexión local, scroll independiente, refresco de cuotas sin prompt, buffers, dobles de transporte RPC y empaquetado del release 1.0.0. **NO representan una validación manual completa con cuentas comerciales reales ni en todos los sistemas operativos (Windows, Linux)**. Consultar [05-interfaz-basic-panel-cuotas.md](05-interfaz-basic-panel-cuotas.md) y [06-preparacion-release-1.0.0-instalador.md](06-preparacion-release-1.0.0-instalador.md) para especificaciones detalladas.

---

## 9. Alcance pendiente y próximos pasos

1. **Gestor visual de workspaces estilo Orca:** Permanece fuera de alcance; se mantiene el modelo de **una sesión activa por instancia de terminal**.
2. **Validación multiplataforma:** Verificación exhaustiva de rutas de ejecutables y comandos en Windows y distribuciones Linux.
3. **Motores de inferencia local:** Adaptadores para runtimes locales (como Ollama o vLLM).
4. **Internacionalización bilingüe de la interfaz TUI (ES/EN):** Actualmente los textos interactivos se presentan en inglés.
5. **Integración con memoria persistente Forge614-Engram:** Diferida formalmente hasta la conclusión y estabilización de la etapa 2.
