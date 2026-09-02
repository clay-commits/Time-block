import { test } from "node:test";
import assert from "node:assert/strict";
import {
	addDays,
	applyFilter,
	collectFolders,
	collectTags,
	completeTaskLine,
	daysBetween,
	folderRulesAllow,
	parseTaskLine,
} from "../src/data/vaultTasks";
import {
	DEFAULT_TASK_FILTER,
	DueFilter,
	TaskFilter,
	TaskSort,
	VaultTask,
} from "../src/data/types";

const TODAY = "2026-09-02";
const STAMP = "2026-09-02 14:35";

/** Build a VaultTask with sensible defaults; override what the test cares about. */
function vt(over: Partial<VaultTask> = {}): VaultTask {
	return {
		path: "Notes/a.md",
		lineNumber: 0,
		raw: "- [ ] task",
		text: "task",
		tags: [],
		due: null,
		createdDate: null,
		done: false,
		...over,
	};
}

function withFilter(over: Partial<TaskFilter>): TaskFilter {
	return { ...DEFAULT_TASK_FILTER, ...over };
}

/** parseTaskLine with throwaway path/line/fallback, asserting it is a task. */
function parse(raw: string, fallbackCreated: string | null = null): VaultTask {
	const t = parseTaskLine(raw, "Notes/a.md", 3, fallbackCreated);
	assert.ok(t, `expected a task for ${JSON.stringify(raw)}`);
	return t;
}

// ---------------------------------------------------------------------------
// parseTaskLine — line grammar
// ---------------------------------------------------------------------------

test("parseTaskLine: every list marker style is accepted", () => {
	for (const raw of ["- [ ] a", "* [ ] a", "+ [ ] a", "1. [ ] a", "12) [ ] a", "007. [ ] a"]) {
		const t = parse(raw);
		assert.equal(t.text, "a", raw);
		assert.equal(t.done, false, raw);
		assert.equal(t.raw, raw);
	}
});

test("parseTaskLine: indentation with spaces or tabs is accepted", () => {
	for (const raw of ["  - [ ] a", "\t- [ ] a", "\t\t* [ ] a", "    1. [ ] a", " \t + [ ] a"]) {
		const t = parse(raw);
		assert.equal(t.text, "a", raw);
		assert.equal(t.raw, raw, "raw is kept exactly as given");
	}
});

test("parseTaskLine: tab after marker and after checkbox is fine", () => {
	const t = parse("-\t[ ]\tdo it");
	assert.equal(t.text, "do it");
});

test("parseTaskLine: path, lineNumber and raw are passed through", () => {
	const t = parseTaskLine("- [ ] hello", "Projects/X/notes.md", 41, null);
	assert.ok(t);
	assert.equal(t.path, "Projects/X/notes.md");
	assert.equal(t.lineNumber, 41);
	assert.equal(t.raw, "- [ ] hello");
});

test("parseTaskLine: done is true for any checkbox char other than a space", () => {
	assert.equal(parse("- [ ] open").done, false);
	for (const raw of ["- [x] a", "- [X] a", "- [/] a", "- [-] a", "- [>] a", "- [?] a"]) {
		assert.equal(parse(raw).done, true, raw);
	}
});

test("parseTaskLine: done tasks still parse their text and metadata", () => {
	const t = parse("- [x] Ship it ✅ 2026-09-01 📅 2026-09-01 #done");
	assert.equal(t.done, true);
	assert.equal(t.text, "Ship it #done");
	assert.equal(t.due, "2026-09-01");
	assert.deepEqual(t.tags, ["done"]);
});

test("parseTaskLine: CRLF — trailing \\r is stripped for parsing, kept in raw", () => {
	const t = parse("- [ ] windows line 📅 2026-09-05\r");
	assert.equal(t.raw, "- [ ] windows line 📅 2026-09-05\r");
	assert.equal(t.text, "windows line");
	assert.equal(t.due, "2026-09-05");
	assert.equal(t.done, false);
	assert.ok(!t.text.includes("\r"));
});

test("parseTaskLine: non-task lines yield null", () => {
	const bad = [
		"- plain bullet",
		"[ ] no marker",
		"- [  ] two spaces in box",
		"-[ ] no space after marker",
		"- [] empty box",
		"- [ ]", // no whitespace after the checkbox
		"",
		"   ",
		"just text",
		"# heading",
		"1 [ ] marker missing its dot",
		"a. [ ] letter marker",
		"-- [ ] double dash",
		"- [x]",
		"\r",
	];
	for (const raw of bad) {
		assert.equal(parseTaskLine(raw, "n.md", 0, null), null, JSON.stringify(raw));
	}
});

test("parseTaskLine: whitespace-only content is still a task with empty text", () => {
	const t = parse("- [ ] ");
	assert.equal(t.text, "");
	assert.deepEqual(t.tags, []);
});

// ---------------------------------------------------------------------------
// parseTaskLine — tags
// ---------------------------------------------------------------------------

