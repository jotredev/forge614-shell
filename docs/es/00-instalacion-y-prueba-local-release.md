# 00 — Instalación y actualización pública del release

2026-09-18 · Etapa 02: instalación y actualización pública en macOS y Linux · Revisión: 5 · [English](../en/00-installation-and-local-release-test.md) · [Índice](../../README.md) · [Detalles técnicos del bundle](06-preparacion-release-1.0.0-instalador.md)

Esta guía explica, con el máximo nivel de detalle y paso a paso para personas **sin experiencia técnica previa**, el flujo público definitivo de instalación y actualización de **Forge614 Shell** en **macOS o Linux**, utilizando como versión de referencia estable el release **`1.0.2`** (`Forge614 Shell v1.0.2`).

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
- **Una o más CLIs de IA instaladas y autenticadas:** Según las IAs que desees utilizar (por ejemplo, Claude Code, OpenAI Codex, Google Gemini CLI o Antigravity CLI).

---

## Lo que aún no está disponible

Para mantener absoluta transparencia técnica y evitar expectativas incorrectas, ten presentes las delimitaciones del producto:

- **Windows no está soportado todavía:** No existe instalador para Windows PowerShell (`install.ps1`). El soporte actual está restringido a macOS y Linux con Bash.
- **Sin dominio propio ni instalador en `forge614.dev`:** No se descargan binarios desde un dominio web propio; la distribución utiliza directamente los servidores públicos de GitHub Releases.
- **Sin paquete en npm:** No existe un comando tipo `npm install -g forge614-shell`.
- **Sin comando `/update` dentro del chat interactivo:** La actualización no es un comando slash del chat, sino un subcomando de terminal ejecutado fuera de la sesión activa: `forge614-shell update`.
- **Sin actualizaciones automáticas en segundo plano:** Forge614 Shell nunca busca ni instala actualizaciones por su cuenta sin que tú lo ordenes explícitamente.
- **Sin restricciones privadas:** El repositorio es público; cualquier persona con macOS o Linux y Node.js compatible puede instalarlo sin requerir invitaciones previas de colaborador.

---

## Primera instalación (Flujo público con un solo comando)

Para instalar Forge614 Shell por primera vez en tu computadora, el **único comando** que debes ejecutar en tu Terminal es:

```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```

### ¿Qué hace este comando automáticamente?
El script instalador resuelve todo el proceso técnico por ti de forma transparente:

1. **Consulta GitHub Releases:** Se conecta a la API pública de GitHub para identificar la versión estable más reciente (`releases/latest`).
2. **Descarga el paquete y su suma:** Descarga automáticamente el archivo comprimido (`forge614-shell-<version>.tar.gz`) y su firma criptográfica (`.sha256`).
3. **Verifica la integridad con SHA-256:** Antes de descomprimir nada, calcula la huella matemática del archivo descargado con `shasum` o `sha256sum`. Si la suma no coincide exactamente con el valor oficial, aborta inmediatamente para proteger tu computadora.
4. **Instala en `~/.forge614`:** Desempaqueta la aplicación dentro de una carpeta propia en tu directorio personal (`~/.forge614/shell/<version>/`) y crea un enlace simbólico ejecutable en `~/.forge614/bin/forge614-shell`.
5. **Configura automáticamente el comando `forge614-shell`:** Detecta tu shell activo (`~/.zshrc` en macOS, `~/.bashrc` en Linux o `~/.profile` en otros entornos) y añade la ruta del programa al inicio de tu terminal de forma idempotente (nunca duplicará líneas si lo vuelves a ejecutar).
6. **NO requiere editar el `PATH` a mano:** No tienes que copiar instrucciones como `export PATH=...` ni tocar archivos de configuración ocultos.
7. **NO requiere herramientas de desarrollo:** No necesitas tener instalados Git, GitHub CLI (`gh`), Bun ni npm, ni requieres clonar el código fuente.
8. **NO requiere permisos de administrador:** No te pedirá contraseñas de sistema ni usará `sudo`; todo se instala dentro de tu carpeta de usuario.

