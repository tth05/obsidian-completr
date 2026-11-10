/**
 * Popup behavior and keybindings: opening/closing, selection, insertion, Tab/Escape/bypass keys, blacklisting,
 * manual triggering, custom hotkeys, and that the editor keys keep working while the popup is closed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { getObsidian, type Obsidian } from "./harness/obsidian.ts";
import {
    BLACKLIST_PATH,
    COMMANDS,
    DAN_WORDS,
    expectText,
    hasHotkeyManager,
    installWordList,
    openNote,
    paste,
    popupInternals,
    removeWordList,
    resetHotkeys,
    setHotkeys,
    setVimMode,
    unblacklist,
    vimInsertMode,
    waitForClosed,
    waitForItems,
    waitForSelected,
    XYL_WORDS,
} from "./helpers/popup_keys.ts";

let obsidian: Obsidian;
beforeAll(async () => {
    obsidian = await getObsidian();
    await installWordList(obsidian);
});
afterAll(async () => {
    await removeWordList(obsidian);
});
beforeEach(async () => {
    await obsidian.resetSettings();
    // Only the word list of this suite: no scanned words (which change while typing) and a stable order.
    await obsidian.setSettings({ fileScannerProviderEnabled: false, rankByUsage: false });
});

/** Opens an empty line and types `xyl`, which opens the popup with all {@link XYL_WORDS}. */
async function openXylPopup(before = "Some text\n", after = "") {
    await openNote(obsidian, before + "<|>" + after);
    await obsidian.type("xyl");
    return waitForItems(obsidian, XYL_WORDS);
}

describe("opening and closing", () => {
    test("opens once minWordTriggerLength characters are typed and filters while typing", async () => {
        await openNote(obsidian, "<|>");
        await obsidian.type("xy");
        await obsidian.expectNoPopup(150);
        await obsidian.type("l");
        expect((await waitForItems(obsidian, XYL_WORDS)).selected).toBe(0);
        await obsidian.type("o");
        await waitForItems(obsidian, ["xylophone"]);
    });

    test("respects a custom minWordTriggerLength", async () => {
        await obsidian.setSettings({ minWordTriggerLength: 5 });
        await openNote(obsidian, "<|>");
        await obsidian.type("xyli");
        await obsidian.expectNoPopup(150);
        await obsidian.type("t");
        await waitForItems(obsidian, ["xylitol"]);
    });

    test("closes when nothing matches anymore", async () => {
        await openXylPopup();
        await obsidian.type("q");
        await waitForClosed(obsidian);
        expect((await popupInternals(obsidian)).isOpen).toBe(false);
        await expectText(obsidian, "Some text\nxylq<|>");
    });

    test("closes when a non-word character is typed", async () => {
        await openXylPopup();
        await obsidian.type(" ");
        await waitForClosed(obsidian);
        await obsidian.expectNoPopup(100);
    });

    test("fast typing (no delay between keys) opens the popup for the final word", async () => {
        await openNote(obsidian, "<|>");
        await obsidian.type("Some text and xyli");
        await waitForItems(obsidian, ["xylitol"]);
    });

    test("closes on ArrowLeft and stays closed", async () => {
        await openXylPopup();
        await obsidian.press("ArrowLeft");
        await waitForClosed(obsidian);
        await obsidian.expectNoPopup(100);
        await expectText(obsidian, "Some text\nxy<|>l");
    });

    test("closes on ArrowRight", async () => {
        await openXylPopup("Some text\n", " end");
        await obsidian.press("ArrowRight");
        await waitForClosed(obsidian);
        await expectText(obsidian, "Some text\nxyl <|>end");
    });

    test("closes when the cursor is moved elsewhere (e.g. a click)", async () => {
        await openXylPopup();
        await obsidian.eval(() => app.workspace.activeEditor!.editor!.setCursor({ line: 0, ch: 2 }));
        await waitForClosed(obsidian);
        await obsidian.expectNoPopup(100);
    });

    test("Escape closes the popup without changing the text", async () => {
        await openXylPopup();
        await obsidian.press("Escape");
        await waitForClosed(obsidian);
        await expectText(obsidian, "Some text\nxyl<|>");
    });

    test("Escape right after typing closes the popup for good", async () => {
        await openXylPopup();
        // Obsidian updates the popup a moment after each keystroke. Escape comes before that.
        await obsidian.type("o");
        await obsidian.press("Escape");
        await waitForClosed(obsidian);
        await obsidian.expectNoPopup();
        await expectText(obsidian, "Some text\nxylo<|>");
    });

    test("pasting a word does not open the popup", async () => {
        await openNote(obsidian, "Some text\n<|>");
        await paste(obsidian, "xyl");
        await expectText(obsidian, "Some text\nxyl<|>");
        await obsidian.expectNoPopup();
    });

    test("Backspace does not open the popup while it is closed", async () => {
        await openNote(obsidian, "Some text\nxylit<|>");
        await obsidian.press("Backspace");
        await expectText(obsidian, "Some text\nxyli<|>");
        await obsidian.expectNoPopup();
    });

    test("Backspace updates the open popup and closes it below the minimum length", async () => {
        await openNote(obsidian, "<|>");
        await obsidian.type("xyli");
        await waitForItems(obsidian, ["xylitol"]);
        await obsidian.press("Backspace");
        await waitForItems(obsidian, XYL_WORDS);
        await obsidian.press("Backspace");
        await waitForClosed(obsidian);
        await expectText(obsidian, "xy<|>");
    });
});

