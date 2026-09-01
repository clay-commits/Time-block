import { test } from "node:test";
import assert from "node:assert/strict";
import {
	parseHM,
	formatHM,
	slotStarts,
	slotContaining,
} from "../src/data/slots";

test("parseHM accepts valid times and rejects garbage", () => {
	assert.equal(parseHM("06:00"), 360);
	assert.equal(parseHM("6:05"), 365);
	assert.equal(parseHM("00:00"), 0);
	assert.equal(parseHM("23:59"), 23 * 60 + 59);
	assert.equal(parseHM("24:00"), 1440);
	assert.equal(parseHM(" 07:30 "), 450);
	assert.equal(parseHM("24:01"), null);
	assert.equal(parseHM("25:00"), null);
	assert.equal(parseHM("06:60"), null);
	assert.equal(parseHM("6"), null);
	assert.equal(parseHM("06:5"), null);
	assert.equal(parseHM("six"), null);
	assert.equal(parseHM(""), null);
	assert.equal(parseHM(null), null);
	assert.equal(parseHM(600 as unknown as string), null);
});

test("formatHM pads and round-trips", () => {
	assert.equal(formatHM(360), "06:00");
	assert.equal(formatHM(365), "06:05");
	assert.equal(formatHM(0), "00:00");
	assert.equal(formatHM(1439), "23:59");
	for (const s of ["06:00", "13:45", "00:15", "23:59"]) {
		assert.equal(formatHM(parseHM(s)!), s);
	}
});

test("default day: 06:00–22:00 by 15 = 64 slots", () => {
	const slots = slotStarts("06:00", "22:00", 15);
	assert.equal(slots.length, 64);
	assert.equal(slots[0], "06:00");
	assert.equal(slots[1], "06:15");
	assert.equal(slots[slots.length - 1], "21:45");
});

test("30-minute slots", () => {
	const slots = slotStarts("06:00", "22:00", 30);
	assert.equal(slots.length, 32);
	assert.equal(slots[1], "06:30");
});

test("odd day start is respected without forced alignment", () => {
	const slots = slotStarts("06:10", "07:00", 15);
	assert.deepEqual(slots, ["06:10", "06:25", "06:40", "06:55"]);
});

test("day end that is not slot-aligned includes the final partial slot", () => {
	const slots = slotStarts("06:00", "06:40", 15);
	assert.deepEqual(slots, ["06:00", "06:15", "06:30"]);
	const slots2 = slotStarts("21:30", "22:10", 15);
	assert.deepEqual(slots2, ["21:30", "21:45", "22:00"]);
});

test("midnight-to-24:00 full day works", () => {
	const slots = slotStarts("00:00", "24:00", 30);
	assert.equal(slots.length, 48);
	assert.equal(slots[0], "00:00");
	assert.equal(slots[47], "23:30");
});

test("inverted or zero-length ranges yield no slots", () => {
	assert.deepEqual(slotStarts("22:00", "06:00", 15), []);
	assert.deepEqual(slotStarts("06:00", "06:00", 15), []);
});

test("invalid start/end/step fall back to defaults", () => {
	const slots = slotStarts("banana", "also-banana", 15);
	assert.equal(slots[0], "06:00");
	assert.equal(slots[slots.length - 1], "21:45");
	// invalid/absurd step falls back to 15
	assert.equal(slotStarts("06:00", "22:00", 0).length, 64);
	assert.equal(slotStarts("06:00", "22:00", NaN).length, 64);
	assert.equal(slotStarts("06:00", "22:00", -30).length, 64);
});

test("slotContaining finds the covering slot", () => {
	assert.equal(slotContaining(360, "06:00", "22:00", 15), "06:00");
	assert.equal(slotContaining(374, "06:00", "22:00", 15), "06:00");
	assert.equal(slotContaining(375, "06:00", "22:00", 15), "06:15");
	assert.equal(slotContaining(359, "06:00", "22:00", 15), null);
	assert.equal(slotContaining(22 * 60, "06:00", "22:00", 15), null);
	// odd start: 06:20 sits in the 06:10–06:25 slot, 06:25 starts the next
	assert.equal(slotContaining(380, "06:10", "07:00", 15), "06:10");
	assert.equal(slotContaining(385, "06:10", "07:00", 15), "06:25");
});