test("parseTaskLine: tags are lowercased, deduped, ordered by appearance, and stay in text", () => {
	const t = parse("- [ ] Fix #Bug now #bug #Project/Sub #_private #a-b #123 no#inline #x_1 #");
	assert.deepEqual(t.tags, ["bug", "project/sub", "_private", "a-b", "x_1"]);
	assert.equal(
		t.text,
		"Fix #Bug now #bug #Project/Sub #_private #a-b #123 no#inline #x_1 #"
	);
});

test("parseTaskLine: a tag at the very start of the content is found", () => {
	assert.deepEqual(parse("- [ ] #first thing").tags, ["first"]);
});

test("parseTaskLine: adjacent tags separated by single spaces are all found", () => {
	assert.deepEqual(parse("- [ ] #a #b #c").tags, ["a", "b", "c"]);
});

test("parseTaskLine: trailing punctuation is not part of a tag", () => {
	assert.deepEqual(parse("- [ ] call #mom, then #dad.").tags, ["mom", "dad"]);
});

// ---------------------------------------------------------------------------
// parseTaskLine — dates
// ---------------------------------------------------------------------------

test("parseTaskLine: due from each syntax; null when absent", () => {
	assert.equal(parse("- [ ] a 📅 2026-09-05").due, "2026-09-05");
	assert.equal(parse("- [ ] a [due:: 2026-09-06]").due, "2026-09-06");
	assert.equal(parse("- [ ] a (due:: 2026-09-07)").due, "2026-09-07");
	assert.equal(parse("- [ ] a [due::2026-09-08]").due, "2026-09-08");
	assert.equal(parse("- [ ] a").due, null);
	assert.equal(parse("- [ ] a 📅 tomorrow").due, null);
	assert.equal(parse("- [ ] a 📅 2026-09-051").due, null, "not a bare date");
});

test("parseTaskLine: 📅 wins over an inline due field when both are present", () => {
	assert.equal(parse("- [ ] a [due:: 2026-09-01] 📅 2026-09-05").due, "2026-09-05");
});

test("parseTaskLine: created from each syntax", () => {
	assert.equal(parse("- [ ] a ➕ 2026-08-30").createdDate, "2026-08-30");
	assert.equal(parse("- [ ] a [created:: 2026-08-29]").createdDate, "2026-08-29");
	assert.equal(parse("- [ ] a (created:: 2026-08-28)").createdDate, "2026-08-28");
});

test("parseTaskLine: fallbackCreated is used only when no ➕/[created] is present", () => {
	assert.equal(parse("- [ ] a", "2026-01-01").createdDate, "2026-01-01");
	assert.equal(parse("- [ ] a", null).createdDate, null);
	assert.equal(parse("- [ ] a ➕ 2026-08-30", "2026-01-01").createdDate, "2026-08-30");
	assert.equal(parse("- [ ] a [created:: 2026-08-29]", "2026-01-01").createdDate, "2026-08-29");
});

test("parseTaskLine: due and created are independent of each other", () => {
	const t = parse("- [ ] a ➕ 2026-08-30 📅 2026-09-05");
	assert.equal(t.due, "2026-09-05");
	assert.equal(t.createdDate, "2026-08-30");
	const u = parse("- [ ] b 📅 2026-09-05", "2026-02-02");
	assert.equal(u.due, "2026-09-05");
	assert.equal(u.createdDate, "2026-02-02");
});

// ---------------------------------------------------------------------------
// parseTaskLine — text cleaning
// ---------------------------------------------------------------------------

test("parseTaskLine: every date marker and inline date field is stripped from text", () => {
	const t = parse(
		"- [ ] Write report 📅 2026-09-05 ➕ 2026-08-30 ⏳ 2026-09-03 🛫 2026-09-01 ❌ 2026-09-09 ✅ 2026-09-02 14:35 [completion:: 2026-09-02] (start:: 2026-09-01) [scheduled:: 2026-09-03] #work"
	);
	assert.equal(t.text, "Write report #work");
	assert.deepEqual(t.tags, ["work"]);
	assert.equal(t.due, "2026-09-05");
	assert.equal(t.createdDate, "2026-08-30");
});

test("parseTaskLine: ✅ with and without a time is stripped", () => {
	assert.equal(parse("- [x] a ✅ 2026-09-02 14:35").text, "a");
	assert.equal(parse("- [x] a ✅ 2026-09-02").text, "a");
	assert.equal(parse("- [x] a ✅ 2026-09-02 b").text, "a b");
});

test("parseTaskLine: markers in the middle of the text leave clean spacing", () => {
	assert.equal(parse("- [ ] before 📅 2026-09-05 after").text, "before after");
	assert.equal(parse("- [ ] before [due:: 2026-09-05] after").text, "before after");
	assert.equal(parse("- [ ] glued📅 2026-09-05to").text, "glued to");
});

test("parseTaskLine: inline fields with other keys are left alone", () => {
	assert.equal(parse("- [ ] a [priority:: high] (owner:: me)").text, "a [priority:: high] (owner:: me)");
});

