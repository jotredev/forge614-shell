# 00 — Instalación y prueba local del release

2026-09-18 · Etapa 02: guía para colaboradores en macOS y Linux · Revisión: 4 · [English](../en/00-installation-and-local-release-test.md) · [Índice](../../README.md) · [Detalles técnicos del bundle](06-preparacion-release-1.0.0-instalador.md)

Esta guía explica, con el máximo nivel de detalle y paso a paso para personas **sin experiencia técnica previa**, el flujo definitivo de instalación de **Forge614 Shell** para colaboradores autorizados de un repositorio privado en **macOS o Linux**, utilizando como versión de referencia el release **`1.0.1`** (`Forge614 Shell v1.0.1`).

---

## Requisitos

Antes de comenzar, asegúrate de contar con los siguientes elementos:

- **macOS o Linux:** Sistema operativo compatible (los comandos son idénticos en ambos; en macOS se usa la app Terminal habitual y en Linux cualquier emulador de terminal estándar).
- **Terminal:** La aplicación de línea de comandos preinstalada en tu sistema.
- **Bash:** El intérprete de comandos estándar en macOS y Linux.
- **Node.js compatible instalado:** Se requiere Node.js versión `>=22.19.0`.
- **Cuenta GitHub con acceso aceptado al repositorio privado:** Tu usuario de GitHub debe haber recibido y aceptado la invitación como colaborador del repositorio privado de Forge614 Shell.
- **Acceso a internet:** Conexión para iniciar sesión en GitHub y descargar los archivos adjuntos (*Assets*) del release.
- **Una o más CLIs de IA instaladas y autenticadas:** Según las IAs que desees utilizar (por ejemplo, Claude Code, OpenAI Codex, Google Gemini CLI o Antigravity CLI).

---

## Lo que aún no pueden hacer los colaboradores

Para mantener absoluta claridad y evitar falsas expectativas, ten presentes las limitaciones del estado actual de distribución:

- **Personas sin acceso al repositorio no pueden descargar ni instalar:** Como el repositorio es estrictamente privado, nadie externo ni sin invitación aceptada puede ver el código ni descargar los paquetes.
- **Windows no está soportado todavía:** No existe instalador para Windows PowerShell (`install.ps1`); el soporte actual está limitado a macOS y Linux con Bash.
- **No hay instalador público:** No existen descargas en páginas web abiertas ni en el dominio `forge614.dev`.
- **No hay actualización automática:** El programa no se actualiza solo en segundo plano ni existe el comando `/update` dentro del chat.
- **No hay instalación mediante npm ni curl:** No existen comandos como `npm install -g forge614-shell` ni tuberías remotas del tipo `curl -fsSL ... | bash`.

---

## Flujo definitivo de instalación para colaboradores autorizados

Sigue estos 15 pasos en orden. No necesitas tener conocimientos avanzados ni experiencia previa en programación.

### Paso 1: Aceptar el acceso al repositorio privado
Asegúrate de que tu cuenta de GitHub ha sido invitada como colaboradora al repositorio privado de Forge614 Shell y que has hecho clic en el botón de **Aceptar invitación** (*Accept invitation*) desde el correo electrónico recibido o desde las notificaciones de GitHub.

