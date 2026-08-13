import type { DocumentSourceAdapter, DocumentSourceProvider } from "./types";
import { procoreSourceAdapter } from "./procore";

const adapters: Partial<Record<DocumentSourceProvider, DocumentSourceAdapter>> = { procore: procoreSourceAdapter };

export function getDocumentSourceAdapter(provider: string) {
  const adapter = adapters[provider as DocumentSourceProvider];
  if (!adapter) throw new Error(`Document source ${provider} is not supported.`);
  return adapter;
}
