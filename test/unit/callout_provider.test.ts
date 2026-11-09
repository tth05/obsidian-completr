import { describe, expect, test } from "bun:test";
import type { Editor, Plugin } from "obsidian";
import { SuggestionBlacklist } from "../../src/provider/blacklist.ts";
import {
    CALLOUT_SUGGESTIONS_FILE,
    CalloutProvider,
    defaultCallouts,
    parseCalloutSuggestions,
} from "../../src/provider/callout_provider.ts";
import { makeContext, makeDataFiles, makeSettings, pluginPath } from "./helpers.ts";

const FILE = pluginPath(CALLOUT_SUGGESTIONS_FILE);

describe("parseCalloutSuggestions", () => {
    test("strings and objects", () => {
        const json = JSON.stringify([
            "custom",
            { displayName: "My Note", replacement: "my-note", icon: "lucide-pencil", color: "#123456" },
        ]);
        expect(parseCalloutSuggestions(json)).toEqual([
            { displayName: "custom", replacement: "custom" },
            { displayName: "My Note", replacement: "my-note", icon: "lucide-pencil", color: "#123456" },
        ]);
    });

    test("icon and color are optional and must be strings", () => {
        const json = JSON.stringify([{ displayName: "a", replacement: "b", icon: 1, color: null }]);
        expect(parseCalloutSuggestions(json)).toEqual([
            { displayName: "a", replacement: "b", icon: undefined, color: undefined },
        ]);
    });

    test("invalid JSON", () => {
        expect(() => parseCalloutSuggestions("[oops")).toThrow(`Failed to parse ${CALLOUT_SUGGESTIONS_FILE}`);
    });

    test("root must be an array", () => {
        expect(() => parseCalloutSuggestions("{}")).toThrow("must be an array");
        expect(() => parseCalloutSuggestions("null")).toThrow("must be an array");
    });

    test.each([[null], [1], [{ displayName: "a" }], [{ replacement: "a" }], [{ displayName: 1, replacement: "a" }]])(
        "invalid entry %p",
        (entry) => {
            expect(() => parseCalloutSuggestions(JSON.stringify([entry]))).toThrow(
                "entry without displayName/replacement",
            );
        },
    );

    test("display names must not contain a newline", () => {
        expect(() => parseCalloutSuggestions(JSON.stringify([{ displayName: "a\nb", replacement: "x" }]))).toThrow(
            "newline",
        );
    });

    test("string entries must not contain a newline either", () => {
        expect(() => parseCalloutSuggestions(JSON.stringify(["a\nb"]))).toThrow("newline");
    });

    test("the default callouts survive a round trip through the file format", () => {
        const json = JSON.stringify(defaultCallouts());
        expect(parseCalloutSuggestions(json)).toEqual(defaultCallouts());
    });
});

describe("defaultCallouts", () => {
    const callouts = defaultCallouts();
    const byName = new Map(callouts.map((c) => [c.displayName, c]));

    test("contains Obsidian's built-in callout types", () => {
        expect(callouts.map((c) => c.replacement)).toEqual([
            "note",
            "summary",
            "abstract",
            "tldr",
            "info",
            "todo",
            "tip",
            "hint",
            "important",
            "success",
            "check",
            "done",
            "question",
            "help",
            "faq",
            "warning",
            "caution",
            "attention",
            "failure",
            "fail",
            "missing",
            "danger",
            "error",
            "bug",
            "example",
            "quote",
            "cite",
        ]);
    });

    test("the Help callout inserts 'help'", () => {
        expect(byName.get("Help")).toMatchObject({ displayName: "Help", replacement: "help" });
    });

    test("display names with an explicit id", () => {
        expect(byName.get("TL;DR")!.replacement).toBe("tldr");
        expect(byName.get("To-Do")!.replacement).toBe("todo");
        expect(byName.get("FAQ")!.replacement).toBe("faq");
    });

    test("every callout has an icon and color", () => {
        for (const c of callouts) {
            expect(c.icon).toBeTruthy();
            expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
        }
        expect(byName.get("Help")!.icon).toBe("lucide-help-circle");
    });

    test("returns fresh objects", () => {
        defaultCallouts()[0].replacement = "changed";
        expect(defaultCallouts()[0].replacement).toBe("note");
    });
});

