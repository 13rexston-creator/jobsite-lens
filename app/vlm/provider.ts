import { openAIRequest, planRuntime, planSafetyIdentifier } from "../plan-library";

export type VlmProviderName = "openai" | "gemini";
export type VlmTask = "classify_sheet" | "analyze_page" | "analyze_region" | "compare_revisions";

export type PlanVisualEvidence = {
  imageDataUrl: string;
  kind: "full_sheet" | "crop";
  region?: { x: number; y: number; width: number; height: number };
};

export type VlmAnalysisRequest = {
  task: VlmTask;
  prompt: string;
  evidence: PlanVisualEvidence[];
  schema: Record<string, unknown>;
  schemaName: string;
  ownerUserId: string;
  strength?: "standard" | "strong";
};

export type VlmAnalysisResult = {
  provider: VlmProviderName;
  model: string;
  data: unknown;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCostMicros: number;
};

export interface PlanVlmProvider {
  readonly name: VlmProviderName;
  analyzePlanPage(request: VlmAnalysisRequest): Promise<VlmAnalysisResult>;
  analyzePlanRegion(request: VlmAnalysisRequest): Promise<VlmAnalysisResult>;
  extractStructuredPlanData(request: VlmAnalysisRequest): Promise<VlmAnalysisResult>;
  comparePlanRevisions(request: VlmAnalysisRequest): Promise<VlmAnalysisResult>;
}

function outputText(response: { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
  return response.output?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text).join("\n").trim() ?? "";
}

function parseJson(text: string, provider: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${provider} returned invalid structured plan data.`);
  }
}

class OpenAIPlanVlm implements PlanVlmProvider {
  readonly name = "openai" as const;

  private async analyze(request: VlmAnalysisRequest) {
    const runtime = planRuntime();
    const model = request.strength === "strong"
      ? runtime.OPENAI_VLM_STRONG_MODEL?.trim() || runtime.OPENAI_VLM_MODEL?.trim() || runtime.OPENAI_TAKEOFF_MODEL?.trim() || "gpt-5.6-sol"
      : runtime.OPENAI_VLM_MODEL?.trim() || runtime.OPENAI_TAKEOFF_MODEL?.trim() || "gpt-5.6-terra";
    const started = Date.now();
    const response = await openAIRequest("/responses", {
      method: "POST",
      body: JSON.stringify({
        model,
        store: false,
        safety_identifier: await planSafetyIdentifier(request.ownerUserId),
        input: [{ role: "user", content: [
          { type: "input_text", text: request.prompt },
          ...request.evidence.map((item) => ({ type: "input_image", image_url: item.imageDataUrl, detail: "high" })),
        ] }],
        text: { format: { type: "json_schema", name: request.schemaName, strict: true, schema: request.schema } },
        max_output_tokens: 12_000,
      }),
    }) as {
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = outputText(response);
    if (!text) throw new Error("OpenAI returned no structured plan data.");
    return {
      provider: this.name,
      model,
      data: parseJson(text, "OpenAI"),
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      latencyMs: Date.now() - started,
      estimatedCostMicros: 0,
    } satisfies VlmAnalysisResult;
  }

  analyzePlanPage(request: VlmAnalysisRequest) { return this.analyze(request); }
  analyzePlanRegion(request: VlmAnalysisRequest) { return this.analyze(request); }
  extractStructuredPlanData(request: VlmAnalysisRequest) { return this.analyze(request); }
  comparePlanRevisions(request: VlmAnalysisRequest) { return this.analyze(request); }
}

class GeminiPlanVlm implements PlanVlmProvider {
  readonly name = "gemini" as const;

  private async analyze(request: VlmAnalysisRequest) {
    const runtime = planRuntime();
    const apiKey = runtime.GOOGLE_API_KEY?.trim();
    if (!apiKey) throw new Error("Gemini is not configured. Add GOOGLE_API_KEY to the hosted environment.");
    const model = request.strength === "strong"
      ? runtime.GEMINI_VLM_STRONG_MODEL?.trim() || runtime.GEMINI_VLM_MODEL?.trim() || "gemini-2.5-pro"
      : runtime.GEMINI_VLM_MODEL?.trim() || "gemini-2.5-pro";
    const started = Date.now();
    const parts = [{ text: request.prompt }, ...request.evidence.map((item) => {
      const match = /^data:([^;]+);base64,(.+)$/s.exec(item.imageDataUrl);
      if (!match) throw new Error("Gemini requires base64 image evidence.");
      return { inlineData: { mimeType: match[1], data: match[2] } };
    })];
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: request.schema,
          maxOutputTokens: 12_000,
        },
      }),
    });
    const payload = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(payload.error?.message ?? "Gemini could not analyze this drawing.");
    const text = payload.candidates?.flatMap((item) => item.content?.parts ?? []).map((item) => item.text ?? "").join("\n").trim() ?? "";
    if (!text) throw new Error("Gemini returned no structured plan data.");
    return {
      provider: this.name,
      model,
      data: parseJson(text, "Gemini"),
      inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
      latencyMs: Date.now() - started,
      estimatedCostMicros: 0,
    } satisfies VlmAnalysisResult;
  }

  analyzePlanPage(request: VlmAnalysisRequest) { return this.analyze(request); }
  analyzePlanRegion(request: VlmAnalysisRequest) { return this.analyze(request); }
  extractStructuredPlanData(request: VlmAnalysisRequest) { return this.analyze(request); }
  comparePlanRevisions(request: VlmAnalysisRequest) { return this.analyze(request); }
}

const providers: Record<VlmProviderName, PlanVlmProvider> = {
  openai: new OpenAIPlanVlm(),
  gemini: new GeminiPlanVlm(),
};

export function configuredVlmProvider(requested?: string): PlanVlmProvider {
  const value = (requested || planRuntime().PLAN_VLM_PROVIDER || "openai").trim().toLowerCase();
  if (value !== "openai" && value !== "gemini") throw new Error(`Unsupported VLM provider: ${value}`);
  return providers[value];
}

export function getVlmProvider(name: VlmProviderName) {
  return providers[name];
}
