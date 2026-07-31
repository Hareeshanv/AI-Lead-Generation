import { aiService } from "../../services/openai";

export interface OutreachInput {
  name: string;
  title: string;
  company: string;
  techStack: string[];
}

export class OutreachAgent {
  async generateCopy(input: OutreachInput): Promise<string> {
    const prompt = `Generate a short 1-on-1 personalized cold email subject & body for ${input.name}, who is ${input.title} at ${input.company}. Mention their tech stack (${input.techStack.join(", ")}).`;
    
    const response = await aiService.generateText({
      prompt,
      systemPrompt: "You are an elite B2B cold email copywriter specializing in high response rates.",
    });

    return response.text;
  }
}

export const outreachAgent = new OutreachAgent();
