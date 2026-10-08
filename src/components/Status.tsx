import { statusText, type Outcome } from "../game";

interface StatusProps {
  outcome: Outcome;
  /** The computer is about to move: shown beside the text, which stays the same. */
  thinking?: boolean;
}

/** Who plays next, or how the game ended, announced to screen readers as it changes. */
export function Status({ outcome, thinking = false }: StatusProps) {
  const player = outcome.status === "playing" ? outcome.next : outcome.status === "won" ? outcome.winner : undefined;
  return (
    <p
      className="status"
      data-testid="status"
      data-state={outcome.status}
      data-player={player}
      data-thinking={thinking ? "true" : undefined}
      role="status"
      aria-live="polite"
    >
      {statusText(outcome)}
    </p>
  );
}
