let selectedSubmissionId = null;
let reviewUnlocked = false;
let loadedSubmissions = [];
// Conjunto de IDs marcados pra acoes em lote.
const bulkSelection = new Set();

// Badge no titulo da aba: avisa que chegaram envios novos enquanto o admin
// estava em outra aba, sem precisar deixar o painel sempre em foco.
const ORIGINAL_TITLE = document.title;
let lastKnownSubmissionCount = null;
let newSubmissionsSinceView = 0;

function updateTabTitleBadge() {
  document.title = newSubmissionsSinceView > 0
    ? `(${newSubmissionsSinceView}) ${ORIGINAL_TITLE}`
    : ORIGINAL_TITLE;
}

function noteSubmissionCount(count) {
  if (lastKnownSubmissionCount === null) {
    lastKnownSubmissionCount = count;
    return;
  }
  if (count > lastKnownSubmissionCount && document.hidden) {
    newSubmissionsSinceView += count - lastKnownSubmissionCount;
    updateTabTitleBadge();
  }
  lastKnownSubmissionCount = count;
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && newSubmissionsSinceView > 0) {
    newSubmissionsSinceView = 0;
    updateTabTitleBadge();
  }
});

const toastStack = document.querySelector("#toastStack");
const reviewDashboard = document.querySelector("#reviewDashboard");
const reviewLocked = document.querySelector("#reviewLocked");
const summaryGrid = document.querySelector("#summaryGrid");
const submissionList = document.querySelector("#submissionList");
const submissionDetail = document.querySelector("#submissionDetail");
const riskFilter = document.querySelector("#riskFilter");
const searchInput = document.querySelector("#searchInput");
const sortBy = document.querySelector("#sortBy");

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
    const selected = bulkSelection.has(submission.id);
    const gradePill = submission.manualGrade != null ? `<span class="pill good">Nota ${submission.manualGrade}</span>` : "";
    return `
      <div class="submission-card-wrap">
        <label class="submission-check" title="Selecionar para acoes em lote">
          <input type="checkbox" data-bulk-select="${submission.id}" ${selected ? "checked" : ""}>
        </label>
        <button class="submission-card ${submission.id === selectedSubmissionId ? "active" : ""}" type="button" data-submission-id="${submission.id}" style="--card-progress:${percentage}%">
          <h3>${escapeHtml(submission.identity.discord || "Sem Discord")}</h3>
          <div class="submission-meta">
            <span class="pill">${percentage}% objetivas</span>
            ${gradePill}
            <span class="pill ${status.className}">${status.text}</span>
            <span class="pill ${risk.className}">${risk.text}</span>
            ${submission.devtoolsOpened ? `<span class="pill bad">DevTools</span>` : ""}
            ${submission.fingerprintMatches?.length ? `<span class="pill bad">⚠ Mesmo dispositivo</span>` : ""}
            ${submission.reviewer ? `<span class="pill">👤 ${escapeHtml(submission.reviewer)}</span>` : ""}
            <span class="pill">${formatDate(submission.submittedAt)}</span>
          </div>
        </button>
      </div>
    `;
  }).join("");
  updateBulkUI();
}

function updateBulkUI() {
  const bar = document.querySelector("#bulkActions");
  const count = document.querySelector("#bulkCount");
  if (!bar) return;
  if (bulkSelection.size === 0) {
    bar.classList.add("hidden");
  } else {
    bar.classList.remove("hidden");
    if (count) count.textContent = `${bulkSelection.size} selecionado(s)`;
  }
}

function readAdvancedFilters() {
  return {
    devtools: document.querySelector("#advFilterDevtools")?.checked,
    sameDevice: document.querySelector("#advFilterSameDevice")?.checked,
    hasGrade: document.querySelector("#advFilterHasGrade")?.checked,
    noGrade: document.querySelector("#advFilterNoGrade")?.checked,
    highSimilarity: document.querySelector("#advFilterHighSimilarity")?.checked,
    hasReviewer: document.querySelector("#advFilterHasReviewer")?.checked
  };
}

