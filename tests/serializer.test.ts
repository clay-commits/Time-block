import { test } from "node:test";
import assert from "node:assert/strict";
import {
	parseDay,
	serializeDay,
	parseLists,
	serializeLists,
	normalizeDay,
	TimeblockParseError,
} from "../src/data/serializer";
import { DayData, emptyDay, emptyLists } from "../src/data/types";

function sampleDay(): DayData {
	return {
		version: 1,
		date: "2026-09-01",
		goals: [
			{ id: "goal-a", text: "Ship Timeblock", created: "2026-09-01T06:05:00-06:00" },
		],
		goalsGhost: ["Old goal one", "Old: goal, with punctuation"],
		big6: [
			{
				id: "big6-a",
				text: "Call the bank: 9am",
				created: "2026-09-01T06:06:00-06:00",
				completed: null,
			},
			{
				id: "big6-b",
				text: 'Say "yes" to the deal',
				created: "2026-09-01T06:07:00-06:00",
				completed: "2026-09-01T11:00:00-06:00",
			},
		],
		tasks: [
			{
				id: "task-a",
				text: "Multi\nline\ntask",
				created: "2026-08-30T10:00:00-06:00",
				completed: null,
				carriedFrom: "2026-08-30",
				slot: "07:15",
			},
			{
				id: "task-b",
				text: "06:00", // looks like a time — must survive as a string
				created: "2026-09-01T06:10:00-06:00",
				completed: null,
			},
		],
		blocks: {
			"07:15": { text: "deep work", taskId: "task-a", created: "2026-09-01T06:11:00-06:00" },
			"06:00": { text: "coffee ☕ — émigré", created: "2026-09-01T06:12:00-06:00" },
		},
		notes: "- leading dash\n#hash\n",
	};
}

test("day round-trip preserves every field", () => {
	const day = sampleDay();
	const yaml = serializeDay(day);
	const back = parseDay(yaml, "1999-01-01");
	assert.deepEqual(back, normalizeDay(sampleDay()));
	assert.equal(back.date, "2026-09-01");
	assert.equal(back.tasks[1]!.text, "06:00");
	assert.equal(typeof back.tasks[1]!.text, "string");
});

test("serialization is deterministic (serialize → parse → serialize is identical)", () => {
	const yaml1 = serializeDay(sampleDay());
	const yaml2 = serializeDay(parseDay(yaml1, "1999-01-01"));
	assert.equal(yaml1, yaml2);
});

test("blocks serialize in sorted slot order regardless of insertion order", () => {
	const a = sampleDay();
	const b = sampleDay();
	b.blocks = {};
	// insert in reverse order
	b.blocks["07:15"] = sampleDay().blocks["07:15"]!;
	b.blocks["06:00"] = sampleDay().blocks["06:00"]!;
	const c = sampleDay();
	c.blocks = {};
	c.blocks["06:00"] = sampleDay().blocks["06:00"]!;
	c.blocks["07:15"] = sampleDay().blocks["07:15"]!;
	assert.equal(serializeDay(b), serializeDay(c));
	assert.equal(serializeDay(a), serializeDay(b));
});

test("bad YAML throws TimeblockParseError and never returns partial data", () => {
	assert.throws(() => parseDay("goals: [unclosed", "2026-09-01"), TimeblockParseError);
	assert.throws(() => parseDay("- just\n- a list", "2026-09-01"), TimeblockParseError);
	assert.throws(() => parseDay("just a plain string", "2026-09-01"), TimeblockParseError);
});

test("blank block parses to an empty day with the fallback date", () => {
	const day = parseDay("", "2026-09-01");
	assert.deepEqual(day, emptyDay("2026-09-01"));
	const day2 = parseDay("   \n", "2026-09-02");
	assert.equal(day2.date, "2026-09-02");
});

test("missing keys coerce to defaults; malformed entries are dropped, not fatal", () => {
	const day = parseDay(
		[
			"date: 2026-09-01",
			"tasks:",
			"  - id: task-ok",
			"    text: fine",
			"    created: 2026-09-01T06:00:00-06:00",
			"  - id: task-broken", // no text -> dropped
			"  - 42", // not a mapping -> dropped
			"goals: not-an-array",
			"blocks:",
			"  nonsense-key: {text: hi, created: x}", // bad slot key -> dropped
			'  "08:00": {text: kept, created: x}',
		].join("\n"),
		"1999-01-01"
	);
	assert.equal(day.date, "2026-09-01");
	assert.equal(day.tasks.length, 1);
	assert.equal(day.tasks[0]!.id, "task-ok");
	assert.deepEqual(day.goals, []);
	assert.deepEqual(Object.keys(day.blocks), ["08:00"]);
	assert.equal(day.version, 1);
	assert.equal(day.notes, "");
});

