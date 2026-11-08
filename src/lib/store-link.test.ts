import { describe, expect, it } from "vitest";

import { storeLink } from "./store-link";

describe("storeLink", () => {
  it("keeps normal store addresses", () => {
    expect(storeLink("https://www.takealot.com/some-product/PLID123")).toBe("https://www.takealot.com/some-product/PLID123");
    expect(storeLink("http://example.co.za/p/1")).toBe("http://example.co.za/p/1");
  });

  it("refuses anything that isn't a web page address", () => {
    expect(storeLink("javascript:alert(1)")).toBeNull();
    expect(storeLink("data:text/html,hi")).toBeNull();
    expect(storeLink("not a link")).toBeNull();
    expect(storeLink("")).toBeNull();
    expect(storeLink(null)).toBeNull();
  });
});
