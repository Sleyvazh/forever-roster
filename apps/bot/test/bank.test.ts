import { describe, expect, it, vi } from "vitest";
import type { BankNotice } from "../src/api";
import { createBankNotices, renderBankNotice } from "../src/bank";

const URL = "https://forever.test/groups/g/membres/banque";
const notice = (over: Partial<BankNotice> = {}): BankNotice => ({
  id: 1, discordUserId: "300000000000000002", kind: "prepared", item: "Major Healing Potion", quantity: 20, by: "Kaeldra", reason: "", groupName: "Les Lanternes", url: URL, ...over,
});
const log = () => ({ info: vi.fn(), warn: vi.fn() });

describe("MP de la banque : textes", () => {
  it("préparée : « est prête », à récupérer auprès de celui qui l'a préparée, avec un lien vers la banque", () => {
    const p = renderBankNotice(notice());
    expect(p.content).toBe("Ta demande de 20 × Major Healing Potion est prête : à récupérer auprès de Kaeldra.");
    expect(p.components).toEqual([{ type: 1, components: [{ type: 2, style: 5, label: "Voir la banque", url: URL }] }]);
  });

  it("élision devant une voyelle ou un h : « d'Offa », « d'Hélène »", () => {
    expect(renderBankNotice(notice({ by: "Offa" })).content).toBe("Ta demande de 20 × Major Healing Potion est prête : à récupérer auprès d'Offa.");
    expect(renderBankNotice(notice({ by: "Hélène" })).content).toContain("auprès d'Hélène.");
    expect(renderBankNotice(notice({ by: "Gorrak" })).content).toContain("auprès de Gorrak.");
  });

  it("refusée : « a été refusée », le motif quand il y en a un, rien d'autre sans motif", () => {
    expect(renderBankNotice(notice({ kind: "refused", reason: "réservé pour le raid de samedi" })).content)
      .toBe("Ta demande de 20 × Major Healing Potion a été refusée : réservé pour le raid de samedi.");
    expect(renderBankNotice(notice({ kind: "refused" })).content).toBe("Ta demande de 20 × Major Healing Potion a été refusée.");
  });

  it("un motif qui finit par une ponctuation ne double pas le point final ; un motif fait de ponctuation seule n'en est plus un", () => {
    const refused = (reason: string) => renderBankNotice(notice({ kind: "refused", reason })).content;
    expect(refused("Plus de stock.")).toBe("Ta demande de 20 × Major Healing Potion a été refusée : Plus de stock.");
    expect(refused("Réservé pour le raid !  ")).toBe("Ta demande de 20 × Major Healing Potion a été refusée : Réservé pour le raid.");
    expect(refused("Pourquoi pas plus tard ?")).toContain("refusée : Pourquoi pas plus tard.");
    expect(refused("on verra…")).toContain("refusée : on verra.");
    expect(refused("Trop demandé...")).toContain("refusée : Trop demandé.");
    expect(refused("...")).toBe("Ta demande de 20 × Major Healing Potion a été refusée.");
    expect(refused("  ")).toBe("Ta demande de 20 × Major Healing Potion a été refusée.");
  });

  it("noms et motifs sans mise en forme ni mention Discord", () => {
    const c = renderBankNotice(notice({ kind: "refused", item: "Oeil-de-tigre *rare*", reason: "demande @everyone _plus tard_" })).content;
    expect(c).toBe("Ta demande de 20 × Oeil\\-de\\-tigre \\*rare\\* a été refusée : demande @​everyone \\_plus tard\\_.");
    expect(renderBankNotice(notice({ by: "" })).content).toBe("Ta demande de 20 × Major Healing Potion est prête : à récupérer auprès d'un officier ou d'un banquier de la guilde.");
  });
});

describe("MP de la banque : relève", () => {
  it("un MP par avis, envoi confirmé au site ; MP fermés : abandonné sans confirmation, les suivants partent", async () => {
    const sent: string[] = [];
    const confirmed: number[] = [];
    const api = {
      claimBankNotices: vi.fn(async () => ({ notices: [notice({ id: 1 }), notice({ id: 2, discordUserId: "closed" }), notice({ id: 3, kind: "refused", reason: "non" })] })),
      bankNoticeSent: vi.fn(async (id: number) => { confirmed.push(id); return { ok: true as const }; }),
    };
    const sync = createBankNotices(api, async (to, p) => { sent.push(`${to}:${p.content}`); return to !== "closed"; }, log());
    await sync.tick();
    expect(sent).toHaveLength(3);
    expect(sent[2]).toBe("300000000000000002:Ta demande de 20 × Major Healing Potion a été refusée : non.");
    expect(confirmed).toEqual([1, 3]);
  });

  it("une confirmation qui échoue ne bloque pas les suivants ; pas deux relèves en même temps", async () => {
    const l = log();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const api = {
      claimBankNotices: vi.fn(async () => { await gate; return { notices: [notice({ id: 1 }), notice({ id: 2 })] }; }),
      bankNoticeSent: vi.fn(async (id: number) => { if (id === 1) throw new Error("API en panne"); return { ok: true as const }; }),
    };
    const dm = vi.fn(async () => true);
    const sync = createBankNotices(api, dm, l);
    const first = sync.tick();
    await sync.tick(); // relève déjà en cours : rien
    expect(api.claimBankNotices).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(dm).toHaveBeenCalledTimes(2);
    expect(api.bankNoticeSent).toHaveBeenCalledTimes(2);
    expect(l.warn).toHaveBeenCalledWith("Envoi du MP de la banque non confirmé (1)", "API en panne");
  });
});
