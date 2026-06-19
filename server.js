import "dotenv/config";
import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";
import pino from "pino";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = process.env.ADMIN_PIN || "DGE-2026";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || ADMIN_PIN;
const MIN_PERFORMANCE_PERCENT = Number(process.env.MIN_PERFORMANCE_PERCENT || 70);
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const EXAM_START_AT = process.env.EXAM_START_AT || "2026-06-19T15:00:00Z"; // 19/06/2026 12:00 BRT
const EXAM_END_AT = process.env.EXAM_END_AT || "2026-06-21T23:00:00Z";   // 21/06/2026 20:00 BRT
const MIN_FORM_DURATION_MS = Number(process.env.MIN_FORM_DURATION_MS || 30_000);
const HONEYPOT_FIELD = "middlename";

// URLs fixas (nao sao segredo, podem ficar no codigo).
// Se mudar a URL da Vercel, edite aqui ou sobrescreva por env var.
const DEFENSORIA_URL = process.env.DEFENSORIA_URL
  || "https://site-edital-defensoria-bly26wwtg-titaniabrm-1862s-projects.vercel.app";
const PUBLIC_ADMIN_URL = process.env.PUBLIC_ADMIN_URL
  || "https://edital-defensoria-painel-ppqjtkr6e-titaniabrm-1862s-projects.vercel.app";
const ADMIN_PANEL_ORIGIN = process.env.ADMIN_PANEL_ORIGIN || PUBLIC_ADMIN_URL;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI
  || `${DEFENSORIA_URL}/api/admin/discord/callback`;

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const DISCORD_ALLOWED_USERS = (process.env.DISCORD_ALLOWED_USERS || "mudinhoxy,titaniabrjv,yoursalf_.7")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "submissions.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const IP_HASH_SALT = process.env.IP_HASH_SALT || ADMIN_SESSION_SECRET;

if (ADMIN_PIN === "DGE-2026") {
  // eslint-disable-next-line no-console
  console.warn("[ATENCAO] ADMIN_PIN nao definido no .env - usando default fraco. Troque antes do deploy.");
}
if (ADMIN_PIN.length < 8) {
  // eslint-disable-next-line no-console
  console.warn("[ATENCAO] ADMIN_PIN com menos de 8 caracteres. Use uma senha forte.");
}

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { svc: "edital-defensoria" }
});

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

const subjectiveQuestions = [
  "Explique com suas palavras o que e uma PETICAO INICIAL.",
  "O que e um despacho e qual sua finalidade dentro de um processo?",
  "O que deve ser feito quando um processo nao possui provas suficientes?",
  "Explique o que e uma MANIFESTACAO processual.",
  "Qual a importancia da ampla defesa em um procedimento?",
  "O que significa agir com imparcialidade durante uma analise processual?",
  "Explique a diferenca entre despacho, decisao e sentenca.",
  "O que caracteriza uma prova valida em um processo?",
  "Qual a funcao da defesa dentro de um procedimento?",
  "O que deve ser analisado antes de emitir um parecer sobre um caso?",
  "Qual a importancia da organizacao documental em um processo?",
  "Como agir diante de informacoes contraditorias dentro de um caso?",
  "Explique a importancia dos prazos processuais.",
  "Qual deve ser a postura ideal de um membro da Defensoria durante a analise de um caso?",
  "Em suas palavras, explique a importancia da analise de provas dentro de um procedimento."
].map((text, index) => ({ id: index + 16, text }));

function fnv1a(value) {
  let hash = 0x811c9dc5;
  const str = String(value);
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithSeed(items, seedString) {
  const rand = mulberry32(fnv1a(seedString));
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildExamForSession(seed) {
  const objectives = shuffleWithSeed(objectiveQuestions, `${seed}|q`).map((question) => {
    const options = shuffleWithSeed(
      question.options.map((text, originalIndex) => ({ text, originalIndex })),
      `${seed}|q${question.id}|o`
    );
    return { id: question.id, text: question.text, options };
  });
  const subjectives = subjectiveQuestions.map((q) => ({ id: q.id, text: q.text }));
  return { objectives, subjectives, seed };
}

let runtimeConfig = {};

async function loadRuntimeConfig() {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("defensoria_config")
        .select("data")
        .eq("id", 1)
        .single();
      if (!error && data) runtimeConfig = data.data || {};
    } catch (e) {
      logger.warn({ err: e.message }, "config.load.supabase.failed");
    }
    return;
  }
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    runtimeConfig = JSON.parse(raw);
  } catch {
    runtimeConfig = {};
  }
}

