import { Transaction } from "@codemirror/state";

/**
 * Whether a transaction is the user typing. Besides CodeMirror's own "input.type" transactions, this accepts changes
 * without a user event that add exactly one character in front of the cursor. That's how plugins that handle typing
 * themselves insert it (e.g. LaTeX Suite replaces "\a" with "\al" when "l" is typed).
 */
export function isTyping(tr: Transaction): boolean {
    if (tr.isUserEvent("input.type")) return true;
    if (tr.annotation(Transaction.userEvent) !== undefined || !tr.docChanged) return false;

    const before = tr.startState.selection.main;
    const after = tr.state.selection.main;
    if (!before.empty || !after.empty) return false;

    let count = 0;
    let typed = false;
    tr.changes.iterChanges((fromA, toA, _fromB, toB, inserted) => {
        count++;
        typed =
            toA === before.head &&
            toB === after.head &&
            inserted.length - (toA - fromA) === 1 &&
            !inserted.sliceString(inserted.length - 1).includes("\n");
    });
    return count === 1 && typed;
}

/** Whether a transaction changes the document without changing its content (e.g. replacing "$" with "$"). */
export function isNoop(tr: Transaction): boolean {
    let noop = true;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (noop && tr.startState.doc.sliceString(fromA, toA) !== inserted.toString()) noop = false;
    });
    return noop;
}

/**
 * Whether the document changes of an editor update were the user typing (as opposed to pasting, deleting, indenting,
 * ...). Null if the update doesn't change the text.
 */
export function wasTyping(transactions: readonly Transaction[]): boolean | null {
    const changes = transactions.filter((tr) => tr.docChanged && !isNoop(tr));
    return changes.length > 0 ? changes.some(isTyping) : null;
}
