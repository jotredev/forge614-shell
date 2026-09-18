# 00 — Instalación y prueba local del release

2026-09-18 · Etapa 02: guía paso a paso para principiantes en macOS · [English](../en/00-installation-and-local-release-test.md) · [Índice](../../README.md) · [Detalles técnicos del bundle](06-preparacion-release-1.0.0-instalador.md)

Esta guía explica, paso a paso y desde cero en **macOS**, cómo empaquetar Forge614 Shell y probar su instalador en una carpeta aislada de tu computadora, sin necesidad de conocimientos previos sobre terminales, repositorios o variables de entorno.

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

Para evitar confusiones, es indispensable distinguir tres etapas de distribución:

1. **Prueba local del instalador (Lo que hacemos hoy):** Creamos un paquete comprimido en tu máquina y comprobamos que el script instalador lo desempaque y lo deje listo para ejecutarse en una carpeta de prueba. **Esta es la única opción disponible actualmente.**
2. **Distribución privada mediante GitHub Release (Próximamente):** Los miembros del equipo podrán descargar este mismo paquete desde un repositorio privado de GitHub sin necesidad de tener las herramientas de construcción instaladas. *(El tag de Git `1.0.0` ya está enviado a `origin`, pero la creación del release en la web de GitHub y la subida de los archivos descargables es una acción manual de los mantenedores documentada en el documento 06; aún no está publicada).*
3. **Instalación pública hospedada (En el futuro):** Cualquier persona podrá instalar el programa con un comando simple desde internet o desde una página web (`forge614.dev`). *(Aún no disponible).*

### Lo que NO existe todavía:
- No existe descarga de archivos desde GitHub Releases hasta que el mantenedor publique el release web.
- No existe un comando remoto del tipo `curl ... | bash`.
- No existe instalador alojado en `forge614.dev`.
- No existe el comando `/update` dentro del chat.
- No existe paquete publicado en npm (`npm install -g forge614-shell` no existe).
- No existe instalador para Windows PowerShell (`install.ps1`).
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

- **Versión de Node.js:** Debes ver un número que comience en `v22.19.0` o superior (por ejemplo, `v22.19.1` o `v23.x`). Si tu versión es más antigua, el instalador no continuará.
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
  - `forge614-shell-1.0.0.tar.gz`: Es la "caja comprimida" que contiene el programa empaquetado, su configuración y sus extensiones. No contiene la carpeta pesada `node_modules` de desarrollo. Este es el archivo que en el futuro se distribuirá.
  - `forge614-shell-1.0.0.tar.gz.sha256`: Es una firma criptográfica (suma de control) que permite comprobar que el archivo comprimido no se dañó ni fue alterado.

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
Run: /Users/<tu-usuario>/.forge614-test/bin/forge614-shell --version
Add /Users/<tu-usuario>/.forge614-test/bin to PATH to use forge614-shell everywhere.
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

## 7. Instalación normal opcional

> [!NOTE]
> Este paso es **estrictamente opcional**. Solo debes realizarlo si la prueba aislada del paso 6 funcionó y deseas tener Forge614 Shell instalado en su ubicación predeterminada de usuario (`~/.forge614/`).

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

El programa quedará instalado en la ruta oficial:
`~/.forge614/bin/forge614-shell`

---

## 8. Configuración del PATH

### ¿Qué es el PATH?
En términos sencillos: cuando escribes una palabra en la terminal como `ls` o `node`, tu computadora no sabe mágicamente dónde está ese archivo; consulta una lista de carpetas llamada **PATH**. Si una carpeta está en el PATH, puedes escribir simplemente `forge614-shell` en lugar de escribir toda la ruta larga `~/.forge614/bin/forge614-shell`.

Configurar el PATH es **opcional**. Siempre podrás ejecutar el programa escribiendo su ruta completa.

### Opción A: Activar solo para la ventana actual de Terminal
```bash
export PATH="$HOME/.forge614/bin:$PATH"
```

### Opción B: Activar de forma permanente en macOS (zsh)
Si usas la terminal estándar de macOS (zsh), ejecuta estos dos comandos:

```bash
echo 'export PATH="$HOME/.forge614/bin:$PATH"' >> ~/.zshrc
```

```bash
source ~/.zshrc
```

### Verificar:
Una vez configurado, puedes abrir una terminal nueva y verificar ejecutando únicamente:
```bash
forge614-shell --version
```
Y verás: `forge614-shell 1.0.0`.

