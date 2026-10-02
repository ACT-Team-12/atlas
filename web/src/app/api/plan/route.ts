import { guard } from "@/lib/guard";
import { PlanRequestSchema, buildPlan } from "@/lib/plan";
import { ExtractError } from "@/lib/extract";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const refused = guard(request, "plan");
  if (refused) return refused;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = PlanRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  if (parsed.data.barriers.length === 0 && parsed.data.care.length === 0) {
    return Response.json({ error: "Pick at least one thing that gets in the way, or add your visit paper first." }, { status: 400 });
  }
  try {
    return Response.json(await buildPlan(parsed.data));
  } catch (e) {
    if (e instanceof ExtractError) return Response.json({ error: e.message }, { status: e.status });
    console.error("plan failed", e);
    return Response.json({ error: "Something went wrong building the plan. Try again." }, { status: 500 });
  }
}
