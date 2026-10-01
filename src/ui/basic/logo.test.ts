import { afterAll, beforeAll, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { resetCapabilitiesCache, setCapabilityOverrides } from "@earendil-works/pi-tui";
import { Container } from "@earendil-works/pi-tui";
import { ChatLogo, helpLogo, renderLogo } from "./logo.ts";
import { mix, palette } from "./theme.ts";

/** These exact RGB assertions need true color instead of whichever terminal runs the suite. */
beforeAll(() => setCapabilityOverrides({ trueColor: true }));
afterAll(() => resetCapabilitiesCache());

/** The letter data is a public visual contract: changing a stroke such as R's lower right block must fail here. */
test("the wide FORGE614 sign has the owner-approved three rows without terminal color codes", () => {
  expect(renderLogo(43, 20, false)).toEqual([
    "█▀▀▀ █▀▀█ █▀▀▄ █▀▀▀ █▀▀▀  █▀▀▀ ▀█  █  █",
    "█▀▀  █  █ █▄▄▀ █ ▀█ █▀▀   █▀▀█  █  ▀▀▀█",
    "▀    ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀  ▀▀▀▀ ▀▀▀    ▀",
  ]);
});

/** Width chooses the compact layout before drawing, so the sign never overflows a narrow chat. */
test("the sign stacks at 42 columns and becomes F614 at 25 columns", () => {
  expect(renderLogo(42, 20, false)).toEqual([
    "█▀▀▀ █▀▀█ █▀▀▄ █▀▀▀ █▀▀▀",
    "█▀▀  █  █ █▄▄▀ █ ▀█ █▀▀ ",
    "▀    ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀",
    "",
    "█▀▀▀ ▀█  █  █",
    "█▀▀█  █  ▀▀▀█",
    "▀▀▀▀ ▀▀▀    ▀",
  ]);
  expect(renderLogo(25, 20, false)).toEqual([
    "█▀▀▀ █▀▀▀ ▀█  █  █",
    "█▀▀  █▀▀█  █  ▀▀▀█",
    "▀    ▀▀▀▀ ▀▀▀    ▀",
  ]);
});

/** A sign that cannot fit, or would crowd a short terminal, must reserve no chat rows at all. */
test("the sign is absent below its width or height limits", () => {
  expect(renderLogo(17, 20, false)).toEqual([]);
  expect(renderLogo(43, 11, false)).toEqual([]);
});

/** The two halves keep OpenCode's visual hierarchy: muted normal text then bold foreground text. */
test("the colored sign paints FORGE muted without bold and 614 foreground in bold", () => {
  const rows = renderLogo(43, 20);
  expect(rows[0]).toContain("\x1b[38;2;161;161;170m█▀▀▀\x1b[39m");
  expect(rows[0]).not.toContain("\x1b[1m█▀▀▀\x1b[22m");
  expect(rows[0]).toContain("\x1b[1m\x1b[38;2;228;228;231m█▀▀▀\x1b[39m\x1b[22m");
});

/** An underscore is not a glyph: O's hollow cell receives exactly the 25%-mixed shadow background. */
test("the O shadow cell uses the exact background and muted 25 percent mix", () => {
  const shadow = mix(palette.background, palette.muted, 0.25);
  expect(renderLogo(43, 20)[1]).toContain(`\x1b[48;2;${shadow.join(";")}m `);
});

/** Help shares the renderer: terminals get color and sizing, while pipes get the stable plain wide form. */
test("help starts with the colored terminal sign and the uncolored wide sign for a pipe", () => {
  expect(helpLogo({ isTTY: true, columns: 25 })[0]).toContain("\x1b[38;2;161;161;170m");
  expect(helpLogo({ isTTY: false, columns: 17 })).toEqual([
    "█▀▀▀ █▀▀█ █▀▀▄ █▀▀▀ █▀▀▀  █▀▀▀ ▀█  █  █",
    "█▀▀  █  █ █▄▄▀ █ ▀█ █▀▀   █▀▀█  █  ▀▀▀█",
    "▀    ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀  ▀▀▀▀ ▀▀▀    ▀",
  ]);
});

/** The shared chat component places a pre-message notice below three blank rows and the sign, then remains gone even when a cleared transcript adds it again. */
test("the chat sign leaves three blank rows above notices and stays absent after the first message and new chat", () => {
  const logo = new ChatLogo();
  const notice = { invalidate() {}, render: () => ["Engram notice"] };
  const transcript = new Container();
  transcript.addChild(logo); transcript.addChild(notice);
  expect(transcript.render(43)).toEqual(["", "", "", ...renderLogo(43, 40), "Engram notice"]);
  logo.dismiss();
  expect(transcript.render(43)).toEqual(["Engram notice"]);
  transcript.clear(); transcript.addChild(logo); transcript.addChild(notice);
  expect(transcript.render(43)).toEqual(["Engram notice"]);
  expect(stripVTControlCharacters(renderLogo(43, 40).join("\n"))).toContain("█▀▀▄");
});
