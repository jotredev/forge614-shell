# 06 — Preparación de releases e instalador público

2026-09-19 · Etapa 02: empaquetado, instalación pública y actualización · Revisión documental: 6 · [English](../en/06-release-1.0.0-bundle-installer.md) · [Índice](../../README.md) · [Guía de instalación y actualización](00-instalacion-y-prueba-local-release.md)

Este documento detalla la arquitectura y procedimiento de **empaquetado, distribución pública y actualización** de Forge614-Shell: la **convención de versiones e identidad de producto**, la **visualización fija de versión en la barra de estado**, el constructor de paquetes autónomos (`scripts/release-bundle.mjs`), el instalador público por red (`scripts/install.sh`), el subcomando de actualización manual (`forge614-shell update`), el **aislamiento de versiones en `~/.forge614/shell/`**, la **integración automática con Forge614 Engines en `~/.forge614/engines/`**, el **flujo para mantenedores para la publicación de GitHub Releases**, las garantías de integridad mediante **sumas SHA-256** y la suite de calidad verificada mediante **130 pruebas automatizadas en 34 archivos (591 aserciones)**. Para la guía paso a paso para el usuario final en macOS/Linux, consulta [00 — Instalación y actualización pública del release](00-instalacion-y-prueba-local-release.md).

> [!NOTE]
> La integración de bootstrap automático con Forge614 Engines y el aislamiento de rutas en `~/.forge614/shell/bin/` están integrados y probados en el código para **el próximo release estable de Shell**, sin modificar la versión pública ya publicada en GitHub Releases.

---

## 1. La Analogía Maestra: El Contenedor Estanco de Aviónica y la Bahía de Montaje

Pensemos en la distribución y montaje de un componente crítico de aviónica militar o espacial:
- **El Paquete de Fábrica (El bundle autónomo):** Un equipo de navegación no se envía a los hangares como piezas sueltas ni exigiendo que los ingenieros de mantenimiento tengan la maquinaria de manufactura de la fábrica central (`node_modules` o compiladores de desarrollo). Se entrega empaquetado dentro de un contenedor estanco cerrado y presurizado (`forge614-shell-<version>.tar.gz`), acompañado de su sello criptográfico de verificación (`.sha256`). El contenedor incluye exclusivamente lo indispensable para operar: el binario transpilado, los metadatos de configuración y las extensiones requeridas.
- **La Bahía de Montaje Aislada (`~/.forge614/shell/<version>/`):** El protocolo de pista (`install.sh`) no sobreescribe ciegamente los instrumentos en uso. Desembala el módulo en una bahía de montaje específica para esa versión exacta. Si se detecta una anomalía previa en los componentes básicos (`package.json` o `cli.js`), el protocolo aborta de inmediato sin alterar la aeronave.
- **El Conmutador Maestro (`~/.forge614/shell/bin/forge614-shell`):** Una vez que la bahía está verificada, el instalador repunta el enlace de mando activo hacia el nuevo módulo. Cambiar de versión consiste únicamente en mover este conmutador de posición.
- **El Subsistema Auxiliar Interno (`~/.forge614/engines/`):** Shell coordina la inspección de IAs locales apoyándose en Forge614 Engines (`v1.0.0`, `schemaVersion: 1`), una herramienta sin TUI que reside en su propio compartimento estanco (`~/.forge614/engines/bin/forge614-engines`) y que Shell verifica o instala de forma automática y desatendida.
- **El Banco de Pruebas de Taller (`FORGE614_HOME`):** Cuando los técnicos necesitan validar el proceso de instalación en un entorno seguro antes de tocar el sistema principal, configuran un hangar de pruebas temporal sin tocar las rutas operativas estándar del piloto.
- **El Testigo de Instrumentación en Cabina (La barra de estado):** En la esquina inferior derecha del cuadro de mandos, el piloto cuenta con un indicador fijo y visible en todo momento (`v1.0.x`), que nunca se oculta aunque la telemetría de ruta o de los motores sature el resto de la pantalla.

---

## 2. Identidad del Release y Convención de Versiones

Forge614-Shell aplica una distinción técnica deliberada entre la denominación semántica del paquete, la etiqueta visual mostrada en la interfaz, el tag en el control de versiones y el release en GitHub:

