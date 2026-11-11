import type { DataFiles } from "../data_files.ts";
import type { CompletrSettings } from "../settings.ts";
import { isWordChar, summarize } from "../text.ts";
import { CustomEntryFile } from "./custom_suggestions.ts";
import type { Suggestion, SuggestionContext, SuggestionProvider } from "./provider.ts";

export const SNIPPETS_FILE = "snippets.json";

/**
 * How many characters of `name` are typed in front of the cursor: the longest start of `name` that `before` ends with.
 * A name starting with a word character only matches at the start of a word ("meet" in "homemeet" is not the start of
 * "meeting"). Names starting with anything else (":sig", "/date") match everywhere, that's what makes them triggers.
 */
export function matchSnippetName(before: string, name: string, isWordChar: (char: string) => boolean): number {
    const needsBoundary = name.length > 0 && isWordChar(name[0]);
    for (let length = Math.min(name.length, before.length); length > 0; length--) {
        if (!before.endsWith(name.substring(0, length))) continue;
        const start = before.length - length;
        if (!needsBoundary || start === 0) return length;
        let charStart = start - 1;
        const code = before.charCodeAt(charStart);
        // Low surrogate -> include the high surrogate in front of it
        if (code >= 0xdc00 && code <= 0xdfff && charStart > 0) {
            const high = before.charCodeAt(charStart - 1);
            if (high >= 0xd800 && high <= 0xdbff) charStart--;
        }
        if (!isWordChar(before.substring(charStart, start))) return length;
    }
    return 0;
}

/**
 * User defined snippets outside of math blocks: typing (the start of) a snippet's name suggests its replacement, which
 * may span multiple lines and contain placeholders.
 */
export class SnippetProvider implements SuggestionProvider {
    readonly id = "snippet";
    readonly icon = "scissors";
    readonly customEntries: CustomEntryFile;

    constructor(files: DataFiles) {
        this.customEntries = new CustomEntryFile(files, SNIPPETS_FILE, {
            title: "Snippets",
            noun: ["snippet", "snippets"],
            description: "Text templates you insert by typing the start of their name.",
            addTitle: "Add snippet",
            editTitle: "Edit snippet",
            namePlaceholder: "meeting",
            replacementPlaceholder: "## Meeting {{title}}\nAttendees: {{}}\n\n{{cursor}}",
            syntaxHelp:
                "The inserted text. {{}} marks a placeholder (jump to the next one with Enter), {{some text}} a placeholder with default text, {{cursor}} the final cursor position. May span multiple lines.",
            nameRequired: true,
        });
    }

    load(): Promise<string | null> {
        return this.customEntries.load();
    }

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[] {
        const snippets = this.customEntries.entries;
        if (!settings.snippetsEnabled || snippets.length === 0) return [];

        const { ch, line } = context.end;
        const typed = context.line.substring(0, ch);
        const lowerCase = typed.toLowerCase();
        // Lower casing can change the length of a few characters, offsets would be off then
        const before = lowerCase.length === typed.length ? lowerCase : typed;
        const wordChar = (char: string) => isWordChar(char, settings.characterRegex);
        // Opening the popup manually with nothing typed lists all snippets
        const listAll = context.manual && context.query.length === 0;

        const matches: { suggestion: Suggestion; length: number }[] = [];
        for (const entry of snippets) {
            const name = entry.displayName;
            // snippets.json may be edited by hand; an empty name would match everywhere
            if (name.length === 0) continue;
            const length = matchSnippetName(before, name.toLowerCase(), wordChar);
            // A single trigger character like ":" is typed all the time, it takes one more to mean the snippet
            const minLength = context.manual || wordChar(name[0] ?? "") ? 1 : Math.min(2, name.length);
            if (length < minLength && !listAll) continue;
            matches.push({
                length,
                suggestion: {
                    displayName: name,
                    replacement: entry.replacement,
                    snippet: "template",
                    overrideStart: { line, ch: ch - length },
                    detail: summarize(entry.replacement),
                    customEntry: entry,
                },
            });
        }
        if (matches.length === 0) return [];
        // Inside math, the LaTeX provider is responsible
        if (context.mathType(false)) return [];

        return matches
            .sort((a, b) => b.length - a.length || a.suggestion.displayName.length - b.suggestion.displayName.length)
            .map((m) => m.suggestion);
    }
}