describe("selection and insertion", () => {
    test("Enter inserts the selected item", async () => {
        await openXylPopup();
        await obsidian.press("Enter");
        await expectText(obsidian, "Some text\nxylem<|>");
        await obsidian.expectNoPopup(100);
    });

    test("ArrowDown/ArrowUp move the selection and wrap around", async () => {
        await openXylPopup();
        const highlight = async () => (await popupInternals(obsidian)).highlighted;
        expect(await popupInternals(obsidian)).toMatchObject({ focused: true, unfocusedClass: false, highlighted: 1 });

        await obsidian.press("ArrowDown");
        await waitForSelected(obsidian, 1);
        await obsidian.press("ArrowDown");
        await waitForSelected(obsidian, 2);
        await obsidian.press("ArrowDown");
        await waitForSelected(obsidian, 0);
        await obsidian.press("ArrowUp");
        await waitForSelected(obsidian, 2);
        expect(await highlight()).toBe(1);
        await obsidian.press("ArrowUp");
        await waitForSelected(obsidian, 1);

        // The arrows only moved the selection, not the cursor.
        await expectText(obsidian, "Some text\nxyl<|>");
        await obsidian.press("Enter");
        await expectText(obsidian, "Some text\nxylitol<|>");
    });

    test("replaces the whole typed word, also in the middle of a line", async () => {
        await openXylPopup("Before ", " after");
        await obsidian.press("ArrowUp");
        await waitForSelected(obsidian, 2);
        await obsidian.press("Enter");
        await expectText(obsidian, "Before xylophone<|> after");
    });
});

describe("autoFocus = false", () => {
    beforeEach(async () => {
        await obsidian.setSettings({ autoFocus: false });
    });

    test("the popup opens without a highlighted item", async () => {
        await openXylPopup();
        expect(await popupInternals(obsidian)).toMatchObject({ isOpen: true, focused: false, unfocusedClass: true });
    });

    test("Enter inserts a newline and closes the popup", async () => {
        await openXylPopup();
        await obsidian.press("Enter");
        await expectText(obsidian, "Some text\nxyl\n<|>");
        await obsidian.expectNoPopup(100);
    });

    test("ArrowDown focuses the first item, Enter then inserts it", async () => {
        await openXylPopup();
        await obsidian.press("ArrowDown");
        await waitForSelected(obsidian, 0);
        expect(await popupInternals(obsidian)).toMatchObject({ focused: true, unfocusedClass: false });
        await obsidian.press("Enter");
        await expectText(obsidian, "Some text\nxylem<|>");
    });

    test("ArrowUp from the unfocused popup selects the last item", async () => {
        await openXylPopup();
        await obsidian.press("ArrowUp");
        await waitForSelected(obsidian, 2);
        expect((await popupInternals(obsidian)).focused).toBe(true);
        await obsidian.press("Enter");
        await expectText(obsidian, "Some text\nxylophone<|>");
    });

    test("Shift+D types a D instead of blacklisting", async () => {
        await openXylPopup();
        await obsidian.type("D");
        await expectText(obsidian, "Some text\nxylD<|>");
        expect((await obsidian.readVaultFile(BLACKLIST_PATH)) ?? "").not.toContain("xylem");
    });

    test("insertWithTab: Tab without a selected item closes the popup and indents", async () => {
        await obsidian.setSettings({ insertWithTab: true });
        await openXylPopup();
        await obsidian.press("Tab");
        // Obsidian's Tab indents the line
        await expectText(obsidian, "Some text\n\txyl<|>");
        await obsidian.expectNoPopup(100);
    });
});

