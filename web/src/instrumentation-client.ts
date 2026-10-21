// Runs in the browser before the app becomes interactive (Next.js instrumentation-client convention).
// Installs the PHI shield on fetch: paper text sent to our AI routes is shielded here, in the browser, and every answer
// gets the real words back before any component sees it (lib/shieldFetch.ts). If installing fails, the page works as
// before and the server's own pass (lib/phiGuard.ts) still shields the text before any AI call.
import { installShieldedFetch } from "@/lib/shieldFetch";

try {
  installShieldedFetch(window);
} catch {
  // never block the page
}
