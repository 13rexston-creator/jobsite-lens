export type DocumentSourceProvider = "upload" | "procore";

export type ExternalProject = {
  id: string;
  name: string;
  companyId?: string;
  companyName?: string;
  number?: string | null;
};

export type ExternalDocument = {
  id: string;
  number: string;
  title: string;
  revision: string;
  issuedAt: string;
  discipline: string;
  size: number | null;
  mimeType: string;
};

export type OpenedExternalDocument = ExternalDocument & {
  body: ReadableStream<Uint8Array>;
};

export interface DocumentSourceAdapter {
  readonly provider: DocumentSourceProvider;
  readonly capabilities: ReadonlyArray<"projects" | "documents" | "revisions" | "server_fetch" | "sync">;
  listProjects(): Promise<ExternalProject[]>;
  listDocuments(input: { externalProjectId: string; externalCompanyId?: string }): Promise<ExternalDocument[]>;
  openDocument(input: { externalProjectId: string; externalCompanyId?: string; externalDocumentId: string }): Promise<OpenedExternalDocument>;
}
