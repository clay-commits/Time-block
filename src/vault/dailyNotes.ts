import { App, TFile, normalizePath, moment } from "obsidian";
import type { TimeblockSettings } from "../settings";
import { DayData, ListsData, emptyLists } from "../data/types";
import { seedDay, previousDates } from "../data/rollover";
import {
	parseDay,
	parseLists,
	serializeDay,
	serializeLists,
} from "../data/serializer";
import { appendFencedBlock, findFencedBlock, replaceFencedBlock } from "../data/block";

type Moment = ReturnType<typeof moment>;

export interface DailyConfig {
	folder: string;
	format: string;
	template: string;
}

/**
 * Read the core Daily Notes plugin's configuration defensively (its API is
 * not public), then apply this plugin's overrides.
 */
export function getDailyConfig(app: App, settings: TimeblockSettings): DailyConfig {
	let folder = "";
	let format = "YYYY-MM-DD";
	let template = "";
	try {
		const options = (app as unknown as {
			internalPlugins?: {
				getPluginById?: (id: string) => {
					instance?: { options?: Record<string, unknown> };
				} | null;
			};
		}).internalPlugins?.getPluginById?.("daily-notes")?.instance?.options;
		if (options) {
			if (typeof options.folder === "string") folder = options.folder;
			if (typeof options.format === "string" && options.format !== "")
				format = options.format;
			if (typeof options.template === "string") template = options.template;
		}
	} catch {
		// fall through to defaults
	}
	if (settings.dailyFolderOverride.trim() !== "")
		folder = settings.dailyFolderOverride.trim();
	if (settings.dailyFormatOverride.trim() !== "")
		format = settings.dailyFormatOverride.trim();
	return { folder, format, template };
}

export function dailyNotePath(config: DailyConfig, m: Moment): string {
	const name = m.format(config.format);
	const folder = config.folder.replace(/^\/+|\/+$/g, "");
	return normalizePath((folder ? folder + "/" : "") + name + ".md");
}

/** Derive the YYYY-MM-DD date a daily-note path represents, or null. */
export function dateForDailyPath(
	app: App,
	settings: TimeblockSettings,
	path: string
): string | null {
	const config = getDailyConfig(app, settings);
	const folder = config.folder.replace(/^\/+|\/+$/g, "");
	const prefix = folder ? folder + "/" : "";
	if (!path.startsWith(prefix) || !path.endsWith(".md")) return null;
	const name = path.slice(prefix.length, -3);
	const m = moment(name, config.format, true);
	return m.isValid() ? m.format("YYYY-MM-DD") : null;
}

async function ensureFolderExists(app: App, filePath: string): Promise<void> {
	const parts = filePath.split("/").slice(0, -1);
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			try {
				await app.vault.createFolder(current);
			} catch {
				// folder may have been created concurrently
			}
		}
	}
}

function applyTemplateVars(text: string, m: Moment, title: string): string {
	return text.replace(
		/{{\s*(date|time|title)(?::([^}]+))?\s*}}/gi,
		(_match, key: string, fmt: string | undefined) => {
			const k = key.toLowerCase();
			if (k === "title") return title;
			return m.format(fmt ?? (k === "date" ? "YYYY-MM-DD" : "HH:mm"));
		}
	);
}

async function templateContents(
	app: App,
	templatePath: string,
	m: Moment,
	title: string
): Promise<string> {
	if (!templatePath) return "";
	const candidates = [templatePath, templatePath + ".md"];
	for (const candidate of candidates) {
		const file = app.vault.getAbstractFileByPath(normalizePath(candidate));
		if (file instanceof TFile) {
			try {
				const text = await app.vault.read(file);
				return applyTemplateVars(text, m, title);
			} catch {
				return "";
			}
		}
	}
	return "";
}

/**
 * Most recent previous day (within the lookback window) that has a parseable
 * timeblock block. Unparseable or blockless notes are skipped, never touched.
 */
