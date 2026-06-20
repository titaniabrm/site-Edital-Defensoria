let objectiveQuestions = [];
let subjectiveQuestions = [];
let examSeed = "";
let examSeedSignature = "";
let formStartedAt = "";
let examEndAt = "";

const DRAFT_KEY = "dge_draft_v1";
const SUBMITTED_KEY = "dge_submitted_v1";
const CLIENT_ID_KEY = "dge_client_id";

function getClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}
const clientId = getClientId();

// ---- Sessao Discord (login obrigatorio para fazer a prova) ----
let currentSession = { authenticated: false, isAdmin: false, username: null };

function goToDiscordLogin() {
  window.location.href = `/api/admin/discord/start?return_to=${encodeURIComponent("/")}`;
}

function applySessionUI() {
  const candidateSections = document.querySelectorAll(".candidate-only");
  const loginGate = document.querySelector("#loginGate");
  const discordLoginButton = document.querySelector("#discordLoginButton");
  const logoutButton = document.querySelector("#logoutButton");
  const painelButton = document.querySelector("#painelButton");
  const sessionLabel = document.querySelector("#sessionLabel");
  const loggedDiscordLabel = document.querySelector("#loggedDiscordLabel");

  if (currentSession.authenticated) {
    loginGate?.classList.add("hidden");
    candidateSections.forEach((el) => el.classList.remove("hidden"));
    discordLoginButton?.classList.add("hidden");
    logoutButton?.classList.remove("hidden");
    sessionLabel?.classList.remove("hidden");
    if (sessionLabel) sessionLabel.textContent = `Logado como @${currentSession.username}`;
    if (loggedDiscordLabel) loggedDiscordLabel.textContent = `@${currentSession.username}`;
    painelButton?.classList.toggle("hidden", !currentSession.isAdmin);
  } else {
    loginGate?.classList.remove("hidden");
    candidateSections.forEach((el) => el.classList.add("hidden"));
    discordLoginButton?.classList.remove("hidden");
    logoutButton?.classList.add("hidden");
    sessionLabel?.classList.add("hidden");
    painelButton?.classList.add("hidden");
  }
}

async function checkSession() {
  try {
    const res = await fetch("/api/session", { credentials: "same-origin" });
    currentSession = await res.json();
  } catch {
    currentSession = { authenticated: false };
  }
  applySessionUI();
}

function handleLoginCallback() {
  const params = new URLSearchParams(window.location.search);
  const result = params.get("login");
  if (!result) return;
  if (result === "ok") {
    toast(`Bem-vindo, @${params.get("user") || ""}!`, "success", "Login Discord");
  } else if (result === "error") {
    toast(params.get("reason") || "Falha no login Discord.", "error");
  }
  window.history.replaceState({}, "", window.location.pathname);
}

function bindSessionEvents() {
  document.querySelector("#discordLoginButton")?.addEventListener("click", goToDiscordLogin);
  document.querySelector("#loginGateButton")?.addEventListener("click", goToDiscordLogin);
  document.querySelector("#painelButton")?.addEventListener("click", () => {
    window.location.href = "/admin";
  });
  document.querySelector("#logoutButton")?.addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    window.location.reload();
  });
}

// ---- Sinais antifraude ----
let devtoolsOpened = false;
let reviewCount = 0;          // quantas vezes abriu o modal de confirmacao e voltou
let lastActivityAt = Date.now();
let maxIdleMs = 0;

function computeFingerprint() {
  const parts = [
    navigator.userAgent,
    navigator.language,
    navigator.platform,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    String(navigator.hardwareConcurrency || ""),
    String(navigator.maxTouchPoints || "")
  ].join("|");
  let hash = 0;
  for (let i = 0; i < parts.length; i += 1) {
    hash = (Math.imul(31, hash) + parts.charCodeAt(i)) | 0;
  }
  return `fp_${(hash >>> 0).toString(16)}`;
}
const fingerprint = computeFingerprint();

function markActivity() {
  const now = Date.now();
  const idle = now - lastActivityAt;
  if (idle > maxIdleMs) maxIdleMs = idle;
  lastActivityAt = now;
}

