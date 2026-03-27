import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const customer = payload as any;
    const customerGid = `gid://shopify/Customer/${customer.id}`;

    await db.customer.upsert({
      where: { id: customerGid },
      create: {
        id: customerGid,
        shopDomain: shop,
        email: customer.email || "",
        firstName: customer.first_name || null,
        lastName: customer.last_name || null,
      },
      update: {
        email: customer.email || "",
        firstName: customer.first_name || null,
        lastName: customer.last_name || null,
      },
    });
  } catch (error) {
    console.error("Error processing customers/create webhook:", error);
  }

  return new Response();
};
