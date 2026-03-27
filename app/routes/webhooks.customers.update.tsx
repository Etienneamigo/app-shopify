import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const customer = payload as any;
    const customerGid = `gid://shopify/Customer/${customer.id}`;

    const existing = await db.customer.findUnique({
      where: { id: customerGid },
    });

    if (existing) {
      await db.customer.update({
        where: { id: customerGid },
        data: {
          email: customer.email || existing.email,
          firstName: customer.first_name || existing.firstName,
          lastName: customer.last_name || existing.lastName,
        },
      });
    } else {
      await db.customer.create({
        data: {
          id: customerGid,
          shopDomain: shop,
          email: customer.email || "",
          firstName: customer.first_name || null,
          lastName: customer.last_name || null,
        },
      });
    }
  } catch (error) {
    console.error("Error processing customers/update webhook:", error);
  }

  return new Response();
};
