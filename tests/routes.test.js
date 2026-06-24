import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import app, { createSession } from "../server.js";

// Sobe o app Express num porto efemero e bate nas rotas com fetch real.
// Roda em modo local-JSON (sem Supabase) - limpamos os arquivos de dados no fim.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

let server;
let base;
const adminCookie = "dge_session=" + encodeURIComponent(createSession({ discordId: "1", username: "mudinhoxy", isAdmin: true }));
const candCookie = "dge_session=" + encodeURIComponent(createSession({ discordId: "2", username: "fulano", isAdmin: false }));

function url(p) { return `${base}${p}`; }

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  // Limpa qualquer arquivo de dado gerado pelos testes.
  for (const f of ["config.json", "submissions.json", "drafts.json", "audit.json"]) {
    try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch {}
  }
});

describe("rotas publicas", () => {
  it("GET /api/config responde com a config publica", async () => {
    const res = await fetch(url("/api/config"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("isOpen");
    expect(body).toHaveProperty("examStartAt");
  });

  it("GET /api/session sem cookie => nao autenticado", async () => {
    const res = await fetch(url("/api/session"));
    const body = await res.json();
    expect(body.authenticated).toBe(false);
  });

  it("GET /api/session com cookie de candidato => autenticado, nao admin", async () => {
    const res = await fetch(url("/api/session"), { headers: { Cookie: candCookie } });
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    expect(body.isAdmin).toBe(false);
  });
});

describe("gating de admin", () => {
  it("GET /api/admin/config sem auth => 401", async () => {
    const res = await fetch(url("/api/admin/config"));
    expect(res.status).toBe(401);
  });

  it("GET /api/admin/config com candidato (nao admin) => 401", async () => {
    const res = await fetch(url("/api/admin/config"), { headers: { Cookie: candCookie } });
    expect(res.status).toBe(401);
  });

  it("GET /api/admin/config com admin => 200 e traz as perguntas", async () => {
    const res = await fetch(url("/api/admin/config"), { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions.objective.length).toBeGreaterThan(0);
    expect(body.questions.subjective.length).toBeGreaterThan(0);
  });

  it("o PIN foi removido: POST /api/admin/login nao existe mais (404)", async () => {
    const res = await fetch(url("/api/admin/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "DGE-2026" })
    });
    expect(res.status).toBe(404);
  });

  it("header x-admin-pin nao da acesso admin", async () => {
    const res = await fetch(url("/api/admin/config"), { headers: { "x-admin-pin": "DGE-2026" } });
    expect(res.status).toBe(401);
  });
});

describe("funil e feedback", () => {
  it("GET /api/admin/funnel (admin) traz a estrutura do funil", async () => {
    const res = await fetch(url("/api/admin/funnel"), { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
    const f = await res.json();
    for (const k of ["started", "submitted", "decided", "approved"]) expect(f).toHaveProperty(k);
    expect(f.started).toBeGreaterThanOrEqual(f.submitted);
  });

  it("GET /api/admin/funnel exige admin (candidato => 401)", async () => {
    const res = await fetch(url("/api/admin/funnel"), { headers: { Cookie: candCookie } });
    expect(res.status).toBe(401);
  });

  it("POST /api/submission-feedback sem login => 401", async () => {
    const res = await fetch(url("/api/submission-feedback"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: 8 })
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/submission-feedback logado mas sem envio => 404", async () => {
    const res = await fetch(url("/api/submission-feedback"), {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: candCookie }, body: JSON.stringify({ rating: 8 })
    });
    expect(res.status).toBe(404);
  });
});

describe("excluir um envio", () => {
  it("DELETE /api/admin/submissions/:id exige admin", async () => {
    const res = await fetch(url("/api/admin/submissions/qualquer"), { method: "DELETE", headers: { Cookie: candCookie } });
    expect(res.status).toBe(401);
  });

  it("DELETE de id inexistente retorna erro tratado (admin)", async () => {
    const res = await fetch(url("/api/admin/submissions/inexistente"), { method: "DELETE", headers: { Cookie: adminCookie } });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("travar edicao de perguntas com edital aberto", () => {
  it("rejeita PATCH de perguntas quando o edital esta aberto", async () => {
    // Abre o edital (janela englobando agora).
    const past = new Date(Date.now() - 3600_000).toISOString();
    const future = new Date(Date.now() + 3600_000).toISOString();
    let res = await fetch(url("/api/admin/config"), {
      method: "PATCH", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ examStartAt: past, examEndAt: future })
    });
    expect(res.ok).toBe(true);

    // Agora tentar editar as perguntas deve falhar.
    res = await fetch(url("/api/admin/config"), {
      method: "PATCH", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ questions: { objective: [{ text: "x", options: ["a", "b", "c", "d"], answer: 0 }], subjective: [{ text: "y", modelAnswer: "z" }] } })
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(String(body.error || "")).toMatch(/edital/i);
  });
});
