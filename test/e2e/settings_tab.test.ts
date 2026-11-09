import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, SortOrder } from "../../src/settings.ts";
import { getObsidian, type Obsidian } from "./harness/obsidian.ts";
import { startErrorCapture, takeErrors } from "./helpers/errors.ts";
import {
    chooseFiles,
    clickButton,
    clickExtraButton,
    clickModalButton,
    clickToggle,
    closeSettings,
    getTextInput,
    groupHeadings,
    isSettingsTabOpen,
    isToggleOn,
    openCompletrSettings,
    readDataJson,
    selectDropdown,
    setTextInput,
    settingNames,
    topModalText,
} from "./helpers/settings_tab.ts";
import {
    deleteNotes,
    forgetScannedWords,
    isScanned,
    removeWordLists,
    setWordList,
    waitForScanned,
} from "./helpers/words.ts";

let obsidian: Obsidian;
const NOTE = "settings-e2e.md";

beforeAll(async () => {
    obsidian = await getObsidian();
});
beforeEach(async () => {
    await obsidian.resetSettings();
});
afterEach(async () => {
    // Close leftover modals (e.g. after a failed test) and the settings
    await obsidian.eval(() => {
        for (const close of Array.from(
            document.querySelectorAll<HTMLElement>(".modal:not(.mod-settings) .modal-close-button"),
        ))
            close.click();
    });
    await closeSettings(obsidian);
});
afterAll(async () => {
    await obsidian.resetSettings();
    await obsidian.openNote("", { path: "test.md" });
    await deleteNotes(obsidian, [NOTE]);
});

function settings() {
    return obsidian.eval(() => ({ ...app.plugins.plugins["obsidian-completr"]!.settings }));
}

async function waitForSaved<K extends keyof typeof DEFAULT_SETTINGS>(key: K, value: (typeof DEFAULT_SETTINGS)[K]) {
    await obsidian.waitFor(async () => (await readDataJson(obsidian))[key] === value, {
        what: `${key} = ${JSON.stringify(value)} in data.json`,
    });
}

test("renders all sections without errors", async () => {
    await startErrorCapture(obsidian);
    await openCompletrSettings(obsidian);
    expect(await isSettingsTabOpen(obsidian)).toBe(true);
    const headings = await groupHeadings(obsidian);
    for (const heading of [
        "Words",
        "LaTeX",
        "Custom LaTeX commands",
        "Front matter",
        "File scanner",
        "Word lists",
        "Callouts",
        "Blacklist",
    ])
        expect(headings).toContain(heading);
    expect(await settingNames(obsidian, null)).toContain("Open automatically");
    expect(await settingNames(obsidian, "Words")).toContain("Word characters");
    // Rendering happens partly asynchronously (word list files)
    await Bun.sleep(100);
    expect(await takeErrors(obsidian)).toEqual([]);

    await closeSettings(obsidian);
    expect(await isSettingsTabOpen(obsidian)).toBe(false);
});

test("toggles, dropdowns and numbers are saved to data.json", async () => {
    await openCompletrSettings(obsidian);
    expect(await isToggleOn(obsidian, "Words", "Fuzzy matching")).toBe(false);
    await clickToggle(obsidian, "Words", "Fuzzy matching");
    expect(await isToggleOn(obsidian, "Words", "Fuzzy matching")).toBe(true);
    await waitForSaved("fuzzyMatching", true);
    expect((await settings()).fuzzyMatching).toBe(true);

    await clickToggle(obsidian, "File scanner", "Only words from the current note");
    await waitForSaved("fileScannerCurrentFileOnly", true);
    await clickToggle(obsidian, "File scanner", "Only words from the current note");
    await waitForSaved("fileScannerCurrentFileOnly", false);

    await selectDropdown(obsidian, "Words", "Sort order", SortOrder.ALPHABETICAL);
    await waitForSaved("sortOrder", SortOrder.ALPHABETICAL);

    await setTextInput(obsidian, "Words", "Minimum word length", "5");
    await waitForSaved("minWordLength", 5);
    // Below the minimum: ignored
    await setTextInput(obsidian, "Words", "Minimum word length", "0");
    await Bun.sleep(100);
    expect((await readDataJson(obsidian)).minWordLength).toBe(5);

    // The settings tab shows the saved values when opened again
    await closeSettings(obsidian);
    await openCompletrSettings(obsidian);
    expect(await isToggleOn(obsidian, "Words", "Fuzzy matching")).toBe(true);
    expect(await getTextInput(obsidian, "Words", "Minimum word length")).toBe("5");
});

