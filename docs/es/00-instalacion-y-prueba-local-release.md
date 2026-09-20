# 00 — Instalación y actualización pública del release

2026-09-19 · Etapa 02: instalación y actualización pública en macOS y Linux · Revisión: 7 · [English](../en/00-installation-and-local-release-test.md) · [Índice](../../README.md) · [Detalles técnicos del bundle](06-preparacion-release-1.0.0-instalador.md)

Esta guía explica, con el máximo nivel de detalle y paso a paso para personas **sin experiencia técnica previa**, el flujo público definitivo de instalación y actualización de **Forge614 Shell** en **macOS o Linux**, utilizando como versión de referencia estable el release **`1.0.2`** (`Forge614 Shell v1.0.2`). La integración con el contrato público de **Forge614 Engines** (`schemaVersion: 1`), el selector de inicio respaldado por Engines (sin fallback local) y el aislamiento de rutas en `~/.forge614/shell/bin/` forman parte del código validado localmente para **el próximo release estable de Shell** (sin modificar aún la versión publicada actual).

El repositorio de Forge614 Shell es público y su distribución oficial se realiza a través de **GitHub Releases**.

---

## Requisitos

Antes de comenzar, asegúrate de que tu computadora cuenta con los siguientes requisitos:

- **macOS o Linux:** Sistema operativo compatible (los comandos son idénticos en ambos; en macOS se usa la app Terminal habitual y en Linux cualquier emulador de terminal estándar).
- **Terminal:** La aplicación de línea de comandos preinstalada en tu sistema.
- **Bash:** El intérprete de comandos estándar en macOS y Linux.
- **`curl`:** Herramienta de red estándar para descargar el instalador.
- **`tar`:** Utilidad para descomprimir el paquete comprimido de la aplicación.
- **`shasum` o `sha256sum`:** Herramienta para verificar la integridad criptográfica SHA-256 de los archivos descargados.
- **Node.js compatible instalado:** Se requiere Node.js versión `>=22.19.0`.
- **Conexión a Internet:** Para conectarse a GitHub y descargar el release y sus componentes.
- **Una o más CLIs de IA instaladas y autenticadas:** Aquellas que desees utilizar en el selector de chat de Shell (por ejemplo, Claude Code o OpenAI Codex).

---

## Lo que aún no está disponible

Para mantener absoluta transparencia técnica y evitar expectativas incorrectas, ten presentes las delimitaciones del producto:

- **Windows no está soportado todavía:** No existe instalador para Windows PowerShell (`install.ps1`). El soporte actual está restringido a macOS y Linux con Bash.
- **Sin dominio propio ni instalador en `forge614.dev`:** No se descargan binarios desde un dominio web propio; la distribución utiliza directamente los servidores públicos de GitHub Releases.
- **Sin paquete en npm:** No existe un comando tipo `npm install -g forge614-shell`.
- **Sin comando `/update` dentro del chat interactivo:** La actualización no es un comando slash del chat, sino un subcomando de terminal ejecutado fuera de la sesión activa: `forge614-shell update`.
- **Sin actualizaciones automáticas en segundo plano:** Forge614 Shell nunca busca ni instala actualizaciones por su cuenta sin que tú lo ordenes explícitamente.
- **Sin restricciones privadas:** El repositorio es público; cualquier persona con macOS o Linux y Node.js compatible puede instalarlo sin requerir invitaciones previas de colaborador.
- **Engines no se gestiona ni ejecuta manualmente:** Forge614 Engines es una dependencia interna no interactiva. Se instala y actualiza automáticamente a través de Shell. No se añade a la variable `PATH` ni está pensado para ser invocado a mano por el usuario.
- **Uso opcional de Shell para trabajo diario:** Forge614 Shell es la cabina visual para configuración, setup, confirmación de integraciones y chat unificado; sin embargo, no es obligatorio permanecer dentro de Shell para programar a diario. Tras completar el setup o inicialización en Shell, puedes cerrar Shell y trabajar directamente en tu entorno preferido (ADE Orca, Claude Code, OpenAI Codex, etc.). Shell no sustituye a esos clientes.

---

## Primera instalación (Flujo público con un solo comando)

