import { test } from "node:test";
import assert from "node:assert/strict";
import {
	ReportDay,
	ReportOptions,
	buildReport,
	dateRange,
	summarizeDay,
	timeOf,
	weekdayName,
} from "../src/data/report";
import { DayData, emptyDay } from "../src/data/types";

// ---------------------------------------------------------------------------
// Fixture: two hand-built days. Every expected number below is computed by
// hand from these, so a wrong count in the module fails loudly.
// ---------------------------------------------------------------------------

const OPTS: ReportOptions = {
	start: "2026-09-01",
	end: "2026-09-02",
	generatedAt: "2026-09-03T08:00:00-06:00",
};

function day1(): DayData {
	const d = emptyDay("2026-09-01");
	d.goals = [
		{ id: "g1", text: "Ship Timeblock", created: "2026-09-01T06:00:00-06:00" },
		{ id: "g2", text: "Exercise", created: "2026-09-01T06:00:00-06:00" },
	];
	d.big6 = [
		{ id: "b1", text: "Call the bank", created: "c", completed: "2026-09-01T11:00:00-06:00" },
		{ id: "b2", text: "Draft memo", created: "c", completed: null },
	];
	d.tasks = [
		{
			id: "t1",
			text: "Write report",
			created: "c",
			completed: "2026-09-01T09:30:00-06:00",
			slot: "07:00",
		},
		{
			id: "t2",
			text: "Call bank",
			created: "c",
			completed: null,
			carriedFrom: "2026-08-28",
			slot: "08:00",
		},
		{
			id: "t3",
			text: "Buy milk",
			created: "c",
			completed: "2026-09-01T18:05:00-06:00",
			source: { path: "Home/errands.md", line: "- [ ] Buy milk" },
		},
		{ id: "t4", text: "Old thing", created: "c", completed: null, carriedFrom: "2026-08-30" },
	];
	// Deliberately NOT in slot order.
	d.blocks = {
		"08:00": { text: "phone", taskId: "t2", created: "c" }, // planned (text + task)
		"07:00": { text: "", taskId: "t1", created: "c", actual: "wrote half" }, // planned (task), actual
		"13:00": { text: "  ", created: "c" }, // blank: neither planned nor actual
		"06:00": { text: "coffee", created: "c" }, // planned (text)
		"12:00": { text: "", created: "c", actual: "lunch ran long" }, // actual only
	};
	return d;
}

function day2(): DayData {
	const d = emptyDay("2026-09-02");
	d.goals = [
		{ id: "g3", text: "  ship timeblock ", created: "c" }, // merges with day 1's goal
		{ id: "g4", text: "Read", created: "c" },
		{ id: "g5", text: "   ", created: "c" }, // blank: ignored
	];
	d.big6 = [{ id: "b3", text: "Plan week", created: "c", completed: null }];
	d.tasks = [
		{ id: "t2", text: "Call bank", created: "c", completed: null, carriedFrom: "2026-08-28" },
		{
			id: "t4",
			text: "Old thing",
			created: "c",
			completed: "2026-09-02T08:00:00-06:00",
			carriedFrom: "2026-08-30",
		},
		{ id: "t5", text: "New task", created: "c", completed: null },
		{ id: "t6", text: "Late one", created: "c", completed: "2026-09-03T01:00:00-06:00" }, // after range
		{ id: "t7", text: "Night owl", created: "c", completed: "2026-09-01T23:00:00-06:00" }, // in range, not "today"
	];
	return d;
}

function fixture(): ReportDay[] {
	return [
		{ date: "2026-09-01", day: day1() },
		{ date: "2026-09-02", day: day2() },
	];
}

function bare(date: string): ReportDay {
	return { date, day: emptyDay(date) };
}

