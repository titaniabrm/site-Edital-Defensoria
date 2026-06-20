import { describe, it, expect } from "vitest";
import {
  signSeed,
  verifySeedSignature,
  isValidAdminSession,
  createAdminSession,
  createSession,
  verifySession,
  hashIdentifier,
  shuffleWithSeed,
  jaccard,
  shingles
} from "../server.js";

describe("sessao unificada (candidato + admin)", () => {
  it("cria e verifica uma sessao de candidato comum", () => {
    const token = createSession({ discordId: "123", username: "fulano", isAdmin: false });
    const session = verifySession(token);
    expect(session).not.toBeNull();
    expect(session.username).toBe("fulano");
    expect(session.discordId).toBe("123");
    expect(session.isAdmin).toBe(false);
  });

  it("cria e verifica uma sessao de admin", () => {
    const token = createSession({ discordId: "999", username: "mudinhoxy", isAdmin: true });
    const session = verifySession(token);
    expect(session.isAdmin).toBe(true);
  });

  it("rejeita token adulterado", () => {
    const token = createSession({ username: "fulano", isAdmin: false });
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(verifySession(tampered)).toBeNull();
  });

  it("rejeita payload alterado sem ajustar assinatura", () => {
    const token = createSession({ username: "fulano", isAdmin: false });
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ username: "admin", isAdmin: true, exp: Date.now() + 999999 })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`)).toBeNull();
  });

  it("rejeita token vazio ou malformado", () => {
    expect(verifySession("")).toBeNull();
    expect(verifySession(null)).toBeNull();
    expect(verifySession("semponto")).toBeNull();
  });

  it("isValidAdminSession aceita apenas sessao com isAdmin true", () => {
    const adminToken = createSession({ username: "x", isAdmin: true });
    const userToken = createSession({ username: "y", isAdmin: false });
    expect(isValidAdminSession(adminToken)).toBe(true);
    expect(isValidAdminSession(userToken)).toBe(false);
  });

  it("createAdminSession continua funcionando (compat)", () => {
    expect(isValidAdminSession(createAdminSession())).toBe(true);
  });
});

describe("assinatura de seed (HMAC)", () => {
  it("aceita uma assinatura recem gerada", () => {
    const seed = "abc123";
    const issuedAt = Date.now();
    const sig = `${issuedAt}.${signSeed(seed, issuedAt)}`;
    expect(verifySeedSignature(seed, sig)).toBe(true);
  });

  it("rejeita assinatura de outro seed", () => {
    const issuedAt = Date.now();
    const sig = `${issuedAt}.${signSeed("seed-a", issuedAt)}`;
    expect(verifySeedSignature("seed-b", sig)).toBe(false);
  });

  it("rejeita assinatura expirada (mais de 6h)", () => {
    const seed = "abc123";
    const old = Date.now() - 7 * 60 * 60 * 1000;
    const sig = `${old}.${signSeed(seed, old)}`;
    expect(verifySeedSignature(seed, sig)).toBe(false);
  });

  it("rejeita lixo", () => {
    expect(verifySeedSignature("x", "")).toBe(false);
    expect(verifySeedSignature("x", "semponto")).toBe(false);
    expect(verifySeedSignature("", "1.abc")).toBe(false);
  });
});

describe("sessao admin", () => {
  it("aceita uma sessao recem criada", () => {
    expect(isValidAdminSession(createAdminSession())).toBe(true);
  });

  it("rejeita assinatura adulterada", () => {
    const token = createAdminSession();
    const [exp, sig] = token.split(".");
    const tampered = `${exp}.${sig.slice(0, -1)}${sig.endsWith("a") ? "b" : "a"}`;
    expect(isValidAdminSession(tampered)).toBe(false);
  });

  it("rejeita sessao expirada", () => {
    expect(isValidAdminSession("1.deadbeef")).toBe(false);
  });

  it("rejeita vazio ou malformado", () => {
    expect(isValidAdminSession("")).toBe(false);
    expect(isValidAdminSession("semponto")).toBe(false);
    expect(isValidAdminSession(null)).toBe(false);
  });
});

describe("hashIdentifier", () => {
  it("e deterministico", () => {
    expect(hashIdentifier("1.2.3.4")).toBe(hashIdentifier("1.2.3.4"));
  });
  it("difere por entrada", () => {
    expect(hashIdentifier("1.2.3.4")).not.toBe(hashIdentifier("5.6.7.8"));
  });
  it("nao expoe o valor original", () => {
    expect(hashIdentifier("192.168.0.1")).not.toContain("192");
  });
});

describe("embaralhamento por seed", () => {
  it("e deterministico para o mesmo seed", () => {
    const a = shuffleWithSeed([1, 2, 3, 4, 5], "seed-x");
    const b = shuffleWithSeed([1, 2, 3, 4, 5], "seed-x");
    expect(a).toEqual(b);
  });
  it("difere entre seeds", () => {
    const a = shuffleWithSeed([1, 2, 3, 4, 5, 6, 7, 8], "seed-x");
    const b = shuffleWithSeed([1, 2, 3, 4, 5, 6, 7, 8], "seed-y");
    expect(a).not.toEqual(b);
  });
});

describe("similaridade (jaccard/shingles)", () => {
  it("textos identicos tem alta similaridade", () => {
    const t = "o processo precisa de provas e contraditorio para garantir a defesa";
    expect(jaccard(shingles(t), shingles(t))).toBe(1);
  });
  it("textos diferentes tem baixa similaridade", () => {
    const a = shingles("o gato subiu no telhado durante a tarde de verao");
    const b = shingles("provas documentais sao essenciais para o devido processo legal");
    expect(jaccard(a, b)).toBeLessThan(0.2);
  });
});
