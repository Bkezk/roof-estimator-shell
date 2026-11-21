/**
 * The public pages' four calls to the server, in one place (lib/public-forms.functions.ts; the
 * shape is lib/public-forms.ts). No sign-in is asked for or sent: these are the only calls a
 * visitor's page makes.
 */
import { useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";

import type {
  PublicCareRequest,
  PublicQuote,
  PublicQuoteAsk,
  PublicSent,
  PublicServiceRequest,
} from "@/lib/public-forms";
import {
  publicRoofCareQuote,
  publicServiceChoices,
  submitRoofCareRequest,
  submitServiceRequest,
} from "@/lib/public-forms.functions";

export interface PublicApi {
  /** The three plans' yearly prices for one building. Nothing is kept of the visitor. */
  quote: (a: { data: PublicQuoteAsk }) => Promise<PublicQuote>;
  sendCare: (a: { data: PublicCareRequest }) => Promise<PublicSent>;
  sendService: (a: { data: PublicServiceRequest }) => Promise<PublicSent>;
  /** The office's list of services to tick on the request page. */
  services: () => Promise<{ services: string[] }>;
}

export function usePublicApi(): PublicApi {
  const quote = useServerFn(publicRoofCareQuote);
  const sendCare = useServerFn(submitRoofCareRequest);
  const sendService = useServerFn(submitServiceRequest);
  const services = useServerFn(publicServiceChoices);
  return useMemo(
    () => ({
      quote: (a) => quote(a),
      sendCare: (a) => sendCare(a),
      sendService: (a) => sendService(a),
      services: () => services(),
    }),
    [quote, sendCare, sendService, services],
  );
}