const GOLDEN = [
	"# Review: 2026-09-01 to 2026-09-02",
	"",
	"Generated 2026-09-03T08:00:00-06:00.",
	"",
	"2 of 2 days had a planner.",
	"",
	"## Scorecard",
	"",
	"| Measure | Value |",
	"| --- | --- |",
	"| Planned slots | 3 |",
	'| Slots with "actually" filled in | 1 (33%) |',
	'| Unplanned slots with an "actually" entry | 1 |',
	"| Placed tasks done | 1 of 2 |",
	"| Big 6 done | 1 of 3 |",
	"| Tasks completed | 4 |",
	"| Tasks still open on last planner day | 2 |",
	"| Longest-carried task | 5 days — Call bank |",
	"",
	"| Day | Planned | Actually filled | Placed done | Big 6 done |",
	"| --- | --- | --- | --- | --- |",
	"| Tuesday, 2026-09-01 | 3 | 1 (33%) | 1 of 2 | 1 of 2 |",
	"| Wednesday, 2026-09-02 | 0 | 0 (–) | 0 of 0 | 0 of 1 |",
	"",
	"## Goals",
	"",
	"| Goal | Days | Dates |",
	"| --- | --- | --- |",
	"| Ship Timeblock | 2 | 2026-09-01, 2026-09-02 |",
	"| Exercise | 1 | 2026-09-01 |",
	"| Read | 1 | 2026-09-02 |",
	"",
	"Kept every planner day: Ship Timeblock",
	"",
	"Appeared once: Exercise, Read",
	"",
	"## Still carrying",
	"",
	"- 5 days — Call bank (since 2026-08-28)",
	"",
	"## Day by day",
	"",
	"### Tuesday, 2026-09-01",
	"",
	"**Goals:**",
	"- Ship Timeblock",
	"- Exercise",
	"",
	"**Big 6:**",
	"- ☑ Call the bank (done 11:00)",
	"- ☐ Draft memo",
	"",
	"**Done today:**",
	"- 09:30 — Write report",
	"- 18:05 — Buy milk (from Home/errands.md)",
	"",
	"**Plan vs actually:**",
	"",
	"| Slot | Planned | Actually |",
	"| --- | --- | --- |",
	"| 06:00 | coffee |  |",
	"| 07:00 | [Write report] | wrote half |",
	"| 08:00 | [Call bank] phone |  |",
	"| 12:00 |  | lunch ran long |",
	"",
	"### Wednesday, 2026-09-02",
	"",
	"**Goals:**",
	"- ship timeblock",
	"- Read",
	"",
	"**Big 6:**",
	"- ☐ Plan week",
	"",
	"**Done today:**",
	"- 08:00 — Old thing (carried since 2026-08-30)",
	"",
].join("\n");

// ---------------------------------------------------------------------------
// dateRange
// ---------------------------------------------------------------------------

test("dateRange: inclusive normal range", () => {
	assert.deepEqual(dateRange("2026-09-01", "2026-09-03"), [
		"2026-09-01",
		"2026-09-02",
		"2026-09-03",
	]);
	assert.deepEqual(dateRange("2026-09-01", "2026-09-01"), ["2026-09-01"]);
});

test("dateRange: inverted range is empty", () => {
	assert.deepEqual(dateRange("2026-09-03", "2026-09-01"), []);
});

test("dateRange: invalid dates are empty", () => {
	assert.deepEqual(dateRange("nope", "2026-09-01"), []);
	assert.deepEqual(dateRange("2026-09-01", ""), []);
	assert.deepEqual(dateRange("2026-13-01", "2026-13-02"), []);
	assert.deepEqual(dateRange("2026-02-30", "2026-03-01"), []); // rolls over -> rejected
	assert.deepEqual(dateRange("2023-02-29", "2023-03-01"), []); // not a leap year
	assert.deepEqual(dateRange("2026-9-1", "2026-09-02"), []); // must be zero-padded
	assert.deepEqual(dateRange("2026-09-01T00:00", "2026-09-02"), []);
});

test("dateRange: caps at 366 entries", () => {
	const out = dateRange("2024-01-01", "2026-12-31");
	assert.equal(out.length, 366);
	assert.equal(out[0], "2024-01-01");
	assert.equal(out[365], "2024-12-31"); // 2024 is a leap year
	assert.equal(dateRange("2024-01-01", "2024-12-31").length, 366);
	assert.equal(dateRange("2025-01-01", "2025-12-31").length, 365);
});

