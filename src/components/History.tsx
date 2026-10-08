import { playerOfMove, position, type Moves } from "../game";

export function History({ moves, step, counted, onJump }: { moves: Moves; step: number; counted: boolean; onJump: (step: number) => void }) {
  return <section className="history-section" aria-labelledby="history-title">
    <div className="section-heading"><h2 id="history-title">Move history</h2><span>{step} / {moves.length}</span></div>
    <div className="history-list">
      {Array.from({ length: moves.length + 1 }, (_, k) => {
        const square = k ? position(moves[k - 1]) : null;
        const mark = k ? playerOfMove(k - 1) : null;
        return <button type="button" key={k} data-testid={`history-${k}`} aria-current={k === step ? "step" : undefined}
          aria-label={k ? `Move ${k}: ${mark}, row ${square!.row + 1}, column ${square!.column + 1}` : "Start: empty board"}
          onClick={() => onJump(k)}>
          <strong>{k ? `${k}. ${mark}` : "Start"}</strong>
          <span>{square ? `R${square.row + 1} C${square.column + 1}` : "Empty"}</span>
        </button>;
      })}
    </div>
    <p className="panel-note">Choose a position to revisit. Play from there to replace later moves.{counted ? " This game has already counted." : ""}</p>
  </section>;
}
