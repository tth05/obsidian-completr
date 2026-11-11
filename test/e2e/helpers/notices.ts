/**
 * Obsidian's notices (the toasts in the top right corner).
 */
import type { Obsidian } from "../harness/obsidian.ts";
import { centerOf, clickMouse } from "./mouse.ts";

/** Texts of the notices that are shown right now. */
export function noticeTexts(obsidian: Obsidian): Promise<string[]> {
    return obsidian.eval(() => Array.from(document.querySelectorAll(".notice"), (n) => n.textContent ?? ""));
}

/** Removes all notices, so the next {@link waitForNotice} only sees new ones. */
export async function clearNotices(obsidian: Obsidian) {
    await obsidian.eval(() => document.querySelectorAll(".notice").forEach((n) => n.remove()));
}

/** Waits for a notice that contains `text` (or matches it) and returns its whole text. */
export async function waitForNotice(obsidian: Obsidian, text: string | RegExp): Promise<string> {
    let last: string[] = [];
    try {
        return await obsidian.waitFor(
            async () => {
                last = await noticeTexts(obsidian);
                return last.find((t) => (typeof text === "string" ? t.includes(text) : text.test(t)));
            },
            { what: "the notice" },
        );
    } catch {
        throw new Error(`No notice with ${String(text)}. Notices: ${JSON.stringify(last)}`);
    }
}

/** Clicks a link (by its text) inside the notice containing `noticeText`, with a real mouse click. */
export async function clickNoticeLink(obsidian: Obsidian, noticeText: string, linkText: string) {
    const point = await centerOf(
        obsidian,
        (noticeText: string, linkText: string) => {
            const notice = Array.from(document.querySelectorAll(".notice")).find((n) =>
                n.textContent?.includes(noticeText),
            );
            return Array.from(notice?.querySelectorAll("a") ?? []).find((a) => a.textContent === linkText);
        },
        noticeText,
        linkText,
    );
    await clickMouse(obsidian, point);
}
