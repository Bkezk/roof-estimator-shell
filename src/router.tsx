import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
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
