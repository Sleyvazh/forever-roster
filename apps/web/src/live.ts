import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/** Événement envoyé par le serveur quand quelque chose change (voir apps/api/src/lib/events.ts). */
export type LiveEvent =
  | { t: "raid"; g: string; r: string; by?: string | null; byName?: string | null }
  | { t: "raids"; g: string }
  | { t: "group"; g: string }
  | { t: "chars"; g: string }
  | { t: "membership" };

const LIVE = "fr-live";

/** Données à recharger pour chaque type d'événement (seules les requêtes affichées se rechargent). */
function refresh(qc: QueryClient, e: LiveEvent) {
  const inv = (queryKey: unknown[]) => void qc.invalidateQueries({ queryKey });
  switch (e.t) {
    case "raid": inv(["raids", e.g]); inv(["raid", e.r]); inv(["softres", e.r]); inv(["reach", e.r]); inv(["prep", e.r]); inv(["week"]); inv(["attendance", e.g]); break;
    case "raids": inv(["raids", e.g]); inv(["raid-templates", e.g]); inv(["raid"]); inv(["week"]); break;
    case "group": inv(["group", e.g]); inv(["orders", e.g]); inv(["groups"]); inv(["invites", e.g]); inv(["group-audit", e.g]); inv(["week"]); break;
    case "chars": inv(["group-chars", e.g]); inv(["crafters", e.g]); inv(["group", e.g]); inv(["item-sources"]); break;
    case "membership": inv(["groups"]); inv(["week"]); break;
  }
}

/**
 * Connexion en direct au serveur (Server-Sent Events) tant que l'utilisateur est connecté.
 * Le navigateur se reconnecte seul ; au retour, on recharge ce qui est affiché pour rattraper le temps perdu.
 */
export function useLiveEvents(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/events");
    let opened = false;
    es.onopen = () => { if (opened) void qc.invalidateQueries(); opened = true; };
    es.onmessage = msg => {
      let e: LiveEvent;
      try { e = JSON.parse(msg.data) as LiveEvent; } catch { return; }
      refresh(qc, e);
      window.dispatchEvent(new CustomEvent<LiveEvent>(LIVE, { detail: e }));
    };
    return () => es.close();
  }, [enabled, qc]);
}

/** Pour une page qui veut réagir elle-même à un événement (ex. la compo d'un raid). */
export function useLiveListener(fn: (e: LiveEvent) => void) {
  useEffect(() => {
    const h = (ev: Event) => fn((ev as CustomEvent<LiveEvent>).detail);
    window.addEventListener(LIVE, h);
    return () => window.removeEventListener(LIVE, h);
  }, [fn]);
}
