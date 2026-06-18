let objectiveQuestions = [];
let subjectiveQuestions = [];
let examSeed = "";
let formStartedAt = "";

const DRAFT_KEY = "dge_draft_v1";

let selectedSubmissionId = null;
let reviewUnlocked = false;
let loadedSubmissions = [];

const form = document.querySelector("#examForm");
const objectiveMount = document.querySelector("#objectiveQuestions");
const subjectiveMount = document.querySelector("#subjectiveQuestions");
const progressMetric = document.querySelector("#progressMetric");
const progressBar = document.querySelector("#progressBar");
const draftStatus = document.querySelector("#draftStatus");
const confirmation = document.querySelector("#confirmation");
const confirmationText = document.querySelector("#confirmationText");
const reviewDashboard = document.querySelector("#reviewDashboard");
const reviewLocked = document.querySelector("#reviewLocked");
const reviewShell = document.querySelector("#revisao");
const summaryGrid = document.querySelector("#summaryGrid");
const submissionList = document.querySelector("#submissionList");
const submissionDetail = document.querySelector("#submissionDetail");
const riskFilter = document.querySelector("#riskFilter");
const exportJsonButton = document.querySelector("#exportJsonButton");
const exportCsvButton = document.querySelector("#exportCsvButton");
const logoutAdminButton = document.querySelector("#logoutAdminButton");
const searchInput = document.querySelector("#searchInput");
const sortBy = document.querySelector("#sortBy");
const sectionProgress = document.querySelector("#sectionProgress");
const timeElapsed = document.querySelector("#timeElapsed");
const toastStack = document.querySelector("#toastStack");
const confirmModal = document.querySelector("#confirmModal");
const confirmModalSummary = document.querySelector("#confirmModalSummary");
const jumpPendingButton = document.querySelector("#jumpPendingButton");

let dirtyDraft = false;
let autoSaveTimer = null;
const startedAt = Date.now();

function toast(message, kind = "info", title = "") {
  if (!toastStack) {
    if (kind === "error") alert(message);
    return;
  }
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.innerHTML = `${title ? `<strong>${escapeHtml(title)}</strong>` : ""}<span>${escapeHtml(message)}</span>`;
  toastStack.appendChild(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transition = "opacity 200ms";
    setTimeout(() => node.remove(), 220);
  }, 4200);
}

function autoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (!dirtyDraft) return;
    saveDraft();
    dirtyDraft = false;
  }, 900);
}

function tickClock() {
  if (!timeElapsed) return;
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  timeElapsed.textContent = `Tempo: ${mm}:${ss}`;
}
const isAdminPage = window.location.pathname.replace(/\/$/, "") === "/admin" || window.location.hash === "#admin";

if (isAdminPage) {
  document.body.classList.add("admin-page");
  document.title = "Admin | Defensoria-Geral do Exercito";
  reviewShell?.classList.remove("hidden");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function renderQuestions() {
  objectiveMount.innerHTML = objectiveQuestions.map((question, qIndex) => `
    <article class="question-card" data-question-id="${question.id}">
      <div class="question-title">
        <h3>${qIndex + 1}. ${escapeHtml(question.text)}</h3>
        <span>Objetiva</span>
      </div>
      <div class="options-list" role="radiogroup" aria-label="${escapeHtml(question.text)}">
        ${question.options.map((option, displayIndex) => `
          <label class="option-row">
            <input type="radio" name="q${question.id}" value="${option.originalIndex}" required>
            <span>${String.fromCharCode(65 + displayIndex)}) ${escapeHtml(option.text)}</span>
          </label>
        `).join("")}
      </div>
    </article>
  `).join("");

  subjectiveMount.innerHTML = subjectiveQuestions.map((question, qIndex) => `
    <article class="question-card" data-question-id="${question.id}">
      <div class="question-title">
        <h3>${objectiveQuestions.length + qIndex + 1}. ${escapeHtml(question.text)}</h3>
        <span>Subjetiva</span>
      </div>
      <textarea name="q${question.id}" required minlength="25" placeholder="Digite sua resposta com suas palavras."></textarea>
      <div class="subjective-tools">
        <span class="answer-count" data-counter-for="q${question.id}">0 palavras</span>
        <span>Minimo recomendado: 25 palavras</span>
      </div>
    </article>
  `).join("");
}

function countWords(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ").length : 0;
}

