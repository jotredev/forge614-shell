# 02 — Mapa de publicación y trazabilidad

Como un catálogo de biblioteca, este documento dice dónde vive cada libro y cómo saber si la copia del estante coincide con el original.

La documentación canónica se mantiene en Markdown local y se publica en Notion bajo `AI Engineer → Librerías → Forge614-Shell`. Cada tema tiene un par Español/Inglés con el mismo número de dos dígitos.

## Regla de sincronización

`docs/notion-map.json` registra para cada archivo local: idioma, URL exacta de Notion, versión revisada y huella de contenido (hash, una firma corta para detectar cambios). Una huella solo se actualiza tras actualizar juntos el archivo local y su página de Notion.

## Revisión

Antes de crear una página se busca el tema y se consulta el hub para evitar duplicados. El hub es un índice breve; los manuales, ejemplos y diagnósticos viven en subpáginas. No se usan títulos ni fondos de color.

## Comprobaciones obligatorias

- Cada número tiene versiones ES y EN.
- Cada ruta local tiene su URL Notion en el mapa.
- Los enlaces del README, del hub y entre pares funcionan.
- Los comandos, asistentes, capacidades, errores y límites concuerdan con el código actual.
