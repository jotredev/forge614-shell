# 05 — Interfaz Basic, panel lateral y cuotas

2026-09-17 · Etapa 02: implementación del entorno base (en curso) · Revisión documental: 2 · [English](../en/05-basic-ui-sidebar-quotas.md) · [Índice](../../README.md)

Este documento detalla la implementación de la **interfaz visual Basic**, el **panel contextual lateral**, la **barra de estado inferior con identidad de proyecto**, el **sistema de comandos agrupados y selección por teclado**, el **descubrimiento de habilidades nativas en Codex (`$`)**, los **modos de trabajo conmutable (`Shift+Tab`)**, el **control de scroll independiente**, la **consulta no invasiva de cuotas (`/refresh`)** y la calidad garantizada mediante **122 pruebas automatizadas en 31 archivos** en Forge614-Shell.

---

## 1. La Analogía Maestra: El Puesto de Conducción con Instrumental de Bordo

Imaginemos el habitáculo de un vehículo de alto rendimiento o la cabina de un avión de reconocimiento:
- **La Ventana Principal (Chat y Compositor):** Es el parabrisas con visualización frontal (*HUD*). Frente al piloto se proyecta el registro de ruta (historial de conversación) y el volante de control (el compositor enmarcado), diseñados con precisión ergonómica para introducir instrucciones directas sin desviar la mirada.
- **El Selector de Modo en el Volante (`Shift+Tab`):** En lugar de escribir comandos farragosos, un pulsador táctil en el volante permite alternar al instante entre modos de pilotaje: manual con confirmación estricta, asistencia automática en entornos de confianza, o modos de planificación pura. Si se selecciona el modo sin restricciones de permisos (`▶▶ bypass permissions on`), el testigo se ilumina en rojo vivo advirtiendo del peligro; dicho modo jamás se conecta en automático al encender el vehículo.
- **El Cajón de Herramientas Especializadas (`$` en Codex):** Al pulsar la tecla `$`, el piloto despliega el catálogo de instrumental especializado disponible en la nave (habilidades locales del proyecto, de la cuenta o de plugins instalados), cargando directamente la referencia técnica en la línea de comandos sin saturar los canales de telemetría.
- **El Cuadro de Instrumentos (Panel Lateral / Sidebar):** A la derecha se sitúa el instrumental de telemetría. No adivina la cantidad de combustible: consulta los sensores físicos del motor. Si el sensor de contexto envía datos, dibuja una aguja circular digital con caracteres braille compactos; si el sensor no existe o el motor no lo expone, el indicador marca con honestidad *"Measurement unavailable"*. Las métricas internas no destinadas al piloto se filtran para evitar ruido visual, y la memoria consumida por Shell se reporta con exactitud.
- **La Barra de Estado de Navegación (Pie de Página):** Bajo el parabrisas principal, una franja condensada informa permanentemente la ruta de trabajo en formato relativo (`~/project`), la rama Git en cian y el estado del repositorio (`Clean` o `X changes` en ámbar de advertencia).
- **Los Amortiguadores de Dirección (Scroll Independiente):** Mover la mirada por los mapas del instrumental lateral no mueve el volante ni el parabrisas principal. Ambos paneles se desplazan por separado, absorbiendo vibraciones para que consultar métricas no sacuda el espacio de trabajo.

---

## 2. Interfaz Basic de Forge614-Shell

La interfaz inicial adoptada es una experiencia **AI-first en terminal** concebida para maximizar el área útil de lectura y escritura:

