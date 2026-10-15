import { pasteClipboardImage, pasteImageKeyLabel } from "../../infrastructure/clipboard.ts";
import type { PastedImage } from "../../infrastructure/clipboard.ts";
import { getCatalog } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import type { ForgeComposer } from "./composer.ts";

/** The path as it is written in the box: with quotes when it has spaces (the temporary folder of a Windows user may), and a space after it so that the person goes on writing. */
export const pastedPathText = (path: string): string => /\s/.test(path) ? `"${path}" ` : `${path} `;

/** The notice of a paste that did not give an image, in the catalog's language. */
export function pasteNotice(result: Exclude<PastedImage, { kind: "image" }>, locale: Locale): string {
  const t = getCatalog(locale).chatImages;
  if (result.kind === "empty") return t.pasteEmpty;
  if (result.kind === "missing-tool") return t.pasteMissingTool({ tools: result.tools });
  if (result.kind === "too-big") return t.pasteTooBig;
  return t.pasteFailed;
}

/**
 * The gray hint of the empty box — «Ctrl+V pega una imagen», «Alt+V» on Windows — or none. In Orca there is none: it pastes an image by itself with the usual Cmd+V (it saves the image in a file and pastes its
 * path), so the hint would be about a key nobody needs. In the macOS Terminal, in contrast, Cmd+V with an image on the clipboard sends the program nothing at all, and nobody would know there is a key for it.
 */
export function pasteHint(locale: Locale, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  return env.TERM_PROGRAM === "Orca" ? undefined : getCatalog(locale).chatImages.pasteHint({ key: pasteImageKeyLabel(platform) });
}

/** What the paste needs of the screen: to repaint and to show a transient notice. */
export interface PasteScreen { requestRender(): void; flash?(message: string, durationMs?: number): void }

/**
 * Makes the box paste the clipboard's image when its key is pressed (`pasteImageKey`: Ctrl+V, Alt+V on Windows): the image is saved as a PNG and its path written in the box at the cursor, the way Orca pastes an image,
 * so that the path goes the way any path does (thumbnail, sent to the assistant). With no image there, a short notice is flashed and nothing is written. One paste at a time: the key pressed again while the
 * clipboard is being read does nothing. `paste` is the clipboard reader (tests give another).
 */
export function attachImagePaste(
  composer: ForgeComposer, screen: PasteScreen, locale: Locale, paste: () => Promise<PastedImage> = () => pasteClipboardImage(),
  where: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {},
): void {
  composer.pasteHint = pasteHint(locale, where.env ?? process.env, where.platform ?? process.platform);
  let reading = false;
  composer.onPasteImage = () => {
    if (reading) return;
    reading = true;
    void paste().then(result => {
      if (result.kind === "image") composer.insertTextAtCursor(pastedPathText(result.path));
      else screen.flash?.(pasteNotice(result, locale));
    }, () => screen.flash?.(pasteNotice({ kind: "failed" }, locale))).finally(() => { reading = false; screen.requestRender(); });
  };
}
