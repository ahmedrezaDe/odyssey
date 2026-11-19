import { createFileRoute } from "@tanstack/react-router";
import { ContactOrchestratorModule } from "@/components/contact-orchestrator/ContactOrchestratorModule";

export const Route = createFileRoute("/networking")({
  component: ContactOrchestratorModule,
});