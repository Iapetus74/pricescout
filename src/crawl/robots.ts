/**
 * robots.txt reading and checking (CLAUDE.md rule 1, SPEC.md section 4.4).
 *
 * Follows the robots.txt standard (RFC 9309):
 * - Rules in a group for "PriceScout" win; otherwise the "*" group applies.
 * - The longest matching rule wins. If an Allow and a Disallow are equally
 *   long, Allow wins.
 * - "*" matches any characters and "$" marks the end of the address.
 * - No robots.txt (404 and other 4xx) means everything is allowed.
 * - A robots.txt we can't read (5xx, 429, no answer) means nothing is
 *   allowed, to be safe.
 */
import { ROBOTS_TOKEN } from "./user-agent";

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

export interface RobotsRules {
  /** True if the path (with its ?query) may be fetched. */
  isAllowed(pathAndQuery: string): boolean;
  /** Crawl-delay for our group, in seconds, if the site gives one. */
  crawlDelaySeconds?: number;
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`);
}

/** Makes percent-encoding comparable: "%7e" and "~" are treated the same. */
function normalisePath(path: string): string {
  return path.replace(/%[0-9a-fA-F]{2}/g, (code) => {
    const char = String.fromCharCode(parseInt(code.slice(1), 16));
    return /[A-Za-z0-9\-._~]/.test(char) ? char : code.toUpperCase();
  });
}

class ParsedRobots implements RobotsRules {
  constructor(
    private readonly rules: Rule[],
    readonly crawlDelaySeconds?: number,
  ) {}

  isAllowed(pathAndQuery: string): boolean {
    const path = normalisePath(pathAndQuery || "/");
    if (path === "/robots.txt") return true;
    let best: Rule | undefined;
    for (const rule of this.rules) {
      if (!rule.regex.test(path)) continue;
      if (
        !best ||
        rule.pattern.length > best.pattern.length ||
        (rule.pattern.length === best.pattern.length && rule.allow)
      ) {
        best = rule;
      }
    }
    return best ? best.allow : true;
  }
}

/** Everything allowed (no robots.txt). */
export const ALLOW_ALL: RobotsRules = { isAllowed: () => true };
/** Nothing allowed (robots.txt couldn't be read). */
export const DISALLOW_ALL: RobotsRules = {
  isAllowed: (path) => normalisePath(path) === "/robots.txt",
};

interface Group {
  agents: string[];
  rules: Rule[];
  crawlDelay?: number;
}

/** Reads a robots.txt file and returns the rules that apply to PriceScout. */
export function parseRobotsTxt(text: string, token: string = ROBOTS_TOKEN): RobotsRules {
  const groups: Group[] = [];
  let current: Group | undefined;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue; // rules before any user-agent line are ignored

    if (field === "allow" || field === "disallow") {
      if (value === "") continue; // "Disallow:" with nothing means allow everything
      const pattern = normalisePath(value.startsWith("/") || value.startsWith("*") ? value : `/${value}`);
      current.rules.push({ allow: field === "allow", pattern, regex: patternToRegex(pattern) });
    } else if (field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) current.crawlDelay = seconds;
    }
  }

  const ours = token.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a.split("/")[0].trim() === ours));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  if (chosen.length === 0) return ALLOW_ALL;

  const rules = chosen.flatMap((g) => g.rules);
  const delays = chosen.map((g) => g.crawlDelay).filter((d): d is number => d !== undefined);
  return new ParsedRobots(rules, delays.length > 0 ? Math.max(...delays) : undefined);
}

/** What happened when robots.txt was requested. `null` means no answer at all. */
export type RobotsResponse = { status: number; body: string } | null;

/** Turns the robots.txt response into rules, following RFC 9309. */
export function rulesFromResponse(response: RobotsResponse): RobotsRules {
  if (!response) return DISALLOW_ALL;
  const { status, body } = response;
  if (status >= 200 && status < 300) return parseRobotsTxt(body);
  if (status === 429) return DISALLOW_ALL;
  if (status >= 400 && status < 500) return ALLOW_ALL;
  return DISALLOW_ALL;
}

export interface RobotsCheckerOptions {
  /** Downloads robots.txt for an origin such as "https://www.takealot.com". */
  fetchRobots: (origin: string) => Promise<RobotsResponse>;
  /** How long a robots.txt is trusted. Default 24 hours. */
  ttlMs?: number;
  /** How long to wait before re-checking a robots.txt that failed to load. Default 1 hour. */
  errorTtlMs?: number;
  now?: () => number;
}

/** Remembers each site's robots.txt and answers "may we fetch this URL?". */
export class RobotsChecker {
  private readonly cache = new Map<string, { rules: RobotsRules; expires: number }>();
  private readonly inFlight = new Map<string, Promise<RobotsRules>>();
  private readonly ttlMs: number;
  private readonly errorTtlMs: number;
  private readonly now: () => number;

  constructor(private readonly options: RobotsCheckerOptions) {
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.errorTtlMs = options.errorTtlMs ?? 60 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  async rulesFor(url: URL): Promise<RobotsRules> {
    const origin = url.origin;
    const cached = this.cache.get(origin);
    if (cached && cached.expires > this.now()) return cached.rules;

    let pending = this.inFlight.get(origin);
    if (!pending) {
      pending = this.load(origin).finally(() => this.inFlight.delete(origin));
      this.inFlight.set(origin, pending);
    }
    return pending;
  }

  async isAllowed(url: URL): Promise<boolean> {
    const rules = await this.rulesFor(url);
    return rules.isAllowed(url.pathname + url.search);
  }

  private async load(origin: string): Promise<RobotsRules> {
    let response: RobotsResponse;
    try {
      response = await this.options.fetchRobots(origin);
    } catch {
      response = null;
    }
    const rules = rulesFromResponse(response);
    const ok = response !== null && response.status < 500 && response.status !== 429;
    this.cache.set(origin, { rules, expires: this.now() + (ok ? this.ttlMs : this.errorTtlMs) });
    return rules;
  }
}
