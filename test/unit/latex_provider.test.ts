import { describe, expect, test } from "bun:test";
import { SuggestionBlacklist } from "../../src/provider/blacklist.ts";
import {
    CUSTOM_LATEX_COMMANDS_FILE,
    getBuiltInLatexCommands,
    type LatexCommand,
    LatexProvider,
    migrateV3LatexCommands,
    parseLatexCommands,
    serializeLatexCommands,
} from "../../src/provider/latex_provider.ts";
import v3Defaults from "./fixtures/latex_commands_v3.json";
import { makeDataFiles, pluginPath } from "./helpers.ts";

/**
 * The latex_commands.json written by v3.2.0 on first load, i.e. the complete list of v3 defaults. Generated from
 * `generateDefaultLatexCommands` in src/provider/latex_provider.ts of v3.2.0 (commit cc54214).
 */
const V3_DEFAULTS: LatexCommand[] = v3Defaults;

const cmd = (displayName: string, replacement = displayName): LatexCommand => ({ displayName, replacement });

describe("parseLatexCommands", () => {
    test("strings are commands with the same display name and replacement", () => {
        expect(parseLatexCommands('["\\\\alpha", "\\\\frac{#}{#}"]')).toEqual([cmd("\\alpha"), cmd("\\frac{#}{#}")]);
    });

    test("objects with display name and replacement", () => {
        const json = JSON.stringify([{ displayName: "\\begin{x}...", replacement: "\\begin{x}\n~\n\\end{x}" }]);
        expect(parseLatexCommands(json)).toEqual([cmd("\\begin{x}...", "\\begin{x}\n~\n\\end{x}")]);
    });

    test("extra properties are dropped", () => {
        const json = JSON.stringify([{ displayName: "a", replacement: "b", icon: "x", color: "red" }]);
        expect(parseLatexCommands(json)).toEqual([cmd("a", "b")]);
    });

    test("mixed entries and the empty list", () => {
        expect(parseLatexCommands(JSON.stringify(["a", { displayName: "b", replacement: "c" }]))).toEqual([
            cmd("a"),
            cmd("b", "c"),
        ]);
        expect(parseLatexCommands("[]")).toEqual([]);
    });

    test("invalid JSON throws", () => {
        expect(() => parseLatexCommands('["a",')).toThrow();
        expect(() => parseLatexCommands("")).toThrow();
    });

    test("the root must be an array", () => {
        expect(() => parseLatexCommands('{"a": 1}')).toThrow("array");
        expect(() => parseLatexCommands('"\\\\alpha"')).toThrow("array");
        expect(() => parseLatexCommands("null")).toThrow("array");
    });

    test.each([
        ["a number", [1]],
        ["null", [null]],
        ["a missing replacement", [{ displayName: "a" }]],
        ["a missing display name", [{ replacement: "a" }]],
        ["a non-string replacement", [{ displayName: "a", replacement: 1 }]],
        ["an array", [["a", "b"]]],
    ])("rejects %s, naming the index", (_, entries) => {
        expect(() => parseLatexCommands(JSON.stringify(["ok", ...entries]))).toThrow("index 1");
    });

    test("display names must not contain a newline", () => {
        const json = JSON.stringify([{ displayName: "a\nb", replacement: "x" }]);
        expect(() => parseLatexCommands(json)).toThrow("newline");
    });

    test("string entries must not contain a newline either", () => {
        expect(() => parseLatexCommands(JSON.stringify(["a\nb"]))).toThrow("newline");
    });

    test("newlines in the replacement are fine", () => {
        expect(parseLatexCommands(JSON.stringify([{ displayName: "a", replacement: "x\ny" }]))).toEqual([
            cmd("a", "x\ny"),
        ]);
    });
});

describe("serializeLatexCommands", () => {
    test("commands with equal display name and replacement are written as strings", () => {
        const json = serializeLatexCommands([cmd("\\alpha"), cmd("a", "b")]);
        expect(JSON.parse(json)).toEqual(["\\alpha", { displayName: "a", replacement: "b" }]);
    });

    test("is pretty printed", () => {
        expect(serializeLatexCommands([cmd("a")])).toBe('[\n  "a"\n]');
        expect(serializeLatexCommands([])).toBe("[]");
    });

    test("round trip", () => {
        const commands = [cmd("\\alpha"), cmd("\\begin{x}...", "\\begin{x}\n~\n\\end{x}"), cmd('"quoted"', "\\\\")];
        expect(parseLatexCommands(serializeLatexCommands(commands))).toEqual(commands);
        expect(parseLatexCommands(serializeLatexCommands(V3_DEFAULTS))).toEqual(V3_DEFAULTS);
    });
});

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
});

