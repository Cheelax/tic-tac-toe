import { Board } from "./components/Board";
import { Settings } from "./components/Settings";
import { Status } from "./components/Status";
import { useGame } from "./useGame";

export default function App() {
  const { board, outcome, settings, computerTurn, playCell, newGame, changeSettings } = useGame();
  return (
    <main className="app">
      <h1>Tic-Tac-Toe</h1>
      <Settings settings={settings} onChange={changeSettings} />
      <Status outcome={outcome} thinking={computerTurn} />
      <Board board={board} outcome={outcome} locked={computerTurn} onPlay={playCell} />
      <button type="button" className="new-game" data-testid="new-game" onClick={newGame}>
        New game
      </button>
    </main>
  );
}