| Atributo | Convención | Ámbito y Propósito |
| :--- | :--- | :--- |
| **Versión del paquete** | `<version>` (ej. `1.0.2` / `1.0.4`) | Definida en `package.json` y leída por herramientas de Node.js / Bun (`metadata.version`). |
| **Etiqueta en interfaz (UI)** | `v<version>` (ej. `v1.0.2` / `v1.0.4`) | Presentada al usuario final en el extremo derecho de la barra de estado inferior para lectura humana clara. |
| **Git Tag** | `<version>` (ej. `1.0.2` / `1.0.4`) | Convención de etiquetado en Git estrictamente **sin el prefijo `v`** (cumplimiento semver puro en el repositorio). |
| **GitHub Release** | `Forge614 Shell v<version>` | Registro web y página pública de descarga de assets en GitHub vinculada al tag numérico. |
| **Nombre del archivo tarball** | `forge614-shell-<version>.tar.gz` | Identificador del artefacto distribuible empaquetado. |
| **Estado de publicación** | **Releases públicos estables** | Tags numéricos en `origin`, publicados en GitHub Releases y marcados como `Latest` con sus 3 assets. |

> [!IMPORTANT]
> **Alineación de etiquetas:** En la interfaz gráfica/terminal se visualiza `v<version>`, mientras que en Git la etiqueta es `<version>` pura. Esta separación respeta los estándares de la industria donde las interfaces estilizan la versión con el prefijo "v", mientras que los sistemas de empaquetado y etiquetas de release utilizan la versión numérica pura.

---

## 3. Visualización de Versión en la Barra de Estado (`ShellStatusBar`)

La versión de Forge614-Shell se muestra en el pie de página de la terminal, integrada de forma fija en la barra de estado inferior (`status-bar.ts`):

```text
F614 · Claude Code · <model> · ~/project · main · 3 changes             v1.0.2
```

### Comportamiento de renderizado y prioridad:
1. **Posicionamiento a la derecha:** La etiqueta de versión se renderiza en color gris atenuado (`muted`) anclada en el borde derecho de la fila de estado.
2. **Prioridad ante pantallas estrechas (Truncamiento protector):**
   - El lado izquierdo agrupa la telemetría de Shell (`F614`), proveedor, modelo, contexto, ruta relativa del proyecto (`homeRelativePath`), rama Git y cambios pendientes.
   - Si el ancho de la terminal disminuye, el componente `ShellStatusBar` calcula el ancho disponible restando el espacio ocupado por la versión:
     `availableLeft = innerWidth - visibleWidth(release) - 1`
   - El texto del lado izquierdo se compacta y trunca con elipsis (`…`) si excede el espacio restante, **garantizando que la versión nunca sea truncada, ocultada ni desplazada a una segunda línea**.

---

## 4. Paquete de Release Local (`bundle:release`)

El empaquetado del producto se realiza mediante un script de construcción desacoplado:

```bash
bun run bundle:release
```

### Arquitectura del empaquetador (`scripts/release-bundle.mjs`):
1. **Lectura de metadatos:** Lee la versión directamente desde `package.json`.
2. **Construcción del runtime:** Invoca `bun build src/cli.ts --target=node --outdir <staging>/dist`, produciendo un ejecutable Node.js unificado y optimizado.
3. **Inclusión de extensiones y metadatos:**
   - Copia `package.json` en la raíz del staging.
   - Copia el directorio `extensions/` (necesario para el puente con Pi heredado y extensiones de entorno).
   - Establece permisos ejecutables (`0o755`) en `dist/cli.js`.
4. **Compresión estanca:** Genera el archivo tarball comprimido con `tar -czf`:
   - `dist/release/forge614-shell-<version>.tar.gz`
5. **Firma criptográfica:** Calcula el hash SHA-256 del archivo generado y escribe el archivo de suma de control:
   - `dist/release/forge614-shell-<version>.tar.gz.sha256`
6. **Autonomía total:** El archivo resultante no requiere clonar el código fuente del repositorio ni arrastra la carpeta pesada `node_modules` de desarrollo. **No se empaquetan binarios de Forge614 Engines dentro de este archivo.**
7. **Requisitos de entorno:** Requiere Node.js versión `>=22.19.0` en el sistema de destino.

---

## 5. Distribución Pública e Instalación en Red

### 5.1 El comando de instalación pública directa
Cualquier usuario en macOS o Linux puede instalar Forge614 Shell con un único comando:

```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```

> [!IMPORTANT]
> **Sin comandos secundarios:** No existe un segundo comando para instalar Forge614 Engines. Shell gestiona Engines de forma completamente transparente.