describe("LatexProvider.load", () => {
    const FILE = pluginPath(CUSTOM_LATEX_COMMANDS_FILE);

    function setup(contents?: string) {
        const { files, adapter } = makeDataFiles();
        if (contents !== undefined) adapter.files.set(FILE, contents);
        const blacklist = new SuggestionBlacklist(files);
        return { provider: new LatexProvider(files, blacklist), adapter, blacklist };
    }

    test("creates an empty commands file if missing", async () => {
        const { provider, adapter } = setup();
        expect(await provider.load(false)).toBeNull();
        expect(adapter.files.get(FILE)).toBe("[]");
        expect(provider.getCustomCommands()).toEqual([]);
    });

    test("a missing file is not migrated", async () => {
        const { provider, adapter, blacklist } = setup();
        expect(await provider.load(true)).toBeNull();
        expect(adapter.files.has(FILE + ".v3.bak")).toBe(false);
        expect(blacklist.size).toBe(0);
    });

    test("loads custom commands", async () => {
        const { provider } = setup(JSON.stringify(["\\foo", { displayName: "\\R", replacement: "\\mathbb{R}" }]));
        expect(await provider.load(false)).toBeNull();
        expect(provider.getCustomCommands()).toEqual([cmd("\\foo"), cmd("\\R", "\\mathbb{R}")]);
    });

    test("an invalid file returns an error and is not overwritten", async () => {
        const { provider, adapter } = setup("[broken");
        const error = await provider.load(true);
        expect(error).toContain(CUSTOM_LATEX_COMMANDS_FILE);
        expect(provider.getCustomCommands()).toEqual([]);
        expect(adapter.files.get(FILE)).toBe("[broken");
        expect(adapter.files.has(FILE + ".v3.bak")).toBe(false);
    });

    test("migrating an unmodified v3 file leaves an empty file, a backup and nothing blacklisted", async () => {
        const contents = JSON.stringify(V3_DEFAULTS, null, 2);
        const { provider, adapter, blacklist } = setup(contents);
        expect(await provider.load(true)).toBeNull();
        expect(adapter.files.get(FILE + ".v3.bak")).toBe(contents);
        expect(JSON.parse(adapter.files.get(FILE)!)).toEqual([]);
        expect(provider.getCustomCommands()).toEqual([]);
        expect(blacklist.size).toBe(0);
    });

    test("migrating a modified v3 file keeps additions and blacklists deleted defaults", async () => {
        const commands = [...V3_DEFAULTS.filter((c) => c.displayName !== "\\alpha"), cmd("\\mine")];
        const { provider, adapter, blacklist } = setup(JSON.stringify(commands));
        expect(await provider.load(true)).toBeNull();
        expect(provider.getCustomCommands()).toEqual([cmd("\\mine")]);
        expect(JSON.parse(adapter.files.get(FILE)!)).toEqual(["\\mine"]);
        expect(blacklist.values()).toEqual(["\\alpha"]);
    });

    test("without migration the file is used as is", async () => {
        const { provider, adapter } = setup(JSON.stringify(["\\alpha", "\\mine"]));
        await provider.load(false);
        expect(provider.getCustomCommands()).toEqual([cmd("\\alpha"), cmd("\\mine")]);
        expect(adapter.writes).toEqual([]);
    });

    test("setCustomCommands saves the commands", async () => {
        const { provider, adapter } = setup();
        await provider.load(false);
        await provider.setCustomCommands([cmd("\\a"), cmd("\\b", "\\beta")]);
        expect(JSON.parse(adapter.files.get(FILE)!)).toEqual(["\\a", { displayName: "\\b", replacement: "\\beta" }]);
        expect(provider.getCustomCommands()).toEqual([cmd("\\a"), cmd("\\b", "\\beta")]);
    });
});
