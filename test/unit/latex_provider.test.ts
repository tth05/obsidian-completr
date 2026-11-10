import { describe, expect, test } from "bun:test";
import type { MathType } from "../../src/editor_context.ts";
import { SuggestionBlacklist } from "../../src/provider/blacklist.ts";
import { type CustomEntry, parseCustomEntries, serializeCustomEntries } from "../../src/provider/custom_suggestions.ts";
import {
    CUSTOM_LATEX_COMMANDS_FILE,
    getBuiltInLatexCommands,
    isV3LatexCommandsFile,
    LatexProvider,
    migrateV3LatexCommands,
    toPreviewTex,
} from "../../src/provider/latex_provider.ts";
import type { SuggestionContext } from "../../src/provider/provider.ts";
import type { CompletrSettings } from "../../src/settings.ts";
import v3Defaults from "./fixtures/latex_commands_v3.json";
import { makeContext, makeDataFiles, makeSettings, pluginPath } from "./helpers.ts";

/**
 * The latex_commands.json written by v3.2.0 on first load, i.e. the complete list of v3 defaults. Generated from
 * `generateDefaultLatexCommands` in src/provider/latex_provider.ts of v3.2.0 (commit cc54214).
 */
const V3_DEFAULTS: CustomEntry[] = v3Defaults;

const FILE = pluginPath(CUSTOM_LATEX_COMMANDS_FILE);
const V3_BACKUP = FILE + ".v3.bak";

const cmd = (displayName: string, replacement = displayName): CustomEntry => ({ displayName, replacement });

/** `count` commands nobody else has. */
const ownCommands = (count: number) => Array.from({ length: count }, (_, i) => cmd(`\\mycommand${i}{#}`));

function setup(contents?: string) {
    const { files, adapter } = makeDataFiles();
    if (contents !== undefined) adapter.files.set(FILE, contents);
    const blacklist = new SuggestionBlacklist(files);
    return { provider: new LatexProvider(files, blacklist), adapter, blacklist, files };
}

describe("getBuiltInLatexCommands", () => {
    const builtIn = getBuiltInLatexCommands();
    const names = builtIn.map((c) => c.displayName);
    const byName = new Map(builtIn.map((c) => [c.displayName, c.replacement]));

    test("display names are unique and never contain a newline", () => {
        expect(new Set(names).size).toBe(names.length);
        for (const name of names) expect(name).not.toContain("\n");
    });

    test("all commands start with a backslash", () => {
        for (const name of names) expect(name.startsWith("\\")).toBe(true);
    });

    test("environments without parameters put the cursor on an empty line", () => {
        expect(byName.get("\\begin{align}...")).toBe("\\begin{align}\n~\n\\end{align}");
        expect(byName.get("\\begin{pmatrix}...")).toBe("\\begin{pmatrix}\n~\n\\end{pmatrix}");
    });

    test("environments with parameters get placeholders", () => {
        expect(byName.get("\\begin{array}...")).toBe("\\begin{array}{#}\n\\end{array}");
        expect(byName.get("\\begin{empheq}...")).toBe("\\begin{empheq}{#}{#}\n\\end{empheq}");
    });

    test("starred variants exist exactly for environments that have one", () => {
        expect(byName.get("\\begin{align*}...")).toBe("\\begin{align*}\n~\n\\end{align*}");
        expect(byName.get("\\begin{alignat*}...")).toBe("\\begin{alignat*}{#}\n\\end{alignat*}");
        expect(byName.has("\\begin{aligned*}...")).toBe(false);
        expect(byName.has("\\begin{split*}...")).toBe(false);
    });

    test("the starred variant follows its environment", () => {
        expect(names.indexOf("\\begin{align*}...")).toBe(names.indexOf("\\begin{align}...") + 1);
    });

    test("common commands are included", () => {
        for (const name of ["\\alpha", "\\frac{#}{#}", "\\sqrt{#}", "\\left\\", "\\verb|#|"]) {
            expect(byName.get(name)).toBe(name);
        }
    });

    test("only environments have a display name that differs from the replacement", () => {
        for (const c of builtIn) {
            if (c.displayName !== c.replacement) expect(c.displayName).toMatch(/^\\begin\{[a-zA-Z]+\*?\}\.\.\.$/);
        }
    });

    test("integrals, products and sums have the subscript first (#76)", () => {
        for (const op of ["int", "prod", "sum"]) {
            expect(byName.has(`\\${op}_{#}^{#}`)).toBe(true);
            expect(byName.has(`\\${op}^{#}_{#}`)).toBe(false);
        }
    });

    test("returns a new array every time", () => {
        const a = getBuiltInLatexCommands();
        a.length = 0;
        expect(getBuiltInLatexCommands()).toHaveLength(builtIn.length);
    });
});

