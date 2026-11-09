import { describe, expect, test } from "bun:test";
import type { CachedMetadata, Editor, MetadataCache, TFile } from "obsidian";
import { findValuePosition, FrontMatterProvider } from "../../src/provider/front_matter_provider.ts";
import type { CompletrSettings } from "../../src/settings.ts";
import { makeContext, makeSettings } from "./helpers.ts";

describe("findValuePosition", () => {
    /** `lines` ends with the line of the cursor, cut at the cursor. */
    function find(...lines: string[]) {
        const before = lines[lines.length - 1];
        const above = lines.slice(0, -1);
        return findValuePosition(before, (offset) => above[above.length - offset] ?? null);
    }

    describe("inline values", () => {
        test("key: value", () => {
            expect(find("title: Hel")).toEqual({ key: "title", type: "inline", start: 7 });
        });

        test("empty value", () => {
            expect(find("title: ")).toEqual({ key: "title", type: "inline", start: 7 });
        });

        test("more whitespace after the colon", () => {
            expect(find("title:   Hel")).toEqual({ key: "title", type: "inline", start: 9 });
            expect(find("title:\tHel")).toEqual({ key: "title", type: "inline", start: 7 });
        });

        test("values with spaces, & and / (#68)", () => {
            expect(find("category: Research & Development / Ops")).toEqual({
                key: "category",
                type: "inline",
                start: 10,
            });
        });

        test("values containing colons", () => {
            expect(find("time: 10:30")).toEqual({ key: "time", type: "inline", start: 6 });
            expect(find("url: https://example.com")).toEqual({ key: "url", type: "inline", start: 5 });
        });

        test("keys with spaces and special characters", () => {
            expect(find("my key: v")).toEqual({ key: "my key", type: "inline", start: 8 });
            expect(find("créé-le: v")).toEqual({ key: "créé-le", type: "inline", start: 9 });
        });

        test("no value position without whitespace after the colon", () => {
            expect(find("title:")).toBeNull();
            expect(find("title:x")).toBeNull();
        });

        test("typing a key is not a value", () => {
            expect(find("tit")).toBeNull();
            expect(find("")).toBeNull();
        });

        test("comments and indented lines are not keys", () => {
            expect(find("# comment: x")).toBeNull();
            expect(find("  nested: x")).toBeNull();
        });
    });

    describe("inline lists", () => {
        test("first item", () => {
            expect(find("tags: [")).toEqual({ key: "tags", type: "inline-list", start: 7 });
            expect(find("tags: [ab")).toEqual({ key: "tags", type: "inline-list", start: 7 });
        });

        test("later items, skipping spaces after the comma", () => {
            expect(find("tags: [a, b")).toEqual({ key: "tags", type: "inline-list", start: 10 });
            expect(find("tags: [a,b")).toEqual({ key: "tags", type: "inline-list", start: 9 });
            expect(find("tags: [a,   ")).toEqual({ key: "tags", type: "inline-list", start: 12 });
        });

        test("items with spaces (#68)", () => {
            expect(find("aliases: [First Alias, Second Al")).toEqual({
                key: "aliases",
                type: "inline-list",
                start: 23,
            });
        });
    });

    describe("multi-line lists", () => {
        test("item directly below the key", () => {
            expect(find("tags:", "  - ab")).toEqual({ key: "tags", type: "multiline", start: 4 });
            expect(find("tags:", "- ab")).toEqual({ key: "tags", type: "multiline", start: 2 });
        });

        test("empty item", () => {
            expect(find("tags:", "- ")).toEqual({ key: "tags", type: "multiline", start: 2 });
        });

        test("items with spaces, & and / (#68)", () => {
            expect(find("aliases:", "  - Some & Other / Thing")).toEqual({
                key: "aliases",
                type: "multiline",
                start: 4,
            });
        });

        test("previous items and empty lines between the key and the cursor", () => {
            expect(find("tags:", "  - a", "", "  - b", "  -", "  - c")).toEqual({
                key: "tags",
                type: "multiline",
                start: 4,
            });
        });

        test("key with trailing whitespace", () => {
            expect(find("tags:  ", "- a")).toEqual({ key: "tags", type: "multiline", start: 2 });
        });

        test("finds the nearest key", () => {
            expect(find("aliases:", "- a", "tags:", "- b")).toMatchObject({ key: "tags" });
        });

        test("other content between the key and the cursor ends the search", () => {
            expect(find("tags:", "other: value", "- b")).toBeNull();
            expect(find("tags:", "text", "- b")).toBeNull();
        });

        test("no key above", () => {
            expect(find("- b")).toBeNull();
            expect(find("- a", "- b")).toBeNull();
        });

        test("a dash without a following space is not an item", () => {
            expect(find("tags:", "-b")).toBeNull();
        });
    });
});