### 5.2 Modos de operación del instalador (`scripts/install.sh`):
1. **Modo por defecto (`--latest`):**
   - Consulta `https://api.github.com/repos/jotredev/forge614-shell/releases/latest`.
   - Extrae el número de versión y las URLs de descarga de los assets (`.tar.gz` y `.sha256`).
   - Descarga en una carpeta temporal segura.
   - Comprueba la suma SHA-256 antes de extraer (`shasum -a 256 -c` o `sha256sum -c`).
   - Si la versión ya coincide con la activa, notifica: `Forge614 Shell v<version> is already active.` y termina con salida limpia.
2. **Modo archivo local (`--archive <tarball>`):**
   - Utilizado para pruebas locales, desarrollo o entornos aislados sin conexión a internet.
   - Desempaqueta y valida directamente el archivo local indicado.
3. **Modo desinstalación (`--uninstall`):**
   - Retira de forma limpia `~/.forge614/shell/` y limpia la línea del `PATH` en el perfil del usuario, dejando intactos otros componentes como Engines o Engram.

### 5.3 Estructura en el sistema de archivos (`~/.forge614/`)

```text
~/.forge614/
├─ shell/
│  ├─ bin/
│  │  └─ forge614-shell -> <FORGE614_HOME>/shell/<version>/dist/cli.js   # Enlace activo (ÚNICO en PATH)
│  └─ <version>/                                                        # Directorio versionado aislado
│     ├── dist/
│     │   └── cli.js                                                    # Runtime ejecutable Node.js
│     ├── extensions/                                                   # Extensiones de entorno
│     └── package.json                                                  # Metadatos del release
└─ engines/
   └─ bin/
      └─ forge614-engines                                               # Binario interno (NO en PATH)
```

### 5.4 Configuración automática de la variable de entorno PATH

El instalador configura el entorno de forma completamente automática y no invasiva:
- Detecta el shell activo (`~/.zshrc` en `zsh`, `~/.bashrc` en `bash`, o `~/.profile` en otros shells).
- Inyecta la línea de exportación hacia el subdirectorio aislado de Shell de manera idempotente (comprobando con `grep -Fqx`):
  ```bash
  # Forge614 Shell
  export PATH="$HOME/.forge614/shell/bin:$PATH"
  ```
- **Limpieza de rutas obsoletas:** Si el perfil contenía la ruta genérica previa `export PATH="$HOME/.forge614/bin:$PATH"`, el script la elimina automáticamente.
- **Aislamiento de Engines:** El directorio `~/.forge614/engines/bin` **nunca se añade al PATH**. `forge614-engines` no debe ser ejecutado directamente por el usuario.

### 5.5 Bootstrap y validación automática de Forge614 Engines

Durante la instalación o actualización manual con `forge614-shell update`, antes de activar la nueva versión de Shell, el instalador ejecuta la rutina `ensure_engines`:

1. **Inspección de binario existente:** Comprueba si `~/.forge614/engines/bin/forge614-engines` existe y tiene permisos de ejecución.
2. **Validación del contrato de detección:** Ejecuta `"$engines_binary" detect` y valida mediante Node.js que la salida JSON contenga:
   - `schemaVersion: 1`
   - `Array.isArray(report.agents)`
3. **Reutilización inteligente:** Si la verificación es exitosa, emite `Using compatible Forge614 Engines (schema v1).` y continúa sin realizar descargas innecesarias.
4. **Instalación desatendida si falta o es incompatible:** Si Engines está ausente o su esquema no coincide, descarga el instalador oficial de Engines desde `FORGE614_ENGINES_INSTALLER_URL` (por defecto `https://github.com/jotredev/forge614-engines/releases/latest/download/install.sh`) y lo ejecuta con `FORGE614_HOME="$forge_home" bash "$installer" --latest`.
5. **Garantía atómica:** Tras la instalación de Engines, vuelve a validar el contrato. Si la descarga, ejecución o compatibilidad de Engines falla, el instalador aborta con código `65`:
   - `Forge614 Engines installation failed; Forge614 Shell was not changed.`
   - `Installed Forge614 Engines is not compatible with Forge614 Shell; Forge614 Shell was not changed.`
   - **Shell no se activa ni se modifica:** Tu instalación anterior de Shell permanece 100% operativa y el sistema nunca queda en un estado roto a medias.

### 5.6 Ciclo de vida y uso independiente tras el setup

Forge614 Shell actúa como la interfaz gráfica para configuración e integraciones, pero no impone un bloqueo de uso diario:
- El usuario puede abrir Shell para configurar sus integraciones de IA o iniciar el entorno.
- Una vez completado el setup, **el usuario puede cerrar Shell libremente y trabajar de forma nativa** en ADE Orca, Claude Code, Codex u otra herramienta habitual.
- Las integraciones gestionadas por el ecosistema permanecen activas en los clientes configurados sin requerir que Shell continúe abierto en segundo plano.

