/*
 * A small, safe Markdown renderer for Claude's messages, helper briefs and reports.
 * It builds React elements only (never HTML strings), so nothing in the text can run.
 * Blocks: headings, paragraphs (a single line break stays a break), fenced code, lists
 * (nested by indent), quotes, tables, rules. Inline: code, bold, italic, links (http,
 * https and mailto only, opening in a new tab) and bare web addresses.
 */
import {
  Component,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** Quotes and lists nest at most this deep; anything deeper reads as a plain paragraph. */
const MAX_DEPTH = 20;
const CLAMP = " ".repeat(MAX_DEPTH * 8);
const DEEP = new RegExp(`^[ \\t]{${MAX_DEPTH * 8},}`);

type Block =
  | { t: "h"; level: number; text: string }
  | { t: "p"; text: string }
  | { t: "plain"; text: string }
  | { t: "code"; text: string }
  | { t: "quote"; blocks: Block[] }
  | { t: "list"; ordered: boolean; start: number; items: Item[] }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "hr" };
interface Item {
  text: string;
  blocks: Block[];
}

const FENCE = /^\s*(`{3,}|~{3,})/;
/** A closing fence: the same character, at least as long, and no info string. */
const closes = (line: string, open: string) => {
  const m = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
  return !!m && m[1]?.[0] === open[0] && (m[1] as string).length >= open.length;
};
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const LIST = /^(\s*)([-*+]|(\d{1,9})[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

const indent = (l: string) => /^\s*/.exec(l)?.[0].length ?? 0;
const blank = (l: string | undefined) => !l?.trim();
const isTable = (lines: string[], i: number) =>
  !!lines[i]?.includes("|") && TABLE_SEP.test(lines[i + 1] ?? "");
const startsBlock = (lines: string[], i: number) => {
  const l = lines[i] ?? "";
  return (
    FENCE.test(l) ||
    HEADING.test(l) ||
    RULE.test(l) ||
    QUOTE.test(l) ||
    LIST.test(l) ||
    isTable(lines, i)
  );
};
const cells = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

function dedent(lines: string[]): string[] {
  const n = Math.min(...lines.filter((l) => l.trim()).map(indent));
  return lines.map((l) => l.slice(Number.isFinite(n) ? n : 0));
}

function parse(src: string, depth = 0): Block[] {
  if (depth >= MAX_DEPTH) {
    // Past the cap, the rest is one plain paragraph: no more parsing, no more nesting.
    const text = src.replace(/\s+/g, " ").trim();
    return text ? [{ t: "plain", text }] : [];
  }
  let lines = src.replace(/\r\n?/g, "\n").split("\n");
  // Indent past what MAX_DEPTH levels can use (8 per level) only feeds the plain tail,
  // so clamp it once instead of re-slicing it at every level.
  if (depth === 0) lines = lines.map((l) => l.replace(DEEP, CLAMP));
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i] as string;
    if (blank(l)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(l);
    if (fence) {
      const body: string[] = [];
      const pad = indent(l);
      i++;
      while (
        i < lines.length &&
        !closes(lines[i] as string, fence[1] as string)
      )
        body.push((lines[i++] as string).slice(pad));
      i++;
      out.push({ t: "code", text: body.join("\n") });
      continue;
    }
    const h = HEADING.exec(l);
    if (h) {
      out.push({
        t: "h",
        level: (h[1] as string).length,
        text: h[2] as string,
      });
      i++;
      continue;
    }
    if (RULE.test(l)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }
    if (QUOTE.test(l)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] as string))
        body.push((lines[i++] as string).replace(QUOTE, ""));
      out.push({ t: "quote", blocks: parse(body.join("\n"), depth + 1) });
      continue;
    }
    if (isTable(lines, i)) {
      const head = cells(l);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] as string).includes("|"))
        rows.push(cells(lines[i++] as string));
      out.push({ t: "table", head, rows });
      continue;
    }
    const li = LIST.exec(l);
    if (li) {
      const base = indent(l);
      // A list of the other kind (ordered or not) starts a new list.
      const same = (m: RegExpExecArray | null) => !!m && !!m[3] === !!li[3];
      const items: { text: string; rest: string[] }[] = [];
      while (i < lines.length) {
        const cur = lines[i] as string;
        const m = LIST.exec(cur);
        if (m && indent(cur) <= base + 1) {
          if (!same(m)) break;
          items.push({ text: m[4] as string, rest: [] });
          i++;
        } else if (blank(cur)) {
          const next = lines.slice(i + 1).find((x) => x.trim());
          const nm = next === undefined ? null : LIST.exec(next);
          if (next === undefined) break;
          if (indent(next) <= base + 1 && !same(nm)) break;
          items.at(-1)?.rest.push("");
          i++;
        } else if (indent(cur) > base) {
          items.at(-1)?.rest.push(cur);
          i++;
        } else if (!startsBlock(lines, i)) {
          const last = items.at(-1);
          if (last) last.text += ` ${cur.trim()}`;
          i++;
        } else break;
      }
      out.push({
        t: "list",
        ordered: !!li[3],
        start: Number(li[3] ?? 1),
        items: items.map((it) => {
          // A wrapped line indented under its item continues the item's text.
          const rest = dedent(it.rest);
          const lead: string[] = [];
          while (
            rest.length &&
            !blank(rest[0]) &&
            !LIST.test(rest[0] as string)
          )
            lead.push((rest.shift() as string).trim());
          return {
            text: [it.text, ...lead].join(" "),
            blocks: parse(rest.join("\n"), depth + 1),
          };
        }),
      });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      !blank(lines[i]) &&
      (para.length === 0 || !startsBlock(lines, i))
    )
      para.push((lines[i++] as string).trim());
    out.push({ t: "p", text: para.join("\n") });
  }
  return out;
}

const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\[((?:[^[\]\n]|\[[^[\]\n]*\])+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)|\*\*(?=\S)([\s\S]+?)\*\*|__(?=\S)([\s\S]+?)__|\*(?=[^\s*])([^*\n]+?)\*|(?<![\w])_(?=[^\s_])([^_\n]+?)_(?![\w])|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"*_`])/g;
const SAFE = /^(https?:|mailto:)/i;