describe("Tab", () => {
    test("by default, Tab closes the popup and indents instead of inserting the suggestion", async () => {
        await openXylPopup();
        await obsidian.press("Tab");
        // Obsidian's Tab indents the line
        await expectText(obsidian, "Some text\n\txyl<|>");
        await obsidian.expectNoPopup(100);
    });

    test("insertWithTab: Tab inserts the selected suggestion", async () => {
        await obsidian.setSettings({ insertWithTab: true });
        await openXylPopup();
        await obsidian.press("ArrowDown");
        await waitForSelected(obsidian, 1);
        await obsidian.press("Tab");
        await expectText(obsidian, "Some text\nxylitol<|>");
        await obsidian.expectNoPopup(100);
    });

    // Issue #60
    test("indenting a list item with Tab does not open the popup", async () => {
        await openNote(obsidian, "- first\n- xyl<|>");
        await obsidian.press("Tab");
        await expectText(obsidian, "- first\n\t- xyl<|>");
        await obsidian.expectNoPopup();
        // Typing afterwards still works
        await obsidian.type("o");
        await waitForItems(obsidian, ["xylophone"]);
    });

    test("Tab in an empty list item indents without opening the popup", async () => {
        await openNote(obsidian, "- xylem\n- <|>");
        await obsidian.press("Tab");
        await expectText(obsidian, "- xylem\n\t- <|>");
        await obsidian.expectNoPopup();
    });
});

describe("bypass keys", () => {
    // Ctrl+Enter / Ctrl+Tab are also Obsidian's defaults for "open link in new tab" / "next tab". While the popup is
    // open, Completr's hotkeys take precedence.
    test("Ctrl+Enter closes the popup and inserts a plain newline", async () => {
        await openXylPopup();
        await obsidian.press("Enter", "Ctrl");
        await expectText(obsidian, "Some text\nxyl\n<|>");
        await obsidian.expectNoPopup(100);
    });

    // Ctrl+Enter / Ctrl+Tab are also Obsidian's defaults for "open link in new tab" / "next tab". While the popup is
    // open, Completr's hotkeys take precedence.
    test("Ctrl+Enter in a list closes the popup and continues the list", async () => {
        await openXylPopup("- item\n- ");
        await obsidian.press("Enter", "Ctrl");
        await expectText(obsidian, "- item\n- xyl\n- <|>");
    });

    // Ctrl+Enter / Ctrl+Tab are also Obsidian's defaults for "open link in new tab" / "next tab". While the popup is
    // open, Completr's hotkeys take precedence.
    test("Ctrl+Tab closes the popup and presses a plain Tab", async () => {
        await openXylPopup();
        await obsidian.press("Tab", "Ctrl");
        await expectText(obsidian, "Some text\n\txyl<|>");
        await obsidian.expectNoPopup(100);
    });

    test("the bypass commands also work when the core hotkeys are removed", async () => {
        // Removes Obsidian's own Ctrl+Enter / Ctrl+Tab hotkeys (open link in new tab, next tab) for this test.
        const core = ["editor:open-link-in-new-leaf", "workspace:next-tab"];
        for (const id of core) await setHotkeys(obsidian, id, []);
        try {
            await openXylPopup();
            await obsidian.press("Enter", "Ctrl");
            await expectText(obsidian, "Some text\nxyl\n<|>");
            await obsidian.expectNoPopup(100);

            await obsidian.type("xyl");
            await waitForItems(obsidian, XYL_WORDS);
            await obsidian.press("Tab", "Ctrl");
            await expectText(obsidian, "Some text\nxyl\n\txyl<|>");
            await obsidian.expectNoPopup(100);
        } finally {
            for (const id of core) await resetHotkeys(obsidian, id);
        }
    });
});

