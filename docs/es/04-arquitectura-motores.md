# 04 — Arquitectura, soporte multimotor y gestión de sesiones

Fecha: 2026-09-17 · Etapa 02: arquitectura, adaptadores multimotor y control de sesión · Revisión documental: 2 · [English](../en/04-architecture-engines.md) · [Índice](../../README.md)

Este documento detalla la reestructuración técnica de Forge614-Shell, evolucionando desde un lanzador monomotor hacia una **arquitectura en capas (Layered Architecture)** con adaptadores modulares para múltiples motores de inteligencia artificial: Claude Code, OpenAI Codex, Antigravity CLI, Google Gemini CLI y el motor heredado Pi. Asimismo, documenta en profundidad el modelo de **autenticación y perfiles compartidos**, el comando interactivo de **desconexión local (`/logout`)**, la **reconexión con cuenta existente (`/login`)** y los límites reales de verificación automatizada.

---

## 1. La Analogía Maestra: El Tablero de Diagnóstico Multimarca con Adaptadores Propios

Imagina una consola de diagnóstico automotriz profesional en un taller mecánico:

- **El Tablero Unificado (La capa UI y App):** El mecánico tiene una única pantalla con controles estandarizados (el selector de interfaz inicial y los comandos interactivos `/login`, `/logout`, `/model`, `/effort`, `/resume`, `/status`, `/stop`, `/quit`). La experiencia visual es uniforme y predecible sin importar el motor conectado.
- **Los Cables Adaptadores por Marca (La capa Engines):** En lugar de forzar a todos los vehículos a encajar en un estándar genérico ficticio, la consola utiliza un adaptador de comunicación específico para cada fabricante:
  - El cable de **Claude** se comunica directamente con la computadora de a bordo de Anthropic mediante su SDK oficial (`@anthropic-ai/claude-agent-sdk`).
  - El cable de **Codex** enlaza con el servidor interno de OpenAI (*App Server*) a través de un canal bidireccional (*JSON-RPC sobre stdio*).
  - El cable de **Antigravity** interactúa con el CLI oficial de Google (`agy`) en modo de flujo estructurado (*stream-json*).
  - El cable de **Gemini** se acopla al protocolo de control de agentes de Google (*ACP — Agent Client Protocol* v1).
  - El conector de **Pi** permite arrancar la maquinaria clásica como respaldo aislado.
- **El Taller Compartido frente a las Mesas Aisladas (Perfiles de Autenticación):** El taller comparte las mismas herramientas globales, manuales de servicio y credenciales maestras que ya utiliza el mecánico en su estación principal (como Orca u otras terminales). Desconectar una herramienta del tablero (*logout local*) simplemente retira la llave del contacto en esa consola específica para evitar que nadie la acelere por error; no destruye la cuenta bancaria del taller, no cambia las cerraduras del edificio ni apaga los otros vehículos en los boxes vecinos.
- **La Protección Eléctrica (Infraestructura y Sanitización de Entorno):** Antes de encender el motor, el tablero comprueba que no haya sobrevoltajes ni variables cruzadas (rechaza tajantemente variables de entorno de facturación por API en modo suscripción) y gestiona los enlaces oficiales de inicio de sesión con el navegador de forma aislada y segura.

---

## 2. Arquitectura y estructura del sistema

Forge614-Shell adopta estrictamente un patrón de **Arquitectura en Capas (Layered Architecture)** con adaptadores especializados por motor.

> [!IMPORTANT]
> **Delimitación conceptual estricta:** Esta arquitectura **NO** es Clean Architecture ni Arquitectura Hexagonal pura. No existe una capa de entidades puras de dominio ni una abstracción universal donde todos los motores sean idénticos o intercambiables en caliente sin fricción. Se trata de un desacoplamiento pragmático y jerárquico donde las capas superiores consumen las inferiores, y cada motor conserva sus particularidades de protocolo nativo.

