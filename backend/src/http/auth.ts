import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { unauthorized } from "../domain/errors.js";

declare module "express-serve-static-core" {
  interface Request {
    /** Corps brut, conservé pour vérifier les signatures HMAC des webhooks. */
    rawBody?: Buffer;
  }
}

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

const hmacHex = (secret: string, body: Buffer) => createHmac("sha256", secret).update(body).digest("hex");

const bearerToken = (req: Request): string | undefined => {
  const header = req.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
};

/** Jeton partagé bot -> backend. Pas de jeton configuré = porte ouverte (dev local uniquement). */
export const requireApiToken =
  (apiToken: string | undefined) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!apiToken) return next();
    const token = bearerToken(req);
    next(token && safeEqual(token, apiToken) ? undefined : unauthorized());
  };

/** Sentry signe le corps brut avec le client secret de l'intégration (en-tête `sentry-hook-signature`). */
export const verifySentrySignature =
  (clientSecret: string | undefined) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!clientSecret) return next();
    const signature = req.get("sentry-hook-signature");
    const valid = signature && req.rawBody && safeEqual(signature, hmacHex(clientSecret, req.rawBody));
    next(valid ? undefined : unauthorized("Signature Sentry invalide. Ce n'est pas Sentry, c'est quelqu'un qui veut blâmer en douce."));
  };

/** CI : `Authorization: Bearer <secret>` ou signature GitHub `X-Hub-Signature-256`. */
export const verifyCiSecret =
  (secret: string | undefined) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!secret) return next();
    const token = bearerToken(req);
    if (token && safeEqual(token, secret)) return next();
    const githubSignature = req.get("x-hub-signature-256");
    if (githubSignature && req.rawBody && safeEqual(githubSignature, `sha256=${hmacHex(secret, req.rawBody)}`)) return next();
    next(unauthorized("Secret CI invalide."));
  };
