import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { refuseBadServerFnBody } from "./lib/server-fn-body";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// Nov 24: a server function call whose JSON body is not one a page sends is answered with a
// plain 400 "Bad request" before the framework reads it (lib/server-fn-body.ts). After the
// cross-site check, so a call from another site is still refused as before.
const serverFnBodyMiddleware = createMiddleware().server(async ({ next, request, handlerType }) => {
  return (await refuseBadServerFnBody(request, handlerType)) ?? next();
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware, serverFnBodyMiddleware],
}));