async function saveRuntimeConfig(next) {
  if (supabase) {
    const { error } = await supabase
      .from("defensoria_config")
      .upsert({ id: 1, data: next, updated_at: new Date().toISOString() });
    if (error) throw normalizeDatabaseError(error);
  } else {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(next, null, 2), "utf8");
  }
  runtimeConfig = next;
}

function getExamStart() { return runtimeConfig.examStartAt || EXAM_START_AT; }
function getExamEnd() { return runtimeConfig.examEndAt || EXAM_END_AT; }
function getMinPerformance() {
  const v = Number(runtimeConfig.minPerformancePercent);
  return Number.isFinite(v) ? v : MIN_PERFORMANCE_PERCENT;
}
function getMinFormDuration() {
  const v = Number(runtimeConfig.minFormDurationMs);
  return Number.isFinite(v) ? v : MIN_FORM_DURATION_MS;
}
function getAllowedDiscord() {
  const list = runtimeConfig.discordAllowedUsers;
  return Array.isArray(list) && list.length ? list : DISCORD_ALLOWED_USERS;
}

function withinExamWindow(now = new Date()) {
  const start = new Date(getExamStart());
  const end = new Date(getExamEnd());
  return now >= start && now <= end;
}

function shingles(text, size = 4) {
  const tokens = normalizeText(text).split(" ").filter(Boolean);
  const set = new Set();
  if (tokens.length < size) return set;
  for (let i = 0; i <= tokens.length - size; i += 1) {
    set.add(tokens.slice(i, i + size).join(" "));
  }
  return set;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function buildSimilaritySummary(currentAnswers, priorSubmissions) {
  const perQuestion = currentAnswers.map((answer) => {
    const sourceShingles = shingles(answer.answer);
    let best = { ratio: 0, candidate: null, candidateId: null };
    for (const prior of priorSubmissions) {
      const priorAnswer = prior.subjectiveAnswers?.find((item) => Number(item.id) === Number(answer.id));
      if (!priorAnswer) continue;
      const ratio = jaccard(sourceShingles, shingles(priorAnswer.answer));
      if (ratio > best.ratio) {
        best = {
          ratio,
          candidate: prior.identity?.discord || prior.identity?.roblox || prior.id,
          candidateId: prior.id
        };
      }
    }
    return {
      id: answer.id,
      bestRatio: Math.round(best.ratio * 100),
      matchedCandidate: best.candidate,
      matchedSubmissionId: best.candidateId
    };
  });
  const maxRatio = perQuestion.reduce((max, item) => Math.max(max, item.bestRatio), 0);
  const flagged = perQuestion.filter((item) => item.bestRatio >= 55).length;
  return { perQuestion, maxRatio, flagged };
}

function newStatusEntry(status, note, by) {
  return {
    status,
    at: new Date().toISOString(),
    note: note ? String(note).slice(0, 400) : "",
    by: by || "admin"
  };
}

const magicLinkStore = new Map();

function createMagicLink() {
  const token = crypto.randomBytes(24).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = Date.now() + 30 * 60 * 1000;
  magicLinkStore.set(hash, { expiresAt, used: false });
  return { token, expiresAt };
}

function consumeMagicLink(token) {
  if (!token) return false;
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const entry = magicLinkStore.get(hash);
  if (!entry || entry.used || Date.now() > entry.expiresAt) return false;
  entry.used = true;
  return true;
}

async function notifyDiscord(submission, baseUrl) {
  if (!DISCORD_WEBHOOK_URL) return;
  const target = baseUrl ? `${baseUrl.replace(/\/$/, "")}/admin` : (PUBLIC_ADMIN_URL || "");
  const payload = {
    username: "Defensoria-Geral do Exercito",
    embeds: [{
      title: "Novo envio registrado",
      url: target || undefined,
      color: 0xd7ad5d,
      fields: [
        { name: "Discord", value: submission.identity.discord || "-", inline: true },
        { name: "Roblox", value: submission.identity.roblox || "-", inline: true },
        { name: "Tempo no EB", value: submission.identity.tempoEb || "-", inline: true },
        { name: "Objetivas", value: `${submission.objectiveScore}/${submission.objectiveTotal} (${submission.performancePercent}%)`, inline: true },
        { name: "Risco IA medio", value: `${submission.aiRiskAverage}%`, inline: true },
        { name: "Status", value: submission.status, inline: true }
      ],
      timestamp: submission.submittedAt
    }]
  };
  try {
    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) logger.warn({ status: response.status }, "discord webhook nao OK");
  } catch (error) {
    logger.warn({ err: error.message }, "discord webhook falhou");
  }
}

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })
  : null;

