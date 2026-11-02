#!/usr/bin/env bash
# Checks every mockup, then screenshots each at 120x40 in kitty on a virtual display, with the
# terminal-screenshot skill's shot.sh. Pictures go to docs/design/directions/shots/.
#   docs/design/mockups/shoot.sh [direction...]     (default: a b c)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../directions/shots"
shot="$HOME/.claude/skills/terminal-screenshot/shot.sh"
mkdir -p "$out"
bun "$here/check.ts"
for direction in "${@:-a b c}"; do
  for d in $direction; do
    for moment in working permission review; do
      "$shot" --out "$out" --size 962x762 --env "KITTY_CONFIG_DIRECTORY=$here/kitty" \
        --cmd "bun $here/show.ts $d $moment" wait 2 shot "$d-$moment" >/dev/null
      # A 192-color palette keeps terminal text sharp at a third of the size.
      if command -v magick >/dev/null; then magick "$out/$d-$moment.png" -depth 8 -colors 192 "PNG8:$out/$d-$moment.png"; fi
      echo "$out/$d-$moment.png"
    done
  done
done
rm -f "$out/kitty.log" "$out/xvfb.log"