describe("CalloutProvider", () => {
    async function setup(contents?: string, blacklisted: string[] = []) {
        const { files, adapter } = makeDataFiles();
        if (contents !== undefined) adapter.files.set(FILE, contents);
        const blacklist = new SuggestionBlacklist(files);
        await blacklist.addAll(blacklisted);
        const provider = new CalloutProvider({} as Plugin, files, blacklist);
        const error = await provider.load(makeSettings());
        return { provider, adapter, error };
    }

    /** `lines` is the document, `|` marks the cursor. */
    function suggest(provider: CalloutProvider, lines: string[], settings = makeSettings()) {
        const lineNumber = lines.findIndex((l) => l.includes("|"));
        const ch = lines[lineNumber].indexOf("|");
        const doc = lines.map((l) => l.replace("|", ""));
        const editor = { getLine: (i: number) => doc[i] } as Editor;
        return provider.getSuggestions(
            makeContext("", { editor, line: doc[lineNumber], end: { line: lineNumber, ch } }),
            settings,
        );
    }

    test("writes the default callouts if the file is missing", async () => {
        const { adapter, error } = await setup();
        expect(error).toBeNull();
        const written = JSON.parse(adapter.files.get(FILE)!) as unknown[];
        expect(written).toHaveLength(defaultCallouts().length);
        expect(written[0]).toEqual({
            displayName: "Note",
            replacement: "note",
            icon: "lucide-pencil",
            color: "#448aff",
        });
    });

    test("suggests matching callout types", async () => {
        const { provider } = await setup();
        const result = suggest(provider, ["> [!he|"]);
        expect(result).toEqual([
            {
                ...defaultCallouts().find((c) => c.displayName === "Help")!,
                replacement: "[!help] ",
                overrideStart: { line: 0, ch: 2 },
                overrideEnd: { line: 0, ch: 6 },
            },
        ]);
    });

    test("matches display name or id", async () => {
        const { provider } = await setup();
        expect(suggest(provider, ["> [!tl|"]).map((s) => s.displayName)).toEqual(["TL;DR"]);
        expect(suggest(provider, ["> [!to|"]).map((s) => s.displayName)).toEqual(["To-Do"]);
        expect(suggest(provider, ["> [!TO|"]).map((s) => s.displayName)).toEqual(["To-Do"]);
    });

    test("an empty search lists all callouts", async () => {
        const { provider } = await setup();
        expect(suggest(provider, ["> [!|"])).toHaveLength(defaultCallouts().length);
    });

    test("replaces the whole header, keeping fold marker and title", async () => {
        const { provider } = await setup();
        const [s] = suggest(provider, ["", "> > [!wa|rn]- Be careful"]);
        expect(s.replacement).toBe("[!warning]- Be careful");
        expect(s.overrideStart).toEqual({ line: 1, ch: 4 });
        expect(s.overrideEnd).toEqual({ line: 1, ch: 23 });
    });

    test("no suggestions on continuation lines", async () => {
        const { provider } = await setup();
        expect(suggest(provider, ["> first line", "> [!no|"])).toEqual([]);
        expect(suggest(provider, ["> > first line", "> > [!no|"])).toEqual([]);
        expect(suggest(provider, ["> first line", "> > [!no|"])).toHaveLength(1);
    });

    test("no suggestions outside block quotes or the type", async () => {
        const { provider } = await setup();
        expect(suggest(provider, ["[!no|"])).toEqual([]);
        expect(suggest(provider, ["> [!note] ti|"])).toEqual([]);
    });

    test("blacklisted callouts are hidden", async () => {
        const { provider } = await setup(undefined, ["Note"]);
        expect(suggest(provider, ["> [!no|"])).toEqual([]);
    });

    test("disabled provider", async () => {
        const { provider } = await setup();
        expect(suggest(provider, ["> [!no|"], makeSettings({ calloutProviderEnabled: false }))).toEqual([]);
    });

    test("blocks all other providers", async () => {
        const { provider } = await setup();
        expect(provider.blocksAllOtherProviders).toBe(true);
    });

    test("uses the callouts from the file", async () => {
        const { provider } = await setup(JSON.stringify(["custom", { displayName: "Other", replacement: "oth" }]));
        expect(suggest(provider, ["> [!|"]).map((s) => s.replacement)).toEqual(["[!custom] ", "[!oth] "]);
    });

    test("an invalid file reports an error and falls back to the defaults", async () => {
        const { provider, error, adapter } = await setup("[broken");
        expect(error).toContain("Using default callout types");
        expect(suggest(provider, ["> [!|"])).toHaveLength(defaultCallouts().length);
        expect(adapter.files.get(FILE)).toBe("[broken");
    });
});
