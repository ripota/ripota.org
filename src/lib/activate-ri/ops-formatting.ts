export type OpsTextFormat = "bold" | "italic" | "code" | "link" | "list" | "quote";

export interface OpsFormattedText {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Insert Markdown while keeping the useful part of the result selected for editing. */
export function formatOpsText(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  format: OpsTextFormat,
  maxLength = -1,
): OpsFormattedText | null {
  const start = Math.max(0, Math.min(value.length, selectionStart));
  const end = Math.max(start, Math.min(value.length, selectionEnd));
  const selected = value.slice(start, end);
  let replacementStart = start;
  let replacementEnd = end;
  let replacement: string;
  let innerStart: number;
  let innerEnd: number;

  if (format === "list" || format === "quote") {
    replacementStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
    const lastSelected = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const lineEnd = value.indexOf("\n", lastSelected);
    replacementEnd = lineEnd < 0 ? value.length : lineEnd;
    const prefix = format === "list" ? "- " : "> ";
    const lines = value.slice(replacementStart, replacementEnd).split("\n");
    const remove = lines.every((line) => line.startsWith(prefix));
    replacement = lines.map((line) => remove ? line.slice(prefix.length) : `${prefix}${line}`).join("\n");
    innerStart = remove ? 0 : prefix.length;
    innerEnd = replacement.length;
  } else if (format === "link") {
    const isUrl = /^https?:\/\/\S+$/i.test(selected);
    const label = selected && !isUrl ? selected : "link text";
    const url = isUrl ? selected : "https://";
    replacement = `[${label}](${url})`;
    innerStart = selected && !isUrl ? label.length + 3 : 1;
    innerEnd = innerStart + (selected && !isUrl ? url.length : label.length);
  } else {
    let marker = format === "bold" ? "**" : format === "italic" ? "*" : "`";
    if (format === "code") {
      const longestRun = Math.max(0, ...[...selected.matchAll(/`+/g)].map((match) => match[0].length));
      marker = "`".repeat(Math.max(selected.includes("\n") ? 3 : 1, longestRun + 1));
    }
    const multiline = format === "code" && selected.includes("\n");
    const padding = format === "code" && !multiline && /^`|`$/.test(selected) ? " " : "";
    const before = multiline ? `${start > 0 && value[start - 1] !== "\n" ? "\n" : ""}${marker}\n` : `${marker}${padding}`;
    const after = multiline ? `\n${marker}${end < value.length && value[end] !== "\n" ? "\n" : ""}` : `${padding}${marker}`;
    // Emphasis delimiters must touch text. Preserve selection-edge whitespace
    // outside them so selecting a word with its trailing space still formats it.
    const emphasis = format === "bold" || format === "italic";
    const leading = emphasis ? selected.match(/^\s*/)?.[0] ?? "" : "";
    const trailing = emphasis && selected.trim() ? selected.match(/\s*$/)?.[0] ?? "" : "";
    const text = (emphasis ? selected.trim() : selected) || (format === "code" ? "code" : `${format} text`);
    replacement = `${leading}${before}${text}${after}${trailing}`;
    innerStart = leading.length + before.length;
    innerEnd = innerStart + text.length;
  }

  const nextValue = value.slice(0, replacementStart) + replacement + value.slice(replacementEnd);
  if (maxLength >= 0 && nextValue.length > maxLength) return null;
  return {
    value: nextValue,
    selectionStart: replacementStart + innerStart,
    selectionEnd: replacementStart + innerEnd,
  };
}
