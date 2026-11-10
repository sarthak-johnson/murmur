import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MapInput, NarrateInput } from "@murmur/core";

// The tools only report: the hooks capture each call's input and upload it.
const noted = async () => ({
  content: [{ type: "text" as const, text: "noted" }],
});

export function createServer(): McpServer {
  const server = new McpServer({ name: "murmur", version: "0.1.0" });
  server.registerTool(
    "map",
    {
      description:
        "Show the user the shape of this request: its kind, a one-line goal, a 2 to 5 word title of what it does, the plan as phases with tasks, and the parts and how they connect. Call once at the start of each request and again when the plan or parts change.",
      inputSchema: MapInput,
    },
    noted,
  );
  server.registerTool(
    "narrate",
    {
      description:
        "Tell the user in plain words what you are doing now and why, at each meaningful step, with the part and task it belongs to.",
      inputSchema: NarrateInput,
    },
    noted,
  );
  return server;
}

if (/[\\/]mcp\.(c?js|ts)$/.test(process.argv[1] ?? "")) {
  void createServer().connect(new StdioServerTransport());
}
