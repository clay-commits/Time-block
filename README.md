# Timeblock Daily

An Obsidian plugin that turns your daily note into a daily planning page, in the
time-blocking style: rewrite your top goals every morning, pick today's Big 6,
keep a rolling task inbox, and plan the day in 15-minute slots. It works on
desktop, phone and tablet.

This is a personal productivity tool, and everything stays on your device: your
planning data is plain text inside your own notes and lists file, and the
plugin's settings — including the last-used filter of the vault inbox — live in
its `data.json` inside your vault's `.obsidian` folder. The plugin makes no
network requests, has no telemetry, and needs no account.

## What's on the page

- **Top 3 life goals** — blank every morning on purpose; rewriting them daily is
  the ritual. The goals from your most recent previous planner (within the
  rollover lookback, 7 days by default) appear as faint placeholders until you
  type over them.
- **Big 6** — the six things to get done today. Always starts empty, never
  auto-filled. Check them off as you go.
- **Task inbox** — add, edit, and check tasks. Anything left unfinished in your
  most recent previous planner (within the lookback) rolls over automatically
  with a *carried over* badge, remembering the day it was first entered.
- **Lists to remember** — named lists (ideas, groceries, …) that persist across
  days and appear on every daily page. Checked items are stamped done and hidden
  from the daily view; they stay in the lists file until you uncheck them there
  or delete the list.
- **The day in 15-minute slots** — a vertical grid from 06:00 to 22:00
  (configurable) in 15- or 30-minute slots. Type into any slot, or place a task
  on a slot with a click (from the task's clock button, or a slot's + menu).
  Entries outside the Day starts / Day ends hours are listed under the grid.
- **Actually…** — every time slot has a second field beside the plan for what
  really happened, stamped the first time you write in it.
- **Notes** — a free-text area for anything else about today, saved in the
  same block.
- **From your vault** — every unchecked `- [ ]` line anywhere in your notes,
  under a filter bar (search, tag, folder, due date, sort). Links in a task's
  text (`[label](url)`, `[[note]]`) are clickable. Tick one and its original
  line becomes `- [x] … ✅ 2026-09-02 14:35`; the completion is also recorded
  in today's planner. The clock button brings a vault task into today so you
  can place it on the grid. In settings you choose which folders or notes to
  scan or skip (Timeblock's own files and `Templates/` are skipped by default).
- **Review report** — the command "Build review report…" asks for a date
  range (pre-filled with the last 7 days) and writes a readable note named
  `<start>_to_<end>.md` to `Timeblock/Reviews/`, with a scorecard, goal
  consistency, aging carried-over tasks, and a day-by-day timeline of what was
  done when. An existing report is never overwritten: a second report for the
  same range is written as a numbered copy (`…-2.md`, `…-3.md`, and so on).
- **Everything is trackable.** Goals record when they were written; Big 6
  items, tasks, and list items record when they were created and completed;
  each time slot records when its plan and its "actually" note were first
  written; tasks also remember the slot they were placed on. Timestamps are
  ISO-8601 with your local UTC offset, and it is all stored as readable YAML
  in a fenced `timeblock` block inside the daily note.

## How it stores data

Each daily note holds one fenced code block:

    ```timeblock
    version: 1
    date: "2026-09-01"
    goals: []
    ...
    notes: ""
    ```

The plugin renders that block as the interactive planner (reading mode and live
preview). Edits are saved automatically a moment after you stop typing, and the
plugin rewrites **only** the fenced block — never the rest of your note. Only
the first `timeblock` block in a note is managed; any extra copy renders
read-only. If the block's YAML is ever broken (a bad sync merge, a stray edit),
or its closing fence is missing, the planner shows an error card and refuses to
overwrite your data.

Lists live in their own file (default `Timeblock/Lists.md`) in a
`timeblock-lists` block; open that file to manage lists (including completed
items).

## Using it

- Click the **calendar-clock icon** in the left ribbon, or run the command
  **"Open today's planner"**. This creates today's daily note if needed
  (honoring your core Daily notes folder, format, and template), adds the
  planner block, carries over unfinished tasks, and opens it.
- Want the planner in a particular spot? Put an empty ` ```timeblock ` fence
  (the opening and closing lines with nothing between them) in your daily-note
  template and the plugin fills it in place, so the planner sits wherever you
  like in the note.
- Optional: turn on **Open today's planner on startup** in the plugin settings.
- Run **"Build review report…"** from the command palette for a look back over
  any date range.

### Settings

| Setting | Default |
| --- | --- |
| Day starts at | 06:00 |
| Day ends at | 22:00 |
| Slot length | 15 minutes (or 30) |
| Lists file | `Timeblock/Lists.md` |
| Rollover lookback (days) | 7 |
| Open today's planner on startup | off |
| Show ribbon icon | on |
| Show tasks from your vault | on |
| Only scan these folders or notes | blank (whole vault) |
| Never scan these folders or notes | `Timeblock`, `Templates` |
| Reports folder | `Timeblock/Reviews` |
| Daily notes folder override | blank (follows the core Daily notes plugin) |
| Daily note date format override | blank (follows the core Daily notes plugin) |

## Install (via BRAT)

1. Open Obsidian, click the gear (Settings) bottom-left.
2. Click "Community plugins"; if a "Turn on community plugins" button shows,
   click it.
3. Click "Browse", type BRAT, click
   "[BRAT](https://github.com/TfTHacker/obsidian42-brat)" (by TfTHacker),
   click "Install", then "Enable".
4. Back in Settings, click "BRAT" in the left sidebar.
5. Click "Add beta plugin", paste exactly: `clay-commits/Time-block` and click
   "Add plugin" (leave "Enable after installing the plugin" checked).
6. Close Settings and click the calendar-clock icon in the left ribbon — today's
   planner opens. Updates arrive automatically from now on.

## Development

```bash
npm ci
npm run typecheck   # tsc --noEmit
npm test            # node:test via tsx — pure data layer
npm run build       # esbuild -> main.js (minified)
```

The data layer (`src/data/`) is pure TypeScript with no Obsidian imports and is
fully unit-tested headlessly. CI runs typecheck, tests, and the build on every
push. Releases are cut automatically from `main`: whenever the version in
`manifest.json` has no GitHub release yet, the release workflow builds
`main.js` and publishes it together with `manifest.json` and `styles.css`,
tagged with that version. Source: `clay-commits/Time-block`.

## Third-party code

The build bundles [js-yaml](https://github.com/nodeca/js-yaml) (MIT,
Copyright 2011-2015 Vitaly Puzrin).

## License

MIT — see [LICENSE](LICENSE).
