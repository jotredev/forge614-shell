# 00 — Instalación y prueba local del release

2026-09-18 · Etapa 02: guía paso a paso para principiantes en macOS y Linux · [English](../en/00-installation-and-local-release-test.md) · [Índice](../../README.md) · [Detalles técnicos del bundle](06-preparacion-release-1.0.0-instalador.md)

Esta guía explica, paso a paso y desde cero en **macOS o Linux**, cómo empaquetar Forge614 Shell y probar su instalador en una carpeta aislada de tu computadora, sin necesidad de conocimientos previos sobre terminales, repositorios o variables de entorno. Los comandos son iguales en ambos sistemas; macOS usa Spotlight para abrir Terminal y en Linux se abre la aplicación Terminal habitual.

> [!IMPORTANT]
> **Aviso de alcance:** Esta guía describe **únicamente la prueba local** del instalador en tu propia máquina. **NO es todavía el flujo de instalación para usuarios externos ni un flujo de descarga pública.** Actualmente no existen enlaces públicos de descarga ni comandos remotos.

---

## 1. Para qué sirve esta guía

Cuando un programador desarrolla una aplicación, el programa suele ejecutarse directamente dentro de la carpeta donde se escribió el código fuente. Sin embargo, un usuario final no debe necesitar esa carpeta de desarrollo para usar el programa.

Esta guía sirve para verificar una pregunta fundamental: **¿se puede instalar y ejecutar Forge614 Shell en otra parte de tu computadora como una aplicación independiente, sin depender de la carpeta del proyecto?**

Para realizar esta prueba:
- **No debes abrir Orca ni Forge614 Shell al inicio.**
- **Lo primero que debes abrir es la aplicación Terminal que viene incluida en tu Mac.**

---

## 2. Qué se prueba y qué no se prueba

Para evitar confusiones, es indispensable distinguir las tres etapas de distribución:

1. **Prueba local del instalador (Lo que hacemos hoy):** Creamos un paquete comprimido en tu máquina y comprobamos que el script instalador lo desempaque, configure automáticamente tu perfil de terminal y lo deje listo para ejecutarse en una carpeta de prueba. **Esta es la verificación técnica base.**
2. **Distribución privada mediante GitHub Release:** Los miembros del equipo invitados como colaboradores al repositorio privado pueden descargar el paquete (`.tar.gz`), su suma de verificación (`.sha256`) y el instalador (`install.sh`) directamente desde los Assets de la Release en GitHub, sin necesidad de tener el código fuente, Git, GitHub CLI ni Bun instalados.
3. **Instalación pública hospedada (En el futuro):** Cualquier persona podrá instalar el programa con un comando simple desde internet o desde una página web (`forge614.dev`). *(Aún no disponible).*

### Lo que NO existe todavía:
- No existe un comando remoto del tipo `curl ... | bash`.
- No existe instalador alojado en `forge614.dev`.
- No existe el comando `/update` dentro del chat.
- No existe paquete publicado en npm (`npm install -g forge614-shell` no existe).
- No existe instalador para Windows PowerShell (`install.ps1`). Windows no está soportado todavía.
- No existen actualizaciones automáticas en segundo plano.

---

## 3. Antes de comenzar

### 3.1 Cómo abrir la Terminal en macOS
1. En el teclado de tu Mac, presiona al mismo tiempo las teclas **Command (⌘)** y la **Barra espaciadora**. Se abrirá la barra de búsqueda de Spotlight en el centro de la pantalla.
2. Escribe la palabra: `Terminal`
3. Presiona la tecla **Enter**. Se abrirá una ventana blanca o negra con una línea de texto parpadeando: esa es tu línea de comandos.

### 3.2 Qué es un comando y cómo ejecutarlo
Un **comando** es una orden en texto que le das a tu computadora.
- Para usar los comandos de esta guía: selecciona el texto dentro de cada caja gris, cópialo (**Command + C**), haz clic en la ventana de Terminal y pégalo (**Command + V**).
- **Ejecuta un solo comando a la vez.**
- Tras pegar cada comando, presiona la tecla **Enter** para que la computadora lo procese.