Para instalar Forge614 Shell por primera vez en tu computadora, el **único comando** que debes ejecutar en tu Terminal es:

```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```

> [!IMPORTANT]
> **Un único comando para todo el entorno:** No debes ejecutar ningún comando secundario para instalar Forge614 Engines. El instalador de Shell detecta, descarga y valida Engines de forma desatendida y automática.

### ¿Qué hace este comando automáticamente?
El script instalador resuelve todo el proceso técnico por ti de forma transparente:

1. **Consulta GitHub Releases:** Se conecta a la API pública de GitHub para identificar la versión estable más reciente (`releases/latest`).
2. **Descarga el paquete y su suma:** Descarga automáticamente el archivo comprimido (`forge614-shell-<version>.tar.gz`) y su firma criptográfica (`.sha256`).
3. **Verifica la integridad con SHA-256:** Antes de descomprimir nada, calcula la huella matemática del archivo descargado con `shasum` o `sha256sum`. Si la suma no coincide exactamente con el valor oficial, aborta inmediatamente para proteger tu computadora.
4. **Bootstrap y validación automática de Forge614 Engines:**
   - Revisa si ya existe el ejecutable interno `~/.forge614/engines/bin/forge614-engines`.
   - Ejecuta `forge614-engines detect` para comprobar que cumpla con `schemaVersion: 1`.
   - Si ya existe y es compatible, lo reutiliza directamente sin descargarlo nuevamente.
   - Si Engines falta o no es compatible, descarga y ejecuta automáticamente el instalador oficial de Forge614 Engines (`v1.0.0`) dentro de `~/.forge614/engines/`.
   - **Garantía atómica:** Si Engines no puede descargarse, instalarse o validarse, **Shell no se activa ni queda instalado a medias**.
5. **Instala Shell en `~/.forge614/shell/<version>`:** Desempaqueta la aplicación de forma aislada y crea el enlace simbólico activo en `~/.forge614/shell/bin/forge614-shell`.
6. **Configura automáticamente el `PATH` exclusivamente para Shell:** Detecta tu shell activo (`~/.zshrc` en macOS, `~/.bashrc` en Linux o `~/.profile` en otros entornos) e inyecta la línea `export PATH="$HOME/.forge614/shell/bin:$PATH"` de forma idempotente, migrando y limpiando cualquier entrada antigua obsoleta. **Engines nunca se agrega al PATH.**
7. **NO requiere herramientas de desarrollo:** No necesitas tener instalados Git, GitHub CLI (`gh`), Bun ni npm, ni requieres clonar el código fuente.
8. **NO requiere permisos de administrador:** No te pedirá contraseñas de sistema ni usará `sudo`; todo se instala dentro de tu carpeta de usuario.

---

## Flujo de ciclo de vida completo

El flujo de trabajo previsto entre Shell, Engines y tus herramientas habituales es el siguiente:

```text
Instalar Shell (con el comando curl único)
       ↓
Shell verifica Engines
(reutiliza Engines compatible v1.0.0 o lo instala automáticamente en ~/.forge614/engines/)
       ↓
Abre Shell (forge614-shell)
       ↓
Shell consulta el contrato público de Engines (~/.forge614/engines/bin/forge614-engines detect)
(Engines detecta clientes locales instalados bajo schemaVersion: 1)
       ↓
Selector "Choose your AI engine" muestra solo agentes detectados con adaptador de chat
(muestra Claude Code y Codex; Cursor se oculta por falta de adaptador; sin Antigravity)
       ↓
El usuario puede cerrar Shell y trabajar normalmente en ADE Orca, Claude Code o Codex
(las integraciones gestionadas quedan activas sin necesidad de mantener Shell abierto;
 Shell no sustituye a ADE Orca ni a las terminales nativas)
```

### Pasos al finalizar la instalación

Una vez que el comando termine y veas el mensaje de confirmación de instalación:

1. **Cierra completamente la aplicación Terminal** (en macOS presiona **Command + Q**; en Linux cierra la ventana de la terminal).
2. **Abre una nueva ventana de Terminal.**
3. **Inicia el programa ejecutando:**

```bash
forge614-shell
```

Para confirmar la versión instalada en cualquier momento, ejecuta:

