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
  if (kind === "jobs") return { tab: "requests" };
  if (kind === "claude") return { tab: "story", item: "claude" };
  return { tab: "story", item: key };
}
