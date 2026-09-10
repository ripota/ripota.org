export type SpotActivityView = {
  view: "all" | "spotted" | "unspotted";
  query: string;
};

export function readSpotActivityView(url: URL): SpotActivityView {
  const view = url.searchParams.get("view");
  return {
    view: view === "all" || view === "unspotted" ? view : "spotted",
    query: url.searchParams.get("q")?.trim() ?? "",
  };
}

export function writeSpotActivityView(url: URL, view: SpotActivityView): URL {
  const result = new URL(url.href);
  if (view.view === "spotted") result.searchParams.delete("view");
  else result.searchParams.set("view", view.view);
  const query = view.query.trim();
  if (query) result.searchParams.set("q", query);
  else result.searchParams.delete("q");
  return result;
}
