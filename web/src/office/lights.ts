// Lights follow activity: rooms where nobody works fall to night; each active spot gets a lamp pool.
// While Claude waits on you, the rest of the floor dims and your open door throws an amber wedge.
import { BOARD, DOOR, H, ROOMS, type RoomId, roomOf, T, W } from "./map";
import { canvas2d } from "./util";

/** A lamp pool in native px; `tint` is an "r,g,b" warm or screen colour. */
export interface Pool {
  x: number;
  y: number;
  r: number;
  tint?: string | undefined;
}

export interface Lights {
  draw(
    g: CanvasRenderingContext2D,
    pools: readonly Pool[],
    waiting: boolean,
    claude: { x: number; y: number } | null,
  ): void;
}

export function createLights(): Lights {
  const { c, g: lg } = canvas2d(W, H);

  function hole(x: number, y: number, r: number, a: number) {
    const gr = lg.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(0,0,0,${a})`);
    gr.addColorStop(0.6, `rgba(0,0,0,${a * 0.6})`);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    lg.fillStyle = gr;
    lg.beginPath();
    lg.arc(x, y, r, 0, Math.PI * 2);
    lg.fill();
  }

  function draw(
    g: CanvasRenderingContext2D,
    pools: readonly Pool[],
    waiting: boolean,
    claude: { x: number; y: number } | null,
  ) {
    const active = new Set(
      pools.map((p) => roomOf(Math.floor(p.x / T), Math.floor(p.y / T))),
    );
    lg.globalCompositeOperation = "source-over";
    lg.clearRect(0, 0, W, H);
    if (!waiting) {
      for (const [k, r] of Object.entries(ROOMS) as [
        RoomId,
        (typeof ROOMS)[RoomId],
      ][]) {
        lg.fillStyle = active.has(k)
          ? "rgba(4,5,12,0.34)"
          : "rgba(4,5,12,0.58)";
        lg.fillRect(r.x * T, r.y * T, r.w * T, r.h * T);
      }
    }
    lg.globalCompositeOperation = "destination-out";
    for (const p of pools) hole(p.x, p.y, p.r, 0.95);
    // The plan board keeps its own light so it stays readable from across the room.
    lg.fillStyle = "rgba(0,0,0,0.85)";
    lg.fillRect(BOARD.px.x - 2, BOARD.px.y - 2, BOARD.px.w + 4, BOARD.px.h + 4);
    lg.globalCompositeOperation = "source-over";
    if (waiting) {
      lg.fillStyle = "rgba(0,0,0,0.45)";
      lg.fillRect(0, 0, W, H);
      lg.globalCompositeOperation = "destination-out";
      const d = DOOR.px;
      if (claude) hole(claude.x, claude.y - 12, 40, 1);
      hole(d.x + d.w / 2, d.y + d.h, 46, 1);
      lg.globalCompositeOperation = "source-over";
    }
    g.drawImage(c, 0, 0);

    // A warm touch inside each pool.
    for (const p of pools) {
      const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 0.8);
      const tint = p.tint ?? "255,226,180";
      gr.addColorStop(0, `rgba(${tint},${p.tint ? 0.11 : 0.07})`);
      gr.addColorStop(1, `rgba(${tint},0)`);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(p.x, p.y, p.r * 0.8, 0, Math.PI * 2);
      g.fill();
    }
    if (waiting) {
      const d = DOOR.px;
      const y0 = d.y + d.h;
      const len = 52;
      const gr = g.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, "rgba(255,191,74,0.34)");
      gr.addColorStop(1, "rgba(255,191,74,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(d.x + 2, y0);
      g.lineTo(d.x + d.w - 2, y0);
      g.lineTo(d.x + d.w + 18, y0 + len);
      g.lineTo(d.x - 18, y0 + len);
      g.closePath();
      g.fill();
    }
  }
  return { draw };
}