test("dateRange: leap day and month/year boundaries", () => {
	assert.deepEqual(dateRange("2024-02-28", "2024-03-01"), [
		"2024-02-28",
		"2024-02-29",
		"2024-03-01",
	]);
	assert.deepEqual(dateRange("2023-02-28", "2023-03-01"), ["2023-02-28", "2023-03-01"]);
	assert.deepEqual(dateRange("2026-08-30", "2026-09-02"), [
		"2026-08-30",
		"2026-08-31",
		"2026-09-01",
		"2026-09-02",
	]);
	assert.deepEqual(dateRange("2026-12-30", "2027-01-02"), [
		"2026-12-30",
		"2026-12-31",
		"2027-01-01",
		"2027-01-02",
	]);
});

// ---------------------------------------------------------------------------
// weekdayName / timeOf
// ---------------------------------------------------------------------------

test("weekdayName: UTC weekday, empty for invalid", () => {
	assert.equal(weekdayName("2026-09-01"), "Tuesday");
	assert.equal(weekdayName("2026-09-06"), "Sunday");
	assert.equal(weekdayName("2026-09-07"), "Monday");
	assert.equal(weekdayName("2024-02-29"), "Thursday");
	assert.equal(weekdayName("2026-02-30"), "");
	assert.equal(weekdayName("garbage"), "");
	assert.equal(weekdayName(""), "");
});

test("timeOf: wall-clock from ISO local stamp, empty otherwise", () => {
	assert.equal(timeOf("2026-09-01T14:35:00-06:00"), "14:35");
	assert.equal(timeOf("2026-09-01T00:05:59+05:30"), "00:05");
	assert.equal(timeOf("2026-09-01T23:59"), "23:59");
	assert.equal(timeOf(null), "");
	assert.equal(timeOf(undefined), "");
	assert.equal(timeOf(""), "");
	assert.equal(timeOf("2026-09-01"), "");
	assert.equal(timeOf("2026-09-01Tab:cd:00"), "");
	assert.equal(timeOf("14:35"), "");
});

// ---------------------------------------------------------------------------
// summarizeDay
// ---------------------------------------------------------------------------

test("summarizeDay: counts from the fixture days", () => {
	assert.deepEqual(summarizeDay(day1()), {
		planned: 3,
		actuallyFilled: 1,
		unplannedActual: 1,
		placedDone: 1,
		placedTotal: 2,
		big6Done: 1,
		big6Total: 2,
	});
	assert.deepEqual(summarizeDay(day2()), {
		planned: 0,
		actuallyFilled: 0,
		unplannedActual: 0,
		placedDone: 0,
		placedTotal: 0,
		big6Done: 0,
		big6Total: 1,
	});
	assert.deepEqual(summarizeDay(emptyDay("2026-09-01")), {
		planned: 0,
		actuallyFilled: 0,
		unplannedActual: 0,
		placedDone: 0,
		placedTotal: 0,
		big6Done: 0,
		big6Total: 0,
	});
});

test("summarizeDay: a taskId alone makes a slot planned; blank actual does not count", () => {
	const d = emptyDay("2026-09-01");
	d.tasks = [{ id: "t1", text: "x", created: "c", completed: null, slot: "09:00" }];
	d.blocks = {
		"09:00": { text: "", taskId: "t1", created: "c", actual: "   " },
		"10:00": { text: "", created: "c" },
	};
	const s = summarizeDay(d);
	assert.equal(s.planned, 1);
	assert.equal(s.actuallyFilled, 0);
	assert.equal(s.placedTotal, 1);
});

test("summarizeDay: blank-text Big 6 placeholders are not counted", () => {
	const d = emptyDay("2026-09-01");
	d.big6 = [
		{ id: "b0", text: "", created: "c", completed: null },
		{ id: "b1", text: "real", created: "c", completed: "2026-09-01T10:00:00-06:00" },
	];
	assert.deepEqual(
		{ done: summarizeDay(d).big6Done, total: summarizeDay(d).big6Total },
		{ done: 1, total: 1 }
	);
});

// ---------------------------------------------------------------------------
// buildReport: whole document
// ---------------------------------------------------------------------------

test("buildReport: fixture renders the hand-computed golden document", () => {
	assert.equal(buildReport(fixture(), OPTS), GOLDEN);
});

