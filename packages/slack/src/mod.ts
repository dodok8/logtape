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
    count += 1;
  }

  if (count === 0) {
    const suffix = "\n[truncated]";
    const message = pending.shift() ?? "";
    return message.slice(0, maxMessageLength - suffix.length) + suffix;
  }

  return pending.splice(0, count).join("\n");
}

export async function postSlackMessage(
  fetcher: typeof globalThis.fetch,
  webhookUrl: string | URL,
  text: string,
): Promise<void> {
  const response = await fetcher(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text,
      mrkdwn: false,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(`Slack webhook returned HTTP ${response.status}: ${body}`);
  }
}
