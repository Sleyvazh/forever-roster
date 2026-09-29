import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

const png = (w: number, h: number, withExif = false) => {
  const img = sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 90, b: 20 } } });
  return (withExif ? img.withExif({ IFD0: { Artist: "secret", Copyright: "GPS 47.7N" } }) : img).png().toBuffer();
};
const upload = (c: Client, url: string, body: Buffer, type = "image/png") => c.req("PUT", url, body, { "content-type": type });

describe("images de compte et portraits", () => {
  it("ré-encode en WebP 200×200 sans métadonnées", async () => {
    const { c } = await signedIn(env);
    const r = await upload(c, "/api/account/avatar", await png(640, 480, true));
    expect(r.statusCode).toBe(200);
    const { avatarId } = r.json();
    expect((await c.get("/api/auth/me")).json().user.avatarId).toBe(avatarId);

    const img = await c.get(`/api/images/${avatarId}`);
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/webp");
    expect(img.headers["x-content-type-options"]).toBe("nosniff");
    const meta = await sharp(img.rawPayload).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 200, height: 200 });
    expect(meta.exif).toBeUndefined();

    // Un nouvel envoi remplace l'ancien fichier (nouvel identifiant, l'ancien n'existe plus)
    const again = (await upload(c, "/api/account/avatar", await png(300, 300))).json().avatarId;
    expect(again).not.toBe(avatarId);
    expect((await c.get(`/api/images/${avatarId}`)).statusCode).toBe(404);
    expect((await c.del("/api/account/avatar")).statusCode).toBe(200);
    expect((await c.get(`/api/images/${again}`)).statusCode).toBe(404);
  });

  it("refuse ce qui n'est pas une vraie image", async () => {
    const { c } = await signedIn(env);
    // Contenu HTML déguisé en PNG : la signature du fichier est vérifiée
    expect((await upload(c, "/api/account/avatar", Buffer.from("<script>alert(1)</script>"))).statusCode).toBe(400);
    // GIF : type non accepté
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    expect((await upload(c, "/api/account/avatar", gif, "image/gif")).statusCode).toBe(415);
    // Signature PNG valide mais fichier tronqué
    const broken = (await png(50, 50)).subarray(0, 60);
    expect((await upload(c, "/api/account/avatar", broken)).statusCode).toBe(400);
    // « Bombe de décompression » : petit fichier, image géante
    expect((await upload(c, "/api/account/avatar", await png(6000, 6000))).statusCode).toBe(400);
    // Trop lourd
    expect((await upload(c, "/api/account/avatar", Buffer.concat([await png(10, 10), Buffer.alloc(2.5 * 1024 * 1024)]))).statusCode).toBe(413);
    // Sans jeton CSRF
    expect((await c.req("PUT", "/api/account/avatar", await png(10, 10), { "content-type": "image/png", "x-csrf-token": "" })).statusCode).toBe(403);
  });

  it("portrait d'un perso : propriétaire seul pour modifier, groupe pour voir", async () => {
    const owner = await signedIn(env, "Portrait"), mate = await signedIn(env, "Coequipier"), outsider = await signedIn(env, "Etranger");
    const ch = (await owner.c.post("/api/characters", { name: "Tournicoti" })).json().character;
    expect((await upload(mate.c, `/api/characters/${ch.id}/portrait`, await png(200, 200))).statusCode).toBe(404);
    const { portraitId } = (await upload(owner.c, `/api/characters/${ch.id}/portrait`, await png(400, 400))).json();
    expect((await owner.c.get("/api/characters")).json().characters[0].portraitId).toBe(portraitId);

    // Hors groupe : 404, sans confirmer que l'image existe
    expect((await outsider.c.get(`/api/images/${portraitId}`)).statusCode).toBe(404);
    expect((await new Client(env).get(`/api/images/${portraitId}`)).statusCode).toBe(401);

    const g = (await owner.c.post("/api/groups", { name: "Portraits" })).json().group;
    const inv = (await owner.c.post(`/api/groups/${g.id}/invites`, { maxUses: 1, expiresInHours: 24 })).json().invite;
    await mate.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    expect((await mate.c.get(`/api/images/${portraitId}`)).statusCode).toBe(200);

    // Supprimer le perso supprime son portrait
    await owner.c.del(`/api/characters/${ch.id}`);
    expect((await owner.c.get(`/api/images/${portraitId}`)).statusCode).toBe(404);
  });
});