### 3.3 Comprobar si tienes las herramientas necesarias
Antes de empaquetar, necesitamos confirmar que tu computadora tiene instalados **Node.js** y **Bun**:

Ejecuta el primer comando:
```bash
node --version
```

Ejecuta el segundo comando:
```bash
bun --version
```

- **Versión de Node.js:** Debes ver un número que comience en `v22.19.0` o superior (por ejemplo, `v22.19.1` o `v23.x`). Si tu versión es más antigua, detente y actualiza Node.js antes de continuar: la aplicación instalada necesita esa versión aunque el instalador actual solo comprueba que exista el comando `node`.
- **Si aparece `"command not found"`:**
  - Si falta Node.js: descárgalo e instálalo desde su página oficial: [nodejs.org](https://nodejs.org).
  - Si falta Bun: sigue las instrucciones oficiales en su página: [bun.sh](https://bun.sh).

---

## 4. Crear el archivo de release

Para probar el instalador, primero debemos generar el paquete comprimido de la versión `1.0.0`.

1. Ve a la carpeta donde tienes el proyecto. Si tu carpeta está en el Escritorio, ejecuta:
```bash
cd ~/Desktop/forge614-shell
```
*(Si tu carpeta está guardada en otra ruta, reemplaza `~/Desktop/forge614-shell` por la ubicación real donde se encuentra).*

2. Genera el archivo empaquetado ejecutando:
```bash
bun run bundle:release
```

### ¿Qué acaba de ocurrir?
- La herramienta empaquetó el código en un ejecutable autónomo y creó una carpeta llamada `dist/release/` dentro del proyecto.
- Si revisas esa carpeta, encontrarás dos archivos:
  - `forge614-shell-1.0.0.tar.gz`: Es la "caja comprimida" que contiene el programa empaquetado, su configuración y sus extensiones. No contiene la carpeta pesada `node_modules` de desarrollo, pero la computadora destino sigue necesitando Node.js. Este es el archivo que en el futuro se distribuirá.
  - `forge614-shell-1.0.0.tar.gz.sha256`: Es una suma de control SHA-256 para detectar corrupción accidental del archivo después de descargarlo.

---

## 5. Prueba segura en instalación aislada

Ahora simularemos la instalación como si fueras un usuario que recibe el paquete, pero usando una carpeta de prueba separada (`.forge614-test`) para garantizar que no se altere nada en tu sistema.

Ejecuta este comando exacto (todo en una sola línea):

```bash
FORGE614_HOME="$HOME/.forge614-test" bash scripts/install.sh --archive "$PWD/dist/release/forge614-shell-1.0.0.tar.gz"
```

### Explicación de cada parte del comando:
- `FORGE614_HOME="$HOME/.forge614-test"`: Le indica al instalador: *"Guarda todo dentro de una carpeta temporal llamada `.forge614-test` en mi usuario, en lugar de usar la carpeta normal"*.
- `bash`: Es el intérprete de macOS encargado de leer y ejecutar scripts de instalación.
- `scripts/install.sh`: Es el archivo de programa del instalador que realiza la descompresión y verificación.
- `--archive`: Es la instrucción que avisa que le pasaremos la ruta a un archivo `.tar.gz`.
- `"$PWD/dist/release/forge614-shell-1.0.0.tar.gz"`: Es la ubicación del paquete que creamos en el paso 4 (`$PWD` significa *"la carpeta en la que estoy parado ahora"*).

### Salida esperada en pantalla:
Si todo salió bien, la terminal mostrará un mensaje similar a este:
```text
Installed Forge614 Shell v1.0.0
Configured /Users/<tu-usuario>/.zshrc so forge614-shell is available in new Terminal windows.
Close and reopen Terminal, then run: forge614-shell
```

---

## 6. Verificar y arrancar

### 6.1 Comprobar la versión instalada
Pide al programa instalado que reporte su versión ejecutando:

```bash
~/.forge614-test/bin/forge614-shell --version
```

**Resultado exacto que debes ver:**
```text
forge614-shell 1.0.0
```

### 6.2 Arrancar la aplicación instalada
Ahora arranca la interfaz interactiva desde la copia aislada:

```bash
~/.forge614-test/bin/forge614-shell
```

### ¿Qué debes observar?
- Se abrirá la interfaz de terminal de Forge614 Shell solicitando seleccionar la interfaz visual y el motor.
- **Mira la esquina inferior derecha de la pantalla (el pie de página o footer debajo del chat):** verás la etiqueta clara:
  ```text
  v1.0.0
  ```
- Para salir del programa, escribe `/quit` y presiona **Enter**, o presiona **Control + C**.

**¿Qué demuestra esto?** Demuestra con certeza técnica que Forge614 Shell se desempaquetó, se instaló en un directorio independiente del sistema y puede ejecutarse sin depender de los archivos de desarrollo del proyecto.

---

### 7. Instalación normal y flujo para colaboradores

### 7.1 Instalación normal local (Opcional tras validar la prueba aislada)

> [!NOTE]
> Este paso es **opcional**. Solo debes realizarlo si la prueba aislada del paso 6 funcionó y deseas tener Forge614 Shell instalado en su ubicación predeterminada de usuario (`~/.forge614/`).

1. Borra la variable de prueba para volver a la ruta normal:
```bash
unset FORGE614_HOME
```

2. Asegúrate de estar en la carpeta del proyecto:
```bash
cd ~/Desktop/forge614-shell
```

3. Ejecuta el instalador normal:
```bash
bash scripts/install.sh --archive "$PWD/dist/release/forge614-shell-1.0.0.tar.gz"
```

El programa quedará instalado en `~/.forge614/bin/forge614-shell` y tu perfil de shell quedará configurado de forma automática.

### 7.2 Flujo real para colaboradores (Descarga directa desde GitHub Releases)

Si eres un colaborador invitado al repositorio privado que no tiene el código fuente del proyecto, Git, GitHub CLI ni Bun instalados, este es el procedimiento completo y directo:

1. **Descargar los tres archivos desde los Assets de GitHub Releases:**
   Inicia sesión en GitHub con tu cuenta autorizada, accede a la página de Releases del repositorio y en la sección **Assets** de la versión deseada (`v1.0.0` o `v1.0.1`), descarga estos **3 archivos** a tu carpeta de Descargas (`~/Downloads`):
   - `forge614-shell-1.0.0.tar.gz` (el paquete de la aplicación)
   - `forge614-shell-1.0.0.tar.gz.sha256` (la suma de comprobación criptográfica)
   - `install.sh` (el script instalador)

2. **Abrir Terminal y situarse en Descargas:**
   ```bash
   cd ~/Downloads
   ```

3. **Verificar la integridad del archivo descargado:**
   Comprueba que el archivo comprimido no se dañó ni quedó truncado en la descarga:
   ```bash
   shasum -a 256 -c forge614-shell-1.0.0.tar.gz.sha256
   ```
   **Resultado esperado en pantalla:**
   ```text
   forge614-shell-1.0.0.tar.gz: OK
   ```

4. **Ejecutar el instalador:**
   ```bash
   bash install.sh --archive ./forge614-shell-1.0.0.tar.gz
   ```

5. **Salida esperada:**
   El instalador descomprime el paquete en `~/.forge614/shell/1.0.0/`, crea el enlace activo `~/.forge614/bin/forge614-shell` y configura automáticamente tu perfil de terminal (`~/.zshrc` en macOS o `~/.bashrc` en Linux):
   ```text
   Installed Forge614 Shell v1.0.0
   Configured /Users/<tu-usuario>/.zshrc so forge614-shell is available in new Terminal windows.
   Close and reopen Terminal, then run: forge614-shell
   ```

6. **Arrancar:**
   **Cierra la ventana actual de Terminal**, abre una ventana nueva de Terminal y ejecuta simplemente:
   ```bash
   forge614-shell
   ```

---

## 8. Configuración automática del PATH (Sin pasos manuales)

### Cero comandos manuales de PATH
A diferencia de procesos manuales tradicionales, **el usuario NO debe copiar comandos de PATH, ni ejecutar `export PATH=...`, ni editar manualmente `.zshrc`, `.bashrc` o `.profile`.**

El instalador `install.sh` se encarga de todo el proceso de forma transparente:

1. **Detección del shell activo:**
   - En **macOS** (donde el shell por defecto es `zsh`), detecta y selecciona automáticamente `~/.zshrc`.
   - En **Linux** (donde el shell por defecto suele ser `bash`), selecciona automáticamente `~/.bashrc`.
   - En otros entornos compatibles con Unix, selecciona `~/.profile`.
2. **Inyección segura e idempotente:**
   Añade de forma limpia la configuración:
   ```bash
   # Forge614 Shell
   export PATH="$HOME/.forge614/bin:$PATH"
   ```
   Si ejecutas el instalador múltiples veces para reinstalar o actualizar, el script verifica previamente con `grep` si la línea ya existe y **evita duplicar entradas en tu archivo de configuración**.
3. **Paso final del usuario:**
   Como una ventana de terminal abierta no puede absorber cambios de entorno de un subproceso hijo, el único paso requerido tras la instalación es:
   - **Cierra la ventana de Terminal.**
   - **Abre una nueva ventana de Terminal.**
   - Escribe directamente:
     ```bash
     forge614-shell
     ```
   Para comprobar que el sistema lo reconoce y ver la versión:
   ```bash
   forge614-shell --version
   ```
   Salida esperada: `forge614-shell 1.0.0`.

---

## 9. Solución de problemas comunes

### 1. `cd: no such file or directory: ~/Desktop/forge614-shell`
- **Causa:** La carpeta del proyecto no está en el Escritorio o tiene otro nombre.
- **Solución:** Escribe `pwd` para ver en qué carpeta estás, o arrastra la carpeta del proyecto desde el Finder directamente a la ventana de Terminal después de escribir `cd `.

### 2. `bun: command not found`
- **Causa:** Bun no está instalado o no se agregó a las rutas conocidas de la terminal.
- **Solución:** Solo es necesario si estás empaquetando el código desde el repositorio (paso 4). Instálalo siguiendo las instrucciones de [bun.sh](https://bun.sh). Los colaboradores que descargan la release no necesitan Bun.

### 3. `node: command not found`
- **Causa:** Node.js no está instalado en la computadora.
- **Solución:** Descarga la versión recomendada (LTS o Current >= 22.19) desde [nodejs.org](https://nodejs.org).

### 4. `Forge614 Shell requires Node.js 22.19 or newer`
- **Causa:** Tienes una versión antigua de Node.js instalada en tu máquina.
- **Solución:** Entra a [nodejs.org](https://nodejs.org), descarga el instalador más reciente para tu sistema y actualiza Node.js.

### 5. `Release archive not found: ...`
- **Causa:** No ejecutaste el empaquetado antes de instalar, o el archivo descargado no se encuentra en la ruta indicada.
- **Solución:** Verifica que el archivo `forge614-shell-1.0.0.tar.gz` exista en la carpeta actual ejecutando `ls -la`.

### 6. `Permission denied`
- **Causa:** Intentaste ejecutar `./scripts/install.sh` directamente y el archivo no tenía permisos de ejecución directa.
- **Solución:** Ejecútalo siempre anteponiendo la palabra `bash`: `bash install.sh --archive ...`.

### 7. El comando dice `forge614-shell: command not found` tras instalar
- **Causa:** Sigues utilizando la misma ventana de Terminal donde se ejecutó el instalador y el nuevo perfil no se ha cargado.
- **Solución:** Cierra esa ventana de Terminal por completo (**Command + Q** o **Command + W**) y abre una nueva ventana. En la nueva ventana, escribe directamente `forge614-shell`.

### 8. Cerré la ventana de Terminal por error a la mitad
- **Solución:** No pasa nada. Vuelve a abrir Terminal, dirígete a la carpeta correspondiente y reanuda el paso.

### 9. Deseo repetir la prueba aislada desde cero
- **Solución:** Para borrar por completo la carpeta de prueba aislada, ejecuta:
```bash
rm -rf ~/.forge614-test
```
Y vuelve a ejecutar el paso 5.

---

## 10. Archivos creados por la prueba

Cuando el instalador termina, crea esta estructura dentro de tu carpeta de usuario:

```text
~/.forge614-test/ (o ~/.forge614/ en instalación normal)
├── bin/
│   └── forge614-shell       <- Enlace simbólico (acceso directo ejecutable)
└── shell/
    └── 1.0.0/               <- Carpeta con la versión 1.0.0 aislada
        ├── dist/
        │   └── cli.js       <- El programa empaquetado de Node.js
        ├── extensions/      <- Archivos de extensiones de entorno
        └── package.json     <- Archivo de información con la versión 1.0.0
```

- `bin/`: Contiene el acceso directo que macOS/Linux ejecuta cuando llamas a `forge614-shell`.
- `shell/1.0.0/`: Guarda los archivos específicos de la versión 1.0.0. En el futuro, si se instala una versión 1.0.1 o superior, convivirá en otra carpeta versionada sin pisar las versiones previas.
- `dist/cli.js`: Es el código de Forge614 Shell unificado y preparado para ejecutarse con Node.js sin necesidad de compiladores.

---

## 11. Próximos pasos y política de versiones

Una vez que la instalación ha sido verificada en tu Mac o Linux:

### 11.1 Política de versiones inmutables y parches
- **Inmutabilidad de versiones publicadas:** La versión `1.0.0` ya fue publicada como release privada estable en GitHub con sus archivos adjuntos. Siguiendo las mejores prácticas de ingeniería de software, **una versión publicada nunca se modifica, no se reemplaza y su tag de Git no se reutiliza**.
- **Lanzamiento de versiones parche (ej. `1.0.1`):** Las mejoras introducidas tras el release inicial (como la configuración automática del PATH en `install.sh` o futuras correcciones de errores) se publican en una versión parche subsiguiente (`1.0.1`).
- **El flujo de publicación para `1.0.1` consiste en:**
  1. Actualizar el campo `"version": "1.0.1"` en `package.json`.
  2. Ejecutar la suite de calidad con `bun run check`.
  3. Empaquetar el release con `bun run bundle:release` (genera `forge614-shell-1.0.1.tar.gz` y su `.sha256`).
  4. Crear el tag numérico `git tag 1.0.1` y subirlo a origin.
  5. Crear la GitHub Release visible como `Forge614 Shell v1.0.1` vinculada a dicho tag.
  6. Adjuntar los 3 assets (`.tar.gz`, `.sha256` e `install.sh` actualizado).

### 11.2 Acceso para colaboradores y alcance de plataforma
- **Repositorio privado:** Únicamente las cuentas invitadas explícitamente como colaboradores al repositorio privado en GitHub tienen permiso para descargar los assets de release.
- **Sin herramientas de desarrollo:** El colaborador no requiere `git`, ni GitHub CLI (`gh`), ni Bun. Solo necesita Node.js `>=22.19.0`, Terminal y Bash.
- **Soporte de sistemas operativos:** El instalador actual está soportado exclusivamente en **macOS y Linux**. Windows **aún no está soportado** (requiere un script `install.ps1` en PowerShell que será desarrollado en una etapa posterior).
- **Sin falsas promesas:** No existe instalación pública por `curl | bash`, ni paquete en npm, ni comando de actualización automática `/update` en esta etapa.

Para consultar el flujo técnico detallado para mantenedores y la arquitectura del instalador, consulta:
👉 [06 — Preparación del release 1.0.0 y empaquetado del instalador](06-preparacion-release-1.0.0-instalador.md)
