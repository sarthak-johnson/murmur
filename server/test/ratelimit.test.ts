import { expect, test } from "vitest";
import { fixedWindow, ipBucket } from "../src/ratelimit.js";

const at = (ms: number) => new Date(ms);

test("sweep removes expired entries from the front", () => {
  const l = fixedWindow(5, 1000);
  l.hit("a", at(0));
  l.hit("b", at(500));
  l.hit("c", at(1200)); // a expired, b live
  expect(l.size).toBe(2);
  l.hit("a", at(1400)); // a starts a new window at the back
  expect(l.size).toBe(3);
  l.hit("d", at(1600)); // b expired; c and a live
  expect(l.size).toBe(3);
  l.hit("e", at(2300)); // c expired; a and d live
  expect(l.size).toBe(3);
  expect(l.blocked("a", at(2300))).toBe(false);
});

test("at the cap a new key is blocked while an existing key still works", () => {
  const l = fixedWindow(5, 1000, 3);
  for (const k of ["a", "b", "c"]) l.hit(k, at(0));
  expect(l.blocked("d", at(10))).toBe(true);
  l.hit("d", at(10));
  expect(l.size).toBe(3);
  expect(l.blocked("a", at(10))).toBe(false);
  l.hit("a", at(10));
  expect(l.blocked("a", at(10))).toBe(false);
  // Once the window passes, new keys are allowed again.
  expect(l.blocked("d", at(1000))).toBe(false);
});

test("200,000 distinct keys over time keep the map at or under the cap", () => {
  const cap = 100_000;
  const l = fixedWindow(5, 10_000, cap);
  let max = 0;
  for (let i = 0; i < 200_000; i++) {
    const now = at(Math.floor(i / 8)); // 8 new keys per ms: 80,000 live at once
    const key = `k${i}`;
    if (!l.blocked(key, now)) l.hit(key, now);
    max = Math.max(max, l.size);
  }
  expect(max).toBeLessThanOrEqual(cap);
  expect(max).toBeGreaterThan(70_000);

  const crowded = fixedWindow(5, 10_000, cap);
  for (let i = 0; i < 200_000; i++) {
    const now = at(Math.floor(i / 20)); // 200,000 live at once: cap binds
    crowded.hit(`k${i}`, now);
    max = Math.max(max, crowded.size);
  }
  expect(crowded.size).toBe(cap);
  expect(max).toBeLessThanOrEqual(cap);
});

test.each([
  ["1.2.3.4", "1.2.3.4"],
  ["::ffff:1.2.3.4", "1.2.3.4"],
  ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"],
  ["2001:0DB8:0001:0002::9", "2001:db8:1:2::/64"],
  ["2001:db8::1", "2001:db8:0:0::/64"],
  ["::1", "0:0:0:0::/64"],
  ["fe80::1%en0", "fe80:0:0:0::/64"],
  ["not an ip", "not an ip"],
])("ipBucket(%s) is %s", (ip, bucket) => {
  expect(ipBucket(ip)).toBe(bucket);
});
