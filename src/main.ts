import {
	MarkdownPostProcessorContext,
	Notice,
	Plugin,
	TFile,
	moment,
	normalizePath,
} from "obsidian";
import { DayData, ListsData } from "./data/types";
import { parseDay, parseLists, TimeblockParseError } from "./data/serializer";
import { findFencedBlock } from "./data/block";
import { BlockWriter } from "./write/BlockWriter";
import {
	DEFAULT_SETTINGS,
	TimeblockSettingTab,
	TimeblockSettings,
} from "./settings";
import {
	dateForDailyPath,
	ensureListsFile,
	ensureTodayPlanner,
} from "./vault/dailyNotes";
import { FocusManager } from "./ui/FocusManager";
import {
	DaySession,
	ListsFileView,
	ListsSession,
	PlannerView,
	renderErrorCard,
} from "./ui/PlannerView";

function normEol(source: string): string {
	if (source === "") return "";
	return source.endsWith("\n") ? source : source + "\n";
}

export default class TimeblockPlugin extends Plugin {
	settings: TimeblockSettings = { ...DEFAULT_SETTINGS };
	private daySessions = new Map<string, DaySession>();
	private listsSessions = new Map<string, ListsSession>();
	private configuredListsPromise: Promise<ListsSession | null> | null = null;
	private configuredListsPath: string | null = null;
	private ribbonIconEl: HTMLElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerMarkdownCodeBlockProcessor("timeblock", (source, el, ctx) =>
			this.renderDayBlock(source, el, ctx)
		);
		this.registerMarkdownCodeBlockProcessor(
			"timeblock-lists",
			(source, el, ctx) => this.renderListsBlock(source, el, ctx)
		);

		this.addCommand({
			id: "open-today",
			name: "Open today's planner",
			callback: () => {
				void this.openToday();
			},
		});
		this.refreshRibbon();
		this.addSettingTab(new TimeblockSettingTab(this.app, this));

