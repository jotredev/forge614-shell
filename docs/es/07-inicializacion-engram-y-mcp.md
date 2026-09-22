# 07 — Inicialización de Engram e integración de memoria

Como conectar varias radios a una misma estación, este flujo prepara la memoria una vez y permite conectar solo los clientes que la persona elija.

## Propósito y entrada

Ejecuta:

```bash
forge614-shell init --product engram
```

El comando exige un terminal interactivo. Primero muestra el flujo de Engram: almacenamiento local SQLite y FTS5 (índice para búsqueda de texto) obligatorio, sincronización PostgreSQL opcional y refuerzo opcional (prioriza memorias repetidas; no prueba que sean verdaderas). Tras una confirmación, Shell ejecuta `forge614-engram init --json` y, si se eligió, `forge614-engram reinforcement-enable`.

Una cancelación antes de confirmar imprime `Cancelled. No changes were made.` y devuelve código 130. Si la inicialización de Engram funciona, un fallo posterior de la integración de memoria no la convierte en fallida.

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

9. Todos los asistentes seleccionados se verifican de esta forma — incluso uno cuyo plan no necesitaba escrituras en absoluto, porque la evidencia de *ejecución* del hook de memoria es una pregunta separada de si sus archivos se escribieron correctamente. Cuando esa verificación muestra que el hook está instalado pero no ha sido observado en tiempo de ejecución aún (ya sea porque nunca se ejecutó, o se ejecutó una vez y la evidencia expiró), Shell le entrega la terminal una vez a ese asistente (nunca al chat en la aplicación de Shell), lo deja iniciarse de verdad, y verifica de nuevo una vez que sale. Para Codex específicamente, también es así como su propio mensaje de confianza del hook nativo obtiene la oportunidad de aparecer — Shell nunca lo aprueba, lo salta, ni lo elude.
10. Finalmente informa un resultado verificado por asistente: `configured — MCP and memory instructions available`, `configured; pending verification — <por qué>`, `partially configured — <lo que falta>`, `not supported — <motivo>`, `skipped` o `not configured — <mensaje de error o conflicto del propio Engines>`.
11. Cuando esta ejecución escribió algo realmente, Shell cierra con un recordatorio de cerrar y volver a abrir la sesión de cada asistente configurado para que cargue el nuevo servidor MCP y las instrucciones de memoria. Una ejecución que no cambió nada no lo imprime.

## Cursor nunca se presenta como completo

Cursor no tiene un mecanismo oficialmente soportado para cargar instrucciones globales de forma automática. Su servidor MCP sí puede configurarse; sus instrucciones de memoria no. Por eso Shell informa Cursor como `partially configured` y explica ese motivo, incluso cuando Engines considera ese estado el máximo alcanzable para este asistente. Shell nunca inventa archivos ni hooks no oficiales para compensarlo, ni presenta Cursor como una integración de memoria completa. Su componente de hook también se informa como `not supported`, por la misma razón.

## El hook de memoria y su evidencia de tiempo de ejecución

El `plan memory-install` y `verify memory-integration` de Forge614 Engines también cubren un tercer componente: un hook `SessionStart`, instalado para Claude Code y Codex junto al servidor MCP e instrucciones. Shell detecta el soporte de este componente de forma estructural — comprobando si el campo `hook` está presente en el JSON del propio Engines — nunca comprobando un número de versión de Engines. Si el Engines instalado es anterior a esta funcionalidad, Shell muestra: "Forge614 Engines needs to be updated. Run `forge614-shell update`, then try again."

Engines puede confirmar que el archivo del hook en sí se escribió correctamente, pero no puede probar criptográficamente que una sesión de cliente real lo ejecutó — entonces informa dos cosas independientes: si el hook está *estructuralmente* instalado, y un `runtimeStatus` separado:

