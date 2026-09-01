/** Item id: prefix + base36 timestamp + base36 random tail, e.g. "task-lx2f0a1b-k3f9". */
export function makeId(
	prefix: string,
	now: number = Date.now(),
	random: () => number = Math.random
): string {
	const time = now.toString(36);
	let tail = "";
	for (let i = 0; i < 4; i++) {
		tail += Math.floor(random() * 36).toString(36);
	}
	return `${prefix}-${time}-${tail}`;
}

/** ISO-8601 timestamp carrying the local UTC offset (never "Z"), second precision. */
export function localIsoTimestamp(d: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	const offsetMin = -d.getTimezoneOffset();
	const sign = offsetMin >= 0 ? "+" : "-";
	const abs = Math.abs(offsetMin);
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
		`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
		`${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
	);
}
