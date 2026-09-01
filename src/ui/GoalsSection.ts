import { Goal } from "../data/types";
import { makeId } from "../data/ids";
import { el, section, textInput } from "./components";
import type { PlannerCtx } from "./PlannerView";

/**
 * Top 3 life goals. Seeded blank every day — rewriting them is the ritual —
 * with yesterday's texts as faint placeholders until typed over.
 */
export class GoalsSection {
	constructor(
		private readonly container: HTMLElement,
		private readonly ctx: PlannerCtx
	) {}

	render(): void {
		while (this.container.firstChild) this.container.removeChild(this.container.firstChild);
		const { body } = section(this.container, "Top 3 life goals", "tb-goals");
		for (let i = 0; i < 3; i++) this.row(body, i);
	}

	private row(body: HTMLElement, index: number): void {
		const { day, ctx } = { day: this.ctx.day, ctx: this.ctx };
		let goal: Goal | null = day.goals[index] ?? null;
		const row = el(body, "div", "tb-row tb-goal-row");
		el(row, "span", "tb-row-index", String(index + 1));
		textInput(row, {
			value: goal?.text ?? "",
			placeholder: day.goalsGhost[index] ?? "",
			tbId: `goal-${index}`,
			cls: "tb-goal-input",
			ariaLabel: `Life goal ${index + 1}`,
			onInput: (value) => {
				if (!goal) {
					if (value.trim() === "") return;
					goal = { id: makeId("goal"), text: value, created: ctx.now() };
					day.goals.push(goal);
				} else {
					goal.text = value;
				}
				ctx.changed();
			},
		});
	}
}
