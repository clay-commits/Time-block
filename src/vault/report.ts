import { App, TFile, moment, normalizePath } from "obsidian";
import type { TimeblockSettings } from "../settings";
import { findFencedBlock } from "../data/block";
import { parseDay } from "../data/serializer";
import { localIsoTimestamp } from "../data/ids";
import { ReportDay, buildReport, dateRange } from "../data/report";
import { dailyNotePath, ensureFolderExists, getDailyConfig } from "./dailyNotes";

/**
 * Read every daily planner in [start, end], build the review report, write it
 * to the reports folder (overwriting a previous report for the same range —
 * it is generated output), and return the note.
 */
export async function buildReviewReport(
	app: App,
	settings: TimeblockSettings,
	start: string,
	end: string
): Promise<TFile> {
	const dates = dateRange(start, end);
	if (dates.length === 0) throw new Error("Invalid date range");
	const config = getDailyConfig(app, settings);

	const days: ReportDay[] = [];
	for (const date of dates) {
		const m = moment(date, "YYYY-MM-DD", true);
		const path = dailyNotePath(config, m);
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			days.push({ date, day: null });
			continue;
		}
		let content: string;
		try {
			content = await app.vault.cachedRead(file);
		} catch {
			days.push({ date, day: null, unreadable: true });
			continue;
		}
		const found = findFencedBlock(content, "timeblock");
		if (!found) {
			days.push({ date, day: null });
			continue;
		}
		try {
			days.push({ date, day: parseDay(found.inner, date) });
		} catch {
			days.push({ date, day: null, unreadable: true });
		}
	}

	const markdown = buildReport(days, { start, end, generatedAt: localIsoTimestamp() });
	const folder = settings.reportsFolder.trim().replace(/^\/+|\/+$/g, "") || "Timeblock/Reviews";
	const path = normalizePath(`${folder}/${start}_to_${end}.md`);
	await ensureFolderExists(app, path);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.modify(existing, markdown);
		return existing;
	}
	return app.vault.create(path, markdown);
}
