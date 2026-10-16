// Began as a copy of nebula-ui's Markdown parser, and is astrocode's own now. A link keeps its URL
// as a following `url` span, since a terminal can't hide it behind the text.

/**
 * Splits a reply's markdown into the blocks astrocode draws itself (fences,
 * headings, tables, quotes and callouts, rules) and runs of prose, which stay
 * with the engine's own Markdown renderer so lists, links and paragraphs keep
 * working. Also the text helpers the drawing shares: how many terminal cells a
 * string takes, and what a tool or process printed without its control codes.
 */

export type Callout = 'note' | 'tip' | 'important' | 'warning' | 'caution'

export type Align = 'left' | 'center' | 'right'

export type Block =
  | { kind: 'prose'; text: string }
  | { kind: 'code'; language: string; source: string; isOpen: boolean }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'table'; align: Align[]; header: string[]; rows: string[][] }
  | { kind: 'quote'; callout: Callout | null; title: string; text: string }
  | { kind: 'rule' }

export type Span = { text: string; style: 'plain' | 'code' | 'bold' | 'italic' | 'strike' | 'link' | 'url' | 'command' | 'image' }

const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const QUOTE = /^ {0,3}>\s?(.*)$/
/** A list item, or a line indented under one: a fence indented after it belongs to the list. */
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s|^\s+\S/
const CALLOUT = /^\[!(note|tip|important|warning|caution)\]\s*(.*)$/i
const TABLE_DIVIDER = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const NUMERIC = /^[~≈<>+\-−$€£]*\s*[\d.,]+\s*(%|x|ms|s|m|h|k|kb|mb|gb|tb)?$/i

/**
 * Inline markdown. Asterisks hug what they emphasize, so `ls *.ts and *.js` and `2 ** 3 ** 4` stay
 * as typed; underscores don't open or close inside a word. `[Image #n]` is an attached image.
 */