```
┌────────────────────────────────────────────────────────┬──────────────────────────────────────┐
│ FORGE614 / SHELL                         workspace-dir │ // SESSION                           │
├────────────────────────────────────────────────────────┤ Account   Connected                  │
│                                                        │ Provider  Claude Code / Codex / agy  │
│ ## YOU · 14:25                                         │ Model     claude-3-7-sonnet          │
│ Explica el flujo de inicialización del workspace       │ Session   New conversation           │
│                                                        │                                      │
│ ## ASSISTANT · 14:25                                   │ // CONTEXT                           │
│ El flujo de inicialización se divide en tres fases... │   ⢀⣴⣶⣦⡀    Conversation              │
│                                                        │   ⣾⣿ 18% ⣿⣷  18% used · 82% free       │
│ │ ▾ Bash tool                                          │   ⠈⠻⣶⡿⠃   36k / 200k tokens         │
│ │ Running · 0.4s                                       │                                      │
│                                                        │ // PLAN USAGE                        │
│                                                        │ 5-hour limit · 32% used              │
│                                                        │ ████████░░░░░░░░░░░░░░░░             │
│                                                        │ Resets in 3h 12m                     │
│                                                        │                                      │
│                                                        │ // RESOURCES                         │
│                                                        │ Shell RAM   48.2 MB                  │
│                                                        │ Engine RAM  Not reported by engine   │
│                                                        │                                      │
│ ╭─ ● Ready ──────────────────────────────────────────╮ │                                      │
│ │                                                    │ │                                      │
│ │ Escribe un mensaje o comando...                    │ │                                      │
│ │                                                    │ │                                      │
│ │ Ⅱ manual mode on   asks before risky actions · ⇥  │ │                                      │
│ ╰────────────────────────────────────────────────────╯ │                                      │
├───────────────────────────────────────────────────────────────────────────────────────────────┤
│ F614 · Claude Code · claude-3-7-sonnet · ctx 18% · ~/project · main · Clean                   │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Características visuales y de diseño
1. **Paleta de diseño Forge614 (`theme.ts`):**
   - **Fondo de terminal:** Fondo oscuro profundo (`#0c1318` / `rgb(12, 19, 24)`), aplicado de manera aislada dentro de la pantalla alterna (`\x1b[?1049h`) y restaurando limpiamente los colores originales al salir (`workspaceTerminal`).
   - **Acento cian:** `#46dee0` (`rgb(70, 222, 224)`) para títulos, marcos, barras de progreso y cursores.
   - **Texto en primer plano:** `#dce6eb` (`rgb(220, 230, 235)`).
   - **Texto secundario y bordes:** `#889eab` (`rgb(136, 158, 171)`) y `#31454e` (`rgb(49, 69, 78)`).
   - **Fondo de tarjetas y bloques:** Fondo atenuado `#141f27` (`rgb(20, 31, 39)`).
2. **Selector de interfaz en arranque (`visual-picker.ts`):**
   - Al iniciar `forge614-shell`, se presenta el selector:
     - `Basic — Minimal interface` (disponible y seleccionado por defecto).
     - `Full — Coming later (disabled)` (deshabilitado; si el usuario intenta elegirlo, la interfaz informa que Full está reservada para etapas posteriores y vuelve a solicitar Basic).
3. **El compositor enmarcado (`composer.ts`):**
   - Marco perimetral cian con caja de esquinas redondeadas (`╭─`, `╮`, `│`, `╰─`, `╯`).
   - Indicador de estado integrado en el marco superior: `● Ready` cuando está en espera o `● Working` cuando la IA o herramientas están activas.
   - Soporte nativo para saltos de línea con `Shift+Enter` y atajo de envío con `Enter`.
   - Barra de ayuda inferior interna: muestra dinámicamente el modo de trabajo activo (e.g. `Ⅱ manual mode on` con `asks before risky actions · Shift+Tab to cycle`) o las ayudas de comandos (`/help or /commands · Browse commands` a la izquierda y `Shift+Enter newline` a la derecha).
   - Márgenes laterales calculados (`margin = width >= 14 ? 2 : 0`) para garantizar alineación visual perfecta entre el flujo de chat superior y el compositor inferior.
   - Control de eventos de ratón para apropiarse de gestos de edición e impedir que selecciones de pantalla de terminal de bajo nivel pinten artificios visuales.
4. **Mensajes y tarjetas estructuradas (`transcript.ts`):**
   - Encabezados con rol y marca de tiempo (`## YOU · 14:25`, `## ASSISTANT · 14:25`).
   - Bloques de código con fondo diferenciado, bordes y renderizado Markdown de texto enriquecido (negrita, cursiva, listas, enlaces).
   - **Tarjetas de actividad de herramientas (`ActivityCard`):** Borde lateral cian `│`, título colapsable/expandible (`▾` / `▸`), detalle con padding interior y fondo destacado `panelBackground`, garantizando que ningún texto toque los bordes físicos de la tarjeta. Al completarse, sustituye el indicador de progreso en vuelo por el estado de término (`Completed` o `Failed`) y la duración en segundos.

---

## 3. Panel Lateral Contextual (*Sidebar*)

El panel lateral (`sidebar.ts`) ocupa una columna derecha de ancho flexible (base 36 columnas, mín. 32, máx. 42), visible en terminales con ancho mayor o igual a 100 columnas.