test("parseTaskLine: bare emoji without a date stays in the text", () => {
	assert.equal(parse("- [ ] pick a date 📅 soon").text, "pick a date 📅 soon");
});

test("parseTaskLine: whitespace is collapsed and trimmed", () => {
	assert.equal(parse("- [ ]   many    spaces \t here  ").text, "many spaces here");
});

test("parseTaskLine: text is empty (not null) when only metadata remains", () => {
	const t = parse("- [ ] 📅 2026-09-05 ➕ 2026-08-30");
	assert.equal(t.text, "");
	assert.equal(t.due, "2026-09-05");
	assert.equal(t.createdDate, "2026-08-30");
});

// ---------------------------------------------------------------------------
// applyFilter — fixtures
// ---------------------------------------------------------------------------

function fixtures(): VaultTask[] {
	return [
		vt({ path: "Projects/ClientX/notes.md", lineNumber: 4, text: "Send invoice", tags: ["work/client"], due: "2026-09-01", createdDate: "2026-08-01" }),
		vt({ path: "Projects/ClientX/notes.md", lineNumber: 9, text: "Call Alice", tags: ["work"], due: "2026-09-02", createdDate: null }),
		vt({ path: "Inbox.md", lineNumber: 1, text: "Buy milk", tags: ["home"], due: "2026-09-08", createdDate: "2026-08-15" }),
		vt({ path: "Inbox.md", lineNumber: 2, text: "Renew passport", tags: ["home", "admin"], due: "2026-09-09", createdDate: "2026-07-01" }),
		vt({ path: "ProjectsOld/legacy.md", lineNumber: 0, text: "Archive box", tags: [], due: null, createdDate: "2026-06-01" }),
		vt({ path: "Daily/2026-09-01.md", lineNumber: 12, text: "Read paper on ALICE detector", tags: ["reading"], due: null, createdDate: null }),
	];
}

const texts = (ts: VaultTask[]) => ts.map((t) => t.text);

// ---------------------------------------------------------------------------
// applyFilter — due modes
// ---------------------------------------------------------------------------

test("applyFilter: due 'any' keeps everything", () => {
	assert.equal(applyFilter(fixtures(), withFilter({ due: "any" }), TODAY).length, 6);
});

test("applyFilter: due 'overdue' is strictly before today, never null", () => {
	assert.deepEqual(texts(applyFilter(fixtures(), withFilter({ due: "overdue" }), TODAY)), ["Send invoice"]);
});

test("applyFilter: due 'today' is an exact match", () => {
	assert.deepEqual(texts(applyFilter(fixtures(), withFilter({ due: "today" }), TODAY)), ["Call Alice"]);
});

test("applyFilter: due 'week' is today..today+6 inclusive; today+7 and yesterday are out", () => {
	const tasks = [
		vt({ text: "yesterday", due: "2026-09-01" }),
		vt({ text: "today", due: "2026-09-02" }),
		vt({ text: "plus6", due: "2026-09-08" }),
		vt({ text: "plus7", due: "2026-09-09" }),
		vt({ text: "none", due: null }),
	];
	const out = applyFilter(tasks, withFilter({ due: "week", sort: "path" }), TODAY);
	assert.deepEqual(texts(out), ["today", "plus6"]);
});

test("applyFilter: due 'week' crosses a month boundary correctly", () => {
	const tasks = [
		vt({ text: "in", due: "2026-10-06" }),
		vt({ text: "out", due: "2026-10-07" }),
	];
	assert.deepEqual(texts(applyFilter(tasks, withFilter({ due: "week" }), "2026-09-30")), ["in"]);
});

test("applyFilter: due 'none' keeps only tasks with no due date", () => {
	assert.deepEqual(
		texts(applyFilter(fixtures(), withFilter({ due: "none", sort: "path" }), TODAY)),
		["Read paper on ALICE detector", "Archive box"]
	);
});

test("applyFilter: an unknown due mode (stale settings) behaves like 'any'", () => {
	const f = withFilter({ due: "bogus" as DueFilter });
	assert.equal(applyFilter(fixtures(), f, TODAY).length, 6);
});

// ---------------------------------------------------------------------------
// applyFilter — query
// ---------------------------------------------------------------------------

test("applyFilter: empty or whitespace-only query is no constraint", () => {
	assert.equal(applyFilter(fixtures(), withFilter({ query: "" }), TODAY).length, 6);
	assert.equal(applyFilter(fixtures(), withFilter({ query: "   \t " }), TODAY).length, 6);
});

test("applyFilter: query is case-insensitive against text", () => {
	assert.deepEqual(texts(applyFilter(fixtures(), withFilter({ query: "INVOICE" }), TODAY)), ["Send invoice"]);
});

test("applyFilter: query words match against path too", () => {
	const out = applyFilter(fixtures(), withFilter({ query: "clientx", sort: "path" }), TODAY);
	assert.deepEqual(texts(out), ["Send invoice", "Call Alice"]);
});

