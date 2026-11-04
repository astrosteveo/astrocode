// How wide the transcript is drawn. Its text starts two columns in, after the gutter's mark, and
// stops two columns short of the terminal's right edge, where full screen's scrollbar goes, and at
// the measure however wide the terminal is. What's under it, the box, the status bar and a
// decision, takes the whole width.

/** Text never runs wider than this, however wide the terminal: past it, lines get hard to read. */
export const MEASURE = 110;
/** Under this many columns a result that doesn't fit beside its target goes under its line. */
export const NARROW = 100;

/** The transcript's width on a terminal `columns` wide: the column its results end at. */
export function edgeOf(columns: number) {
  return Math.min(columns - 2, MEASURE + 2);
}

/** Whether a transcript `edgeOf()` drew this wide is on a terminal under `NARROW` columns. */
export function isNarrow(edge: number) {
  return edge < edgeOf(NARROW);
}