function uniqueRatio(words) {
  if (!words.length) return 0;
  return new Set(words).size / words.length;
}

function averageSentenceLength(value) {
  const sentences = String(value).split(/[.!?]+/).map((item) => item.trim()).filter(Boolean);
  if (!sentences.length) return 0;
  return sentences.reduce((sum, sentence) => sum + countWords(sentence), 0) / sentences.length;
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

function analyzeSingleSubjectiveAnswer(answer, allAnswers) {
  const normalized = normalizeText(answer);
  const words = normalized ? normalized.split(" ") : [];
  const flags = [];
  let score = 0;

  const genericTerms = [
    "e importante ressaltar",
    "de forma clara e objetiva",
    "garantir a lisura",
    "analise cuidadosa",
    "procedimento adequado",
    "conforme os principios",
    "dessa forma",
    "em suma",
    "vale destacar",
    "fundamental para"
  ];

  const expectedProcessTerms = [
    "prova",
    "autos",
    "contraditorio",
    "defesa",
    "despacho",
    "parecer",
    "diligencia",
    "documento",
    "fatos",
    "processo"
  ];

  const genericHits = genericTerms.filter((term) => normalized.includes(term)).length;
  const processHits = expectedProcessTerms.filter((term) => normalized.includes(term)).length;
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

  const sameStarts = allAnswers
    .map((item) => normalizeText(item).split(" ").slice(0, 4).join(" "))
    .filter((start) => start && start === words.slice(0, 4).join(" ")).length;

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

function analyzeSubjectiveAnswers(answers) {
  const answerValues = answers.map((item) => item.answer);
  const analyzed = answers.map((item) => ({
    ...item,
    aiReview: analyzeSingleSubjectiveAnswer(item.answer, answerValues)
  }));

  const averageRisk = analyzed.length
    ? Math.round(analyzed.reduce((sum, item) => sum + item.aiReview.score, 0) / analyzed.length)
    : 0;

  const flaggedCount = analyzed.filter((item) => item.aiReview.score >= 35).length;
  const highRiskCount = analyzed.filter((item) => item.aiReview.score >= 60).length;

  return {
    answers: analyzed,
    averageRisk,
    flaggedCount,
    highRiskCount
  };
}

function riskLabel(score) {
  if (score >= 60) return { text: "Alto risco IA", className: "bad" };
  if (score >= 35) return { text: "Revisar IA", className: "warn" };
  return { text: "Baixo risco", className: "good" };
}

function statusLabel(status) {
  if (status === "Aprovado") return { text: "Aprovado", className: "good" };
  if (status === "Reprovado") return { text: "Reprovado", className: "bad" };
  return { text: "Em analise", className: "warn" };
}

function collectFormData() {
  const data = new FormData(form);
  const identity = {
    discord: String(data.get("discord") || "").trim(),
    roblox: String(data.get("roblox") || "").trim(),
    tempoEb: String(data.get("tempoEb") || "").trim()
  };

  const objectiveAnswers = objectiveQuestions.map((question) => ({
    id: question.id,
    selectedOriginalIndex: Number(data.get(`q${question.id}`))
  }));

  const subjectiveAnswers = subjectiveQuestions.map((question) => ({
    id: question.id,
    question: question.text,
    answer: String(data.get(`q${question.id}`) || "").trim()
  }));

  return {
    identity,
    objectiveAnswers,
    subjectiveAnswers,
    seed: examSeed,
    formStartedAt,
    middlename: String(data.get("middlename") || "")
  };
}

function saveDraft() {
  const data = new FormData(form);
  const draft = {};
  for (const [key, value] of data.entries()) {
    draft[key] = value;
  }
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  draftStatus.textContent = `Rascunho salvo as ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`;
}

function loadDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}");
    for (const [key, value] of Object.entries(draft)) {
      const fields = form.elements[key];
      if (!fields) continue;
      if (fields instanceof RadioNodeList) {
        const option = [...fields].find((item) => item.value === String(value));
        if (option) option.checked = true;
      } else {
        fields.value = value;
      }
    }
  } catch {
    localStorage.removeItem(DRAFT_KEY);
  }
}

function updateCounters() {
  document.querySelectorAll("textarea").forEach((textarea) => {
    const counter = document.querySelector(`[data-counter-for="${textarea.name}"]`);
    if (counter) counter.textContent = `${countWords(textarea.value)} palavras`;
  });
}