test("an invalid word characters regex is marked and not saved", async () => {
    await openCompletrSettings(obsidian);
    expect(await getTextInput(obsidian, "Words", "Word characters")).toBe(DEFAULT_SETTINGS.characterRegex);

    for (const invalid of ["\\p{NoSuchProperty}", "z-a", ""]) {
        const classes = await setTextInput(obsidian, "Words", "Word characters", invalid);
        expect(classes, invalid).toContain("completr-settings-error");
    }
    await Bun.sleep(100);
    expect((await readDataJson(obsidian)).characterRegex).toBe(DEFAULT_SETTINGS.characterRegex);
    expect((await settings()).characterRegex).toBe(DEFAULT_SETTINGS.characterRegex);

    const classes = await setTextInput(obsidian, "Words", "Word characters", "a-z0-9");
    expect(classes).not.toContain("completr-settings-error");
    await waitForSaved("characterRegex", "a-z0-9");
});

test("scans the whole vault after confirmation", async () => {
    await obsidian.writeVaultFile("settings-e2e-unopened.md", "Contains vaultscanwordzz only here.");
    try {
        expect(await isScanned(obsidian, "vaultscanwordzz")).toBe(false);
        await openCompletrSettings(obsidian);
        await clickExtraButton(obsidian, "File scanner", null, "Scan all notes in the vault now");
        expect(await topModalText(obsidian)).toContain("Scan the whole vault?");
        await clickModalButton(obsidian, "Scan");
        await waitForScanned(obsidian, "vaultscanwordzz", 5_000);
    } finally {
        await deleteNotes(obsidian, ["settings-e2e-unopened.md"]);
        await forgetScannedWords(obsidian, ["vaultscanwordzz"]);
    }
});

