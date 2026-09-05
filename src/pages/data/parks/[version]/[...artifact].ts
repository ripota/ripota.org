import type { APIRoute, GetStaticPaths } from "astro";
import { displayReferences } from "@ripota/parks/display";
import { parksGeometryVersion, readGeometryArtifact } from "../../../../lib/pota/geometry-assets";

export const getStaticPaths: GetStaticPaths = () => [
  "@ripota/parks/all.geojson",
  ...displayReferences.flatMap(({ artifact }) => artifact ? [artifact] : []),
].map((artifact) => ({
  params: {
    version: parksGeometryVersion,
    artifact: artifact.replace("@ripota/parks/", ""),
  },
  props: { artifact },
}));

export const GET: APIRoute = ({ props }) => new Response(
  readGeometryArtifact(props.artifact),
  { headers: {
    "Content-Type": "application/geo+json",
    "Cache-Control": "public, max-age=31536000, immutable",
  } },
);
