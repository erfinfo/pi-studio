/**
 * Hub partagé entre l'extension pi (extensions/studio.ts) et le serveur web.
 * L'extension y dépose ses références (pi, ctx de commande) et y publie les
 * événements; le serveur les consomme. Module-level par design: le serveur est
 * un singleton qui survit aux remplacements de session.
 */

export interface HubState {
  /** ExtensionAPI de la session active (mis à jour à chaque factory run). */
  pi: unknown | null;
  /** Contexte de commande stashé (méthodes de contrôle de session). */
  ctx: unknown | null;
  /** Répertoire de travail de la session au démarrage du serveur. */
  cwd: string;
  /** Listeners d'événements pi (alimentés par l'extension). */
  listeners: Set<(event: unknown) => void>;
}

export const hub: HubState = {
  pi: null,
  ctx: null,
  cwd: process.cwd(),
  listeners: new Set(),
};

export function emitToWeb(event: unknown): void {
  for (const listener of hub.listeners) {
    try {
      listener(event);
    } catch {
      // Un listener en erreur ne doit jamais briser l'agent.
    }
  }
}