test("applyFilter: every query word must match (text or path, independently)", () => {
	// "alice" matches two texts; "projects" narrows by path
	const out = applyFilter(fixtures(), withFilter({ query: "alice projects" }), TODAY);
	assert.deepEqual(texts(out), ["Call Alice"]);
	// one word in text, the other in path
	const mixed = applyFilter(fixtures(), withFilter({ query: "milk inbox" }), TODAY);
	assert.deepEqual(texts(mixed), ["Buy milk"]);
	// a word that matches nothing removes everything
	assert.deepEqual(applyFilter(fixtures(), withFilter({ query: "milk zzz" }), TODAY), []);
});

test("applyFilter: a query word does not span text and path together", () => {
	const tasks = [vt({ path: "foo.md", text: "bar" })];
	assert.equal(applyFilter(tasks, withFilter({ query: "foobar" }), TODAY).length, 0);
	assert.equal(applyFilter(tasks, withFilter({ query: "foo bar" }), TODAY).length, 1);
});

// ---------------------------------------------------------------------------
// applyFilter — tag
// ---------------------------------------------------------------------------

test("applyFilter: tag null is no constraint", () => {
	assert.equal(applyFilter(fixtures(), withFilter({ tag: null }), TODAY).length, 6);
});

test("applyFilter: tag matches exactly or as a hierarchy parent", () => {
	const out = applyFilter(fixtures(), withFilter({ tag: "work", sort: "path" }), TODAY);
	assert.deepEqual(texts(out), ["Send invoice", "Call Alice"]);
	const child = applyFilter(fixtures(), withFilter({ tag: "work/client" }), TODAY);
	assert.deepEqual(texts(child), ["Send invoice"]);
});

test("applyFilter: tag prefix without a '/' boundary does not match", () => {
	assert.deepEqual(applyFilter(fixtures(), withFilter({ tag: "wor" }), TODAY), []);
	assert.deepEqual(applyFilter(fixtures(), withFilter({ tag: "hom" }), TODAY), []);
});

test("applyFilter: tag comparison is lowercased and tolerates a leading '#'", () => {
	assert.deepEqual(texts(applyFilter(fixtures(), withFilter({ tag: "ADMIN" }), TODAY)), ["Renew passport"]);
	assert.deepEqual(texts(applyFilter(fixtures(), withFilter({ tag: "#admin" }), TODAY)), ["Renew passport"]);
	const upper = [vt({ text: "u", tags: ["Work"] })];
	assert.equal(applyFilter(upper, withFilter({ tag: "work" }), TODAY).length, 1);
});

test("applyFilter: a child tag does not match a filter for a sibling", () => {
	assert.deepEqual(applyFilter(fixtures(), withFilter({ tag: "work/other" }), TODAY), []);
});

// ---------------------------------------------------------------------------
// applyFilter — folder
// ---------------------------------------------------------------------------

test("applyFilter: folder null or empty is no constraint", () => {
	assert.equal(applyFilter(fixtures(), withFilter({ folder: null }), TODAY).length, 6);
	assert.equal(applyFilter(fixtures(), withFilter({ folder: "" }), TODAY).length, 6);
	assert.equal(applyFilter(fixtures(), withFilter({ folder: " / " }), TODAY).length, 6);
});

test("applyFilter: folder matches nested paths but not a folder sharing the prefix", () => {
	const out = applyFilter(fixtures(), withFilter({ folder: "Projects", sort: "path" }), TODAY);
	assert.deepEqual(texts(out), ["Send invoice", "Call Alice"]);
	const old = applyFilter(fixtures(), withFilter({ folder: "ProjectsOld" }), TODAY);
	assert.deepEqual(texts(old), ["Archive box"]);
});

test("applyFilter: folder rule is normalized (trim, strip surrounding slashes)", () => {
	for (const rule of ["Projects/", "/Projects", " /Projects/ ", "//Projects//"]) {
		const out = applyFilter(fixtures(), withFilter({ folder: rule }), TODAY);
		assert.equal(out.length, 2, JSON.stringify(rule));
	}
});

test("applyFilter: a note rule matches the note itself", () => {
	const out = applyFilter(fixtures(), withFilter({ folder: "Inbox.md", sort: "path" }), TODAY);
	assert.deepEqual(texts(out), ["Buy milk", "Renew passport"]);
	assert.deepEqual(applyFilter(fixtures(), withFilter({ folder: "Inbox" }), TODAY), []);
});

test("applyFilter: folder match is case-sensitive", () => {
	assert.deepEqual(applyFilter(fixtures(), withFilter({ folder: "projects" }), TODAY), []);
});

test("applyFilter: all constraints combine (AND)", () => {
	const f = withFilter({ query: "call", tag: "work", folder: "Projects", due: "today" });
	assert.deepEqual(texts(applyFilter(fixtures(), f, TODAY)), ["Call Alice"]);
	const none = withFilter({ query: "call", tag: "work", folder: "Projects", due: "overdue" });
	assert.deepEqual(applyFilter(fixtures(), none, TODAY), []);
});

// ---------------------------------------------------------------------------
// applyFilter — sorting
// ---------------------------------------------------------------------------