- `runtime-observed` — una sesión real ejecutó el hook recientemente (menos de 7 días) y Engram devolvió contexto. Solo este estado, combinado con que tanto el servidor MCP como las instrucciones estén en su lugar, se informa como `configured`.
- `pending-runtime-verification` — el hook está instalado pero no hay evidencia fresca. Su propio `reason` distingue un hook que *nunca* se ejecutó (`no-evidence`, el estado de todo asistente recién configurado, incluida la primera `plan memory-install` de una instalación completamente nueva) de uno que *sí* se ejecutó antes pero cuya ventana de evidencia venció (`evidence-expired`). De cualquier forma, la redacción de Shell es la misma e igualmente honesta: nada se perdió ni nada falló — el servidor MCP e instrucciones de memoria permanecen exactamente como se configuraron, solo el chequeo de tiempo de ejecución en sí necesita ejecutarse nuevamente. Shell le entrega la terminal al asistente una vez para renovarlo, luego verifica de nuevo.
- `needs-user-trust` — Codex específicamente requiere revisar y confiar en un hook nuevo una vez, a través de su propio comando `/hooks`, antes de ejecutarlo. Esta es genuinamente una situación diferente de la evidencia expirada — una decisión de confianza sin resolver, no un temporizador vencido — y Shell nunca redacta ni informa los dos de la misma forma. Shell no tiene forma de otorgar o saltar esa confianza, y nunca lo intenta.
- `unsupported` — este asistente (Cursor hoy) no tiene un mecanismo oficialmente soportado y estable de hook de inicio de sesión que Engines pueda instalar.

Cuando un hook de un asistente seleccionado es `pending-runtime-verification` (por cualquier motivo) o `needs-user-trust`, Shell le entrega la terminal a ese asistente su propio ejecutable real — el ejecutable `claude` o `codex` real, no la interfaz de chat de Shell — espera a que salga, y verifica de nuevo. Esto es deliberado: los propios adaptadores de chat de Shell hablan con Codex sobre un protocolo máquina-a-máquina que no puede mostrar el mensaje de confianza nativo de Codex, y no hay necesidad de probar que la sesión impulsada por SDK de Claude se comporta idénticamente al CLI real cuando el CLI real está a un spawn de proceso de distancia. Nada sobre esta entrega requiere una segunda confirmación — la persona ya confirmó el cambio de integración de memoria una vez, antes de que se aplicara algo.

La evidencia caduca después de 7 días. Esto nunca elimina memoria ni configuración — solo significa que Shell informará `configured; pending verification` nuevamente hasta que una nueva sesión real ejecute el hook. `runtime-observed` no es prueba criptográfica de que el cliente realmente usó la memoria recuperada; solo significa que Engines observó una invocación `SessionStart` real y compatible y que Engram devolvió contexto para ella.

## Seguridad y resultados

Shell nunca presenta ni registra `afterContent` (contenido propuesto) ni `beforeHash` (huella del contenido previo) de los archivos de configuración; la vista previa solo muestra rutas y estados. La cadena de conexión PostgreSQL introducida durante la inicialización de Engram se envía únicamente a Engram y nunca llega a la pantalla ni al registro en ningún punto de la ejecución. Esto se aplica también al componente del hook — su escritura puede tocar todo el archivo de configuración local de un asistente (por ejemplo, `~/.claude/settings.json` de Claude Code, que también contiene todos los hooks e reglas de permisos existentes), así que su `afterContent`/`beforeHash` son exactamente igual de sensibles que los de la entrada MCP, y nunca se muestran.

`configured` solo aparece si el propio `verify memory-integration` de Engines confirma ambas partes, o si el plan ya reportó ambas presentes sin nada que escribir. Un error, `applied: false` o una verificación que no confirma ambas partes nunca se informa como éxito. Un asistente fallido no oculta el resultado de los demás.

La infraestructura también incluye `planMcpRemove` y `removeEngramMcpFromAgent`, bases internas para una futura desinstalación. No existe todavía un comando público ni interfaz de eliminación de memoria; no debe documentarse como disponible.

La configuración hace disponible la memoria para el cliente seleccionado; no garantiza que Shell pueda chatear con ese cliente ni que muestre su actividad. Ambas capacidades requieren su propio adaptador y una investigación del protocolo del asistente.

## Ejemplo real de interpretación

Si Claude Code ya está completamente configurado y Codex tiene un plan pendiente, la vista previa muestra ambos. Al confirmar, Shell aplica solo el plan de Codex y luego lo verifica. Si la aplicación de Codex falla, el resultado conserva `Claude Code: configured — MCP and memory instructions available` e informa `Codex: not configured — <mensaje de Engines>`.