function getFilteredSubmissions() {
  const filter = riskFilter?.value || "all";
  const sort = sortBy?.value || "date";
  const term = normalizeText(searchInput?.value || "");
  const adv = readAdvancedFilters();

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

  // Filtros avancados (AND): cada checkbox marcado restringe a lista.
  if (adv.devtools) submissions = submissions.filter((s) => s.devtoolsOpened);
  if (adv.sameDevice) submissions = submissions.filter((s) => s.fingerprintMatches?.length);
  if (adv.hasGrade) submissions = submissions.filter((s) => s.manualGrade != null);
  if (adv.noGrade) submissions = submissions.filter((s) => s.manualGrade == null);
  if (adv.highSimilarity) submissions = submissions.filter((s) => (s.similaritySummary?.maxRatio || 0) >= 55);
  if (adv.hasReviewer) submissions = submissions.filter((s) => s.reviewer);

  if (sort === "score") {
    submissions.sort((a, b) => (b.objectiveScore / b.objectiveTotal) - (a.objectiveScore / a.objectiveTotal));
  } else if (sort === "risk") {
    submissions.sort((a, b) => b.aiRiskAverage - a.aiRiskAverage);
  } else if (sort === "grade") {
    submissions.sort((a, b) => (b.manualGrade ?? -1) - (a.manualGrade ?? -1));
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
        <div class="answer-text">${answer.answerHtml || escapeHtml(answer.answer)}</div>
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
      <button class="ghost-button" type="button" data-copy-link="${submission.id}">📋 Copiar link</button>
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
      <div class="detail-box ${submission.fingerprintMatches?.length ? "alert" : ""}">
        <span>Fingerprint</span>
        <strong>${escapeHtml(submission.fingerprint || "-")}</strong>
        ${submission.fingerprintMatches?.length ? `<span class="alert-text">⚠ Mesmo dispositivo de ${submission.fingerprintMatches.length} outro(s): ${submission.fingerprintMatches.map((m) => "@" + escapeHtml(m)).join(", ")}</span>` : ""}
      </div>
      <div class="detail-box ${submission.devtoolsOpened ? "alert" : ""}"><span>DevTools</span><strong>${submission.devtoolsOpened ? "ABERTO" : "nao"}</strong></div>
      <div class="detail-box"><span>Voltas na revisao</span><strong>${submission.reviewCount || 0}</strong></div>
      <div class="detail-box"><span>Maior inatividade</span><strong>${Math.round((submission.maxIdleMs || 0) / 1000)}s</strong></div>
      ${submission.autoSuggestedStatus ? `<div class="detail-box"><span>Sugestao automatica</span><strong>${escapeHtml(submission.autoSuggestedStatus)}</strong></div>` : ""}
    </div>
    ${renderTimePerQuestionChart(submission)}
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
      <span>Nota manual do revisor (0 a 10)</span>
      <span class="reviewer-row">
        <input id="manualGradeInput" type="number" min="0" max="10" step="0.1" value="${submission.manualGrade ?? ""}" placeholder="Ex.: 8.5">
        <input id="manualGradeNoteInput" type="text" value="${escapeHtml(submission.manualGradeNote || "")}" placeholder="Comentario do revisor (opcional)">
        <button class="secondary-button" type="button" data-save-grade="${submission.id}">Salvar nota</button>
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

function updateStatusChipCounts(allSubmissions) {
  const counts = { all: allSubmissions.length, approved: 0, rejected: 0, review: 0 };
  allSubmissions.forEach((item) => {
    if (item.status === "Aprovado") counts.approved += 1;
    else if (item.status === "Reprovado") counts.rejected += 1;
    else counts.review += 1;
  });
  const set = (id, value) => { const el = document.querySelector(id); if (el) el.textContent = value; };
  set("#chipCountAll", counts.all);
  set("#chipCountApproved", counts.approved);
  set("#chipCountRejected", counts.rejected);
  set("#chipCountReview", counts.review);
}

function syncStatusChipsFromFilter() {
  const value = riskFilter?.value || "all";
  const activeChip = ["all", "approved", "rejected", "review"].includes(value) ? value : "all";
  document.querySelectorAll("[data-status-chip]").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.statusChip === activeChip);
  });
}

