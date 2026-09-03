import { App, TFile, moment, normalizePath } from "obsidian";
import type { TimeblockSettings } from "../settings";
import { findFencedBlock } from "../data/block";
import { parseDay } from "../data/serializer";
import { localIsoTimestamp } from "../data/ids";
import { ReportDay, buildReport, dateRange, firstFreePath } from "../data/report";
import { dailyNotePath, ensureFolderExists, getDailyConfig } from "./dailyNotes";

/**
 * Read every daily planner in [start, end], build the review report, write it
 * to the reports folder as a NEW note, and return it. An existing note is
 * never overwritten: a second report for the same range becomes
 * "<start>_to_<end>-2.md", then "-3", and so on.
 */
export async function buildReviewReport(
	app: App,
	settings: TimeblockSettings,
	start: string,
	end: string
): Promise<TFile> {
	const dates = dateRange(start, end);
	if (dates.length === 0) throw new Error("Invalid date range");
	if (dates[dates.length - 1] !== end) throw new Error("Date range longer than a year");
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
		if (!found || found.inner.trim() === "") {
			// No block, or an unseeded template block: not a planner day.
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
	const base = normalizePath(`${folder}/${start}_to_${end}`);
	await ensureFolderExists(app, `${base}.md`);
	const exists = (p: string) => app.vault.getAbstractFileByPath(p) !== null;
	// Only ever create; a name that turns out to be taken (created concurrently
	// by sync or another device) is skipped for the next free one.
	for (let attempt = 0; attempt < 5; attempt++) {
		const path = firstFreePath(base, exists);
		if (path === null) break;
		try {
			return await app.vault.create(path, markdown);
		} catch (e) {
			if (!exists(path)) throw e;
		}
	}
	throw new Error("Could not find a free name for the report note");
}
