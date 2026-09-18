# 06 — Preparación del release 1.0.0 e instalador

2026-09-18 · Etapa 02: empaquetado e instalación local · Revisión documental: 4 · [English](../en/06-release-1.0.0-bundle-installer.md) · [Índice](../../README.md) · [Guía práctica de instalación](00-instalacion-y-prueba-local-release.md)

Este documento detalla la ingeniería y preparación del **empaquetado e instalación** de Forge614-Shell: la **convención de versiones e identidad de producto**, la **visualización fija de versión en la barra de estado (`v1.0.1`)**, el constructor de paquetes autónomos (`scripts/release-bundle.mjs`), el instalador de sistema de archivos con inyección automática de PATH (`scripts/install.sh`), el **aislamiento de instalación en `~/.forge614/`**, el **flujo para mantenedores para la publicación de GitHub Releases privados**, las garantías de integridad mediante **sumas SHA-256** y la suite de calidad verificada mediante **124 pruebas automatizadas en 32 archivos (567 aserciones)**. Para la guía paso a paso para colaboradores y principiantes en macOS/Linux, consulta [00 — Instalación y prueba local del release](00-instalacion-y-prueba-local-release.md).

---

## 1. La Analogía Maestra: El Contenedor Estanco de Aviónica y la Bahía de Montaje

Pensemos en la distribución y montaje de un componente crítico de aviónica militar o espacial:
- **El Paquete de Fábrica (El bundle autónomo):** Un equipo de navegación no se envía a los hangares como piezas sueltas ni exigiendo que los ingenieros de mantenimiento tengan la maquinaria de manufactura de la fábrica central (`node_modules` o compiladores de desarrollo). Se entrega empaquetado dentro de un contenedor estanco cerrado y presurizado (`forge614-shell-1.0.1.tar.gz`), acompañado de su sello criptográfico de verificación (`.sha256`). El contenedor incluye exclusivamente lo indispensable para operar: el binario transpilado, los metadatos de configuración y las extensiones requeridas.
- **La Bahía de Montaje Aislada (`~/.forge614/shell/1.0.1/`):** El protocolo de pista (`install.sh`) no sobreescribe ciegamente los instrumentos en uso. Desembala el módulo en una bahía de montaje específica para esa versión exacta. Si se detecta una anomalía previa en los componentes básicos (`package.json` o `cli.js`), el protocolo aborta de inmediato sin alterar la aeronave.
- **El Conmutador Maestro (`~/.forge614/bin/forge614-shell`):** Una vez que la bahía está verificada, el instalador repunta el enlace de mando activo hacia el nuevo módulo. Cambiar de versión consiste únicamente en mover este conmutador de posición.
- **El Banco de Pruebas de Taller (`FORGE614_HOME`):** Cuando los técnicos necesitan validar el proceso de instalación en un entorno seguro antes de tocar el sistema principal, configuran un hangar de pruebas temporal sin tocar las rutas operativas estándar del piloto.
- **El Testigo de Instrumentación en Cabina (La barra de estado):** En la esquina inferior derecha del cuadro de mandos, el piloto cuenta con un indicador fijo y visible en todo momento (`v1.0.1`), que nunca se oculta aunque la telemetría de ruta o de los motores sature el resto de la pantalla.

---

## 2. Identidad del Release y Convención de Versiones

Forge614-Shell aplica una distinción técnica deliberada entre la denominación semántica del paquete, la etiqueta visual mostrada en la interfaz, el tag en el control de versiones y el release en GitHub:

| Atributo | Valor de Referencia | Ámbito y Propósito |
| :--- | :--- | :--- |
| **Versión del paquete** | `1.0.1` | Definida en `package.json` y leída por herramientas de Node.js / Bun (`metadata.version`). |
| **Etiqueta en interfaz (UI)** | `v1.0.1` | Presentada al usuario final en el extremo derecho de la barra de estado inferior para lectura humana clara. |
| **Git Tag** | `1.0.1` | Convención de etiquetado en Git estrictamente **sin el prefijo `v`** (cumplimiento semver puro en el repositorio). |
| **GitHub Release** | `Forge614 Shell v1.0.1` | Registro web y página privada de descarga de assets en GitHub vinculada al tag numérico `1.0.1`. |
| **Nombre del archivo tarball** | `forge614-shell-1.0.1.tar.gz` | Identificador del artefacto distribuible empaquetado. |
| **Estado de publicación** | **Release privado publicado (`Forge614 Shell v1.0.1`)** | El tag de código `1.0.1` está en `origin` y el release web privado con sus 3 assets está publicado en GitHub para colaboradores autorizados. |