test("buildReport: header counts planner days and unreadable days", () => {
	const days: ReportDay[] = [
		{ date: "2026-09-01", day: day1() },
		{ date: "2026-09-02", day: null },
		{ date: "2026-09-03", day: null, unreadable: true },
	];
	const out = buildReport(days, { ...OPTS, end: "2026-09-03" });
	assert.ok(out.startsWith("# Review: 2026-09-01 to 2026-09-03\n\nGenerated 2026-09-03T08:00:00-06:00.\n\n"));
	assert.ok(out.includes("\n1 of 3 days had a planner, 1 unreadable.\n"));
	const noUnreadable = buildReport(fixture(), OPTS);
	assert.ok(noUnreadable.includes("\n2 of 2 days had a planner.\n"));
	assert.ok(!noUnreadable.includes("unreadable"));
});

test("buildReport: an unreadable day is not a planner day even if a DayData is attached", () => {
	const days: ReportDay[] = [
		{ date: "2026-09-01", day: day1(), unreadable: true },
		{ date: "2026-09-02", day: null },
	];
	const out = buildReport(days, OPTS);
	assert.ok(out.includes("\n0 of 2 days had a planner, 1 unreadable.\n"));
	assert.ok(out.includes("### Tuesday, 2026-09-01\n\nPlanner block could not be read.\n"));
	assert.ok(!out.includes("Ship Timeblock"));
});

// ---------------------------------------------------------------------------
// Scorecard
// ---------------------------------------------------------------------------

test("scorecard: percent formatting, including no planned slots", () => {
	const d = emptyDay("2026-09-01");
	d.blocks = {
		"06:00": { text: "a", created: "c", actual: "did a" },
		"07:00": { text: "b", created: "c" },
		"08:00": { text: "c", created: "c" },
	};
	const out = buildReport([{ date: "2026-09-01", day: d }], { ...OPTS, end: "2026-09-01" });
	assert.ok(out.includes('| Slots with "actually" filled in | 1 (33%) |'));
	assert.ok(out.includes("| Tuesday, 2026-09-01 | 3 | 1 (33%) | 0 of 0 | 0 of 0 |"));

	const none = buildReport([bare("2026-09-01")], { ...OPTS, end: "2026-09-01" });
	assert.ok(none.includes('| Slots with "actually" filled in | 0 (–) |'));
	assert.ok(none.includes("| Planned slots | 0 |"));

	const empty = buildReport([], OPTS);
	assert.ok(empty.includes("\n0 of 0 days had a planner.\n"));
	assert.ok(empty.includes('| Slots with "actually" filled in | 0 (–) |'));
	assert.ok(empty.includes("| Tasks still open on last planner day | 0 |"));
	assert.ok(empty.includes("| Longest-carried task | none |"));
});

test("scorecard: tasks completed counts by date part within the range only", () => {
	const d = emptyDay("2026-09-01");
	d.tasks = [
		{ id: "a", text: "in", created: "c", completed: "2026-09-01T01:00:00-06:00" },
		{ id: "b", text: "in-end", created: "c", completed: "2026-09-02T23:59:00-06:00" },
		{ id: "c", text: "before", created: "c", completed: "2026-08-31T23:59:00-06:00" },
		{ id: "d", text: "after", created: "c", completed: "2026-09-03T00:00:00-06:00" },
		{ id: "e", text: "open", created: "c", completed: null },
		{ id: "f", text: "bad stamp", created: "c", completed: "yesterday" },
	];
	const out = buildReport([{ date: "2026-09-01", day: d }], OPTS);
	assert.ok(out.includes("| Tasks completed | 2 |"));
});

test("scorecard: open count and longest-carried use the LAST planner day", () => {
	const first = emptyDay("2026-09-01");
	first.tasks = [
		{ id: "x", text: "ancient", created: "c", completed: null, carriedFrom: "2026-01-01" },
	];
	const last = emptyDay("2026-09-02");
	last.tasks = [
		{ id: "p", text: "open one", created: "c", completed: null },
		{ id: "q", text: "open two", created: "c", completed: null, carriedFrom: "2026-08-31" },
		{ id: "r", text: "done", created: "c", completed: "2026-09-02T10:00:00-06:00", carriedFrom: "2026-01-01" },
		{ id: "s", text: "   ", created: "c", completed: null }, // blank placeholder
	];
	const days: ReportDay[] = [
		{ date: "2026-09-01", day: first },
		{ date: "2026-09-02", day: last },
		{ date: "2026-09-03", day: null }, // trailing gap must not shift "last planner day"
	];
	const out = buildReport(days, { ...OPTS, end: "2026-09-03" });
	assert.ok(out.includes("| Tasks still open on last planner day | 2 |"));
	assert.ok(out.includes("| Longest-carried task | 2 days — open two |"));
	assert.ok(!out.includes("ancient"), "earlier day's carried task must not leak into the scorecard");
});

