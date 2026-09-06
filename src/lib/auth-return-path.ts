export function safeLocalReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") ||
    value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return null;

  try {
    const url = new URL(value, "https://return-path.invalid");
    if (url.origin !== "https://return-path.invalid" || url.pathname.startsWith("//")) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
