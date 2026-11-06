import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/mcp.js";

let client: Client;
beforeEach(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer().connect(a);
  client = new Client({ name: "test", version: "0" });
  await client.connect(b);
});

describe("mcp server", () => {
  it("lists map and narrate", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["map", "narrate"]);
  });

  it("narrate with a valid note answers noted", async () => {
    const res = await client.callTool({
      name: "narrate",
      arguments: { now: "Reading the hook", why: "To see what it sends" },
    });
    expect(res.isError).toBeFalsy();
    expect(res.content).toEqual([{ type: "text", text: "noted" }]);
  });

  it("map with a bad kind returns an error", async () => {
    const res = await client.callTool({
      name: "map",
      arguments: { kind: "chore", goal: "g", phases: [], parts: [] },
    });
    expect(res.isError).toBe(true);
    const [first] = res.content as { type: string; text: string }[];
    expect(first?.text).toMatch(/kind/);
    expect(first?.text).toMatch(/Invalid option/);
  });
});
