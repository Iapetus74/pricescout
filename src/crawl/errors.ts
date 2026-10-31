/**
 * Errors the polite fetcher throws. Each one says, in plain words, why a
 * page was not fetched, so the worker and the UI can show the right store
 * status instead of a stack trace.
 */

/** Base class, so callers can catch every fetcher error at once. */
export class CrawlError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** robots.txt says we may not fetch this path. The page was not requested. */
export class NotAllowedByRobotsError extends CrawlError {}

/** The store is Paused after repeated blocks or a CAPTCHA. Nothing was requested. */
export class StorePausedError extends CrawlError {}

/** The store recently answered 429/503/403, so we are waiting before trying again. */
export class StoreBackingOffError extends CrawlError {
  constructor(
    message: string,
    url: string,
    readonly retryAt: Date,
  ) {
    super(message, url);
  }
}

/** The store answered with a block (429, 503 or 403). */
export class BlockedError extends CrawlError {
  constructor(
    message: string,
    url: string,
    readonly status: number,
  ) {
    super(message, url);
  }
}

/** The store showed a CAPTCHA or bot-check page. We never try to solve these. */
export class CaptchaError extends CrawlError {}

/** Any other unsuccessful answer, such as 404 for a removed product. */
export class HttpError extends CrawlError {
  constructor(
    message: string,
    url: string,
    readonly status: number,
  ) {
    super(message, url);
  }
}

/** The request never got an answer (no internet, timeout, bad address). */
export class NetworkError extends CrawlError {}
