// Review report: a Markdown summary of a date range built from per-day
// planner data. Pure and deterministic — every "now" is a parameter, and
// timestamps are read as text (chars 0–10 = date, 11–16 = wall clock),
// never parsed with Date. Nothing here may import from "obsidian".

import { Big6Item, Block, DayData, Task } from "./types";

export interface ReportDay {
	date: string;
	/** null = no planner note/block existed that day. */
	day: DayData | null;
	/** A planner block existed that day but could not be parsed. */
	unreadable?: boolean;
}

export interface ReportOptions {
	start: string;
	end: string;
	/** ISO local stamp; placed in the header verbatim. */
	generatedAt: string;
}

const MS_PER_DAY = 86400000;
const MAX_RANGE_DAYS = 366;
const WEEKDAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

// ---------------------------------------------------------------------------
// Dates and stamps (UTC arithmetic so DST can never skip or repeat a day)
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" → UTC midnight ms, or null when malformed or not a real date. */
function parseDateUtc(date: string): number | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!m) return null;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	const ms = Date.UTC(y, mo - 1, d);
	if (!Number.isFinite(ms)) return null;
	const back = new Date(ms);
	if (
		back.getUTCFullYear() !== y ||
		back.getUTCMonth() !== mo - 1 ||
		back.getUTCDate() !== d
	) {
		return null; // e.g. 2026-02-30 rolled over into March
	}
	return ms;
}

function formatDateUtc(ms: number): string {
	const d = new Date(ms);
	const y = d.getUTCFullYear();
	const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
	const da = String(d.getUTCDate()).padStart(2, "0");
	return `${y}-${mo}-${da}`;
}

/** Inclusive list of dates from start to end; [] when invalid or inverted; capped at 366. */
/**
 * First free note path for a generated report: "<base>.md", then "<base>-2.md",
 * "<base>-3.md", … A path that already exists is never returned, so a report
 * can never overwrite an earlier one. Null when `limit` names are all taken.
 */
export function firstFreePath(
	base: string,
	exists: (path: string) => boolean,
	limit = 1000
): string | null {
	for (let n = 1; n <= limit; n++) {
		const path = n === 1 ? `${base}.md` : `${base}-${n}.md`;
		if (!exists(path)) return path;
	}
	return null;
}

export function dateRange(start: string, end: string): string[] {
	const a = parseDateUtc(start);
	const b = parseDateUtc(end);
	if (a == null || b == null || b < a) return [];
	const out: string[] = [];
	for (let t = a; t <= b && out.length < MAX_RANGE_DAYS; t += MS_PER_DAY) {
		out.push(formatDateUtc(t));
	}
	return out;
}

/** "Monday".."Sunday" for a "YYYY-MM-DD" date (UTC), "" when invalid. */
export function weekdayName(date: string): string {
	const ms = parseDateUtc(date);
	if (ms == null) return "";
	return WEEKDAYS[new Date(ms).getUTCDay()] ?? "";
}

/** "HH:MM" wall-clock time from an ISO local stamp (chars 11–16), else "". */
export function timeOf(stamp: string | null | undefined): string {
	if (!stamp) return "";
	const hm = stamp.slice(11, 16);
	return /^\d\d:\d\d$/.test(hm) ? hm : "";
}

/** "YYYY-MM-DD" date part of an ISO local stamp (chars 0–10), else "". */
function dateOf(stamp: string | null | undefined): string {
	if (!stamp) return "";
	const d = stamp.slice(0, 10);
	return /^\d{4}-\d\d-\d\d$/.test(d) ? d : "";
}

/** Whole days from `from` to `to`; 0 when either is invalid or `to` is earlier. */
function daysBetween(from: string, to: string): number {
	const a = parseDateUtc(from);
	const b = parseDateUtc(to);
	if (a == null || b == null) return 0;
	return Math.max(0, Math.round((b - a) / MS_PER_DAY));
}

// ---------------------------------------------------------------------------
// Data predicates
// ---------------------------------------------------------------------------

function isBlank(text: string | undefined): boolean {
	return text == null || text.trim() === "";
}

