/**
 * The buttons that appear when a suggestion in the popup is hovered ("Never suggest this", "Edit ...").
 */
import type { Obsidian } from "../harness/obsidian.ts";
import { centerOf, clickMouse, moveMouse, type Point } from "./mouse.ts";

/** Tooltip of the button that blacklists a suggestion, without the hotkey in parentheses. */
export const HIDE_ACTION = "Never suggest this";

export interface SuggestionAction {
    tooltip: string;
    /** Class list of the button's icon. */
    iconClass: string;
    /** Computed `visibility` of the button. */
    visibility: string;
}

export interface SuggestionRow {
    text: string;
    actions: SuggestionAction[];
}

/** The rows of the open popup with their action buttons. */
export function suggestionRows(obsidian: Obsidian): Promise<SuggestionRow[]> {
    return obsidian.eval(() =>
        Array.from(document.querySelectorAll(".suggestion-container .completr-suggestion-item"), (row) => ({
            text: row.querySelector(".completr-suggestion-text")?.textContent ?? "",
            actions: Array.from(
                row.querySelectorAll(":scope > .completr-suggestion-actions > .completr-suggestion-action"),
                (button) => ({
                    tooltip: button.getAttribute("aria-label") ?? "",
                    iconClass: button.querySelector("svg")?.getAttribute("class") ?? "",
                    visibility: getComputedStyle(button).visibility,
                }),
            ),
        })),
    );
}

/** Texts of the rows whose action buttons are visible. */
export async function rowsWithVisibleActions(obsidian: Obsidian): Promise<string[]> {
    const rows = await suggestionRows(obsidian);
    return rows.filter((r) => r.actions.some((a) => a.visibility === "visible")).map((r) => r.text);
}

export interface PopupWidth {
    /** Width of the popup as it is. */
    width: number;
    /** Width of the popup if there were no action buttons at all. */
    withoutActions: number;
}

/** Width of the open popup, with and without its action buttons. */
export function popupWidth(obsidian: Obsidian): Promise<PopupWidth> {
    return obsidian.eval(() => {
        const container = document.querySelector(".suggestion-container")!;
        const width = container.getBoundingClientRect().width;
        const style = document.head.createEl("style", {
            text: ".completr-suggestion-actions { display: none !important; }",
        });
        const withoutActions = container.getBoundingClientRect().width;
        style.remove();
        return { width, withoutActions };
    });
}

function rowPoint(obsidian: Obsidian, item: string): Promise<Point> {
    return centerOf(
        obsidian,
        (item: string) =>
            Array.from(document.querySelectorAll(".suggestion-container .completr-suggestion-item"))
                .find((row) => row.querySelector(".completr-suggestion-text")?.textContent === item)
                ?.querySelector(".completr-suggestion-text"),
        item,
    );
}

/** Moves the mouse over the name of a suggestion. */
export async function hoverSuggestion(obsidian: Obsidian, item: string) {
    await moveMouse(obsidian, await rowPoint(obsidian, item));
}

/**
 * Clicks an action button of a suggestion like a user: moves the mouse onto the row first (the buttons are hidden
 * until then), then onto the button, and clicks. `tooltip` is the start of the button's tooltip.
 */
export async function clickSuggestionAction(obsidian: Obsidian, item: string, tooltip: string) {
    await hoverSuggestion(obsidian, item);
    const point = await centerOf(
        obsidian,
        (item: string, tooltip: string) => {
            const row = Array.from(document.querySelectorAll(".suggestion-container .completr-suggestion-item")).find(
                (row) => row.querySelector(".completr-suggestion-text")?.textContent === item,
            );
            const button = Array.from(row?.querySelectorAll(".completr-suggestion-action") ?? []).find((b) =>
                b.getAttribute("aria-label")?.startsWith(tooltip),
            );
            // Only a visible button can be clicked
            return button && getComputedStyle(button).visibility === "visible" ? button : null;
        },
        item,
        tooltip,
    );
    await clickMouse(obsidian, point);
}
