# 01 — Alcance y decisiones de Forge614-Shell

Fecha: 2026-09-17 · Etapa 01: definición del producto · Revisión documental: 1

Este documento registra lo acordado con el usuario. Describe el producto deseado, no funcionalidades ya implementadas. Su equivalente es [Scope and agreed decisions](../en/01-scope.md).

## Propósito

Forge614-Shell será un entorno propio de terminal con chat para programación asistida por IA. El usuario abrirá `forge614-shell` para conversar y trabajar en sus proyectos. Pi será el motor base de conversación con modelos y herramientas; el mecanismo concreto de integración todavía está pendiente.

La experiencia reunirá chat, herramientas, selección de proveedor y modelo, nivel de razonamiento cuando el modelo lo soporte, sesiones y estado visible del trabajo.

## Decisiones acordadas

| ID | Decisión |
| --- | --- |
| D-001 | Forge614-Shell será un proyecto independiente, utilizable sin Forge614-AI ni Forge614-Engram. |
| D-002 | Pi será el motor base. Shell tendrá identidad e interfaz propias. No se construirá un modelo de IA propio. |
| D-003 | El comando previsto para abrir la experiencia será `forge614-shell`. |
| D-004 | Shell podrá abrir proyectos de cualquier tecnología y estructura, sin exigir convenciones de Forge614. |
| D-005 | Un proyecto podrá tener varios trabajos abiertos simultáneamente. Cada trabajo tendrá su chat y podrá tener su rama y worktree propios. |
| D-006 | Cambiar de trabajo en la interfaz no deberá detener los demás trabajos activos. |
| D-007 | Las conversaciones podrán conservarse y retomarse sin Engram. Historial de chat y memoria de conocimiento son capacidades distintas. |
| D-008 | Sin Git, Shell seguirá ofreciendo chat y trabajo sobre archivos; las operaciones de ramas y worktrees no estarán disponibles. |
| D-009 | Forge614-Engram será opcional para Shell independiente. Su integración se abordará al final, cuando el proyecto Engram esté listo. |
| D-010 | El desarrollo será incremental, con documentación ES/EN en el repositorio y publicación coordinada en Notion mediante la otra IA del usuario. |
| D-011 | TypeScript y Bun son la preferencia tecnológica acordada. Su uso concreto y la compatibilidad con Pi deben validarse antes de fijar dependencias o empaquetado. |
| D-012 | Toda documentación estará numerada e indexada. Cada par ES/EN compartirá número; el README será el índice general. |

## Experiencia de trabajo esperada

- Navegación lateral de proyectos y sus trabajos.
- Chat propio por trabajo, con posibilidad de retomar la sesión.
- Varios trabajos activos sobre un mismo proyecto, cada uno con su copia de trabajo cuando se use un worktree.
- Estado, rama y cambios correspondientes al trabajo seleccionado.
- Selección de proveedor, modelo y razonamiento según las capacidades disponibles.
- Herramientas, resultados, errores y preguntas interactivas visibles dentro del flujo del chat.
- Información de contexto, uso y costo cuando el motor o proveedor la exponga.
- Visibilidad de workers cuando esa capacidad se incorpore y esté disponible; no se define todavía su implementación ni política de orquestación.

Una tarea de usuario no es necesariamente un subagente. Tampoco se fija todavía una relación obligatoria de una sola sesión por worktree.

## Referencias y límites

Las ocho capturas `IMG_0276.jpg` y `IMG_0277.PNG` a `IMG_0283.PNG` se revisaron como referencia de Gentle Shell: chat principal, entrada inferior, panel de estado, agentes, tareas y controles interactivos. La captura posterior de Orca muestra la referencia de navegación por proyectos y trabajos en distintas ramas. Las imágenes no se han incorporado al repositorio.

Se tomarán sus comportamientos útiles sin copiar literalmente la identidad visual. Las capturas no demuestran por sí mismas garantías de aislamiento, persistencia o funcionamiento interno.

La investigación técnica previa incluyó estas revisiones de código:

