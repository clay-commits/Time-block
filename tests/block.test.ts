import { test } from "node:test";
import assert from "node:assert/strict";
import {
	findFencedBlock,
	replaceFencedBlock,
	appendFencedBlock,
} from "../src/data/block";

const YAML = "version: 1\ndate: 2026-09-01\n";

test("finds a simple timeblock block and extracts inner content", () => {
	const doc = `# Daily\n\n\`\`\`timeblock\n${YAML}\`\`\`\n\ntrailing text\n`;
	const found = findFencedBlock(doc, "timeblock");
	assert.ok(found);
	assert.equal(found.inner, YAML);
	assert.equal(found.closed, true);
	assert.equal(doc.slice(found.outerStart, found.outerEnd), `\`\`\`timeblock\n${YAML}\`\`\`\n`);
});

test("skips other code fences, including ones containing the word timeblock", () => {
	const doc = [
		"```js",
		"const s = '```timeblock';",
		"```",
		"",
		"````markdown",
		"```timeblock",
		"decoy: true",
		"```",
		"````",
		"",
		"~~~python",
		"# ```timeblock inside tildes",
		"~~~",
		"",
		"```timeblock",
		YAML.trimEnd(),
		"```",
		"",
	].join("\n");
	const found = findFencedBlock(doc, "timeblock");
	assert.ok(found);
	assert.equal(found.inner, YAML);
});

test("does not match timeblock-lists when looking for timeblock (and vice versa)", () => {
	const doc = "```timeblock-lists\nversion: 1\nlists: []\n```\n";
	assert.equal(findFencedBlock(doc, "timeblock"), null);
	const found = findFencedBlock(doc, "timeblock-lists");
	assert.ok(found);
	assert.equal(found.inner, "version: 1\nlists: []\n");
});

test("block at EOF without trailing newline", () => {
	const doc = "intro\n\n```timeblock\n" + YAML + "```";
	const found = findFencedBlock(doc, "timeblock");
	assert.ok(found);
	assert.equal(found.inner, YAML);
	assert.equal(found.closed, true);
	const replaced = replaceFencedBlock(doc, found, "notes: hi\n");
	assert.equal(replaced, "intro\n\n```timeblock\nnotes: hi\n```");
});

test("unclosed block at EOF is treated as running to EOF and gets closed on replace", () => {
	const doc = "intro\n\n```timeblock\n" + YAML;
	const found = findFencedBlock(doc, "timeblock");
	assert.ok(found);
	assert.equal(found.closed, false);
	assert.equal(found.inner, YAML);
	const replaced = replaceFencedBlock(doc, found, "notes: hi\n");
	assert.equal(replaced, "intro\n\n```timeblock\nnotes: hi\n```\n");
});

test("replace preserves every byte outside the fenced region", () => {
	const before = "# Title\n\nsome text\n\n";
	const after = "\n\nmore text with ``` inline\n- list\n";
	const doc = before + "```timeblock\n" + YAML + "```" + after;
	const found = findFencedBlock(doc, "timeblock");
	assert.ok(found);
	const replaced = replaceFencedBlock(doc, found, "x: 1\n");
	assert.equal(replaced, before + "```timeblock\nx: 1\n```" + after);
});

test("longer fences work (````timeblock closed by ````)", () => {
	const doc = "````timeblock\n" + YAML + "````\n";
	const found = findFencedBlock(doc, "timeblock");
	assert.ok(found);
	assert.equal(found.inner, YAML);
	const replaced = replaceFencedBlock(doc, found, "y: 2\n");
	assert.equal(replaced, "````timeblock\ny: 2\n````\n");
});

test("indented backtick runs inside the block do not close it (closing fence must be column 0)", () => {
	const inner = "notes: |\n  ```\n  code inside notes\n  ```\ndate: 2026-09-01\n";
	const doc = "```timeblock\n" + inner + "```\n";
	const found = findFencedBlock(doc, "timeblock");
	assert.ok(found);
	assert.equal(found.inner, inner);
});

test("empty block (opener immediately followed by closer)", () => {
	const doc = "```timeblock\n```\n";
	const found = findFencedBlock(doc, "timeblock");
	assert.ok(found);
	assert.equal(found.inner, "");
	const replaced = replaceFencedBlock(doc, found, "a: 1\n");
	assert.equal(replaced, "```timeblock\na: 1\n```\n");
});

