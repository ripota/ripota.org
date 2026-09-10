export type HunterView = {
  status: "all" | "hunted" | "remaining";
  query: string;
};

export function readHunterView(url: URL): HunterView {
  const status = url.searchParams.get("status");
  return {
    status: status === "hunted" || status === "remaining" ? status : "all",
    query: url.searchParams.get("q")?.trim() ?? "",
  };
}

export function writeHunterView(url: URL, view: HunterView): URL {
  const result = new URL(url.href);
  if (view.status === "all") result.searchParams.delete("status");
  else result.searchParams.set("status", view.status);
  const query = view.query.trim();
  if (query) result.searchParams.set("q", query);
  else result.searchParams.delete("q");
  return result;
}
