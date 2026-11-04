// Began as a copy of nebula-ui's Markdown parser, and is astrocode's own now. A link keeps its URL
// as a following `url` span, since a terminal can't hide it behind the text.
import { BARE_URL, isWebLink } from './links'

/**
 * Splits a reply's markdown into blocks: fences, headings, tables, quotes and
 * callouts, rules, and runs of prose, which hold paragraphs and lists. A fence
 * indented under a list item is a block of its own that keeps its indent, so it
 * sits under the item. Also the text helpers the drawing shares: how many terminal cells a
 * string takes, and what a tool or process printed without its control codes.
 */

export type Callout = 'note' | 'tip' | 'important' | 'warning' | 'caution'

export type Align = 'left' | 'center' | 'right'

export type Block =
  | { kind: 'prose'; text: string }
  /** `indent`: cells the block sits in by, under the list item it belongs to. */
  | { kind: 'code'; language: string; source: string; isOpen: boolean; indent?: number }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'table'; align: Align[]; header: string[]; rows: string[][] }
  | { kind: 'quote'; callout: Callout | null; title: string; text: string }
  | { kind: 'rule' }

/** A run of text in one style. `href` is the web address a link's text and its URL go to. */
export type Span = {
  text: string
  style: 'plain' | 'code' | 'bold' | 'italic' | 'strike' | 'link' | 'url' | 'image'
  href?: string
}

const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)/
/** A fence under a list item, which can be indented further, as under `10. `. */
const LIST_FENCE = /^(\s+)(`{3,}|~{3,})\s*([^\s`]*)/
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
 * as typed; underscores, single or double, don't open or close inside a word, so
 * `mcp__server__tool` and `snake_case` stay as typed. `[Image #n]` is an attached image. A bare web
 * address is a link, matched whole, so emphasis can't start inside it.
 */
const INLINE = new RegExp(
  /(`+)(.+?)\1|\*\*(?!\s)(.+?)(?<!\s)\*\*|(?<![\w])__(?!\s)(.+?)(?<!\s)__(?![\w])|~~(.+?)~~|\*(?![\s*])(.+?)(?<![\s*])\*|(?<![\w])_(?![\s_])(.+?)(?<![\s_])_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)|(\[Image #\d+\])/
    .source + `|(${BARE_URL.source})`,
  'g'
)

/** Terminal color and cursor codes, and the other escape sequences a tool or process prints. */
export const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

/** One color code, `ESC[` then numbers and `m`: the only escape sequence drawn, as a style. */
const SGR_TOKEN = /(\u001b\[[0-9;]*m)/

/** Text a tool or process printed, safe to draw: escape sequences gone, other control characters but tab and newline dropped. */
export const printable = (text: string) =>
  text.replace(ANSI, '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')

/** `printable`, keeping the color codes, so the terminal draws them as styles. */
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
export const cellsOf = (grapheme: string) => {
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

/** Printable ASCII, a cell to each character, which needs no splitting into graphemes. */
const ASCII = /^[\x20-\x7e]*$/

/** Terminal cells a string takes on screen: what a column must hold, which a code point count does not give for wide glyphs. */
export const cellWidth = (text: string) =>
  ASCII.test(text) ? text.length : graphemes(text).reduce((sum, grapheme) => sum + cellsOf(grapheme), 0)

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
    const [, , code, bold, boldU, strike, italic, italicU, link, url, image, bare] = match
    if (bare !== undefined) {
      out.push({ text: bare, style: 'link', href: bare })
    } else if (code !== undefined) {
      out.push({ text: code.trim(), style: 'code' })
    } else if (boldU !== undefined && /^\w+$/.test(boldU)) {
      // One name between double underscores is Python's `__init__` or `__name__`, not bold, though
      // CommonMark would make it bold and eat its underscores. Bold of one word takes asterisks.
      out.push({ text: match[0], style: 'plain' })
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
      const target = url !== undefined && isWebLink(url) ? url : undefined
      for (const run of spans(inner)) {
        const kept = run.style === 'code' || run.style === 'link' || run.style === 'url' || run.style === 'image' ? run.style : style
        // Everything in a link's text goes where the link does, even an address written there.
        const href = style === 'link' ? target : run.href
        out.push(href === undefined ? { text: run.text, style: kept } : { text: run.text, style: kept, href })
      }
      if (style === 'link' && url !== undefined && url !== link) {
        out.push(target === undefined ? { text: ` (${url})`, style: 'url' } : { text: ` (${url})`, style: 'url', href: target })
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
    // Blank lines at the ends go, but not the first line's indent, which may say it goes on with a list item.
    const joined = prose.join('\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd()
    if (joined !== '') {
      blocks.push({ kind: 'prose', text: joined })
    }
    prose = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    const inList = LIST_ITEM.test(prose.findLast(one => one.trim() !== '') ?? '')
    const fence = FENCE.exec(line) ?? (inList ? LIST_FENCE.exec(line) : null)
    if (fence !== null) {
      const marker = fence[2]!
      const indent = fence[1]!.length
      const body: string[] = []
      i++
      while (i < lines.length && !closesFence(lines[i]!, marker)) {
        body.push(lines[i]!)
        i++
      }
      flush()
      blocks.push({
        kind: 'code',
        language: fence[3]!.toLowerCase(),
        source: dedent(body, indent).join('\n'),
        isOpen: i >= lines.length,
        ...(indent > 0 && inList ? { indent } : {}),
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

    // A run of blank lines is one paragraph break, as in Markdown, however many were typed.
    if (line.trim() === '' && (prose.at(-1) ?? '').trim() === '') {
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

  /** Whether text in `run`'s style goes on with the row's last run rather than starting one. */
  const continues = ({ style, href }: Span) => {
    const last = rows[rows.length - 1]!.at(-1)

    return last !== undefined && last.style === style && last.href === href
  }

  const add = (text: string, run: Span) => {
    if (text === '') {
      return
    }
    const { style, href } = run
    used += cellWidth(text)
    if (continues(run)) {
      rows[rows.length - 1]!.at(-1)!.text += text
    } else {
      rows[rows.length - 1]!.push(href === undefined ? { text, style } : { text, style, href })
    }
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
            add(takeCells(token, indent)[0], run)
          }
        } else if (used > 0 && used + cellWidth(token) <= limit) {
          add(token, run)
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
      while (rest !== '' && cellWidth(rest) > limit) {
        const [head, tail] = takeCells(rest, limit)
        add(head, run)
        rest = tail
        if (rest !== '') {
          breakRow()
        }
      }
      add(rest, run)
    }
  }

  return rows.map(row => row.filter(run => run.text !== ''))
}

/** Text with newlines wrapped line by line; inline markdown read as styles unless `isPlain`. */
export const wrapText = (text: string, room: number, isPlain = false): Span[][] =>
  text.split('\n').flatMap(line => wrapSpans(isPlain ? [{ text: line, style: 'plain' }] : spans(line), room))

/** Cells a row of runs takes. */
export const rowWidth = (row: Span[]) => row.reduce((sum, run) => sum + cellWidth(run.text), 0)