### 5.7 Actualización manual con `forge614-shell update`

La aplicación incluye un subcomando CLI nativo para actualizar:

```bash
forge614-shell update
```

- **Invocación segura:** Llama internamente al instalador en modo `--latest`, validando tanto los assets de Shell como la compatibilidad de Engines.
- **Acción manual:** Nunca actualiza en segundo plano de forma desatendida.
- **Protección de estado:** Si la descarga, el checksum o Engines fallan, conserva la versión activa previa sin dejar el sistema en un estado roto.
- **Aviso de versión activa:** Si no hay versiones nuevas, informa que la versión actual ya está activa.

---

## 6. Seguridad y Comportamiento de Instalación

El instalador (`scripts/install.sh`) incorpora salvaguardas rigurosas para prevenir estados corruptos o inconsistentes:

1. **Despliegue versionado en dos etapas:**
   - La descompresión se realiza en un directorio de puesta en escena temporal oculto: `$shell_root/.${version}.installing`.
   - Si la descompresión o validación falla, el directorio temporal se purga sin afectar a versiones previas.
   - Solo cuando los archivos están completos y Engines está validado, se renombra atómicamente a `$shell_root/$version`.
2. **Validación previa obligatoria (*Preflight verification*):**
   - Valida que Node.js esté disponible y que la versión sea `>=22.19.0`.
   - Valida herramientas del sistema (`tar`, `curl`, `shasum` o `sha256sum`).
   - Inspecciona el contenido desembalado verificando la existencia simultánea de `package.json` y `dist/cli.js`. Si alguno falta, aborta con código de salida `65` (*Invalid release archive*).
3. **Conmutación segura de enlace simbólico:**
   - Emplea `ln -sfn "$target/dist/cli.js" "$shell_root/bin/forge614-shell"` para repuntar el enlace del ejecutable activo hacia la versión instalada dentro de `~/.forge614/shell/bin/`.
4. **Configuración idempotente del perfil de shell:**
   - Evita duplicación de entradas (`if ! grep -Fqx "$path_line" "$profile"`).
5. **Verificación automatizada en integración (`public-installer.test.ts` y `release-bundle.test.ts`):**
   - Valida descarga remota, verificación de checksum, instalación exitosa, migración del PATH, reutilización de Engines y preservación del ejecutable activo ante cualquier fallo.

---

## 7. Alcance Explícitamente No Implementado (*Negative Scope*)

Para preservar la absoluta veracidad técnica y evitar expectativas falsas, se deja constancia expresa de que los siguientes componentes **NO forman parte del producto actual**:

- **Sin soporte para Windows:** No se incluye un script `install.ps1` nativo para Windows PowerShell (solo macOS y Linux vía bash).
- **Sin dominio propio ni instalador en `forge614.dev`:** El dominio `forge614.dev` no aloja binarios en esta etapa; la distribución pública depende exclusivamente de GitHub Releases.
- **Sin paquete npm público:** Forge614-Shell no está publicado en el registro npm (`npm install -g forge614-shell` no existe).
- **Sin comando `/update` en el chat:** El compositor interactivo no dispone de un comando slash para actualizarse; la actualización se ejecuta en la terminal con `forge614-shell update`.
- **Sin comando de actualización automática desatendida:** Shell nunca busca ni descarga nuevas versiones de fondo.
- **Engines no se añade al PATH ni es un comando de usuario:** `forge614-engines` es una dependencia interna sin TUI; no debe ser ejecutado manualmente por el usuario.
- **Sin obligación de usar Shell a diario:** Tras la configuración inicial, no es obligatorio mantener Shell abierto para el trabajo diario de programación asistida por IA.

---

## 8. Flujo para Mantenedores: Publicación de un Release Público

Para publicar una nueva versión pública estable en GitHub Releases, el mantenedor debe seguir estrictamente este flujo de 7 pasos:

1. **Verificar la publicación previa de Forge614 Engines:**
   - `forge614-engines` debe contar con un release público estable compatible (por ejemplo `v1.0.0`) con `schemaVersion: 1` publicado antes de lanzar una versión de Shell que dependa de él.
   - El instalador de Shell consumirá el instalador oficial de Engines vía red; **nunca se deben copiar binarios de Engines dentro del bundle o release de Shell**.
2. **Actualizar la versión en `package.json`:**
   Incrementar el campo `"version"` (por ejemplo `"1.0.4"` o la siguiente versión estable).
