# 08 — Diagnóstico y límites operativos

Como una lista de averías de automóvil, este documento conecta cada síntoma con el componente que puede resolverlo, sin prometer que una luz apagada sea una reparación.

| Síntoma | Significado y acción |
| --- | --- |
| Engines ausente o esquema incompatible | Reinstala Forge614 Shell para reparar su dependencia; Shell no busca otro ejecutable por su cuenta. |
| No hay asistentes de chat | Instala y autentica Claude Code o Codex; Cursor no es chat de Shell. |
| `init` sin terminal interactivo | Ejecuta el comando en una terminal real; el flujo requiere selección y confirmación. |
| No hay asistentes MCP | Ningún asistente instalado respondió `supportsMcp: true`; Engram ya puede estar inicializado. |
| Plan MCP bloqueado | Engines rechazó el cambio, por ejemplo por una entrada con el mismo nombre. Lee el motivo mostrado; Shell no fuerza archivos. |
| Resultado `not configured` | El plan o la aplicación falló, o Engines devolvió `applied: false`. Los demás asistentes pueden haber terminado correctamente. |
| Credenciales o URL base en el entorno | El adaptador rechaza desvíos de autenticación. Usa una terminal limpia y el login oficial. |
| Datos de cuotas/contexto ausentes | El cliente nativo no los reportó; Shell no los calcula ni inventa. |
| Una herramienta MCP no muestra 🧠 | Solo `forge614-engram` usa ese indicador. Otros MCP muestran `servidor: herramienta`; un asistente nuevo necesita un adaptador y validación de su protocolo. |

## Límites conocidos

Shell necesita pruebas manuales con cuentas reales para validar flujos externos y plataformas distintas de macOS/Linux. No hay instalador Windows, chat Cursor, gestor de worktrees, motores locales ni interfaz de eliminación MCP. `forge614-ai` aún no posee `forge614 init`.

## Verificación de mantenimiento

Ejecuta desde el repositorio:

```bash
bun run typecheck
bun test
bun run build
```

No hay un verificador documental configurado en `package.json`; la revisión documental comprueba pares ES/EN, enlaces Markdown, mapa Notion y afirmaciones frente al código y las pruebas.
