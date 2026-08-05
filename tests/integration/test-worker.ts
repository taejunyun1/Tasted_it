export default {
  async fetch(): Promise<Response> {
    return new Response("integration-test-worker");
  },
} satisfies ExportedHandler<Env>;
