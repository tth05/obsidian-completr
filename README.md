# Completr
[![](https://img.shields.io/github/v/release/tth05/obsidian-completr?style=flat-square)](https://github.com/tth05/obsidian-completr/releases)
![](https://img.shields.io/github/downloads/tth05/obsidian-completr/total?style=flat-square)

This plugin provides advanced auto-completion functionality for obsidian.

## Features
- Latex support
    - No need to start with a `\`
    - Includes all MathJax commands
    - Allows `\begin...` completion for all environments
    - Support for inserting snippets with placeholders
- Word list support
    - Load files where each line is a word
    - Performant, even with very big lists
- Scanning your vault for words
    - Scans the current file or your whole vault to find new words which can then be suggested

## Installation

### Community plugin list
Browse the community plugins list and search for `Completr`.
### Manually
- Download `main.js, styles.css` and `manifest.json` from a release of your choice
- Copy the three files to your vault `VaultFolder/.obsidian/plugins/obsidian-completr/`

## Example usage
#### Latex snippets
![Latex](https://user-images.githubusercontent.com/36999320/146680089-57390cd7-e3c3-418c-9c55-9536259bb956.gif)
#### File scanning
![File scanner](https://user-images.githubusercontent.com/36999320/146680134-33d8393b-956a-4028-ab2f-62526f76984d.gif)
#### Two million german words loaded
![Word list](https://user-images.githubusercontent.com/36999320/146680359-ae572473-8919-4927-a6f5-bc39800a5c23.gif)



## Development
- Clone the repo to the `plugins` folder of an obsidian vault
- Run `npm i` and `npm run dev`
- Enable the plugin in obsidian
