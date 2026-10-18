<div align="center">
<img width="96" height="96" alt="icon" src="https://github.com/user-attachments/assets/07fe58ff-3d67-45d3-9f4f-a5e9dbb6e022" />

# open_chess

A chess game for Windows with a bot that adapts to how you play.

[![Windows](https://img.shields.io/badge/Windows-2b2b2b?style=flat&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZiI+PHBhdGggZD0iTTMgNS43IDEwLjQgNC41djcuMUgzek0xMS41IDQuMyAyMSAzdjguNmgtOS41ek0zIDEyLjdoNy40djcuMUwzIDE4LjZ6TTExLjUgMTIuN0gyMVYyMWwtOS41LTEuM3oiLz48L3N2Zz4=)](https://github.com/Lucki74/open-chess/releases)
![Unsigned](https://img.shields.io/badge/Unsigned%20build-2b2b2b?style=flat)

![Electron](https://img.shields.io/badge/Electron-47848F?style=flat&logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat&logo=vitest&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)

</div>

open_chess has no menus, settings or difficulty slider. You play, the panel on the right lists the moves, and the bot picks its strength from your results. It never shows you a rating. If you start winning easily it gets harder, and if you keep losing it goes easy on you.

The engine is written from scratch in TypeScript and runs in a Web Worker, so the board stays responsive while the bot thinks.

## Install

Download `open_chess_installer.exe`, or the portable `open_chess.exe`, from the [releases page](https://github.com/Lucki74/open-chess/releases). The builds are not code signed, so Windows SmartScreen will warn you on first run.

## Controls

- Click or drag a piece to move it. Dots mark the legal squares.
- `Ctrl+Z` takes back your last move. `H` shows a hint as a blue arrow. You get three of each per game, and both also have a button under the board.
- `F` flips the board, `M` mutes, `N` starts a new game after a confirmation.
- Arrow keys move the focus, Enter or Space picks up and drops a piece.

## Build from source

You need Node.js and npm.

```bash
npm install
npm run dev     # run with hot reload
npm test        # unit tests
npm run build   # installer and portable exe in release/
```

## How the bot works

The bot has 101 skill levels, from a random mover at 0 to a full-depth search at 100. After each game your result and how accurately you played nudge a hidden rating, and the bot moves toward a level that fits it.

`npm run selfplay` plays the levels against each other, and `npm run simulate` runs simulated players of different strengths against the adaptive bot.

## Layout

- `electron/` main process and local storage
- `src/engine/` move generation, search and levels
- `src/skill/` rating and adaptation
- `src/ui/` board and history panel
- `tests/` and `e2e/` unit tests and Electron end-to-end scripts