const app = express();
app.use(express.json({ limit: "1mb" }));

// Cabecalhos basicos de seguranca (substitui helmet sem dependencia extra).
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

// CORS para o painel admin separado.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (ADMIN_PANEL_ORIGIN === "*" || origin === ADMIN_PANEL_ORIGIN)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,x-admin-pin");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.use(express.static(__dirname, {
  extensions: ["html"],
  maxAge: process.env.VERCEL === "1" ? "1h" : 0
}));

app.get("/styles.css", (req, res) => {
  res.type("text/css").sendFile(path.join(__dirname, "styles.css"));
});

app.get("/app.js", (req, res) => {
  res.type("text/javascript").sendFile(path.join(__dirname, "app.js"));
});

app.get("/manifest.json", (req, res) => {
  res.type("application/manifest+json").sendFile(path.join(__dirname, "manifest.json"));
});

app.get("/sw.js", (req, res) => {
  res.type("text/javascript").sendFile(path.join(__dirname, "sw.js"));
});

app.get("/assets/:file", (req, res) => {
  const safe = path.basename(String(req.params.file || ""));
  res.sendFile(path.join(__dirname, "assets", safe));
});

app.get(["/admin", "/admin/"], (req, res) => {
  const token = String(req.query?.token || "");
  if (token && consumeMagicLink(token)) {
    setAdminCookie(res);
    logger.info({ event: "magic.consumed" }, "magic link usado");
    if (PUBLIC_ADMIN_URL) {
      res.redirect(`${PUBLIC_ADMIN_URL.replace(/\/$/, "")}/?token=consumed`);
      return;
    }
  }
  if (PUBLIC_ADMIN_URL) {
    res.redirect(PUBLIC_ADMIN_URL);
    return;
  }
  res.status(410).type("text/plain").send(
    "O painel administrativo agora roda em um projeto separado.\n" +
    "Defina PUBLIC_ADMIN_URL para redirecionar automaticamente."
  );
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
  if (!expiration || !signature || Number(expiration) < Date.now()) return false;
  const expected = signSession(expiration);
  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length === 0 || sigBuf.length !== expBuf.length) return false;
  try {
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

function setAdminCookie(res) {
  const token = createAdminSession();
  res.setHeader("Set-Cookie", `admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
}

function clearAdminCookie(res) {
  res.setHeader("Set-Cookie", "admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function getAutomaticStatus(performancePercent, aiRiskAverage, aiHighRiskCount) {
  if (performancePercent < getMinPerformance()) return "Reprovado";
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

export {
  heuristicReview,
  fallbackAiReview,
  buildSimilaritySummary,
  shuffleWithSeed,
  mulberry32,
  fnv1a,
  jaccard,
  shingles,
  withinExamWindow,
  buildExamForSession
};

function validateSubmission(body) {
  const identity = body?.identity || {};
  const objectiveAnswers = Array.isArray(body?.objectiveAnswers) ? body.objectiveAnswers : [];
  const subjectiveAnswers = Array.isArray(body?.subjectiveAnswers) ? body.subjectiveAnswers : [];

  if (String(body?.[HONEYPOT_FIELD] || "").trim()) {
    throw new Error("Envio rejeitado.");
  }
  const startedAtRaw = body?.formStartedAt ? new Date(body.formStartedAt) : null;
  if (!startedAtRaw || Number.isNaN(startedAtRaw.getTime())) {
    throw new Error("Sessao invalida. Recarregue a pagina.");
  }
  if (Date.now() - startedAtRaw.getTime() < getMinFormDuration()) {
    throw new Error("Envio muito rapido. Releia as questoes antes de enviar.");
  }
  if (!withinExamWindow()) {
    throw new Error("Fora do periodo do edital.");
  }

  if (!identity.discord?.trim() || !identity.roblox?.trim() || !identity.tempoEb?.trim()) {
    throw new Error("Dados do candidato incompletos.");
  }
  if (objectiveAnswers.length !== objectiveQuestions.length) {
    throw new Error("Respostas objetivas incompletas.");
  }
  if (subjectiveAnswers.length !== subjectiveQuestions.length || subjectiveAnswers.some((item) => countWords(item.answer) < 5)) {
    throw new Error("Respostas subjetivas incompletas.");
  }

  const seed = String(body?.seed || "").slice(0, 80);
  const seedSignature = String(body?.seedSignature || "");
  if (!verifySeedSignature(seed, seedSignature)) {
    throw new Error("Sessao invalida ou expirada. Recarregue a pagina.");
  }

  const normalizedObjective = objectiveAnswers.map((item) => {
    const selected = Number.isInteger(Number(item.selectedOriginalIndex))
      ? Number(item.selectedOriginalIndex)
      : Number(item.selected);
    return {
      id: Number(item.id),
      selected,
      timeSpentMs: Math.max(0, Number(item.timeSpentMs) || 0)
    };
  });

  return {
    identity: {
      discord: String(identity.discord).trim(),
      roblox: String(identity.roblox).trim(),
      tempoEb: String(identity.tempoEb).trim()
    },
    objectiveAnswers: normalizedObjective,
    subjectiveAnswers: subjectiveAnswers.map((item) => ({
      id: Number(item.id),
      question: String(item.question || ""),
      answer: String(item.answer || "").trim(),
      pasteDetected: Boolean(item.pasteDetected),
      timeSpentMs: Math.max(0, Number(item.timeSpentMs) || 0)
    })),
    seed,
    startedAt: startedAtRaw.toISOString()
  };
}

function hashIdentifier(value) {
  return crypto.createHash("sha256").update(`${IP_HASH_SALT}|${value}`).digest("hex").slice(0, 24);
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
    status_history: submission.statusHistory || [],
    seed: submission.seed || null,
    started_at: submission.startedAt || null,
    similarity_summary: submission.similaritySummary || null,
    ai_risk_average: submission.aiRiskAverage,
    ai_flagged_count: submission.aiFlaggedCount,
    ai_high_risk_count: submission.aiHighRiskCount,
    ai_provider: submission.aiProvider,
    ai_model: submission.aiModel,
    ai_raw: submission.aiRaw,
    tags: submission.tags || [],
    ip_hash: submission.ipHash || null,
    ua_hash: submission.uaHash || null,
    paste_count: submission.pasteCount || 0
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
    statusHistory: row.status_history || [],
    seed: row.seed || null,
    startedAt: row.started_at || null,
    similaritySummary: row.similarity_summary || null,
    aiRiskAverage: row.ai_risk_average,
    aiFlaggedCount: row.ai_flagged_count,
    aiHighRiskCount: row.ai_high_risk_count,
    aiProvider: row.ai_provider,
    aiModel: row.ai_model,
    tags: row.tags || [],
    ipHash: row.ip_hash || null,
    uaHash: row.ua_hash || null,
    pasteCount: row.paste_count || 0
  };
}

async function saveSubmission(submission) {
  if (supabase) {
    const { error } = await supabase.from("defensoria_submissions").insert(toDbRow(submission));
    if (error) throw normalizeDatabaseError(error);
    return;
  }

  if (process.env.VERCEL === "1") {
    throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variaveis de ambiente da Vercel.");
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

async function updateSubmissionStatus(id, status, note, by) {
  const entry = newStatusEntry(status, note, by);
  if (supabase) {
    const { data: existing, error: readError } = await supabase
      .from("defensoria_submissions")
      .select("status_history")
      .eq("id", id)
      .single();
    if (readError) throw normalizeDatabaseError(readError);
    const history = Array.isArray(existing?.status_history) ? existing.status_history : [];
    history.push(entry);
    const { error } = await supabase
      .from("defensoria_submissions")
      .update({ status, status_history: history })
      .eq("id", id);
    if (error) throw normalizeDatabaseError(error);
    return entry;
  }

  const submissions = await readLocalSubmissions();
  const index = submissions.findIndex((submission) => submission.id === id);
  if (index === -1) throw new Error("Candidato nao encontrado.");
  submissions[index].status = status;
  submissions[index].statusHistory = [...(submissions[index].statusHistory || []), entry];
  await writeLocalSubmissions(submissions);
  return entry;
}

async function updateAdminNote(id, adminNote, tags) {
  const safeTags = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12) : undefined;
  if (supabase) {
    const update = { admin_note: adminNote };
    if (safeTags) update.tags = safeTags;
    const { error } = await supabase
      .from("defensoria_submissions")
      .update(update)
      .eq("id", id);
    if (error) throw normalizeDatabaseError(error);
    return;
  }

  const submissions = await readLocalSubmissions();
  const index = submissions.findIndex((submission) => submission.id === id);
  if (index === -1) throw new Error("Candidato nao encontrado.");
  submissions[index].adminNote = adminNote;
  if (safeTags) submissions[index].tags = safeTags;
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
  doc.text(`Nota minima configurada: ${getMinPerformance()}%`);
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

function extractBearer(req) {
  const auth = String(req.header("authorization") || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req);
  const bearer = extractBearer(req);
  const hasSession = isValidAdminSession(cookies.admin_session) || isValidAdminSession(bearer);
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

function signSeed(seed, issuedAt) {
  return crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(`${seed}|${issuedAt}`).digest("hex");
}

function verifySeedSignature(seed, signature) {
  if (!seed || !signature || typeof signature !== "string") return false;
  const [issuedAt, sig] = signature.split(".");
  if (!issuedAt || !sig) return false;
  // Seed expira em 6h para evitar reuso de longo prazo
  if (Date.now() - Number(issuedAt) > 1000 * 60 * 60 * 6) return false;
  const expected = signSeed(seed, issuedAt);
  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length) return false;
  try {
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

app.get("/api/exam", async (req, res) => {
  await ensureConfig();
  const seed = crypto.randomBytes(12).toString("hex");
  const exam = buildExamForSession(seed);
  const issuedAt = Date.now();
  res.json({
    seed,
    seedSignature: `${issuedAt}.${signSeed(seed, issuedAt)}`,
    serverNow: new Date().toISOString(),
    examStartAt: getExamStart(),
    examEndAt: getExamEnd(),
    isOpen: withinExamWindow(),
    honeypotField: HONEYPOT_FIELD,
    minDurationMs: getMinFormDuration(),
    ...exam
  });
});

app.get("/api/config", async (req, res) => {
  await ensureConfig();
  res.json({
    examStartAt: getExamStart(),
    examEndAt: getExamEnd(),
    isOpen: withinExamWindow(),
    minPerformancePercent: getMinPerformance()
  });
});

app.get("/api/admin/config", requireAdmin, async (req, res) => {
  await ensureConfig();
  res.json({
    examStartAt: getExamStart(),
    examEndAt: getExamEnd(),
    minPerformancePercent: getMinPerformance(),
    minFormDurationMs: getMinFormDuration(),
    discordAllowedUsers: getAllowedDiscord(),
    isOpen: withinExamWindow(),
    serverNow: new Date().toISOString()
  });
});

app.patch("/api/admin/config", requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const next = { ...runtimeConfig };

    if (body.examStartAt !== undefined) {
      const d = new Date(body.examStartAt);
      if (Number.isNaN(d.getTime())) throw new Error("Data de inicio invalida.");
      next.examStartAt = d.toISOString();
    }
    if (body.examEndAt !== undefined) {
      const d = new Date(body.examEndAt);
      if (Number.isNaN(d.getTime())) throw new Error("Data de fim invalida.");
      next.examEndAt = d.toISOString();
    }
    if (next.examStartAt && next.examEndAt && new Date(next.examStartAt) >= new Date(next.examEndAt)) {
      throw new Error("Fim do edital precisa ser depois do inicio.");
    }
    if (body.minPerformancePercent !== undefined) {
      const v = Number(body.minPerformancePercent);
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error("Nota minima deve estar entre 0 e 100.");
      next.minPerformancePercent = Math.round(v);
    }
    if (body.minFormDurationMs !== undefined) {
      const v = Number(body.minFormDurationMs);
      if (!Number.isFinite(v) || v < 0 || v > 86_400_000) throw new Error("Duracao minima invalida.");
      next.minFormDurationMs = Math.round(v);
    }
    if (Array.isArray(body.discordAllowedUsers)) {
      next.discordAllowedUsers = body.discordAllowedUsers
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 50);
    }

    await saveRuntimeConfig(next);
    logger.info({ event: "config.updated", keys: Object.keys(body) }, "Config atualizada via painel");
    res.json({ ok: true, config: next });
  } catch (error) {
    logger.warn({ err: error.message }, "config.update.failed");
    res.status(400).json({ error: error.message || "Falha ao salvar configuracao." });
  }
});

app.post("/api/admin/magic", requireAdmin, (req, res) => {
  const { token, expiresAt } = createMagicLink();
  const baseUrl = PUBLIC_ADMIN_URL || `${req.protocol}://${req.get("host")}`;
  const url = `${baseUrl.replace(/\/$/, "")}/admin?token=${token}`;
  logger.info({ event: "magic.created", expiresAt }, "magic link gerado");
  if (DISCORD_WEBHOOK_URL) {
    fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Defensoria-Geral do Exercito",
        content: `Magic link admin (valido por 30 min):\n${url}`
      })
    }).catch((error) => logger.warn({ err: error.message }, "magic webhook falhou"));
  }
  res.json({ url, expiresAt });
});

