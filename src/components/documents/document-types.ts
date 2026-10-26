/**
 * The Documents rows as the server functions return them, derived from the functions' own
 * return types so the editor and the panel stay in step with documents.functions.ts whatever
 * names that module exports for them.
 */
import type {
  getDocument,
  getDocumentTemplate,
  listDocumentAssets,
  listDocumentRevisions,
  listDocuments,
  listDocumentTemplates,
  listSavedModules,
} from "@/lib/documents.functions";

export type DocumentBundle = Awaited<ReturnType<typeof getDocument>>;
export type DocumentRow = DocumentBundle["document"];
export type DocumentPhoto = DocumentBundle["photos"][number];
export type DocumentListRow = Awaited<ReturnType<typeof listDocuments>>[number];
export type TemplateListRow = Awaited<ReturnType<typeof listDocumentTemplates>>[number];
export type TemplateRow = Awaited<ReturnType<typeof getDocumentTemplate>>;
export type SavedModuleRow = Awaited<ReturnType<typeof listSavedModules>>[number];
export type DocumentAssetRow = Awaited<ReturnType<typeof listDocumentAssets>>[number];
export type DocumentRevisionRow = Awaited<ReturnType<typeof listDocumentRevisions>>[number];

/** TanStack Query keys. */
export const documentKey = (id: string) => ["document", id] as const;
export const documentsKey = (scope: {
  bidId?: string | undefined;
  serviceJobId?: string | undefined;
  accountId?: string | undefined;
}) => ["documents", scope.bidId ?? "", scope.serviceJobId ?? "", scope.accountId ?? ""] as const;
export const templatesKey = (kind?: string) => ["document-templates", kind ?? "all"] as const;
export const templateKey = (id: string) => ["document-template", id] as const;
export const savedModulesKey = ["document-saved-modules"] as const;
export const assetsKey = ["document-assets"] as const;
export const revisionsKey = (id: string) => ["document-revisions", id] as const;
export const imageUrlKey = (path: string) => ["document-image", path] as const;

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
