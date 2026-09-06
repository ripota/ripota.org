import type { PublicParkPotaStatus } from "./pota-status-client";

export type ProgressView = {
  status: "all" | PublicParkPotaStatus["status"];
  query: string;
};

export function readProgressView(url: URL): ProgressView {
  const status = url.searchParams.get("progress-status");
  return {
    status: status === "confirmed" || status === "observed" || status === "scheduled" || status === "needed"
      ? status : "all",
    query: url.searchParams.get("progress-q")?.trim() ?? "",
  };
}

export function writeProgressView(url: URL, view: ProgressView): URL {
  const result = new URL(url.href);
  if (view.status === "all") result.searchParams.delete("progress-status");
  else result.searchParams.set("progress-status", view.status);
  const query = view.query.trim();
  if (query) result.searchParams.set("progress-q", query);
  else result.searchParams.delete("progress-q");
  return result;
}