function updateProgress() {
  const requiredFields = [...form.querySelectorAll("[required]")];
  const completed = requiredFields.filter((field) => {
    if (field.type === "radio") {
      return Boolean(form.querySelector(`[name="${field.name}"]:checked`));
    }
    return String(field.value || "").trim().length > 0;
  });
  const uniqueRequired = new Set(requiredFields.map((field) => field.name));
  const completedUnique = new Set(completed.map((field) => field.name));
  const percent = uniqueRequired.size ? Math.round((completedUnique.size / uniqueRequired.size) * 100) : 0;
  progressMetric.textContent = `${percent}%`;
  progressBar.style.width = `${percent}%`;

  const identityFields = ["discord", "roblox", "tempoEb"];
  const identityDone = identityFields.filter((name) => String(form.elements[name]?.value || "").trim()).length;
  const objectiveDone = objectiveQuestions.filter((q) => form.querySelector(`[name="q${q.id}"]:checked`)).length;
  const subjectiveDone = subjectiveQuestions.filter((q) => {
    const value = form.elements[`q${q.id}`]?.value || "";
    return value.trim() && countWords(value) >= 5;
  }).length;

  const counts = { identidade: [identityDone, 3], objetivas: [objectiveDone, 15], subjetivas: [subjectiveDone, 15] };
  sectionProgress?.querySelectorAll("li").forEach((li) => {
    const [done, total] = counts[li.dataset.section];
    li.querySelector("strong").textContent = `${done}/${total}`;
    li.dataset.complete = done === total ? "true" : "false";
  });

  objectiveQuestions.forEach((q) => {
    const card = form.querySelector(`[name="q${q.id}"]`)?.closest(".question-card");
    if (card) card.dataset.answered = form.querySelector(`[name="q${q.id}"]:checked`) ? "true" : "false";
  });
  subjectiveQuestions.forEach((q) => {
    const ta = form.elements[`q${q.id}`];
    const card = ta?.closest(".question-card");
    if (card) card.dataset.answered = ta.value.trim() && countWords(ta.value) >= 5 ? "true" : "false";
  });
}

function jumpToNextPending() {
  const required = [...form.querySelectorAll("[required]")];
  const pending = required.find((field) => {
    if (field.type === "radio") return !form.querySelector(`[name="${field.name}"]:checked`);
    return !String(field.value || "").trim();
  });
  if (!pending) {
    toast("Todas as questoes ja foram respondidas.", "success");
    return;
  }
  const card = pending.closest(".question-card") || pending.closest("label") || pending;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  if (pending.focus) setTimeout(() => pending.focus(), 350);
}

function openConfirmModal() {
  const identity = ["discord", "roblox", "tempoEb"].filter((name) => String(form.elements[name]?.value || "").trim()).length;
  const objectiveDone = objectiveQuestions.filter((q) => form.querySelector(`[name="q${q.id}"]:checked`)).length;
  const subjectiveDone = subjectiveQuestions.filter((q) => {
    const value = form.elements[`q${q.id}`]?.value || "";
    return value.trim() && countWords(value) >= 5;
  }).length;

  const rows = [
    { label: "Identificacao", done: identity, total: 3 },
    { label: "Objetivas", done: objectiveDone, total: 15 },
    { label: "Subjetivas", done: subjectiveDone, total: 15 }
  ];
  confirmModalSummary.innerHTML = rows.map((row) => `
    <li class="${row.done === row.total ? "" : "missing"}">
      <span>${row.label}</span><strong>${row.done}/${row.total}</strong>
    </li>
  `).join("");
  confirmModal.classList.remove("hidden");
}

function closeConfirmModal() {
  confirmModal.classList.add("hidden");
}

