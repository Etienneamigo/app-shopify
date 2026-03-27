import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const order = payload as any;
    if (!order.customer?.id) {
      return new Response("No customer on order", { status: 200 });
    }

    const shopDomain = shop;
    const customerGid = `gid://shopify/Customer/${order.customer.id}`;
    const orderGid = `gid://shopify/Order/${order.id}`;

    // Upsert customer
    await db.customer.upsert({
      where: { id: customerGid },
      create: {
        id: customerGid,
        shopDomain,
        email: order.customer.email || "",
        firstName: order.customer.first_name || null,
        lastName: order.customer.last_name || null,
      },
      update: {
        email: order.customer.email || "",
        firstName: order.customer.first_name || null,
        lastName: order.customer.last_name || null,
      },
    });

    // Upsert order
    await db.order.upsert({
      where: { id: orderGid },
      create: {
        id: orderGid,
        shopDomain,
        orderNumber: order.order_number || 0,
        customerId: customerGid,
      },
      update: {
        orderNumber: order.order_number || 0,
      },
    });

    // Upsert products and order items
    for (const item of order.line_items || []) {
      if (!item.product_id) continue;

      const productGid = `gid://shopify/Product/${item.product_id}`;

      await db.product.upsert({
        where: { id: productGid },
        create: {
          id: productGid,
          shopDomain,
          title: item.title || "Unknown",
          handle: item.product_id.toString(),
          imageUrl: null,
        },
        update: {
          title: item.title || "Unknown",
        },
      });

      await db.orderItem.upsert({
        where: {
          orderId_productId: {
            orderId: orderGid,
            productId: productGid,
          },
        },
        create: {
          orderId: orderGid,
          productId: productGid,
          quantity: item.quantity || 1,
        },
        update: {
          quantity: item.quantity || 1,
        },
      });
    }

    // Auto-mark existing pending reviews as verified if purchase confirmed
    const customerReviews = await db.review.findMany({
      where: {
        customerId: customerGid,
        verifiedPurchase: false,
      },
    });

    for (const review of customerReviews) {
      const hasPurchased = await db.orderItem.findFirst({
        where: {
          order: { customerId: customerGid },
          productId: review.productId,
        },
      });
      if (hasPurchased) {
        await db.review.update({
          where: { id: review.id },
          data: { verifiedPurchase: true },
        });
      }
    }
  } catch (error) {
    console.error("Error processing orders/create webhook:", error);
  }

  return new Response();
};
