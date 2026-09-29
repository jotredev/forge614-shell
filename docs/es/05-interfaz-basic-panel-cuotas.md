# 05 — Interfaz Basic y chat

Como el tablero de un automóvil, la interfaz Basic muestra lo que el motor reporta; no inventa una aguja cuando el sensor no existe.

La interfaz Basic es la única interfaz visual disponible. El selector inicial pide confirmación incluso si hay una sola opción. Los asistentes de chat son Claude Code y Codex.

## Controles públicos dentro del chat

| Control | Efecto |
| --- | --- |
| `/login` | Conecta Shell con la cuenta nativa existente u ofrece el flujo oficial. |
| `/logout` | Desconecta solo esta sesión Shell; no revoca la cuenta. |
| `/new` | Crea una conversación nueva del cliente. |
| `/resume` | Abre un selector con las conversaciones guardadas de este proyecto, la más reciente arriba. Cada fila muestra el título, la fecha, el primer mensaje y la carpeta, solo lo que el asistente informa. Las flechas se mueven, escribir filtra (título, primer mensaje y carpeta, sin distinguir mayúsculas ni acentos), Enter retoma la resaltada y Esc cancela sin cambiar nada. `/resume <número>` (la posición de la fila en esa lista) y, en Codex, `/resume <id>` siguen funcionando. |
| `/model`, `/effort` | Muestra o ajusta opciones que el cliente informa. |
| `/compact` | Codex: le pide al propio motor de Codex que compacte la conversación (`thread/compact/start`) y avisa cuando termina; la memoria de Engram se vuelve a enviar con tu siguiente mensaje, igual que al abrir un hilo. Claude Code: pasa el comando a Claude Code. Cualquier otro `/comando` que Shell no pueda pasar a Codex se responde con «Codex no permite /x desde Shell todavía», no con «Comando desconocido». |
| `Shift+Tab` | Cambia el modo de trabajo en cualquier momento, también a mitad de un turno o con un permiso pendiente. Claude Code aplica el cambio al instante. Codex lee el modo en cada turno, así que Shell acepta el cambio y avisa en una línea que se aplicará en el siguiente turno. |
| `/status` | Muestra estado reportado por el cliente. Con Codex agrega también la carpeta, el modo de trabajo y la conversación, como el `/status` de Codex. |
| `/f614:stop` | Propio de Shell, en Claude Code y en Codex: cancela la respuesta en curso. Antes era `/stop`, que ahora pertenece a Codex. |
| `/quit` | Sale de Shell. |
| `/refresh` | Solicita de nuevo las cuotas que Codex o Claude informan; no envía un prompt de chat. |
| `$nombre` | Codex: el autocompletado de `$` lista el catálogo oficial de habilidades (skills: instrucciones reutilizables) de Codex desde `skills/list`, con las de plugins y sin las que Codex tiene apagadas. Cada `$nombre` reconocido en un mensaje se envía a Codex como una habilidad de verdad (`{ type: "skill", name, path }`) junto al texto del mensaje, que queda tal como lo escribiste; un `$palabra` que no es habilidad queda solo como texto. |

Comandos propios de Codex, conectados por su app-server (cada uno muestra un mensaje corto; los nombres y las descripciones de Codex no se traducen):

| Comando | Qué hace |
| --- | --- |
| `/rename <nombre>` | Cambia el nombre de la conversación (`thread/name/set`). |
| `/clear` | Empieza una conversación nueva al instante (`thread/start`) y limpia la vista. |
| `/archive` | Archiva la conversación (`thread/archive`) y te deja en una nueva. |
| `/delete` | Antes pregunta «Sí / No» (Enter sobre «No», o Esc, no cambia nada) y luego borra la conversación para siempre (`thread/delete`). |
| `/goal`, `/goal <meta>`, `/goal clear` | Muestra, fija o borra la meta de una tarea larga (`thread/goal/get`, `set`, `clear`). |
| `/mcp`, `/mcp verbose` | Lista los servidores MCP configurados (conexiones con herramientas externas) y sus herramientas; verbose agrega versión, estado de inicio de sesión, dirección y la descripción de cada herramienta (`mcpServerStatus/list`). |
| `/hooks` | Muestra los hooks (acciones que Codex ejecuta solo en momentos fijos) con `hooks/list`; solo verlos, administrarlos no está conectado. |
| `/usage` | Muestra el uso de tokens de la cuenta (`account/usage/read`); usar un reinicio del límite de uso todavía no está conectado. |
| `/skills` | Lista las habilidades que Codex ofrece para esta carpeta (`skills/list`). |
| `/pwd` | Muestra la carpeta de trabajo; no llama a nada. |
| `/ps`, `/stop` | «Listar terminales en segundo plano» y «detener todas las terminales en segundo plano» de Codex (`thread/backgroundTerminals/list` y `/clean`). Esos dos métodos existen solo en el protocolo experimental de Codex, por eso Shell declara `experimentalApi` al conectarse. |

