import { Menu, moment } from "obsidian";
import { Block } from "../data/types";
import { normalizeDay } from "../data/serializer";
import { parseHM, slotContaining, slotStarts } from "../data/slots";
import { el, iconButton } from "./components";
import type { PlannerCtx } from "./PlannerView";

/**
 * The 15-minute breakdown of the day: a vertical grid of slots with free text
 * per slot, plus click-to-assign task placement in both directions (armed task
 * → click a slot; or a slot's + menu → pick a task).
 */
export class TimeGrid {
	constructor(
		private readonly container: HTMLElement,
		private readonly ctx: PlannerCtx
	) {}

	render(): void {
		while (this.container.firstChild) this.container.removeChild(this.container.firstChild);
		const ctx = this.ctx;
		const root = el(this.container, "div", "tb-section tb-grid");
		el(root, "div", "tb-section-title", "The day, in 15s");
		const scroll = el(root, "div", "tb-grid-scroll");
		if (ctx.armedTaskId()) root.classList.add("tb-arming");

		const slots = slotStarts(
			ctx.settings.dayStart,
			ctx.settings.dayEnd,
			ctx.settings.slotMinutes
		);
		const nowMoment = moment();
		const nowSlot = slotContaining(
			nowMoment.hours() * 60 + nowMoment.minutes(),
			ctx.settings.dayStart,
			ctx.settings.dayEnd,
			ctx.settings.slotMinutes
		);

		for (const slot of slots) this.row(scroll, slot, nowSlot);
		this.renderOutsideGrid(root, new Set(slots));
	}

	private row(scroll: HTMLElement, slot: string, nowSlot: string | null): void {
		const ctx = this.ctx;
		const day = ctx.day;
		const row = el(scroll, "div", "tb-slot");
		row.setAttribute("data-tb-id", `slot-row-${slot}`);
		const minutes = parseHM(slot);
		if (minutes != null && minutes % 60 === 0) row.classList.add("tb-slot-hour");
		if (slot === nowSlot) row.classList.add("tb-now");

		el(row, "span", "tb-slot-time", slot);
		const content = el(row, "div", "tb-slot-content");

		const block: Block | undefined = day.blocks[slot];
		if (block?.taskId) {
			const task = day.tasks.find((t) => t.id === block.taskId);
			const chip = el(content, "span", "tb-chip tb-chip-task");
			el(chip, "span", "tb-chip-text", task ? task.text : "(missing task)");
			iconButton(
				chip,
				"x",
				"Remove this task from the slot",
				() => {
					const t = day.tasks.find((x) => x.id === block.taskId);
					if (t) delete t.slot;
					delete block.taskId;
					normalizeDay(day);
					ctx.changed();
					ctx.refreshTasks();
					ctx.refreshGrid();
				},
				"tb-chip-x"
			);
		}

		const input = el(content, "input", "tb-text tb-slot-input");
		input.type = "text";
		input.value = block?.text ?? "";
		input.setAttribute("data-tb-id", `slot-${slot}`);
		input.setAttribute("aria-label", `Plan for ${slot}`);
		input.setAttribute("spellcheck", "false");
		input.addEventListener("input", () => {
			const value = input.value;
			const existing = day.blocks[slot];
			if (existing) {
				existing.text = value;
				if (value.trim() === "" && !existing.taskId) delete day.blocks[slot];
			} else if (value.trim() !== "") {
				day.blocks[slot] = { text: value, created: ctx.now() };
			}
			ctx.changed();
		});

		iconButton(
			row,
			"plus",
			"Place a task on this slot",
			(evt) => this.openAssignMenu(evt, slot),
			"tb-slot-plus"
		);

		row.addEventListener("click", (evt) => {
			const armed = ctx.armedTaskId();
			if (!armed) return;
			// Ignore clicks that already did something (buttons, chip x).
			if (evt.defaultPrevented) return;
			this.assign(armed, slot);
		});
	}

	private openAssignMenu(evt: MouseEvent, slot: string): void {
		const ctx = this.ctx;
		const candidates = ctx.day.tasks.filter((t) => !t.completed && !t.slot);
		const menu = new Menu();
		if (candidates.length === 0) {
			menu.addItem((item) =>
				item.setTitle("No unplaced open tasks").setDisabled(true)
			);
		}
		for (const task of candidates) {
			menu.addItem((item) =>
				item
					.setTitle(task.text)
					.setIcon("circle")
					.onClick(() => this.assign(task.id, slot))
			);
		}
		menu.showAtMouseEvent(evt);
	}

	private assign(taskId: string, slot: string): void {
		const ctx = this.ctx;
		const task = ctx.day.tasks.find((t) => t.id === taskId);
		if (!task) {
			ctx.armTask(null);
			return;
		}
		// Reassigning to an occupied slot: the previous occupant is released.
		for (const t of ctx.day.tasks) {
			if (t.id !== taskId && t.slot === slot) delete t.slot;
		}
		task.slot = slot;
		normalizeDay(ctx.day);
		ctx.armTask(null);
		ctx.changed();
		ctx.refreshTasks();
		ctx.refreshGrid();
	}

	private renderOutsideGrid(root: HTMLElement, gridSlots: Set<string>): void {
		const day = this.ctx.day;
		const orphans = Object.keys(day.blocks)
			.filter((key) => !gridSlots.has(key))
			.sort();
		if (orphans.length === 0) return;
		const box = el(root, "div", "tb-outside");
		el(
			box,
			"div",
			"tb-outside-title",
			"Outside the current day range (change Day starts/ends in settings to see these)"
		);
		for (const key of orphans) {
			const b = day.blocks[key];
			if (!b) continue;
			const line = el(box, "div", "tb-outside-row");
			el(line, "span", "tb-slot-time", key);
			const task = b.taskId ? day.tasks.find((t) => t.id === b.taskId) : null;
			el(
				line,
				"span",
				"tb-outside-text",
				[task ? `[${task.text}]` : "", b.text].filter(Boolean).join(" ")
			);
		}
	}
}
