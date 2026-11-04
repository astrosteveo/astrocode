// Claude Code's test for a secret in text: an API key, a token or a credential in a header. Claude
// Code keeps a message with one out of its prompt history. The patterns are claude 2.1.318's own,
// kept as its bundle builds them, so the two agree on what's a secret.

/** A run of `chars` with a digit within its first 64. */
const digitWithin = (chars: string) => `(?=${chars}{0,64}[0-9])`;

/** `count` letters or digits in a row, with a digit and a letter within the first 64. */
const mixedWithin = (count: number) =>
  `(?=[A-Za-z0-9_-]{0,64}?(?=[A-Za-z0-9]{${count}})(?=[A-Za-z0-9]{0,64}[0-9])(?=[A-Za-z0-9]{0,64}[A-Za-z]))`;

/** A token: `prefix`, then at least `length` of `chars`, either after a word boundary or with `ahead` true of what follows. */
function token(prefix: string, chars: string, length: number, ahead: string, suffix = "", afterPrefix = "", flags = "g") {
  const body = `${chars}{${length},}${suffix}`;
  return new RegExp(`(?:\\b${prefix}${afterPrefix}${body}|${prefix}${ahead}${body})`, flags);
}

const slackHook = /hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/_-]+/gi;
const headers = [
  /\bBearer\s{1,512}(?=[A-Za-z0-9._~+/=-](?:[A-Za-z0-9._~+/=-]|%(?!20)[0-9A-Fa-f]{2}){15})(?:eyJ|(?=(?:[A-Za-z0-9._~+/=-]|%(?!20)[0-9A-Fa-f]{2}){0,64}[0-9=]))/i,
  /:\s{0,512}Basic\s{1,512}(?=[A-Za-z0-9+/=]{16})(?=[A-Za-z0-9+/=]{0,64}[0-9=])/i,
  /\bsk-(?=[A-Za-z0-9_-]{20})(?=[A-Za-z0-9_-]{0,64}[0-9])/,
];
const anthropicAndOpenAi = [token("sk-ant-", "[A-Za-z0-9_-]", 8, mixedWithin(8)), token("sk-(?:proj|svcacct|admin)-", "[A-Za-z0-9_-]", 20, mixedWithin(20))];
const aws = [new RegExp(`(^|[^A-Za-z0-9+])(?:${["AKIA", "ASIA", "ABIA", "ACCA", "A3T[A-Z0-9]"].join("|")})[A-Z0-9]{16}(?![A-Za-z0-9+=])`, "g")];
const services = [
  token("gh[opusr]_", "[A-Za-z0-9]", 20, digitWithin("[A-Za-z0-9]")),
  /github_pat_[A-Za-z0-9_]{82,}/g,
  /sq0(?:atp|csp)-[A-Za-z0-9_-]{22,}/g,
  /(^|[^A-Za-z0-9+/])EAAA[A-Za-z0-9+/=%_-]{56,}/g,
  token("gl(?:pat|dt|rt|ft|soat|oas|agent|ptt|cbt|imt|ffct)-", "[A-Za-z0-9_=-]", 20, digitWithin("[A-Za-z0-9_=-]"), "(?:\\.[0-9a-z]{9})?"),
  token("(?:xox[abe-z](?:\\.xox[a-z])?|xapp|xwfp)-", "[A-Za-z0-9+/=%_-]", 10, "(?=[0-9])", "", digitWithin("[A-Za-z0-9+/=%_-]"), "gi"),
  new RegExp(`(?:\\bxox[cd]-[A-Za-z0-9+/=%_-]{10,}|xox[cd]-${digitWithin("[A-Za-z0-9+/=%_-]")}[A-Za-z0-9+/=%_-]{16,})`, "gi"),
  slackHook,
];
const google = [/(^|[^A-Za-z0-9+_-])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9+=_-])/g, /(^|[^A-Za-z0-9+_-])GOCSPX-[A-Za-z0-9_-]{28}(?![A-Za-z0-9+=_-])/g];
const stripe = [/(^|[^A-Za-z0-9+_-])[sr]k_(?:live|test|prod)_(?=[A-Za-z0-9]{0,64}[0-9])[A-Za-z0-9]{24,}(?![A-Za-z0-9+=_-])/g];
const jwt = /\beyJ(?:[A-Za-z0-9_-]{256}|[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{10})/;

// Without `g`, as claude makes them for testing: a `g` pattern's test() carries on from its last match.
const PATTERNS = [...headers, ...[...anthropicAndOpenAi, ...aws, ...services, ...google, ...stripe].map((one) => new RegExp(one.source, one.flags.replaceAll("g", ""))), jwt];

/** Long text is tested in overlapping pieces, as claude tests it, so no pattern runs over too much at once. */
const PIECE = 65536;
const OVERLAP = 2 * 4096;

/** Whether `text` has an API key, a token or a credential in a header in it, by claude's patterns. */
export function hasSecret(text: string) {
  const test = (piece: string) => PATTERNS.some((pattern) => pattern.test(piece));
  if (text.length <= PIECE) return test(text);
  for (let at = 0; at < text.length; at += PIECE - OVERLAP) if (test(text.slice(at, at + PIECE))) return true;
  return false;
}
