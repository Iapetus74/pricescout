import { describe, expect, it } from "vitest";

import { looksLikeCaptcha } from "./captcha";

describe("looksLikeCaptcha", () => {
  it("spots a Cloudflare challenge page", () => {
    expect(looksLikeCaptcha(200, "<html><title>Just a moment...</title></html>")).toBe(true);
    expect(looksLikeCaptcha(403, '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script>')).toBe(true);
  });

  it("spots a reCAPTCHA on a refused request", () => {
    expect(looksLikeCaptcha(403, '<div class="g-recaptcha" data-sitekey="x"></div>')).toBe(true);
  });

  it("does not flag a normal page that has a CAPTCHA on its newsletter form", () => {
    expect(looksLikeCaptcha(200, '<h1>Tent</h1><form><div class="g-recaptcha"></div></form>')).toBe(false);
  });

  it("does not flag a plain 503", () => {
    expect(looksLikeCaptcha(503, "Service temporarily unavailable")).toBe(false);
  });
});
