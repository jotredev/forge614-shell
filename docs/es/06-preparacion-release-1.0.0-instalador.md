# 06 — Preparación del release 1.0.0 y empaquetado del instalador

2026-09-18 · Etapa 02: empaquetado e instalación local · Revisión documental: 1 · [English](../en/06-release-1.0.0-bundle-installer.md) · [Índice](../../README.md)

Este documento detalla la preparación del **release local 1.0.0** de Forge614-Shell: la **convención de versiones e identidad de producto**, la **visualización fija de versión en la barra de estado (`v1.0.0`)**, el script constructor de paquetes autónomos (`scripts/release-bundle.mjs`), el instalador local de sistema de archivos (`scripts/install.sh`), el **aislamiento de instalación en `~/.forge614/`**, las garantías de integridad mediante **sumas SHA-256** y la suite de calidad verificada mediante **124 pruebas automatizadas en 32 archivos**.

---

## 1. La Analogía Maestra: El Contenedor Estanco de Aviónica y la Bahía de Montaje

Pensemos en la distribución y montaje de un componente crítico de aviónica militar o espacial:
- **El Paquete de Fábrica (El bundle autónomo):** Un equipo de navegación no se envía a los hangares como piezas sueltas ni exigiendo que los ingenieros de mantenimiento tengan la maquinaria de manufactura de la fábrica central (`node_modules` o compiladores de desarrollo). Se entrega empaquetado dentro de un contenedor estanco cerrado y presurizado (`forge614-shell-1.0.0.tar.gz`), acompañado de su sello criptográfico de verificación (`.sha256`). El contenedor incluye exclusivamente lo indispensable para operar: el binario transpilado, los metadatos de configuración y las extensiones requeridas.
- **La Bahía de Montaje Aislada (`~/.forge614/shell/1.0.0/`):** El protocolo de pista (`install.sh`) no sobreescribe ciegamente los instrumentos en uso. Desembala el módulo en una bahía de montaje específica para esa versión exacta. Si se detecta una anomalía previa en los componentes básicos (`package.json` o `cli.js`), el protocolo aborta de inmediato sin alterar la aeronave.
- **El Conmutador Maestro (`~/.forge614/bin/forge614-shell`):** Una vez que la bahía 1.0.0 está verificada, el instalador conmuta de forma atómica el enlace de mando activo hacia el nuevo módulo. Cambiar de versión consiste únicamente en mover este conmutador de posición.
- **El Banco de Pruebas de Taller (`FORGE614_HOME`):** Cuando los técnicos necesitan validar el proceso de instalación en un entorno seguro antes de tocar el sistema principal, configuran un hangar de pruebas temporal sin tocar las rutas operativas estándar del piloto.
- **El Testigo de Instrumentación en Cabina (La barra de estado):** En la esquina inferior derecha del cuadro de mandos, el piloto cuenta con un indicador fijo y visible en todo momento (`v1.0.0`), que nunca se oculta aunque la telemetría de ruta o de los motores sature el resto de la pantalla.

---

## 2. Identidad del Release y Convención de Versiones

Forge614-Shell aplica una distinción técnica deliberada entre la denominación semántica del paquete, la etiqueta visual mostrada en la interfaz y el tag en el control de versiones:

| Atributo | Valor | Ámbito y Propósito |
| :--- | :--- | :--- |
| **Versión del paquete** | `1.0.0` | Definida en `package.json` y leída por herramientas de Node.js / Bun (`metadata.version`). |
| **Etiqueta en interfaz (UI)** | `v1.0.0` | Presentada al usuario final en el extremo derecho de la barra de estado inferior para lectura humana clara. |
| **Git Tag** | `1.0.0` | Convención de etiquetado en Git estrictamente **sin el prefijo `v`** (cumplimiento semver puro en el repositorio). |
| **Nombre del archivo tarball** | `forge614-shell-1.0.0.tar.gz` | Identificador del artefacto distribuible empaquetado. |
| **Estado de publicación** | **Local únicamente** | Preparado y verificado en la máquina local; **no ha sido publicado ni enviado (`git push`) a ningún repositorio o registro remoto**. |

> [!IMPORTANT]
> **Alineación de etiquetas:** En la interfaz gráfica/terminal se visualiza `v1.0.0`, mientras que en Git la etiqueta es `1.0.0`. Esta separación respeta los estándares de la industria donde las interfaces estilizan la versión con el prefijo "v", mientras que los sistemas de empaquetado y etiquetas de release utilizan la versión numérica pura.

