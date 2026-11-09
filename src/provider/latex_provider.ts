import type { DataFiles } from "../data_files.ts";
import { getLatexContext } from "../editor_context.ts";
import type { CompletrSettings } from "../settings.ts";
import type { SuggestionBlacklist } from "./blacklist.ts";
import { type CustomEntry, CustomEntryFile, parseCustomEntries, serializeCustomEntries } from "./custom_suggestions.ts";
import { DEFAULT_LATEX_COMMANDS, DEFAULT_LATEX_ENVIRONMENTS } from "./latex_commands.ts";
import { type Suggestion, type SuggestionContext, type SuggestionProvider, suggestion } from "./provider.ts";

export const CUSTOM_LATEX_COMMANDS_FILE = "latex_commands.json";

export type LatexCommand = CustomEntry;

interface IndexedCommand {
    suggestion: Suggestion;
    lowerCaseName: string;
    /** Length of the name up to the first "{", used for ranking ("\vee" before "\veebar"). */
    nameLength: number;
}

function environmentCommands(): LatexCommand[] {
    const result: LatexCommand[] = [];
    for (const [name, paramCount, hasStar] of DEFAULT_LATEX_ENVIRONMENTS) {
        for (const env of hasStar ? [name, name + "*"] : [name]) {
            result.push({
                displayName: `\\begin{${env}}...`,
                replacement: `\\begin{${env}}${"{#}".repeat(paramCount)}\n${paramCount < 1 ? "~\n" : ""}\\end{${env}}`,
            });
        }
    }
    return result;
}

export function getBuiltInLatexCommands(): LatexCommand[] {
    return [...environmentCommands(), ...DEFAULT_LATEX_COMMANDS.map((c) => ({ displayName: c, replacement: c }))];
}

/** Defaults of v3 that were changed in v4 (old -> new). Needed to recognize unmodified v3 command files. */
const CHANGED_V3_DEFAULTS = new Map(
    ["int", "prod", "sum"].map((op) => [`\\${op}^{#}_{#}`, `\\${op}_{#}^{#}`] as const),
);

/** Parses the contents of a commands file: an array of strings or {displayName, replacement} objects. */
export const parseLatexCommands: (json: string) => LatexCommand[] = parseCustomEntries;

export const serializeLatexCommands: (commands: readonly LatexCommand[]) => string = serializeCustomEntries;

/**
 * Up to v3, the commands file contained all default commands. Splits such a file into the user's own commands and the
 * default commands the user deleted.
 */
export function migrateV3LatexCommands(commands: LatexCommand[]): {
    custom: LatexCommand[];
    removedDefaults: string[];
} {
    const builtIn = getBuiltInLatexCommands();
    const key = (c: LatexCommand) => c.displayName + "\n" + c.replacement;
    const defaults = new Set(builtIn.map(key));
    for (const old of CHANGED_V3_DEFAULTS.keys()) defaults.add(key({ displayName: old, replacement: old }));

    const present = new Set(commands.map((c) => c.displayName));
    for (const [old, renamed] of CHANGED_V3_DEFAULTS) if (present.has(old)) present.add(renamed);

    return {
        custom: commands.filter((c) => !defaults.has(key(c))),
        removedDefaults: builtIn.map((c) => c.displayName).filter((name) => !present.has(name)),
    };
}

export class LatexProvider implements SuggestionProvider {
    readonly id = "latex";
    readonly icon = "sigma";

    private readonly custom: CustomEntryFile;
    private builtInIndex: IndexedCommand[] = [];
    private customIndex: IndexedCommand[] = [];

    constructor(
        private readonly files: DataFiles,
        private readonly blacklist: SuggestionBlacklist,
    ) {
        this.custom = new CustomEntryFile(files, CUSTOM_LATEX_COMMANDS_FILE);
    }

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[] {
        if (!settings.latexProviderEnabled) return [];
        if (!context.manual && (!context.query || context.query.length < settings.latexMinWordTriggerLength)) return [];

        const pos = context.editor.posToOffset(context.end);
        const mathType = getLatexContext(context.state, pos, settings.latexTriggerInCodeBlocks);
        if (!mathType) return [];

        const ignoreCase = settings.latexIgnoreCase;
        const query = ignoreCase ? context.query.toLowerCase() : context.query;
        const stripBackslash = context.separatorChar === "\\";

        const matches: { cmd: IndexedCommand; index: number }[] = [];
        const collect = (commands: IndexedCommand[]) => {
            for (const cmd of commands) {
                const index = (ignoreCase ? cmd.lowerCaseName : cmd.suggestion.displayName).indexOf(query);
                if (index !== -1) matches.push({ cmd, index });
            }
        };
        collect(this.customIndex);
        if (settings.latexBuiltInCommands) collect(this.builtInIndex);

        // Matches closer to the start rank higher, then shorter names ("\vee" before "\curlyvee" for "vee").
        matches.sort((a, b) => a.index - b.index || a.cmd.nameLength - b.cmd.nameLength);

        return matches.map(({ cmd }) => {
            let replacement = cmd.suggestion.replacement;
            if (stripBackslash && replacement.startsWith("\\")) replacement = replacement.substring(1);
            if (mathType === "inline") replacement = replacement.replace(/\n/g, "");
            return { ...cmd.suggestion, replacement };
        });
    }

    getCustomCommands(): readonly LatexCommand[] {
        return this.custom.entries;
    }

    async setCustomCommands(commands: LatexCommand[]) {
        await this.custom.set(commands);
        this.rebuildIndex();
    }

    /**
     * Loads the user's commands. Returns an error message if the file is invalid.
     * @param migrateFromV3 the file is from an older version and contains all default commands.
     */
    async load(migrateFromV3: boolean): Promise<string | null> {
        const hadFile = await this.files.exists(CUSTOM_LATEX_COMMANDS_FILE);
        const error = await this.custom.load();
        if (migrateFromV3 && hadFile && !error) {
            const contents = (await this.files.read(CUSTOM_LATEX_COMMANDS_FILE)) ?? "[]";
            const { custom, removedDefaults } = migrateV3LatexCommands([...this.custom.entries]);
            await this.files.write(CUSTOM_LATEX_COMMANDS_FILE + ".v3.bak", contents);
            await this.blacklist.addAll(removedDefaults);
            await this.custom.set(custom);
        }

        this.rebuildIndex();
        return error;
    }

    rebuildIndex() {
        const index = (commands: readonly LatexCommand[]) =>
            commands
                .filter((c) => !this.blacklist.has(c.displayName))
                .map((c): IndexedCommand => ({
                    suggestion: suggestion(c.displayName, c.replacement, { isSnippet: true }),
                    lowerCaseName: c.displayName.toLowerCase(),
                    nameLength: c.displayName.split("{", 1)[0].length,
                }));
        this.builtInIndex = index(getBuiltInLatexCommands());
        this.customIndex = index([...this.custom.entries]);
    }
}
