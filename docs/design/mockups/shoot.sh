#!/usr/bin/env bash
# Checks every mockup, then screenshots each at its own size in kitty on a virtual display, with
# the terminal-screenshot skill's shot.sh. Pictures go to docs/design/<folder>/<name>.png.
#   docs/design/mockups/shoot.sh [name...]     (default: every mockup)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
design="$(dirname "$here")"
shot="$HOME/.claude/skills/terminal-screenshot/shot.sh"
bun "$here/check.ts"
# kitty's cells are 8x19 pixels with kitty/kitty.conf's font, so a 120x40 frame is 962x762.
bun "$here/show.ts" --list | while read -r name cols rows folder; do
  if [ $# -gt 0 ] && [[ " $* " != *" $name "* ]]; then continue; fi
  out="$design/$folder"
  mkdir -p "$out"
  "$shot" --out "$out" --size "$((cols * 8 + 2))x$((rows * 19 + 2))" --env "KITTY_CONFIG_DIRECTORY=$here/kitty" \
    --cmd "bun $here/show.ts $name" wait 2 shot "$name" >/dev/null </dev/null
  # A 192-color palette keeps terminal text sharp at a third of the size.
  if command -v magick >/dev/null; then magick "$out/$name.png" -depth 8 -colors 192 "PNG8:$out/$name.png"; fi
  rm -f "$out/kitty.log" "$out/xvfb.log"
  echo "$out/$name.png"
done