function startDevtoolsWatch() {
  const threshold = 170;
  setInterval(() => {
    const widthGap = window.outerWidth - window.innerWidth;
    const heightGap = window.outerHeight - window.innerHeight;
    if (widthGap > threshold || heightGap > threshold) devtoolsOpened = true;
  }, 2000);
}

const form = document.querySelector("#examForm");
const objectiveMount = document.querySelector("#objectiveQuestions");
const subjectiveMount = document.querySelector("#subjectiveQuestions");
const progressMetric = document.querySelector("#progressMetric");
const progressBar = document.querySelector("#progressBar");
const draftStatus = document.querySelector("#draftStatus");
const confirmation = document.querySelector("#confirmation");
const confirmationText = document.querySelector("#confirmationText");
const sectionProgress = document.querySelector("#sectionProgress");
const timeElapsed = document.querySelector("#timeElapsed");
const toastStack = document.querySelector("#toastStack");
const confirmModal = document.querySelector("#confirmModal");
const confirmModalSummary = document.querySelector("#confirmModalSummary");
const jumpPendingButton = document.querySelector("#jumpPendingButton");
const questionIndex = document.querySelector("#questionIndex");

let dirtyDraft = false;
let autoSaveTimer = null;
const startedAt = Date.now();
const questionTiming = new Map(); // questionId -> { firstFocus, lastFocus, totalMs }
const pasteFlags = new Map();     // questionId -> true

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

function countWords(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ").length : 0;
}

function autoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (!dirtyDraft) return;
    saveDraft();
    dirtyDraft = false;
  }, 900);
}

let warned5min = false;
let examClosedLocally = false;

function tickClock() {
  if (!timeElapsed) return;
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  let countdown = "";
  if (examEndAt) {
    const remaining = Math.max(0, new Date(examEndAt).getTime() - Date.now());
    const dd = Math.floor(remaining / 86400000);
    const hh = String(Math.floor((remaining / 3600000) % 24)).padStart(2, "0");
    const mins = String(Math.floor((remaining / 60000) % 60)).padStart(2, "0");
    const secs = String(Math.floor((remaining / 1000) % 60)).padStart(2, "0");
    countdown = ` | Encerra em ${dd}d ${hh}:${mins}:${secs}`;

    if (remaining > 0 && remaining <= 5 * 60 * 1000 && !warned5min) {
      warned5min = true;
      toast("Faltam 5 minutos para o fim do edital. Finalize seu envio!", "warn", "Atencao");
    }
    if (remaining <= 0 && !examClosedLocally) {
      examClosedLocally = true;
      const submit = form?.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      toast("O periodo do edital terminou.", "error", "Encerrado");
    }
  }
  timeElapsed.textContent = `Tempo: ${mm}:${ss}${countdown}`;
}

function renderQuestions() {
  objectiveMount.innerHTML = objectiveQuestions.map((question, qIndex) => `
    <article class="question-card" data-question-id="${question.id}" id="q-${question.id}">
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
    <article class="question-card" data-question-id="${question.id}" id="q-${question.id}">
      <div class="question-title">
        <h3>${objectiveQuestions.length + qIndex + 1}. ${escapeHtml(question.text)}</h3>
        <span>Subjetiva</span>
      </div>
      <textarea name="q${question.id}" required placeholder="Digite sua resposta com suas palavras."></textarea>
      <div class="subjective-tools">
        <span class="answer-count" data-counter-for="q${question.id}">0 palavras</span>
        <span>Minimo obrigatorio: 5 palavras &middot; recomendado: 25+</span>
      </div>
    </article>
  `).join("");

  // Indice flutuante
  if (questionIndex) {
    const all = [...objectiveQuestions, ...subjectiveQuestions];
    questionIndex.innerHTML = all.map((q, i) =>
      `<button type="button" data-jump-to="q-${q.id}" title="Questao ${i + 1}">${i + 1}</button>`
    ).join("");
  }

  // Paste detection + tempo por questao
  document.querySelectorAll("textarea[name^='q']").forEach((ta) => {
    const id = Number(ta.name.slice(1));
    ta.addEventListener("paste", (event) => {
      const text = event.clipboardData?.getData("text") || "";
      if (countWords(text) >= 8) {
        pasteFlags.set(id, true);
        toast(`Colagem detectada na questao ${id}. O envio sera marcado.`, "warn", "Atencao");
      }
    });
    const enter = () => {
      const entry = questionTiming.get(id) || { firstFocus: 0, lastFocus: 0, totalMs: 0 };
      entry.lastFocus = Date.now();
      if (!entry.firstFocus) entry.firstFocus = Date.now();
      questionTiming.set(id, entry);
    };
    const leave = () => {
      const entry = questionTiming.get(id);
      if (entry?.lastFocus) {
        entry.totalMs += Date.now() - entry.lastFocus;
        entry.lastFocus = 0;
        questionTiming.set(id, entry);
      }
    };
    ta.addEventListener("focus", enter);
    ta.addEventListener("blur", leave);
  });

  document.querySelectorAll("input[type='radio'][name^='q']").forEach((input) => {
    const id = Number(input.name.slice(1));
    input.addEventListener("change", () => {
      const entry = questionTiming.get(id) || { firstFocus: Date.now(), lastFocus: 0, totalMs: 0 };
      entry.totalMs += 500; // marca um delta minimo para sabermos que houve interacao
      questionTiming.set(id, entry);
    });
  });
}

