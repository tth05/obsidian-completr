import {
    Suggestion,
    SuggestionContext,
    SuggestionProvider
} from "./provider";
import {CompletrSettings, intoCompletrPath} from "../settings";
import {Notice, Vault} from "obsidian";
import {SuggestionBlacklist} from "./blacklist";


const CALLOUT_SUGGESTIONS_FILE = "callout_suggestions.json";

const BLOCKQUOTE_PREFIX_REGEX = /^(?:[ \t]*>[ \t]*)+/;
const CALLOUT_HEADER_REGEX = /^(\[!?([^\]]*)\])([+-]?)([ \t]*)(.*)$/d; // [!TYPE]- TITLE
const CALLOUT_HEADER_PARTIAL_REGEX = /^(\[!?([^\]]*))$/d;           // [!TYPE

class CalloutSuggestionProvider implements SuggestionProvider {

    private loadedSuggestions: Suggestion[] = [];

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[] {
        if (!settings.calloutProviderEnabled)
            return [];

        const { editor } = context;
        const lineNumber = context.start.line;
        const line = editor.getLine(lineNumber);

        // Ensure we're in a block quote.
        const quote = extractBlockQuotePrefix(line);
        if (quote == null)
            return [];

        // Ensure we're the top of this specific block quote.
        // Example:
        //   > > >     <-- OK
        //   > > >     <-- not OK (continuation)
        //   > >       <-- not OK (continuation of lower-depth block)
        //   > > >     <-- OK (new block)
        //
        const quoteAbove = lineNumber === 0 ? null : extractBlockQuotePrefix(editor.getLine(lineNumber - 1));
        if (quoteAbove != null && quoteAbove.depth >= quote.depth)
            return [];

        // Get the callout type.
        const trimmed = line.substring(quote.chOffset);
        const callout = extractCalloutHeader(trimmed);
        if (callout === null)
            return [];

        // Do nothing if the cursor is outside the callout type area.
        const cursor = editor.getCursor("from").ch - quote.chOffset;
        if (cursor < callout.type.start + 1 || cursor > callout.type.end)
            return [];

        // Generate and return the suggestions.
        const replaceFoldable = callout.foldable.rawText === '' ? ' ' : callout.foldable.rawText;
        const replaceTitle = callout.title.rawText;

        const search = callout.type.text.toLowerCase();
        return this.loadedSuggestions
            .filter(s => s.displayName.toLowerCase().startsWith(search) || s.replacement.toLowerCase().startsWith(search))
            .map(suggestion => {
                return suggestion.derive({
                    replacement: `[!${suggestion.replacement}]${replaceFoldable}${replaceTitle}`,
                    overrideEnd: {
                        line: context.end.line,
                        ch: line.length,
                    },
                    overrideStart: {
                        line: context.start.line,
                        ch: quote.chOffset,
                    }
                });
            });
    }

    async loadSuggestions(vault: Vault) {
        const path = intoCompletrPath(vault, CALLOUT_SUGGESTIONS_FILE);

        if (!(await vault.adapter.exists(path))) {
            const defaultCommands = generateDefaulCalloutOptions();
            await vault.adapter.write(path, JSON.stringify(defaultCommands, null, 2));
            this.loadedSuggestions = defaultCommands;
        } else {
            const data = await vault.adapter.read(path);
            try {
                const suggestions: Suggestion[] = (JSON.parse(data) as any[])
                    .map(obj => typeof obj === "string" ?
                        Suggestion.fromString(obj) :
                        new Suggestion(obj.displayName, obj.replacement)
                    );
                const invalidsuggestion = suggestions.find(c => c.displayName.includes("\n"));
                if (invalidsuggestion)
                    throw new Error("Display name cannot contain a newline: " + invalidsuggestion.displayName);

                this.loadedSuggestions = suggestions;
            } catch (e) {
                console.log("Completr callout types parse error:", e.message);
                new Notice("Failed to parse callout types file " + path + ". Using default suggestions.", 3000);
                this.loadedSuggestions = generateDefaulCalloutOptions();
            }
        }

        this.loadedSuggestions = SuggestionBlacklist.filter(this.loadedSuggestions);
    }
}

export const Callout = new CalloutSuggestionProvider();


/*
 * Extract information about the block quote.
 */
function extractBlockQuotePrefix(line: string): { depth: number, chOffset: number, text: string } | null {
    const matches = BLOCKQUOTE_PREFIX_REGEX.exec(line);
    if (matches == null)
        return null;

    const depth = /* the number of ">" chars */
        matches[0].length -
        matches[0].replaceAll(">", "").length;

    return {
        chOffset: matches[0].length,
        text: matches[0],
        depth,
    }
}

interface CalloutHeader {
    type: { start: number, end: number, text: string, rawText: string },
    foldable: { start: number, end: number, text: string, rawText: string },
    title: { start: number, end: number, text: string, rawText: string },
}

/*
 * Extract information from the callout header.
 * This assumes that `line` had the blockquote prefix stripped.
 */
function extractCalloutHeader(line: string): CalloutHeader | null {
    const result: CalloutHeader = {
        type: {
            start: -1,
            end: -1,
            text: '',
            rawText: '',
        },
        foldable: {
            start: -1,
            end: -1,
            text: '',
            rawText: '',
        },
        title: {
            start: -1,
            end: -1,
            text: '',
            rawText: '',
        }
    };

    // Try parsing the full header.
    let matches = CALLOUT_HEADER_REGEX.exec(line);
    if (matches !== null) {
        [result.type.start, result.type.end] = matches.indices[1];
        result.type.rawText = matches[1];
        result.type.text = matches[2].trim();

        [result.foldable.start, result.foldable.end] = matches.indices[3];
        result.foldable.rawText = matches[3] + matches[4];
        result.foldable.text = result.foldable.rawText.trim();

        [result.title.start, result.title.end] = matches.indices[5];
        result.title.rawText = matches[5];
        result.title.text = matches[5].trim();
        return result;
    }

    // Try parsing the partial header.
    matches = CALLOUT_HEADER_PARTIAL_REGEX.exec(line);
    if (matches !== null) {
        [result.type.start, result.type.end] = matches.indices[1];
        result.type.rawText = matches[1];
        result.type.text = matches[2].trim();
        return result;
    }

    return null;
}

/*
 * Generates the default callout suggestions. This is a method to avoid any unnecessary initialization
 */
function generateDefaulCalloutOptions(): Suggestion[] {
    return [
        new Suggestion("Note", "note"),
        new Suggestion("Summary", "summary"),
        new Suggestion("Info", "info"),
        new Suggestion("Tip", "tip"),
        new Suggestion("Hint", "hint"),
        new Suggestion("Example", "example"),
        new Suggestion("Quote", "quote"),
        new Suggestion("Important", "important"),
        new Suggestion("Warning", "warning"),
        new Suggestion("Success", "success"),
        new Suggestion("Error", "error"),
        new Suggestion("To-Do", "todo"),
        new Suggestion("Check", "check"),
        new Suggestion("Done", "done"),
        new Suggestion("Question", "question"),
        new Suggestion("Caution", "caution"),
        new Suggestion("Attention", "attention"),
        new Suggestion("Failure", "failure"),
        new Suggestion("Fail", "fail"),
        new Suggestion("Missing", "missing"),
        new Suggestion("Danger", "danger"),
        new Suggestion("Bug", "bug"),
        new Suggestion("Help", "Help"),
        new Suggestion("Abstract", "abstract"),
        new Suggestion("Cite", "cite"),
        new Suggestion("TL;DR", "tldr"),
        new Suggestion("FAQ", "faq"),
    ];
}
