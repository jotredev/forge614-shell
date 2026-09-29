/**
 * Fixed texts Codex's terminal app sends to the model as ordinary user messages. Each is copied verbatim (same
 * characters, curly apostrophes and final newline included) from Codex 0.159.0; refresh them from a fresh
 * download when Codex changes, never from memory.
 */

/**
 * What `/init` sends as a normal turn (`slash_dispatch.rs:290`, `include_str!`). Source:
 * https://raw.githubusercontent.com/openai/codex/rust-v0.159.0/codex-rs/tui/assets/prompt_for_init_command.md
 */
export const CODEX_INIT_PROMPT = `Generate a file named AGENTS.md that serves as a contributor guide for this repository.
Before writing, check whether AGENTS.md already exists in the current working directory. If it does, do not overwrite or modify it.
Your goal is to produce a clear, concise, and well-structured document with descriptive headings and actionable explanations for each section.
Follow the outline below, but adapt as needed — add sections if relevant, and omit those that do not apply to this project.

Document Requirements

- Title the document "Repository Guidelines".
- Use Markdown headings (#, ##, etc.) for structure.
- Keep the document concise. 200-400 words is optimal.
- Keep explanations short, direct, and specific to this repository.
- Provide examples where helpful (commands, directory paths, naming patterns).
- Maintain a professional, instructional tone.

Recommended Sections

Project Structure & Module Organization

- Outline the project structure, including where the source code, tests, and assets are located.

Build, Test, and Development Commands

- List key commands for building, testing, and running locally (e.g., npm test, make build).
- Briefly explain what each command does.

Coding Style & Naming Conventions

- Specify indentation rules, language-specific style preferences, and naming patterns.
- Include any formatting or linting tools used.

Testing Guidelines

- Identify testing frameworks and coverage requirements.
- State test naming conventions and how to run tests.

Commit & Pull Request Guidelines

- Summarize commit message conventions found in the project’s Git history.
- Outline pull request requirements (descriptions, linked issues, screenshots, etc.).

(Optional) Add other sections if relevant, such as Security & Configuration Tips, Architecture Overview, or Agent-Specific Instructions.
`;

/**
 * «Yes, implement this plan» sends this in Default mode (`PLAN_IMPLEMENTATION_CODING_MESSAGE`). Source:
 * https://raw.githubusercontent.com/openai/codex/rust-v0.159.0/codex-rs/tui/src/chatwidget/plan_implementation.rs
 */
export const PLAN_IMPLEMENTATION_CODING_MESSAGE = "Implement the plan.";

/**
 * «Yes, clear context and implement» starts a new thread and sends this, a blank line and the plan
 * (`PLAN_IMPLEMENTATION_CLEAR_CONTEXT_PREFIX`, same file as above).
 */
export const PLAN_IMPLEMENTATION_CLEAR_CONTEXT_PREFIX = "A previous agent produced the plan below to accomplish the user's task. Implement the plan in a fresh context. Treat the plan as the source of user intent, re-read files as needed, and carry the work through implementation and verification.";
