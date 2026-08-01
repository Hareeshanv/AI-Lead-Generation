import { aiService } from "../../services/openai";
import { agentGateway } from "../../services/sarvam/agentGateway";

export interface OutreachInput {
  name: string;
  title: string;
  company: string;
  techStack: string[];
}

export class OutreachAgent {
  async generateCopy(input: OutreachInput): Promise<string> {
    // Prefer Sarvam AI agent if configured
    if (agentGateway.isConfigured("agt-outreach")) {
      const response = await agentGateway.runAgent("agt-outreach", {
        lead_name: input.name,
        lead_title: input.title,
        lead_company: input.company,
        tech_stack: input.techStack,
      });
      if (response && response.success && response.output) {
        // Try to extract email copy from structured output
        const copy = response.output.outreach_copy || response.output;
        if (copy.cold_email?.variant_a?.body) return copy.cold_email.variant_a.body;
        if (copy.cold_email?.body) return copy.cold_email.body;
        if (typeof copy.message === "string") return copy.message;
        return JSON.stringify(copy);
      }
    }

    // Fallback: Local OpenAI call
    const prompt = `Generate a short 1-on-1 personalized cold email subject & body for ${input.name}, who is ${input.title} at ${input.company}. Mention their tech stack (${input.techStack.join(", ")}).`;
    
    const response = await aiService.generateText({
      prompt,
      systemPrompt: "You are an elite B2B cold email copywriter specializing in high response rates.",
    });

    return response.text;
  }
}

export const outreachAgent = new OutreachAgent();