test("normalize: task.slot is source of truth over block.taskId", () => {
	const day = emptyDay("2026-09-01");
	day.tasks = [
		{ id: "t1", text: "one", created: "c1", completed: null, slot: "09:00" },
		{ id: "t2", text: "two", created: "c2", completed: null },
	];
	day.blocks = {
		"09:00": { text: "", taskId: "t2", created: "cb" }, // wrong: t1 owns 09:00
		"10:00": { text: "x", taskId: "ghost", created: "cb" }, // orphan taskId
	};
	normalizeDay(day);
	assert.equal(day.blocks["09:00"]!.taskId, "t1");
	assert.equal(day.blocks["10:00"]!.taskId, undefined);
	assert.equal(day.blocks["10:00"]!.text, "x");
});

test("normalize: one task per slot (first wins), invalid slots dropped, empty blocks pruned", () => {
	const day = emptyDay("2026-09-01");
	day.tasks = [
		{ id: "t1", text: "one", created: "c1", completed: null, slot: "09:00" },
		{ id: "t2", text: "two", created: "c2", completed: null, slot: "09:00" },
		{ id: "t3", text: "three", created: "c3", completed: null, slot: "99:99" },
	];
	day.blocks = {
		"11:00": { text: "   ", created: "cb" }, // empty, no task -> pruned
	};
	normalizeDay(day);
	assert.equal(day.tasks[0]!.slot, "09:00");
	assert.equal(day.tasks[1]!.slot, undefined);
	assert.equal(day.tasks[2]!.slot, undefined);
	assert.equal(day.blocks["09:00"]!.taskId, "t1");
	assert.equal(day.blocks["11:00"], undefined);
});

test("normalize: a block is created for a slotted task with no block", () => {
	const day = emptyDay("2026-09-01");
	day.tasks = [
		{ id: "t1", text: "one", created: "c1", completed: null, slot: "09:00" },
	];
	normalizeDay(day);
	assert.equal(day.blocks["09:00"]!.taskId, "t1");
	assert.equal(day.blocks["09:00"]!.created, "c1");
});

test("duplicate task ids are dropped on parse (first wins)", () => {
	const yaml = [
		"date: 2026-09-01",
		"tasks:",
		"  - {id: t1, text: first, created: c}",
		"  - {id: t1, text: second, created: c}",
	].join("\n");
	const day = parseDay(yaml, "2026-09-01");
	assert.equal(day.tasks.length, 1);
	assert.equal(day.tasks[0]!.text, "first");
});

test("goals cap at 3 and big6 at 6 on parse", () => {
	const day = emptyDay("2026-09-01");
	for (let i = 0; i < 5; i++)
		day.goals.push({ id: `g${i}`, text: `goal ${i}`, created: "c" });
	for (let i = 0; i < 8; i++)
		day.big6.push({ id: `b${i}`, text: `b ${i}`, created: "c", completed: null });
	const back = parseDay(serializeDay(day), "2026-09-01");
	assert.equal(back.goals.length, 3);
	assert.equal(back.big6.length, 6);
});

test("YAML timestamp values (unquoted dates) coerce to strings, not Date objects", () => {
	const yaml = [
		"date: 2026-09-01",
		"tasks:",
		"  - id: t1",
		"    text: hello",
		"    created: 2026-09-01T06:00:00-06:00", // unquoted -> js-yaml yields Date
		"    completed: 2026-09-01T07:00:00-06:00",
	].join("\n");
	const day = parseDay(yaml, "2026-09-01");
	assert.equal(typeof day.tasks[0]!.created, "string");
	assert.equal(typeof day.tasks[0]!.completed, "string");
	// and it round-trips deterministically afterwards
	const once = serializeDay(day);
	assert.equal(once, serializeDay(parseDay(once, "2026-09-01")));
});

test("lists round-trip deterministically and completed stamps survive", () => {
	const lists = emptyLists();
	lists.lists.push({
		id: "list-1",
		name: "Groceries: weekly",
		created: "2026-09-01T06:00:00-06:00",
		items: [
			{ id: "item-1", text: "milk", created: "c1", completed: null },
			{ id: "item-2", text: "eggs — dozen", created: "c2", completed: "2026-09-01T09:00:00-06:00" },
		],
	});
	const yaml1 = serializeLists(lists);
	const back = parseLists(yaml1);
	assert.deepEqual(back, lists);
	assert.equal(yaml1, serializeLists(back));
});

test("lists: blank source is empty, bad YAML throws, malformed lists dropped", () => {
	assert.deepEqual(parseLists(""), emptyLists());
	assert.throws(() => parseLists("lists: [unclosed"), TimeblockParseError);
	const data = parseLists(
		["lists:", "  - name: Ideas", "    items: []", "  - 42", "  - items: []"].join("\n")
	);
	assert.equal(data.lists.length, 1);
	assert.equal(data.lists[0]!.name, "Ideas");
});

// ---------------------------------------------------------------------------
// Review-pass regressions
// ---------------------------------------------------------------------------

