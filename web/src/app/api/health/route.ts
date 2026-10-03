import { MODEL } from "@/lib/extract";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    ai_key_configured: Boolean(process.env.ANTHROPIC_API_KEY),
    model: MODEL,
    // Git-integration deploys set VERCEL_GIT_COMMIT_SHA. CLI deploys (scripts/deploy-prod.sh) leave it empty and pass
    // ATLAS_COMMIT instead, so `||` (not `??`) lets an empty string fall through to it.
    commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.ATLAS_COMMIT || "local",
  });
}
