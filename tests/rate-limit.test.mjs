import test from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../scripts/rate-limit.mjs";

test("лимит по ключу и окно времени", () => {
  let now = 0;
  const limiter = new RateLimiter({ limit: 3, windowMs: 1000, now: () => now });
  assert.deepEqual([1, 2, 3, 4].map(() => limiter.allow("a")), [true, true, true, false]);
  assert.equal(limiter.allow("b"), true, "другой ключ независим");
  now = 999;
  assert.equal(limiter.allow("a"), false, "окно ещё не прошло");
  now = 1000;
  assert.equal(limiter.allow("a"), true, "окно прошло");
});

test("отказ не продлевает блокировку, reset очищает", () => {
  let now = 0;
  const limiter = new RateLimiter({ limit: 1, windowMs: 100, now: () => now });
  assert.equal(limiter.allow("a"), true);
  now = 50;
  assert.equal(limiter.allow("a"), false);
  now = 100;
  assert.equal(limiter.allow("a"), true, "отказ не засчитывался");
  limiter.reset();
  assert.equal(limiter.allow("a"), true);
});