test("scorecard: longest-carried tie breaks by text; single day reads '1 day'", () => {
	const d = emptyDay("2026-09-02");
	d.tasks = [
		{ id: "a", text: "zeta", created: "c", completed: null, carriedFrom: "2026-09-01" },
		{ id: "b", text: "alpha", created: "c", completed: null, carriedFrom: "2026-09-01" },
	];
	const out = buildReport([{ date: "2026-09-02", day: d }], { ...OPTS, start: "2026-09-02" });
	assert.ok(out.includes("| Longest-carried task | 1 day — alpha |"));
	assert.ok(out.includes("- 1 day — alpha (since 2026-09-01)\n- 1 day — zeta (since 2026-09-01)"));
});

test("scorecard: per-day table has exactly one row per planner day", () => {
	const days: ReportDay[] = [
		{ date: "2026-09-01", day: day1() },
		{ date: "2026-09-02", day: null },
		{ date: "2026-09-03", day: null, unreadable: true },
		{ date: "2026-09-04", day: day2() },
	];
	const out = buildReport(days, { ...OPTS, end: "2026-09-04" });
	const rows = out
		.split("\n")
		.filter((l) => /^\| (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), /.test(l));
	assert.deepEqual(rows, [
		"| Tuesday, 2026-09-01 | 3 | 1 (33%) | 1 of 2 | 1 of 2 |",
		"| Friday, 2026-09-04 | 0 | 0 (–) | 0 of 0 | 0 of 1 |",
	]);
});

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

function goalDay(date: string, texts: string[]): ReportDay {
	const d = emptyDay(date);
	d.goals = texts.map((text, i) => ({ id: `${date}-g${i}`, text, created: "c" }));
	return { date, day: d };
}

test("goals: sorted by days desc then text, case-insensitive merge, blanks ignored", () => {
	const days = [
		goalDay("2026-09-01", ["Beta", "alpha", ""]),
		goalDay("2026-09-02", ["BETA", "Gamma", "  "]),
		goalDay("2026-09-03", ["beta ", "Gamma", "Alpha"]),
	];
	const out = buildReport(days, { ...OPTS, end: "2026-09-03" });
	const goalsSection = out.slice(out.indexOf("## Goals"), out.indexOf("## Still carrying"));
	assert.equal(
		goalsSection,
		[
			"## Goals",
			"",
			"| Goal | Days | Dates |",
			"| --- | --- | --- |",
			"| Beta | 3 | 2026-09-01, 2026-09-02, 2026-09-03 |",
			"| alpha | 2 | 2026-09-01, 2026-09-03 |",
			"| Gamma | 2 | 2026-09-02, 2026-09-03 |",
			"",
			"Kept every planner day: Beta",
			"",
			"Appeared once: none",
			"",
			"",
		].join("\n")
	);
});

test("goals: 'kept every day' considers planner days only, and 'none' when nothing qualifies", () => {
	const days: ReportDay[] = [
		goalDay("2026-09-01", ["Focus"]),
		{ date: "2026-09-02", day: null },
		goalDay("2026-09-03", ["Focus", "Rest"]),
		{ date: "2026-09-04", day: null, unreadable: true },
	];
	const out = buildReport(days, { ...OPTS, end: "2026-09-04" });
	assert.ok(out.includes("\nKept every planner day: Focus\n"));
	assert.ok(out.includes("\nAppeared once: Rest\n"));

	const split = [goalDay("2026-09-01", ["One"]), goalDay("2026-09-02", ["Two"])];
	const out2 = buildReport(split, OPTS);
	assert.ok(out2.includes("\nKept every planner day: none\n"));
	assert.ok(out2.includes("\nAppeared once: One, Two\n"));
});

