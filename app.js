let objectiveQuestions = [];
let subjectiveQuestions = [];
let examSeed = "";
let examSeedSignature = "";
let formStartedAt = "";
let examEndAt = "";
let serverAlreadySubmitted = false;

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
let publicConfig = {};
let hcaptchaWidgetId = null;

async function loadPublicConfig() {
  try {
    const res = await fetch("/api/config", { credentials: "same-origin" });
    publicConfig = await res.json();
  } catch {
    publicConfig = {};
  }
  applyCustomTheme(publicConfig.theme);
}

// Aplica tema custom via CSS variables sobre os estilos padrao.
function applyCustomTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  if (theme.primaryColor) root.style.setProperty("--navy", theme.primaryColor);
  if (theme.accentColor) root.style.setProperty("--gold", theme.accentColor);
  if (theme.backgroundColor) root.style.setProperty("--paper", theme.backgroundColor);
  // Logo e textos do hero
  if (theme.logoUrl) {
    document.querySelectorAll(".brand img, .status-panel img").forEach((img) => {
      img.src = theme.logoUrl;
    });
  }
  if (theme.bannerTitle) {
    const h = document.querySelector(".hero-copy h2");
    if (h) h.textContent = theme.bannerTitle;
  }
  if (theme.bannerSubtitle) {
    const p = document.querySelector(".hero-copy p:last-child");
    if (p) p.textContent = theme.bannerSubtitle;
  }
}

// Carrega o widget hCaptcha so quando ha sitekey publica configurada.
function setupHCaptchaIfNeeded() {
  const sitekey = publicConfig.hcaptchaSiteKey;
  const container = document.querySelector("#captchaContainer");
  if (!sitekey || !container) return;
  const widget = document.querySelector("#hcaptchaWidget");
  if (!widget || widget.dataset.loaded) {
    container.classList.remove("hidden");
    return;
  }
  container.classList.remove("hidden");
  // Carrega o script externo so quando precisamos (depois do login).
  const script = document.createElement("script");
  script.src = "https://hcaptcha.com/1/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  script.onload = () => {
    if (window.hcaptcha) {
      hcaptchaWidgetId = window.hcaptcha.render(widget, { sitekey });
      widget.dataset.loaded = "1";
    }
  };
  document.head.appendChild(script);
}

function getCaptchaToken() {
  if (!publicConfig.hcaptchaSiteKey || hcaptchaWidgetId === null) return "";
  try {
    return window.hcaptcha.getResponse(hcaptchaWidgetId) || "";
  } catch {
    return "";
  }
}

function resetCaptcha() {
  if (hcaptchaWidgetId === null) return;
  try { window.hcaptcha.reset(hcaptchaWidgetId); } catch {}
}

function goToDiscordLogin() {
  window.location.href = `/api/admin/discord/start?return_to=${encodeURIComponent("/")}`;
}

