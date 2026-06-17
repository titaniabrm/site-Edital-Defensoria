import "dotenv/config";
import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = process.env.ADMIN_PIN || "DGE-2026";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || ADMIN_PIN;
const MIN_PERFORMANCE_PERCENT = Number(process.env.MIN_PERFORMANCE_PERCENT || 70);
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "submissions.json");

const objectiveQuestions = [
  { id: 1, text: "O que e uma PETICAO INICIAL?", answer: 1, options: ["Documento que encerra o processo", "Documento que da inicio ao processo e apresenta o pedido", "Documento de defesa", "Documento de arquivamento"] },
  { id: 2, text: "O que e um DESPACHO?", answer: 1, options: ["Decisao final do caso", "Documento administrativo para andamento no processo", "Defesa apresentada pela parte", "Documento de arquivamento"] },
  { id: 3, text: "Caso nao existam provas suficientes para sustentar uma acusacao, o mais adequado e:", answer: 2, options: ["Aplicar punicao imediatamente", "Ignorar a falta de provas", "Solicitar mais diligencias ou producao de provas", "Encerrar imediatamente sem analise"] },
  { id: 4, text: "O que e uma MANIFESTACAO?", answer: 0, options: ["Documento utilizado para apresentar posicionamento ou esclarecimento no processo", "Documento de prisao", "Arquivamento automatico", "Documento administrativo militar apenas"] },
  { id: 5, text: "Qual e a funcao de uma DEFESA?", answer: 1, options: ["Acusar uma parte", "Garantir contraditorio e apresentar argumentos/provas", "Arquivar processo", "Aplicar punicao"] },
  { id: 6, text: "O principio da AMPLA DEFESA significa:", answer: 0, options: ["A parte pode apresentar argumentos e provas para se defender", "O processo deve ser rapido apenas", "Apenas autoridades podem se manifestar", "A defesa e opcional"] },
  { id: 7, text: "O que significa \"juntar aos autos\"?", answer: 2, options: ["Arquivar processo", "Aplicar penalidade", "Adicionar documentos ao processo", "Excluir provas"] },
  { id: 8, text: "O que e uma PROVA DOCUMENTAL?", answer: 1, options: ["Testemunho verbal apenas", "Documento ou registro que auxilia a comprovar fatos", "Opiniao pessoal", "Hipotese sem fundamento"] },
  { id: 9, text: "Se uma prova apresentar inconsistencias, deve-se:", answer: 2, options: ["Ignorar o problema", "Considera-la automaticamente verdadeira", "Verificar autenticidade e buscar esclarecimentos", "Arquivar imediatamente"] },
  { id: 10, text: "O que significa um pedido ser DEFERIDO?", answer: 1, options: ["Foi recusado", "Foi aprovado/aceito", "Foi arquivado", "Foi cancelado automaticamente"] },
  { id: 11, text: "O que significa um pedido ser INDEFERIDO?", answer: 2, options: ["Foi aceito", "Foi encaminhado", "Foi recusado", "Foi colocado em sigilo"] },
  { id: 12, text: "Qual e a funcao da fase de instrucao processual?", answer: 1, options: ["Encerrar o processo", "Produzir e analisar provas e informacoes", "Aplicar penalidades", "Arquivar documentos"] },
  { id: 13, text: "O CONTRADITORIO significa:", answer: 1, options: ["Apenas uma parte pode falar", "Direito das partes se manifestarem sobre fatos e provas", "O processo nao precisa de provas", "O processo pode terminar sem defesa"] },
  { id: 14, text: "O que deve orientar a analise de um processo?", answer: 2, options: ["Opiniao pessoal", "Pressa para finalizar", "Imparcialidade e analise dos fatos/provas", "Preferencia hierarquica"] },
  { id: 15, text: "Surgindo novas provas importantes durante a tramitacao, o correto e:", answer: 1, options: ["Ignorar", "Analisar e incluir no processo conforme procedimento", "Encerrar imediatamente", "Remover provas anteriores"] }
];

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })
  : null;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

