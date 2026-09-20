# 05 — Basic interface and chat

Like a car dashboard, the Basic interface shows what the engine reports; it does not invent a gauge when no sensor exists.

The Basic interface is the only available visual interface. The startup picker asks for confirmation even with one option. Claude Code and Codex are the chat assistants.

## Public in-chat controls

| Control | Effect |
| --- | --- |
| `/login` | Connects Shell to the existing native account or offers the official flow. |
| `/logout` | Disconnects only this Shell session; it does not revoke the account. |
| `/new`, `/resume` | Starts or resumes a client conversation. |
| `/model`, `/effort` | Shows or adjusts options reported by the client. |
| `/status` | Shows client-reported state. |
| `/stop`, `/quit` | Interrupts the active turn or exits. |
| `/refresh` | Requests the quotas that Codex or Claude report again; it sends no chat prompt. |
| `$` | Opens Codex skill discovery (reusable instructions). |

The status bar, sidebar, and history show project, model, context, and quotas when the client exposes them. “Not reported” means exactly that the client did not provide the value. The interface has no Gemini or Antigravity screens or commands.

## Sessions and permissions

Codex lists and resumes threads in the current directory; it rejects a thread from another project or one active in another client. Codex work modes come from its configuration requirements and can combine approval policy with sandboxing. Claude retains its native history. Before an action requiring confirmation, Shell shows the question in the interface.