test("applyFilter: sort 'due' — dated ascending, nulls last, then path, then line", () => {
	const tasks = [
		vt({ path: "b.md", lineNumber: 1, text: "n-b1", due: null }),
		vt({ path: "a.md", lineNumber: 5, text: "d3-a5", due: "2026-09-03" }),
		vt({ path: "a.md", lineNumber: 2, text: "n-a2", due: null }),
		vt({ path: "b.md", lineNumber: 1, text: "d1-b1", due: "2026-09-01" }),
		vt({ path: "a.md", lineNumber: 9, text: "d3-a9", due: "2026-09-03" }),
		vt({ path: "a.md", lineNumber: 1, text: "n-a1", due: null }),
		vt({ path: "b.md", lineNumber: 0, text: "d3-b0", due: "2026-09-03" }),
	];
	const out = applyFilter(tasks, withFilter({ sort: "due" }), TODAY);
	assert.deepEqual(texts(out), ["d1-b1", "d3-a5", "d3-a9", "d3-b0", "n-a1", "n-a2", "n-b1"]);
});

test("applyFilter: sort 'age' — oldest createdDate first, nulls last, then path/line", () => {
	const tasks = [
		vt({ path: "z.md", lineNumber: 0, text: "none-z", createdDate: null }),
		vt({ path: "m.md", lineNumber: 3, text: "aug", createdDate: "2026-08-01" }),
		vt({ path: "a.md", lineNumber: 0, text: "none-a", createdDate: null }),
		vt({ path: "m.md", lineNumber: 1, text: "jul-m1", createdDate: "2026-07-01" }),
		vt({ path: "b.md", lineNumber: 7, text: "jul-b7", createdDate: "2026-07-01" }),
	];
	const out = applyFilter(tasks, withFilter({ sort: "age" }), TODAY);
	assert.deepEqual(texts(out), ["jul-b7", "jul-m1", "aug", "none-a", "none-z"]);
});

test("applyFilter: sort 'path' — path then numeric line number (2 before 10)", () => {
	const tasks = [
		vt({ path: "b.md", lineNumber: 10, text: "b10", due: "2026-01-01" }),
		vt({ path: "a.md", lineNumber: 10, text: "a10", due: "2026-01-02" }),
		vt({ path: "b.md", lineNumber: 2, text: "b2", due: "2025-01-01" }),
		vt({ path: "a.md", lineNumber: 2, text: "a2", due: null }),
	];
	const out = applyFilter(tasks, withFilter({ sort: "path" }), TODAY);
	assert.deepEqual(texts(out), ["a2", "a10", "b2", "b10"]);
});

test("applyFilter: sort 'due' ignores createdDate and sort 'age' ignores due", () => {
	const tasks = [
		vt({ path: "a.md", lineNumber: 0, text: "x", due: "2026-09-05", createdDate: "2026-01-01" }),
		vt({ path: "a.md", lineNumber: 1, text: "y", due: "2026-09-01", createdDate: "2026-05-01" }),
	];
	assert.deepEqual(texts(applyFilter(tasks, withFilter({ sort: "due" }), TODAY)), ["y", "x"]);
	assert.deepEqual(texts(applyFilter(tasks, withFilter({ sort: "age" }), TODAY)), ["x", "y"]);
});

test("applyFilter: sorting is stable — identical keys keep input order", () => {
	const mk = (text: string) => vt({ path: "same.md", lineNumber: 1, due: null, createdDate: null, text });
	const tasks = [mk("third"), mk("first"), mk("second")];
	for (const sort of ["due", "age", "path"] as TaskSort[]) {
		assert.deepEqual(texts(applyFilter(tasks, withFilter({ sort }), TODAY)), ["third", "first", "second"], sort);
	}
});

test("applyFilter: an unknown sort (stale settings) falls back to path order", () => {
	const tasks = [
		vt({ path: "b.md", lineNumber: 0, text: "b" }),
		vt({ path: "a.md", lineNumber: 0, text: "a" }),
	];
	assert.deepEqual(texts(applyFilter(tasks, withFilter({ sort: "bogus" as TaskSort }), TODAY)), ["a", "b"]);
});

test("applyFilter: DEFAULT_TASK_FILTER returns everything sorted by due", () => {
	const out = applyFilter(fixtures(), DEFAULT_TASK_FILTER, TODAY);
	assert.deepEqual(texts(out), [
		"Send invoice",
		"Call Alice",
		"Buy milk",
		"Renew passport",
		"Read paper on ALICE detector",
		"Archive box",
	]);
});

test("applyFilter: never mutates the input array or its tasks", () => {
	const tasks = fixtures();
	const snapshot = fixtures();
	const before = [...tasks];
	const out = applyFilter(tasks, withFilter({ query: "a", due: "week", sort: "path" }), TODAY);
	assert.notEqual(out, tasks, "returns a new array");
	assert.deepEqual(tasks, snapshot, "element contents unchanged");
	for (let i = 0; i < before.length; i++) {
		assert.equal(tasks[i], before[i], "element order unchanged");
	}
	// a sort-only call must not reorder the input either
	applyFilter(tasks, withFilter({ sort: "path" }), TODAY);
	for (let i = 0; i < before.length; i++) assert.equal(tasks[i], before[i]);
});