> [!IMPORTANT]
> **Alineación de etiquetas:** En la interfaz gráfica/terminal se visualiza `v1.0.1`, mientras que en Git la etiqueta es `1.0.1`. Esta separación respeta los estándares de la industria donde las interfaces estilizan la versión con el prefijo "v", mientras que los sistemas de empaquetado y etiquetas de release utilizan la versión numérica pura.

---

## 3. Visualización de Versión en la Barra de Estado (`ShellStatusBar`)

La versión de Forge614-Shell se muestra en el pie de página de la terminal, integrada de forma fija en la barra de estado inferior (`status-bar.ts`):

```text
F614 · Claude Code · <model> · ~/project · main · 3 changes             v1.0.1
```

### Comportamiento de renderizado y prioridad:
1. **Posicionamiento a la derecha:** La etiqueta `v1.0.1` se renderiza en color gris atenuado (`muted`) anclada en el borde derecho de la fila de estado.
2. **Prioridad ante pantallas estrechas (Truncamiento protector):**
   - El lado izquierdo agrupa la telemetría de Shell (`F614`), proveedor, modelo, contexto, ruta relativa del proyecto (`homeRelativePath`), rama Git y cambios pendientes.
   - Si el ancho de la terminal disminuye, el componente `ShellStatusBar` calcula el ancho disponible restando el espacio ocupado por la versión:
     `availableLeft = innerWidth - visibleWidth(release) - 1`
   - El texto del lado izquierdo se compacta y trunca con elipsis (`…`) si excede el espacio restante, **garantizando que la versión `v1.0.1` nunca sea truncada, ocultada ni desplazada a una segunda línea**.

---

## 4. Paquete de Release Local (`bundle:release`)

El empaquetado del producto se realiza mediante un script de construcción desacoplado:

```bash
bun run bundle:release
```

### Arquitectura del empaquetador (`scripts/release-bundle.mjs`):
1. **Lectura de metadatos:** Lee la versión (`1.0.1`) directamente desde `package.json`.
2. **Construcción del runtime:** Invoca `bun build src/cli.ts --target=node --outdir <staging>/dist`, produciendo un ejecutable Node.js unificado y optimizado.
3. **Inclusión de extensiones y metadatos:**
   - Copia `package.json` en la raíz del staging.
   - Copia el directorio `extensions/` (necesario para el puente con Pi heredado y extensiones de entorno).
   - Establece permisos ejecutables (`0o755`) en `dist/cli.js`.
4. **Compresión estanca:** Genera el archivo tarball comprimido con `tar -czf`:
   - `dist/release/forge614-shell-1.0.1.tar.gz`
5. **Firma criptográfica:** Calcula el hash SHA-256 del archivo generado y escribe el archivo de suma de control:
   - `dist/release/forge614-shell-1.0.1.tar.gz.sha256`
6. **Autonomía total:** El archivo resultante no requiere clonar el código fuente del repositorio ni arrastra la carpeta pesada `node_modules` de desarrollo.
7. **Requisitos de entorno:** Requiere Node.js versión `>=22.19.0` en el sistema de destino.

---

## 5. Flujo de Prueba de Instalación Local

El instalador de Forge614-Shell opera deliberadamente sobre archivos locales (`--archive`). Su objetivo es verificar la estructura real de directorios, permisos y enlaces simbólicos en el sistema operativo del usuario antes de desplegar infraestructura de distribución remota.

### 5.1 Ejecución del instalador

```bash
bash scripts/install.sh --archive "$PWD/dist/release/forge614-shell-1.0.1.tar.gz"
```

### 5.2 Estructura en el sistema de archivos (`~/.forge614/`)

Por defecto, el instalador organiza los archivos bajo el directorio de usuario:

```text
~/.forge614/
├── bin/
│   └── forge614-shell -> <FORGE614_HOME>/shell/1.0.1/dist/cli.js   # Enlace simbólico activo
└── shell/
    └── 1.0.1/                                                     # Directorio versionado aislado
        ├── dist/
        │   └── cli.js                                             # Runtime ejecutable Node.js
        ├── extensions/                                            # Extensiones de entorno
        └── package.json                                           # Metadatos del release
```

### 5.3 Verificación de la instalación

Tras completar el script, se comprueba la disponibilidad del binario:

```bash
# Comprobación de versión instalada
~/.forge614/bin/forge614-shell --version
# Salida: forge614-shell 1.0.1

# Ejecución interactiva
~/.forge614/bin/forge614-shell
```

### 5.4 Configuración automática de la variable de entorno PATH (Sin pasos manuales)

El instalador `scripts/install.sh` se encarga de configurar el entorno de forma completamente desatendida:
- Detecta automáticamente el archivo de configuración del shell activo del usuario:
  - En `zsh`: `~/.zshrc`
  - En `bash`: `~/.bashrc`
  - En otros shells: `~/.profile`
- Si el archivo de perfil no existe, lo crea automáticamente.
- Verifica de manera idempotente mediante `grep -Fqx` si la ruta ya está declarada. Solo si no existe, añade al final del archivo:
  ```bash
  # Forge614 Shell
  export PATH="$HOME/.forge614/bin:$PATH"
  ```
- **Cero comandos manuales requeridos:** El usuario o colaborador **no debe** ejecutar comandos manuales de `export PATH=...` ni editar archivos de configuración a mano.
- **Activación:** Únicamente se necesita cerrar la aplicación Terminal por completo, abrir una nueva ventana y ejecutar directamente `forge614-shell`.

### 5.5 Sobrescritura de directorio raíz con `FORGE614_HOME`

Para pruebas automatizadas, instalaciones aisladas o entornos de integración continua, la variable de entorno `FORGE614_HOME` permite redirigir la raíz de instalación:

```bash
FORGE614_HOME=/tmp/test-forge614 bash scripts/install.sh --archive dist/release/forge614-shell-1.0.1.tar.gz
```

---

## 6. Seguridad y Comportamiento de Instalación

El instalador (`scripts/install.sh`) incorpora salvaguardas rigurosas para prevenir estados corruptos o inconsistentes:

1. **Despliegue versionado en dos etapas:**
   - La descompresión se realiza en un directorio de puesta en escena temporal oculto: `$shell_root/.${version}.installing`.
   - Si la descompresión o validación falla, el directorio temporal se purga sin afectar a versiones previas.
   - Solo cuando los archivos están completos, se renombra atómicamente a `$shell_root/$version`.
2. **Validación previa obligatoria (*Preflight verification*):**
   - El instalador valida que Node.js esté disponible. La aplicación empaquetada declara Node.js `>=22.19.0` como requisito de runtime.
   - Inspecciona el contenido desembalado verificando la existencia simultánea de `package.json` y `dist/cli.js`. Si alguno falta, aborta con código de salida `65` (*Invalid release archive*).
3. **Conmutación segura de enlace simbólico:**
   - Emplea `ln -sfn "$target/dist/cli.js" "$forge_home/bin/forge614-shell"` para repuntar el enlace del ejecutable activo hacia la versión instalada.
4. **Configuración idempotente del perfil de shell:**
   - Detecta la shell activa y el archivo de inicio adecuado (`~/.zshrc`, `~/.bashrc` o `~/.profile`).
   - Evita duplicación de entradas (`if ! grep -Fqx "$path_line" "$profile"`).
   - Elimina la necesidad de intervención manual o configuración frágil por parte de colaboradores.
5. **Verificación automatizada en integración (`release-bundle.test.ts`):**
   - La suite de pruebas de integración ejecuta el ciclo completo en un entorno temporal estricto:
     1. Genera el bundle mediante `bun scripts/release-bundle.mjs --out <temp-dir>`.
     2. Ejecuta `scripts/install.sh --archive <archive>` inyectando `FORGE614_HOME` temporal.
     3. Verifica que la variable `PATH` se haya inyectado correctamente en el perfil del shell sin duplicaciones.
     4. Invoca `<temp-home>/bin/forge614-shell --version`.
     5. Comprueba que el código de salida es `0` y que la salida por pantalla es exactamente `forge614-shell 1.0.1`.