app.get("/api/admin/metrics", requireAdmin, async (req, res) => {
  try {
    const submissions = await listSubmissions();
    const perDay = new Map();
    const riskBuckets = [0, 0, 0, 0, 0];
    const scoreBuckets = [0, 0, 0, 0, 0];
    submissions.forEach((item) => {
      const day = item.submittedAt?.slice(0, 10) || "?";
      perDay.set(day, (perDay.get(day) || 0) + 1);
      const riskBucket = Math.min(4, Math.floor(Number(item.aiRiskAverage || 0) / 20));
      riskBuckets[riskBucket] += 1;
      const score = (item.objectiveScore / item.objectiveTotal) * 100;
      const scoreBucket = Math.min(4, Math.floor(score / 20));
      scoreBuckets[scoreBucket] += 1;
    });
    res.json({
      total: submissions.length,
      perDay: [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)),
      riskBuckets,
      scoreBuckets
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Erro ao gerar metricas." });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    database: supabase ? "supabase" : "local-json",
    groqConfigured: Boolean(process.env.GROQ_API_KEY),
    model: GROQ_MODEL
  });
});

const loginRate = new Map();
const LOGIN_RATE_WINDOW_MS = 60 * 1000;
const LOGIN_RATE_MAX = 5;

function rateLimitLogin(req, res, next) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
  const now = Date.now();
  const entry = loginRate.get(ip) || { count: 0, reset: now + LOGIN_RATE_WINDOW_MS };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + LOGIN_RATE_WINDOW_MS;
  }
  entry.count += 1;
  loginRate.set(ip, entry);
  if (entry.count > LOGIN_RATE_MAX) {
    res.status(429).json({ error: "Muitas tentativas de login. Aguarde um minuto." });
    return;
  }
  next();
}

