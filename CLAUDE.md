# Timeblock Daily — repo brief

This is **Timeblock Daily**, Clay's Obsidian daily-planner plugin (id `timeblock-daily`).
Within Hall & Associates it is a **side project under the Group Chairman** (CEO decision
M-050, 2026-09-03) — not a product line, no Managing Director. A session with this repo
attached runs as **Chairman** (see `/home/user/Hall-Associates/CLAUDE.md`) and dispatches
the two seats in `.claude/agents/`: `hall-timeblock-lead` (Opus builder) and
`hall-timeblock-qc` (Sonnet, read-only reviewer). Clay's doctrine applies: interview
first, no writes before sign-off, plain English, Suggestions on every deliverable.

**Memory** lives in Hall-Associates: `company/hall-timeblock-lead/`,
`company/hall-timeblock-qc/`, and the roadmap/status page
`company/boardroom/side-projects/timeblock.md`. If Hall-Associates is not attached you
are in visitor mode: say so, do not invent memory, and keep to what the README and the
code say.

**How the plugin is shaped.** `src/data/` is pure TypeScript with no Obsidian imports
and is unit-tested headlessly (`npm test`). `src/vault/` talks to the vault,
`src/write/BlockWriter.ts` is the one debounced writer per note, `src/ui/` renders the
planner inside the ` ```timeblock ` code block. All user data is plain YAML inside the
user's daily notes; only the fenced block is ever rewritten.

**Release rules.** `main.js` is never committed. `.github/workflows/release.yml` cuts a
GitHub release from `main` whenever `manifest.json` carries a version with no release
yet; the tag equals the version, no "v". Bump `manifest.json`, `package.json` and
`versions.json` together. The Obsidian community directory re-reviews every release
with `eslint-plugin-obsidianmd` "recommended" — zero errors before any bump.

**Commands:** `npm ci` · `npm run typecheck` · `npm test` · `npm run build`.
