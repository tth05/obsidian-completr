import { type App, Notice, type Plugin } from "obsidian";
import type { CalloutManager } from "obsidian-callout-manager";
import type { DataFiles } from "../data_files.ts";
import { reportError } from "../errors.ts";
import { CalloutProviderSource, type CompletrSettings } from "../settings.ts";
import { getCalloutCompletion } from "./callout_syntax.ts";
import { type Suggestion, type SuggestionContext, type SuggestionProvider, suggestion } from "./provider.ts";

export const CALLOUT_SUGGESTIONS_FILE = "callout_suggestions.json";

const CALLOUT_MANAGER_ID = "callout-manager";

interface CalloutManagerPlugin extends Plugin {
    newApiHandle(version: "v1", consumer: Plugin, cleanup: () => void): Promise<CalloutManager<true>>;
    destroyApiHandle(version: "v1", consumer: Plugin): void;
}

/**
 * The running Callout Manager plugin. Not done with `getApi`/`isInstalled` of the obsidian-callout-manager package,
 * because they only look at `enabledPlugins`: plugins started by other plugins (e.g. Lazy Plugin Loader) run without
 * being in there (#94).
 */
function getCalloutManagerPlugin(app: App): CalloutManagerPlugin | null {
    return app.plugins.getPlugin(CALLOUT_MANAGER_ID) as CalloutManagerPlugin | null;
}

/** Whether Callout Manager is running, or enabled and about to be loaded. */
export function isCalloutManagerAvailable(app: App): boolean {
    return getCalloutManagerPlugin(app) !== null || app.plugins.enabledPlugins.has(CALLOUT_MANAGER_ID);
}

/** Suggests callout types when typing `> [!` at the start of a block quote. */
export class CalloutProvider implements SuggestionProvider {
    readonly id = "callout";
    readonly icon = "quote";
    readonly blocksAllOtherProviders = true;

    private suggestions: Suggestion[] = [];
    /** Whether Callout Manager is the configured source, even if it isn't running right now. */
    private useCalloutManager = false;
    /** The Callout Manager the suggestions come from, null if they come from the file. */
    private connected: { plugin: CalloutManagerPlugin; api: CalloutManager<true> } | null = null;
    /** Incremented by every (re)load, so that a slower, older load can't overwrite a newer one. */
    private generation = 0;
    private readonly onCalloutManagerChange = () => this.loadFromCalloutManager();

    constructor(
        private readonly plugin: Plugin,
        private readonly files: DataFiles,
    ) {
        // Callout Manager can be loaded after Completr (e.g. delayed by Lazy Plugin Loader) and turned off at any time
        plugin.registerEvent(plugin.app.plugins.on("changed", () => this.onPluginsChanged()));
    }

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
        this.useCalloutManager = settings.calloutProviderSource === CalloutProviderSource.CALLOUT_MANAGER;
        return this.reload();
    }

    unload() {
        this.generation++;
        this.disconnect();
    }

    private async reload(): Promise<string | null> {
        const generation = ++this.generation;
        this.disconnect();

        const calloutManager = this.useCalloutManager ? getCalloutManagerPlugin(this.plugin.app) : null;
        if (!calloutManager) return this.loadFromFile(generation);

        const api = await calloutManager.newApiHandle("v1", this.plugin, () =>
            calloutManager.destroyApiHandle("v1", this.plugin),
        );
        if (generation !== this.generation) return null;
        this.connected = { plugin: calloutManager, api };
        api.on("change", this.onCalloutManagerChange);
        this.loadFromCalloutManager();
        return null;
    }

    private disconnect() {
        this.connected?.api.off("change", this.onCalloutManagerChange);
        this.connected = null;
    }

    /** Connects to Callout Manager once it is loaded, and falls back to the file once it is unloaded. */
    private onPluginsChanged() {
        if (!this.useCalloutManager) return;
        if (getCalloutManagerPlugin(this.plugin.app) === (this.connected?.plugin ?? null)) return;
        this.reload()
            .then((problem) => {
                if (problem) new Notice("Completr: " + problem, 8000);
            })
            .catch(reportError);
    }

    private loadFromCalloutManager() {
        const api = this.connected?.api;
        if (!api) return;
        this.suggestions = Array.from(api.getCallouts())
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((callout) => {
                // The raw color is "r, g, b" before Obsidian 1.13 and a hex color since, getColor parses both
                const color = api.getColor(callout);
                return suggestion(api.getTitle(callout), callout.id, {
                    icon: callout.icon,
                    color: "invalid" in color ? undefined : `rgb(${color.r}, ${color.g}, ${color.b})`,
                });
            });
    }

    private async loadFromFile(generation: number): Promise<string | null> {
        const contents = await this.files.read(CALLOUT_SUGGESTIONS_FILE);
        if (generation !== this.generation) return null;
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
