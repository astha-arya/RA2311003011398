/**
 * @module @your-org/logging-middleware
 *
 * Reusable logging middleware that ships structured log entries to a remote
 * evaluation service via HTTP POST. All failures are swallowed and printed to
 * stderr so that a logging hiccup never crashes the calling application.
 */

// ---------------------------------------------------------------------------
// Types & Enums
// ---------------------------------------------------------------------------

/** The broad architectural layer that produced the log entry. */
export type Stack = "backend" | "frontend";

/** Severity level of the log entry, ordered from least to most critical. */
export type Level = "debug" | "info" | "warn" | "error" | "fatal";

/**
 * The logical package / module inside the service that produced the log entry.
 * Keeping this constrained enables reliable filtering in the evaluation service.
 */
export type Package =
  | "cache"
  | "controller"
  | "cron_job"
  | "db"
  | "domain"
  | "handler"
  | "repository"
  | "route"
  | "service"
  | "auth"
  | "config"
  | "middleware"
  | "utils";

/** Full shape of a log entry as sent to the remote API. */
export interface LogPayload {
  /** Architectural layer that produced this entry. */
  stack: Stack;
  /** Severity level. */
  level: Level;
  /** Logical module / package that produced this entry. */
  package: Package;
  /** Human-readable description of the event. */
  message: string;
  /** ISO-8601 timestamp generated at call-time. */
  timestamp: string;
}

/** Configuration accepted by {@link Logger.init}. */
export interface LoggerConfig {
  /**
   * Bearer token used to authenticate against the remote logging endpoint.
   *
   * Recommended approach: read this from an environment variable in the
   * consuming service, e.g. `process.env.LOGGER_BEARER_TOKEN`.
   */
  bearerToken: string;

  /**
   * Override the default API endpoint.
   * Defaults to `http://20.207.122.201/evaluation-service/logs`.
   */
  endpoint?: string;

  /**
   * Maximum number of milliseconds to wait for the remote API before aborting.
   * Defaults to `5000` (5 seconds).
   */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const DEFAULT_ENDPOINT = "http://20.207.122.201/evaluation-service/logs";
const DEFAULT_TIMEOUT_MS = 5_000;

let _bearerToken: string | null = null;
let _endpoint: string = DEFAULT_ENDPOINT;
let _timeoutMs: number = DEFAULT_TIMEOUT_MS;
let _initialised = false;

// ---------------------------------------------------------------------------
// Logger class
// ---------------------------------------------------------------------------

/**
 * Singleton-style logger that must be initialised once with {@link Logger.init}
 * before calling {@link Logger.log}.
 *
 * @example
 * ```ts
 * import { Logger } from "@your-org/logging-middleware";
 *
 * Logger.init({ bearerToken: process.env.LOGGER_BEARER_TOKEN! });
 *
 * await Logger.log("backend", "info", "service", "Server started on port 3000");
 * ```
 */
export class Logger {
  private constructor() {
    // Static-only class; prevent instantiation.
  }

  // -------------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------------

  /**
   * Initialise the logger with authentication credentials and optional
   * overrides. **Must be called once** before any {@link Logger.log} call.
   *
   * Calling `init` a second time replaces the existing configuration, which is
   * useful in tests that need different tokens per suite.
   *
   * @param config - Logger configuration object.
   *
   * @example
   * ```ts
   * Logger.init({
   *   bearerToken: process.env.LOGGER_BEARER_TOKEN!,
   *   timeoutMs: 3000,
   * });
   * ```
   */
  static init(config: LoggerConfig): void {
    if (!config.bearerToken || config.bearerToken.trim() === "") {
      throw new Error(
        "[Logger] bearerToken must be a non-empty string. " +
          "Pass it via Logger.init({ bearerToken: process.env.LOGGER_BEARER_TOKEN! })."
      );
    }

    _bearerToken = config.bearerToken.trim();
    _endpoint = config.endpoint?.trim() ?? DEFAULT_ENDPOINT;
    _timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    _initialised = true;
  }

  // -------------------------------------------------------------------------
  // Core logging method
  // -------------------------------------------------------------------------

