import { finishRenderMath, loadMathJax, renderMath } from "obsidian";

/**
 * Renders LaTeX (e.g. `\alpha`) with MathJax for the popup. Results are cached, and rendering happens in
 * small batches after the popup was drawn, so a full popup never blocks typing.
 */

const BATCH_SIZE = 15;

/** Rendered previews, null if the command can't be rendered on its own (e.g. `\left(`). */
const cache = new Map<string, HTMLElement | null>();
const queue: { tex: string; target: HTMLElement }[] = [];
let mathJax: Promise<void> | null = null;
let scheduled = false;

function render(tex: string): HTMLElement | null {
    try {
        const el = renderMath(tex, false);
        // MathJax renders errors inline instead of throwing, and unknown commands as red text
        if (el.querySelector('mjx-merror, [data-mjx-error], [style*="color: red"], [mathcolor="red"]')) return null;
        return el;
    } catch {
        return null;
    }
}

function attach(target: HTMLElement, preview: HTMLElement | null) {
    if (preview) target.appendChild(preview.cloneNode(true));
}

async function flush() {
    scheduled = false;
    try {
        await (mathJax ??= loadMathJax());
    } catch (e) {
        // Try again with the next popup
        mathJax = null;
        queue.length = 0;
        console.warn("Completr: Unable to load MathJax", e);
        return;
    }

    const batch = queue.splice(0, BATCH_SIZE);
    let rendered = false;
    for (const { tex, target } of batch) {
        // The popup is attached to the DOM after its items are rendered, so by now every item of the current popup is
        // connected. Items of an outdated popup were removed, rendering them would be wasted work.
        if (!target.isConnected) continue;
        let preview = cache.get(tex);
        if (preview === undefined) {
            preview = render(tex);
            cache.set(tex, preview);
            rendered = true;
        }
        attach(target, preview);
    }
    if (rendered) await finishRenderMath();
    schedule();
}

function schedule() {
    if (scheduled || queue.length === 0) return;
    scheduled = true;
    window.setTimeout(() => void flush(), 0);
}

/** Appends the rendered `tex` to `target`, now if cached, otherwise soon. */
export function renderLatexPreview(target: HTMLElement, tex: string) {
    const cached = cache.get(tex);
    if (cached !== undefined) {
        attach(target, cached);
        return;
    }

    queue.push({ tex, target });
    schedule();
}
