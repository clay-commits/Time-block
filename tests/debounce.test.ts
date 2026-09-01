import { test } from "node:test";
import assert from "node:assert/strict";
import type { TFile } from "obsidian";
import {
	BlockWriter,
	Debouncer,
	Scheduler,
} from "../src/write/BlockWriter";
import { appendFencedBlock, findFencedBlock } from "../src/data/block";

/** Deterministic fake scheduler: fires timers only when advance() is called. */
class FakeScheduler implements Scheduler {
	private timers = new Map<number, { fn: () => void; at: number }>();
	private nextId = 1;
	now = 0;

	set(fn: () => void, delayMs: number): unknown {
		const id = this.nextId++;
		this.timers.set(id, { fn, at: this.now + delayMs });
		return id;
	}

	clear(handle: unknown): void {
		this.timers.delete(handle as number);
	}

	advance(ms: number): void {
		this.now += ms;
		for (const [id, t] of [...this.timers.entries()]) {
			if (t.at <= this.now) {
				this.timers.delete(id);
				t.fn();
			}
		}
	}

	get armed(): number {
		return this.timers.size;
	}
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

test("debouncer coalesces rapid schedules into one trailing call", async () => {
	const sched = new FakeScheduler();
	let calls = 0;
	const d = new Debouncer(800, () => void calls++, sched);
	d.schedule();
	sched.advance(300);
	d.schedule();
	sched.advance(300);
	d.schedule();
	assert.equal(calls, 0);
	sched.advance(799);
	assert.equal(calls, 0);
	sched.advance(1);
	assert.equal(calls, 1);
	// nothing further armed
	sched.advance(10000);
	assert.equal(calls, 1);
});

test("flush runs a pending call immediately and disarms the timer", async () => {
	const sched = new FakeScheduler();
	let calls = 0;
	const d = new Debouncer(800, () => void calls++, sched);
	d.schedule();
	await d.flush();
	assert.equal(calls, 1);
	assert.equal(sched.armed, 0);
	// flush with nothing pending is a no-op
	await d.flush();
	assert.equal(calls, 1);
});

test("cancel drops the pending call", () => {
	const sched = new FakeScheduler();
	let calls = 0;
	const d = new Debouncer(800, () => void calls++, sched);
	d.schedule();
	d.cancel();
	sched.advance(10000);
	assert.equal(calls, 0);
});

test("scheduling again after firing fires again", () => {
	const sched = new FakeScheduler();
	let calls = 0;
	const d = new Debouncer(800, () => void calls++, sched);
	d.schedule();
	sched.advance(800);
	d.schedule();
	sched.advance(800);
	assert.equal(calls, 2);
});

// ---------------------------------------------------------------------------
// BlockWriter against a fake vault
// ---------------------------------------------------------------------------

class FakeVault {
	writes = 0;
	constructor(public content: string) {}
	async process(_file: TFile, fn: (data: string) => string): Promise<string> {
		const next = fn(this.content);
		if (next !== this.content) this.writes++;
		this.content = next;
		return next;
	}
}

const FILE = {} as TFile;

function makeWriter(
	vault: FakeVault,
	sched: FakeScheduler,
	onDiverged: (disk: string | null) => void = () => {}
) {
	return new BlockWriter(vault, () => FILE, "timeblock", onDiverged, 800, sched);
}

test("writer coalesces queues and writes only the final payload", async () => {
	const vault = new FakeVault(appendFencedBlock("# note\n", "timeblock", "a: 1\n"));
	const sched = new FakeScheduler();
	const writer = makeWriter(vault, sched);
	writer.primeLastWritten("a: 1\n");
	writer.queue("a: 2\n");
	sched.advance(400);
	writer.queue("a: 3\n");
	sched.advance(800);
	await tick();
	assert.equal(vault.writes, 1);
	assert.equal(findFencedBlock(vault.content, "timeblock")!.inner, "a: 3\n");
	assert.match(vault.content, /^# note\n/);
});

test("writer replaces only the fenced region", async () => {
	const before = "# head\n\nbody text\n\n```timeblock\na: 1\n```\n\ntail\n";
	const vault = new FakeVault(before);
	const sched = new FakeScheduler();
	const writer = makeWriter(vault, sched);
	writer.primeLastWritten("a: 1\n");
	writer.queue("a: 2\n");
	await writer.flush();
	assert.equal(vault.content, "# head\n\nbody text\n\n```timeblock\na: 2\n```\n\ntail\n");
});

test("divergence: disk differs from both lastWritten and pending → drop + notify", async () => {
	const vault = new FakeVault("```timeblock\nuser-edited: true\n```\n");
	const sched = new FakeScheduler();
	let divergedWith: string | null | undefined;
	const writer = makeWriter(vault, sched, (disk) => (divergedWith = disk));
	writer.primeLastWritten("a: 1\n"); // we hydrated from "a: 1"
	writer.queue("a: 2\n"); // meanwhile the disk changed to user-edited
	await writer.flush();
	assert.equal(divergedWith, "user-edited: true\n");
	assert.equal(vault.content, "```timeblock\nuser-edited: true\n```\n");
	assert.equal(writer.hasPending, false);
});

test("no divergence when disk already equals the pending payload (echo)", async () => {
	const vault = new FakeVault("```timeblock\na: 2\n```\n");
	const sched = new FakeScheduler();
	let diverged = false;
	const writer = makeWriter(vault, sched, () => (diverged = true));
	writer.primeLastWritten("a: 1\n");
	writer.queue("a: 2\n");
	await writer.flush();
	assert.equal(diverged, false);
	assert.equal(vault.writes, 0);
	assert.equal(writer.getLastWritten(), "a: 2\n");
});

test("block deleted from the note → pending dropped, never resurrected", async () => {
	const vault = new FakeVault("# the user deleted the whole block\n");
	const sched = new FakeScheduler();
	let divergedWith: string | null | undefined = "unset";
	const writer = makeWriter(vault, sched, (disk) => (divergedWith = disk));
	writer.primeLastWritten("a: 1\n");
	writer.queue("a: 2\n");
	await writer.flush();
	assert.equal(divergedWith, null);
	assert.equal(vault.content, "# the user deleted the whole block\n");
});

test("sequential writes chain: second queue after flush writes normally", async () => {
	const vault = new FakeVault("```timeblock\na: 1\n```\n");
	const sched = new FakeScheduler();
	const writer = makeWriter(vault, sched);
	writer.primeLastWritten("a: 1\n");
	writer.queue("a: 2\n");
	await writer.flush();
	writer.queue("a: 3\n");
	await writer.flush();
	assert.equal(findFencedBlock(vault.content, "timeblock")!.inner, "a: 3\n");
	assert.equal(vault.writes, 2);
});

test("write failure keeps the payload pending for a retry", async () => {
	const sched = new FakeScheduler();
	class FailingVault {
		fails = 1;
		content = "```timeblock\na: 1\n```\n";
		async process(_f: TFile, fn: (d: string) => string): Promise<string> {
			if (this.fails-- > 0) throw new Error("disk error");
			this.content = fn(this.content);
			return this.content;
		}
	}
	const vault = new FailingVault();
	const writer = new BlockWriter(
		vault as unknown as FakeVault,
		() => FILE,
		"timeblock",
		() => {},
		800,
		sched
	);
	writer.primeLastWritten("a: 1\n");
	writer.queue("a: 2\n");
	await writer.flush(); // fails, payload retained
	assert.equal(writer.hasPending, true);
	sched.advance(800);
	await writer.flush(); // retry succeeds
	assert.equal(findFencedBlock(vault.content, "timeblock")!.inner, "a: 2\n");
});

test("write-phase failure (callback ran, then write threw) retries WITHOUT false divergence", async () => {
	const sched = new FakeScheduler();
	class WritePhaseFailVault {
		fails = 1;
		content = "```timeblock\nold: 1\n```\n";
		async process(_f: TFile, fn: (d: string) => string): Promise<string> {
			const next = fn(this.content); // callback runs first, like Obsidian
			if (this.fails-- > 0) throw new Error("disk full");
			this.content = next;
			return next;
		}
	}
	const vault = new WritePhaseFailVault();
	let diverged = false;
	const writer = new BlockWriter(
		vault as unknown as FakeVault,
		() => FILE,
		"timeblock",
		() => (diverged = true),
		800,
		sched
	);
	writer.primeLastWritten("old: 1\n");
	writer.queue("new: 2\n");
	await writer.flush(); // write phase fails after callback ran
	assert.equal(writer.hasPending, true, "payload retained for retry");
	assert.equal(diverged, false);
	sched.advance(800);
	await writer.flush();
	assert.equal(diverged, false, "retry must not be misread as divergence");
	assert.equal(findFencedBlock(vault.content, "timeblock")!.inner, "new: 2\n");
});

test("CRLF disk content does not trigger false divergence", async () => {
	const vault = new FakeVault("```timeblock\r\na: 1\r\n```\r\n");
	const sched = new FakeScheduler();
	let diverged = false;
	const writer = makeWriter(vault, sched, () => (diverged = true));
	writer.primeLastWritten("a: 1\n"); // hydrated from LF-normalized source
	writer.queue("a: 2\n");
	await writer.flush();
	assert.equal(diverged, false);
	assert.equal(findFencedBlock(vault.content, "timeblock")!.inner, "a: 2\n");
});
