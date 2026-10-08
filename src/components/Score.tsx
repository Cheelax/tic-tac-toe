import type { Score as Tally } from "../score";

/** The games finished so far, kept across reloads, and the button that sets them back to 0. */
export function Score({ score, onReset }: { score: Tally; onReset: () => void }) {
  return (
    <section className="score" aria-labelledby="score-title">
      <h2 id="score-title" className="visually-hidden">Score</h2>
      <dl className="score-tiles">
        <div className="score-tile" data-player="X">
          <dt>X wins</dt>
          <dd data-testid="score-x">{score.x}</dd>
        </div>
        <div className="score-tile">
          <dt>Draws</dt>
          <dd data-testid="score-draw">{score.draw}</dd>
        </div>
        <div className="score-tile" data-player="O">
          <dt>O wins</dt>
          <dd data-testid="score-o">{score.o}</dd>
        </div>
      </dl>
      <button type="button" className="reset-score" data-testid="reset-score" onClick={onReset}>Reset score</button>
    </section>
  );
}