Se organiza en cuatro secciones estrictas, sin secciones obsoletas ni botones redundantes:

### 1. `// SESSION` (Datos de la sesión activa)
Muestra únicamente métricas reales informadas por el conector o estado de Shell:
- **Account:** `Connected` (en verde/cian) o estados transitorios (`Checking…`, `Unverified`, `Disconnected`).
- **Provider:** Nombre del motor conectado (Claude Code, Codex, Antigravity CLI, Gemini CLI).
- **User:** Correo o nombre de usuario del proveedor si el motor lo expone (por ejemplo, email de ChatGPT en Codex); si no, se muestra explícitamente `"Not reported"`.
- **Model:** Modelo activo o `"Engine default"`.
- **Reasoning:** Nivel de razonamiento/esfuerzo activo o `"Provider default"`.
- **Session:** ID de la conversación o `"New conversation"`.
- **Opened & Shell uptime:** Hora de inicio de la sesión y tiempo de actividad en minutos desde el arranque.

### 2. `// CONTEXT` (Gráfica circular braille y consumo de ventana)
- **Gráfica circular en braille (`contextRing` en `metrics.ts`):** Mediante patrones de puntos Unicode Braille (`U+2800` a `U+28FF`), se dibuja un anillo de 6 filas de altura con porcentaje de uso centrado, sin depender de protocolos gráficos de terminal (como Kitty Graphics o Sixel) que fallan en entornos SSH o terminales básicas.
- **Medición real:** Muestra tokens usados frente al tamaño de la ventana (`36k / 200k tokens`) y porcentaje libre/usado.
- **Honestidad métrica:** Si el motor no informa uso de contexto (como sesiones nuevas antes del primer turno o motores sin API de telemetría de contexto), se indica claramente:
  - `"Measurement unavailable"` o `"Available after first response"`.
  - **Bajo ninguna circunstancia se inventan o simulan cifras de contexto.**

### 3. `// PLAN USAGE` (Barras de cuota del proveedor)
- Representa cuotas reales de la suscripción o cuenta del proveedor (`five_hour`, `seven_day`, etc.).
- Barra de progreso por celdas con bloques cian `█` y celdas de fondo `░`.
- Tiempo de reinicio calculado (`resetLabel`): `"Resets in 3h 12m"`, `"Resets in 2d 4h"`.
- **Filtrado de cubetas internas (`isDisplayableUsage`):** Cubetas técnicas internas de proveedores (como `nimbus_quill`) se filtran automáticamente mediante `isDisplayableUsage()` y nunca se renderizan en el panel, evitando confusión con cuotas reales de usuario.
- **Etiquetas desconocidas de cuota:** Si el proveedor envía identificadores no estándar legítimos, el sistema los formatea de manera neutral como nombres del proveedor (`XYZ (provider)`).
- **Estimaciones de API vs Facturación:** Si el motor expone estimaciones de costo de inferencia, se acompañan obligatoriamente de la advertencia: `"Not your subscription bill"` para evitar confundir la tarifa de suscripción plana con cargos por consumo de tokens.

### 4. `// RESOURCES` (Consumo de memoria)
- Reemplaza la antigua sección de proyecto que fue trasladada a la barra de estado inferior.
- **Shell RAM:** Medición en tiempo real de la memoria residente de la instancia de Shell (`process.memoryUsage().rss`) obtenida a través de `readRuntimeResources()` y formateada en MB legibles (`formatMemory()`).
- **Engine RAM:** Memoria consumida por el proceso del motor de IA. Si el motor o transporte no reporta esta telemetría, se muestra explícitamente `"Not reported by engine"`, prohibiendo terminantemente números fabricados.

### Eliminación del botón de refresco en el sidebar
El antiguo botón interactivo `↻ Refresh · /refresh` que se mostraba en el sidebar fue eliminado del diseño visual para mantener un panel de telemetría puramente informativo. La actualización de cuotas se realiza exclusivamente mediante el comando `/refresh` en el compositor, preservando un diseño sobrio y sin redundancias.

---

## 4. Barra de Estado Inferior (`ShellStatusBar`)

La barra de estado inferior (`status-bar.ts`) se ubica en el pie de la terminal, debajo del área de chat, condensando en una única línea horizontal la identidad de la sesión y el estado del repositorio:

