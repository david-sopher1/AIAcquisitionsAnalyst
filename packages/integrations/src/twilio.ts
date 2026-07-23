// SMS Agent transport — Twilio Programmable Messaging (10DLC).
import { createHmac } from "node:crypto";
import { getConfig } from "@dealengine/shared";
import { formEncode, httpJson } from "./http.js";

export interface SmsSendResult {
  providerMessageId: string;
  status: string;
}

export async function sendSms(params: {
  to: string;               // E.164
  body: string;
  mediaUrl?: string;        // MMS
  statusCallback?: string;
}): Promise<SmsSendResult> {
  const cfg = getConfig();
  if (!cfg.TWILIO_ACCOUNT_SID || !cfg.TWILIO_AUTH_TOKEN) {
    throw new Error("Twilio not configured");
  }
  const auth = Buffer.from(`${cfg.TWILIO_ACCOUNT_SID}:${cfg.TWILIO_AUTH_TOKEN}`).toString("base64");

  const body: Record<string, string | undefined> = {
    To: params.to,
    Body: params.body,
    StatusCallback: params.statusCallback,
    MediaUrl: params.mediaUrl,
  };
  // Prefer Messaging Service (handles number pool, opt-out, throughput).
  if (cfg.TWILIO_MESSAGING_SERVICE_SID) {
    body.MessagingServiceSid = cfg.TWILIO_MESSAGING_SERVICE_SID;
  } else {
    body.From = cfg.TWILIO_FROM_NUMBER;
  }

  const res = await httpJson<{ sid: string; status: string }>(
    "twilio",
    `https://api.twilio.com/2010-04-01/Accounts/${cfg.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formEncode(body),
    },
  );
  return { providerMessageId: res.sid, status: res.status };
}

/**
 * Validate Twilio's X-Twilio-Signature header (HMAC-SHA1 over URL + sorted
 * POST params, base64). Reject webhooks that fail this check.
 */
export function validateTwilioSignature(params: {
  signature: string | undefined;
  url: string;
  body: Record<string, string>;
}): boolean {
  const cfg = getConfig();
  if (!cfg.TWILIO_AUTH_TOKEN || !params.signature) return false;
  const data =
    params.url +
    Object.keys(params.body)
      .sort()
      .map((k) => k + params.body[k])
      .join("");
  const expected = createHmac("sha1", cfg.TWILIO_AUTH_TOKEN).update(data).digest("base64");
  return expected === params.signature;
}