Con Codex, el menú de `/` (y `/commands`) lista los comandos de Codex con la descripción de Codex, en el orden de Codex, y solo los que Codex muestra en macOS; los propios de Shell (`/login`, `/refresh`, `/commands`, `/f614:stop`) van aparte bajo FORGE614. Los comandos que pueden correr mientras Codex trabaja (`/rename`, `/goal`, `/mcp`, `/hooks`, `/usage`, `/skills`, `/pwd`, `/ps`, `/stop`) lo hacen; los demás esperan a que termine el turno. Un comando de Codex que Shell todavía no conectó se responde con «Codex no permite /x desde Shell todavía»; un nombre que no es de Codex es «Comando desconocido».

El panel lateral muestra la sesión, el modelo, el razonamiento, el contexto y las cuotas, y la barra de estado bajo el chat muestra solo lo que el panel no repite: trabajo en segundo plano, carpeta, rama y estado de Git. El historial muestra la conversación, con cada herramienta con sangría bajo el mensaje del asistente al que pertenece. “No reportado” significa exactamente que el cliente no entregó el dato. La interfaz no soporta pantallas ni comandos de Gemini o Antigravity.

## Actividad de memoria Engram

Como ver encenderse una luz del archivador, la tarjeta de actividad del chat muestra cuándo el asistente está usando una herramienta de memoria, sin revelar el contenido de la configuración.

Cuando Claude Code o Codex llama una herramienta del servidor MCP `forge614-engram`, la tarjeta muestra `🧠` y un nombre legible: por ejemplo, `🧠 memory search` en lugar de `mcp__forge614-engram__memory_search`. El cerebro identifica solo el servidor conocido Engram; no infiere que otros servidores sean memoria. Para otro MCP se muestra `servidor: herramienta`, por ejemplo `github: create_issue`.

Claude Code obtiene el dato del nombre de herramienta que entrega su SDK: `mcp__<servidor>__<herramienta>`. Codex lo obtiene de `item.server` e `item.tool` en sus notificaciones `mcpToolCall` de `app-server` (protocolo JSON-RPC para su interfaz). Esos campos se verificaron con una sesión real antes de implementar el indicador. La lógica compartida está en `src/engines/mcp-labels.ts` y tiene pruebas propias.

## Memoria de tres ámbitos y avisos de Engram

Como tres estantes que se consultan a la vez —el de la persona, el del pasillo compartido con otros repositorios y el de este proyecto—, el chat entrega al asistente la memoria de los ámbitos `shared`, `ecosystem` (el grupo del proyecto, si lo tiene) y `project`, en ese orden y dentro del mismo bloque de datos, nunca como instrucción. Si Engram es anterior a 1.6.0 no hay ámbito de grupo y todo sigue igual.

Cuando Engram avisa algo, el chat lo muestra una sola vez con texto propio (es/en): que actualizó su base de datos para poder usar grupos (con la ruta de la copia de seguridad), o que volvió a vincular la carpeta con el proyecto que declara su archivo `.forge614/project.json`. Si ese archivo es inválido, Engram no entrega ninguna memoria y Shell lo dice de forma visible; el chat sigue funcionando sin memoria hasta que se corrija o se borre el archivo.

La pantalla de recepción sin proyecto (lista de proyectos recientes, con el grupo de cada uno) **todavía no existe**: el acta 0003 la declara pendiente y no forma parte de esta entrega.

## Sesiones y permisos

