import { errorContext, type Logger } from "../logger.js";

/**
 * Exécute des tâches après avoir répondu au webhook (Sentry coupe au bout d'une
 * seconde, l'IA prend son temps pour trouver la bonne excuse).
 * `drain()` sert à l'arrêt propre et aux tests.
 */
export class BackgroundTasks {
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly logger: Logger) {}

  run(name: string, task: () => Promise<unknown>): void {
    const promise = task()
      .then(() => undefined)
      .catch((error: unknown) => this.logger.error(`Tâche de fond "${name}" en échec`, errorContext(error)))
      .finally(() => this.pending.delete(promise));
    this.pending.add(promise);
  }

  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }
}
