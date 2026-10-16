// Copying what you select in full screen. The terminal sets the clipboard (OSC 52), which also
// works over SSH; the desktop's own copier covers terminals that don't support that.
import { spawn } from "node:child_process";

export function copy(text: string) {
  try {
    process.stdout.write(`\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`);
  } catch {}
  const command = copier();
  if (!command) return;
  const [name = "", ...args] = command;
  try {
    const child = spawn(name, args, { stdio: ["pipe", "ignore", "ignore"], detached: true });
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(text);
    child.unref();
  } catch {}
}

function copier() {
  if (process.platform === "darwin") return ["pbcopy"];
  if (process.env.WAYLAND_DISPLAY) return ["wl-copy"];
  if (process.env.DISPLAY) return ["xclip", "-selection", "clipboard"];
  return null;
}