---

## 9. Solución de problemas comunes

### 1. `cd: no such file or directory: ~/Desktop/forge614-shell`
- **Causa:** La carpeta del proyecto no está en el Escritorio o tiene otro nombre.
- **Solución:** Escribe `pwd` para ver en qué carpeta estás, o arrastra la carpeta del proyecto desde el Finder directamente a la ventana de Terminal después de escribir `cd `.

### 2. `bun: command not found`
- **Causa:** Bun no está instalado o no se agregó a las rutas conocidas de la terminal.
- **Solución:** Instálalo siguiendo las instrucciones de [bun.sh](https://bun.sh) y abre una nueva ventana de Terminal.

### 3. `node: command not found`
- **Causa:** Node.js no está instalado en la computadora.
- **Solución:** Descarga la versión recomendada (LTS o Current >= 22.19) desde [nodejs.org](https://nodejs.org).

### 4. `Forge614 Shell requires Node.js 22.19 or newer`
- **Causa:** Tienes una versión antigua de Node.js instalada en tu Mac.
- **Solución:** Entra a [nodejs.org](https://nodejs.org), descarga el instalador más reciente para Mac y ejecútalo para actualizar.

### 5. `Release archive not found: ...`
- **Causa:** No ejecutaste el paso 4 (`bun run bundle:release`) o la ruta indicada tras `--archive` no coincide.
- **Solución:** Asegúrate de estar dentro de la carpeta del proyecto y corre `bun run bundle:release` antes de intentar instalar.

### 6. `Permission denied`
- **Causa:** Intentaste ejecutar `./scripts/install.sh` directamente y el archivo no tenía permisos de ejecución directa.
- **Solución:** Ejecútalo siempre anteponiendo la palabra `bash`, tal como se explica en la guía: `bash scripts/install.sh ...`.

### 7. El comando funciona con la ruta completa pero `forge614-shell` dice `command not found`
- **Causa:** No se configuró el PATH de forma permanente en `~/.zshrc` o no se recargó la ventana.
- **Solución:** Ejecuta `source ~/.zshrc` o usa la ruta completa `~/.forge614/bin/forge614-shell`.

### 8. Cerré la ventana de Terminal por error a la mitad
- **Solución:** No pasa nada. Vuelve a abrir Terminal, escribe `cd ~/Desktop/forge614-shell` y continúa en el paso donde te habías quedado.

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
~/.forge614-test/
├── bin/
│   └── forge614-shell       <- Enlace simbólico (acceso directo ejecutable)
└── shell/
    └── 1.0.0/               <- Carpeta con la versión 1.0.0 aislada
        ├── dist/
        │   └── cli.js       <- El programa real empaquetado de Node.js
        ├── extensions/      <- Archivos de extensiones de entorno
        └── package.json     <- Archivo de información con la versión 1.0.0
```

- `bin/`: Contiene el acceso directo que macOS ejecuta cuando llamas al programa.
- `shell/1.0.0/`: Guarda los archivos específicos de la versión 1.0.0. En el futuro, si se instala una versión 1.0.1 o superior, convivirá en otra carpeta sin pisar las versiones previas.
- `dist/cli.js`: Es el código de Forge614 Shell unificado y preparado para ejecutarse con Node.js sin necesidad de compiladores.

---

## 11. Próximos pasos

Una vez que esta prueba local ha sido verificada en tu Mac:

1. **Fase siguiente (Colaboradores privados):** El flujo para mantenedores para crear el GitHub Release privado a partir del tag existente `1.0.0` y adjuntar los 3 archivos (`forge614-shell-1.0.0.tar.gz`, `forge614-shell-1.0.0.tar.gz.sha256` e `install.sh`) se encuentra documentado en la sección 8 del documento 06. Una vez que un mantenedor complete la publicación en la web de GitHub, los colaboradores autorizados del repositorio privado podrán descargar los archivos e instalar Shell sin necesidad de clonar el código fuente.
2. **Fase futura (Usuarios generales):** Se desarrollará un instalador alojado en internet (`forge614.dev`) que descargará y configurará automáticamente el programa.

Para consultar el flujo de publicación de mantenedores, la arquitectura técnica, las sumas de verificación SHA-256 y el código del empaquetador, consulta el documento técnico:
👉 [06 — Preparación del release 1.0.0 y empaquetado del instalador](06-preparacion-release-1.0.0-instalador.md)
