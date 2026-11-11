import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { isInUnclosedInlineMath } from "./text.ts";

export type MathType = "inline" | "block";

export interface CursorContext {
    inCode: boolean;
    /** Math according to the syntax tree. Unclosed inline math (`$\fr`) is not part of the tree. */
    math: MathType | null;
}

/*
 * Obsidian's markdown parser (HyperMD based) produces node names like
 *   "formatting_formatting-math_formatting-math-begin_keyword_math_math-block", "math_tag", "HyperMD-math",
 *   "inline-code", "hmd-codeblock", "HyperMD-codeblock_HyperMD-codeblock-bg", "formatting-code-end ...".
 */

function nodeChain(node: SyntaxNode | null): string[] {
    const names: string[] = [];
    for (let n = node; n; n = n.parent) names.push(n.name);
    return names;
}

/** Inspects the syntax tree around `pos`. Fast: only resolves a single node and scans the current line. */
export function getCursorContext(state: EditorState, pos: number): CursorContext {
    const tree = ensureSyntaxTree(state, pos, 20) ?? syntaxTree(state);
    // Looking at the character before the cursor. A closing delimiter right before the cursor means we're outside.
    const names = nodeChain(tree.resolveInner(pos, -1));
    const own = names[0] ?? "";

    const isEnd = own.includes("formatting-math-end");
    const inCode =
        !own.includes("formatting-code-end") && names.some((n) => n.includes("inline-code") || n.includes("codeblock"));
    if (inCode) return { inCode: true, math: null };

    if (isEnd || !names.some((n) => n.includes("math"))) return { inCode: false, math: null };
    if (names.some((n) => n.includes("HyperMD-math"))) return { inCode: false, math: "block" };

    // Single line math, either $...$ or $$...$$. The opening delimiter tells which one.
    const line = state.doc.lineAt(pos);
    let lastBegin = "";
    tree.iterate({
        from: line.from,
        to: pos,
        enter: (node) => {
            if (node.from < pos && node.name.includes("formatting-math-begin")) lastBegin = node.name;
        },
    });
    // No opening delimiter on this line: a continuation line of a multi-line $ block. Obsidian doesn't mark those as
    // HyperMD-math inside block quotes / callouts.
    return { inCode: false, math: lastBegin === "" || lastBegin.includes("math-block") ? "block" : "inline" };
}

/**
 * Determines whether LaTeX suggestions should be shown at `pos` and whether newlines are allowed (block).
 * @param triggerInCode whether a dollar sign inside code should count as math (e.g. `$\fr`).
 */
export function getLatexContext(
    state: EditorState,
    pos: number,
    triggerInCode: boolean,
    ctx = getCursorContext(state, pos),
): MathType | null {
    if (ctx.math) return ctx.math;

    if (ctx.inCode && !triggerInCode) return null;
    const line = state.doc.lineAt(pos);
    // Inside code, backticks are part of the code and must not hide the dollar sign.
    return isInUnclosedInlineMath(line.text, pos - line.from, !ctx.inCode) ? "inline" : null;
}
