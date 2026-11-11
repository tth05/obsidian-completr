import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { getObsidian, type Obsidian } from "./harness/obsidian.ts";
import { startErrorCapture, takeErrors } from "./helpers/errors.ts";
import { deleteNotes, forgetUsage } from "./helpers/words.ts";

let obsidian: Obsidian;

const FIXTURES: Record<string, string> = {
    "fm-e2e-fixture-1.md": [
        "---",
        "status: draft",
        "categories: [Alphacat, Betacat]",
        "topics:",
        "  - A & B",
        "  - A & B/C",
        "mood: 🌲 Evergreen",
        "rating: 5",
        "score: 42",
        "done: true",
        "meta:",
        "  nested: 1",
        "tags: [projectalpha]",
        "---",
        "Body with #inlinetagzz",
    ].join("\n"),
    "fm-e2e-fixture-2.md": ["---", "status: published", "rating: 4.5", "empty:", "---", ""].join("\n"),
};
const NOTE = "fm-e2e-note.md";
/** Suggestions these tests insert. Their usage counts are reset, so ranking by usage doesn't change the order. */
const INSERTED = [
    "status: #",
    "draft",
    "categories: [#]",
    "categories: \\...",
    "Alphacat",
    "Betacat",
    "A & B",
    "A & B/C",
    "🌲 Evergreen",
    "projectalpha",
    "inlinetagzz",
    "false",
    "4.5",
    "front-matter",
];

/** Opens the test note in source mode (live preview shows the properties widget instead of the YAML). */
function openNote(content: string) {
    return obsidian.openNote(content, { path: NOTE, sourceMode: true });
}

async function expectText(textWithCursor: string) {
    expect((await obsidian.editor()).textWithCursor).toBe(textWithCursor);
}

beforeAll(async () => {
    obsidian = await getObsidian();
    for (const [path, content] of Object.entries(FIXTURES)) await obsidian.writeVaultFile(path, content);
    // Wait until Completr picked up the front matter of the fixtures
    await obsidian.waitFor(
        () =>
            obsidian.eval(() => {
                const fm = app.plugins.plugins["obsidian-completr"]!.frontMatter as unknown as {
                    getKeys(): Map<string, { values: Set<string> }>;
                };
                const keys = fm.getKeys();
                return !!keys.get("status")?.values.has("published") && !!keys.get("tags")?.values.has("inlinetagzz");
            }),
        { timeout: 5_000, what: "the fixtures' front matter" },
    );
});
beforeEach(async () => {
    await obsidian.resetSettings();
    await forgetUsage(obsidian, INSERTED);
});
afterAll(async () => {
    await forgetUsage(obsidian, INSERTED);
    await obsidian.openNote("", { path: "test.md" });
    await deleteNotes(obsidian, [...Object.keys(FIXTURES), NOTE]);
});

test("completes keys at the start of a line", async () => {
    await openNote("---\n<|>\n---\n");
    await obsidian.type("stat");
    expect((await obsidian.waitForPopup()).items).toEqual(["status: #"]);
    await obsidian.press("Enter");
    await expectText("---\nstatus: <|>\n---\n");

    await obsidian.type("dr");
    expect((await obsidian.waitForPopup()).items).toEqual(["draft"]);
    await obsidian.press("Enter");
    await expectText("---\nstatus: draft<|>\n---\n");
});

test("offers inline and multi-line forms for list keys", async () => {
    await openNote("---\n<|>\n---\n");
    await obsidian.type("categ");
    expect((await obsidian.waitForPopup()).items).toEqual(["categories: [#]", "categories: \\..."]);
    await obsidian.press("Enter");
    await expectText("---\ncategories: [<|>]\n---\n");

    await openNote("---\n<|>\n---\n");
    await obsidian.type("categ");
    await obsidian.waitForPopup();
    await obsidian.press("ArrowDown");
    await obsidian.press("Enter");
    await expectText("---\ncategories:\n- <|>\n---\n");
});

test("built-in list keys are suggested even if no note uses them", async () => {
    await openNote("---\n<|>\n---\n");
    await obsidian.type("css");
    expect((await obsidian.waitForPopup()).items).toEqual(["cssclasses: [#]", "cssclasses: \\..."]);
});

test("completes values of inline lists and appends ', '", async () => {
    await openNote("---\ncategories: [<|>]\n---\n");
    await obsidian.type("alp");
    expect((await obsidian.waitForPopup()).items).toEqual(["Alphacat"]);
    await obsidian.press("Enter");
    await expectText("---\ncategories: [Alphacat, <|>]\n---\n");

    await obsidian.type("Bet");
    await obsidian.waitForPopup((p) => p.items[0] === "Betacat");
    await obsidian.press("Enter");
    await expectText("---\ncategories: [Alphacat, Betacat, <|>]\n---\n");
});

