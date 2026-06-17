const objectiveQuestions = [
  {
    id: 1,
    text: "O que e uma PETICAO INICIAL?",
    options: [
      "Documento que encerra o processo",
      "Documento que da inicio ao processo e apresenta o pedido",
      "Documento de defesa",
      "Documento de arquivamento"
    ],
    answer: 1
  },
  {
    id: 2,
    text: "O que e um DESPACHO?",
    options: [
      "Decisao final do caso",
      "Documento administrativo para andamento no processo",
      "Defesa apresentada pela parte",
      "Documento de arquivamento"
    ],
    answer: 1
  },
  {
    id: 3,
    text: "Caso nao existam provas suficientes para sustentar uma acusacao, o mais adequado e:",
    options: [
      "Aplicar punicao imediatamente",
      "Ignorar a falta de provas",
      "Solicitar mais diligencias ou producao de provas",
      "Encerrar imediatamente sem analise"
    ],
    answer: 2
  },
  {
    id: 4,
    text: "O que e uma MANIFESTACAO?",
    options: [
      "Documento utilizado para apresentar posicionamento ou esclarecimento no processo",
      "Documento de prisao",
      "Arquivamento automatico",
      "Documento administrativo militar apenas"
    ],
    answer: 0
  },
  {
    id: 5,
    text: "Qual e a funcao de uma DEFESA?",
    options: [
      "Acusar uma parte",
      "Garantir contraditorio e apresentar argumentos/provas",
      "Arquivar processo",
      "Aplicar punicao"
    ],
    answer: 1
  },
  {
    id: 6,
    text: "O principio da AMPLA DEFESA significa:",
    options: [
      "A parte pode apresentar argumentos e provas para se defender",
      "O processo deve ser rapido apenas",
      "Apenas autoridades podem se manifestar",
      "A defesa e opcional"
    ],
    answer: 0
  },
  {
    id: 7,
    text: "O que significa \"juntar aos autos\"?",
    options: [
      "Arquivar processo",
      "Aplicar penalidade",
      "Adicionar documentos ao processo",
      "Excluir provas"
    ],
    answer: 2
  },
  {
    id: 8,
    text: "O que e uma PROVA DOCUMENTAL?",
    options: [
      "Testemunho verbal apenas",
      "Documento ou registro que auxilia a comprovar fatos",
      "Opiniao pessoal",
      "Hipotese sem fundamento"
    ],
    answer: 1
  },
  {
    id: 9,
    text: "Se uma prova apresentar inconsistencias, deve-se:",
    options: [
      "Ignorar o problema",
      "Considera-la automaticamente verdadeira",
      "Verificar autenticidade e buscar esclarecimentos",
      "Arquivar imediatamente"
    ],
    answer: 2
  },
  {
    id: 10,
    text: "O que significa um pedido ser DEFERIDO?",
    options: [
      "Foi recusado",
      "Foi aprovado/aceito",
      "Foi arquivado",
      "Foi cancelado automaticamente"
    ],
    answer: 1
  },
  {
    id: 11,
    text: "O que significa um pedido ser INDEFERIDO?",
    options: [
      "Foi aceito",
      "Foi encaminhado",
      "Foi recusado",
      "Foi colocado em sigilo"
    ],
    answer: 2
  },
  {
    id: 12,
    text: "Qual e a funcao da fase de instrucao processual?",
    options: [
      "Encerrar o processo",
      "Produzir e analisar provas e informacoes",
      "Aplicar penalidades",
      "Arquivar documentos"
    ],
    answer: 1
  },
  {
    id: 13,
    text: "O CONTRADITORIO significa:",
    options: [
      "Apenas uma parte pode falar",
      "Direito das partes se manifestarem sobre fatos e provas",
      "O processo nao precisa de provas",
      "O processo pode terminar sem defesa"
    ],
    answer: 1
  },
  {
    id: 14,
    text: "O que deve orientar a analise de um processo?",
    options: [
      "Opiniao pessoal",
      "Pressa para finalizar",
      "Imparcialidade e analise dos fatos/provas",
      "Preferencia hierarquica"
    ],
    answer: 2
  },
  {
    id: 15,
    text: "Surgindo novas provas importantes durante a tramitacao, o correto e:",
    options: [
      "Ignorar",
      "Analisar e incluir no processo conforme procedimento",
      "Encerrar imediatamente",
      "Remover provas anteriores"
    ],
    answer: 1
  }
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
  objectiveMount.innerHTML = objectiveQuestions.map((question) => `
    <article class="question-card">
      <div class="question-title">
        <h3>${question.id}. ${escapeHtml(question.text)}</h3>
        <span>Objetiva</span>
      </div>
      <div class="options-list" role="radiogroup" aria-label="${escapeHtml(question.text)}">
        ${question.options.map((option, index) => `
          <label class="option-row">
            <input type="radio" name="q${question.id}" value="${index}" required>
            <span>${String.fromCharCode(65 + index)}) ${escapeHtml(option)}</span>
          </label>
        `).join("")}
      </div>
    </article>
  `).join("");

  subjectiveMount.innerHTML = subjectiveQuestions.map((question) => `
    <article class="question-card">
      <div class="question-title">
        <h3>${question.id}. ${escapeHtml(question.text)}</h3>
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

  const objectiveAnswers = objectiveQuestions.map((question) => {
    const selected = Number(data.get(`q${question.id}`));
    return {
      id: question.id,
      question: question.text,
      selected,
      selectedText: question.options[selected] ?? "",
      correctIndex: question.answer,
      correctText: question.options[question.answer],
      isCorrect: selected === question.answer
    };
  });

  const subjectiveAnswers = subjectiveQuestions.map((question) => ({
    id: question.id,
    question: question.text,
    answer: String(data.get(`q${question.id}`) || "").trim()
  }));

  const subjectiveReview = analyzeSubjectiveAnswers(subjectiveAnswers);
  const objectiveScore = objectiveAnswers.filter((item) => item.isCorrect).length;

  return {
    id: crypto.randomUUID(),
    submittedAt: new Date().toISOString(),
    identity,
    objectiveAnswers,
    subjectiveAnswers: subjectiveReview.answers,
    objectiveScore,
    objectiveTotal: objectiveQuestions.length,
    aiRiskAverage: subjectiveReview.averageRisk,
    aiFlaggedCount: subjectiveReview.flaggedCount,
    aiHighRiskCount: subjectiveReview.highRiskCount
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

  summaryGrid.innerHTML = `
    <div class="summary-card"><strong>${total}</strong><span>envios registrados</span></div>
    <div class="summary-card"><strong>${avgScore}%</strong><span>media nas objetivas</span></div>
    <div class="summary-card"><strong>${avgRisk}%</strong><span>media de risco IA</span></div>
    <div class="summary-card"><strong>${highRisk}</strong><span>candidatos com alerta alto</span></div>
    <div class="summary-card"><strong>${approved}</strong><span>aprovados</span></div>
    <div class="summary-card"><strong>${review}</strong><span>em analise</span></div>
    <div class="summary-card"><strong>${rejected}</strong><span>reprovados</span></div>
  `;
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
  const submissions = [...loadedSubmissions].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

  if (filter === "high") {
    return submissions
      .filter((item) => item.aiRiskAverage >= 35 || item.aiHighRiskCount > 0)
      .sort((a, b) => b.aiRiskAverage - a.aiRiskAverage);
  }
  if (filter === "review") return submissions.filter((item) => item.status === "Em analise");
  if (filter === "approved") return submissions.filter((item) => item.status === "Aprovado");
  if (filter === "rejected") return submissions.filter((item) => item.status === "Reprovado");
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
  submissionDetail.innerHTML = `
    <h3>${escapeHtml(submission.identity.discord)} - ${escapeHtml(submission.identity.roblox)}</h3>
    <div class="detail-actions">
      <span class="pill ${status.className}">${status.text}</span>
      <button class="secondary-button" type="button" data-download-pdf="${submission.id}">Baixar PDF</button>
    </div>
    <div class="detail-grid">
      <div class="detail-box"><span>Tempo no EB</span><strong>${escapeHtml(submission.identity.tempoEb)}</strong></div>
      <div class="detail-box"><span>Envio</span><strong>${formatDate(submission.submittedAt)}</strong></div>
      <div class="detail-box"><span>Objetivas</span><strong>${submission.objectiveScore}/${submission.objectiveTotal}</strong></div>
      <div class="detail-box"><span>Desempenho</span><strong>${performance}%</strong></div>
      <div class="detail-box"><span>Triagem IA</span><strong>${risk.text} - ${submission.aiRiskAverage}% medio</strong></div>
      <div class="detail-box"><span>Analise</span><strong>${escapeHtml(submission.aiProvider || "groq")}</strong></div>
    </div>
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

function bindEvents() {
  form.addEventListener("input", () => {
    updateCounters();
    updateProgress();
  });

  form.addEventListener("change", updateProgress);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validateForm()) {
      alert("Preencha todas as questoes antes de enviar.");
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
      if (!response.ok) {
        throw new Error(result.error || "Nao foi possivel enviar as respostas.");
      }

      localStorage.removeItem(DRAFT_KEY);
      confirmation.classList.remove("hidden");
      confirmationText.textContent = `${submission.identity.discord}, sua avaliacao foi registrada. Pontuacao objetiva: ${result.objectiveScore}/${result.objectiveTotal} (${result.performancePercent}%). Analise IA: ${result.aiRiskAverage}% de risco medio.`;
      selectedSubmissionId = result.id;
      if (reviewUnlocked) {
        await loadAdminSubmissions();
      }
      confirmation.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      alert(error.message);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Enviar respostas";
    }
  });

  document.querySelector("#saveDraftButton").addEventListener("click", saveDraft);
  document.querySelector("#newSubmissionButton").addEventListener("click", () => {
    form.reset();
    updateCounters();
    updateProgress();
    confirmation.classList.add("hidden");
    document.querySelector("#formulario").scrollIntoView({ behavior: "smooth" });
  });

  document.querySelector("#unlockReviewButton").addEventListener("click", unlockReview);
  document.querySelector("#exportJsonButton").addEventListener("click", exportJson);
  document.querySelector("#exportCsvButton").addEventListener("click", exportCsv);
  document.querySelector("#importJsonInput").addEventListener("change", (event) => importJson(event.target.files[0]));

  document.querySelector("#clearSubmissionsButton").addEventListener("click", async () => {
    if (!confirm("Tem certeza que deseja apagar os envios salvos no banco?")) return;
    const pin = document.querySelector("#adminPin").value.trim();
    const response = await fetch("/api/admin/submissions", {
      method: "DELETE",
      headers: { "x-admin-pin": pin }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      alert(data.error || "Nao foi possivel limpar os envios.");
      return;
    }
    loadedSubmissions = [];
    selectedSubmissionId = null;
    renderReview();
  });

  submissionList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-submission-id]");
    if (!button) return;
    selectedSubmissionId = button.dataset.submissionId;
    renderReview();
  });

  document.querySelectorAll("[data-scroll-target]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector(`#${button.dataset.scrollTarget}`)?.scrollIntoView({ behavior: "smooth" });
    });
  });
}

renderQuestions();
loadDraft();
bindEvents();
updateCounters();
updateProgress();
