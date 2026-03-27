import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const ADMIN_EMAIL = "etienne.amigo@icloud.com";

// GET /api/reviews/check-eligibility?productId=...&customerEmail=...&customerId=...&shop=...
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  const customerEmail = url.searchParams.get("customerEmail");
  const customerId = url.searchParams.get("customerId");
  const shop = session?.shop || url.searchParams.get("shop") || "";

  if (!productId || !customerEmail) {
    return Response.json({ eligible: false, reason: "missing_params" });
  }

  const isAdmin = customerEmail.toLowerCase() === ADMIN_EMAIL;

  // Admin can always post
  if (isAdmin) {
    return Response.json({
      eligible: true,
      isAdmin: true,
      hasPurchased: true,
      hasReviewed: false,
    });
  }

  // Check if customer has purchased this product
  let hasPurchased = false;
  if (customerId) {
    const purchase = await db.orderItem.findFirst({
      where: {
        product: { id: productId },
        order: { customerId: customerId },
      },
    });
    hasPurchased = !!purchase;
  }

  // Check if already reviewed
  let hasReviewed = false;
  if (customerId) {
    const existing = await db.review.findUnique({
      where: {
        customerId_productId: {
          customerId,
          productId,
        },
      },
    });
    hasReviewed = !!existing;
  }

  return Response.json({
    eligible: hasPurchased && !hasReviewed,
    isAdmin: false,
    hasPurchased,
    hasReviewed,
  });
};