function validateForm() {
  let valid = true;
  form.querySelectorAll(".invalid").forEach((field) => field.classList.remove("invalid"));

  ["discord", "roblox", "tempoEb"].forEach((name) => {
    const field = form.elements[name];
    if (!field.value.trim()) {
      field.classList.add("invalid");
      valid = false;
    }
  });

  objectiveQuestions.forEach((question) => {
    if (!form.querySelector(`[name="q${question.id}"]:checked`)) {
      form.querySelector(`[name="q${question.id}"]`)?.closest(".question-card")?.classList.add("invalid");
      valid = false;
    }
  });

  subjectiveQuestions.forEach((question) => {
    const field = form.elements[`q${question.id}`];
    if (!field.value.trim() || countWords(field.value) < 5) {
      field.classList.add("invalid");
      valid = false;
    }
  });

  if (!valid) {
    const target = form.querySelector(".invalid");
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return valid;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function renderSummary(submissions) {
  const total = submissions.length;
  const avgScore = total
    ? Math.round(submissions.reduce((sum, item) => sum + (item.objectiveScore / item.objectiveTotal) * 100, 0) / total)
    : 0;
  const avgRisk = total
    ? Math.round(submissions.reduce((sum, item) => sum + item.aiRiskAverage, 0) / total)
    : 0;
  const highRisk = submissions.filter((item) => item.aiHighRiskCount > 0 || item.aiRiskAverage >= 60).length;
  const approved = submissions.filter((item) => item.status === "Aprovado").length;
  const rejected = submissions.filter((item) => item.status === "Reprovado").length;
  const review = submissions.filter((item) => item.status === "Em analise").length;

  const scoreBuckets = [0, 0, 0, 0, 0];
  const riskBuckets = [0, 0, 0, 0, 0];
  submissions.forEach((item) => {
    const score = (item.objectiveScore / item.objectiveTotal) * 100;
    scoreBuckets[Math.min(4, Math.floor(score / 20))] += 1;
    riskBuckets[Math.min(4, Math.floor(Number(item.aiRiskAverage || 0) / 20))] += 1;
  });

  summaryGrid.innerHTML = `
    <div class="summary-card"><strong>${total}</strong><span>envios registrados</span></div>
    <div class="summary-card"><strong>${avgScore}%</strong><span>media nas objetivas</span></div>
    <div class="summary-card"><strong>${avgRisk}%</strong><span>media de risco IA</span></div>
    <div class="summary-card"><strong>${highRisk}</strong><span>candidatos com alerta alto</span></div>
    <div class="summary-card"><strong>${approved}</strong><span>aprovados</span></div>
    <div class="summary-card"><strong>${review}</strong><span>em analise</span></div>
    <div class="summary-card"><strong>${rejected}</strong><span>reprovados</span></div>
    <div class="summary-card chart-card">
      <span>distribuicao de % objetivas</span>
      ${renderBarChart(scoreBuckets, ["0-20", "20-40", "40-60", "60-80", "80-100"])}
    </div>
    <div class="summary-card chart-card">
      <span>distribuicao de risco IA</span>
      ${renderBarChart(riskBuckets, ["0-20", "20-40", "40-60", "60-80", "80-100"])}
    </div>
  `;
}

function renderBarChart(values, labels) {
  const max = Math.max(1, ...values);
  const bars = values.map((value, index) => {
    const height = Math.round((value / max) * 60);
    return `
      <g transform="translate(${index * 40 + 8}, 0)">
        <rect x="0" y="${70 - height}" width="28" height="${height}" rx="3"></rect>
        <text x="14" y="68" text-anchor="middle" class="bar-value">${value}</text>
        <text x="14" y="92" text-anchor="middle" class="bar-label">${labels[index]}</text>
      </g>
    `;
  }).join("");
  return `<svg class="bar-chart" viewBox="0 0 220 100" role="img">${bars}</svg>`;
}

function renderSubmissionList(submissions) {
  if (!submissions.length) {
    submissionList.innerHTML = `<div class="empty-state">Nenhum envio registrado ainda.</div>`;
    submissionDetail.innerHTML = `<div class="empty-state">Aguardando respostas dos candidatos.</div>`;
    return;
  }

  if (!selectedSubmissionId || !submissions.some((item) => item.id === selectedSubmissionId)) {
    selectedSubmissionId = submissions[0].id;
  }

  submissionList.innerHTML = submissions.map((submission) => {
    const risk = riskLabel(submission.aiRiskAverage);
    const status = statusLabel(submission.status);
    const percentage = Math.round((submission.objectiveScore / submission.objectiveTotal) * 100);
    return `
      <button class="submission-card ${submission.id === selectedSubmissionId ? "active" : ""}" type="button" data-submission-id="${submission.id}">
        <h3>${escapeHtml(submission.identity.discord || "Sem Discord")}</h3>
        <div class="submission-meta">
          <span class="pill">${percentage}% objetivas</span>
          <span class="pill ${status.className}">${status.text}</span>
          <span class="pill ${risk.className}">${risk.text}</span>
          <span class="pill">${formatDate(submission.submittedAt)}</span>
        </div>
      </button>
    `;
  }).join("");
}

function getFilteredSubmissions() {
  const filter = riskFilter?.value || "all";
  const sort = sortBy?.value || "date";
  const term = normalizeText(searchInput?.value || "");

  let submissions = [...loadedSubmissions];

  if (term) {
    submissions = submissions.filter((item) => {
      const haystack = normalizeText(`${item.identity?.discord || ""} ${item.identity?.roblox || ""}`);
      return haystack.includes(term);
    });
  }

  if (filter === "high") {
    submissions = submissions.filter((item) => item.aiRiskAverage >= 35 || item.aiHighRiskCount > 0);
  } else if (filter === "review") {
    submissions = submissions.filter((item) => item.status === "Em analise");
  } else if (filter === "approved") {
    submissions = submissions.filter((item) => item.status === "Aprovado");
  } else if (filter === "rejected") {
    submissions = submissions.filter((item) => item.status === "Reprovado");
  }

  if (sort === "score") {
    submissions.sort((a, b) => (b.objectiveScore / b.objectiveTotal) - (a.objectiveScore / a.objectiveTotal));
  } else if (sort === "risk") {
    submissions.sort((a, b) => b.aiRiskAverage - a.aiRiskAverage);
  } else {
    submissions.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  }

  return submissions;
}

function renderSubmissionDetail(submission) {
  if (!submission) return;

  const objectiveRows = submission.objectiveAnswers.map((answer) => `
    <tr>
      <td>${answer.id}</td>
      <td>${escapeHtml(answer.selectedText || "Nao respondida")}</td>
      <td>${answer.isCorrect ? "Correta" : "Incorreta: " + escapeHtml(answer.correctText)}</td>
    </tr>
  `).join("");

  const subjectiveReviews = submission.subjectiveAnswers.map((answer) => {
    const risk = riskLabel(answer.aiReview.score);
    const flags = answer.aiReview.flags.length
      ? `<ul class="flag-list">${answer.aiReview.flags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join("")}</ul>`
      : `<p>Nenhum sinal forte encontrado.</p>`;

    return `
      <div class="answer-review">
        <span>Questao ${answer.id} - ${answer.aiReview.wordCount} palavras - variedade ${answer.aiReview.uniqueRatio}%</span>
        <h3>${escapeHtml(answer.question)}</h3>
        <p>${escapeHtml(answer.answer)}</p>
        <div class="submission-meta">
          <span class="pill ${risk.className}">${risk.text}</span>
          <span class="pill">${answer.aiReview.score}% risco</span>
        </div>
        ${flags}
      </div>
    `;
  }).join("");

  const risk = riskLabel(submission.aiRiskAverage);
  const status = statusLabel(submission.status);
  const performance = submission.performancePercent ?? Math.round((submission.objectiveScore / submission.objectiveTotal) * 100);
  const similarity = submission.similaritySummary || { maxRatio: 0, perQuestion: [], flagged: 0 };
  const similarityRows = (similarity.perQuestion || [])
    .filter((item) => item.bestRatio >= 30)
    .sort((a, b) => b.bestRatio - a.bestRatio)
    .slice(0, 6)
    .map((item) => `<li>Q${item.id}: <strong>${item.bestRatio}%</strong> similar a ${escapeHtml(item.matchedCandidate || "?")}</li>`)
    .join("");
  const history = (submission.statusHistory || []).slice().reverse()
    .map((entry) => `<li><strong>${escapeHtml(entry.status)}</strong> - ${formatDate(entry.at)} (${escapeHtml(entry.by || "?")})${entry.note ? `<br><span>${escapeHtml(entry.note)}</span>` : ""}</li>`)
    .join("");
  submissionDetail.innerHTML = `
    <h3>${escapeHtml(submission.identity.discord)} - ${escapeHtml(submission.identity.roblox)}</h3>
    <div class="detail-actions">
      <span class="pill ${status.className}">${status.text}</span>
      <button class="secondary-button" type="button" data-download-pdf="${submission.id}">Baixar PDF</button>
    </div>
    <div class="status-actions">
      <button class="primary-button" type="button" data-set-status="Aprovado" data-id="${submission.id}">Aprovar</button>
      <button class="danger-button" type="button" data-set-status="Reprovado" data-id="${submission.id}">Reprovar</button>
      <button class="secondary-button" type="button" data-set-status="Em analise" data-id="${submission.id}">Em analise</button>
    </div>
    <div class="detail-grid">
      <div class="detail-box"><span>Tempo no EB</span><strong>${escapeHtml(submission.identity.tempoEb)}</strong></div>
      <div class="detail-box"><span>Envio</span><strong>${formatDate(submission.submittedAt)}</strong></div>
      <div class="detail-box"><span>Objetivas</span><strong>${submission.objectiveScore}/${submission.objectiveTotal}</strong></div>
      <div class="detail-box"><span>Desempenho</span><strong>${performance}%</strong></div>
      <div class="detail-box"><span>Triagem IA</span><strong>${risk.text} - ${submission.aiRiskAverage}% medio</strong></div>
      <div class="detail-box"><span>Analise</span><strong>${escapeHtml(submission.aiProvider || "groq")}</strong></div>
      <div class="detail-box"><span>Similaridade maxima</span><strong>${similarity.maxRatio || 0}%</strong></div>
      <div class="detail-box"><span>Subjetivas com cola</span><strong>${similarity.flagged || 0}</strong></div>
    </div>
    ${similarityRows ? `<div class="answer-review"><span>Subjetivas mais parecidas com outro candidato</span><ul class="flag-list">${similarityRows}</ul></div>` : ""}
    ${history ? `<div class="answer-review"><span>Historico de status</span><ul class="history-list">${history}</ul></div>` : ""}
    <label class="admin-note">
      <span>Observacao administrativa</span>
      <textarea id="adminNoteInput" placeholder="Escreva uma observacao para este candidato.">${escapeHtml(submission.adminNote || "")}</textarea>
    </label>
    <div class="detail-actions">
      <button class="primary-button" type="button" data-save-note="${submission.id}">Salvar observacao</button>
    </div>
    <h3>Resultado das objetivas</h3>
    <table class="objective-table">
      <thead><tr><th>Q</th><th>Resposta</th><th>Status</th></tr></thead>
      <tbody>${objectiveRows}</tbody>
    </table>
    <h3 style="margin-top:18px">Analise das subjetivas</h3>
    ${subjectiveReviews}
  `;
}
function renderReview() {
  if (!reviewUnlocked) return;
  const allSubmissions = [...loadedSubmissions].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  const filteredSubmissions = getFilteredSubmissions();
  renderSummary(allSubmissions);
  renderSubmissionList(filteredSubmissions);
  renderSubmissionDetail(filteredSubmissions.find((item) => item.id === selectedSubmissionId));
}

async function loadAdminSubmissions() {
  const response = await fetch("/api/admin/submissions", {
    credentials: "same-origin"
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Nao foi possivel carregar o painel.");
  }

  loadedSubmissions = await response.json();
  renderReview();
}

async function unlockReview() {
  try {
    const password = document.querySelector("#adminPin").value.trim();
    if (password) {
      const loginResponse = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password })
      });
      if (!loginResponse.ok) {
        const data = await loginResponse.json().catch(() => ({}));
        throw new Error(data.error || "Senha administrativa invalida.");
      }
    }
    reviewUnlocked = true;
    await loadAdminSubmissions();
  } catch (error) {
    reviewUnlocked = false;
    alert(error.message);
    return;
  }

  reviewLocked.classList.add("hidden");
  reviewDashboard.classList.remove("hidden");
  exportJsonButton.disabled = false;
  exportCsvButton.disabled = false;
  logoutAdminButton.disabled = false;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportJson() {
  downloadFile("envios-defensoria.json", JSON.stringify(loadedSubmissions, null, 2), "application/json");
}

