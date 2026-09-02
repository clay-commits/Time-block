// Pure data model. Nothing in src/data/ may import from "obsidian" —
// these modules run headless under node:test.

export const SCHEMA_VERSION = 1;

/** ISO-8601 timestamp with local UTC offset, e.g. "2026-09-01T07:15:00-06:00". */
export type IsoStamp = string;

/** "HH:MM" 24-hour slot key, e.g. "06:15". */
export type SlotKey = string;

export interface Goal {
	id: string;
	text: string;
	created: IsoStamp;
}

export interface Big6Item {
	id: string;
	text: string;
	created: IsoStamp;
	completed: IsoStamp | null;
}

/** Where an adopted vault task came from: its note and the raw checkbox line. */
export interface TaskSource {
	path: string;
	line: string;
}

export interface Task {
	id: string;
	text: string;
	created: IsoStamp;
	completed: IsoStamp | null;
	/** Date (YYYY-MM-DD) of the day this task was first entered, if carried over. */
	carriedFrom?: string;
	/** Slot this task is placed on, if any. Task is the source of truth for placement. */
	slot?: SlotKey;
	/** Set when the task was adopted from a "- [ ]" line elsewhere in the vault. */
	source?: TaskSource;
}

export interface Block {
	/** What was planned for this slot. */
	text: string;
	/** What actually happened in this slot (the "actually" lane). */
	actual?: string;
	/** Task placed on this slot, mirrored from Task.slot during normalization. */
	taskId?: string;
	created: IsoStamp;
	/** Stamped the first time something is written into the "actually" lane. */
	actualCreated?: IsoStamp;
}

export interface DayData {
	version: number;
	date: string; // YYYY-MM-DD
	goals: Goal[]; // max 3
	goalsGhost: string[]; // yesterday's goal texts, shown as placeholders
	big6: Big6Item[]; // max 6
	tasks: Task[];
	blocks: Record<SlotKey, Block>;
	notes: string;
}

export interface ListItem {
	id: string;
	text: string;
	created: IsoStamp;
	completed: IsoStamp | null;
}

export interface UserList {
	id: string;
	name: string;
	created: IsoStamp;
	items: ListItem[];
}

export interface ListsData {
	version: number;
	lists: UserList[];
}

export function emptyDay(date: string): DayData {
	return {
		version: SCHEMA_VERSION,
		date,
		goals: [],
		goalsGhost: [],
		big6: [],
		tasks: [],
		blocks: {},
		notes: "",
	};
}

export function emptyLists(): ListsData {
	return { version: SCHEMA_VERSION, lists: [] };
}

// ---------------------------------------------------------------------------
// Vault-wide task inbox (checkbox lines found anywhere in the vault)
// ---------------------------------------------------------------------------

/** One "- [ ] …" line found in a vault note. Pure data; produced by the scanner. */
export interface VaultTask {
	/** Note path, e.g. "Projects/ClientX/notes.md". */
	path: string;
	/** 0-based line index at scan time (may drift; `raw` is the stable key). */
	lineNumber: number;
	/** The full raw line, used to re-find the task when completing it. */
	raw: string;
	/** Task text with the list marker/checkbox removed and metadata markers trimmed. */
	text: string;
	/** Lowercased tags without '#'. */
	tags: string[];
	/** Due date YYYY-MM-DD from "📅 YYYY-MM-DD", "[due:: …]" or "(due:: …)", else null. */
	due: string | null;
	/** Creation date YYYY-MM-DD from "➕ YYYY-MM-DD", else the note's creation date if known, else null. */
	createdDate: string | null;
	/** True when the checkbox is anything other than "[ ]". */
	done: boolean;
}

export type DueFilter = "any" | "overdue" | "today" | "week" | "none";
export type TaskSort = "due" | "age" | "path";

/** Filter-bar state for the vault task list (persisted in plugin settings). */
export interface TaskFilter {
	query: string;
	tag: string | null;
	folder: string | null;
	due: DueFilter;
	sort: TaskSort;
}

export const DEFAULT_TASK_FILTER: TaskFilter = {
	query: "",
	tag: null,
	folder: null,
	due: "any",
	sort: "due",
};
