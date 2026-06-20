let selectedSubmissionId = null;
let reviewUnlocked = false;
let loadedSubmissions = [];

const toastStack = document.querySelector("#toastStack");
const reviewDashboard = document.querySelector("#reviewDashboard");
const reviewLocked = document.querySelector("#reviewLocked");
const summaryGrid = document.querySelector("#summaryGrid");
const submissionList = document.querySelector("#submissionList");
const submissionDetail = document.querySelector("#submissionDetail");
const riskFilter = document.querySelector("#riskFilter");
const logoutAdminButton = document.querySelector("#logoutAdminButton");
const searchInput = document.querySelector("#searchInput");
const sortBy = document.querySelector("#sortBy");
const dateFrom = document.querySelector("#dateFrom");
const dateTo = document.querySelector("#dateTo");

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

function toast(message, kind = "info", title = "") {
  if (!toastStack) return;
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

// Mesma origem do edital agora: sessao via cookie, sem token na URL.
function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(path, { ...options, headers, credentials: "same-origin" });
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
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
    <div class="summary-card chart-card">
      <span>risco IA x % objetivas</span>
      ${renderScatter(submissions)}
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

function renderScatter(submissions) {
  if (!submissions.length) return `<svg class="bar-chart" viewBox="0 0 220 120" role="img"></svg>`;
  const points = submissions.map((item) => {
    const x = Math.round((item.objectiveScore / item.objectiveTotal) * 100);
    const y = Math.max(0, Math.min(100, Number(item.aiRiskAverage || 0)));
    return `<circle cx="${10 + x * 2}" cy="${110 - y}" r="3" fill="currentColor"></circle>`;
  }).join("");
  return `<svg class="bar-chart" viewBox="0 0 220 120" role="img">
    <line x1="10" y1="110" x2="210" y2="110" stroke="#999" stroke-width="0.5"/>
    <line x1="10" y1="10" x2="10" y2="110" stroke="#999" stroke-width="0.5"/>
    <text x="110" y="118" text-anchor="middle" class="bar-label">% objetivas</text>
    ${points}
  </svg>`;
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
          ${submission.devtoolsOpened ? `<span class="pill bad">DevTools</span>` : ""}
          ${submission.reviewer ? `<span class="pill">👤 ${escapeHtml(submission.reviewer)}</span>` : ""}
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
  const from = dateFrom?.value ? new Date(`${dateFrom.value}T00:00:00`).getTime() : null;
  const to = dateTo?.value ? new Date(`${dateTo.value}T23:59:59`).getTime() : null;

  let submissions = [...loadedSubmissions];

  if (term) {
    submissions = submissions.filter((item) => {
      const haystack = normalizeText(`${item.identity?.discord || ""} ${item.identity?.roblox || ""}`);
      return haystack.includes(term);
    });
  }

  if (from !== null) submissions = submissions.filter((item) => new Date(item.submittedAt).getTime() >= from);
  if (to !== null) submissions = submissions.filter((item) => new Date(item.submittedAt).getTime() <= to);

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
    const flags = answer.aiReview.flags?.length
      ? `<ul class="flag-list">${answer.aiReview.flags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join("")}</ul>`
      : `<p>Nenhum sinal forte encontrado.</p>`;
    const pasteFlag = answer.pasteDetected
      ? `<span class="pill bad">Conteudo colado detectado</span>`
      : "";
    const timeUsed = Number.isFinite(answer.timeSpentMs)
      ? `<span class="pill">${Math.round(answer.timeSpentMs / 1000)}s gastos</span>`
      : "";
    return `
      <div class="answer-review">
        <span>Questao ${answer.id} - ${answer.aiReview.wordCount} palavras - variedade ${answer.aiReview.uniqueRatio}%</span>
        <h3>${escapeHtml(answer.question)}</h3>
        <p class="answer-text">${escapeHtml(answer.answer)}</p>
        <div class="submission-meta">
          <span class="pill ${risk.className}">${risk.text}</span>
          <span class="pill">${answer.aiReview.score}% risco</span>
          ${timeUsed}
          ${pasteFlag}
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
    .map((item) => {
      const compareBtn = item.matchedSubmissionId
        ? ` <button class="link-button" type="button" data-compare="${item.matchedSubmissionId}" data-qid="${item.id}" data-self="${submission.id}">comparar</button>`
        : "";
      return `<li>Q${item.id}: <strong>${item.bestRatio}%</strong> similar a ${escapeHtml(item.matchedCandidate || "?")}${compareBtn}</li>`;
    })
    .join("");
  const history = (submission.statusHistory || []).slice().reverse()
    .map((entry) => `<li><strong>${escapeHtml(entry.status)}</strong> - ${formatDate(entry.at)} (${escapeHtml(entry.by || "?")})${entry.note ? `<br><span>${escapeHtml(entry.note)}</span>` : ""}</li>`)
    .join("");
  const tags = Array.isArray(submission.tags) ? submission.tags : [];
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
      <div class="detail-box"><span>UA hash</span><strong>${escapeHtml((submission.uaHash || "-").slice(0, 12))}</strong></div>
      <div class="detail-box"><span>IP hash</span><strong>${escapeHtml((submission.ipHash || "-").slice(0, 12))}</strong></div>
      <div class="detail-box"><span>Fingerprint</span><strong>${escapeHtml(submission.fingerprint || "-")}</strong></div>
      <div class="detail-box ${submission.devtoolsOpened ? "alert" : ""}"><span>DevTools</span><strong>${submission.devtoolsOpened ? "ABERTO" : "nao"}</strong></div>
      <div class="detail-box"><span>Voltas na revisao</span><strong>${submission.reviewCount || 0}</strong></div>
      <div class="detail-box"><span>Maior inatividade</span><strong>${Math.round((submission.maxIdleMs || 0) / 1000)}s</strong></div>
    </div>
    ${similarityRows ? `<div class="answer-review"><span>Subjetivas mais parecidas com outro candidato</span><ul class="flag-list">${similarityRows}</ul></div>` : ""}
    ${history ? `<div class="answer-review"><span>Historico de status</span><ul class="history-list">${history}</ul></div>` : ""}
    <label class="admin-note">
      <span>Revisor responsavel</span>
      <span class="reviewer-row">
        <input id="reviewerInput" type="text" value="${escapeHtml(submission.reviewer || "")}" placeholder="Nome do admin">
        <button class="secondary-button" type="button" data-save-reviewer="${submission.id}">Atribuir</button>
      </span>
    </label>
    <label class="admin-note">
      <span>Tags (separadas por virgula)</span>
      <input id="adminTagsInput" type="text" value="${escapeHtml(tags.join(", "))}">
    </label>
    <label class="admin-note">
      <span>Observacao administrativa</span>
      <textarea id="adminNoteInput" placeholder="Escreva uma observacao para este candidato.">${escapeHtml(submission.adminNote || "")}</textarea>
    </label>
    <div class="detail-actions">
      <button class="primary-button" type="button" data-save-note="${submission.id}">Salvar observacao e tags</button>
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
  const response = await api("/api/admin/submissions");
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Nao foi possivel carregar o painel.");
  }
  loadedSubmissions = await response.json();
  renderReview();
}

let activePollTimer = null;
let sessionRefreshTimer = null;

async function refreshActiveNow() {
  const el = document.querySelector("#activeNow");
  if (!el) return;
  try {
    const res = await api("/api/admin/active");
    if (!res.ok) return;
    const data = await res.json();
    if (data.active > 0) {
      el.classList.remove("hidden");
      el.textContent = `🟢 ${data.active} preenchendo agora`;
    } else {
      el.classList.add("hidden");
    }
  } catch {
    el.classList.add("hidden");
  }
}

// Atualiza a lista de envios em segundo plano para que novas respostas dos
// candidatos apareçam sem precisar recarregar a pagina manualmente.
async function refreshSubmissionsQuietly() {
  try {
    const response = await api("/api/admin/submissions");
    if (!response.ok) return;
    loadedSubmissions = await response.json();
    renderReview();
  } catch {
    // mantem a lista atual em caso de falha temporaria
  }
}

function enterReviewMode() {
  reviewUnlocked = true;
  reviewLocked.classList.add("hidden");
  reviewDashboard.classList.remove("hidden");
  logoutAdminButton.disabled = false;
  refreshActiveNow();
  if (!activePollTimer) {
    activePollTimer = setInterval(() => {
      refreshActiveNow();
      refreshSubmissionsQuietly();
    }, 15000);
  }
  if (!sessionRefreshTimer) {
    sessionRefreshTimer = setInterval(() => {
      api("/api/admin/refresh", { method: "POST" }).catch(() => {});
    }, 10 * 60 * 1000);
  }
}

async function handleSubmissionDetailClick(event) {
  const setStatus = event.target.closest("[data-set-status]");
  if (setStatus) {
    const id = setStatus.dataset.id;
    const status = setStatus.dataset.setStatus;
    const note = prompt(`Observacao para "${status}" (opcional):`) || "";
    try {
      const response = await api(`/api/admin/submissions/${id}/status`, {
        method: "PATCH",
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
    const response = await api(`/api/admin/submissions/${pdfBtn.dataset.downloadPdf}/report.pdf`);
    if (!response.ok) {
      toast("Falha ao gerar PDF.", "error");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const noteBtn = event.target.closest("[data-save-note]");
  if (noteBtn) {
    const id = noteBtn.dataset.saveNote;
    const adminNote = document.querySelector("#adminNoteInput").value;
    const tagsRaw = document.querySelector("#adminTagsInput").value;
    const tags = tagsRaw.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12);
    try {
      const response = await api(`/api/admin/submissions/${id}/note`, {
        method: "PATCH",
        body: JSON.stringify({ adminNote, tags })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Falha ao salvar observacao.");
      const target = loadedSubmissions.find((item) => item.id === id);
      if (target) {
        target.adminNote = adminNote;
        target.tags = tags;
      }
      toast("Observacao salva.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
    return;
  }
  const reviewerBtn = event.target.closest("[data-save-reviewer]");
  if (reviewerBtn) {
    const id = reviewerBtn.dataset.saveReviewer;
    const reviewer = document.querySelector("#reviewerInput").value.trim();
    try {
      const response = await api(`/api/admin/submissions/${id}/reviewer`, {
        method: "PATCH",
        body: JSON.stringify({ reviewer })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Falha ao atribuir revisor.");
      const target = loadedSubmissions.find((item) => item.id === id);
      if (target) target.reviewer = data.reviewer;
      renderReview();
      toast("Revisor atribuido.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
    return;
  }
  const compareBtn = event.target.closest("[data-compare]");
  if (compareBtn) {
    openCompareModal(compareBtn.dataset.self, compareBtn.dataset.compare, Number(compareBtn.dataset.qid));
  }
}

function openCompareModal(selfId, otherId, qid) {
  const self = loadedSubmissions.find((item) => item.id === selfId);
  const other = loadedSubmissions.find((item) => item.id === otherId);
  if (!self || !other) {
    toast("Candidato pareado nao esta carregado.", "error");
    return;
  }
  const selfAns = self.subjectiveAnswers.find((a) => Number(a.id) === qid);
  const otherAns = other.subjectiveAnswers.find((a) => Number(a.id) === qid);
  const modal = document.querySelector("#compareModal");
  const body = document.querySelector("#compareBody");
  body.innerHTML = `
    <h3>Questao ${qid}</h3>
    <div class="compare-grid">
      <div>
        <span class="pill">${escapeHtml(self.identity.discord || "?")}</span>
        <p class="answer-text">${escapeHtml(selfAns?.answer || "-")}</p>
      </div>
      <div>
        <span class="pill">${escapeHtml(other.identity.discord || "?")}</span>
        <p class="answer-text">${escapeHtml(otherAns?.answer || "-")}</p>
      </div>
    </div>
  `;
  modal.classList.remove("hidden");
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

async function checkDiscordStatus() {
  try {
    const res = await fetch("/api/admin/discord/status", { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (!data.configured) {
      toast("Login Discord nao configurado no servidor.", "error", "Atencao");
    }
  } catch {
    // Servidor offline; mensagem aparece quando clicar
  }
}

function clearLoginQuery() {
  if (window.location.search) window.history.replaceState({}, "", window.location.pathname);
}

async function bootstrapFromCallback() {
  const params = new URLSearchParams(window.location.search);
  const result = params.get("login");
  if (result === "error") {
    toast(params.get("reason") || "Falha no login Discord.", "error");
    clearLoginQuery();
    return;
  }
  if (result === "ok") {
    clearLoginQuery();
  }
}

// Sessao via cookie e a mesma do edital: se quem entrou ja e admin
// autorizado, o painel abre direto, sem precisar logar de novo.
async function checkSessionAndBoot() {
  try {
    const res = await fetch("/api/session", { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (data.authenticated && data.isAdmin) {
      await loadAdminSubmissions();
      enterReviewMode();
      await loadConfig();
      toast(`Bem-vindo, @${data.username}.`, "success", "Painel liberado");
    } else if (data.authenticated && !data.isAdmin) {
      reviewLocked.textContent = `Voce esta logado como @${data.username}, mas essa conta nao tem permissao de administrador.`;
    }
  } catch (error) {
    toast(error.message || "Falha ao verificar sessao.", "error");
  }
}

function toLocalDatetimeValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadConfig() {
  const form = document.querySelector("#configForm");
  const status = document.querySelector("#configStatus");
  if (!form) return;
  try {
    const res = await api("/api/admin/config");
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Falha ao carregar config.");
    const cfg = await res.json();
    form.elements.examStartAt.value = toLocalDatetimeValue(cfg.examStartAt);
    form.elements.examEndAt.value = toLocalDatetimeValue(cfg.examEndAt);
    form.elements.minPerformancePercent.value = cfg.minPerformancePercent;
    form.elements.minFormDurationSec.value = Math.round((cfg.minFormDurationMs || 0) / 1000);
    form.elements.discordAllowedUsers.value = (cfg.discordAllowedUsers || []).join(", ");
    if (status) status.textContent = `Edital ${cfg.isOpen ? "ABERTO" : "FECHADO"} agora. Servidor: ${new Date(cfg.serverNow).toLocaleString("pt-BR")}`;
  } catch (error) {
    if (status) status.textContent = error.message;
  }
}

async function saveConfig(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector("#configStatus");
  const payload = {
    examStartAt: new Date(form.elements.examStartAt.value).toISOString(),
    examEndAt: new Date(form.elements.examEndAt.value).toISOString(),
    minPerformancePercent: Number(form.elements.minPerformancePercent.value),
    minFormDurationMs: Number(form.elements.minFormDurationSec.value) * 1000,
    discordAllowedUsers: form.elements.discordAllowedUsers.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  };
  try {
    const res = await api("/api/admin/config", { method: "PATCH", body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Falha ao salvar.");
    toast("Configuracoes salvas.", "success");
    await loadConfig();
  } catch (error) {
    if (status) status.textContent = error.message;
    toast(error.message, "error");
  }
}

function bindEvents() {
  document.querySelector("#configForm")?.addEventListener("submit", saveConfig);
  document.querySelector("#reloadConfigButton")?.addEventListener("click", loadConfig);
  document.querySelector("#discordLoginButton")?.addEventListener("click", () => {
    const returnTo = window.location.pathname;
    window.location.href = `/api/admin/discord/start?return_to=${encodeURIComponent(returnTo)}`;
  });
  document.querySelector("#clearSubmissionsButton")?.addEventListener("click", async () => {
    if (!confirm("Tem certeza que deseja apagar os envios salvos no banco?")) return;
    const response = await api("/api/admin/submissions", { method: "DELETE" });
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
  document.querySelector("#closeCompare")?.addEventListener("click", () => {
    document.querySelector("#compareModal")?.classList.add("hidden");
  });
  document.querySelector("#compareModal")?.addEventListener("click", (event) => {
    if (event.target.id === "compareModal") event.currentTarget.classList.add("hidden");
  });
  searchInput?.addEventListener("input", () => renderReview());
  sortBy?.addEventListener("change", () => renderReview());
  riskFilter?.addEventListener("change", () => renderReview());
  dateFrom?.addEventListener("change", () => renderReview());
  dateTo?.addEventListener("change", () => renderReview());
  logoutAdminButton?.addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST" }).catch(() => {});
    reviewUnlocked = false;
    reviewDashboard.classList.add("hidden");
    reviewLocked.classList.remove("hidden");
    reviewLocked.textContent = "Painel bloqueado. Apenas usuarios Discord autorizados podem acessar.";
    logoutAdminButton.disabled = true;
    if (activePollTimer) { clearInterval(activePollTimer); activePollTimer = null; }
    if (sessionRefreshTimer) { clearInterval(sessionRefreshTimer); sessionRefreshTimer = null; }
    toast("Sessao encerrada.", "success");
  });
}

bindTheme();
bindEvents();
checkDiscordStatus();
bootstrapFromCallback().then(checkSessionAndBoot);
