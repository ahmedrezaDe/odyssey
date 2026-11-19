import { defineMcp } from "@lovable.dev/mcp-js";
import atsMatchTool from "./tools/ats-match";
import roastResumeTool from "./tools/roast-resume";
import interviewQuestionsTool from "./tools/interview-questions";
import networkingDraftTool from "./tools/networking-draft";

export default defineMcp({
  name: "odyssey-mcp",
  title: "Odyssey Career OS",
  version: "1.0.0",
  instructions:
    "Career-tooling utilities from Odyssey Career OS. Use `ats_match` to score a resume against a JD, `roast_resume` to critique resume bullets, `generate_interview_questions` to produce keyword-driven interview questions from a JD, and `draft_networking_email` to compose a short outbound intro email.",
  tools: [atsMatchTool, roastResumeTool, interviewQuestionsTool, networkingDraftTool],
});
