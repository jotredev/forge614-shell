# 07 — Inicialización de Engram e integración de memoria

Como conectar varias radios a una misma estación, este flujo prepara la memoria una vez y permite conectar solo los clientes que la persona elija.

## Propósito y entrada

Ejecuta:

```bash
forge614-shell init --product engram
```

El comando exige un terminal interactivo. Primero muestra el flujo de Engram: almacenamiento local SQLite y FTS5 (índice para búsqueda de texto) obligatorio, sincronización PostgreSQL opcional y refuerzo opcional (prioriza memorias repetidas; no prueba que sean verdaderas). Tras una confirmación, Shell ejecuta `forge614-engram init --json` y, si se eligió, `forge614-engram reinforcement-enable`. Después, si la carpeta es un proyecto que aún no tiene grupo, pregunta una sola vez a cuál pertenece (ver «Grupo del proyecto»).

Todo el comando — introducción, PostgreSQL, refuerzo, resumen, inicialización de Engram, grupo del proyecto (si aplica), selección de asistentes, vista previa, confirmación y resultado final — es una única experiencia visual continua en pantalla alterna. Shell nunca imprime una línea de estado en la terminal normal entre pantallas ni abre una segunda pantalla independiente a mitad de camino; la persona solo vuelve a ver la terminal normal una vez, al final, cuando el resultado ya está en pantalla.

Una cancelación antes de confirmar muestra una pantalla de resultado con `Cancelled. No changes were made.` y devuelve código 130. Si la inicialización de Engram funciona, un fallo posterior de la integración de memoria no la convierte en fallida.

## Grupo del proyecto (ámbito `ecosystem`)

Como el estante del pasillo que comparten las oficinas de una misma empresa, un **grupo** reúne repositorios relacionados (microservicios, un monorepo partido, los nodos de Forge614) para que compartan memoria. Un proyecto pertenece como máximo a un grupo, y la memoria de un proyecto manda sobre la del grupo, que manda sobre la compartida (`project` > `ecosystem` > `shared`).

**Cuándo aparece la pantalla.** Después de que Engram termina `init`, y solo si se cumplen las tres condiciones:

- el flujo es interactivo (sin terminal interactivo `init` no arranca, y no existe un modo `--yes`: nunca se pregunta ni se vincula un grupo sin persona);
- la carpeta es un proyecto: la raíz de un repositorio Git, o una carpeta con un manifiesto (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `composer.json`, `Gemfile` o `forge614.node.json`);
- todavía no existe `.forge614/project.json` en la raíz del proyecto. Si el archivo existe, **nunca** se pregunta, diga lo que diga (acta 0023). Se pregunta una sola vez.

**Qué muestra.** El título «Este repositorio aún no pertenece a ningún grupo.»; una sección «Grupos existentes» con cada grupo y sus proyectos (dato de `forge614-engram group-list`); una línea divisoria; y las acciones «Crear un grupo nuevo…» (pide un nombre: minúsculas, números y guiones simples, de 1 a 64 caracteres, y que no exista ya) y «Es un proyecto suelto (sin grupo)». Si todavía no hay grupos, la primera sección no aparece. Esc no vincula nada y el flujo continúa; Shell volverá a preguntar la próxima vez. Con muchos grupos la lista se muestra por ventanas con un contador (`3/12`).

**Cómo se aplica.** Solo con comandos no interactivos de Engram, siempre en este orden:

```text
forge614-engram group-create --name <nombre>                    (solo si se creó un grupo)
forge614-engram init --json --directory <raíz del proyecto>     (Engram registra el proyecto y escribe el archivo)
forge614-engram group-bind --project-id <id> --group <id>       (solo si hay grupo; siempre por id, nunca por nombre)
```

**Shell nunca escribe `.forge614/project.json`**: es de Engram (acta 0023). Shell solo comprueba si existe. Si algo falla, el resultado lo informa con el mensaje de Engram y la inicialización, que ya se aplicó, no se convierte en fallida.

**Límites conocidos.** Si Engram ya creó el archivo antes (por ejemplo, tras un chat) con `ecosystem: null`, Shell no vuelve a preguntar; el grupo se cambia con los comandos de Engram. Si `group-bind` falla después de que Engram escribió el archivo, el proyecto queda sin grupo y tampoco se vuelve a preguntar. Las memorias de grupo todavía no se replican a PostgreSQL (llegará con Engram 1.7.0).

