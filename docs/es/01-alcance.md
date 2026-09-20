# 01 — Propósito, límites y ecosistema

Imagina una recepción de taller: Shell recibe a la persona, muestra opciones y mantiene visible el trabajo; no fabrica las herramientas ni guarda todos los archivos del taller.

Forge614-Shell es el espacio de terminal con chat para programación asistida por IA del ecosistema Forge614. Se ejecuta en el directorio de trabajo actual y conserva la responsabilidad visible: selección, confirmaciones, progreso y conversación.

## Responsabilidades actuales

- Inicia una interfaz de chat para Claude Code o Codex, dos clientes de IA instalados localmente.
- Pide a Forge614 Engines (dependencia interna que detecta asistentes y prepara cambios) la lista de asistentes disponibles.
- Puede inicializar Forge614 Engram (motor independiente de memoria persistente) mediante su CLI público y, después, ofrecer su conexión MCP (protocolo para que un cliente de IA use una herramienta local).
- Mantiene las sesiones y permisos que cada cliente nativo proporciona; no inventa modelos, cuotas ni permisos.

## Límites

- Shell no es un sandbox (entorno que impide por sí mismo cambios peligrosos); los permisos dependen del cliente seleccionado.
- Shell no es un gestor de proyectos, pestañas o worktrees (copias de trabajo Git separadas). Cada instancia trabaja desde su propio directorio.
- Shell no almacena credenciales de suscripción ni revoca cuentas externas. `/logout` solo desconecta la sesión de Shell.
- Gemini y Antigravity no tienen soporte. Pi solo se conserva para automatización no interactiva heredada.
- Cursor puede recibir la configuración MCP de Engram, pero no puede abrirse como chat de Shell.

## Relación con el ecosistema

`forge614-ai` será el futuro orquestador global. Shell es la única experiencia visual; Engines detecta y planifica, Engram conserva memoria y Atlas contextualiza repositorios. Los productos se comunican por CLIs o SDKs (interfaces documentadas para otros programas) públicos, nunca por importaciones de carpetas privadas.

## Decisiones de mantenimiento

La fuente de verdad es el código, sus pruebas y los contratos públicos actuales. Las decisiones y entregas anteriores se preservan como historia en el documento 03, pero no describen capacidades actuales si el código las retiró.
