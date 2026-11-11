/**
 * "Period after double space": after a completed word got a space appended, Space turns it into ". ".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { getObsidian, type Obsidian } from "./harness/obsidian.ts";
import { expectText, setVimMode, vimInsertMode, waitForClosed } from "./helpers/popup_keys.ts";
import { closeSettings, isToggleOn, openCompletrSettings, settingNames } from "./helpers/settings_tab.ts";
import { forgetScannedWords, removeWordLists, setWordList } from "./helpers/words.ts";

const WORD_LIST = "e2e-period.txt";
const WORDS = ["flabbergast", "flabbergasted"];
const NOTE = "period-e2e.md";

let obsidian: Obsidian;
beforeAll(async () => {
    obsidian = await getObsidian();
    await setWordList(obsidian, WORD_LIST, WORDS);
});
afterAll(async () => {
    await removeWordLists(obsidian, WORD_LIST);
    await forgetScannedWords(obsidian, [...WORDS, "flabb"]);
    await obsidian.resetSettings();
});
beforeEach(async () => {
    await obsidian.resetSettings();
    // Only the words of this suite, in a stable order
    await obsidian.setSettings({
        insertSpaceAfterWord: true,
        insertPeriodAfterSpace: true,
        fileScannerProviderEnabled: false,
        rankByUsage: false,
    });
});

function openNote(content: string) {
    return obsidian.openNote(content, { path: NOTE });
}

/** Completes "flabb" to "flabbergast " with the popup. */
async function complete(before = "") {
    await obsidian.type("flabb");
    await obsidian.waitForPopup((p) => p.items[0] === "flabbergast");
    await obsidian.press("Enter");
    await expectText(obsidian, before + "flabbergast <|>");
    await waitForClosed(obsidian);
}

describe("setting", () => {
    test("is off by default: a second space stays a space", async () => {
        await obsidian.resetSettings();
        expect(
            await obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.settings.insertPeriodAfterSpace),
        ).toBe(false);
        await obsidian.setSettings({
            insertSpaceAfterWord: true,
            fileScannerProviderEnabled: false,
            rankByUsage: false,
        });
        await openNote("<|>");
        await complete();
        await obsidian.type(" ");
        await expectText(obsidian, "flabbergast  <|>");
    });

    test("is shown in the Words group right after 'Add space after words'", async () => {
        await obsidian.resetSettings();
        try {
            await openCompletrSettings(obsidian);
            const names = await settingNames(obsidian, "Words");
            expect(names[names.indexOf("Add space after words") + 1]).toBe("Period after double space");
            expect(await isToggleOn(obsidian, "Words", "Period after double space")).toBe(false);
        } finally {
            await closeSettings(obsidian);
        }
    });

    test("does nothing without 'Add space after words'", async () => {
        await obsidian.setSettings({ insertSpaceAfterWord: false });
        await openNote("<|>");
        await obsidian.type("flabb");
        await obsidian.waitForPopup((p) => p.items[0] === "flabbergast");
        await obsidian.press("Enter");
        await expectText(obsidian, "flabbergast<|>");
        await obsidian.type("  ");
        await expectText(obsidian, "flabbergast  <|>");
    });
});

describe("Space after a completed word", () => {
    test("turns the added space into '. ', typing continues after it", async () => {
        await openNote("Some text <|>");
        await complete("Some text ");
        await obsidian.type(" ");
        await expectText(obsidian, "Some text flabbergast. <|>");
        // Only once
        await obsidian.type(" Next");
        await expectText(obsidian, "Some text flabbergast.  Next<|>");
    });

    test("is one undo step back to the completed word with its space", async () => {
        await openNote("<|>");
        await complete();
        await obsidian.type(" ");
        await expectText(obsidian, "flabbergast. <|>");
        await obsidian.press("z", "Mod");
        await expectText(obsidian, "flabbergast <|>");
        // Undoing doesn't arm it again
        await obsidian.type(" ");
        await expectText(obsidian, "flabbergast  <|>");
    });

    test("moving the cursor first cancels it, also when it comes back", async () => {
        await openNote("<|>");
        await complete();
        await obsidian.press("ArrowLeft");
        await obsidian.press("ArrowRight");
        await obsidian.type(" ");
        await expectText(obsidian, "flabbergast  <|>");
    });

    test("another key first cancels it", async () => {
        await openNote("<|>");
        await complete();
        // Changes nothing in the note
        await obsidian.press("Escape");
        await obsidian.type(" ");
        await expectText(obsidian, "flabbergast  <|>");

        await openNote("<|>");
        await complete();
        await obsidian.type("x");
        await obsidian.press("Backspace");
        await expectText(obsidian, "flabbergast <|>");
        await obsidian.type(" ");
        await expectText(obsidian, "flabbergast  <|>");
    });

    test("opening the popup first cancels it", async () => {
        await openNote("<|>");
        await complete();
        // There is no word in front of the cursor, so the popup may have nothing to show
        await obsidian.press(" ", "Mod");
        await Bun.sleep(100);
        if ((await obsidian.popup()).visible) {
            await obsidian.press("Escape");
            await waitForClosed(obsidian);
        }
        await obsidian.type(" ");
        await expectText(obsidian, "flabbergast  <|>");
    });

    test("works after accepting an inline suggestion with Tab", async () => {
        await obsidian.setSettings({ inlineSuggestions: true, autoTrigger: false });
        await openNote("<|>");
        await obsidian.type("flabb");
        await obsidian.waitFor(
            () =>
                obsidian.eval(
                    () =>
                        app.workspace.activeEditor!.editor!.cm.dom.querySelector(".completr-ghost-text")
                            ?.textContent === "ergast",
                ),
            { what: "ghost text" },
        );
        await obsidian.press("Tab");
        await expectText(obsidian, "flabbergast <|>");
        await obsidian.type(" ");
        await expectText(obsidian, "flabbergast. <|>");
    });

    test("works in vim's insert mode", async () => {
        await setVimMode(obsidian, true);
        try {
            await openNote("<|>");
            await obsidian.waitFor(async () => (await vimInsertMode(obsidian)) !== null, { what: "vim mode" });
            await obsidian.type("i");
            await obsidian.waitFor(() => vimInsertMode(obsidian), { what: "insert mode" });
            await complete();
            await obsidian.type(" ");
            await expectText(obsidian, "flabbergast. <|>");
        } finally {
            await obsidian.press("Escape");
            await setVimMode(obsidian, false);
        }
    });
});
