import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12 sm:py-20">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">PriceScout</h1>
        <p className="text-muted-foreground">
          Compare and track prices across South African online stores.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Paste a product link</CardTitle>
          <CardDescription>
            Coming soon: paste a link from a supported store and PriceScout will find the same
            product at other stores.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="url"
              name="url"
              placeholder="https://www.takealot.com/..."
              aria-label="Product link"
              disabled
            />
            <Button type="submit" disabled>
              Find prices
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Setup is complete. Tracked products, watchlists and stores will appear here as they are
        built.
      </p>
    </main>
  );
}