describe("vim mode", () => {
    test("Escape closes the popup and leaves insert mode", async () => {
        await setVimMode(obsidian, true);
        try {
            await openNote(obsidian, "Some text\n<|>");
            await obsidian.waitFor(async () => (await vimInsertMode(obsidian)) !== null, { what: "vim mode" });
            await obsidian.type("i");
            await obsidian.waitFor(() => vimInsertMode(obsidian), { what: "insert mode" });
            await obsidian.type("xyl");
            await waitForItems(obsidian, XYL_WORDS);

            await obsidian.press("Escape");
            await waitForClosed(obsidian);
            await obsidian.waitFor(async () => (await vimInsertMode(obsidian)) === false, { what: "normal mode" });
            // In normal mode, "x" deletes the character under the cursor instead of typing it.
            await obsidian.type("x");
            await expectText(obsidian, "Some text\nx<|>y");
        } finally {
            await setVimMode(obsidian, false);
        }
    });
});

describe("blacklist", () => {
    test("a capital D is typed even while the popup is focused", async () => {
        await openXylPopup();
        await obsidian.type("D");
        await expectText(obsidian, "Some text\nxylD<|>");
        expect((await obsidian.readVaultFile(BLACKLIST_PATH)) ?? "").not.toContain("xylem");
    });

    test("Mod+Shift+D blacklists the selected suggestion", async () => {
        try {
            await openNote(obsidian, "Some text\n<|>");
            await obsidian.type("dan");
            await waitForItems(obsidian, DAN_WORDS);
            await obsidian.press("D", "Mod", "Shift");
            await waitForItems(obsidian, ["dandelion"]);
            await expectText(obsidian, "Some text\ndan<|>");
            expect(await obsidian.readVaultFile(BLACKLIST_PATH)).toContain("dandruff");

            // Stays gone
            await openNote(obsidian, "Other text\n<|>");
            await obsidian.type("dan");
            await waitForItems(obsidian, ["dandelion"]);
        } finally {
            await unblacklist(obsidian, ["dandruff"]);
        }
        expect(await obsidian.readVaultFile(BLACKLIST_PATH)).not.toContain("dandruff");
    });
});

