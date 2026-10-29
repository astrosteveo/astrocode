// The lightbox: one of the conversation's pictures as large as the screen allows, above the message
// box. ← and → flip through the others in the order they came, so a before and after, or a
// picture drawn again, swap in place. It opens from a click on a picture in full screen, or
// /pictures, and closes with Esc, or in full screen a click on the picture or on `esc close`.
import { Box, Text, useInput, type DOMElement } from "ink";
import { useEffect, useRef, useState } from "react";
import type { ImageAttachment } from "../src/events";
import { pageFile, pictureFile, type Shown } from "./figure";
import { Panel } from "./markdown-view";
import { hit, useHover, useMouse } from "./mouse";
import { copyOf, ImageView, isReady, prepare } from "./pictures";
import { PALETTE } from "./theme";

/** Rows the lightbox and what stays under it (the message box and the status bar) take besides the picture. */
const AROUND = 12;

type Props = {
  /** Every picture in the conversation, in order. */
  gallery: readonly Shown[];
  /** The picture it opens on. */
  start: ImageAttachment;
  width: number;
  /** The terminal's height. */
  rows: number;
  onClose: () => void;
  /** Opens a file astrocode wrote, in the desktop's image viewer or browser. */
  onOpen: (path: string) => void;
  onCopy: (text: string) => void;
};

export function Lightbox({ gallery, start, width, rows, onClose, onOpen, onCopy }: Props) {
  const [at, setAt] = useState(() => Math.max(0, gallery.findIndex((one) => one.image === start)));
  const index = Math.min(at, gallery.length - 1);
  const shown = gallery[index];
  const large = shown ? copyOf(shown.image) : null;
  const [, setDrawn] = useState(0);
  useEffect(() => {
    if (large && !isReady(large)) void prepare(large).then(() => setDrawn((n) => n + 1));
  }, [large]);

  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (key.escape || input === "q" || (key.ctrl && input === "c")) return onClose();
    if (key.leftArrow) return setAt(Math.max(0, index - 1));
    if (key.rightArrow) return setAt(Math.min(gallery.length - 1, index + 1));
    if (!shown) return;
    if (input === "o") {
      const file = pictureFile(shown.image);
      if (file) onOpen(file);
    } else if (input === "b" && shown.html) onOpen(pageFile(shown.html));
    else if (input === "c" && shown.source) onCopy(shown.source);
  });

  // A click on the picture puts it back, as a click on it in the transcript enlarged it, and so
  // does one on `esc close`.
  const picture = useRef<DOMElement>(null);
  const closer = useRef<DOMElement>(null);
  useMouse((event) => {
    if (event.type !== "press" || event.button !== "left") return;
    if (!hit(picture.current, event) && !hit(closer.current, event)) return;
    event.handled = true;
    onClose();
  });
  useHover(picture, () => ({ key: "picture", shape: "zoom-out" }));
  const overClose = useHover(closer, () => ({ key: "close", shape: "pointer" })) !== null;

  if (!shown || !large) return null;
  const inner = width - 2;
  const tall = Math.max(4, rows - AROUND);
  const name = [shown.title, shown.label, shown.caption].filter(Boolean).join(" · ") || "Picture";
  const keys = [gallery.length > 1 ? "←→ flip" : "", "o open", shown.html ? "b browser" : "", shown.source ? "c copy source" : ""];
  return (
    <Panel width={width} accent={PALETTE.gold} note={gallery.length > 1 ? `${index + 1} of ${gallery.length}` : undefined}>
      <Text bold color={PALETTE.star} wrap="truncate-end">
        {name}
      </Text>
      {/* The same height whatever picture it shows, so flipping doesn't move the box or the keys under it. */}
      <Box ref={picture} marginTop={1} height={tall} justifyContent="center">
        <ImageView image={large} width={inner - 2} rows={tall} grow />
      </Box>
      <Box marginTop={1} justifyContent="space-between" width={inner}>
        <Text color={PALETTE.dust} wrap="truncate-end">
          {keys.filter(Boolean).join("   ")}
        </Text>
        <Box ref={closer} flexShrink={0}>
          <Text>
            <Text color={overClose ? PALETTE.star : PALETTE.haze}>esc</Text>
            <Text color={overClose ? PALETTE.star : PALETTE.dust}> close</Text>
          </Text>
        </Box>
      </Box>
    </Panel>
  );
}
