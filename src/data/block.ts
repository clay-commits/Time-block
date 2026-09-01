// Locate and rewrite one fenced code block (```timeblock / ```timeblock-lists)
// inside a note, character-offset based so every other byte of the note is
// preserved exactly. Fences belonging to OTHER languages (backtick or tilde,
// any length >= 3) are skipped so a "```timeblock" example inside another
// fence is never matched. Our own blocks are always written with fences at
// column 0, so the closing fence of our block must start at column 0 — that
// keeps indented backtick runs inside YAML block scalars from closing us.

export interface FoundBlock {
	/** Offset of the first character of the opening fence line. */
	outerStart: number;
	/** Offset just past the block (past the closing fence line, or EOF if unclosed). */
	outerEnd: number;
	/** Offset of the first character of the inner content. */
	innerStart: number;
	/** Offset just past the inner content (start of the closing fence line). */
	innerEnd: number;
	/** Inner content, including its trailing newline when present. */
	inner: string;
	/** The opening fence marker, e.g. "```". */
	marker: string;
	/** False when the block runs to EOF without a closing fence. */
	closed: boolean;
}

interface Line {
	text: string;
	start: number;
	/** Offset just past this line's newline (or EOF for the last line). */
	next: number;
}

function splitLines(content: string): Line[] {
	const lines: Line[] = [];
	let start = 0;
	while (start <= content.length) {
		let nl = content.indexOf("\n", start);
		if (nl === -1) {
			if (start < content.length) {
				lines.push({
					text: content.slice(start).replace(/\r$/, ""),
					start,
					next: content.length,
				});
			}
			break;
		}
		// Strip a trailing \r from the matching text (CRLF files) but keep the
		// real offsets so replacement stays byte-exact.
		lines.push({
			text: content.slice(start, nl).replace(/\r$/, ""),
			start,
			next: nl + 1,
		});
		start = nl + 1;
	}
	return lines;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

function closesFence(lineText: string, marker: string): boolean {
	const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lineText);
	if (!m) return false;
	const run = m[1]!;
	return run[0] === marker[0] && run.length >= marker.length;
}

/** Closing fence for OUR block: column 0, same fence char, length >= opener. */
function closesOurFence(lineText: string, marker: string): boolean {
	const m = /^(`{3,}|~{3,})\s*$/.exec(lineText);
	if (!m) return false;
	const run = m[1]!;
	return run[0] === marker[0] && run.length >= marker.length;
}

/**
 * Semantic equality for block inner content, tolerant of representation-only
 * differences (CRLF vs LF, trailing blank lines) that Obsidian's rendered
 * source and the raw bytes on disk can legitimately disagree on.
 */
export function sameInner(a: string, b: string): boolean {
	const norm = (s: string) =>
		s.replace(/\r\n?/g, "\n").replace(/\n*$/, "\n");
	return norm(a) === norm(b);
}

/** Find the first fenced block whose info string is exactly `lang`. */
export function findFencedBlock(
	content: string,
	lang: string
): FoundBlock | null {
	const lines = splitLines(content);
	let otherFence: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (otherFence !== null) {
			if (closesFence(line.text, otherFence)) otherFence = null;
			continue;
		}
		const m = FENCE_OPEN.exec(line.text);
		if (!m) continue;
		const marker = m[1]!;
		const info = m[2]!.trim();
		// Match the way Obsidian routes code blocks to processors: any fence
		// char, and only the FIRST info-string token names the language.
		const infoLang = info.split(/\s+/)[0] ?? "";
		if (infoLang === lang && !(marker[0] === "`" && info.includes("`"))) {
			// Our block: inner runs from the end of this line to the closing fence.
			const innerStart = line.next;
			for (let j = i + 1; j < lines.length; j++) {
				const closer = lines[j]!;
				if (closesOurFence(closer.text, marker)) {
					return {
						outerStart: line.start,
						outerEnd: closer.next,
						innerStart,
						innerEnd: closer.start,
						inner: content.slice(innerStart, closer.start),
						marker,
						closed: true,
					};
				}
			}
			return {
				outerStart: line.start,
				outerEnd: content.length,
				innerStart,
				innerEnd: content.length,
				inner: content.slice(innerStart),
				marker,
				closed: false,
			};
		}
		// Some other fenced block (```js, ~~~text, ````…): skip to its close.
		// An info string containing backticks is not a valid fence opener.
		if (marker[0] === "`" && info.includes("`")) continue;
		otherFence = marker;
	}
	return null;
}

function withTrailingNewline(s: string): string {
	if (s === "") return s;
	return s.endsWith("\n") ? s : s + "\n";
}

/** Replace the inner content of a previously found block. */
export function replaceFencedBlock(
	content: string,
	found: FoundBlock,
	newInner: string
): string {
	const inner = withTrailingNewline(newInner);
	const head = content.slice(0, found.innerStart);
	// If the opener was the last line with no newline, add one before the content.
	const headFixed =
		head.length > 0 && !head.endsWith("\n") ? head + "\n" : head;
	if (found.closed) {
		return headFixed + inner + content.slice(found.innerEnd);
	}
	// Unclosed block at EOF: everything after innerStart was inner — close it.
	return headFixed + inner + found.marker + "\n";
}

/** Append a new fenced block at the end of the note, separated by a blank line. */
export function appendFencedBlock(
	content: string,
	lang: string,
	inner: string
): string {
	let prefix = content;
	if (prefix.length > 0 && !prefix.endsWith("\n")) prefix += "\n";
	if (prefix.length > 0 && !prefix.endsWith("\n\n")) prefix += "\n";
	return prefix + "```" + lang + "\n" + withTrailingNewline(inner) + "```\n";
}
