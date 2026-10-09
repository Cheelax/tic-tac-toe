import { useEffect, useRef, useState } from "react";

interface Props {
  /** The link of the position shown. */
  link: string;
  /** The moves played on the position shown. */
  shown: number;
}

type Copy = { link: string; copied: boolean };

/**
 * The link of the position shown, and the button that copies it. What the last copy did is said next to it, for as
 * long as the link it copied is the one shown. Without clipboard access, the link is selected for a manual copy.
 */
export function Share({ link, shown }: Props) {
  const field = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<Copy | null>(null);
  const current = copy?.link === link ? copy : null;
  // A long link is cut on the left, not the right: its end, the moves, is what changes.
  useEffect(() => {
    const input = field.current;
    if (input && document.activeElement !== input) input.scrollLeft = input.scrollWidth;
  }, [link]);
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopy({ link, copied: true });
    } catch {
      field.current?.focus();
      field.current?.select();
      setCopy({ link, copied: false });
    }
  }
  const opens = shown === 0 ? "an empty board" : `this game after move ${shown}`;
  return (
    <section className="share" aria-labelledby="share-title">
      <h2 id="share-title" className="share-title">Share this game</h2>
      <div className="share-row">
        <input ref={field} className="share-url" data-testid="share-url" type="url" readOnly value={link}
          aria-label="Link to this game" aria-describedby="share-note" spellCheck={false}
          onFocus={(event) => event.currentTarget.select()} />
        <button type="button" className="copy-link" data-testid="copy-link" data-copied={current?.copied ? "true" : undefined}
          onClick={() => void copyLink()}>{current?.copied ? "Copied" : "Copy link"}</button>
      </div>
      <p className="share-note" id="share-note" role="status">
        {current === null
          ? `The link opens ${opens}.`
          : current.copied
            ? `Link copied. It opens ${opens}.`
            : "Could not reach the clipboard: the link is selected, copy it with Ctrl+C (⌘C on a Mac)."}
      </p>
    </section>
  );
}