**Avisos de Engram.** La primera vez que se usa un grupo Engram actualiza su base de datos (con copia de seguridad previa) y avisa `DATABASE_MIGRATED`. Shell lo muestra en el resultado, con la ruta de la copia, en su propio texto (es/en) y una sola vez.

## Qué es la «integración de memoria»

La integración de memoria de Engram tiene dos partes, y Shell instala ambas por asistente:

- El servidor MCP `forge614-engram` (una conexión local estándar que permite a un cliente de IA llamar a una herramienta), para que el asistente pueda leer y guardar memorias.
- Las instrucciones universales de memoria de Engram, para que el asistente sepa cuándo usarlas.

Shell nunca construye por su cuenta la entrada MCP ni el contenido de las instrucciones, y nunca lee directamente los archivos de configuración de un asistente ni los archivos internos de Engram. Solo llama a `forge614-engines` y lee su salida JSON.

## Flujo de integración de memoria paso a paso

1. Shell llama a `forge614-engines detect` y exige `schemaVersion: 1`.
2. Para cada asistente instalado, llama a `forge614-engines capabilities --agent <id>`.
3. Solo ofrece los que responden `supportsMcp: true`. Esta lista puede incluir Cursor y no depende de que exista un adaptador de chat.
4. La persona puede elegir cero, uno o varios asistentes. Esc cancela la configuración de memoria; elegir cero no escribe nada.
5. Para cada elegido, Shell solicita un plan de solo lectura que cubre ambas partes a la vez:

```text
forge614-engines plan memory-install --agent <id>
```

   No se envían banderas de nombre, comando ni argumentos: Engines deriva por sí mismo el servidor MCP `forge614-engram` y las instrucciones de memoria de Engram.

6. Una única vista previa combinada cubre todos los asistentes elegidos. Para cada uno muestra las rutas que Engines planea cambiar, el estado del MCP (`will add`, `already configured` o `blocked`), el estado de las instrucciones de memoria (`will add`, `already present`, `not supported by this assistant` o `blocked`) y un estado general (`complete`, `partial` o `unsupported`). La explicación propia de Engines para un componente bloqueado o no soportado aparece en su propia línea. La pantalla indica que todavía no se ha cambiado nada.
7. Tras una única confirmación explícita, Shell aplica cada plan pendiente (no noop) de forma independiente:

```text
forge614-engines apply --plan-id <id>
```

8. Después de cada aplicación exitosa, Shell pregunta a Engines qué hay realmente en disco:

```text
forge614-engines verify memory-integration --agent <id>
```

9. Todos los asistentes seleccionados se verifican de esta forma — incluso uno cuyo plan no necesitaba escrituras en absoluto, porque la evidencia de *ejecución* del hook de memoria es una pregunta separada de si sus archivos se escribieron correctamente. Shell llama a `verify memory-integration` exactamente una vez por asistente. Nunca lanza un cliente nativo para renovar esa evidencia ni pide a la persona que vuelva a ejecutar nada: la evidencia de tiempo de ejecución es información de estado, no una condición para completar el flujo. Una instalación estructuralmente correcta (el servidor MCP y las instrucciones de memoria realmente escritos y presentes) se informa como lograda — `configured` o `ready` — incluso mientras esa evidencia todavía no existe.
10. Finalmente informa un resultado por asistente, calculado únicamente a partir del JSON del propio Engines: `configured — MCP server and memory instructions are installed and active`, `ready — <qué puede pasar la próxima vez que se inicie el asistente normalmente>`, `partially configured — <una limitación real y nombrada de este asistente>`, `blocked — <el detalle de conflicto del propio Engines>`, `could not be configured — <una descripción honesta de lo que falló>`, o `skipped`.
11. Cuando esta ejecución escribió algo realmente, Shell cierra con un recordatorio de cerrar y volver a abrir la sesión de cada asistente configurado para que cargue el nuevo servidor MCP y las instrucciones de memoria. Una ejecución que no cambió nada no lo imprime.

