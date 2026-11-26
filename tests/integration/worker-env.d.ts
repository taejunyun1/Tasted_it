declare module "cloudflare:workers" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
    MIGRATION_DB: D1Database;
    PILOT_TEST_PHOTOS: R2Bucket;
  }
}
