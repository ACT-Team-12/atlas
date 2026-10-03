import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

/**
 * The Vonage application's answer URL. ATLAS only places outbound calls (each carries its own NCCO), and no phone
 * number is linked to the ATLAS Vonage application, so nothing should ever reach this. If a call ever does (a number
 * linked by mistake), it hears one word and the call ends: no input, no stream, no connect, no plan data, so an
 * inbound call costs a few seconds and cannot be turned into anything else. Its own small rate-limit bucket keeps a
 * flood of inbound calls from using up the shared Vonage callback bucket.
 */
const NCCO = [{ action: "talk", text: "Goodbye.", language: "en-US" }];

async function answer(request: Request) {
  const refused = guard(request, "call-answer", 20);
  if (refused) return refused;
  return Response.json(NCCO, { headers: { "cache-control": "no-store" } });
}

export const GET = answer;
export const POST = answer;
