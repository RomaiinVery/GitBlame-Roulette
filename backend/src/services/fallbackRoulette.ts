import type { AlibiEngine, SpinRequest, SpinResult } from "../clients/aiService.js";

/**
 * Roulette de secours, utilisée quand l'ai-service ne répond pas.
 *
 * Volontairement rudimentaire : le vrai tirage pondéré (ChaosJustice™) appartient
 * à l'ai-service. Ici on se contente d'un poids « plus tu es fatigué, plus tu es
 * coupable », ce qui est scientifiquement prouvé par personne.
 */
export class FallbackRoulette implements AlibiEngine {
  static readonly ALIBIS = [
    "Un rayon cosmique a inversé un bit dans le cache Redis pendant le déploiement.",
    "La migration a été lancée en heure d'été mais validée en heure d'hiver.",
    "Le linter a auto-corrigé le code vers une version plus correcte mais moins fonctionnelle.",
    "Une dépendance transitive a publié un patch mineur contenant une philosophie majeure.",
    "Le feature flag était activé dans l'environnement de l'univers parallèle.",
    "Le load balancer a choisi un pod au hasard, et le hasard était mal luné.",
  ] as const;

  constructor(private readonly random: () => number = Math.random) {}

  async spin(request: SpinRequest): Promise<SpinResult> {
    const { candidates } = request;
    if (candidates.length === 0) throw new Error("Aucun candidat : impossible de blâmer le vide (pour l'instant).");

    const weights = candidates.map((candidate) => 1 + candidate.fatigueLevel / 25);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let ticket = this.random() * total;
    let index = 0;
    while (index < candidates.length - 1 && ticket >= weights[index]!) {
      ticket -= weights[index]!;
      index++;
    }

    const alibi = FallbackRoulette.ALIBIS[Math.floor(this.random() * FallbackRoulette.ALIBIS.length)]!;
    return {
      scapegoatId: candidates[index]!.id,
      alibi: `${alibi} (Alibi généré en mode dégradé : l'IA elle-même est en arrêt maladie.)`,
      probability: weights[index]! / total,
    };
  }
}