## Cursor nunca se presenta como completo

Cursor no tiene un mecanismo oficialmente soportado para cargar instrucciones globales de forma automática. Su servidor MCP sí puede configurarse; sus instrucciones de memoria no. Por eso Shell informa Cursor como `partially configured` y explica ese motivo, incluso cuando Engines considera ese estado el máximo alcanzable para este asistente. Shell nunca inventa archivos ni hooks no oficiales para compensarlo, ni presenta Cursor como una integración de memoria completa.

## El hook de memoria y su evidencia de tiempo de ejecución

El `plan memory-install` y `verify memory-integration` de Forge614 Engines también cubren un tercer componente: un hook `SessionStart`, instalado para Claude Code y Codex junto al servidor MCP e instrucciones. Shell detecta el soporte de este componente de forma estructural — comprobando si el campo `hook` está presente en el JSON del propio Engines — nunca comprobando un número de versión de Engines. Si el Engines instalado es anterior a esta funcionalidad, Shell muestra: "Forge614 Engines needs to be updated. Run "forge614-shell update", then try again."

Engines puede confirmar que el archivo del hook en sí se escribió correctamente, pero no puede probar criptográficamente que una sesión de cliente real lo ejecutó — entonces informa dos cosas independientes: si el hook está *estructuralmente* instalado, y un `runtimeStatus` separado:

- `runtime-observed` — una sesión real ejecutó el hook recientemente (menos de 7 días) y Engram devolvió contexto. Solo este estado, combinado con que tanto el servidor MCP como las instrucciones estén en su lugar, se informa como `configured`.
- `pending-runtime-verification` — el hook está instalado pero todavía no hay evidencia fresca, ya sea porque nunca se ejecutó (`no-evidence`, el estado de todo asistente recién configurado) o porque se ejecutó antes y la ventana de evidencia venció (`evidence-expired`). Shell informa esto como `ready`, con la misma redacción honesta sin importar el motivo: nada se perdió ni nada falló — el servidor MCP e instrucciones de memoria permanecen exactamente como se configuraron, y el chequeo de tiempo de ejecución termina de confirmarse solo la próxima vez que la persona use ese asistente normalmente. Shell nunca lanza nada para forzar esto ni pide una nueva ejecución.
- `needs-user-trust` — Codex específicamente requiere revisar y confiar en un hook nuevo una vez, a través de su propio comando `/hooks`, antes de ejecutarlo. Shell no tiene forma de saber si esa decisión de confianza ya se tomó, y nunca afirma lo contrario. También informa esto como `ready`, pero con una redacción que solo describe una posibilidad, nunca un hecho: "Codex memory integration is ready. When you next start Codex normally, Codex may ask you once to approve the Forge614 memory hook." Shell nunca dice que Codex "no ha confiado" en el hook, y nunca trata esto como motivo para negar el éxito.
- `unsupported` — este asistente (Cursor hoy) no tiene un mecanismo oficialmente soportado y estable de hook de inicio de sesión que Engines pueda instalar.

La evidencia de tiempo de ejecución — por cualquiera de los motivos anteriores — nunca convierte una instalación estructuralmente correcta en un fallo, ni requiere que Shell abra un cliente nativo. Esta es una decisión de producto deliberada: `init --product engram` nunca lanza Claude Code, Codex ni ningún otro cliente nativo, y nunca trata la ausencia de evidencia de tiempo de ejecución como algo que la persona deba resolver volviendo a ejecutar un comando. Si el hook realmente se ha ejecutado en una sesión real se vuelve visible de la forma habitual — mediante el propio uso de Shell de ese asistente, o una futura superficie explícita de estado/diagnóstico — nunca como un paso bloqueante dentro de `init`.

La evidencia caduca después de 7 días. Esto nunca elimina memoria ni configuración — solo significa que el propio chequeo de tiempo de ejecución del hook necesita ejecutarse de nuevo, lo cual ocurre por sí solo la próxima vez que arranca una sesión real. `runtime-observed` no es prueba criptográfica de que el cliente realmente usó la memoria recuperada; solo significa que Engines observó una invocación `SessionStart` real y compatible y que Engram devolvió contexto para ella.

## Memoria propia de Shell