test("applyFilter: an empty list stays empty", () => {
	assert.deepEqual(applyFilter([], DEFAULT_TASK_FILTER, TODAY), []);
});

// ---------------------------------------------------------------------------
// completeTaskLine
// ---------------------------------------------------------------------------

test("completeTaskLine: exact output for a plain task", () => {
	assert.equal(completeTaskLine("- [ ] Buy milk", STAMP), "- [x] Buy milk ✅ 2026-09-02 14:35");
});

test("completeTaskLine: is idempotent — a completed line is returned unchanged", () => {
	const once = completeTaskLine("- [ ] Buy milk", STAMP);
	assert.equal(completeTaskLine(once, "2026-09-03 09:00"), once);
});

test("completeTaskLine: already-done lines are unchanged whatever the box char", () => {
	for (const raw of ["- [x] a", "- [X] a", "- [/] a", "- [-] a"]) {
		assert.equal(completeTaskLine(raw, STAMP), raw, raw);
	}
});

test("completeTaskLine: non-task lines are unchanged", () => {
	for (const raw of ["- plain bullet", "[ ] no marker", "-[ ] nospace", "- [  ] two", "", "text", "- [ ]"]) {
		assert.equal(completeTaskLine(raw, STAMP), raw, JSON.stringify(raw));
	}
});

test("completeTaskLine: CRLF — the stamp goes before the trailing \\r", () => {
	assert.equal(completeTaskLine("- [ ] a\r", STAMP), "- [x] a ✅ 2026-09-02 14:35\r");
});

test("completeTaskLine: indentation and marker style are preserved", () => {
	assert.equal(completeTaskLine("  * [ ] a", STAMP), "  * [x] a ✅ 2026-09-02 14:35");
	assert.equal(completeTaskLine("1. [ ] a", STAMP), "1. [x] a ✅ 2026-09-02 14:35");
	assert.equal(completeTaskLine("\t\t+ [ ] a", STAMP), "\t\t+ [x] a ✅ 2026-09-02 14:35");
	assert.equal(completeTaskLine("3) [ ] a", STAMP), "3) [x] a ✅ 2026-09-02 14:35");
	assert.equal(completeTaskLine("-\t[ ]\ta", STAMP), "-\t[x]\ta ✅ 2026-09-02 14:35");
});

test("completeTaskLine: only the first checkbox is replaced", () => {
	assert.equal(completeTaskLine("- [ ] a [ ] b", STAMP), "- [x] a [ ] b ✅ 2026-09-02 14:35");
});

test("completeTaskLine: trailing whitespace on the content is dropped before the stamp", () => {
	assert.equal(completeTaskLine("- [ ] a   ", STAMP), "- [x] a ✅ 2026-09-02 14:35");
	assert.equal(completeTaskLine("- [ ] a \t\r", STAMP), "- [x] a ✅ 2026-09-02 14:35\r");
});

test("completeTaskLine: existing metadata and tags are kept", () => {
	assert.equal(
		completeTaskLine("- [ ] a #tag 📅 2026-09-05", STAMP),
		"- [x] a #tag 📅 2026-09-05 ✅ 2026-09-02 14:35"
	);
});

test("completeTaskLine: the result parses back as a done task with clean text", () => {
	const done = parseTaskLine(completeTaskLine("- [ ] Buy milk #home 📅 2026-09-05", STAMP), "n.md", 0, null);
	assert.ok(done);
	assert.equal(done.done, true);
	assert.equal(done.text, "Buy milk #home");
	assert.equal(done.due, "2026-09-05");
	assert.deepEqual(done.tags, ["home"]);
});

// ---------------------------------------------------------------------------
// folderRulesAllow
// ---------------------------------------------------------------------------

test("folderRulesAllow: no rules allows everything", () => {
	assert.equal(folderRulesAllow("Notes/a.md", [], []), true);
	assert.equal(folderRulesAllow("root.md", [], []), true);
});

test("folderRulesAllow: includes restrict to matching folders (and nested ones)", () => {
	const inc = ["Projects"];
	assert.equal(folderRulesAllow("Projects/a.md", inc, []), true);
	assert.equal(folderRulesAllow("Projects/Deep/er/a.md", inc, []), true);
	assert.equal(folderRulesAllow("Projects", inc, []), true);
	assert.equal(folderRulesAllow("Other/a.md", inc, []), false);
	assert.equal(folderRulesAllow("root.md", inc, []), false);
});

test("folderRulesAllow: 'Projects' does not match 'ProjectsOld'", () => {
	assert.equal(folderRulesAllow("ProjectsOld/a.md", ["Projects"], []), false);
	assert.equal(folderRulesAllow("ProjectsOld/a.md", [], ["Projects"]), true);
	assert.equal(folderRulesAllow("Projects.md", ["Projects"], []), false);
});

