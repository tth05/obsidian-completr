import {Text} from "@codemirror/text";
import {Editor, EditorPosition} from "obsidian";
import {EditorState} from "@codemirror/state";
import {EditorView} from "@codemirror/view";

export function posFromIndex(doc: Text, offset: number): EditorPosition {
    let line = doc.lineAt(offset)
    return {line: line.number - 1, ch: offset - line.from}
}

export function indexFromPos(doc: Text, pos: EditorPosition): number {
    const ch = pos.ch;
    const line = doc.line(pos.line + 1);
    return Math.min(line.from + Math.max(0, ch), line.to)
}

export function editorToCodeMirrorState(editor: Editor): EditorState {
    return (editor as any).cm.state;
}

export function editorToCodeMirrorView(editor: Editor): EditorView {
    return (editor as any).cm;
}

export function matchWordBackwards(
    editor: Editor,
    cursor: EditorPosition,
    charValidator: (char: string) => boolean,
    maxLookBackDistance: number = 50
): { query: string, separatorChar: string } {
    let query = "", separatorChar = null;

    //Save some time for very long lines
    let lookBackEnd = Math.max(0, cursor.ch - maxLookBackDistance);
    //Find word in front of cursor
    for (let i = cursor.ch - 1; i >= lookBackEnd; i--) {
        const prevChar = editor.getRange({...cursor, ch: i}, {...cursor, ch: i + 1});
        if (!charValidator(prevChar)) {
            separatorChar = prevChar;
            break;
        }

        query = prevChar + query;
    }

    return {query, separatorChar};
}

export function isInFrontMatterBlock(editor: Editor, pos: EditorPosition): boolean {
    if (editor.getLine(0) !== "---" || editor.getLine(1) === "---" || pos.line === 0)
        return false;

    for (let i = 2; i < Math.max(30, editor.lastLine()); i++) {
        if (editor.getLine(i) === "---")
            return pos.line < i;
    }

    return false;
}

class BlockType {
    public static DOLLAR_MULTI = new BlockType("$$", true);
    public static DOLLAR_SINGLE = new BlockType("$", false, BlockType.DOLLAR_MULTI);
    public static CODE_MULTI = new BlockType("```", true);
    public static CODE_SINGLE = new BlockType("`", false, BlockType.CODE_MULTI);

    static {
        BlockType.DOLLAR_MULTI.otherType0 = BlockType.DOLLAR_SINGLE;
        BlockType.CODE_MULTI.otherType0 = BlockType.CODE_SINGLE;
    }

    public static SINGLE_TYPES = [BlockType.DOLLAR_SINGLE, BlockType.CODE_SINGLE];

    constructor(public readonly c: string, public readonly isMultiLine: boolean, private otherType0: BlockType = null) {
    }

    public get isDollarBlock(): boolean {
        return this === BlockType.DOLLAR_SINGLE || this === BlockType.DOLLAR_MULTI;
    }

    public get isCodeBlock(): boolean {
        return !this.isDollarBlock;
    }

    public get otherType(): BlockType {
        return this.otherType0;
    }
}

export function isInLatexBlock(editor: Editor, cursorPos: EditorPosition, triggerInCodeBlocks: boolean): boolean {
    let blockTypeStack: { type: BlockType, line: number }[] = [];

    for (let lineIndex = Math.max(0, cursorPos.line - 1000); lineIndex <= cursorPos.line; lineIndex++) {
        const line = editor.getLine(lineIndex);
        for (let j = cursorPos.line == lineIndex ? cursorPos.ch - 1 : line.length - 1; j >= 0; j--) {
            const currentChar = line.charAt(j);
            let matchingBlockType = BlockType.SINGLE_TYPES.find((b) => b.c.charAt(0) === currentChar);
            if (!matchingBlockType || line.charAt(Math.max(0, j - 1)) === '\\')
                continue;

            const multiTypeLength = matchingBlockType.otherType.c.length;
            const isDouble = j + 1 >= multiTypeLength && substringMatches(line, matchingBlockType.otherType.c, j - multiTypeLength + 1);
            if (isDouble) {
                j -= multiTypeLength - 1;
                matchingBlockType = matchingBlockType.otherType;
            }

            blockTypeStack.push({type: matchingBlockType, line: lineIndex});
        }
    }

    if (blockTypeStack.length < 1)
        return false;

    let currentIndex = 0;
    while (true) {
        if (currentIndex >= blockTypeStack.length)
            return false;

        const currentBlock = blockTypeStack[currentIndex];
        const otherBlockIndex = findIndex(blockTypeStack, ({type}) => type === currentBlock.type, currentIndex + 1);

        if (otherBlockIndex === -1) {
            if (!triggerInCodeBlocks && currentBlock.type.isCodeBlock)
                return false;
            if (currentBlock.type === BlockType.DOLLAR_SINGLE && currentBlock.line !== cursorPos.line) {
                currentIndex++;
                continue;
            }

            return true;
        } else {
            currentIndex = otherBlockIndex + 1;
        }
    }
}

function findIndex<T>(arr: T[], predicate: (element: T) => boolean, fromIndex: number): number {
    for (let i = fromIndex; i < arr.length; i++) {
        if (predicate(arr[i]))
            return i;
    }

    return -1;
}

function substringMatches(str: string, toMatch: string, from: number): boolean {
    for (let i = from; i < from + toMatch.length - 1; i++) {
        if (str.charAt(i) !== toMatch.charAt(i - from))
            return false;
    }

    return true;
}
