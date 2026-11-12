import type { RequestView, SessionView } from "@murmur/core";
import { describe, expect, it } from "vitest";
import { withoutFolderTasks } from "../src/plan";

const task = (id: string, agents: string[] = []) => ({
  id,
  title: id,
  part: id,
  status: "done" as const,
  agents,
});
const part = (id: string, agents: string[] = []) => ({ id, agents });
const view = (req: Partial<RequestView>) =>
  ({ requests: [{ planInferred: true, ...req }] }) as unknown as SessionView;

describe("an inferred plan", () => {
  it("keeps a helper's work as a task, and a folder only as a part", () => {
    const v = withoutFolderTasks(
      view({
        parts: [part("h", ["a1"]), part("contracts")] as never,
        phases: [
          {
            id: "did",
            title: "What Claude did",
            status: "done",
            tasks: [task("h", ["a1"]), task("contracts")],
          },
        ] as never,
      }),
    );
    const req = v.requests[0] as RequestView;
    expect(req.phases[0]?.tasks.map((t) => t.id)).toEqual(["h"]);
    expect(req.parts.map((p) => p.id)).toEqual(["h", "contracts"]);
  });

  it("has no plan when it was only folders", () => {
    const v = withoutFolderTasks(
      view({
        parts: [part("alphatake"), part("contracts")] as never,
        phases: [
          {
            id: "did",
            title: "What Claude did",
            status: "todo",
            tasks: [task("alphatake"), task("contracts")],
          },
        ] as never,
      }),
    );
    expect(v.requests[0]?.phases).toEqual([]);
  });

  it("leaves a plan Claude made, and a view with nothing to drop, as they are", () => {
    const mine = view({
      planInferred: false,
      parts: [part("contracts")] as never,
      phases: [
        { id: "did", title: "x", status: "done", tasks: [task("contracts")] },
      ] as never,
    });
    expect(withoutFolderTasks(mine)).toBe(mine);
  });
});