---

## 3. Visualización de Versión en la Barra de Estado (`ShellStatusBar`)

La versión de Forge614-Shell se muestra en el pie de página de la terminal, integrada de forma fija en la barra de estado inferior (`status-bar.ts`):

```text
F614 · Claude Code · <model> · ~/project · main · 3 changes             v1.0.0
```

### Comportamiento de renderizado y prioridad:
1. **Posicionamiento a la derecha:** La etiqueta `v1.0.0` se renderiza en color gris atenuado (`muted`) anclada en el borde derecho de la fila de estado.
2. **Prioridad ante pantallas estrechas (Truncamiento protector):**
   - El lado izquierdo agrupa la telemetría de Shell (`F614`), proveedor, modelo, contexto, ruta relativa del proyecto (`homeRelativePath`), rama Git y cambios pendientes.
   - Si el ancho de la terminal disminuye, el componente `ShellStatusBar` calcula el ancho disponible restando el espacio ocupado por la versión:
     `availableLeft = innerWidth - visibleWidth(release) - 1`
   - El texto del lado izquierdo se compacta y trunca con elipsis (`…`) si excede el espacio restante, **garantizando que la versión `v1.0.0` nunca sea truncada, ocultada ni desplazada a una segunda línea**.

---

## 4. Paquete de Release Local (`bundle:release`)

El empaquetado del producto se realiza mediante un script de construcción desacoplado:

```bash
bun run bundle:release
```

### Arquitectura del empaquetador (`scripts/release-bundle.mjs`):
1. **Lectura de metadatos:** Lee la versión (`1.0.0`) directamente desde `package.json`.
2. **Construcción del runtime:** Invoca `bun build src/cli.ts --target=node --outdir <staging>/dist`, produciendo un ejecutable Node.js unificado y optimizado.
3. **Inclusión de extensiones y metadatos:**
   - Copia `package.json` en la raíz del staging.
   - Copia el directorio `extensions/` (necesario para el puente con Pi heredado y extensiones de entorno).
   - Establece permisos ejecutables (`0o755`) en `dist/cli.js`.
4. **Compresión estanca:** Genera el archivo tarball comprimido con `tar -czf`:
   - `dist/release/forge614-shell-1.0.0.tar.gz`
5. **Firma criptográfica:** Calcula el hash SHA-256 del archivo generado y escribe el archivo de suma de control:
   - `dist/release/forge614-shell-1.0.0.tar.gz.sha256`
6. **Autonomía total:** El archivo resultante no requiere clonar el código fuente del repositorio ni arrastra la carpeta pesada `node_modules` de desarrollo.
7. **Requisitos de entorno:** Requiere Node.js versión `>=22.19.0` en el sistema de destino.

---

## 5. Flujo de Prueba de Instalación Local

El primer instalador de Forge614-Shell opera deliberadamente sobre archivos locales (`--archive`). Su objetivo es verificar la estructura real de directorios, permisos y enlaces simbólicos en el sistema operativo del usuario antes de desplegar infraestructura de distribución remota.

### 5.1 Ejecución del instalador

```bash
bash scripts/install.sh --archive "$PWD/dist/release/forge614-shell-1.0.0.tar.gz"
```

### 5.2 Estructura en el sistema de archivos (`~/.forge614/`)

Por defecto, el instalador organiza los archivos bajo el directorio de usuario:

```text
~/.forge614/
├── bin/
│   └── forge614-shell -> <FORGE614_HOME>/shell/1.0.0/dist/cli.js   # Enlace simbólico activo
└── shell/
    └── 1.0.0/                                         # Directorio versionado aislado
        ├── dist/
        │   └── cli.js                                 # Runtime ejecutable Node.js
        ├── extensions/                                # Extensiones de entorno
        └── package.json                               # Metadatos del release
```

### 5.3 Verificación de la instalación

Tras completar el script, se comprueba la disponibilidad del binario:

```bash
# Comprobación de versión instalada
~/.forge614/bin/forge614-shell --version
# Salida: forge614-shell 1.0.0

# Ejecución interactiva
~/.forge614/bin/forge614-shell
```

### 5.4 Configuración de la variable de entorno `PATH`

Para invocar `forge614-shell` directamente desde cualquier terminal, se debe agregar el directorio de binarios a la variable `PATH` en el archivo de configuración del shell (`~/.zshrc` o `~/.bashrc`):

```bash
export PATH="$HOME/.forge614/bin:$PATH"
```

### 5.5 Sobrescritura de directorio raíz con `FORGE614_HOME`

