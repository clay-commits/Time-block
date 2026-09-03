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
import { findFencedBlock, sameInner } from "./data/block";
import { BlockWriter } from "./write/BlockWriter";
import {
	DEFAULT_SETTINGS,
	TimeblockSettingTab,
	TimeblockSettings,
	mergeSettings,
} from "./settings";
import {
	VaultTaskScanner,
	completeInSource,
	openVaultTask,
} from "./vault/vaultTasks";
import { buildReviewReport } from "./vault/report";
import { ReportModal } from "./ui/ReportModal";
import type { VaultTaskServices } from "./ui/VaultTasksSection";
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

const FOREIGN_BLOCK_MSG =
	"Timeblock Daily manages only the first timeblock block in a note. This block is a duplicate (or its content no longer matches the managed block), so it is shown read-only to protect your data. Remove the extra block, or move its content into the first one.";

export default class TimeblockPlugin extends Plugin {
	settings: TimeblockSettings = { ...DEFAULT_SETTINGS };
	private daySessions = new Map<string, DaySession>();
	private listsSessions = new Map<string, ListsSession>();
	private configuredListsPromise: Promise<ListsSession | null> | null = null;
	private configuredListsPath: string | null = null;
	private ribbonIconEl: HTMLElement | null = null;
	private scanner: VaultTaskScanner = null as unknown as VaultTaskScanner;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.scanner = new VaultTaskScanner(this.app);

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
		this.addCommand({
			id: "build-review-report",
			name: "Build review report…",
			callback: () => this.openReportModal(),
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
			this.app.vault.on("modify", (file) => this.scanner.invalidate(file.path))
		);
		// The metadata cache updates after the file does; a scan in between
		// would pin stale list items under the new mtime.
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => this.scanner.invalidate(file.path))
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.scanner.invalidate(oldPath);
				this.scanner.invalidate(file.path);
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
				this.scanner.invalidate(file.path);
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
		this.settings = mergeSettings(await this.loadData());
	}

	/** Services the planner's "From your vault" panel needs. */
	vaultTaskServices(): VaultTaskServices {
		return {
			scan: () => this.scanner.scan(this.settings),
			complete: (source) => completeInSource(this.app, source),
			open: (task) => openVaultTask(this.app, task),
			saveSettings: () => this.saveSettings(),
			notice: (message) => {
				new Notice(message);
			},
		};
	}

	openReportModal(): void {
		const end = moment().format("YYYY-MM-DD");
		const start = moment().subtract(6, "days").format("YYYY-MM-DD");
		new ReportModal(this.app, { start, end }, async (from, to) => {
			try {
				await this.flushAll();
				const file = await buildReviewReport(this.app, this.settings, from, to);
				await this.app.workspace.getLeaf(false).openFile(file);
			} catch (e) {
				console.error("Timeblock Daily: report failed", e);
				new Notice("Couldn't build the report — see the console.");
			}
		}).open();
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
			// Rollover reads previous notes from disk — land pending edits first.
			await this.flushAll();
			const file = await ensureTodayPlanner(this.app, this.settings);
			await this.app.workspace.getLeaf(false).openFile(file);
		} catch (e) {
			console.error("Timeblock Daily: could not open today's planner", e);
			new Notice("Could not open today's planner.");
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
	): void | Promise<void> {
		const path = ctx.sourcePath;
		const session = this.daySessions.get(path);

		// Echo of our own write (or an unchanged re-render): reuse the live
		// model — this is the hot path while typing, kept synchronous.
		const last = session?.writer.getLastWritten();
		if (session && last != null && sameInner(source, last)) {
			this.mountDay(container, ctx, session);
			return;
		}
		return this.hydrateAndMountDay(source, container, ctx);
	}

	/**
	 * First render of a note, or its block changed outside this plugin: read
	 * the file and bind to the FIRST timeblock block's exact bytes. A rendered
	 * block whose content does not match that block (a pasted duplicate, a
	 * non-standard fence the finder cannot address) gets a read-only card so
	 * a live-looking planner can never silently discard edits.
	 */
	private async hydrateAndMountDay(
		source: string,
		container: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): Promise<void> {
		const path = ctx.sourcePath;
		let diskInner: string | null = null;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			try {
				const content = await this.app.vault.cachedRead(file);
				const found = findFencedBlock(content, "timeblock");
				if (found) diskInner = found.inner;
			} catch (e) {
				console.error("Timeblock Daily: could not read note", e);
			}
		}
		if (diskInner == null || !sameInner(source, diskInner)) {
			renderErrorCard(container, "This planner block is read-only", FOREIGN_BLOCK_MSG);
			return;
		}

		const fallbackDate =
			dateForDailyPath(this.app, this.settings, path) ??
			moment().format("YYYY-MM-DD");
		let day: DayData;
		try {
			day = parseDay(diskInner, fallbackDate);
		} catch (e) {
			renderErrorCard(
				container,
				"Timeblock Daily can't read this block",
				e instanceof TimeblockParseError ? e.message : String(e)
			);
			return;
		}

		let session = this.daySessions.get(path);
		if (!session) {
			session = this.createDaySession(path, day, diskInner);
			this.daySessions.set(path, session);
		} else {
			session.writer.dropPending();
			session.writer.primeLastWritten(diskInner);
			session.day = day;
			session.armedTaskId = null;
		}
		this.mountDay(container, ctx, session);
	}

	private mountDay(
		container: HTMLElement,
		ctx: MarkdownPostProcessorContext,
		session: DaySession
	): void {
		const child = new PlannerView(container, {
			app: this.app,
			settings: this.settings,
			session,
			getLists: () => this.getConfiguredListsSession(),
			vaultTasks: this.vaultTaskServices(),
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
	): void | Promise<void> {
		const path = ctx.sourcePath;
		const session = this.listsSessions.get(path);
		const last = session?.writer.getLastWritten();
		if (session && last != null && sameInner(source, last)) {
			ctx.addChild(new ListsFileView(container, session));
			return;
		}
		return this.hydrateAndMountLists(source, container, ctx);
	}

	private async hydrateAndMountLists(
		source: string,
		container: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): Promise<void> {
		const path = ctx.sourcePath;
		let diskInner: string | null = null;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			try {
				const content = await this.app.vault.cachedRead(file);
				const found = findFencedBlock(content, "timeblock-lists");
				if (found) diskInner = found.inner;
			} catch (e) {
				console.error("Timeblock Daily: could not read lists note", e);
			}
		}
		if (diskInner == null || !sameInner(source, diskInner)) {
			renderErrorCard(container, "This lists block is read-only", FOREIGN_BLOCK_MSG);
			return;
		}

		let data: ListsData | null;
		try {
			data = parseLists(diskInner);
		} catch (e) {
			renderErrorCard(
				container,
				"Timeblock Daily can't read this lists block",
				e instanceof TimeblockParseError ? e.message : String(e)
			);
			return;
		}

		let session = this.listsSessions.get(path);
		if (!session) {
			session = this.createListsSession(path, data, diskInner);
			this.listsSessions.set(path, session);
		} else {
			session.writer.dropPending();
			session.writer.primeLastWritten(diskInner);
			session.data = data;
		}
		ctx.addChild(new ListsFileView(container, session));
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
		const promise = (async (): Promise<ListsSession | null> => {
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
		this.configuredListsPromise = promise;
		// Never cache a failure — the next render should retry.
		void promise.then((result) => {
			if (result === null && this.configuredListsPromise === promise) {
				this.configuredListsPromise = null;
				this.configuredListsPath = null;
			}
		});
		return promise;
	}
}