### Pasos al finalizar la instalación

Una vez que el comando termine y veas el mensaje `Installed Forge614 Shell v1.0.2`:

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

- **Resultado esperado:**
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
- **Descarga e instalación de la última versión estable:** Consulta la API pública de GitHub, descarga los nuevos assets y repunta el enlace activo a la nueva versión.
- **Acción manual deliberada:** Nunca se ejecuta en segundo plano. La decisión de cuándo actualizar está siempre en tus manos.
- **Protección de la versión activa:** Si la descarga se interrumpe, el checksum falla o el paquete descargado es inválido, **la versión que ya tenías instalada permanece intacta y activa**. Tu entorno nunca quedará roto.
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
> - **Para Google Gemini CLI / Antigravity CLI:** Debes haber completado el flujo de autenticación de Google en tu terminal.
>
> Si seleccionas un motor de IA que no está instalado en tu máquina o cuya sesión expiró, Forge614 Shell te informará amablemente en pantalla que debes iniciar sesión con ese proveedor antes de enviar mensajes.

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

### 6. Sistema operativo no soportado
- **Mensaje de error:**
  ```text
  Forge614 Shell supports macOS and Linux only.
  ```
- **Causa:** Se intentó ejecutar el script en Windows u otro sistema operativo no compatible.
- **Solución:** Utiliza una computadora con macOS o una distribución de Linux compatible.

### 7. El comando dice `forge614-shell: command not found` tras instalar
- **Causa:** Sigues escribiendo en la misma ventana de Terminal donde se ejecutó el instalador y tu shell aún no ha leído el archivo de perfil actualizado.
- **Solución:** Cierra esa ventana de Terminal por completo (**Command + Q** en macOS) y abre una nueva ventana. Escribe directamente `forge614-shell`.

---

## Estructura creada en tu disco (`~/.forge614/`)

Una vez instalado, los archivos quedan organizados bajo tu carpeta de usuario de la siguiente manera:

```text
~/.forge614/
├── bin/
│   └── forge614-shell -> ~/.forge614/shell/1.0.2/dist/cli.js   # Enlace simbólico activo
└── shell/
    └── 1.0.2/                                                 # Directorio de la versión 1.0.2
        ├── dist/
        │   └── cli.js                                         # Aplicación Node.js empaquetada
        ├── extensions/                                        # Extensiones de entorno
        └── package.json                                       # Metadatos del release
```

Cuando actualices a una futura versión con `forge614-shell update`, se creará una carpeta paralela (por ejemplo `shell/1.0.3/`) y el enlace activo `bin/forge614-shell` se repuntará a ella de forma atómica y segura.

---

## Prueba local de empaquetado (Para desarrolladores)

> [!NOTE]
> Esta sección es **exclusiva para mantenedores o desarrolladores** que clonaron el repositorio fuente y desean generar el paquete desde cero o probarlo en una carpeta aislada antes de publicar un release. Los usuarios finales no necesitan realizar esto.

1. **Generar el bundle localmente:**
   ```bash
   bun run bundle:release
   ```
   Produce `dist/release/forge614-shell-1.0.2.tar.gz` y `dist/release/forge614-shell-1.0.2.tar.gz.sha256`.
2. **Probar la instalación por archivo en una ruta temporal aislada:**
   ```bash
   FORGE614_HOME="$HOME/.forge614-test" bash scripts/install.sh --archive "$PWD/dist/release/forge614-shell-1.0.2.tar.gz"
   ```
3. **Verificar la versión instalada en la prueba:**
   ```bash
   ~/.forge614-test/bin/forge614-shell --version
   # Salida esperada: forge614-shell 1.0.2
   ```
4. **Limpieza del entorno de prueba:**
   ```bash
   rm -rf ~/.forge614-test
   ```

Para más detalles sobre la arquitectura del empaquetado y el flujo de publicación para mantenedores, consulta:
👉 [06 — Preparación de releases e instalador público](06-preparacion-release-1.0.0-instalador.md)
