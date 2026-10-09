import { Board } from "./components/Board";
import { Status } from "./components/Status";
import { GameControls } from "./components/GameControls";
import { History } from "./components/History";
import { Score } from "./components/Score";
import { TurnNote } from "./components/TurnNote";
import { playerOfMove } from "./game";
import { computerPlayer } from "./match";
import { useGame } from "./useGame";

export default function App() {
  const game = useGame();
  const lastComputerCell = game.settings.mode === "cpu" && game.moves.length > 0 && playerOfMove(game.moves.length - 1) === computerPlayer(game.settings)
    ? game.moves[game.moves.length - 1] : undefined;
  return (
    <main className="app">
      <header className="game-heading">
        <p className="eyebrow">A SMALL GAME. A WORTHY OPPONENT.</p>
        <h1>Tic-Tac-Toe</h1>
      </header>
      <GameControls settings={game.settings} onChange={game.changeSettings} />
      <Score score={game.score} onReset={game.resetScore} />
      <div className="turn-summary">
        <Status outcome={game.outcome} />
        <TurnNote moves={game.moves} outcome={game.outcome} thinking={game.thinking} settings={game.settings} />
      </div>
      <Board board={game.board} outcome={game.outcome} onPlay={game.playCell} locked={game.thinking} lastComputerCell={lastComputerCell} />
      <History history={game.history} shown={game.moves.length} onJump={game.jump} />
      <button type="button" className="new-game" data-testid="new-game" onClick={game.newGame}>New game</button>
      <p className="keyboard-hint" id="board-keys">Arrow keys move between squares · Enter or Space plays</p>
    </main>
  );
}
