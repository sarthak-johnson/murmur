import { expect, test } from "vitest";
import * as core from "./index.js";

test("core module loads", () => {
  expect(core).toBeDefined();
});
