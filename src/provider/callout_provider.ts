import { getApi } from "obsidian-callout-manager";
import { Suggestion, SuggestionContext, SuggestionProvider } from "./provider";
import { CalloutProviderSource, CompletrSettings, intoCompletrPath } from "../settings";
import { Notice, Vault } from "obsidian";
import { SuggestionBlacklist } from "./blacklist";
import CompletrPlugin from "src/main";

const CALLOUT_SUGGESTIONS_FILE = "callout_suggestions.json";

const BLOCKQUOTE_PREFIX_REGEX = /^(?:[ \t]*>[ \t]*)+/;
const CALLOUT_HEADER_REGEX = /^(\[!?([^\]]*)\])([+-]?)([ \t]*)(.*)$/d; // [!TYPE]- TITLE
const CALLOUT_HEADER_PARTIAL_REGEX = /^(\[!?([^\]]*))$/d;           // [!TYPE

class CalloutSuggestionProvider implements SuggestionProvider {
    blocksAllOtherProviders = true;

    private loadedSuggestions: Suggestion[] = [];
    private boundLoadSuggestionsUsingCalloutManager = this.loadSuggestionsUsingCalloutManager.bind(this);

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
        const calloutType = callout.type;
        if (cursor < calloutType.start + 1 || cursor > (calloutType.end - (calloutType.rawText.endsWith("]") ? 1 : 0)))
            return [];

        // Generate and return the suggestions.
        const replaceTitle = callout.title.rawText;
        const replaceFoldable = untrimEnd(callout.foldable.rawText);

        // This ensures that we only perform the startsWith check up until where the cursor is placed in the type text.
        const cursorInType = cursor - (calloutType.start + calloutType.rawText.indexOf(calloutType.text));
        const search = calloutType.text.toLowerCase().substring(0, cursorInType);
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

    async loadSuggestions(vault: Vault, plugin: CompletrPlugin) {
        const source = plugin.settings.calloutProviderSource;

        // Callout Manager
        const calloutManagerApi = await getApi(plugin);
        if (calloutManagerApi != null) {
            calloutManagerApi.off('change', this.boundLoadSuggestionsUsingCalloutManager);
            if (source === CalloutProviderSource.CALLOUT_MANAGER) {
                calloutManagerApi.on('change', this.boundLoadSuggestionsUsingCalloutManager);
                await this.loadSuggestionsUsingCalloutManager();
                return;
            }
        }

        // Completr.
        await this.loadSuggestionsUsingCompletr(vault);
    }

    protected async loadSuggestionsUsingCompletr(vault: Vault) {
        const path = intoCompletrPath(vault, CALLOUT_SUGGESTIONS_FILE);

        if (!(await vault.adapter.exists(path))) {
            const defaultCommands = generateDefaulCalloutOptions();
            await vault.adapter.write(path, JSON.stringify(defaultCommands, null, 2));
            this.loadedSuggestions = defaultCommands;
        } else {
            try {
                this.loadedSuggestions = await loadSuggestionsFromFile(vault, path, {
                    allowColors: true,
                    allowIcons: true,
                });
            } catch (e) {
                new Notice(`${e.message}. Using default callout types.`, 3000);
                this.loadedSuggestions = generateDefaulCalloutOptions();
            }
        }

        this.loadedSuggestions = SuggestionBlacklist.filter(this.loadedSuggestions);
    }

    protected async loadSuggestionsUsingCalloutManager() {
        const api = await getApi();

        this.loadedSuggestions = Array.from(api.getCallouts())
            .sort(({id: a}, {id: b}) => a.localeCompare(b))
            .map(callout => newSuggestion(
                api.getTitle(callout),
                callout.id,
                callout.icon,
                `rgb(${callout.color})`,
            ));
    }
}

export const Callout = new CalloutSuggestionProvider();

/*
 * Ensures there is at least one character worth of whitespace at the end of the provided string.
 */
function untrimEnd(string: string) {
    if (string.trimEnd() !== string)
        return string; // There's already some whitespace at the end.

    return `${string} `;
}

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
 * Loads suggestions from a file.
 */
