import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { getObsidian, type Obsidian } from "./harness/obsidian.ts";
import { clickAt, openFreshNote, placeholders, recordDocuments, selectAndInsert } from "./helpers/latex.ts";
import { clickModalButton, fillEntryModal, waitForEntryModal, waitForNoModal } from "./helpers/settings_tab.ts";
import { forgetScannedWords, renderedItems } from "./helpers/words.ts";

let obsidian: Obsidian;
beforeAll(async () => {
    obsidian = await getObsidian();
});
beforeEach(async () => {
    await obsidian.resetSettings();
    await obsidian.setSettings({ rankByUsage: false });
});

async function text() {
    return (await obsidian.editor()).textWithCursor;
}

function selectedText() {
    return obsidian.eval(() => app.workspace.activeEditor!.editor!.getSelection());
}

/** Opens a math block and inserts `\frac{#}{#}` through the popup. */
async function insertFrac(content = "$$\n<|>\n$$") {
    await openFreshNote(obsidian, content);
    await obsidian.type("\\frac");
    await selectAndInsert(obsidian, "\\frac{#}{#}");
}

test("Enter outside of the popup inserts a newline", async () => {
    await openFreshNote(obsidian, "Line<|>");
    await obsidian.press("Enter");
    expect(await text()).toBe("Line\n<|>");
});

test("inserting a snippet puts the cursor into the first placeholder without inserting #", async () => {
    await insertFrac();
    expect(await text()).toBe("$$\n\\frac{<|>}{}\n$$");
    expect(await placeholders(obsidian)).toEqual({ count: 2, empty: 2 });

    // Typing grows the placeholder
    await obsidian.type("ab");
    expect(await text()).toBe("$$\n\\frac{ab<|>}{}\n$$");
    expect(await placeholders(obsidian)).toEqual({ count: 2, empty: 1 });
});

test("Enter jumps through the placeholders and finally behind the closing brace", async () => {
    await insertFrac();
    await obsidian.type("a");
    await obsidian.press("Enter");
    expect(await text()).toBe("$$\n\\frac{a}{<|>}\n$$");
    expect(await placeholders(obsidian)).toEqual({ count: 1, empty: 1 });

    await obsidian.type("b");
    await obsidian.press("Enter");
    expect(await text()).toBe("$$\n\\frac{a}{b}<|>\n$$");
    expect(await placeholders(obsidian)).toEqual({ count: 0, empty: 0 });

    // The snippet is finished, Enter is a normal newline again
    await obsidian.press("Enter");
    expect(await text()).toBe("$$\n\\frac{a}{b}\n<|>\n$$");
});

test("Enter jumps over empty placeholders", async () => {
    await insertFrac("$<|>$");
    await obsidian.press("Enter");
    expect(await text()).toBe("$\\frac{}{<|>}$");
    await obsidian.press("Enter");
    expect(await text()).toBe("$\\frac{}{}<|>$");
});

test("issue #92: the document never contains # while filling a snippet", async () => {
    await openFreshNote(obsidian, "$$\n<|>\n$$");
    const stop = await recordDocuments(obsidian);
    let recorded: string[];
    try {
        await obsidian.type("\\frac");
        await selectAndInsert(obsidian, "\\frac{#}{#}");
        await obsidian.type("a");
        await obsidian.press("Enter");
        await obsidian.type("b");
        await obsidian.press("Enter");
    } finally {
        recorded = await stop();
    }
    expect(recorded.length).toBeGreaterThan(5);
    expect(recorded.filter((t) => t.includes("#"))).toEqual([]);
    expect(recorded.at(-1)).toBe("$$\n\\frac{a}{b}\n$$");

    // An unfinished snippet renders as valid math as well
    await insertFrac("$$\n<|>\n$$\nText");
    await clickAt(obsidian, (await obsidian.editor()).text.length);
    const rendered = await obsidian.waitFor(() =>
        obsidian.eval(() => {
            const math = app.workspace.activeEditor!.editor!.cm.dom.querySelector(".math");
            return math ? { html: math.innerHTML, hasMath: !!math.querySelector("mjx-container") } : null;
        }),
    );
    expect(rendered.hasMath).toBe(true);
    // MathJax renders errors as <mjx-merror>
    expect(rendered.html).not.toContain("merror");
});

