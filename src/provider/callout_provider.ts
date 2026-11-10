import type { Plugin } from "obsidian";
import { type CalloutManager, getApi } from "obsidian-callout-manager";
import type { DataFiles } from "../data_files.ts";
import { CalloutProviderSource, type CompletrSettings } from "../settings.ts";
import { getCalloutCompletion } from "./callout_syntax.ts";
import { type Suggestion, type SuggestionContext, type SuggestionProvider, suggestion } from "./provider.ts";

export const CALLOUT_SUGGESTIONS_FILE = "callout_suggestions.json";

/** Suggests callout types when typing `> [!` at the start of a block quote. */
export class CalloutProvider implements SuggestionProvider {
    readonly id = "callout";
    readonly icon = "quote";
    readonly blocksAllOtherProviders = true;

    private suggestions: Suggestion[] = [];
    private calloutManager: CalloutManager<true> | null = null;
    private readonly onCalloutManagerChange = () => this.loadFromCalloutManager();

    constructor(
        private readonly plugin: Plugin,
        private readonly files: DataFiles,
    ) {}

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[] {
        if (!settings.calloutProviderEnabled) return [];

        const { editor } = context;
        const lineNumber = context.end.line;
        const completion = getCalloutCompletion(
            context.line,
            lineNumber === 0 ? null : editor.getLine(lineNumber - 1),
            context.end.ch,
        );
        if (!completion) return [];

        const { search } = completion;
        return this.suggestions
            .filter(
                (s) => s.displayName.toLowerCase().startsWith(search) || s.replacement.toLowerCase().startsWith(search),
            )
            .map((s) => ({
                ...s,
                replacement: `[!${s.replacement}]${completion.suffix}`,
                overrideStart: { line: lineNumber, ch: completion.start },
                overrideEnd: { line: lineNumber, ch: context.line.length },
            }));
    }

    /** Loads the callout types from the configured source. Returns an error message if the file is invalid. */
    async load(settings: CompletrSettings): Promise<string | null> {
        this.calloutManager?.off("change", this.onCalloutManagerChange);
        this.calloutManager = null;

        if (settings.calloutProviderSource === CalloutProviderSource.CALLOUT_MANAGER) {
            const api = await getApi(this.plugin);
            if (api) {
                this.calloutManager = api;
                api.on("change", this.onCalloutManagerChange);
                this.loadFromCalloutManager();
                return null;
            }
        }

        return this.loadFromFile();
    }

    unload() {
        this.calloutManager?.off("change", this.onCalloutManagerChange);
        this.calloutManager = null;
    }

    private loadFromCalloutManager() {
        const api = this.calloutManager;
        if (!api) return;
        this.suggestions = Array.from(api.getCallouts())
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((callout) =>
                suggestion(api.getTitle(callout), callout.id, { icon: callout.icon, color: `rgb(${callout.color})` }),
            );
    }

    private async loadFromFile(): Promise<string | null> {
        const contents = await this.files.read(CALLOUT_SUGGESTIONS_FILE);
        if (contents === null) {
            this.suggestions = defaultCallouts();
            await this.files.write(
                CALLOUT_SUGGESTIONS_FILE,
                JSON.stringify(
                    this.suggestions.map(({ displayName, replacement, icon, color }) => ({
                        displayName,
                        replacement,
                        icon,
                        color,
                    })),
                    null,
                    2,
                ),
            );
            return null;
        }

        try {
            this.suggestions = parseCalloutSuggestions(contents);
            return null;
        } catch (e) {
            this.suggestions = defaultCallouts();
            return `${(e as Error).message}. Using default callout types.`;
        }
    }
}

export function parseCalloutSuggestions(json: string): Suggestion[] {
    let data: unknown;
    try {
        data = JSON.parse(json);
    } catch {
        throw new Error(`Failed to parse ${CALLOUT_SUGGESTIONS_FILE}`);
    }
    if (!Array.isArray(data)) throw new Error(`Invalid ${CALLOUT_SUGGESTIONS_FILE}: JSON root must be an array`);

    return data.map((entry: unknown) => {
        if (typeof entry === "string") {
            if (entry.includes("\n")) throw new Error("Display name cannot contain a newline: " + entry);
            return suggestion(entry);
        }
        const obj = (entry ?? {}) as Record<string, unknown>;
        if (typeof obj.displayName !== "string" || typeof obj.replacement !== "string")
            throw new Error(
                `Invalid ${CALLOUT_SUGGESTIONS_FILE}: entry without displayName/replacement: ${JSON.stringify(entry)}`,
            );
        if (obj.displayName.includes("\n"))
            throw new Error("Display name cannot contain a newline: " + obj.displayName);
        return suggestion(obj.displayName, obj.replacement, {
            icon: typeof obj.icon === "string" ? obj.icon : undefined,
            color: typeof obj.color === "string" ? obj.color : undefined,
        });
    });
}

export function defaultCallouts(): Suggestion[] {
    const types: [string, string, string[]][] = [
        ["lucide-pencil", "#448aff", ["Note"]],
        ["lucide-clipboard-list", "#00b0ff", ["Summary", "Abstract", "TL;DR:tldr"]],
        ["lucide-info", "#00b8d4", ["Info"]],
        ["lucide-check-circle-2", "#00b8d4", ["To-Do:todo"]],
        ["lucide-flame", "#00bfa6", ["Tip", "Hint", "Important"]],
        ["lucide-check", "#00c853", ["Success", "Check", "Done"]],
        ["lucide-help-circle", "#63dd17", ["Question", "Help", "FAQ"]],
        ["lucide-alert-triangle", "#ff9100", ["Warning", "Caution", "Attention"]],
        ["lucide-x", "#ff5252", ["Failure", "Fail", "Missing"]],
        ["lucide-zap", "#ff1744", ["Danger", "Error"]],
        ["lucide-bug", "#f50057", ["Bug"]],
        ["lucide-list", "#7c4dff", ["Example"]],
        ["quote-glyph", "#9e9e9e", ["Quote", "Cite"]],
    ];
    return types.flatMap(([icon, color, names]) =>
        names.map((n) => {
            const [displayName, id = displayName.toLowerCase()] = n.split(":") as [string, string?];
            return suggestion(displayName, id, { icon, color });
        }),
    );
}
