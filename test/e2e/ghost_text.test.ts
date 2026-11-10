/**
 * Inline suggestions ("ghost text"): the rest of the best suggestion in grey after the cursor, Tab inserts it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { CustomEntry } from "../../src/provider/custom_suggestions.ts";
import { getObsidian, type Obsidian } from "./harness/obsidian.ts";
import { openFreshNote, placeholders } from "./helpers/latex.ts";
import { parkMouse } from "./helpers/mouse.ts";
import { hoverSuggestion } from "./helpers/popup_actions.ts";
import {
    expectText,
    paste,
    popupInternals,
    resetHotkeys,
    setHotkeys,
    setVimMode,
    vimInsertMode,
    waitForClosed,
    waitForItems,
    waitForSelected,
} from "./helpers/popup_keys.ts";
import { clickToggle, closeSettings, isToggleOn, openCompletrSettings, settingNames } from "./helpers/settings_tab.ts";
import { forgetScannedWords, removeWordLists, setWordList } from "./helpers/words.ts";

const WORD_LIST = "ghost_text.txt";
const NOTE = "ghost-text.md";
const ACCEPT_COMMAND = "obsidian-completr:completr-accept-inline-suggestion";
/** Shortest first, the default sort order. */
const ZEB_WORDS = ["zebra", "zebrafish"];
const VEX_WORDS = ["Vexillum", "vexillology"];
const SNIPPET: CustomEntry = { displayName: "zsig", replacement: "zsignature: {{name}}, done{{cursor}}" };

let obsidian: Obsidian;
let snippetsBefore: CustomEntry[];
beforeAll(async () => {
    obsidian = await getObsidian();
    await setWordList(obsidian, WORD_LIST, [...ZEB_WORDS, ...VEX_WORDS]);
    snippetsBefore = await obsidian.eval(() =>
        app.plugins.plugins["obsidian-completr"]!.snippets.customEntries.entries.map((e) => ({ ...e })),
    );
    await setSnippets([SNIPPET]);
});
afterAll(async () => {
    await removeWordLists(obsidian, WORD_LIST);
    // The scanner is off in these tests, but a scan that was pending when a test turned it back on could learn them
    await forgetScannedWords(obsidian, [...ZEB_WORDS, ...VEX_WORDS, "zeb", "zebr", "vex", "zsignature"]);
    await setSnippets(snippetsBefore);
    await obsidian.resetSettings();
});
beforeEach(async () => {
    await obsidian.resetSettings();
    // Only the words of this suite (no scanned words, which change while typing) in a stable order. The popup only
    // opens on request, so the inline suggestions are computed on their own.
    await obsidian.setSettings({
        inlineSuggestions: true,
        autoTrigger: false,
        fileScannerProviderEnabled: false,
        rankByUsage: false,
    });
});

function setSnippets(entries: CustomEntry[]) {
    return obsidian.eval(
        (entries: CustomEntry[]) => app.plugins.plugins["obsidian-completr"]!.snippets.customEntries.set(entries),
        entries,
    );
}

function openNote(content: string) {
    return obsidian.openNote(content, { path: NOTE });
}

/** The ghost texts in the active editor. */
function ghosts(): Promise<string[]> {
    return obsidian.eval(() =>
        Array.from(
            app.workspace.activeEditor!.editor!.cm.dom.querySelectorAll(".completr-ghost-text"),
            (el) => el.textContent ?? "",
        ),
    );
}

async function waitForGhost(text: string) {
    let last: string[] = [];
    try {
        await obsidian.waitFor(
            async () => {
                last = await ghosts();
                return last.length === 1 && last[0] === text;
            },
            { what: "ghost text" },
        );
    } catch {
        throw new Error(`Expected ghost text "${text}", got ${JSON.stringify(last)}`);
    }
}

/** Asserts that no ghost text is shown during the next `ms` milliseconds. */
async function expectNoGhost(ms = 150) {
    const deadline = Date.now() + ms;
    do {
        expect(await ghosts()).toEqual([]);
        await Bun.sleep(25);
    } while (Date.now() < deadline);
}

async function waitForNoGhost() {
    await obsidian.waitFor(async () => (await ghosts()).length === 0, { what: "the ghost text to disappear" });
}

/** The ghost text must never be part of the note. */
async function expectValue(value: string) {
    expect(await obsidian.eval(() => app.workspace.activeEditor!.editor!.getValue())).toBe(value);
}

describe("setting", () => {
    test("is off by default: no ghost text, also with the popup open", async () => {
        await obsidian.resetSettings();
        expect(await obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.settings.inlineSuggestions)).toBe(
            false,
        );
        await obsidian.setSettings({ fileScannerProviderEnabled: false, rankByUsage: false });
        await openNote("<|>");
        await obsidian.type("zeb");
        await waitForItems(obsidian, ZEB_WORDS);
        await expectNoGhost();
    });

    test("is shown in the settings right after 'Open automatically' and can be toggled", async () => {
        await obsidian.resetSettings();
        try {
            await openCompletrSettings(obsidian);
            const names = await settingNames(obsidian, null);
            expect(names[names.indexOf("Open automatically") + 1]).toBe("Inline suggestions");
            expect(await isToggleOn(obsidian, null, "Inline suggestions")).toBe(false);
            await clickToggle(obsidian, null, "Inline suggestions");
            await obsidian.waitFor(
                () => obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.settings.inlineSuggestions),
                { what: "the setting to be on" },
            );
        } finally {
            await closeSettings(obsidian);
        }
    });
});

