import {Editor} from "obsidian";

/**
 * A simple class to keep track the state of a period being added after a completed word.
 */
export default class PeriodInserter {

    /**
     * If the class is in the right state to insert a period, if a space is pressed immediately before any other action.
     */
    private canInsert: boolean = false

    allowInsertPeriod() {
        this.canInsert = true
    }
    
    cancelInsertPeriod() {
        this.canInsert = false
    }
    
    canInsertPeriod(): boolean {
        return this.canInsert
    }

    /**
     * Inserts a period at the character before the cursor. This will be invoked after a space is already inserted,
     * so the cursor will always be after `'. '`
     * @param editor The Editor
     */
    attemptInsert(editor: Editor) {
        this.cancelInsertPeriod()
        
        const cursor = editor.getCursor()
        
        editor.replaceRange(".", {line: cursor.line, ch: cursor.ch - 1})
    }
    
} 
