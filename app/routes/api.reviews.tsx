import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const ADMIN_EMAIL = "etienne.amigo@icloud.com";

// GET /api/reviews?productId=gid://shopify/Product/123&shop=myshop.myshopify.com
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  const shop = session?.shop || url.searchParams.get("shop") || "";

  if (!productId) {
    return Response.json({ error: "productId is required" }, { status: 400 });
  }

  const reviews = await db.review.findMany({
    where: {
      productId,
      shopDomain: shop,
      status: "APPROVED",
    },
    orderBy: [
      { pinned: "desc" },
      { createdAt: "desc" },
    ],
    select: {
      id: true,
      rating: true,
      title: true,
      body: true,
      authorName: true,
      verifiedPurchase: true,
      pinned: true,
      isAdmin: true,
      createdAt: true,
    },
  });

  // Compute average rating
  const stats = await db.review.aggregate({
    where: {
      productId,
      shopDomain: shop,
      status: "APPROVED",
    },
    _avg: { rating: true },
    _count: { id: true },
  });

  return Response.json({
    reviews,
    averageRating: stats._avg.rating || 0,
    totalCount: stats._count.id,
  });
};

// POST /api/reviews - Submit a new review
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.public.appProxy(request);
  const shop = session?.shop || "";

  const body = await request.formData();
  const productId = body.get("productId") as string;
  const rating = parseInt(body.get("rating") as string, 10);
  const title = (body.get("title") as string) || null;
  const reviewBody = body.get("body") as string;
  const authorName = body.get("authorName") as string;
  const authorEmail = body.get("authorEmail") as string;
  const customerGid = body.get("customerId") as string | null;

  // Server-side validation
  if (!productId || !reviewBody || !authorName || !authorEmail) {
    return Response.json(
      { error: "Missing required fields: productId, body, authorName, authorEmail" },
      { status: 400 },
    );
  }

  if (!rating || rating < 1 || rating > 5) {
    return Response.json(
      { error: "Rating must be between 1 and 5" },
      { status: 400 },
    );
  }

  if (reviewBody.length < 10 || reviewBody.length > 5000) {
    return Response.json(
      { error: "Review body must be between 10 and 5000 characters" },
      { status: 400 },
    );
  }

  const isAdminAccount = authorEmail.toLowerCase() === ADMIN_EMAIL;

  // Check 1 review per customer per product (skip for admin)
  if (customerGid && !isAdminAccount) {
    const existingReview = await db.review.findUnique({
      where: {
        customerId_productId: {
          customerId: customerGid,
          productId,
        },
      },
    });

    if (existingReview) {
      return Response.json(
        { error: "You have already reviewed this product" },
        { status: 409 },
      );
    }
  }

  // Check purchase verification (skip for admin)
  let verifiedPurchase = false;
  if (customerGid) {
    if (isAdminAccount) {
      verifiedPurchase = true;
    } else {
      const purchase = await db.orderItem.findFirst({
        where: {
          product: { id: productId },
          order: { customerId: customerGid },
        },
      });
      verifiedPurchase = !!purchase;

      // Non-admin must have purchased the product
      if (!verifiedPurchase) {
        return Response.json(
          { error: "You must purchase this product before reviewing it" },
          { status: 403 },
        );
      }
    }
  }

  // Admin gets instant approval, others go to pending
  const status = isAdminAccount ? "APPROVED" : "PENDING";

  const review = await db.review.create({
    data: {
      shopDomain: shop,
      productId,
      customerId: customerGid || null,
      rating,
      title,
      body: reviewBody,
      authorName,
      authorEmail: authorEmail.toLowerCase(),
      status,
      verifiedPurchase,
      isAdmin: isAdminAccount,
    },
  });

  return Response.json({ review, status });
};
