"""Classify each row of a 40-row text capture as content or chrome, for the audit's row budget.

Usage: python3 -I rows.py FILE...   (astrocode captures end -ac.txt, claude's -cc.txt)
"""
import re
import sys

BLANK = "blank"


def kind_ac(line: str) -> str:
    s = line.rstrip()
    if not s.strip():
        return BLANK
    if re.fullmatch(r"[│┃ ]+", s):
        return "rail spacer"
    if re.fullmatch(r"[▁▀▄ ]+", s.replace("┃", "")):
        return "panel edge"
    if "shift+tab" in s and ("context" in s or "ask first" in s or "accept" in s):
        return "status bar"
    if s.lstrip().startswith("❯"):
        return "message box"
    if "⬢" in s and "astrocode" in s or re.fullmatch(r"[⬢· ]+", s.strip()) or "/tmp/ac-ux" in s and "⎇" in s:
        return "start mark"
    if s.startswith("╰──"):
        return "turn closer"
    if re.match(r"^[⣀-⣿⠀-⡿]\s*$", s):
        return "live tip"
    if re.match(r"^[⣀-⣿⠀-⡿◆] (Working|Waiting|Getting|Running|Thinking|Writing|Claude has)", s):
        return "live line"
    if re.match(r"^[✓●✕×■◌] (Bash|Read|Write|Edit|Search|Find|Inspect|Background)", s):
        return "step name (made from calls)"
    if re.search(r"(to choose|enter to confirm|esc to deny|esc to dismiss)", s):
        return "hint line"
    return "content"


def kind_cc(line: str) -> str:
    s = line.rstrip()
    if not s.strip():
        return BLANK
    if re.fullmatch(r"[─╌ ]+.*", s) and set(s.strip()) <= set("─╌ abcdefghijklmnopqrstuvwxyzUXA"):
        return "rule"
    if s.startswith("❯"):
        return "message box"
    if re.match(r"^\s+(Sonnet|ctx|7d|⏸|⏵⏵)", s):
        return "status line"
    if re.match(r"^[✻✽*·✢✶] ", s):
        return "spinner/done line"
    if re.search(r"(Esc to cancel|Enter to select)", s):
        return "hint line"
    if re.match(r"^\s*(▐▛|▝▜|▝▝)", s):
        return "start mark"
    if "◐ medium" in s:
        return "effort hint"
    return "content"


for path in sys.argv[1:]:
    rows = open(path, encoding="utf-8").read().split("\n")[:40]
    rows += [""] * (40 - len(rows))
    classify = kind_cc if path.endswith("-cc.txt") else kind_ac
    counts: dict[str, int] = {}
    for row in rows:
        k = classify(row)
        counts[k] = counts.get(k, 0) + 1
    content = counts.get("content", 0)
    print(f"{path.split('/')[-1]}: content {content}/40 ({content * 100 // 40}%)")
    for k, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        if k != "content":
            print(f"    {n:2d}  {k}")
