import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

/**
 * The Vonage application's answer URL. Outbound ATLAS calls carry their own NCCO, so this only answers someone who
 * calls the ATLAS number back: it says what the number is for and hangs up.
 */
const NCCO = [
  { action: "talk", text: "This is ATLAS. This number only calls people who asked ATLAS to read them their plan. It does not take calls. Goodbye.", language: "en-US" },
  { action: "talk", text: "Este es ATLAS. Este número solo llama a personas que pidieron escuchar su plan. No recibe llamadas. Adiós.", language: "es-US" },
];

async function answer(request: Request) {
  const refused = guard(request, "call-hook", 300);
  if (refused) return refused;
  return Response.json(NCCO);
}

export const GET = answer;
export const POST = answer;
