/**
 * A record's documents as a query (owner, Oct 26): the list the panel shows, and the count the
 * ticket header's Documents icon wears (Oct 27). One key (document-types documentsKey) for both,
 * so the badge and the list are read once and refresh together. A .ts module so the panel's
 * file exports components only (fast refresh).
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { listDocuments } from "@/lib/documents.functions";

import { documentsKey } from "./document-types";

export interface DocumentsScope {
  bidId?: string | undefined;
  serviceJobId?: string | undefined;
  /** Every document of the customer. */
  accountId?: string | undefined;
}

export function useDocumentsQuery(scope: DocumentsScope, opts: { enabled?: boolean } = {}) {
  const listFn = useServerFn(listDocuments);
  return useQuery({
    queryKey: documentsKey(scope),
    queryFn: () =>
      listFn({
        data: {
          ...(scope.bidId ? { bidId: scope.bidId } : {}),
          ...(scope.serviceJobId ? { serviceJobId: scope.serviceJobId } : {}),
          ...(scope.accountId ? { accountId: scope.accountId } : {}),
        },
      }),
    enabled: opts.enabled ?? true,
  });
}