test("goals: a goal repeated within one day counts that day once; no goals at all", () => {
	const out = buildReport([goalDay("2026-09-01", ["Same", "same"])], { ...OPTS, end: "2026-09-01" });
	assert.ok(out.includes("| Same | 1 | 2026-09-01 |"));
	assert.ok(!out.includes("| same |"));
	assert.ok(out.includes("\nAppeared once: Same\n"));

	const none = buildReport([bare("2026-09-01")], { ...OPTS, end: "2026-09-01" });
	assert.ok(none.includes("## Goals\n\n| Goal | Days | Dates |\n| --- | --- | --- |\n\nKept every planner day: none\n\nAppeared once: none\n"));
});

// ---------------------------------------------------------------------------
// Still carrying
// ---------------------------------------------------------------------------

test("still carrying: sorted by days desc then text, with 'since' dates", () => {
	const d = emptyDay("2026-09-05");
	d.tasks = [
		{ id: "a", text: "middle b", created: "c", completed: null, carriedFrom: "2026-09-03" },
		{ id: "b", text: "oldest", created: "c", completed: null, carriedFrom: "2026-08-31" },
		{ id: "c", text: "middle a", created: "c", completed: null, carriedFrom: "2026-09-03" },
		{ id: "d", text: "fresh", created: "c", completed: null }, // no carriedFrom
		{ id: "e", text: "finished", created: "c", completed: "2026-09-05T09:00:00-06:00", carriedFrom: "2026-08-01" },
	];
	const out = buildReport([{ date: "2026-09-05", day: d }], { ...OPTS, start: "2026-09-05", end: "2026-09-05" });
	const section = out.slice(out.indexOf("## Still carrying"), out.indexOf("## Day by day"));
	assert.equal(
		section,
		[
			"## Still carrying",
			"",
			"- 5 days — oldest (since 2026-08-31)",
			"- 2 days — middle a (since 2026-09-03)",
			"- 2 days — middle b (since 2026-09-03)",
			"",
			"",
		].join("\n")
	);
});

test("still carrying: clean-slate message when nothing is carried or no planner exists", () => {
	const d = emptyDay("2026-09-02");
	d.tasks = [{ id: "a", text: "new", created: "c", completed: null }];
	const out = buildReport([{ date: "2026-09-02", day: d }], OPTS);
	assert.ok(out.includes("## Still carrying\n\nNothing carried over — clean slate.\n\n## Day by day"));

	const nothing = buildReport([{ date: "2026-09-01", day: null }], OPTS);
	assert.ok(nothing.includes("## Still carrying\n\nNothing carried over — clean slate.\n"));
});

// ---------------------------------------------------------------------------
// Day by day
// ---------------------------------------------------------------------------

function section(out: string, date: string): string {
	const start = out.indexOf(`### ${weekdayName(date)}, ${date}`);
	assert.ok(start >= 0, `no heading for ${date}`);
	const next = out.indexOf("\n### ", start + 1);
	return out.slice(start, next === -1 ? out.length : next + 1);
}

test("day by day: null, unreadable and empty days", () => {
	const days: ReportDay[] = [
		{ date: "2026-09-01", day: null },
		{ date: "2026-09-02", day: null, unreadable: true },
		bare("2026-09-03"),
	];
	const out = buildReport(days, { ...OPTS, end: "2026-09-03" });
	assert.equal(section(out, "2026-09-01"), "### Tuesday, 2026-09-01\n\nNo planner this day.\n\n");
	assert.equal(section(out, "2026-09-02"), "### Wednesday, 2026-09-02\n\nPlanner block could not be read.\n\n");
	assert.equal(section(out, "2026-09-03"), "### Thursday, 2026-09-03\n\nNothing recorded.\n");
});

test("day by day: every date in the input appears, in input order", () => {
	const days: ReportDay[] = [
		{ date: "2026-09-03", day: null },
		{ date: "2026-09-01", day: null },
		{ date: "2026-09-02", day: null },
	];
	const out = buildReport(days, { ...OPTS, end: "2026-09-03" });
	const headings = out.split("\n").filter((l) => l.startsWith("### "));
	assert.deepEqual(headings, [
		"### Thursday, 2026-09-03",
		"### Tuesday, 2026-09-01",
		"### Wednesday, 2026-09-02",
	]);
});

