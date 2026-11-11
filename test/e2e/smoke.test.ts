import { beforeAll, beforeEach, expect, test } from "bun:test";
import { getObsidian, type Obsidian } from "./harness/obsidian.ts";

let obsidian: Obsidian;
beforeAll(async () => {
    obsidian = await getObsidian();
});
beforeEach(async () => {
    await obsidian.resetSettings();
});

test("latex suggestions show up in inline math", async () => {
    await obsidian.openNote("Some text <|>");
    await obsidian.type("$\\alp");
    const popup = await obsidian.waitForPopup((p) => p.items.includes("\\alpha"));
    expect(popup.items[0]).toBe("\\alpha");
});
