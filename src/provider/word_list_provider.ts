import SuggestionProvider from "./provider";
import {EditorSuggestContext} from "obsidian";
import {CompletrSettings, WordListInsertionMode} from "../settings";
import {readFileSync} from "fs";

class WordListSuggestionProvider implements SuggestionProvider {

    private wordMap: Map<string, string[]> = new Map<string, string[]>();

    getSuggestions(context: EditorSuggestContext, settings: CompletrSettings): string[] {
        const ignoreCase = settings.wordListInsertionMode != WordListInsertionMode.MATCH_CASE_REPLACE;
        const query = ignoreCase ? context.query.toLowerCase() : context.query;
        const firstChar = query.charAt(0);

        const list = ignoreCase ?
            [...(this.wordMap.get(firstChar) ?? []), ...(this.wordMap.get(firstChar.toUpperCase()) ?? [])] //Get both lists if we're ignoring case
            :
            this.wordMap.get(firstChar);

        if (!list || list.length < 1)
            return [];

        //TODO: Rank those who match case higher
        let result = list.filter(s => {
            const match = ignoreCase ? s.toLowerCase() : s;
            return match.startsWith(query);
        });

        //In append mode we combine the query with the suggestions
        if (settings.wordListInsertionMode === WordListInsertionMode.IGNORE_CASE_APPEND) {
            result = result.map(s => query + s.substring(query.length, s.length));
        }

        return result;
    }

    loadFromFiles(settings: CompletrSettings) {
        this.wordMap.clear();

        //Read all files
        for (let i = settings.wordListFiles.length - 1; i >= 0; i--) {
            let data: string;
            try {
                data = readFileSync(settings.wordListFiles[i])?.toString();
            } catch (e) {
                settings.wordListFiles.splice(i, 1);
                continue;
            }

            //Each line is a word
            const lines = data.split("\n");
            for (let line of lines) {
                if (line === "" || line.length < settings.minWordLength)
                    continue;

                let list = this.wordMap.get(line.charAt(0));
                if (!list) {
                    list = [];
                    this.wordMap.set(line.charAt(0), list);
                }

                list.push(line.trim());
            }
        }

        let count = 0;
        //Sort by length
        for (let entry of this.wordMap.entries()) {
            entry[1] = entry[1].sort((a, b) => a.length - b.length);
            count += entry[1].length;
        }

        if (count > 0)
            console.log("Completr: Loaded " + count + " words");
    }
}

export const WordList = new WordListSuggestionProvider();