test("folderRulesAllow: excludes win over includes, including nested excludes", () => {
	const inc = ["Projects"];
	const exc = ["Projects/Archive"];
	assert.equal(folderRulesAllow("Projects/Archive/old.md", inc, exc), false);
	assert.equal(folderRulesAllow("Projects/Archive", inc, exc), false);
	assert.equal(folderRulesAllow("Projects/live.md", inc, exc), true);
	// identical include and exclude → excluded
	assert.equal(folderRulesAllow("Projects/x.md", ["Projects"], ["Projects"]), false);
});

test("folderRulesAllow: excludes alone allow everything else", () => {
	const exc = ["Templates", "Archive"];
	assert.equal(folderRulesAllow("Templates/t.md", [], exc), false);
	assert.equal(folderRulesAllow("Archive/2020/x.md", [], exc), false);
	assert.equal(folderRulesAllow("Notes/a.md", [], exc), true);
	assert.equal(folderRulesAllow("root.md", [], exc), true);
});

test("folderRulesAllow: nested include only admits that subtree", () => {
	const inc = ["Projects/ClientX"];
	assert.equal(folderRulesAllow("Projects/ClientX/notes.md", inc, []), true);
	assert.equal(folderRulesAllow("Projects/ClientY/notes.md", inc, []), false);
	assert.equal(folderRulesAllow("Projects/notes.md", inc, []), false);
});

test("folderRulesAllow: any of several includes is enough", () => {
	const inc = ["Work", "Home"];
	assert.equal(folderRulesAllow("Work/a.md", inc, []), true);
	assert.equal(folderRulesAllow("Home/b.md", inc, []), true);
	assert.equal(folderRulesAllow("Play/c.md", inc, []), false);
});

test("folderRulesAllow: a rule naming a note matches that note exactly", () => {
	assert.equal(folderRulesAllow("Inbox.md", ["Inbox.md"], []), true);
	assert.equal(folderRulesAllow("Inbox2.md", ["Inbox.md"], []), false);
	assert.equal(folderRulesAllow("Inbox.md", [], ["Inbox.md"]), false);
	assert.equal(folderRulesAllow("Notes/Inbox.md", ["Inbox.md"], []), false);
});

test("folderRulesAllow: rules are normalized and blanks are ignored", () => {
	assert.equal(folderRulesAllow("Projects/a.md", [" /Projects/ "], []), true);
	assert.equal(folderRulesAllow("Projects/a.md", ["//Projects//"], []), true);
	assert.equal(folderRulesAllow("Projects/a.md", [], ["Projects/"]), false);
	// blank includes count as "no includes"
	assert.equal(folderRulesAllow("Anything/a.md", ["", "  ", "/", "//"], []), true);
	// blank excludes exclude nothing
	assert.equal(folderRulesAllow("Anything/a.md", [], ["", " ", "/"]), true);
});

test("folderRulesAllow: matching is case-sensitive", () => {
	assert.equal(folderRulesAllow("Projects/a.md", ["projects"], []), false);
	assert.equal(folderRulesAllow("Projects/a.md", [], ["projects"]), true);
});

// ---------------------------------------------------------------------------
// collectTags / collectFolders
// ---------------------------------------------------------------------------

test("collectTags: sorted unique union of all task tags", () => {
	const tasks = [
		vt({ tags: ["work", "home"] }),
		vt({ tags: ["admin", "work", "work/client"] }),
		vt({ tags: [] }),
	];
	assert.deepEqual(collectTags(tasks), ["admin", "home", "work", "work/client"]);
	assert.deepEqual(collectTags([]), []);
});

test("collectFolders: top-level folders only, root notes contribute nothing", () => {
	const tasks = [
		vt({ path: "Projects/ClientX/notes.md" }),
		vt({ path: "Projects/other.md" }),
		vt({ path: "Daily/2026-09-01.md" }),
		vt({ path: "Inbox.md" }),
		vt({ path: "Archive/x.md" }),
	];
	assert.deepEqual(collectFolders(tasks), ["Archive", "Daily", "Projects"]);
	assert.deepEqual(collectFolders([vt({ path: "root.md" })]), []);
	assert.deepEqual(collectFolders([]), []);
});

// ---------------------------------------------------------------------------
// addDays / daysBetween
// ---------------------------------------------------------------------------

test("addDays: month, year and leap-day boundaries", () => {
	assert.equal(addDays("2026-01-31", 1), "2026-02-01");
	assert.equal(addDays("2026-12-31", 1), "2027-01-01");
	assert.equal(addDays("2024-02-28", 1), "2024-02-29");
	assert.equal(addDays("2024-02-29", 1), "2024-03-01");
	assert.equal(addDays("2023-02-28", 1), "2023-03-01");
	assert.equal(addDays("2100-02-28", 1), "2100-03-01", "2100 is not a leap year");
	assert.equal(addDays("2000-02-28", 1), "2000-02-29", "2000 is a leap year");
});