describe("manual trigger", () => {
    test("Mod+Space opens the popup below the minimum length with autoTrigger off", async () => {
        await obsidian.setSettings({ autoTrigger: false });
        await openNote(obsidian, "Some text\n<|>");
        await obsidian.type("xy");
        await obsidian.expectNoPopup(150);
        await obsidian.press(" ", "Mod");
        await waitForItems(obsidian, XYL_WORDS);
        await obsidian.press("Enter");
        await expectText(obsidian, "Some text\nxylem<|>");
    });

    // Issues #37, #53
    test("Mod+Space opens the popup with no typed characters", async () => {
        await openNote(obsidian, "Some text\n<|>");
        await obsidian.press(" ", "Mod");
        const popup = await obsidian.waitForPopup();
        for (const word of [...XYL_WORDS, ...DAN_WORDS]) expect(popup.items).toContain(word);
        await expectText(obsidian, "Some text\n<|>");
    });

    test("Mod+Space works after a space", async () => {
        await openNote(obsidian, "Some text <|>");
        await obsidian.press(" ", "Mod");
        const popup = await obsidian.waitForPopup();
        for (const word of XYL_WORDS) expect(popup.items).toContain(word);
        await expectText(obsidian, "Some text <|>");
    });

    test("a manually opened popup stays open while typing below the minimum length", async () => {
        await openNote(obsidian, "Some text\n<|>");
        // One and two characters, minWordTriggerLength is 3
        await obsidian.type("x");
        await obsidian.press(" ", "Mod");
        await waitForItems(obsidian, XYL_WORDS);
        await obsidian.type("y");
        await waitForItems(obsidian, XYL_WORDS);
        expect((await popupInternals(obsidian)).focused).toBe(true);
        await obsidian.type("li");
        await waitForItems(obsidian, ["xylitol"]);
        // Deleting characters again keeps it open as well
        await obsidian.press("Backspace");
        await obsidian.press("Backspace");
        await obsidian.press("Backspace");
        await waitForItems(obsidian, XYL_WORDS);
        await expectText(obsidian, "Some text\nx<|>");

        await obsidian.press("Enter");
        await expectText(obsidian, "Some text\nxylem<|>");
    });

    test("after a manually opened popup was closed, the minimum length applies again", async () => {
        await openNote(obsidian, "Some text\n<|>");
        await obsidian.type("x");
        await obsidian.expectNoPopup(150);
        await obsidian.press(" ", "Mod");
        await waitForItems(obsidian, XYL_WORDS);
        await obsidian.press("Escape");
        await waitForClosed(obsidian);

        await obsidian.type("y");
        await obsidian.expectNoPopup(150);
        await obsidian.type("l");
        await waitForItems(obsidian, XYL_WORDS);
    });

    test("a manually opened popup closes when nothing matches, the minimum length applies again", async () => {
        await openNote(obsidian, "Some text\n<|>");
        await obsidian.type("x");
        await obsidian.press(" ", "Mod");
        await waitForItems(obsidian, XYL_WORDS);
        await obsidian.type("q");
        await waitForClosed(obsidian);
        expect((await popupInternals(obsidian)).isOpen).toBe(false);

        await obsidian.press("Backspace");
        await obsidian.type("y");
        await expectText(obsidian, "Some text\nxy<|>");
        await obsidian.expectNoPopup(150);
        await obsidian.type("l");
        await waitForItems(obsidian, XYL_WORDS);
    });

    // Guards against manual mode outliving its word: the empty query after the space would list all known words.
    test("a manually opened popup closes when the word is finished with a space", async () => {
        await openNote(obsidian, "Some text\n<|>");
        await obsidian.type("x");
        await obsidian.press(" ", "Mod");
        await waitForItems(obsidian, XYL_WORDS);
        await obsidian.type("y ");
        await waitForClosed(obsidian);
        await obsidian.expectNoPopup(100);
        // Enter is a newline again, it doesn't insert a suggestion
        await obsidian.press("Enter");
        await expectText(obsidian, "Some text\nxy \n<|>");
    });

    /** Fails while the popup is closed during the next `ms` milliseconds. */
    async function expectPopupStaysOpen(ms: number) {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
            expect((await obsidian.popup()).visible, "the popup is still open").toBe(true);
            await Bun.sleep(25);
        }
    }

    // Guards against Obsidian's deferred re-trigger (about 20 ms later, empty query) ending manual mode.
    test("a popup opened with Mod+Space on an empty line stays open", async () => {
        await openNote(obsidian, "Some text\n<|>");
        await obsidian.press(" ", "Mod");
        await obsidian.waitForPopup((p) => p.items.includes("dandruff"));
        await expectPopupStaysOpen(300);
    });

    test("a popup opened on an empty line closes when a typed letter is deleted again", async () => {
        await openNote(obsidian, "Some text\n<|>");
        await obsidian.press(" ", "Mod");
        await obsidian.waitForPopup((p) => p.items.includes("dandruff"));
        await obsidian.type("x");
        await waitForItems(obsidian, XYL_WORDS);
        await obsidian.press("Backspace");
        await waitForClosed(obsidian);
        await expectText(obsidian, "Some text\n<|>");
    });

    // Guards against the refresh after hiding (empty query) ending manual mode.
    test("hiding a suggestion of a popup opened on an empty line keeps it open with the other words", async () => {
        await openNote(obsidian, "Some text\n<|>");
        await obsidian.press(" ", "Mod");
        const before = await obsidian.waitForPopup((p) => p.items.includes("dandruff") && p.selected === 0);
        const hidden = before.items[0];
        try {
            await obsidian.press("D", "Mod", "Shift");
            const after = await obsidian.waitForPopup((p) => !p.items.includes(hidden));
            // The rest of the list, in the same order
            expect(after.items.slice(0, before.items.length - 1)).toEqual(before.items.slice(1));
            for (const word of [...XYL_WORDS, ...DAN_WORDS].filter((w) => w !== hidden))
                expect(after.items).toContain(word);
            // It doesn't close a moment later either
            await expectPopupStaysOpen(300);
            await expectText(obsidian, "Some text\n<|>");
        } finally {
            await unblacklist(obsidian, [hidden]);
        }
    });

    test("the toggle auto trigger command switches automatic opening off and on", async () => {
        const toggle = () =>
            obsidian.eval((id: string) => {
                const commands = app.commands as unknown as { executeCommandById(id: string): boolean };
                return commands.executeCommandById(id);
            }, COMMANDS.toggleAutoTrigger);
        const autoTrigger = () => obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.settings.autoTrigger);

        await toggle();
        expect(await autoTrigger()).toBe(false);
        await openNote(obsidian, "<|>");
        await obsidian.type("xyl");
        await obsidian.expectNoPopup();
        // Manual opening still works
        await obsidian.press(" ", "Mod");
        await waitForItems(obsidian, XYL_WORDS);

        await toggle();
        expect(await autoTrigger()).toBe(true);
        await openNote(obsidian, "<|>");
        await obsidian.type("xyl");
        await waitForItems(obsidian, XYL_WORDS);
    });
});

