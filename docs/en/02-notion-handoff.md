# 02 — Publication map and traceability

Like a library catalogue, this document says where each book lives and how to tell whether the shelf copy matches the original.

Canonical documentation is maintained in local Markdown and published to Notion under `AI Engineer → Librerías → Forge614-Shell`. Every topic has a Spanish/English pair with the same two-digit number.

## Synchronization rule

`docs/notion-map.json` records each local file's language, exact Notion URL, reviewed version, and SHA-256 fingerprint of the current local Markdown. Refresh the fingerprint when that file changes; `notionSyncPending: true` means the Notion page still needs the local changes. Clear that flag only after the page is synchronized.

## Review

Before creating a page, search for its topic and fetch the hub to avoid duplicates. The hub is a short index; manuals, examples, and diagnostics belong in child pages. Do not use coloured headings or backgrounds.

## Required checks

- Every number has ES and EN versions.
- Every local path has a Notion URL in the map.
- README, hub, and counterpart links work.
- Commands, assistants, capabilities, errors, and boundaries match current code.