test("serialized YAML never contains a line Obsidian could read as a fence", () => {
	const day = emptyDay("2026-09-01");
	day.notes = "some code:\n```\nconst x = 1;\n```\nand tildes:\n~~~\ndone";
	day.tasks.push({
		id: "t1",
		text: "task with\n```js\nfence inside\n```",
		created: "c",
		completed: null,
	});
	day.goals.push({ id: "g1", text: "```", created: "c" });
	const yaml = serializeDay(day);
	for (const line of yaml.split("\n")) {
		assert.ok(
			!/^ {0,3}(`{3,}|~{3,})/.test(line),
			`fence-like line in output: ${JSON.stringify(line)}`
		);
	}
	// and it still round-trips exactly
	const back = parseDay(yaml, "2026-09-01");
	assert.equal(back.notes, day.notes);
	assert.equal(back.tasks[0]!.text, day.tasks[0]!.text);
	assert.equal(back.goals[0]!.text, "```");
	assert.equal(yaml, serializeDay(back));
});

test("empty-text goal/big6 placeholders are omitted from serialization", () => {
	const day = emptyDay("2026-09-01");
	day.goals = [
		{ id: "g0", text: "", created: "c" },
		{ id: "g1", text: "real goal", created: "c" },
	];
	day.big6 = [
		{ id: "b0", text: "  ", created: "c", completed: null },
		{ id: "b1", text: "real item", created: "c", completed: null },
	];
	const back = parseDay(serializeDay(day), "2026-09-01");
	assert.deepEqual(back.goals.map((g) => g.id), ["g1"]);
	assert.deepEqual(back.big6.map((b) => b.id), ["b1"]);
});

test("non-zero-padded slots and block keys canonicalize to HH:MM", () => {
	const yaml = [
		"date: 2026-09-01",
		"tasks:",
		'  - {id: t1, text: hello, created: c, slot: "9:00"}',
		"blocks:",
		'  "6:15": {text: coffee, created: c}',
		'  "06:15": {text: duplicate, created: c}',
	].join("\n");
	const day = parseDay(yaml, "2026-09-01");
	assert.equal(day.tasks[0]!.slot, "09:00");
	assert.ok(day.blocks["09:00"], "block created for canonicalized task slot");
	assert.equal(day.blocks["06:15"]!.text, "coffee");
	assert.equal(Object.keys(day.blocks).includes("6:15"), false);
});

// ---------------------------------------------------------------------------
// 1.1.0: "actually" lane and adopted-task sources
// ---------------------------------------------------------------------------

test('blocks round-trip the "actually" lane with its own stamp', () => {
	const day = emptyDay("2026-09-02");
	day.blocks["09:00"] = {
		text: "deep work",
		actual: "email instead",
		created: "2026-09-02T06:00:00-06:00",
		actualCreated: "2026-09-02T09:40:00-06:00",
	};
	day.blocks["10:00"] = {
		text: "",
		actual: "walk",
		created: "2026-09-02T10:05:00-06:00",
		actualCreated: "2026-09-02T10:05:00-06:00",
	};
	const yaml = serializeDay(day);
	const back = parseDay(yaml, "2026-09-02");
	assert.deepEqual(back.blocks["09:00"], day.blocks["09:00"]);
	// a block with only an "actually" entry survives normalization (not pruned)
	assert.deepEqual(back.blocks["10:00"], day.blocks["10:00"]);
	assert.equal(yaml, serializeDay(back));
});

test("an empty actually lane is omitted and its stamp not written", () => {
	const day = emptyDay("2026-09-02");
	day.blocks["09:00"] = {
		text: "plan",
		actual: "",
		created: "c",
		actualCreated: "should-not-appear",
	};
	const yaml = serializeDay(day);
	assert.ok(!yaml.includes("actualCreated"));
	assert.ok(!yaml.includes("should-not-appear"));
	const back = parseDay(yaml, "2026-09-02");
	assert.equal(back.blocks["09:00"]!.actual, undefined);
});

test("adopted vault tasks keep their source note and line", () => {
	const day = emptyDay("2026-09-02");
	day.tasks.push({
		id: "t1",
		text: "Call the bank",
		created: "c",
		completed: null,
		source: { path: "Projects/Money.md", line: "- [ ] Call the bank #work 📅 2026-09-03" },
	});
	const yaml = serializeDay(day);
	const back = parseDay(yaml, "2026-09-02");
	assert.deepEqual(back.tasks[0]!.source, day.tasks[0]!.source);
	assert.equal(yaml, serializeDay(back));
	// a malformed source is dropped rather than fatal
	const bad = parseDay(
		["date: 2026-09-02", "tasks:", "  - {id: t2, text: x, created: c, source: {path: only}}"].join("\n"),
		"2026-09-02"
	);
	assert.equal(bad.tasks[0]!.source, undefined);
});
