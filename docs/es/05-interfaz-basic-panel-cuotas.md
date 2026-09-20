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

## Sesiones y permisos

Codex lista y retoma hilos del directorio actual; rechaza un hilo de otro proyecto o activo en otro cliente. Los modos de trabajo de Codex proceden de sus requisitos de configuración y pueden combinar política de aprobación con sandbox. Claude mantiene su propio historial nativo. Antes de una acción que requiera confirmación, Shell muestra la pregunta en la interfaz.
