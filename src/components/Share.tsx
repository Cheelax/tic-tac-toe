import { useRef, useState } from "react";

interface Props {
  url: string;
  moveCount: number;
}

export function Share({ url, moveCount }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<{ url: string; message: string } | null>(null);
  const message = feedback?.url === url ? feedback.message : "";

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setFeedback({ url, message: "Link copied. Open it to replay this position." });
    } catch {
      input.current?.focus();
      input.current?.select();
      setFeedback({ url, message: "Clipboard unavailable. Select the link and copy it manually." });
    }
  }

  return (
    <section className="share" aria-labelledby="share-title">
      <div className="share-heading">
        <h2 id="share-title">Share this game</h2>
        <span>{moveCount === 0 ? "Empty board" : `${moveCount} ${moveCount === 1 ? "move" : "moves"}`}</span>
      </div>
      <div className="share-controls">
        <input ref={input} id="share-url" data-testid="share-url" aria-label="Game link" aria-describedby="share-note"
          value={url} readOnly spellCheck={false} onFocus={(event) => event.currentTarget.select()} />
        <button type="button" data-testid="copy-link" onClick={copy}>Copy link</button>
      </div>
      <p id="share-note">Opens this position in two-player mode. Opening a link adds no points.</p>
      <p className="copy-feedback" role="status" aria-live="polite">{message}</p>
    </section>
  );
}