const discordStateStore = new Map();

app.get("/api/admin/discord/start", (req, res) => {
  if (!DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI || !DISCORD_CLIENT_SECRET) {
    res.status(503).json({ error: "Login Discord nao configurado no servidor." });
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  const returnTo = String(req.query?.return_to || ADMIN_PANEL_ORIGIN || PUBLIC_ADMIN_URL || "");
  discordStateStore.set(state, { createdAt: Date.now(), returnTo });
  for (const [k, v] of discordStateStore) {
    if (Date.now() - v.createdAt > 10 * 60 * 1000) discordStateStore.delete(k);
  }
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify",
    state,
    prompt: "consent"
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get("/api/admin/discord/callback", async (req, res) => {
  const fallbackTarget = ADMIN_PANEL_ORIGIN || PUBLIC_ADMIN_URL || "/";
  try {
    const code = String(req.query?.code || "");
    const state = String(req.query?.state || "");
    const stored = discordStateStore.get(state);
    discordStateStore.delete(state);
    if (!code || !stored) {
      throw new Error("Sessao OAuth invalida ou expirada.");
    }

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: DISCORD_REDIRECT_URI
      })
    });
    if (!tokenRes.ok) throw new Error(`Discord token HTTP ${tokenRes.status}`);
    const tokenData = await tokenRes.json();

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    if (!userRes.ok) throw new Error(`Discord user HTTP ${userRes.status}`);
    const user = await userRes.json();
    const username = String(user.username || "").toLowerCase();

    if (!getAllowedDiscord().includes(username)) {
      logger.warn({ event: "discord.unauthorized", username }, "Usuario Discord nao autorizado");
      const target = stored.returnTo || fallbackTarget;
      res.redirect(`${target.replace(/\/$/, "")}/?discord=unauthorized&user=${encodeURIComponent(user.username || "?")}`);
      return;
    }

    setAdminCookie(res);
    const adminToken = createAdminSession();
    const target = stored.returnTo || fallbackTarget;
    logger.info({ event: "discord.login", username }, "Login Discord OK");
    res.redirect(`${target.replace(/\/$/, "")}/?discord=ok&token=${encodeURIComponent(adminToken)}&user=${encodeURIComponent(user.username || "")}`);
  } catch (error) {
    logger.warn({ err: error.message }, "Discord login failed");
    res.redirect(`${fallbackTarget.replace(/\/$/, "")}/?discord=error&reason=${encodeURIComponent(error.message)}`);
  }
});

