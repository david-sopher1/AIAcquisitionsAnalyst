// Ringless voicemail — Drop Cowboy. Consent-gated by the compliance engine
// (prerecorded voice to cells requires prior express written consent).
import { getConfig } from "@dealengine/shared";
import { httpJson } from "./http.js";

export async function sendRvm(params: {
  to: string;
  audioUrl: string;      // pre-recorded voicemail file (or use TTS ids configured in Drop Cowboy)
  callbackNumber: string;
  foreignId?: string;    // our touch id for webhook correlation
}): Promise<{ providerMessageId: string }> {
  const cfg = getConfig();
  if (!cfg.DROPCOWBOY_TEAM_ID || !cfg.DROPCOWBOY_SECRET) {
    throw new Error("Drop Cowboy not configured");
  }
  const res = await httpJson<{ id?: string }>(
    "dropcowboy",
    "https://api.dropcowboy.com/v1/rvm",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        team_id: cfg.DROPCOWBOY_TEAM_ID,
        secret: cfg.DROPCOWBOY_SECRET,
        brand_id: cfg.DROPCOWBOY_BRAND_ID,
        phone_number: params.to,
        callerid: params.callbackNumber,
        audio_url: params.audioUrl,
        foreign_id: params.foreignId,
      }),
    },
  );
  return { providerMessageId: res.id ?? params.foreignId ?? "unknown" };
}
