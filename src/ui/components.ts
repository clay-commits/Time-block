import { setIcon } from "obsidian";

export function el<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tag: K,
	cls?: string,
	text?: string
): HTMLElementTagNameMap[K] {
	const node = parent.ownerDocument.createElement(tag);
	if (cls) node.className = cls;
	if (text !== undefined) node.textContent = text;
	parent.appendChild(node);
	return node;
}

export function section(
	parent: HTMLElement,
	title: string,
	cls = ""
): { root: HTMLElement; body: HTMLElement } {
	const root = el(parent, "div", `tb-section ${cls}`.trim());
	el(root, "div", "tb-section-title", title);
	const body = el(root, "div", "tb-section-body");
	return { root, body };
}

export interface TextInputOpts {
	value: string;
	placeholder?: string;
	tbId: string;
	cls?: string;
	ariaLabel?: string;
	onInput?: (value: string) => void;
	onEnter?: (value: string, input: HTMLInputElement) => void;
}

export function textInput(parent: HTMLElement, opts: TextInputOpts): HTMLInputElement {
	const input = el(parent, "input", `tb-text ${opts.cls ?? ""}`.trim());
	input.type = "text";
	input.value = opts.value;
	if (opts.placeholder) input.placeholder = opts.placeholder;
	if (opts.ariaLabel) input.setAttribute("aria-label", opts.ariaLabel);
	input.setAttribute("data-tb-id", opts.tbId);
	input.setAttribute("spellcheck", "false");
	if (opts.onInput) {
		input.addEventListener("input", () => opts.onInput!(input.value));
	}
	if (opts.onEnter) {
		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" && !evt.isComposing) {
				evt.preventDefault();
				opts.onEnter!(input.value, input);
			}
		});
	}
	return input;
}

export interface TextareaOpts {
	value: string;
	placeholder?: string;
	tbId: string;
	onInput?: (value: string) => void;
}

export function textarea(parent: HTMLElement, opts: TextareaOpts): HTMLTextAreaElement {
	const area = el(parent, "textarea", "tb-textarea");
	area.value = opts.value;
	if (opts.placeholder) area.placeholder = opts.placeholder;
	area.setAttribute("data-tb-id", opts.tbId);
	area.rows = 3;
	const grow = () => {
		area.style.height = "auto";
		area.style.height = `${area.scrollHeight}px`;
	};
	area.addEventListener("input", () => {
		grow();
		opts.onInput?.(area.value);
	});
	window.requestAnimationFrame(grow);
	return area;
}

export function checkbox(
	parent: HTMLElement,
	checked: boolean,
	ariaLabel: string,
	onChange: (checked: boolean, input: HTMLInputElement) => void
): HTMLInputElement {
	const input = el(parent, "input", "tb-check");
	input.type = "checkbox";
	input.checked = checked;
	input.setAttribute("aria-label", ariaLabel);
	input.addEventListener("change", () => onChange(input.checked, input));
	return input;
}

export function iconButton(
	parent: HTMLElement,
	icon: string,
	tooltip: string,
	onClick: (evt: MouseEvent) => void,
	cls = ""
): HTMLElement {
	const btn = el(parent, "button", `tb-icon-btn ${cls}`.trim());
	btn.type = "button";
	btn.setAttribute("aria-label", tooltip);
	btn.title = tooltip;
	setIcon(btn, icon);
	btn.addEventListener("click", (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		onClick(evt);
	});
	return btn;
}

export function badge(
	parent: HTMLElement,
	text: string,
	cls = "",
	title?: string
): HTMLElement {
	const node = el(parent, "span", `tb-badge ${cls}`.trim(), text);
	if (title) node.title = title;
	return node;
}
