import { App, PluginSettingTab, Setting } from "obsidian";
import type TimeblockPlugin from "./main";
import { parseHM } from "./data/slots";
import { DEFAULT_TASK_FILTER, TaskFilter } from "./data/types";

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
	/** Vault task inbox: show the "from your vault" list on the daily page. */
	showVaultTasks: boolean;
	/** Only scan these folders/notes (empty = whole vault). */
	vaultTaskIncludeFolders: string[];
	/** Never scan these folders/notes. */
	vaultTaskExcludeFolders: string[];
	/** Last filter-bar state, remembered between sessions (plugin state, not user data). */
	vaultTaskFilter: TaskFilter;
	/** Where review reports are written. */
	reportsFolder: string;
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
	showVaultTasks: true,
	vaultTaskIncludeFolders: [],
	vaultTaskExcludeFolders: ["Timeblock", "Templates"],
	vaultTaskFilter: { ...DEFAULT_TASK_FILTER },
	reportsFolder: "Timeblock/Reviews",
};

function asStringList(v: unknown): string[] | null {
	if (!Array.isArray(v)) return null;
	return v.filter((s): s is string => typeof s === "string");
}

/** Merge stored settings (possibly from an older version) over the defaults. */
export function mergeSettings(stored: unknown): TimeblockSettings {
	const s = (stored && typeof stored === "object" ? stored : {}) as Partial<
		Record<keyof TimeblockSettings, unknown>
	>;
	const merged: TimeblockSettings = { ...DEFAULT_SETTINGS };
	const str = (k: keyof TimeblockSettings, v: unknown) => {
		if (typeof v === "string") (merged as unknown as Record<string, unknown>)[k] = v;
	};
	const bool = (k: keyof TimeblockSettings, v: unknown) => {
		if (typeof v === "boolean") (merged as unknown as Record<string, unknown>)[k] = v;
	};
	str("dayStart", s.dayStart);
	str("dayEnd", s.dayEnd);
	if (s.slotMinutes === 15 || s.slotMinutes === 30) merged.slotMinutes = s.slotMinutes;
	str("listsFilePath", s.listsFilePath);
	if (typeof s.rolloverLookbackDays === "number" && s.rolloverLookbackDays >= 1)
		merged.rolloverLookbackDays = Math.floor(s.rolloverLookbackDays);
	bool("autoOpenOnStartup", s.autoOpenOnStartup);
	bool("showRibbonIcon", s.showRibbonIcon);
	str("dailyFolderOverride", s.dailyFolderOverride);
	str("dailyFormatOverride", s.dailyFormatOverride);
	bool("showVaultTasks", s.showVaultTasks);
	const inc = asStringList(s.vaultTaskIncludeFolders);
	if (inc) merged.vaultTaskIncludeFolders = inc;
	const exc = asStringList(s.vaultTaskExcludeFolders);
	if (exc) merged.vaultTaskExcludeFolders = exc;
	str("reportsFolder", s.reportsFolder);
	if (s.vaultTaskFilter && typeof s.vaultTaskFilter === "object") {
		const f = s.vaultTaskFilter as Partial<Record<keyof TaskFilter, unknown>>;
		const filter: TaskFilter = { ...DEFAULT_TASK_FILTER };
		if (typeof f.query === "string") filter.query = f.query;
		if (typeof f.tag === "string" || f.tag === null) filter.tag = f.tag ?? null;
		if (typeof f.folder === "string" || f.folder === null) filter.folder = f.folder ?? null;
		if (
			f.due === "any" ||
			f.due === "overdue" ||
			f.due === "today" ||
			f.due === "week" ||
			f.due === "none"
		)
			filter.due = f.due;
		if (f.sort === "due" || f.sort === "age" || f.sort === "path") filter.sort = f.sort;
		merged.vaultTaskFilter = filter;
	}
	return merged;
}

function linesToList(value: string): string[] {
	return value
		.split(/\r?\n|,/)
		.map((s) => s.trim())
		.filter((s) => s !== "");
}

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

		new Setting(containerEl).setName("Vault task inbox").setHeading();

		new Setting(containerEl)
			.setName("Show tasks from your vault")
			.setDesc(
				'Lists every unchecked "- [ ]" line found in your notes under the task inbox, with a filter bar.'
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showVaultTasks)
					.onChange(async (value) => {
						this.plugin.settings.showVaultTasks = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Only scan these folders or notes")
			.setDesc("One per line. Leave empty to scan the whole vault.")
			.addTextArea((area) =>
				area
					.setPlaceholder("Projects\nInbox.md")
					.setValue(this.plugin.settings.vaultTaskIncludeFolders.join("\n"))
					.onChange(async (value) => {
						this.plugin.settings.vaultTaskIncludeFolders = linesToList(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Never scan these folders or notes")
			.setDesc("One per line. Keeps templates and Timeblock's own files out of the inbox.")
			.addTextArea((area) =>
				area
					.setPlaceholder("Timeblock\nTemplates")
					.setValue(this.plugin.settings.vaultTaskExcludeFolders.join("\n"))
					.onChange(async (value) => {
						this.plugin.settings.vaultTaskExcludeFolders = linesToList(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Review reports").setHeading();

		new Setting(containerEl)
			.setName("Reports folder")
			.setDesc('Where "Build review report" writes its notes.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.reportsFolder)
					.setValue(this.plugin.settings.reportsFolder)
					.onChange(async (value) => {
						const v = value.trim().replace(/^\/+|\/+$/g, "");
						this.plugin.settings.reportsFolder = v || DEFAULT_SETTINGS.reportsFolder;
						await this.plugin.saveSettings();
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