describe("showing", () => {
    test("typing shows the rest of the best suggestion once the minimum length is reached", async () => {
        await openNote("Some text <|>");
        await obsidian.type("ze");
        await expectNoGhost(100);
        await obsidian.type("b");
        await waitForGhost("ra");
        // Not part of the text, and the cursor didn't move
        await expectText(obsidian, "Some text zeb<|>");
        await expectValue("Some text zeb");
        await obsidian.expectNoPopup(50);
    });

    test("follows while typing", async () => {
        await openNote("<|>");
        await obsidian.type("zeb");
        await waitForGhost("ra");
        await obsidian.type("r");
        await waitForGhost("a");
        await obsidian.type("a");
        // "zebra" itself is typed, "zebrafish" is left
        await waitForGhost("fish");
        await obsidian.type(" ");
        await expectNoGhost();
    });

    test("not in the middle of a word", async () => {
        await openNote("<|>x tail");
        await obsidian.type("zeb");
        await expectNoGhost();
        await openNote("<|> tail");
        await obsidian.type("zeb");
        await waitForGhost("ra");
    });

    test("a suggestion that changes the typed case is skipped for the next one", async () => {
        await openNote("<|>");
        // "Vexillum" would rewrite "vex"
        await obsidian.type("vex");
        await waitForGhost("illology");
        await openNote("<|>");
        await obsidian.type("Vex");
        await waitForGhost("illum");
        // Neither keeps "VEX"
        await openNote("<|>");
        await obsidian.type("VEX");
        await expectNoGhost();
    });

    test("moving the cursor, pasting and deleting don't show it", async () => {
        await openNote("<|>");
        await obsidian.type("zeb");
        await waitForGhost("ra");
        await obsidian.press("ArrowLeft");
        await expectNoGhost(50);
        await obsidian.press("ArrowRight");
        await expectNoGhost(50);
        await expectText(obsidian, "zeb<|>");

        await openNote("Some text <|>");
        await paste(obsidian, "zeb");
        await expectText(obsidian, "Some text zeb<|>");
        await expectNoGhost();

        await openNote("Some text zebr<|>");
        await obsidian.press("Backspace");
        await expectText(obsidian, "Some text zeb<|>");
        await expectNoGhost();
    });

    test("losing the focus hides it", async () => {
        await openNote("<|>");
        await obsidian.type("zeb");
        await waitForGhost("ra");
        await obsidian.eval(() => app.workspace.activeEditor!.editor!.cm.contentDOM.blur());
        // CodeMirror reports the focus change a moment later
        await waitForNoGhost();
    });
});

describe("Tab", () => {
    test("inserts the word", async () => {
        await openNote("Some <|> text");
        await obsidian.type("zeb");
        await waitForGhost("ra");
        await obsidian.press("Tab");
        await expectText(obsidian, "Some zebra<|> text");
        await expectNoGhost(50);
    });

    // Snippet placeholders survive replacing the text of a note, so these use notes of their own
    test("inserts a LaTeX command with its placeholders", async () => {
        await openFreshNote(obsidian, "$<|>$");
        await obsidian.type("\\fr");
        await waitForGhost("ac{}{}");
        await obsidian.press("Tab");
        await expectText(obsidian, "$\\frac{<|>}{}$");
        expect(await placeholders(obsidian)).toEqual({ count: 2, empty: 2 });
        await obsidian.type("a");
        await obsidian.press("Enter");
        await expectText(obsidian, "$\\frac{a}{<|>}$");
    });

    test("inserts a snippet and selects its first placeholder", async () => {
        await openFreshNote(obsidian, "<|>");
        await obsidian.type("zsi");
        await waitForGhost("gnature: name, done");
        await obsidian.press("Tab");
        await expectValue("zsignature: name, done");
        expect(await obsidian.eval(() => app.workspace.activeEditor!.editor!.getSelection())).toBe("name");
    });

    test("without ghost text, Tab does what it always does", async () => {
        await openNote("zeb<|>");
        await obsidian.press("Tab");
        await expectText(obsidian, "\tzeb<|>");
    });
});

