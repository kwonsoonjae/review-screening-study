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
  const SMIN = Math.round(C.SLIDER_MIN * 100);
  const NONCE = Math.random().toString(36).slice(2, 12);
  const t0 = Date.now();
  const STEPS = 16;

  const D = {
    version: "study2-v3.2", study: STUDY, k: null, step: "start",
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
    app.classList.add("fresh"); clearTimeout(screen.t); screen.t = setTimeout(() => app.classList.remove("fresh"), 350);
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
  const guide = (html) => `<div class="guide"><div class="av" aria-hidden="true">i</div><p>${html}</p></div>`;
  const thrLabel = (t) => (t > 1 ? "Model off (all reviews to the team)" : fmt2(t));

  const badge = (v) => v === "real" ? `<span class="badge real">✓ Real guest</span>` : `<span class="badge ai">⚠ AI-generated</span>`;
  function reviewCard(it, wrong, clamp = false) {
    return `<div class="card review${wrong ? " wrong" : ""}${clamp ? " clamp" : ""}"><div class="body">
      <div class="row"><span class="tag liked">Liked</span><span>${esc(it.liked || "—")}</span></div>
      <div class="row"><span class="tag disliked">Disliked</span><span>${esc(it.disliked || "—")}</span></div></div>
      <div class="verdict"><span class="small muted">The model says</span>${badge(it.ai_says)}<span class="meter">Probability <b>${fmt2(it.p)}</b></span></div>
      ${wrong ? `<div class="flag">Actually AI-generated: a fake review published as real</div>` : ""}</div>`;
  }
  const costTable = () => `<table class="cost"><colgroup><col style="width:40%"><col style="width:30%"><col style="width:30%"></colgroup>
    <tr><th>Points lost per review</th><th>Final decision right</th><th>Final decision wrong</th></tr>
    <tr><td>Decided by the model</td><td>0</td><td>${C.ERROR_PENALTY}</td></tr>
    <tr><td>Sent to your team</td><td>${C.TEAM_COST}</td><td>${C.TEAM_COST} + ${C.ERROR_PENALTY} = ${C.TEAM_COST + C.ERROR_PENALTY}</td></tr></table>`;
  const teamAvg = () => C.TEAM_COST + Math.round((1 - C.TEAM_ACCURACY) * C.ERROR_PENALTY);
  const teamNote = () => `<ul class="defs"><li><b>Team average:</b> about ${teamAvg()} points lost per review (${C.TEAM_COST} points for the check, plus ${C.ERROR_PENALTY} points for each mistake the team makes: ${pct(1 - C.TEAM_ACCURACY)} × ${C.ERROR_PENALTY} = ${Math.round((1 - C.TEAM_ACCURACY) * C.ERROR_PENALTY)}).</li></ul>`;
  const rulesBox = () => `<div class="card rules"><h3>Rules</h3>
    <ul class="tight"><li>Probability <b>at or above</b> the threshold → <b>decided by the model</b> (its answer is applied as is).</li>
    <li>Probability <b>below</b> the threshold → sent to <b>your team</b> (right ${pct(C.TEAM_ACCURACY)} of the time).</li></ul>
    ${costTable()}${teamNote()}</div>`;
  const vendorNote = () => `<div class="note vendor"><h3>What the vendor says</h3>
    <p>The vendor (the tech company that sells the model) describes the probabilities like this:</p>
    <ul><li>The model gives each answer a probability: <b>the probability that the answer is correct</b>.</li>
    <li>A probability of ${fmt2(C.VENDOR_EXAMPLE)} means the model's answer is correct about <b>${pct(C.VENDOR_EXAMPLE)}</b> of the time.</li></ul></div>`;
  const autoCost = (a) => (C.ERROR_PENALTY * (1 - a)).toFixed(1);
  const evidenceTable = (cost = D.costView) => `<div class="card evidence"><h3>Your team's own test</h3>
    <p class="sub">To see how the model works on your own website, your team ran it on 200 past reviews from this website. For these reviews, the team already knew which were real and which were fake. The reviews are grouped by the model's probability (40 reviews per row).${cost ? ` The last two columns show the average points lost per review, counting both costs and mistakes.<br>In each row, the <b>lower number</b> is the cheaper way to handle those reviews.` : ""}</p>
    <table class="ev${cost ? " cost4" : ""}">${cost ? `<colgroup><col style="width:22%"><col style="width:30%"><col style="width:24%"><col style="width:24%"></colgroup>` : `<colgroup><col style="width:40%"><col style="width:60%"></colgroup>`}
    <thead><tr><th>Model probability</th><th>Answer correct</th>${cost ? "<th>Cost if the model decides</th><th>Cost if sent to team</th>" : ""}</tr></thead><tbody>
    ${S.localTable.map((r) => `<tr><td class="nowrap">${esc(r.bin)}</td><td class="nowrap"><span class="mini" style="width:${Math.round(r.accuracy * 110)}px"></span>${+(r.accuracy * 100).toFixed(1)}%</td>${cost ? (() => { const a = Number(autoCost(r.accuracy)), t = teamAvg(), b = (v, on) => on ? `<b>${v}</b>` : v; return `<td>${b(a.toFixed(1) + " points", a < t)}</td><td>${b(t.toFixed(1) + " points", t <= a)}</td>`; })() : ""}</tr>`).join("")}
    </tbody></table><ul class="defs"><li><b>Answer correct:</b> share of the model's answers that were right.</li>${cost ? `
      <li><b>Cost if the model decides:</b> ${C.ERROR_PENALTY} points × share of wrong answers.</li>
      <li><b>Cost if sent to team:</b> about ${teamAvg()} points (${C.TEAM_COST} points for the check plus the team's mistakes, on average).</li>` : ""}</ul></div>`;
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
      r1_moves: D.r1_moves, r1_path: D.r1_path, r1_rt_ms: D.r1_rt_ms, basis: D.basis, basis_r2: D.basis_r2, recall_opened: D.recall_opened,
      resp_me: rs.me, resp_model: rs.model, resp_vendor: rs.vendor, resp_order: rs.order,
      r2_threshold: r2.threshold, r2_ai_off: r2.ai_off, r2_n_auto: r2.n_auto, r2_auto_wrong: r2.auto_wrong, r2_n_team: r2.n_team, r2_team_wrong: r2.team_wrong, r2_points: r2.points,
      r2_moves: D.r2_moves, r2_path: D.r2_path, r2_rt_ms: D.r2_rt_ms,
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
    ? `<p>You will receive a small payment for your time.</p><p><a class="btn primary" href="${screenOutURL()}">Return to Prolific</a></p>`
    : `<p>Please <b>return the study</b> on Prolific (do not submit it).</p>`;
  const maxBonus = () => { const best = (q) => Math.max(...Array.from({ length: 101 - SMIN }, (_, i) => outcome(q, (SMIN + i) / 100).points)); return ((best(S.queue1) + best(S.queue2)) * C.POINT_VALUE_USD).toFixed(2); };
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
        ? `<p>You will be asked to return the study on Prolific, without any penalty.</p><p><a class="btn primary" href="${noConsentURL()}">Return to Prolific</a></p>`
        : `<p>Please <b>return the study</b> on Prolific (do not submit it).</p>`}`);
      throw new Error("no-consent");
    }
  }

  async function intro(regP) {
    screen(`<h1>Your job</h1>
      ${guide("You manage review screening at a hotel booking website. Here is your situation.")}
      <div class="card step-card"><h3><span class="n">1</span>The website</h3><p>Guests post hotel reviews. Some reviews are <b>fake</b>: written by AI, not by real guests. Real reviews should be published, fake ones removed.</p></div>
      <div class="card step-card"><h3><span class="n">2</span>Your review team</h3><p>Your review team checks reviews by hand. It is right ${pct(C.TEAM_ACCURACY)} of the time, but every check costs staff time.</p></div>
      <div class="card step-card"><h3><span class="n">3</span>The new AI tool</h3><p>Your company bought an AI tool, a <b>decision model</b> ("the model"), from a tech company (the <b>vendor</b>). For each review, the model gives an answer, <b>Real guest</b> or <b>AI-generated</b>, and a <b>probability</b> from ${fmt2(C.SLIDER_MIN)} to 1.00. Two examples:</p>
        ${S.examples.map((e) => reviewCard(e)).join("")}
        <p>Reviews with a probability below ${fmt2(C.SLIDER_MIN)} go to another team and do not affect your points.</p></div>
      <div class="card step-card"><h3><span class="n">4</span>Your role</h3><p>You decide which reviews the model handles on its own and which your team checks.</p>
        <ul class="tight">
          <li>Your company judges review screening by its <b>total cost</b>: staff checks plus wrong decisions.</li>
          <li>Each round you get a budget of <b>${num(C.ROUND_START)} points</b>. The points left become <b>your bonus</b>.</li>
          <li>Each week, the website's management reviews how screening went. You may be asked to explain the threshold you chose.</li>
        </ul></div>
      <div class="btns"><button class="primary" id="go">Continue</button></div>`, 1);
    await wait("#go");
    const go = app.querySelector("#go");
    if (go) { go.disabled = true; go.textContent = "Preparing…"; }
    return regP;
  }

  async function howItWorks() {
    await next(`<h1>How the threshold works</h1>
      ${guide("You make one decision: the <b>threshold</b>. It decides who handles each review, based on the model's probability.")}
      <div class="card"><div class="tdiag"><div class="mark"><span>your threshold<br>▼</span></div>
        <div class="bar"><span class="l">Sent to your team</span><span class="r">Decided by the model</span></div>
        <div class="ends"><span>Probability ${fmt2(C.SLIDER_MIN)}</span><span>Probability 1.00</span></div></div></div>
      <div class="lanes">
        <div class="lane team"><div class="t">Probability below the threshold</div><b>Sent to your team.</b> Your team checks the review and makes the final decision. This costs staff time; the team is right ${pct(C.TEAM_ACCURACY)} of the time.</div>
        <div class="lane auto"><div class="t">Probability at or above the threshold</div><b>Decided by the model.</b> Its answer is applied as is: real reviews are published, fake ones removed. No staff time, but the model's mistakes go through.</div>
      </div>
      <p><b>Raise</b> the threshold → more reviews go to your team. <b>Lower</b> it → the model decides more reviews on its own.</p>`, 2);
    await next(`<h1>Costs and bonus</h1>
      ${guide("Points stand for the company's money. Every review costs points in one of these ways.")}
      <div class="card"><h3>Points lost</h3><ul class="tight">
        <li><b>Team check: ${C.TEAM_COST} points</b>, the staff time to check one review.</li>
        <li><b>Wrong final decision: ${C.ERROR_PENALTY} points.</b> A fake review that is published, or a real review that is removed, leads to complaints, refunds and lost trust.</li>
        <li><b>The model decides and is right: 0 points.</b></li></ul>
        ${costTable()}${teamNote()}</div>
      <div class="card"><h3>Rounds and bonus</h3><ul class="tight">
        <li>2 rounds. Each round is one week of 200 reviews with a budget of <b>${num(C.ROUND_START)} points</b>.</li>
        <li>Every review costs something on average, so a round usually uses most of its budget. Your bonus is whatever is left.</li>
        <li>Points left at the end of each round become your bonus: <b>$${(C.POINT_VALUE_USD * 100).toFixed(2)} per 100 points</b>. A round cannot go below 0, nothing carries over, and your base payment is never affected.</li>
        <li>Round 1 is a trial week: any threshold is allowed, but the model cannot be switched off. From round 2 you can also switch the model off and send every review to your team.</li></ul></div>`, 2, "Continue", C.MIN_READ_MS);
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
      await next(`<h1>Not quite</h1><p>${wrongQ.length === 1 ? "One answer was not correct:" : "Neither answer was correct:"}</p>
        ${wrongQ.map(([k, q]) => `<div class="card"><p class="q">${q}</p><p>${why[k]}</p></div>`).join("")}
        <p>Please try once more.</p>${rulesBox()}`, 3, "Try again");
    }
  }

  async function modelInfo() {
    await next(`<h1>About the decision model</h1>
      ${guide("Before you set your first threshold, here is what you know about the model. Please read it carefully; it is repeated on the next page.")}
      ${infoBlock()}`, 4, "Continue", C.MIN_READ_MS);
    log("model_info_seen", {});
  }

  async function threshold(round) {
    const fixed = false;
    const queue = round === 1 ? S.queue1 : S.queue2;
    const current = round === 2 ? D.round1.threshold : null;
    const intro = round === 1
      ? `${guide("Set your threshold for round 1 (200 reviews). The information about the model is repeated below for reference; the bar is at the bottom.")}`
      : `${guide(`Set your threshold for round 2 (next week's 200 reviews). Your round-1 threshold was <b>${thrLabel(current)}</b>, marked on the bar at the bottom.`)}<p class="ref-label">For reference: the same information about the model that you saw before round 1.</p>`;
    const OFFMAX = 103;
    const sliderVal = (t) => (t > 1 ? OFFMAX : Math.round(t * 100));
    const max = round === 1 ? 100 : OFFMAX;
    const pos = (v) => `calc(${((v - SMIN) / (max - SMIN)).toFixed(4)} * (100% - 22px) + 11px)`;
    const startVal = round === 2 ? sliderVal(current) : Math.round((SMIN + 100) / 2);
    screen(`<h1>Round ${round}: threshold</h1>${intro}
      ${infoBlock()}
      ${rulesBox()}
      <div class="card thr"><div class="thr-head"><div><div class="small muted">Your threshold</div><div class="thr-value" id="v">Not set</div></div>
        <div class="small muted hint">Click or drag on the bar.</div></div>
      ${fixed ? "" : `${round === 2 ? `<div class="ticks abs mark"><span style="left:${pos(startVal)}">Round 1<br>▼</span></div>` : ""}<input type="range" id="s" class="untouched${round === 2 ? " has-off" : ""}" style="--off:${pos(100.5)}" min="${SMIN}" max="${max}" step="1" value="${startVal}" aria-label="Threshold">
      <div class="ticks abs"><span style="left:${pos(SMIN)}">${fmt2(C.SLIDER_MIN)}</span>${round === 1 ? `<span style="left:${pos(100)};transform:translateX(-100%)">1.00</span>` : `<span style="left:${pos(100)};transform:translateX(-100%)">1.00</span><span class="off" style="left:${pos((100.5 + OFFMAX) / 2)};transform:translateX(-50%)">Model off</span>`}</div>
      <div class="dir"><span>← More decided by the model</span><span>More sent to your team →</span></div>`}
      <div class="split-box"><p class="split-empty" id="splitEmpty">Set a threshold to see how the ${queue.length} reviews would be split.</p>
      <div class="split-cap" id="splitCap">This round's ${queue.length} reviews:</div>
      <div class="split" id="split"><span class="a" id="sa"></span><span class="b" id="sb"></span></div>
      <div class="legend" id="legend"><span><i style="background:var(--accent)"></i>Decided by the model</span><span><i style="background:var(--team)"></i>Sent to your team</span></div></div>
      <div class="btns"><button class="primary" id="go" ${fixed ? "" : "disabled"}>${fixed ? "Continue" : "Confirm threshold"}</button></div></div>`, round === 1 ? 5 : 12);
    const sa = app.querySelector("#sa"), sb = app.querySelector("#sb");
    const upd = (t) => {
      const shown = [app.querySelector("#split"), app.querySelector("#legend"), app.querySelector("#splitCap")], em = app.querySelector("#splitEmpty");
      shown.forEach((x) => { x.style.display = t === null ? "none" : ""; }); em.style.display = t === null ? "" : "none";
      if (t === null) return;
      const na = autoCount(queue, t), a = na / queue.length;
      sa.style.width = a * 100 + "%"; sb.style.width = (1 - a) * 100 + "%";
      sa.style.display = na ? "" : "none"; sb.style.display = na < queue.length ? "" : "none";
      sa.textContent = a > 0.15 ? `${na} by the model` : ""; sb.textContent = 1 - a > 0.15 ? `${queue.length - na} to team` : "";
    };
    const toT = (v) => (Number(v) >= 101 ? AI_OFF : Math.round(Number(v)) / 100);
    upd(null);
    const s = app.querySelector("#s"); let moves = 0; const path = [];
    if (s) {
      const touch = () => { s.classList.remove("untouched"); const t = toT(s.value); app.querySelector("#v").textContent = thrLabel(t); upd(t); app.querySelector("#go").disabled = false; moves++; if (path[path.length - 1] !== t && path.length < 200) path.push(t); };
      s.addEventListener("input", touch); s.addEventListener("change", touch); s.addEventListener("pointerup", touch); s.addEventListener("keyup", touch);
    }
    const shown = Date.now();
    await wait("#go");
    const t = toT(s.value);
    D["r" + round + "_moves"] = moves; D["r" + round + "_path"] = path.join(" "); D["r" + round + "_rt_ms"] = Date.now() - shown;
    log("threshold", { round, value: t, fixed, n_moves: moves, rt_ms: Date.now() - shown });
    return t;
  }

  function statTiles(o) {
    return `<div class="stats">
      <div class="stat"><div class="k">Decided by the model</div><div class="v">${o.n_auto}</div><div class="s">${o.auto_wrong} wrong · ${num(o.auto_wrong * C.ERROR_PENALTY)} points lost</div></div>
      <div class="stat"><div class="k">Sent to review team</div><div class="v">${o.n_team}</div><div class="s">${o.team_wrong} wrong · ${num(o.n_team * C.TEAM_COST + o.team_wrong * C.ERROR_PENALTY)} points lost</div></div>
      <div class="stat"><div class="k">Points left</div><div class="v">${num(o.points)}</div><div class="s">started with ${num(C.ROUND_START)}</div></div></div>`;
  }

  async function basis(round) {
    const B = [["vendor_claim", "What the vendor says about the model's probabilities"],
               ["accuracy", "Whether the model is right as often as my review team"],
               ["cost", "Which costs fewer points: letting the model decide or sending to the team"],
               ["workload", "How many reviews would go to my team"],
               ["gut", "My gut feeling"]].concat(round === 2 ? [["audit", "The fake reviews found in the round-1 audit"]] : []);
    const basisCard = `<div class="card"><p class="q">What mainly guided your round-${round} threshold?</p>
      ${B.map(([v, l]) => `<label class="opt"><input type="radio" name="basis" value="${v}">${l}</label>`).join("")}</div>`;
    screen(`<h1>Round ${round}: about your threshold</h1>
      ${round === 1 ? `<div class="card">${scale("difficulty", "Deciding on my round-1 threshold was difficult.", ["Strongly disagree", "Strongly agree"])}</div>
        <div class="card">${scale("justify1", "I could easily explain my round-1 threshold to the website's management.", ["Strongly disagree", "Strongly agree"])}</div>
        <div class="card">${scale("justify2", "If my round-1 threshold turned out badly, I could defend it.", ["Strongly disagree", "Strongly agree"])}</div>
        <div class="card">${scale("confidence", "How confident are you that your round-1 threshold was a good choice?", ["Not at all confident", "Completely confident"])}</div>` : ""}
      ${basisCard}
      <div class="btns"><button class="primary" id="go">Continue</button></div><p id="msg" class="err"></p>`, round === 1 ? 6 : 12);
    app.querySelectorAll(".seg input").forEach((inp) => inp.addEventListener("change", () => {
      app.querySelectorAll(`input[name=${inp.name}]`).forEach((x) => x.parentElement.classList.toggle("on", x.checked));
    }));
    for (;;) {
      await wait("#go");
      const v = (app.querySelector("input[name=basis]:checked") || {}).value;
      const dif = round === 1 ? Number((app.querySelector("input[name=difficulty]:checked") || {}).value || 0) : null;
      const conf = round === 1 ? Number((app.querySelector("input[name=confidence]:checked") || {}).value || 0) : null;
      const j1 = round === 1 ? Number((app.querySelector("input[name=justify1]:checked") || {}).value || 0) : null;
      const j2 = round === 1 ? Number((app.querySelector("input[name=justify2]:checked") || {}).value || 0) : null;
      if (!v || dif === 0 || conf === 0 || j1 === 0 || j2 === 0) { flagMissing((round === 1 ? ["difficulty", "justify1", "justify2", "confidence"] : []).concat(["basis"])); continue; }
      D[round === 1 ? "basis" : "basis_r2"] = v;
      if (round === 1) { D.items.difficulty = dif; D.items.confidence = conf; D.items.justify1 = j1; D.items.justify2 = j2; }
      log("basis", { round, value: v, difficulty: dif, confidence: conf, justify1: j1, justify2: j2 }); return;
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
    const spot = `${guide("Round 1 is over. Decisions made by the model are applied without a human check, so their mistakes are not visible right away.")}
      <div class="callout bad">To check, your team audited all <b>${S.spotN}</b> reviews the model decided with probability <b>1.00</b>.<br><b>${S.spotWrong} of them were AI-generated fakes that were published as real.</b></div>
      <p>Reviews with probability 1.00 are decided by the model at any round-1 threshold, so no threshold could have sent them to your team.</p>
      <p>Three of them:</p>`;
    const recall = `<details class="recall" id="recall"><summary>Show the information you had before round 1</summary>${infoBlock()}</details>`;
    D.recall_opened = false;
    const nx = next(`<h1>Round 1: audit result</h1>${spot}${S.spotShow.map((e) => reviewCard(e, true)).join("")}${recall}`, 6);
    const rc = app.querySelector("#recall");
    if (rc) rc.addEventListener("toggle", () => { if (rc.open) { D.recall_opened = true; log("recall_open", {}); } });
    await nx;
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
    screen(`<h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ""}${order.map(([k, t]) => `<div class="card">${scale(k, t, ends)}</div>`).join("")}${extra ? extra.html : ""}
      <div class="btns"><button class="primary" id="go">Continue</button></div><p id="msg" class="err"></p>`, step);
    app.querySelectorAll(".seg input").forEach((inp) => inp.addEventListener("change", () => {
      app.querySelectorAll(`input[name=${inp.name}]`).forEach((x) => x.parentElement.classList.toggle("on", x.checked));
    }));
    const shown = Date.now();
    for (;;) {
      await wait("#go");
      const ans = Object.fromEntries(order.map(([k]) => [k, Number((app.querySelector(`input[name=${k}]:checked`) || {}).value || 0)]));
      const ex = extra ? extra.read() : null;
      if (Object.values(ans).some((v) => !v) || (extra && !ex)) { flagMissing(order.map(([k]) => k).concat(extra ? extra.names : [])); continue; }
      if (extra) ans._extra = ex;
      Object.assign(D.items, ans);
      log("likert", { page: id, order: order.map(([k]) => k), rt_ms: Date.now() - shown, ...ans });
      return ans;
    }
  }
  function flagMissing(names) {
    app.querySelectorAll(".card.missing").forEach((c) => c.classList.remove("missing"));
    const miss = names.filter((n) => !app.querySelector(`input[name="${n}"]:checked`)).map((n) => app.querySelector(`input[name="${n}"]`)?.closest(".card")).filter(Boolean);
    miss.forEach((c) => c.classList.add("missing"));
    if (miss[0] && miss[0].scrollIntoView) miss[0].scrollIntoView({ behavior: "smooth", block: "center" });
    app.querySelector("#msg").textContent = miss.length ? "Please answer the highlighted question" + (miss.length > 1 ? "s." : ".") : "Please answer all questions.";
  }
  app.addEventListener("change", (e) => { const c = e.target.closest && e.target.closest(".card.missing"); if (c) c.classList.remove("missing"); });
  const likertPage = (id, title, lead, items, step, tail = []) => ratingPage(id, title, lead, items, step, undefined, true, tail);

  async function afterRound1() {
    const a = await likertPage("post_r1", "Looking back", `Think about round 1 and the ${S.spotWrong} fake reviews found in the audit.`, [
      ["link_clear", "Before round 1, it was clear what a good threshold would be."],
      ["fore1", "Before round 1, it was possible to foresee how often the model would be wrong when it reported probability 1.00."],
      ["fore2", "With the information I had before round 1, I could have predicted that some reviews the model decided with probability 1.00 would be wrong."],
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

  const pills = (name, q, opts) => `<div class="card"><p class="q">${q}</p><div class="inline-opts">${opts.map((v) => `<label class="opt"><input type="radio" name="${name}" value="${v}">${v}</label>`).join("")}</div></div>`;
  async function survey() {
    const ans = await ratingPage("end_trust", "About the model", "", [
      ["trust_m1", "I trust the decision model."],
      ["trust_m2", "I can rely on the decision model."],
      ["trust_m3", "The decision model works reliably."],
      ["claim1", "The vendor's description of the model's probabilities is accurate."],
      ["claim2", "The vendor's description of the model's probabilities is believable."],
      ["imc2", "To show you are reading, please select 1 for this statement."],
    ], 13);
    D.attention2_passed = ans.imc2 === 1;
    const ex = await ratingPage("end_about", "Last questions", "", [], 14, undefined, false, [], {
      html: `<div class="card">${scale("risk", "How do you see yourself: are you generally a person who is fully prepared to take risks or do you try to avoid taking risks?",
          ["Not at all willing to take risks", "Fully prepared to take risks"])}</div>`
        + pills("aiuse", "How often do you use AI tools such as chatbots?", ["Never", "Less than monthly", "Monthly", "Weekly", "Daily"])
        + pills("mgr", "Do you currently work in a role where you manage people or make decisions for a team?", ["Yes", "No"])
        + pills("autoset", "At work, have you ever set rules or limits for an automated system (for example, alert levels or approval limits)?", ["Yes", "No", "Not sure"]),
      names: ["risk", "aiuse", "mgr", "autoset"],
      read: () => { const r = app.querySelector("input[name=risk]:checked"), a = (app.querySelector("input[name=aiuse]:checked") || {}).value,
                         m = app.querySelector("input[name=mgr]:checked"), u = app.querySelector("input[name=autoset]:checked");
                    return r && a && m && u ? { risk: Number(r.value), ai: a, mgr: m.value, autoset: u.value } : ""; } });

    delete D.items._extra;
    D.survey = { ai_use: ex._extra.ai, risk: ex._extra.risk, manager: ex._extra.mgr, set_automation: ex._extra.autoset };
    log("survey", D.survey);
  }

  const debrief = () => `<div class="card"><h3>About this study</h3>
    <p>The hotel website, the vendor, its documentation${D.evidence ? ", “your team's” test" : ""}, the manager role and the weekly management review were fictional parts of a role-play. The vendor's description of the probabilities did not match how this model actually performed. The reviews and the model's answers and probabilities are real research data from an AI system. We study how people set and revise automation thresholds and how they assign responsibility when automated decisions go wrong. Your bonus is based on the points shown above.${C.CONTACT ? " Questions: " + esc(C.CONTACT) + "." : ""}</p></div>`;

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
    const R = [D.round1, D.round2], usd = (n) => "$" + n.toFixed(2);
    const row = (label, f, cls = "") => `<tr${cls ? ` class="${cls}"` : ""}><td>${label}</td>${R.map((o) => `<td>${f(o)}</td>`).join("")}</tr>`;
    const minus = (n, c) => (n ? `${n} × ${c} = −${num(n * c)}` : "0");
    const summary = `<div class="card goal"><div class="bonus-head">Your bonus: ${usd(D.bonus_usd)}</div>
        <p style="margin:6px 0 0">You kept ${num(D.round1.points)} + ${num(D.round2.points)} = <b>${num(total)} points</b> over the two rounds. ${num(total)} points × $${(C.POINT_VALUE_USD * 100).toFixed(2)} per 100 points = ${usd(D.bonus_usd)} (rounded to the cent), paid within a few days.</p></div>
      <p>After both rounds, every review was checked. Here is where your points went.</p>
      <div class="card"><table class="ledger"><colgroup><col style="width:40%"><col style="width:30%"><col style="width:30%"></colgroup>
        <tr><th></th><th>Round 1</th><th>Round 2</th></tr>
        ${row("Your threshold", (o) => thrLabel(o.threshold).replace(" (all reviews to the team)", ""))}
        ${row("Budget at the start", () => num(C.ROUND_START))}
        ${row("Team checks", (o) => minus(o.n_team, C.TEAM_COST))}
        ${row("Mistakes by the model", (o) => minus(o.auto_wrong, C.ERROR_PENALTY))}
        ${row("Mistakes by your team", (o) => minus(o.team_wrong, C.ERROR_PENALTY))}
        ${row("Points kept", (o) => (o.points_raw < 0 ? "0*" : num(o.points)), "sum")}</table>
        <ul class="defs">${R.some((o) => o.points_raw < 0) ? "<li>* A round cannot go below 0 points.</li>" : ""}<li><b>Decided by the model:</b> ${D.round1.n_auto} reviews in round 1, ${D.round2.n_auto} in round 2. <b>Sent to your team:</b> ${D.round1.n_team} in round 1, ${D.round2.n_team} in round 2.</li></ul></div>`;
    if (DEBUG) {
      const blob = new Blob([JSON.stringify(D, null, 1)], { type: "application/json" });
      screen(`<h1>Debug: finished</h1><p>Condition ${D.condition} (evidence=${D.evidence}, cost view=${D.costView}).</p>${summary}
        <p><a download="${D.prolific_pid}.json" href="${URL.createObjectURL(blob)}">Download data (JSON)</a></p>`, 15);
      window.__RESULT__ = D;
      return;
    }
    screen(`<h1>Thank you! Your results</h1>${summary}${debrief()}
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
