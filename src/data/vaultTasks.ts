// Pure vault-task helpers. Nothing in src/data/ may import from "obsidian".
//
// The plugin scans every note for markdown checkbox lines ("- [ ] …") and
// shows them in a filterable inbox. This module parses one such line into a
// VaultTask, filters and sorts the resulting list, rewrites a line as
// completed, and evaluates the folder include/exclude rules from settings.
// Every "today"/"now" value arrives as a parameter, so the module is
// deterministic and runs headless under node:test.

import { DueFilter, TaskFilter, TaskSort, VaultTask } from "./types";

// ---------------------------------------------------------------------------
// Line grammar
// ---------------------------------------------------------------------------

/**
 * indent · list marker ("-", "*", "+", "1.", "1)") · whitespace · "[" + exactly
 * one character + "]" · at least one whitespace · content (may be empty).
 * Groups: 1 indent, 2 marker, 3 gap, 4 checkbox char, 5 gap, 6 content.
 */
const TASK_LINE_RE = /^(\s*)([-*+]|\d+[.)])(\s+)\[(.)\](\s+)(.*)$/u;

/** "📅 2026-09-05" (an optional U+FE0F variation selector is tolerated). */
const DUE_EMOJI_RE = /📅\uFE0F?\s*(\d{4}-\d{2}-\d{2})(?!\d)/u;
/** "[due:: 2026-09-05]" or "(due:: 2026-09-05)". */
const DUE_FIELD_RE = /[\[(]due::\s*(\d{4}-\d{2}-\d{2})(?!\d)/iu;
/** "➕ 2026-08-30". */
const CREATED_EMOJI_RE = /➕\uFE0F?\s*(\d{4}-\d{2}-\d{2})(?!\d)/u;
/** "[created:: 2026-08-30]" or "(created:: 2026-08-30)". */
const CREATED_FIELD_RE = /[\[(]created::\s*(\d{4}-\d{2}-\d{2})(?!\d)/iu;

/** Every Tasks-plugin date marker except ✅, followed by its date. */
const EMOJI_DATE_RE = /(?:📅|➕|⏳|🛫|❌)\uFE0F?\s*\d{4}-\d{2}-\d{2}(?!\d)/gu;
/** "✅ 2026-09-02" with an optional " 14:35" time (what completeTaskLine writes). */
const DONE_STAMP_RE = /✅\uFE0F?\s*\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?(?!\d)/gu;
/** Dataview inline fields for the date keys this module understands. */
const FIELD_STRIP_RE =
	/\[(?:due|created|completion|start|scheduled)::[^\]]*\]|\((?:due|created|completion|start|scheduled)::[^)]*\)/giu;

/** "#tag" tokens: start with a letter or "_", then letters/digits/"_"/"-"/"/". */
const TAG_RE = /(^|\s)#([A-Za-z_][\w\/-]*)/g;

const DAY_MS = 86400000;

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function compareStrings(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Ascending, with null sorting after every real value. */
function compareNullableAsc(a: string | null, b: string | null): number {
	if (a === null && b === null) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return compareStrings(a, b);
}

/** Split a trailing "\r" off a raw line so CRLF notes parse like LF ones. */
function splitCR(raw: string): { line: string; cr: string } {
	return raw.endsWith("\r")
		? { line: raw.slice(0, -1), cr: "\r" }
		: { line: raw, cr: "" };
}

/** First capture group of the first pattern that matches, else null. */
function firstDate(content: string, patterns: RegExp[]): string | null {
	for (const re of patterns) {
		const m = re.exec(content);
		const d = m?.[1];
		if (d) return d;
	}
	return null;
}

function extractTags(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(TAG_RE)) {
		const tag = m[2]?.toLowerCase();
		if (tag !== undefined && !out.includes(tag)) out.push(tag);
	}
	return out;
}

/** Strip date markers and inline date fields, then collapse whitespace. */
function cleanText(content: string): string {
	return content
		.replace(DONE_STAMP_RE, " ")
		.replace(EMOJI_DATE_RE, " ")
		.replace(FIELD_STRIP_RE, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Trim a folder/note rule and strip leading/trailing slashes; "" when empty. */
function normalizeRule(rule: string | null | undefined): string {
	if (typeof rule !== "string") return "";
	return rule.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalizeRules(rules: string[]): string[] {
	const out: string[] = [];
	for (const r of rules) {
		const n = normalizeRule(r);
		if (n !== "") out.push(n);
	}
	return out;
}

/** A rule matches the note itself or anything nested under a folder of that name. */
function pathMatchesRule(path: string, rule: string): boolean {
	return path === rule || path.startsWith(rule + "/");
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse one line of a note. Returns null unless the line is a checkbox list
 * item. A trailing "\r" is tolerated for parsing but kept in `raw`, which is
 * the stable key used to re-find the line later.
 */
export function parseTaskLine(
	raw: string,
	path: string,
	lineNumber: number,
	fallbackCreated: string | null
): VaultTask | null {
	const { line } = splitCR(raw);
	const m = TASK_LINE_RE.exec(line);
	if (!m) return null;
	const box = m[4] ?? "";
	const content = m[6] ?? "";
	const text = cleanText(content);
	return {
		path,
		lineNumber,
		raw,
		text,
		tags: extractTags(text),
		due: firstDate(content, [DUE_EMOJI_RE, DUE_FIELD_RE]),
		createdDate:
			firstDate(content, [CREATED_EMOJI_RE, CREATED_FIELD_RE]) ??
			fallbackCreated,
		done: box !== " ",
	};
}

// ---------------------------------------------------------------------------
// Filtering and sorting
// ---------------------------------------------------------------------------

function matchesDue(
	due: string | null,
	mode: DueFilter,
	today: string,
	weekEnd: string
): boolean {
	switch (mode) {
		case "overdue":
			return due !== null && due < today;
		case "today":
			return due === today;
		case "week":
			return due !== null && due >= today && due <= weekEnd;
		case "none":
			return due === null;
		default:
			// "any" — and any stale value persisted from an older settings file.
			return true;
	}
}

function compareTasks(a: VaultTask, b: VaultTask, sort: TaskSort): number {
	if (sort === "due") {
		const c = compareNullableAsc(a.due, b.due);
		if (c !== 0) return c;
	} else if (sort === "age") {
		const c = compareNullableAsc(a.createdDate, b.createdDate);
		if (c !== 0) return c;
	}
	return compareStrings(a.path, b.path) || a.lineNumber - b.lineNumber;
}

/** Stable sort into a new array (input order is the final tie-break). */
function sortTasks(tasks: VaultTask[], sort: TaskSort): VaultTask[] {
	return tasks
		.map((task, index) => ({ task, index }))
		.sort((x, y) => compareTasks(x.task, y.task, sort) || x.index - y.index)
		.map((d) => d.task);
}

/**
 * Apply the inbox filter bar and sort order. `today` is "YYYY-MM-DD"; date
 * strings are compared lexically. Never mutates `tasks`.
 */
export function applyFilter(
	tasks: VaultTask[],
	filter: TaskFilter,
	today: string
): VaultTask[] {
	const query = typeof filter.query === "string" ? filter.query : "";
	const words = query
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w !== "");
	const tag =
		typeof filter.tag === "string"
			? filter.tag.trim().replace(/^#/, "").toLowerCase()
			: "";
	const folder = normalizeRule(filter.folder);
	const weekEnd = addDays(today, 6);

	const kept = tasks.filter((t) => {
		if (words.length > 0) {
			const text = t.text.toLowerCase();
			const path = t.path.toLowerCase();
			for (const w of words) {
				if (!text.includes(w) && !path.includes(w)) return false;
			}
		}
		if (tag !== "") {
			const hit = t.tags.some((raw) => {
				const x = raw.toLowerCase();
				return x === tag || x.startsWith(tag + "/");
			});
			if (!hit) return false;
		}
		if (folder !== "" && !pathMatchesRule(t.path, folder)) return false;
		return matchesDue(t.due, filter.due, today, weekEnd);
	});
	return sortTasks(kept, filter.sort);
}

// ---------------------------------------------------------------------------
// Completing a line
// ---------------------------------------------------------------------------

/**
 * Rewrite an open task line as done: the first "[ ]" becomes "[x]" and
 * " ✅ <stamp>" is appended (before any trailing "\r"). Trailing whitespace
 * on the content is dropped so the stamp sits one space after the text.
 * Lines that are not open tasks come back unchanged.
 */
export function completeTaskLine(raw: string, stamp: string): string {
	const { line, cr } = splitCR(raw);
	const m = TASK_LINE_RE.exec(line);
	if (!m || m[4] !== " ") return raw;
	const head = `${m[1] ?? ""}${m[2] ?? ""}${m[3] ?? ""}`;
	const body = `${m[5] ?? ""}${m[6] ?? ""}`.trimEnd();
	return `${head}[x]${body} ✅ ${stamp}${cr}`;
}

// ---------------------------------------------------------------------------
// Folder rules
// ---------------------------------------------------------------------------

/**
 * Evaluate the settings' include/exclude rules for a note path. Rules are
 * folder paths or note paths; excludes always win; with no includes every
 * non-excluded note is allowed. Case-sensitive, like vault paths.
 */
export function folderRulesAllow(
	path: string,
	includes: string[],
	excludes: string[]
): boolean {
	const inc = normalizeRules(includes);
	const exc = normalizeRules(excludes);
	if (exc.some((r) => pathMatchesRule(path, r))) return false;
	if (inc.length === 0) return true;
	return inc.some((r) => pathMatchesRule(path, r));
}

// ---------------------------------------------------------------------------
// Filter-bar option lists
// ---------------------------------------------------------------------------

/** Every tag seen across the tasks, sorted, unique. */
export function collectTags(tasks: VaultTask[]): string[] {
	const set = new Set<string>();
	for (const t of tasks) for (const tag of t.tags) set.add(tag);
	return Array.from(set).sort(compareStrings);
}

/** Every top-level folder seen across the tasks, sorted, unique (root notes add nothing). */
export function collectFolders(tasks: VaultTask[]): string[] {
	const set = new Set<string>();
	for (const t of tasks) {
		const i = t.path.indexOf("/");
		if (i > 0) set.add(t.path.slice(0, i));
	}
	return Array.from(set).sort(compareStrings);
}

// ---------------------------------------------------------------------------
// Date math (UTC, so DST can never skip or repeat a day)
// ---------------------------------------------------------------------------

/** Epoch ms for a "YYYY-MM-DD" calendar date, or null when not a real date. */
function parseUtcDate(date: string): number | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!m) return null;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	// setUTCFullYear avoids Date.UTC's 0–99 → 1900s remapping.
	const dt = new Date(0);
	dt.setUTCFullYear(y, mo - 1, d);
	if (
		dt.getUTCFullYear() !== y ||
		dt.getUTCMonth() !== mo - 1 ||
		dt.getUTCDate() !== d
	) {
		return null; // e.g. "2026-02-30" or month 13 rolled over
	}
	return dt.getTime();
}

function formatUtcDate(ms: number): string {
	const dt = new Date(ms);
	const y = dt.getUTCFullYear();
	if (!Number.isFinite(y)) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${String(y).padStart(4, "0")}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** "YYYY-MM-DD" plus n whole days (n may be negative). Invalid input → "". */
export function addDays(date: string, n: number): string {
	const base = parseUtcDate(date);
	if (base === null || !Number.isFinite(n)) return "";
	return formatUtcDate(base + Math.trunc(n) * DAY_MS);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). Invalid input → 0. */
export function daysBetween(from: string, to: string): number {
	const a = parseUtcDate(from);
	const b = parseUtcDate(to);
	if (a === null || b === null) return 0;
	return Math.round((b - a) / DAY_MS);
}