Para pruebas automatizadas, instalaciones aisladas o entornos de integración continua, la variable de entorno `FORGE614_HOME` permite redirigir la raíz de instalación:

```bash
FORGE614_HOME=/tmp/test-forge614 bash scripts/install.sh --archive dist/release/forge614-shell-1.0.0.tar.gz
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
4. **Verificación automatizada en integración (`release-bundle.test.ts`):**
   - La suite de pruebas de integración ejecuta el ciclo completo en un entorno temporal estricto:
     1. Genera el bundle mediante `bun scripts/release-bundle.mjs --out <temp-dir>`.
     2. Ejecuta `scripts/install.sh --archive <archive>` inyectando `FORGE614_HOME` temporal.
     3. Invoca `<temp-home>/bin/forge614-shell --version`.
     4. Comprueba que el código de salida es `0` y que la salida por pantalla es exactamente `forge614-shell 1.0.0`.

---

## 7. Alcance Explícitamente No Implementado (*Negative Scope*)

Para preservar la absoluta veracidad técnica y evitar expectativas falsas sobre capacidades no construidas, se deja constancia expresa de que los siguientes componentes **NO forman parte del producto actual**:

- **Sin paquete npm público:** Forge614-Shell no está publicado en el registro npm (`npm install -g forge614-shell` no existe).
- **Sin descarga remota desde GitHub Releases:** No existe un flujo de descarga mediante releases de GitHub.
- **Sin endpoint `curl | bash`:** No existe un comando de instalación remota por tubería tipo `curl -fsSL https://... | bash`.
- **Sin instalador alojado en `forge614.dev`:** El dominio `forge614.dev` no aloja instaladores ni binarios en esta etapa.
- **Sin comando de actualización automática:** Shell no busca ni descarga nuevas versiones de forma desatendida.
- **Sin comando `/update` en el chat:** El compositor no dispone de un comando slash para actualizarse en caliente.
- **Sin instalador PowerShell para Windows:** No se incluye un script `install.ps1` nativo para Windows.
- **Sin canales de release remotos:** No existen canales *stable*, *beta* o *nightly* alojados en servidores.
- **Sin publicación remota efectuada:** El repositorio local no ha sido sincronizado ni publicado en la nube (`git push` pendiente).
- **Sin tag de GitHub publicado:** El tag `1.0.0` reside exclusivamente en el repositorio Git local.

---

## 8. Estrategia de Distribución por Niveles

El ciclo de vida de distribución de Forge614-Shell avanza en tres niveles técnicos bien diferenciados:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ NIVEL 1 (ACTUAL): Empaquetado y Verificación Local                                              │
│ • Bundle autónomo Node.js (forge614-shell-1.0.0.tar.gz)                                        │
│ • Instalador local por archivo (bash scripts/install.sh --archive)                              │
│ • Validación de layout de directorios (~/.forge614/) y pruebas de integración aisladas          │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ NIVEL 2 (PRÓXIMO): Distribución Privada en GitHub Releases                                      │
│ • Publicación de tags numéricos (1.0.0) y artefactos tarball firmados                           │
│ • Descarga autenticada mediante GitHub CLI o tokens personales para el equipo interno           │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ NIVEL 3 (FUTURO): Infraestructura Pública y Actualizaciones en Caliente                        │
│ • Endpoint de instalación rápida hospedada (forge614.dev)                                       │
│ • Script de instalación multiplataforma (macOS, Linux y Windows PowerShell)                    │
│ • Comando en aplicación (/update) con verificación de sumas criptográficas y reemplazo seguro   │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Estado de Verificación y Calidad

El paquete de release y el instalador cuentan con cobertura automatizada completa dentro del comando estándar de verificación del repositorio:

```bash
bun run check
# Equivale a: bun run typecheck && bun test && bun run build
```

### Métricas reales de verificación:
- **Pruebas automatizadas:** **124 pruebas superadas en 32 archivos** (0 fallos, 566 aserciones `expect()`).
- **Prueba clave añadida:** `tests/integration/release-bundle.test.ts` (empaquetado, instalación e invocación de `--version` fuera del repositorio).
- **Prueba de interfaz añadida:** `src/ui/basic/workspace-chrome.test.ts` (anclaje de versión `v1.0.0` a la derecha de la barra de estado con protección de truncamiento).
- **Typecheck:** `tsc --noEmit` completado sin errores.
- **Compilación de producción:** `dist/cli.js` generado correctamente (149.48 KB).