```
┌─────────────────────────────────────────────────────────────┐
│                         src/cli.ts                          │
│        (Punto de entrada, parser CLI y selector)            │
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
│  - discovery.ts (detección de ejecutables en PATH)          │
│  - process.ts (arranque seguro y desinfección de entorno)    │
│  - logout.ts (helper de confirmación de desconexión local)  │
│  ┌────────────┬─────────────┬──────────────┬──────────────┐ │
│  │ claude/    │ codex/      │ antigravity/ │ gemini/ & pi │ │
│  │ SDK + CLI  │ App Server  │ agy stream   │ ACP / Legacy │ │
│  └────────────┴─────────────┴──────────────┴──────────────┘ │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    src/infrastructure/                      │
│  - browser.ts (lanzador seguro de navegador para OAuth)      │
│  - rpc.ts (JsonRpcPeer: transporte bidireccional sobre stdio)│
└─────────────────────────────────────────────────────────────┘
```

### Reglas de dependencia entre capas

La prueba arquitectónica automatizada (`tests/architecture/layers.test.ts`) garantiza:
1. Las capas `engines/` e `infrastructure/` no importan código de `ui/` ni de `app/`.
2. Cada motor nativo soportado (`claude`, `codex`, `antigravity`, `gemini`) es dueño de su propia implementación de sesión (`session.ts`).

### Módulos principales

| Módulo | Ruta | Propósito técnico |
| --- | --- | --- |
| **CLI Entry** | `src/cli.ts` | Analiza los argumentos de inicio, procesa banderas inmediatas (`--help`, `--version`), verifica terminal TTY interactiva e invoca los selectores visuales o el arranque legacy de Pi. |
| **App Options** | `src/app/options.ts` | Valida y extrae el argumento `--engine` (`claude`, `codex`, `antigravity`, `gemini`, `pi`). |
| **App Native Chat** | `src/app/native-chat.ts` | Raíz de composición (*composition root*): instancia el subproceso, enlaza el transporte RPC o de flujos, y monta `CodexSession`, `AntigravitySession` o `GeminiSession` en la interfaz sin que la UI conozca los detalles de proceso. |
| **Engines Types** | `src/engines/types.ts` | Define las interfaces canónicas: `NativeSession` (ciclo de vida, `logout?()`, `login()`), `NativeModel`, `NativeEvent`, `Approve` y `Emit`. |
| **Engines Discovery** | `src/engines/discovery.ts` | Inspecciona el `PATH` buscando ejecutables soportados (`claude`, `codex`, `agy`). En Windows, resuelve paquetes npm sin invocar archivos `.cmd`. |
| **Engines Process** | `src/engines/process.ts` | Configura el entorno de subproceso, rechaza variables conflictivas de facturación por API (`OPENAI_API_KEY`, `GEMINI_API_KEY`, etc.) y arranca el transporte `JsonRpcPeer`. |
| **Engines Logout** | `src/engines/logout.ts` | Función compartida `confirmedLogout`: solicita confirmación interactiva informando que la desconexión es exclusiva de la sesión actual de Shell. |
| **Engine Claude** | `src/engines/claude/` | Integración oficial con Claude Code vía SDK; maneja preflight de suscripción (`auth.ts`), ciclo de turnos (`session.ts`) y telemetría de cuotas y tokens (`telemetry.ts`). |
| **Engine Codex** | `src/engines/codex/` | Conecta con `codex app-server` mediante JSON-RPC sobre stdio, con soporte de catálogo de modelos, streaming, `/login` y `/logout` local. |
| **Engine Antigravity** | `src/engines/antigravity/` | Conecta con Google Antigravity CLI (`agy`) en modo `stream-json` (`process.ts`), verificación de cuentas sin abrir terminales descontroladas (`account-command.ts`) y sesión interactiva (`session.ts`). |
| **Engine Gemini** | `src/engines/gemini/` | Conecta con Gemini CLI vía ACP v1 (`--acp --approval-mode default`) y captura controlada de `stderr` (`login-feedback.ts`). |
| **Engine Pi** | `src/engines/pi/` | Conector heredado (*legacy*) que encapsula `@earendil-works/pi-coding-agent`, manteniendo aislamiento de perfil en `~/.forge614-shell/agent`. |
| **UI Startup** | `src/ui/startup/` | Selectores de interfaz visual (`visual-picker.ts`) y de motor (`engine-picker.ts`). |
| **UI Basic** | `src/ui/basic/` | Terminal interactiva construida con componentes `@earendil-works/pi-tui`: `native.ts` (para Codex, agy y Gemini) y `claude.ts` (para Claude Code). |
| **Infrastructure Browser** | `src/infrastructure/browser.ts` | Abre el navegador del sistema operativo de forma segura solo para endpoints oficiales (`auth.openai.com` y `accounts.google.com`) sin interpolación en shell. |
| **Infrastructure RPC** | `src/infrastructure/rpc.ts` | `JsonRpcPeer`: transporte JSON-RPC bidireccional sobre `stdin`/`stdout` con manejo de timeouts, fragmentación y cancelación. |

