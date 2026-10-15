(function () {
  "use strict";
  const C = window.CONFIG, S = window.STIMULI;
  const app = document.getElementById("app");
  const bar = document.getElementById("progress");
  const url = new URLSearchParams(location.search);
  const DEBUG = url.get("debug") === "1";
  const PID = url.get("PROLIFIC_PID") || "";
  const TEST = url.get("test") === "1" || !PID;
  const STUDY = C.STUDY + (TEST ? "-test" : "");
  const LIVE = !DEBUG && !!C.ENDPOINT;
  const t0 = Date.now();
  const STEPS = 11;

  const D = {
    version: "study2-v0.3", study: STUDY, k: null, step: "start",
    prolific_pid: PID || "nopid-" + Math.random().toString(36).slice(2, 10), study_id: url.get("STUDY_ID") || "", session_id: url.get("SESSION_ID") || "",
    started_at: new Date().toISOString(), user_agent: navigator.userAgent, condition: null, owner: null, evidence: null, events: [],
  };
  const log = (type, payload) => D.events.push({ type, t_ms: Date.now() - t0, ...payload });

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt2 = (x) => Number(x).toFixed(2);
  const pct = (x) => Math.round(x * 100) + "%";
  function screen(html, step) {
    app.innerHTML = html;
    if (step !== undefined) bar.style.width = Math.min(100, Math.round((step / STEPS) * 100)) + "%";
    window.scrollTo(0, 0);
  }
  function wait(selector, event = "click") {
    return new Promise((res) => app.querySelectorAll(selector).forEach((el) => el.addEventListener(event, (e) => res(e.currentTarget), { once: true })));
  }
  async function next(html, step, label = "Continue") {
    screen(html + `<div class="btns"><button class="primary" id="go">${label}</button></div>`, step);
    await wait("#go");
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const badge = (v) => v === "real" ? `<span class="badge real">✓ Real guest</span>` : `<span class="badge ai">⚠ AI-generated</span>`;
  function reviewCard(it, wrong) {
    return `<div class="card review${wrong ? " wrong" : ""}"><div class="body">
      <div class="row"><span class="tag liked">Liked</span><span>${esc(it.liked || "—")}</span></div>
      <div class="row"><span class="tag disliked">Disliked</span><span>${esc(it.disliked || "—")}</span></div></div>
      <div class="verdict"><span class="small muted">The model says</span>${badge(it.ai_says)}
        <span class="meter">Confidence <b>${fmt2(it.conf)}</b></span></div>
      ${wrong ? `<div class="flag">Actually AI-generated: a fake review published as real</div>` : ""}</div>`;
  }
  const vendorNote = () => `<div class="note"><b>From the vendor's documentation</b><br>“Confidence scores are calibrated. A confidence of 0.90 means the model's answer is correct about 90% of the time.”</div>`;
  const evidenceTable = () => `<div class="card evidence"><b>Your team's own test</b>
    <p class="small muted" style="margin:4px 0 0">Before launch, your team ran the model on 200 reviews from this website whose true origin was known.</p>
    <table><thead><tr><th>Model confidence</th><th>Reviews</th><th>Answer correct</th></tr></thead><tbody>
    ${S.localTable.map((r) => `<tr><td>${esc(r.bin)}</td><td>${r.n}</td><td><span class="mini" style="width:${Math.round(r.accuracy * 80)}px"></span>${pct(r.accuracy)}</td></tr>`).join("")}
    </tbody></table></div>`;
  const infoBlock = () => vendorNote() + (D.evidence ? evidenceTable() : "");

  function outcome(queue, t) {
    const auto = queue.filter(([c]) => c >= t), team = queue.filter(([c]) => c < t);
    const autoWrong = auto.filter(([, ok]) => !ok).length;
    const teamWrong = Math.round(team.length * (1 - C.TEAM_ACCURACY));
    const points = C.ROUND_START - C.TEAM_COST * team.length - C.ERROR_PENALTY * (autoWrong + teamWrong);
    return { threshold: t, n_auto: auto.length, auto_wrong: autoWrong, n_team: team.length, team_wrong: teamWrong, points: Math.max(0, points) };
  }
  const autoShare = (queue, t) => queue.filter(([c]) => c >= t).length / queue.length;

  async function post(body) {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(C.ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
        const j = await r.json();
        if (j.ok) return true;
      } catch (e) { /* retry */ }
      await sleep(1500 * (i + 1));
    }
    return false;
  }
  function participantRow() {
    const r1 = D.round1 || {}, r2 = D.round2 || {}, rs = D.responsibility || {}, sv = D.survey || {};
    return { pid: D.prolific_pid, study: STUDY, k: D.k, condition: D.condition, owner: D.owner, evidence: D.evidence, step: D.step,
      finished: D.finished_at || "", duration_s: Math.round((Date.now() - t0) / 1000),
      belief_pre: D.belief_pre, belief_post: D.belief_post,
      r1_threshold: r1.threshold, r1_n_auto: r1.n_auto, r1_auto_wrong: r1.auto_wrong, r1_n_team: r1.n_team, r1_team_wrong: r1.team_wrong, r1_points: r1.points,
      resp_me: rs.me, resp_model: rs.model, resp_vendor: rs.vendor, resp_designers: rs.designers,
      r2_threshold: r2.threshold, r2_n_auto: r2.n_auto, r2_auto_wrong: r2.auto_wrong, r2_n_team: r2.n_team, r2_team_wrong: r2.team_wrong, r2_points: r2.points,
      own1: sv.own1, ctrl1: sv.ctrl1, trust1: sv.trust1, just1: sv.just1, just2: sv.just2, attn2: sv.attn2,
      attention_passed: D.attention_passed, comprehension_failed: !!D.comprehension_failed, comprehension_tries: D.comprehension_tries,
      ai_use: sv.ai_use, age: sv.age, gender: sv.gender, how: sv.how, total_points: D.total_points, bonus_usd: D.bonus_usd,
      prolific_study: D.study_id, prolific_session: D.session_id, started: D.started_at, ua: D.user_agent, version: D.version,
      data_json: JSON.stringify(D) };
  }
  let saveChain = Promise.resolve(true);
  function enqueue(body) { saveChain = saveChain.then(() => post(body)); return saveChain; }
  function checkpoint(step) {
    D.step = step;
    log("step", { step });
    if (LIVE) enqueue({ kind: "participant", participant: participantRow() });
  }

  async function assignCondition() {
    const forced = url.get("cond");
    if (forced !== null && /^[0-3]$/.test(forced)) return Number(forced);
    if (LIVE) {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch(`${C.ENDPOINT}?action=register&study=${encodeURIComponent(STUDY)}&pid=${encodeURIComponent(D.prolific_pid)}`);
          const j = await r.json();
          if (j.ok) { D.k = j.k; D.resumed = j.resumed; D.already_complete = !!j.complete; return Number(j.condition) % 4; }
        } catch (e) { log("register_error", { message: String(e) }); }
        await sleep(1500 * (i + 1));
      }
      D.register_failed = true;
    }
    return Math.floor(Math.random() * 4);
  }
  function applyCondition(c) {
    D.condition = c; D.owner = c < 2 ? "self" : "default"; D.evidence = c % 2 === 1;
    log("condition", { condition: c, owner: D.owner, evidence: D.evidence, k: D.k, resumed: !!D.resumed });
  }

  async function consent() {
    screen(`<h1>Review screening study</h1>
      <div class="card small">
        <p><b>What you will do.</b> You will manage an AI system that screens reviews on a hotel booking website. The study takes about 8 minutes. You receive the base payment plus a performance bonus based on the points you earn.</p>
        <p><b>Data.</b> We record your choices and response times together with your Prolific ID. We do not collect your name or contact details. Anonymous data may be shared for research.</p>
        <p style="margin:0"><b>Voluntary.</b> You may stop at any time by closing this window. [IRB approval number and contact details to be inserted.]</p>
      </div>
      <p>Do you agree to take part?</p>
      <div class="btns"><button class="primary" id="yes">I agree</button><button id="no">I do not agree</button></div>`, 0);
    const b = await wait("#yes, #no");
    log("consent", { agree: b.id === "yes" });
    if (b.id !== "yes") { screen(`<h1>Thank you</h1><p>You chose not to take part. Please return the study on Prolific.</p>`); throw new Error("no-consent"); }
  }

  async function intro() {
    await next(`<h1>Your role</h1>
      <p class="lead">You manage review screening for a hotel booking website. Some reviews are written by real guests. Others are <b>fake reviews generated by AI</b>.</p>
      <p>A <b>decision model</b> checks every review and gives an answer (Real guest or AI-generated) with a confidence score. Two examples:</p>
      ${S.examples.map((e) => reviewCard(e)).join("")}`, 1);
  }

  async function howItWorks() {
    await next(`<h1>How screening works</h1>
      <p>You set a <b>threshold</b>. It decides who handles each review.</p>
      <div class="lanes">
        <div class="lane auto"><div class="t">Confidence ≥ threshold</div>The model's answer is applied <b>automatically</b>. No cost, but the model's mistakes go through.</div>
        <div class="lane team"><div class="t">Confidence &lt; threshold</div>The review goes to your <b>review team</b>. Each review costs <b>${C.TEAM_COST} points</b>. The team is right <b>${pct(C.TEAM_ACCURACY)}</b> of the time.</div>
      </div>
      <div class="card"><b>Points</b><p style="margin:6px 0 0">Each round starts with ${C.ROUND_START} points. Every review sent to the team costs ${C.TEAM_COST} points, and every <b>wrong final decision</b> (by the model or the team) costs <b>${C.ERROR_PENALTY} points</b>. There are two rounds of 200 reviews. Points become your bonus ($${(C.POINT_VALUE_USD * 100).toFixed(1)} per 100 points).</p></div>
      ${infoBlock()}`, 2);
    for (let tries = 1; ; tries++) {
      screen(`<h1>Quick check</h1>
        <p class="q">1. The threshold is 0.90. A review gets a model confidence of 0.97. What happens?</p>
        <label class="opt"><input type="radio" name="q1" value="auto">The model's answer is applied automatically</label>
        <label class="opt"><input type="radio" name="q1" value="team">It goes to the review team</label>
        <p class="q">2. Which of these cost points?</p>
        <label class="opt"><input type="radio" name="q2" value="both">Each review sent to the team, and each wrong final decision</label>
        <label class="opt"><input type="radio" name="q2" value="team">Only reviews sent to the team</label>
        <div class="btns"><button class="primary" id="go">Check answers</button></div>`, 3);
      await wait("#go");
      const q1 = (app.querySelector("input[name=q1]:checked") || {}).value, q2 = (app.querySelector("input[name=q2]:checked") || {}).value;
      const ok = q1 === "auto" && q2 === "both";
      log("comprehension", { try: tries, q1, q2, ok });
      D.comprehension_tries = tries;
      if (ok) break;
      if (tries >= C.COMPREHENSION_MAX_TRIES) { D.comprehension_failed = true; break; }
      await next(`<h1>Not quite</h1><div class="lanes"><div class="lane auto"><div class="t">At or above the threshold</div>decided automatically by the model</div><div class="lane team"><div class="t">Below the threshold</div>sent to the review team</div></div>
        <p>Every review sent to the team costs ${C.TEAM_COST} points, and every wrong final decision costs ${C.ERROR_PENALTY} points.</p>`, 3, "Try again");
    }
  }

  async function belief(when) {
    const pre = when === "pre";
    screen(`<h1>${pre ? "Your expectation" : "Your expectation now"}</h1>
      <p class="lead">Think of all reviews where the model reports a confidence of <b>0.95 or higher</b>. What percentage of those answers do you ${pre ? "expect" : "now expect"} to be correct?</p>
      <div class="card"><div class="thr-value" id="v">—</div>
      <input type="range" id="s" min="50" max="100" step="1" value="75" aria-label="Expected percentage correct">
      <div class="ticks"><span>50%</span><span>75%</span><span>100%</span></div></div>
      <div class="btns"><button class="primary" id="go" disabled>Continue</button></div><p class="muted small">Move the slider to answer.</p>`, pre ? 4 : 7);
    const s = app.querySelector("#s"), v = app.querySelector("#v"), go = app.querySelector("#go");
    s.addEventListener("input", () => { v.textContent = s.value + "%"; go.disabled = false; });
    await wait("#go");
    D["belief_" + when] = Number(s.value) / 100;
    log("belief", { when, value: D["belief_" + when] });
  }

  async function threshold(round) {
    const fixed = round === 1 && D.owner === "default";
    const queue = round === 1 ? S.queue1 : S.queue2;
    const start = fixed ? C.VENDOR_DEFAULT_THRESHOLD : (round === 2 ? D.round1.threshold : (C.SLIDER_MIN + C.SLIDER_MAX) / 2);
    const intro = round === 1
      ? (fixed ? `<p class="lead">For round 1 the threshold is set to the <b>vendor's recommended setting</b>. It cannot be changed in this round.</p>`
               : `<p class="lead">Set the threshold for round 1 (200 reviews).</p>`)
      : `<p class="lead">Set the threshold for <b>round 2</b>: next week's 200 reviews. Round-2 points are calculated from the model's real performance on those reviews.</p>`;
    screen(`<h1>Round ${round}: threshold</h1>${intro}
      <div class="card"><div class="small muted">Threshold${fixed ? " (vendor recommended)" : ""}</div>
      <div class="thr-value" id="v">${fmt2(start)}</div>
      ${fixed ? "" : `<input type="range" id="s" min="${C.SLIDER_MIN}" max="${C.SLIDER_MAX}" step="0.01" value="${start}" aria-label="Threshold">
      <div class="ticks"><span>${fmt2(C.SLIDER_MIN)}</span><span>${fmt2(C.SLIDER_MAX)}</span></div>`}
      <div class="split" id="split"><span class="a" id="sa"></span><span class="b" id="sb"></span></div>
      <div class="legend"><span><i style="background:var(--accent)"></i>Decided automatically by the model</span><span><i style="background:var(--team)"></i>Sent to your review team</span></div></div>
      ${infoBlock()}
      <div class="btns"><button class="primary" id="go" ${fixed || round === 2 ? "" : "disabled"}>${fixed ? "Continue" : "Confirm threshold"}</button></div>
      ${fixed || round === 2 ? "" : `<p class="muted small">Move the slider to set your threshold.</p>`}`, round === 1 ? 5 : 9);
    const sa = app.querySelector("#sa"), sb = app.querySelector("#sb");
    const upd = (t) => {
      const a = autoShare(queue, t), na = Math.round(a * queue.length);
      sa.style.width = a * 100 + "%"; sb.style.width = (1 - a) * 100 + "%";
      sa.textContent = a > 0.12 ? `${na} auto` : ""; sb.textContent = 1 - a > 0.12 ? `${queue.length - na} to team` : "";
    };
    upd(start);
    const s = app.querySelector("#s"); let moves = 0;
    if (s) s.addEventListener("input", () => { app.querySelector("#v").textContent = fmt2(s.value); upd(Number(s.value)); app.querySelector("#go").disabled = false; moves++; });
    const shown = Date.now();
    await wait("#go");
    const t = s ? Number(s.value) : start;
    log("threshold", { round, value: t, fixed, n_moves: moves, rt_ms: Date.now() - shown });
    return t;
  }

  function statTiles(o) {
    return `<div class="stats">
      <div class="stat"><div class="k">Decided by the model</div><div class="v">${o.n_auto}</div><div class="s${o.auto_wrong ? " bad" : ""}">${o.auto_wrong} wrong</div></div>
      <div class="stat"><div class="k">Sent to review team</div><div class="v">${o.n_team}</div><div class="s">${o.team_wrong} wrong · ${o.n_team * C.TEAM_COST} pts cost</div></div>
      <div class="stat"><div class="k">Round points</div><div class="v">${o.points}</div><div class="s">of ${C.ROUND_START}</div></div></div>`;
  }

  async function round1() {
    const t = await threshold(1);
    screen(`<h1>Round 1</h1><p>Screening 200 reviews with threshold ${fmt2(t)}…</p><div class="spinner"></div>`, 6);
    await sleep(1600);
    D.round1 = outcome(S.queue1, t);
    log("round1_result", D.round1);
    checkpoint("round1_done");
    await next(`<h1>Round 1 results</h1>${statTiles(D.round1)}
      <div class="card"><b>Spot check</b><p style="margin:6px 0 0">We checked <b>${S.auditN}</b> of the reviews the model decided automatically with confidence <b>0.95 or higher</b>.
      <b>${S.auditWrong} of them were AI-generated fake reviews that the model published as real.</b> Three of them:</p></div>
      ${S.auditShow.map((e) => reviewCard(e, true)).join("")}`, 6);
  }

  async function responsibility() {
    const parties = [["me", "You, the manager who runs the screening system"], ["model", "The decision model"],
                     ["vendor", "The company that sells the decision model"], ["designers", "The website's system designers, who set up the screening workflow"]];
    const cols = { me: "#2a78d6", model: "#eb6834", vendor: "#eda100", designers: "#1baf7a" };
    screen(`<h1>Who is responsible?</h1><p class="lead">Fake reviews were published on the website in round 1. How responsible is each party? Divide <b>100 points</b>.</p>
      <div class="card"><div class="alloc">${parties.map(([k, l]) => `<label for="${k}"><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${cols[k]};margin-right:8px"></i>${l}</label><input type="number" id="${k}" min="0" max="100" step="1" value="0" inputmode="numeric">`).join("")}
      <b>Total</b><b id="sum" style="text-align:right">0</b></div>
      <div class="sumbar">${parties.map(([k]) => `<span id="b_${k}" style="background:${cols[k]};width:0"></span>`).join("")}</div></div>
      <div class="btns"><button class="primary" id="go" disabled>Continue</button></div><p class="muted small" id="hint">The total must be exactly 100.</p>`, 8);
    const inputs = parties.map(([k]) => app.querySelector("#" + k)), go = app.querySelector("#go"), sum = app.querySelector("#sum");
    const upd = () => {
      const vals = inputs.map((i) => Math.max(0, Number(i.value) || 0)), t = vals.reduce((a, b) => a + b, 0);
      sum.textContent = t; sum.style.color = t === 100 ? "var(--team)" : "var(--bad)";
      parties.forEach(([k], i) => { app.querySelector("#b_" + k).style.width = (t ? Math.min(100, vals[i]) : 0) + "%"; });
      go.disabled = t !== 100;
    };
    inputs.forEach((i) => i.addEventListener("input", upd));
    await wait("#go");
    D.responsibility = Object.fromEntries(parties.map(([k], i) => [k, Number(inputs[i].value)]));
    log("responsibility", D.responsibility);
  }

  async function round2() {
    const t = await threshold(2);
    D.round2 = outcome(S.queue2, t);
    log("round2_result", D.round2);
    checkpoint("round2_done");
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
      ["just1", "After seeing the fake reviews, I wanted to show that my earlier threshold was reasonable."],
      ["attn2", "To show you are reading, please select “Strongly disagree” for this statement."],
      ["just2", "I prefer to stick with a decision I have made rather than change it."],
    ];
    screen(`<h1>A few questions</h1><div class="card">${items.map(([k, t]) => likert(k, t)).join("")}</div>
      <div class="card"><p class="q" style="margin-top:0">How did you choose your thresholds?</p><textarea id="how"></textarea>
      <p class="q">How often do you use AI tools such as chatbots?</p>
      <select id="aiuse"><option value="">Select…</option><option>Never</option><option>Less than monthly</option><option>Monthly</option><option>Weekly</option><option>Daily</option></select>
      <div class="grid2"><div><p class="q">Age</p><input type="number" id="age" min="18" max="100"></div>
      <div><p class="q">Gender</p><select id="gender"><option value="">Select…</option><option>Woman</option><option>Man</option><option>Non-binary</option><option>Prefer not to say</option><option>Other</option></select></div></div></div>
      <div class="btns"><button class="primary" id="go">Submit</button></div><p id="msg" class="err"></p>`, 10);
    for (;;) {
      await wait("#go");
      const ans = Object.fromEntries(items.map(([k]) => [k, Number((app.querySelector(`input[name=${k}]:checked`) || {}).value || 0)]));
      if (Object.values(ans).some((v) => !v)) { app.querySelector("#msg").textContent = "Please answer all statements."; continue; }
      D.survey = { ...ans, how: app.querySelector("#how").value.slice(0, 2000), ai_use: app.querySelector("#aiuse").value,
                   age: Number(app.querySelector("#age").value) || null, gender: app.querySelector("#gender").value };
      D.attention_passed = ans.attn2 === 1;
      log("survey", D.survey);
      break;
    }
  }

  async function finish() {
    const total = D.round1.points + D.round2.points;
    D.total_points = total;
    D.bonus_usd = Math.round(total * C.POINT_VALUE_USD * 100) / 100;
    D.finished_at = new Date().toISOString();
    D.step = "finished";
    D.duration_s = Math.round((Date.now() - t0) / 1000);
    screen(`<h1>Saving your responses…</h1><p>Please do not close this window.</p><div class="spinner"></div>`, 11);
    let saved = false;
    if (LIVE) saved = await enqueue({ kind: "participant", participant: participantRow() });
    const done = `https://app.prolific.com/submissions/complete?cc=${encodeURIComponent(C.PROLIFIC_COMPLETION_CODE)}`;
    const summary = `<h2>Round 2 results</h2>${statTiles(D.round2)}
      <div class="card"><b>Total: ${total} points</b> · bonus $${D.bonus_usd.toFixed(2)}, paid within a few days.</div>`;
    if (DEBUG) {
      const blob = new Blob([JSON.stringify(D, null, 1)], { type: "application/json" });
      screen(`<h1>Debug: finished</h1><p>Condition ${D.condition} (${D.owner}, evidence=${D.evidence}).</p>${summary}
        <p><a download="${D.prolific_pid}.json" href="${URL.createObjectURL(blob)}">Download data (JSON)</a></p>`, 11);
      window.__RESULT__ = D;
      return;
    }
    screen(`<h1>Thank you!</h1>${summary}
      ${saved || !LIVE ? `<p>Your responses were saved. ${C.PROLIFIC_COMPLETION_CODE ? "You will return to Prolific in a few seconds." : ""}</p><p><a href="${done}">Return to Prolific</a></p>`
              : `<p class="err">We could not save your responses automatically. Please click the link to return to Prolific and send us a message.</p><p><a href="${done}">Return to Prolific</a></p>`}`, 11);
    if (saved && C.PROLIFIC_COMPLETION_CODE) setTimeout(() => { location.href = done; }, 6000);
  }

  async function main() {
    try {
      await consent();
      const condP = assignCondition();
      const introP = intro();
      applyCondition(await condP);
      if (D.already_complete) { screen(`<h1>Already completed</h1><p>Our records show you have already completed this study. Thank you! Please return to Prolific.</p>`); return; }
      checkpoint("consented");
      await introP;
      await howItWorks();
      await belief("pre");
      await round1();
      await belief("post");
      await responsibility();
      await round2();
      await survey();
      await finish();
    } catch (e) {
      if (String(e.message) !== "no-consent") { log("error", { message: String(e), stack: String(e.stack) }); screen(`<h1>Something went wrong</h1><p>Please contact the researcher via Prolific.</p>`); }
    }
  }
  window.addEventListener("beforeunload", (e) => { if (!D.finished_at && D.events.length > 2) { e.preventDefault(); e.returnValue = ""; } });
  main();
})();