		// Never write on keystroke; do write the moment attention moves away.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				void this.flushAll();
			})
		);
		this.registerDomEvent(window, "blur", () => {
			void this.flushAll();
		});

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				const day = this.daySessions.get(oldPath);
				if (day) {
					this.daySessions.delete(oldPath);
					day.path = file.path;
					this.daySessions.set(file.path, day);
				}
				const lists = this.listsSessions.get(oldPath);
				if (lists) {
					this.listsSessions.delete(oldPath);
					lists.path = file.path;
					this.listsSessions.set(file.path, lists);
				}
				if (this.configuredListsPath === oldPath)
					this.configuredListsPath = file.path;
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.daySessions.delete(file.path);
				this.listsSessions.delete(file.path);
				if (this.configuredListsPath === file.path) {
					this.configuredListsPath = null;
					this.configuredListsPromise = null;
				}
			})
		);

		if (this.settings.autoOpenOnStartup) {
			this.app.workspace.onLayoutReady(() => {
				void this.openToday();
			});
		}
	}

	onunload(): void {
		void this.flushAll();
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<TimeblockSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		const path = this.normalizedListsPath();
		if (this.configuredListsPath !== null && this.configuredListsPath !== path) {
			this.configuredListsPromise = null;
			this.configuredListsPath = null;
		}
	}

	refreshRibbon(): void {
		this.ribbonIconEl?.remove();
		this.ribbonIconEl = null;
		if (this.settings.showRibbonIcon) {
			this.ribbonIconEl = this.addRibbonIcon(
				"calendar-clock",
				"Open today's planner",
				() => {
					void this.openToday();
				}
			);
		}
	}

	async openToday(): Promise<void> {
		try {
			const file = await ensureTodayPlanner(this.app, this.settings);
			await this.app.workspace.getLeaf(false).openFile(file);
		} catch (e) {
			console.error("Timeblock Daily: could not open today's planner", e);
			new Notice("Timeblock Daily: could not open today's planner.");
		}
	}

	async flushAll(): Promise<void> {
		const writers = [
			...[...this.daySessions.values()].map((s) => s.writer),
			...[...this.listsSessions.values()].map((s) => s.writer),
		];
		await Promise.all(
			writers.map((w) =>
				w.flush().catch((e) => console.error("Timeblock Daily: flush failed", e))
			)
		);
	}

	// -----------------------------------------------------------------------
	// timeblock (daily planner) blocks
	// -----------------------------------------------------------------------

	private renderDayBlock(
		source: string,
		container: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): void {
		const path = ctx.sourcePath;
		const norm = normEol(source);
		let session = this.daySessions.get(path);

		if (!session || session.writer.getLastWritten() !== norm) {
			// Not an echo of our own write: hydrate the model from the source.
			const fallbackDate =
				dateForDailyPath(this.app, this.settings, path) ??
				moment().format("YYYY-MM-DD");
			let day: DayData;
			try {
				day = parseDay(norm, fallbackDate);
			} catch (e) {
				renderErrorCard(
					container,
					"Timeblock Daily can't read this block",
					e instanceof TimeblockParseError ? e.message : String(e)
				);
				return;
			}
			if (!session) {
				session = this.createDaySession(path, day, norm);
				this.daySessions.set(path, session);
			} else {
				session.writer.dropPending();
				session.writer.primeLastWritten(norm);
				session.day = day;
				session.armedTaskId = null;
			}
		}

		const child = new PlannerView(container, {
			app: this.app,
			settings: this.settings,
			session,
			getLists: () => this.getConfiguredListsSession(),
		});
		ctx.addChild(child);
	}

	private createDaySession(
		path: string,
		day: DayData,
		inner: string
	): DaySession {
		const session: DaySession = {
			path,
			day,
			writer: null as unknown as BlockWriter,
			focus: new FocusManager(),
			armedTaskId: null,
			listeners: new Set(),
		};
		session.writer = new BlockWriter(
			this.app.vault,
			() => {
				const f = this.app.vault.getAbstractFileByPath(session.path);
				return f instanceof TFile ? f : null;
			},
			"timeblock",
			() => {
				void this.rehydrateDaySession(session);
			}
		);
		session.writer.primeLastWritten(inner);
		return session;
	}

	/** The block diverged on disk (user/sync edit): re-read and rebuild views. */
	private async rehydrateDaySession(session: DaySession): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(session.path);
		if (!(file instanceof TFile)) return;
		try {
			const content = await this.app.vault.read(file);
			const found = findFencedBlock(content, "timeblock");
			if (!found) return; // block deleted — views vanish on next render
			const fallbackDate =
				dateForDailyPath(this.app, this.settings, session.path) ??
				session.day.date;
			session.day = parseDay(found.inner, fallbackDate);
			session.writer.primeLastWritten(found.inner);
			session.armedTaskId = null;
			for (const listener of session.listeners) listener();
		} catch (e) {
			console.error("Timeblock Daily: could not re-read diverged block", e);
		}
	}

	// -----------------------------------------------------------------------
	// timeblock-lists blocks
	// -----------------------------------------------------------------------

	private renderListsBlock(
		source: string,
		container: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): void {
		const path = ctx.sourcePath;
		const norm = normEol(source);
		let session = this.listsSessions.get(path);

		if (!session || session.writer.getLastWritten() !== norm) {
			let data: ListsData | null;
			try {
				data = parseLists(norm);
			} catch (e) {
				renderErrorCard(
					container,
					"Timeblock Daily can't read this lists block",
					e instanceof TimeblockParseError ? e.message : String(e)
				);
				return;
			}
			if (!session) {
				session = this.createListsSession(path, data, norm);
				this.listsSessions.set(path, session);
			} else {
				session.writer.dropPending();
				session.writer.primeLastWritten(norm);
				session.data = data;
			}
		}

		const child = new ListsFileView(container, session);
		ctx.addChild(child);
	}

	private createListsSession(
		path: string,
		data: ListsData | null,
		inner: string
	): ListsSession {
		const session: ListsSession = {
			path,
			data,
			writer: null as unknown as BlockWriter,
			focus: new FocusManager(),
			listeners: new Set(),
		};
		session.writer = new BlockWriter(
			this.app.vault,
			() => {
				const f = this.app.vault.getAbstractFileByPath(session.path);
				return f instanceof TFile ? f : null;
			},
			"timeblock-lists",
			() => {
				void this.rehydrateListsSession(session);
			}
		);
		session.writer.primeLastWritten(inner);
		return session;
	}

	private async rehydrateListsSession(session: ListsSession): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(session.path);
		if (!(file instanceof TFile)) return;
		try {
			const content = await this.app.vault.read(file);
			const found = findFencedBlock(content, "timeblock-lists");
			if (!found) return;
			try {
				session.data = parseLists(found.inner);
			} catch {
				session.data = null;
			}
			session.writer.primeLastWritten(found.inner);
			for (const listener of session.listeners) listener();
		} catch (e) {
			console.error("Timeblock Daily: could not re-read diverged lists", e);
		}
	}

	private normalizedListsPath(): string {
		const raw = this.settings.listsFilePath.trim() || "Timeblock/Lists.md";
		return normalizePath(raw.endsWith(".md") ? raw : raw + ".md");
	}

	/** Lists session for the configured lists file, creating the file if needed. */
	private getConfiguredListsSession(): Promise<ListsSession | null> {
		const path = this.normalizedListsPath();
		if (this.configuredListsPromise && this.configuredListsPath === path) {
			return this.configuredListsPromise;
		}
		this.configuredListsPath = path;
		this.configuredListsPromise = (async () => {
			try {
				const { file, lists, inner } = await ensureListsFile(
					this.app,
					this.settings
				);
				const existing = this.listsSessions.get(file.path);
				if (existing) return existing;
				const session = this.createListsSession(file.path, lists, inner);
				this.listsSessions.set(file.path, session);
				return session;
			} catch (e) {
				console.error("Timeblock Daily: lists file unavailable", e);
				return null;
			}
		})();
		return this.configuredListsPromise;
	}
}