3. **Ejecutar la suite completa de calidad:**
   ```bash
   bun run check
   ```
   Asegurar que el typecheck, las 130 pruebas automáticas y el build pasen con 0 errores.
4. **Generar el bundle autónomo y la suma criptográfica:**
   ```bash
   bun run bundle:release
   ```
   Esto produce en `dist/release/`:
   - `forge614-shell-<version>.tar.gz`
   - `forge614-shell-<version>.tar.gz.sha256`
5. **Crear y enviar el tag numérico a Git:**
   ```bash
   git tag <version>
   git push origin <version>
   ```
   *(El tag debe ser estrictamente numérico, por ejemplo `1.0.4`, sin prefijo `v`).*
6. **Crear el GitHub Release público y subir exactamente los tres Assets requeridos:**
   - Tag seleccionado: `<version>`.
   - Título del Release: `Forge614 Shell v<version>`.
   - Subir exactamente los tres Assets requeridos:
     1. `forge614-shell-<version>.tar.gz`
     2. `forge614-shell-<version>.tar.gz.sha256`
     3. `scripts/install.sh`
7. **Marcarlo como Latest solo si es versión estable pública:**
   - Marcar la casilla **Set as the latest release**.
   - > [!WARNING]
     > El instalador público (`curl .../releases/latest/download/install.sh | bash`) y el comando `forge614-shell update` consultan el endpoint `/releases/latest`. **Una versión experimental, beta o pre-release NUNCA debe marcarse como Latest**, ya que sobrescribiría la versión que reciben los usuarios finales en la instalación pública.

---

## 9. Estrategia de Distribución por Niveles

El ciclo de vida de distribución de Forge614-Shell avanza en tres niveles técnicos bien diferenciados:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ NIVEL 1 (COMPLETADO): Empaquetado y Verificación Local                                          │
│ • Bundle autónomo Node.js (forge614-shell-<version>.tar.gz)                                     │
│ • Instalador local por archivo (bash scripts/install.sh --archive)                              │
│ • Validación de layout de directorios (~/.forge614/shell/) y pruebas de integración aisladas    │
│ • Tag numérico de Git enviado a origin                                                          │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ NIVEL 2 (ACTUAL / PRÓXIMO RELEASE ESTABLE): Distribución Pública y Bootstrap de Engines         │
│ • Release público publicado como Latest con título "Forge614 Shell v<version>"                  │
│ • 3 assets obligatorios (.tar.gz, .sha256, install.sh) vinculados al tag numérico               │
│ • Instalación pública directa: curl -fsSL .../releases/latest/download/install.sh | bash         │
│ • Actualización manual segura en terminal: forge614-shell update                                │
│ • Bootstrap y validación automática de Forge614 Engines (schemaVersion: 1) en ~/.forge614/engines/│
│ • Aislamiento de PATH en ~/.forge614/shell/bin (Engines queda fuera del PATH)                   │
│ • Handoff para trabajo nativo directo en ADE Orca, Claude Code o Codex tras el setup            │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ NIVEL 3 (FUTURO): Infraestructura con Dominio Propio y Soporte Multiplataforma                  │
│ • Endpoint en dominio propio (forge614.dev)                                                     │
│ • Script de instalación multiplataforma (macOS, Linux y Windows PowerShell)                    │
│ • Extensiones de entorno ampliadas                                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Estado de Verificación y Calidad

El paquete de release, el instalador público en red, la integración con Engines y el comando de actualización manual cuentan con cobertura automatizada completa:

```bash
bun run check
# Equivale a: bun run typecheck && bun test && bun run build
```

### Métricas reales de verificación:
- **Pruebas automatizadas:** **130 pruebas superadas en 34 archivos** (0 fallos, 591 aserciones `expect()`).
- **Prueba clave de instalador público y bootstrap de Engines:** `tests/integration/public-installer.test.ts` (descarga remota, verificación de hash, instalación de Shell, bootstrap de Engines v1.0.0, reutilización de Engines compatible e instalación fallida si el hash o Engines es corrupto).
- **Prueba clave de actualización segura:** `tests/integration/public-installer.test.ts` (verificación de preservación de ejecutable activo ante un checksum corrupto).
- **Prueba clave de comando update:** `src/infrastructure/updater.test.ts` (invocación del instalador en modo `--latest`).
- **Typecheck:** `tsc --noEmit` completado sin errores.
- **Compilación de producción:** `dist/cli.js` generado correctamente (150.77 KB).
