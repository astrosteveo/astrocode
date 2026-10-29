// Claude describes each command it runs in the imperative, as the Bash tool asks ("Run the test
// suite"). An activity line says what Claude did, so it says the description in the past tense
// ("Ran the test suite"): the first word, and the verbs joined to it by "and", "then" or a comma
// ("Merged the PR, deleted the branch and updated main"). Only verbs listed here change, so a
// description that doesn't start with one is left as it is.

/** Verbs whose past tense isn't the verb and -ed. */
const IRREGULAR: Record<string, string> = {
  be: "was", become: "became", begin: "began", bind: "bound", break: "broke", bring: "brought", build: "built", buy: "bought",
  cast: "cast", catch: "caught", checkout: "checked out", choose: "chose", cut: "cut", deal: "dealt", dig: "dug", do: "did",
  draw: "drew", drive: "drove", eat: "ate", fall: "fell", feed: "fed", feel: "felt", fight: "fought", find: "found", fit: "fitted",
  forget: "forgot", freeze: "froze", get: "got", give: "gave", go: "went", grow: "grew", hang: "hung", hear: "heard", hide: "hid",
  hit: "hit", hold: "held", keep: "kept", know: "knew", lay: "laid", lead: "led", leave: "left", lend: "lent", let: "let",
  light: "lit", lose: "lost", make: "made", mean: "meant", meet: "met", overwrite: "overwrote", override: "overrode", pay: "paid",
  put: "put", quit: "quit", read: "read", rebuild: "rebuilt", redo: "redid", rerun: "reran", reread: "reread", reset: "reset",
  rethink: "rethought", rewind: "rewound", rewrite: "rewrote", ride: "rode", ring: "rang", rise: "rose", run: "ran", say: "said",
  see: "saw", seek: "sought", sell: "sold", send: "sent", set: "set", setup: "set up", shake: "shook", shed: "shed", shoot: "shot",
  show: "showed", shrink: "shrank", shut: "shut", sing: "sang", sink: "sank", sit: "sat", sleep: "slept", slide: "slid",
  speak: "spoke", spend: "spent", spin: "spun", split: "split", spread: "spread", stand: "stood", steal: "stole", stick: "stuck",
  strike: "struck", sweep: "swept", swing: "swung", take: "took", teach: "taught", tear: "tore", tell: "told", think: "thought",
  throw: "threw", undo: "undid", understand: "understood", upset: "upset", wake: "woke", wear: "wore", win: "won", wind: "wound",
  withdraw: "withdrew", write: "wrote",
};

/** Verbs that double their last letter before -ed, besides the short ones the rule finds (stop, log, scan). */
const DOUBLED = new Set(
  "admit commit compel control debug defer deter emit equip expel format incur infer kidnap occur omit patrol permit prefer program propel rebel recur refer regret screenshot snapshot submit transfer transmit unplug unwrap unzip worship".split(" "),
);

/** The verbs, besides the irregular ones, that start a command's description: `Check`, `Commit`, `Install`. */
const REGULAR = new Set(
  `accept adapt add adjust aim align amend analyse analyze animate annotate answer append apply approve archive arrange ask assemble
  assert attach attempt audit autosave back backfill bake balance ban benchmark bisect blame block boot bootstrap bound box brighten
  browse bump bundle calculate call cancel capture center centre change check chop clamp clean clear click clip clone close collapse
  collect color colour combine compare compile complete compose compress compute concatenate configure confirm connect contact
  convert copy correct count crawl create crop cycle debounce declare decode decompress decrypt define delete deploy describe
  deserialize destroy detach detect diff dim disable disconnect dismiss display document double downgrade download draft drag drop
  dump duplicate echo edit emit empty enable encode encrypt end enlarge ensure enter erase estimate evaluate examine exclude execute
  exercise exit expand expect explain explore export expose extend extract factor fade fail fake fetch file fill film filter finish
  fire fix flag flatten flip flush focus fold follow force fork format forward frame free gate gather generate glance grab grade grep
  group guard hand handle hash hide highlight hoist hook hover identify ignore implement import improve include indent index
  initialise initialize inline insert inspect install interpolate interrupt invoke isolate join judge jump kill label land latch
  launch learn level lift limit link lint list load locate lock log look loop lower map mark mask match measure merge migrate minify
  mirror mock modify monitor montage mount move mute name narrow navigate normalise normalize note nudge observe open opt order
  outline pack pad paint pair parse pass paste patch pause peek pick pin ping place play plot plug point polish poll pose post
  preload prepare prepend press preview prime print probe process produce profile prompt prune publish pull purge push query queue
  raise rank reapply rebase recall recheck recompare reconnect record reduce refactor reference reflow refresh refuse regenerate
  register reinstall reload remeasure remember remesh remove rename render reopen reorder repeat replace replay reply report
  reproduce request require reseed reshape resize resolve respond restart restore restyle resume retest retitle retrace retry return
  revalidate revert review reword rework roll rotate save scaffold scale scan schedule scope score scrape scratch scroll search seed select
  separate serialize serve share shift ship shorten sign simplify simulate size skim skin skip slice smooth snap sort splice spot
  squash stack stage start stash step stop straighten stream strengthen strip stub style submit substitute summarise summarize survey
  swap switch sync synthesise synthesize tag tail tally tap terminate test thicken tidy tie tighten tile time tint toggle touch trace
  track train transform translate trigger trim trust try tune turn type typecheck uncomment uninstall unlink unlock unmount unpack
  unstage untrack update upgrade upload use validate vendor verify view visit wait walk warn warp watch weigh widen wire work wrap
  zip zoom`.split(/\s+/),
);