```
F614 · Claude Code · claude-3-7-sonnet · ctx 18% · ~/Desktop/forge614-shell · main · Clean
```

### Elementos y colores semánticos:
1. **Identificador del Shell:** Prefijo `F614` en acento cian (`accent`).
2. **Telemetría condensada:** Proveedor, modelo activo, nivel de razonamiento y porcentaje de ocupación de contexto (`ctx XX%`), visibles únicamente cuando están confirmados.
3. **Identidad del proyecto:**
   - **Ruta compacta:** La ruta de trabajo (`cwd`) se presenta en formato relativo al directorio de usuario mediante `homeRelativePath` (e.g. `~/Desktop/forge614-shell`) en color gris atenuado (`muted`).
   - **Rama Git:** Nombre de la rama activa en cian (`accent`, e.g. `main` o `Detached HEAD`), consultada de forma no bloqueante (`GIT_OPTIONAL_LOCKS=0`).
   - **Estado de cambios:**
     - Si el árbol de trabajo está limpio: `Clean` en cian (`accent`).
     - Si existen archivos modificados o sin seguimiento: `X changes` (e.g. `7 changes`) en ámbar de advertencia (`warning`).
   - **Directorios sin Git:** Si Git no está instalado o la carpeta no es un repositorio, la sección de rama y cambios se omite limpiamente sin imprimir mensajes de error ficticios.

---

## 5. Modos de Trabajo, Habilidades Codex y Menús por Teclado

### 5.1 Modos de trabajo nativos y alternancia con `Shift+Tab`

El usuario puede alternar los modos nativos del motor presionando `Shift+Tab` en cualquier momento mientras el compositor no esté ocupado ejecutando una acción.

**Principio Native-first:** Forge614-Shell no define una capa universal abstracta de modos que enmascare el comportamiento real del motor. Expone con fidelidad las directivas de control soportadas por el motor conectado:

1. **Claude Code (`ClaudeSession.permissionModes`):**
   - Modos nativos del SDK: `default`, `acceptEdits`, `plan`, `dontAsk`, `auto`, `bypassPermissions`.
2. **OpenAI Codex (`configRequirements/read`):**
   - Combinaciones nativas de directivas de aprobación y sandbox reportadas por el App Server: `onRequest:readOnly`, `onRequest:workspaceWrite`, `unlessTrusted:readOnly`, `unlessTrusted:workspaceWrite`.
3. **Gemini ACP y Antigravity:**
   - No exponen modos dinámicos en su protocolo actual; `session.workModes()` devuelve una lista vacía y presionar `Shift+Tab` no altera el sistema ni muestra estados falsos.

#### Presentación visual y colores semánticos en el compositor (`workModePresentation`):
| Modo Nativo | Etiqueta Literal en Inglés | Color Semántico | Mensaje de Ayuda |
| :--- | :--- | :--- | :--- |
| `bypassPermissions` | `▶▶ bypass permissions on` | **Rojo de peligro** (`255;102;136`) | `no confirmations · Shift+Tab to cycle` |
| `auto` / `unlessTrusted` | `▶▶ auto mode on` | **Ámbar advertencia** (`warning`) | `the engine decides approvals · Shift+Tab to cycle` / `trusted workspace` |
| `default` / `onRequest` | `Ⅱ manual mode on` | **Gris atenuado** (`muted`) | `asks before risky actions · Shift+Tab to cycle` / `asks for approval` |
| `acceptEdits` | `▶▶ accept edits on` | **Púrpura** (`176;132;255`) | `auto-approves file edits · Shift+Tab to cycle` |
| `plan` | `Ⅱ plan mode on` | **Turquesa plan** (`52;170;166`) | `plans only; tools cannot run · Shift+Tab to cycle` |
| `dontAsk` | `Ⅱ don't ask mode on` | **Ámbar advertencia** (`warning`) | `denies actions without prior approval · Shift+Tab to cycle` |

> [!CAUTION]
> **Implicación crítica de seguridad (`bypassPermissions`):**
> El modo `bypassPermissions` ejecuta comandos de sistema y modificaciones de archivos sin solicitar autorización previa. **Forge614-Shell NUNCA inicia en este modo ni lo activa de manera predeterminada.** Únicamente se habilita si el usuario lo selecciona explícitamente ciclando con `Shift+Tab`, mostrándose siempre en rojo intenso como advertencia de riesgo activo.

---

### 5.2 Descubrimiento de Habilidades nativas en Codex (`$`)

