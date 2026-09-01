// Restores focus, caret position, and grid scroll across widget rebuilds.
// Obsidian re-renders the whole code block whenever the note changes on disk —
// including after our own debounced writes — so every editable element carries
// a stable data-tb-id and the snapshot survives on the session, not the view.

export interface FocusSnapshot {
	tbId: string | null;
	selStart: number | null;
	selEnd: number | null;
	gridScroll: number;
}

type Editable = HTMLInputElement | HTMLTextAreaElement;

function isEditable(node: Element | null): node is Editable {
	return (
		node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
	);
}

export class FocusManager {
	private snapshot: FocusSnapshot | null = null;

	/** Record the current focus/selection/scroll state inside `root`. */
	captureFrom(root: HTMLElement): void {
		const doc = root.ownerDocument;
		const active = doc.activeElement;
		let tbId: string | null = null;
		let selStart: number | null = null;
		let selEnd: number | null = null;
		if (active && root.contains(active)) {
			const idHolder = active.closest("[data-tb-id]");
			tbId = idHolder?.getAttribute("data-tb-id") ?? null;
			if (isEditable(active)) {
				selStart = active.selectionStart;
				selEnd = active.selectionEnd;
			}
		} else if (this.snapshot) {
			// Focus already left the widget (or the widget was detached before
			// capture ran): keep the last known focused field, refresh scroll only.
			tbId = this.snapshot.tbId;
			selStart = this.snapshot.selStart;
			selEnd = this.snapshot.selEnd;
		}
		const grid = root.querySelector(".tb-grid-scroll");
		const gridScroll =
			grid instanceof HTMLElement ? grid.scrollTop : this.snapshot?.gridScroll ?? 0;
		this.snapshot = { tbId, selStart, selEnd, gridScroll };
	}

	/**
	 * Re-apply the snapshot inside a freshly built `root`. Focus is restored
	 * only when nothing else holds it (rebuilds drop focus to <body>), so the
	 * planner never steals focus from the editor or another pane.
	 */
	restoreTo(root: HTMLElement): void {
		const s = this.snapshot;
		if (!s) return;
		const grid = root.querySelector(".tb-grid-scroll");
		if (grid instanceof HTMLElement) grid.scrollTop = s.gridScroll;
		if (!s.tbId) return;
		const doc = root.ownerDocument;
		const active = doc.activeElement;
		const focusIsFree =
			active == null || active === doc.body || root.contains(active);
		if (!focusIsFree) return;
		const escaped =
			typeof CSS !== "undefined" && CSS.escape
				? CSS.escape(s.tbId)
				: s.tbId.replace(/"/g, '\\"');
		const holder = root.querySelector(`[data-tb-id="${escaped}"]`);
		if (!holder) return;
		const target = isEditable(holder)
			? holder
			: holder.querySelector("input, textarea");
		if (!isEditable(target)) return;
		target.focus({ preventScroll: true });
		if (s.selStart != null) {
			const len = target.value.length;
			const start = Math.min(s.selStart, len);
			const end = Math.min(s.selEnd ?? start, len);
			try {
				target.setSelectionRange(start, end);
			} catch {
				// some input types refuse selections; focus alone is fine
			}
		}
	}

	clear(): void {
		this.snapshot = null;
	}
}