```bash
forge614-shell --version
```

- **Resultado esperado de referencia:**
  ```text
  forge614-shell 1.0.2
  ```

---

## Actualización manual (`forge614-shell update`)

Cuando se publique una nueva versión estable en GitHub, puedes actualizar tu instalación con este comando en la Terminal:

```bash
forge614-shell update
```

### Comportamiento del comando de actualización:
- **Descarga e instalación de la última versión estable:** Consulta la API pública de GitHub, descarga los nuevos assets, valida Engines y repunta el enlace activo a la nueva versión.
- **Acción manual deliberada:** Nunca se ejecuta en segundo plano. La decisión de cuándo actualizar está siempre en tus manos.
- **Protección de la versión activa:** Si la descarga se interrumpe, el checksum falla, el paquete es inválido o Engines no puede validarse, **la versión de Shell que ya tenías instalada permanece intacta y activa**. Tu entorno nunca quedará roto.
- **Aviso si ya estás al día:** Si ya tienes activa la versión más reciente, el sistema te avisará con un mensaje claro:
  ```text
  Forge614 Shell v1.0.2 is already active.
  ```
  y no descargará archivos innecesarios.
- **Reinicio requerido:** Después de actualizar, debes salir de la sesión actual de Forge614 Shell (escribiendo `/quit`) y abrirla nuevamente para comenzar a utilizar la nueva versión.

---

## Autenticación previa obligatoria de las herramientas de IA

> [!IMPORTANT]
> **Forge614 Shell utiliza tus propias sesiones de IA instaladas:**
> Forge614 Shell es una cabina de mando unificada para programar con IA en la terminal, pero **no incluye cuentas de IA, suscripciones pagadas ni claves API empaquetadas**.
>
> Solo puede interactuar con las herramientas de IA que **tú ya tengas instaladas y autenticadas previamente en tu propia computadora**:
> - **Para Claude Code:** Debes tener instalada la herramienta CLI oficial de Claude Code (`claude`) y haber iniciado sesión previamente en tu máquina (`claude login` o autenticación web en Anthropic) con una suscripción activa (Claude Pro o Claude Max).
> - **Para OpenAI Codex:** Debes tener instalada la CLI de Codex e iniciar sesión con tu cuenta de ChatGPT / OpenAI.
>
> **Nota sobre el selector de arranque:** El selector "Choose your AI engine" muestra únicamente los agentes reportados por Forge614 Engines (`forge614-engines detect`) para los cuales Shell ya dispone de un adaptador de chat interactivo (Claude Code y Codex). Si Engines detecta Cursor, este no aparecerá aún en el selector pues su adaptador de chat está en desarrollo. Antigravity CLI ya no figura en este selector inicial al pertenecer a la detección local en PATH histórica. Si seleccionas un motor de IA que no está autenticado o cuya sesión expiró, Forge614 Shell te informará amablemente en pantalla que debes iniciar sesión con ese proveedor antes de enviar mensajes.

---

## Estructura creada en tu disco (`~/.forge614/`)

Una vez completada la instalación, los archivos quedan organizados bajo tu directorio personal con estricta separación de responsabilidades:

```text
~/.forge614/
├─ shell/
│  ├─ bin/
│  │  └─ forge614-shell -> ~/.forge614/shell/<version>/dist/cli.js   # Enlace activo (ÚNICO en PATH)
│  └─ <version>/                                                    # Directorio versionado de Shell
│     ├── dist/
│     │   └── cli.js                                                # Runtime empaquetado Node.js
│     ├── extensions/                                               # Extensiones de entorno
│     └── package.json                                              # Metadatos del release
└─ engines/
   └─ bin/
      └─ forge614-engines                                           # Binario interno de Engines (NO en PATH)
```

> [!IMPORTANT]
> **Aislamiento estricto del PATH:**
> - Solo el directorio `~/.forge614/shell/bin` se añade a la variable `PATH` de tu sistema.
> - El directorio `~/.forge614/engines/bin` **no se añade al PATH**, ya que `forge614-engines` es una herramienta auxiliar interna para inspección de capacidades, consumida de forma programática por Shell.

