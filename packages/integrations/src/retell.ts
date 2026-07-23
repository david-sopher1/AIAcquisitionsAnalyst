// AI Voice — Retell AI outbound call. The Retell agent (configured in their
// dashboard with our persona + qualification goals) handles the live call;
// the call transcript comes back via webhook and is fed to the same
// qualification extraction pipeline as SMS.
import { getConfig } from "@dealengine/shared";
import { httpJson } from "./http.js";

export async function startOutboundCall(params: {
  to: string;
  leadId: string;
  dynamicVariables?: Record<string, string>; // owner_name, address, operator_name...
}): Promise<{ callId: string }> {
  const cfg = getConfig();
  if (!cfg.RETELL_API_KEY || !cfg.RETELL_FROM_NUMBER) {
    throw new Error("Retell not configured");
  }
  const res = await httpJson<{ call_id: string }>(
    "retell",
    "https://api.retellai.com/v2/create-phone-call",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.RETELL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from_number: cfg.RETELL_FROM_NUMBER,
        to_number: params.to,
        override_agent_id: cfg.RETELL_AGENT_ID,
        metadata: { lead_id: params.leadId },
        retell_llm_dynamic_variables: params.dynamicVariables ?? {},
      }),
    },
  );
  return { callId: res.call_id };
}