describe("blacklist", () => {
    const WORDS = ["blackwordalpha", "blackwordbeta"];
    let originalBlacklist: string | null = null;

    async function blacklistFile() {
        const path = join(obsidian.pluginDir, "blacklisted_suggestions.txt");
        return existsSync(path) ? await Bun.file(path).text() : null;
    }

    beforeAll(async () => {
        // Start without a blacklist file, to check that it gets created (#78)
        originalBlacklist = await obsidian.eval(async () => {
            const plugin = app.plugins.plugins["obsidian-completr"]!;
            const original = await plugin.files.read("blacklisted_suggestions.txt");
            await plugin.files.remove("blacklisted_suggestions.txt");
            await plugin.blacklist.load();
            return original;
        });
        await setWordList(obsidian, "e2e-blacklist.txt", WORDS);
    });
    afterAll(async () => {
        await obsidian.eval(async (original: string | null) => {
            const plugin = app.plugins.plugins["obsidian-completr"]!;
            if (original === null) await plugin.files.remove("blacklisted_suggestions.txt");
            else await plugin.files.write("blacklisted_suggestions.txt", original);
            await plugin.blacklist.load();
        }, originalBlacklist);
        await removeWordLists(obsidian, "e2e-blacklist.txt");
        await forgetScannedWords(obsidian, WORDS);
    });

    test("Mod+Shift+D blacklists the selected suggestion and creates the file in the plugin folder (#78)", async () => {
        expect(await blacklistFile()).toBeNull();
        await obsidian.openNote("<|>", { path: NOTE });
        await obsidian.type("blackw");
        await obsidian.waitForPopup((p) => p.items[0] === "blackwordbeta" && p.items.includes("blackwordalpha"));
        await obsidian.press("D", "Mod", "Shift");
        // The popup updates right away
        const popup = await obsidian.waitForPopup((p) => !p.items.includes("blackwordbeta"));
        expect(popup.items).toContain("blackwordalpha");
        expect((await obsidian.editor()).text).toBe("blackw");

        await obsidian.waitFor(async () => (await blacklistFile()) === "blackwordbeta", {
            what: "the blacklist file",
        });
        const pluginFolder = await obsidian.eval(() => app.plugins.plugins["obsidian-completr"]!.manifest.dir);
        expect(pluginFolder).toBe(".obsidian/plugins/obsidian-completr");

        await obsidian.press("D", "Mod", "Shift");
        await obsidian.waitFor(async () => !(await obsidian.popup()).visible, { what: "the popup to close" });
        await obsidian.waitFor(async () => (await blacklistFile()) === "blackwordbeta\nblackwordalpha", {
            what: "the blacklist file",
        });
        expect((await obsidian.editor()).text).toBe("blackw");
    });

    test("the settings list the blacklisted suggestions, which can be filtered and removed (#23)", async () => {
        await obsidian.eval(async (words: string[]) => {
            const plugin = app.plugins.plugins["obsidian-completr"]!;
            for (const w of words) await plugin.blacklistSuggestion(w);
        }, WORDS);
        await openCompletrSettings(obsidian);
        expect(await settingNames(obsidian, "Blacklist")).toEqual(WORDS);

        // Filter
        const visible = await obsidian.eval(() => {
            const input = window.__e2eFindSetting!("Blacklist", null).querySelector<HTMLInputElement>(
                "input[type=search]",
            )!;
            input.value = "BETA";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            return Array.from(document.querySelectorAll<HTMLElement>(".completr-blacklist-item"))
                .filter((el) => el.isShown())
                .map((el) => el.dataset.entry);
        });
        expect(visible).toEqual(["blackwordbeta"]);

        await clickExtraButton(obsidian, "Blacklist", "blackwordalpha", "Remove from blacklist");
        await obsidian.waitFor(
            async () => JSON.stringify(await settingNames(obsidian, "Blacklist")) === '["blackwordbeta"]',
            { what: "the entry to disappear" },
        );
        expect(await blacklistFile()).toBe("blackwordbeta");

        await clickExtraButton(obsidian, "Blacklist", "blackwordbeta", "Remove from blacklist");
        await obsidian.waitFor(async () => (await settingNames(obsidian, "Blacklist")).length === 0, {
            what: "the list to be empty",
        });
        expect(await blacklistFile()).toBe("");
    });

    test("a word list word removed from the blacklist is suggested again", async () => {
        await obsidian.eval(async () => {
            await app.plugins.plugins["obsidian-completr"]!.blacklistSuggestion("blackwordalpha");
        });
        await openCompletrSettings(obsidian);
        await clickExtraButton(obsidian, "Blacklist", "blackwordalpha", "Remove from blacklist");
        await obsidian.waitFor(async () => (await settingNames(obsidian, "Blacklist")).length === 0, {
            what: "the list to be empty",
        });
        await closeSettings(obsidian);

        await obsidian.openNote("<|>", { path: NOTE });
        await obsidian.type("blackw");
        await obsidian.waitForPopup((p) => p.items.includes("blackwordalpha"));
    });
});

