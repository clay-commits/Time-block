import { dump, load } from "js-yaml";
import {
	Big6Item,
	Block,
	DayData,
	Goal,
	ListItem,
	ListsData,
	SCHEMA_VERSION,
	Task,
	UserList,
	emptyDay,
	emptyLists,
} from "./types";
import { parseHM } from "./slots";

export class TimeblockParseError extends Error {
	constructor(message: string, public readonly cause?: unknown) {
		super(message);
		this.name = "TimeblockParseError";
	}
}

const DUMP_OPTS = {
	lineWidth: -1,
	noRefs: true,
	sortKeys: false,
} as const;

// ---------------------------------------------------------------------------
// Coercion helpers — parsing is tolerant: well-formed entries are kept,
// malformed entries are dropped, and only YAML that fails to load at all
// (or is not a mapping) raises TimeblockParseError.
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = ""): string {
	if (typeof v === "string") return v;
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	if (v instanceof Date) return v.toISOString();
	return fallback;
}

function asStamp(v: unknown): string {
	if (v instanceof Date) return v.toISOString();
	return typeof v === "string" ? v : "";
}

/** Coerce a day-date value to "YYYY-MM-DD" (unquoted YAML dates load as Date). */
function asDateStr(v: unknown): string {
	if (v instanceof Date) {
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
	}
	return typeof v === "string" ? v : "";
}

function asCompleted(v: unknown): string | null {
	if (v == null || v === false) return null;
	if (v instanceof Date) return v.toISOString();
	if (typeof v === "string") return v === "" ? null : v;
	return null;
}

function asArray(v: unknown): unknown[] {
	return Array.isArray(v) ? v : [];
}

function recoveredId(prefix: string, index: number): string {
	return `${prefix}-recovered-${index}`;
}

// ---------------------------------------------------------------------------
// Day
// ---------------------------------------------------------------------------

function orderedGoal(g: Goal): Record<string, unknown> {
	return { id: g.id, text: g.text, created: g.created };
}

function orderedBig6(b: Big6Item): Record<string, unknown> {
	return { id: b.id, text: b.text, created: b.created, completed: b.completed };
}

function orderedTask(t: Task): Record<string, unknown> {
	const o: Record<string, unknown> = {
		id: t.id,
		text: t.text,
		created: t.created,
		completed: t.completed,
	};
	if (t.carriedFrom) o.carriedFrom = t.carriedFrom;
	if (t.slot) o.slot = t.slot;
	return o;
}

function orderedBlock(b: Block): Record<string, unknown> {
	const o: Record<string, unknown> = { text: b.text };
	if (b.taskId) o.taskId = b.taskId;
	o.created = b.created;
	return o;
}

/** Serialize a day to YAML with deterministic key order (blocks sorted by slot). */
export function serializeDay(day: DayData): string {
	const blocks: Record<string, unknown> = {};
	for (const key of Object.keys(day.blocks).sort()) {
		const b = day.blocks[key];
		if (b) blocks[key] = orderedBlock(b);
	}
	const doc: Record<string, unknown> = {
		version: day.version,
		date: day.date,
		goals: day.goals.map(orderedGoal),
		goalsGhost: [...day.goalsGhost],
		big6: day.big6.map(orderedBig6),
		tasks: day.tasks.map(orderedTask),
		blocks,
		notes: day.notes,
	};
	return dump(doc, DUMP_OPTS);
}

function parseGoal(v: unknown, index: number): Goal | null {
	if (!isRecord(v)) return null;
	const text = asString(v.text, "");
	if (text === "") return null;
	return {
		id: asString(v.id) || recoveredId("goal", index),
		text,
		created: asStamp(v.created),
	};
}

function parseBig6(v: unknown, index: number): Big6Item | null {
	if (!isRecord(v)) return null;
	const text = asString(v.text, "");
	if (text === "") return null;
	return {
		id: asString(v.id) || recoveredId("big6", index),
		text,
		created: asStamp(v.created),
		completed: asCompleted(v.completed),
	};
}

function parseTask(v: unknown, index: number): Task | null {
	if (!isRecord(v)) return null;
	const text = asString(v.text, "");
	if (text === "") return null;
	const t: Task = {
		id: asString(v.id) || recoveredId("task", index),
		text,
		created: asStamp(v.created),
		completed: asCompleted(v.completed),
	};
	const carriedFrom = asDateStr(v.carriedFrom);
	if (carriedFrom) t.carriedFrom = carriedFrom;
	const slot = asString(v.slot, "");
	if (slot && parseHM(slot) != null) t.slot = slot;
	return t;
}

function parseBlock(v: unknown): Block | null {
	if (typeof v === "string") {
		return v.trim() === "" ? null : { text: v, created: "" };
	}
	if (!isRecord(v)) return null;
	const block: Block = {
		text: asString(v.text, ""),
		created: asStamp(v.created),
	};
	const taskId = asString(v.taskId, "");
	if (taskId) block.taskId = taskId;
	return block;
}

/**
 * Reconcile invariants in place: Task.slot is the source of truth for slot
 * placement (one task per slot, first in array order wins); Block.taskId is
 * derived from it; empty blocks are pruned; goals cap at 3, big6 at 6.
 */
