import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

// Équipe de démonstration. Toute ressemblance avec vos collègues est un signe.
const developers = [
  { name: "Alice Rollback", handle: "alice", slackUserId: "U0ALICE01", hiredAt: "2015-03-02", fatigueLevel: 20 },
  { name: "Bob Hotfix", handle: "bob", slackUserId: "U0BOBHF02", hiredAt: "2021-09-13", fatigueLevel: 65 },
  { name: "Chloé Stagiaire", handle: "chloe", slackUserId: "U0CHLOE03", hiredAt: "2026-09-01", fatigueLevel: 5 },
  { name: "David Legacy", handle: "david", slackUserId: "U0DAVID04", hiredAt: "2009-01-05", fatigueLevel: 90 },
  { name: "Eve Oncall", handle: "eve", slackUserId: "U0EVEOC05", hiredAt: "2019-06-17", fatigueLevel: 80 },
];

const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL manquant : impossible de semer la zizanie.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

try {
  for (const dev of developers) {
    const data = { ...dev, hiredAt: new Date(dev.hiredAt) };
    await prisma.developer.upsert({ where: { handle: dev.handle }, create: data, update: data });
  }
  console.log(`${developers.length} boucs émissaires potentiels prêts à servir.`);
} finally {
  await prisma.$disconnect();
}
