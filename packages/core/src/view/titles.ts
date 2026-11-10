/*
 * Titles: what a titles run said (Claude's names for the requests, the session and its
 * storylines), and Murmur's own fallback before Claude has named a request.
 */
import type { MurmurEvent } from "../events.js";
import { TITLES_TOOL, TitlesInput } from "../narration.js";
import { cutWords, firstSentence } from "./moments.js";

/** A titles run's answer, queued by the plugin: see `TITLES_TOOL`. */
export const isTitles = (e: MurmurEvent): boolean =>
  e.hook === "PostToolUse" && e.payload.tool_name === TITLES_TOOL;

export type TitleEntry = TitlesInput["requests"][number];

/**
 * Each request's key, from its prompt events in time order: what a titles run names it by.
 * The live hook and the transcript give a prompt different event ids but the same
 * `prompt_id`; a prompt typed while Claude works shares its turn's, so the nth request
 * of one `prompt_id` is "<prompt_id>#n" from the second on. No `prompt_id`: the event id.
 */
export function requestKeys(starts: MurmurEvent[]): string[] {
  const seen = new Map<string, number>();
  return starts.map((e) => {
    const p = e.payload.prompt_id;
    if (typeof p !== "string" || !p) return e.id;
    const n = seen.get(p) ?? 0;
    seen.set(p, n + 1);
    return n ? `${p}#${n}` : p;
  });
}

/**
 * Every titles run of a session merged, in time order: a later run wins for what it
 * names. Requests by key (`requestKeys`).
 */
export interface Titles {
  session?: string;
  threads: Map<string, string>;
  requests: Map<string, TitleEntry>;
}

export function titlesOf(events: MurmurEvent[]): Titles {
  const out: Titles = { threads: new Map(), requests: new Map() };
  for (const e of events) {
    const run = TitlesInput.safeParse(e.payload.tool_input);
    if (!run.success) continue;
    out.session = run.data.session.title;
    for (const t of run.data.threads) out.threads.set(t.id, t.title);
    for (const r of run.data.requests) out.requests.set(r.id, r);
  }
  return out;
}

