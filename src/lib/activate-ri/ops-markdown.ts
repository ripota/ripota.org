import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
}).disable(["heading", "lheading", "table", "hr"]);

markdown.linkify.set({ fuzzyLink: true });

// Limit authored links to web/email destinations, including relative site URLs.
// URL uses the same scheme normalization as the browser for obfuscated inputs.
markdown.validateLink = (href) => {
  if (/[\u0000-\u001f\u007f]|%(?:0[\da-f]|1[\da-f]|7f)/i.test(href)) return false;
  try {
    const { protocol } = new URL(href, "https://chat.invalid/");
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:";
  } catch {
    return false;
  }
};

markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrSet("rel", "noopener noreferrer nofollow");
  return renderer.renderToken(tokens, index, options);
};

// Chat does not embed remote images: retain their descriptions without loading
// external resources, and escape the description as text rather than HTML.
markdown.renderer.rules.image = (tokens, index, options, env, renderer) =>
  markdown.utils.escapeHtml(
    renderer.renderInlineAsText(tokens[index].children ?? [], options, env),
  );

/** Render the supported chat Markdown subset into a message or preview. */
export function renderOpsMarkdown(target: HTMLElement, source: string): void {
  target.classList.add("ops-markdown");
  // Only this configured parser's output may reach this sink. Raw HTML is
  // disabled, URLs are validated, and all text/attributes are escaped by it.
  target.innerHTML = markdown.render(source);
}
