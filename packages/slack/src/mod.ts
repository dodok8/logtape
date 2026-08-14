import {
  defaultTextFormatter,
  getLogger,
  type LogRecord,
  type Sink,
  type TextFormatter,
} from "@logtape/logtape";

type Fetcher = (
  ...args: Parameters<typeof globalThis.fetch>
) => ReturnType<typeof globalThis.fetch>;

export interface SlackSinkOptions {
  readonly webhookUrl: string | URL;
  readonly formatter?: TextFormatter;
  readonly batchInterval?: number;
  readonly maxMessageLength?: number;
  readonly maxBufferSize?: number;
  readonly maxRetries?: number;
  readonly fetch?: Fetcher;
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

export function postSlackMessage(
  fetcher: Fetcher,
  webhookUrl: string | URL,
  text: string,
  maxRetries: number,
): Promise<void> {
  return postSlackMessageWithRetries(
    fetcher,
    webhookUrl,
    text,
    0,
    maxRetries,
  );
}

async function postSlackMessageWithRetries(
  fetcher: Fetcher,
  webhookUrl: string | URL,
  text: string,
  currRetries: number,
  maxRetries: number,
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

  if (response.status === 429 && currRetries < maxRetries) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "1");

    await new Promise<void>((resolve) => {
      setTimeout(resolve, retryAfter * 1_000);
    });

    return postSlackMessageWithRetries(
      fetcher,
      webhookUrl,
      text,
      currRetries + 1,
      maxRetries,
    );
  } else if (!response.ok) {
    const body = await response.text();

    throw new Error(`Slack webhook returned HTTP ${response.status}: ${body}`);
  }
}

export function getSlackSink(
  options: SlackSinkOptions,
): Sink & AsyncDisposable {
  const pending: string[] = [];
  const batchInterval = options.batchInterval ?? 1_000;
  const maxMessageLength = options.maxMessageLength ?? 40_000;
  const maxBufferSize = options.maxBufferSize ?? 1_000;
  const maxRetries = options.maxRetries ?? 30;
  const formatter = options.formatter ?? defaultTextFormatter;
  const fetcher = options.fetch ?? globalThis.fetch;

  let droppedRecords = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeSend: Promise<void> | undefined;
  let disposed = false;
  let nextSendAt = 0;

  function scheduleFlush(): void {
    if (
      disposed || timer != null || activeSend != null || pending.length === 0
    ) {
      return;
    }

    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, batchInterval);
  }

  async function flush(): Promise<void> {
    if (activeSend != null || pending.length === 0) return;

    if (timer != null) {
      clearTimeout(timer);
      timer = undefined;
    }

    if (droppedRecords > 0) {
      pending.unshift(
        `[LogTape] ${droppedRecords} log records were dropped because ` +
          "the Slack buffer was full.",
      );
      droppedRecords = 0;
    }

    const message = takeBatch(pending, maxMessageLength);

    const work = (async () => {
      const delay = Math.max(0, nextSendAt - Date.now());

      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }

      nextSendAt = Date.now() + batchInterval;

      await postSlackMessage(
        fetcher,
        options.webhookUrl,
        message,
        maxRetries,
      );
    })()
      .catch(reportError)
      .finally(() => {
        activeSend = undefined;

        if (!disposed && pending.length > 0) {
          scheduleFlush();
        }
      });

    activeSend = work;
    await work;
  }

  function reportError(error: unknown): void {
    try {
      getLogger(["logtape", "meta", "slack"]).error(
        "Failed to send log records to Slack: {error}",
        { error },
      );
    } catch {
      // Last resort: avoid throwing from error reporting.
    }
  }

  function isSlackMetaRecord(record: LogRecord): boolean {
    return (
      record.category[0] === "logtape" &&
      record.category[1] === "meta" &&
      record.category[2] === "slack"
    );
  }

  const sink: Sink & AsyncDisposable = (record: LogRecord) => {
    if (disposed || isSlackMetaRecord(record)) return;

    if (pending.length >= maxBufferSize) {
      pending.shift();
      droppedRecords += 1;
    }

    pending.push(formatter(record));
    scheduleFlush();
  };

  sink[Symbol.asyncDispose] = async (): Promise<void> => {
    disposed = true;

    if (timer != null) {
      clearTimeout(timer);
      timer = undefined;
    }

    while (activeSend != null || pending.length > 0) {
      if (activeSend != null) {
        await activeSend;
      } else {
        await flush();
      }
    }
  };

  return sink;
}
