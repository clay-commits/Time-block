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

export interface Task {
	id: string;
	text: string;
	created: IsoStamp;
	completed: IsoStamp | null;
	/** Date (YYYY-MM-DD) of the day this task was first entered, if carried over. */
	carriedFrom?: string;
	/** Slot this task is placed on, if any. Task is the source of truth for placement. */
	slot?: SlotKey;
}

export interface Block {
	text: string;
	/** Task placed on this slot, mirrored from Task.slot during normalization. */
	taskId?: string;
	created: IsoStamp;
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
