import { ISOLATION_HEADERS } from "../pwa/isolation";

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  ...ISOLATION_HEADERS,
} as const;
const WORKER_HEADERS = { "Cache-Control": "no-cache" } as const;

function rule(path: string, headers: Record<string, string>): string {
  return `${path}\n${Object.entries(headers)
    .map(([name, value]) => `  ${name}: ${value}\n`)
    .join("")}`;
}

export function headersFile(): string {
  return rule("/*", BASE_HEADERS) + rule("/sw.js", WORKER_HEADERS);
}
