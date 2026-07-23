// Direct Mail Manager — Lob (postcards/letters) + Handwrytten (handwritten cards).
import { getConfig } from "@dealengine/shared";
import { formEncode, httpJson } from "./http.js";

export async function sendPostcard(params: {
  toName: string;
  toLine1: string;
  toCity: string;
  toState: string;
  toZip: string;
  frontTemplateId: string;   // Lob template id (designed in Lob dashboard)
  backTemplateId: string;
  mergeVariables: Record<string, string>;  // owner_name, address, phone...
}): Promise<{ providerMessageId: string; expectedDeliveryDate?: string }> {
  const cfg = getConfig();
  if (!cfg.LOB_API_KEY) throw new Error("Lob not configured");
  const auth = Buffer.from(`${cfg.LOB_API_KEY}:`).toString("base64");

  const res = await httpJson<{ id: string; expected_delivery_date?: string }>(
    "lob",
    "https://api.lob.com/v1/postcards",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formEncode({
        "to[name]": params.toName,
        "to[address_line1]": params.toLine1,
        "to[address_city]": params.toCity,
        "to[address_state]": params.toState,
        "to[address_zip]": params.toZip,
        front: params.frontTemplateId,
        back: params.backTemplateId,
        merge_variables: JSON.stringify(params.mergeVariables),
        use_type: "marketing",
      }),
    },
  );
  return { providerMessageId: res.id, expectedDeliveryDate: res.expected_delivery_date };
}

export async function sendHandwrittenCard(params: {
  toName: string;
  toLine1: string;
  toCity: string;
  toState: string;
  toZip: string;
  message: string;           // the handwritten body
  handwritingId?: string;
  cardId?: string;
}): Promise<{ providerMessageId: string }> {
  const cfg = getConfig();
  if (!cfg.HANDWRYTTEN_API_KEY) throw new Error("Handwrytten not configured");

  const res = await httpJson<{ order_id?: string | number; id?: string | number }>(
    "handwrytten",
    "https://api.handwrytten.com/v1/orders/singleStepOrder",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.HANDWRYTTEN_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        card_id: params.cardId,
        handwriting_id: params.handwritingId,
        message: params.message,
        recipient_name: params.toName,
        recipient_address1: params.toLine1,
        recipient_city: params.toCity,
        recipient_state: params.toState,
        recipient_zip: params.toZip,
      }),
    },
  );
  return { providerMessageId: String(res.order_id ?? res.id ?? "unknown") };
}
