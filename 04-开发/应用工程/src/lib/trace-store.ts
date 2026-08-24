import type { TraceRecord } from "@/lib/contracts";

declare global {
  // eslint-disable-next-line no-var
  var customerServiceTraceStore: TraceRecord[] | undefined;
}

function store(): TraceRecord[] {
  if (!globalThis.customerServiceTraceStore) {
    globalThis.customerServiceTraceStore = [];
  }
  return globalThis.customerServiceTraceStore;
}

export function appendTrace(record: TraceRecord): TraceRecord {
  const records = store();
  records.push(record);
  if (records.length > 500) records.splice(0, records.length - 500);
  return record;
}

export function listTraces(sessionId?: string): TraceRecord[] {
  const records = store();
  return sessionId
    ? records.filter((record) => record.sessionId === sessionId)
    : records;
}

export function clearTraces(): void {
  globalThis.customerServiceTraceStore = [];
}
