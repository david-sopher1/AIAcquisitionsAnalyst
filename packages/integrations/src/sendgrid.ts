// Email Agent transport — SendGrid v3.
import { getConfig } from "@dealengine/shared";
import { httpJson } from "./http.js";

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  categories?: string[];
}): Promise<{ providerMessageId: string }> {
  const cfg = getConfig();
  if (!cfg.SENDGRID_API_KEY || !cfg.SENDGRID_FROM_EMAIL) {
    throw new Error("SendGrid not configured");
  }

  // SendGrid returns 202 with X-Message-Id header; httpJson gives us body only,
  // so use fetch directly here to read the header.
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: params.to }] }],
      from: { email: cfg.SENDGRID_FROM_EMAIL, name: cfg.SENDGRID_FROM_NAME ?? undefined },
      subject: params.subject,
      content: [
        { type: "text/plain", value: params.text },
        ...(params.html ? [{ type: "text/html", value: params.html }] : []),
      ],
      categories: params.categories,
      // CAN-SPAM: SendGrid subscription tracking appends the unsubscribe link
      tracking_settings: { subscription_tracking: { enable: true } },
    }),
  });
  if (!res.ok) {
    throw new Error(`sendgrid HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return { providerMessageId: res.headers.get("x-message-id") ?? "unknown" };
}

// Suppress this address after hard bounces / spam reports (webhook driven).
export { httpJson as _http };