describe("isV3LatexCommandsFile", () => {
    const builtIn = getBuiltInLatexCommands();
    const OLD_FORMS = ["int", "prod", "sum"].map((op) => cmd(`\\${op}^{#}_{#}`));

    test("the file written by v3", () => {
        expect(isV3LatexCommandsFile(V3_DEFAULTS)).toBe(true);
    });

    test("the file written by v3, parsed from its JSON like when loading", () => {
        expect(isV3LatexCommandsFile(parseCustomEntries(JSON.stringify(V3_DEFAULTS)))).toBe(true);
        expect(isV3LatexCommandsFile(parseCustomEntries(serializeCustomEntries(V3_DEFAULTS)))).toBe(true);
    });

    test("a v3 file in a different order, with additions and deletions", () => {
        expect(isV3LatexCommandsFile([...V3_DEFAULTS].reverse())).toBe(true);
        expect(isV3LatexCommandsFile([cmd("\\mine"), ...V3_DEFAULTS, cmd("\\R", "\\mathbb{R}")])).toBe(true);
        expect(isV3LatexCommandsFile(V3_DEFAULTS.filter((_, i) => i % 2 === 0))).toBe(true);
    });

    test("an empty file", () => {
        expect(isV3LatexCommandsFile([])).toBe(false);
    });

    test("a handful of custom commands", () => {
        expect(
            isV3LatexCommandsFile([cmd("\\mine"), cmd("\\R", "\\mathbb{R}"), cmd("\\abs", "\\left|#\\right|")]),
        ).toBe(false);
    });

    test("a handful of commands that happen to be built-in ones", () => {
        expect(isV3LatexCommandsFile([cmd("\\alpha"), cmd("\\beta"), cmd("\\frac{#}{#}"), cmd("\\mine")])).toBe(false);
    });

    test("many custom commands, none of them built-in", () => {
        expect(isV3LatexCommandsFile(ownCommands(500))).toBe(false);
    });

    test("49 copies of built-in commands are not enough, 50 are", () => {
        expect(isV3LatexCommandsFile(builtIn.slice(0, 49))).toBe(false);
        expect(isV3LatexCommandsFile(builtIn.slice(0, 50))).toBe(true);
        // Not only the first ones (the environments) count
        expect(isV3LatexCommandsFile(builtIn.slice(-49))).toBe(false);
        expect(isV3LatexCommandsFile(builtIn.slice(-50))).toBe(true);
    });

    test("49 vs. 50 copies of built-in commands among many custom ones", () => {
        const own = ownCommands(200);
        expect(isV3LatexCommandsFile([...own.slice(0, 100), ...builtIn.slice(300, 349), ...own.slice(100)])).toBe(
            false,
        );
        expect(isV3LatexCommandsFile([...own.slice(0, 100), ...builtIn.slice(300, 350), ...own.slice(100)])).toBe(true);
    });

    test("built-in commands the user changed don't count", () => {
        const changed = builtIn.slice(0, 60).map((c) => cmd(c.displayName, c.replacement + " "));
        expect(isV3LatexCommandsFile(changed)).toBe(false);
        const renamed = builtIn.slice(0, 60).map((c) => cmd(c.displayName + " ", c.replacement));
        expect(isV3LatexCommandsFile(renamed)).toBe(false);
    });

    test("the v3 defaults that were changed in v4 count in their old form", () => {
        const others = builtIn.filter((c) => !/^\\(int|prod|sum)_/.test(c.displayName));
        expect(isV3LatexCommandsFile([...others.slice(0, 46), ...OLD_FORMS])).toBe(false);
        expect(isV3LatexCommandsFile([...others.slice(0, 47), ...OLD_FORMS])).toBe(true);
    });

    test("all built-in commands of v4", () => {
        expect(isV3LatexCommandsFile(builtIn)).toBe(true);
    });

    test("does not modify the commands", () => {
        const commands = Object.freeze(V3_DEFAULTS.map((c) => Object.freeze({ ...c })));
        expect(isV3LatexCommandsFile(commands)).toBe(true);
    });
});

