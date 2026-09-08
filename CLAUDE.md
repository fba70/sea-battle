# Claude Code Project Instructions

## Source of Truth

- Treat `specs/seabattle-portal-spec.md` as the primary product and architecture specification.
- Treat `specs/template.md` as an additional technology-stack requirement.
- Read the relevant parts of both specifications before architectural or implementation work.
- If the specifications conflict or leave an architecture decision unresolved, do not silently choose. Explain the conflict and ask before proceeding.
- Do not modify specification files unless explicitly asked.

## Workflow

- Keep every change scoped to the requested task.
- Do not implement unrelated features or future phases without being asked.
- Before substantial architectural changes, inspect the existing code and propose an implementation approach before editing.
- Prefer small, reviewable changes over large rewrites.
- Do not commit, push, reset, rebase, force-push, or rewrite Git history unless explicitly asked.
- Do not install new dependencies unless they are required for the requested task. Explain non-obvious dependency additions.

## Code Quality

- Keep TypeScript strict.
- Do not suppress TypeScript, lint, or test errors merely to make checks pass.
- Avoid `any` unless there is a clear technical reason.
- Keep domain/game logic separate from rendering and framework-specific UI code where practical.
- Prefer simple, readable implementations over unnecessary abstractions.
- Follow existing project conventions once they exist.

## Verification

After implementation work:

- Run the relevant tests.
- Run TypeScript type checking.
- Run linting.
- Run formatting checks if configured.
- Report any remaining errors, warnings, failing tests, or checks instead of hiding them.
- Add or update tests when changing game rules, rating logic, protocol validation, or other critical behavior.

## Game Architecture and Security

- The server is authoritative for game state, rules, timers, RNG, and competitive results.
- The client must never receive unrevealed opponent ship positions.
- Treat the client as untrusted.
- Validate external input at trust boundaries.
- Keep the game rules engine transport-independent where practical.
- Keep rendering logic separate from authoritative game logic.
- Do not weaken anti-cheat guarantees for implementation convenience.

## Scope and Phasing

- Follow the implementation phases defined in `specs/seabattle-portal-spec.md`.
- Do not pull Phase 1, Phase 2, or Phase 3 functionality into an earlier phase unless explicitly requested.
- When a task depends on an unresolved Open Question from the specification, surface it before implementing a choice that would be expensive to reverse.

## Communication

When completing a task:

- Briefly explain what was changed.
- List the important files affected.
- Mention relevant architectural decisions and assumptions.
- Report verification commands and their results.
- Clearly state anything that remains incomplete or unresolved.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