test("placeholders are rendered with the snippet color", async () => {
    await insertFrac("$<|>$");
    const classes = await obsidian.eval(() =>
        Array.from(
            app.workspace.activeEditor!.editor!.cm.dom.querySelectorAll(".completr-placeholder"),
            (e) => e.className,
        ),
    );
    expect(classes).toHaveLength(2);
    for (const c of classes) expect(c).toMatch(/completr-placeholder-\d/);
});

test("clicking outside of the placeholders ends the snippet", async () => {
    await insertFrac("Some text\n\n$$\n<|>\n$$");
    expect(await placeholders(obsidian)).toEqual({ count: 2, empty: 2 });

    await clickAt(obsidian, 4);
    await obsidian.waitFor(async () => (await placeholders(obsidian)).count === 0, {
        what: "the placeholders to disappear",
    });
    expect((await obsidian.editor()).cursor).toBe(4);
    // Enter is a normal newline again
    await obsidian.press("Enter");
    expect(await text()).toStartWith("Some\n<|>");
});

test("moving the cursor with the keyboard ends the snippet", async () => {
    await insertFrac("$<|>$");
    await obsidian.press("End");
    expect(await placeholders(obsidian)).toEqual({ count: 0, empty: 0 });
    expect(await text()).toBe("$\\frac{}{}$<|>");
});

test("jumpWithTab: Tab jumps to the next placeholder", async () => {
    await obsidian.setSettings({ jumpWithTab: true });
    await insertFrac();
    await obsidian.type("a");
    await obsidian.press("Tab");
    expect(await text()).toBe("$$\n\\frac{a}{<|>}\n$$");
    await obsidian.type("b");
    await obsidian.press("Tab");
    expect(await text()).toBe("$$\n\\frac{a}{b}<|>\n$$");
    expect(await placeholders(obsidian)).toEqual({ count: 0, empty: 0 });
});

test("Tab doesn't jump without jumpWithTab", async () => {
    await insertFrac();
    await obsidian.type("a");
    await obsidian.press("Tab");
    expect(await text()).not.toBe("$$\n\\frac{a}{<|>}\n$$");
});

/** Inserts `\sqrt{#}` into the first placeholder of a `\frac{#}{#}` snippet and fills it with "x". */
async function insertNestedSnippet() {
    await insertFrac();
    await obsidian.type("\\sqrt");
    await selectAndInsert(obsidian, "\\sqrt{#}");
    expect(await text()).toBe("$$\n\\frac{\\sqrt{<|>}}{}\n$$");
    // The nested snippet's placeholder plus the outer snippet's second one
    expect((await placeholders(obsidian)).empty).toBe(2);
    await obsidian.type("x");
}

test("nested snippets are visited first", async () => {
    await insertNestedSnippet();
    await obsidian.press("Enter");
    // Back in the outer snippet's first placeholder, which now contains the nested snippet
    expect(await text()).toBe("$$\n\\frac{\\sqrt{x}<|>}{}\n$$");
    await obsidian.press("Enter");
    expect(await text()).toBe("$$\n\\frac{\\sqrt{x}}{<|>}\n$$");
    await obsidian.type("y");
    await obsidian.press("Enter");
    expect(await text()).toBe("$$\n\\frac{\\sqrt{x}}{y}<|>\n$$");
    expect(await placeholders(obsidian)).toEqual({ count: 0, empty: 0 });
});

test("typing after leaving a nested snippet doesn't replace it", async () => {
    await insertNestedSnippet();
    await obsidian.press("Enter");
    expect(await selectedText()).toBe("");
    await obsidian.type("+1");
    expect(await text()).toBe("$$\n\\frac{\\sqrt{x}+1<|>}{}\n$$");
    await obsidian.press("Enter");
    expect(await text()).toBe("$$\n\\frac{\\sqrt{x}+1}{<|>}\n$$");
});

test("replacing the whole document ends the snippet", async () => {
    await insertFrac("$<|>$");
    await obsidian.eval(() => {
        const editor = app.workspace.activeEditor!.editor!;
        editor.setValue("Replaced\ncontent");
        editor.setCursor({ line: 0, ch: 2 });
    });
    expect(await placeholders(obsidian)).toEqual({ count: 0, empty: 0 });
    await obsidian.press("Enter");
    expect(await text()).toBe("Re\n<|>placed\ncontent");
});

