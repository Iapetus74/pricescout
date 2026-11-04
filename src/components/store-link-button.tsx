import { buttonVariants } from "@/components/ui/button";
import { storeLink } from "@/lib/store-link";
import { cn } from "@/lib/utils";

/** "Visit Takealot ↗": opens the product's page on the store's own site in a new tab. */
export function StoreLinkButton({ url, storeName, className }: { url: string; storeName: string; className?: string }) {
  const href = storeLink(url);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), className)}
      aria-label={`Visit ${storeName} (opens in a new tab)`}
    >
      Visit {storeName} <span aria-hidden="true">↗</span>
    </a>
  );
}