export async function findPreviousDayData(
	app: App,
	settings: TimeblockSettings,
	todayDate: string
): Promise<DayData | null> {
	const config = getDailyConfig(app, settings);
	for (const date of previousDates(todayDate, settings.rolloverLookbackDays)) {
		const m = moment(date, "YYYY-MM-DD", true);
		if (!m.isValid()) continue;
		const path = dailyNotePath(config, m);
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) continue;
		let content: string;
		try {
			content = await app.vault.read(file);
		} catch {
			continue;
		}
		const found = findFencedBlock(content, "timeblock");
		if (!found) continue;
		try {
			return parseDay(found.inner, date);
		} catch {
			continue;
		}
	}
	return null;
}

/**
 * Create today's daily note if missing (honoring the core template), seed the
 * timeblock block if absent — rollover runs exactly here, block existence
 * being the idempotency latch — and return the file.
 */
export async function ensureTodayPlanner(
	app: App,
	settings: TimeblockSettings
): Promise<TFile> {
	const m = moment();
	const todayDate = m.format("YYYY-MM-DD");
	const config = getDailyConfig(app, settings);
	const path = dailyNotePath(config, m);

	let file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		await ensureFolderExists(app, path);
		const title = path.split("/").pop()!.replace(/\.md$/, "");
		const initial = await templateContents(app, config.template, m, title);
		try {
			file = await app.vault.create(path, initial);
		} catch {
			// created concurrently (sync, another command) — re-resolve
			file = app.vault.getAbstractFileByPath(path);
		}
		if (!(file instanceof TFile)) {
			throw new Error(`Timeblock Daily: could not create ${path}`);
		}
	}

	const content = await app.vault.read(file);
	const existing = findFencedBlock(content, "timeblock");
	const needsSeed = !existing || existing.inner.trim() === "";
	if (needsSeed) {
		const prev = await findPreviousDayData(app, settings, todayDate);
		const yaml = serializeDay(seedDay(todayDate, prev));
		await app.vault.process(file, (current) => {
			const found = findFencedBlock(current, "timeblock");
			if (!found) return appendFencedBlock(current, "timeblock", yaml);
			// Empty block (e.g. from the user's daily template): seed it in place.
			if (found.inner.trim() === "")
				return replaceFencedBlock(current, found, yaml);
			return current;
		});
	}
	return file;
}

/**
 * Ensure the lists file exists with a timeblock-lists block, returning the
 * file and the parsed lists (null lists when the block is unparseable —
 * unparseable YAML is never overwritten).
 */
export async function ensureListsFile(
	app: App,
	settings: TimeblockSettings
): Promise<{ file: TFile; lists: ListsData | null; inner: string }> {
	const raw = settings.listsFilePath.trim() || "Timeblock/Lists.md";
	const path = normalizePath(raw.endsWith(".md") ? raw : raw + ".md");
	let file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		await ensureFolderExists(app, path);
		const yaml = serializeLists(emptyLists());
		const body = appendFencedBlock("# Lists to remember\n", "timeblock-lists", yaml);
		try {
			file = await app.vault.create(path, body);
		} catch {
			file = app.vault.getAbstractFileByPath(path);
		}
		if (!(file instanceof TFile)) {
			throw new Error(`Timeblock Daily: could not create ${path}`);
		}
	}

	let content = await app.vault.read(file);
	let found = findFencedBlock(content, "timeblock-lists");
	if (!found) {
		await app.vault.process(file, (current) =>
			findFencedBlock(current, "timeblock-lists")
				? current
				: appendFencedBlock(current, "timeblock-lists", serializeLists(emptyLists()))
		);
		content = await app.vault.read(file);
		found = findFencedBlock(content, "timeblock-lists");
	}
	if (!found) throw new Error("Timeblock Daily: lists block missing after create");

	try {
		return { file, lists: parseLists(found.inner), inner: found.inner };
	} catch {
		return { file, lists: null, inner: found.inner };
	}
}