export async function loadSuggestionsFromFile(vault: Vault, file: string, opts?: Partial<{
    allowIcons: boolean,
    allowColors: boolean,
}>) {
    const rawData = await vault.adapter.read(file);
    let data: any[];

    // Parse the suggestions.
    try {
        data = JSON.parse(rawData);
    } catch (e) {
        console.log("Completr callout types parse error:", e.message);
        throw new Error(`Failed to parse file ${file}.`);
    }

    // Ensure the suggestions are an array.
    if (!(data instanceof Array)) {
        throw new Error(`Invalid suggestions file ${file}: JSON root must be array.`)
    }

    // Parse suggestions.
    const suggestions = data.map(obj => {
        if (typeof obj === 'string')
            return Suggestion.fromString(obj);

        if (!opts?.allowColors) delete obj['color'];
        if (!opts?.allowIcons) delete obj['icon'];

        return new Suggestion(
            obj.displayName,
            obj.replacement,
            undefined,
            undefined,
            obj,
        )
    });

    // Validate suggestions.
    const invalidsuggestion = suggestions.find(c => c.displayName.includes("\n"));
    if (invalidsuggestion)
        throw new Error("Display name cannot contain a newline: " + invalidsuggestion.displayName);

    // Return suggestions.
    return suggestions;
}

function newSuggestion(name: string, replacement: string, icon: string, color: string) {
    return new Suggestion(name, replacement, undefined, undefined, {
        icon,
        color,
    })
}

/*
 * Generates the default callout suggestions. This is a method to avoid any unnecessary initialization
 */
function generateDefaulCalloutOptions(): Suggestion[] {
    const NOTE: [string, string] = ['lucide-pencil', '#448aff'];
    const ABSTRACT: [string, string] = ['lucide-clipboard-list', '#00b0ff'];
    const INFO: [string, string] = ['lucide-info', '#00b8d4'];
    const TODO: [string, string] = ['lucide-check-circle-2', '#00b8d4'];
    const TIP: [string, string] = ['lucide-flame', '#00bfa6'];
    const SUCCESS: [string, string] = ['lucide-check', '#00c853'];
    const QUESTION: [string, string] = ['lucide-help-circle', '#63dd17'];
    const WARNING: [string, string] = ['lucide-alert-triangle', '#ff9100'];
    const FAILURE: [string, string] = ['lucide-x', '#ff5252'];
    const DANGER: [string, string] = ['lucide-zap', '#ff1744'];
    const BUG: [string, string] = ['lucide-bug', '#f50057'];
    const EXAMPLE: [string, string] = ['lucide-list', '#7c4dff'];
    const QUOTE: [string, string] = ['quote-glyph', '#9e9e9e'];

    return [
        newSuggestion("Note", "note", ...NOTE),
        newSuggestion("Summary", "summary", ...ABSTRACT),
        newSuggestion("Abstract", "abstract", ...ABSTRACT),
        newSuggestion("TL;DR", "tldr", ...ABSTRACT),
        newSuggestion("Info", "info", ...INFO),
        newSuggestion("To-Do", "todo", ...TODO),
        newSuggestion("Tip", "tip", ...TIP),
        newSuggestion("Hint", "hint", ...TIP),
        newSuggestion("Important", "important", ...TIP),
        newSuggestion("Success", "success", ...SUCCESS),
        newSuggestion("Check", "check", ...SUCCESS),
        newSuggestion("Done", "done", ...SUCCESS),
        newSuggestion("Question", "question", ...QUESTION),
        newSuggestion("Help", "Help", ...QUESTION),
        newSuggestion("FAQ", "faq", ...QUESTION),
        newSuggestion("Warning", "warning", ...WARNING),
        newSuggestion("Caution", "caution", ...WARNING),
        newSuggestion("Attention", "attention", ...WARNING),
        newSuggestion("Failure", "failure", ...FAILURE),
        newSuggestion("Fail", "fail", ...FAILURE),
        newSuggestion("Missing", "missing", ...FAILURE),
        newSuggestion("Danger", "danger", ...DANGER),
        newSuggestion("Error", "error", ...DANGER),
        newSuggestion("Bug", "bug", ...BUG),
        newSuggestion("Example", "example", ...EXAMPLE),
        newSuggestion("Quote", "quote", ...QUOTE),
        newSuggestion("Cite", "cite", ...QUOTE),
    ];
}
