import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "draft_networking_email",
  title: "Draft Networking Email",
  description: "Draft a short, warm outbound networking email tailored to a specific contact, company, and role.",
  inputSchema: {
    contact_name: z.string().min(1).max(120).describe("Full name of the contact."),
    company: z.string().min(1).max(160).describe("Company name."),
    role: z.string().max(120).default("Recruiter").describe("Their role — defaults to 'Recruiter'."),
    context: z.string().max(2_000).default("").describe("Optional extra context to weave in."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: ({ contact_name, company, role, context }) => {
    const first = contact_name.split(/\s+/)[0];
    const subject = `Quick intro — exploring opportunities at ${company}`;
    const body =
      `Hi ${first},\n\n` +
      `I came across your work at ${company} and wanted to reach out. ` +
      `I'm exploring ${role.toLowerCase()} conversations and ${context || "would love to learn how your team is approaching the next quarter"}.\n\n` +
      `Open to a 15-minute call next week?\n\nBest,\n`;
    return {
      content: [{ type: "text", text: `Subject: ${subject}\n\n${body}` }],
      structuredContent: { subject, body },
    };
  },
});
