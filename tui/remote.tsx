// /remote-control: the session's link on claude.ai/code and a QR code of it to scan with a phone,
// and how the connection is doing. c copies the link, o opens it here, x turns Remote Control off,
// Enter tries again after a failure, and Esc closes.
import { Box, Text, useInput } from "ink";
import { encode } from "uqr";
import type { RemoteControl } from "../src/events";
import { hyperlink } from "./links";
import { fit, Panel } from "./markdown-view";
import { isDark, PALETTE } from "./theme";

type Props = {
  /** Remote Control as it is now; unset while it's off. */
  remote?: RemoteControl;
  width: number;
  /** The most rows the QR code may take. */
  rows: number;
  onRetry: () => void;
  onTurnOff: () => void;
  onCopy: (url: string) => void;
  onOpen: (url: string) => void;
  onClose: () => void;
};

const STATUS: Record<RemoteControl["status"], { text: string; color: string }> = {
  connecting: { text: "◌ connecting…", color: PALETTE.haze },
  connected: { text: "● connected", color: PALETTE.teal },
  failed: { text: "✕ failed", color: PALETTE.rose },
};

export function RemotePanel({ remote, width, rows, onRetry, onTurnOff, onCopy, onOpen, onClose }: Props) {
  const url = remote?.url;
  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (key.escape || (key.ctrl && input === "c")) return onClose();
    if (key.return) return remote?.status === "failed" || !remote ? onRetry() : onClose();
    if (input === "x" && remote) return onTurnOff();
    if (input === "c" && url) return onCopy(url);
    if (input === "o" && url) return onOpen(url);
  });

  const inner = width - 4;
  const code = url ? qrLines(url) : [];
  const status = remote ? STATUS[remote.status] : { text: "off", color: PALETTE.haze };
  const keys = [url ? "c copy link   o open" : "", remote ? "x turn off" : "", !remote || remote.status === "failed" ? "enter try again" : "", "esc close"];
  return (
    <Panel width={width} accent={PALETTE.gold} label="remote control">
      <Text color={status.color}>{status.text}</Text>
      {remote?.detail ? <Text color={remote.status === "failed" ? PALETTE.rose : PALETTE.haze}>{remote.detail}</Text> : null}
      {url ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={PALETTE.sky} underline>
            {hyperlink(url, fit(url, inner, false))}
          </Text>
          {code.length <= rows && (code[0]?.length ?? 0) <= inner ? <QrCode lines={code} /> : null}
          <Box marginTop={1}>
            <Text color={PALETTE.haze}>
              Scan it with your phone, or open the session in the Claude app's Code list. What you send there, and your answers to Claude's prompts,
              go to Claude as if typed here.
            </Text>
          </Box>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={PALETTE.dust}>{keys.filter(Boolean).join("   ")}</Text>
      </Box>
    </Panel>
  );
}

/**
 * The code drawn dark on light, as scanners expect, whatever the theme: each row of cells is two
 * rows of modules, the upper half block in the dark color over the light background.
 */
function QrCode({ lines }: { lines: string[] }) {
  const [light, dark] = isDark(PALETTE.star) ? [PALETTE.ink, PALETTE.star] : [PALETTE.star, PALETTE.ink];
  return (
    <Box marginTop={1} flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i} color={dark} backgroundColor={light}>
          {line}
        </Text>
      ))}
    </Box>
  );
}

/** A QR code of `text` as rows of half blocks, with a quiet zone of two modules all round. */
export function qrLines(text: string): string[] {
  const { data } = encode(text, { ecc: "L", border: 2 });
  const lines: string[] = [];
  for (let y = 0; y < data.length; y += 2) {
    const top = data[y] ?? [];
    const bottom = data[y + 1] ?? [];
    lines.push(top.map((on, x) => (on ? (bottom[x] ? "█" : "▀") : bottom[x] ? "▄" : " ")).join(""));
  }
  return lines;
}
