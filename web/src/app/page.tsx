import { Preloader } from "@/ui/Preloader";
import { Nav } from "@/ui/Nav";
import { Hero } from "@/ui/Hero";
import { HowItWorks } from "@/ui/HowItWorks";
import { CarePlanTool } from "@/ui/CarePlanTool";
import { LabResults } from "@/ui/LabResults";
import { Why } from "@/ui/Why";
import { Trust } from "@/ui/Trust";
import { Footer } from "@/ui/Footer";

export default function Home() {
  return (
    <>
      <Preloader />
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <CarePlanTool />
        <LabResults />
        <Why />
        <Trust />
      </main>
      <Footer />
    </>
  );
}