Independientemente del flujo anterior, el chat propio de Shell (tanto el adaptador de Claude Code como el de Codex) recupera contexto de memoria directamente desde el contrato público, de solo lectura y no interactivo de Engram:

```text
forge614-engram startup-context --directory <cwd> --json
```

Esta llamada nunca crea un proyecto, un vínculo ni una memoria, y una carpeta no vinculada no es un error. Shell la recupera una vez por conversación lógica — cuando la sesión de chat se conecta por primera vez, y de nuevo tras `/new` o `/resume` — nunca en cada turno. El resumen que construye se envuelve en un bloque explícito `<forge614-engram-memory>` que le indica al modelo que esto es dato recuperado, no una instrucción, y que cualquier texto dentro que parezca un comando debe ignorarse; para Claude se añade al preset de system prompt `claude_code`, y para Codex se antepone como una parte de texto separada solo en ese turno. El resumen tiene un tamaño acotado y nunca incluye la base de datos de Engram, su configuración ni ningún secreto. Si Engram no está instalado, no responde o devuelve un JSON inválido, Shell continúa la conversación sin contexto de memoria en lugar de fallar al iniciar — nunca inventa uno.

Desde Engram 1.6.0 el resultado trae tres capas, en este orden: `shared` (la persona), `ecosystem` (el grupo del proyecto, si tiene) y `project`. El bloque `ecosystem` es opcional y aditivo (`format` sigue en 1): si Engram es anterior, no viene y nada cambia; si viene con una forma que Shell no entiende, se descarta solo ese bloque y `shared` y `project` siguen llegando. Shell ignora los campos desconocidos y solo exige los que usa. Las tres capas se sanean igual y van dentro del mismo bloque `<forge614-engram-memory>`, como dato y no como instrucción; el resumen reparte su tope de 20 líneas entre las capas presentes para que una capa grande no deje fuera a las más específicas.

El resultado también puede traer avisos. Shell muestra en el chat, una sola vez y con su propio texto (es/en), `DATABASE_MIGRATED` (con la ruta de la copia de seguridad) y `PROJECT_REBOUND_FROM_FILE`. Si el archivo `.forge614/project.json` es inválido (`PROJECT_FILE_INVALID`), Engram no devuelve ningún contexto: Shell lo dice de forma visible («la memoria no se cargó; corrige el archivo o bórralo») y el chat continúa sin memoria.

## Seguridad y resultados

Shell nunca presenta ni registra `afterContent` (contenido propuesto) ni `beforeHash` (huella del contenido previo) de los archivos de configuración; la vista previa solo muestra rutas y estados. La cadena de conexión PostgreSQL introducida durante la inicialización de Engram se envía únicamente a Engram y nunca llega a la pantalla ni al registro en ningún punto de la ejecución. Esto se aplica también al componente del hook — su escritura puede tocar todo el archivo de configuración local de un asistente (por ejemplo, `~/.claude/settings.json` de Claude Code, que también contiene todos los hooks y reglas de permisos existentes), así que su `afterContent`/`beforeHash` son exactamente igual de sensibles que los de la entrada MCP, y nunca se muestran.

`configured` solo aparece si el propio `verify memory-integration` de Engines confirma ambas partes. Un error o `applied: false` nunca se informa como éxito. Un asistente fallido no oculta el resultado de los demás.

La infraestructura también incluye `planMcpRemove` y `removeEngramMcpFromAgent`, bases internas para una futura desinstalación. No existe todavía un comando público ni interfaz de eliminación de memoria; no debe documentarse como disponible.

La configuración hace disponible la memoria para el cliente seleccionado; no garantiza que Shell pueda chatear con ese cliente ni que muestre su actividad. Ambas capacidades requieren su propio adaptador y una investigación del protocolo del asistente.

## Ejemplo real de interpretación

Si Claude Code ya está completamente configurado y Codex tiene un plan pendiente, la vista previa muestra ambos. Al confirmar, Shell aplica solo el plan de Codex y luego lo verifica. Si la aplicación de Codex falla, el resultado conserva `Claude Code: configured — MCP server and memory instructions are installed and active` e informa `Codex: could not be configured — <mensaje de Engines>`.