function exportCsv() {
  const rows = [
    ["Discord", "Roblox", "Tempo EB", "Data", "Objetivas", "Total", "Risco IA medio", "Subjetivas com alerta", "Alto risco"]
  ];

  loadedSubmissions.forEach((item) => {
    rows.push([
      item.identity.discord,
      item.identity.roblox,
      item.identity.tempoEb,
      formatDate(item.submittedAt),
      item.objectiveScore,
      item.objectiveTotal,
      item.aiRiskAverage,
      item.aiFlaggedCount,
      item.aiHighRiskCount
    ]);
  });

  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n");
  downloadFile("envios-defensoria.csv", csv, "text/csv;charset=utf-8");
}

function importJson(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const imported = JSON.parse(String(reader.result || "[]"));
      if (!Array.isArray(imported)) throw new Error("Formato invalido");
      const current = loadedSubmissions;
      const merged = [...current];
      imported.forEach((item) => {
        if (item?.id && !merged.some((saved) => saved.id === item.id)) {
          merged.push(item);
        }
      });
      loadedSubmissions = merged;
      renderReview();
      alert("Importacao concluida.");
    } catch {
      alert("Nao foi possivel importar o arquivo JSON.");
    }
  });
  reader.readAsText(file);
}

async function submitForm() {
  if (!validateForm()) {
    toast("Preencha todas as questoes antes de enviar.", "error", "Faltam respostas");
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Enviando...";

  try {
    const submission = collectFormData();
    const response = await fetch("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission)
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Nao foi possivel enviar as respostas.");

    localStorage.removeItem(DRAFT_KEY);
    dirtyDraft = false;
    confirmation.classList.remove("hidden");
    confirmationText.textContent = `${submission.identity.discord}, sua avaliacao foi registrada. Pontuacao objetiva: ${result.objectiveScore}/${result.objectiveTotal} (${result.performancePercent}%). Analise IA: ${result.aiRiskAverage}% de risco medio.`;
    selectedSubmissionId = result.id;
    if (reviewUnlocked) await loadAdminSubmissions();
    confirmation.scrollIntoView({ behavior: "smooth", block: "center" });
    toast("Avaliacao enviada.", "success", "Tudo certo");
  } catch (error) {
    toast(error.message, "error", "Erro no envio");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Enviar respostas";
  }
}

function bindEvents() {
  form.addEventListener("input", () => {
    updateCounters();
    updateProgress();
    dirtyDraft = true;
    autoSave();
  });

  form.addEventListener("change", () => {
    updateProgress();
    dirtyDraft = true;
    autoSave();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    openConfirmModal();
  });

  document.querySelector("#cancelConfirm").addEventListener("click", closeConfirmModal);
  document.querySelector("#okConfirm").addEventListener("click", () => {
    closeConfirmModal();
    submitForm();
  });
  confirmModal.addEventListener("click", (event) => {
    if (event.target === confirmModal) closeConfirmModal();
  });

  jumpPendingButton.addEventListener("click", jumpToNextPending);

  window.addEventListener("beforeunload", (event) => {
    if (dirtyDraft) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  document.querySelector("#saveDraftButton").addEventListener("click", () => {
    saveDraft();
    dirtyDraft = false;
    toast("Rascunho salvo.", "success");
  });
  document.querySelector("#newSubmissionButton").addEventListener("click", () => {
    form.reset();
    updateCounters();
    updateProgress();
    confirmation.classList.add("hidden");
    document.querySelector("#formulario").scrollIntoView({ behavior: "smooth" });
  });

  document.querySelectorAll("[data-scroll-target]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector(`#${button.dataset.scrollTarget}`)?.scrollIntoView({ behavior: "smooth" });
    });
  });
}

async function loadExamFromServer() {
  const response = await fetch("/api/exam", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Falha ao carregar o edital.");
  const data = await response.json();
  objectiveQuestions = data.objectives;
  subjectiveQuestions = data.subjectives;
  examSeed = data.seed;
  formStartedAt = data.serverNow;
  if (!data.isOpen) renderExamClosedBanner(data.examStartAt, data.examEndAt);
}

function renderExamClosedBanner(start, end) {
  const banner = document.querySelector("#examClosedBanner");
  if (!banner) return;
  const fmt = (iso) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  banner.classList.remove("hidden");
  banner.innerHTML = `<strong>Edital fora do periodo.</strong> Janela oficial: ${fmt(start)} a ${fmt(end)}.`;
  const submit = form?.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("dge_theme", theme);
  const button = document.querySelector("#themeToggle");
  if (button) button.textContent = theme === "dark" ? "Tema claro" : "Tema escuro";
}

function bindTheme() {
  const saved = localStorage.getItem("dge_theme") || (matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(saved);
  document.querySelector("#themeToggle")?.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("SW falhou", error));
  });
}