describe("migrateV3LatexCommands", () => {
    test("the fixture is a complete v3 list", () => {
        expect(V3_DEFAULTS.length).toBeGreaterThan(1000);
        expect(V3_DEFAULTS.map((c) => c.displayName)).toContain("\\int^{#}_{#}");
    });

    test("an unmodified v3 list has no custom commands and no removed defaults", () => {
        expect(migrateV3LatexCommands(V3_DEFAULTS)).toEqual({ custom: [], removedDefaults: [] });
    });

    test("an unmodified v3 list in a different order", () => {
        expect(migrateV3LatexCommands([...V3_DEFAULTS].reverse())).toEqual({ custom: [], removedDefaults: [] });
    });

    test("user additions are kept, in order", () => {
        const additions = [cmd("\\mycommand{#}"), cmd("\\R", "\\mathbb{R}")];
        const commands = [additions[0], ...V3_DEFAULTS, additions[1]];
        expect(migrateV3LatexCommands(commands)).toEqual({ custom: additions, removedDefaults: [] });
    });

    test("deleted defaults are reported", () => {
        const deleted = new Set(["\\alpha", "\\begin{align*}...", "\\zeta"]);
        const { custom, removedDefaults } = migrateV3LatexCommands(
            V3_DEFAULTS.filter((c) => !deleted.has(c.displayName)),
        );
        expect(custom).toEqual([]);
        expect(removedDefaults.sort()).toEqual([...deleted].sort());
    });

    test("modified defaults are kept as custom commands and not reported as deleted", () => {
        const commands = V3_DEFAULTS.map((c) =>
            c.displayName === "\\begin{align}..." ? cmd(c.displayName, "\\begin{align}\n~\n\\end{align}\n") : c,
        );
        expect(migrateV3LatexCommands(commands)).toEqual({
            custom: [cmd("\\begin{align}...", "\\begin{align}\n~\n\\end{align}\n")],
            removedDefaults: [],
        });
    });

    test("the changed v3 defaults count as present for their new form", () => {
        const commands = [cmd("\\int^{#}_{#}"), cmd("\\prod^{#}_{#}"), cmd("\\sum^{#}_{#}")];
        const { custom, removedDefaults } = migrateV3LatexCommands(commands);
        expect(custom).toEqual([]);
        for (const op of ["int", "prod", "sum"]) expect(removedDefaults).not.toContain(`\\${op}_{#}^{#}`);
    });

    test("deleting a changed v3 default reports its new form as removed", () => {
        const { custom, removedDefaults } = migrateV3LatexCommands(
            V3_DEFAULTS.filter((c) => c.displayName !== "\\sum^{#}_{#}"),
        );
        expect(custom).toEqual([]);
        expect(removedDefaults).toEqual(["\\sum_{#}^{#}"]);
    });

    test("a list that already has the new forms is fine too", () => {
        const commands = getBuiltInLatexCommands();
        expect(migrateV3LatexCommands(commands)).toEqual({ custom: [], removedDefaults: [] });
    });

    test("an empty list reports every default as removed", () => {
        const { custom, removedDefaults } = migrateV3LatexCommands([]);
        expect(custom).toEqual([]);
        expect(removedDefaults).toEqual(getBuiltInLatexCommands().map((c) => c.displayName));
    });

    test("the result of a migration is not a v3 file any more", () => {
        const commands = [...V3_DEFAULTS.filter((c) => c.displayName !== "\\alpha"), ...ownCommands(80)];
        const { custom } = migrateV3LatexCommands(commands);
        expect(custom).toEqual(ownCommands(80));
        expect(isV3LatexCommandsFile(custom)).toBe(false);
    });
});

describe("toPreviewTex", () => {
    test("commands without placeholders are previewed as they are", () => {
        expect(toPreviewTex("\\alpha")).toBe("\\alpha");
        expect(toPreviewTex("\\mathbb{R}")).toBe("\\mathbb{R}");
    });

    test("placeholders become boxes", () => {
        expect(toPreviewTex("\\frac{#}{#}")).toBe("\\frac{\\square}{\\square}");
        expect(toPreviewTex("\\sum_{#}^{#}")).toBe("\\sum_{\\square}^{\\square}");
        expect(toPreviewTex("##")).toBe("\\square\\square");
    });

    test("the final cursor marker is removed", () => {
        expect(toPreviewTex("\\left(#\\right)~")).toBe("\\left(\\square\\right)");
        expect(toPreviewTex("a~b~")).toBe("ab");
    });

    test("multi-line commands have no preview", () => {
        expect(toPreviewTex("\\begin{align}\n~\n\\end{align}")).toBeNull();
        expect(toPreviewTex("a\nb")).toBeNull();
        expect(toPreviewTex("\n")).toBeNull();
    });

    test("empty text", () => {
        expect(toPreviewTex("")).toBe("");
    });
});

