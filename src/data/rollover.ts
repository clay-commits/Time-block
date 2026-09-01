import { DayData, Task, emptyDay } from "./types";

/**
 * Seed a new day from the most recent previous day (or from nothing).
 *
 * Pure and deterministic: rollover runs ONLY at block-creation time — the
 * existence of the timeblock block in the note is the idempotency latch, so
 * re-rendering or reopening a note never re-runs this, and previous notes are
 * never modified.
 *
 * - Unfinished tasks carry over with their ORIGINAL ids.
 * - carriedFrom points at the earliest origin day (prev.carriedFrom ?? prev.date).
 * - Slot placements are cleared (a new day is planned fresh).
 * - Goals and Big 6 always seed empty; goalsGhost carries the previous goals'
 *   texts (or the previous ghost, so the ritual survives a skipped day).
 */
export function seedDay(date: string, prev: DayData | null): DayData {
	const day = emptyDay(date);
	if (!prev) return day;

	const seen = new Set<string>();
	const carried: Task[] = [];
	for (const t of prev.tasks) {
		if (t.completed) continue;
		if (t.text.trim() === "") continue;
		if (seen.has(t.id)) continue;
		seen.add(t.id);
		const task: Task = {
			id: t.id,
			text: t.text,
			created: t.created,
			completed: null,
			carriedFrom: t.carriedFrom ?? prev.date,
		};
		carried.push(task);
	}
	day.tasks = carried;

	const prevGoalTexts = prev.goals
		.map((g) => g.text)
		.filter((s) => s.trim() !== "");
	day.goalsGhost =
		prevGoalTexts.length > 0 ? prevGoalTexts : [...prev.goalsGhost];
	return day;
}

/**
 * Candidate previous dates (YYYY-MM-DD), most recent first, for the rollover
 * lookback. Invalid input dates yield an empty list. UTC arithmetic so DST
 * cannot skip or repeat a day.
 */
export function previousDates(date: string, lookbackDays: number): string[] {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!m) return [];
	const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	if (!Number.isFinite(base)) return [];
	const days = Math.max(0, Math.min(365, Math.floor(lookbackDays)));
	const out: string[] = [];
	for (let i = 1; i <= days; i++) {
		const d = new Date(base - i * 86400000);
		const y = d.getUTCFullYear();
		const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
		const da = String(d.getUTCDate()).padStart(2, "0");
		out.push(`${y}-${mo}-${da}`);
	}
	return out;
}