test("custom LaTeX commands can be added and removed", async () => {
    const original = await obsidian.eval(() =>
        app.plugins.plugins["obsidian-completr"]!.latex.getCustomCommands().map((c) => ({ ...c })),
    );
    try {
        await openCompletrSettings(obsidian);
        await clickButton(obsidian, "Custom LaTeX commands", null, "Add command");
        expect(await topModalText(obsidian)).toContain("Add LaTeX command");

        // An empty replacement is rejected
        await clickModalButton(obsidian, "Add");
        expect(await topModalText(obsidian)).toContain("Add LaTeX command");

        await obsidian.eval(() => {
            const modal = Array.from(document.querySelectorAll(".modal:not(.mod-settings)")).at(-1)!;
            const textarea = modal.querySelector<HTMLTextAreaElement>("textarea")!;
            textarea.value = "\\eecmd{#}{#}";
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
            const name = modal.querySelector<HTMLInputElement>("input[type=text]")!;
            name.value = "\\eecmd";
            name.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await clickModalButton(obsidian, "Add");
        await obsidian.waitFor(async () => (await topModalText(obsidian)) === null, { what: "the modal to close" });

        await obsidian.waitFor(
            async () => (await settingNames(obsidian, "Custom LaTeX commands")).includes("\\eecmd"),
            {
                what: "the command in the list",
            },
        );
        const file = await Bun.file(join(obsidian.pluginDir, "latex_commands.json")).text();
        expect(JSON.parse(file)).toContainEqual({ displayName: "\\eecmd", replacement: "\\eecmd{#}{#}" });
        await closeSettings(obsidian);

        await obsidian.openNote("<|>", { path: NOTE });
        await obsidian.type("$\\eec");
        await obsidian.waitForPopup((p) => p.items[0] === "\\eecmd");
        await obsidian.press("Enter");
        expect((await obsidian.editor()).text).toContain("$\\eecmd{}{}");

        await openCompletrSettings(obsidian);
        await clickExtraButton(obsidian, "Custom LaTeX commands", "\\eecmd", "Remove");
        await obsidian.waitFor(
            async () => !(await settingNames(obsidian, "Custom LaTeX commands")).includes("\\eecmd"),
            { what: "the command to be removed" },
        );
        const after = await Bun.file(join(obsidian.pluginDir, "latex_commands.json")).text();
        expect(after).not.toContain("eecmd");
    } finally {
        await obsidian.eval(async (commands) => {
            await app.plugins.plugins["obsidian-completr"]!.latex.setCustomCommands(commands);
        }, original);
    }
});

describe("word list import", () => {
    let dir: string;
    const UTF16 = "e2e-import-utf16.txt";
    const CP1252 = "e2e-import-cp1252.txt";

    beforeAll(async () => {
        dir = mkdtempSync(join(tmpdir(), "completr-e2e-import-"));
        const utf16 = Buffer.concat([
            Buffer.from([0xff, 0xfe]),
            Buffer.from("Größenwahn\r\nÜberschwang\r\n", "utf16le"),
        ]);
        await Bun.write(join(dir, UTF16), utf16);
        // All characters used are in Latin-1, where Windows-1252 has the same byte values
        await Bun.write(join(dir, CP1252), Buffer.from("Mädchenzimmer\nÖlfaß\n", "latin1"));
    });
    afterAll(async () => {
        rmSync(dir, { recursive: true, force: true });
        await removeWordLists(obsidian, UTF16, CP1252);
        await forgetScannedWords(obsidian, ["Größ", "Ölf"]);
    });

    test("imports UTF-16 and Windows-1252 files through the file dialog and deletes them", async () => {
        await startErrorCapture(obsidian);
        await openCompletrSettings(obsidian);
        await chooseFiles(obsidian, () => clickButton(obsidian, "Word lists", "Word list files", "Import"), [
            join(dir, UTF16),
            join(dir, CP1252),
        ]);
        await obsidian.waitFor(
            async () => {
                const names = await settingNames(obsidian, "Word lists");
                return names.includes(UTF16) && names.includes(CP1252);
            },
            { what: "the imported files in the list" },
        );
        // Stored as UTF-8
        const wordLists = join(obsidian.pluginDir, "wordLists");
        expect((await Bun.file(join(wordLists, UTF16)).text()).split(/\r?\n/)).toEqual([
            "Größenwahn",
            "Überschwang",
            "",
        ]);
        expect((await Bun.file(join(wordLists, CP1252)).text()).split("\n")).toEqual(["Mädchenzimmer", "Ölfaß", ""]);
        await closeSettings(obsidian);

        await obsidian.openNote("<|>", { path: NOTE });
        await obsidian.type("Größ");
        await obsidian.waitForPopup((p) => p.items[0] === "Größenwahn");
        await obsidian.press("Escape");
        await obsidian.type(" Ölf");
        await obsidian.waitForPopup((p) => p.items[0] === "Ölfaß");
        await obsidian.press("Escape");

        // Delete one of them again
        await openCompletrSettings(obsidian);
        await obsidian.waitFor(async () => (await settingNames(obsidian, "Word lists")).includes(UTF16), {
            what: "the word list files", // rendered asynchronously
        });
        await clickExtraButton(obsidian, "Word lists", UTF16, "Remove");
        expect(await topModalText(obsidian)).toContain(`Delete ${UTF16}?`);
        await clickModalButton(obsidian, "Delete");
        await obsidian.waitFor(async () => !(await settingNames(obsidian, "Word lists")).includes(UTF16), {
            what: "the file to disappear from the list",
        });
        expect(existsSync(join(wordLists, UTF16))).toBe(false);
        expect(await settingNames(obsidian, "Word lists")).toContain(CP1252);
        await closeSettings(obsidian);

        await obsidian.openNote("<|>", { path: NOTE });
        await obsidian.type("Größ");
        await obsidian.expectNoPopup();
        expect(await takeErrors(obsidian)).toEqual([]);
    });
});
