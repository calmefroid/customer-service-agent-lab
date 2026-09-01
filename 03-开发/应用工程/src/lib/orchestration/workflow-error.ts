import type { AgentPublicError } from "@/lib/contracts";

/** Public workflow failure that Runtime may safely expose as AgentEvent.error. */
export class AgentWorkflowError extends Error {
  constructor(
    readonly publicError: AgentPublicError,
    readonly internalCode = publicError.code,
  ) {
    super(publicError.message);
    this.name = "AgentWorkflowError";
  }
}