---

## 7. Alcance Explícitamente No Implementado (*Negative Scope*)

Para preservar la absoluta veracidad técnica y evitar expectativas falsas sobre capacidades no construidas, se deja constancia expresa de que los siguientes componentes **NO forman parte del producto actual**:

- **Sin paquete npm público:** Forge614-Shell no está publicado en el registro npm (`npm install -g forge614-shell` no existe).
- **Sin descarga remota automática desatendida:** No existe un demonio ni cliente que descargue actualizaciones de fondo sin intervención humana; los colaboradores descargan los assets autenticándose en GitHub.
- **Sin endpoint `curl | bash` público:** No existe un comando de instalación remota por tubería tipo `curl -fsSL https://... | bash`.
- **Sin instalador alojado en `forge614.dev`:** El dominio `forge614.dev` no aloja instaladores ni binarios en esta etapa.
- **Sin comando de actualización automática:** Shell no busca ni descarga nuevas versiones de forma desatendida.
- **Sin comando `/update` en el chat:** El compositor no dispone de un comando slash para actualizarse en caliente.
- **Sin instalador PowerShell para Windows:** No se incluye un script `install.ps1` nativo para Windows (solo macOS y Linux vía bash).
- **Sin canales de release remotos:** No existen canales *stable*, *beta* o *nightly* alojados en servidores públicos.
- **Sin publicación en registros comerciales:** El paquete no está publicado en npm ni en otro registro comercial de distribución pública.

---

# Crear un release privado en GitHub

## 8. Flujo para mantenedores: Crear un release privado en GitHub

> [!NOTE]
> **Procedimiento exclusivo para mantenedores (*Maintainer Workflow*):**
> Esta sección documenta los pasos manuales que debe realizar un administrador del repositorio en la interfaz web de GitHub para crear un Release privado y adjuntar los paquetes descargables. Un colaborador o usuario final no realiza estos pasos.

### 8.1 Distinción crítica: Git Tag frente a GitHub Release

Es fundamental comprender la diferencia técnica entre un tag de Git y un release en la plataforma GitHub:

1. **El Git Tag (`1.0.1`):** Es una referencia inmutable en el historial de Git que apunta a un commit específico del código fuente. Enviar un tag al servidor remoto (`git push origin 1.0.1`) sube ese puntero al repositorio de Git, **pero no crea automáticamente un GitHub Release ni adjunta archivos descargables**.
2. **El GitHub Release (`Forge614 Shell v1.0.1`):** Es un registro web en la interfaz de GitHub asociado a un tag existente. Proporciona una página con notas de la versión (*release notes*) y una sección de archivos binarios descargables (*Assets*). Debe ser creado o publicado manualmente por un mantenedor.
3. **Diferencia de nombres:** El tag de Git se denomina estrictamente `1.0.1` (sin prefijo `v`), mientras que el título visible del GitHub Release se titula `Forge614 Shell v1.0.1` (con el prefijo `v` para lectura clara de usuario).
4. **Significado de "estable" (*stable*):** En este entorno privado, "estable" significa que es un **release normal aprobado por los mantenedores** (la casilla *Set as a pre-release* se deja desmarcada), apto para pruebas internas por parte de colaboradores autorizados. **No implica** la existencia de canales automáticos de actualización desatendida ni el comando `/update`.

### 8.2 Tabla de terminología y convención de nombres

| Término | Ejemplo | Significado y Ámbito |
| :--- | :--- | :--- |
| **Versión del paquete** | `1.0.1` | Versión interna del producto declarada en `package.json` (`metadata.version`). |
| **Etiqueta en interfaz (UI)** | `v1.0.1` | Etiqueta visual mostrada en el extremo derecho de la barra de estado inferior (`ShellStatusBar`). |
| **Git Tag** | `1.0.1` | Identificador inmutable del commit exacto en Git (estrictamente numérico, sin prefijo `v`). |
| **GitHub Release** | `Forge614 Shell v1.0.1` | Registro web y página privada de descarga de archivos adjuntos (*assets*) en GitHub. |
| **Release estable** | Release normal publicado (no pre-release) | Versión aprobada por mantenedores para pruebas de colaboradores; no incluye canal automático ni comando `/update`. |