function isDone(item: { completed: string | null }): boolean {
	return !!item.completed;
}

/** A slot counts as planned when something was written or a task was placed on it. */
function isPlanned(block: Block): boolean {
	return !isBlank(block.text) || !!block.taskId;
}

function hasActual(block: Block): boolean {
	return !isBlank(block.actual);
}

/** Blank-text rows are in-memory placeholders, not data (see serializer). */
function realTasks(day: DayData): Task[] {
	return day.tasks.filter((t) => !isBlank(t.text));
}

function realBig6(day: DayData): Big6Item[] {
	return day.big6.filter((b) => !isBlank(b.text));
}

function realGoalTexts(day: DayData): string[] {
	return day.goals.map((g) => g.text.trim()).filter((t) => t !== "");
}

function hasPlanner(rd: ReportDay): rd is ReportDay & { day: DayData } {
	return rd.day !== null && !rd.unreadable;
}

/** Blocks in slot-key order (insertion order of the record must never leak into output). */
function sortedBlocks(day: DayData): Array<[string, Block]> {
	const out: Array<[string, Block]> = [];
	for (const key of Object.keys(day.blocks).sort()) {
		const b = day.blocks[key];
		if (b) out.push([key, b]);
	}
	return out;
}

function compareText(a: string, b: string): number {
	const la = a.toLowerCase();
	const lb = b.toLowerCase();
	if (la < lb) return -1;
	if (la > lb) return 1;
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

/** Per-day counts for the scorecard and the plugin UI. */
export function summarizeDay(day: DayData): {
	planned: number;
	/** Planned slots that also have an "actually" entry (never exceeds planned). */
	actuallyFilled: number;
	/** Slots with an "actually" entry but nothing planned. */
	unplannedActual: number;
	placedDone: number;
	placedTotal: number;
	big6Done: number;
	big6Total: number;
} {
	let planned = 0;
	let actuallyFilled = 0;
	let unplannedActual = 0;
	for (const block of Object.values(day.blocks)) {
		if (isPlanned(block)) {
			planned++;
			if (hasActual(block)) actuallyFilled++;
		} else if (hasActual(block)) {
			unplannedActual++;
		}
	}
	const placed = realTasks(day).filter((t) => !!t.slot);
	const big6 = realBig6(day);
	return {
		planned,
		actuallyFilled,
		unplannedActual,
		placedDone: placed.filter(isDone).length,
		placedTotal: placed.length,
		big6Done: big6.filter(isDone).length,
		big6Total: big6.length,
	};
}

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

/** Collapse line breaks so one item always stays on one Markdown line. */
function inline(text: string): string {
	return text.replace(/\r\n|\r|\n/g, " ");
}

/** Table-cell text: single line, with "|" escaped so it cannot split the row. */
function cell(text: string): string {
	return inline(text).replace(/\|/g, "\\|");
}

function tableRow(cells: string[]): string {
	return `| ${cells.join(" | ")} |`;
}

function table(header: string[], rows: string[][]): string {
	const lines = [
		tableRow(header.map(cell)),
		tableRow(header.map(() => "---")),
		...rows.map((r) => tableRow(r.map(cell))),
	];
	return lines.join("\n");
}

function bullets(items: string[]): string {
	return items.map((i) => `- ${inline(i)}`).join("\n");
}

function percentLabel(filled: number, planned: number): string {
	if (planned === 0) return `${filled} (–)`;
	return `${filled} (${Math.round((filled / planned) * 100)}%)`;
}

function ofLabel(k: number, n: number): string {
	return `${k} of ${n}`;
}

function dayCount(n: number): string {
	return `${n} ${n === 1 ? "day" : "days"}`;
}

/** "Tuesday, 2026-09-01" — or just the date when the weekday is unknown. */
function dayLabel(date: string): string {
	const weekday = weekdayName(date);
	return weekday ? `${weekday}, ${date}` : date;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

interface CarriedTask {
	days: number;
	text: string;
	since: string;
}

/** Open, carried-over tasks on a day, longest-carried first. */
function carriedTasks(rd: ReportDay & { day: DayData }): CarriedTask[] {
	const out: CarriedTask[] = [];
	for (const t of realTasks(rd.day)) {
		if (isDone(t) || !t.carriedFrom) continue;
		out.push({
			days: daysBetween(t.carriedFrom, rd.date),
			text: t.text,
			since: t.carriedFrom,
		});
	}
	out.sort((a, b) => b.days - a.days || compareText(a.text, b.text));
	return out;
}

function renderHeader(days: ReportDay[], opts: ReportOptions, blocks: string[]): void {
	const withPlanner = days.filter(hasPlanner).length;
	const unreadable = days.filter((d) => d.unreadable).length;
	blocks.push(`# Review: ${opts.start} to ${opts.end}`);
	blocks.push(`Generated ${opts.generatedAt}.`);
	let line = `${withPlanner} of ${days.length} days had a planner`;
	if (unreadable > 0) line += `, ${unreadable} unreadable`;
	blocks.push(`${line}.`);
}

function renderScorecard(days: ReportDay[], opts: ReportOptions, blocks: string[]): void {
	const plannerDays = days.filter(hasPlanner);
	const lastDay = plannerDays[plannerDays.length - 1];

	let planned = 0;
	let actuallyFilled = 0;
	let unplannedActual = 0;
	let placedDone = 0;
	let placedTotal = 0;
	let big6Done = 0;
	let big6Total = 0;
	let completedInRange = 0;
	const dayRows: string[][] = [];

	for (const rd of plannerDays) {
		const s = summarizeDay(rd.day);
		planned += s.planned;
		actuallyFilled += s.actuallyFilled;
		unplannedActual += s.unplannedActual;
		placedDone += s.placedDone;
		placedTotal += s.placedTotal;
		big6Done += s.big6Done;
		big6Total += s.big6Total;
		for (const t of realTasks(rd.day)) {
			const done = dateOf(t.completed);
			if (done && done >= opts.start && done <= opts.end) completedInRange++;
		}
		dayRows.push([
			dayLabel(rd.date),
			String(s.planned),
			percentLabel(s.actuallyFilled, s.planned),
			ofLabel(s.placedDone, s.placedTotal),
			ofLabel(s.big6Done, s.big6Total),
		]);
	}

	const stillOpen = lastDay
		? realTasks(lastDay.day).filter((t) => !isDone(t)).length
		: 0;
	const longest = lastDay ? carriedTasks(lastDay)[0] : undefined;

	blocks.push("## Scorecard");
	blocks.push(
		table(
			["Measure", "Value"],
			[
				["Planned slots", String(planned)],
				['Slots with "actually" filled in', percentLabel(actuallyFilled, planned)],
				['Unplanned slots with an "actually" entry', String(unplannedActual)],
				["Placed tasks done", ofLabel(placedDone, placedTotal)],
				["Big 6 done", ofLabel(big6Done, big6Total)],
				["Tasks completed", String(completedInRange)],
				["Tasks still open on last planner day", String(stillOpen)],
				[
					"Longest-carried task",
					longest ? `${dayCount(longest.days)} — ${longest.text}` : "none",
				],
			]
		)
	);
	blocks.push(
		table(["Day", "Planned", "Actually filled", "Placed done", "Big 6 done"], dayRows)
	);
}

interface GoalStat {
	key: string;
	text: string;
	dates: string[];
}

function renderGoals(days: ReportDay[], blocks: string[]): void {
	const plannerDays = days.filter(hasPlanner);
	const stats = new Map<string, GoalStat>();
	for (const rd of plannerDays) {
		for (const raw of realGoalTexts(rd.day)) {
			const text = raw.trim();
			const key = text.toLowerCase();
			let stat = stats.get(key);
			if (!stat) {
				stat = { key, text, dates: [] };
				stats.set(key, stat);
			}
			if (!stat.dates.includes(rd.date)) stat.dates.push(rd.date);
		}
	}
	const rows = [...stats.values()].sort(
		(a, b) => b.dates.length - a.dates.length || compareText(a.text, b.text)
	);

	const everyDay = rows
		.filter((r) => plannerDays.length > 0 && r.dates.length === plannerDays.length)
		.map((r) => inline(r.text));
	const once = rows.filter((r) => r.dates.length === 1).map((r) => inline(r.text));

	blocks.push("## Goals");
	blocks.push(
		table(
			["Goal", "Days", "Dates"],
			rows.map((r) => [r.text, String(r.dates.length), r.dates.join(", ")])
		)
	);
	blocks.push(`Kept every planner day: ${everyDay.length ? everyDay.join(", ") : "none"}`);
	blocks.push(`Appeared once: ${once.length ? once.join(", ") : "none"}`);
}

function renderCarrying(days: ReportDay[], blocks: string[]): void {
	const plannerDays = days.filter(hasPlanner);
	const lastDay = plannerDays[plannerDays.length - 1];
	const carried = lastDay ? carriedTasks(lastDay) : [];
	blocks.push("## Still carrying");
	if (carried.length === 0) {
		blocks.push("Nothing carried over — clean slate.");
		return;
	}
	blocks.push(
		bullets(carried.map((c) => `${dayCount(c.days)} — ${c.text} (since ${c.since})`))
	);
}

function renderDay(rd: ReportDay, blocks: string[]): void {
	blocks.push(`### ${dayLabel(rd.date)}`);
	if (rd.unreadable) {
		blocks.push("Planner block could not be read.");
		return;
	}
	if (rd.day === null) {
		blocks.push("No planner this day.");
		return;
	}
	const day = rd.day;
	let wrote = false;

	const goals = realGoalTexts(day);
	if (goals.length > 0) {
		blocks.push(`**Goals:**\n${bullets(goals)}`);
		wrote = true;
	}

	const big6 = realBig6(day);
	if (big6.length > 0) {
		const items = big6.map((b) => {
			// Not Markdown checkboxes on purpose: a generated report must never
			// create new open tasks for the vault inbox to find.
			if (!isDone(b)) return `☐ ${b.text}`;
			const at = timeOf(b.completed);
			return at ? `☑ ${b.text} (done ${at})` : `☑ ${b.text}`;
		});
		blocks.push(`**Big 6:**\n${bullets(items)}`);
		wrote = true;
	}

	const doneToday = realTasks(day)
		.filter((t) => dateOf(t.completed) === rd.date)
		.map((t) => ({ at: timeOf(t.completed), task: t }))
		.sort((a, b) => compareText(a.at, b.at) || compareText(a.task.text, b.task.text));
	if (doneToday.length > 0) {
		const items = doneToday.map(({ at, task }) => {
			let line = at ? `${at} — ${task.text}` : task.text;
			if (task.source) line += ` (from ${task.source.path})`;
			if (task.carriedFrom) line += ` (carried since ${task.carriedFrom})`;
			return line;
		});
		blocks.push(`**Done today:**\n${bullets(items)}`);
		wrote = true;
	}

	const taskById = new Map(day.tasks.map((t) => [t.id, t] as const));
	const rows: string[][] = [];
	for (const [slot, block] of sortedBlocks(day)) {
		if (!isPlanned(block) && !hasActual(block)) continue;
		const parts: string[] = [];
		if (block.taskId) {
			const task = taskById.get(block.taskId);
			parts.push(task ? `[${task.text}]` : "[missing task]");
		}
		if (!isBlank(block.text)) parts.push(block.text);
		rows.push([slot, parts.join(" "), block.actual ?? ""]);
	}
	if (rows.length > 0) {
		blocks.push(`**Plan vs actually:**\n\n${table(["Slot", "Planned", "Actually"], rows)}`);
		wrote = true;
	}

	if (!wrote) blocks.push("Nothing recorded.");
}

/** Build the Markdown review report. Output is deterministic and ends with one "\n". */
export function buildReport(days: ReportDay[], opts: ReportOptions): string {
	const blocks: string[] = [];
	renderHeader(days, opts, blocks);
	renderScorecard(days, opts, blocks);
	renderGoals(days, blocks);
	renderCarrying(days, blocks);
	blocks.push("## Day by day");
	for (const rd of days) renderDay(rd, blocks);
	return blocks.join("\n\n") + "\n";
}
