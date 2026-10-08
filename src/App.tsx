import { useState } from "react";
import { newBoard, play, position, statusText } from "./game";

export default function App() {
  const [board, setBoard] = useState(newBoard);
  const current = position(board);
  const moves = board.filter((cell) => cell !== null).length;
  const active = current.kind === "playing" ? current.next : null;

  return (
    <main className="app">
      <header className="masthead">
        <span className="brand"><span className="brand-mark" aria-hidden="true">×○</span> TABLETOP</span>
        <span className="edition">NO. 01 / TWO PLAYERS</span>
      </header>
      <section className="game" aria-labelledby="game-title">
        <div className="intro">
          <p className="eyebrow">A FRIENDLY RIVALRY</p>
          <h1 id="game-title">Tic-Tac-Toe<span className="title-dot">.</span></h1>
          <p className="subtitle">One board. Two players. Your next move.</p>
        </div>
        <div className="player-strip" aria-label="Players">
          <div className={`player player-x ${active === "X" ? "active" : ""}`}>
            <span className="player-mark" aria-hidden="true">X</span>
            <span><strong>Player X</strong><small>{active === "X" ? "YOUR TURN" : "STARTS THE GAME"}</small></span>
            <span className="turn-dot" aria-hidden="true" />
          </div>
          <div className={`player player-o ${active === "O" ? "active" : ""}`}>
            <span className="player-mark" aria-hidden="true">O</span>
            <span><strong>Player O</strong><small>{active === "O" ? "YOUR TURN" : "SECOND TO PLAY"}</small></span>
            <span className="turn-dot" aria-hidden="true" />
          </div>
        </div>
        <div className="board-shell">
          <div className="board" data-testid="board" role="group" aria-label="Tic-tac-toe board" aria-describedby="instructions">
            {board.map((mark, index) => {
              const winning = current.winningCells.includes(index);
              const unavailable = mark !== null || current.kind !== "playing";
              return (
                <button
                  key={index}
                  type="button"
                  className={`cell ${mark ? `mark-${mark.toLowerCase()}` : "empty"}`}
                  data-testid={`cell-${index}`}
                  data-win={winning ? "true" : undefined}
                  aria-label={`Row ${Math.floor(index / 3) + 1}, column ${index % 3 + 1}, ${mark ?? "empty"}${winning ? ", winning line" : ""}`}
                  aria-disabled={unavailable}
                  onClick={() => setBoard((latest) => play(latest, index))}
                >{mark}</button>
              );
            })}
          </div>
        </div>
        <div className={`game-footer ${current.kind !== "playing" ? "finished" : ""}`}>
          <div className="status-wrap">
            <span className="status-dot" aria-hidden="true" />
            <p data-testid="status" role="status" aria-live="polite" aria-atomic="true">{statusText(current)}</p>
            <span className="move-count" aria-label={`${moves} moves played`}>{String(moves).padStart(2, "0")} / 09</span>
          </div>
          <button className="new-game" data-testid="new-game" type="button" onClick={() => setBoard(newBoard())}>
            <span aria-hidden="true">↻</span> New game
          </button>
        </div>
        <p id="instructions" className="instructions">
          {current.kind === "won" ? "Three in a row. Ready for a rematch?"
            : current.kind === "draw" ? "A well-matched pair. Try another round."
            : "Take turns. Get three in a row to win."}
          <span>Tab to a square · Enter or Space to play</span>
        </p>
      </section>
      <footer className="colophon"><span>GOOD COMPANY. A SIMPLE GAME.</span><span>X & O, SINCE ALWAYS.</span></footer>
    </main>
  );
}