function collectFormData() {
  const data = new FormData(form);
  const identity = {
    roblox: String(data.get("roblox") || "").trim(),
    tempoEb: String(data.get("tempoEb") || "").trim()
  };

  const objectiveAnswers = objectiveQuestions.map((question) => {
    const raw = data.get(`q${question.id}`);
    return {
      id: question.id,
      selectedOriginalIndex: raw === null || raw === "" ? -1 : Number(raw),
      timeSpentMs: questionTiming.get(question.id)?.totalMs || 0
    };
  });

  const subjectiveAnswers = subjectiveQuestions.map((question) => ({
    id: question.id,
    question: question.text,
    answer: String(data.get(`q${question.id}`) || "").trim(),
    pasteDetected: pasteFlags.get(question.id) === true,
    timeSpentMs: questionTiming.get(question.id)?.totalMs || 0
  }));

  return {
    identity,
    objectiveAnswers,
    subjectiveAnswers,
    seed: examSeed,
    seedSignature: examSeedSignature,
    formStartedAt,
    middlename: String(data.get("middlename") || ""),
    clientId,
    fingerprint,
    devtoolsOpened,
    reviewCount,
    maxIdleMs
  };
}

function collectDraftObject() {
  const data = new FormData(form);
  const draft = {};
  for (const [key, value] of data.entries()) draft[key] = value;
  return draft;
}

function saveDraft() {
  const draft = collectDraftObject();
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  draftStatus.textContent = `Rascunho salvo as ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`;
  // Sincroniza com o servidor (best-effort, nao bloqueia).
  fetch("/api/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, data: draft })
  }).catch(() => {});
}

function applyDraftObject(draft) {
  for (const [key, value] of Object.entries(draft || {})) {
    const fields = form.elements[key];
    if (!fields) continue;
    if (fields instanceof RadioNodeList) {
      const option = [...fields].find((item) => item.value === String(value));
      if (option) option.checked = true;
    } else {
      fields.value = value;
    }
  }
}

async function loadServerDraftIfNewer() {
  // Se nao ha rascunho local, tenta recuperar do servidor (outro dispositivo).
  if (localStorage.getItem(DRAFT_KEY)) return;
  try {
    const res = await fetch(`/api/draft/${encodeURIComponent(clientId)}`);
    const body = await res.json().catch(() => ({}));
    if (body?.data && Object.keys(body.data).length) {
      applyDraftObject(body.data);
      updateCounters();
      updateProgress();
      toast("Rascunho recuperado do servidor.", "success");
    }
  } catch {
    // sem rascunho remoto
  }
}