app.get("/api/admin/discord/status", (req, res) => {
  res.json({
    configured: Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_REDIRECT_URI),
    allowedCount: getAllowedDiscord().length
  });
});

app.post("/api/admin/login", rateLimitLogin, (req, res) => {
  const provided = String(req.body?.password || "");
  const a = Buffer.from(provided);
  const b = Buffer.from(ADMIN_PIN);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    res.status(401).json({ error: "Senha administrativa invalida." });
    return;
  }
  setAdminCookie(res);
  const token = createAdminSession();
  res.json({ ok: true, token });
});

app.post("/api/admin/logout", (req, res) => {
  clearAdminCookie(res);
  res.json({ ok: true });
});

app.get("/api/admin/session", (req, res) => {
  const cookies = parseCookies(req);
  res.json({ authenticated: isValidAdminSession(cookies.admin_session) });
});

const submissionRate = new Map();
const SUBMISSION_RATE_WINDOW_MS = 60 * 1000;
const SUBMISSION_RATE_MAX = 3;

function rateLimitSubmissions(req, res, next) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
    .toString()
    .split(",")[0]
    .trim();
  const now = Date.now();
  const entry = submissionRate.get(ip) || { count: 0, reset: now + SUBMISSION_RATE_WINDOW_MS };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + SUBMISSION_RATE_WINDOW_MS;
  }
  entry.count += 1;
  submissionRate.set(ip, entry);
  if (entry.count > SUBMISSION_RATE_MAX) {
    res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto antes de tentar de novo." });
    return;
  }
  next();
}

