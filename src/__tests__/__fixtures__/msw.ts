import type { HttpHandler } from "msw";
import { type SetupServer, setupServer } from "msw/node";

export interface ServerApi {
  start: () => void;
  reset: () => void;
  close: SetupServer["close"];
  overrideHandlers: (newHandlerCreators: (() => HttpHandler)[]) => void;
}

// Creator functions, not instances: a reset must rebuild handlers that close over
// per-test state, which `resetHandlers` alone would leave stale. Unhandled
// requests throw — a real network call escaping a test is a bug.
export const createServer = (
  handlerCreators: (() => HttpHandler)[],
): ServerApi => {
  const server = setupServer(
    ...handlerCreators.map((handlerCreator) => handlerCreator()),
  );

  return {
    start: () => {
      server.listen({ onUnhandledRequest: "error" });
    },
    reset: () => {
      server.resetHandlers(
        ...handlerCreators.map((handlerCreator) => handlerCreator()),
      );
    },
    overrideHandlers: (newHandlerCreators: (() => HttpHandler)[]) => {
      server.resetHandlers(
        ...newHandlerCreators.map((handlerCreator) => handlerCreator()),
        ...handlerCreators.map((handlerCreator) => handlerCreator()),
      );
    },
    close: () => {
      server.close();
    },
  };
};
