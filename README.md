# Timeblock Daily

An Obsidian plugin that turns your daily note into a daily planning page, in the
time-blocking style: rewrite your top goals every morning, pick today's Big 6,
keep a rolling task inbox, and plan the day in 15-minute slots.

This is a personal productivity tool. It stores **all of your planning data as
plain text inside your own vault** — nothing ever leaves your notes, and nothing
personal lives in this repository.

## What's on the page

- **Top 3 life goals** — blank every morning on purpose; rewriting them daily is
  the ritual. Yesterday's goals appear as faint placeholders until you type over
  them.
- **Big 6** — the six things to get done today. Always starts empty, never
  auto-filled. Check them off as you go.
- **Task inbox** — add, edit, and check tasks. Anything unfinished yesterday
  rolls over automatically with a *carried over* badge (and remembers the day it
  was first entered).
- **Lists to remember** — named lists (ideas, groceries, …) that persist across
  days and appear on every daily page. Checked items are stamped done and hidden
  from the daily view, but stay in the lists file forever.
- **The day, in 15s** — a vertical grid from 06:00 to 22:00 (configurable) in
  15- or 30-minute slots. Type into any slot, or place a task on a slot with a
  click (from the task's clock button, or a slot's + menu).
- **From your vault** — every unchecked `- [ ]` line anywhere in your notes,
  under a filter bar (search, tag, folder, due date, sort). Tick one and its
  original line becomes `- [x] … ✅ 2026-09-02 14:35`; the completion is also
  recorded in today's planner. The clock button brings a vault task into today
  so you can place it on the grid. In settings you choose which folders or
  notes to scan or skip (Timeblock's own files and `Templates/` are skipped by
  default).
- **Actually…** — every time slot has a second field beside the plan for what
  really happened, stamped the first time you write in it.
- **Review report** — the command "Build review report…" asks for a date
  range (pre-filled with the last 7 days) and writes a readable note to
  `Timeblock/Reviews/` with a scorecard, goal consistency, aging carried-over
  tasks, and a day-by-day timeline of what was done when.
- **Everything is trackable.** Every goal, Big 6 item, task, list item, and slot
  entry carries created/completed timestamps (ISO-8601, with your local UTC
  offset) and its slot placement — all stored as readable YAML in a fenced
  `timeblock` block inside the daily note.

## How it stores data

Each daily note holds one fenced code block:

    ```timeblock
    version: 1
    date: 2026-09-01
    goals: []
    ...
    ```

The plugin renders that block as the interactive planner (reading mode and live
preview). Edits are saved automatically a moment after you stop typing, and the
plugin rewrites **only** the fenced block — never the rest of your note. If the
block's YAML is ever broken (a bad sync merge, a stray edit), the planner shows
an error card and refuses to overwrite your data.

Lists live in their own file (default `Timeblock/Lists.md`) in a
`timeblock-lists` block; open that file to manage lists (including completed
items).

## Using it

- Click the **calendar-clock icon** in the left ribbon, or run the command
  **"Open today's planner"**. This creates today's daily note if needed
  (honoring your core Daily notes folder, format, and template), adds the
  planner block, carries over unfinished tasks, and opens it.
- Optional: turn on **Open today's planner on startup** in the plugin settings.
- Run **"Build review report…"** from the command palette for a look back over
  any date range.

### Settings

| Setting | Default |
| --- | --- |
| Day starts / ends | 06:00 / 22:00 |
| Slot length | 15 minutes (or 30) |
| Lists file | `Timeblock/Lists.md` |
| Rollover lookback | 7 days |
| Open on startup | off |
| Ribbon icon | on |
| Daily folder/format override | blank (follows the core Daily notes plugin) |
| Show tasks from your vault | on |
| Only scan / never scan | blank / `Timeblock`, `Templates` |
| Reports folder | `Timeblock/Reviews` |

## Install (via BRAT)

1. Open Obsidian, click the gear (Settings) bottom-left.
2. Click "Community plugins"; if a "Turn on community plugins" button shows,
   click it.
3. Click "Browse", type BRAT, click "BRAT" (by TfTHacker), click "Install",
   then "Enable".
4. Back in Settings, click "BRAT" in the left sidebar.
5. Click "Add Beta Plugin", paste exactly: `clay-commits/time-block` and click
   "Add Plugin" (leave "Enable after installing" checked).
6. Close Settings and click the calendar-clock icon in the left ribbon — today's
   planner opens. Updates arrive automatically from now on.

## Development

```bash
npm ci
npm run typecheck   # tsc --noEmit
npm test            # node:test via tsx — pure data layer
npm run build       # esbuild -> main.js
```

The data layer (`src/data/`) is pure TypeScript with no Obsidian imports and is
fully unit-tested headlessly. CI runs typecheck, tests, and the build on every
push; pushing a tag matching the manifest version cuts a GitHub release with
`main.js`, `manifest.json`, and `styles.css`.
