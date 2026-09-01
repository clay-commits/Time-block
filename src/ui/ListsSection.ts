import { ListsData, UserList } from "../data/types";
import { makeId } from "../data/ids";
import { checkbox, el, iconButton, section, textInput } from "./components";

/**
 * "Lists to remember" — named lists that persist across days in a dedicated
 * vault file. The daily planner and the lists file itself render the same
 * interactive UI; the daily view hides checked items (they stay in the file,
 * completion-stamped, for trackability).
 */
export interface ListsCtx {
	data: ListsData;
	showCompleted: boolean;
	now(): string;
	changed(): void;
	refresh(): void;
}

export class ListsSection {
	constructor(
		private readonly container: HTMLElement,
		private readonly ctx: ListsCtx
	) {}

	render(): void {
		while (this.container.firstChild) this.container.removeChild(this.container.firstChild);
		const { body } = section(this.container, "Lists to remember", "tb-lists");
		for (const list of this.ctx.data.lists) this.renderList(body, list);

		const newRow = el(body, "div", "tb-row tb-list-new");
		textInput(newRow, {
			value: "",
			placeholder: "New list name, press Enter…",
			tbId: "list-new",
			ariaLabel: "Create a new list",
			onEnter: (value, input) => {
				const name = value.trim();
				if (name === "") return;
				this.ctx.data.lists.push({
					id: makeId("list"),
					name,
					created: this.ctx.now(),
					items: [],
				});
				input.value = "";
				this.ctx.changed();
				this.ctx.refresh();
			},
		});
	}

	private renderList(body: HTMLElement, list: UserList): void {
		const ctx = this.ctx;
		const card = el(body, "div", "tb-list-card");
		const head = el(card, "div", "tb-list-head");
		textInput(head, {
			value: list.name,
			tbId: `list-name-${list.id}`,
			cls: "tb-list-name",
			ariaLabel: "List name",
			onInput: (value) => {
				if (value.trim() === "") return;
				list.name = value;
				ctx.changed();
			},
		});
		iconButton(
			head,
			"trash-2",
			"Delete this list and its items",
			() => {
				const idx = ctx.data.lists.indexOf(list);
				if (idx >= 0) ctx.data.lists.splice(idx, 1);
				ctx.changed();
				ctx.refresh();
			},
			"tb-delete"
		);

		const items = el(card, "div", "tb-list-items");
		for (const item of list.items) {
			if (item.completed && !ctx.showCompleted) continue;
			const row = el(items, "div", "tb-row tb-list-item");
			if (item.completed) row.classList.add("tb-done");
			checkbox(row, !!item.completed, `Done: ${item.text}`, (checked) => {
				item.completed = checked ? ctx.now() : null;
				ctx.changed();
				ctx.refresh();
			});
			textInput(row, {
				value: item.text,
				tbId: `list-item-${item.id}`,
				ariaLabel: "List item",
				onInput: (value) => {
					item.text = value;
					ctx.changed();
				},
			});
		}

		const addRow = el(card, "div", "tb-row tb-list-add");
		textInput(addRow, {
			value: "",
			placeholder: "Add an item…",
			tbId: `list-add-${list.id}`,
			ariaLabel: `Add an item to ${list.name}`,
			onEnter: (value, input) => {
				const text = value.trim();
				if (text === "") return;
				list.items.push({
					id: makeId("item"),
					text,
					created: ctx.now(),
					completed: null,
				});
				input.value = "";
				ctx.changed();
				ctx.refresh();
			},
		});
	}
}
