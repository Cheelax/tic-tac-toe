/** Why the link the page was opened with holds no game; the empty board below is the game instead. */
export function LinkError({ reason }: { reason: string }) {
  return (
    <p className="link-error" data-testid="error" role="alert">
      <strong>This link does not hold a game.</strong> {reason} A new game starts instead.
    </p>
  );
}
