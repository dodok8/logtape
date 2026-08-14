import { type TextFormatter } from "@logtape/logtape";

interface SlackSinkOptions {
  readonly webhookUrl: string | URL;
  readonly formatter?: TextFormatter;
  readonly batchInterval?: number;
  readonly maxMessageLength?: number;
  readonly maxBufferSize?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export function takeBatch(
  pending: string[],
  maxMessageLength = 40_000,
): string {
  let length = 0;
  let count = 0;

  for (const message of pending) {
    const nextLength = length + (count === 0 ? 0 : 1) + message.length;
    if (nextLength > maxMessageLength) break;

    length = nextLength;
    count++;
  }

  if (count === 0) {
    const suffix = "\n[truncated]";
    const message = pending.shift() ?? "";
    return message.slice(0, maxMessageLength - suffix.length) + suffix;
  }

  return pending.splice(0, count).join("\n");
}