function link(href: string, children: ReactNode, key: number) {
  return SAFE.test(href) ? (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span key={key}>{children}</span>
  );
}

/** Inline Markdown as React nodes; a single line break becomes a <br>. */
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const plain = (s: string) =>
    s.split("\n").forEach((part, i) => {
      if (i) out.push(<br key={out.length} />);
      if (part) out.push(part);
    });
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    plain(text.slice(last, m.index));
    last = m.index + m[0].length;
    const k = out.length;
    // A short code token never breaks across lines (at its hyphens, say).
    if (m[2] !== undefined)
      out.push(
        <code key={k} className={m[2].length <= 32 ? "nw" : undefined}>
          {m[2]}
        </code>,
      );
    else if (m[3] !== undefined)
      out.push(link(m[4] as string, inline(m[3]), k));
    else if (m[5] !== undefined || m[6] !== undefined)
      out.push(<strong key={k}>{inline((m[5] ?? m[6]) as string)}</strong>);
    else if (m[7] !== undefined || m[8] !== undefined)
      out.push(<em key={k}>{inline((m[7] ?? m[8]) as string)}</em>);
    else if (m[9] !== undefined) out.push(link(m[9], m[9], k));
  }
  plain(text.slice(last));
  return out;
}

/** The text with its Markdown marks dropped, for one-line summaries. */
export function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\W)[*_]([^*_\n]+)[*_](?=\W|$)/g, "$1$2")
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function render(blocks: Block[]): ReactNode[] {
  const out: ReactNode[] = [];
  for (const b of blocks) {
    const k = out.length;
    switch (b.t) {
      case "h": {
        const H = `h${Math.min(6, b.level + 2)}` as "h3";
        out.push(
          <H key={k} className={`md-h${Math.min(b.level, 4)}`}>
            {inline(b.text)}
          </H>,
        );
        break;
      }
      case "p":
        out.push(<p key={k}>{inline(b.text)}</p>);
        break;
      case "plain":
        out.push(<p key={k}>{b.text}</p>);
        break;
      case "code":
        out.push(
          <pre key={k} className="md-code">
            <code>{b.text}</code>
          </pre>,
        );
        break;
      case "quote":
        out.push(<blockquote key={k}>{render(b.blocks)}</blockquote>);
        break;
      case "hr":
        out.push(<hr key={k} />);
        break;
      case "table":
        out.push(
          <div key={k} className="md-table">
            <table>
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed columns
                    <th key={j}>{inline(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed rows
                  <tr key={j}>
                    {r.map((c, x) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: fixed columns
                      <td key={x}>{inline(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        break;
      case "list": {
        const items = b.items.map((it, j) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed items
          <li key={j}>
            {inline(it.text)}
            {render(it.blocks)}
          </li>
        ));
        out.push(
          b.ordered ? (
            <ol key={k} start={b.start === 1 ? undefined : b.start}>
              {items}
            </ol>
          ) : (
            <ul key={k}>{items}</ul>
          ),
        );
        break;
      }
    }
  }
  return out;
}

/** If rendering a text ever fails, show it as plain text instead of blanking the page. */
export class MdBoundary extends Component<
  { text: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className="md-plain">{this.props.text}</p>
    ) : (
      this.props.children
    );
  }
}

function Blocks({ text }: { text: string }) {
  return <>{render(parse(text))}</>;
}

export function Markdown(props: { text: string; className?: string }) {
  return (
    <div className={props.className ? `md ${props.className}` : "md"}>
      <MdBoundary text={props.text}>
        <Blocks text={props.text} />
      </MdBoundary>
    </div>
  );
}

/** Long enough to fold, judged from the text where layout is unknown (tests, first paint). */
const looksLong = (text: string, lines: number) =>
  text.split("\n").filter((l) => l.trim()).length > lines ||
  text.length > lines * 90;

/** Markdown that folds after `lines` lines with "Show more"; a text that fits never folds. */
export function Fold(props: {
  text: string;
  lines?: number;
  className?: string;
  /** Shown on the line under the text, beside "Show more". */
  aside?: ReactNode;
}) {
  const { text, lines = 4, className, aside } = props;
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(() => looksLong(text, lines));
  const body = useRef<HTMLDivElement>(null);
  // In a real layout, measure: fold only what really runs past the fold.
  // ponytail: measured once per open/close, not on resize; add a ResizeObserver if widths change live
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || open || !el.clientHeight) return; // no layout (tests): keep the guess
    el.classList.add("folded");
    const over = el.scrollHeight > el.clientHeight + 2;
    el.classList.toggle("folded", over);
    setLong(over);
  }, [open]);
  const folded = long && !open;
  // A link or button inside the fold that takes focus opens it, so focus is never hidden.
  useEffect(() => {
    const el = body.current;
    if (!el || !folded) return;
    const unfold = () => setOpen(true);
    el.addEventListener("focusin", unfold);
    return () => el.removeEventListener("focusin", unfold);
  }, [folded]);
  return (
    <div className={className}>
      <div
        ref={body}
        className={folded ? "fold-body folded" : "fold-body"}
        style={{ "--fold-lines": lines } as CSSProperties}
      >
        <Markdown text={text} />
      </div>
      {(long || aside) && (
        <div className="fold-foot">
          {aside}
          {long && (
            <button
              type="button"
              className="link more"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
