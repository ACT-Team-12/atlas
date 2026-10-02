import { z } from "zod";
import { guard } from "@/lib/guard";
import { isTestRequest, recordEvent, surfaceOf } from "@/lib/db";

export const dynamic = "force-dynamic";

// Choices only, no free text, so nothing identifying can be submitted.
const FeedbackSchema = z.object({
  role: z.enum(["patient", "caregiver", "helper", "tester"]),
  rating: z.number().int().min(1).max(5),
  would_use: z.enum(["yes", "maybe", "no"]),
  quiz_total: z.number().int().min(0).max(40).optional(),
  quiz_first_try: z.number().int().min(0).max(40).optional(),
  language: z.string().max(20).optional(),
}).refine((f) => (f.quiz_first_try ?? 0) <= (f.quiz_total ?? 0), { message: "quiz_first_try cannot exceed quiz_total." });

export async function POST(request: Request) {
  const refused = guard(request, "feedback");
  if (refused) return refused;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = FeedbackSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid feedback." }, { status: 400 });
  const ok = await recordEvent({ surface: surfaceOf(request), kind: "feedback", ...parsed.data }, isTestRequest(request));
  if (!ok) return Response.json({ error: "We couldn't save that right now. Thank you anyway." }, { status: 503 });
  return Response.json({ ok: true });
}
