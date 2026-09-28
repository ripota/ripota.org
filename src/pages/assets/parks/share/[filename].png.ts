import type { APIRoute, GetStaticPaths } from "astro";
import { getParkShareCards, type ParkShareCard } from "../../../../lib/parks/share-cards";

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () =>
  (await getParkShareCards()).map(card => ({ params: { filename: card.filename }, props: { card } }));

export const GET: APIRoute = ({ props }) => {
  const card = props.card as ParkShareCard;
  return new Response(card.data, {
    headers: { "Content-Type": card.type, "Cache-Control": "public, max-age=31536000, immutable" },
  });
};