app.get(["/admin", "/admin/"], (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function signSession(expiration) {
  return crypto
    .createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(String(expiration))
    .digest("hex");
}

function createAdminSession() {
  const expiration = Date.now() + 1000 * 60 * 60 * 8;
  return `${expiration}.${signSession(expiration)}`;
}

function isValidAdminSession(token) {
  if (!token || !String(token).includes(".")) return false;
  const [expiration, signature] = String(token).split(".");
  if (Number(expiration) < Date.now()) return false;
  const expected = signSession(expiration);
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function setAdminCookie(res) {
  const token = createAdminSession();
  res.setHeader("Set-Cookie", `admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
}

function clearAdminCookie(res) {
  res.setHeader("Set-Cookie", "admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function getAutomaticStatus(performancePercent, aiRiskAverage, aiHighRiskCount) {
  if (performancePercent < MIN_PERFORMANCE_PERCENT) return "Reprovado";
  if (aiRiskAverage >= 60 || aiHighRiskCount > 0) return "Em analise";
  return "Aprovado";
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ").length : 0;
}

function uniqueRatio(words) {
  return words.length ? new Set(words).size / words.length : 0;
}

function averageSentenceLength(value) {
  const sentences = String(value).split(/[.!?]+/).map((item) => item.trim()).filter(Boolean);
  return sentences.length
    ? sentences.reduce((sum, sentence) => sum + countWords(sentence), 0) / sentences.length
    : 0;
}

function repeatedPhraseScore(text) {
  const words = normalizeText(text).split(" ").filter(Boolean);
  const grams = new Map();
  for (let index = 0; index <= words.length - 3; index += 1) {
    const gram = words.slice(index, index + 3).join(" ");
    grams.set(gram, (grams.get(gram) || 0) + 1);
  }
  return [...grams.values()].filter((count) => count > 1).length;
}

function heuristicReview(answer, allAnswers) {
  const normalized = normalizeText(answer);
  const words = normalized ? normalized.split(" ") : [];
  const flags = [];
  let score = 0;
  const genericTerms = ["e importante ressaltar", "de forma clara e objetiva", "garantir a lisura", "analise cuidadosa", "procedimento adequado", "conforme os principios", "dessa forma", "em suma", "vale destacar", "fundamental para"];
  const processTerms = ["prova", "autos", "contraditorio", "defesa", "despacho", "parecer", "diligencia", "documento", "fatos", "processo"];
  const genericHits = genericTerms.filter((term) => normalized.includes(term)).length;
  const processHits = processTerms.filter((term) => normalized.includes(term)).length;
  const ratio = uniqueRatio(words);
  const avgSentence = averageSentenceLength(answer);
  const repeated = repeatedPhraseScore(answer);

  if (words.length < 18) {
    flags.push("Resposta muito curta para avaliacao segura.");
    score += 8;
  }
  if (words.length >= 55 && ratio < 0.58) {
    flags.push("Texto longo com baixa variedade de palavras.");
    score += 16;
  }
  if (genericHits >= 2) {
    flags.push("Uso frequente de expressoes genericas comuns em texto artificial.");
    score += 18;
  }
  if (words.length >= 35 && processHits <= 1) {
    flags.push("Resposta extensa com poucos termos especificos do processo.");
    score += 16;
  }
  if (avgSentence > 28) {
    flags.push("Frases muito longas e uniformes.");
    score += 12;
  }
  if (repeated >= 2) {
    flags.push("Repeticao de estruturas ou trechos semelhantes.");
    score += 14;
  }

  const start = words.slice(0, 4).join(" ");
  const sameStarts = allAnswers
    .map((item) => normalizeText(item).split(" ").slice(0, 4).join(" "))
    .filter((item) => item && item === start).length;

  if (sameStarts >= 3 && words.length > 10) {
    flags.push("Varias respostas comecam com a mesma estrutura.");
    score += 16;
  }

  return {
    score: Math.min(100, score),
    wordCount: words.length,
    uniqueRatio: Math.round(ratio * 100),
    flags
  };
}

function fallbackAiReview(subjectiveAnswers) {
  const allAnswers = subjectiveAnswers.map((item) => item.answer);
  const answers = subjectiveAnswers.map((item) => ({
    ...item,
    aiReview: heuristicReview(item.answer, allAnswers)
  }));
  return summarizeAiReview(answers, "heuristica-local", null);
}

function summarizeAiReview(answers, provider, raw) {
  const averageRisk = answers.length
    ? Math.round(answers.reduce((sum, item) => sum + Number(item.aiReview.score || 0), 0) / answers.length)
    : 0;
  return {
    provider,
    raw,
    answers,
    averageRisk,
    flaggedCount: answers.filter((item) => Number(item.aiReview.score || 0) >= 35).length,
    highRiskCount: answers.filter((item) => Number(item.aiReview.score || 0) >= 60).length
  };
}

function extractJson(text) {
  const source = String(text || "").trim();
  try {
    return JSON.parse(source);
  } catch {
    const match = source.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Groq nao retornou JSON.");
    return JSON.parse(match[0]);
  }
}

async function analyzeWithGroq(subjectiveAnswers) {
  if (!process.env.GROQ_API_KEY) {
    return fallbackAiReview(subjectiveAnswers);
  }

  const prompt = {
    role: "user",
    content: JSON.stringify({
      tarefa: "Analise respostas subjetivas de um edital para sinalizar possivel uso de IA. Nao reprove automaticamente. Retorne apenas JSON valido.",
      criterios: [
        "risco_ia de 0 a 100 por resposta",
        "marcar texto generico, uniforme, repetitivo, com pouca especificidade processual ou estilo artificial",
        "nao marcar como IA apenas por estar correto ou bem escrito",
        "incluir flags curtas em portugues"
      ],
      formato_obrigatorio: {
        answers: [
          {
            id: 16,
            score: 0,
            flags: ["motivo curto"],
            summary: "parecer curto"
          }
        ]
      },
      respostas: subjectiveAnswers.map(({ id, question, answer }) => ({ id, question, answer }))
    })
  };

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0,
        max_tokens: 2200,
        messages: [
          {
            role: "system",
            content: "Voce e uma banca avaliadora. Retorne somente JSON valido, sem markdown."
          },
          prompt
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Groq HTTP ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = extractJson(content);
    const reviewsById = new Map((parsed.answers || []).map((item) => [Number(item.id), item]));
    const allAnswers = subjectiveAnswers.map((item) => item.answer);

    const answers = subjectiveAnswers.map((item) => {
      const groqReview = reviewsById.get(Number(item.id));
      const local = heuristicReview(item.answer, allAnswers);
      const score = Math.max(0, Math.min(100, Number(groqReview?.score ?? local.score)));
      return {
        ...item,
        aiReview: {
          score,
          wordCount: local.wordCount,
          uniqueRatio: local.uniqueRatio,
          flags: Array.isArray(groqReview?.flags) && groqReview.flags.length ? groqReview.flags.slice(0, 5) : local.flags,
          summary: String(groqReview?.summary || "Analise automatica concluida.")
        }
      };
    });

    return summarizeAiReview(answers, "groq", data);
  } catch (error) {
    const fallback = fallbackAiReview(subjectiveAnswers);
    fallback.provider = `heuristica-local-groq-falhou: ${error.message}`;
    return fallback;
  }
}

function calculateObjectiveAnswers(receivedAnswers) {
  return objectiveQuestions.map((question) => {
    const received = receivedAnswers.find((item) => Number(item.id) === question.id);
    const selected = Number(received?.selected);
    return {
      id: question.id,
      question: question.text,
      selected: Number.isInteger(selected) ? selected : -1,
      selectedText: question.options[selected] ?? "",
      correctIndex: question.answer,
      correctText: question.options[question.answer],
      isCorrect: selected === question.answer
    };
  });
}

function validateSubmission(body) {
  const identity = body?.identity || {};
  const objectiveAnswers = Array.isArray(body?.objectiveAnswers) ? body.objectiveAnswers : [];
  const subjectiveAnswers = Array.isArray(body?.subjectiveAnswers) ? body.subjectiveAnswers : [];

  if (!identity.discord?.trim() || !identity.roblox?.trim() || !identity.tempoEb?.trim()) {
    throw new Error("Dados do candidato incompletos.");
  }
  if (objectiveAnswers.length !== objectiveQuestions.length) {
    throw new Error("Respostas objetivas incompletas.");
  }
  if (subjectiveAnswers.length !== 15 || subjectiveAnswers.some((item) => countWords(item.answer) < 5)) {
    throw new Error("Respostas subjetivas incompletas.");
  }

  return {
    identity: {
      discord: String(identity.discord).trim(),
      roblox: String(identity.roblox).trim(),
      tempoEb: String(identity.tempoEb).trim()
    },
    objectiveAnswers,
    subjectiveAnswers: subjectiveAnswers.map((item) => ({
      id: Number(item.id),
      question: String(item.question || ""),
      answer: String(item.answer || "").trim()
    }))
  };
}

async function readLocalSubmissions() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

async function writeLocalSubmissions(submissions) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(submissions, null, 2), "utf8");
}

function toDbRow(submission) {
  return {
    id: submission.id,
    created_at: submission.submittedAt,
    identity: submission.identity,
    objective_answers: submission.objectiveAnswers,
    subjective_answers: submission.subjectiveAnswers,
    objective_score: submission.objectiveScore,
    objective_total: submission.objectiveTotal,
    performance_percent: submission.performancePercent,
    status: submission.status,
    admin_note: submission.adminNote || "",
    ai_risk_average: submission.aiRiskAverage,
    ai_flagged_count: submission.aiFlaggedCount,
    ai_high_risk_count: submission.aiHighRiskCount,
    ai_provider: submission.aiProvider,
    ai_model: submission.aiModel,
    ai_raw: submission.aiRaw
  };
}

function fromDbRow(row) {
  return {
    id: row.id,
    submittedAt: row.created_at,
    identity: row.identity,
    objectiveAnswers: row.objective_answers,
    subjectiveAnswers: row.subjective_answers,
    objectiveScore: row.objective_score,
    objectiveTotal: row.objective_total,
    performancePercent: Number(row.performance_percent),
    status: row.status || getAutomaticStatus(Number(row.performance_percent), row.ai_risk_average, row.ai_high_risk_count),
    adminNote: row.admin_note || "",
    aiRiskAverage: row.ai_risk_average,
    aiFlaggedCount: row.ai_flagged_count,
    aiHighRiskCount: row.ai_high_risk_count,
    aiProvider: row.ai_provider,
    aiModel: row.ai_model
  };
}

async function saveSubmission(submission) {
  if (supabase) {
    const { error } = await supabase.from("defensoria_submissions").insert(toDbRow(submission));
    if (error) throw normalizeDatabaseError(error);
    return;
  }

  const submissions = await readLocalSubmissions();
  submissions.push(submission);
  await writeLocalSubmissions(submissions);
}

async function findDuplicateSubmission(identity) {
  const discord = normalizeText(identity.discord);
  const roblox = normalizeText(identity.roblox);
  const submissions = await listSubmissions();
  return submissions.find((submission) => (
    normalizeText(submission.identity?.discord) === discord ||
    normalizeText(submission.identity?.roblox) === roblox
  ));
}

async function getSubmissionById(id) {
  if (supabase) {
    const { data, error } = await supabase
      .from("defensoria_submissions")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw normalizeDatabaseError(error);
    return fromDbRow(data);
  }

  const submissions = await readLocalSubmissions();
  return submissions.find((submission) => submission.id === id);
}

async function updateAdminNote(id, adminNote) {
  if (supabase) {
    const { error } = await supabase
      .from("defensoria_submissions")
      .update({ admin_note: adminNote })
      .eq("id", id);
    if (error) throw normalizeDatabaseError(error);
    return;
  }

  const submissions = await readLocalSubmissions();
  const index = submissions.findIndex((submission) => submission.id === id);
  if (index === -1) throw new Error("Candidato nao encontrado.");
  submissions[index].adminNote = adminNote;
  await writeLocalSubmissions(submissions);
}

async function listSubmissions() {
  if (supabase) {
    const { data, error } = await supabase
      .from("defensoria_submissions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw normalizeDatabaseError(error);
    return data.map(fromDbRow);
  }

  const submissions = await readLocalSubmissions();
  return submissions
    .map((submission) => ({
      ...submission,
      status: submission.status || getAutomaticStatus(submission.performancePercent || ((submission.objectiveScore / submission.objectiveTotal) * 100), submission.aiRiskAverage, submission.aiHighRiskCount),
      adminNote: submission.adminNote || ""
    }))
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

function normalizeDatabaseError(error) {
  if (String(error?.message || "").includes("defensoria_submissions")) {
    return new Error("Tabela do Supabase nao encontrada. Rode o arquivo supabase-schema.sql no SQL Editor do Supabase.");
  }
  return error;
}

function writeSubmissionPdf(doc, submission) {
  const line = () => {
    doc.moveTo(42, doc.y + 6).lineTo(553, doc.y + 6).strokeColor("#d7ad5d").stroke();
    doc.moveDown();
  };

  doc.fillColor("#071a2b").fontSize(18).text("Defensoria-Geral do Exercito", { align: "center" });
  doc.fontSize(13).text("Relatorio individual do candidato", { align: "center" });
  line();

  doc.fillColor("#17212a").fontSize(11);
  doc.text(`Discord: ${submission.identity.discord}`);
  doc.text(`Roblox: ${submission.identity.roblox}`);
  doc.text(`Tempo no EB: ${submission.identity.tempoEb}`);
  doc.text(`Envio: ${new Date(submission.submittedAt).toLocaleString("pt-BR")}`);
  doc.text(`Status automatico: ${submission.status}`);
  doc.text(`Desempenho: ${submission.objectiveScore}/${submission.objectiveTotal} (${submission.performancePercent}%)`);
  doc.text(`Nota minima configurada: ${MIN_PERFORMANCE_PERCENT}%`);
  doc.text(`Risco medio IA: ${submission.aiRiskAverage}%`);
  doc.text(`Respostas com alerta: ${submission.aiFlaggedCount}`);
  doc.text(`Alto risco: ${submission.aiHighRiskCount}`);
  doc.text(`Observacao admin: ${submission.adminNote || "Sem observacao."}`);
  line();

  doc.fillColor("#071a2b").fontSize(13).text("Questoes objetivas");
  doc.fillColor("#17212a").fontSize(9);
  submission.objectiveAnswers.forEach((answer) => {
    doc.text(`${answer.id}. ${answer.isCorrect ? "Correta" : "Incorreta"} - Resposta: ${answer.selectedText || "Nao respondida"}`);
  });
  line();

  doc.fillColor("#071a2b").fontSize(13).text("Questoes subjetivas e analise IA");
  submission.subjectiveAnswers.forEach((answer) => {
    doc.moveDown(0.5);
    doc.fillColor("#071a2b").fontSize(10).text(`${answer.id}. ${answer.question}`);
    doc.fillColor("#17212a").fontSize(9).text(answer.answer, { continued: false });
    doc.fillColor("#65717b").text(`Risco IA: ${answer.aiReview.score}% | Palavras: ${answer.aiReview.wordCount} | Variedade: ${answer.aiReview.uniqueRatio}%`);
    if (answer.aiReview.flags?.length) {
      doc.text(`Sinais: ${answer.aiReview.flags.join("; ")}`);
    }
  });
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req);
  const hasSession = isValidAdminSession(cookies.admin_session);
  const hasPassword = req.header("x-admin-pin") === ADMIN_PIN;

  if (!hasSession && !hasPassword) {
    res.status(401).json({ error: "Senha administrativa invalida." });
    return;
  }

  if (hasPassword && !hasSession) {
    setAdminCookie(res);
  }

  next();
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    database: supabase ? "supabase" : "local-json",
    groqConfigured: Boolean(process.env.GROQ_API_KEY),
    model: GROQ_MODEL
  });
});

app.post("/api/admin/login", (req, res) => {
  if (String(req.body?.password || "") !== ADMIN_PIN) {
    res.status(401).json({ error: "Senha administrativa invalida." });
    return;
  }
  setAdminCookie(res);
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  clearAdminCookie(res);
  res.json({ ok: true });
});

app.get("/api/admin/session", (req, res) => {
  const cookies = parseCookies(req);
  res.json({ authenticated: isValidAdminSession(cookies.admin_session) });
});

app.post("/api/submissions", async (req, res) => {
  try {
    const valid = validateSubmission(req.body);
    const duplicate = await findDuplicateSubmission(valid.identity);
    if (duplicate) {
      res.status(409).json({
        error: "Ja existe um envio registrado com este Discord ou Roblox.",
        duplicateId: duplicate.id
      });
      return;
    }

    const objectiveAnswers = calculateObjectiveAnswers(valid.objectiveAnswers);
    const objectiveScore = objectiveAnswers.filter((item) => item.isCorrect).length;
    const objectiveTotal = objectiveQuestions.length;
    const performancePercent = Math.round((objectiveScore / objectiveTotal) * 10000) / 100;
    const aiReview = await analyzeWithGroq(valid.subjectiveAnswers);
    const status = getAutomaticStatus(performancePercent, aiReview.averageRisk, aiReview.highRiskCount);

    const submission = {
      id: crypto.randomUUID(),
      submittedAt: new Date().toISOString(),
      identity: valid.identity,
      objectiveAnswers,
      subjectiveAnswers: aiReview.answers,
      objectiveScore,
      objectiveTotal,
      performancePercent,
      status,
      adminNote: "",
      aiRiskAverage: aiReview.averageRisk,
      aiFlaggedCount: aiReview.flaggedCount,
      aiHighRiskCount: aiReview.highRiskCount,
      aiProvider: aiReview.provider,
      aiModel: aiReview.provider === "groq" ? GROQ_MODEL : null,
      aiRaw: aiReview.raw
    };

    await saveSubmission(submission);
    res.status(201).json({
      id: submission.id,
      objectiveScore,
      objectiveTotal,
      performancePercent,
      aiRiskAverage: submission.aiRiskAverage,
      aiFlaggedCount: submission.aiFlaggedCount,
      aiHighRiskCount: submission.aiHighRiskCount,
      status,
      aiProvider: submission.aiProvider
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Nao foi possivel salvar o envio." });
  }
});

app.get("/api/admin/submissions", requireAdmin, async (req, res) => {
  try {
    res.json(await listSubmissions());
  } catch (error) {
    res.status(500).json({ error: error.message || "Erro ao listar envios." });
  }
});

app.patch("/api/admin/submissions/:id/note", requireAdmin, async (req, res) => {
  try {
    const adminNote = String(req.body?.adminNote || "").slice(0, 3000);
    await updateAdminNote(req.params.id, adminNote);
    res.json({ ok: true, adminNote });
  } catch (error) {
    res.status(500).json({ error: error.message || "Erro ao salvar observacao." });
  }
});

app.get("/api/admin/submissions/:id/report.pdf", requireAdmin, async (req, res) => {
  try {
    const submission = await getSubmissionById(req.params.id);
    if (!submission) {
      res.status(404).json({ error: "Candidato nao encontrado." });
      return;
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="relatorio-${submission.identity.discord || submission.id}.pdf"`);

    const doc = new PDFDocument({ margin: 42, size: "A4" });
    doc.pipe(res);
    writeSubmissionPdf(doc, submission);
    doc.end();
  } catch (error) {
    res.status(500).json({ error: error.message || "Erro ao gerar PDF." });
  }
});

app.delete("/api/admin/submissions", requireAdmin, async (req, res) => {
  try {
    if (supabase) {
      const { error } = await supabase
        .from("defensoria_submissions")
        .delete()
        .not("id", "is", null);
      if (error) throw normalizeDatabaseError(error);
    } else {
      await writeLocalSubmissions([]);
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || "Erro ao limpar envios." });
  }
});

app.listen(PORT, () => {
  console.log(`Edital Defensoria em http://127.0.0.1:${PORT}`);
  console.log(`Banco ativo: ${supabase ? "Supabase" : "JSON local"}`);
});
