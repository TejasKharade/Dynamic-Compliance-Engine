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


// ---------- Simulate / What-If types ----------
export interface SimulateRule {
  relationship: string;
  target?: string;
  source?: string;
  operator?: string;
  min_version?: string | null;
  rule_text: string;
}

export interface SimulateAffectedFinding {
  severity: string;
  rule_type: string;
  source: string;
  target: string;
  message: string;
  remediation?: {
    component: string;
    action: string;
    target_version?: string;
    reason: string;
  } | null;
}

export interface SimulateAffectedDevice {
  device_id: string;
  is_compliant: boolean;
  compliance_score: number;
  critical_findings: number;
  warning_findings: number;
  relevant_findings: SimulateAffectedFinding[];
}

export interface SimulateResult {
  found: boolean;
  message?: string;
  change_request?: {
    component: string;
    target_version: string;
    planned_component_id: string;
    graph_node_used: string;
  };
  risk_level?: "HIGH" | "MEDIUM" | "LOW";
  graph_context?: {
    component_id: string;
    component_type: string;
    direct_requirements: SimulateRule[];
    blockers: SimulateRule[];
    advisories: SimulateRule[];
  };
  impact_summary?: {
    devices_with_related_findings: number;
    critical_devices: number;
    warning_devices: number;
  };
  affected_devices?: SimulateAffectedDevice[];
  recommended_next_actions?: string[];
}

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
   * Unified pipeline: parse rules → push to Neo4j → evaluate inventory → cache.
   * Backend field names: rules_file, inventory_file
   */
  evaluate: (files: { rules?: File[]; inventory?: File[] }) => {
    const fd = new FormData();
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
   * POST /simulate
   * What-If simulator: given a component + target version, returns risk level,
   * graph rules (requirements / blockers / advisories), and affected devices.
   */
  simulate: (payload: { component: string; target_version?: string }) =>
    request<SimulateResult>("/simulate", {
      method: "POST",
      body: JSON.stringify({ component: payload.component, target_version: payload.target_version ?? "" }),
    }),

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