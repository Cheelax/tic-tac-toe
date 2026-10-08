import { statusText, type Outcome } from "../game";

/** Who plays next, or how the game ended, announced to screen readers as it changes. */
export function Status({ outcome }: { outcome: Outcome }) {
  const player = outcome.status === "playing" ? outcome.next : outcome.status === "won" ? outcome.winner : undefined;
  return (
    <p className="status" data-testid="status" data-state={outcome.status} data-player={player} role="status" aria-live="polite">
      {statusText(outcome)}
    </p>
  );
}