test("addDays: zero, negative and large offsets", () => {
	assert.equal(addDays("2026-09-02", 0), "2026-09-02");
	assert.equal(addDays("2026-09-02", -2), "2026-08-31");
	assert.equal(addDays("2026-01-01", -1), "2025-12-31");
	assert.equal(addDays("2026-09-02", 6), "2026-09-08");
	assert.equal(addDays("2026-09-02", 365), "2027-09-02");
	assert.equal(addDays("2026-09-02", 2.9), "2026-09-04", "fractional days truncate");
});

test("addDays: invalid input yields an empty string", () => {
	for (const bad of ["", "nope", "2026-9-2", "2026-13-01", "2026-02-30", "2026-00-10", "2026-09-02T00:00", " 2026-09-02"]) {
		assert.equal(addDays(bad, 1), "", JSON.stringify(bad));
	}
	assert.equal(addDays("2026-09-02", Number.NaN), "");
	assert.equal(addDays("2026-09-02", Number.POSITIVE_INFINITY), "");
});

test("daysBetween: sign follows direction, zero for same day", () => {
	assert.equal(daysBetween("2026-09-01", "2026-09-08"), 7);
	assert.equal(daysBetween("2026-09-08", "2026-09-01"), -7);
	assert.equal(daysBetween("2026-09-02", "2026-09-02"), 0);
	assert.equal(daysBetween("2025-12-31", "2026-01-01"), 1);
	assert.equal(daysBetween("2024-02-28", "2024-03-01"), 2, "leap day counted");
	assert.equal(daysBetween("2023-02-28", "2023-03-01"), 1);
	assert.equal(daysBetween("2025-09-02", "2026-09-02"), 365);
});

test("daysBetween: invalid input yields 0", () => {
	assert.equal(daysBetween("", "2026-09-02"), 0);
	assert.equal(daysBetween("2026-09-02", "bad"), 0);
	assert.equal(daysBetween("2026-02-30", "2026-03-01"), 0);
});

test("addDays and daysBetween agree with each other", () => {
	for (const n of [-400, -31, -1, 0, 1, 29, 366]) {
		assert.equal(daysBetween("2026-09-02", addDays("2026-09-02", n)), n, String(n));
	}
});

// ---------------------------------------------------------------------------
// locateTaskLine / isCompletedVariant (review-pass additions)
// ---------------------------------------------------------------------------

import { isCompletedVariant, locateTaskLine } from "../src/data/vaultTasks";

test("locateTaskLine skips lines inside fenced code blocks", () => {
	const lines = ["# Notes", "```", "- [ ] Buy milk", "```", "- [ ] Buy milk", ""];
	assert.deepEqual(locateTaskLine(lines, "- [ ] Buy milk"), { index: 4, state: "open" });
	const tilde = ["~~~md", "- [ ] Buy milk", "~~~", "- [ ] Buy milk"];
	assert.deepEqual(locateTaskLine(tilde, "- [ ] Buy milk"), { index: 3, state: "open" });
	const onlyFenced = ["```", "- [ ] Buy milk", "```"];
	assert.equal(locateTaskLine(onlyFenced, "- [ ] Buy milk"), null);
});

test("locateTaskLine prefers the hinted line among duplicates", () => {
	const lines = ["- [ ] Call mom", "- [ ] Other", "- [ ] Call mom"];
	assert.deepEqual(locateTaskLine(lines, "- [ ] Call mom", 2), { index: 2, state: "open" });
	assert.deepEqual(locateTaskLine(lines, "- [ ] Call mom", 0), { index: 0, state: "open" });
	// stale hint pointing elsewhere falls back to the first exact match
	assert.deepEqual(locateTaskLine(lines, "- [ ] Call mom", 1), { index: 0, state: "open" });
	assert.deepEqual(locateTaskLine(lines, "- [ ] Call mom", 99), { index: 0, state: "open" });
});

test("locateTaskLine recognises an already-completed variant (tick → untick → tick)", () => {
	const lines = ["- [x] Call mom ✅ 2026-09-02 14:35", "- [ ] Other"];
	assert.deepEqual(locateTaskLine(lines, "- [ ] Call mom"), { index: 0, state: "completed" });
	assert.deepEqual(locateTaskLine(lines, "- [ ] Call mom", 0), { index: 0, state: "completed" });
	assert.equal(locateTaskLine(["- [ ] Nope"], "- [ ] Call mom"), null);
});

test("isCompletedVariant matches [x]/[X] with or without a stamp, not other text", () => {
	assert.ok(isCompletedVariant("- [x] a", "- [ ] a"));
	assert.ok(isCompletedVariant("  * [X] a ✅ 2026-09-02 09:00", "  * [ ] a"));
	assert.ok(isCompletedVariant("- [x] a\r", "- [ ] a"));
	assert.ok(!isCompletedVariant("- [x] ab", "- [ ] a"));
	assert.ok(!isCompletedVariant("- [ ] a", "- [ ] a"));
	assert.ok(!isCompletedVariant("- [/] a", "- [ ] a"));
});