test("completes values of multi-line lists and starts a new item", async () => {
    await openNote("---\ncategories:\n- <|>\n---\n");
    await obsidian.type("Alp");
    await obsidian.waitForPopup((p) => p.items[0] === "Alphacat");
    await obsidian.press("Enter");
    await expectText("---\ncategories:\n- Alphacat\n- <|>\n---\n");

    // Keeps the indentation
    await openNote("---\ntopics:\n  - <|>\n---\n");
    await obsidian.type("A & B");
    await obsidian.waitForPopup((p) => p.items[0] === "A & B/C");
    await obsidian.press("Enter");
    await expectText("---\ntopics:\n  - A & B/C\n  - <|>\n---\n");
});

test("the separator can be disabled", async () => {
    await obsidian.setSettings({ frontMatterTagAppendSuffix: false });
    await openNote("---\ncategories: [<|>]\n---\n");
    await obsidian.type("alp");
    await obsidian.waitForPopup((p) => p.items[0] === "Alphacat");
    await obsidian.press("Enter");
    await expectText("---\ncategories: [Alphacat<|>]\n---\n");
});

test("values may contain spaces, '&' and '/' (#68)", async () => {
    await openNote("---\ntopics: [<|>]\n---\n");
    await obsidian.type("A & ");
    expect((await obsidian.waitForPopup()).items).toEqual(["A & B", "A & B/C"]);
    await obsidian.type("B/");
    await obsidian.waitForPopup((p) => p.items.length === 1 && p.items[0] === "A & B/C");
    await obsidian.press("Enter");
    await expectText("---\ntopics: [A & B/C, <|>]\n---\n");
});

test("suggests values containing the typed text, e.g. with an emoji in front (#27)", async () => {
    await openNote("---\nmood: <|>\n---\n");
    await obsidian.type("evergreen");
    expect((await obsidian.waitForPopup()).items).toEqual(["🌲 Evergreen"]);
    await obsidian.press("Enter");
    await expectText("---\nmood: 🌲 Evergreen<|>\n---\n");
});

test("tags from the front matter and the body of all notes are suggested", async () => {
    await openNote("---\ntags: [<|>]\n---\n");
    await obsidian.type("proj");
    expect((await obsidian.waitForPopup()).items).toEqual(["projectalpha"]);
    await obsidian.press("Enter");
    await obsidian.type("inlinet");
    await obsidian.waitForPopup((p) => p.items[0] === "inlinetagzz");
    await obsidian.press("Enter");
    await expectText("---\ntags: [projectalpha, inlinetagzz, <|>]\n---\n");
});

test("suggests true/false for publish", async () => {
    await openNote("---\npublish: <|>\n---\n");
    await obsidian.type("f");
    expect((await obsidian.waitForPopup()).items).toEqual(["false"]);
    await obsidian.press("Enter");
    await expectText("---\npublish: false<|>\n---\n");
});

test("numbers, booleans, empty values and objects don't break anything", async () => {
    await startErrorCapture(obsidian);
    await openNote("---\nrating: <|>\n---\n");
    await obsidian.type("4");
    expect((await obsidian.waitForPopup()).items).toEqual(["4.5"]);
    await obsidian.press("Enter");
    await expectText("---\nrating: 4.5<|>\n---\n");

    await openNote("---\ndone: <|>\n---\n");
    await obsidian.type("t");
    expect((await obsidian.waitForPopup()).items).toEqual(["true"]);

    // Object values are not suggested
    await openNote("---\nmeta: <|>\n---\n");
    await obsidian.type("nes");
    await obsidian.expectNoPopup();
    expect(await takeErrors(obsidian)).toEqual([]);
});

test("keys without a value are suggested", async () => {
    await openNote("---\n<|>\n---\n");
    await obsidian.type("emp");
    expect((await obsidian.waitForPopup()).items).toEqual(["empty: #"]);
});

test("nothing is suggested outside of the front matter", async () => {
    await openNote("---\nstatus: draft\n---\n<|>");
    await obsidian.type("status: publ");
    await obsidian.expectNoPopup();
});

test("the front-matter snippet creates the front matter on the first line", async () => {
    await openNote("<|>\nSome text");
    await obsidian.type("front");
    expect((await obsidian.waitForPopup()).items).toEqual(["front-matter"]);
    await obsidian.press("Enter");
    await expectText("---\n<|>\n---\nSome text");

    // Only on the first line
    await openNote("Text\n<|>");
    await obsidian.type("front");
    await obsidian.expectNoPopup();
});
