import { useLayoutEffect, useRef, useState } from "react";

type Props = { busy: boolean; connected: boolean; onSend: (text: string) => void; onStop: () => void };

const MAX_HEIGHT = 240;

/** Enter sends, Shift+Enter adds a line, Esc stops Claude. You can send while Claude works; it reads it next. */
export function Composer({ busy, connected, onSend, onStop }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Grow with the text up to MAX_HEIGHT, then scroll.
    el.style.height = "auto";
    const borders = el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(el.scrollHeight + borders, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight + borders > MAX_HEIGHT ? "auto" : "hidden";
  }, [text]);

  const send = () => {
    if (!text.trim() || !connected) return;
    onSend(text);
    setText("");
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={text}
        aria-label="Message Claude"
        placeholder={connected ? "Message Claude" : "Reconnecting to astrocode…"}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          } else if (event.key === "Escape" && busy) {
            event.preventDefault();
            onStop();
          }
        }}
      />
      {busy ? (
        <button type="button" className="btn" onClick={onStop}>
          Stop
        </button>
      ) : null}
      <button type="submit" className="btn primary" disabled={!text.trim() || !connected}>
        Send
      </button>
    </form>
  );
}
