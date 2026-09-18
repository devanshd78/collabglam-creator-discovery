/**
 * A newline-delimited JSON response: `work` sends progress events as it goes, and whatever it
 * returns (or throws) becomes the final `result` (or `error`) line. Used so a long discovery run
 * shows live progress instead of one silent request.
 */
export function ndjsonResponse(work: (send: (payload: unknown) => void) => Promise<unknown>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (payload: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          // The browser went away; the work still finishes and the run is still saved.
          open = false;
        }
      };
      try {
        send({ type: "result", result: await work(send) });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Discovery failed" });
      } finally {
        if (open) controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}
