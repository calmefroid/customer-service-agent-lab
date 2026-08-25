import type { TraceEvent } from "@/lib/contracts";

import type { RuntimeTraceSink } from "./types";

export class InMemoryRuntimeTraceStore implements RuntimeTraceSink {
  private readonly events: TraceEvent[] = [];

  append(event: TraceEvent): void {
    this.events.push(event);
  }

  list(traceId?: string): TraceEvent[] {
    return this.events.filter((event) => !traceId || event.traceId === traceId);
  }

  reset(): void {
    this.events.length = 0;
  }
}
