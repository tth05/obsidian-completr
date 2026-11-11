/**
 * Real mouse input through the DevTools protocol. Unlike `element.click()`, it goes through hit testing, hover state
 * and focus handling, like the mouse of a user does.
 */
import type { Obsidian } from "../harness/obsidian.ts";

export interface Point {
    x: number;
    y: number;
}

/**
 * The center of the element that `find` returns inside Obsidian, scrolled into view. Waits for the element to exist
 * and to stop moving (notices slide in, for example). `find` is serialized like the functions passed to
 * `Obsidian.eval`.
 */
export function centerOf<A extends unknown[]>(
    obsidian: Obsidian,
    find: (...args: A) => Element | null | undefined,
    ...args: A
): Promise<Point> {
    let previous: Point | null = null;
    return obsidian.waitFor(
        async () => {
            const point = await obsidian.cdp.evaluate<Point | null>(`(() => {
                const el = (${find.toString()})(...${JSON.stringify(args)});
                if (!el) return null;
                el.scrollIntoView({ block: "nearest", inline: "nearest" });
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
            })()`);
            const stable = point !== null && previous !== null && point.x === previous.x && point.y === previous.y;
            previous = point;
            return stable ? point : null;
        },
        { what: "the element for the mouse" },
    );
}

export async function moveMouse(obsidian: Obsidian, point: Point) {
    await obsidian.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, button: "none" });
}

/** Moves the mouse to the point and clicks the left button. */
export async function clickMouse(obsidian: Obsidian, point: Point) {
    await moveMouse(obsidian, point);
    const base = { ...point, button: "left", clickCount: 1 };
    await obsidian.cdp.send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
    await obsidian.cdp.send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
}

/** Moves the mouse to the bottom right corner of the window, where it hovers nothing the tests look at. */
export async function parkMouse(obsidian: Obsidian) {
    const point = await obsidian.eval(() => ({ x: window.innerWidth - 2, y: window.innerHeight - 2 }));
    await moveMouse(obsidian, point);
}
