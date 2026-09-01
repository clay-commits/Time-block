import { Big6Item } from "../data/types";
import { makeId } from "../data/ids";
import { checkbox, el, section, textInput } from "./components";
import type { PlannerCtx } from "./PlannerView";

/** The Big 6: today's six things. Always starts empty, never auto-filled. */
export class Big6Section {
	constructor(
		private readonly container: HTMLElement,
		private readonly ctx: PlannerCtx
	) {}

	render(): void {
		while (this.container.firstChild) this.container.removeChild(this.container.firstChild);
		const { body } = section(this.container, "Big 6 — today", "tb-big6");
		for (let i = 0; i < 6; i++) this.row(body, i);
	}

	private row(body: HTMLElement, index: number): void {
		const day = this.ctx.day;
		const ctx = this.ctx;
		let item: Big6Item | null = day.big6[index] ?? null;
		const row = el(body, "div", "tb-row tb-big6-row");
		if (item?.completed) row.classList.add("tb-done");
		const hasText = () => !!item && item.text.trim() !== "";
		const check = checkbox(
			row,
			!!item?.completed,
			`Big 6 item ${index + 1} done`,
			(checked, input) => {
				if (!item || !hasText()) {
					input.checked = false;
					return;
				}
				item.completed = checked ? ctx.now() : null;
				row.classList.toggle("tb-done", checked);
				ctx.changed();
			}
		);
		check.disabled = !hasText();
		textInput(row, {
			value: item?.text ?? "",
			placeholder: "",
			tbId: `big6-${index}`,
			ariaLabel: `Big 6 item ${index + 1}`,
			onInput: (value) => {
				if (!item) {
					if (value.trim() === "") return;
					item = {
						id: makeId("big6"),
						text: value,
						created: ctx.now(),
						completed: null,
					};
					// Land at THIS row's index (padding skipped rows with
					// in-memory placeholders the serializer omits) so rows
					// keep their binding across widget rebuilds.
					while (day.big6.length < index) {
						day.big6.push({
							id: makeId("big6"),
							text: "",
							created: ctx.now(),
							completed: null,
						});
					}
					day.big6.splice(index, 1, item);
				} else {
					item.text = value;
				}
				check.disabled = value.trim() === "";
				ctx.changed();
			},
		});
	}
}
