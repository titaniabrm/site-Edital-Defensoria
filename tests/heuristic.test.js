import { describe, it, expect } from "vitest";
import {
  heuristicReview,
  buildSimilaritySummary,
  shuffleWithSeed,
  jaccard,
  shingles,
  withinExamWindow,
  buildExamForSession,
  fnv1a,
  mulberry32,
  normalizeQuestionsInput,
  answerVsModelSimilarity,
  highlightSuspectHtml
} from "../server.js";

describe("heuristicReview", () => {
  it("flags short answers", () => {
    const result = heuristicReview("Resposta curta", []);
    expect(result.flags.some((flag) => flag.includes("curta"))).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it("flags generic AI-like long answers", () => {
    const generic = "E importante ressaltar que de forma clara e objetiva o procedimento adequado conforme os principios deve ser seguido. Dessa forma vale destacar que e fundamental para garantir a lisura do trabalho. Em suma a analise cuidadosa e necessaria.";
    const result = heuristicReview(generic, []);
    expect(result.flags.length).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(30);
  });

  it("scores capped at 100", () => {
    const long = "palavra ".repeat(120);
    const result = heuristicReview(long, []);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("low risk for specific processual answer", () => {
    const answer = "A peticao inicial e o documento que apresenta o pedido nos autos do processo. Ela narra os fatos, junta provas e formula o pedido para o juiz analisar.";
    const result = heuristicReview(answer, []);
    expect(result.score).toBeLessThan(35);
  });
});

describe("buildSimilaritySummary", () => {
  it("detects high similarity between duplicated texts", () => {
    const current = [{ id: 16, answer: "O contraditorio garante que ambas as partes possam se manifestar nos autos do processo." }];
    const prior = [{
      id: "x",
      subjectiveAnswers: [{ id: 16, answer: "O contraditorio garante que ambas as partes possam se manifestar nos autos do processo." }],
      identity: { discord: "fulano" }
    }];
    const summary = buildSimilaritySummary(current, prior);
    expect(summary.maxRatio).toBeGreaterThan(60);
    expect(summary.perQuestion[0].matchedCandidate).toBe("fulano");
  });

  it("returns zero when no prior submissions", () => {
    const summary = buildSimilaritySummary([{ id: 16, answer: "qualquer texto longo aqui" }], []);
    expect(summary.maxRatio).toBe(0);
  });
});

describe("shuffleWithSeed", () => {
  it("is deterministic for the same seed", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = shuffleWithSeed(items, "alpha");
    const b = shuffleWithSeed(items, "alpha");
    expect(a).toEqual(b);
  });

  it("produces different orders for different seeds", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = shuffleWithSeed(items, "alpha").join(",");
    const b = shuffleWithSeed(items, "beta").join(",");
    expect(a).not.toBe(b);
  });
});

describe("jaccard / shingles", () => {
  it("returns 1 for identical text", () => {
    const a = shingles("o processo tem fases claras e definidas");
    const b = shingles("o processo tem fases claras e definidas");
    expect(jaccard(a, b)).toBe(1);
  });
  it("returns 0 for disjoint texts", () => {
    const a = shingles("alfa beta gama delta epsilon zeta eta teta");
    const b = shingles("um dois tres quatro cinco seis sete oito");
    expect(jaccard(a, b)).toBe(0);
  });
});

describe("withinExamWindow", () => {
  it("respects the configured ISO range", () => {
    const inside = withinExamWindow(new Date("2026-06-20T10:00:00Z"));
    const before = withinExamWindow(new Date("2026-06-18T10:00:00Z"));
    const after = withinExamWindow(new Date("2026-07-01T10:00:00Z"));
    expect(before).toBe(false);
    expect(inside).toBe(true);
    expect(after).toBe(false);
  });
});

describe("buildExamForSession", () => {
  it("returns 10 objectives with shuffled options containing originalIndex", () => {
    const exam = buildExamForSession("seed-test");
    expect(exam.objectives).toHaveLength(10);
    exam.objectives.forEach((q) => {
      expect(q.options).toHaveLength(4);
      q.options.forEach((option) => {
        expect(option).toHaveProperty("originalIndex");
        expect(option).toHaveProperty("text");
      });
    });
  });

  it("returns 20 subjectives without leaking the model answer to the candidate", () => {
    const exam = buildExamForSession("seed-test");
    expect(exam.subjectives).toHaveLength(20);
    exam.subjectives.forEach((q) => {
      expect(q).toHaveProperty("id");
      expect(q).toHaveProperty("text");
      // gabarito (modelAnswer) nunca pode ir para o candidato
      expect(q.modelAnswer).toBeUndefined();
    });
  });
});

describe("editor de perguntas (normalizeQuestionsInput)", () => {
  it("reatribui ids em sequencia: objetivas 1..N, subjetivas continuam", () => {
    const out = normalizeQuestionsInput({
      objective: [
        { text: "Q1", options: ["a", "b", "c", "d"], answer: 0 },
        { text: "Q2", options: ["a", "b", "c", "d"], answer: 3 }
      ],
      subjective: [{ text: "S1", modelAnswer: "gab" }]
    });
    expect(out.objective.map((q) => q.id)).toEqual([1, 2]);
    expect(out.subjective[0].id).toBe(3);
  });

  it("rejeita prova invalida", () => {
    expect(() => normalizeQuestionsInput({ objective: [], subjective: [{ text: "x" }] })).toThrow();
    expect(() => normalizeQuestionsInput({ objective: [{ text: "q", options: ["a", "b", "c"], answer: 0 }], subjective: [{ text: "s" }] })).toThrow();
    expect(() => normalizeQuestionsInput({ objective: [{ text: "q", options: ["a", "b", "c", "d"], answer: 9 }], subjective: [{ text: "s" }] })).toThrow();
  });
});

describe("comparacao com gabarito (answerVsModelSimilarity)", () => {
  it("100% para texto identico, 0% sem sobreposicao, null sem gabarito", () => {
    expect(answerVsModelSimilarity("prova autos defesa", "prova autos defesa")).toBe(100);
    expect(answerVsModelSimilarity("nada a ver aqui", "prova autos contraditorio")).toBe(0);
    expect(answerVsModelSimilarity("qualquer", null)).toBeNull();
  });
});

describe("destaque de trechos suspeitos de IA (highlightSuspectHtml)", () => {
  it("marca conectivos tipicos e escapa HTML perigoso", () => {
    const r = highlightSuspectHtml("Defendi o cliente. Em suma, e importante ressaltar a lisura.");
    expect(r.count).toBeGreaterThanOrEqual(1);
    expect(r.html).toContain("ai-suspect");
    const xss = highlightSuspectHtml("<script>alert(1)</script> em suma teste");
    expect(xss.html).not.toContain("<script>");
  });
  it("nao marca texto natural curto", () => {
    expect(highlightSuspectHtml("Defendi o cliente porque nao havia provas.").count).toBe(0);
  });
});

describe("rng primitives", () => {
  it("fnv1a returns same hash for same input", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
  });
  it("mulberry32 produces values in [0,1)", () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 50; i += 1) {
      const value = rand();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
