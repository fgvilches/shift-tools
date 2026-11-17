/**
 * Sample patterns, their test payloads, and the syntax cheat sheet shown in
 * the Regex Tester. Everything here is ECMAScript RegExp syntax — the engine
 * is the browser's own, no PCRE/Python extensions.
 */

export interface RegexSample {
  id: string;
  label: string;
  pattern: string;
  flags: string;
  text: string;
}

const NETWORK_LOG = [
  "[SYSTEM_LOG 08:14:22] Client dispatched request to https://api.github.com:443/repos/rust-lang/rust status=200 payload=42kb",
  "[GATEWAY_AUDIT] Inbound tunnel forwarded to internal proxy http://192.168.1.1:8080/admin/status over loopback",
  "[METRICS] Exported telemetry batch to https://telemetry.datadoghq.com/v1/traces with TLS 1.3 reuse",
  "[CONTAINER_DOCK] Health probe hitting http://localhost:3000/healthz every 5000ms — response UP",
  "[S3_SYNC] Uploaded payload to https://s3.eu-central-1.amazonaws.com/vault-backups/core.tar.gz checksum ok",
  "[DEV_SERVER] Listening at remote peer endpoint http://10.0.0.245:9092/kafka/topics partition=0 offset=99142",
].join("\n");

const TIMESTAMPS = [
  "2026-11-03T08:14:22.104Z  ingest  batch=8421  status=ok",
  "2026-11-03T08:14:23Z      ingest  batch=8422  status=ok",
  "2026-11-03 08:14:24.9-03:00 worker shard=7  retry=1",
  "2026-11-03T08:14:25.000000+02:00 worker shard=8  retry=0",
  "not-a-timestamp           scheduler tick=912",
].join("\n");

const EMAILS = [
  "ops@shift-tools.dev",
  "security+audit@nousresearch.com",
  "no-reply@mail.github.com  (bounced)",
  "support@localhost",
  "oncall@10.0.0.7",
].join("\n");

const IPV4 = [
  "peer 10.0.0.245 → gateway 10.0.0.1",
  "listener 192.168.1.1:8080",
  "subnet 172.16.4.9 / 8",
  "reject 999.999.999.999",
].join("\n");

const LEVELS = [
  "TRACE [scheduler] tick 0x1f",
  "DEBUG [io] opened 12 handles",
  "INFO  [gateway] listening on 8080",
  "WARN  [pool] saturation 91%",
  "ERROR [redis] connection reset by peer",
  "2026-11-03 INFO stray line without level prefix",
].join("\n");

export const SAMPLES: RegexSample[] = [
  {
    id: "endpoints",
    label: "HTTP endpoints",
    pattern: String.raw`(?<protocol>https?):\/\/(?<host>[\w.-]+)(?::(?<port>\d+))?(?<path>\/[^\s?#]*)`,
    flags: "g",
    text: NETWORK_LOG,
  },
  {
    id: "timestamps",
    label: "ISO 8601 timestamps",
    pattern: String.raw`(?<date>\d{4}-\d{2}-\d{2})[T ](?<time>\d{2}:\d{2}:\d{2})(?:\.(?<fraction>\d{1,6}))?(?<zone>Z|[+-]\d{2}:\d{2})`,
    flags: "g",
    text: TIMESTAMPS,
  },
  {
    id: "emails",
    label: "Email addresses",
    pattern: String.raw`\b[\w.+-]+@[\w-]+\.[\w.-]+\b`,
    flags: "gi",
    text: EMAILS,
  },
  {
    id: "ipv4",
    label: "IPv4 candidates",
    pattern: String.raw`\b(?:\d{1,3}\.){3}\d{1,3}\b`,
    flags: "g",
    text: IPV4,
  },
  {
    id: "levels",
    label: "Log levels",
    pattern: String.raw`^\s*(?<level>TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+\[(?<scope>[^\]]+)\]`,
    flags: "gm",
    text: LEVELS,
  },
];

export interface CheatEntry {
  token: string;
  description: string;
}

export interface CheatGroup {
  title: string;
  entries: CheatEntry[];
}

export const CHEAT_SHEET: CheatGroup[] = [
  {
    title: "Character classes",
    entries: [
      { token: "\\d", description: "Digit 0–9" },
      { token: "\\w", description: "Word char: letter, digit, underscore" },
      { token: "\\s", description: "Whitespace incl. newlines" },
      { token: ".", description: "Any char except line terminators" },
      { token: "[abc]", description: "One of a, b or c" },
      { token: "[^abc]", description: "Any char but a, b, c" },
      { token: "\\p{L}", description: "Unicode letter (needs u)" },
    ],
  },
  {
    title: "Anchors & boundaries",
    entries: [
      { token: "^", description: "Start of input (or line with m)" },
      { token: "$", description: "End of input (or line with m)" },
      { token: "\\b", description: "Word boundary" },
      { token: "\\B", description: "Not a word boundary" },
    ],
  },
  {
    title: "Quantifiers",
    entries: [
      { token: "*", description: "0 or more, greedy" },
      { token: "+", description: "1 or more, greedy" },
      { token: "?", description: "0 or 1, greedy" },
      { token: "{2,5}", description: "Between 2 and 5 times" },
      { token: "*?", description: "0 or more, lazy" },
      { token: "+?", description: "1 or more, lazy" },
    ],
  },
  {
    title: "Groups & references",
    entries: [
      { token: "(…)", description: "Capturing group, numbered from 1" },
      { token: "(?<name>…)", description: "Named capturing group" },
      { token: "(?:…)", description: "Non-capturing group" },
      { token: "a|b", description: "Alternation: a or b" },
      { token: "\\1", description: "Backreference to group 1" },
    ],
  },
  {
    title: "Lookaround",
    entries: [
      { token: "(?=…)", description: "Positive lookahead" },
      { token: "(?!…)", description: "Negative lookahead" },
      { token: "(?<=…)", description: "Positive lookbehind" },
      { token: "(?<!…)", description: "Negative lookbehind" },
    ],
  },
  {
    title: "Replacement",
    entries: [
      { token: "$1", description: "Captured group 1" },
      { token: "$<name>", description: "Named captured group" },
      { token: "$&", description: "The whole match" },
      { token: "$`", description: "Text before the match" },
      { token: "$'", description: "Text after the match" },
      { token: "$$", description: "A literal dollar sign" },
    ],
  },
];