En OpenAI Codex, escribir el carácter `$` en el compositor activa el autocompletado interactivo de habilidades nativas (`CODEX SKILLS`):

1. **Rutas de descubrimiento (`discoverCodexSkills` en `skills.ts`):**
   - **Proyecto:** Directorio `.agents/skills` en el directorio de trabajo actual y recursivamente en sus directorios padre.
   - **Usuario:** `~/.agents/skills` y `~/.codex/skills`.
   - **Sistema:** `/etc/codex/skills`.
   - **Plugins instalados:** `~/.codex/plugins/cache/**/skills` (inspección de árboles de plugins hasta profundidad 6).
2. **Formato:** Lee los ficheros `SKILL.md`, parseando los campos de frontmatter YAML `name:` y `description:`.
3. **Inserción ergonómica:**
   - La habilidad elegida se inserta como `$nombre-skill` directamente en el texto del prompt.
   - **Separación de responsabilidades:** Las habilidades con `$` no son comandos slash (`/`). Los comandos slash ejecutan operaciones del plano de control en Shell o el motor, mientras que `$skill` aporta directivas contextuales nativas al modelo dentro del turno de trabajo.
   - El contenido íntegro del fichero Markdown de la habilidad nunca se inyecta indiscriminadamente como texto plano en el prompt; se envía el identificador estructurado que Codex resuelve internamente.

---

### 5.3 Menú de Comandos Agrupado (`/help` y `/commands`)

Al teclear `/` o invocar `/commands` / `/help`, el compositor despliega un menú flotante organizado por grupos de proveedor:

```
CLAUDE CODE
› /model    Select model
  /effort   Select reasoning
  /resume   Chat history
  /new      New conversation
  /login    Connect account
  /logout   Disconnect locally
  /status   Session details
  /stop     Cancel active turn
FORGE614
  /refresh  Refresh plan usage
  /commands Browse commands
  /quit     Exit Shell
Commands · 1–5 of 11 · ↑/↓ choose · Enter confirm · Esc cancel
```

- **Agrupación estricta:**
  - Primero se muestran los comandos del motor activo (`CLAUDE CODE`, `CODEX`, `GEMINI CLI`, `ANTIGRAVITY CLI`).
  - Segundo se muestran los comandos propios de `FORGE614`: únicamente `/refresh`, `/commands` y `/quit`.
  - **Sin duplicaciones:** `/model`, `/effort`, `/resume`, etc., pertenecen a la categoría del proveedor y no se repiten bajo Forge614.
- **Contador y ayudas de navegación:** La línea inferior del menú refleja en todo momento la posición actual (`Commands · 1–5 of 11 · ↑/↓ choose · Enter confirm · Esc cancel`).
- **Navegación fluida:** Flechas arriba/abajo (`↑/↓`), selección y ejecución con `Enter` o `Tab`, y cierre con `Esc`.

---

### 5.4 Selectores Nativos de Modelo y Razonamiento (Claude Code)

- **`/model`:** Despliega el catálogo de modelos reportados por Claude (`session.models`), mostrando su nombre de presentación (`displayName`) y su descripción técnica (`description`), e.g. `claude-3-7-sonnet · Most intelligent model`. Si no se han recibido modelos al inicio, se cargan mediante un handshake del plano de control que **nunca envía prompts ni consume tokens**. Si se pasa un argumento (`/model claude-3-5-haiku`), se valida contra el catálogo antes de aplicarse.
- **`/effort` o `/thinking`:** Despliega los niveles de esfuerzo de razonamiento soportados por el modelo activo (`supportedEffortLevels`, tales como `default`, `low`, `medium`, `high`, `xhigh`, `max`). Si el modelo actual no admite razonamiento extendido, el sistema informa con franqueza: *"The engine has not reported reasoning options for this model."*, impidiendo configuraciones inválidas.

---

### 5.5 Solicitudes de Permisos y Control de Turnos

Cuando un motor requiere autorización para ejecutar una herramienta en el sistema (por ejemplo, escribir un archivo o ejecutar bash), el compositor presenta el selector:
```
Permission · /yes allow once · /no deny · /stop cancel turn
› /no   Deny
  /yes  Allow this call only
```
- **Alternativas equivalentes:** El usuario puede seleccionar con flechas y presionar Enter, o escribir directamente `/yes`, `/no`, pulsar `Esc` o escribir `/stop`.
- **El comando `/stop`:** Cancela el turno o la operación de autenticación en curso; **no cierra Shell, no desconecta la cuenta y no revierte modificaciones** de archivos que ya hayan sido ejecutadas en el sistema operativo.
- **El comando `/logout` local:** Desconecta la sesión en memoria de Forge614-Shell; **no ejecuta logout nativo en el proveedor ni afecta a Orca ni a otras terminales**.

