/** Erreur métier portant son code HTTP. Le middleware d'erreur s'occupe du reste. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what: string) => new HttpError(404, "NOT_FOUND", `${what} introuvable. Peut-être déjà blâmé·e et parti·e.`);

export const conflict = (code: string, message: string) => new HttpError(409, code, message);

export const unauthorized = (message = "Jeton invalide. Bien essayé.") => new HttpError(401, "UNAUTHORIZED", message);