  /**
   * Send a structured log entry to the remote evaluation service.
   *
   * The method is intentionally **fire-and-forget safe**: if the remote API
   * returns an error or the network request fails for any reason, the error is
   * printed to `stderr` and the returned promise resolves (not rejects), so
   * the calling application is never disrupted.
   *
   * @param stack   - Architectural layer (`"backend"` | `"frontend"`).
   * @param level   - Severity (`"debug"` | `"info"` | `"warn"` | `"error"` | `"fatal"`).
   * @param pkg     - Originating module (e.g. `"service"`, `"controller"`, …).
   * @param message - Human-readable description of the event.
   * @returns       A promise that always resolves (never rejects).
   *
   * @example
   * ```ts
   * await Logger.log("backend", "error", "db", "Connection pool exhausted");
   * ```
   */
  static async log(
    stack: Stack,
    level: Level,
    pkg: Package,
    message: string
  ): Promise<void> {
    if (!_initialised || _bearerToken === null) {
      console.error(
        "[Logger] Logger.log() called before Logger.init(). " +
          "Call Logger.init({ bearerToken }) once at application startup."
      );
      return;
    }

    const payload: LogPayload = {
      stack,
      level,
      package: pkg,
      message,
      timestamp: new Date().toISOString(),
    };

    await Logger._dispatch(payload);
  }

  // -------------------------------------------------------------------------
  // Convenience level helpers
  // -------------------------------------------------------------------------

  /** Shorthand for `Logger.log(stack, "debug", pkg, message)`. */
  static debug(stack: Stack, pkg: Package, message: string): Promise<void> {
    return Logger.log(stack, "debug", pkg, message);
  }

  /** Shorthand for `Logger.log(stack, "info", pkg, message)`. */
  static info(stack: Stack, pkg: Package, message: string): Promise<void> {
    return Logger.log(stack, "info", pkg, message);
  }

  /** Shorthand for `Logger.log(stack, "warn", pkg, message)`. */
  static warn(stack: Stack, pkg: Package, message: string): Promise<void> {
    return Logger.log(stack, "warn", pkg, message);
  }

  /** Shorthand for `Logger.log(stack, "error", pkg, message)`. */
  static error(stack: Stack, pkg: Package, message: string): Promise<void> {
    return Logger.log(stack, "error", pkg, message);
  }

  /** Shorthand for `Logger.log(stack, "fatal", pkg, message)`. */
  static fatal(stack: Stack, pkg: Package, message: string): Promise<void> {
    return Logger.log(stack, "fatal", pkg, message);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Dispatch a {@link LogPayload} to the remote API.
   * Errors are caught and printed to `stderr`; they never propagate.
   *
   * @internal
   */
  private static async _dispatch(payload: LogPayload): Promise<void> {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), _timeoutMs);

    try {
      const response = await fetch(_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${_bearerToken}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        let body = "";
        try {
          body = await response.text();
        } catch {
          body = "<unreadable response body>";
        }

        console.error(
          `[Logger] Remote API returned HTTP ${response.status} (${response.statusText}). ` +
            `Endpoint: ${_endpoint}. Body: ${body}`
        );
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        console.error(
          `[Logger] Request to ${_endpoint} timed out after ${_timeoutMs} ms.`
        );
      } else {
        const message =
          err instanceof Error ? err.message : String(err);
        console.error(
          `[Logger] Failed to send log to ${_endpoint}: ${message}`
        );
      }
    } finally {
      clearTimeout(timerId);
    }
  }

  // -------------------------------------------------------------------------
  // Introspection (useful for tests)
  // -------------------------------------------------------------------------

  /**
   * Returns `true` if {@link Logger.init} has been called with valid credentials.
   *
   * @example
   * ```ts
   * if (!Logger.isInitialised()) {
   *   Logger.init({ bearerToken: process.env.LOGGER_BEARER_TOKEN! });
   * }
   * ```
   */
  static isInitialised(): boolean {
    return _initialised;
  }

  /**
   * Reset logger state. Intended for use in unit-test teardown only.
   * @internal
   */
  static _reset(): void {
    _bearerToken = null;
    _endpoint = DEFAULT_ENDPOINT;
    _timeoutMs = DEFAULT_TIMEOUT_MS;
    _initialised = false;
  }
}

// ---------------------------------------------------------------------------
// Standalone functional API (thin wrapper around Logger)
// ---------------------------------------------------------------------------

/**
 * Functional alternative to the class API.
 * Delegates to {@link Logger.log} — `Logger.init()` must still be called first.
 *
 * @param stack   - Architectural layer.
 * @param level   - Severity level.
 * @param pkg     - Originating module.
 * @param message - Human-readable description of the event.
 *
 * @example
 * ```ts
 * import { log } from "@your-org/logging-middleware";
 * await log("backend", "warn", "cache", "Cache miss rate above threshold");
 * ```
 */
export async function log(
  stack: Stack,
  level: Level,
  pkg: Package,
  message: string
): Promise<void> {
  return Logger.log(stack, level, pkg, message);
}