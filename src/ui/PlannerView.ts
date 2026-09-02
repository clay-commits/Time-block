import { App, MarkdownRenderChild, moment } from "obsidian";
import { DayData, ListsData, TaskSource } from "../data/types";
import { localIsoTimestamp } from "../data/ids";
import { serializeDay, serializeLists } from "../data/serializer";
import { BlockWriter } from "../write/BlockWriter";
import type { TimeblockSettings } from "../settings";
import { FocusManager } from "./FocusManager";
import { el, section, textarea } from "./components";
import { GoalsSection } from "./GoalsSection";
import { Big6Section } from "./Big6Section";
import { TasksSection } from "./TasksSection";
import { ListsSection } from "./ListsSection";
import { TimeGrid } from "./TimeGrid";
import { VaultTaskServices, VaultTasksSection } from "./VaultTasksSection";

// Sessions live on the plugin, keyed by file path, so the in-memory model,
// pending writes, armed state, and focus snapshot all survive the widget
// rebuilds Obsidian performs whenever the note changes on disk.

export interface DaySession {
	path: string;
	day: DayData;
	writer: BlockWriter;
	focus: FocusManager;
	armedTaskId: string | null;
	/** Open views; called to rebuild after an external change re-hydrates. */
	listeners: Set<() => void>;
}

export interface ListsSession {
	path: string;
	/** null = the block on disk is unparseable; it is never overwritten. */
	data: ListsData | null;
	writer: BlockWriter;
	focus: FocusManager;
	listeners: Set<() => void>;
}

/** What each section needs from the planner. */
export interface PlannerCtx {
	day: DayData;
	settings: TimeblockSettings;
	now(): string;
	changed(): void;
	armedTaskId(): string | null;
	armTask(id: string | null): void;
	refreshTasks(): void;
	refreshGrid(): void;
	/** Mark an adopted vault task done in its original note (fire-and-forget). */
	completeSource(task: { source?: TaskSource }): void;
}

export interface PlannerDeps {
	app: App;
	settings: TimeblockSettings;
	session: DaySession;
	getLists: () => Promise<ListsSession | null>;
	vaultTasks: VaultTaskServices;
}

export function renderErrorCard(
	container: HTMLElement,
	title: string,
	message: string
): void {
	const card = el(container, "div", "tb-error-card");
	el(card, "div", "tb-error-title", title);
	el(card, "div", "tb-error-msg", message);
	el(
		card,
		"div",
		"tb-error-hint",
		"Your data was left untouched. Fix the block in source mode (or restore from sync/backup) and it will render again."
	);
}

const NARROW_PX = 640;

export class PlannerView extends MarkdownRenderChild {
	private root: HTMLElement | null = null;
	private unloaded = false;
	private resizeObserver: ResizeObserver | null = null;
	private tasksSection: TasksSection | null = null;
	private timeGrid: TimeGrid | null = null;
	private readonly rebuildListener = () => this.rebuild();

	constructor(containerEl: HTMLElement, private readonly deps: PlannerDeps) {
		super(containerEl);
	}

	private makeCtx(): PlannerCtx {
		const { session, settings } = this.deps;
		return {
			day: session.day,
			settings,
			now: () => localIsoTimestamp(),
			changed: () => session.writer.queue(serializeDay(session.day)),
			armedTaskId: () => session.armedTaskId,
			armTask: (id) => {
				session.armedTaskId = id;
			},
			refreshTasks: () => this.withFocusPreserved(() => this.tasksSection?.render()),
			refreshGrid: () => this.withFocusPreserved(() => this.timeGrid?.render()),
			completeSource: (task) => {
				if (!task.source) return;
				void this.deps.vaultTasks.complete(task.source).then(
					(result) => {
						if (result === "missing") {
							this.deps.vaultTasks.notice(
								"Done here, but its original line wasn't found in the note anymore."
							);
						}
					},
					(e) => {
						console.error("Timeblock Daily: could not complete task in its note", e);
						this.deps.vaultTasks.notice(
							"Done here, but the original note couldn't be updated — see the console."
						);
					}
				);
			},
		};
	}

	private withFocusPreserved(fn: () => void): void {
		if (!this.root) return;
		this.deps.session.focus.captureFrom(this.root);
		fn();
		this.deps.session.focus.restoreTo(this.root);
	}

	onload(): void {
		this.build();
		this.deps.session.listeners.add(this.rebuildListener);
	}

	onunload(): void {
		this.unloaded = true;
		this.deps.session.listeners.delete(this.rebuildListener);
		if (this.root) this.deps.session.focus.captureFrom(this.root);
		this.root = null;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		void this.deps.session.writer.flush();
	}

	private rebuild(): void {
		if (!this.root) return;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.containerEl.removeChild(this.root);
		this.root = null;
		this.build();
	}