export function normalizeDay(day: DayData): DayData {
	day.goals = day.goals.slice(0, 3);
	day.big6 = day.big6.slice(0, 6);

	const taskById = new Map(day.tasks.map((t) => [t.id, t] as const));
	const claimed = new Map<string, string>(); // slot -> taskId
	for (const t of day.tasks) {
		if (!t.slot) continue;
		if (parseHM(t.slot) == null || claimed.has(t.slot)) {
			delete t.slot;
			continue;
		}
		claimed.set(t.slot, t.id);
	}
	for (const [key, block] of Object.entries(day.blocks)) {
		if (block.taskId && claimed.get(key) !== block.taskId) {
			delete block.taskId;
		}
	}
	for (const [slot, taskId] of claimed) {
		const existing = day.blocks[slot];
		if (existing) {
			existing.taskId = taskId;
		} else {
			const task = taskById.get(taskId);
			day.blocks[slot] = {
				text: "",
				taskId,
				created: task ? task.created : "",
			};
		}
	}
	for (const key of Object.keys(day.blocks)) {
		const b = day.blocks[key];
		if (b && !b.taskId && b.text.trim() === "") delete day.blocks[key];
	}
	return day;
}

/**
 * Parse a day block. Throws TimeblockParseError on YAML that cannot be loaded
 * or is not a mapping; a blank block yields an empty day for fallbackDate.
 */
export function parseDay(source: string, fallbackDate: string): DayData {
	let raw: unknown;
	try {
		raw = load(source);
	} catch (e) {
		throw new TimeblockParseError(
			e instanceof Error ? e.message : "Invalid YAML",
			e
		);
	}
	if (raw == null || (typeof raw === "string" && raw.trim() === "")) {
		return emptyDay(fallbackDate);
	}
	if (!isRecord(raw)) {
		throw new TimeblockParseError(
			"The timeblock block is not a YAML mapping."
		);
	}

	const day = emptyDay(fallbackDate);
	const version = Number(raw.version);
	day.version = Number.isFinite(version) && version > 0 ? version : SCHEMA_VERSION;
	day.date = asDateStr(raw.date) || fallbackDate;
	day.goals = asArray(raw.goals)
		.map((g, i) => parseGoal(g, i))
		.filter((g): g is Goal => g !== null);
	day.goalsGhost = asArray(raw.goalsGhost)
		.map((s) => asString(s, ""))
		.filter((s) => s !== "");
	day.big6 = asArray(raw.big6)
		.map((b, i) => parseBig6(b, i))
		.filter((b): b is Big6Item => b !== null);
	day.tasks = asArray(raw.tasks)
		.map((t, i) => parseTask(t, i))
		.filter((t): t is Task => t !== null);

	// Drop duplicate task ids (first occurrence wins) so ids stay unique.
	const seen = new Set<string>();
	day.tasks = day.tasks.filter((t) => {
		if (seen.has(t.id)) return false;
		seen.add(t.id);
		return true;
	});

	if (isRecord(raw.blocks)) {
		for (const [key, value] of Object.entries(raw.blocks)) {
			if (parseHM(key) == null) continue;
			const block = parseBlock(value);
			if (block) day.blocks[key] = block;
		}
	}
	day.notes = asString(raw.notes, "");
	return normalizeDay(day);
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

function orderedListItem(i: ListItem): Record<string, unknown> {
	return { id: i.id, text: i.text, created: i.created, completed: i.completed };
}

function orderedList(l: UserList): Record<string, unknown> {
	return {
		id: l.id,
		name: l.name,
		created: l.created,
		items: l.items.map(orderedListItem),
	};
}

export function serializeLists(data: ListsData): string {
	const doc: Record<string, unknown> = {
		version: data.version,
		lists: data.lists.map(orderedList),
	};
	return dump(doc, DUMP_OPTS);
}

function parseListItem(v: unknown, index: number): ListItem | null {
	if (!isRecord(v)) return null;
	const text = asString(v.text, "");
	if (text === "") return null;
	return {
		id: asString(v.id) || recoveredId("item", index),
		text,
		created: asStamp(v.created),
		completed: asCompleted(v.completed),
	};
}

function parseList(v: unknown, index: number): UserList | null {
	if (!isRecord(v)) return null;
	const name = asString(v.name, "");
	if (name === "") return null;
	return {
		id: asString(v.id) || recoveredId("list", index),
		name,
		created: asStamp(v.created),
		items: asArray(v.items)
			.map((i, idx) => parseListItem(i, idx))
			.filter((i): i is ListItem => i !== null),
	};
}

export function parseLists(source: string): ListsData {
	let raw: unknown;
	try {
		raw = load(source);
	} catch (e) {
		throw new TimeblockParseError(
			e instanceof Error ? e.message : "Invalid YAML",
			e
		);
	}
	if (raw == null || (typeof raw === "string" && raw.trim() === "")) {
		return emptyLists();
	}
	if (!isRecord(raw)) {
		throw new TimeblockParseError(
			"The timeblock-lists block is not a YAML mapping."
		);
	}
	const data = emptyLists();
	const version = Number(raw.version);
	data.version =
		Number.isFinite(version) && version > 0 ? version : SCHEMA_VERSION;
	data.lists = asArray(raw.lists)
		.map((l, i) => parseList(l, i))
		.filter((l): l is UserList => l !== null);
	return data;
}
