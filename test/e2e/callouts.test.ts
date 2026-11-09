import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { CalloutProviderSource, IconMode } from "../../src/settings.ts";
import { getObsidian, type Obsidian } from "./harness/obsidian.ts";
import { addCustomCallout, removeCustomCallout } from "./helpers/callout_manager.ts";
import { startErrorCapture, takeErrors } from "./helpers/errors.ts";
import {
    closeSettings,
    dropdownOptions,
    openCompletrSettings,
    readDataJson,
    selectDropdown,
} from "./helpers/settings_tab.ts";
import { CALLOUT_MANAGER, disablePinnedPlugin, installPinnedPlugin } from "./helpers/third_party_plugins.ts";
import { deleteNotes, forgetUsage, renderedItems } from "./helpers/words.ts";

let obsidian: Obsidian;
const NOTE = "callouts-e2e.md";
const INSERTED = ["Note", "Tip", "Warning", "Recipe", "E2e unicorn"];

function openNote(content: string) {
    return obsidian.openNote(content, { path: NOTE });
}

async function expectText(text: string) {
    expect((await obsidian.editor()).text).toBe(text);
}

/** Reloads the callout types from the configured source, like changing the source in the settings does. */
async function reloadCallouts() {
    await obsidian.eval(async () => {
        const plugin = app.plugins.plugins["obsidian-completr"]!;
        await plugin.callout.load(plugin.settings);
    });
}

beforeAll(async () => {
    obsidian = await getObsidian();
});
beforeEach(async () => {
    await obsidian.resetSettings();
    await forgetUsage(obsidian, INSERTED);
});
afterAll(async () => {
    await obsidian.resetSettings();
    await disablePinnedPlugin(obsidian, CALLOUT_MANAGER);
    await reloadCallouts();
    await forgetUsage(obsidian, INSERTED);
    await obsidian.openNote("", { path: "test.md" });
    await deleteNotes(obsidian, [NOTE]);
});

test("suggests callout types after '> [!'", async () => {
    await openNote("<|>");
    await obsidian.type("> [!no");
    const popup = await obsidian.waitForPopup((p) => p.items[0] === "Note");
    expect(popup.items).toEqual(["Note"]);
    await obsidian.press("Enter");
    expect((await obsidian.editor()).textWithCursor).toBe("> [!note] <|>");
});

test("lists all types right after '> [!'", async () => {
    await openNote("<|>");
    await obsidian.type("> [!");
    const popup = await obsidian.waitForPopup((p) => p.items.length > 10);
    expect(popup.items.slice(0, 3)).toEqual(["Note", "Summary", "Abstract"]);
    expect(popup.items).toContain("TL;DR");

    // Matches the id, too
    await obsidian.type("tld");
    await obsidian.waitForPopup((p) => p.items.length === 1 && p.items[0] === "TL;DR");
    await obsidian.press("Enter");
    await expectText("> [!tldr] ");
});

test("replaces only the type and keeps the fold marker and title", async () => {
    await openNote("> [!no<|>]- My title");
    await obsidian.type("t");
    await obsidian.waitForPopup((p) => p.items[0] === "Note");
    await obsidian.press("Enter");
    await expectText("> [!note]- My title");

    await openNote("> [!ti<|>]+ Title");
    await obsidian.type("p");
    await obsidian.waitForPopup((p) => p.items[0] === "Tip");
    await obsidian.press("Enter");
    await expectText("> [!tip]+ Title");

    // Replaces the whole old type, even if the cursor is in the middle of it
    await openNote("> [!w<|>xyz] Title");
    await obsidian.type("a");
    await obsidian.waitForPopup((p) => p.items[0] === "Warning");
    await obsidian.press("Enter");
    await expectText("> [!warning] Title");
});

test("works in nested block quotes", async () => {
    await openNote("> Outer quote\n> <|>");
    await obsidian.type("> [!war");
    await obsidian.waitForPopup((p) => p.items[0] === "Warning");
    await obsidian.press("Enter");
    await expectText("> Outer quote\n> > [!warning] ");
});

