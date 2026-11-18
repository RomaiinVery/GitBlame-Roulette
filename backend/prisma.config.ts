import "dotenv/config";
import { defineConfig } from "prisma/config";

// `process.env` plutôt que `env()` : `prisma generate` (postinstall, CI) doit
// fonctionner sans base de données. Seules les migrations ont besoin de l'URL.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