describe("editor keys while the popup is closed", () => {
    test("Enter inserts a newline", async () => {
        await openNote(obsidian, "hello<|>");
        await obsidian.press("Enter");
        await expectText(obsidian, "hello\n<|>");
    });

    test("Enter continues a list", async () => {
        await openNote(obsidian, "- item<|>");
        await obsidian.press("Enter");
        await expectText(obsidian, "- item\n- <|>");
    });

    test("Enter works after the popup closed because nothing matched", async () => {
        await openXylPopup();
        await obsidian.type("q");
        await waitForClosed(obsidian);
        await obsidian.press("Enter");
        await expectText(obsidian, "Some text\nxylq\n<|>");
    });

    test("ArrowDown and ArrowUp move the cursor", async () => {
        await openNote(obsidian, "first<|>\nsecond");
        await obsidian.press("ArrowDown");
        await obsidian.waitFor(async () => (await obsidian.editor()).cursor > 6, { what: "cursor in line 2" });
        await obsidian.press("ArrowUp");
        await expectText(obsidian, "first<|>\nsecond");
    });

    test("Escape does nothing to the text, Tab indents", async () => {
        await openNote(obsidian, "hello<|>");
        await obsidian.press("Escape");
        await obsidian.press("Tab");
        await expectText(obsidian, "\thello<|>");
    });

    test("Shift+D types a capital D", async () => {
        await openNote(obsidian, "hello <|>");
        await obsidian.type("Dan");
        await expectText(obsidian, "hello Dan<|>");
    });
});

describe("custom hotkeys", () => {
    test("the hotkey manager internals exist", async () => {
        expect(await hasHotkeyManager(obsidian)).toBe(true);
    });

    test("insert rebound to Tab: Tab inserts, Enter closes the popup and makes a newline", async () => {
        await setHotkeys(obsidian, COMMANDS.insert, [{ modifiers: [], key: "Tab" }]);
        try {
            await openXylPopup();
            await obsidian.press("Tab");
            await expectText(obsidian, "Some text\nxylem<|>");

            await openXylPopup();
            await obsidian.press("Enter");
            await expectText(obsidian, "Some text\nxyl\n<|>");
            await obsidian.expectNoPopup(100);
        } finally {
            await resetHotkeys(obsidian, COMMANDS.insert);
        }
    });

    test("insert rebound to Tab: Tab and Enter work normally while the popup is closed", async () => {
        await setHotkeys(obsidian, COMMANDS.insert, [{ modifiers: [], key: "Tab" }]);
        try {
            await openNote(obsidian, "- item<|>");
            await obsidian.press("Tab");
            await expectText(obsidian, "\t- item<|>");
            await obsidian.press("Enter");
            await expectText(obsidian, "\t- item\n\t- <|>");
        } finally {
            await resetHotkeys(obsidian, COMMANDS.insert);
        }
    });
});

// Issue #67
describe("closing quote after a word", () => {
    test("typing a closing quote closes the popup", async () => {
        await openNote(obsidian, "Some text\n<|>");
        await obsidian.type('"xyl');
        await waitForItems(obsidian, XYL_WORDS);
        await obsidian.type('"');
        await waitForClosed(obsidian);
        await expectText(obsidian, 'Some text\n"xyl"<|>');
    });

    test("Enter after the closing quote makes a newline and does not append the word", async () => {
        await openNote(obsidian, "Some text\n<|>");
        await obsidian.type('"xyl');
        await waitForItems(obsidian, XYL_WORDS);
        await obsidian.type('"');
        await waitForClosed(obsidian);
        await obsidian.press("Enter");
        await expectText(obsidian, 'Some text\n"xyl"\n<|>');
    });
});
