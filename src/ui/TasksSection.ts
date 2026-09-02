import { Task } from "../data/types";
import { makeId } from "../data/ids";
import { normalizeDay } from "../data/serializer";
import { badge, checkbox, el, iconButton, section, textInput } from "./components";
import type { PlannerCtx } from "./PlannerView";

/**
 * Task inbox: add/edit/check tasks. Unfinished tasks from the previous day
 * arrive with a "carried over" badge. Placing a task on the grid is
 * click-to-assign: arm the task here, then click a slot (or use the slot's
 * own + menu).
 */
export class TasksSection {
	constructor(
		private readonly container: HTMLElement,
		private readonly ctx: PlannerCtx
	) {}

	render(): void {
		while (this.container.firstChild) this.container.removeChild(this.container.firstChild);
		const { body } = section(this.container, "Task inbox", "tb-tasks");
		const list = el(body, "div", "tb-task-list");
		for (const task of this.ctx.day.tasks) this.row(list, task);

		const addRow = el(body, "div", "tb-row tb-task-add");
		textInput(addRow, {
			value: "",
			placeholder: "Add a task, press Enter…",
			tbId: "task-add",
			ariaLabel: "Add a task",
			onEnter: (value, input) => {
				const text = value.trim();
				if (text === "") return;
				this.ctx.day.tasks.push({
					id: makeId("task"),
					text,
					created: this.ctx.now(),
					completed: null,
				});
				input.value = "";
				this.ctx.changed();
				this.ctx.refreshTasks();
			},
		});
	}

	private row(list: HTMLElement, task: Task): void {
		const ctx = this.ctx;
		const row = el(list, "div", "tb-row tb-task-row");
		row.setAttribute("data-tb-id", `task-row-${task.id}`);
		if (task.completed) row.classList.add("tb-done");
		if (ctx.armedTaskId() === task.id) row.classList.add("tb-armed");

		checkbox(row, !!task.completed, `Task done: ${task.text}`, (checked) => {
			task.completed = checked ? ctx.now() : null;
			row.classList.toggle("tb-done", checked);
			ctx.changed();
			if (checked && task.source) ctx.completeSource(task);
		});

		textInput(row, {
			value: task.text,
			tbId: `task-${task.id}`,
			ariaLabel: "Task text",
			onInput: (value) => {
				task.text = value;
				ctx.changed();
			},
		});

		const meta = el(row, "span", "tb-row-meta");
		if (task.source) {
			const note = task.source.path.split("/").pop()?.replace(/\.md$/, "") ?? task.source.path;
			badge(meta, `from ${note}`, "tb-badge-carried", task.source.path);
		}
		if (task.carriedFrom) {
			badge(meta, "carried over", "tb-badge-carried", `First entered ${task.carriedFrom}`);
		}
		if (task.slot) {
			const chip = badge(meta, task.slot, "tb-chip tb-chip-slot", "Placed on the time grid");
			iconButton(
				chip,
				"x",
				"Remove from the time grid",
				() => {
					delete task.slot;
					normalizeDay(ctx.day);
					ctx.changed();
					ctx.refreshTasks();
					ctx.refreshGrid();
				},
				"tb-chip-x"
			);
		} else if (!task.completed) {
			iconButton(
				meta,
				"clock",
				ctx.armedTaskId() === task.id
					? "Click a time slot to place this task (click again to cancel)"
					: "Place on the time grid",
				() => {
					ctx.armTask(ctx.armedTaskId() === task.id ? null : task.id);
					ctx.refreshTasks();
					ctx.refreshGrid();
				},
				ctx.armedTaskId() === task.id ? "tb-armed" : ""
			);
		}
		iconButton(
			meta,
			"trash-2",
			"Delete task (past days keep their record)",
			() => {
				const idx = ctx.day.tasks.indexOf(task);
				if (idx >= 0) ctx.day.tasks.splice(idx, 1);
				if (ctx.armedTaskId() === task.id) ctx.armTask(null);
				normalizeDay(ctx.day);
				ctx.changed();
				ctx.refreshTasks();
				ctx.refreshGrid();
			},
			"tb-delete"
		);
	}
}
