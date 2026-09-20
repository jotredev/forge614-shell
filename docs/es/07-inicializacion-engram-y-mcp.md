# 07 — Inicialización de Engram y configuración MCP

Como conectar varias radios a una misma estación, este flujo prepara la memoria una vez y permite conectar solo los clientes que la persona elija.

## Propósito y entrada

Ejecuta:

```bash
forge614-shell init --product engram
```

El comando exige un terminal interactivo. Primero muestra el flujo de Engram: almacenamiento local SQLite y FTS5 (índice para búsqueda de texto) obligatorio, sincronización PostgreSQL opcional y refuerzo opcional (prioriza memorias repetidas; no prueba que sean verdaderas). Tras una confirmación, Shell ejecuta `forge614-engram init --json` y, si se eligió, `forge614-engram reinforcement-enable`.

Una cancelación antes de confirmar imprime `Cancelled. No changes were made.` y devuelve código 130. Si la inicialización de Engram funciona, un fallo posterior de MCP no la convierte en fallida.

## Flujo MCP paso a paso

1. Shell llama a `forge614-engines detect` y exige `schemaVersion: 1`.
2. Para cada asistente instalado, llama a `forge614-engines capabilities --agent <id>`.
3. Solo ofrece los que responden `supportsMcp: true`. Esta lista puede incluir Cursor y no depende de que exista un adaptador de chat.
4. La persona puede elegir cero, uno o varios asistentes. Esc cancela la configuración MCP; elegir cero no escribe nada.
5. Para cada elegido, Shell solicita un plan de solo lectura:

```text
forge614-engines plan mcp-install --agent <id> --name forge614-engram \
  --command <ruta-real-de-forge614-engram> --args mcp
```

6. La vista previa combinada muestra el asistente y solo la ruta del archivo que cambiaría, o `already configured`, o `blocked` con el motivo.
7. Tras una única confirmación explícita, Shell aplica cada plan pendiente de forma independiente:

```text
forge614-engines apply --plan-id <id>
```

8. Finalmente informa por asistente: `configured`, `already configured`, `skipped` o `not configured — <motivo>`.

## Seguridad y resultados

Shell nunca presenta ni registra `afterContent` (contenido propuesto) ni `beforeHash` (huella del contenido previo) de los archivos de configuración. `configured` solo aparece si Engines responde `applied: true`; un error o `applied: false` es `not configured`. Un asistente fallido no oculta el resultado de los demás.

La infraestructura también incluye `planMcpRemove` y `removeEngramMcpFromAgent`, bases internas para una futura desinstalación. No existe todavía un comando público ni interfaz de eliminación MCP; no debe documentarse como disponible.

La configuración hace disponible el servidor para el cliente seleccionado; no garantiza que Shell pueda chatear con ese cliente ni que muestre su actividad. Ambas capacidades requieren su propio adaptador y una investigación del protocolo del asistente.

## Ejemplo real de interpretación

Si Claude Code ya está configurado y Codex tiene un plan pendiente, la vista previa muestra ambos. Al confirmar, Shell no aplica Claude y aplica solo el plan de Codex. Si Codex falla, el resultado conserva `Claude Code: already configured` y muestra `Codex: not configured — ...`.