// Claude Code's placeholders for what the person pasted or attached.
const PASTED =
  /<pasted_content\b[^>]*>[\s\S]*?(?:<\/pasted_content[^>]*>|$)|\[Pasted text #\d+[^\]]*\]/g;
const IMAGE = /\[Image #\d+\]/g;

/** The prompt with pasted text and images as "(pasted text)" and "(image)". */
export const markPasted = (prompt: string): string =>
  prompt.replace(PASTED, " (pasted text) ").replace(IMAGE, " (image) ");

/** The prompt's own words: no pasted text or images, spaces collapsed. */
export const ownWords = (prompt: string): string =>
  prompt
    .replace(PASTED, " ")
    .replace(IMAGE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-*•]\s+/, "");

const REPLY_WORD =
  /^(?:yes|yeah|yep|yup|ok|okay|k|sure|go ahead|go for it|do it|done|thanks|thank you|thx|waiting|still waiting|great|perfect|cool|nice|alright|all right|fine|sounds good|lgtm|please do)\b/i;

/**
 * A prompt that answers Claude rather than asks for work: at most 4 words of its own, or
 * starting with a yes, ok, sure, go ahead, done, thanks or waiting kind of word, or only
 * pasted text or an image.
 */
export function isReply(prompt: string): boolean {
  const own = ownWords(prompt);
  return own.split(" ").filter(Boolean).length <= 4 || REPLY_WORD.test(own);
}

// "Yes, ..." and its kin say nothing of the work.
const LEAD =
  /^(?:yes|yeah|ok|okay|sure|right|done|got it|understood)\s*[,:;.!-]\s*/i;
/** A sentence's first clause: up to its first comma, colon, semicolon or " - ". */
const firstClause = (s: string) =>
  (s.split(/[,:;]\s|\s[-\u2013\u2014]\s/)[0] ?? "")
    .replace(/[.!?]+$/, "")
    .trim();
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Words that open a clause without saying anything of the work ("Ok", "Meanwhile",
// "Can you", "Let's"), taken off the front of a title, and "please" off its end.
const OPENER =
  /^(?:(?:yes|yeah|yep|yup|ok|okay|k|sure|right|no|nope|so|well|hey|hi|bro|man|meanwhile|finally|also|and|but|alright|all right|got it|understood|thanks|thank you|thx|great|perfect|cool|nice|done|waiting|still waiting|go ahead|go for it|do it|please do|sounds good|lgtm)(?:[\s,.!:;]+|$)|(?:(?:can|could|would|will) (?:you|we)|let's|let us|please)\s+)/i;
const PLEASE = /[\s,]+please[.!?]*$/i;
const strip = (clause: string) => {
  let s = clause.replace(/\u2019/g, "'").trim();
  for (let t = ""; t !== s; ) {
    t = s;
    s = s.replace(OPENER, "");
  }
  return s.replace(PLEASE, "").trim();
};
// "Here's the page ..." names a thing: the thing is the title.
const HERE = /^here(?:'s| is| are)\s+(?:(?:a|an|the)\s+)?/i;
// "I renamed the tab" says what was done: "Renamed the tab".
const I_DID =
  /^i\s+(?=(?:(?!(?:need|feed|proceed|succeed|exceed)\b)\w+ed|made|wrote|rewrote|found|built|rebuilt|ran|sent|put|set|got|took|left|kept|did|gave|cut|split|began|chose|drew|broke|undid|redid)\s)/i;
// A clause that starts like this is talk between Claude and the person, not a title.
const TALK =
  /^(?:i|me|my|you|your|it|its|this|that|there|nothing|everything|something|here|we're|we'll|we've|we'd)\b/i;
// Claude speaking of itself or to the person anywhere in the clause: talk too.
const TALK_INSIDE = /\b(?:i|me|my|you|your)\b/i;

/**
 * A clause as a title, or undefined when it says nothing of the work: what is left
 * without its openers ("Ok", "Can you", "Let's") and a "Here's" or "I" before what was
 * done, when that is two words or more and does not start as talk ("I'll", "Your",
 * "Nothing", "It's"). `claude`: the clause is Claude's, so any "I", "my" or "you" in it
 * is talk too.
 */
export function titleClause(
  clause: string,
  claude = false,
): string | undefined {
  const s = strip(clause).replace(HERE, "").replace(I_DID, "");
  if (TALK.test(s) || (claude && TALK_INSIDE.test(s))) return undefined;
  return s.split(/\s+/).filter(Boolean).length >= 2 ? s : undefined;
}

/** The text is only openers: "Yes", "Ok, go ahead", "Waiting". */
export const talkOnly = (s: string): boolean =>
  s.trim() !== "" && strip(s).replace(/[.!?]+$/, "") === "";

/**
 * The goal Murmur gives a request no map or titles run described: for a reply, the first
 * clause of how it ended when that reads as a title (`titleClause`), else the prompt's
 * own words.
 */
export function fallbackGoal(prompt: string, outcome?: string): string {
  if (outcome && isReply(prompt)) {
    const clause = firstClause(firstSentence(outcome).replace(LEAD, ""));
    const title = titleClause(clause, true);
    if (title) return cutWords(capital(title), 120);
  }
  return cutWords(ownWords(prompt) || placeholder(prompt), 80);
}

/** What a prompt of only pasted text or images was: "(image)", "(pasted text)". */
const placeholder = (prompt: string) =>
  markPasted(prompt).replace(/\s+/g, " ").trim();

/** Murmur's name for a session: the first prompt that is not a reply, else the first. */
export function fallbackTitle(prompts: string[]): string {
  const p = prompts.find((x) => !isReply(x)) ?? prompts[0] ?? "";
  return cutWords(ownWords(p) || placeholder(p), 48);
}