function clearDraft() {
  if (!confirm("Apagar o rascunho atual e limpar todas as respostas?")) return;
  localStorage.removeItem(DRAFT_KEY);
  form.reset();
  pasteFlags.clear();
  questionTiming.clear();
  updateCounters();
  updateProgress();
  draftStatus.textContent = "Rascunho apagado.";
  toast("Rascunho apagado.", "success");
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
  const uniqueRequired = new Set(requiredFields.map((field) => field.name));
  const completedUnique = new Set();
  requiredFields.forEach((field) => {
    if (field.type === "radio") {
      if (form.querySelector(`[name="${field.name}"]:checked`)) completedUnique.add(field.name);
    } else if (String(field.value || "").trim().length > 0) {
      completedUnique.add(field.name);
    }
  });
  const percent = uniqueRequired.size ? Math.round((completedUnique.size / uniqueRequired.size) * 100) : 0;
  progressMetric.textContent = `${percent}%`;
  progressBar.style.width = `${percent}%`;

  const identityFields = ["roblox", "tempoEb"];
  const identityDone = identityFields.filter((name) => String(form.elements[name]?.value || "").trim()).length;
  const objectiveDone = objectiveQuestions.filter((q) => form.querySelector(`[name="q${q.id}"]:checked`)).length;
  const subjectiveDone = subjectiveQuestions.filter((q) => {
    const value = form.elements[`q${q.id}`]?.value || "";
    return value.trim() && countWords(value) >= 5;
  }).length;

  const counts = { identidade: [identityDone, 2], objetivas: [objectiveDone, 15], subjetivas: [subjectiveDone, 15] };
  sectionProgress?.querySelectorAll("li").forEach((li) => {
    const [done, total] = counts[li.dataset.section];
    li.querySelector("strong").textContent = `${done}/${total}`;
    li.dataset.complete = done === total ? "true" : "false";
  });

  objectiveQuestions.forEach((q) => {
    const answered = Boolean(form.querySelector(`[name="q${q.id}"]:checked`));
    const card = form.querySelector(`[name="q${q.id}"]`)?.closest(".question-card");
    if (card) card.dataset.answered = answered ? "true" : "false";
    const idx = questionIndex?.querySelector(`[data-jump-to="q-${q.id}"]`);
    if (idx) idx.dataset.answered = answered ? "true" : "false";
  });
  subjectiveQuestions.forEach((q) => {
    const ta = form.elements[`q${q.id}`];
    const answered = ta?.value.trim() && countWords(ta.value) >= 5;
    const card = ta?.closest(".question-card");
    if (card) card.dataset.answered = answered ? "true" : "false";
    const idx = questionIndex?.querySelector(`[data-jump-to="q-${q.id}"]`);
    if (idx) idx.dataset.answered = answered ? "true" : "false";
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
  const identity = ["roblox", "tempoEb"].filter((name) => String(form.elements[name]?.value || "").trim()).length;
  const objectiveDone = objectiveQuestions.filter((q) => form.querySelector(`[name="q${q.id}"]:checked`)).length;
  const subjectiveDone = subjectiveQuestions.filter((q) => {
    const value = form.elements[`q${q.id}`]?.value || "";
    return value.trim() && countWords(value) >= 5;
  }).length;

  const rows = [
    { label: "Identificacao", done: identity, total: 2 },
    { label: "Objetivas", done: objectiveDone, total: 15 },
    { label: "Subjetivas", done: subjectiveDone, total: 15 }
  ];
  confirmModalSummary.innerHTML = rows.map((row) => `
    <li class="${row.done === row.total ? "" : "missing"}">
      <span>${row.label}</span><strong>${row.done}/${row.total}</strong>
    </li>
  `).join("");

  const reviewMount = document.querySelector("#confirmModalReview");
  if (reviewMount) {
    const data = new FormData(form);
    const objRows = objectiveQuestions.map((q, i) => {
      const sel = form.querySelector(`[name="q${q.id}"]:checked`);
      const label = sel ? sel.closest(".option-row")?.querySelector("span")?.textContent?.trim() : null;
      return `<div class="review-item ${sel ? "" : "missing"}">
        <strong>${i + 1}.</strong> ${escapeHtml(q.text)}<br>
        <span>${sel ? escapeHtml(label || "Respondida") : "Nao respondida"}</span>
      </div>`;
    }).join("");
    const subjRows = subjectiveQuestions.map((q, i) => {
      const val = String(data.get(`q${q.id}`) || "").trim();
      return `<div class="review-item ${val && countWords(val) >= 5 ? "" : "missing"}">
        <strong>${objectiveQuestions.length + i + 1}.</strong> ${escapeHtml(q.text)}<br>
        <span>${val ? escapeHtml(val.slice(0, 160)) + (val.length > 160 ? "..." : "") : "Nao respondida"}</span>
      </div>`;
    }).join("");
    reviewMount.innerHTML = objRows + subjRows;
  }
  confirmModal.classList.remove("hidden");
}

function closeConfirmModal() {
  confirmModal.classList.add("hidden");
}

function validateForm() {
  let valid = true;
  form.querySelectorAll(".invalid").forEach((field) => field.classList.remove("invalid"));

  ["roblox", "tempoEb"].forEach((name) => {
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

async function submitForm() {
  if (!validateForm()) {
    toast("Preencha todas as questoes antes de enviar.", "error", "Faltam respostas");
    return;
  }
  if (localStorage.getItem(SUBMITTED_KEY)) {
    toast("Voce ja enviou um formulario nesta sessao.", "error", "Envio duplicado");
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
    localStorage.setItem(SUBMITTED_KEY, result.id || "1");
    dirtyDraft = false;
    confirmation.classList.remove("hidden");
    const greetingName = currentSession.username ? `@${currentSession.username}` : "Candidato";
    confirmationText.textContent = `${greetingName}, sua avaliacao foi registrada. Pontuacao objetiva: ${result.objectiveScore}/${result.objectiveTotal} (${result.performancePercent}%). Analise IA: ${result.aiRiskAverage}% de risco medio.`;
    form.querySelectorAll("input, textarea, button[type='submit']").forEach((el) => { el.disabled = true; });
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
    markActivity();
    updateCounters();
    updateProgress();
    dirtyDraft = true;
    autoSave();
  });

  form.addEventListener("change", () => {
    markActivity();
    updateProgress();
    dirtyDraft = true;
    autoSave();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    openConfirmModal();
  });

  document.querySelector("#cancelConfirm").addEventListener("click", () => {
    reviewCount += 1;
    closeConfirmModal();
  });
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
  document.querySelector("#clearDraftButton")?.addEventListener("click", clearDraft);
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

  questionIndex?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-jump-to]");
    if (!btn) return;
    document.querySelector(`#${btn.dataset.jumpTo}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // Atalhos de teclado
  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveDraft();
      dirtyDraft = false;
      toast("Rascunho salvo.", "success");
    } else if (event.altKey && event.key === "ArrowRight") {
      event.preventDefault();
      jumpToNextPending();
    }
  });
}

async function loadExamFromServer() {
  const response = await fetch("/api/exam", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Falha ao carregar o edital.");
  const data = await response.json();
  objectiveQuestions = data.objectives;
  subjectiveQuestions = data.subjectives;
  examSeed = data.seed;
  examSeedSignature = data.seedSignature || "";
  formStartedAt = data.serverNow;
  examEndAt = data.examEndAt || "";
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
  bindSessionEvents();
  registerServiceWorker();
  handleLoginCallback();
  await checkSession();
  if (!currentSession.authenticated) {
    return;
  }
  try {
    await loadExamFromServer();
  } catch (error) {
    toast(error.message, "error", "Carregar edital");
    return;
  }
  renderQuestions();
  loadDraft();
  await loadServerDraftIfNewer();
  bindEvents();
  updateCounters();
  updateProgress();
  tickClock();
  setInterval(tickClock, 1000);

  const alreadySubmitted = Boolean(localStorage.getItem(SUBMITTED_KEY));
  if (alreadySubmitted) {
    toast("Voce ja enviou esta avaliacao.", "info");
    form.querySelectorAll("input, textarea, button[type='submit']").forEach((el) => { el.disabled = true; });
  } else {
    startDevtoolsWatch();
    // Heartbeat de presenca (candidato preenchendo agora).
    const heartbeat = () => {
      if (localStorage.getItem(SUBMITTED_KEY)) return;
      fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId })
      }).catch(() => {});
    };
    heartbeat();
    setInterval(heartbeat, 20000);
  }
}

boot();
