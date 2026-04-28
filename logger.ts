import chalk from "chalk";
import type { OverrideRuleMeta } from "./utils.js";

export function fmtStatus(status?: number): string {
  if (status == null) return "";
  if (status >= 500) return chalk.red(String(status));
  if (status >= 400) return chalk.yellow(String(status));
  if (status >= 300) return chalk.magenta(String(status));
  if (status >= 200) return chalk.green(String(status));
  return String(status);
}

export function logRequestStart(
  id: number,
  method: string,
  url: string,
): void {
  console.log(chalk.gray(`[${id}] -> ${method} ${url}`));
}

export function logRequestMatch(
  id: number,
  match: string,
  meta?: OverrideRuleMeta,
): void {
  const extra = meta?.file
    ? ` (${meta.file}${meta?.export ? ":" + meta.export : ""})`
    : "";
  console.log(chalk.cyan(`[${id}] match ${match}${extra}`));
}

export function logRequestEnd(
  id: number,
  status: number,
  ms: number,
  via?: string,
  match?: string,
): void {
  const viaStr = via ? chalk.blue(via) : "";
  const matchStr = match ? chalk.cyan(match) : "";
  console.log(
    `[${id}] <- ${fmtStatus(status)} ${ms}ms ${viaStr} ${matchStr}`.trim(),
  );
}

export function logError(id: number, err: unknown, match?: string): void {
  console.error(
    chalk.red(`[${id}] ERROR ${match ? match + " " : ""}${String(err)}`),
  );
}

export function logWebSocketUpgrade(
  id: number,
  pathname: string,
  routeName?: string,
): void {
  const route = routeName ? ` ${chalk.cyan(routeName)}` : "";
  console.log(chalk.gray(`[ws:${id}] -> ${pathname}${route}`));
}

export function logWebSocketProxy(
  id: number,
  target: string,
): void {
  console.log(`[ws:${id}] proxy ${chalk.blue(target)}`);
}

export function logWebSocketMatch(
  id: number,
  direction: string,
  match: string,
  meta?: OverrideRuleMeta,
): void {
  const extra = meta?.file
    ? ` (${meta.file}${meta?.export ? ":" + meta.export : ""})`
    : "";
  console.log(chalk.cyan(`[ws:${id}] ${direction} match ${match}${extra}`));
}

export function logWebSocketAction(
  id: number,
  direction: string,
  action: string,
  bytes?: number,
): void {
  const size = bytes == null ? "" : ` ${bytes}b`;
  console.log(`[ws:${id}] ${direction} ${action}${size}`);
}

export function logWebSocketClose(
  id: number,
  code: number,
  ms: number,
): void {
  console.log(chalk.gray(`[ws:${id}] <- close ${code} ${ms}ms`));
}

export function logWebSocketReject(
  id: number,
  pathname: string,
  reason: string,
): void {
  console.log(chalk.yellow(`[ws:${id}] reject ${pathname} ${reason}`));
}
