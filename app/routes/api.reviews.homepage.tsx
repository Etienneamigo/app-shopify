import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// GET /api/reviews/homepage?shop=myshop.myshopify.com&limit=20
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = session?.shop || url.searchParams.get("shop") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 50);

  // Get approved reviews, prioritize pinned, then random
  const reviews = await db.review.findMany({
    where: {
      shopDomain: shop,
      status: "APPROVED",
    },
    orderBy: [
      { pinned: "desc" },
      { createdAt: "desc" },
    ],
    take: limit,
    select: {
      id: true,
      rating: true,
      title: true,
      body: true,
      authorName: true,
      verifiedPurchase: true,
      pinned: true,
      createdAt: true,
      product: {
        select: {
          title: true,
          handle: true,
        },
      },
    },
  });

  // Shuffle non-pinned reviews for variety
  const pinned = reviews.filter((r) => r.pinned);
  const unpinned = reviews.filter((r) => !r.pinned);
  for (let i = unpinned.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unpinned[i], unpinned[j]] = [unpinned[j], unpinned[i]];
  }

  return Response.json({
    reviews: [...pinned, ...unpinned],
  });
};
