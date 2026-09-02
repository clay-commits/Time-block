import { App, TFile } from "obsidian";
import type { TimeblockSettings } from "../settings";
import { VaultTask } from "../data/types";
import { completeTaskLine, folderRulesAllow, parseTaskLine } from "../data/vaultTasks";
import { localIsoTimestamp } from "../data/ids";

interface CacheEntry {
	mtime: number;
	size: number;
	tasks: VaultTask[];
}

function dateOf(epochMs: number): string | null {
	if (!Number.isFinite(epochMs) || epochMs <= 0) return null;
	return localIsoTimestamp(new Date(epochMs)).slice(0, 10);
}

/** "YYYY-MM-DD HH:MM" local, for the ✅ stamp written into the source note. */
export function completionStamp(d: Date = new Date()): string {
	const iso = localIsoTimestamp(d);
	return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/**
 * Finds open "- [ ]" lines across the vault using Obsidian's metadata cache
 * (so only notes that actually contain task items are read), with a per-file
 * cache keyed on mtime+size so unchanged notes are never re-read.
 */
export class VaultTaskScanner {
	private readonly cache = new Map<string, CacheEntry>();

	constructor(private readonly app: App) {}

	invalidate(path: string): void {
		this.cache.delete(path);
	}

	async scan(settings: TimeblockSettings): Promise<VaultTask[]> {
		const out: VaultTask[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (
				!folderRulesAllow(
					file.path,
					settings.vaultTaskIncludeFolders,
					settings.vaultTaskExcludeFolders
				)
			)
				continue;
			const meta = this.app.metadataCache.getFileCache(file);
			const openItems = (meta?.listItems ?? []).filter((li) => li.task === " ");
			if (openItems.length === 0) continue;

			const cached = this.cache.get(file.path);
			if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
				out.push(...cached.tasks);
				continue;
			}

			let content: string;
			try {
				content = await this.app.vault.cachedRead(file);
			} catch {
				continue;
			}
			const lines = content.split("\n");
			const fallbackCreated = dateOf(file.stat.ctime);
			const tasks: VaultTask[] = [];
			for (const li of openItems) {
				const lineNumber = li.position.start.line;
				const raw = lines[lineNumber];
				if (raw === undefined) continue;
				const task = parseTaskLine(raw, file.path, lineNumber, fallbackCreated);
				if (task && !task.done) tasks.push(task);
			}
			this.cache.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, tasks });
			out.push(...tasks);
		}
		return out;
	}
}

export type CompleteResult = "done" | "already" | "missing";

/**
 * Mark a task line done in its source note: the first line whose text equals
 * the recorded raw line becomes "- [x] … ✅ YYYY-MM-DD HH:MM". Only that line
 * changes; the rest of the note is preserved byte-for-byte.
 */
export async function completeInSource(
	app: App,
	source: { path: string; line: string },
	stamp: string = completionStamp()
): Promise<CompleteResult> {
	const file = app.vault.getAbstractFileByPath(source.path);
	if (!(file instanceof TFile)) return "missing";
	let result: CompleteResult = "missing";
	const target = source.line.replace(/\r$/, "");
	await app.vault.process(file, (content) => {
		const lines = content.split("\n");
		const idx = lines.findIndex((l) => l.replace(/\r$/, "") === target);
		if (idx === -1) return content;
		const current = lines[idx]!;
		const updated = completeTaskLine(current, stamp);
		if (updated === current) {
			result = "already";
			return content;
		}
		lines[idx] = updated;
		result = "done";
		return lines.join("\n");
	});
	return result;
}

/** Open the note a vault task lives in, scrolled to its line. */
export async function openVaultTask(app: App, task: VaultTask): Promise<void> {
	const file = app.vault.getAbstractFileByPath(task.path);
	if (!(file instanceof TFile)) return;
	await app.workspace.getLeaf(false).openFile(file, {
		eState: { line: task.lineNumber },
	});
}