// Cruza fingerprints entre todas as submissoes carregadas e anota em
// cada uma quais outros candidatos compartilham o mesmo dispositivo.
// Sinal forte de tentativa de multipla conta na mesma maquina.
function annotateFingerprintMatches(submissions) {
  const byFp = new Map();
  submissions.forEach((s) => {
    const fp = s.fingerprint;
    if (!fp || fp === "-") return;
    if (!byFp.has(fp)) byFp.set(fp, []);
    byFp.get(fp).push(s);
  });
  submissions.forEach((s) => {
    const same = byFp.get(s.fingerprint) || [];
    s.fingerprintMatches = same
      .filter((other) => other.id !== s.id)
      .map((other) => other.identity?.discord || "?")
      .slice(0, 5);
  });
}

function renderReview() {
  if (!reviewUnlocked) return;
  const allSubmissions = [...loadedSubmissions].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  annotateFingerprintMatches(allSubmissions);
  const filteredSubmissions = getFilteredSubmissions();
  renderSummary(allSubmissions);
  updateStatusChipCounts(allSubmissions);
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
  noteSubmissionCount(loadedSubmissions.length);

  // Suporte a link direto: /admin#submission/<id> pula direto pra ficha
  // do candidato e abre a aba "Candidatos".
  const hashMatch = window.location.hash.match(/^#submission\/([\w-]+)$/);
  if (hashMatch && loadedSubmissions.some((s) => s.id === hashMatch[1])) {
    selectedSubmissionId = hashMatch[1];
    switchAdminTab("candidates");
  }
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
    noteSubmissionCount(loadedSubmissions.length);
    renderReview();
  } catch {
    // mantem a lista atual em caso de falha temporaria
  }
}

function renderTimelineChart(perDay) {
  const el = document.querySelector("#timelineChart");
  if (!el) return;
  if (!perDay || !perDay.length) {
    el.innerHTML = `<div class="empty-state">Sem envios registrados ainda.</div>`;
    return;
  }
  const max = Math.max(1, ...perDay.map(([, count]) => count));
  const width = Math.max(220, perDay.length * 44);
  const bars = perDay.map(([day, count], index) => {
    const height = Math.round((count / max) * 70);
    const label = day.slice(5).replace("-", "/");
    return `
      <g transform="translate(${index * 44 + 10}, 0)">
        <rect x="0" y="${90 - height}" width="30" height="${height}" rx="3"></rect>
        <text x="15" y="${Math.max(12, 84 - height)}" text-anchor="middle" class="bar-value">${count}</text>
        <text x="15" y="106" text-anchor="middle" class="bar-label">${label}</text>
      </g>
    `;
  }).join("");
  el.innerHTML = `<svg class="bar-chart timeline-chart" viewBox="0 0 ${width} 116" role="img">${bars}</svg>`;
}

async function loadMetricsChart() {
  try {
    const res = await api("/api/admin/metrics");
    if (!res.ok) return;
    const data = await res.json();
    renderTimelineChart(data.perDay);
  } catch {
    // mantem o estado anterior em caso de falha temporaria
  }
}

