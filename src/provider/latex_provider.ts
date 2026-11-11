import type { DataFiles } from "../data_files.ts";
import type { CompletrSettings } from "../settings.ts";
import type { SuggestionBlacklist } from "./blacklist.ts";
import { type CustomEntry, CustomEntryFile } from "./custom_suggestions.ts";
import { DEFAULT_LATEX_COMMANDS, DEFAULT_LATEX_ENVIRONMENTS } from "./latex_commands.ts";
import type { Suggestion, SuggestionContext, SuggestionProvider } from "./provider.ts";

export const CUSTOM_LATEX_COMMANDS_FILE = "latex_commands.json";

/** A commands file with at least this many built-in commands in it was written by v3, which stored all of them. */
const V3_FILE_MIN_BUILT_INS = 50;

interface IndexedCommand {
    suggestion: Suggestion;
    lowerCaseName: string;
    /** Length of the name up to the first "{", used for ranking ("\vee" before "\veebar"). */
    nameLength: number;
}

function environmentCommands(): CustomEntry[] {
    const result: CustomEntry[] = [];
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

export function getBuiltInLatexCommands(): CustomEntry[] {
    return [...environmentCommands(), ...DEFAULT_LATEX_COMMANDS.map((c) => ({ displayName: c, replacement: c }))];
}

/** Defaults of v3 that were changed in v4 (old -> new). Needed to recognize unmodified v3 command files. */
const CHANGED_V3_DEFAULTS = new Map(
    ["int", "prod", "sum"].map((op) => [`\\${op}^{#}_{#}`, `\\${op}_{#}^{#}`] as const),
);

const commandKey = (c: CustomEntry) => c.displayName + "\n" + c.replacement;

/** The commands v3 wrote into a new commands file, as keys. */
function v3DefaultKeys(builtIn: CustomEntry[]): Set<string> {
    const keys = new Set(builtIn.map(commandKey));
    for (const old of CHANGED_V3_DEFAULTS.keys()) keys.add(commandKey({ displayName: old, replacement: old }));
    return keys;
}

/**
 * Up to v3, the commands file contained all default commands, since v4 only the user's own. Tells them apart by their
 * content: nobody adds dozens of commands that are identical to built-in ones.
 */
export function isV3LatexCommandsFile(commands: readonly CustomEntry[]): boolean {
    if (commands.length < V3_FILE_MIN_BUILT_INS) return false;
    const defaults = v3DefaultKeys(getBuiltInLatexCommands());
    let count = 0;
    for (const c of commands) if (defaults.has(commandKey(c)) && ++count >= V3_FILE_MIN_BUILT_INS) return true;
    return false;
}

/** Splits a v3 commands file into the user's own commands and the default commands the user deleted. */
export function migrateV3LatexCommands(commands: readonly CustomEntry[]): {
    custom: CustomEntry[];
    removedDefaults: string[];
} {
    const builtIn = getBuiltInLatexCommands();
    const defaults = v3DefaultKeys(builtIn);

    const present = new Set(commands.map((c) => c.displayName));
    for (const [old, renamed] of CHANGED_V3_DEFAULTS) if (present.has(old)) present.add(renamed);

    return {
        custom: commands.filter((c) => !defaults.has(commandKey(c))),
        removedDefaults: builtIn.map((c) => c.displayName).filter((name) => !present.has(name)),
    };
}

/** The TeX source that shows what a command looks like, null if it can't be shown in one line. */
export function toPreviewTex(tex: string): string | null {
    if (tex.includes("\n")) return null;
    // Placeholders become boxes, like in a template
    return tex.replaceAll("#", "\\square").replaceAll("~", "");
}

function indexCommands(commands: readonly CustomEntry[], custom: boolean): IndexedCommand[] {
    return commands.map((c): IndexedCommand => {
        // Built-in names are the command itself. Custom names can be anything, so their replacement is previewed.
        const previewTex =
            (custom || c.displayName === c.replacement ? toPreviewTex(c.replacement) : null) ?? undefined;
        return {
            suggestion: {
                displayName: c.displayName,
                replacement: c.replacement,
                snippet: "latex",
                previewTex,
                customEntry: custom ? c : undefined,
            },
            lowerCaseName: c.displayName.toLowerCase(),
            nameLength: c.displayName.split("{", 1)[0].length,
        };
    });
}

export class LatexProvider implements SuggestionProvider {
    readonly id = "latex";
    readonly icon = "sigma";
    readonly customEntries: CustomEntryFile;

    private readonly builtInIndex = indexCommands(getBuiltInLatexCommands(), false);
    private customIndex: IndexedCommand[] = [];

    constructor(
        private readonly files: DataFiles,
        private readonly blacklist: SuggestionBlacklist,
    ) {
        this.customEntries = new CustomEntryFile(
            files,
            CUSTOM_LATEX_COMMANDS_FILE,
            {
                title: "Custom LaTeX commands",
                noun: ["custom command", "custom commands"],
                description: "Your own suggestions inside math blocks.",
                addTitle: "Add LaTeX command",
                editTitle: "Edit LaTeX command",
                namePlaceholder: "\\frac{#}{#}",
                replacementPlaceholder: "\\frac{#}{#}",
                syntaxHelp:
                    "The inserted text. # marks a placeholder (jump to the next one with Enter), ~ the final cursor position. May span multiple lines.",
                nameRequired: false,
            },
            () => (this.customIndex = indexCommands(this.customEntries.entries, true)),
        );
    }

    getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[] {
        if (!settings.latexProviderEnabled) return [];
        if (!context.manual && (!context.query || context.query.length < settings.latexMinWordTriggerLength)) return [];

        const mathType = context.mathType(settings.latexTriggerInCodeBlocks);
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

    /**
     * Loads the user's commands, returns an error message if the file is invalid. A file written by v3 is migrated:
     * it is backed up, reduced to the user's own commands, and the defaults the user had deleted are blacklisted.
     */
    async load(): Promise<string | null> {
        const error = await this.customEntries.load();
        const commands = this.customEntries.entries;
        if (!error && isV3LatexCommandsFile(commands)) {
            const contents = await this.files.read(CUSTOM_LATEX_COMMANDS_FILE);
            if (contents !== null) await this.files.write(CUSTOM_LATEX_COMMANDS_FILE + ".v3.bak", contents);
            const { custom, removedDefaults } = migrateV3LatexCommands(commands);
            await this.blacklist.addAll(removedDefaults);
            await this.customEntries.set(custom);
        }
        return error;
    }
}