test("multi-line environment puts the cursor at the ~ position", async () => {
    await openFreshNote(obsidian, "$$\n<|>\n$$");
    await obsidian.type("\\begin");
    await selectAndInsert(obsidian, "\\begin{align}...");
    expect(await text()).toBe("$$\n\\begin{align}\n<|>\n\\end{align}\n$$");
    // No placeholders, so nothing is rendered or tracked
    expect(await placeholders(obsidian)).toEqual({ count: 0, empty: 0 });
});

test("front matter snippet", async () => {
    await openFreshNote(obsidian, "<|>");
    await obsidian.type("fro");
    await selectAndInsert(obsidian, "front-matter");
    expect(await text()).toBe("---\n<|>\n---");
});

describe("custom snippets", () => {
    const MEETING = { displayName: "meeting", replacement: "## Meeting {{title}}\nAttendees: {{}}\n\n{{cursor}}" };

    async function setSnippets(snippets: { displayName: string; replacement: string }[]) {
        await obsidian.eval(
            (s: typeof snippets) => app.plugins.plugins["obsidian-completr"]!.snippets.customEntries.set(s),
            snippets,
        );
    }

    beforeEach(() => setSnippets([MEETING]));
    afterEach(() => setSnippets([]));

    test("are saved to snippets.json", async () => {
        const file = await obsidian.readVaultFile(".obsidian/plugins/obsidian-completr/snippets.json");
        expect(JSON.parse(file!)).toEqual([MEETING]);
    });

    test("pre-filled placeholders are selected, Enter jumps to the next one and finally to {{cursor}}", async () => {
        await openFreshNote(obsidian, "Notes\n\n<|>");
        await obsidian.type("meet");
        await selectAndInsert(obsidian, "meeting");
        expect(await text()).toBe("Notes\n\n## Meeting title<|>\nAttendees: \n\n");
        expect(await selectedText()).toBe("title");
        expect(await placeholders(obsidian)).toEqual({ count: 2, empty: 1 });

        await obsidian.type("Weekly");
        expect(await text()).toBe("Notes\n\n## Meeting Weekly<|>\nAttendees: \n\n");
        await obsidian.press("Enter");
        expect(await text()).toBe("Notes\n\n## Meeting Weekly\nAttendees: <|>\n\n");
        await obsidian.type("Bob");
        await obsidian.press("Enter");
        expect(await text()).toBe("Notes\n\n## Meeting Weekly\nAttendees: Bob\n\n<|>");
        expect(await placeholders(obsidian)).toEqual({ count: 0, empty: 0 });
    });

    test("continuation lines get the quote prefix of the first line", async () => {
        await openFreshNote(obsidian, "> <|>");
        await obsidian.type("meet");
        await selectAndInsert(obsidian, "meeting");
        expect((await obsidian.editor()).text).toBe("> ## Meeting title\n> Attendees: \n> \n> ");
    });

    test("continuation lines get the indentation of a list item", async () => {
        await openFreshNote(obsidian, "- <|>");
        await obsidian.type("meet");
        await selectAndInsert(obsidian, "meeting");
        expect((await obsidian.editor()).text).toBe("- ## Meeting title\n  Attendees: \n  \n  ");
    });

    test("# and ~ are plain text in snippets", async () => {
        await setSnippets([{ displayName: "todo", replacement: "#todo ~{{}}~" }]);
        await openFreshNote(obsidian, "<|>");
        await obsidian.type("tod");
        await selectAndInsert(obsidian, "todo");
        expect(await text()).toBe("#todo ~<|>~");
    });

    /** Types "meet" and expects the snippet not to be suggested (words from other providers may be). */
    async function expectNoMeetingSnippet(content: string) {
        await openFreshNote(obsidian, content);
        await obsidian.type("meet");
        const deadline = Date.now() + 250;
        while (Date.now() < deadline) {
            expect((await obsidian.popup()).items).not.toContain("meeting");
            await Bun.sleep(25);
        }
    }

    test("are not suggested in math", async () => {
        await expectNoMeetingSnippet("$$\n<|>\n$$");
        await expectNoMeetingSnippet("Text $<|>");
        await expectNoMeetingSnippet("Text $<|>$");
    });

    test("snippetsEnabled=false", async () => {
        await obsidian.setSettings({ snippetsEnabled: false });
        await expectNoMeetingSnippet("<|>");
    });

    test("a name starting with a word character only matches at the start of a word", async () => {
        await expectNoMeetingSnippet("home<|>");
        await expectNoMeetingSnippet("Text home<|>");
    });

    test("the popup shows the first line of what a snippet inserts", async () => {
        await openFreshNote(obsidian, "<|>");
        await obsidian.type("meet");
        await obsidian.waitForPopup((p) => p.items.includes("meeting"));
        const item = (await renderedItems(obsidian)).find((i) => i.text === "meeting");
        expect(item?.detail).toBe("## Meeting {{title}} …");
    });

    describe("a name starting with a non-word character (:sig)", () => {
        const SIG = { displayName: ":sig", replacement: "Best regards, {{}}" };
        beforeEach(() => setSnippets([MEETING, SIG]));

        async function expectNoSig() {
            const deadline = Date.now() + 250;
            while (Date.now() < deadline) {
                expect((await obsidian.popup()).items).not.toContain(":sig");
                await Bun.sleep(25);
            }
        }

        test("is not suggested after the trigger character alone", async () => {
            await openFreshNote(obsidian, "Text <|>");
            await obsidian.type(":");
            await expectNoSig();
        });

        test("is suggested after two characters, also right after a word, and replaces them", async () => {
            for (const before of ["Text ", "Text"]) {
                await openFreshNote(obsidian, `${before}<|>`);
                await obsidian.type(":s");
                await obsidian.waitForPopup((p) => p.items[0] === ":sig");
                expect((await renderedItems(obsidian))[0].detail).toBe("Best regards, {{}}");
                await obsidian.press("Enter");
                expect(await text()).toBe(`${before}Best regards, <|>`);
            }
        });
    });
});

