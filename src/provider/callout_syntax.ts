/**
 * Pure parsing helpers for callout headers (`> [!type]+ Title`).
 */

const BLOCKQUOTE_PREFIX_REGEX = /^(?:[ \t]*>[ \t]*)+/;
const CALLOUT_HEADER_REGEX = /^(\[!?([^\]]*)\])([+-]?)([ \t]*)(.*)$/d; // [!TYPE]- TITLE
const CALLOUT_HEADER_PARTIAL_REGEX = /^(\[!?([^\]]*))$/d; // [!TYPE

export interface BlockQuotePrefix {
    /** Number of ">" characters. */
    depth: number;
    /** Length of the prefix including whitespace. */
    chOffset: number;
    text: string;
}

export function extractBlockQuotePrefix(line: string): BlockQuotePrefix | null {
    const match = BLOCKQUOTE_PREFIX_REGEX.exec(line);
    if (!match) return null;
    const text = match[0];
    return { chOffset: text.length, text, depth: text.length - text.replaceAll(">", "").length };
}

export interface CalloutHeaderPart {
    start: number;
    end: number;
    text: string;
    rawText: string;
}

export interface CalloutHeader {
    type: CalloutHeaderPart;
    foldable: CalloutHeaderPart;
    title: CalloutHeaderPart;
}

const emptyPart = (): CalloutHeaderPart => ({ start: -1, end: -1, text: "", rawText: "" });

/** Parses a callout header. `line` must have the block quote prefix stripped. */
export function extractCalloutHeader(line: string): CalloutHeader | null {
    const result: CalloutHeader = { type: emptyPart(), foldable: emptyPart(), title: emptyPart() };

    let match = CALLOUT_HEADER_REGEX.exec(line);
    if (match?.indices) {
        [result.type.start, result.type.end] = match.indices[1]!;
        result.type.rawText = match[1]!;
        result.type.text = match[2].trim();

        [result.foldable.start, result.foldable.end] = match.indices[3]!;
        result.foldable.rawText = match[3] + match[4];
        result.foldable.text = result.foldable.rawText.trim();

        [result.title.start, result.title.end] = match.indices[5]!;
        result.title.rawText = match[5]!;
        result.title.text = match[5].trim();
        return result;
    }

    match = CALLOUT_HEADER_PARTIAL_REGEX.exec(line);
    if (match?.indices) {
        [result.type.start, result.type.end] = match.indices[1]!;
        result.type.rawText = match[1]!;
        result.type.text = match[2].trim();
        return result;
    }

    return null;
}

export interface CalloutCompletion {
    /** What has been typed of the callout type so far (lower case). */
    search: string;
    /** Where the replacement starts (after the block quote prefix). */
    start: number;
    /** Text to keep after the new `[!type]`: the fold marker (followed by at least one space) and the title. */
    suffix: string;
}

/**
 * Checks whether the cursor (`ch`) is inside the type of a callout header on `line`. `lineAbove` is needed to make sure
 * the line starts a new block quote.
 */
export function getCalloutCompletion(line: string, lineAbove: string | null, ch: number): CalloutCompletion | null {
    const quote = extractBlockQuotePrefix(line);
    if (!quote) return null;

    // Only the first line of a (nested) block quote can be a callout header:
    //   > > >     <-- OK
    //   > > >     <-- not OK (continuation)
    //   > >       <-- not OK (continuation of lower-depth block)
    const quoteAbove = lineAbove === null ? null : extractBlockQuotePrefix(lineAbove);
    if (quoteAbove && quoteAbove.depth >= quote.depth) return null;

    const header = extractCalloutHeader(line.substring(quote.chOffset));
    if (!header) return null;

    const cursor = ch - quote.chOffset;
    const { type } = header;
    if (cursor < type.start + 1 || cursor > type.end - (type.rawText.endsWith("]") ? 1 : 0)) return null;

    // Only compare up to the cursor
    const cursorInType = cursor - (type.start + type.rawText.indexOf(type.text));
    const foldable = header.foldable.rawText;
    return {
        search: type.text.toLowerCase().substring(0, Math.max(0, cursorInType)),
        start: quote.chOffset,
        suffix: (foldable.trimEnd() !== foldable ? foldable : foldable + " ") + header.title.rawText,
    };
}
