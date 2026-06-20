// Centralized API client for ComplianceIQ backend
// All endpoint paths, request shapes, and response types are aligned with src/api/main.py

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:8000";

export class ApiError extends Error {
  status: number;
  body?: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    throw new ApiError(
      `Could not reach compliance engine at ${API_BASE_URL}. Is the backend running?`,
      0,
      err,
    );
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep as text */
  }
  if (!res.ok) {
    throw new ApiError(
      `Request failed (${res.status}) at ${path}`,
      res.status,
      body,
    );
  }
  return body as T;
}

// ---------- Shared types (aligned with backend schemas) ----------
export type Severity = "BLOCKER" | "CRITICAL" | "WARNING" | "INFO";

export interface Violation {
  rule_id?: string;
  severity: Severity | string;
  message: string;
  explanation?: string;
  source?: { document?: string; page?: number };
  components?: string[];
}

export interface RemediationSubStep {
  order?: number;
  description: string;
  command?: string;
  warning?: string;
  note?: string;
}

export interface RemediationStep {
  order?: number;
  action: string;
  component?: string;
  target_version?: string;
  reason?: string;
  estimated_time?: string;
  risk?: string;
  sub_steps?: RemediationSubStep[];
}

export interface DeviceSpec {
  component: string;
  version: string;
  source?: "auto" | "manual" | string;
  confidence?: number;
}

export interface DeviceEvaluation {
  device_id: string;
  name?: string;
  compliance_score?: number;
  is_compliant?: boolean;
  last_evaluated?: string;
  violations: Violation[];
  remediation?: RemediationStep[];
  specs?: DeviceSpec[];
}

export interface EvaluationResponse {
  devices: DeviceEvaluation[];
  summary?: {
    total?: number;
    compliant?: number;
    critical?: number;
    needs_attention?: number;
  };
}

export interface GraphNode {
  id: string;
  label?: string;
  type?: string;
  [k: string]: unknown;
}
export interface GraphEdge {
  source: string;
  target: string;
  relationship?: "requires" | "conflicts" | "deprecated" | string;
  [k: string]: unknown;
}
export interface GraphResponse {
  nodes: GraphNode[];
  edges?: GraphEdge[];
  links?: GraphEdge[];
}

export interface ExtractedRule {
  component_a: string;
  component_b?: string;
  relationship: string;
  version_constraint?: string;
  severity?: string;
  confidence?: number;
}

export interface IngestResponse {
  message: string;
  nodes: number;
  relationships: number;
  rules: ExtractedRule[];
}

export interface SystemStatus {
  status?: string;
  neo4j?: { connected?: boolean; [k: string]: unknown };
  cached_reports?: number;
  last_ingestion?: string;
  [k: string]: unknown;
}

// Chat types — aligned with backend POST /chat
// Backend expects: { question: string; session_id?: string }
// Backend returns: { session_id: string; answer: string; tools_used: string[] }
export interface ChatRequest {
  question: string;
  session_id?: string;
}
export interface ChatResponse {
  session_id: string;
  answer: string;
  tools_used?: string[];
}

// ---------- Endpoints ----------
export const api = {
  health: () => request<{ status: string }>("/health"),
  systemStatus: () => request<SystemStatus>("/system/status"),
  debugCache: () => request<unknown>("/debug/cache"),

  graphFull: () => request<GraphResponse>("/graph/full"),
  graphNetwork: () => request<GraphResponse>("/graph/network"),

  impact: (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    return request<unknown>(`/impact${qs ? `?${qs}` : ""}`);
  },

  /**
   * POST /evaluate-inventory
   * Returns cached compliance results without re-running evaluation.
   * Used by FleetOverview and DeviceDrilldown.
   */
  evaluateInventory: () =>
    request<EvaluationResponse>("/evaluate-inventory", {
      method: "POST",
    }),

  /**
   * POST /evaluate-json
   * Evaluate from a pre-built graph + inventory object.
   */
  evaluateJson: (payload: { rules?: unknown; inventory?: unknown }) =>
    request<EvaluationResponse>("/evaluate-json", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /**
   * POST /evaluate (multipart)
   * Backend field names: rules_file, inventory_file
   */
  evaluate: (files: { rules?: File[]; inventory?: File[] }) => {
    const fd = new FormData();
    // Backend expects single files named rules_file / inventory_file
    if (files.rules?.[0]) fd.append("rules_file", files.rules[0]);
    if (files.inventory?.[0]) fd.append("inventory_file", files.inventory[0]);
    return request<EvaluationResponse>("/evaluate", { method: "POST", body: fd });
  },

  /**
   * POST /ingest-rules (multipart)
   * Backend field name: rules_file
   */
  ingestRules: (files: File[]) => {
    const fd = new FormData();
    if (files[0]) fd.append("rules_file", files[0]);
    return request<IngestResponse>("/ingest-rules", { method: "POST", body: fd });
  },

  /**
   * POST /evaluate-neo4j (multipart)
   * Backend field names: rules_file, inventory_file
   */
  evaluateNeo4j: (files: { rules?: File[]; inventory?: File[] }) => {
    const fd = new FormData();
    if (files.rules?.[0]) fd.append("rules_file", files.rules[0]);
    if (files.inventory?.[0]) fd.append("inventory_file", files.inventory[0]);
    return request<EvaluationResponse>("/evaluate-neo4j", { method: "POST", body: fd });
  },

  /**
   * POST /chat
   * Backend expects: { question, session_id }
   * Backend returns: { session_id, answer, tools_used }
   */
  chat: (payload: ChatRequest) =>
    request<ChatResponse>("/chat", {
      method: "POST",
      body: JSON.stringify({
        question: payload.question,
        session_id: payload.session_id ?? "default",
      }),
    }),
};