import { Suggestion } from "./provider";
import { Vault } from "obsidian";
import { intoCompletrPath } from "../settings";

const BLACKLIST_PATH = "blacklisted_suggestions.txt";
const NEW_LINE_REGEX = /\r?\n/;

export const SuggestionBlacklist = new class {
    private blacklist: Set<string> = new Set<string>();

    add(suggestion: Suggestion) {
        this.addFromText(suggestion.displayName);
    }

    addFromText(text: string) {
        this.blacklist.add(text);
    }

    has(suggestion: Suggestion): boolean {
        return this.hasText(suggestion.displayName);
    }

    hasText(text: string): boolean {
        return this.blacklist.has(text);
    }

    filter(suggestions: Suggestion[]): Suggestion[] {
        if (this.blacklist.size < 1)
            return suggestions;

        return suggestions.filter(s => !this.blacklist.has(s.displayName));
    }

    filterText(suggestions: string[]): string[] {
        if (this.blacklist.size < 1)
            return suggestions;

        return suggestions.filter(s => !this.blacklist.has(s));
    }

    async saveData(vault: Vault) {
        await vault.adapter.write(intoCompletrPath(vault, BLACKLIST_PATH), [...this.blacklist].join("\n"));
    }

    async loadData(vault: Vault) {
        const path = intoCompletrPath(vault, BLACKLIST_PATH);
        if (!(await vault.adapter.exists(path)))
            return

        const contents = (await vault.adapter.read(path)).split(NEW_LINE_REGEX);
        for (let word of contents) {
            if (!word)
                continue;

            this.addFromText(word);
        }
    }
};
