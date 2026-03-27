import { useState, useCallback, useEffect } from "react";
import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  HeadersFunction,
} from "react-router";
import { useLoaderData, useFetcher, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import type { ReviewStatus } from "@prisma/client";

const PAGE_SIZE = 20;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const status = url.searchParams.get("status") as ReviewStatus | "ALL" | null;
  const search = url.searchParams.get("search") || "";
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const pinnedOnly = url.searchParams.get("pinned") === "true";

  const where: any = { shopDomain: shop };
  if (status && status !== "ALL") {
    where.status = status;
  }
  if (pinnedOnly) {
    where.pinned = true;
  }
  if (search) {
    where.OR = [
      { authorName: { contains: search, mode: "insensitive" } },
      { authorEmail: { contains: search, mode: "insensitive" } },
      { body: { contains: search, mode: "insensitive" } },
      { title: { contains: search, mode: "insensitive" } },
    ];
  }

  const [reviews, totalCount, stats] = await Promise.all([
    db.review.findMany({
      where,
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        product: { select: { title: true, handle: true } },
        customer: { select: { email: true, firstName: true, lastName: true } },
      },
    }),
    db.review.count({ where }),
    db.review.groupBy({
      by: ["status"],
      where: { shopDomain: shop },
      _count: { id: true },
    }),
  ]);

  const statusCounts = {
    ALL: 0,
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
  };
  stats.forEach((s) => {
    statusCounts[s.status] = s._count.id;
    statusCounts.ALL += s._count.id;
  });

  // Get products for manual review creation
  const products = await db.product.findMany({
    where: { shopDomain: shop },
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });

  return {
    reviews: reviews.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    totalCount,
    statusCounts,
    products,
    page,
    totalPages: Math.ceil(totalCount / PAGE_SIZE),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  switch (intent) {
    case "approve": {
      const id = formData.get("reviewId") as string;
      await db.review.update({
        where: { id, shopDomain: shop },
        data: { status: "APPROVED" },
      });
      return { success: true, action: "approved" };
    }

    case "reject": {
      const id = formData.get("reviewId") as string;
      await db.review.update({
        where: { id, shopDomain: shop },
        data: { status: "REJECTED" },
      });
      return { success: true, action: "rejected" };
    }

    case "delete": {
      const id = formData.get("reviewId") as string;
      await db.review.delete({
        where: { id, shopDomain: shop },
      });
      return { success: true, action: "deleted" };
    }

    case "pin": {
      const id = formData.get("reviewId") as string;
      const pinned = formData.get("pinned") === "true";
      await db.review.update({
        where: { id, shopDomain: shop },
        data: { pinned },
      });
      return { success: true, action: pinned ? "pinned" : "unpinned" };
    }

    case "edit": {
      const id = formData.get("reviewId") as string;
      const rating = parseInt(formData.get("rating") as string, 10);
      const title = (formData.get("title") as string) || null;
      const body = formData.get("body") as string;
      const authorName = formData.get("authorName") as string;
      const status = formData.get("status") as ReviewStatus;

      if (!body || !authorName || !rating || rating < 1 || rating > 5) {
        return { error: "Invalid fields" };
      }

      await db.review.update({
        where: { id, shopDomain: shop },
        data: { rating, title, body, authorName, status },
      });
      return { success: true, action: "edited" };
    }

    case "create": {
      const productId = formData.get("productId") as string;
      const rating = parseInt(formData.get("rating") as string, 10);
      const title = (formData.get("title") as string) || null;
      const body = formData.get("body") as string;
      const authorName = formData.get("authorName") as string;
      const authorEmail = formData.get("authorEmail") as string;
      const status = (formData.get("status") as ReviewStatus) || "APPROVED";

      if (!productId || !body || !authorName || !authorEmail || !rating) {
        return { error: "Missing required fields" };
      }

      await db.review.create({
        data: {
          shopDomain: shop,
          productId,
          rating,
          title,
          body,
          authorName,
          authorEmail,
          status,
          isAdmin: true,
          verifiedPurchase: false,
        },
      });
      return { success: true, action: "created" };
    }

    default:
      return { error: "Unknown action" };
  }
};