describe("FrontMatterProvider", () => {
    let fileCounter = 0;
    const file = (path = "note" + fileCounter++ + ".md") => ({ path }) as TFile;

    function providerWith(...frontMatters: Record<string, unknown>[]) {
        const provider = new FrontMatterProvider();
        for (const frontmatter of frontMatters) provider.updateFile(file(), { frontmatter });
        return provider;
    }

    /** `lines` is the document, `|` marks the cursor. */
    function suggest(
        provider: FrontMatterProvider,
        lines: string[],
        overrides: Partial<CompletrSettings> = {},
        manual = false,
    ) {
        const lineNumber = lines.findIndex((l) => l.includes("|"));
        const ch = lines[lineNumber].indexOf("|");
        const doc = lines.map((l) => l.replace("|", ""));
        const editor = { getLine: (i: number) => doc[i], lineCount: () => doc.length } as Editor;
        return provider.getSuggestions(
            makeContext("", { editor, line: doc[lineNumber], end: { line: lineNumber, ch }, manual }),
            makeSettings(overrides),
        );
    }

    const names = (...args: Parameters<typeof suggest>) => suggest(...args).map((s) => s.displayName);

    test("blocks all other providers", () => {
        expect(new FrontMatterProvider().blocksAllOtherProviders).toBe(true);
    });

    describe("front matter snippet", () => {
        test("suggested while typing 'front-matter' on the first line", () => {
            const provider = new FrontMatterProvider();
            expect(suggest(provider, ["fro|"])).toEqual([
                {
                    displayName: "front-matter",
                    replacement: "---\n~\n---",
                    overrideStart: { line: 0, ch: 0 },
                    overrideEnd: { line: 0, ch: 3 },
                    isSnippet: true,
                },
            ]);
        });

        test("case insensitive if configured", () => {
            const provider = new FrontMatterProvider();
            expect(names(provider, ["FRO|"])).toEqual(["front-matter"]);
            expect(names(provider, ["FRO|"], { frontMatterIgnoreCase: false })).toEqual([]);
        });

        test("only on the first line and only if it matches", () => {
            const provider = new FrontMatterProvider();
            expect(names(provider, ["", "fro|"])).toEqual([]);
            expect(names(provider, ["foo|"])).toEqual([]);
            expect(names(provider, ["front-matter more|"])).toEqual([]);
        });

        test("an empty first line only when triggered manually", () => {
            const provider = new FrontMatterProvider();
            expect(names(provider, ["|"])).toEqual([]);
            expect(names(provider, ["|"], {}, true)).toEqual(["front-matter"]);
        });

        test("not when there already is front matter", () => {
            const provider = new FrontMatterProvider();
            expect(names(provider, ["---|", "---"])).toEqual([]);
        });
    });

    describe("keys", () => {
        test("built-in list keys are always suggested", () => {
            const provider = new FrontMatterProvider();
            expect(names(provider, ["---", "ta|", "---"])).toEqual(["tags: [#]", "tags: \\..."]);
            expect(names(provider, ["---", "c|", "---"])).toEqual(["cssclasses: [#]", "cssclasses: \\..."]);
        });

        test("list keys offer an inline and a multi-line form", () => {
            const provider = new FrontMatterProvider();
            const result = suggest(provider, ["---", "al|", "---"]);
            expect(result).toEqual([
                {
                    displayName: "aliases: [#]",
                    replacement: "aliases: [~]",
                    overrideStart: { line: 1, ch: 0 },
                    isSnippet: true,
                },
                {
                    displayName: "aliases: \\...",
                    replacement: "aliases:\n- ~",
                    overrideStart: { line: 1, ch: 0 },
                    isSnippet: true,
                },
            ]);
        });

        test("keys from the vault, sorted by length", () => {
            const provider = providerWith({ status: "done" }, { stars: 3, starred: true });
            const result = suggest(provider, ["---", "st|", "---"]);
            expect(result.map((s) => [s.displayName, s.replacement])).toEqual([
                ["stars: #", "stars: ~"],
                ["status: #", "status: ~"],
                ["starred: #", "starred: ~"],
            ]);
        });

        test("a key used as a list in any file is a list key", () => {
            const provider = providerWith({ authors: "me" }, { authors: ["you", "them"] });
            expect(names(provider, ["---", "au|", "---"])).toEqual(["authors: [#]", "authors: \\..."]);
        });

        test("key search respects frontMatterIgnoreCase", () => {
            const provider = providerWith({ Status: "x" });
            expect(names(provider, ["---", "sta|", "---"])).toEqual(["Status: #"]);
            expect(names(provider, ["---", "sta|", "---"], { frontMatterIgnoreCase: false })).toEqual([]);
        });

        test("an empty line only lists all keys when triggered manually", () => {
            const provider = providerWith({ status: "x" });
            expect(names(provider, ["---", "|", "---"])).toEqual([]);
            expect(names(provider, ["---", "|", "---"], {}, true)).toContain("status: #");
        });

        test("no key suggestions after whitespace or in the middle of a value", () => {
            const provider = providerWith({ status: "x" });
            expect(names(provider, ["---", "  sta|", "---"])).toEqual([]);
            expect(names(provider, ["---", "my sta|", "---"])).toEqual([]);
        });

        test("nothing outside the front matter", () => {
            const provider = providerWith({ status: "x" });
            expect(names(provider, ["---", "a: b", "---", "sta|"])).toEqual([]);
            expect(names(provider, ["---", "sta|"])).toEqual([]);
        });

        test("keys whose values are objects or empty are still suggested as keys", () => {
            const provider = providerWith({ nested: { a: 1 }, empty: null });
            expect(names(provider, ["---", "ne|", "---"])).toEqual(["nested: #"]);
            expect(names(provider, ["---", "em|", "---"])).toEqual(["empty: #"]);
        });

        test("the position key of Obsidian's metadata cache is ignored", () => {
            const provider = providerWith({ position: { start: 0 } });
            expect(names(provider, ["---", "pos|", "---"])).toEqual([]);
        });
    });

    describe("values", () => {
        test("suggests known values of the key", () => {
            const provider = providerWith({ status: "done" }, { status: "doing" }, { other: "dot" });
            expect(names(provider, ["---", "status: do|", "---"])).toEqual(["done", "doing"]);
        });

        test("replacement starts at the value", () => {
            const provider = providerWith({ status: "done" });
            expect(suggest(provider, ["---", "status: d|", "---"])).toEqual([
                { displayName: "done", replacement: "done", overrideStart: { line: 1, ch: 8 } },
            ]);
        });

        test("numbers and booleans are suggested as text instead of crashing", () => {
            const provider = providerWith({ rating: 5, done: true, ratio: 0.5 }, { rating: 10, done: false });
            expect(names(provider, ["---", "rating: |", "---"], {}, true)).toEqual(["5", "10"]);
            expect(names(provider, ["---", "rating: 1|", "---"])).toEqual(["10"]);
            expect(names(provider, ["---", "done: t|", "---"])).toEqual(["true"]);
            expect(names(provider, ["---", "ratio: 0|", "---"])).toEqual(["0.5"]);
        });

        test("lists of mixed values", () => {
            const provider = providerWith({ list: ["text", 1, true, null, { a: 1 }, ["nested"]] });
            expect(names(provider, ["---", "list: [|", "---"], {}, true).sort()).toEqual(
                ["1", "nested", "text", "true"].sort(),
            );
        });

        test("empty strings are not suggested", () => {
            const provider = providerWith({ status: "" }, { status: "x" });
            expect(names(provider, ["---", "status: |", "---"], {}, true)).toEqual(["x"]);
        });

        test("substring matches come after prefix matches (#27)", () => {
            const provider = providerWith({ project: ["website", "web", "new website", "mobile web app"] });
            expect(names(provider, ["---", "project: web|", "---"])).toEqual([
                "website",
                "new website",
                "mobile web app",
            ]);
        });

        test("the exact typed value is not suggested", () => {
            const provider = providerWith({ status: ["done", "done later"] });
            expect(names(provider, ["---", "status: done|", "---"])).toEqual(["done later"]);
        });

        test("values with spaces, & and / (#68)", () => {
            const provider = providerWith({ category: ["R&D / Ops", "R&D / Sales", "Retail"] });
            expect(names(provider, ["---", "category: R&D /|", "---"])).toEqual(["R&D / Ops", "R&D / Sales"]);
        });

        test("case insensitive by default", () => {
            const provider = providerWith({ status: "Done" });
            expect(names(provider, ["---", "status: do|", "---"])).toEqual(["Done"]);
            expect(names(provider, ["---", "status: do|", "---"], { frontMatterIgnoreCase: false })).toEqual([]);
        });

        test("an empty value only lists all values when triggered manually", () => {
            const provider = providerWith({ status: "done" });
            expect(names(provider, ["---", "status: |", "---"])).toEqual([]);
            expect(names(provider, ["---", "status: |", "---"], {}, true)).toEqual(["done"]);
        });

        test("unknown keys have no values", () => {
            const provider = providerWith({ status: "done" });
            expect(names(provider, ["---", "unknown: d|", "---"])).toEqual([]);
        });

        test("publish always suggests true and false", () => {
            const provider = new FrontMatterProvider();
            expect(names(provider, ["---", "publish: |", "---"], {}, true)).toEqual(["true", "false"]);
            expect(names(provider, ["---", "publish: f|", "---"])).toEqual(["false"]);
        });

        test("values are merged across files and de-duplicated", () => {
            const provider = providerWith({ status: "done" }, { status: ["done", "open"] });
            expect(names(provider, ["---", "status: |", "---"], {}, true)).toEqual(["done", "open"]);
        });

        describe("list suffix", () => {
            const provider = providerWith({ topics: ["alpha", "beta"] });

            test("inline lists get ', ' appended", () => {
                expect(suggest(provider, ["---", "topics: [alpha, b|", "---"])).toEqual([
                    { displayName: "beta", replacement: "beta, ", overrideStart: { line: 1, ch: 16 } },
                ]);
            });

            test("multi-line lists get a new item with the same indentation", () => {
                const [s] = suggest(provider, ["---", "topics:", "  - al|", "---"]);
                expect(s.replacement).toBe("alpha\n  - ");
                expect(s.overrideStart).toEqual({ line: 2, ch: 4 });
            });

            test("no suffix for inline values or if disabled", () => {
                expect(suggest(provider, ["---", "topics: al|", "---"])[0].replacement).toBe("alpha");
                expect(
                    suggest(provider, ["---", "topics: [al|", "---"], { frontMatterTagAppendSuffix: false })[0]
                        .replacement,
                ).toBe("alpha");
            });

            test("no suffix for non-list keys", () => {
                const p = providerWith({ status: "done" });
                expect(suggest(p, ["---", "status: [d|", "---"])[0].replacement).toBe("done");
            });
        });

        test("multi-line list item search uses the key above", () => {
            const provider = providerWith({ topics: ["alpha"], other: ["alps"] });
            expect(names(provider, ["---", "topics:", "  - x", "  - al|", "---"])).toEqual(["alpha"]);
        });

        test("the multi-line key search does not leave the front matter", () => {
            const provider = providerWith({ topics: ["alpha"] });
            expect(names(provider, ["---", "- al|", "---"])).toEqual([]);
        });
    });

    describe("tags", () => {
        test("tags come from the front matter and the note body, without '#'", () => {
            const provider = new FrontMatterProvider();
            provider.updateFile(file(), {
                frontmatter: { tags: ["project/web", "#todo"] },
                tags: [{ tag: "#inline" }],
            } as unknown as CachedMetadata);
            expect(names(provider, ["---", "tags: [|", "---"], {}, true).sort()).toEqual([
                "inline",
                "project/web",
                "todo",
            ]);
        });

        test("inline tags of notes without front matter are ignored", () => {
            const provider = new FrontMatterProvider();
            provider.updateFile(file(), { tags: [{ tag: "#inline" }] } as unknown as CachedMetadata);
            expect(names(provider, ["---", "tags: [|", "---"], {}, true)).toEqual([]);
        });
    });

    describe("file tracking", () => {
        test("updating a file replaces its values", () => {
            const provider = new FrontMatterProvider();
            const f = file();
            provider.updateFile(f, { frontmatter: { status: "old" } });
            expect(names(provider, ["---", "status: |", "---"], {}, true)).toEqual(["old"]);
            provider.updateFile(f, { frontmatter: { status: "new" } });
            expect(names(provider, ["---", "status: |", "---"], {}, true)).toEqual(["new"]);
        });

        test("a file without front matter removes its keys", () => {
            const provider = new FrontMatterProvider();
            const f = file();
            provider.updateFile(f, { frontmatter: { status: "old" } });
            provider.updateFile(f, {});
            expect(names(provider, ["---", "sta|", "---"])).toEqual([]);
            provider.updateFile(f, { frontmatter: { status: "x" } });
            provider.updateFile(f, null);
            expect(names(provider, ["---", "sta|", "---"])).toEqual([]);
        });

        test("removeFile", () => {
            const provider = new FrontMatterProvider();
            provider.updateFile(file("a.md"), { frontmatter: { status: "a" } });
            provider.updateFile(file("b.md"), { frontmatter: { status: "b" } });
            provider.removeFile("a.md");
            expect(names(provider, ["---", "status: |", "---"], {}, true)).toEqual(["b"]);
            provider.removeFile("unknown.md");
            expect(names(provider, ["---", "status: |", "---"], {}, true)).toEqual(["b"]);
        });

        test("renameFile keeps the values under the new path", () => {
            const provider = new FrontMatterProvider();
            provider.updateFile(file("a.md"), { frontmatter: { status: "a" } });
            provider.renameFile("a.md", "b.md");
            expect(names(provider, ["---", "status: |", "---"], {}, true)).toEqual(["a"]);
            provider.removeFile("a.md");
            expect(names(provider, ["---", "status: |", "---"], {}, true)).toEqual(["a"]);
            provider.removeFile("b.md");
            expect(names(provider, ["---", "status: |", "---"], {}, true)).toEqual([]);
            provider.renameFile("unknown.md", "c.md");
        });

        test("loadAll reads every file from the metadata cache", () => {
            const provider = new FrontMatterProvider();
            const caches = new Map<string, CachedMetadata | null>([
                ["a.md", { frontmatter: { status: "a" } }],
                ["b.md", null],
                ["c.md", { frontmatter: { status: "c" } }],
            ]);
            const cache = { getFileCache: (f: TFile) => caches.get(f.path) ?? null } as MetadataCache;
            provider.loadAll(
                cache,
                [...caches.keys()].map((p) => file(p)),
            );
            expect(names(provider, ["---", "status: |", "---"], {}, true)).toEqual(["a", "c"]);
        });
    });

    test("disabled provider", () => {
        const provider = providerWith({ status: "x" });
        expect(names(provider, ["---", "sta|", "---"], { frontMatterProviderEnabled: false })).toEqual([]);
        expect(names(provider, ["fro|"], { frontMatterProviderEnabled: false })).toEqual([]);
    });
});
