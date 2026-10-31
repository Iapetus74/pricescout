/**
 * Spots CAPTCHA and bot-check pages, so we stop instead of trying to get
 * past them (CLAUDE.md rule 1). We never solve or work around these.
 */

/** Signs of a bot-check page that we trust even on a normal 200 answer. */
const STRONG_MARKERS = [
  /captcha-delivery\.com/i, // DataDome
  /px-captcha/i, // PerimeterX / HUMAN
  /_Incapsula_Resource/i, // Imperva
  /\/cdn-cgi\/challenge-platform\//i, // Cloudflare
  /cf-chl-/i, // Cloudflare
  /<title>\s*(Just a moment\.\.\.|Attention Required! \| Cloudflare)/i,
  /are you a (human|robot)\??/i,
  /verify (that )?you are (a )?human/i,
];

/** Weaker signs. Normal pages sometimes have a CAPTCHA on a newsletter form,
 *  so these only count when the store also refused the request. */
const WEAK_MARKERS = [/g-recaptcha/i, /h-captcha|hcaptcha\.com/i, /captcha/i];

export function looksLikeCaptcha(status: number, body: string): boolean {
  if (STRONG_MARKERS.some((re) => re.test(body))) return true;
  const refused = status === 403 || status === 429 || status === 503;
  return refused && WEAK_MARKERS.some((re) => re.test(body));
}
