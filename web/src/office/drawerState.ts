// What the office drawer shows, and what a click in the room opens there.

export const DRAWER_TABS = [
  ["story", "Story"],
  ["tasks", "Tasks"],
  ["flow", "Flow"],
  ["files", "Files"],
  ["helpers", "Helpers"],
  ["requests", "Requests"],
] as const;
export type DrawerTab = (typeof DRAWER_TABS)[number][0];

/** What the drawer shows: a tab, or a close-up of a thing in the room (`agent:id`, `task:id`, ...). */
export interface DrawerState {
  tab: DrawerTab;
  item?: string | undefined;
  /** On the Tasks tab: the phase to bring into view. */
  phase?: string | undefined;
}

/** A thing in the room as the tab that tells its story; the rest open a close-up. */
export function drawerFor(key: string): DrawerState {
  const [kind] = key.split(":");
  if (kind === "phase") return { tab: "tasks", phase: key.slice(6) };
  if (kind === "archive") return { tab: "files" };
  if (kind === "helpers") return { tab: "helpers" };
  if (kind === "jobs") return { tab: "requests" };
  if (kind === "claude") return { tab: "story", item: "claude" };
  return { tab: "story", item: key };
}

const TOOL_WORDS: Record<string, string> = {
  ArtifactData: "Updated an artifact's data",
  Artifact: "Published an artifact",
  ToolSearch: "Looked up a tool",
  TaskStop: "Stopped a background task",
  TaskCreate: "Started a background task",
  TodoWrite: "Updated its to-do list",
  WebSearch: "Searched the web",
  WebFetch: "Read a web page",
  Skill: "Used a skill",
  Grep: "Searched the code",
  Glob: "Looked for files",
  Read: "Read a file",
  Edit: "Edited a file",
  Write: "Wrote a file",
  Bash: "Ran a command",
  Monitor: "Watched a command",
  AskUserQuestion: "Asked you a question",
  ExitPlanMode: "Showed you its plan",
};

/** A tool in words: its own, or the service an MCP tool belongs to ("Used Supabase"). */
export function toolWords(tool: string): string {
  const known = TOOL_WORDS[tool];
  if (known) return known;
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(tool);
  if (mcp) {
    const server = (mcp[1] ?? "")
      .replace(/^(claude_ai_|plugin_[^_]+_)/, "")
      .replace(/^claude-in-chrome$/, "the browser")
      .replace(/^mcp[_-]?/i, "")
      .replace(/[_-]+/g, " ")
      .trim();
    if (!server) return "Used a connected tool";
    const named = server.startsWith("the ")
      ? server
      : server.replace(/\b\w/g, (c) => c.toUpperCase());
    return `Used ${named}`;
  }
  return `Used ${tool.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}`;
}
