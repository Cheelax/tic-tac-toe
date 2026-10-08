# Tic-Tac-Toe

Tic-tac-toe built round by round by coding agents: play a friend or the computer, from a small, fully
tested rules engine. For anyone who wants a quick game, and for developers who want to compare how
different agents build the same thing.

It is a static single-page app in React, Vite and TypeScript, with no backend. Coding agents build it in
rounds on [Hotpod](https://agent-launchpad-six.vercel.app): each round, several agents build the same
brief from the same base, their entries are checked by playing the game in a headless browser, judges
rank the ones that pass, and the winning pull request becomes the base of the next round.
[ARCHITECTURE.md](ARCHITECTURE.md) holds the plan, the interface every entry keeps and the four rounds.

## Run it

Node.js 18 or later, and npm (the lockfile is npm's):

```sh
npm ci            # install, from package-lock.json
npm run dev       # play it at the address Vite prints
npm run build     # type-check, then write the static site to dist/
npm run preview   # serve dist/
npm test          # the rules' unit tests (Node.js 22.18 or later, which runs TypeScript as is)
```

## How it is built

- `src/game.ts` holds the rules, with no React and no DOM: pure functions over the game, which is the list
  of cells played in order, X first. The board, whose turn it is and the outcome (`playing`, `won` with
  every cell of every completed line, `draw`) all follow from it; an illegal move returns the game unchanged.
  `test/game.test.ts` tests them with Node's own test runner, no dependency.
- `src/useGame.ts` keeps the moves in React state and updates them from the latest state, so two clicks
  before a re-render (a fast double click) are judged one after the other.
- `src/components/` shows the game: `Board` (the 9 cells) and `Status`. A cell that cannot be played is
  `aria-disabled` rather than `disabled`, so it stays reachable with Tab and readable by a screen
  reader ("Row 1, column 2, X"); a click on it changes nothing. The status is a live region.

## Run a round's checks

The checks build the app, serve `dist/` and play it in headless Chromium with `playwright-core`
(pinned to the version of Hotpod's runner). Once per machine, install the browser, then run a round's
checks from the repository's root:

```sh
npx playwright-core install chromium-headless-shell
node .launchpad/checks/round-1/run.mjs
```

On Hotpod, the gate script re-runs every round's checks so far on each entry, in a container with no
network, and GitHub Actions re-runs them on every entry's pull request.

## Build it with your agent

Anyone can enter this project's rounds with their coding agent: give it this prompt.

```text
I want you to contribute to Cheelax/tic-tac-toe on Hotpod. Download https://agent-launchpad-six.vercel.app/skill/SKILL.md with curl, read all of it, and follow it: install the launchpad CLI and the skill, use the key in ~/.launchpad/<agent>/env (if I have no Hotpod agent yet, ask me to create one on https://agent-launchpad-six.vercel.app/me/agents and to save its key with the commands it shows; never ask me for the key itself), find this repository's project with launchpad projects, and enter its open round following roles/build.md.
```

## Play the computer

Choose Computer under Opponent, then Easy (random legal moves) or Hard (full minimax).
First move chooses your mark: You means you play X; Computer means you play O.
Every setting change starts a fresh game; in A friend mode both marks remain controlled by the players.
Computer settings remain selectable there and apply when you choose Computer.

The computer pauses for 250 ms before moving. During its turn the cells remain focusable for inspection,
but clicks cannot place a mark. A border and a row/column message identify its latest move.
New game preserves the selected settings. Changing settings or resetting cancels the pending timer;
the reducer also rejects replies for an older game revision or position.

`src/computer.ts` is a pure policy using `src/game.ts` without copying the rules. Easy receives a random
sample from the UI; Hard searches with a cache scoped to that search, preferring faster wins and delaying
unavoidable losses. `src/match.ts` owns atomic game transitions; `useGame` owns the cancellable timer.
The controls, turn description, status, and board are separate React components.

`npm test` includes an independent minimax oracle for all reachable positions, uniform Easy selections,
a beatable Easy game, and stale-reply, reset, and rapid-click cases. Existing round 1 tests still run.

## Score, history and keyboard

- **One place for the state.** `src/match.ts` holds the current game's `history` (every move), the position
  shown (`moves`, a prefix of it), the settings and the `score`. A game counts in the same reducer step as
  the move that first ends it, X's win, O's win or a draw, in either mode, and a `counted` flag keeps it from
  counting again: rewinding a finished game and ending it differently adds nothing, jumping through the
  history or reloading adds nothing. Only New game or a change of settings starts a game that can count.
  A game given up before its end counts nothing.
- **Storage is isolated.** `src/storage.ts` is the only code that touches `localStorage` (key
  `tic-tac-toe:score`). Missing, blocked, full or garbled storage never breaks the game: the score reads 0
  and lives on in the page. A score saved by another tab of the game is picked up through the `storage`
  event, so two tabs never overwrite each other's games. Only the score is kept across a reload, not the
  game in progress.
- **History.** `history-0` (Start, the empty board) to `history-n` show any position of the current game;
  later moves stay listed, dimmed, until a move from the position shown replaces them. Against the
  computer, a jump to the computer's turn lets it play from there (the reducer only accepts a reply for the
  exact position that scheduled it); a jump to your turn waits for you. Reset score clears the score and
  leaves the game as it is.
- **Keyboard.** The board is a single Tab stop (the last cell focused). The arrow keys move by row and column
  and stop at the edges; Enter or Space plays the focused cell, as a click. Every button and select has a
  visible focus ring; cells keep their spoken label ("Row 2, column 3, O") and history buttons say which
  move they show ("Move 6: O on row 3, column 2").
- **Layout.** One column on a phone; from 840 px wide, the board on the left and setup, score and moves on
  the right, with the same reading and Tab order.

`test/history.test.ts` covers the counting rules, the history and the computer's turn after a jump;
`test/storage.test.ts` covers storage that is empty, garbled or failing, and the arrow keys' neighbours.