---

## 6. Scroll y Controles de Terminal

La terminal física opera sobre una rejilla discreta de celdas de caracteres sin soporte nativo para desplazamiento subpíxel. Para ofrecer una ergonomía fluida dentro de estas restricciones:

1. **Scroll totalmente independiente (`IndependentScrollView`):**
   - El historial de chat (panel izquierdo) y el panel lateral contextual (panel derecho) tienen árboles de desplazamiento completamente separados.
   - **Corrección de arrastre cruzado:** Se resolvió el problema donde hacer scroll con la rueda del ratón en el panel lateral arrastraba el chat principal. `IndependentScrollView` captura y consume el evento de rueda (`delta`) en el panel sobre el que se encuentra el puntero, evitando que el excedente se propague al panel contiguo (`overscroll: "contain"`).
2. **Scrollbars invisibles conservando desplazamiento:**
   - Se configuraron los paneles con `scrollbar: "hidden"`. Se eliminaron las barras de desplazamiento verticales de caracteres que ensuciaban el diseño, manteniendo la capacidad de scroll con ratón, trackpad o teclado.
3. **Transición corta por fotogramas (`advance()`):**
   - Para evitar saltos abruptos cuando la rueda del ratón envía ráfagas de movimiento, `IndependentScrollView` interpola el desplazamiento hacia la posición objetivo mediante un temporizador desacoplado (`setTimeout` a 16 ms) con avance fraccionario del 40% de la distancia restante (`Math.ceil(distance * 0.4)`).
   - Si el usuario invierte la dirección de la rueda, el movimiento anterior se cancela inmediatamente en lugar de forzar al usuario a esperar que termine la inercia anterior.

---

## 7. Consulta de Cuotas sin Consumo de Tokens (`/refresh`)

Forge614-Shell estandariza la capacidad de actualización manual de consumo:

1. **Invocación:** Mediante el comando de chat `/refresh` en el compositor.
2. **Consulta sin consumo de turnos ni tokens de IA:**
   - **Claude Code (`catalog.ts`):** Ejecuta un handshake en el plano de control (`loadClaudeCatalog`) con un generador de entrada abierto que **nunca emite un mensaje de usuario**. Llama a la API de uso interna del SDK sin disparar una consulta al modelo LLM.
   - **Codex (`codex/session.ts`):** Envía la petición RPC `account/rateLimits/read` directamente al App Server de Codex, obteniendo las cuotas de 5 horas y semanales sin iniciar una conversación.
   - **Antigravity (`antigravity/process.ts`):** Invoca `agy -p /usage` en un subproceso desacoplado de la terminal, parseando los porcentajes de cuota restantes sin interactuar con el modelo de chat.
   - **Gemini CLI (ACP):** Si el servidor ACP de Gemini CLI no expone un método de lectura de cuota, el comando informa con total claridad: `"Usage refresh is not supported by this engine"`.

---

## 8. Arquitectura, Pruebas y Calidad

El proyecto mantiene la separación estricta en capas (UI, Aplicación, Motores e Infraestructura) con **pruebas coubicadas (*colocated tests*)**.

### Resumen de la suite de verificación automatizada (`bun run check`):
- **122 pruebas pasando (0 fallos)** en **31 archivos de prueba**, con **559 aserciones (`expect()`)**.
- **Typecheck estricto:** `tsc --noEmit` superado sin advertencias ni tipos inseguros.
- **Build de producción:** `bun build src/cli.ts -> dist/cli.js` (148.84 KB).

