import { callConfig } from "@/lib/call/config";
import { canCallIn } from "@/lib/call/ncco";
import { LANGUAGES } from "@/lib/schema";

export const dynamic = "force-dynamic";

/** Whether "ATLAS calls you" is on for this deployment, and in which languages. Names nothing secret. */
export async function GET() {
  // FEEDBACK_SECRET signs the plan's speak token; without it no plan can be read on a call.
  const on = Boolean(callConfig() && process.env.FEEDBACK_SECRET);
  return Response.json({ enabled: on, languages: on ? LANGUAGES.filter(canCallIn) : [] }, { headers: { "cache-control": "no-store" } });
}
