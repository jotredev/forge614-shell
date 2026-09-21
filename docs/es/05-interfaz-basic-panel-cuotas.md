# 05 — Interfaz Basic y chat

Como el tablero de un automóvil, la interfaz Basic muestra lo que el motor reporta; no inventa una aguja cuando el sensor no existe.

La interfaz Basic es la única interfaz visual disponible. El selector inicial pide confirmación incluso si hay una sola opción. Los asistentes de chat son Claude Code y Codex.

## Controles públicos dentro del chat

| Control | Efecto |
| --- | --- |
| `/login` | Conecta Shell con la cuenta nativa existente u ofrece el flujo oficial. |
| `/logout` | Desconecta solo esta sesión Shell; no revoca la cuenta. |
| `/new`, `/resume` | Crea o retoma una conversación del cliente. |
| `/model`, `/effort` | Muestra o ajusta opciones que el cliente informa. |
| `/status` | Muestra estado reportado por el cliente. |
| `/stop`, `/quit` | Interrumpe el turno activo o sale. |
| `/refresh` | Solicita de nuevo las cuotas que Codex o Claude informan; no envía un prompt de chat. |
| `$` | Abre el descubrimiento de skills (instrucciones reutilizables) de Codex. |

La barra de estado, el panel lateral y el historial muestran proyecto, modelo, contexto y cuotas cuando el cliente los expone. “No reportado” significa exactamente que el cliente no entregó el dato. La interfaz no soporta pantallas ni comandos de Gemini o Antigravity.

## Actividad de memoria Engram

Como ver encenderse una luz del archivador, la tarjeta de actividad del chat muestra cuándo el asistente está usando una herramienta de memoria, sin revelar el contenido de la configuración.

Cuando Claude Code o Codex llama una herramienta del servidor MCP `forge614-engram`, la tarjeta muestra `🧠` y un nombre legible: por ejemplo, `🧠 memory search` en lugar de `mcp__forge614-engram__memory_search`. El cerebro identifica solo el servidor conocido Engram; no infiere que otros servidores sean memoria. Para otro MCP se muestra `servidor: herramienta`, por ejemplo `github: create_issue`.

Claude Code obtiene el dato del nombre de herramienta que entrega su SDK: `mcp__<servidor>__<herramienta>`. Codex lo obtiene de `item.server` e `item.tool` en sus notificaciones `mcpToolCall` de `app-server` (protocolo JSON-RPC para su interfaz). Esos campos se verificaron con una sesión real antes de implementar el indicador. La lógica compartida está en `src/engines/mcp-labels.ts` y tiene pruebas propias.

## Sesiones y permisos

Codex lista y retoma hilos del directorio actual; rechaza un hilo de otro proyecto o activo en otro cliente. Los modos de trabajo de Codex proceden de sus requisitos de configuración y pueden combinar política de aprobación con sandbox. Claude mantiene su propio historial nativo. Antes de una acción que requiera confirmación, Shell muestra la pregunta en la interfaz.

## Arranque visible y bienvenida

Como esperar el ascensor viendo que la flecha se mueve, el arranque deja claro que Shell sigue trabajando mientras consulta qué motores están disponibles.

En una terminal interactiva, Shell muestra el spinner `Detecting installed AI engines…` antes de abrir el selector. La detección usa un proceso asíncrono (`execFile`), no una espera síncrona que congele el proceso; por eso la animación puede seguir actualizándose. En una salida sin TTY se imprime el mismo mensaje una vez, sin animación. Cuando termina la consulta, el indicador se limpia y continúa el flujo normal.

La bienvenida destaca `FORGE614` en negritas y muestra la versión de Shell como `v<versión>` a la derecha cuando el ancho de la terminal alcanza. Es información de identidad de la aplicación, no una afirmación sobre la versión de Claude Code o Codex.

## Transcripción: actividad, cambios y errores

Como un registro de vuelo, el historial separa los eventos rutinarios de los momentos que exigen inspección o una decisión.

