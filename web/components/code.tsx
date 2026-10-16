import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" className="text-button" onClick={() => void copy()}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** The text an Edit replaces and what it puts in its place. */
export function Diff({ before, after }: { before: string; after: string }) {
  const lines = (text: string) => (text ? text.split("\n") : []);
  return (
    <pre className="diff">
      {lines(before).map((line, i) => (
        <span key={`d${i}`} className="del">
          {`- ${line}`}
        </span>
      ))}
      {lines(after).map((line, i) => (
        <span key={`a${i}`} className="add">
          {`+ ${line}`}
        </span>
      ))}
    </pre>
  );
}
