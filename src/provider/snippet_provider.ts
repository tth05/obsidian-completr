import type { DataFiles } from "../data_files.ts";
import { getLatexContext } from "../editor_context.ts";
import type { CompletrSettings } from "../settings.ts";
import type { SuggestionBlacklist } from "./blacklist.ts";
import { type CustomEntry, CustomEntryFile } from "./custom_suggestions.ts";
import { type Suggestion, type SuggestionContext, type SuggestionProvider, suggestion } from "./provider.ts";

export const SNIPPETS_FILE = "snippets.json";

/**
 * User defined snippets outside of math blocks: typing (the start of) a snippet's name suggests its replacement, which
 * may span multiple lines and contain placeholders.
 */
export class SnippetProvider implements SuggestionProvider {
    readonly id = "snippet";
    readonly icon = "scissors";

    private readonly file: CustomEntryFile;

    constructor(
        files: DataFiles,
        private readonly blacklist: SuggestionBlacklist,
    ) {
        this.file = new CustomEntryFile(files, SNIPPETS_FILE);
    }

    get snippets(): readonly CustomEntry[] {
        return this.file.entries;
    }

    setSnippets(snippets: CustomEntry[]): Promise<void> {
        return this.file.set(snippets);
    }

    load(): Promise<string | null> {
        return this.file.load();
    }

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[] {
        const { snippets } = this;
        if (!settings.snippetsEnabled || snippets.length === 0) return [];

        const query = context.query.toLowerCase();
        if (!context.manual && query.length === 0) return [];

        const matches = snippets.filter(
            (s) => s.displayName.toLowerCase().startsWith(query) && !this.blacklist.has(s.displayName),
        );
        if (matches.length === 0) return [];
        // Inside math, the LaTeX provider is responsible
        if (getLatexContext(context.state, context.editor.posToOffset(context.end), false)) return [];

        return matches
            .sort((a, b) => a.displayName.length - b.displayName.length)
            .map((s) => suggestion(s.displayName, s.replacement, { isSnippet: true, snippetSyntax: "template" }));
    }
}
