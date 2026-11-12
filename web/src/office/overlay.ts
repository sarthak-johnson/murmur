// Text and click targets over the canvas, in plain DOM so text stays crisp at any scale.
import {
  BOARD,
  CLAUDE_DESK,
  CONSOLE,
  DOOR,
  JOB_BOARD,
  jobCards,
  RACKS,
  ROOMS,
  SHELVES,
  T,
} from "./map";
import { boardLayout, type ClaudePos, deskTile } from "./render";
import { cutWords, type Scene } from "./scene";
import { hash, helperLook, LINEAGE, phaseColor } from "./sprites";
import { clockOf, context2d, dur, esc, phaseShort } from "./util";

const MODEL: Record<string, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};
const modelWord = (m: string | undefined) =>
  MODEL[(m ?? "").toLowerCase().split(/[-\s]/)[0] ?? ""] ?? "";

// Bubbles pop in when the words change and fade after a while, unless you point at their speaker.
const SAY_MS = { helper: 6000, claude: 9000 };
const hashText = (t: string) => hash(t).toString(36);

const WORD: Record<string, string> = {
  done: "done",
  now: "running",
  blocked: "waiting on you",
  failed: "failed",
  todo: "not started",
};
// Pure cache: one measuring context, made on first use.
let mctx: CanvasRenderingContext2D | undefined;
const fits = (text: string, px: number, size: number) => {
  mctx ??= context2d(document.createElement("canvas"));
  mctx.font = `600 ${size}px Geist, system-ui, sans-serif`;
  return mctx.measureText(text).width <= px;
};

/** One thing laid over the canvas, in floor pixels. */
interface Item {
  key: string;
  cls: string;
  /** A button: hovering it points at `ring`, clicking it opens `open`. */
  button?: boolean;
  html?: string;
  label?: string;
  open?: string;
  ring?: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** Screen px. */
  maxW?: number;
  /** The speaker's colour, for a bubble's edge. */
  who?: string;
  /** Screen px from the bubble's centre to its speaker. */
  tail?: number;
  hidden?: boolean;
}

/** An element and what was last written to it, so unchanged items touch nothing. */
interface Placed {
  el: HTMLElement;
  cls?: string;
  html?: string;
  label?: string;
  open?: string | undefined;
  ring?: string | undefined;
}

/** Someone on the floor, for keeping labels clear of them. */
export interface Walker {
  id: string;
  x: number;
  y: number;
}

export interface Overlay {
  /** The scale the canvas is drawn at: crisp, so whole or (on a dense screen) a fraction. */
  setScale(v: number): void;
  render(
    scene: Scene,
    claude: ClaudePos | null,
    walkers: readonly Walker[],
    selected: string | null,
    hovered: string | null,
    t: string,
  ): void;
  /** Remove every element it made, with their listeners. */
  destroy(): void;
}

/**
 * root: the element over the canvas (its parent gets the scale classes).
 * onOpen: a target was clicked ("agent:<id>", "task:<id>", "phase:<id>", "claude", "archive", "door", "jobs", "terminal").
 * onHover: a target is pointed at (its ring key), or null when the pointer leaves.
 */