### 8.3 Flujo paso a paso en la interfaz web de GitHub

Para publicar el release privado a partir del tag `1.0.1` ya enviado a `origin`:

1. **Abrir el repositorio privado en el navegador:** Accede a la URL del repositorio en GitHub (`https://github.com/<organización-o-usuario>/forge614-shell`) habiendo iniciado sesión con una cuenta con permisos de administración o mantenedor.
2. **Acceder a la sección de Releases:** En la barra lateral derecha de la página principal del repositorio (o en la pestaña de navegación superior), haz clic en **Releases**.
3. **Iniciar la creación del release:** Haz clic en el botón **Create a new release** (o **Draft a new release** si no existiera ningún release previo).
4. **Seleccionar el tag existente (`Choose a tag`):**
   - Haz clic en el menú desplegable **Choose a tag**.
   - Selecciona el tag existente **`1.0.1`**.
   - ⚠️ **Regla estricta:** NO crees un tag nuevo en este diálogo. **Nunca crees un tag llamado `v1.0.1`**. El tag numérico `1.0.1` ya existe en el repositorio remoto y debe ser seleccionado de la lista.
5. **Establecer el título del release (`Release title`):** Escribe exactamente:
   ```text
   Forge614 Shell v1.0.1
   ```
6. **Redactar las notas de la versión:** En el cuadro de texto principal (*Describe this release*), pega exactamente este texto en formato Markdown:
   ```markdown
   Testing release for Forge614 Shell.

   macOS and Linux local/archive installation only.
   Requires Node.js 22.19.0 or newer.

   Windows installer and public distribution are not available yet.
   ```
7. **Adjuntar los tres archivos de release (*Attach binaries/assets*):**
   Arrastra y suelta (o usa el explorador de archivos para subir) exactamente los siguientes **3 archivos**:
   - `dist/release/forge614-shell-1.0.1.tar.gz`: El paquete comprimido autónomo del producto.
   - `dist/release/forge614-shell-1.0.1.tar.gz.sha256`: El archivo con la suma criptográfica SHA-256.
   - `scripts/install.sh`: El script de instalación para macOS y Linux.
8. **Justificación técnica de cada archivo adjunto:**
   - `forge614-shell-1.0.1.tar.gz`: Archivo comprimido con la aplicación Forge614 Shell preempaquetada. Permite instalar sin clonar el repositorio de Git ni descargar dependencias de desarrollo (`node_modules` o Bun), pero la computadora destino sigue necesitando Node.js.
   - `forge614-shell-1.0.1.tar.gz.sha256`: Archivo con la suma SHA-256. Permite detectar corrupción accidental del paquete después de descargarlo; por sí solo no es un mecanismo de firma de código.
   - `install.sh`: Script auxiliar de instalación que automatiza la descompresión segura en dos fases, el despliegue versionado en `~/.forge614/shell/1.0.1/` y el repunte del enlace simbólico en `~/.forge614/bin/forge614-shell`.
9. **Configuración de pre-release:**
   - **NO marcar la casilla `Set as a pre-release`**. Debe quedar desmarcada para que el release se publique como una versión normal/estable orientada a evaluadores internos.
   - Si GitHub muestra la opción `Set as the latest release`, déjala marcada por defecto.
10. **Publicar el release:** Haz clic en el botón verde **Publish release**.

> [!WARNING]
> **Privacidad y Seguridad del Repositorio:**
> Debido a que este es un repositorio privado, **únicamente los usuarios añadidos explícitamente como colaboradores** o que cuenten con permisos de acceso dentro de la organización de GitHub podrán ver la página del release o descargar los archivos adjuntos. Publicar un GitHub Release en un repositorio privado **NO hace públicos el código ni los artefactos**.

### 8.4 Estado de publicación del release

El mantenedor completó la publicación en la web de GitHub:
- El release privado `Forge614 Shell v1.0.1` está publicado y vinculado al tag inmutable `1.0.1`.
- Los tres assets (`forge614-shell-1.0.1.tar.gz`, `forge614-shell-1.0.1.tar.gz.sha256`, e `install.sh`) se encuentran disponibles para su descarga por colaboradores autorizados.

### 8.5 Flujo de descarga e instalación para colaboradores