---

## 3. Autenticación y decisión sobre perfiles compartidos

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

## 4. El comando `/logout` local de Forge614-Shell

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

## 5. Reconexión mediante `/login`

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

## 6. Confirmación, cancelación y seguridad

1. **Control de cancelación:**
   - Escribir `/no` en el diálogo de confirmación de `/logout` cancela la desconexión y mantiene la sesión intacta.
   - Escribir `/stop` interrumpe operaciones de autenticación pendientes.
   - Si una comprobación de cuenta en segundo plano fue abortada por `/stop` o cancelación de señal, una respuesta tardía del subproceso no puede reactivar la sesión de manera espuria.
2. **Protección de datos confidenciales:**
   - Los subprocesos de comprobación de cuenta se ejecutan con streams aislados (`stdio: ["ignore", "pipe", "pipe"]` en `account-command.ts`).
   - Las salidas de error (`stderr`) no se imprimen directamente en la pantalla de chat si contienen tokens o datos privados.
3. **Claridad hacia el usuario:** Todos los avisos diferencian explícitamente entre la desconexión de la ventana de Shell y el estado de la cuenta en el proveedor de IA.

---

## 7. Pruebas y verificación técnica (*Colocated Tests*)

### Distribución de la suite de pruebas

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
│   │   ├── session.test.ts
│   │   └── telemetry.test.ts
│   ├── codex/
│   │   └── session.test.ts           # Logout local, reconexión sin OAuth y bloqueo de turnos
│   ├── antigravity/
│   │   ├── account-command.test.ts   # Sondas de cuenta sin TTY y límites de buffer
│   │   ├── process.test.ts           # Protocolo stream-json, cancelación y rechazo de API keys
│   │   └── session.test.ts           # Logout local, reconexión agy y bloqueo de mensajes
│   ├── gemini/
│   │   ├── config.test.ts
│   │   ├── login-feedback.test.ts
│   │   └── session.test.ts
│   └── pi/
│       └── launcher.test.ts
├── infrastructure/
│   ├── browser.test.ts
│   └── rpc.test.ts
└── ui/
    ├── basic/
    │   ├── native.test.ts            # Bucle de comandos, /logout local y /login
    │   └── claude.test.ts            # Consentimiento de logout en Claude y reconexión
    └── startup/
        ├── engine-picker.test.ts
        └── visual-picker.test.ts
tests/
├── architecture/
│   └── layers.test.ts                # Fronteras entre capas y propiedad de session.ts
├── integration/
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
- **Pruebas automatizadas:** **74 pruebas superadas en 23 archivos** (0 fallos, 344 aserciones `expect()`).
- **Compilación de producción:** `dist/cli.js` generado correctamente (94.1 KB).

> [!WARNING]
> **Límite de verificación:** Estas 74 pruebas automatizadas validan con rigor los contratos lógicos, máquinas de estado, desconexión local, buffers y dobles de transporte RPC. **NO representan una validación manual completa con cuentas reales ni en todos los sistemas operativos (Windows, Linux)**.

---

## 8. Alcance pendiente y próximos pasos

1. **Gestor visual de workspaces estilo Orca:** Permanece fuera de alcance; se mantiene el modelo de **una sesión activa por instancia de terminal**.
2. **Validación multiplataforma:** Verificación exhaustiva de rutas de ejecutables y comandos en Windows y distribuciones Linux.
3. **Motores de inferencia local:** Adaptadores para runtimes locales (como Ollama o vLLM).
4. **Internacionalización bilingüe de la interfaz TUI (ES/EN):** Actualmente los textos interactivos se presentan en inglés.
5. **Integración con memoria persistente Forge614-Engram:** Diferida formalmente hasta la conclusión y estabilización de la etapa 2.