test("doesn't trigger on continuation lines of a block quote", async () => {
    await openNote("> [!note] Title\n> <|>");
    await obsidian.type("[!no");
    await obsidian.expectNoPopup();

    await openNote("> > [!note] Title\n> <|>");
    await obsidian.type("[!no");
    await obsidian.expectNoPopup();
});

test("shows colored icons", async () => {
    await openNote("<|>");
    await obsidian.type("> [!");
    await obsidian.waitForPopup((p) => p.items.includes("Bug"));
    const items = await renderedItems(obsidian);
    const note = items.find((i) => i.text === "Note")!;
    expect(note.iconClass).toContain("lucide-pencil");
    expect(note.color).toBe("#448aff");
    expect(items.find((i) => i.text === "Bug")!.iconClass).toContain("lucide-bug");
    expect(items.every((i) => i.iconClass !== null)).toBe(true);

    // Icon mode "none" hides them
    await obsidian.press("Escape");
    await obsidian.setSettings({ iconMode: IconMode.NONE });
    await openNote("<|>");
    await obsidian.type("> [!");
    await obsidian.waitForPopup((p) => p.items.includes("Bug"));
    expect((await renderedItems(obsidian)).every((i) => i.iconClass === null)).toBe(true);
});

test("callout types can be customized in callout_suggestions.json", async () => {
    const original = await obsidian.eval(() =>
        app.plugins.plugins["obsidian-completr"]!.files.read("callout_suggestions.json"),
    );
    expect(original).not.toBeNull();
    try {
        await obsidian.eval(async () => {
            const plugin = app.plugins.plugins["obsidian-completr"]!;
            await plugin.files.write(
                "callout_suggestions.json",
                JSON.stringify([
                    { displayName: "Recipe", replacement: "recipe", icon: "lucide-chef-hat", color: "#ff0000" },
                    "Plain",
                ]),
            );
        });
        await reloadCallouts();
        await openNote("<|>");
        await obsidian.type("> [!");
        const popup = await obsidian.waitForPopup((p) => p.items.includes("Recipe"));
        expect(popup.items).toEqual(["Recipe", "Plain"]);
        const recipe = (await renderedItems(obsidian))[0];
        expect(recipe.iconClass).toContain("lucide-chef-hat");
        expect(recipe.color).toBe("#ff0000");
        await obsidian.press("Enter");
        await expectText("> [!recipe] ");
    } finally {
        await obsidian.eval(async (original: string) => {
            await app.plugins.plugins["obsidian-completr"]!.files.write("callout_suggestions.json", original);
        }, original!);
        await reloadCallouts();
    }
});

test("an invalid callout_suggestions.json falls back to the default types", async () => {
    const result = await obsidian.eval(async () => {
        const plugin = app.plugins.plugins["obsidian-completr"]!;
        const original = (await plugin.files.read("callout_suggestions.json"))!;
        try {
            await plugin.files.write("callout_suggestions.json", "{ not json");
            return await plugin.callout.load(plugin.settings);
        } finally {
            await plugin.files.write("callout_suggestions.json", original);
        }
    });
    expect(result).toContain("Using default callout types");
    await openNote("<|>");
    await obsidian.type("> [!no");
    await obsidian.waitForPopup((p) => p.items[0] === "Note");
    await reloadCallouts();
});

