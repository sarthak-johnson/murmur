import { afterEach, expect, test, vi } from "vitest";
import { bus } from "../src/stream.js";
import { ev, ingest, linkMachine, testApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof testApp>> | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.close();
  t = undefined;
});

/** Reads SSE text until it contains `until`. */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  until: string,
) {
  const dec = new TextDecoder();
  let text = "";
  while (!text.includes(until)) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`stream ended before ${until}: ${text}`);
    text += dec.decode(value, { stream: true });
  }
  return text;
}

test("stream delivers events ingested after subscribe", async () => {
  t = await testApp();
  const { token, cookie, machineId } = await linkMachine(t, "ada");
  await ingest(t, token, [ev("s1", "SessionStart")]);
  const unsubscribed = vi.fn();
  const subscribe = bus.subscribe.bind(bus);
  vi.spyOn(bus, "subscribe").mockImplementation((...args) => {
    const off = subscribe(...args);
    return () => {
      unsubscribed();
      off();
    };
  });

  const res = await t.app.request("/api/sessions/s1/stream", {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();

  const e1 = ev("s1", "PreToolUse");
  const e2 = ev("s1", "PostToolUse");
  await ingest(t, token, [e1, e2, ev("other", "SessionStart")]);
  const text = await readUntil(reader, "\n\n");
  const [event, data] = text.trim().split("\n");
  expect(event).toBe("event: events");
  expect(JSON.parse((data as string).slice("data: ".length))).toEqual([
    { ...e1, machineId },
    { ...e2, machineId },
  ]);

  // A replayed batch stores nothing new, so nothing is published.
  await ingest(t, token, [e1, e2]);
  const e3 = ev("s1", "Stop");
  await ingest(t, token, [e3]);
  expect(await readUntil(reader, "\n\n")).toContain(e3.id);

  await reader.cancel();
  expect(unsubscribed).toHaveBeenCalledOnce();
});

test("stream sends a ping comment on the interval", async () => {
  t = await testApp({ config: { ssePingMs: 10 } });
  const { token, cookie } = await linkMachine(t, "ada");
  await ingest(t, token, [ev("s1", "SessionStart")]);
  const res = await t.app.request("/api/sessions/s1/stream", {
    headers: { Cookie: cookie },
  });
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  expect(await readUntil(reader, ": ping\n\n")).toBe(": ping\n\n");
  await reader.cancel();
});

test("stream needs a cookie", async () => {
  t = await testApp();
  const res = await t.app.request("/api/sessions/s1/stream");
  expect(res.status).toBe(401);
});