async function boot() {
  bindTheme();
  registerServiceWorker();
  if (!isAdminPage) {
    try {
      await loadExamFromServer();
    } catch (error) {
      toast(error.message, "error", "Carregar edital");
      return;
    }
    renderQuestions();
    loadDraft();
    bindEvents();
    updateCounters();
    updateProgress();
    tickClock();
    setInterval(tickClock, 1000);
  } else {
    bindAdminOnlyEvents();
  }
}

function bindAdminOnlyEvents() {
  document.querySelector("#unlockReviewButton")?.addEventListener("click", unlockReview);
  document.querySelector("#exportJsonButton")?.addEventListener("click", exportJson);
  document.querySelector("#exportCsvButton")?.addEventListener("click", exportCsv);
  document.querySelector("#importJsonInput")?.addEventListener("change", (event) => importJson(event.target.files[0]));
  document.querySelector("#magicLinkButton")?.addEventListener("click", requestMagicLink);
  document.querySelector("#clearSubmissionsButton")?.addEventListener("click", async () => {
    if (!confirm("Tem certeza que deseja apagar os envios salvos no banco?")) return;
    const pin = document.querySelector("#adminPin").value.trim();
    const response = await fetch("/api/admin/submissions", { method: "DELETE", headers: { "x-admin-pin": pin } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      toast(data.error || "Falha ao limpar.", "error");
      return;
    }
    loadedSubmissions = [];
    selectedSubmissionId = null;
    renderReview();
    toast("Envios apagados.", "success");
  });
  submissionList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-submission-id]");
    if (!button) return;
    selectedSubmissionId = button.dataset.submissionId;
    renderReview();
  });
  submissionDetail?.addEventListener("click", handleSubmissionDetailClick);
  searchInput?.addEventListener("input", () => renderReview());
  sortBy?.addEventListener("change", () => renderReview());
  riskFilter?.addEventListener("change", () => renderReview());
  logoutAdminButton?.addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
    reviewUnlocked = false;
    reviewDashboard.classList.add("hidden");
    reviewLocked.classList.remove("hidden");
    exportJsonButton.disabled = true;
    exportCsvButton.disabled = true;
    logoutAdminButton.disabled = true;
    toast("Sessao admin encerrada.", "success");
  });
}