// Comparativo entre questoes objetivas (% acertos por questao).
function renderQuestionStatsChart(questions) {
  const el = document.querySelector("#questionStatsChart");
  if (!el) return;
  if (!questions?.length) {
    el.innerHTML = `<div class="empty-state">Sem dados ainda.</div>`;
    return;
  }
  const width = Math.max(220, questions.length * 30);
  const bars = questions.map((q, i) => {
    const height = Math.round((q.percent / 100) * 70);
    const color = q.percent >= 70 ? "#287355" : q.percent >= 40 ? "#b97518" : "#b73d35";
    return `
      <g transform="translate(${i * 30 + 10}, 0)">
        <rect x="0" y="${90 - height}" width="22" height="${height}" rx="3" fill="${color}">
          <title>Questao ${q.id}: ${q.percent}% acertaram (${q.correct}/${q.total})</title>
        </rect>
        <text x="11" y="${Math.max(12, 84 - height)}" text-anchor="middle" class="bar-value">${q.percent}%</text>
        <text x="11" y="106" text-anchor="middle" class="bar-label">${q.id}</text>
      </g>
    `;
  }).join("");
  el.innerHTML = `<svg class="bar-chart timeline-chart" viewBox="0 0 ${width} 116" role="img">${bars}</svg>`;
}

async function loadQuestionStatsChart() {
  try {
    const res = await api("/api/admin/question-stats");
    if (!res.ok) return;
    const data = await res.json();
    renderQuestionStatsChart(data.questions);
  } catch {
    // mantem o estado anterior
  }
}

// Mini grafico de tempo gasto por questao (objetivas + subjetivas), usado
// no detalhe do candidato. Picos longos podem indicar consulta externa.
function renderTimePerQuestionChart(submission) {
  const objs = submission.objectiveAnswers || [];
  const subs = submission.subjectiveAnswers || [];
  const items = [
    ...objs.map((a) => ({ label: String(a.id), sec: Math.round((a.timeSpentMs || 0) / 1000), kind: "obj" })),
    ...subs.map((a) => ({ label: String(a.id), sec: Math.round((a.timeSpentMs || 0) / 1000), kind: "subj" }))
  ];
  if (!items.length) return "";
  const max = Math.max(1, ...items.map((i) => i.sec));
  const width = Math.max(220, items.length * 18);
  const bars = items.map((it, i) => {
    const h = Math.round((it.sec / max) * 60);
    const fill = it.kind === "obj" ? "var(--gold)" : "var(--gold-2)";
    return `
      <g transform="translate(${i * 18 + 6}, 0)">
        <rect x="0" y="${70 - h}" width="12" height="${h}" rx="2" fill="${fill}">
          <title>Q${it.label}: ${it.sec}s</title>
        </rect>
      </g>
    `;
  }).join("");
  return `
    <div class="answer-review time-chart-box">
      <span>Tempo gasto por questao (segundos)</span>
      <svg class="bar-chart" viewBox="0 0 ${width} 80" role="img">${bars}</svg>
    </div>
  `;
}