describe("Escape", () => {
    test("hides it, the next typed character brings it back", async () => {
        await openNote("<|>");
        await obsidian.type("zeb");
        await waitForGhost("ra");
        await obsidian.press("Escape");
        await expectNoGhost();
        await expectText(obsidian, "zeb<|>");
        // Tab is a normal Tab again
        await obsidian.press("Tab");
        await expectText(obsidian, "\tzeb<|>");
        await obsidian.type("r");
        await waitForGhost("a");
    });

    test("vim mode: hides it and leaves insert mode", async () => {
        await setVimMode(obsidian, true);
        try {
            await openNote("Some text\n<|>");
            await obsidian.waitFor(async () => (await vimInsertMode(obsidian)) !== null, { what: "vim mode" });
            await obsidian.type("i");
            await obsidian.waitFor(() => vimInsertMode(obsidian), { what: "insert mode" });
            await obsidian.type("zeb");
            await waitForGhost("ra");
            await obsidian.press("Escape");
            await obsidian.waitFor(async () => (await vimInsertMode(obsidian)) === false, { what: "normal mode" });
            await expectNoGhost(50);
        } finally {
            await setVimMode(obsidian, false);
        }
    });
});

describe("with the popup", () => {
    beforeEach(async () => {
        await obsidian.setSettings({ autoTrigger: true });
    });

    test("shows the selected item, follows the arrow keys and the mouse, Tab inserts it", async () => {
        await openNote("<|>");
        await parkMouse(obsidian);
        await obsidian.type("zeb");
        await waitForItems(obsidian, ZEB_WORDS);
        await waitForGhost("ra");
        await obsidian.press("ArrowDown");
        await waitForSelected(obsidian, 1);
        await waitForGhost("rafish");
        await obsidian.press("ArrowUp");
        await waitForGhost("ra");
        await hoverSuggestion(obsidian, "zebrafish");
        await waitForGhost("rafish");
        await obsidian.press("Tab");
        await expectText(obsidian, "zebrafish<|>");
        await waitForClosed(obsidian);
        await expectNoGhost(50);
        await parkMouse(obsidian);
    });

    test("a selected item that changes the typed text has no ghost text, Tab then closes the popup and indents", async () => {
        await openNote("<|>");
        await obsidian.type("vex");
        await waitForItems(obsidian, VEX_WORDS);
        await expectNoGhost(100);
        await obsidian.press("ArrowDown");
        await waitForGhost("illology");
        await obsidian.press("ArrowUp");
        await waitForSelected(obsidian, 0);
        await expectNoGhost(50);
        await obsidian.press("Tab");
        await expectText(obsidian, "\tvex<|>");
        await waitForClosed(obsidian);
    });

    test("Insert with Tab: Tab inserts the selected item of the focused popup", async () => {
        await obsidian.setSettings({ insertWithTab: true });
        await openNote("<|>");
        await obsidian.type("vex");
        await waitForItems(obsidian, VEX_WORDS);
        await obsidian.press("Tab");
        await expectText(obsidian, "Vexillum<|>");
    });

    test("Insert with Tab and an unfocused popup: Tab inserts the ghost text of the first item", async () => {
        await obsidian.setSettings({ autoFocus: false, insertWithTab: true });
        await openNote("<|>");
        await obsidian.type("zeb");
        await waitForItems(obsidian, ZEB_WORDS);
        expect((await popupInternals(obsidian)).focused).toBe(false);
        await waitForGhost("ra");
        await obsidian.press("Tab");
        await expectText(obsidian, "zebra<|>");
        await waitForClosed(obsidian);
    });

    test("typing the next character keeps it while the popup updates, Escape closes both", async () => {
        await openNote("<|>");
        await obsidian.type("zeb");
        await waitForGhost("ra");
        await obsidian.type("r");
        // Right away, before the popup has updated its list
        expect(await ghosts()).toEqual(["a"]);
        // Same items as before, the query tells when the popup has updated
        await obsidian.waitFor(
            () => obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.popup.context?.query === "zebr"),
            { what: "the popup to update" },
        );
        await waitForGhost("a");
        await obsidian.press("Escape");
        await waitForClosed(obsidian);
        await expectNoGhost();
        await expectText(obsidian, "zebr<|>");
    });
});

describe("the accept command", () => {
    test("bound to ArrowRight: accepts the ghost text, moves the cursor without one", async () => {
        await setHotkeys(obsidian, ACCEPT_COMMAND, [{ modifiers: [], key: "ArrowRight" }]);
        try {
            await openNote("<|>");
            await obsidian.type("zeb");
            await waitForGhost("ra");
            await obsidian.press("ArrowRight");
            await expectText(obsidian, "zebra<|>");

            await openNote("ab<|>cd");
            await obsidian.press("ArrowRight");
            await expectText(obsidian, "abc<|>d");

            // With the popup open, too
            await obsidian.setSettings({ autoTrigger: true });
            await openNote("<|>");
            await obsidian.type("zeb");
            await waitForItems(obsidian, ZEB_WORDS);
            await obsidian.press("ArrowDown");
            await waitForGhost("rafish");
            await obsidian.press("ArrowRight");
            await expectText(obsidian, "zebrafish<|>");
            await waitForClosed(obsidian);
        } finally {
            await resetHotkeys(obsidian, ACCEPT_COMMAND);
        }
    });
});
