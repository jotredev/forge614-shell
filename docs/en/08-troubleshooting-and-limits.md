# 08 — Troubleshooting and operational limits

Like a car fault list, this document connects each symptom to the component that can resolve it, without pretending an extinguished light is a repair.

| Symptom | Meaning and action |
| --- | --- |
| Engines absent or schema incompatible | Reinstall Forge614 Shell to repair its dependency; Shell does not search for another executable itself. |
| No chat assistants | Install and authenticate Claude Code or Codex; Shell lists only assistants Engines reports as fully supported. |
| `init` without an interactive terminal | Run the command in a real terminal; the flow requires selection and confirmation. |
| No assistants for Engram setup | No installed assistant returned `fullySupported: true`; Engram may still be initialized. |
| Engines needs to be updated | The installed Engines does not report `fullySupported` (older than 1.14.0). Run `forge614-shell update`. |
| MCP plan blocked | Engines refused the change, for example because an entry has the same name. Read the displayed reason; Shell does not force files. |
| `not configured` outcome | Planning or apply failed, or Engines returned `applied: false`. Other assistants may have completed correctly. |
| Credentials or base URL in environment | The adapter rejects authentication rerouting. Use a clean terminal and official login. |
| Missing quota/context data | The native client did not report it; Shell does not calculate or invent it. |
| «Codex did not answer the stop request…» notice | `/f614:stop` got no answer to `turn/interrupt` within 5 seconds: Shell ended the turn on its side. A timed-out request closes the transport on purpose, so nothing keeps running unattended, and Shell then reconnects by itself: it opens Codex's app-server again and, if there already was a conversation, resumes it (`thread/resume` with the same id; if there was none, it only opens a new connection), and the notice says so («…and reconnected to Codex. Your conversation is still here.»): keep working. Only if it cannot reconnect does the notice end «…and closed the connection. Restart Shell to keep working.» (a side conversation is not reconnected, so there the second wording applies). If the notice says Codex had no turn running, Shell did not close the connection and normally no restart is needed. |
| «Codex accepted the stop request but did not finish the turn…» notice | Codex confirmed `turn/interrupt` but did not end the turn (`turn/completed`) within 5 seconds: Shell ended the turn on its side and did not close the connection to Codex. Normally no restart is needed. |
| «Turn stopped: Claude Code did not answer the stop in 5 seconds…» notice | `/f614:stop` interrupts Claude Code without closing it; if it does not end the turn within 5 seconds, Shell closes it and opens it again in the background with the same conversation (if there already was one). Background tasks that were running are left «interrupted». It appears only if a message of yours was waiting. Shell does not need to be restarted. |
| «Turn stopped: Claude Code was closed before it could answer.» notice | Claude Code was closed before it answered a message of yours: you stopped it while Claude Code was still opening, or ran `/logout` with a message waiting. Send the message again. |
| An MCP tool does not show 🧠 | Only `forge614-engram` uses that indicator. Other MCP servers show `server: tool`; a new assistant needs an adapter and protocol validation. |
| `init` returns to the prompt with no visible output | Fixed: any failure to enter or leave the alternate screen now forces a clean exit and a message on the plain terminal, with a non-zero exit code. If it still happens, rerun with `FORGE614_SHELL_DEBUG_INIT=1 forge614-shell init --product engram`. Diagnostics are never printed to the screen — mixing them with the alternate-screen render corrupts it — they are written to a private file under `$FORGE614_HOME/shell/logs/` (or `~/.forge614/shell/logs/`), whose path is printed once on the plain terminal when the command exits. The file records TTY state, key classifications (Enter/Esc/Ctrl-D/other), signals, and the exact termination reason, never secrets. |
| `Cmd+V` in the macOS Terminal does not paste an image | With an image on the clipboard, the macOS Terminal sends the program nothing (not even an empty paste), so Shell cannot react. Use `Ctrl+V` in the writing box (`Alt+V` on Windows); where Orca is not running, the empty box reminds you in gray. Orca does paste the image's path with `Cmd+V`. |
| «There is no image on the clipboard» | `Ctrl+V` (`Alt+V` on Windows) found no image on the clipboard (copied text does not count). Copy a screenshot, for example with `Cmd+Ctrl+Shift+4` on macOS, and press it again. |
| «Could not read the clipboard: install wl-clipboard» (or `xclip`) | On Linux Shell reads the clipboard with `wl-paste` (the `wl-clipboard` package, Wayland) or `xclip` (X11) and neither is installed; install the one for your session. If the session is not known, the notice says «wl-clipboard o xclip». |
| «The image on the clipboard is over 20 MB» | The limit for an image, pasted or written as a path, is 20 MB; a heavier one is not drawn (a path of that size comes out only as a gray line). |
| «Could not read the image on the clipboard» | The program that reads the clipboard failed, did not answer in 5 seconds or handed over something that is not an image. Copy it again and retry. |
| No thumbnail, only the gray line `🖼 name · W×H · KB` | The terminal does not show images in the chat: the macOS Terminal, iTerm2 (pi-tui turns its protocol off in the alternate screen, also with `FORGE614_SHELL_IMAGES=iterm2`), Windows Terminal, VS Code and others. With Orca, kitty, Ghostty, WezTerm or Warp there is a thumbnail. In a terminal that understands the kitty protocol, try `FORGE614_SHELL_IMAGES=kitty`. While the thumbnail is being made only the gray line is seen too. |
| No thumbnails under tmux or screen | Those programs do not pass graphics through to the terminal, so Shell does not draw them there, even if the outer terminal could. Only the gray line is seen. |
| A thumbnail disappears whole when the chat scrolls up | When a thumbnail's first row leaves the top of the chat, pi-tui removes the whole image (it only crops it when it leaves at the bottom). Scroll back down to see it. |
| A very long image path is not a link | A path that takes several rows stops being a clickable link in the text; the image is detected all the same and its gray line does carry the link. |

## Known limits

Windows x64 has an official installer (`install.ps1`) and native launcher (`forge614-shell.cmd`), continuously verified in native CI (`windows-latest`) alongside macOS and Linux. However, interactive chat with real assistant accounts (Claude Code, Codex) and specific terminal emulators still requires manual verification with external accounts. Shell does not include a worktree manager, local engines, or an MCP-removal UI. `forge614-ai` does not own `forge614 init` yet.

## Maintenance verification

Run from the repository:

```bash
bun run typecheck
bun test
bun run build
```

No documentation verifier is configured in `package.json`; documentation review checks ES/EN pairs, Markdown links, the Notion map, and claims against code and tests.
