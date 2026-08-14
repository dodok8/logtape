import { type TextFormatter } from "@logtape/logtape";

interface SlackSinkOptions {
  readonly webhookUrl: string | URL;
  readonly formatter?: TextFormatter;
  readonly batchInterval?: number;
  readonly maxMessageLength?: number;
  readonly maxBufferSize?: number;
  readonly fetch?: typeof globalThis.fetch;
}
