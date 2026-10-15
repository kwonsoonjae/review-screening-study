(function () {
  "use strict";
  const C = window.CONFIG, S = window.STIMULI;
  const app = document.getElementById("app");
  const url = new URLSearchParams(location.search);
  const DEBUG = url.get("debug") === "1";
  const TEST = url.get("test") === "1";
  const STUDY = C.STUDY + (TEST ? "-test" : "");
  const LIVE = !DEBUG && !!C.ENDPOINT;
  const t0 = Date.now();

  const D = {
    version: "study2-v0.2", study: STUDY, k: null, step: "start",
    prolific_pid: url.get("PROLIFIC_PID") || "", study_id: url.get("STUDY_ID") || "", session_id: url.get("SESSION_ID") || "",
    started_at: new Date().toISOString(), user_agent: navigator.userAgent,
    condition: null, owner: null, evidence: null, events: [],
  };
  const log = (type, payload) => D.events.push({ type, t_ms: Date.now() - t0, ...payload });

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const fmt2 = (x) => Number(x).toFixed(2);
  const pct = (x) => Math.round(x * 100) + "%";
  function screen(html) { app.innerHTML = html; window.scrollTo(0, 0); }
  function wait(selector, event = "click") {
    return new Promise((res) => app.querySelectorAll(selector).forEach((el) => el.addEventListener(event, (e) => res(e.currentTarget), { once: true })));
  }
  async function next(html, label = "Continue") {
    screen(html + `<div class="btns"><button class="primary" id="go">${label}</button></div>`);
    await wait("#go");
  }

  const vendorNote = () => `<div class="note"><b>Vendor documentation:</b> “The model's confidence scores are calibrated. A confidence of 0.90 means the verdict is correct about 90% of the time.”</div>`;
  const evidenceTable = () => `<div class="card"><b>Your team's test:</b> before launch, your team ran the model on 200 reviews from your own platform whose true origin was known.
    <table><thead><tr><th>Model confidence</th><th>Reviews tested</th><th>Verdict correct</th></tr></thead><tbody>
    ${S.localTable.map((r) => `<tr><td>${esc(r.bin)}</td><td>${r.n}</td><td>${pct(r.accuracy)}</td></tr>`).join("")}
    </tbody></table></div>`;
  const infoBlock = () => vendorNote() + (D.evidence ? evidenceTable() : "");

  function reviewCard(it, opts = {}) {
    return `<div class="card review">
      <div class="label">Liked</div><div class="text">${esc(it.liked || "—")}</div>
      <div class="label">Disliked</div><div class="text">${esc(it.disliked || "—")}</div>
    </div>` + (opts.noVerdict ? "" : `<div class="verdict"><span>Decision model verdict: <b>${esc(it.ai_says === "real" ? "Real guest" : "AI-generated")}</b></span>
      <span>Confidence: <b>${fmt2(it.conf)}</b></span></div>`);
  }

  const escalatedShare = (t) => S.population.filter(([c]) => c < t).length / S.population.length;

  async function post(body) {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(C.ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
        const j = await r.json();
        if (j.ok) return true;
      } catch (e) { /* retry */ }
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
    return false;
  }
  function participantRow() {
    const r1 = D.round1 || {}, r2 = D.round2 || {}, rs = D.responsibility || {}, sv = D.survey || {};
    return { pid: D.prolific_pid, study: STUDY, k: D.k, condition: D.condition, owner: D.owner, evidence: D.evidence, step: D.step,
      finished: D.finished_at || "", duration_s: Math.round((Date.now() - t0) / 1000), self_pred: D.self_predicted_accuracy,
      r1_threshold: r1.threshold, r1_n_escalated: r1.n_escalated, r1_n_my_correct: r1.n_my_correct, r1_n_auto: r1.n_auto,
      r1_n_auto_wrong: r1.n_auto_wrong, r1_n_audit_wrong: r1.n_audit_wrong, r1_points: r1.points,
      resp_me: rs.me, resp_model: rs.model, resp_vendor: rs.vendor, resp_designers: rs.designers,
      r2_threshold: r2.threshold, r2_h_used: r2.h_used, r2_points: r2.points,
      own1: sv.own1, ctrl1: sv.ctrl1, trust1: sv.trust1, calib1: sv.calib1, just1: sv.just1, just2: sv.just2, attn2: sv.attn2,
      attention_passed: D.attention_passed, attention2_passed: D.attention2_passed, comprehension_failed: !!D.comprehension_failed,
      ai_use: sv.ai_use, age: sv.age, gender: sv.gender, how: sv.how, total_points: D.total_points, bonus_usd: D.bonus_usd,
      prolific_study: D.study_id, prolific_session: D.session_id, started: D.started_at, ua: D.user_agent, version: D.version,
      data_json: JSON.stringify(D) };
  }
  async function checkpoint(step) {
    D.step = step;
    log("step", { step });
    if (LIVE) return post({ kind: "participant", participant: participantRow() });
    return true;
  }

  async function assignCondition() {
    const forced = url.get("cond");
    if (forced !== null && /^[0-3]$/.test(forced)) return Number(forced);
    if (LIVE) {
      if (!D.prolific_pid) { D.prolific_pid = "nopid-" + Math.random().toString(36).slice(2, 10); }
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch(`${C.ENDPOINT}?action=register&study=${encodeURIComponent(STUDY)}&pid=${encodeURIComponent(D.prolific_pid)}`);
          const j = await r.json();
          if (j.ok) {
            D.k = j.k; D.resumed = j.resumed;
            if (j.complete) { D.already_complete = true; }
            return Number(j.condition) % 4;
          }
        } catch (e) { log("register_error", { message: String(e) }); }
        await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
      }
      D.register_failed = true;
    }
    return Math.floor(Math.random() * 4);
  }

  async function consent() {
    screen(`<h1>Review screening study</h1>
      <div class="card small">
        <p><b>About this study.</b> You will act as the manager of a review-screening system on a hotel booking website. The study takes about 16 minutes. You will receive the base payment plus a performance bonus based on the points you earn.</p>
        <p><b>Data.</b> We record your choices and response times together with your Prolific ID. We do not collect your name or contact details. Anonymous data may be shared for research.</p>
        <p><b>Voluntary.</b> You may stop at any time by closing this window. [IRB approval number and contact details to be inserted.]</p>
      </div>
      <p>Do you agree to take part?</p>
      <div class="btns"><button class="primary" id="yes">I agree</button><button id="no">I do not agree</button></div>`);
    const b = await wait("#yes, #no");
    log("consent", { agree: b.id === "yes" });
    if (b.id !== "yes") { screen(`<h1>Thank you</h1><p>You chose not to take part. Please return the study on Prolific.</p>`); throw new Error("no-consent"); }
  }

  async function instructions() {
    await next(`<h1>Your role</h1>
      <p>You manage review screening for a hotel booking website. Some reviews are written by real guests. Others are <b>fake reviews generated by AI</b> to look real.</p>
      <p>A <b>decision model</b> checks every review. For each review it returns a <b>verdict</b> (Real guest or AI-generated) and a <b>confidence</b> between 0.50 and 1.00.</p>`);
    await next(`<h1>How screening works</h1>
      <p>A <b>threshold</b> decides who handles each review:</p>
      <div class="card"><p>• Confidence <b>at or above</b> the threshold → the model's verdict is applied <b>automatically</b>.</p>
      <p>• Confidence <b>below</b> the threshold → the review is <b>passed to you</b>, and you decide.</p></div>
      <h2>Points and bonus</h2>
      <div class="card"><p>• Each review you check yourself costs <b>${C.REVIEW_COST} point</b> (your time).</p>
      <p>• Each wrong final decision, by the model or by you, costs <b>${C.ERROR_PENALTY} points</b>.</p>
      <p class="muted small">There are two rounds. Your points are converted to a bonus at $${C.POINT_VALUE_USD.toFixed(3)} per point.</p></div>
      ${infoBlock()}`);
    for (let tries = 1; ; tries++) {
      screen(`<h1>Quick check</h1>
        <p class="q">1. The threshold is 0.90. A review gets a model confidence of 0.97. Who decides?</p>
        <label><input type="radio" name="q1" value="model"> The model's verdict is applied automatically</label><br>
        <label><input type="radio" name="q1" value="me"> It is passed to me</label>
        <p class="q">2. What costs points?</p>
        <label><input type="radio" name="q2" value="both"> Each review I check, and each wrong final decision</label><br>
        <label><input type="radio" name="q2" value="wrong"> Only wrong decisions I make myself</label>
        <div class="btns"><button class="primary" id="go">Check</button></div><p id="msg" class="err"></p>`);
      await wait("#go");
      const q1 = (app.querySelector("input[name=q1]:checked") || {}).value, q2 = (app.querySelector("input[name=q2]:checked") || {}).value;
      const ok = q1 === "model" && q2 === "both";
      log("comprehension", { try: tries, q1, q2, ok });
      if (ok) break;
      if (tries >= C.COMPREHENSION_MAX_TRIES) { D.comprehension_failed = true; break; }
      await next(`<h1>Not quite</h1><p>Reviews at or above the threshold are decided automatically by the model. Reviews below it are passed to you. Every review you check costs ${C.REVIEW_COST} point, and every wrong final decision (by the model or by you) costs ${C.ERROR_PENALTY} points.</p>`, "Try again");
    }
  }

  async function judge(it, progress, phase) {
    screen(`<div class="progress">${progress}</div><h1>Is this review real or AI-generated?</h1>${reviewCard(it)}
      <p class="muted small">The model's confidence was below the threshold, so this review was passed to you.</p>
      <div class="btns"><button data-v="real" class="choice">Real guest</button><button data-v="AI-generated" class="choice">AI-generated</button></div>`);
    const s = Date.now();
    const b = await wait("button.choice");
    const answer = b.dataset.v;
    const rec = { phase, id: it.id, conf: it.conf, ai_says: it.ai_says, truth: it.truth, answer, correct: answer === it.truth ? 1 : 0,
                  followed_ai: answer === it.ai_says ? 1 : 0, rt_ms: Date.now() - s };
    log("judgment", rec);
    return rec;
  }

  async function practice() {
    await next(`<h1>Practice</h1><p>First, two practice reviews so you can see the screen. They do not count for points.</p>`);
    let k = 1;
    for (const it of shuffle(S.practice)) await judge(it, `Practice ${k++} of 2`, "practice");
  }

  async function selfPrediction() {
    screen(`<h1>Before you start</h1><p>Think about the reviews that will be passed to you. What percentage of them do you expect to judge correctly?</p>
      <div class="slider-value" id="v">50%</div><input type="range" id="s" min="0" max="100" step="1" value="50">
      <div class="btns"><button class="primary" id="go" disabled>Continue</button></div><p class="muted small">Move the slider to continue.</p>`);
    const s = app.querySelector("#s"), v = app.querySelector("#v"), go = app.querySelector("#go");
    s.addEventListener("input", () => { v.textContent = s.value + "%"; go.disabled = false; });
    await wait("#go");
    D.self_predicted_accuracy = Number(s.value) / 100;
    log("self_prediction", { value: D.self_predicted_accuracy });
  }

  async function thresholdScreen(round) {
    const fixed = round === 1 && D.owner === "default";
    const intro = round === 1
      ? (fixed ? `<p>For this round the threshold is set to the <b>vendor's recommended setting</b>. It cannot be changed in this round.</p>`
               : `<p>Set the threshold for this round.</p>`)
      : `<p>Now set the threshold for <b>next week's queue of ${C.ROUND2_QUEUE} reviews</b>. Your round-2 points will be calculated from the model's actual performance on reviews like these and from how accurately you judged reviews in round 1.</p>`;
    const start = fixed ? C.VENDOR_DEFAULT_THRESHOLD : (round === 2 ? D.round1.threshold : (C.SLIDER_MIN + C.SLIDER_MAX) / 2);
    screen(`<h1>Round ${round}: threshold</h1>${intro}${infoBlock()}
      <div class="card"><div class="slider-value" id="v">${fmt2(start)}${fixed ? " (vendor recommended)" : ""}</div>
      ${fixed ? "" : `<input type="range" id="s" min="${C.SLIDER_MIN}" max="${C.SLIDER_MAX}" step="0.01" value="${start}">`}
      <p class="muted small" id="share"></p></div>
      <div class="btns"><button class="primary" id="go" ${fixed || round === 2 ? "" : "disabled"}>Confirm threshold</button></div>
      ${fixed || round === 2 ? "" : `<p class="muted small">Move the slider to continue.</p>`}`);
    const share = app.querySelector("#share");
    const upd = (t) => { share.textContent = `With this threshold, about ${Math.round(escalatedShare(t) * 100)} of every 100 reviews will be passed to you; the model decides the rest automatically.`; };
    upd(start);
    const s = app.querySelector("#s"); const moves = [];
    if (s) s.addEventListener("input", () => { app.querySelector("#v").textContent = fmt2(s.value); upd(Number(s.value)); app.querySelector("#go").disabled = false; moves.push(Number(s.value)); });
    const shown = Date.now();
    await wait("#go");
    const t = s ? Number(s.value) : start;
    log("threshold", { round, value: t, fixed, n_moves: moves.length, rt_ms: Date.now() - shown });
    return t;
  }

  function drawBank() {
    const out = [];
    for (const [bin, n] of Object.entries(C.BANK_QUOTA)) out.push(...shuffle(S.bank.filter((x) => x.conf_bin === bin)).slice(0, n));
    return out;
  }

  async function round1() {
    const t = await thresholdScreen(1);
    const bank = drawBank();
    const escalated = shuffle(bank.filter((x) => x.conf < t));
    const autoBank = bank.filter((x) => x.conf >= t);
    log("round1_queue", { threshold: t, bank_ids: bank.map((x) => x.id), escalated_ids: escalated.map((x) => x.id), audit_ids: S.audit.map((x) => x.id) });
    await next(`<h1>Round 1</h1><p>Today's queue has <b>${S.audit.length + bank.length} reviews</b>. With your threshold of ${fmt2(t)}, <b>${escalated.length}</b> were passed to you. Please judge each one.</p>`, "Start");
    const recs = [];
    const attentionAt = Math.floor(escalated.length / 2);
    for (let i = 0; i < escalated.length; i++) {
      if (i === attentionAt) {
        const a = { id: -1, liked: "This is an attention check. Please ignore the model's verdict and select “AI-generated” for this review.", disliked: "", ai_says: "real", conf: 0.71, truth: "AI-generated" };
        const r = await judge(a, "Check", "attention");
        D.attention_passed = r.answer === "AI-generated";
      }
      recs.push(await judge(escalated[i], `Review ${i + 1} of ${escalated.length}`, "round1"));
    }
    if (D.attention_passed === undefined) D.attention_passed = null;
    const autoAll = S.audit.concat(autoBank);
    const autoWrong = autoAll.filter((x) => !x.ai_correct);
    const auditWrong = S.audit.filter((x) => !x.ai_correct);
    const myWrong = recs.filter((r) => !r.correct).length;
    const pts = C.ROUND1_START - C.REVIEW_COST * recs.length - C.ERROR_PENALTY * (autoWrong.length + myWrong);
    D.round1 = { threshold: t, n_escalated: recs.length, n_my_correct: recs.length - myWrong, n_auto: autoAll.length,
                 n_auto_wrong: autoWrong.length, n_audit_wrong: auditWrong.length, n_autobank: autoBank.length,
                 n_autobank_wrong: autoBank.filter((x) => !x.ai_correct).length, points: pts };
    log("round1_result", D.round1);

    screen(`<h1>Round 1 results</h1>
      <div class="card"><p>The model decided <b>${autoAll.length}</b> reviews automatically. <b>${autoWrong.length}</b> of those decisions were wrong.</p>
      <p>Among the ${S.audit.length} reviews the model was most confident about (confidence 0.95 or higher), <b>${auditWrong.length} were fake reviews that the model published as real</b>.${autoBank.length ? ` Among the other ${autoBank.length} automatic decisions, ${D.round1.n_autobank_wrong} were wrong.` : ""}</p>
      <p>You checked <b>${recs.length}</b> reviews and judged <b>${recs.length - myWrong}</b> correctly.</p>
      <p>Round 1 points: <b>${pts}</b></p></div>
      <h2>The ${auditWrong.length} fake reviews published with confidence 0.95 or higher</h2>
      ${auditWrong.map((it) => reviewCard(it) + `<p class="small err">Actually: AI-generated (fake). Published as real.</p>`).join("")}
      <div class="btns"><button class="primary" id="go">Continue</button></div>`);
    await wait("#go");
  }

  async function responsibility() {
    const parties = [["me", "You, as the manager of the screening system"], ["model", "The decision model"],
                     ["vendor", "The company that sells the decision model"], ["designers", "The platform's system designers, who set up the screening workflow"]];
    screen(`<h1>Who is responsible?</h1><p>${D.round1.n_audit_wrong} fake reviews were published on the website in round 1. How responsible is each party for this? Divide <b>100 points</b> among them.</p>
      <div class="card alloc">${parties.map(([k, l]) => `<label for="${k}">${l}</label><input type="number" id="${k}" min="0" max="100" step="1" value="0">`).join("")}
      <b>Total</b><b id="sum">0</b></div>
      <div class="btns"><button class="primary" id="go" disabled>Continue</button></div><p class="muted small">The total must be exactly 100.</p>`);
    const inputs = parties.map(([k]) => app.querySelector("#" + k)), go = app.querySelector("#go"), sum = app.querySelector("#sum");
    const upd = () => { const t = inputs.reduce((a, i) => a + (Number(i.value) || 0), 0); sum.textContent = t; go.disabled = t !== 100 || inputs.some((i) => Number(i.value) < 0); };
    inputs.forEach((i) => i.addEventListener("input", upd));
    await wait("#go");
    D.responsibility = Object.fromEntries(parties.map(([k], i) => [k, Number(inputs[i].value)]));
    log("responsibility", D.responsibility);
  }

  function round2Points(t) {
    const h = (D.round1.n_my_correct + C.H_PRIOR * C.H_PRIOR_WEIGHT) / (D.round1.n_escalated + C.H_PRIOR_WEIGHT);
    let cost = 0;
    for (const [c, ok] of S.population) cost += c >= t ? (ok ? 0 : C.ERROR_PENALTY) : C.REVIEW_COST + (1 - h) * C.ERROR_PENALTY;
    cost *= C.ROUND2_QUEUE / S.population.length;
    return { h_used: h, points: Math.max(0, Math.round(C.ROUND2_START - cost)) };
  }

  async function round2() {
    const t = await thresholdScreen(2);
    D.round2 = { threshold: t, ...round2Points(t) };
    log("round2_result", D.round2);
  }

  function likert(name, text) {
    const lab = ["Strongly disagree", "", "", "Neutral", "", "", "Strongly agree"];
    return `<p class="q">${text}</p><div class="likert">${lab.map((l, i) => `<label><input type="radio" name="${name}" value="${i + 1}"><span>${l || i + 1}</span></label>`).join("")}</div>`;
  }

  async function survey() {
    const items = [
      ["own1", "The round-1 threshold was my decision."],
      ["ctrl1", "I had control over how reviews were handled."],
      ["trust1", "I trusted the vendor's description of the confidence scores."],
      ["calib1", "A confidence of 0.95 meant the model's verdict was right about 95% of the time."],
      ["just1", "After seeing the errors, I wanted to show that my earlier threshold was reasonable."],
      ["just2", "I prefer to stick with a decision I have made rather than change it."],
      ["attn2", "To show you are reading, please select “Strongly disagree” for this statement."],
    ];
    screen(`<h1>A few questions</h1>${items.map(([k, t]) => likert(k, t)).join("")}
      <p class="q">How did you choose your thresholds?</p><textarea id="how"></textarea>
      <p class="q">How often do you use AI tools such as chatbots?</p>
      <select id="aiuse"><option value="">Select…</option><option>Never</option><option>Less than monthly</option><option>Monthly</option><option>Weekly</option><option>Daily</option></select>
      <p class="q">Age</p><input type="number" id="age" min="18" max="100">
      <p class="q">Gender</p><select id="gender"><option value="">Select…</option><option>Woman</option><option>Man</option><option>Non-binary</option><option>Prefer not to say</option><option>Other</option></select>
      <div class="btns"><button class="primary" id="go">Submit</button></div><p id="msg" class="err"></p>`);
    for (;;) {
      await wait("#go");
      const ans = Object.fromEntries(items.map(([k]) => [k, Number((app.querySelector(`input[name=${k}]:checked`) || {}).value || 0)]));
      if (Object.values(ans).some((v) => !v)) { app.querySelector("#msg").textContent = "Please answer all statements."; continue; }
      D.survey = { ...ans, how: app.querySelector("#how").value.slice(0, 2000), ai_use: app.querySelector("#aiuse").value,
                   age: Number(app.querySelector("#age").value) || null, gender: app.querySelector("#gender").value };
      D.attention2_passed = ans.attn2 === 1;
      log("survey", D.survey);
      break;
    }
  }

  async function finish() {
    const total = Math.max(0, D.round1.points) + D.round2.points;
    D.total_points = total;
    D.bonus_usd = Math.round(total * C.POINT_VALUE_USD * 100) / 100;
    D.finished_at = new Date().toISOString();
    D.step = "finished";
    D.duration_s = Math.round((Date.now() - t0) / 1000);
    screen(`<h1>Saving…</h1><p>Please wait and do not close this window.</p>`);
    const filename = `${D.prolific_pid || "anon"}_${Date.now()}.json`;
    let saved = false;
    if (LIVE) {
      const rows = D.events.filter((e) => e.type === "judgment").map((e, i) => ({ row_id: `${D.prolific_pid}-${i}`, condition: D.condition, order: i,
        phase: e.phase, item_id: e.id, conf: e.conf, ai_says: e.ai_says, truth: e.truth, answer: e.answer, correct: e.correct,
        followed_ai: e.followed_ai, rt_ms: e.rt_ms, t_ms: e.t_ms }));
      const okRows = await post({ kind: "judgments", pid: D.prolific_pid, study: STUDY, rows });
      D.step = "finished";
      const okPart = await post({ kind: "participant", participant: participantRow() });
      saved = okRows && okPart;
    }
    const done = `https://app.prolific.com/submissions/complete?cc=${encodeURIComponent(C.PROLIFIC_COMPLETION_CODE)}`;
    if (DEBUG) {
      const blob = new Blob([JSON.stringify(D, null, 1)], { type: "application/json" });
      screen(`<h1>Debug: finished</h1><p>Condition ${D.condition} (${D.owner}, evidence=${D.evidence}). Total ${total} points, bonus $${D.bonus_usd.toFixed(2)}.</p>
        <p><a download="${filename}" href="${URL.createObjectURL(blob)}">Download data (JSON)</a></p><pre class="small">${esc(JSON.stringify(D.round1))}\n${esc(JSON.stringify(D.round2))}</pre>`);
      window.__RESULT__ = D;
      return;
    }
    screen(`<h1>Thank you!</h1><p>You earned <b>${total} points</b> (bonus $${D.bonus_usd.toFixed(2)}, paid within a few days).</p>
      ${saved ? `<p>Your responses were saved. You will now return to Prolific.</p><p><a href="${done}">Click here if you are not redirected.</a></p>`
              : `<p class="err">We could not save your responses automatically. Please click the link to return to Prolific and send us a message.</p><p><a href="${done}">Return to Prolific</a></p>`}`);
    if (saved && C.PROLIFIC_COMPLETION_CODE) setTimeout(() => { location.href = done; }, 3000);
  }

  async function main() {
    D.condition = await assignCondition();
    D.owner = D.condition < 2 ? "self" : "default";
    D.evidence = D.condition % 2 === 1;
    log("condition", { condition: D.condition, owner: D.owner, evidence: D.evidence, k: D.k, resumed: !!D.resumed });
    if (D.already_complete) { screen(`<h1>Already completed</h1><p>Our records show you have already completed this study. Thank you! Please return to Prolific.</p>`); return; }
    try {
      await consent();
      await checkpoint("consented");
      await instructions();
      await practice();
      await selfPrediction();
      await round1();
      await checkpoint("round1_done");
      await responsibility();
      await round2();
      await checkpoint("round2_done");
      await survey();
      await finish();
    } catch (e) {
      if (String(e.message) !== "no-consent") { log("error", { message: String(e), stack: String(e.stack) }); screen(`<h1>Something went wrong</h1><p>Please contact the researcher via Prolific.</p>`); }
    }
  }
  window.addEventListener("beforeunload", (e) => { if (!D.finished_at && D.events.length > 2) { e.preventDefault(); e.returnValue = ""; } });
  main();
})();
