import { Task, TaskFilter, VaultTask } from "../data/types";
import { makeId } from "../data/ids";
import {
	addDays,
	applyFilter,
	collectFolders,
	collectTags,
	daysBetween,
} from "../data/vaultTasks";
import { checkbox, el, iconButton, textInput } from "./components";
import type { PlannerCtx } from "./PlannerView";

export interface VaultTaskServices {
	scan(): Promise<VaultTask[]>;
	complete(source: { path: string; line: string }): Promise<"done" | "already" | "missing">;
	open(task: VaultTask): Promise<void>;
	saveSettings(): Promise<void>;
	notice(message: string): void;
}

export interface VaultTasksCtx extends PlannerCtx {
	services: VaultTaskServices;
	today(): string;
}

/**
 * "From your vault": every open "- [ ]" line in the vault, behind a filter bar
 * (search, tag, folder, due, sort). Ticking marks the line done in its own
 * note and records the completion in today's planner; the clock button adopts
 * the task into today's list so it can be placed on the grid.
 */
export class VaultTasksSection {
	private tasks: VaultTask[] | null = null;
	private listEl: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly container: HTMLElement,
		private readonly ctx: VaultTasksCtx
	) {}

	private get filter(): TaskFilter {
		return this.ctx.settings.vaultTaskFilter;
	}

	render(): void {
		while (this.container.firstChild) this.container.removeChild(this.container.firstChild);
		const root = el(this.container, "div", "tb-section tb-vault");
		const title = el(root, "div", "tb-section-title tb-row");
		el(title, "span", "", "From your vault");
		this.countEl = el(title, "span", "tb-vault-count", "");
		iconButton(title, "refresh-cw", "Rescan the vault", () => {
			this.tasks = null;
			this.load();
		});

		this.renderFilterBar(el(root, "div", "tb-filter-bar"));
		this.listEl = el(root, "div", "tb-vault-list");
		this.load();
	}

	private load(): void {
		if (this.tasks) {
			this.renderList();
			return;
		}
		if (this.listEl) {
			while (this.listEl.firstChild) this.listEl.removeChild(this.listEl.firstChild);
			el(this.listEl, "div", "tb-vault-status", "Scanning your vault…");
		}
		const listEl = this.listEl;
		void this.ctx.services.scan().then(
			(tasks) => {
				if (this.listEl !== listEl) return; // section was rebuilt meanwhile
				this.tasks = tasks;
				this.renderList();
				this.refreshPickers();
			},
			(e) => {
				console.error("Timeblock Daily: vault scan failed", e);
				if (this.listEl === listEl && listEl) {
					while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
					el(listEl, "div", "tb-vault-status", "Couldn't scan the vault — see the console.");
				}
			}
		);
	}

	// ---- filter bar --------------------------------------------------------

	private tagSelect: HTMLSelectElement | null = null;
	private folderSelect: HTMLSelectElement | null = null;

	private renderFilterBar(bar: HTMLElement): void {
		const filter = this.filter;
		textInput(bar, {
			value: filter.query,
			placeholder: "Search tasks…",
			tbId: "vault-query",
			ariaLabel: "Search vault tasks",
			onInput: (value) => {
				filter.query = value;
				this.persistFilter();
				this.renderList();
			},
		});
		this.tagSelect = this.select(bar, "Tag", [["", "All tags"]], filter.tag ?? "", (v) => {
			filter.tag = v === "" ? null : v;
		});
		this.folderSelect = this.select(bar, "Folder", [["", "All folders"]], filter.folder ?? "", (v) => {
			filter.folder = v === "" ? null : v;
		});
		this.select(
			bar,
			"Due",
			[
				["any", "Any due"],
				["overdue", "Overdue"],
				["today", "Due today"],
				["week", "Due this week"],
				["none", "No due date"],
			],
			filter.due,
			(v) => {
				filter.due = (v as TaskFilter["due"]) || "any";
			}
		);
		this.select(
			bar,
			"Sort",
			[
				["due", "Sort: due"],
				["age", "Sort: oldest"],
				["path", "Sort: note"],
			],
			filter.sort,
			(v) => {
				filter.sort = (v as TaskFilter["sort"]) || "due";
			}
		);
		this.refreshPickers();
	}

	private select(
		parent: HTMLElement,
		label: string,
		options: [string, string][],
		value: string,
		onChange: (value: string) => void
	): HTMLSelectElement {
		const sel = el(parent, "select", "dropdown");
		sel.setAttribute("aria-label", label);
		sel.setAttribute("data-tb-id", `vault-${label.toLowerCase()}`);
		for (const [v, text] of options) {
			const opt = el(sel, "option", "", text);
			opt.value = v;
		}
		sel.value = value;
		sel.addEventListener("change", () => {
			onChange(sel.value);
			this.persistFilter();
			this.renderList();
		});
		return sel;
	}

	/** Fill the tag/folder pickers from the scanned tasks, keeping the selection. */
	private refreshPickers(): void {
		const tasks = this.tasks ?? [];
		const fill = (sel: HTMLSelectElement | null, allLabel: string, values: string[], current: string | null) => {
			if (!sel) return;
			while (sel.firstChild) sel.removeChild(sel.firstChild);
			const all = el(sel, "option", "", allLabel);
			all.value = "";
			for (const v of values) {
				const opt = el(sel, "option", "", v);
				opt.value = v;
			}
			if (current && !values.includes(current)) {
				const opt = el(sel, "option", "", current);
				opt.value = current;
			}
			sel.value = current ?? "";
		};
		fill(this.tagSelect, "All tags", collectTags(tasks), this.filter.tag);
		fill(this.folderSelect, "All folders", collectFolders(tasks), this.filter.folder);
	}

	private persistFilter(): void {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.ctx.services.saveSettings();
		}, 500);
	}

	// ---- list --------------------------------------------------------------

	private adoptedKeys(): Set<string> {
		const keys = new Set<string>();
		for (const t of this.ctx.day.tasks) {
			if (t.source) keys.add(`${t.source.path}\n${t.source.line}`);
		}
		return keys;
	}

	private renderList(): void {
		const listEl = this.listEl;
		if (!listEl) return;
		while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
		const all = this.tasks ?? [];
		const adopted = this.adoptedKeys();
		const visible = applyFilter(all, this.filter, this.ctx.today()).filter(
			(t) => !adopted.has(`${t.path}\n${t.raw}`)
		);
		if (this.countEl) {
			this.countEl.textContent =
				all.length === 0 ? "" : `${visible.length} of ${all.length}`;
		}
		if (all.length === 0) {
			el(listEl, "div", "tb-vault-empty", 'No open "- [ ]" tasks found in your vault.');
			return;
		}
		if (visible.length === 0) {
			el(listEl, "div", "tb-vault-empty", "Nothing matches this filter.");
			return;
		}
		for (const task of visible) this.row(listEl, task);
	}

	private row(listEl: HTMLElement, task: VaultTask): void {
		const ctx = this.ctx;
		const row = el(listEl, "div", "tb-row tb-vault-row");
		row.setAttribute("data-tb-id", `vault-${task.path}#${task.lineNumber}`);

		checkbox(row, false, `Done: ${task.text}`, (checked, input) => {
			if (!checked) return;
			input.disabled = true;
			void ctx.services.complete({ path: task.path, line: task.raw }).then((result) => {
				if (result === "missing") {
					input.checked = false;
					input.disabled = false;
					ctx.services.notice(
						"Couldn't find that line in its note anymore — open the note to check."
					);
					return;
				}
				// Record the completion in today's planner so it is trackable.
				const adopted = this.adopt(task);
				adopted.completed = ctx.now();
				this.tasks = (this.tasks ?? []).filter((t) => t !== task);
				ctx.changed();
				ctx.refreshTasks();
				this.renderList();
			});
		});

		const main = el(row, "div", "tb-vault-main");
		const text = el(main, "span", "tb-vault-text", task.text || "(empty task)");
		text.title = "Open the note";
		text.addEventListener("click", () => {
			void ctx.services.open(task);
		});
		const meta = el(main, "div", "tb-vault-meta");
		el(meta, "span", "tb-vault-path", task.path.replace(/\.md$/, ""));
		if (task.due) {
			const today = ctx.today();
			const cls =
				task.due < today ? "tb-due-overdue" : task.due === today ? "tb-due-today" : "";
			const label =
				task.due < today
					? `overdue ${task.due}`
					: task.due === today
						? "due today"
						: task.due <= addDays(today, 6)
							? `due ${task.due}`
							: `due ${task.due}`;
			el(meta, "span", `tb-vault-due ${cls}`.trim(), label);
		}
		if (task.createdDate) {
			const age = daysBetween(task.createdDate, ctx.today());
			if (age > 0) el(meta, "span", "tb-vault-age", `${age}d old`);
		}

		const actions = el(row, "span", "tb-row-meta");
		iconButton(actions, "clock", "Bring into today and place on the time grid", () => {
			const adopted = this.adopt(task);
			ctx.changed();
			ctx.armTask(adopted.id);
			ctx.refreshTasks();
			ctx.refreshGrid();
			this.renderList();
		});
	}

	/** Copy a vault task into today's task list (once), remembering its source. */
	private adopt(task: VaultTask): Task {
		const key = `${task.path}\n${task.raw}`;
		const existing = this.ctx.day.tasks.find(
			(t) => t.source && `${t.source.path}\n${t.source.line}` === key
		);
		if (existing) return existing;
		const adopted: Task = {
			id: makeId("task"),
			text: task.text || "(empty task)",
			created: this.ctx.now(),
			completed: null,
			source: { path: task.path, line: task.raw },
		};
		this.ctx.day.tasks.push(adopted);
		return adopted;
	}
}