app.post("/api/submissions", rateLimitSubmissions, async (req, res) => {
  try {
    await ensureConfig();
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

    const priorSubmissions = await listSubmissions();
    const similaritySummary = buildSimilaritySummary(valid.subjectiveAnswers, priorSubmissions);

    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
      .toString().split(",")[0].trim();
    const ua = String(req.headers["user-agent"] || "unknown");
    // Reaplica paste/timing vindos do client nas respostas analisadas pela IA
    const subjectiveWithSignals = aiReview.answers.map((analyzed) => {
      const original = valid.subjectiveAnswers.find((item) => item.id === analyzed.id);
      return {
        ...analyzed,
        pasteDetected: original?.pasteDetected || false,
        timeSpentMs: original?.timeSpentMs || 0
      };
    });
    const pasteCount = subjectiveWithSignals.filter((item) => item.pasteDetected).length;

    const submission = {
      id: crypto.randomUUID(),
      submittedAt: new Date().toISOString(),
      identity: valid.identity,
      objectiveAnswers,
      subjectiveAnswers: subjectiveWithSignals,
      objectiveScore,
      objectiveTotal,
      performancePercent,
      status,
      adminNote: "",
      statusHistory: [newStatusEntry(status, "Status automatico", "system")],
      seed: valid.seed,
      startedAt: valid.startedAt,
      similaritySummary,
      aiRiskAverage: aiReview.averageRisk,
      aiFlaggedCount: aiReview.flaggedCount,
      aiHighRiskCount: aiReview.highRiskCount,
      aiProvider: aiReview.provider,
      aiModel: aiReview.provider === "groq" ? GROQ_MODEL : null,
      aiRaw: aiReview.raw,
      tags: [],
      ipHash: hashIdentifier(ip),
      uaHash: hashIdentifier(ua),
      pasteCount
    };

    await saveSubmission(submission);
    logger.info({
      event: "submission.created",
      id: submission.id,
      discord: submission.identity.discord,
      score: performancePercent,
      risk: submission.aiRiskAverage,
      simMax: similaritySummary.maxRatio,
      status
    }, "novo envio");
    const baseUrl = PUBLIC_ADMIN_URL || `${req.protocol}://${req.get("host")}`;
    notifyDiscord(submission, baseUrl);
    res.status(201).json({
      id: submission.id,
      objectiveScore,
      objectiveTotal,
      performancePercent,
      aiRiskAverage: submission.aiRiskAverage,
      aiFlaggedCount: submission.aiFlaggedCount,
      aiHighRiskCount: submission.aiHighRiskCount,
      similarityMax: similaritySummary.maxRatio,
      status,
      aiProvider: submission.aiProvider
    });
  } catch (error) {
    logger.warn({ err: error.message, stack: error.stack }, "submission.failed");
    const isValidation = [
      "Envio rejeitado.",
      "Sessao invalida. Recarregue a pagina.",
      "Envio muito rapido. Releia as questoes antes de enviar.",
      "Fora do periodo do edital.",
      "Dados do candidato incompletos.",
      "Respostas objetivas incompletas.",
      "Respostas subjetivas incompletas.",
      "Sessao invalida ou expirada. Recarregue a pagina."
    ].includes(error.message);
    res.status(isValidation ? 400 : 500).json({
      error: isValidation ? error.message : "Nao foi possivel salvar o envio. Tente novamente em instantes."
    });
  }
});

