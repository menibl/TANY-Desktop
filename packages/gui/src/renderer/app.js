/* Vanilla JS renderer - no bundler needed since this only talks to the
   main process through the small `window.tany` bridge exposed by preload. */

const contentEl = document.getElementById("content");
const routineListEl = document.getElementById("routine-list");
let activeRoutineId = null;
let newRoutineState = null; // { type, startUrl, steps, editingRoutineId, existingTriggers }

const STEP_LABELS = {
  goto: "פתיחת עמוד",
  click: "לחיצה",
  fill: "מילוי שדה",
  press: "לחיצת מקש",
  select: "בחירה מרשימה",
  waitForSelector: "המתנה לאלמנט",
  extract: "חילוץ נתון",
  otp_injection: "הזרקת OTP",
};

/**
 * Wires the two-step one-time-login UI used both in the new-routine wizard
 * and the routine detail view's "refresh login" section: click startBtn ->
 * opens a plain, unmanaged Chrome window (main process) -> user logs in
 * manually -> click "done" to capture+save the session, or "cancel" to
 * abort. See engine-web/recorder.ts for why this can't be one click.
 */
function wireLoginFlow(root, startBtn, routineId, getUrl, statusEl, onSuccess) {
  const controls = root.querySelector(".login-active-controls");
  const finishBtn = root.querySelector(".login-finish-btn");
  const cancelBtn = root.querySelector(".login-cancel-btn");

  startBtn.addEventListener("click", async () => {
    const url = getUrl();
    if (!url) return;
    startBtn.disabled = true;
    statusEl.textContent = "נפתח חלון Chrome - התחברו ידנית, ואז לחצו 'סיימתי להתחבר'.";
    try {
      await window.tany.recording.loginStart(routineId, url);
      controls.style.display = "flex";
    } catch (err) {
      statusEl.textContent = `שגיאת התחברות: ${err.message || err}`;
      startBtn.disabled = false;
    }
  });

  finishBtn.addEventListener("click", async () => {
    finishBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      await window.tany.recording.loginFinish(routineId);
      controls.style.display = "none";
      startBtn.disabled = false;
      onSuccess();
    } catch (err) {
      statusEl.textContent = `שגיאה בשמירת ההתחברות: ${err.message || err}`;
    } finally {
      finishBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });

  cancelBtn.addEventListener("click", async () => {
    cancelBtn.disabled = true;
    finishBtn.disabled = true;
    try {
      await window.tany.recording.loginCancel(routineId);
    } finally {
      controls.style.display = "none";
      statusEl.textContent = "ההתחברות בוטלה.";
      startBtn.disabled = false;
      cancelBtn.disabled = false;
      finishBtn.disabled = false;
    }
  });
}

function describeSelector(step) {
  if (step.type === "goto") return step.url || "";
  if (!step.selectorKind) return step.key ? `מקש: ${step.key}` : "";
  if (step.selectorKind === "role") return `role=${step.role}${step.name ? ` name="${step.name}"` : ""}`;
  return `${step.selectorKind}="${step.selector ?? ""}"`;
}

async function refreshSidebar() {
  const [routines, device, service] = await Promise.all([
    window.tany.routines.list(),
    window.tany.device.get(),
    window.tany.service.status(),
  ]);

  routineListEl.innerHTML = "";
  for (const r of routines) {
    const li = document.createElement("li");
    li.className = r.routineId === activeRoutineId ? "active" : "";
    const status = r.lastRun ? r.lastRun.status : "never";
    li.innerHTML = `
      <div class="r-title">${escapeHtml(r.name)}</div>
      <div class="r-meta">
        <span class="badge ${status}">${statusLabel(status)}</span>
        ${r.type === "web" ? "🌐" : "🖥"} ${r.triggers.length} ניסוחים
      </div>`;
    li.addEventListener("click", () => selectRoutine(r.routineId));
    routineListEl.appendChild(li);
  }

  document.getElementById("device-name").textContent = device.deviceName;
  document.getElementById("device-id").textContent = device.deviceId;
  const statusBadge = document.getElementById("service-status");
  const toggleBtn = document.getElementById("service-toggle-btn");
  statusBadge.textContent = service.running ? `פעיל (:${service.port})` : "לא פעיל";
  statusBadge.className = "badge" + (service.running ? " online" : "");
  toggleBtn.textContent = service.running ? "עצור שירות" : "הפעל שירות";
  toggleBtn.onclick = async () => {
    if (service.running) await window.tany.service.stop();
    else await window.tany.service.start();
    refreshSidebar();
  };
}

