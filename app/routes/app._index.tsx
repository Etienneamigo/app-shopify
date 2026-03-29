import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [totalReviews, pendingCount, approvedCount, avgRating, recentReviews] =
    await Promise.all([
      db.review.count({ where: { shopDomain: shop } }),
      db.review.count({ where: { shopDomain: shop, status: "PENDING" } }),
      db.review.count({ where: { shopDomain: shop, status: "APPROVED" } }),
      db.review.aggregate({
        where: { shopDomain: shop, status: "APPROVED" },
        _avg: { rating: true },
      }),
      db.review.findMany({
        where: { shopDomain: shop },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          product: { select: { title: true } },
        },
      }),
    ]);

  return {
    totalReviews,
    pendingCount,
    approvedCount,
    averageRating: avgRating._avg.rating || 0,
    recentReviews: recentReviews.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
};

export default function Index() {
  const {
    totalReviews,
    pendingCount,
    approvedCount,
    averageRating,
    recentReviews,
  } = useLoaderData<typeof loader>();

  const statCard = (label: string, value: string | number, color: string) => (
    <div
      style={{
        padding: "20px",
        borderRadius: "12px",
        border: "1px solid #e5e5e5",
        background: "#fff",
        flex: "1",
        minWidth: "140px",
      }}
    >
      <div style={{ fontSize: "13px", color: "#666", marginBottom: "4px" }}>
        {label}
      </div>
      <div style={{ fontSize: "28px", fontWeight: 700, color }}>{value}</div>
    </div>
  );

  return (
    <s-page heading="Reviews Dashboard">
      <s-button slot="primary-action" href="/app/reviews">
        Manage reviews
      </s-button>

      <s-section heading="Overview">
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {statCard("Total Reviews", totalReviews, "#333")}
          {statCard("Pending", pendingCount, "#FFC107")}
          {statCard("Approved", approvedCount, "#4CAF50")}
          {statCard(
            "Avg Rating",
            averageRating ? `${averageRating.toFixed(1)} / 5` : "N/A",
            "#f59e0b",
          )}
        </div>
      </s-section>

      {pendingCount > 0 && (
        <s-section heading="Action Required">
          <s-banner tone="warning">
            You have {pendingCount} review{pendingCount > 1 ? "s" : ""} waiting
            for approval.{" "}
            <s-link href="/app/reviews?status=PENDING">
              Review them now
            </s-link>
          </s-banner>
        </s-section>
      )}

      <s-section heading="Recent Reviews">
        {recentReviews.length === 0 ? (
          <s-paragraph>No reviews yet. Reviews will appear here once customers start submitting them.</s-paragraph>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {recentReviews.map((review: any) => (
              <div
                key={review.id}
                style={{
                  padding: "12px 16px",
                  border: "1px solid #eee",
                  borderRadius: "8px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {"★".repeat(review.rating)}
                    {"☆".repeat(5 - review.rating)}{" "}
                    <span style={{ color: "#666", fontWeight: 400 }}>
                      by {review.authorName}
                    </span>
                  </div>
                  <div style={{ fontSize: "13px", color: "#888" }}>
                    {review.product?.title} -{" "}
                    {new Date(review.createdAt).toLocaleDateString("fr-FR")}
                  </div>
                </div>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#fff",
                    background:
                      review.status === "APPROVED"
                        ? "#4CAF50"
                        : review.status === "PENDING"
                          ? "#FFC107"
                          : "#F44336",
                  }}
                >
                  {review.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
