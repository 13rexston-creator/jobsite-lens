import Anthropic from "@anthropic-ai/sdk";
import { anthropicDefaultHeaders, planRuntime, planSafetyIdentifier, requireAnthropicKey } from "../plan-library";

export type VlmProviderName = "anthropic";
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

function imageBlock(item: PlanVisualEvidence): Anthropic.ImageBlockParam {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(item.imageDataUrl);
  if (!match) throw new Error("Claude requires base64 image evidence.");
  const mediaType = match[1];
  if (mediaType !== "image/jpeg" && mediaType !== "image/png" && mediaType !== "image/webp" && mediaType !== "image/gif") {
    throw new Error(`Unsupported image type for Claude vision: ${mediaType}`);
  }
  return { type: "image", source: { type: "base64", media_type: mediaType, data: match[2] } };
}

class AnthropicPlanVlm implements PlanVlmProvider {
  readonly name = "anthropic" as const;
  private client: Anthropic | null = null;

  private getClient() {
    if (!this.client) this.client = new Anthropic({ apiKey: requireAnthropicKey(), defaultHeaders: anthropicDefaultHeaders() });
    return this.client;
  }

  private async analyze(request: VlmAnalysisRequest): Promise<VlmAnalysisResult> {
    const runtime = planRuntime();
    const model = request.strength === "strong"
      ? runtime.ANTHROPIC_VLM_STRONG_MODEL?.trim() || "claude-opus-5"
      : runtime.ANTHROPIC_VLM_MODEL?.trim() || "claude-sonnet-5";
    const toolName = request.schemaName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "record_analysis";
    const started = Date.now();
    const response = await this.getClient().messages.create({
      model,
      max_tokens: request.strength === "strong" ? 16_000 : 8_192,
      metadata: { user_id: await planSafetyIdentifier(request.ownerUserId) },
      tool_choice: { type: "tool", name: toolName },
      tools: [{ name: toolName, description: "Record the structured analysis of this construction drawing.", input_schema: request.schema as Anthropic.Tool.InputSchema }],
      messages: [{
        role: "user",
        content: [
          { type: "text", text: request.prompt },
          ...request.evidence.map(imageBlock),
        ],
      }],
    });
    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === toolName);
    if (!toolUse) throw new Error("Claude did not return structured plan data.");
    return {
      provider: this.name,
      model,
      data: toolUse.input,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs: Date.now() - started,
      estimatedCostMicros: 0,
    };
  }

  analyzePlanPage(request: VlmAnalysisRequest) { return this.analyze(request); }
  analyzePlanRegion(request: VlmAnalysisRequest) { return this.analyze(request); }
  extractStructuredPlanData(request: VlmAnalysisRequest) { return this.analyze(request); }
  comparePlanRevisions(request: VlmAnalysisRequest) { return this.analyze(request); }
}

const anthropicPlanVlm = new AnthropicPlanVlm();

export function configuredVlmProvider(): PlanVlmProvider {
  return anthropicPlanVlm;
}

export function getVlmProvider(name: VlmProviderName) {
  void name;
  return anthropicPlanVlm;
}
