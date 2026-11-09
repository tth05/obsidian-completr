/**
 * Compatibility with the "LaTeX Suite" plugin (https://github.com/artisticat1/obsidian-latex-suite), which handles
 * Tab (tabout / tabstops) and typed characters (auto snippets) in math itself. Issue #101: with Completr enabled, Tab
 * inside math inserted spurious indentation.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { getObsidian, type Obsidian } from "./harness/obsidian.ts";
import { openFreshNote, selectAndInsert } from "./helpers/latex.ts";
import { disablePinnedPlugin, installPinnedPlugin, LATEX_SUITE } from "./helpers/third_party_plugins.ts";

let obsidian: Obsidian;
beforeAll(async () => {
    obsidian = await getObsidian();
    // Pinned release, verified by hash
    await installPinnedPlugin(obsidian, LATEX_SUITE);
}, 60_000);
afterAll(async () => {
    // The Obsidian instance is shared with the other test files
    await disablePinnedPlugin(obsidian, LATEX_SUITE);
});
beforeEach(async () => {
    await obsidian.resetSettings();
    await obsidian.setSettings({ rankByUsage: false });
});

async function text() {
    return (await obsidian.editor()).textWithCursor;
}

/** Opens the popup with the "open suggestion popup" hotkey and waits for `item`. */
async function openPopupManually(item: string) {
    await obsidian.press(" ", "Ctrl");
    return obsidian.waitForPopup((p) => p.items.includes(item));
}

test("issue #101: Tab with the popup open doesn't indent, LaTeX Suite tabs out of inline math", async () => {
    await openFreshNote(obsidian, "$x + <|>$");
    await obsidian.type("\\al");
    await openPopupManually("\\alpha");
    await obsidian.press("Tab");
    expect(await text()).toBe("$x + \\al$<|>");
    expect((await obsidian.popup()).visible).toBe(false);
});

test("issue #101: Tab with the popup open doesn't indent, LaTeX Suite tabs out of a math block", async () => {
    await openFreshNote(obsidian, "$$\nx + <|>\n$$");
    await obsidian.type("\\al");
    await openPopupManually("\\alpha");
    await obsidian.press("Tab");
    expect(await text()).toBe("$$\nx + \\al\n$$\n<|>");
});

test("issue #101: Tab without the popup is handled by LaTeX Suite", async () => {
    await openFreshNote(obsidian, "$\\frac{a<|>}{b}$");
    await obsidian.press("Tab");
    expect(await text()).toBe("$\\frac{a}<|>{b}$");
    await obsidian.press("Tab");
    await obsidian.press("Tab");
    expect(await text()).toBe("$\\frac{a}{b}$<|>");
});

test("LaTeX Suite snippets and their tabstops keep working", async () => {
    await openFreshNote(obsidian, "$<|>$");
    // Auto fraction
    await obsidian.type("x/");
    expect(await text()).toBe("$\\frac{x}{<|>}$");
    await obsidian.type("b");
    await obsidian.press("Tab");
    expect(await text()).toBe("$\\frac{x}{b}<|>$");
});

test("Completr suggestions can be inserted", async () => {
    await openFreshNote(obsidian, "$x + <|>$");
    await obsidian.type("\\al");
    await openPopupManually("\\alpha");
    await selectAndInsert(obsidian, "\\alpha");
    expect(await text()).toBe("$x + \\alpha<|>$");
});

test("Completr snippets can be filled with Enter", async () => {
    await openFreshNote(obsidian, "$<|>$");
    await obsidian.type("\\frac");
    await openPopupManually("\\frac{#}{#}");
    await selectAndInsert(obsidian, "\\frac{#}{#}");
    expect(await text()).toBe("$\\frac{<|>}{}$");
    await obsidian.type("a");
    await obsidian.press("Enter");
    await obsidian.type("b");
    await obsidian.press("Enter");
    expect(await text()).toBe("$\\frac{a}{b}<|>$");
});

test("jumpWithTab: Completr's placeholders take precedence over LaTeX Suite's tabout", async () => {
    await obsidian.setSettings({ jumpWithTab: true });
    await openFreshNote(obsidian, "$<|>$");
    await obsidian.type("\\frac");
    await openPopupManually("\\frac{#}{#}");
    await selectAndInsert(obsidian, "\\frac{#}{#}");
    await obsidian.type("a");
    await obsidian.press("Tab");
    expect(await text()).toBe("$\\frac{a}{<|>}$");
    await obsidian.type("b");
    await obsidian.press("Tab");
    expect(await text()).toBe("$\\frac{a}{b}<|>$");
    // Snippet finished, Tab is LaTeX Suite's again
    await obsidian.press("Tab");
    expect(await text()).toBe("$\\frac{a}{b}$<|>");
});

test("the popup opens automatically while typing in math", async () => {
    await openFreshNote(obsidian, "$x + <|>$");
    await obsidian.type("\\al");
    await obsidian.waitForPopup((p) => p.items.includes("\\alpha"));
});