describe("Callout Manager as source (#94)", () => {
    const CUSTOM = "e2e-unicorn";

    async function suggestionsFor(typed: string) {
        await openNote("<|>");
        await obsidian.type("> [!" + typed);
        return (await obsidian.waitForPopup()).items;
    }

    afterAll(async () => {
        await removeCustomCallout(obsidian, CUSTOM);
        await closeSettings(obsidian);
    });

    test("the source can be switched to Callout Manager once it is installed", async () => {
        await startErrorCapture(obsidian);
        await openCompletrSettings(obsidian);
        expect(await dropdownOptions(obsidian, "Callouts", "Source")).toEqual([CalloutProviderSource.COMPLETR]);
        await closeSettings(obsidian);

        await installPinnedPlugin(obsidian, CALLOUT_MANAGER);
        await addCustomCallout(obsidian, CUSTOM);
        // Still using Completr's own list
        expect(await suggestionsFor("tl")).toEqual(["TL;DR"]);
        await obsidian.press("Escape");
        await openNote("<|>");
        await obsidian.type("> [!e2e");
        await obsidian.expectNoPopup();

        await openCompletrSettings(obsidian);
        expect(await dropdownOptions(obsidian, "Callouts", "Source")).toEqual([
            CalloutProviderSource.COMPLETR,
            CalloutProviderSource.CALLOUT_MANAGER,
        ]);
        await selectDropdown(obsidian, "Callouts", "Source", CalloutProviderSource.CALLOUT_MANAGER);
        await obsidian.waitFor(
            async () => (await readDataJson(obsidian)).calloutProviderSource === CalloutProviderSource.CALLOUT_MANAGER,
            { what: "the source to be saved" },
        );
        await closeSettings(obsidian);

        // Suggestions now come from Callout Manager, without a restart
        const items = await suggestionsFor("e2e");
        expect(items).toEqual(["E2e unicorn"]);
        const unicorn = (await renderedItems(obsidian))[0];
        expect(unicorn.color).toMatch(/^rgb\(/);
        await obsidian.press("Enter");
        await expectText(`> [!${CUSTOM}] `);

        // Callout Manager's titles are derived from the ids
        expect(await suggestionsFor("tl")).toEqual(["Tldr"]);
        await obsidian.press("Escape");
        expect(await takeErrors(obsidian)).toEqual([]);
    });

    test("changes in Callout Manager are picked up immediately", async () => {
        await obsidian.setSettings({ calloutProviderSource: CalloutProviderSource.CALLOUT_MANAGER });
        await reloadCallouts();
        await addCustomCallout(obsidian, "e2e-dragon");
        try {
            expect(await suggestionsFor("e2e")).toEqual(["E2e dragon", "E2e unicorn"]);
        } finally {
            await removeCustomCallout(obsidian, "e2e-dragon");
        }
        await obsidian.press("Escape");
        expect(await suggestionsFor("e2e")).toEqual(["E2e unicorn"]);
    });

    test("Callout Manager is used after restarting Completr", async () => {
        await obsidian.setSettings({ calloutProviderSource: CalloutProviderSource.CALLOUT_MANAGER });
        await obsidian.reloadPlugin();
        expect(await suggestionsFor("e2e")).toEqual(["E2e unicorn"]);
    });

    test("switching back uses callout_suggestions.json again", async () => {
        await obsidian.setSettings({ calloutProviderSource: CalloutProviderSource.CALLOUT_MANAGER });
        await reloadCallouts();
        await openCompletrSettings(obsidian);
        await selectDropdown(obsidian, "Callouts", "Source", CalloutProviderSource.COMPLETR);
        await obsidian.waitFor(
            async () => (await readDataJson(obsidian)).calloutProviderSource === CalloutProviderSource.COMPLETR,
            { what: "the source to be saved" },
        );
        await closeSettings(obsidian);

        expect(await suggestionsFor("tl")).toEqual(["TL;DR"]);
        await obsidian.press("Escape");
        await openNote("<|>");
        await obsidian.type("> [!e2e");
        await obsidian.expectNoPopup();
    });

    test("falls back to callout_suggestions.json if Callout Manager is disabled", async () => {
        await obsidian.setSettings({ calloutProviderSource: CalloutProviderSource.CALLOUT_MANAGER });
        await removeCustomCallout(obsidian, CUSTOM);
        await disablePinnedPlugin(obsidian, CALLOUT_MANAGER);
        await obsidian.reloadPlugin();
        expect(await suggestionsFor("tl")).toEqual(["TL;DR"]);

        // The option stays visible while it is selected, so it can be switched back
        await openCompletrSettings(obsidian);
        expect(await dropdownOptions(obsidian, "Callouts", "Source")).toEqual([
            CalloutProviderSource.COMPLETR,
            CalloutProviderSource.CALLOUT_MANAGER,
        ]);
        await closeSettings(obsidian);
    });
});