// ---- Acoes em lote: aprovar/reprovar varios candidatos de uma vez. ----
async function bulkUpdateStatus(status) {
  if (!bulkSelection.size) return;
  if (!confirm(`Aplicar status "${status}" a ${bulkSelection.size} candidato(s)?`)) return;
  const ids = [...bulkSelection];
  let ok = 0;
  let fail = 0;
  for (const id of ids) {
    try {
      const res = await api(`/api/admin/submissions/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, note: "Atualizacao em lote" })
      });
      if (res.ok) {
        const target = loadedSubmissions.find((s) => s.id === id);
        if (target) target.status = status;
        ok += 1;
      } else {
        fail += 1;
      }
    } catch {
      fail += 1;
    }
  }
  bulkSelection.clear();
  renderReview();
  toast(`${ok} atualizado(s)${fail ? `, ${fail} com erro` : ""}.`, fail ? "warn" : "success");
}

async function sendRanking() {
  if (!confirm("Enviar o ranking atual dos aprovados para o canal do Discord?")) return;
  try {
    const res = await api("/api/admin/ranking/send", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Falha ao enviar ranking.");
    toast(`Ranking de ${data.count} aprovados enviado.`, "success", "Discord");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function sendStats() {
  if (!confirm("Enviar as estatisticas da semana para o canal do Discord?")) return;
  try {
    const res = await api("/api/admin/stats/send", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Falha ao enviar estatisticas.");
    toast(`Estatisticas enviadas (${data.weekTotal} envios na semana).`, "success", "Discord");
  } catch (error) {
    toast(error.message, "error");
  }
}

// Aplica os valores do formulario de tema diretamente como CSS vars,
// sem persistir, pro admin ver o resultado antes de salvar.
function previewTheme() {
  const form = document.querySelector("#themeForm");
  if (!form) return;
  const root = document.documentElement;
  const setVar = (name, value) => {
    if (value && value.trim()) root.style.setProperty(name, value.trim());
  };
  setVar("--navy", form.elements.primaryColor.value);
  setVar("--gold", form.elements.accentColor.value);
  setVar("--paper", form.elements.backgroundColor.value);
  // Logo no painel admin: troca se URL valida.
  const logo = form.elements.logoUrl.value.trim();
  if (logo) {
    document.querySelectorAll(".brand img").forEach((img) => { img.src = logo; });
  }
  toast("Visualizacao aplicada (nao salvo). Clique em Salvar tema pra persistir.", "info", "Preview");
}

async function saveTheme(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const theme = {
    bannerTitle: form.elements.bannerTitle.value.trim(),
    bannerSubtitle: form.elements.bannerSubtitle.value.trim(),
    primaryColor: form.elements.primaryColor.value.trim(),
    accentColor: form.elements.accentColor.value.trim(),
    backgroundColor: form.elements.backgroundColor.value.trim(),
    logoUrl: form.elements.logoUrl.value.trim()
  };
  try {
    const res = await api("/api/admin/config", { method: "PATCH", body: JSON.stringify({ theme }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Falha ao salvar tema.");
    toast("Tema salvo. Os candidatos verao no proximo carregamento.", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function resetTheme() {
  if (!confirm("Voltar ao tema padrao?")) return;
  try {
    const res = await api("/api/admin/config", {
      method: "PATCH",
      body: JSON.stringify({ theme: { bannerTitle: "", bannerSubtitle: "", primaryColor: "", accentColor: "", backgroundColor: "", logoUrl: "" } })
    });
    if (!res.ok) throw new Error("Falha ao resetar tema.");
    document.querySelectorAll("#themeForm input").forEach((i) => { i.value = ""; });
    toast("Tema padrao restaurado.", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

function enterReviewMode() {
  reviewUnlocked = true;
  reviewLocked.classList.add("hidden");
  reviewDashboard.classList.remove("hidden");
  refreshActiveNow();
  loadMetricsChart();
  loadQuestionStatsChart();
  if (!activePollTimer) {
    activePollTimer = setInterval(() => {
      refreshActiveNow();
      refreshSubmissionsQuietly();
      loadMetricsChart();
      loadQuestionStatsChart();
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
  const gradeBtn = event.target.closest("[data-save-grade]");
  if (gradeBtn) {
    const id = gradeBtn.dataset.saveGrade;
    const gradeRaw = document.querySelector("#manualGradeInput").value.trim();
    const note = document.querySelector("#manualGradeNoteInput").value.trim();
    try {
      const response = await api(`/api/admin/submissions/${id}/grade`, {
        method: "PATCH",
        body: JSON.stringify({ grade: gradeRaw === "" ? null : Number(gradeRaw), note })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Falha ao salvar nota.");
      const target = loadedSubmissions.find((item) => item.id === id);
      if (target) {
        target.manualGrade = data.grade;
        target.manualGradeNote = data.note;
      }
      renderReview();
      toast("Nota salva.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
    return;
  }
  const copyBtn = event.target.closest("[data-copy-link]");
  if (copyBtn) {
    const url = `${window.location.origin}/admin#submission/${copyBtn.dataset.copyLink}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copiado para a area de transferencia.", "success");
    } catch {
      prompt("Copie o link manualmente:", url);
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

function renderUserBadge(data) {
  const badge = document.querySelector("#userBadge");
  if (!badge) return;
  if (!data?.authenticated) {
    badge.classList.add("hidden");
    return;
  }
  const avatar = document.querySelector("#userAvatar");
  const name = document.querySelector("#userName");
  if (avatar && data.avatarUrl) avatar.src = data.avatarUrl;
  if (name) name.textContent = `@${data.username || ""}`;
  badge.classList.remove("hidden");
}

// Sessao via cookie e a mesma do edital. Como agora o login acontece no
// proprio site do edital, aqui so checamos o estado: se nao tem sessao ou
// nao e admin, mostra mensagem orientando voltar pro edital.
async function checkSessionAndBoot() {
  try {
    const res = await fetch("/api/session", { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    renderUserBadge(data);
    if (data.authenticated && data.isAdmin) {
      await loadAdminSubmissions();
      enterReviewMode();
      await loadConfig();
      toast(`Bem-vindo, @${data.username}.`, "success", "Painel liberado");
    } else if (data.authenticated && !data.isAdmin) {
      reviewLocked.innerHTML = `Voce esta logado como <strong>@${escapeHtml(data.username)}</strong>, mas essa conta nao tem permissao de administrador. <a href="/">Voltar ao edital</a>`;
    } else {
      reviewLocked.innerHTML = 'Voce nao esta logado. <a href="/">Entre com Discord pelo edital</a> para acessar o painel.';
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
    if (form.elements.maxApproved) form.elements.maxApproved.value = cfg.maxApproved || 0;
    if (form.elements.maintenance) form.elements.maintenance.checked = Boolean(cfg.maintenance);
    form.elements.discordAllowedUsers.value = (cfg.discordAllowedUsers || []).join(", ");
    // Popula o formulario de tema com os valores atuais.
    const themeForm = document.querySelector("#themeForm");
    if (themeForm && cfg.theme) {
      themeForm.elements.bannerTitle.value = cfg.theme.bannerTitle || "";
      themeForm.elements.bannerSubtitle.value = cfg.theme.bannerSubtitle || "";
      themeForm.elements.primaryColor.value = cfg.theme.primaryColor || "";
      themeForm.elements.accentColor.value = cfg.theme.accentColor || "";
      themeForm.elements.backgroundColor.value = cfg.theme.backgroundColor || "";
      themeForm.elements.logoUrl.value = cfg.theme.logoUrl || "";
    }
    if (status) {
      const captchaInfo = cfg.hcaptchaConfigured ? "hCaptcha ativo" : "hCaptcha desativado";
      const maintInfo = cfg.maintenance ? " | MODO MANUTENCAO ATIVO" : "";
      status.textContent = `Edital ${cfg.isOpen ? "ABERTO" : "FECHADO"} agora. ${captchaInfo}${maintInfo}.`;
    }
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
    maxApproved: form.elements.maxApproved ? Number(form.elements.maxApproved.value) : 0,
    maintenance: form.elements.maintenance ? Boolean(form.elements.maintenance.checked) : false,
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

function switchAdminTab(tabName) {
  document.querySelectorAll(".admin-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".admin-tab-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `tab-${tabName}`);
  });
  if (tabName === "audit") loadAuditLog();
}

function auditActionLabel(action) {
  const labels = {
    "login.pin": "Login com senha",
    "discord.login": "Login Discord",
    "discord.login.admin": "Login Discord (admin)",
    "discord.login.denied": "Login Discord negado",
    "config.update": "Configuracao alterada",
    "submission.status": "Status de candidato alterado",
    "submission.reviewer": "Revisor atribuido",
    "submissions.clear": "Envios apagados",
    "backup.run": "Backup automatico executado"
  };
  return labels[action] || action;
}

async function loadAuditLog() {
  const list = document.querySelector("#auditList");
  if (!list) return;
  list.innerHTML = `<div class="empty-state">Carregando...</div>`;
  try {
    const response = await api("/api/admin/audit?limit=200");
    if (!response.ok) throw new Error("Falha ao carregar auditoria.");
    const entries = await response.json();
    if (!entries.length) {
      list.innerHTML = `<div class="empty-state">Nenhuma acao registrada ainda.</div>`;
      return;
    }
    list.innerHTML = entries.map((entry) => `
      <div class="audit-item">
        <div class="audit-item-head">
          <strong>${escapeHtml(auditActionLabel(entry.action))}</strong>
          <span class="pill">${formatDate(entry.at)}</span>
        </div>
        <div class="audit-item-meta">
          <span>por <strong>${escapeHtml(entry.actor || "?")}</strong></span>
          ${entry.target ? `<span>em <code>${escapeHtml(String(entry.target).slice(0, 12))}</code></span>` : ""}
          ${entry.meta ? `<span>${escapeHtml(JSON.stringify(entry.meta))}</span>` : ""}
        </div>
      </div>
    `).join("");
  } catch (error) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function bindEvents() {
  document.querySelectorAll(".admin-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchAdminTab(btn.dataset.tab));
  });
  document.querySelector("#reloadAuditButton")?.addEventListener("click", loadAuditLog);
  document.querySelector("#configForm")?.addEventListener("submit", saveConfig);
  document.querySelector("#reloadConfigButton")?.addEventListener("click", loadConfig);
  document.querySelector("#clearSubmissionsButton")?.addEventListener("click", async () => {
    const sure = confirm(
      "ATENCAO: isso vai apagar TODOS os envios salvos e resetar o edital - " +
      "todos os candidatos poderao enviar de novo. Essa acao NAO PODE SER DESFEITA.\n\n" +
      "Deseja continuar?"
    );
    if (!sure) return;
    const typed = prompt('Para confirmar, digite "APAGAR" (em letras maiusculas):');
    if (typed !== "APAGAR") {
      toast("Limpeza cancelada.", "info");
      return;
    }
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
    const check = event.target.closest("[data-bulk-select]");
    if (check) {
      const id = check.dataset.bulkSelect;
      if (check.checked) bulkSelection.add(id);
      else bulkSelection.delete(id);
      updateBulkUI();
      event.stopPropagation();
      return;
    }
    const button = event.target.closest("[data-submission-id]");
    if (!button) return;
    selectedSubmissionId = button.dataset.submissionId;
    renderReview();
  });
  document.querySelector("#bulkActions")?.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-bulk]");
    if (btn) await bulkUpdateStatus(btn.dataset.bulk);
    if (event.target.id === "bulkClear") {
      bulkSelection.clear();
      renderReview();
    }
  });
  document.querySelectorAll(".advanced-filter-grid input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => renderReview());
  });
  document.querySelector("#sendRankingButton")?.addEventListener("click", sendRanking);
  document.querySelector("#sendStatsButton")?.addEventListener("click", sendStats);
  document.querySelector("#themeForm")?.addEventListener("submit", saveTheme);
  document.querySelector("#resetThemeButton")?.addEventListener("click", resetTheme);
  document.querySelector("#previewThemeButton")?.addEventListener("click", previewTheme);
  submissionDetail?.addEventListener("click", handleSubmissionDetailClick);
  document.querySelector("#closeCompare")?.addEventListener("click", () => {
    document.querySelector("#compareModal")?.classList.add("hidden");
  });
  document.querySelector("#compareModal")?.addEventListener("click", (event) => {
    if (event.target.id === "compareModal") event.currentTarget.classList.add("hidden");
  });
  searchInput?.addEventListener("input", () => renderReview());
  sortBy?.addEventListener("change", () => renderReview());
  riskFilter?.addEventListener("change", () => {
    syncStatusChipsFromFilter();
    renderReview();
  });
  document.querySelector("#statusChips")?.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-status-chip]");
    if (!chip) return;
    if (riskFilter) riskFilter.value = chip.dataset.statusChip;
    syncStatusChipsFromFilter();
    renderReview();
  });
}

bindTheme();
bindEvents();
bootstrapFromCallback().then(checkSessionAndBoot);
