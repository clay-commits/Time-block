export const DEFAULT_DAY_START = "06:00";
export const DEFAULT_DAY_END = "22:00";
export const DEFAULT_SLOT_MINUTES = 15;

/** Parse "HH:MM" to minutes since midnight. Accepts "24:00" (as a day-end bound). */
export function parseHM(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (min > 59) return null;
	if (h > 24 || (h === 24 && min > 0)) return null;
	return h * 60 + min;
}

export function formatHM(minutes: number): string {
	const clamped = Math.max(0, Math.min(1440, Math.floor(minutes)));
	const shown = clamped === 1440 ? 1440 : clamped % 1440;
	const h = Math.floor(shown / 60);
	const m = shown % 60;
	return `${String(h === 24 ? 24 : h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Slot start keys for the day grid. Invalid start/end fall back to defaults
 * per-field; an inverted or empty range yields no slots. A final partial slot
 * is included whenever its start is before dayEnd.
 */
export function slotStarts(
	dayStart: string,
	dayEnd: string,
	slotMinutes: number
): string[] {
	const start = parseHM(dayStart) ?? parseHM(DEFAULT_DAY_START)!;
	const end = parseHM(dayEnd) ?? parseHM(DEFAULT_DAY_END)!;
	const step =
		Number.isFinite(slotMinutes) && Math.floor(slotMinutes) >= 5
			? Math.floor(slotMinutes)
			: DEFAULT_SLOT_MINUTES;
	if (end <= start) return [];
	const out: string[] = [];
	for (let t = start; t < end; t += step) {
		out.push(formatHM(t));
	}
	return out;
}

/** The slot key containing the given wall-clock minutes, or null if outside the grid. */
export function slotContaining(
	minutesSinceMidnight: number,
	dayStart: string,
	dayEnd: string,
	slotMinutes: number
): string | null {
	const start = parseHM(dayStart) ?? parseHM(DEFAULT_DAY_START)!;
	const end = parseHM(dayEnd) ?? parseHM(DEFAULT_DAY_END)!;
	const step =
		Number.isFinite(slotMinutes) && Math.floor(slotMinutes) >= 5
			? Math.floor(slotMinutes)
			: DEFAULT_SLOT_MINUTES;
	if (end <= start) return null;
	if (minutesSinceMidnight < start || minutesSinceMidnight >= end) return null;
	const idx = Math.floor((minutesSinceMidnight - start) / step);
	return formatHM(start + idx * step);
}
