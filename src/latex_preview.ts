import { finishRenderMath, loadMathJax, renderMath } from "obsidian";

/**
 * Renders LaTeX suggestions (e.g. `\alpha`) with MathJax for the popup. Results are cached, and rendering happens in
 * small batches after the popup was drawn, so a full popup never blocks typing.
 */

const BATCH_SIZE = 15;

/** Rendered previews, null if the command can't be rendered on its own (e.g. `\left(`). */
const cache = new Map<string, HTMLElement | null>();
const queue: { tex: string; target: HTMLElement }[] = [];
let mathJax: Promise<void> | null = null;
let scheduled = false;

/** The TeX source to preview for a suggestion, null if it shouldn't be previewed. */
export function toPreviewTex(displayName: string): string | null {
    if (displayName.startsWith("\\begin{") || !displayName.startsWith("\\")) return null;
    // Placeholders become boxes, like in a template
    return displayName.replaceAll("#", "\\square").replaceAll("~", "");
}

function render(tex: string): HTMLElement | null {
    try {
        const el = renderMath(tex, false);
        // MathJax renders errors inline instead of throwing
        if (el.querySelector("mjx-merror, [data-mjx-error]")) return null;
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
    mathJax ??= loadMathJax();
    await mathJax;

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

/** Appends the rendered preview of `displayName` to `target`, now if cached, otherwise soon. */
export function renderLatexPreview(target: HTMLElement, displayName: string) {
    const tex = toPreviewTex(displayName);
    if (tex === null) return;

    const cached = cache.get(tex);
    if (cached !== undefined) {
        attach(target, cached);
        return;
    }

    queue.push({ tex, target });
    schedule();
}
