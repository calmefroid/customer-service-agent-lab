import { InMemorySessionStore } from "@/lib/sessions";

import { InMemoryRuntimeTraceStore } from "./runtime-trace-store";

export const defaultRuntimeSessions = new InMemorySessionStore();
export const defaultRuntimeTraceStore = new InMemoryRuntimeTraceStore();