Las llamadas rutinarias de herramientas —búsquedas, lecturas, Bash, MCP/Engram y similares— se renderizan como una viñeta no interactiva y, si hay detalle, una sola línea de vista previa debajo. No tienen borde, fondo ni control para expandir: la actividad resumida es todo lo que se presenta. Las solicitudes de permiso mantienen una tarjeta completa porque la persona debe poder leer el contexto antes de decidir.

Cuando Claude Code informa una edición `Edit` o `Write`, Shell presenta un diff por línea en vez del objeto JSON de la herramienta: líneas eliminadas en rojo, agregadas en verde, líneas de contexto atenuadas y un canal de numeración. Para proteger la fluidez del chat, el cálculo usa una comparación de subsecuencias comunes para cambios habituales, cae a una vista gruesa para archivos demasiado grandes y muestra como máximo 60 filas antes de indicar que quedan más.

Claude Code y Codex mantienen una vista de transcripción independiente. Al alejarse del último mensaje aparece, centrado bajo el encabezado, el botón flotante `↓ New messages · jump to latest`; al pulsarlo vuelve al final. El botón se oculta automáticamente al volver a seguir el final del chat.

Errores como un turno detenido, un comando inválido, una solicitud de permiso sin respuesta válida o un fallo de conexión se insertan con texto rojo. `ChatText` acepta un color base para que el formato Markdown del error conserve esa señal visual, en lugar de confundirse con una respuesta normal.

## Estado vivo, modelo y razonamiento

Como el semáforo de una consola de operaciones, el compositor comunica si se puede escribir, si el motor está ocupado o si espera una decisión humana.

`Ready` usa verde; `Working` usa ámbar y reemplaza el punto estático por un spinner; `Awaiting permission` usa rojo. Mientras hay un turno activo, Claude Code y Codex actualizan el estado cada medio segundo y muestran el tiempo transcurrido, por ejemplo `Working · 12s`. Al terminar o cancelarse el turno, el contador se detiene.

Los menús de `/model` y `/effort` son elecciones explícitas: numeran las opciones, alinean la columna principal y marcan con `✓` el valor activo aunque el cursor esté sobre otra opción. Esto evita confundir la opción enfocada con la configuración que se usará realmente.

Para Claude Code, el sidebar intenta mostrar el nombre amigable que ofrece el catálogo —por ejemplo, `Opus (1M context)`— en vez de un identificador técnico. Si la elección o la telemetría no tienen una coincidencia exacta en el catálogo, aplica una conversión legible del identificador sin inventar un nombre de producto.

Shell recuerda por separado el modelo y el nivel de razonamiento elegidos para `claude` y `codex` en `~/.forge614/shell/preferences.json` (o bajo `FORGE614_HOME` si se definió). Es una preferencia propia de Shell, no modifica la configuración nativa de los CLIs. Leer o escribir ese archivo es una comodidad de mejor esfuerzo: un archivo ausente o inválido, una escritura fallida o un modelo ya no ofrecido dejan que la sesión continúe con los valores disponibles.

En el sidebar, la ausencia de razonamiento explícito se llama `Default (auto)`. En el selector de razonamiento de Claude Code aparece `Default (recommended)` y explica `Claude Code decides — shown in the sidebar after you send a message`: Claude no comunica de antemano el nivel concreto que resolverá, por lo que Shell lo declara en vez de adivinarlo.

## Métricas del sidebar

Como agrupar los instrumentos de consumo junto al medidor de combustible, el sidebar coloca los datos de uso donde se interpretan juntos y deja la RAM como recurso del proceso.

Los tokens de la última respuesta (`Last turn`, entrada y salida) y el importe estimado quedan debajo de `PLAN USAGE`, antes de `RESOURCES`; ya no se mezclan con la RAM de Shell o del motor. El importe se rotula `Est. API cost` y siempre añade `Reference only, not billed`: es una referencia estimada, no un cargo facturado por Shell.

Los conteos compactos usan `1M`, no `1000k`, y conservan una decimal solo cuando aporta información: `1.5k`, `43k`, `1M` y `1.5M`. El anillo de contexto y las porciones llenas de las barras de uso comparten una escala de alerta: color normal por debajo de 85 %, ámbar desde 85 % y rojo desde 100 %. Así el color expresa cercanía al límite, no solo una preferencia estética.