Para consultar la guía detallada de 15 pasos para colaboradores autorizados (incluyendo requisitos previos, verificación SHA-256, autenticación de IAs y solución de problemas), consulta directamente:
👉 [00 — Instalación y prueba local del release](00-instalacion-y-prueba-local-release.md)

### 8.6 Política de inmutabilidad de versiones y flujo de publicación de parches

Forge614-Shell mantiene una disciplina estricta de control de versiones y trazabilidad de ingeniería:

1. **Inmutabilidad de releases y tags publicados:**
   - Los tags `1.0.0` y `1.0.1` ya fueron publicados en el repositorio remoto y son estrictamente inmutables.
   - **Regla inquebrantable:** Nunca se debe mover, borrar, retiquetar o sobreescribir un tag o release ya publicado. Reemplazar un archivo o mover un tag destruye la confianza y la reproducibilidad criptográfica.
2. **Ciclo de mejoras post-release (Versión 1.0.2 en adelante):**
   - Cualquier mejora o corrección futura se publicará en una nueva versión de parche SemVer (`1.0.2`).
3. **Flujo de 6 pasos para publicar futuros parches:**
   1. **Actualizar `package.json`:** Incrementar el campo `"version"`.
   2. **Ejecutar la verificación completa:** Ejecutar `bun run check` asegurando que los tipos, el build y los 124 tests pasen sin fallos.
   3. **Generar los nuevos artefactos de release:**
      ```bash
      bun run bundle:release
      ```
   4. **Crear y enviar el tag numérico a Git:**
      ```bash
      git tag <version>
      git push origin <version>
      ```
   5. **Crear el GitHub Release privado:**
      - Tag seleccionado: `<version>` (numérico puro).
      - Título: `Forge614 Shell v<version>` (con prefijo "v").
      - Configuración: Release normal/estable (no pre-release).
   6. **Adjuntar los tres assets:**
      - `.tar.gz`
      - `.tar.gz.sha256`
      - `scripts/install.sh`

---

## 9. Estrategia de Distribución por Niveles

El ciclo de vida de distribución de Forge614-Shell avanza en tres niveles técnicos bien diferenciados:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ NIVEL 1 (COMPLETADO): Empaquetado y Verificación Local                                          │
│ • Bundle autónomo Node.js (forge614-shell-1.0.1.tar.gz)                                        │
│ • Instalador local por archivo (bash scripts/install.sh --archive)                              │
│ • Validación de layout de directorios (~/.forge614/) y pruebas de integración aisladas          │
│ • Tag numérico de Git (1.0.1) enviado a origin                                                  │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ NIVEL 2 (COMPLETADO): Distribución Privada en GitHub Releases                                   │
│ • Release privado publicado con título "Forge614 Shell v1.0.1"                                  │
│ • 3 assets (.tar.gz, .sha256, install.sh) vinculados al tag 1.0.1                               │
│ • Descarga autenticada y verificación SHA-256 para colaboradores autorizados                    │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ NIVEL 3 (FUTURO): Infraestructura Pública y Actualizaciones en Caliente                        │
│ • Endpoint de instalación rápida hospedada (forge614.dev)                                       │
│ • Script de instalación multiplataforma (macOS, Linux y Windows PowerShell)                    │
│ • Comando en aplicación (/update) con verificación de sumas criptográficas y reemplazo seguro   │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Estado de Verificación y Calidad

El paquete de release y el instalador cuentan con cobertura automatizada completa dentro del comando estándar de verificación del repositorio:

```bash
bun run check
# Equivale a: bun run typecheck && bun test && bun run build
```

### Métricas reales de verificación:
- **Pruebas automatizadas:** **124 pruebas superadas en 32 archivos** (0 fallos, 567 aserciones `expect()`).
- **Prueba clave añadida:** `tests/integration/release-bundle.test.ts` (empaquetado, instalación con inyección de PATH e invocación de `--version` fuera del repositorio).
- **Prueba de interfaz añadida:** `src/ui/basic/workspace-chrome.test.ts` (anclaje de versión a la derecha de la barra de estado con protección de truncamiento).
- **Typecheck:** `tsc --noEmit` completado sin errores.
- **Compilación de producción:** `dist/cli.js` generado correctamente (149.48 KB).
