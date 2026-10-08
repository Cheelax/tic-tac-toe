import { Board } from "./components/Board";
import { Status } from "./components/Status";
import { useGame } from "./useGame";

export default function App() {
  const { board, outcome, playCell, newGame } = useGame();
  return (
    <main className="app">
      <h1>Tic-Tac-Toe</h1>
      <Status outcome={outcome} />
      <Board board={board} outcome={outcome} onPlay={playCell} />
      <button type="button" className="new-game" data-testid="new-game" onClick={newGame}>
        New game
      </button>
    </main>
  );
}
