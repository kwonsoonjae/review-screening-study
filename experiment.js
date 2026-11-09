(function () {
  "use strict";
  const C = window.CONFIG, S = window.STIMULI;
  const app = document.getElementById("app");
  const bar = document.getElementById("progress");
  const url = new URLSearchParams(location.search);
  const DEBUG = url.get("debug") === "1";
  const TEST = url.get("test") === "1";
  const PID = url.get("PROLIFIC_PID") || "";
  const STUDY = C.STUDY + (TEST ? "-test" : "");
  const LIVE = !DEBUG && !!C.ENDPOINT;
  const AI_OFF = 1.01;
  const NONCE = Math.random().toString(36).slice(2, 12);
  const t0 = Date.now();
  const STEPS = 16;

  const D = {
    version: "study2-v1.11", study: STUDY, k: null, step: "start",
    prolific_pid: PID || "nopid-" + Math.random().toString(36).slice(2, 10), study_id: url.get("STUDY_ID") || "", session_id: url.get("SESSION_ID") || "",
    started_at: new Date().toISOString(), user_agent: navigator.userAgent, screen_w: window.innerWidth, screen_h: window.innerHeight,
    condition: null, evidence: null, costView: null, items: {}, events: [], hidden_count: 0, hidden_ms: 0,
    resumed: false, register_failed: false, already_complete: false,
  };
  const log = (type, payload) => D.events.push({ type, t_ms: Date.now() - t0, ...payload });
  let hiddenAt = null;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); D.hidden_count++; }
    else if (hiddenAt) { D.hidden_ms += Date.now() - hiddenAt; hiddenAt = null; }
  });

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const fmt2 = (x) => Number(x).toFixed(2);
  const pct = (x) => Math.round(x * 100) + "%";
  const num = (x) => Number(x).toLocaleString("en-US");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function screen(html, step) {
    app.innerHTML = html;
    if (step !== undefined) bar.style.width = Math.min(100, Math.round((step / STEPS) * 100)) + "%";
    window.scrollTo(0, 0);
  }
  function wait(selector, event = "click") {
    return new Promise((res) => app.querySelectorAll(selector).forEach((el) => el.addEventListener(event, (e) => res(e.currentTarget), { once: true })));
  }
  async function next(html, step, label = "Continue", minMs = 0) {
    screen(html + `<div class="btns"><button class="primary" id="go"${minMs ? " disabled" : ""}>${label}</button></div>${minMs ? `<p class="muted small" id="wait"></p>` : ""}`, step);
    if (minMs && !DEBUG) {
      const go = app.querySelector("#go"), msg = app.querySelector("#wait"), end = Date.now() + minMs;
      await new Promise((res) => {
        const tick = () => { const left = Math.ceil((end - Date.now()) / 1000); if (left <= 0) { go.disabled = false; msg.textContent = ""; res(); } else { msg.textContent = `Please read carefully. You can continue in ${left} s.`; setTimeout(tick, 250); } };
        tick();
      });
    } else if (minMs) app.querySelector("#go").disabled = false;
    await wait("#go");
  }
  const thrLabel = (t) => (t > 1 ? "AI off (all reviews to the team)" : fmt2(t));

  const badge = (v) => v === "real" ? `<span class="badge real">✓ Real guest</span>` : `<span class="badge ai">⚠ AI-generated</span>`;
  function reviewCard(it, wrong, clamp = false) {
    return `<div class="card review${wrong ? " wrong" : ""}${clamp ? " clamp" : ""}"><div class="body">
      <div class="row"><span class="tag liked">Liked</span><span>${esc(it.liked || "—")}</span></div>
      <div class="row"><span class="tag disliked">Disliked</span><span>${esc(it.disliked || "—")}</span></div></div>
      <div class="verdict"><span class="small muted">The model says</span>${badge(it.ai_says)}<span class="meter">Confidence <b>${fmt2(it.conf)}</b></span></div>
      ${wrong ? `<div class="flag">Actually AI-generated: a fake review published as real</div>` : ""}</div>`;
  }
  const costTable = () => `<table class="cost"><colgroup><col style="width:40%"><col style="width:30%"><col style="width:30%"></colgroup>
    <tr><th>Points per review</th><th>Final decision right</th><th>Final decision wrong</th></tr>
    <tr><td>Decided automatically</td><td>0</td><td>${C.ERROR_PENALTY}</td></tr>
    <tr><td>Sent to your team</td><td>${C.TEAM_COST}</td><td>${C.TEAM_COST} + ${C.ERROR_PENALTY} = ${C.TEAM_COST + C.ERROR_PENALTY}</td></tr></table>`;
  const teamAvg = () => C.TEAM_COST + Math.round((1 - C.TEAM_ACCURACY) * C.ERROR_PENALTY);
  const teamNote = () => `<ul class="defs"><li><b>Team average:</b> about ${teamAvg()} points per review (${C.TEAM_COST} points plus the team's occasional mistakes).</li></ul>`;
  const rulesBox = () => `<div class="card rules"><h3>Rules</h3>
    <ul class="tight"><li>Confidence <b>at or above</b> the threshold → decided <b>automatically</b> by the model.</li>
    <li>Confidence <b>below</b> the threshold → sent to <b>your team</b> (right ${pct(C.TEAM_ACCURACY)} of the time).</li></ul>
    ${costTable()}${teamNote()}</div>`;
  const vendorNote = () => `<div class="note vendor"><h3>What the vendor says</h3>
    <ul><li>The model's confidence scores are <b>calibrated</b>.</li>
    <li>A confidence of 0.85 means the model's answer is correct about <b>85%</b> of the time.</li></ul></div>`;
  const autoCost = (a) => (C.ERROR_PENALTY * (1 - Math.round(a * 100) / 100)).toFixed(1);
  const evidenceTable = (cost = D.costView) => `<div class="card evidence"><h3>Your team's own test</h3>
    <p class="sub">Your team ran the model on 200 reviews from this website whose true origin was known (40 reviews per row).${cost ? ` The last two columns show the average points lost per review, counting both costs and mistakes. In each row, the <b>lower number</b> is the cheaper way to handle those reviews.` : ""}</p>
    <table class="ev${cost ? " cost4" : ""}">${cost ? `<colgroup><col style="width:22%"><col style="width:30%"><col style="width:24%"><col style="width:24%"></colgroup>` : `<colgroup><col style="width:40%"><col style="width:60%"></colgroup>`}
    <thead><tr><th>Model confidence</th><th>Answer correct</th>${cost ? "<th>Cost if automatic</th><th>Cost if sent to team</th>" : ""}</tr></thead><tbody>
    ${S.localTable.map((r) => `<tr><td class="nowrap">${esc(r.bin)}</td><td class="nowrap"><span class="mini" style="width:${Math.round(r.accuracy * 110)}px"></span>${Math.round(r.accuracy * 100)}%</td>${cost ? (() => { const a = Number(autoCost(r.accuracy)), t = teamAvg(), b = (v, on) => on ? `<b>${v}</b>` : v; return `<td>${b(a.toFixed(1) + " points", a < t)}</td><td>${b(t + " points", t <= a)}</td>`; })() : ""}</tr>`).join("")}
    </tbody></table><ul class="defs"><li><b>Answer correct:</b> share of the model's answers that were right.</li>${cost ? `
      <li><b>Cost if automatic:</b> ${C.ERROR_PENALTY} points × share of wrong answers.</li>
      <li><b>Cost if sent to team:</b> about ${teamAvg()} points (${C.TEAM_COST} points plus the team's occasional mistakes).</li>` : ""}</ul></div>`;
  const infoBlock = () => vendorNote() + (D.evidence ? evidenceTable() : "");

  function outcome(queue, t) {
    const auto = queue.filter(([c]) => c >= t), team = queue.filter(([c]) => c < t);
    const autoWrong = auto.filter(([, ok]) => !ok).length;
    const teamWrong = Math.round(team.length * (1 - C.TEAM_ACCURACY));
    const raw = C.ROUND_START - C.TEAM_COST * team.length - C.ERROR_PENALTY * (autoWrong + teamWrong);
    return { threshold: t, ai_off: t > 1, n_auto: auto.length, auto_wrong: autoWrong, n_team: team.length, team_wrong: teamWrong, points_raw: raw, points: Math.max(0, raw) };
  }
  const autoCount = (queue, t) => queue.filter(([c]) => c >= t).length;

  async function fetchT(u, opts = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), C.FETCH_TIMEOUT_MS);
    try { return await fetch(u, { ...opts, signal: ctl.signal }); } finally { clearTimeout(timer); }
  }
  async function post(body) {
    for (let i = 0; i < C.SAVE_RETRIES; i++) {
      try {
        const r = await fetchT(C.ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
        const j = await r.json();
        if (j.ok) return true;
      } catch (e) { /* retry */ }
      await sleep(Math.min(30000, 1000 * 2 ** i) * (0.5 + Math.random()));
    }
    return false;
  }
  const BK = "rss_backup_" + D.prolific_pid;
  function backup() { try { localStorage.setItem(BK, JSON.stringify(D)); } catch (e) { /* ignore */ } }
  function participantRow() {
    const r1 = D.round1 || {}, r2 = D.round2 || {}, rs = D.responsibility || {}, sv = D.survey || {};
    return { pid: D.prolific_pid, study: STUDY, k: D.k, condition: D.condition, evidence: D.evidence, cost_view: D.costView, step: D.step,
      finished: D.finished_at || "", duration_s: D.duration_s ?? Math.round((Date.now() - t0) / 1000),
      resumed: D.resumed, resumed_local: !!D.resumed_local, register_failed: D.register_failed, assign_failed: !!D.assign_failed, hidden_count: D.hidden_count, hidden_ms: D.hidden_ms,
      comprehension_tries: D.comprehension_tries, comprehension_failed: !!D.comprehension_failed,
      r1_threshold: r1.threshold, r1_ai_off: r1.ai_off, r1_n_auto: r1.n_auto, r1_auto_wrong: r1.auto_wrong, r1_n_team: r1.n_team, r1_team_wrong: r1.team_wrong, r1_points: r1.points,
      r1_moves: D.r1_moves, r1_rt_ms: D.r1_rt_ms, basis: D.basis, basis_r2: D.basis_r2,
      resp_me: rs.me, resp_model: rs.model, resp_vendor: rs.vendor, resp_order: rs.order,
      r2_threshold: r2.threshold, r2_ai_off: r2.ai_off, r2_n_auto: r2.n_auto, r2_auto_wrong: r2.auto_wrong, r2_n_team: r2.n_team, r2_team_wrong: r2.team_wrong, r2_points: r2.points,
      r2_moves: D.r2_moves, r2_rt_ms: D.r2_rt_ms,
      ...D.items,
      attention1_passed: D.attention1_passed, attention2_passed: D.attention2_passed,
       
      ai_use: sv.ai_use, risk: sv.risk, manager: sv.manager, set_automation: sv.set_automation,
      total_points: D.total_points, bonus_usd: D.bonus_usd,
      prolific_study: D.study_id, prolific_session: D.session_id, started: D.started_at, ua: D.user_agent, screen: `${D.screen_w}x${D.screen_h}`, version: D.version,
      data_json: JSON.stringify(D) };
  }
  let saveChain = Promise.resolve(true);
  function enqueue(body) { saveChain = saveChain.then(() => post(body)); return saveChain; }
  function checkpoint(step) {
    D.step = step;
    log("step", { step });
    backup();
    if (LIVE) enqueue({ kind: "participant", participant: participantRow() });
  }

  async function register() {
    if (!LIVE) return;
    for (let i = 0; i < C.SAVE_RETRIES; i++) {
      try {
        const r = await fetchT(`${C.ENDPOINT}?action=register&study=${encodeURIComponent(STUDY)}&pid=${encodeURIComponent(D.prolific_pid)}&nonce=${NONCE}`);
        const j = await r.json();
        if (j.ok) {
          D.resumed = !!j.resumed; D.already_complete = !!j.complete; D.screened_out = !!j.screened;
          if (j.condition !== "" && j.condition !== null && j.condition !== undefined) { D.k = j.k; D.prior_condition = Number(j.condition) % 3; }
          return;
        }
      } catch (e) { log("register_error", { message: String(e) }); }
      await sleep(Math.min(30000, 1000 * 2 ** i) * (0.5 + Math.random()));
    }
    D.register_failed = true;
  }
  async function assignCondition() {
    const forced = url.get("cond");
    if ((TEST || DEBUG) && forced !== null && /^[0-3]$/.test(forced)) return Number(forced);
    if (D.prior_condition !== undefined) return D.prior_condition;
    if (LIVE && !D.register_failed) {
      for (let i = 0; i < C.SAVE_RETRIES; i++) {
        try {
          const r = await fetchT(`${C.ENDPOINT}?action=assign&study=${encodeURIComponent(STUDY)}&pid=${encodeURIComponent(D.prolific_pid)}`);
          const j = await r.json();
          if (j.ok) { D.k = j.k; return Number(j.condition) % 3; }
        } catch (e) { log("assign_error", { message: String(e) }); }
        await sleep(Math.min(30000, 1000 * 2 ** i) * (0.5 + Math.random()));
      }
    }
    D.assign_failed = true;
    return Math.floor(Math.random() * 3);
  }
  function applyCondition(c) {
    D.condition = c; D.evidence = c >= 1; D.costView = c === 2;
    log("condition", { condition: c, evidence: D.evidence, cost_view: D.costView, k: D.k, resumed: D.resumed, register_failed: D.register_failed });
  }
  const noConsentURL = () => `https://app.prolific.com/submissions/complete?cc=${encodeURIComponent(C.PROLIFIC_NOCONSENT_CODE)}`;
  async function logExit(step) { D.step = step; backup(); if (LIVE) await Promise.race([post({ kind: "participant", participant: participantRow() }), sleep(4000)]); }
  const screenOutURL = () => `https://app.prolific.com/submissions/complete?cc=${encodeURIComponent(C.PROLIFIC_SCREENOUT_CODE)}`;
  const returnBlock = () => C.PROLIFIC_SCREENOUT_CODE
    ? `<p><a href="${screenOutURL()}">Click here to go back to Prolific</a>. You will receive a small payment for your time.</p>`
    : `<p>Please <b>return the study</b> on Prolific (do not submit it).</p>`;
  const maxBonus = () => { const best = (q) => Math.max(...Array.from({ length: 51 }, (_, i) => outcome(q, (50 + i) / 100).points)); return ((best(S.queue1) + best(S.queue2)) * C.POINT_VALUE_USD).toFixed(2); };
  const doneURL = () => `https://app.prolific.com/submissions/complete?cc=${encodeURIComponent(C.PROLIFIC_COMPLETION_CODE)}`;

  async function consent() {
    screen(`<h1>Review screening study</h1>
      <div class="card"><dl class="facts">
        <dt>Task</dt><dd>Manage an AI system that screens reviews on a hotel booking website. About 10 minutes.</dd>
        <dt>Pay</dt><dd>Base payment plus a bonus from the points you earn ($0 to about $${maxBonus()}).</dd>
        <dt>Data</dt><dd>We record your choices and response times with your Prolific ID. No name or contact details. Anonymized data may be shared for research.</dd>
        <dt>Voluntary</dt><dd>You can stop at any time by closing this window.</dd>
        ${C.CONTACT ? `<dt>Questions</dt><dd>${esc(C.CONTACT)}</dd>` : ""}
      </dl></div>
      <p class="q">Do you agree to take part?</p>
      <div class="btns"><button class="primary" id="yes">I agree</button><button id="no">I do not agree</button></div>`, 0);
    const b = await wait("#yes, #no");
    log("consent", { agree: b.id === "yes" });
    if (b.id !== "yes") {
      screen(`<h1>Thank you</h1><p>You chose not to take part.</p>`);
      await logExit("no_consent");
      screen(`<h1>Thank you</h1><p>You chose not to take part.</p>${C.PROLIFIC_NOCONSENT_CODE
        ? `<p><a href="${noConsentURL()}">Click here to go back to Prolific</a>. You will be asked to return the study there, without any penalty.</p>`
        : `<p>Please <b>return the study</b> on Prolific (do not submit it).</p>`}`);
      throw new Error("no-consent");
    }
  }

  async function intro(regP) {
    screen(`<h1>Your role</h1>
      <p class="lead">You manage review screening for a hotel booking website. Some reviews are <b>fake reviews written by AI</b>.</p>
      <p>A <b>decision model</b> labels every review <b>Real guest</b> or <b>AI-generated</b> and gives a <b>confidence</b> score from 0.50 to 1.00. Two examples:</p>
      ${S.examples.map((e) => reviewCard(e)).join("")}
      <div class="btns"><button class="primary" id="go">Continue</button></div>`, 1);
    await wait("#go");
    const go = app.querySelector("#go");
    if (go) { go.disabled = true; go.textContent = "Preparing…"; }
    return regP;
  }

  async function howItWorks() {
    await next(`<h1>How screening works</h1>
      <p class="lead">You choose a <b>threshold</b>. It decides who handles each review.</p>
      <div class="lanes">
        <div class="lane auto"><div class="t">Confidence ≥ threshold</div><b>Decided automatically</b> by the model.<br><span class="muted">No cost, but the model's mistakes get through.</span></div>
        <div class="lane team"><div class="t">Confidence &lt; threshold</div><b>Sent to your review team.</b><br><span class="muted">${C.TEAM_COST} points per review. The team is right ${pct(C.TEAM_ACCURACY)} of the time.</span></div>
      </div>
      <div class="card"><h3>Points</h3>${costTable()}
        ${teamNote()}</div>
      <div class="card"><h3>Rounds and bonus</h3><ul class="tight">
        <li>2 rounds of 200 reviews. Each round starts with <b>${num(C.ROUND_START)} points</b> (never below 0).</li>
        <li>Bonus: <b>$${(C.POINT_VALUE_USD * 100).toFixed(2)} per 100 points</b> left. Shown at the end.</li>
        <li>Round 1 is a trial week: the model must be used. From round 2, you can also switch the model off.</li></ul></div>`, 2, "Continue", C.MIN_READ_MS);
    const Q = [
      ["q3", "1. If you raise the threshold, what happens?", [["more", "More reviews go to your team"], ["fewer", "Fewer reviews go to your team"]], "more"],
      ["q4", `2. A review goes to your team, and the team gets it wrong. How many points does this review cost in total?`, [[String(C.TEAM_COST), `${C.TEAM_COST} points`], [String(C.ERROR_PENALTY), `${C.ERROR_PENALTY} points`], [String(C.TEAM_COST + C.ERROR_PENALTY), `${C.TEAM_COST + C.ERROR_PENALTY} points`]], String(C.TEAM_COST + C.ERROR_PENALTY)],
    ];
    for (let tries = 1; ; tries++) {
      screen(`<h1>Quick check</h1>${rulesBox()}
        ${Q.map(([k, q, opts]) => `<div class="card"><p class="q">${q}</p>${opts.map(([v, l]) => `<label class="opt"><input type="radio" name="${k}" value="${v}">${l}</label>`).join("")}</div>`).join("")}
        <div class="btns"><button class="primary" id="go">Check answers</button></div><p id="msg" class="err"></p>`, 3);
      let ans;
      for (;;) {
        await wait("#go");
        ans = Object.fromEntries(Q.map(([k]) => [k, (app.querySelector(`input[name=${k}]:checked`) || {}).value || ""]));
        if (Object.values(ans).some((v) => !v)) { app.querySelector("#msg").textContent = "Please answer both questions."; continue; }
        break;
      }
      const ok = Q.every(([k, , , right]) => ans[k] === right);
      log("comprehension", { try: tries, ...ans, ok });
      D.comprehension_tries = tries;
      if (ok) return;
      if (tries >= C.COMPREHENSION_MAX_TRIES) {
        D.comprehension_failed = true;
        checkpoint("comprehension_failed");
        if (LIVE) await saveChain;
        screen(`<h1>Thank you for your time</h1><p>Unfortunately, your answers to the check questions indicate that the task rules were not clear enough to continue.</p>${returnBlock()}`);
        throw new Error("comprehension-failed");
      }
      const why = { q3: "A higher threshold means fewer reviews clear it, so <b>more reviews go to the review team</b>.",
                    q4: `A review sent to the team always costs ${C.TEAM_COST} points, and a wrong final decision adds ${C.ERROR_PENALTY} points: <b>${C.TEAM_COST} + ${C.ERROR_PENALTY} = ${C.TEAM_COST + C.ERROR_PENALTY} points</b>.` };
      const wrongQ = Q.filter(([k, , , right]) => ans[k] !== right);
      await next(`<h1>Not quite</h1><p>${wrongQ.length === 1 ? "One answer was" : "Both answers were"} not correct:</p>
        ${wrongQ.map(([k, q]) => `<div class="card"><p class="q">${q}</p><p>${why[k]}</p></div>`).join("")}
        <p>Please try once more.</p>${rulesBox()}`, 3, "Try again");
    }
  }

  async function modelInfo() {
    await next(`<h1>About the decision model</h1>
      <p class="lead">Please read this information carefully. You will use it to set the threshold.</p>
      ${infoBlock()}`, 4, "Continue", C.MIN_READ_MS);
    log("model_info_seen", {});
  }

  async function threshold(round) {
    const fixed = false;
    const queue = round === 1 ? S.queue1 : S.queue2;
    const current = round === 2 ? D.round1.threshold : null;
    const intro = round === 1
      ? `<p class="lead">Set the threshold for round 1 (200 reviews).</p>`
      : `<p class="lead">Set the threshold for round 2 (next week's 200 reviews). Your round-1 threshold was <b>${thrLabel(current)}</b> (▼ on the bar).</p>`;
    const sliderVal = (t) => (t > 1 ? 105 : Math.round(t * 100));
    const max = round === 1 ? 100 : 105;
    const pos = (v) => ((v - 50) / (max - 50) * 100).toFixed(1) + "%";
    const startVal = round === 2 ? sliderVal(current) : 75;
    screen(`<h1>Round ${round}: threshold</h1>${intro}
      ${infoBlock()}
      <div class="card thr"><div class="thr-head"><div><div class="small muted">Your threshold</div><div class="thr-value" id="v">Not set</div></div>
        <div class="small muted hint">Click or drag on the bar.</div></div>
      ${fixed ? "" : `${round === 2 ? `<div class="ticks abs mark"><span style="left:${pos(startVal)}">▼ Round 1</span></div>` : ""}<input type="range" id="s" class="untouched" min="50" max="${max}" step="1" value="${startVal}" aria-label="Threshold">
      <div class="ticks abs"><span style="left:${pos(50)}">0.50</span><span style="left:${pos(75)}">0.75</span>${round === 1 ? `<span style="left:${pos(100)};transform:translateX(-100%)">1.00</span>` : `<span style="left:${pos(100)}">1.00</span><span class="off" style="left:${pos(105)}">AI off</span>`}</div>
      <div class="dir"><span>← More decided automatically</span><span>More sent to your team →</span></div>`}
      <div class="split" id="split"><span class="a" id="sa"></span><span class="b" id="sb"></span></div>
      <div class="legend"><span><i style="background:var(--accent)"></i>Decided automatically</span><span><i style="background:var(--team)"></i>Sent to your team</span></div></div>
      <div class="btns"><button class="primary" id="go" ${fixed ? "" : "disabled"}>${fixed ? "Continue" : "Confirm threshold"}</button></div>
      ${rulesBox()}`, round === 1 ? 5 : 12);
    const sa = app.querySelector("#sa"), sb = app.querySelector("#sb");
    const upd = (t) => {
      const sp = app.querySelector("#split");
      if (t === null) { sp.style.visibility = "hidden"; return; }
      sp.style.visibility = "visible";
      const na = autoCount(queue, t), a = na / queue.length;
      sa.style.width = a * 100 + "%"; sb.style.width = (1 - a) * 100 + "%";
      sa.textContent = a > 0.15 ? `${na} auto` : ""; sb.textContent = 1 - a > 0.15 ? `${queue.length - na} to team` : "";
    };
    const toT = (v) => (Number(v) >= 101 ? AI_OFF : Math.round(Number(v)) / 100);
    upd(null);
    const s = app.querySelector("#s"); let moves = 0;
    if (s) {
      const touch = () => { s.classList.remove("untouched"); const t = toT(s.value); app.querySelector("#v").textContent = thrLabel(t); upd(t); app.querySelector("#go").disabled = false; moves++; };
      s.addEventListener("input", touch); s.addEventListener("change", touch); s.addEventListener("pointerup", touch); s.addEventListener("keyup", touch);
    }
    const shown = Date.now();
    await wait("#go");
    const t = toT(s.value);
    D["r" + round + "_moves"] = moves; D["r" + round + "_rt_ms"] = Date.now() - shown;
    log("threshold", { round, value: t, fixed, n_moves: moves, rt_ms: Date.now() - shown });
    return t;
  }

  function statTiles(o) {
    return `<div class="stats">
      <div class="stat"><div class="k">Decided by the model</div><div class="v">${o.n_auto}</div><div class="s${o.auto_wrong ? " bad" : ""}">${o.auto_wrong} wrong</div></div>
      <div class="stat"><div class="k">Sent to review team</div><div class="v">${o.n_team}</div><div class="s">${o.team_wrong} wrong · ${num(o.n_team * C.TEAM_COST)} points spent</div></div>
      <div class="stat"><div class="k">Points left</div><div class="v">${num(o.points)}</div><div class="s">started with ${num(C.ROUND_START)}</div></div></div>`;
  }

  async function basis(round) {
    const B = [["vendor_claim", "What the vendor says about its confidence scores"],
               ["accuracy", "Whether the model is right as often as my review team"],
               ["cost", "Which costs fewer points: deciding automatically or sending to the team"],
               ["workload", "How many reviews would go to my team"],
               ["gut", "My gut feeling"]].concat(round === 2 ? [["audit", "The fake reviews found in the round-1 audit"]] : []);
    screen(`<h1>Your round-${round} threshold</h1>
      <div class="card"><p class="q">What mainly guided your round-${round} threshold?</p>
      ${B.map(([v, l]) => `<label class="opt"><input type="radio" name="basis" value="${v}">${l}</label>`).join("")}</div>
      ${round === 1 ? `<div class="card">${scale("difficulty", "Deciding on my round-1 threshold was difficult.", ["Strongly disagree", "Strongly agree"])}</div>
        <div class="card">${scale("confidence", "How confident are you that your round-1 threshold was a good choice?", ["Not at all confident", "Completely confident"])}</div>` : ""}
      <div class="btns"><button class="primary" id="go">Continue</button></div><p id="msg" class="err"></p>`, round === 1 ? 6 : 12);
    app.querySelectorAll(".seg input").forEach((inp) => inp.addEventListener("change", () => {
      app.querySelectorAll(`input[name=${inp.name}]`).forEach((x) => x.parentElement.classList.toggle("on", x.checked));
    }));
    for (;;) {
      await wait("#go");
      const v = (app.querySelector("input[name=basis]:checked") || {}).value;
      const dif = round === 1 ? Number((app.querySelector("input[name=difficulty]:checked") || {}).value || 0) : null;
      const conf = round === 1 ? Number((app.querySelector("input[name=confidence]:checked") || {}).value || 0) : null;
      if (!v || dif === 0 || conf === 0) { app.querySelector("#msg").textContent = "Please answer all questions."; continue; }
      D[round === 1 ? "basis" : "basis_r2"] = v;
      if (round === 1) { D.items.difficulty = dif; D.items.confidence = conf; }
      log("basis", { round, value: v, difficulty: dif, confidence: conf }); return;
    }
  }

  async function round1() {
    const t = await threshold(1);
    await basis(1);
    screen(`<h1>Round 1</h1><p>Screening 200 reviews with threshold ${thrLabel(t)}…</p><div class="spinner"></div>`, 6);
    await sleep(1600);
    D.round1 = outcome(S.queue1, t);
    log("round1_result", D.round1);
    checkpoint("round1_done");
    const spot = `<p class="lead">Automatic decisions are published without human review, so their mistakes are not visible right away.</p>
      <div class="callout bad">To check, your team audited all <b>${S.spotN}</b> reviews the model decided with confidence <b>1.00</b>.<br><b>${S.spotWrong} of them were AI-generated fakes that were published as real.</b></div>
      <p>Three of them:</p>`;
    await next(`<h1>Round 1: audit result</h1>${spot}${S.spotShow.map((e) => reviewCard(e, true)).join("")}`, 6);
  }

  async function responsibility() {
    const P = { me: "You, the manager who runs the screening system", model: "The decision model",
                vendor: "The company that sells the decision model" };
    const order = shuffle(Object.keys(P));
    const lead = `In round 1, the model automatically published the ${S.spotWrong} fake reviews found in the audit. How responsible is each of the following for this?`;
    const ans = await ratingPage("responsibility", "Who is responsible?", lead, order.map((k) => ["resp_" + k, P[k]]), 8,
      ["Not at all responsible", "Completely responsible"], false);
    D.responsibility = { me: ans.resp_me, model: ans.resp_model, vendor: ans.resp_vendor, order: order.join(">") };
    log("responsibility", D.responsibility);
  }

  function scale(name, text, ends, vals = [1, 2, 3, 4, 5, 6, 7]) {
    const mid = ends[0] === "Strongly disagree" ? "Neutral" : "";
    return `<div class="lk"><p class="q">${text}</p>
      <div class="likert seg" role="radiogroup" style="grid-template-columns:repeat(${vals.length},1fr)">${vals.map((v) => `<label><input type="radio" name="${name}" value="${v}"><span>${v}</span></label>`).join("")}</div>
      <div class="seg-ends"><span>${ends[0]}</span><span>${mid}</span><span>${ends[1]}</span></div></div>`;
  }
  async function ratingPage(id, title, lead, items, step, ends = ["Strongly disagree", "Strongly agree"], shuffleItems = true, tail = [], extra = null) {
    const order = (shuffleItems ? shuffle(items) : items).concat(tail);
    screen(`<h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ""}<div class="card">${order.map(([k, t]) => scale(k, t, ends)).join("")}${extra ? extra.html : ""}</div>
      <div class="btns"><button class="primary" id="go">Continue</button></div><p id="msg" class="err"></p>`, step);
    app.querySelectorAll(".seg input").forEach((inp) => inp.addEventListener("change", () => {
      app.querySelectorAll(`input[name=${inp.name}]`).forEach((x) => x.parentElement.classList.toggle("on", x.checked));
    }));
    const shown = Date.now();
    for (;;) {
      await wait("#go");
      const ans = Object.fromEntries(order.map(([k]) => [k, Number((app.querySelector(`input[name=${k}]:checked`) || {}).value || 0)]));
      const ex = extra ? extra.read() : null;
      if (Object.values(ans).some((v) => !v) || (extra && !ex)) { app.querySelector("#msg").textContent = "Please answer all questions."; continue; }
      if (extra) ans._extra = ex;
      Object.assign(D.items, ans);
      log("likert", { page: id, order: order.map(([k]) => k), rt_ms: Date.now() - shown, ...ans });
      return ans;
    }
  }
  const likertPage = (id, title, lead, items, step, tail = []) => ratingPage(id, title, lead, items, step, undefined, true, tail);

  async function afterRound1() {
    const a = await likertPage("post_r1", "Looking back", `Think about round 1 and the ${S.spotWrong} fake reviews found in the audit.`, [
      ["link_clear", "Before round 1, it was clear what a good threshold would be."],
      ["fore1", "Before round 1, it was possible to foresee how often the model would be wrong."],
      ["fore2", "With the information I had before round 1, I could have predicted that some fake reviews would get through."],
      ["imc1", "This is a check: please select 7 for this statement."],
    ], 9);
    D.attention1_passed = a.imc1 === 7;
    checkpoint("mediators_done");
  }

  async function round2() {
    const t = await threshold(2);
    await basis(2);
    D.round2 = outcome(S.queue2, t);
    log("round2_result", D.round2);
    checkpoint("round2_done");
  }

  async function survey() {
    const ans = await ratingPage("end_trust", "About the model", "", [
      ["trust_m1", "I trust the decision model."],
      ["trust_m2", "I can rely on the decision model."],
      ["trust_m3", "The decision model works reliably."],
      ["claim1", "The vendor's description of the confidence scores is accurate."],
      ["claim2", "The vendor's description of the confidence scores is believable."],
      ["imc2", "To show you are reading, please select 1 for this statement."],
    ], 13);
    D.attention2_passed = ans.imc2 === 1;
    const ex = await ratingPage("end_about", "Last questions", "", [], 14, undefined, false, [], {
      html: scale("risk", "How do you see yourself: are you generally a person who is fully prepared to take risks or do you try to avoid taking risks?",
          ["Not at all willing to take risks", "Fully prepared to take risks"])
        + `<div class="lk"><p class="q">How often do you use AI tools such as chatbots?</p>
        <select id="aiuse"><option value="">Select…</option><option>Never</option><option>Less than monthly</option><option>Monthly</option><option>Weekly</option><option>Daily</option></select></div>
        <div class="lk"><p class="q">Do you currently work in a role where you manage people or make decisions for a team?</p>
        <div class="inline-opts">${["Yes", "No"].map((v) => `<label class="opt"><input type="radio" name="mgr" value="${v}">${v}</label>`).join("")}</div></div>
        <div class="lk"><p class="q">At work, have you ever set rules or limits for an automated system (for example, alert levels or approval limits)?</p>
        <div class="inline-opts">${["Yes", "No", "Not sure"].map((v) => `<label class="opt"><input type="radio" name="autoset" value="${v}">${v}</label>`).join("")}</div></div>`,
      read: () => { const r = app.querySelector("input[name=risk]:checked"), a = app.querySelector("#aiuse").value,
                         m = app.querySelector("input[name=mgr]:checked"), u = app.querySelector("input[name=autoset]:checked");
                    return r && a && m && u ? { risk: Number(r.value), ai: a, mgr: m.value, autoset: u.value } : ""; } });

    delete D.items._extra;
    D.survey = { ai_use: ex._extra.ai, risk: ex._extra.risk, manager: ex._extra.mgr, set_automation: ex._extra.autoset };
    log("survey", D.survey);
  }

  const debrief = () => `<div class="card small"><b>About this study</b>
    <p style="margin:6px 0 0">The hotel website, the vendor, its documentation${D.evidence ? ", “your team's” test" : ""} and the manager role were fictional parts of a role-play. The reviews and the model's answers and confidence scores are real research data from an AI system. We study how people set and revise automation thresholds and how they assign responsibility when automated decisions go wrong. Your bonus is based on the points shown above.${C.CONTACT ? " Questions: " + esc(C.CONTACT) + "." : ""}</p></div>`;

  async function finish() {
    const total = D.round1.points + D.round2.points;
    D.total_points = total;
    D.bonus_usd = Math.round(total * C.POINT_VALUE_USD * 100) / 100;
    D.finished_at = new Date().toISOString();
    D.step = "finished";
    D.duration_s = Math.round((Date.now() - t0) / 1000);
    backup();
    screen(`<h1>Saving your responses…</h1><p>Please do not close this window.</p><div class="spinner"></div>`, 15);
    let saved = false;
    if (LIVE) {
      const p = enqueue({ kind: "participant", participant: participantRow() }).then((ok) => { if (ok) { D.saved = true; backup(); } return ok; });
      saved = await Promise.race([p, sleep(60000).then(() => false)]);
    }
    const summary = `<p>After the week, every review was verified. Here are your full results.</p><h2>Round 1 results (threshold ${thrLabel(D.round1.threshold)})</h2>${statTiles(D.round1)}
      <h2>Round 2 results (threshold ${thrLabel(D.round2.threshold)})</h2>${statTiles(D.round2)}
      <div class="card"><b>Total: ${num(total)} points</b> · bonus $${D.bonus_usd.toFixed(2)}, paid within a few days.</div>`;
    if (DEBUG) {
      const blob = new Blob([JSON.stringify(D, null, 1)], { type: "application/json" });
      screen(`<h1>Debug: finished</h1><p>Condition ${D.condition} (evidence=${D.evidence}, cost view=${D.costView}).</p>${summary}
        <p><a download="${D.prolific_pid}.json" href="${URL.createObjectURL(blob)}">Download data (JSON)</a></p>`, 15);
      window.__RESULT__ = D;
      return;
    }
    screen(`<h1>Thank you!</h1>${summary}${debrief()}
      ${saved || !LIVE ? `<p>Your responses were saved. ${C.PROLIFIC_COMPLETION_CODE ? "You will return to Prolific in a few seconds." : ""}</p>`
                       : `<p class="err">We could not save your responses right now. They are kept in this browser and will be sent again if you reload this page. Please also click the link below to complete the study on Prolific.</p>`}
      <div class="btns"><a class="btn primary" href="${doneURL()}">Return to Prolific to complete the study</a></div>`, 15);
    if (saved && C.PROLIFIC_COMPLETION_CODE) setTimeout(() => { location.href = doneURL(); }, 8000);
  }

  async function recoverUnsaved() {
    let b = null;
    try { b = JSON.parse(localStorage.getItem(BK) || "null"); } catch (e) { b = null; }
    if (!b || !b.finished_at || b.saved || !LIVE) return false;
    screen(`<h1>Sending your saved responses…</h1><div class="spinner"></div>`);
    Object.assign(D, b);
    const ok = await enqueue({ kind: "participant", participant: participantRow() });
    if (ok) { D.saved = true; backup(); }
    screen(`<h1>Thank you!</h1>${debrief()}<p>${ok ? "Your responses were saved." : "We still could not save your responses. Please send us a message on Prolific."}</p><div class="btns"><a class="btn primary" href="${doneURL()}">Return to Prolific to complete the study</a></div>`);
    return true;
  }

  async function deviceOk() {
    const touchOnly = window.matchMedia && window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-pointer: fine)").matches;
    if (touchOnly && !DEBUG) {
      log("device_blocked", { w: window.innerWidth, h: window.innerHeight });
      await logExit("device_blocked");
      screen(`<h1>Please use a computer</h1><p>This study needs a desktop or laptop computer with a mouse or trackpad. Thank you!</p>${returnBlock()}`);
      return false;
    }
    while (window.innerWidth < 760 && !DEBUG) {
      screen(`<h1>Please widen your browser window</h1><p>This study needs a wider window. Please maximize your browser window; the study will continue automatically.</p>`);
      await new Promise((res) => window.addEventListener("resize", res, { once: true }));
    }
    return true;
  }

  async function main() {
    try {
      if (!PID && !DEBUG && !TEST) {
        screen(`<h1>Please open this study from Prolific</h1><p>This link is missing your Prolific ID. Please return to Prolific and open the study from there.</p>`);
        return;
      }
      if (await recoverUnsaved()) return;
      if (!(await deviceOk())) return;
      try { const old = JSON.parse(localStorage.getItem(BK) || "null"); if (old && !old.finished_at) D.resumed_local = true; } catch (e) { /* ignore */ }
      await consent();
      await intro(register());
      if (D.screened_out) { screen(`<h1>Thank you for your time</h1><p>Our records show that this study ended for you at the check questions.</p>${returnBlock()}`); return; }
      if (D.already_complete) { screen(`<h1>Already completed</h1><p>Our records show you have already completed this study. Thank you!</p><div class="btns"><a class="btn primary" href="${doneURL()}">Return to Prolific</a></div>`); return; }
      if (D.resumed || D.resumed_local) await next(`<h1>Welcome back</h1><p>It looks like you started this study before. Please continue from the beginning and answer as you would now.</p>`, 1);
      checkpoint("consented");
      await howItWorks();
      screen(`<h1>Preparing…</h1><div class="spinner"></div>`, 3);
      applyCondition(await assignCondition());
      checkpoint("assigned");
      await modelInfo();
      await round1();
      await responsibility();
      await afterRound1();
      await round2();
      await survey();
      await finish();
    } catch (e) {
      const m = String(e && e.message);
      if (m !== "no-consent" && m !== "comprehension-failed") {
        log("error", { message: String(e), stack: String(e && e.stack) });
        checkpoint("error");
        screen(`<h1>Something went wrong</h1><p>Sorry, an error occurred. Your answers so far were saved. Please send the researcher a message on Prolific, and use this link to complete the study:</p><div class="btns"><a class="btn primary" href="${doneURL()}">Return to Prolific</a></div>`);
      }
    }
  }
  window.addEventListener("beforeunload", (e) => { if ((!D.finished_at || (LIVE && !D.saved)) && D.events.length > 2 && !D.comprehension_failed && !D.screened_out) { e.preventDefault(); e.returnValue = ""; } });
  main();
})();
