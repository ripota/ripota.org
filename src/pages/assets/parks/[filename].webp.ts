import type { APIRoute, GetStaticPaths } from "astro";
import { getParkImageAssets, type ParkImageAsset } from "../../../lib/parks/images";

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () =>
  (await getParkImageAssets()).map((asset) => ({
    params: { filename: asset.filename },
    props: { asset },
  }));

export const GET: APIRoute = ({ props }) => {
  const asset = props.asset as ParkImageAsset;
  return new Response(asset.data, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
