// Debounced, atomic persistence for one fenced block in one file.
// Only type-only imports from "obsidian" so this module stays headless-testable.

import type { TFile } from "obsidian";
import { findFencedBlock, replaceFencedBlock, sameInner } from "../data/block";

export interface Scheduler {
	set(fn: () => void, delayMs: number): unknown;
	clear(handle: unknown): void;
}

// `window` is looked up lazily, inside the arrow functions, so this module
// still loads headless (tests inject their own scheduler and never call these).
const defaultScheduler: Scheduler = {
	set: (fn, delayMs) => window.setTimeout(fn, delayMs),
	clear: (handle) => window.clearTimeout(handle as number),
};

/** Trailing-edge debouncer with an awaitable flush. Pure; scheduler injectable. */
export class Debouncer {
	private handle: unknown = null;

	constructor(
		private readonly delayMs: number,
		private readonly fn: () => void | Promise<void>,
		private readonly scheduler: Scheduler = defaultScheduler
	) {}

	schedule(): void {
		if (this.handle != null) this.scheduler.clear(this.handle);
		this.handle = this.scheduler.set(() => {
			this.handle = null;
			void this.fn();
		}, this.delayMs);
	}

	async flush(): Promise<void> {
		if (this.handle == null) return;
		this.scheduler.clear(this.handle);
		this.handle = null;
		await this.fn();
	}

	cancel(): void {
		if (this.handle != null) {
			this.scheduler.clear(this.handle);
			this.handle = null;
		}
	}

	get pending(): boolean {
		return this.handle != null;
	}
}

/** The one vault capability BlockWriter needs; matches Obsidian's Vault.process. */
export interface ProcessableVault {
	process(file: TFile, fn: (data: string) => string): Promise<string>;
}

export const WRITE_DEBOUNCE_MS = 800;

/**
 * Debounced writer for one fenced block. Never writes on keystroke: queue()
 * stores the latest payload and (re)arms an 800 ms trailing debounce; flush()
 * writes immediately. Writes go through vault.process (atomic read-modify-write)
 * and replace ONLY the fenced region.
 *
 * Divergence rule: if the on-disk inner content differs from BOTH lastWritten
 * and the pending payload, someone else (user in source mode, sync, another
 * device) edited the block — the pending write is dropped and onDiverged fires
 * so the owner re-hydrates from disk. Unparseable content upstream never gets
 * here: parse errors render an error card and no writer is created.
 */
export class BlockWriter {
	private pendingInner: string | null = null;
	private lastWritten: string | null = null;
	/**
	 * Bumped whenever the owner re-hydrates from disk (dropPending /
	 * primeLastWritten). A write that was already in flight then belongs to
	 * an older picture of the file: it must not land, must not be recorded as
	 * lastWritten, and must not be retried — otherwise a stale payload could
	 * overwrite the newer content the owner just loaded.
	 */
	private epoch = 0;
	private readonly debouncer: Debouncer;
	private writeChain: Promise<void> = Promise.resolve();

	constructor(
		private readonly vault: ProcessableVault,
		private readonly getFile: () => TFile | null,
		private readonly lang: string,
		private readonly onDiverged: (diskInner: string | null) => void,
		delayMs: number = WRITE_DEBOUNCE_MS,
		scheduler?: Scheduler
	) {
		this.debouncer = new Debouncer(delayMs, () => this.writeNow(), scheduler);
	}

	/** Record what the block looked like when we hydrated from disk. */
	primeLastWritten(inner: string): void {
		this.lastWritten = inner;
		this.epoch++;
	}

	getLastWritten(): string | null {
		return this.lastWritten;
	}

	get hasPending(): boolean {
		return this.pendingInner != null || this.debouncer.pending;
	}

	queue(inner: string): void {
		this.pendingInner = inner;
		this.debouncer.schedule();
	}

	dropPending(): void {
		this.pendingInner = null;
		this.debouncer.cancel();
		this.epoch++;
	}

	async flush(): Promise<void> {
		await this.debouncer.flush();
		if (this.pendingInner != null) await this.writeNow();
		await this.writeChain;
	}

	private writeNow(): Promise<void> {
		this.writeChain = this.writeChain.then(() => this.doWrite());
		return this.writeChain;
	}

	private async doWrite(): Promise<void> {
		const inner = this.pendingInner;
		if (inner == null) return;
		this.pendingInner = null;
		const file = this.getFile();
		if (!file) return;
		const epoch = this.epoch;
		const superseded = () => this.epoch !== epoch;

		let diverged: { disk: string | null } | null = null;
		// lastWritten must only be committed AFTER vault.process resolves: a
		// failed write with lastWritten already advanced would make the retry
		// look like an external divergence and silently drop the edit.
		let commitLastWritten: string | null = null;
		try {
			await this.vault.process(file, (content) => {
				// The owner re-hydrated while we waited for the file: this
				// payload describes an older state — leave the note alone.
				if (superseded()) return content;
				const found = findFencedBlock(content, this.lang);
				if (!found) {
					// Block was deleted out from under us — never resurrect it.
					diverged = { disk: null };
					return content;
				}
				if (sameInner(found.inner, inner)) {
					commitLastWritten = found.inner;
					return content;
				}
				if (this.lastWritten != null && !sameInner(found.inner, this.lastWritten)) {
					diverged = { disk: found.inner };
					return content;
				}
				commitLastWritten = inner;
				return replaceFencedBlock(content, found, inner);
			});
			if (commitLastWritten != null && !superseded()) this.lastWritten = commitLastWritten;
		} catch (e) {
			// Superseded meanwhile: the owner holds newer content; nothing to retry.
			if (superseded()) return;
			// Disk write failed (file gone, IO error): keep the payload pending and
			// re-arm the debounce so it retries instead of silently losing the edit.
			if (this.pendingInner == null) {
				this.pendingInner = inner;
				this.debouncer.schedule();
			}
			console.error("Timeblock Daily: failed to write block", e);
			return;
		}
		if (diverged && !superseded()) {
			this.dropPending();
			this.onDiverged((diverged as { disk: string | null }).disk);
		}
	}
}
