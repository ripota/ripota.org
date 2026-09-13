import { describe, expect, it, vi } from "vitest";
import { renderOpsMarkdown } from "./ops-markdown";

function render(source: string): string {
  const target = {
    classList: { add: vi.fn() },
    innerHTML: "old content",
  } as unknown as HTMLElement;
  renderOpsMarkdown(target, source);
  expect(target.classList.add).toHaveBeenCalledWith("ops-markdown");
  return target.innerHTML;
}

describe("Ops Room Markdown", () => {
  it("formats text, paragraphs, and chat line breaks", () => {
    expect(render("**Bold** _italic_ ~~old~~ and `code`\nNext line\n\nParagraph")).toBe(
      "<p><strong>Bold</strong> <em>italic</em> <s>old</s> and <code>code</code><br>\nNext line</p>\n<p>Paragraph</p>\n",
    );
  });

  it("formats lists, quotes, and code blocks without parsing Markdown inside code", () => {
    expect(render("- first\n- second\n\n1. ordered\n2. list\n\n> quoted\n\n```js\n**literal** <script>alert(1)</script>\n```")).toBe(
      '<ul>\n<li>first</li>\n<li>second</li>\n</ul>\n<ol>\n<li>ordered</li>\n<li>list</li>\n</ol>\n<blockquote>\n<p>quoted</p>\n</blockquote>\n<pre><code class="language-js">**literal** &lt;script&gt;alert(1)&lt;/script&gt;\n</code></pre>\n',
    );
    expect(render("`https://ripota.org`\n\n    https://ripota.org")).not.toContain("<a ");
  });

  it("links Markdown destinations and plain URLs without trailing punctuation", () => {
    const html = render(
      '[My media](https://ripota.org/activate-ri-2026/media/ "Upload photos")\nhttps://ripota.org/activate-ri-2026/media/.\nwww.ripota.org, http://example.com?a=1&b=2',
    );
    expect(html).toContain('href="https://ripota.org/activate-ri-2026/media/" title="Upload photos"');
    expect(html).toContain('>https://ripota.org/activate-ri-2026/media/</a>.');
    expect(html).toContain('href="http://www.ripota.org"');
    expect(html).toContain('>www.ripota.org</a>,');
    expect(html).toContain('href="http://example.com?a=1&amp;b=2"');
    expect(html.match(/rel="noopener noreferrer nofollow"/g)).toHaveLength(4);
  });

  it("keeps site-relative links and fragment links usable", () => {
    const html = render("[Media](/activate-ri-2026/media/) [Message](#ops-message-123)");
    expect(html).toContain('href="/activate-ri-2026/media/"');
    expect(html).toContain('href="#ops-message-123"');
    expect(html).not.toContain("target=");
  });

  it("escapes raw HTML and link attributes supplied by authors", () => {
    const html = render('<img src=x onerror=alert(1)> <script>alert(1)</script>\n[link](https://ripota.org/ "\\\" onmouseover=\\\"alert(1)")');
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toMatch(/<(?:img|script)\b/);
    expect(html).toContain('title="&quot; onmouseover=&quot;alert(1)"');
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "javascript&#x3a;alert(1)",
    "java&#x09;script:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "file:///etc/passwd",
    "ftp://example.com/file",
  ])("does not create a link for unsafe or unsupported destination %s", (href) => {
    expect(render(`[click](<${href}>)`)).not.toContain("<a ");
  });

  it("retains escaped image descriptions without embedding images", () => {
    const html = render('![**Our park** <img src=x onerror=alert(1)>](https://example.com/tracker.png)');
    expect(html).toBe("<p>Our park &lt;img src=x onerror=alert(1)&gt;</p>\n");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("tracker.png");
  });

  it("preserves plain messages and escaped Markdown syntax", () => {
    expect(render("N1RWJ on 14.062 MHz & ready.\\*literal\\*"))
      .toBe("<p>N1RWJ on 14.062 MHz &amp; ready.*literal*</p>\n");
    expect(render("")).toBe("");
  });
});