function applySessionUI() {
  const candidateSections = document.querySelectorAll(".candidate-only");
  const loginGate = document.querySelector("#loginGate");
  const discordLoginButton = document.querySelector("#discordLoginButton");
  const logoutButton = document.querySelector("#logoutButton");
  const painelButton = document.querySelector("#painelButton");
  const userBadge = document.querySelector("#userBadge");
  const userAvatar = document.querySelector("#userAvatar");
  const userName = document.querySelector("#userName");
  const loggedDiscordLabel = document.querySelector("#loggedDiscordLabel");

  if (currentSession.authenticated) {
    loginGate?.classList.add("hidden");
    candidateSections.forEach((el) => el.classList.remove("hidden"));
    discordLoginButton?.classList.add("hidden");
    logoutButton?.classList.remove("hidden");
    if (userBadge) {
      userBadge.classList.remove("hidden");
      if (userAvatar) {
        // Fallback se a sessao (antiga) nao trouxer avatarUrl ou se a imagem
        // do Discord falhar - usa um dos 6 avatares default da plataforma.
        const fallback = "https://cdn.discordapp.com/embed/avatars/0.png";
        userAvatar.src = currentSession.avatarUrl || fallback;
        userAvatar.onerror = () => { userAvatar.src = fallback; };
      }
      if (userName) userName.textContent = `@${currentSession.username || ""}`;
    }
    if (loggedDiscordLabel) loggedDiscordLabel.textContent = `@${currentSession.username}`;
    painelButton?.classList.toggle("hidden", !currentSession.isAdmin);
  } else {
    loginGate?.classList.remove("hidden");
    candidateSections.forEach((el) => el.classList.add("hidden"));
    discordLoginButton?.classList.remove("hidden");
    logoutButton?.classList.add("hidden");
    userBadge?.classList.add("hidden");
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
    if (kind === "error") customAlert(message);
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

// ---- Dialogo customizado (substitui confirm()/prompt()/alert() nativos) ----
const dialogModal = document.querySelector("#dialogModal");
const dialogModalEyebrow = document.querySelector("#dialogModalEyebrow");
const dialogModalTitle = document.querySelector("#dialogModalTitle");
const dialogModalMessage = document.querySelector("#dialogModalMessage");
const dialogModalInput = document.querySelector("#dialogModalInput");
const dialogModalCancel = document.querySelector("#dialogModalCancel");
const dialogModalConfirm = document.querySelector("#dialogModalConfirm");
let dialogResolve = null;

function closeDialog(result) {
  dialogModal?.classList.add("hidden");
  if (dialogResolve) {
    const resolve = dialogResolve;
    dialogResolve = null;
    resolve(result);
  }
}

function openDialog({
  eyebrow = "Atencao",
  title = "Confirmar",
  message = "",
  danger = false,
  withInput = false,
  inputValue = "",
  inputPlaceholder = "",
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  hideCancel = false
}) {
  if (!dialogModal) return Promise.resolve(withInput ? null : false);
  dialogModalEyebrow.textContent = eyebrow;
  dialogModalTitle.textContent = title;
  dialogModalMessage.textContent = message;
  dialogModalConfirm.textContent = confirmLabel;
  dialogModalConfirm.className = danger ? "danger-button" : "primary-button";
  dialogModalCancel.textContent = cancelLabel;
  dialogModalCancel.classList.toggle("hidden", hideCancel);
  if (withInput) {
    dialogModalInput.classList.remove("hidden");
    dialogModalInput.value = inputValue;
    dialogModalInput.placeholder = inputPlaceholder;
  } else {
    dialogModalInput.classList.add("hidden");
  }
  dialogModal.classList.remove("hidden");
  if (withInput) setTimeout(() => dialogModalInput.focus(), 50);
  return new Promise((resolve) => { dialogResolve = resolve; });
}

function customConfirm(message, opts = {}) {
  return openDialog({ message, ...opts }).then((result) => result === true);
}

function customPrompt(message, opts = {}) {
  return openDialog({ message, withInput: true, ...opts });
}

function customAlert(message, opts = {}) {
  return openDialog({ message, hideCancel: true, confirmLabel: "OK", ...opts });
}

dialogModalCancel?.addEventListener("click", () => closeDialog(dialogModalInput.classList.contains("hidden") ? false : null));
dialogModalConfirm?.addEventListener("click", () => closeDialog(dialogModalInput.classList.contains("hidden") ? true : dialogModalInput.value));
dialogModal?.addEventListener("click", (event) => {
  if (event.target === dialogModal) closeDialog(dialogModalInput.classList.contains("hidden") ? false : null);
});
dialogModalInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") dialogModalConfirm.click();
});

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
      toast("Faltam 5 minutos para o fim do edital. Finalize seu envio!", "warn", "Atenção");
    }
    if (remaining <= 0 && !examClosedLocally) {
      examClosedLocally = true;
      const submit = form?.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      toast("O período do edital terminou.", "error", "Encerrado");
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

let lastSavedAt = 0;

function refreshSavedAgo() {
  if (!lastSavedAt || !draftStatus) return;
  const sec = Math.max(0, Math.round((Date.now() - lastSavedAt) / 1000));
  let label;
  if (sec < 5) label = "✓ Salvo agora";
  else if (sec < 60) label = `✓ Salvo ha ${sec}s`;
  else if (sec < 3600) label = `✓ Salvo ha ${Math.floor(sec / 60)} min`;
  else label = `✓ Salvo as ${new Date(lastSavedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  draftStatus.textContent = label;
  draftStatus.classList.add("saved-indicator");
}

function saveDraft() {
  const draft = collectDraftObject();
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  lastSavedAt = Date.now();
  refreshSavedAgo();
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

async function clearDraft() {
  const ok = await customConfirm("Apagar o rascunho atual e limpar todas as respostas?", {
    eyebrow: "Confirmacao",
    title: "Apagar rascunho",
    confirmLabel: "Apagar",
    danger: true
  });
  if (!ok) return;
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
    toast("Todas as questões já foram respondidas.", "success");
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

function statusLabelFor(status) {
  if (status === "Aprovado") return { text: "Aprovado", className: "good" };
  if (status === "Reprovado") return { text: "Reprovado", className: "bad" };
  return { text: "Em análise", className: "warn" };
}

function renderMyAnswersList(objectiveItems, subjectiveItems) {
  const objRows = objectiveItems.map((item, i) => `
    <div class="review-item">
      <strong>${i + 1}.</strong> ${escapeHtml(item.question)}<br>
      <span>${escapeHtml(item.selectedText || "Nao respondida")}</span>
    </div>
  `).join("");
  const subjRows = subjectiveItems.map((item, i) => {
    // Quando o servidor anexa answerHtml (markdown renderizado), usamos ele.
    // Caso contrario (envio recem feito no client), escapa o texto cru.
    const body = item.answerHtml || `<span>${escapeHtml(item.answer || "Nao respondida")}</span>`;
    return `
      <div class="review-item">
        <strong>${objectiveItems.length + i + 1}.</strong> ${escapeHtml(item.question)}<br>
        <div class="answer-body">${body}</div>
      </div>
    `;
  }).join("");
  return objRows + subjRows;
}

function showOnlyMyResults() {
  document.querySelectorAll(".candidate-only").forEach((el) => {
    if (el.id !== "confirmation") el.classList.add("hidden");
  });
}

async function loadMyResults() {
  try {
    const res = await fetch("/api/my-submission", { credentials: "same-origin" });
    const data = await res.json();
    if (!data.found) return;
    showOnlyMyResults();
    const status = statusLabelFor(data.status);
    document.querySelector("#confirmationTitle").textContent = data.decided
      ? "Resultado da sua avaliação"
      : "Avaliação em análise pela banca";
    // So mostra pontuacao depois que o admin decidiu (Aprovado/Reprovado).
    // Enquanto "Em analise", mantemos o candidato sem ver nota nem desempenho.
    confirmationText.textContent = data.decided
      ? `Enviado em ${new Date(data.submittedAt).toLocaleString("pt-BR")}. Pontuação objetiva: ${data.objectiveScore}/${data.objectiveTotal} (${data.performancePercent}%).`
      : `Enviado em ${new Date(data.submittedAt).toLocaleString("pt-BR")}. Aguarde a análise da banca — o resultado aparece aqui quando estiver pronto.`;
    const pill = document.querySelector("#myStatusPill");
    pill.textContent = status.text;
    pill.className = `pill ${status.className}`;
    document.querySelector("#myAnswersList").innerHTML = renderMyAnswersList(data.objectiveAnswers, data.subjectiveAnswers);
    confirmation.classList.remove("hidden");
  } catch {
    toast("Não foi possível carregar suas respostas.", "error");
  }
}

async function submitForm() {
  if (!validateForm()) {
    toast("Preencha todas as questões antes de enviar.", "error", "Faltam respostas");
    return;
  }
  if (localStorage.getItem(SUBMITTED_KEY)) {
    toast("Você já enviou um formulário nesta sessão.", "error", "Envio duplicado");
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.classList.add("is-loading");

  try {
    if (publicConfig.hcaptchaSiteKey && !getCaptchaToken()) {
      throw new Error("Resolva o captcha antes de enviar.");
    }
    const submission = collectFormData();
    submission.captchaToken = getCaptchaToken();
    const objectiveItems = objectiveQuestions.map((q) => {
      const sel = form.querySelector(`[name="q${q.id}"]:checked`);
      const label = sel ? sel.closest(".option-row")?.querySelector("span")?.textContent?.trim() : null;
      return { question: q.text, selectedText: label || "" };
    });
    const formDataForReview = new FormData(form);
    const subjectiveItems = subjectiveQuestions.map((q) => ({
      question: q.text,
      answer: String(formDataForReview.get(`q${q.id}`) || "").trim()
    }));

    const response = await fetch("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission)
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Não foi possível enviar as respostas.");

    localStorage.removeItem(DRAFT_KEY);
    localStorage.setItem(SUBMITTED_KEY, result.id || "1");
    dirtyDraft = false;
    showOnlyMyResults();
    confirmation.classList.remove("hidden");
    const greetingName = currentSession.username ? `@${currentSession.username}` : "Candidato";
    const status = statusLabelFor(result.status || "Em analise");
    document.querySelector("#confirmationTitle").textContent = "Avaliação em análise pela banca";
    confirmationText.textContent = `${greetingName}, sua avaliação foi registrada. Aguarde a análise da banca — o resultado aparece aqui quando estiver pronto.`;
    const pill = document.querySelector("#myStatusPill");
    pill.textContent = status.text;
    pill.className = `pill ${status.className}`;
    document.querySelector("#myAnswersList").innerHTML = renderMyAnswersList(objectiveItems, subjectiveItems);
    confirmation.scrollIntoView({ behavior: "smooth", block: "center" });
    toast("Avaliação enviada.", "success", "Tudo certo");
  } catch (error) {
    toast(error.message, "error", "Erro no envio");
    resetCaptcha();
  } finally {
    submitButton.disabled = false;
    submitButton.classList.remove("is-loading");
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

  document.querySelector("#clearDraftButton")?.addEventListener("click", clearDraft);
  document.querySelector("#saveExitButton")?.addEventListener("click", async () => {
    saveDraft();
    dirtyDraft = false;
    toast("Rascunho salvo. Encerrando sessão...", "success");
    try {
      await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
    } catch {}
    setTimeout(() => window.location.reload(), 800);
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

  // O servidor e a fonte da verdade sobre "ja enviou": sincroniza o
  // localStorage com ela. Assim, quando o admin limpa os envios no painel,
  // o candidato consegue enviar de novo sem precisar limpar nada no proprio
  // navegador (a flag antiga ficaria presa pra sempre senao).
  serverAlreadySubmitted = Boolean(data.you?.alreadySubmitted);
  if (serverAlreadySubmitted) {
    localStorage.setItem(SUBMITTED_KEY, "1");
  } else {
    localStorage.removeItem(SUBMITTED_KEY);
  }
}

function renderExamClosedBanner(start, end) {
  const banner = document.querySelector("#examClosedBanner");
  if (!banner) return;
  const fmt = (iso) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  banner.classList.remove("hidden");
  banner.innerHTML = `<strong>Edital fora do período.</strong> Janela oficial: ${fmt(start)} a ${fmt(end)}.`;
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

function showMaintenancePanel() {
  document.querySelector("#maintenancePanel")?.classList.remove("hidden");
  document.querySelector("#loginGate")?.classList.add("hidden");
  document.querySelectorAll(".candidate-only").forEach((el) => el.classList.add("hidden"));
}

function showPreExamPanel(startIso) {
  const panel = document.querySelector("#preExamPanel");
  if (!panel) return;
  panel.classList.remove("hidden");
  document.querySelectorAll(".candidate-only").forEach((el) => el.classList.add("hidden"));
  const sub = document.querySelector("#preExamSubtitle");
  const countdown = document.querySelector("#preExamCountdown");
  if (sub) sub.textContent = `Abertura em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(new Date(startIso))}`;
  const update = () => {
    const remaining = Math.max(0, new Date(startIso).getTime() - Date.now());
    if (!remaining) { window.location.reload(); return; }
    const dd = Math.floor(remaining / 86400000);
    const hh = String(Math.floor((remaining / 3600000) % 24)).padStart(2, "0");
    const mins = String(Math.floor((remaining / 60000) % 60)).padStart(2, "0");
    const secs = String(Math.floor((remaining / 1000) % 60)).padStart(2, "0");
    if (countdown) countdown.textContent = `${dd}d ${hh}:${mins}:${secs}`;
  };
  update();
  setInterval(update, 1000);
}

async function boot() {
  bindTheme();
  bindSessionEvents();
  registerServiceWorker();
  handleLoginCallback();
  await loadPublicConfig();

  // Modo manutencao: bloqueia tudo pra candidato comum, antes mesmo do login.
  if (publicConfig.maintenance) {
    showMaintenancePanel();
    return;
  }

  // Pre-edital: se ainda nao abriu, mostra contagem regressiva e nao pede login.
  const now = Date.now();
  const start = publicConfig.examStartAt ? new Date(publicConfig.examStartAt).getTime() : 0;
  if (start && now < start) {
    showPreExamPanel(publicConfig.examStartAt);
    return;
  }

  await checkSession();
  if (!currentSession.authenticated) {
    return;
  }
  try {
    await loadExamFromServer();
  } catch (error) {
    if (error.message?.includes("manutenção")) { showMaintenancePanel(); return; }
    toast(error.message, "error", "Carregar edital");
    return;
  }

  if (serverAlreadySubmitted) {
    await loadMyResults();
    return;
  }

  // Edital fechado: o servidor nao manda as perguntas pra candidato comum,
  // entao nem rendereriza o formulario - so o banner de "fora do periodo".
  if (!objectiveQuestions.length) {
    document.querySelectorAll(".candidate-only").forEach((el) => {
      if (el.id !== "examClosedBanner") el.classList.add("hidden");
    });
    return;
  }

  setupHCaptchaIfNeeded();
  renderQuestions();
  loadDraft();
  await loadServerDraftIfNewer();
  bindEvents();
  updateCounters();
  updateProgress();
  tickClock();
  setInterval(tickClock, 1000);
  setInterval(refreshSavedAgo, 5000);

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

boot();