Cuando actualices a una futura versión con `forge614-shell update`, se creará una carpeta paralela en `shell/<nueva-version>/` y el enlace activo `shell/bin/forge614-shell` se repuntará a ella de forma atómica y segura.

---

## Mensajes de ayuda y resolución de errores

El instalador y el comando de actualización incorporan diagnósticos claros para asistirte ante cualquier inconveniente:

### 1. Node.js ausente o demasiado antiguo
- **Mensaje de error:**
  ```text
  Forge614 Shell requires Node.js 22.19 or newer.
  ```
  o bien `node: command not found`.
- **Causa:** No tienes Node.js instalado o tu versión es inferior a la requerida (por ejemplo v18 o v20).
- **Solución:** Entra a [nodejs.org](https://nodejs.org), descarga el instalador oficial más reciente (LTS o Current) para macOS o Linux, instálalo, cierra la Terminal, vuelve a abrirla y repite el comando de instalación.

### 2. Sin conexión a internet
- **Mensaje de error:**
  ```text
  Could not download Forge614 Shell release metadata.
  ```
- **Causa:** La computadora no pudo conectarse a GitHub debido a un fallo de red o falta de internet.
- **Solución:** Verifica tu conexión a internet o tu configuración de proxy/VPN y vuelve a ejecutar el comando.

### 3. Release público inexistente o problema de red en GitHub
- **Mensaje de error:**
  ```text
  Could not download Forge614 Shell release metadata.
  ```
- **Causa:** La API de GitHub no responde o no existe un release estable marcado como Latest en el repositorio.
- **Solución:** Comprueba en tu navegador que la página pública de releases en `https://github.com/jotredev/forge614-shell/releases` esté disponible.

### 4. Assets requeridos ausentes en el release
- **Mensaje de error:**
  ```text
  Latest release is missing valid Forge614 Shell assets.
  ```
- **Causa:** El release publicado en GitHub no contiene los tres archivos indispensables (`.tar.gz`, `.sha256` e `install.sh`).
- **Solución:** El mantenedor debe asegurarse de subir los tres assets al release público antes de que los usuarios puedan instalarlo.

### 5. Checksum inválido o descarga corrupta
- **Mensaje de error:**
  ```text
  Forge614 Shell download checksum failed.
  ```
- **Causa:** El archivo comprimido se descargó de forma incompleta o sus bytes se alteraron durante la transferencia.
- **Solución:** El instalador aborta sin tocar tu sistema. Vuelve a ejecutar el comando para realizar una nueva descarga limpia.

### 6. Problemas al descargar o instalar Forge614 Engines
- **Mensaje de error:**
  ```text
  Could not download the Forge614 Engines installer.
  ```
  o bien `Forge614 Engines installation failed; Forge614 Shell was not changed.`.
- **Causa:** Falló la conexión con GitHub al intentar descargar el instalador oficial de Engines, o la instalación de Engines abortó. Shell no se activó para evitar dejar tu sistema inconsistente.
- **Solución:** Comprueba tu conexión a internet y vuelve a ejecutar el comando de instalación de Shell. Shell reintentará descargar Engines.

### 7. Forge614 Engines ausente al iniciar Shell (Sin Fallback Local)
- **Mensaje de error al ejecutar `forge614-shell`:**
  ```text
  Forge614-Shell could not start: Forge614 Engines is unavailable. Reinstall Forge614 Shell to repair its required dependency.
  ```
- **Causa:** El binario interno `~/.forge614/engines/bin/forge614-engines` fue eliminado, movido o no cuenta con permisos de ejecución.
- **Comportamiento arquitectónico:** **Forge614 Shell no realiza fallback a detección local en `PATH`**. No intenta adivinar qué CLIs están instaladas ni inventa una lista interna.
- **Solución:** Repara la instalación ejecutando nuevamente el instalador oficial de Shell:
  ```bash
  curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
  ```
  El instalador reinstalará y verificará automáticamente la versión correcta de Engines.

### 8. Forge614 Engines incompatible o salida corrupta al iniciar Shell
- **Mensajes de error al ejecutar `forge614-shell`:**
  ```text
  Forge614-Shell could not start: Forge614 Engines is incompatible with this Shell version. Reinstall Forge614 Shell to repair its required dependency.
  ```
  o bien:
  ```text
  Forge614-Shell could not start: Forge614 Engines returned an invalid detection result.
  ```
- **Causa:** La versión instalada de Engines responde con una versión de contrato diferente a `schemaVersion: 1` o el JSON emitido está malformado.
- **Comportamiento arquitectónico:** Shell rechaza tajantemente contratos incompatibles y se detiene de forma segura sin intentar una detección local alternativa.
- **Solución:** Reinstala Forge614 Shell con el comando curl oficial para restaurar la versión compatible de Engines.

### 9. Reutilización de Forge614 Engines ya existente
- **Mensaje informativo durante la instalación/actualización:**
  ```text
  Using compatible Forge614 Engines (schema v1).
  ```
- **Explicación:** Shell detectó que tu sistema ya cuenta con una versión compatible de Engines en `~/.forge614/engines/`. No requiere descargas adicionales ni acción por tu parte.

### 10. El usuario intenta ejecutar `forge614-engines` manualmente
- **Síntoma:** Al escribir `forge614-engines` en la terminal, el sistema responde:
  ```text
  forge614-engines: command not found
  ```
- **Causa y explicación:** `forge614-engines` es un componente de soporte interno no interactivo para el ecosistema Forge614. No cuenta con interfaz de usuario (TUI) ni se añade a la variable `PATH` del usuario (el único comando en `PATH` es `forge614-shell`). Solo debe ser invocado internamente por Shell y otros componentes autorizados. No intentes ejecutarlo ni configurarlo por separado; todo su ciclo de vida lo gestiona `forge614-shell`.

### 11. Libertad de trabajo en ADE Orca y clientes nativos
- **Aclaración de diseño:** Forge614 Shell no reemplaza a ADE Orca, Claude Code, OpenAI Codex ni a tu terminal habitual.
- **Flujo:** Puedes utilizar Shell para la configuración inicial, verificación de agentes y confirmación de integraciones. Una vez concluido, eres libre de cerrar Shell y programar directamente desde Orca o la terminal de tu preferencia. Las sesiones y perfiles compartidos permanecen operativos en tus herramientas habituales.

### 12. Sistema operativo no soportado
- **Mensaje de error:**
  ```text
  Forge614 Shell supports macOS and Linux only.
  ```
- **Causa:** Se intentó ejecutar el script en Windows u otro sistema operativo no compatible.
- **Solución:** Utiliza una computadora con macOS o una distribución de Linux compatible.

### 13. El comando dice `forge614-shell: command not found` tras instalar
- **Causa:** Sigues escribiendo en la misma ventana de Terminal donde se ejecutó el instalador y tu shell aún no ha leído el archivo de perfil actualizado (`~/.forge614/shell/bin`).
- **Solución:** Cierra esa ventana de Terminal por completo (**Command + Q** en macOS) y abre una nueva ventana. Escribe directamente `forge614-shell`.

---

## Prueba local de empaquetado (Para desarrolladores)

> [!NOTE]
> Esta sección es **exclusiva para mantenedores o desarrolladores** que clonaron el repositorio fuente y desean generar el paquete desde cero o probarlo en una carpeta aislada antes de publicar un release. Los usuarios finales no necesitan realizar esto.

1. **Generar el bundle localmente:**
   ```bash
   bun run bundle:release
   ```
   Produce `dist/release/forge614-shell-1.0.4.tar.gz` (o la versión correspondiente) y su archivo `.sha256`.
2. **Probar la instalación por archivo en una ruta temporal aislada:**
   ```bash
   FORGE614_HOME="$HOME/.forge614-test" bash scripts/install.sh --archive "$PWD/dist/release/forge614-shell-1.0.4.tar.gz"
   ```
3. **Verificar la versión instalada en la prueba:**
   ```bash
   ~/.forge614-test/shell/bin/forge614-shell --version
   ```
4. **Limpieza del entorno de prueba:**
   ```bash
   rm -rf ~/.forge614-test
   ```

Para más detalles sobre la arquitectura del empaquetado y el flujo de publicación para mantenedores, consulta:
👉 [06 — Preparación de releases e instalador público](06-preparacion-release-1.0.0-instalador.md)
