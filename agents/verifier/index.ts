import { emailVerifier } from "../../services/email";

export class VerifierAgent {
  async verify(email: string) {
    return await emailVerifier.verifyEmail(email);
  }
}

export const verifierAgent = new VerifierAgent();
