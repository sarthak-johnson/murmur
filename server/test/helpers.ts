import { createApp } from "../src/app.js";
import { openDb } from "../src/db/client.js";

export async function testApp() {
  const { db, close } = await openDb("memory://");
  const app = createApp({
    db,
    now: () => new Date(),
    config: {
      baseUrl: "http://localhost",
      devLogin: true,
      cookieSecure: false,
    },
  });
  const loginAs = async (_login: string): Promise<string> => {
    throw new Error("loginAs is implemented in Task 10");
  };
  return { app, db, loginAs, close };
}
