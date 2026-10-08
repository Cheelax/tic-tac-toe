import type { Scores } from "../scoreStorage";

export function Scoreboard({ scores, onReset, saved }: { scores: Scores; onReset: () => void; saved: boolean }) {
  return <section className="score-section" aria-labelledby="score-title">
    <div className="section-heading"><h2 id="score-title">Scoreboard</h2>
      <button type="button" className="quiet-button" data-testid="reset-score" onClick={onReset}>Reset scores</button>
    </div>
    <dl className="scoreboard">
      <div><dt>X wins</dt><dd data-testid="score-x">{scores.x}</dd></div>
      <div><dt>O wins</dt><dd data-testid="score-o">{scores.o}</dd></div>
      <div><dt>Draws</dt><dd data-testid="score-draw">{scores.draw}</dd></div>
    </dl>
    <p className="panel-note" role="status">{saved ? "Saved on this browser. Each game counts once." : "Scores work, but this browser cannot save them across reloads."}</p>
  </section>;
}
