import { runCheckerTest } from "@/lib/checkerTest";

export const dynamic = "force-dynamic";

// Public and free to call: no AI, no key, no personal data. Recomputes the quote-checker test on every request.
export async function GET() {
  const r = runCheckerTest();
  return Response.json({ ...r, commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local", computed_at: new Date().toISOString() });
}