test("day by day: blank goals/big6 placeholders and blank blocks count as nothing recorded", () => {
	const d = emptyDay("2026-09-01");
	d.goals = [{ id: "g", text: "  ", created: "c" }];
	d.big6 = [{ id: "b", text: "", created: "c", completed: null }];
	d.blocks = { "09:00": { text: " ", created: "c", actual: "" } };
	d.tasks = [{ id: "t", text: "open, not done", created: "c", completed: null }];
	const out = buildReport([{ date: "2026-09-01", day: d }], { ...OPTS, end: "2026-09-01" });
	assert.equal(section(out, "2026-09-01"), "### Tuesday, 2026-09-01\n\nNothing recorded.\n");
});

test("day by day: done today filters by date part and sorts by time, with annotations", () => {
	const d = emptyDay("2026-09-02");
	d.tasks = [
		{ id: "a", text: "late", created: "c", completed: "2026-09-02T17:00:00-06:00" },
		{ id: "b", text: "yesterday", created: "c", completed: "2026-09-01T17:00:00-06:00" },
		{ id: "c", text: "early", created: "c", completed: "2026-09-02T06:15:00-06:00", carriedFrom: "2026-08-30" },
		{
			id: "d",
			text: "adopted",
			created: "c",
			completed: "2026-09-02T09:00:00-06:00",
			source: { path: "Projects/x.md", line: "- [ ] adopted" },
			carriedFrom: "2026-09-01",
		},
		{ id: "e", text: "same minute b", created: "c", completed: "2026-09-02T09:00:00-06:00" },
		{ id: "f", text: "same minute a", created: "c", completed: "2026-09-02T09:00:00-06:00" },
		{ id: "g", text: "open", created: "c", completed: null },
	];
	const out = buildReport([{ date: "2026-09-02", day: d }], OPTS);
	assert.equal(
		section(out, "2026-09-02"),
		[
			"### Wednesday, 2026-09-02",
			"",
			"**Done today:**",
			"- 06:15 — early (carried since 2026-08-30)",
			"- 09:00 — adopted (from Projects/x.md) (carried since 2026-09-01)",
			"- 09:00 — same minute a",
			"- 09:00 — same minute b",
			"- 17:00 — late",
			"",
		].join("\n")
	);
	assert.ok(!out.includes("yesterday"));
});

test("day by day: Big 6 checkboxes with completion time; time omitted when the stamp has none", () => {
	const d = emptyDay("2026-09-01");
	d.big6 = [
		{ id: "a", text: "done at time", created: "c", completed: "2026-09-01T07:45:00-06:00" },
		{ id: "b", text: "done no time", created: "c", completed: "2026-09-01" },
		{ id: "c", text: "open", created: "c", completed: null },
	];
	const out = buildReport([{ date: "2026-09-01", day: d }], { ...OPTS, end: "2026-09-01" });
	assert.ok(out.includes("**Big 6:**\n- ☑ done at time (done 07:45)\n- ☑ done no time\n- ☐ open\n"));
});

test("day by day: plan vs actually looks tasks up by id and flags missing ones", () => {
	const d = emptyDay("2026-09-01");
	d.tasks = [{ id: "t1", text: "Deep work", created: "c", completed: null, slot: "09:00" }];
	d.blocks = {
		"10:00": { text: "", taskId: "ghost", created: "c" },
		"09:00": { text: "", taskId: "t1", created: "c" },
		"11:00": { text: "gym", taskId: "ghost", created: "c", actual: "skipped" },
		"12:00": { text: "", created: "c", actual: "lunch" },
		"13:00": { text: "", created: "c" },
	};
	const out = buildReport([{ date: "2026-09-01", day: d }], { ...OPTS, end: "2026-09-01" });
	assert.ok(
		out.includes(
			[
				"**Plan vs actually:**",
				"",
				"| Slot | Planned | Actually |",
				"| --- | --- | --- |",
				"| 09:00 | [Deep work] |  |",
				"| 10:00 | [missing task] |  |",
				"| 11:00 | [missing task] gym | skipped |",
				"| 12:00 |  | lunch |",
				"",
			].join("\n")
		)
	);
	assert.ok(!out.includes("| 13:00 |"));
});

