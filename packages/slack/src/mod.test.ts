import assert from "node:assert/strict";
import test from "node:test";
import { postSlackMessage, takeBatch } from "./mod.ts";

test("takeBatch() consumes messages up to the length limit", () => {
  // Arrange
  const pending = ["abc", "de", "fgh"];

  // Act
  const batch = takeBatch(pending, 6);

  // Assert
  assert.strictEqual(batch, "abc\nde");
  assert.deepStrictEqual(pending, ["fgh"]);
});

test("takeBatch() truncates a message that exceeds the length limit", () => {
  // Arrange
  const pending = ["abcdefghijklmnopqrstuvwxyz"];

  // Act
  const batch = takeBatch(pending, 16);

  // Assert
  assert.strictEqual(batch, "abcd\n[truncated]");
  assert.deepStrictEqual(pending, []);
});

test("postSlackMessage() retries a rate-limited request", async () => {
  // Arrange
  const responses = [
    new Response("rate limited", {
      status: 429,
      headers: { "retry-after": "0" },
    }),
    new Response("ok"),
  ];
  let calls = 0;
  const fetcher = () => {
    calls++;
    return Promise.resolve(responses.shift()!);
  };

  // Act
  await postSlackMessage(fetcher, "https://hooks.slack.com/test", "log", 1);

  // Assert
  assert.strictEqual(calls, 2);
});

test("postSlackMessage() stops after the maximum retries", async () => {
  // Arrange
  let calls = 0;
  const fetcher = () => {
    calls++;
    return Promise.resolve(
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "0" },
      }),
    );
  };

  // Act
  const result = postSlackMessage(
    fetcher,
    "https://hooks.slack.com/test",
    "log",
    2,
  );

  // Assert
  await assert.rejects(result, /Slack webhook returned HTTP 429/);
  assert.strictEqual(calls, 3);
});