/** What comes before a hyphen in a verb: `re-run`, `type-check`, `dry-run`, `squash-merge`. */
const HYPHENED = new Set(
  "auto bulk cherry co cross double dry fast force hard live onion parse pipe pre ray re rebase regression shallow smoke soft spot squash tap type".split(" "),
);

/**
 * Verbs a list of things often follows: `Read the logs and test results`. After one, a verb joined
 * to it changes only where what comes next says it's a verb (`and find where it lives`).
 */
const LISTING = new Set(
  "check compare count examine explore find inspect list locate look measure peek print probe re-check re-read read recheck reread report review search see show skim survey trace view".split(" "),
);

/** Verbs that, joined to another, are as often nouns: `and test runs`, `and build tests`, `position, size and travel`. */
const NOUNISH = new Set("build light log map register review size test type".split(" "));

/** What follows a verb rather than a noun: articles, pronouns, question words and prepositions. */
const OBJECT =
  /^(?:the|a|an|this|that|these|those|it|its|them|their|his|her|my|our|your|every|each|all|any|both|no|some|how|what|which|where|why|whether|if|when|who|up|down|out|in|on|off|back|over|through|to|for|from|with|into|at|by|again|everything|anything)\b/i;

/** The past tense of a verb in lower case, or null when it isn't one listed here. */
function past(verb: string): string | null {
  if (IRREGULAR[verb]) return IRREGULAR[verb]!;
  // `type-check`, `re-run`, `fast-forward`: the last part changes, after a part that makes a verb
  // of it, unlike `real-time` or `fixed-point`.
  const hyphen = verb.lastIndexOf("-");
  if (hyphen > 0) {
    const last = HYPHENED.has(verb.slice(0, hyphen)) ? past(verb.slice(hyphen + 1)) : null;
    return last && !last.includes(" ") ? `${verb.slice(0, hyphen + 1)}${last}` : null;
  }
  if (!REGULAR.has(verb) && !DOUBLED.has(verb)) {
    // `reshoot`, `unwrap`: again or undone, of a verb listed here.
    const prefix = /^(re|un)(?=[a-z]{3})/.exec(verb)?.[0];
    const rest = prefix ? past(verb.slice(prefix.length)) : null;
    return rest && !rest.includes(" ") ? `${prefix}${rest}` : null;
  }
  // A short verb ending in a vowel and a consonant doubles it: stop, log, scan, but not show or fix.
  if (DOUBLED.has(verb) || /^[^aeiou]*[aeiou][bdgklmnprstvz]$/.test(verb)) return `${verb}${verb.at(-1)}ed`;
  if (verb.endsWith("e")) return `${verb}d`;
  if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ied`;
  return `${verb}ed`;
}

/** `word` in the past tense, keeping its first letter's case, or null when it isn't a verb listed here. */
function pastOf(word: string) {
  const lower = word.toLowerCase();
  // Words in capitals, such as `README`, aren't verbs.
  if (word !== lower && word.slice(1) !== lower.slice(1)) return null;
  const done = past(lower);
  if (!done) return null;
  return word[0] === lower[0] ? done : done[0]!.toUpperCase() + done.slice(1);
}

/** A verb joined to the one before: after `and`, `then`, `&`, a comma or a semicolon. */
const JOINED = /((?:[,;]|\band\b|\bthen\b|&)\s+(?:and\s+|then\s+)?)([a-z][a-z-]*)/g;

/**
 * A command's description in the past tense, or null when it doesn't start with a verb listed
 * here. What follows a colon or a bracket, which says more about what came before, stays as it is.
 */
export function inPastTense(description: string) {
  const text = description.split("\n")[0]!.trim().replace(/\.$/, "");
  const first = /^([A-Za-z][A-Za-z-]*)(.*)$/.exec(text);
  const verb = first ? pastOf(first[1]!) : null;
  if (!first || !verb) return null;
  const rest = first[2]!;
  const cut = rest.search(/[:([—]/);
  const joined = cut === -1 ? rest : rest.slice(0, cut);
  const after = cut === -1 ? "" : rest.slice(cut);
  const listing = LISTING.has(first[1]!.toLowerCase());
  return (
    verb +
    joined.replace(JOINED, (all: string, before: string, word: string, at: number) => {
      const next = joined.slice(at + all.length);
      // `remove's report` is a noun's.
      if (/^['’]/.test(next)) return all;
      const ends = next.trim() === "" || /^\s*[,;]/.test(next);
      const verbal = ends || OBJECT.test(next.trimStart());
      if (NOUNISH.has(word) && !verbal) return all;
      if (listing && !verbal && !/^\s+(?:and|then|or)\b/.test(next)) return all;
      const done = pastOf(word);
      return done ? before + done : all;
    }) +
    after
  );
}