export default function ReviewsPage() {
  const { reviews, totalCount, statusCounts, products, page, totalPages } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editingReview, setEditingReview] = useState<any>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const currentStatus = searchParams.get("status") || "ALL";
  const currentSearch = searchParams.get("search") || "";

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.set("page", "1");
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    if (fetcher.data?.success) {
      setEditingReview(null);
      setShowCreateModal(false);
    }
  }, [fetcher.data]);

  const renderStars = (rating: number) => {
    return "★".repeat(rating) + "☆".repeat(5 - rating);
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PENDING: "#FFC107",
      APPROVED: "#4CAF50",
      REJECTED: "#F44336",
    };
    return (
      <span
        style={{
          padding: "2px 8px",
          borderRadius: "4px",
          fontSize: "12px",
          fontWeight: 600,
          color: "#fff",
          background: colors[status] || "#999",
        }}
      >
        {status}
      </span>
    );
  };

  return (
    <s-page heading="Reviews Management">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => setShowCreateModal(true)}
      >
        Create review
      </s-button>

      {/* Filters */}
      <s-section>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: "4px" }}>
            {(["ALL", "PENDING", "APPROVED", "REJECTED"] as const).map((s) => (
              <button
                key={s}
                onClick={() => updateFilter("status", s === "ALL" ? "" : s)}
                style={{
                  padding: "6px 12px",
                  border: "1px solid #ccc",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "13px",
                  background: currentStatus === s || (s === "ALL" && !currentStatus) ? "#333" : "#fff",
                  color: currentStatus === s || (s === "ALL" && !currentStatus) ? "#fff" : "#333",
                }}
              >
                {s} ({statusCounts[s]})
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search reviews..."
            defaultValue={currentSearch}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                updateFilter("search", (e.target as HTMLInputElement).value);
              }
            }}
            style={{
              padding: "6px 12px",
              border: "1px solid #ccc",
              borderRadius: "6px",
              fontSize: "13px",
              minWidth: "200px",
            }}
          />
        </div>
      </s-section>

      {/* Reviews Table */}
      <s-section>
        {reviews.length === 0 ? (
          <s-paragraph>No reviews found.</s-paragraph>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e5e5e5", textAlign: "left" }}>
                  <th style={{ padding: "8px" }}>Product</th>
                  <th style={{ padding: "8px" }}>Author</th>
                  <th style={{ padding: "8px" }}>Rating</th>
                  <th style={{ padding: "8px" }}>Review</th>
                  <th style={{ padding: "8px" }}>Status</th>
                  <th style={{ padding: "8px" }}>Badges</th>
                  <th style={{ padding: "8px" }}>Date</th>
                  <th style={{ padding: "8px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((review: any) => (
                  <tr
                    key={review.id}
                    style={{
                      borderBottom: "1px solid #eee",
                      background: review.pinned ? "#fffde7" : "transparent",
                    }}
                  >
                    <td style={{ padding: "8px", maxWidth: "150px" }}>
                      <strong>{review.product?.title || "Unknown"}</strong>
                    </td>
                    <td style={{ padding: "8px" }}>
                      <div>{review.authorName}</div>
                      <div style={{ fontSize: "11px", color: "#888" }}>
                        {review.authorEmail}
                      </div>
                    </td>
                    <td style={{ padding: "8px", color: "#f59e0b" }}>
                      {renderStars(review.rating)}
                    </td>
                    <td style={{ padding: "8px", maxWidth: "250px" }}>
                      {review.title && <strong>{review.title}</strong>}
                      <div
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: "250px",
                        }}
                      >
                        {review.body}
                      </div>
                    </td>
                    <td style={{ padding: "8px" }}>{statusBadge(review.status)}</td>
                    <td style={{ padding: "8px" }}>
                      {review.verifiedPurchase && (
                        <span
                          style={{
                            background: "#e3f2fd",
                            color: "#1565c0",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            marginRight: "4px",
                          }}
                        >
                          Verified
                        </span>
                      )}
                      {review.pinned && (
                        <span
                          style={{
                            background: "#fff3e0",
                            color: "#e65100",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "11px",
                          }}
                        >
                          Pinned
                        </span>
                      )}
                      {review.isAdmin && (
                        <span
                          style={{
                            background: "#f3e5f5",
                            color: "#7b1fa2",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            marginLeft: "4px",
                          }}
                        >
                          Admin
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "8px", fontSize: "12px" }}>
                      {new Date(review.createdAt).toLocaleDateString("fr-FR")}
                    </td>
                    <td style={{ padding: "8px" }}>
                      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                        {review.status === "PENDING" && (
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="approve" />
                            <input type="hidden" name="reviewId" value={review.id} />
                            <button
                              type="submit"
                              style={{
                                padding: "4px 8px",
                                fontSize: "12px",
                                border: "1px solid #4CAF50",
                                background: "#4CAF50",
                                color: "#fff",
                                borderRadius: "4px",
                                cursor: "pointer",
                              }}
                            >
                              Approve
                            </button>
                          </fetcher.Form>
                        )}
                        {review.status === "PENDING" && (
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="reject" />
                            <input type="hidden" name="reviewId" value={review.id} />
                            <button
                              type="submit"
                              style={{
                                padding: "4px 8px",
                                fontSize: "12px",
                                border: "1px solid #F44336",
                                background: "#F44336",
                                color: "#fff",
                                borderRadius: "4px",
                                cursor: "pointer",
                              }}
                            >
                              Reject
                            </button>
                          </fetcher.Form>
                        )}
                        <fetcher.Form method="post">
                          <input type="hidden" name="intent" value="pin" />
                          <input type="hidden" name="reviewId" value={review.id} />
                          <input
                            type="hidden"
                            name="pinned"
                            value={review.pinned ? "false" : "true"}
                          />
                          <button
                            type="submit"
                            style={{
                              padding: "4px 8px",
                              fontSize: "12px",
                              border: "1px solid #FF9800",
                              background: review.pinned ? "#FF9800" : "#fff",
                              color: review.pinned ? "#fff" : "#FF9800",
                              borderRadius: "4px",
                              cursor: "pointer",
                            }}
                          >
                            {review.pinned ? "Unpin" : "Pin"}
                          </button>
                        </fetcher.Form>
                        <button
                          onClick={() => setEditingReview(review)}
                          style={{
                            padding: "4px 8px",
                            fontSize: "12px",
                            border: "1px solid #2196F3",
                            background: "#fff",
                            color: "#2196F3",
                            borderRadius: "4px",
                            cursor: "pointer",
                          }}
                        >
                          Edit
                        </button>
                        <fetcher.Form
                          method="post"
                          onSubmit={(e) => {
                            if (!confirm("Delete this review?")) {
                              e.preventDefault();
                            }
                          }}
                        >
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="reviewId" value={review.id} />
                          <button
                            type="submit"
                            style={{
                              padding: "4px 8px",
                              fontSize: "12px",
                              border: "1px solid #F44336",
                              background: "#fff",
                              color: "#F44336",
                              borderRadius: "4px",
                              cursor: "pointer",
                            }}
                          >
                            Delete
                          </button>
                        </fetcher.Form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "8px",
              marginTop: "16px",
            }}
          >
            {page > 1 && (
              <button
                onClick={() => {
                  const params = new URLSearchParams(searchParams);
                  params.set("page", String(page - 1));
                  setSearchParams(params);
                }}
                style={{
                  padding: "6px 12px",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Previous
              </button>
            )}
            <span style={{ padding: "6px 12px" }}>
              Page {page} / {totalPages} ({totalCount} reviews)
            </span>
            {page < totalPages && (
              <button
                onClick={() => {
                  const params = new URLSearchParams(searchParams);
                  params.set("page", String(page + 1));
                  setSearchParams(params);
                }}
                style={{
                  padding: "6px 12px",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Next
              </button>
            )}
          </div>
        )}
      </s-section>

      {/* Edit Modal */}
      {editingReview && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setEditingReview(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "12px",
              padding: "24px",
              width: "500px",
              maxHeight: "80vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 16px" }}>Edit Review</h2>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="edit" />
              <input type="hidden" name="reviewId" value={editingReview.id} />
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <label>
                  Author Name
                  <input
                    name="authorName"
                    defaultValue={editingReview.authorName}
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                    }}
                  />
                </label>
                <label>
                  Rating (1-5)
                  <select
                    name="rating"
                    defaultValue={editingReview.rating}
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                    }}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} {"★".repeat(n)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Title
                  <input
                    name="title"
                    defaultValue={editingReview.title || ""}
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                    }}
                  />
                </label>
                <label>
                  Body
                  <textarea
                    name="body"
                    defaultValue={editingReview.body}
                    rows={4}
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                    }}
                  />
                </label>
                <label>
                  Status
                  <select
                    name="status"
                    defaultValue={editingReview.status}
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                    }}
                  >
                    <option value="PENDING">PENDING</option>
                    <option value="APPROVED">APPROVED</option>
                    <option value="REJECTED">REJECTED</option>
                  </select>
                </label>
                <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => setEditingReview(null)}
                    style={{
                      padding: "8px 16px",
                      border: "1px solid #ccc",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{
                      padding: "8px 16px",
                      border: "none",
                      borderRadius: "6px",
                      background: "#333",
                      color: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            </fetcher.Form>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowCreateModal(false)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "12px",
              padding: "24px",
              width: "500px",
              maxHeight: "80vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 16px" }}>Create Manual Review</h2>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="create" />
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <label>
                  Product
                  <select
                    name="productId"
                    required
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                    }}
                  >
                    <option value="">Select a product...</option>
                    {products.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Author Name
                  <input
                    name="authorName"
                    required
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                    }}
                  />
                </label>
                <label>
                  Author Email
                  <input
                    name="authorEmail"
                    type="email"
                    required
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                    }}
                  />
                </label>
                <label>
                  Rating (1-5)
                  <select
                    name="rating"
                    required
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                    }}
                  >
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {n} {"★".repeat(n)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Title (optional)
                  <input
                    name="title"
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                    }}
                  />
                </label>
                <label>
                  Body
                  <textarea
                    name="body"
                    required
                    rows={4}
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                    }}
                  />
                </label>
                <label>
                  Status
                  <select
                    name="status"
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                    }}
                  >
                    <option value="APPROVED">APPROVED</option>
                    <option value="PENDING">PENDING</option>
                  </select>
                </label>
                <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    style={{
                      padding: "8px 16px",
                      border: "1px solid #ccc",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{
                      padding: "8px 16px",
                      border: "none",
                      borderRadius: "6px",
                      background: "#333",
                      color: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    Create
                  </button>
                </div>
              </div>
            </fetcher.Form>
          </div>
        </div>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