	private build(): void {
		const { session, settings } = this.deps;
		const day = session.day;
		const ctx = this.makeCtx();
		const root = el(this.containerEl, "div", "tb-root");
		this.root = root;

		// Header: the date, written out.
		const header = el(root, "div", "tb-header");
		const m = moment(day.date, "YYYY-MM-DD", true);
		el(
			header,
			"span",
			"tb-header-date",
			m.isValid() ? m.format("dddd, MMMM D, YYYY") : day.date
		);
		el(header, "span", "tb-header-brand", "Timeblock Daily");

		const cols = el(root, "div", "tb-cols");
		const left = el(cols, "div", "tb-col tb-col-left");
		const right = el(cols, "div", "tb-col tb-col-right");

		const goalsC = el(left, "div", "tb-slot-goals");
		const big6C = el(left, "div", "tb-slot-big6");
		const tasksC = el(left, "div", "tb-slot-tasks");
		const vaultC = el(left, "div", "tb-slot-vault");
		const listsC = el(left, "div", "tb-slot-lists");
		const notesC = el(left, "div", "tb-slot-notes");
		const gridC = el(right, "div", "tb-slot-grid");

		new GoalsSection(goalsC, ctx).render();
		new Big6Section(big6C, ctx).render();
		this.tasksSection = new TasksSection(tasksC, ctx);
		this.tasksSection.render();
		if (settings.showVaultTasks) {
			new VaultTasksSection(vaultC, {
				...ctx,
				services: this.deps.vaultTasks,
				today: () => moment().format("YYYY-MM-DD"),
			}).render();
		}
		this.mountLists(listsC);
		this.mountNotes(notesC, ctx);
		this.timeGrid = new TimeGrid(gridC, ctx);
		this.timeGrid.render();

		// Two columns collapse to one when the pane gets narrow.
		this.resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				root.classList.toggle("tb-narrow", entry.contentRect.width < NARROW_PX);
			}
		});
		this.resizeObserver.observe(root);
		root.classList.toggle("tb-narrow", root.clientWidth > 0 && root.clientWidth < NARROW_PX);

		// Keep the focus snapshot current so a rebuild can restore the caret.
		const capture = () => session.focus.captureFrom(root);
		this.registerDomEvent(root, "focusin", capture);
		this.registerDomEvent(root, "input", capture);
		this.registerDomEvent(root, "click", capture);

		// Use this pane's own window (pop-out support): flush when it blurs,
		// and restore focus on its next frame.
		const win = root.ownerDocument.defaultView ?? window;
		this.registerDomEvent(win, "blur", () => {
			void session.writer.flush();
		});
		win.requestAnimationFrame(() => {
			if (this.root === root) session.focus.restoreTo(root);
		});
	}

	private mountNotes(container: HTMLElement, ctx: PlannerCtx): void {
		const { body } = section(container, "Notes", "tb-notes");
		textarea(body, {
			value: ctx.day.notes,
			placeholder: "Anything else about today…",
			tbId: "notes",
			onInput: (value) => {
				ctx.day.notes = value;
				ctx.changed();
			},
		});
	}

	private mountLists(container: HTMLElement): void {
		const placeholder = el(container, "div", "tb-lists-loading", "");
		void this.deps.getLists().then((listsSession) => {
			if (this.unloaded || !this.root || !this.root.contains(container)) return;
			placeholder.remove();
			if (!listsSession) {
				renderErrorCard(
					container,
					"Lists unavailable",
					"The lists file could not be created or read."
				);
				return;
			}
			const host = el(container, "div");
			// Rebuilt from scratch on every session notification so the UI is
			// always bound to the CURRENT session.data object — after an
			// external change replaces it, a stale binding would silently
			// drop edits (they'd mutate a dead object).
			const mount = () => {
				while (host.firstChild) host.removeChild(host.firstChild);
				const data = listsSession.data;
				if (data === null) {
					renderErrorCard(
						host,
						"Lists need attention",
						`The lists block in "${listsSession.path}" has invalid YAML. It will not be overwritten.`
					);
					return;
				}
				const listsSection = new ListsSection(host, {
					data,
					showCompleted: false,
					now: () => localIsoTimestamp(),
					changed: () => listsSession.writer.queue(serializeLists(data)),
					refresh: () => {
						this.withFocusPreserved(() => listsSection.render());
						for (const listener of listsSession.listeners) {
							if (listener !== refreshListener) listener();
						}
					},
				});
				listsSection.render();
			};
			const refreshListener = () => this.withFocusPreserved(mount);
			listsSession.listeners.add(refreshListener);
			this.register(() => listsSession.listeners.delete(refreshListener));
			mount();
		});
	}
}

/** The lists file's own view: same lists UI, completed items shown. */
export class ListsFileView extends MarkdownRenderChild {
	private root: HTMLElement | null = null;
	private listsSection: ListsSection | null = null;
	private readonly rebuildListener = () => this.rebuild();

	constructor(
		containerEl: HTMLElement,
		private readonly session: ListsSession
	) {
		super(containerEl);
	}

	onload(): void {
		this.build();
		this.session.listeners.add(this.rebuildListener);
	}

	onunload(): void {
		this.session.listeners.delete(this.rebuildListener);
		if (this.root) this.session.focus.captureFrom(this.root);
		void this.session.writer.flush();
	}

	private rebuild(): void {
		if (this.root) {
			this.session.focus.captureFrom(this.root);
			this.containerEl.removeChild(this.root);
			this.root = null;
		}
		this.build();
		if (this.root) this.session.focus.restoreTo(this.root);
	}

	private build(): void {
		const session = this.session;
		const root = el(this.containerEl, "div", "tb-root tb-lists-file");
		this.root = root;
		if (session.data === null) {
			renderErrorCard(
				root,
				"Lists need attention",
				"This timeblock-lists block has invalid YAML. It will not be overwritten."
			);
			return;
		}
		const data = session.data;
		const host = el(root, "div");
		this.listsSection = new ListsSection(host, {
			data,
			showCompleted: true,
			now: () => localIsoTimestamp(),
			changed: () => session.writer.queue(serializeLists(data)),
			refresh: () => {
				if (!this.root || !this.listsSection) return;
				session.focus.captureFrom(this.root);
				this.listsSection.render();
				session.focus.restoreTo(this.root);
				for (const listener of session.listeners) {
					if (listener !== this.rebuildListener) listener();
				}
			},
		});
		this.listsSection.render();
		const capture = () => session.focus.captureFrom(root);
		this.registerDomEvent(root, "focusin", capture);
		this.registerDomEvent(root, "input", capture);
	}
}
