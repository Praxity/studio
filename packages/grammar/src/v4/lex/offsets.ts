function validOffset(offset: number, length: number): void {
	if (!Number.isInteger(offset) || offset < 0 || offset > length) {
		throw new RangeError(`Offset ${offset} is outside 0..${length}`);
	}
}

function pointWidth(point: number): number {
	return point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
}

/** UTF-8 encodes isolated surrogates as U+FFFD, as TextEncoder does. */
export function toUtf8Offset(text: string, utf16Offset: number): number {
	validOffset(utf16Offset, text.length);
	let bytes = 0;
	for (let index = 0; index < utf16Offset; ) {
		const point = text.codePointAt(index) as number;
		const width = point > 0xffff ? 2 : 1;
		if (index + width > utf16Offset) throw new RangeError("Offset splits a surrogate pair");
		bytes += pointWidth(point);
		index += width;
	}
	return bytes;
}

/** Rejects byte offsets inside a UTF-8 scalar instead of rounding a write boundary. */
export function toUtf16Offset(text: string, utf8Offset: number): number {
	if (!Number.isInteger(utf8Offset) || utf8Offset < 0) throw new RangeError("Invalid UTF-8 offset");
	let bytes = 0;
	let index = 0;
	while (index < text.length && bytes < utf8Offset) {
		const point = text.codePointAt(index) as number;
		bytes += pointWidth(point);
		index += point > 0xffff ? 2 : 1;
	}
	if (bytes !== utf8Offset)
		throw new RangeError("Offset is outside the text or splits a UTF-8 scalar");
	return index;
}

/** One-based UTF-16 columns. A CRLF break completes after LF, a lone CR after CR. */
export function lineColumn(text: string, utf16Offset: number): { line: number; column: number } {
	validOffset(utf16Offset, text.length);
	let line = 1;
	let lineStart = 0;
	for (let index = 0; index < utf16Offset; index++) {
		if (text[index] === "\r" && text[index + 1] === "\n") {
			if (index + 1 >= utf16Offset) break;
			index++;
		} else if (text[index] !== "\n" && text[index] !== "\r") {
			continue;
		}
		line++;
		lineStart = index + 1;
	}
	return { line, column: utf16Offset - lineStart + 1 };
}
