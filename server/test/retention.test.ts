import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  assumptionDecisions,
  deviceCodes,
  events,
  sessions,
  users,
  webSessions,
} from "../src/db/schema.js";
import { runRetention } from "../src/retention.js";
import { linkMachine, testApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof testApp>>;
afterEach(() => t.close());

const day = 86_400_000;

describe("runRetention", () => {
  it("deletes sessions idle longer than the user's days and keeps the rest", async () => {
    t = await testApp();
    const now = new Date("2026-11-06T10:00:00Z");
    const m = await linkMachine(t, "ann");
    await t.db
      .update(users)
      .set({ retentionDays: 10 })
      .where(eq(users.id, m.userId));
    const mk = async (sessionId: string, ageDays: number) => {
      const at = new Date(now.getTime() - ageDays * day);
      await t.db.insert(sessions).values({
        userId: m.userId,
        sessionId,
        machineId: m.machineId,
        cwd: "/r",
        startedAt: at,
        lastEventAt: at,
      });
      await t.db.insert(events).values({
        userId: m.userId,
        id: randomUUID(),
        sessionId,
        ts: at,
        hook: "PreToolUse",
        payload: {},
      });
      await t.db.insert(assumptionDecisions).values({
        userId: m.userId,
        sessionId,
        key: "k",
        decision: "accepted",
      });
    };
    await mk("old", 11);
    await mk("new", 9);
    await t.db.insert(webSessions).values({
      idHash: "dead",
      userId: m.userId,
      expiresAt: new Date(now.getTime() - 1000),
    });
    await t.db.insert(deviceCodes).values({
      deviceCodeHash: "dc",
      userCode: "AAAA-BBBB",
      machineName: "x",
      expiresAt: new Date(now.getTime() - 1000),
    });

    expect(await runRetention(t.db, now)).toBe(1);

    const left = await t.db.select().from(sessions);
    expect(left.map((s) => s.sessionId)).toEqual(["new"]);
    expect((await t.db.select().from(events)).map((e) => e.sessionId)).toEqual([
      "new",
    ]);
    expect(
      (await t.db.select().from(assumptionDecisions)).map((e) => e.sessionId),
    ).toEqual(["new"]);
    expect(
      (await t.db.select().from(webSessions)).some((w) => w.idHash === "dead"),
    ).toBe(false);
    expect(await t.db.select().from(deviceCodes)).toHaveLength(0);
  });
});
