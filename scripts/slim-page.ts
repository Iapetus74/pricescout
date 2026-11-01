/**
 * Makes saved HTML pages small enough for the repository: empties ordinary
 * <script>, <style> and <svg> tags, but keeps JSON-LD blocks and the rest of
 * the page exactly as the store sent it.
 */
export function slimPage(html: string): string {
  return html
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (whole, attrs: string) =>
      /application\/ld\+json/i.test(attrs) ? whole : `<script${attrs}></script>`,
    )
    .replace(/<style\b([^>]*)>[\s\S]*?<\/style\s*>/gi, "<style$1></style>")
    .replace(/<svg\b([^>]*)>[\s\S]*?<\/svg\s*>/gi, "<svg$1></svg>");
}
