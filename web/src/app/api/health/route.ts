import { MODEL } from "@/lib/extract";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    ai_key_configured: Boolean(process.env.ANTHROPIC_API_KEY),
    model: MODEL,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
  });
}