### Principales pruebas de regresión verificadas:
| Archivo de Test | Casos Clave Verificados |
| :--- | :--- |
| `src/ui/basic/workspace-chrome.test.ts` | Compositor enmarcado como superficie de escritura; modos de trabajo nativos con etiquetas en inglés y colores semánticos correspondientes; preservación de saltos de línea y adaptación a terminales estrechas y anchas; renderizado de Markdown enriquecido; status bar compacta en una sola línea; identidad de proyecto bajo el chat; colores semánticos de ruta, rama y cambios Git. |
| `src/ui/basic/sidebar.test.ts` | El refresco de cuotas es invocable sin renderizar un botón en el sidebar; sidebar conectado muestra telemetría real y oculta datos inventados; agrupación de sesión, contexto y cuotas; exclusión estricta de la cubeta interna Nimbus Quill; sidebar desconectado oculta datos del motor anterior; visualización de RAM de Shell sin repetir identidad de proyecto; delegación del estado de proyecto al pie de página. |
| `src/ui/basic/shell-state.test.ts` | Desconexión limpia detalles del motor en memoria; estado conectado expone únicamente datos propiedad de Shell; conservación de memoria RAM de Shell medida sin inventar memoria del motor. |
| `src/ui/basic/status-bar.ts` (en tests) | Formato relativo de ruta (`homeRelativePath`); cálculo de cambios y rama Git con colores semánticos (cian para rama limpia, ámbar para modificaciones). |
| `src/engines/codex/skills.test.ts` | Descubrimiento de habilidades Codex mediante ficheros `SKILL.md` con nombre y descripción en `.agents/skills` de proyecto; descubrimiento de habilidades instaladas a través de plugins (`.codex/plugins/cache`). |
| `src/engines/codex/session.test.ts` | Refresco manual de cuotas sin iniciar turno; logout local y reconexión reutilizando cuenta intacta; limpieza de telemetría visual tras logout; aplicación estricta de modos permitidos por el app-server; streaming de turnos y respeto a permisos denegados. |
| `src/engines/claude/session.test.ts` | Aplicación del modo de permisos nativo al turno siguiente; lectura de resumen de contexto antes del cierre del canal; bloqueo de escritores concurrentes; herramientas denegadas y canceladas no se convierten en aprobaciones. |
| `src/engines/claude/catalog.test.ts` | Consulta de modelos y cuota sin emitir prompts; tolerancia a versiones antiguas de CLI. |
| `src/engines/antigravity/process.test.ts` | Conversión de porcentaje restante en porcentaje usado sin prompt al LLM; cancelación de subprocesos resistentes a SIGTERM. |
| `src/engines/antigravity/session.test.ts` | Logout local confirma y bloquea llamadas al modelo hasta login explícito; reconexión agy sin abrir UI externa. |
| `src/engines/gemini/session.test.ts` | Autenticación única mediante Google y permisos ACP nativos; carga de historial sin prompts; bloqueo de escritores concurrentes. |

---

## 9. Limitaciones Conocidas (*Known Limitations*)

Para mantener la honestidad técnica y delimitar con precisión el estado actual del producto:

1. **Restricciones gráficas de emuladores de terminal:**
   - La terminal no garantiza renderizado de imágenes o gráficos vectoriales (SVG) en todas las plataformas y clientes SSH. Por este motivo, la gráfica de contexto se implementa mediante caracteres Unicode Braille portables en lugar de protocolos gráficos como Kitty o Sixel.
2. **Scroll basado en celdas de texto:**
   - El desplazamiento en terminal está físicamente limitado a filas completas de caracteres de texto. Aunque las transiciones animadas suavizan la inercia, la terminal no puede realizar scroll continuo a nivel de subpíxel como una página web.
3. **Métricas no reportadas por los motores:**
   - Si un conector o protocolo (como Gemini ACP) no expone cuotas, ventana de contexto o nivel de razonamiento, Shell no genera métricas sintéticas. Esas secciones reflejan explícitamente *"Measurement unavailable"* o *"Usage unavailable from provider"*.
4. **Memoria de motor en procesos desacoplados:**
   - Cuando el motor corre como un servidor desacoplado o daemon externo, la memoria del motor no se puede medir directamente con fiabilidad sin permisos de sistema adicionales, marcándose con rigor como `"Not reported by engine"`.
5. **Interfaz Full diferida:**
   - La interfaz avanzada con pestañas múltiples, gestor visual de worktrees y soporte multi-ventana estilo IDE permanece fuera del alcance de esta entrega y se mantiene deshabilitada en el selector de arranque.
6. **Validación en entornos reales:**
   - Las 122 pruebas automatizadas garantizan exhaustivamente los contratos y máquinas de estado mediante mocks rigurosos y ejecución headless; no se han consumido tokens comerciales en vivo en todos los sistemas operativos (macOS, Windows, Linux).
