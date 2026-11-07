import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Fold, Markdown } from "../src/markdown";

afterEach(cleanup);

const md = (text: string) => render(<Markdown text={text} />).container;

describe("Markdown", () => {
  it("renders bold, italic, inline code and links as elements, never raw symbols", () => {
    const c = md(
      "The **review** found *one* real `--l2` problem, see [the PR](https://github.com/x/y/pull/1).",
    );
    expect(c.querySelector("strong")?.textContent).toBe("review");
    expect(c.querySelector("em")?.textContent).toBe("one");
    expect(c.querySelector("code")?.textContent).toBe("--l2");
    const a = c.querySelector("a") as HTMLAnchorElement;
    expect(a.textContent).toBe("the PR");
    expect(a.getAttribute("href")).toBe("https://github.com/x/y/pull/1");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(c.textContent).not.toMatch(/\*|`|\]\(/);
  });

  it("keeps symbols inside inline code literal", () => {
    const c = md("Run `a **b** c` now");
    expect(c.querySelector("code")?.textContent).toBe("a **b** c");
    expect(c.querySelector("strong")).toBeNull();
  });

  it("never links an unsafe address", () => {
    const c = md("[click](javascript:alert(1))");
    expect(c.querySelector("a")).toBeNull();
    expect(c.textContent).toContain("click");
  });

  it("links a bare web address", () => {
    const c = md("Preview at https://murmur.dev/s/1.");
    expect(c.querySelector("a")?.getAttribute("href")).toBe(
      "https://murmur.dev/s/1",
    );
  });

  it("renders headings below the page heading level", () => {
    md("# Report\n\n## Summary\n\nText");
    expect(screen.getByRole("heading", { name: "Report" }).tagName).toBe("H3");
    expect(screen.getByRole("heading", { name: "Summary" }).tagName).toBe("H4");
  });

  it("renders lists, nested lists and ordered lists", () => {
    const c = md(
      "Concerns:\n- Opacity steps won't work\n  - their alpha is baked in\n- One test fails\n\n1. First\n2. Second",
    );
    const lists = c.querySelectorAll("ul");
    expect(lists.length).toBe(2);
    expect(c.querySelector("ul > li > ul > li")?.textContent).toBe(
      "their alpha is baked in",
    );
    expect(
      [...c.querySelectorAll("ol > li")].map((l) => l.textContent),
    ).toEqual(["First", "Second"]);
    expect(c.textContent).not.toContain("- ");
  });

  it("renders fenced code blocks as code, untouched", () => {
    const c = md("Before\n\n```ts\nconst a = **1**;\n```\n\nAfter");
    expect(c.querySelector("pre code")?.textContent).toBe("const a = **1**;");
    expect(c.querySelectorAll("p").length).toBe(2);
  });

  it("renders a table", () => {
    const c = md("| File | Lines |\n|---|---:|\n| a.css | 12 |\n| b.ts | 3 |");
    expect([...c.querySelectorAll("th")].map((t) => t.textContent)).toEqual([
      "File",
      "Lines",
    ]);
    expect(c.querySelectorAll("tbody tr").length).toBe(2);
    expect(c.textContent).not.toContain("|");
  });

  it("keeps a single line break inside a paragraph", () => {
    const c = md("Status: DONE\nCommit: abc1234");
    expect(c.querySelectorAll("p").length).toBe(1);
    expect(c.querySelector("p br")).toBeTruthy();
  });

  it("renders a quote", () => {
    const c = md("> Keep the **map**");
    expect(c.querySelector("blockquote strong")?.textContent).toBe("map");
  });
});

describe("Fold", () => {
  it("folds a long text after 4 lines with Show more", async () => {
    const long = Array.from({ length: 8 }, (_, i) => `Line ${i + 1}`).join(
      "\n\n",
    );
    const { container } = render(<Fold text={long} />);
    const btn = screen.getByRole("button", { name: "Show more" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".fold-body.folded")).toBeTruthy();
    await userEvent.click(btn);
    expect(btn.textContent).toBe("Show less");
    expect(container.querySelector(".fold-body.folded")).toBeNull();
  });

  it("leaves a short text alone", () => {
    render(<Fold text="Task 1 is done." />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