export function createOverlay(
  root: HTMLElement,
  onOpen: (key: string) => void,
  onHover: (key: string | null) => void,
): Overlay {
  const els = new Map<string, Placed>();
  const born = new Map<string, number>();
  let s = 4;
  // The element pointed at: if it goes (a helper finishes), the pointing ends with it.
  let pointed: Placed | null = null;

  function make(it: Item): Placed {
    const el = document.createElement(it.button ? "button" : "div");
    const p: Placed = { el };
    if (el instanceof HTMLButtonElement) {
      el.type = "button";
      const enter = () => {
        pointed = p;
        onHover(p.ring ?? null);
      };
      const leave = () => {
        if (pointed === p) pointed = null;
        onHover(null);
      };
      el.addEventListener("mouseenter", enter);
      el.addEventListener("mouseleave", leave);
      // The keyboard points too: a focused desk lights its cables as a hovered one does.
      el.addEventListener("focus", enter);
      el.addEventListener("blur", leave);
    }
    el.addEventListener("click", (e) => {
      if (!p.open) return;
      e.stopPropagation();
      onOpen(p.open);
    });
    root.append(el);
    return p;
  }

  function put(items: Item[]) {
    const seen = new Set<string>();
    for (const it of items) {
      seen.add(it.key);
      let p = els.get(it.key);
      if (!p) {
        p = make(it);
        els.set(it.key, p);
      }
      const el = p.el;
      if (p.cls !== it.cls) {
        p.cls = it.cls;
        el.className = it.cls;
      }
      if (it.html !== undefined && p.html !== it.html) {
        p.html = it.html;
        el.innerHTML = it.html;
      }
      if (it.label !== undefined && p.label !== it.label) {
        p.label = it.label;
        el.setAttribute("aria-label", it.label);
        el.title = it.label;
      }
      p.open = it.open;
      p.ring = it.ring;
      const st = el.style;
      st.left = `${it.x * s}px`;
      st.top = `${it.y * s}px`;
      if (it.w !== undefined) st.width = `${it.w * s}px`;
      if (it.h !== undefined) st.height = `${it.h * s}px`;
      if (it.maxW) st.maxWidth = `${it.maxW}px`;
      if (it.who) st.setProperty("--who", it.who);
      if (it.tail !== undefined) st.setProperty("--tail", `${it.tail}px`); // a shifted bubble still points at its speaker
      st.visibility = it.hidden ? "hidden" : "";
    }
    for (const [k, p] of els) {
      if (seen.has(k)) continue;
      if (pointed === p) {
        pointed = null;
        onHover(null);
      }
      p.el.remove();
      els.delete(k);
      born.delete(k);
    }
  }

  function items(
    scene: Scene,
    claude: ClaudePos | null,
    walkers: readonly Walker[],
    selected: string | null,
    hovered: string | null,
    t: string,
  ): Item[] {
    const out: Item[] = [];
    const now = performance.now();
    /** True once a bubble has been up longer than ms. */
    const said = (key: string, ms: number) => {
      let at = born.get(key);
      if (at === undefined) {
        at = now;
        born.set(key, at);
      }
      return now - at > ms;
    };
    const covered = (x0: number, y0: number, w: number, h: number) =>
      walkers.some(
        (a) =>
          a.x + 7 > x0 && a.x - 7 < x0 + w && a.y > y0 && a.y - 22 < y0 + h,
      );
    const room = (key: string, text: string, x: number, y: number) =>
      out.push({
        key,
        cls: "room-label",
        html: esc(text),
        x,
        y,
        hidden: covered(x, y, text.length * 6, 6),
      });
    room("rl-plan", ROOMS.plan.label, 2 * T + 4, 7 * T + 4);
    if (!scene.waiting)
      room("rl-corner", ROOMS.corner.label, 26 * T + 4, 7 * T + 4); // the question to you takes this floor
    // The bottom rooms show their back wall, so their names hang on it as signs, clear of the desks.
    room("rl-work", ROOMS.work.label, 2 * T + 4, 9 * T + 5);
    room("rl-review", ROOMS.review.label, 33 * T + 4, 9 * T + 5);
    out.push({
      key: "sl-jobs",
      cls: "spot-label",
      html: "Requests",
      x: JOB_BOARD.px.x,
      y: 0,
    });
    // The pinned sheet says what you asked on this floor's request.
    const cards = jobCards(scene.jobs, scene.request.id);
    const sheet = cards.find((c) => c.big);
    if (sheet) {
      out.push({
        key: "ask-sheet",
        cls: "sheet",
        x: sheet.x + 1,
        y: sheet.y + 4,
        w: sheet.w - 2,
        h: sheet.h - 5,
        // Your own words, cut to the sheet; the whole of them reads in its label.
        html: `<small>You asked</small><span>${esc(cutWords(scene.request.asked, 90))}</span>`,
        label: `Request ${scene.request.n}, you asked: ${scene.request.asked}`,
      });
    }
    // Each small card carries its request's number; the older stack says how many it holds.
    for (const c of cards) {
      if (c.big) continue;
      out.push({
        key: `card-${c.id}`,
        cls: "card-n",
        x: c.x,
        y: c.y + 4,
        w: c.w,
        h: c.h - 4,
        html: c.more ? `+${c.more}` : String(c.n),
      });
    }
    out.push({
      key: "sl-arch",
      cls: "spot-label",
      html: "Archive",
      x: SHELVES.px.x + 2,
      y: 0,
    });
    out.push({
      key: "you",
      cls: "you-plate",
      html: "YOU",
      x: DOOR.px.x + DOOR.px.w + 6,
      y: DOOR.px.y + 10,
      w: 12,
      h: 8,
    });

    // Ring a note's helpers when the note is hovered or chosen, and the other way round.
    const focusKey = hovered ?? selected ?? "";
    const ringAgents = new Set<string>();
    const ringNotes = new Set<string>();
    for (const c of scene.columns) {
      for (const n of c.notes) {
        if (focusKey === `task:${n.id}`)
          for (const a of n.agents) ringAgents.add(a);
        if (n.agents.some((a) => focusKey === `agent:${a}`))
          ringNotes.add(n.id);
      }
    }

    const cols = boardLayout(scene, s);
    if (!scene.columns.length)
      out.push({
        key: "board-empty",
        cls: "board-empty",
        x: BOARD.px.x + 4,
        y: BOARD.px.y + 4,
        w: BOARD.px.w - 8,
        h: BOARD.px.h - 8,
        html:
          scene.request.state === "running" || scene.request.state === "waiting"
            ? "No plan yet. Claude is working without one."
            : "No plan on this request: Claude did it in one go.",
      });
    // One style for every column head: the longest form that fits them all.
    const size = s >= 3 ? 15 : 13;
    const pad = s >= 3 ? 12 : 8;
    const firstWord = (title: string) => phaseShort(title).split(" ")[0] ?? "";
    const forms = [(title: string) => title, phaseShort, firstWord];
    const form =
      forms.find((f) =>
        cols.every((c) => fits(f(c.title), (c.w - 1) * s - pad, size)),
      ) ?? firstWord;
    for (const col of cols) {
      out.push({
        key: `ph-${col.id}`,
        button: true,
        cls: "phase-h",
        html: esc(form(col.title)),
        x: col.x,
        y: BOARD.px.y + 1,
        w: col.w - 1,
        h: 13,
        label: `Phase: ${col.title}, ${WORD[col.status] ?? col.status}`,
        open: `phase:${col.id}`,
        ring: `phase:${col.id}`,
      });
      for (const n of col.notes) {
        const sel = selected === `task:${n.id}`;
        const ring = ringNotes.has(n.id);
        out.push({
          key: `n-${n.id}`,
          button: true,
          cls: `hit note${n.status === "done" ? " done" : ""}${n.slotW >= 60 ? " wide" : ""}${sel ? " sel" : ""}${ring ? " ring" : ""}`,
          x: n.x - 1,
          y: n.y - 1,
          w: n.slotW - 4,
          h: n.rowH + 2,
          ring: `task:${n.id}`,
          html: `<span class="t">${esc(n.title)}</span>${n.stage ? `<span class="stage${n.status === "todo" ? " left" : ""}">${esc(n.stage)}</span>` : ""}`,
          label: `Task: ${n.title}, ${n.stage ?? WORD[n.status] ?? n.status}`,
          open: `task:${n.id}`,
        });
      }
      if (col.hidden) {
        out.push({
          key: `more-${col.id}`,
          cls: "more",
          html: `+${col.hidden} more`,
          x: col.x + 3,
          y: BOARD.px.y + BOARD.px.h - 7,
        });
      }
    }

    const walking = new Set(walkers.map((a) => a.id)); // a helper still on its way has nothing to say yet
    for (const d of scene.desks) {
      const tl = deskTile(d);
      const cx = tl.x * T + 24;
      const when =
        d.status === "running"
          ? dur(Date.parse(t) - Date.parse(d.startedAt))
          : `done ${clockOf(d.endedAt ?? t)}`;
      // Plate: name, then a chip tying the desk to its phase (or the earlier request it works for).
      let pc: string | null = null;
      let chipText = "";
      if (d.task) {
        pc = phaseColor(d.group);
        chipText = d.chip ?? "";
      } else if (d.fromRequest) {
        pc = LINEAGE;
        chipText = `Req ${d.fromRequest}`;
      }
      // Role, model and time, dropping the model, then the role, so the time is never the
      // part cut off. At 2x too: a reviewer seated on the work floor is told apart by it.
      const model = s >= 3 ? modelWord(d.model) : "";
      const room = 78 * s - (chipText ? chipText.length * 7 + 18 : 0) - 6;
      const parts = [
        model ? `${d.roleWord} · ${model} · ` : `${d.roleWord} · `,
        `${d.roleWord} · `,
        "",
      ];
      const lead = parts.find((p) => fits(`${p}${when}`, room, 13)) ?? "";
      const role = esc(lead);
      const sub = `${chipText ? `<i class="ph" style="--ph:${pc}">${esc(chipText)}</i>` : ""}${role}${esc(when)}`;
      const py = (tl.y + 1) * T + 1;
      const sel = selected === `agent:${d.agent}`;
      // The desk's hit area first, so its selection ring sits under the plate and bubble, never through them.
      out.push({
        key: `d-${d.agent}`,
        button: true,
        cls: `hit desk${sel ? " sel" : ""}${ringAgents.has(d.agent) ? " ring" : ""}`,
        x: tl.x * T,
        y: tl.y * T - 21,
        w: 48,
        h: 36,
        ring: `agent:${d.agent}`,
        label: `Helper: ${d.description}, ${d.status}`,
        open: `agent:${d.agent}`,
      });
      out.push({
        key: `pl-${d.agent}`,
        cls: `plate ${d.status === "running" ? "now" : "done"}`,
        x: cx,
        y: py,
        html: `<b>${esc(d.name)}</b><span>${sub}</span>`,
        hidden: covered(cx - 24, py, 48, 11),
      });
      if (d.bubble && !walking.has(d.agent)) {
        const key = `b-${d.agent}-${hashText(d.bubble)}`;
        const pointed = focusKey === `agent:${d.agent}`;
        const quiet = said(key, SAY_MS.helper) && !pointed;
        const who = pc ?? helperLook(d.agent, d.look).pal.C;
        out.push({
          key,
          cls: `bubble mate${quiet ? " gone" : ""}`,
          x: tl.x * T + 28,
          y: tl.y * T - 12,
          html: `<span class="bt">${esc(d.bubble)}</span>`,
          maxW: Math.min(280, (d.kind === "review" ? 5 : 6) * T * s - 8),
          who,
        });
        // Once the words fade, three soft dots say the helper is still at it.
        if (quiet) {
          out.push({
            key: `dots-${d.agent}`,
            cls: "dots",
            x: tl.x * T + 28,
            y: tl.y * T - 13,
            html: "<i></i><i></i><i></i>",
            who,
          });
        }
      }
    }

    const hit = (
      key: string,
      open: string,
      label: string,
      x: number,
      y: number,
      w: number,
      h: number,
    ) =>
      out.push({
        key,
        button: true,
        cls: `hit${selected === open ? " sel" : ""}`,
        x,
        y,
        w,
        h,
        label,
        open,
      });
    hit(
      "h-archive",
      "archive",
      "Archive: files touched",
      SHELVES.px.x,
      SHELVES.px.y,
      SHELVES.px.w,
      SHELVES.px.h,
    );
    hit(
      "h-door",
      "door",
      "Your door: what Claude asked",
      DOOR.px.x - 3,
      DOOR.px.y,
      DOOR.px.w + 24,
      DOOR.px.h + 2,
    );
    hit(
      "h-jobs",
      "jobs",
      "Request board: switch request",
      JOB_BOARD.px.x - 3,
      JOB_BOARD.px.y - 3,
      JOB_BOARD.px.w + 6,
      JOB_BOARD.px.h + 6,
    );
    hit(
      "h-term",
      "terminal",
      "Terminal: Claude's commands",
      RACKS.px.x - 2,
      RACKS.px.y,
      RACKS.px.w + 4,
      (CONSOLE.y + 1) * T - RACKS.px.y,
    );
    hit(
      "h-cdesk",
      "claude",
      "Claude's desk",
      CLAUDE_DESK.x * T,
      CLAUDE_DESK.y * T - 20,
      CLAUDE_DESK.w * T,
      38,
    );

    if (claude) {
      const c = scene.claude;
      const x = claude.x;
      const y = claude.y;
      const head = claude.sit ? y - 18 : y - 25;
      out.push({
        key: "c-tag",
        cls: "tag",
        html: "Claude",
        x,
        y: claude.sit ? y + 14 : y + 1,
        hidden: claude.sit,
      });
      if (c.waiting) {
        out.push({ key: "c-bang", cls: "bang", html: "!", x, y: head - 2 });
        const half = (s >= 3 ? 420 : 340) / 2 / s; // half the bubble's width, in floor pixels
        const bx = Math.max(
          21 * T + half,
          Math.min(x, CONSOLE.x * T - 4 - half),
        );
        out.push({
          key: "c-b",
          cls: "bubble wait",
          x: bx,
          y: y + 9,
          tail: (x - bx) * s,
          html: `<span>${esc(c.bubble)}</span><small>Waiting ${dur(Date.parse(t) - Date.parse(c.since ?? t))}</small>`,
        });
      } else if (c.bubble) {
        const key = `c-b-${hashText(c.bubble)}`;
        const pointed = focusKey === "claude" || selected === "claude";
        const left = c.spot === "helper";
        out.push({
          key,
          cls: `bubble claude${left ? " left" : ""}${said(key, SAY_MS.claude) && !pointed ? " gone" : ""}`,
          x: left ? x - 8 : x,
          y: head,
          html: `<span class="bt">${esc(c.bubble)}</span>`,
          maxW: s >= 3 ? 300 : 200,
        });
      }
      out.push({
        key: "c-hit",
        button: true,
        cls: `hit${selected === "claude" ? " sel" : ""}`,
        x: x - 9,
        y: y - 25,
        w: 18,
        h: 26,
        label: "Claude: what it is doing",
        open: "claude",
        ring: "claude",
      });
    }
    // Helpers beyond the desks: a sign by the cooler says how many, and opens the full list.
    if (scene.off.length)
      out.push({
        key: "off",
        button: true,
        cls: "off-sign",
        // Under the water cooler, on the work floor's right edge, clear of the plates.
        x: 25.3 * T,
        y: 15.9 * T,
        html: `+${scene.off.length} more`,
        label: `${scene.off.length} more helper${scene.off.length === 1 ? "" : "s"} than desks show: see them all`,
        open: "helpers",
      });
    return out;
  }

  return {
    setScale(v) {
      s = v;
      const m = root.parentElement;
      if (!m) return;
      // Lesser words step down, then hide, as the room shrinks: s2 under 3x, s15 under 2x,
      // s1 under 1.5x.
      m.classList.toggle("s1", v < 1.5);
      m.classList.toggle("s15", v < 2);
      m.classList.toggle("s2", v < 3);
      m.classList.toggle("s4", v >= 4);
      m.style.setProperty("--s", String(v));
    },
    render(scene, claude, walkers, selected, hovered, t) {
      put(items(scene, claude, walkers, selected, hovered, t));
      root.classList.toggle("waitdim", !!scene.waiting);
    },
    destroy() {
      pointed = null;
      for (const p of els.values()) p.el.remove();
      els.clear();
      born.clear();
      root.classList.remove("waitdim");
    },
  };
}