test("'Create snippet from selection' opens the dialog with the selection, the snippet can be used right away", async () => {
    const original = await obsidian.eval(() =>
        app.plugins.plugins["obsidian-completr"]!.snippets.customEntries.entries.map((e) => ({ ...e })),
    );
    try {
        await openFreshNote(obsidian, "Sigzzone,\nSigzztwo\n<|>");
        await obsidian.eval(() => {
            const editor = app.workspace.activeEditor!.editor!;
            editor.setSelection({ line: 0, ch: 0 }, { line: 1, ch: 8 });
        });
        const name = await obsidian.eval(() => {
            const { commands } = app.commands as unknown as { commands: Record<string, { name: string }> };
            return commands["obsidian-completr:completr-create-snippet-from-selection"]?.name;
        });
        expect(name).toBe("Completr: Create snippet from selection");
        await obsidian.runCommand("completr-create-snippet-from-selection");

        expect(await waitForEntryModal(obsidian)).toEqual({
            title: "Add snippet",
            name: "",
            replacement: "Sigzzone,\nSigzztwo",
        });
        await fillEntryModal(obsidian, "sigteam", null);
        await clickModalButton(obsidian, "Add");
        await waitForNoModal(obsidian);
        expect(
            JSON.parse((await obsidian.readVaultFile(".obsidian/plugins/obsidian-completr/snippets.json"))!),
        ).toEqual([...original, { displayName: "sigteam", replacement: "Sigzzone,\nSigzztwo" }]);

        await openFreshNote(obsidian, "<|>");
        await obsidian.type("sigt");
        await selectAndInsert(obsidian, "sigteam");
        expect(await text()).toBe("Sigzzone,\nSigzztwo<|>");
    } finally {
        await obsidian.eval(
            (entries) => app.plugins.plugins["obsidian-completr"]!.snippets.customEntries.set(entries),
            original,
        );
        await forgetScannedWords(obsidian, ["Sigzzone", "Sigzztwo", "sigt"]);
    }
});

test("'Create snippet from selection' is not available without a selection", async () => {
    await openFreshNote(obsidian, "Some text<|>");
    const available = await obsidian.eval(() => {
        const commands = app.commands as unknown as {
            commands: Record<string, { editorCheckCallback?: (checking: boolean, editor: unknown) => boolean }>;
        };
        return commands.commands["obsidian-completr:completr-create-snippet-from-selection"].editorCheckCallback!(
            true,
            app.workspace.activeEditor!.editor!,
        );
    });
    expect(available).toBe(false);
});