app.get("/api/admin/submissions", requireAdmin, async (req, res) => {
  try {
    res.json(await listSubmissions());
  } catch (error) {
    logger.error({ err: error.message }, "admin.list.failed");
    res.status(500).json({ error: "Erro ao listar envios. Verifique configuracao do banco." });
  }
});

app.patch("/api/admin/submissions/:id/status", requireAdmin, async (req, res) => {
  try {
    const status = String(req.body?.status || "").trim();
    if (!["Aprovado", "Reprovado", "Em analise"].includes(status)) {
      res.status(400).json({ error: "Status invalido." });
      return;
    }
    const note = String(req.body?.note || "");
    const entry = await updateSubmissionStatus(req.params.id, status, note, "admin");
    logger.info({ event: "submission.status", id: req.params.id, status }, "status atualizado");
    res.json({ ok: true, status, entry });
  } catch (error) {
    res.status(500).json({ error: error.message || "Erro ao atualizar status." });
  }
});

app.patch("/api/admin/submissions/:id/note", requireAdmin, async (req, res) => {
  try {
    const adminNote = String(req.body?.adminNote || "").slice(0, 3000);
    const tags = Array.isArray(req.body?.tags) ? req.body.tags : undefined;
    await updateAdminNote(req.params.id, adminNote, tags);
    res.json({ ok: true, adminNote, tags });
  } catch (error) {
    res.status(500).json({ error: error.message || "Erro ao salvar observacao." });
  }
});

app.get("/api/admin/report/approved.pdf", requireAdmin, async (req, res) => {
  try {
    const all = await listSubmissions();
    const approved = all.filter((item) => item.status === "Aprovado");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="aprovados-defensoria.pdf"`);
    const doc = new PDFDocument({ margin: 42, size: "A4" });
    doc.pipe(res);
    doc.fillColor("#071a2b").fontSize(18).text("Defensoria-Geral do Exercito", { align: "center" });
    doc.fontSize(13).text(`Aprovados (${approved.length})`, { align: "center" });
    doc.moveDown();
    approved.forEach((submission, index) => {
      if (index > 0) doc.addPage();
      writeSubmissionPdf(doc, submission);
    });
    if (!approved.length) {
      doc.fillColor("#17212a").fontSize(11).text("Nenhum candidato aprovado ainda.");
    }
    doc.end();
  } catch (error) {
    res.status(500).json({ error: error.message || "Erro ao gerar PDF consolidado." });
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

// Carrega configuracao mutavel (datas do edital etc).
// Em serverless cada invocacao re-importa o modulo; refreshamos a cada 60s
// para que mudancas feitas no painel apareçam em outras instancias.
const configBootPromise = loadRuntimeConfig().catch((e) => {
  logger.warn({ err: e.message }, "config.boot.failed");
});
let lastConfigRefresh = Date.now();
async function ensureConfig() {
  if (Date.now() - lastConfigRefresh > 60_000) {
    lastConfigRefresh = Date.now();
    await loadRuntimeConfig().catch(() => {});
  }
  return configBootPromise;
}

const isMainModule = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || import.meta.url.endsWith(path.basename(process.argv[1] || ""));
if (isMainModule && process.env.VERCEL !== "1" && process.env.NODE_ENV !== "test") {
  app.listen(PORT, async () => {
    await configBootPromise;
    logger.info({ port: PORT, database: supabase ? "supabase" : "local-json" }, "Edital Defensoria online");
  });
}

export default app;
