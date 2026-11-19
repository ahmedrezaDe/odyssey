// Simplified lexicon - always uses premium mode
const LEXICON = {
  brand: { name: "Odyssey Career",  tagline: "Career Workspace" },
  fleetOverview: "Overview",
  sectorTag: "workspace",
  orchestratorLog: "Activity",
  startButton: "Start Workflows",
  stopButton: "Pause Workflows",
  webhooks: "Integrations",
  cvGenerator: "Document Studio",
  emailListener: "Inbound Gateway",
  triageAgent: "Intake Pipeline",
  liveStatus: "Live",
  groups: {
    operations: "Workspace",
    tools: "Studio",
    pipelines: "Workflows",
    system: "Settings",
  },
} as const;

export function useLexicon() {
  return {
    mode: "premium" as const,
    brand: LEXICON.brand,
    fleetOverview: LEXICON.fleetOverview,
    sectorTag: LEXICON.sectorTag,
    orchestratorLog: LEXICON.orchestratorLog,
    startButton: LEXICON.startButton,
    stopButton: LEXICON.stopButton,
    webhooks: LEXICON.webhooks,
    cvGenerator: LEXICON.cvGenerator,
    emailListener: LEXICON.emailListener,
    triageAgent: LEXICON.triageAgent,
    liveStatus: LEXICON.liveStatus,
    groups: LEXICON.groups,
  };
}
