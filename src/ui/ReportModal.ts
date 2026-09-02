import { App, Modal, Setting } from "obsidian";
import { dateRange } from "../data/report";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Asks for a start and end date (pre-filled with the last 7 days). */
export class ReportModal extends Modal {
	private start: string;
	private end: string;

	constructor(
		app: App,
		defaults: { start: string; end: string },
		private readonly onSubmit: (start: string, end: string) => Promise<void>
	) {
		super(app);
		this.start = defaults.start;
		this.end = defaults.end;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("tb-report-modal");
		contentEl.createEl("h2", { text: "Build review report" });
		contentEl.createEl("div", {
			cls: "tb-report-hint",
			text: "Pick the days to review. The report is written to your reports folder and opened.",
		});

		new Setting(contentEl).setName("From").addText((text) => {
			text.inputEl.type = "date";
			text.setValue(this.start).onChange((v) => {
				this.start = v;
			});
		});
		new Setting(contentEl).setName("To").addText((text) => {
			text.inputEl.type = "date";
			text.setValue(this.end).onChange((v) => {
				this.end = v;
			});
		});

		const error = contentEl.createEl("div", { cls: "tb-report-error" });

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Build")
				.setCta()
				.onClick(() => {
					const start = this.start.trim();
					const end = this.end.trim();
					if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
						error.setText("Both dates are needed, as YYYY-MM-DD.");
						return;
					}
					if (dateRange(start, end).length === 0) {
						error.setText("The end date must be on or after the start date (and within a year).");
						return;
					}
					btn.setDisabled(true);
					this.close();
					void this.onSubmit(start, end);
				})
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