describe("LatexProvider.load", () => {
    test("id, icon and the kind of its custom entries", () => {
        const { provider } = setup();
        expect(provider.id).toBe("latex");
        expect(provider.icon).toBe("sigma");
        expect(provider.customEntries.fileName).toBe(CUSTOM_LATEX_COMMANDS_FILE);
        expect(provider.customEntries.path).toBe(FILE);
        expect(provider.customEntries.kind.noun).toEqual(["custom command", "custom commands"]);
        // The name of a command defaults to the command itself
        expect(provider.customEntries.kind.nameRequired).toBe(false);
    });

    test("creates an empty commands file if missing", async () => {
        const { provider, adapter } = setup();
        expect(await provider.load()).toBeNull();
        expect(adapter.files.get(FILE)).toBe("[]");
        expect(provider.customEntries.entries).toEqual([]);
    });

    test("a missing file is not migrated", async () => {
        const { provider, adapter, blacklist } = setup();
        expect(await provider.load()).toBeNull();
        expect(adapter.files.has(V3_BACKUP)).toBe(false);
        expect(blacklist.size).toBe(0);
    });

    test("loads custom commands", async () => {
        const { provider } = setup(JSON.stringify(["\\foo", { displayName: "\\R", replacement: "\\mathbb{R}" }]));
        expect(await provider.load()).toBeNull();
        expect(provider.customEntries.entries).toEqual([cmd("\\foo"), cmd("\\R", "\\mathbb{R}")]);
        expect(provider.customEntries.countLabel).toBe("2 custom commands");
    });

    test("an invalid file returns an error and is not overwritten", async () => {
        const { provider, adapter, blacklist } = setup("[broken");
        const error = await provider.load();
        expect(error).toContain(CUSTOM_LATEX_COMMANDS_FILE);
        expect(provider.customEntries.error).toBe(error);
        expect(provider.customEntries.entries).toEqual([]);
        expect(adapter.files.get(FILE)).toBe("[broken");
        expect(adapter.files.has(V3_BACKUP)).toBe(false);
        expect(blacklist.size).toBe(0);
    });

    describe("v3 file", () => {
        test("an unmodified v3 file is recognized by its content: empty file, a backup, nothing blacklisted", async () => {
            const contents = JSON.stringify(V3_DEFAULTS, null, 2);
            const { provider, adapter, blacklist } = setup(contents);
            expect(await provider.load()).toBeNull();
            expect(adapter.files.get(V3_BACKUP)).toBe(contents);
            expect(JSON.parse(adapter.files.get(FILE)!)).toEqual([]);
            expect(provider.customEntries.entries).toEqual([]);
            expect(blacklist.size).toBe(0);
        });

        test("a modified v3 file keeps additions and blacklists deleted defaults", async () => {
            const commands = [...V3_DEFAULTS.filter((c) => c.displayName !== "\\alpha"), cmd("\\mine")];
            const { provider, adapter, blacklist } = setup(JSON.stringify(commands));
            expect(await provider.load()).toBeNull();
            expect(provider.customEntries.entries).toEqual([cmd("\\mine")]);
            expect(JSON.parse(adapter.files.get(FILE)!)).toEqual(["\\mine"]);
            expect(blacklist.values()).toEqual(["\\alpha"]);
            expect(JSON.parse(adapter.files.get(V3_BACKUP)!)).toHaveLength(commands.length);
        });

        test("the blacklist is saved", async () => {
            const { provider, adapter, files } = setup(
                JSON.stringify(V3_DEFAULTS.filter((c) => c.displayName !== "\\alpha")),
            );
            await provider.load();
            const reloaded = new SuggestionBlacklist(files);
            await reloaded.load();
            expect(reloaded.values()).toEqual(["\\alpha"]);
            expect(adapter.files.has(pluginPath("blacklisted_suggestions.txt"))).toBe(true);
        });

        test("entries that were blacklisted before are kept", async () => {
            const { provider, blacklist } = setup(
                JSON.stringify(V3_DEFAULTS.filter((c) => c.displayName !== "\\alpha")),
            );
            await blacklist.add("word");
            await provider.load();
            expect(blacklist.values()).toEqual(["word", "\\alpha"]);
        });

        test("the migrated commands are the ones that are suggested", async () => {
            const { provider } = setup(JSON.stringify([...V3_DEFAULTS, cmd("\\mine", "\\mathcal{M}")]));
            await provider.load();
            const context = (query: string) => makeContext(query, { mathType: () => "block" });
            const mine = provider.getSuggestions(context("mine"), makeSettings());
            expect(mine).toHaveLength(1);
            expect(mine[0].customEntry).toBe(provider.customEntries.entries[0]);
            // The defaults are not custom commands any more, so they are only suggested once
            const alpha = provider.getSuggestions(context("alpha"), makeSettings());
            expect(alpha.map((s) => s.displayName)).toEqual(["\\alpha", "\\upalpha"]);
            expect(alpha.every((s) => s.customEntry === undefined)).toBe(true);
        });

        test("loading again after a migration does not migrate again", async () => {
            const commands = [...V3_DEFAULTS.filter((c) => c.displayName !== "\\alpha"), cmd("\\mine")];
            const contents = JSON.stringify(commands);
            const { provider, adapter, blacklist } = setup(contents);
            await provider.load();
            // The user wants \alpha back
            await blacklist.remove("\\alpha");
            adapter.writes.length = 0;

            expect(await provider.load()).toBeNull();
            expect(provider.customEntries.entries).toEqual([cmd("\\mine")]);
            expect(blacklist.size).toBe(0);
            expect(adapter.files.get(V3_BACKUP)).toBe(contents);
            expect(adapter.writes).toEqual([]);
        });

        test("a new provider does not migrate the migrated file again either", async () => {
            const contents = JSON.stringify([...V3_DEFAULTS, cmd("\\mine")]);
            const first = setup(contents);
            await first.provider.load();
            first.adapter.writes.length = 0;

            const { files } = makeDataFiles(first.adapter);
            const blacklist = new SuggestionBlacklist(files);
            const second = new LatexProvider(files, blacklist);
            expect(await second.load()).toBeNull();
            expect(second.customEntries.entries).toEqual([cmd("\\mine")]);
            expect(blacklist.size).toBe(0);
            expect(first.adapter.files.get(V3_BACKUP)).toBe(contents);
            expect(first.adapter.writes).toEqual([]);
        });

        test("a v3 file with many own commands is migrated once, the own commands stay", async () => {
            const own = ownCommands(120);
            const { provider, adapter } = setup(JSON.stringify([...V3_DEFAULTS, ...own]));
            await provider.load();
            expect(provider.customEntries.entries).toEqual(own);
            adapter.writes.length = 0;
            await provider.load();
            expect(provider.customEntries.entries).toEqual(own);
            expect(adapter.writes).toEqual([]);
        });
    });

    describe("v4 file", () => {
        test("is used as is, also if it contains a few built-in commands", async () => {
            const { provider, adapter, blacklist } = setup(JSON.stringify(["\\alpha", "\\mine"]));
            expect(await provider.load()).toBeNull();
            expect(provider.customEntries.entries).toEqual([cmd("\\alpha"), cmd("\\mine")]);
            expect(adapter.writes).toEqual([]);
            expect(blacklist.size).toBe(0);
        });

        test("with many own commands is not migrated", async () => {
            const own = ownCommands(300);
            const { provider, adapter, blacklist } = setup(serializeCustomEntries(own));
            expect(await provider.load()).toBeNull();
            expect(provider.customEntries.entries).toEqual(own);
            expect(adapter.writes).toEqual([]);
            expect(adapter.files.has(V3_BACKUP)).toBe(false);
            expect(blacklist.size).toBe(0);
        });

        test("with 49 copies of built-in commands is not migrated, with 50 it is", async () => {
            const builtIn = getBuiltInLatexCommands();
            const v4 = setup(serializeCustomEntries([...builtIn.slice(100, 149), cmd("\\mine")]));
            await v4.provider.load();
            expect(v4.provider.customEntries.entries).toHaveLength(50);
            expect(v4.adapter.writes).toEqual([]);
            expect(v4.blacklist.size).toBe(0);

            const v3 = setup(serializeCustomEntries([...builtIn.slice(100, 150), cmd("\\mine")]));
            await v3.provider.load();
            expect(v3.provider.customEntries.entries).toEqual([cmd("\\mine")]);
            expect(v3.adapter.files.has(V3_BACKUP)).toBe(true);
            expect(v3.blacklist.size).toBe(builtIn.length - 50);
        });
    });

    test("customEntries.set saves the commands", async () => {
        const { provider, adapter } = setup();
        await provider.load();
        await provider.customEntries.set([cmd("\\a"), cmd("\\b", "\\beta")]);
        expect(JSON.parse(adapter.files.get(FILE)!)).toEqual(["\\a", { displayName: "\\b", replacement: "\\beta" }]);
        expect(provider.customEntries.entries).toEqual([cmd("\\a"), cmd("\\b", "\\beta")]);
    });
});

