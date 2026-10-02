import { guard } from "@/lib/guard";
import { RequestSchema } from "@/lib/schema";
import { extractCarePlan, ExtractError } from "@/lib/extract";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const refused = guard(request, "extract");
  if (refused) return refused;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  try {
    const plan = await extractCarePlan(parsed.data);
    return Response.json(plan);
  } catch (e) {
    if (e instanceof ExtractError) return Response.json({ error: e.message }, { status: e.status });
    console.error("extract failed", e);
    return Response.json({ error: "Something went wrong reading that document. Try again." }, { status: 500 });
  }
}