const INLINE =
  /(`+)(.+?)\1|\*\*(?!\s)(.+?)(?<!\s)\*\*|__(.+?)__|~~(.+?)~~|\*(?![\s*])(.+?)(?<![\s*])\*|(?<![\w])_(?!\s)(.+?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)|(\[Image #\d+\])/g

/** Terminal color and cursor codes, and the other escape sequences a tool or process prints. */
export const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

/** One color code, `ESC[` then numbers and `m`: the only escape sequence drawn, as a style. */
const SGR_TOKEN = /(\u001b\[[0-9;]*m)/

/** Text a tool or process printed, safe to draw: escape sequences gone, other control characters but tab and newline dropped. */
export const printable = (text: string) =>
  text.replace(ANSI, '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')

/** `printable`, keeping the color codes, which `colorRuns` reads as styles. */
export const printableColored = (text: string) =>
  text
    .split(SGR_TOKEN)
    .map((part, index) => (index % 2 === 1 ? part : printable(part)))
    .join('')

/** East Asian wide and fullwidth code points, and the emoji that take two cells, ascending so a search can stop early. */
const WIDE: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x16fe0, 0x18aff],
  [0x1b000, 0x1b2ff],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f251],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f7e0, 0x1f7eb],
  [0x1f90c, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
]

const isWide = (code: number) => {
  for (const [from, to] of WIDE) {
    if (code < from) {
      return false
    }
    if (code <= to) {
      return true
    }
  }

  return false
}

/** Code points that take no cell of their own: combining marks, joiners, variation selectors, skin tones and tags. */
const isZeroWidth = (code: number) =>
  (code >= 0x0300 && code <= 0x036f) ||
  (code >= 0x1ab0 && code <= 0x1aff) ||
  (code >= 0x1dc0 && code <= 0x1dff) ||
  (code >= 0x20d0 && code <= 0x20ff) ||
  (code >= 0xfe00 && code <= 0xfe0f) ||
  (code >= 0xfe20 && code <= 0xfe2f) ||
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x2028 && code <= 0x202e) ||
  (code >= 0x2060 && code <= 0x206f) ||
  (code >= 0x1f3fb && code <= 0x1f3ff) ||
  (code >= 0xe0020 && code <= 0xe007f) ||
  (code >= 0xe0100 && code <= 0xe01ef)

type Graphemes = { segment: (text: string) => Iterable<{ segment: string }> }

let segmenter: Graphemes | null | undefined

/** Grapheme clusters: what a reader takes for one character, an emoji sequence or a letter with its marks. */
const graphemes = (text: string): string[] => {
  if (segmenter === undefined) {
    const Segmenter = (Intl as unknown as { Segmenter?: new (locale: undefined, options: { granularity: 'grapheme' }) => Graphemes })
      .Segmenter
    segmenter = Segmenter === undefined ? null : new Segmenter(undefined, { granularity: 'grapheme' })
  }

  return segmenter === null ? [...text] : [...segmenter.segment(text)].map(part => part.segment)
}

/** The cells one grapheme takes: two for a wide glyph, an emoji or a flag, one for other visible text, none for marks alone. */
const cellsOf = (grapheme: string) => {
  let visible = false
  let wide = false
  for (const char of grapheme) {
    const code = char.codePointAt(0)!
    if (isZeroWidth(code)) {
      continue
    }
    visible = true
    if (isWide(code) || (code >= 0x1f1e6 && code <= 0x1f1ff)) {
      wide = true
    }
  }

  return visible ? (wide ? 2 : 1) : 0
}

/** Terminal cells a string takes on screen: what a column must hold, which a code point count does not give for wide glyphs. */
export const cellWidth = (text: string) => graphemes(text).reduce((sum, grapheme) => sum + cellsOf(grapheme), 0)

/** How many leading graphemes fit in `room` cells: always one, so a wide glyph in a one-cell room still advances. */
const headCount = (parts: string[], room: number) => {
  let cells = 0
  let count = 0
  while (count < parts.length) {
    const next = cellsOf(parts[count]!)
    if (count > 0 && cells + next > room) {
      break
    }
    cells += next
    count++
  }

  return count
}

/** The leading part of `text` that fits `room` cells, and the rest. */
export const takeCells = (text: string, room: number): [string, string] => {
  const parts = graphemes(text)
  const count = headCount(parts, room)

  return [parts.slice(0, count).join(''), parts.slice(count).join('')]
}

/** The trailing part of `text` that fits `room` cells. */
export const lastCells = (text: string, room: number) => {
  const parts = graphemes(text).reverse()

  return parts.slice(0, headCount(parts, room)).reverse().join('')
}

/**
 * A line's inline markdown as styled runs: code, bold, italic, strike, link text, images. Inside bold,
 * italic, strike and link text, code stays code and a link stays a link; emphasis inside emphasis
 * takes the outer style, so its markers never show.
 */
export const spans = (text: string): Span[] => {
  const out: Span[] = []
  let at = 0
  for (const match of text.matchAll(INLINE)) {
    if (match.index > at) {
      out.push({ text: text.slice(at, match.index), style: 'plain' })
    }
    const [, , code, bold, boldU, strike, italic, italicU, link, url, image] = match
    if (code !== undefined) {
      out.push({ text: code.trim(), style: 'code' })
    } else if (image !== undefined) {
      out.push({ text: image, style: 'image' })
    } else {
      const [inner, style]: [string, Span['style']] =
        bold !== undefined || boldU !== undefined
          ? [(bold ?? boldU)!, 'bold']
          : strike !== undefined
            ? [strike, 'strike']
            : italic !== undefined || italicU !== undefined
              ? [(italic ?? italicU)!, 'italic']
              : [link!, 'link']
      for (const run of spans(inner)) {
        out.push(run.style === 'code' || run.style === 'link' || run.style === 'url' || run.style === 'image' ? run : { text: run.text, style })
      }
      if (style === 'link' && url !== undefined && url !== link) {
        out.push({ text: ` (${url})`, style: 'url' })
      }
    }
    at = match.index + match[0].length
  }
  if (at < text.length) {
    out.push({ text: text.slice(at), style: 'plain' })
  }

  return out
}

/** Cells the text takes once its inline markers are drawn as styles. */
export const width = (text: string) => spans(text).reduce((sum, run) => sum + cellWidth(run.text), 0)

/** A table row's cells: split on pipes outside code spans, `\|` kept as a pipe. A backtick with no closing one is a plain character. */
const rowCells = (line: string) => {
  const row = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
  const out: string[] = []
  let cell = ''
  let at = 0
  while (at < row.length) {
    const char = row[at]!
    if (char === '\\' && row[at + 1] === '|') {
      cell += '|'
      at += 2
    } else if (char === '`') {
      const run = /^`+/.exec(row.slice(at))![0]
      const close = row.indexOf(run, at + run.length)
      if (close === -1) {
        cell += run
        at += run.length
      } else {
        cell += row.slice(at, close + run.length)
        at = close + run.length
      }
    } else if (char === '|') {
      out.push(cell.trim())
      cell = ''
      at++
    } else {
      cell += char
      at++
    }
  }
  out.push(cell.trim())

  return out
}

const alignOf = (divider: string): Align => {
  const left = divider.startsWith(':')
  const right = divider.endsWith(':')

  return left && right ? 'center' : right ? 'right' : 'left'
}

/** Each column's alignment: the divider's markers, else right for a column of numbers. */
const alignments = (dividers: string[], rows: string[][]) =>
  dividers.map((divider, column) => {
    const marked = divider.startsWith(':') || divider.endsWith(':')
    const values = rows.map(row => row[column] ?? '').filter(value => value !== '')
    const isNumeric = values.length > 0 && values.every(value => NUMERIC.test(value))

    return marked ? alignOf(divider) : isNumeric ? 'right' : 'left'
  })

const dedent = (lines: string[], indent: number) =>
  lines.map(line => line.slice(Math.min(indent, line.length - line.trimStart().length)))

/** A line that closes a fence opened with `marker`: the same fence character, at least as long, and nothing after it. */
const closesFence = (line: string, marker: string) => {
  const run = line.trim()

  return run.length >= marker.length && [...run].every(char => char === marker[0])
}

export const parse = (text: string): Block[] => {
  const lines = text.split('\n').map(line => line.replace(/\r$/, ''))
  const blocks: Block[] = []
  let prose: string[] = []

  const flush = () => {
    const joined = prose.join('\n').trim()
    if (joined !== '') {
      blocks.push({ kind: 'prose', text: joined })
    }
    prose = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    const fence = FENCE.exec(line)
    if (fence !== null) {
      const marker = fence[2]!
      const body: string[] = []
      i++
      while (i < lines.length && !closesFence(lines[i]!, marker)) {
        body.push(lines[i]!)
        i++
      }
      const lastProse = prose.findLast(one => one.trim() !== '') ?? ''
      if (fence[1]!.length > 0 && LIST_ITEM.test(lastProse)) {
        prose.push(line, ...body, ...(i < lines.length ? [lines[i]!] : []))
        continue
      }
      flush()
      blocks.push({
        kind: 'code',
        language: fence[3]!.toLowerCase(),
        source: dedent(body, fence[1]!.length).join('\n'),
        isOpen: i >= lines.length,
      })
      continue
    }

    const next = lines[i + 1]
    if (line.includes('|') && next !== undefined && TABLE_DIVIDER.test(next) && next.includes('-')) {
      const header = rowCells(line)
      const dividers = rowCells(next)
      if (dividers.length === header.length) {
        flush()
        const rows: string[][] = []
        i += 2
        while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
          const row = rowCells(lines[i]!)
          rows.push(header.map((_, column) => row[column] ?? ''))
          i++
        }
        i--
        blocks.push({ kind: 'table', align: alignments(dividers, rows), header, rows })
        continue
      }
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      flush()
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! })
      continue
    }

    if (RULE.test(line)) {
      flush()
      blocks.push({ kind: 'rule' })
      continue
    }

    if (QUOTE.test(line)) {
      flush()
      const body: string[] = []
      while (i < lines.length) {
        const quoted = QUOTE.exec(lines[i]!)
        if (quoted === null) {
          break
        }
        body.push(quoted[1]!)
        i++
      }
      i--
      const callout = CALLOUT.exec(body[0] ?? '')
      if (callout !== null) {
        body.shift()
      }
      blocks.push({
        kind: 'quote',
        callout: callout === null ? null : (callout[1]!.toLowerCase() as Callout),
        title: callout?.[2] ?? '',
        text: body.join('\n').trim(),
      })
      continue
    }

    prose.push(line)
  }
  flush()

  return blocks
}

/**
 * Column widths that fit `room` columns of content: each column's widest cell,
 * the widest shrunk a column at a time (to no less than 6) until they fit.
 */
export const fitColumns = (natural: number[], room: number) => {
  const widths = natural.map(one => Math.max(1, one))
  let total = widths.reduce((sum, one) => sum + one, 0)
  while (total > room) {
    const widest = widths.indexOf(Math.max(...widths))
    if (widths[widest]! <= 6) {
      break
    }
    widths[widest] = widths[widest]! - 1
    total--
  }

  return widths
}

/**
 * Styled runs word-wrapped into rows of at most `room` cells, styles kept across the breaks: a word
 * longer than a row is cut, spaces at a break are dropped. An empty input is one empty row.
 */
export const wrapSpans = (runs: Span[], room: number): Span[][] => {
  const limit = Math.max(1, room)
  const rows: Span[][] = [[]]
  let used = 0
  let hasWords = false

  const add = (text: string, style: Span['style']) => {
    if (text === '') {
      return
    }
    const row = rows[rows.length - 1]!
    const last = row[row.length - 1]
    if (last !== undefined && last.style === style) {
      last.text += text
    } else {
      row.push({ text, style })
    }
    used += cellWidth(text)
  }

  const breakRow = () => {
    const row = rows[rows.length - 1]!
    // A row ends where its last words do: trailing whitespace goes, in every run it reaches.
    for (let at = row.length - 1; at >= 0; at--) {
      row[at]!.text = row[at]!.text.replace(/\s+$/, '')
      if (row[at]!.text !== '') {
        break
      }
    }
    rows.push([])
    used = 0
  }

  for (const run of runs) {
    for (const token of run.text.split(/(\s+)/)) {
      if (token === '') {
        continue
      }
      if (/^\s+$/.test(token)) {
        if (!hasWords) {
          // A line's own indentation stays.
          const indent = limit - 1
          if (indent > 0) {
            add(takeCells(token, indent)[0], run.style)
          }
        } else if (used > 0 && used + cellWidth(token) <= limit) {
          add(token, run.style)
        } else if (used > 0) {
          breakRow()
        }
        continue
      }
      hasWords = true
      if (used > 0 && used + cellWidth(token) > limit) {
        breakRow()
      }
      let rest = token
      while (cellWidth(rest) > limit) {
        const [head, tail] = takeCells(rest, limit)
        add(head, run.style)
        breakRow()
        rest = tail
      }
      add(rest, run.style)
    }
  }

  return rows.map(row => row.filter(run => run.text !== ''))
}

/** Text with newlines wrapped line by line; inline markdown read as styles unless `isPlain`. */
export const wrapText = (text: string, room: number, isPlain = false): Span[][] =>
  text.split('\n').flatMap(line => wrapSpans(isPlain ? [{ text: line, style: 'plain' }] : spans(line), room))

/** Cells a row of runs takes. */
export const rowWidth = (row: Span[]) => row.reduce((sum, run) => sum + cellWidth(run.text), 0)

/** A command a reply names in inline code: a slash command or `! shell` for this session, or a shell command. */
export type Command = { kind: 'slash' | 'bang' | 'shell'; text: string }

/** First words that make inline code a shell command worth running (a path or a name is left alone). */
const SHELL_WORDS = new Set(
  (
    'claude git gh npm npx pnpm yarn bun bunx deno node python python3 pip pip3 uv uvx cargo rustup go make cmake ' +
    'docker podman kubectl brew apt sudo curl wget ssh scp rsync ls cd cat rg fd grep sed awk tsc eza bat code ' +
    'just mise nvm export source chmod mkdir rm cp mv touch echo tar unzip systemctl journalctl pacman yay paru ' +
    'sleep watch tail head find env time timeout xargs which kill pkill ps top htop du df less man ping jq yq ' +
    'sqlite3 psql mysql redis-cli ruby gem bundle rails php composer java mvn gradle dotnet swift zig nix ' +
    'terraform aws gcloud az firebase vercel netlify flyctl vite pytest jest vitest eslint prettier ruff black ' +
    'mypy poetry pipx conda tmux zsh bash sh fish nvim vim nano http nc dig open xdg-open godot gdh'
  ).split(' '),
)

/** Words that are also plain English, so inline code starting with one reads as a command only with shell syntax after it. */
const AMBIGUOUS = new Set(
  'export find time code open top go head less watch which man source env ping http dig touch kill tail make'.split(' '),
)

/** A flag or a piece of shell syntax, which make code read as a command whatever its first word. */
const SHELL_SHAPE = /(?:^|\s)--?[a-z0-9]|&&|\|\||[|;>]|\$[A-Za-z_{(]/i

/** `export NAME=value`, the one form of `export` that is a shell command in a sentence's clothes. */
const EXPORT_ASSIGNMENT = /^export\s+[A-Za-z_]\w*=/

/** A program's name: lowercase, as typed at a prompt (not `Name`, `fn(x)` or `a.b.c`). */
const PROGRAM = /^[a-z][a-z0-9_+-]*$/

/** Leading `NAME=value` assignments, which say where a command's environment comes from, not what it runs. */
const ASSIGNMENTS = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/

/** What a piece of inline code would run, or null when it reads as a name, a path or a value. */
export const commandOf = (code: string): Command | null => {
  const text = code.trim()
  if (/^\/[a-z][\w:-]*(?:\s|$)/i.test(text)) {
    return { kind: 'slash', text }
  }
  if (/^!\s*\S/.test(text)) {
    return { kind: 'bang', text: `!${text.slice(1).trimStart()}` }
  }
  const body = text.replace(ASSIGNMENTS, '')
  const first = body.split(/\s+/)[0] ?? ''
  if (!/\s/.test(body)) {
    return null
  }
  const isCommand =
    EXPORT_ASSIGNMENT.test(body) ||
    (SHELL_WORDS.has(first) && (!AMBIGUOUS.has(first) || SHELL_SHAPE.test(body))) ||
    (PROGRAM.test(first) && SHELL_SHAPE.test(body))

  return isCommand ? { kind: 'shell', text } : null
}

/** Where a command's link points: a host that never resolves, so nothing opens if a click reaches the terminal. */
const COMMAND_HOST = 'https://nebula-ui.invalid/command/'

/**
 * Prose with each command in inline code made a link the mod answers, and the commands by their link.
 * Code already inside a link's text is left as written.
 */
export const linkCommands = (prose: string) => {
  const commands = new Map<string, Command>()
  const text = prose.replace(/(\[?)`([^`\n]+)`/g, (whole, bracket: string, code: string) => {
    const command = bracket === '' ? commandOf(code) : null
    if (command === null) {
      return whole
    }
    const href = `${COMMAND_HOST}${commands.size}`
    commands.set(href, command)

    return `[\`${code}\`](${href})`
  })

  return { text, commands }
}

/** Fence languages that hold shell commands. */
const SHELL_FENCES = new Set(['sh', 'bash', 'shell', 'zsh', 'console', 'terminal', 'fish'])

/**
 * What a code fence would run, or null. A shell fence runs as it is shown, one script, with the `$ ` prompts
 * of a transcript dropped and its comments and blank lines kept; a fence without a language counts when every
 * line reads as a command; one `/` or `!` line goes to the prompt.
 */
export const fenceCommand = (language: string, source: string): Command | null => {
  const lines = source.split('\n').map(line => line.replace(/^\s*\$\s+/, ''))
  const first = lines.findIndex(line => line.trim() !== '')
  if (first === -1) {
    return null
  }
  let last = lines.length - 1
  while (lines[last]!.trim() === '') {
    last--
  }
  const script = lines.slice(first, last + 1)
  const content = script.filter(line => line.trim() !== '' && !line.trim().startsWith('#'))
  if (content.length === 0) {
    return null
  }
  const single = content.length === 1 ? commandOf(content[0]!) : null
  if (single !== null && single.kind !== 'shell') {
    return single
  }
  if (SHELL_FENCES.has(language)) {
    return { kind: 'shell', text: script.join('\n') }
  }
  if (language === '' && content.every(line => commandOf(line)?.kind === 'shell')) {
    return { kind: 'shell', text: script.join('\n') }
  }

  return null
}

/** The style a color code sets, and the ones after it on the same line. */
export type Tint = { color?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean }

/** The eight basic ANSI colors as theme keys, so a tool's colors follow the person's theme. */
const BASIC_COLORS = ['inactive', 'error', 'success', 'warning', 'suggestion', 'permission', 'suggestion', 'text']

const applySgr = (tint: Tint, codes: number[]): Tint => {
  let next: Tint = { ...tint }
  for (const code of codes) {
    if (code === 0) {
      next = {}
    } else if (code === 1) {
      next = { ...next, bold: true }
    } else if (code === 2) {
      next = { ...next, dim: true }
    } else if (code === 3) {
      next = { ...next, italic: true }
    } else if (code === 4) {
      next = { ...next, underline: true }
    } else if (code === 22) {
      next = { ...next, bold: false, dim: false }
    } else if (code === 23) {
      next = { ...next, italic: false }
    } else if (code === 24) {
      next = { ...next, underline: false }
    } else if (code === 39) {
      next = { ...next, color: undefined }
    } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      next = { ...next, color: BASIC_COLORS[code % 10] }
    }
  }

  return next
}

/**
 * A line of a command's output as runs, each with the style its color codes set: bold, dim, italic and
 * underline, and the eight basic colors, bright or not. Other escape sequences and control codes are gone.
 */
export const colorRuns = (line: string): Array<{ text: string } & Tint> => {
  const runs: Array<{ text: string } & Tint> = []
  let tint: Tint = {}
  for (const part of line.split(SGR_TOKEN)) {
    const codes = /^\u001b\[([0-9;]*)m$/.exec(part)
    if (codes !== null) {
      tint = applySgr(tint, codes[1] === '' ? [0] : codes[1]!.split(';').map(Number))
    } else {
      const text = printable(part)
      if (text !== '') {
        runs.push({ ...tint, text })
      }
    }
  }

  return runs
}
