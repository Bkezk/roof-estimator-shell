import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { UNAUTHORIZED_EVENT } from "./lib/auth-store";

export const getRouter = () => {
  const queryClient = new QueryClient({
    // A server function answered Unauthorized: the browser has no usable token (expired session
    // that could not refresh, storage cleared). Tell the auth provider so it drops the session
    // and the gate sends the user to /login, instead of a page that waits forever on that query.
    queryCache: new QueryCache({
      onError: (error) => {
        if (
          typeof window !== "undefined" &&
          error instanceof Error &&
          error.message.includes("Unauthorized")
        ) {
          window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
        }
      },
    }),
    defaultOptions: {
      queries: {
        // An Unauthorized failure means there is no usable session (signed out, or a mobile
        // browser whose token expired while backgrounded) — retrying can never succeed, and the
        // AuthGate redirect to /login is already on its way. Everything else gets one retry.
        retry: (failureCount, error) =>
          !(error instanceof Error && error.message.includes("Unauthorized")) && failureCount < 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