- [Gentle Shell — ce47bae](https://github.com/Gentleman-Programming/gentle-shell/tree/ce47bae0168d4a60b43cc45d660d83901c8868dd): referencia de experiencia e integración sobre Pi.
- [Gentle-AI — 712ebdc](https://github.com/Gentleman-Programming/gentle-ai/tree/712ebdc78ebe57005c8f9364e21ed4b2d392ca5b): referencia de instalación y límites entre componentes.
- [Pi — e4c75a7](https://github.com/earendil-works/pi/tree/e4c75a73222ae2c72abb5f5314fa35ee8effc508): referencia del motor, sesiones, extensiones, SDK y RPC. El enlace histórico `badlogic/pi-mono` redirigía a este proyecto durante la investigación.

Estas revisiones documentan lo investigado; no fijan versiones de nuestras futuras dependencias ni implican adoptar toda su arquitectura.

## Separación respecto del ecosistema

Shell debe conservar su funcionamiento independiente. En el futuro, Forge614-AI podrá aportar orquestación de ingeniería y Shell mostrar su estado, contexto, workers, revisiones y acciones.

La instalación completa de Forge614-AI deberá preparar Shell, Pi y Engram, según lo acordado en el contexto del ecosistema. Este repositorio no diseña ni implementa ese instalador en esta etapa.

Para Shell independiente, el acuerdo futuro es permitir elegir memoria persistente durante la configuración: si se elige, preparar Engram; si no, funcionar sin él. No se implementará ni diseñará ahora ese conector. Los puntos pendientes son disponibilidad de memoria, estado de conexión y operaciones expuestas, sujetos al contrato real de Engram.

## Decisiones abiertas

- Extensiones de Pi, uso del SDK o procesos mediante RPC; no hay arquitectura final elegida.
- Gestión de trabajos simultáneos y comportamiento al cerrar, reiniciar o recuperar una sesión.
- Creación, reutilización y eliminación de worktrees; relación entre proyecto, trabajo, rama y sesiones.
- Alcance del visor de cambios: estado completo de Git, cambios atribuidos a una sesión o ambos.
- Límites de acceso y coordinación de escrituras: un worktree separa copias de trabajo, pero no constituye por sí solo un sandbox.
- Instalación y actualización automática de Pi, compatibilidad de versiones, plataformas y distribución de Shell.
- Presentación de credenciales, capacidades de modelos, consumo y errores sin inventar datos no disponibles.
- Ubicación y estructura de las páginas de Notion, pendientes de coordinar con la otra IA.

## Forma de avanzar

Cada etapa tendrá un alcance acordado, un resultado revisable, verificación proporcional y documentación equivalente en ES/EN. Se registrarán sus decisiones, limitaciones y asuntos pendientes antes de pasar a la siguiente etapa.

La actualización de Notion se realizará mediante un traspaso explícito. Preparar el contenido no equivale a publicarlo: la sincronización solo se marcará como confirmada al recibir los enlaces y la confirmación de la otra IA.

### Convención de documentación

- El [README](../../README.md) es el punto de entrada y el índice general.
- Los documentos viven en `docs/es/` y `docs/en/`, con nombres `NN-tema.md` en minúsculas y palabras separadas por guiones.
- Cada tema recibe un número estable, compartido por sus versiones ES/EN: `01-alcance.md` y `01-scope.md`.
- Los documentos nuevos se añaden al índice en ambos idiomas y reciben el siguiente número disponible. No se renumeran documentos existentes para insertar otro tema.
- La numeración documental no representa una etapa de implementación: una etapa puede producir varios documentos.
- Notion conserva el mismo número y un título traducido para cada página, además del índice con enlaces a ambas versiones.
- Todo cambio documental actualiza su equivalente, los enlaces afectados y el estado de sincronización con Notion. Un cambio aún no publicado queda marcado como pendiente.

## Resultado de la etapa 01

- Alcance y decisiones documentados en ES/EN dentro del repositorio.
- Traspaso a Notion preparado en [02-traspaso-notion.md](02-traspaso-notion.md).
- Publicación en Notion: pendiente de confirmación.
- Revisión del usuario: pendiente.
- Sin implementación, dependencias, arquitectura definitiva ni plan de desarrollo aprobado.