### Paso 2: Iniciar sesión en GitHub
Abre tu navegador web preferido (Safari, Chrome, Firefox, etc.) e inicia sesión en [github.com](https://github.com) con la misma cuenta que tiene el acceso aceptado.

### Paso 3: Abrir el repositorio privado y entrar a Releases
1. En la barra de direcciones de tu navegador, entra al enlace del repositorio privado del proyecto:
   `https://github.com/<organización-o-usuario>/forge614-shell`
2. En la columna derecha de la página principal del repositorio, busca y haz clic en la sección llamada **Releases** (o entra directamente a la ruta `/releases`).

### Paso 4: Abrir el release publicado más reciente
Localiza el release publicado más reciente, cuyo título visible es:
```text
Forge614 Shell v1.0.1
```
*(Asociado al tag numérico de Git `1.0.1`). Haz clic sobre su título para entrar a la página del release.*

### Paso 5: Descargar exactamente los tres Assets
En la parte inferior de la página del release, busca la sección desplegable **Assets**. Haz clic para descargar en tu computadora exactamente estos **3 archivos**:

1. `forge614-shell-1.0.1.tar.gz`: El paquete comprimido con la aplicación compilada.
2. `forge614-shell-1.0.1.tar.gz.sha256`: El archivo con la firma criptográfica para verificar que la descarga no se dañó.
3. `install.sh`: El script que automatiza la instalación en tu computadora.

> [!NOTE]
> Guarda los tres archivos en tu carpeta habitual de **Descargas** (`Downloads`). Ignora los enlaces adicionales llamados *Source code (zip)* y *Source code (tar.gz)*; esos archivos contienen código de desarrollo que no necesitas.

### Paso 6: Abrir la Terminal
- **En macOS:** Presiona simultáneamente las teclas **Command (⌘)** y la **Barra espaciadora** para abrir la búsqueda de Spotlight. Escribe `Terminal` y presiona la tecla **Enter**. Se abrirá una ventana donde podrás escribir comandos.
- **En Linux:** Abre la aplicación **Terminal** desde tu menú de aplicaciones o presiona las teclas **Ctrl + Alt + T**.

### Paso 7: Comprobar que Node.js esté instalado
Forge614 Shell necesita Node.js para ejecutarse. En la ventana de Terminal, escribe o pega el siguiente comando y presiona **Enter**:

```bash
node --version
```

- **¿Qué significa una respuesta correcta?**
  Verás un texto que empieza con la letra `v` seguido de tres números separados por puntos, por ejemplo:
  `v22.19.0`, `v22.19.1` o `v23.x`.
  Si el número es igual o mayor a `v22.19.0`, tu sistema está listo.
- **¿Qué hacer si aparece `command not found` o una versión menor?**
  - Si la terminal responde `command not found`, significa que Node.js no está instalado en tu equipo.
  - Si muestra una versión inferior a 22.19.0 (por ejemplo `v18.x` o `v20.x`), tu versión es demasiado antigua.
  - **Acción requerida:** Detén el proceso antes de continuar. Entra a [nodejs.org](https://nodejs.org), descarga el instalador oficial recomendado para tu sistema operativo e instálalo. Una vez instalado, cierra la Terminal, vuelve a abrirla y repite `node --version` hasta obtener una versión compatible.

### Paso 8: Entrar a la carpeta de Descargas
En la Terminal, escribe el siguiente comando y presiona **Enter**:

```bash
cd ~/Downloads
```

*(El comando `cd` significa "change directory" o cambiar de directorio, y `~/Downloads` te sitúa dentro de tu carpeta de Descargas, donde guardaste los tres archivos descargados).*

### Paso 9: Listar los archivos para confirmar su presencia
Escribe el siguiente comando y presiona **Enter**:

```bash
ls
```

Revisa la lista que aparece en pantalla. Debes confirmar visualmente que los tres archivos se encuentran allí:
- `forge614-shell-1.0.1.tar.gz`
- `forge614-shell-1.0.1.tar.gz.sha256`
- `install.sh`

### Paso 10: Verificar la integridad criptográfica del paquete
Antes de instalar, comprobaremos que el archivo comprimido se descargó de manera 100% íntegra y que ningún byte quedó truncado o dañado. Ejecuta este comando en la Terminal:

```bash
shasum -a 256 -c forge614-shell-1.0.1.tar.gz.sha256
```

- **Resultado correcto y esperado:**
  ```text
  forge614-shell-1.0.1.tar.gz: OK
  ```
- **¿Qué significa?** La computadora calculó la huella matemática del archivo y confirmó que coincide exactamente con la firma oficial emitida por el equipo de desarrollo.
- Si en lugar de `OK` respondiera `FAILED` o arrojara un error, el archivo se descargó corrupto. Bórralo de tu carpeta Descargas, vuelve a descargarlo desde GitHub Releases y repite el comando.

### Paso 11: Ejecutar el instalador
Una vez verificada la integridad, ejecuta el script de instalación indicándole el paquete:

```bash
bash install.sh --archive forge614-shell-1.0.1.tar.gz
```

Presiona **Enter**. El instalador trabajará durante unos segundos y mostrará en pantalla una confirmación como esta:

```text
Installed Forge614 Shell v1.0.1
Configured /Users/<tu-usuario>/.zshrc so forge614-shell is available in new Terminal windows.
Close and reopen Terminal, then run: forge614-shell
```

### Paso 12: Qué hizo el instalador automáticamente (y lo que NO necesitas hacer)
El instalador automatizado de Forge614 Shell resolvió toda la configuración técnica por ti:

- **Instala en `~/.forge614`:** Desempaqueta la versión en una carpeta aislada y segura en tu usuario (`~/.forge614/shell/1.0.1/`) y crea el enlace ejecutable en `~/.forge614/bin/forge614-shell`.
- **Configura automáticamente el comando `forge614-shell`:** Detecta el perfil de tu terminal (`~/.zshrc` en macOS o `~/.bashrc` en Linux) e inyecta la variable `PATH` de forma idempotente (sin duplicar líneas si lo reinstalas en el futuro).
- **NO requiere Git:** No necesitas tener Git instalado en tu computadora.
- **NO requiere GitHub CLI (`gh`):** No necesitas herramientas especiales de línea de comandos de GitHub.
- **NO requiere Bun:** La aplicación ya viene precompilada y optimizada para ejecutarse con Node.js puro.
- **NO requiere clonar el repositorio:** No tienes que descargar gigabytes de código fuente ni lidiar con ramas.
- **NO requiere editar PATH ni copiar `export PATH=...`:** El script lo hizo por ti de forma permanente; no debes escribir comandos manuales de variables de entorno ni modificar archivos ocultos a mano.

### Paso 13: Cerrar Terminal por completo, abrir una ventana nueva y verificar
Las ventanas de terminal abiertas no pueden recargar cambios de entorno aplicados por programas externos. Por lo tanto:

1. **Cierra completamente la ventana de Terminal actual** (en macOS presiona **Command + Q** para salir de la aplicación; en Linux cierra la ventana).
2. **Abre una nueva ventana de Terminal.**
3. Verifica que el comando esté activo escribiendo:

```bash
forge614-shell --version
```

- **Resultado esperado:**
  ```text
  forge614-shell 1.0.1
  ```

### Paso 14: Iniciar Forge614 Shell
Para arrancar el entorno, escribe en la Terminal y presiona **Enter**:

```bash
forge614-shell
```

- Verás la pantalla interactiva de Forge614 Shell solicitando seleccionar la interfaz visual (elige **Basic**) y luego tu motor de IA preferido.
- **Observa el extremo derecho de la barra de estado inferior:** verás fija y clara la etiqueta de versión:
  ```text
  v1.0.1
  ```
- Para salir del programa en cualquier momento, escribe `/quit` y presiona **Enter**, o pulsa **Control + C**.

### Paso 15: Autenticación previa obligatoria de las herramientas de IA
> [!IMPORTANT]
> **Forge614 Shell utiliza tus propias sesiones de IA instaladas:**
> Forge614 Shell es una cabina de mando unificada para programar con IA, pero **no incluye cuentas de IA, suscripciones ni claves secretas preconfiguradas**.
>
> Solo puede interactuar con las herramientas de IA que **tú ya tengas instaladas y autenticadas previamente en tu propia computadora**:
> - **Para Claude Code:** Debes tener instalada la herramienta CLI oficial de Claude Code (`claude`) y haber iniciado sesión previamente en tu computadora (`claude login` o autenticación web en Anthropic) con una suscripción activa (Claude Pro o Claude Max).
> - **Para OpenAI Codex:** Debes tener instalada la CLI de Codex e iniciar sesión con tu cuenta de ChatGPT / OpenAI.
> - **Para Google Gemini CLI / Antigravity CLI:** Debes haber completado el flujo de autenticación de Google en tu terminal.
>
> Si seleccionas un motor de IA que no está instalado en tu máquina o cuya sesión expiró, Forge614 Shell te informará amablemente en pantalla que debes iniciar sesión con ese proveedor antes de enviar mensajes.

---

## Configuración automática del PATH (Sin pasos manuales)

A diferencia de guías técnicas tradicionales que exigen al usuario editar archivos de inicio del sistema, en Forge614 Shell **no debes ejecutar ningún comando manual de exportación de PATH ni editar archivos a mano**:

1. **Detección inteligente de shell:**
   - En macOS, el instalador detecta `zsh` y modifica automáticamente `~/.zshrc`.
   - En Linux, detecta `bash` y modifica automáticamente `~/.bashrc`.
   - En otros sistemas compatibles con Unix, modifica `~/.profile`.
2. **Salvaguarda idempotente:**
   Antes de añadir la línea:
   ```bash
   # Forge614 Shell
   export PATH="$HOME/.forge614/bin:$PATH"
   ```
   El instalador comprueba con `grep` si la instrucción ya existe. Si ya está presente, no añade líneas duplicadas, manteniendo tus archivos de configuración limpios.
3. **Paso indispensable del usuario:**
   Únicamente cerrar la Terminal por completo y abrir una ventana nueva para que el sistema lea la configuración actualizada.

---

## Solución de problemas comunes

### 1. `node: command not found` o versión menor a `22.19.0`
- **Causa:** Node.js no está instalado o tienes instalada una versión antigua.
- **Solución:** Entra a [nodejs.org](https://nodejs.org), descarga el paquete oficial LTS o Current e instálalo. Reinicia la Terminal antes de continuar.

### 2. `shasum: forge614-shell-1.0.1.tar.gz: FAILED`
- **Causa:** El archivo se descargó de forma incompleta o se corrompió en el navegador.
- **Solución:** Ve a la carpeta `~/Downloads`, elimina el archivo `forge614-shell-1.0.1.tar.gz`, vuelve a descargarlo desde la página de Releases en GitHub y repite el comando `shasum -a 256 -c forge614-shell-1.0.1.tar.gz.sha256`.

### 3. `forge614-shell: command not found` tras completar la instalación
- **Causa:** Sigues escribiendo en la misma ventana de Terminal donde ejecutaste el instalador, por lo que los cambios en el archivo de configuración aún no surten efecto.
- **Solución:** Cierra esa ventana de Terminal por completo (**Command + Q** en macOS) y abre una nueva ventana. Escribe de nuevo `forge614-shell`.

### 4. `Release archive not found: ...`
- **Causa:** La Terminal no se encuentra dentro de la carpeta donde se descargaron los archivos.
- **Solución:** Ejecuta `cd ~/Downloads` y luego `ls` para verificar que estás en la carpeta correcta y que los archivos están presentes.

### 5. `Permission denied` al intentar ejecutar `install.sh`
- **Causa:** Intentaste ejecutar `./install.sh` directamente sin concederle permisos ejecutables.
- **Solución:** Ejecútalo siempre anteponiendo la palabra `bash`:
  ```bash
  bash install.sh --archive forge614-shell-1.0.1.tar.gz
  ```

### 6. Al iniciar Claude Code o Codex aparece error de autenticación
- **Causa:** No has iniciado sesión previamente en la herramienta de IA correspondiente en tu computadora.
- **Solución:** Abre otra ventana de terminal y ejecuta el inicio de sesión nativo del proveedor (por ejemplo `claude login` para Claude Code). Una vez autenticado, regresa a Forge614 Shell.

---

## Estructura creada en tu disco (`~/.forge614/`)

Una vez instalado, los archivos quedan ordenados bajo tu carpeta de usuario de la siguiente manera:

```text
~/.forge614/
├── bin/
│   └── forge614-shell -> ~/.forge614/shell/1.0.1/dist/cli.js   # Acceso directo ejecutable
└── shell/
    └── 1.0.1/                                                 # Versión 1.0.1 aislada
        ├── dist/
        │   └── cli.js                                         # Aplicación Node.js empaquetada
        ├── extensions/                                        # Extensiones de entorno
        └── package.json                                       # Metadatos del release 1.0.1
```

---

## Prueba local para desarrolladores (Empaquetado desde el código fuente)

> [!NOTE]
> Esta sección es **exclusiva para mantenedores o desarrolladores** que clonaron el repositorio completo y desean generar el paquete desde cero o probarlo en una carpeta aislada antes de publicar un release. Los colaboradores no necesitan realizar esto.

1. **Empaquetar la versión:**
   ```bash
   bun run bundle:release
   ```
   Genera `dist/release/forge614-shell-1.0.1.tar.gz` y `dist/release/forge614-shell-1.0.1.tar.gz.sha256`.
2. **Probar en una ruta temporal aislada (`~/.forge614-test`):**
   ```bash
   FORGE614_HOME="$HOME/.forge614-test" bash scripts/install.sh --archive "$PWD/dist/release/forge614-shell-1.0.1.tar.gz"
   ```
3. **Verificar versión:**
   ```bash
   ~/.forge614-test/bin/forge614-shell --version
   # Salida esperada: forge614-shell 1.0.1
   ```
4. **Limpieza del entorno de prueba:**
   ```bash
   rm -rf ~/.forge614-test
   ```

Para más detalles sobre la arquitectura del instalador y el flujo de publicación para mantenedores en GitHub Releases, consulta:
👉 [06 — Preparación del release 1.0.0 e instalador](06-preparacion-release-1.0.0-instalador.md)
