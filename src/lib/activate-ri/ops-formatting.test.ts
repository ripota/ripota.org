import { describe, expect, it } from "vitest";
import { formatOpsText } from "./ops-formatting";

describe("chat composer formatting", () => {
  it.each([
    ["bold", "**open**", 2, 6],
    ["italic", "*open*", 1, 5],
    ["code", "`open`", 1, 5],
  ] as const)("wraps a selected word with %s while preserving the surrounding message", (format, formatted, offsetStart, offsetEnd) => {
    expect(formatOpsText("The gate is open today.", 12, 16, format)).toEqual({
      value: `The gate is ${formatted} today.`, selectionStart: 12 + offsetStart, selectionEnd: 12 + offsetEnd,
    });
  });

  it("inserts and selects placeholder text at an empty caret", () => {
    expect(formatOpsText("Ready: ", 7, 7, "bold")).toEqual({
      value: "Ready: **bold text**", selectionStart: 9, selectionEnd: 18,
    });
  });

  it.each([
    ["bold", "**", 2],
    ["italic", "*", 1],
  ] as const)("keeps selected edge whitespace outside %s delimiters", (format, marker, markerLength) => {
    expect(formatOpsText("gate open ", 5, 10, format)).toEqual({
      value: `gate ${marker}open${marker} `,
      selectionStart: 5 + markerLength,
      selectionEnd: 9 + markerLength,
    });
    expect(formatOpsText("Gate: \topen\n next", 5, 13, format)).toEqual({
      value: `Gate: \t${marker}open${marker}\n next`,
      selectionStart: 7 + markerLength,
      selectionEnd: 11 + markerLength,
    });
  });

  it("preserves a whitespace-only selection once and selects an emphasis placeholder", () => {
    expect(formatOpsText("Go:  ", 3, 5, "bold")).toEqual({
      value: "Go:  **bold text**", selectionStart: 7, selectionEnd: 16,
    });
  });

  it("selects a new link destination after wrapping its label", () => {
    expect(formatOpsText("See the map", 8, 11, "link")).toEqual({
      value: "See the [map](https://)", selectionStart: 14, selectionEnd: 22,
    });
  });

  it("uses a selected web address as a link destination and selects the new label", () => {
    const url = "https://ripota.org/activate-ri-2026/media/";
    expect(formatOpsText(url, 0, url.length, "link")).toEqual({
      value: `[link text](${url})`, selectionStart: 1, selectionEnd: 10,
    });
  });

  it("formats whole selected lines without including the line after a trailing newline", () => {
    expect(formatOpsText("Before\nGate open\nPath clear\nAfter", 9, 28, "list")).toEqual({
      value: "Before\n- Gate open\n- Path clear\nAfter", selectionStart: 9, selectionEnd: 31,
    });
  });

  it("toggles prefixes off lines that are already quoted", () => {
    expect(formatOpsText("> Gate open\n> Path clear", 3, 22, "quote")).toEqual({
      value: "Gate open\nPath clear", selectionStart: 0, selectionEnd: 20,
    });
  });

  it("can begin a list on an empty first line", () => {
    expect(formatOpsText("\nNext line", 0, 0, "list")).toEqual({
      value: "- \nNext line", selectionStart: 2, selectionEnd: 2,
    });
  });

  it("uses fences for multiple lines of code", () => {
    expect(formatOpsText("CQ\nPOTA", 0, 7, "code")).toEqual({
      value: "```\nCQ\nPOTA\n```", selectionStart: 4, selectionEnd: 11,
    });
  });

  it("escapes backticks within an inline code selection", () => {
    expect(formatOpsText("`CQ`", 0, 4, "code")).toEqual({
      value: "`` `CQ` ``", selectionStart: 3, selectionEnd: 7,
    });
  });

  it("puts multiline code fences on their own lines within a message", () => {
    expect(formatOpsText("Call CQ\nPOTA today", 5, 12, "code")).toEqual({
      value: "Call \n```\nCQ\nPOTA\n```\n today", selectionStart: 10, selectionEnd: 17,
    });
  });

  it("rejects formatting that would exceed the message limit without truncating the draft", () => {
    expect(formatOpsText("a".repeat(1000), 0, 1000, "bold", 1000)).toBeNull();
    expect(formatOpsText("a".repeat(996), 0, 996, "bold", 1000)?.value).toHaveLength(1000);
  });
});
