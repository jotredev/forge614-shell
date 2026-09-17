import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

export default function forge614Shell(pi: ExtensionAPI) {
  const status = (ctx: ExtensionContext, state: string) => {
    if (ctx.hasUI) ctx.ui.setStatus("forge614-shell", `Forge614 · ${state}`);
  };

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setTitle("Forge614-Shell");
    status(ctx, "ready");
    if (ctx.mode === "tui") {
      ctx.ui.setHeader((_tui, theme) => ({
        render(width) {
          return [
            truncateToWidth(theme.fg("accent", theme.bold("Forge614-Shell")), width),
            truncateToWidth(theme.fg("dim", "Powered by Pi · /login · /resume · /model · /thinking"), width),
          ];
        },
        invalidate() {},
      }));
    }
  });

  pi.on("agent_start", (_event, ctx) => status(ctx, "working"));
  pi.on("agent_settled", (_event, ctx) => status(ctx, "ready"));

  pi.registerCommand("forge614-status", {
    description: "Show the current Forge614-Shell workspace and profile",
    handler: async (_args, ctx) => {
      ctx.ui.notify([
        "Forge614-Shell",
        `Project: ${ctx.cwd}`,
        `Profile: ${process.env.PI_CODING_AGENT_DIR ?? "Pi host profile"}`,
        `Model: ${ctx.model && ctx.model.id !== "unknown" ? `${ctx.model.provider}/${ctx.model.id}` : "not selected — use /login"}`,
        "Persistent knowledge memory: not connected (Engram deferred)",
      ].join("\n"), "info");
    },
  });
}
