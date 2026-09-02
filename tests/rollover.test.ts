import { test } from "node:test";
import assert from "node:assert/strict";
import { seedDay, previousDates } from "../src/data/rollover";
import { DayData, emptyDay } from "../src/data/types";

function prevDay(): DayData {
	const d = emptyDay("2026-08-31");
	d.goals = [
		{ id: "g1", text: "Grow the company", created: "c" },
		{ id: "g2", text: "Stay healthy", created: "c" },
	];
	d.big6 = [
		{ id: "b1", text: "old big6", created: "c", completed: null },
	];
	d.tasks = [
		{ id: "t-open", text: "still open", created: "2026-08-31T08:00:00-06:00", completed: null, slot: "09:00" },
		{ id: "t-done", text: "finished", created: "c", completed: "2026-08-31T17:00:00-06:00" },
		{ id: "t-carried", text: "carried twice", created: "2026-08-29T08:00:00-06:00", completed: null, carriedFrom: "2026-08-29" },
		{ id: "t-open", text: "duplicate id", created: "c", completed: null },
		{ id: "t-empty", text: "   ", created: "c", completed: null },
	];
	d.blocks = { "09:00": { text: "work", taskId: "t-open", created: "c" } };
	d.notes = "yesterday's notes";
	return d;
}

test("seedDay with no previous day is a blank day", () => {
	const day = seedDay("2026-09-01", null);
	assert.deepEqual(day, emptyDay("2026-09-01"));
});

test("only unfinished tasks carry over, keeping their original ids", () => {
	const day = seedDay("2026-09-01", prevDay());
	const ids = day.tasks.map((t) => t.id);
	assert.deepEqual(ids, ["t-open", "t-carried"]);
	assert.equal(day.tasks[0]!.created, "2026-08-31T08:00:00-06:00");
});

test("carriedFrom is the EARLIEST origin day", () => {
	const day = seedDay("2026-09-01", prevDay());
	assert.equal(day.tasks[0]!.carriedFrom, "2026-08-31"); // first carry
	assert.equal(day.tasks[1]!.carriedFrom, "2026-08-29"); // kept from before
});

test("slot placements are cleared on rollover", () => {
	const day = seedDay("2026-09-01", prevDay());
	assert.equal(day.tasks[0]!.slot, undefined);
	assert.deepEqual(day.blocks, {});
});

test("duplicate ids in the previous day are deduped (first wins)", () => {
	const day = seedDay("2026-09-01", prevDay());
	assert.equal(day.tasks.filter((t) => t.id === "t-open").length, 1);
	assert.equal(day.tasks.find((t) => t.id === "t-open")!.text, "still open");
});

test("goals and big6 seed EMPTY; goalsGhost carries yesterday's goal texts", () => {
	const day = seedDay("2026-09-01", prevDay());
	assert.deepEqual(day.goals, []);
	assert.deepEqual(day.big6, []);
	assert.deepEqual(day.goalsGhost, ["Grow the company", "Stay healthy"]);
	assert.equal(day.notes, "");
});

test("goalsGhost falls through a day with no typed goals", () => {
	const prev = prevDay();
	prev.goals = [];
	prev.goalsGhost = ["Ghost from two days ago"];
	const day = seedDay("2026-09-01", prev);
	assert.deepEqual(day.goalsGhost, ["Ghost from two days ago"]);
});

test("seedDay is deterministic/idempotent for the same inputs", () => {
	const a = seedDay("2026-09-01", prevDay());
	const b = seedDay("2026-09-01", prevDay());
	assert.deepEqual(a, b);
});

test("seeding from an already-seeded (untouched) day does not duplicate tasks", () => {
	const day1 = seedDay("2026-09-01", prevDay());
	const day2 = seedDay("2026-09-02", day1);
	assert.equal(day2.tasks.length, day1.tasks.length);
	assert.deepEqual(
		day2.tasks.map((t) => t.id),
		day1.tasks.map((t) => t.id)
	);
	// origins stay the earliest
	assert.equal(day2.tasks[0]!.carriedFrom, "2026-08-31");
	assert.equal(day2.tasks[1]!.carriedFrom, "2026-08-29");
});

test("previousDates walks back the right days, most recent first", () => {
	assert.deepEqual(previousDates("2026-09-01", 3), [
		"2026-08-31",
		"2026-08-30",
		"2026-08-29",
	]);
});

test("previousDates crosses month/year boundaries and leap days", () => {
	assert.deepEqual(previousDates("2026-01-01", 1), ["2025-12-31"]);
	assert.deepEqual(previousDates("2024-03-01", 1), ["2024-02-29"]);
	assert.deepEqual(previousDates("2023-03-01", 1), ["2023-02-28"]);
});

test("previousDates rejects invalid input", () => {
	assert.deepEqual(previousDates("not-a-date", 7), []);
	assert.deepEqual(previousDates("2026-09-01", 0), []);
	assert.deepEqual(previousDates("2026-09-01", -5), []);
});

test("adopted vault tasks keep their source (and line hint) when carried over", () => {
	const prev = emptyDay("2026-09-01");
	prev.tasks = [
		{
			id: "t-src",
			text: "Call the bank",
			created: "2026-09-01T09:00:00-06:00",
			completed: null,
			source: { path: "Projects/Money.md", line: "- [ ] Call the bank", lineNumber: 12 },
		},
	];
	const day = seedDay("2026-09-02", prev);
	assert.deepEqual(day.tasks[0]!.source, {
		path: "Projects/Money.md",
		line: "- [ ] Call the bank",
		lineNumber: 12,
	});
	assert.equal(day.tasks[0]!.carriedFrom, "2026-09-01");
});