test("markdown safety: pipes escaped and newlines collapsed in cells and bullets", () => {
	const d = emptyDay("2026-09-01");
	d.goals = [{ id: "g", text: "a|b\ngoal", created: "c" }];
	d.tasks = [
		{ id: "t1", text: "task|with\r\npipe", created: "c", completed: null, slot: "09:00", carriedFrom: "2026-08-30" },
		{ id: "t2", text: "done|it\nnow", created: "c", completed: "2026-09-01T10:00:00-06:00" },
	];
	d.big6 = [{ id: "b", text: "big|six\nline", created: "c", completed: null }];
	d.blocks = {
		"09:00": { text: "plan|x\ny", taskId: "t1", created: "c", actual: "act|z\nw" },
	};
	const out = buildReport([{ date: "2026-09-01", day: d }], { ...OPTS, end: "2026-09-01" });
	assert.ok(out.includes("| a\\|b goal | 1 | 2026-09-01 |"));
	assert.ok(out.includes("| 09:00 | [task\\|with pipe] plan\\|x y | act\\|z w |"));
	assert.ok(out.includes("| Longest-carried task | 2 days — task\\|with pipe |"));
	assert.ok(out.includes("- 2 days — task|with pipe (since 2026-08-30)"));
	assert.ok(out.includes("- a|b goal\n"));
	assert.ok(out.includes("- ☐ big|six line\n"));
	assert.ok(out.includes("- 10:00 — done|it now\n"));
	assert.ok(!out.includes("\r"), "no carriage returns survive");
	// A multi-line task text must never split a table row.
	const tableRows = out.split("\n").filter((l) => l.startsWith("| 09:00 |"));
	assert.equal(tableRows.length, 1);
});

// ---------------------------------------------------------------------------
// Determinism and document shape
// ---------------------------------------------------------------------------

test("determinism: repeated builds and reordered blocks give identical output", () => {
	const a = buildReport(fixture(), OPTS);
	const b = buildReport(fixture(), OPTS);
	assert.equal(a, b);

	const reordered = fixture();
	const src = day1().blocks;
	const blocks: DayData["blocks"] = {};
	for (const key of Object.keys(src).sort().reverse()) blocks[key] = src[key]!;
	reordered[0]!.day!.blocks = blocks;
	assert.notDeepEqual(Object.keys(reordered[0]!.day!.blocks), Object.keys(day1().blocks));
	assert.equal(buildReport(reordered, OPTS), a);
});

test("determinism: input is not mutated", () => {
	const days = fixture();
	const before = JSON.stringify(days);
	buildReport(days, OPTS);
	assert.equal(JSON.stringify(days), before);
});

test("document ends with exactly one trailing newline and sections are in order", () => {
	for (const out of [buildReport(fixture(), OPTS), buildReport([], OPTS), buildReport([bare("2026-09-01")], OPTS)]) {
		assert.ok(out.endsWith("\n"));
		assert.ok(!out.endsWith("\n\n"));
		const order = ["# Review:", "## Scorecard", "## Goals", "## Still carrying", "## Day by day"].map((h) =>
			out.indexOf(h)
		);
		assert.deepEqual([...order].sort((x, y) => x - y), order);
		assert.ok(order.every((i) => i >= 0));
	}
});

test("day label falls back to the bare date when the weekday is unknown", () => {
	const out = buildReport([{ date: "not-a-date", day: null }], OPTS);
	assert.ok(out.includes("### not-a-date\n\nNo planner this day.\n"));
});

test("scorecard: the actually rate never exceeds 100% and unplanned entries are counted apart", () => {
	const d = emptyDay("2026-09-01");
	d.blocks = {
		"06:00": { text: "plan", created: "c", actual: "did it" },
		"07:00": { text: "", created: "c", actual: "unplanned thing" },
		"08:00": { text: "", created: "c", actual: "another unplanned" },
	};
	const out = buildReport([{ date: "2026-09-01", day: d }], { ...OPTS, end: "2026-09-01" });
	assert.ok(out.includes("| Planned slots | 1 |"));
	assert.ok(out.includes('| Slots with "actually" filled in | 1 (100%) |'));
	assert.ok(out.includes('| Unplanned slots with an "actually" entry | 2 |'));
	// and the report never emits a live Markdown checkbox
	assert.ok(!/^- \[[ xX]\] /m.test(out));
});