Codex lista y retoma hilos del directorio actual; rechaza un hilo de otro proyecto o activo en otro cliente. Cada asistente conserva sus modos de trabajo nativos, con los nombres y el comportamiento que él les da, leídos del propio asistente y nunca de una lista escrita en Shell: Claude Code muestra los modos de permisos de su SDK (Manual, Accept edits, Plan, Don't Ask, Auto, Bypass Permissions); Codex muestra sus propios preajustes (Read Only, Default, Full Access), acotados por las restricciones que informa (`configRequirements/read`) y enviados como la política de aprobación y el sandbox que define su protocolo. Si un asistente rechaza un modo, Shell lo dice en palabras normales y vuelve al anterior. Claude mantiene su propio historial nativo. Antes de una acción que requiera confirmación, Shell muestra la pregunta en la interfaz.

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

`Ready` usa verde; `Working` usa ámbar y reemplaza el punto estático por un spinner; `Awaiting permission` usa rojo. Mientras hay un turno activo, Claude Code y Codex actualizan el estado cada medio segundo y muestran el tiempo transcurrido, por ejemplo `Working · 12s`. Si hay una herramienta o un comando en curso, el estado dice también qué hace, por ejemplo `Working · Esperando los checks del PR #3 · 8m 23s` (la descripción de la herramienta en Claude Code; el comando, en una sola línea, en Codex); si no hay ninguno, solo el tiempo. Todo contador de tiempo de Shell (este indicador, cada herramienta y la barra lateral) usa el mismo formato: `45s`, `1m 27s`, `8m 23s`, `1h 02m`. Un comando largo ocupa un solo renglón en el chat que se actualiza en su lugar y queda fijo con su resultado al terminar. Al terminar o cancelarse el turno, el contador se detiene.

Los menús de `/model` y `/effort` son elecciones explícitas: numeran las opciones, alinean la columna principal y marcan con `✓` el valor activo aunque el cursor esté sobre otra opción. Esto evita confundir la opción enfocada con la configuración que se usará realmente.

Para Claude Code, el sidebar intenta mostrar el nombre amigable que ofrece el catálogo —por ejemplo, `Opus (1M context)`— en vez de un identificador técnico. Si la elección o la telemetría no tienen una coincidencia exacta en el catálogo, aplica una conversión legible del identificador sin inventar un nombre de producto.

Shell recuerda por separado el modelo y el nivel de razonamiento elegidos para `claude` y `codex` en `~/.forge614/shell/preferences.json` (o bajo `FORGE614_HOME` si se definió). También recuerda el último asistente usado (el selector de arranque lo marca como «último usado» y lo deja resaltado, así que Enter lo acepta) y, por asistente, el último modo de trabajo, sea cual sea (también el de acceso total), que restaura al abrir sin preguntar; un modo guardado que el asistente ya no tiene deja su modo por defecto, sin error. Es una preferencia propia de Shell, no modifica la configuración nativa de los CLIs. Leer o escribir ese archivo es una comodidad de mejor esfuerzo: un archivo ausente o inválido, una escritura fallida o un modelo ya no ofrecido dejan que la sesión continúe con los valores disponibles.

En el sidebar, la ausencia de razonamiento explícito se llama `Default (auto)`. En el selector de razonamiento de Claude Code aparece `Default (recommended)` y explica `Claude Code decides — shown in the sidebar after you send a message`: Claude no comunica de antemano el nivel concreto que resolverá, por lo que Shell lo declara en vez de adivinarlo.

## Métricas del sidebar

Como agrupar los instrumentos de consumo junto al medidor de combustible, el sidebar coloca los datos de uso donde se interpretan juntos y deja la RAM como recurso del proceso.

Los tokens del último mensaje y el importe estimado quedan debajo de `PLAN USAGE`, antes de `RESOURCES`; ya no se mezclan con la RAM de Shell o del motor. Se escriben en palabras normales y en renglones cortos, sin cortes: `Este mensaje` / `leyó 2 996 tokens` / `escribió 700`, y luego `Si pagaras por uso` / `≈ $0,67` / `tu plan no lo cobra`. El importe es una referencia estimada, no un cargo de Shell ni de tu plan; si es menos de un centavo dice `menos de $0,01` en vez de cero.

Mientras el contexto no tiene cifra, la sección `CONTEXTO` dice cuándo aparecerá, con un texto corto que cabe en el ancho del panel: `tras el 1.er mensaje` en una conversación nueva, `tras el próximo mensaje` en una reanudada que aún no se ha medido.

El panel también toma para sí presionar, arrastrar y soltar el botón izquierdo, igual que el compositor, así que seleccionar texto del chat con el ratón ya no resalta el panel. Que la selección se quede quieta al desplazar la pantalla todavía no está resuelto.

Los conteos compactos usan `1M`, no `1000k`, y conservan una decimal solo cuando aporta información: `1.5k`, `43k`, `1M` y `1.5M`. El anillo de contexto y las porciones llenas de las barras de uso comparten una escala de alerta: color normal por debajo de 85 %, ámbar desde 85 % y rojo desde 100 %. Así el color expresa cercanía al límite, no solo una preferencia estética.

## Actividad en segundo plano

Cuando el motor activo reporta trabajo en segundo plano (subagentes de Claude Code, procesos backgroundeados), el panel lateral muestra un solo renglón por actividad, con su título, su estado (corriendo, hecho, fallido) y el tiempo transcurrido (si el título es largo, se recorta él, no el estado ni el tiempo); un clic la expande para ver el resultado si el motor lo entregó. La barra de estado añade un contador con el punto animado mientras haya actividad corriendo (es lo que queda ahí además de carpeta, rama y estado de Git). Si el motor no reporta esto de forma distinguible, el panel lo dice explícitamente en vez de mostrar una lista vacía silenciosa — ver `docs/superpowers/specs/2026-09-22-background-activity-indicator-design.md`.
