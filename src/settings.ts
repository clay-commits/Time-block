import { App, PluginSettingTab, Setting } from "obsidian";
import type TimeblockPlugin from "./main";
import { parseHM } from "./data/slots";

export interface TimeblockSettings {
	dayStart: string;
	dayEnd: string;
	slotMinutes: number;
	listsFilePath: string;
	rolloverLookbackDays: number;
	autoOpenOnStartup: boolean;
	showRibbonIcon: boolean;
	dailyFolderOverride: string;
	dailyFormatOverride: string;
}

export const DEFAULT_SETTINGS: TimeblockSettings = {
	dayStart: "06:00",
	dayEnd: "22:00",
	slotMinutes: 15,
	listsFilePath: "Timeblock/Lists.md",
	rolloverLookbackDays: 7,
	autoOpenOnStartup: false,
	showRibbonIcon: true,
	dailyFolderOverride: "",
	dailyFormatOverride: "",
};

export class TimeblockSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: TimeblockPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Day starts at")
			.setDesc("First slot of the time grid, 24-hour HH:MM.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.dayStart)
					.setValue(this.plugin.settings.dayStart)
					.onChange(async (value) => {
						if (parseHM(value) == null) return;
						this.plugin.settings.dayStart = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Day ends at")
			.setDesc("End of the time grid, 24-hour HH:MM (up to 24:00).")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.dayEnd)
					.setValue(this.plugin.settings.dayEnd)
					.onChange(async (value) => {
						if (parseHM(value) == null) return;
						this.plugin.settings.dayEnd = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Slot length")
			.setDesc("Size of each time slot.")
			.addDropdown((drop) =>
				drop
					.addOption("15", "15 minutes")
					.addOption("30", "30 minutes")
					.setValue(String(this.plugin.settings.slotMinutes))
					.onChange(async (value) => {
						this.plugin.settings.slotMinutes = value === "30" ? 30 : 15;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Lists file")
			.setDesc(
				"Vault file that stores your persistent lists (created automatically)."
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.listsFilePath)
					.setValue(this.plugin.settings.listsFilePath)
					.onChange(async (value) => {
						const v = value.trim();
						if (v === "") return;
						this.plugin.settings.listsFilePath = v.endsWith(".md")
							? v
							: v + ".md";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Rollover lookback (days)")
			.setDesc(
				"How many days back to look for your last planner when carrying over unfinished tasks."
			)
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.rolloverLookbackDays))
					.setValue(String(this.plugin.settings.rolloverLookbackDays))
					.onChange(async (value) => {
						const n = Number(value);
						if (!Number.isFinite(n) || n < 1 || n > 365) return;
						this.plugin.settings.rolloverLookbackDays = Math.floor(n);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Open today's planner on startup")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoOpenOnStartup)
					.onChange(async (value) => {
						this.plugin.settings.autoOpenOnStartup = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show ribbon icon")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showRibbonIcon)
					.onChange(async (value) => {
						this.plugin.settings.showRibbonIcon = value;
						await this.plugin.saveSettings();
						this.plugin.refreshRibbon();
					})
			);

		new Setting(containerEl).setName("Daily note overrides").setHeading();

		new Setting(containerEl)
			.setName("Daily notes folder override")
			.setDesc("Leave blank to follow the core Daily notes plugin.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.dailyFolderOverride)
					.onChange(async (value) => {
						this.plugin.settings.dailyFolderOverride = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Daily note date format override")
			.setDesc(
				'Moment format, e.g. "YYYY-MM-DD". Leave blank to follow the core Daily notes plugin.'
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.dailyFormatOverride)
					.onChange(async (value) => {
						this.plugin.settings.dailyFormatOverride = value.trim();
						await this.plugin.saveSettings();
					})
			);
	}
}