function statusLabel(status) {
  return (
    { success: "הצליחה", failed: "נכשלה", awaiting_otp: "ממתינה ל-OTP", running: "רצה", never: "לא רצה עדיין" }[
      status
    ] || status
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function selectRoutine(routineId) {
  activeRoutineId = routineId;
  newRoutineState = null;
  await refreshSidebar();

  const detail = await window.tany.routines.get(routineId);
  const tpl = document.getElementById("tpl-routine-detail").content.cloneNode(true);
  const root = tpl.querySelector(".panel");

  root.querySelector(".r-name").textContent = detail.routine.name;

  const triggersEl = root.querySelector(".triggers");
  triggersEl.innerHTML = detail.triggers.map((t) => `<span class="trigger-chip">${escapeHtml(t)}</span>`).join("") || "<span class='muted'>אין ניסוחים</span>";

  const outputsEl = root.querySelector(".outputs");
  outputsEl.innerHTML =
    detail.definition.outputFields.map((f) => `<span class="output-chip">${escapeHtml(f)}</span>`).join("") ||
    "<span class='muted'>אין שדות פלט מוגדרים</span>";

  const stepsEl = root.querySelector(".steps");
  stepsEl.innerHTML = detail.definition.steps
    .map((s) => {
      const badges = [`<span class="step-badge">${STEP_LABELS[s.type] || s.type}</span>`];
      if (s.type === "otp_injection") badges.push('<span class="step-badge otp">OTP</span>');
      if (s.credentialField) badges.push(`<span class="step-badge cred">סוד: ${escapeHtml(s.credentialField)}</span>`);
      const valueTxt = s.type === "fill" && !s.credentialField ? ` = "${escapeHtml(s.value ?? "")}"` : "";
      return `<li>${badges.join(" ")} ${escapeHtml(describeSelector(s))}${valueTxt}</li>`;
    })
    .join("");

  const runLogBody = root.querySelector(".runlog-table tbody");
  runLogBody.innerHTML = detail.runLogs
    .map(
      (r) =>
        `<tr><td>${new Date(r.startedAt).toLocaleString("he-IL")}</td><td><span class="badge ${r.status}">${statusLabel(r.status)}</span></td><td>${r.failedStep ?? ""}</td><td>${escapeHtml(r.reason ?? "")}</td></tr>`
    )
    .join("");

  root.querySelector(".delete-btn").addEventListener("click", async () => {
    if (!confirm(`למחוק את השגרה "${detail.routine.name}"?`)) return;
    await window.tany.routines.delete(routineId);
    activeRoutineId = null;
    contentEl.innerHTML = "";
    refreshSidebar();
  });

  root.querySelector(".rerecord-btn").addEventListener("click", () => {
    startNewRoutineFlow({
      editingRoutineId: routineId,
      type: detail.routine.type,
      startUrl: detail.definition.startUrl,
      existingName: detail.routine.name,
      existingTriggers: detail.triggers,
    });
  });

  const authStatusEl = root.querySelector(".auth-status");
  authStatusEl.textContent = "";
  authStatusEl.innerHTML = detail.hasAuthState
    ? '<span class="badge online">מחובר</span>'
    : "<span class='muted'>אין התחברות שמורה לשגרה זו</span>";

  function getDetailStartUrl() {
    if (detail.definition.startUrl) return detail.definition.startUrl;
    alert("לשגרה הזו אין כתובת התחלה שמורה");
    return null;
  }

  wireLoginFlow(root, root.querySelector(".refresh-login-btn"), routineId, getDetailStartUrl, authStatusEl, () => {
    authStatusEl.innerHTML = '<span class="badge online">מחובר</span>';
  });

  const resultSection = root.querySelector(".run-result-section");
  const resultEl = root.querySelector(".run-result");
  const otpForm = root.querySelector(".otp-form");

  async function handleRunResult(result) {
    resultSection.style.display = "block";
    if (result.status === "success") {
      resultEl.innerHTML = `<div class="badge success">success</div><pre>${escapeHtml(JSON.stringify(result.result, null, 2))}</pre>`;
      otpForm.style.display = "none";
    } else if (result.status === "awaiting_otp") {
      resultEl.innerHTML = `<div class="badge awaiting_otp">awaiting_otp</div><p>${escapeHtml(result.prompt_hint)}</p>`;
      otpForm.style.display = "flex";
      otpForm.dataset.token = result.continuation_token;
    } else {
      resultEl.innerHTML = `<div class="badge failed">failed</div><p>שלב ${result.failed_step}: ${escapeHtml(result.reason)} - ${escapeHtml(result.message)}</p>`;
      otpForm.style.display = "none";
    }
    refreshSidebar();
  }

  root.querySelector(".run-btn").addEventListener("click", async (e) => {
    e.target.disabled = true;
    resultSection.style.display = "block";
    resultEl.textContent = "מריץ...";
    try {
      const result = await window.tany.routines.run(routineId);
      await handleRunResult(result);
    } finally {
      e.target.disabled = false;
    }
  });

  root.querySelector(".otp-submit").addEventListener("click", async () => {
    const token = otpForm.dataset.token;
    const code = otpForm.querySelector(".otp-input").value.trim();
    if (!code) return;
    const result = await window.tany.routines.submitOtp(token, code);
    await handleRunResult(result);
  });

  contentEl.innerHTML = "";
  contentEl.appendChild(root);
}

// ---- New routine / recording flow ----

function startNewRoutineFlow(opts = {}) {
  activeRoutineId = null;
  newRoutineState = {
    editingRoutineId: opts.editingRoutineId ?? null,
    // A stable id is needed before the routine is ever saved, so a one-time
    // login done before recording and the recording session itself agree on
    // where to store/load the saved auth state (see ipc.ts recording:login).
    routineId: opts.editingRoutineId ?? `rtn_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: opts.type ?? "web",
    startUrl: opts.startUrl ?? "",
    steps: [],
    existingName: opts.existingName ?? "",
    existingTriggers: opts.existingTriggers ?? [],
  };

  const tpl = document.getElementById("tpl-new-routine").content.cloneNode(true);
  const root = tpl.querySelector(".panel");

  const typeSelect = root.querySelector(".new-type");
  typeSelect.value = newRoutineState.type;
  const webOnly = root.querySelector(".web-only");
  const desktopOnly = root.querySelector(".desktop-only");
  typeSelect.addEventListener("change", () => {
    newRoutineState.type = typeSelect.value;
    webOnly.style.display = typeSelect.value === "web" ? "block" : "none";
    desktopOnly.style.display = typeSelect.value === "desktop" ? "block" : "none";
  });

  const startUrlInput = root.querySelector(".new-start-url");
  startUrlInput.value = newRoutineState.startUrl;

  const recordingStatus = root.querySelector(".recording-status");
  const loginStatus = root.querySelector(".login-status");
  const stepsReview = root.querySelector(".steps-review");
  const nameInput = root.querySelector(".new-name");
  const triggersInput = root.querySelector(".new-triggers");
  nameInput.value = newRoutineState.existingName;
  triggersInput.value = newRoutineState.existingTriggers.join(", ");

  function requireUrl() {
    const url = startUrlInput.value.trim();
    if (!url) {
      alert("יש להזין כתובת התחלה");
      return null;
    }
    newRoutineState.startUrl = url;
    return url;
  }

  wireLoginFlow(root, root.querySelector(".login-btn"), newRoutineState.routineId, requireUrl, loginStatus, () => {
    loginStatus.textContent = "ההתחברות נשמרה. אפשר להמשיך להקלטה.";
  });

  root.querySelector(".start-recording-btn").addEventListener("click", async (e) => {
    const url = requireUrl();
    if (!url) return;
    e.target.disabled = true;
    recordingStatus.textContent = "מקליט... בצעו את התהליך בדפדפן שנפתח, ואז סגרו את חלון ההקלטה.";
    try {
      const steps = await window.tany.recording.start(newRoutineState.routineId, url);
      newRoutineState.steps = steps;
      recordingStatus.textContent = `ההקלטה הסתיימה - נקלטו ${steps.length} שלבים.`;
      stepsReview.style.display = "block";
      renderNewSteps(stepsReview);
    } catch (err) {
      recordingStatus.textContent = `שגיאת הקלטה: ${err.message || err}`;
    } finally {
      e.target.disabled = false;
    }
  });

  root.querySelector(".add-extract-btn").addEventListener("click", () => {
    newRoutineState.steps.push({
      index: newRoutineState.steps.length,
      type: "extract",
      selectorKind: "css",
      selector: "",
      extractAs: "",
    });
    renderNewSteps(stepsReview);
  });

  root.querySelector(".save-routine-btn").addEventListener("click", async () => {
    const { steps, credential } = collectStepsAndCredential(stepsReview);
    const outputFields = steps.filter((s) => s.type === "extract" && s.extractAs).map((s) => s.extractAs);
    const name = nameInput.value.trim();
    const triggers = triggersInput.value.split(",").map((t) => t.trim()).filter(Boolean);
    if (!name) return alert("יש להזין שם לשגרה");
    if (triggers.length === 0) return alert("יש להזין לפחות ניסוח הפעלה אחד");

    await window.tany.routines.save({
      routineId: newRoutineState.routineId,
      name,
      type: newRoutineState.type,
      startUrl: newRoutineState.startUrl,
      steps,
      outputFields,
      triggers,
      credential,
    });
    newRoutineState = null;
    await refreshSidebar();
    contentEl.innerHTML = "";
  });

  if (newRoutineState.editingRoutineId) {
    // Re-recording an existing routine (spec §7): user still needs to record
    // again before reviewing/saving, so steps review stays hidden until then.
  }

  contentEl.innerHTML = "";
  contentEl.appendChild(root);
  typeSelect.dispatchEvent(new Event("change"));
}

function renderNewSteps(container) {
  const list = container.querySelector(".new-steps");
  list.innerHTML = "";
  newRoutineState.steps.forEach((step, idx) => {
    const li = document.createElement("li");
    li.dataset.idx = String(idx);

    if (step.type === "extract") {
      li.innerHTML = `
        <span class="step-badge">${STEP_LABELS.extract}</span>
        <input type="text" class="extract-selector" placeholder="CSS selector, למשל .balance" style="width:45%">
        <input type="text" class="extract-field" placeholder="שם שדה פלט, למשל balance" style="width:35%">
      `;
      list.appendChild(li);
      return;
    }

    if (step.type === "fill") {
      li.innerHTML = `
        <span class="step-badge">${STEP_LABELS.fill}</span> ${escapeHtml(describeSelector(step))}
        <select class="fill-mode">
          <option value="normal">ערך רגיל: "${escapeHtml(step.value ?? "")}"</option>
          <option value="credential">שדה סוד (סיסמה/פרטי כניסה)</option>
          <option value="otp">שלב הזרקת OTP</option>
        </select>
        <input type="text" class="cred-field-name" placeholder="שם השדה (למשל password)" style="display:none">
      `;
      const select = li.querySelector(".fill-mode");
      const credInput = li.querySelector(".cred-field-name");
      select.addEventListener("change", () => {
        credInput.style.display = select.value === "credential" ? "block" : "none";
      });
    } else {
      li.innerHTML = `<span class="step-badge">${STEP_LABELS[step.type] || step.type}</span> ${escapeHtml(describeSelector(step))}`;
    }

    // Any step that targeted a specific element already carries a good
    // selector Playwright generated during recording - reuse it instead of
    // asking the user to write a CSS selector by hand (see .extract-selector
    // above, still available as a manual fallback for elements they didn't
    // click during recording).
    if (step.selectorKind) {
      const extractRow = document.createElement("div");
      extractRow.innerHTML = `
        <label><input type="checkbox" class="extract-toggle"> גם לחלץ נתון מכאן (למשל טקסט/מספר שמוצג באלמנט הזה)</label>
        <input type="text" class="extract-field-name" placeholder="שם שדה פלט, למשל balance" style="display:none">
      `;
      const toggle = extractRow.querySelector(".extract-toggle");
      const fieldInput = extractRow.querySelector(".extract-field-name");
      toggle.addEventListener("change", () => {
        fieldInput.style.display = toggle.checked ? "inline-block" : "none";
      });
      li.appendChild(extractRow);
    }

    list.appendChild(li);
  });
}

function collectStepsAndCredential(container) {
  const credential = {};
  const steps = [];
  container.querySelectorAll(".new-steps > li").forEach((li) => {
    const idx = Number(li.dataset.idx);
    const original = newRoutineState.steps[idx];

    if (original.type === "extract") {
      const selector = li.querySelector(".extract-selector").value.trim();
      const extractAs = li.querySelector(".extract-field").value.trim();
      steps.push({ ...original, index: steps.length, selector, extractAs });
      return;
    }

    if (original.type === "fill") {
      const mode = li.querySelector(".fill-mode").value;
      if (mode === "credential") {
        const fieldName = li.querySelector(".cred-field-name").value.trim() || `field_${idx}`;
        credential[fieldName] = original.value ?? "";
        const { value, ...rest } = original;
        steps.push({ ...rest, index: steps.length, credentialField: fieldName });
      } else if (mode === "otp") {
        const { value, ...rest } = original;
        steps.push({ ...rest, index: steps.length, type: "otp_injection", promptHint: "קוד אימות" });
      } else {
        steps.push({ ...original, index: steps.length });
      }
    } else {
      steps.push({ ...original, index: steps.length });
    }

    // A step the user clicked/targeted during recording already carries a
    // good selector - reuse it for extraction instead of asking for a
    // hand-written CSS selector (see the "extract" branch above for that
    // manual fallback, still available via "+ הוסף שלב חילוץ נתונים").
    const extractToggle = li.querySelector(".extract-toggle");
    if (extractToggle && extractToggle.checked) {
      const extractAs = li.querySelector(".extract-field-name").value.trim() || `field_${idx}`;
      steps.push({
        index: steps.length,
        type: "extract",
        selectorKind: original.selectorKind,
        selector: original.selector,
        role: original.role,
        name: original.name,
        extractAs,
      });
    }
  });
  return { steps, credential };
}

document.getElementById("new-routine-btn").addEventListener("click", () => startNewRoutineFlow());

refreshSidebar();
