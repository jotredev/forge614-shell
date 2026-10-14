import { expect, test } from "bun:test";
import { isCommandText } from "./command-text.ts";

test("los comandos de verdad siguen siendo comandos", () => {
  for (const text of ["/help", "/compact", "/f614:quit", "/f614:stop", "/model opus", "/effort high", "/resume 2", "/model /var/folders/x.png", "/status   ", "/"]) {
    expect(isCommandText(text), text).toBe(true);
  }
});

test("un texto que no empieza con / no es un comando", () => {
  for (const text of ["hola", "  /help", "C:\\Users\\ana\\a.png", "\"/var/x.png\"", ""]) expect(isCommandText(text), text).toBe(false);
});

test("una ruta (la primera palabra tiene otra / después de la inicial) no es un comando: sola, con texto, que no exista, con espacios escapados o de red", () => {
  for (const text of [
    "/var/folders/py/8t_f613/T/orca-paste-1792014790450-4d52d7ff-600a-4b53-9ee0-f9d071631bd0.png",
    "/Users/ana/captura.png mira esto por favor",
    "/ruta/que/no/existe.png",
    "/Users/ana/Mis\\ capturas/a.png",
    "/tmp/",
    "//servidor/recurso/a.png",
    "/var/x.png\ncon otra línea",
  ]) expect(isCommandText(text), text).toBe(false);
});