async function handleSubmissionDetailClick(event) {
  const setStatus = event.target.closest("[data-set-status]");
  if (setStatus) {
    const id = setStatus.dataset.id;
    const status = setStatus.dataset.setStatus;
    const note = prompt(`Observacao para "${status}" (opcional):`) || "";
    const pin = document.querySelector("#adminPin").value.trim();
    try {
      const response = await fetch(`/api/admin/submissions/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-pin": pin },
        credentials: "same-origin",
        body: JSON.stringify({ status, note })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Falha ao atualizar status.");
      const target = loadedSubmissions.find((item) => item.id === id);
      if (target) {
        target.status = status;
        target.statusHistory = [...(target.statusHistory || []), data.entry];
      }
      renderReview();
      toast(`Status: ${status}`, "success");
    } catch (error) {
      toast(error.message, "error");
    }
    return;
  }
  const pdfBtn = event.target.closest("[data-download-pdf]");
  if (pdfBtn) {
    window.open(`/api/admin/submissions/${pdfBtn.dataset.downloadPdf}/report.pdf`, "_blank");
    return;
  }
  const noteBtn = event.target.closest("[data-save-note]");
  if (noteBtn) {
    const id = noteBtn.dataset.saveNote;
    const adminNote = document.querySelector("#adminNoteInput").value;
    const pin = document.querySelector("#adminPin").value.trim();
    try {
      const response = await fetch(`/api/admin/submissions/${id}/note`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-pin": pin },
        credentials: "same-origin",
        body: JSON.stringify({ adminNote })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Falha ao salvar observacao.");
      const target = loadedSubmissions.find((item) => item.id === id);
      if (target) target.adminNote = adminNote;
      toast("Observacao salva.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  }
}

async function requestMagicLink() {
  const pin = document.querySelector("#adminPin").value.trim();
  try {
    const response = await fetch("/api/admin/magic", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-pin": pin },
      credentials: "same-origin"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Falha ao gerar link.");
    await navigator.clipboard?.writeText(data.url).catch(() => {});
    toast(`Link copiado. Valido ate ${new Date(data.expiresAt).toLocaleTimeString("pt-BR")}.`, "success", "Magic link");
  } catch (error) {
    toast(error.message, "error");
  }
}

boot();