test("opener as the very last line of the file", () => {
	const doc = "text\n```timeblock";
	const found = findFencedBlock(doc, "timeblock");
	assert.ok(found);
	assert.equal(found.inner, "");
	assert.equal(found.closed, false);
	const replaced = replaceFencedBlock(doc, found, "a: 1\n");
	assert.equal(replaced, "text\n```timeblock\na: 1\n```\n");
});

test("no block returns null", () => {
	assert.equal(findFencedBlock("just some text\n", "timeblock"), null);
	assert.equal(findFencedBlock("", "timeblock"), null);
});

test("only the FIRST timeblock block is managed", () => {
	const doc =
		"```timeblock\nfirst: 1\n```\n\n```timeblock\nsecond: 2\n```\n";
	const found = findFencedBlock(doc, "timeblock");
	assert.ok(found);
	assert.equal(found.inner, "first: 1\n");
	const replaced = replaceFencedBlock(doc, found, "first: changed\n");
	assert.equal(
		replaced,
		"```timeblock\nfirst: changed\n```\n\n```timeblock\nsecond: 2\n```\n"
	);
});

test("append to empty file, file without trailing newline, and file with one", () => {
	assert.equal(
		appendFencedBlock("", "timeblock", "a: 1\n"),
		"```timeblock\na: 1\n```\n"
	);
	assert.equal(
		appendFencedBlock("text", "timeblock", "a: 1\n"),
		"text\n\n```timeblock\na: 1\n```\n"
	);
	assert.equal(
		appendFencedBlock("text\n", "timeblock", "a: 1"),
		"text\n\n```timeblock\na: 1\n```\n"
	);
	assert.equal(
		appendFencedBlock("text\n\n", "timeblock", "a: 1\n"),
		"text\n\n```timeblock\na: 1\n```\n"
	);
});

test("find → replace round-trip is stable when content is unchanged", () => {
	const doc = "pre\n\n```timeblock\n" + YAML + "```\n\npost\n";
	const found = findFencedBlock(doc, "timeblock");
	assert.ok(found);
	assert.equal(replaceFencedBlock(doc, found, found.inner), doc);
});

// ---------------------------------------------------------------------------
// Review-pass regressions: CRLF, fence variants, semantic inner equality
// ---------------------------------------------------------------------------

import { sameInner } from "../src/data/block";

test("CRLF notes: block is found, inner keeps bytes, replace touches only the region", () => {
	const doc = "# t\r\n```timeblock\r\nversion: 1\r\n```\r\nrest\r\n";
	const found = findFencedBlock(doc, "timeblock");
	assert.ok(found, "fence must be found in a CRLF file");
	assert.equal(found.inner, "version: 1\r\n");
	const replaced = replaceFencedBlock(doc, found, "version: 2\n");
	assert.equal(replaced, "# t\r\n```timeblock\r\nversion: 2\n```\r\nrest\r\n");
});

test("info string with extra tokens still names the language by first token", () => {
	const doc = "```timeblock extra tokens\na: 1\n```\n";
	const found = findFencedBlock(doc, "timeblock");
	assert.ok(found);
	assert.equal(found.inner, "a: 1\n");
	// but a longer first token is a different language
	assert.equal(findFencedBlock("```timeblock-lists\na: 1\n```\n", "timeblock"), null);
});

test("tilde-fenced timeblock blocks are found and replaced, fences preserved", () => {
	const doc = "~~~timeblock\na: 1\n~~~\n";
	const found = findFencedBlock(doc, "timeblock");
	assert.ok(found);
	assert.equal(found.inner, "a: 1\n");
	assert.equal(replaceFencedBlock(doc, found, "a: 2\n"), "~~~timeblock\na: 2\n~~~\n");
});

test("sameInner tolerates CRLF and trailing blank lines but not real differences", () => {
	assert.ok(sameInner("a: 1\r\nb: 2\r\n", "a: 1\nb: 2\n"));
	assert.ok(sameInner("a: 1\n\n", "a: 1\n"));
	assert.ok(sameInner("a: 1", "a: 1\n"));
	assert.ok(sameInner("", "\n"));
	assert.ok(!sameInner("a: 1\n", "a: 2\n"));
	assert.ok(!sameInner("a: 1\n\nb: 2\n", "a: 1\nb: 2\n"));
});