describe("LatexProvider.getSuggestions", () => {
    const BUILT_IN_COUNT = getBuiltInLatexCommands().length;

    async function loaded(...custom: CustomEntry[]) {
        const result = setup(serializeCustomEntries(custom));
        await result.provider.load();
        return result;
    }

    /** A context inside math, after a backslash: `$\<query>`. */
    const inMath = (query: string, overrides: Partial<SuggestionContext> = {}) =>
        makeContext(query, { separatorChar: "\\", mathType: () => "inline", ...overrides });

    async function suggest(
        query: string,
        settings: Partial<CompletrSettings> = {},
        overrides: Partial<SuggestionContext> = {},
        custom: CustomEntry[] = [],
    ) {
        const { provider } = await loaded(...custom);
        return provider.getSuggestions(inMath(query, overrides), makeSettings(settings));
    }

    const names = async (...args: Parameters<typeof suggest>) => (await suggest(...args)).map((s) => s.displayName);

    describe("where", () => {
        test("nothing outside of math", async () => {
            expect(await names("alpha", {}, { mathType: () => null })).toEqual([]);
            expect(await names("alpha", {}, { mathType: () => null, manual: true })).toEqual([]);
        });

        test("inside inline and block math", async () => {
            expect(await names("alpha", {}, { mathType: () => "inline" })).toEqual(["\\alpha", "\\upalpha"]);
            expect(await names("alpha", {}, { mathType: () => "block" })).toEqual(["\\alpha", "\\upalpha"]);
        });

        test.each([true, false])("asks the context with latexTriggerInCodeBlocks = %p", async (triggerInCode) => {
            const asked: boolean[] = [];
            const mathType = (inCode: boolean): MathType | null => {
                asked.push(inCode);
                return null;
            };
            await suggest("alpha", { latexTriggerInCodeBlocks: triggerInCode }, { mathType });
            expect(asked).toEqual([triggerInCode]);
        });

        test("the code flag of the context is not looked at, only its math type", async () => {
            expect(await names("alpha", {}, { inCode: true, mathType: () => "inline" })).toHaveLength(2);
            expect(await names("alpha", {}, { inCode: true, mathType: () => null })).toEqual([]);
        });

        test("disabled provider", async () => {
            let asked = false;
            const mathType = (): MathType => {
                asked = true;
                return "inline";
            };
            expect(await names("alpha", { latexProviderEnabled: false }, { mathType })).toEqual([]);
            expect(await names("alpha", { latexProviderEnabled: false }, { mathType, manual: true })).toEqual([]);
            expect(asked).toBe(false);
        });
    });

    describe("trigger length", () => {
        test("queries shorter than latexMinWordTriggerLength are ignored", async () => {
            expect(await names("al", { latexMinWordTriggerLength: 3 })).toEqual([]);
            expect(await names("alp", { latexMinWordTriggerLength: 3 })).not.toEqual([]);
            expect(await names("a", { latexMinWordTriggerLength: 1 })).not.toEqual([]);
        });

        test("an empty query never triggers automatically", async () => {
            expect(await names("", { latexMinWordTriggerLength: 0 })).toEqual([]);
        });

        test("a manual trigger ignores the minimum length", async () => {
            expect(await names("al", { latexMinWordTriggerLength: 5 }, { manual: true })).toContain("\\alpha");
        });

        test("a manual trigger with an empty query lists all commands", async () => {
            const result = await names("", {}, { manual: true }, [cmd("\\mine")]);
            expect(result).toHaveLength(BUILT_IN_COUNT + 1);
            expect(result).toContain("\\mine");
        });
    });

    describe("matching and order", () => {
        test("matches anywhere in the name: closest to the start first, then the shortest name", async () => {
            expect(await names("vee")).toEqual(["\\vee", "\\veebar", "\\bigvee", "\\curlyvee"]);
        });

        test("the length of a name is counted up to its first brace", async () => {
            expect(await names("frac")).toEqual([
                "\\frac{#}{#}",
                "\\cfrac{#}{#}",
                "\\dfrac{#}{#}",
                "\\tfrac{#}{#}",
                "\\textfractionsolidus",
                "\\splitfrac{#}{#}",
                "\\splitdfrac{#}{#}",
            ]);
            expect(await names("sum")).toEqual(["\\sum", "\\sum_{#}^{#}"]);
        });

        test("the query may contain non-word characters of the name", async () => {
            expect(await names("begin{align")).toEqual([
                "\\begin{align}...",
                "\\begin{align*}...",
                "\\begin{alignat}...",
                "\\begin{alignat*}...",
                "\\begin{aligned}...",
                "\\begin{alignedat}...",
            ]);
        });

        test("no match", async () => {
            expect(await names("notacommand")).toEqual([]);
        });

        test("is case sensitive by default", async () => {
            expect(await names("Delta")).toEqual(["\\Delta", "\\varDelta"]);
            expect(await names("delta")).toEqual(["\\delta", "\\updelta", "\\Updelta"]);
            expect(await names("DELTA")).toEqual([]);
        });

        test("latexIgnoreCase ignores the case of query and name", async () => {
            const expected = ["\\Delta", "\\delta", "\\varDelta", "\\updelta", "\\Updelta"].sort();
            expect((await names("Delta", { latexIgnoreCase: true })).sort()).toEqual(expected);
            expect((await names("delta", { latexIgnoreCase: true })).sort()).toEqual(expected);
            expect((await names("DELTA", { latexIgnoreCase: true })).sort()).toEqual(expected);
        });

        test("custom commands are matched like built-in ones and come first among equals", async () => {
            const custom = [cmd("\\veebaz"), cmd("\\myvee"), cmd("\\vee2", "\\vee_2")];
            expect(await names("vee", {}, {}, custom)).toEqual([
                "\\vee",
                "\\vee2",
                // Same position and length: the custom command first
                "\\veebaz",
                "\\veebar",
                "\\myvee",
                "\\bigvee",
                "\\curlyvee",
            ]);
        });

        test("without the built-in commands only custom ones are suggested", async () => {
            const custom = [cmd("\\myalpha", "\\alpha_m")];
            expect(await names("alpha", { latexBuiltInCommands: false }, {}, custom)).toEqual(["\\myalpha"]);
            expect(await names("alpha", { latexBuiltInCommands: false })).toEqual([]);
            expect(await names("", { latexBuiltInCommands: false }, { manual: true }, custom)).toEqual(["\\myalpha"]);
        });

        test("a custom command with the name of a built-in one is suggested in addition to it", async () => {
            const result = await suggest("alpha", {}, {}, [cmd("\\alpha", "\\alpha_0")]);
            expect(result.map((s) => [s.displayName, s.replacement])).toEqual([
                ["\\alpha", "alpha_0"],
                ["\\alpha", "alpha"],
                ["\\upalpha", "upalpha"],
            ]);
        });
    });

    describe("replacement", () => {
        test("the backslash is dropped if one is typed in front of the query", async () => {
            const [s] = await suggest("alpha", {}, { separatorChar: "\\" });
            expect(s).toMatchObject({ displayName: "\\alpha", replacement: "alpha" });
        });

        test.each([null, " ", "$", "{"])("the backslash is kept after the separator %p", async (separatorChar) => {
            const [s] = await suggest("alpha", {}, { separatorChar });
            expect(s).toMatchObject({ displayName: "\\alpha", replacement: "\\alpha" });
        });

        test("only a leading backslash is dropped", async () => {
            const [s] = await suggest("left", {}, { separatorChar: "\\" });
            expect(s).toMatchObject({ displayName: "\\left\\", replacement: "left\\" });
            const [custom] = await suggest("abs", { latexBuiltInCommands: false }, { separatorChar: "\\" }, [
                cmd("abs", "|#|"),
            ]);
            expect(custom.replacement).toBe("|#|");
        });

        test("inline math gets the replacement without line breaks", async () => {
            const [s] = await suggest("begin{align}", {}, { mathType: () => "inline" });
            expect(s).toMatchObject({ displayName: "\\begin{align}...", replacement: "begin{align}~\\end{align}" });
        });

        test("block math keeps the line breaks", async () => {
            const [s] = await suggest("begin{align}", {}, { mathType: () => "block" });
            expect(s).toMatchObject({
                displayName: "\\begin{align}...",
                replacement: "begin{align}\n~\n\\end{align}",
            });
        });

        test("placeholders are kept for the snippet engine", async () => {
            const [s] = await suggest("frac");
            expect(s.replacement).toBe("frac{#}{#}");
        });
    });

    describe("suggestion details", () => {
        test("a built-in command", async () => {
            expect((await suggest("alpha"))[0]).toEqual({
                displayName: "\\alpha",
                replacement: "alpha",
                snippet: "latex",
                previewTex: "\\alpha",
                customEntry: undefined,
            });
        });

        test("all suggestions are LaTeX snippets", async () => {
            const result = await suggest("", {}, { manual: true }, [cmd("\\mine"), cmd("\\R", "\\mathbb{R}")]);
            expect(result).toHaveLength(BUILT_IN_COUNT + 2);
            for (const s of result) expect(s.snippet).toBe("latex");
        });

        test("built-in commands are previewed as themselves, with boxes for placeholders", async () => {
            const result = await suggest("frac");
            expect(result[0]).toMatchObject({ displayName: "\\frac{#}{#}", previewTex: "\\frac{\\square}{\\square}" });
            expect((await suggest("alpha"))[0].previewTex).toBe("\\alpha");
        });

        test("the preview is the whole command, whatever is inserted", async () => {
            for (const separatorChar of ["\\", " "]) {
                for (const type of ["inline", "block"] as const) {
                    const [s] = await suggest("sqrt", {}, { separatorChar, mathType: () => type });
                    expect(s.previewTex).toBe("\\sqrt{\\square}");
                }
            }
        });

        test("built-in environments have no preview", async () => {
            const result = await suggest("begin{", {}, { mathType: () => "block" });
            expect(result.length).toBeGreaterThan(50);
            for (const s of result) expect(s.previewTex).toBeUndefined();
        });

        test("every other built-in command has a single-line preview", async () => {
            const result = await suggest("", {}, { manual: true });
            for (const s of result) {
                if (s.displayName.startsWith("\\begin{")) continue;
                expect(s.previewTex).toBeString();
                expect(s.previewTex).not.toContain("\n");
                expect(s.previewTex).not.toContain("#");
            }
        });

        test("built-in commands are not custom entries", async () => {
            const result = await suggest("", {}, { manual: true });
            for (const s of result) expect(s.customEntry).toBeUndefined();
        });

        test("custom commands preview their replacement, not their name", async () => {
            const custom = [cmd("\\R", "\\mathbb{R}"), cmd("reals", "\\mathbb{R}^{#}~"), cmd("\\mine")];
            const result = await suggest("", { latexBuiltInCommands: false }, { manual: true }, custom);
            expect(result.map((s) => [s.displayName, s.previewTex])).toEqual([
                ["\\R", "\\mathbb{R}"],
                ["reals", "\\mathbb{R}^{\\square}"],
                ["\\mine", "\\mine"],
            ]);
        });

        test("multi-line custom commands have no preview", async () => {
            const custom = [cmd("cases2", "\\begin{cases}\n# & #\\\\\n# & #\n\\end{cases}")];
            for (const type of ["inline", "block"] as const) {
                const [s] = await suggest("cases2", {}, { mathType: () => type }, custom);
                expect(s.displayName).toBe("cases2");
                expect(s.previewTex).toBeUndefined();
            }
        });

        test("custom commands carry their entry", async () => {
            const { provider } = await loaded(cmd("\\R", "\\mathbb{R}"), cmd("\\mine"));
            const result = provider.getSuggestions(inMath("", { manual: true }), makeSettings());
            const custom = result.filter((s) => s.customEntry);
            expect(custom).toHaveLength(2);
            const [r, mine] = provider.customEntries.entries;
            expect(custom.find((s) => s.displayName === "\\R")!.customEntry).toBe(r);
            expect(custom.find((s) => s.displayName === "\\mine")!.customEntry).toBe(mine);
        });

        test("the entry has the stored replacement, not the inserted one", async () => {
            const entry = cmd("\\env", "\\begin{x}\n~\n\\end{x}");
            const [s] = await suggest("env", {}, { mathType: () => "inline" }, [entry]);
            expect(s.replacement).toBe("begin{x}~\\end{x}");
            expect(s.customEntry).toEqual(entry);
        });

        test("suggestions are fresh objects, changing them does not change later results", async () => {
            const { provider } = await loaded(cmd("\\mine"));
            const first = provider.getSuggestions(inMath("mine"), makeSettings());
            expect(first).toHaveLength(1);
            first[0].displayName = "changed";
            first[0].replacement = "changed";
            first[0].provider = provider;
            expect(provider.getSuggestions(inMath("mine"), makeSettings())).toEqual([
                {
                    displayName: "\\mine",
                    replacement: "mine",
                    snippet: "latex",
                    previewTex: "\\mine",
                    customEntry: cmd("\\mine"),
                },
            ]);
        });
    });

    describe("blacklist", () => {
        test("blacklisted built-in commands are still returned, hiding them is the popup's job", async () => {
            const { provider, blacklist } = await loaded();
            await blacklist.addAll(["\\alpha", "\\upalpha"]);
            const result = provider.getSuggestions(inMath("alpha"), makeSettings());
            expect(result.map((s) => s.displayName)).toEqual(["\\alpha", "\\upalpha"]);
        });

        test("blacklisted custom commands are still returned as well", async () => {
            const { provider, blacklist } = await loaded(cmd("\\mine"));
            await blacklist.add("\\mine");
            const result = provider.getSuggestions(inMath("mine"), makeSettings());
            expect(result.map((s) => s.displayName)).toEqual(["\\mine"]);
        });

        test("defaults that a v3 user had deleted are blacklisted, but still returned", async () => {
            const { provider, blacklist } = setup(
                JSON.stringify(V3_DEFAULTS.filter((c) => c.displayName !== "\\alpha")),
            );
            await provider.load();
            expect(blacklist.has("\\alpha")).toBe(true);
            const result = provider.getSuggestions(inMath("alpha"), makeSettings());
            expect(result.map((s) => s.displayName)).toEqual(["\\alpha", "\\upalpha"]);
        });
    });

    describe("changes to the custom commands", () => {
        test("nothing custom is suggested before loading", () => {
            const { provider } = setup(JSON.stringify(["\\mine"]));
            expect(provider.getSuggestions(inMath("mine"), makeSettings())).toEqual([]);
            expect(provider.getSuggestions(inMath("alpha"), makeSettings())).toHaveLength(2);
        });

        test("added, replaced and removed commands are used right away", async () => {
            const { provider } = await loaded();
            const find = () => provider.getSuggestions(inMath("mine"), makeSettings()).map((s) => s.replacement);
            expect(find()).toEqual([]);

            await provider.customEntries.add(cmd("\\mine", "\\mathcal{M}"));
            expect(find()).toEqual(["mathcal{M}"]);

            await provider.customEntries.replace(provider.customEntries.entries[0], cmd("\\mine", "\\mathfrak{M}"));
            expect(find()).toEqual(["mathfrak{M}"]);

            await provider.customEntries.remove(provider.customEntries.entries[0]);
            expect(find()).toEqual([]);
        });

        test("reloading picks up changes of the file", async () => {
            const { provider, adapter } = await loaded(cmd("\\old"));
            adapter.files.set(FILE, JSON.stringify(["\\new"]));
            await provider.load();
            const all = provider.getSuggestions(
                inMath("", { manual: true }),
                makeSettings({ latexBuiltInCommands: false }),
            );
            expect(all.map((s) => s.displayName)).toEqual(["\\new"]);
        });

        test("a file that became invalid leaves only the built-in commands", async () => {
            const { provider, adapter } = await loaded(cmd("\\mine"));
            adapter.files.set(FILE, "[broken");
            expect(await provider.load()).not.toBeNull();
            expect(provider.getSuggestions(inMath("mine"), makeSettings())).toEqual([]);
            expect(provider.getSuggestions(inMath("alpha"), makeSettings())).toHaveLength(2);
        });
    });
});
