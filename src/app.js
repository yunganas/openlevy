// OpenLevy web app. Static, no server, no account. Works on low-end phones.
import QRCode from "qrcode";
import { NWCClient } from "@getalby/sdk";
import { getFiatValue } from "@getalby/lightning-tools";
import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { hexToBytes } from "nostr-tools/utils";
import * as D from "./core.js";

const $ = (s) => document.querySelector(s);
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n).toLocaleString("en-NG");
const store = {
  get: (k, d = null) => { try { return JSON.parse(localStorage.getItem("ol:" + k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem("ol:" + k, JSON.stringify(v)),
  del: (k) => localStorage.removeItem("ol:" + k),
};
const pool = new SimplePool();
let naira = null; // naira per sat, fetched once
async function nairaOf(sats) {
  try { if (naira === null) naira = (await getFiatValue({ satoshi: 100000, currency: "ngn" })) / 100000; } catch { naira = 0; }
  return naira ? Math.round(sats * naira) : null;
}
function toast(msg, bad) { const t = $("#toast"); t.textContent = msg; t.className = bad ? "show bad" : "show"; clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ""), bad ? 7000 : 3500); }
const linkFor = (code) => `${location.origin}${location.pathname}#/l/${code}`;
const wallet = () => store.get("nwc");

// ---------- mode banner ----------
const BANNER = { demo: "🧪 DEMO: simulated payments with fake sats. No funds move.", testnet: "🛰️ TESTNET: real Lightning on Bitcoin signet. Test coins have no value.", live: "" };
function banner(mode) {
  const tb = document.getElementById("test"); if (!tb) return;
  tb.textContent = BANNER[mode] || ""; tb.className = mode || ""; tb.style.display = BANNER[mode] ? "block" : "none";
}
const chip = (mode) => `<span class="mode ${mode}" title="${mode === "testnet" ? "Bitcoin signet test network" : mode === "demo" ? "Simulated, no funds move" : "Real bitcoin"}">${D.MODE_LABEL[mode]}</span>`;

// ---------- router ----------
window.addEventListener("hashchange", route);
function route() {
  banner(wallet()?.test ? "demo" : null);
  const h = location.hash.slice(1) || "/";
  if (h.startsWith("/l/")) return board(h.slice(3));
  if (h === "/new") return createForm();
  if (h === "/wallet") return walletPage();
  return home();
}

// ---------- home ----------
function home() {
  const mine = store.get("mine", []);
  app.innerHTML = `
  <section class="hero">
    <span class="pill">⚡ Bitcoin Lightning · Nostr</span>
    <h1>Class dues, <em>out in the open.</em></h1>
    <p>Collect levies in seconds. Everyone sees who paid, and every naira spent comes with proof. No more "I paid, check your alert."</p>
    <a class="btn" href="#/new">Create a levy</a>
    <div class="share"><button class="btn ghost" id="demo">▶ Demo (instant)</button><button class="btn ghost" id="tdemo">🛰️ Testnet levy</button></div>
    <p class="small heroNote">Demo simulates payments so you can click through in seconds. Testnet uses real Lightning invoices on Bitcoin signet, paid from a signet wallet.</p>
  </section>
  <section class="features">
    <div class="feat"><i>✅</i><b>Checked payments</b><p>Each payment is confirmed with the rep's wallet, not a screenshot.</p></div>
    <div class="feat"><i>👀</i><b>Public paid list</b><p>One link shows the whole class who has paid.</p></div>
    <div class="feat"><i>🧾</i><b>Provable spending</b><p>Reps attach Lightning proof to every expense.</p></div>
    <div class="feat"><i>🔓</i><b>No middleman</b><p>Money goes straight to the rep. OpenLevy never holds it.</p></div>
  </section>
  ${mine.length ? `<section><h2>Your levies</h2>${mine.map((m) => `<a class="row" href="#/l/${esc(m.code)}"><span class="who">${avatar(m.title)}<b>${esc(m.title)}</b></span><span class="badge ${m.rep ? "proven" : "claimed"}">${m.rep ? "Rep" : "Member"}</span></a>`).join("")}</section>` : ""}
  <section><h2>How it works</h2><ol class="steps">
    <li><b>Rep creates a levy</b><span class="muted small">Amount, due date, Lightning address, class list.</span></li>
    <li><b>Share one link</b><span class="muted small">Drop it in the class WhatsApp group.</span></li>
    <li><b>Students pay in seconds</b><span class="muted small">Pick your name, scan, done. Paid straight to the rep.</span></li>
    <li><b>Everyone can see it</b><span class="muted small">Who paid, what came in, where it went.</span></li></ol></section>
  <section><h2>Questions</h2>${faq()}</section>`;
  $("#demo").onclick = demo; $("#tdemo").onclick = testnetDemo;
}

async function demo() {
  const b = $("#demo"); b.disabled = true; b.textContent = "Making test wallets…";
  try {
    const [payee, me] = [await D.faucetWallet(0), await D.faucetWallet(10000)];
    store.set("nwc", { url: me.nwc, label: "Demo test wallet (10,000 test sats)", test: true });
    const repSk = D.newKey(generateSecretKey);
    const l = { title: "Demo: LIS 400L class dues", amount: 500, due: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10), payee: payee.ln,
      roster: ["Bisi Adeyemi", "Tunde Okafor", "Aisha Bello", "Chidi Nwosu", "Kemi Alade"], sk: D.newKey(generateSecretKey), rep: D.repPubkeyOf(repSk), mode: "demo", desc: "Demo class" };
    const code = D.encodeLevy(l);
    store.set("rep:" + D.levyTag(l), repSk);
    remember(code, l.title, true);
    location.hash = "/l/" + code;
    toast("Demo ready. You're the rep and have 10,000 test sats.");
  } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = "▶ Demo (instant)"; }
}
function testnetDemo() {
  const repSk = D.newKey(generateSecretKey);
  const l = { title: "Testnet: LIS 400L excursion levy", desc: "Signet test levy", amount: 210, due: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10), payee: "test@pay.staging.blink.sv",
    roster: ["Bisi Adeyemi", "Tunde Okafor", "Aisha Bello", "Chidi Nwosu", "Kemi Alade"], sk: D.newKey(generateSecretKey), rep: D.repPubkeyOf(repSk), mode: "testnet" };
  const code = D.encodeLevy(l);
  store.set("rep:" + D.levyTag(l), repSk); remember(code, l.title, true);
  location.hash = "/l/" + code;
  toast("Testnet levy ready. Pay it from any signet Lightning wallet.");
}
function faq() {
  const q = [
    ["Do I need a wallet to try it?", "No. Demo mode makes free test wallets for you. Testnet needs a signet wallet, such as Blink switched to its test server."],
    ["Does OpenLevy hold the money?", "Never. Students pay the rep's own Lightning address directly. OpenLevy has no server and no account."],
    ["How do you know a payment is real?", "The app asks the rep's wallet provider whether the invoice is paid (LUD-21), then checks the payment's preimage against the invoice. A screenshot or a typed claim never counts."],
    ["Can a payment be reversed?", "No. Bitcoin payments are final. If someone pays by mistake, the rep refunds them from their wallet and posts it as a spend so the class can see it."],
    ["Who can see the list?", "Anyone with the link. Use names only, never phone or matric numbers."],
    ["What if I spot a strange expense?", "Tap Question this on it. Your flag shows on the expense for the whole class."],
  ];
  return q.map(([a, b]) => `<details class="faq"><summary>${a}</summary><p class="muted small">${b}</p></details>`).join("");
}
function remember(code, title, rep) {
  const mine = store.get("mine", []).filter((m) => m.code !== code);
  mine.unshift({ code, title, rep: !!rep }); store.set("mine", mine.slice(0, 20));
}

// ---------- create ----------
function createForm() {
  banner(null);
  app.innerHTML = `<section class="levy"><p class="kicker">New levy</p><h1>Create a levy</h1><p class="muted small">Takes a minute. You'll get one link to share with your class.</p>
  <form id="f" novalidate>
    <fieldset class="modes"><legend>Mode</legend>
      <label class="radio"><input type="radio" name="mode" value="demo" checked><span><b>Demo</b><small>Simulated payments, fake sats. Instant.</small></span></label>
      <label class="radio"><input type="radio" name="mode" value="testnet"><span><b>Testnet</b><small>Real Lightning on Bitcoin signet. Test coins only.</small></span></label>
    </fieldset>
    <label>What is it for?<input name="title" required maxlength="80" placeholder="e.g. 400L departmental dues 2026/27"></label>
    <label>Class or department <span class="opt">(optional)</span><input name="desc" maxlength="80" placeholder="e.g. Library & Info Science, FUTA"></label>
    <div class="two">
      <label>Amount per student (sats)<input name="amount" type="number" inputmode="numeric" min="1" max="1000000" step="1" required value="1000"><small id="ngn"></small></label>
      <label>Due date<input name="due" type="date" required></label>
    </div>
    <label>Your Lightning address (where money goes)<input name="payee" required placeholder="you@getalby.com" autocomplete="off" inputmode="email"><small id="payhint"></small></label>
    <label>Class list, one name per line<textarea name="roster" rows="7" placeholder="Bisi Adeyemi&#10;Tunde Okafor"></textarea><small>Names only. Don't add phone numbers or matric numbers: the paid list is public to anyone with the link.</small></label>
    <div id="errs" class="errs" role="alert"></div>
    <div id="sum" class="summary"></div>
    <button class="btn" id="go">Create and get link →</button>
  </form></section>`;
  const f = $("#f"), ngn = $("#ngn");
  const mode = () => f.mode.value;
  const hint = () => {
    $("#payhint").innerHTML = mode() === "testnet"
      ? `Must be a <b>signet</b> address with payment checks (LUD-21), e.g. from Blink's test server. No wallet? <a href="#" id="testaddr">Use Blink's public test address</a>.`
      : `Demo uses free test wallets. <a href="#" id="testaddr">Use a test address</a> (fake sats).`;
    $("#testaddr").onclick = useTest;
    f.payee.placeholder = mode() === "testnet" ? "you@pay.staging.blink.sv" : "nwc…@getalby.com";
  };
  async function useTest(ev) {
    ev.preventDefault(); const a = ev.target;
    if (mode() === "testnet") { f.payee.value = "test@pay.staging.blink.sv"; toast("Blink's public signet test address filled in."); return check(); }
    a.textContent = "Making a test wallet…";
    try {
      const [payee, me] = [await D.faucetWallet(0), await D.faucetWallet(10000)];
      f.payee.value = payee.ln;
      store.set("nwc", { url: me.nwc, label: "Test wallet (10,000 test sats)", test: true }); banner("demo");
      toast("Test address filled in. You also got a test wallet with 10,000 fake sats to pay with.");
    } catch (e) { toast(e.message, true); }
    a.textContent = "Use a test address"; check();
  }
  const names = () => f.roster.value.split("\n").map((x) => x.trim()).filter(Boolean);
  function problems() {
    const e = [], amt = Number(f.amount.value);
    if (f.title.value.trim().length < 3) e.push("Give the levy a title (at least 3 characters).");
    if (!Number.isInteger(amt) || amt < 1 || amt > 1000000) e.push("Amount must be a whole number from 1 to 1,000,000 sats.");
    if (!f.due.value) e.push("Pick a due date.");
    if (f.payee.value.trim() && !/^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(f.payee.value.trim())) e.push("Lightning address should look like name@wallet.com.");
    const seen = new Map();
    for (const n of names()) { const k = n.toLowerCase(); seen.set(k, (seen.get(k) || 0) + 1); }
    const dup = [...seen].filter(([, c]) => c > 1).map(([k]) => k);
    if (dup.length) e.push(`Listed twice: ${dup.map(esc).join(", ")}. Add an initial to tell them apart.`);
    if (names().some((n) => n.length > 40)) e.push("Keep each name under 40 characters.");
    if (names().length > 300) e.push("At most 300 names per levy.");
    return e;
  }
  async function check() {
    const e = problems(), n = names().length, amt = Number(f.amount.value) || 0;
    $("#errs").innerHTML = e.length ? `<ul>${e.map((x) => `<li>${x}</li>`).join("")}</ul>` : "";
    $("#sum").innerHTML = `<div><b>${fmt(n)}</b><span>students</span></div><div><b>${fmt(amt)}</b><span>sats each</span></div><div><b>${fmt(n * amt)}</b><span>sats expected</span></div>`;
    if (mode() === "testnet") ngn.textContent = "Test sats have no value.";
    else nairaOf(amt).then((v) => { ngn.textContent = v ? `≈ ₦${fmt(v)} if these were real sats (estimate)` : ""; });
    return e;
  }
  f.oninput = check; f.onchange = (ev) => { if (ev.target.name === "mode") { hint(); f.payee.value = ""; f.amount.value = mode() === "testnet" ? 210 : 1000; } check(); };
  f.due.value = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  hint(); check();
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const e = await check(); if (e.length) return toast(e[0], true);
    if (!f.payee.value.trim()) return toast("Add the Lightning address where money should go.", true);
    if (!names().length) return toast("Add at least one name to the class list.", true);
    const repSk = D.newKey(generateSecretKey);
    const l = { title: f.title.value.trim(), desc: f.desc.value.trim() || undefined, amount: Number(f.amount.value), due: f.due.value, payee: f.payee.value.trim().toLowerCase(),
      roster: names(), sk: D.newKey(generateSecretKey), rep: D.repPubkeyOf(repSk), mode: mode() };
    let code;
    try { code = D.encodeLevy(l); } catch (er) { return toast(er.message, true); }
    const b = $("#go"); b.disabled = true; b.textContent = "Checking the address…";
    try { await D.requestInvoice(l.payee, l.amount, "OpenLevy address check", fetch, l.mode); }
    catch (er) { b.disabled = false; b.textContent = "Create and get link →"; return toast("Payee address problem: " + er.message, true); }
    store.set("rep:" + D.levyTag(l), repSk);
    remember(code, l.title, true);
    location.hash = "/l/" + code;
    setTimeout(() => repBackup(l, code), 300);
  };
}

function repBackup(l, code) {
  const sk = store.get("rep:" + D.levyTag(l));
  modal(`<h3>Save your rep code</h3><p>This code lets you post spending on this levy. It stays on this phone only. Keep a copy somewhere safe, and don't share it.</p>
    <code class="key">${esc(sk)}</code><button class="btn" data-copy="${esc(sk)}">Copy rep code</button>`);
}

// ---------- board ----------
let live = null, view = { filter: "all", q: "" }, lastBoard = null;
async function board(code) {
  let l;
  try { l = D.decodeLevy(code); } catch (e) { app.innerHTML = `<section><h2>Link problem</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Home</a></section>`; return; }
  const tag = D.levyTag(l), mode = D.modeOf(l);
  banner(mode);
  const repSk = store.get("rep:" + tag);
  if (!store.get("mine", []).some((m) => m.code === code)) remember(code, l.title, !!repSk);
  const me = store.get("me:" + tag, "");
  const ngn = mode === "live" ? await nairaOf(l.amount) : null;
  view = { filter: "all", q: "" };
  app.innerHTML = `
  <section class="levy">
    <p class="kicker">${chip(mode)} ${repSk ? "You're the rep" : "Levy"} · due ${esc(l.due)}</p>
    <h1>${esc(l.title)}</h1>${l.desc ? `<p class="muted small desc">${esc(l.desc)}</p>` : ""}
    <p class="amt">${fmt(l.amount)} sats${ngn ? ` <span>≈ ₦${fmt(ngn)} (estimate)</span>` : mode !== "live" ? ` <span>${mode === "testnet" ? "test sats, no value" : "fake sats"}</span>` : ""}</p>
    <span class="payee">⚡ ${esc(l.payee)}</span>
    <div class="share"><button class="btn small" data-copy="${esc(linkFor(code))}">Copy link</button>
    <a class="btn small ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Pay ${l.title} (${fmt(l.amount)} sats${mode !== "live" ? ", " + D.MODE_LABEL[mode] : ""}) here: ${linkFor(code)}`)}">Share on WhatsApp</a></div>
  </section>
  <section class="stats" id="stats" aria-live="polite"><p class="muted">Checking payments…</p></section>
  <section id="pay"><h2>💸 Pay your dues</h2>
    <label>Your name<select id="who"><option value="">Choose your name</option>${l.roster.map((n) => `<option ${n === me ? "selected" : ""}>${esc(n)}</option>`).join("")}<option value="__other">My name isn't listed</option></select></label>
    <input id="other" class="hide" maxlength="40" placeholder="Type your full name" aria-label="Your full name">
    <div id="due" class="dueBox hide"></div>
    <button class="btn" id="getinv">Get payment code</button>
    <div id="inv"></div>
    <p class="muted small">${mode === "testnet" ? "Pay with a signet Lightning wallet (for example Blink switched to its test server). Mainnet wallets can't pay testnet invoices." : mode === "demo" ? "Demo payments use fake sats from a test wallet. Nothing real moves." : "Bitcoin payments are final. Check the name and amount before you pay."}</p>
  </section>
  <section><div class="head"><h2>👥 Who has paid</h2><button class="iconbtn" id="reload" aria-label="Refresh">↻</button></div>
    <div class="filters" role="tablist"><button data-f="all" class="on">All</button><button data-f="paid">Paid</button><button data-f="unpaid">Not yet</button></div>
    <input id="q" type="search" placeholder="Search a name" aria-label="Search a name">
    <div id="people" class="people"><p class="muted">Checking payments…</p></div>
    <p class="muted tiny" id="updated"></p></section>
  <section><h2>🧾 Where the money went</h2><div id="spends"><p class="muted">Loading…</p></div></section>
  <section><h2>🕒 Activity</h2><div id="feed"><p class="muted">Loading…</p></div></section>
  ${repSk ? repTools() : `<section class="note">Are you the rep on a new phone? <a href="#" id="importrep">Enter your rep code</a></section>`}
  <section class="note">🔒 ${mode === "demo" ? "Demo receipts are simulated payments between test wallets. " : ""}Receipts live on public Nostr relays. Each one is re-checked with the payee's wallet provider and the payment's preimage before it counts. Only the rep's key can post spending.</section>`;

  const who = $("#who"), other = $("#other");
  const showDue = () => {
    const name = who.value === "__other" ? other.value.trim() : who.value;
    $("#due").classList.toggle("hide", !name);
    $("#due").innerHTML = name ? `<span>Paying for <b>${esc(name)}</b></span><b>${fmt(l.amount)} sats</b>` : "";
  };
  who.onchange = () => { other.classList.toggle("hide", who.value !== "__other"); showDue(); };
  other.oninput = showDue; showDue();
  $("#getinv").onclick = () => startPay(l, who.value === "__other" ? other.value.trim() : who.value);
  $("#reload").onclick = () => refresh(l, true);
  $("#q").oninput = (e) => { view.q = e.target.value.toLowerCase(); renderPeople(); };
  app.querySelectorAll(".filters button").forEach((b) => (b.onclick = () => { view.filter = b.dataset.f; app.querySelectorAll(".filters button").forEach((x) => x.classList.toggle("on", x === b)); renderPeople(); }));
  if (repSk) wireRep(l, repSk); else $("#importrep").onclick = (e) => { e.preventDefault(); importRep(l, code); };
  app.onclick = (e) => { const fb = e.target.closest("[data-flag]"); if (fb) flagSpend(l, fb.dataset.flag); };
  resumePending(l);
  await refresh(l);
  if (live) live.close();
  live = pool.subscribeMany(D.DEFAULT_RELAYS, { kinds: [D.KIND], "#t": [tag], since: Math.floor(Date.now() / 1000) }, { onevent: () => setTimeout(() => refresh(l), 800) });
}

async function fetchEvents(l) {
  return pool.querySync(D.DEFAULT_RELAYS, { kinds: [D.KIND], "#t": [D.levyTag(l)], limit: 1000 }, { maxWait: 4000 });
}
const when = (at) => new Date(at * 1000).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
function renderPeople() {
  const b = lastBoard; if (!b || !$("#people")) return;
  const list = b.people.filter((p) => (view.filter === "all" || (view.filter === "paid" ? p.state === "paid" : p.state !== "paid")) && (!view.q || p.name.toLowerCase().includes(view.q)));
  $("#people").innerHTML = !b.people.length ? `<div class="empty"><span>🙋</span>No class list. Paid names will show here.</div>`
    : !list.length ? `<div class="empty">No names match.</div>`
    : list.map((p) => `<div class="person ${p.state}"><span class="who">${avatar(p.name)}<span><span class="nm">${esc(p.name)}${p.extra ? ' <small class="muted">(not on list)</small>' : ""}</span>${p.state === "paid" ? `<small class="muted ref">${when(p.at)} · ref ${esc(p.ref)}</small>` : ""}</span></span><em>${p.state === "paid" ? "✓ Paid" : p.state === "pending" ? "⏳ Waiting" : "○ Not yet"}</em></div>`).join("");
}
async function refresh(l, manual) {
  let b;
  if (manual) { const r = $("#reload"); if (r) r.classList.add("spin"); }
  try { b = await D.buildBoard(l, await fetchEvents(l)); } catch (e) { return toast("Couldn't load receipts: " + e.message, true); }
  finally { $("#reload")?.classList.remove("spin"); }
  if (!$("#stats")) return;
  lastBoard = b;
  const total = l.roster.length || b.paidCount;
  const pct = total ? Math.round((100 * b.paidCount) / total) : 0;
  $("#stats").innerHTML = `<div class="statline"><span class="kicker">Progress</span><span><b>${b.paidCount}</b><span class="muted"> of ${total} paid · ${pct}%</span></span></div>
    <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><b style="width:0"></b></div>
    <div class="nums"><div><b>${fmt(b.collected)}</b><span>of ${fmt(b.expected)} sats</span></div><div><b>${fmt(b.out)}</b><span>sats spent</span></div><div><b>${fmt(b.balance)}</b><span>sats left</span></div></div>
    <p class="muted small center">${b.outstanding ? `${b.outstanding} still to pay` : "Everyone has paid 🎉"}</p>`;
  requestAnimationFrame(() => { const bar = $("#stats .progress b"); if (bar) bar.style.width = pct + "%"; });
  renderPeople();
  const label = { proven: "⚡ Verified payment", claimed: "Reported, no proof", mismatch: "⚠ Proof doesn't match" };
  $("#spends").innerHTML = b.spent.length ? b.spent.map((s) => `<div class="spend"><div><b>${esc(s.note)}</b><small>${esc(s.category || "Other")}${s.vendor ? " · " + esc(s.vendor) : ""} · ${when(s.at)}</small>
      ${s.flags.length ? `<small class="flagged">🚩 Questioned by ${s.flags.length}: ${s.flags.slice(0, 2).map((f) => esc(f.reason || "no reason")).join("; ")}</small>` : ""}
      <button class="linkbtn" data-flag="${esc(s.id)}">Question this</button></div>
      <div><b>${fmt(s.sats)} sats</b><span class="badge ${s.proof}">${label[s.proof]}</span></div></div>`).join("")
    : `<div class="empty"><span>🪙</span>Nothing spent yet. Every spend will show here.</div>`;
  $("#feed").innerHTML = b.activity.length ? b.activity.slice(0, 30).map((a) => `<div class="feed ${a.type}"><i>${a.type === "pay" ? "↓" : "↑"}</i><span><b>${esc(a.name)}</b> ${a.type === "pay" ? "paid" : "spent"}<small class="muted"> · ${when(a.at)}${a.ref ? " · ref " + esc(a.ref) : ""}</small></span><b class="${a.type === "pay" ? "ok" : ""}">${a.type === "pay" ? "+" : "−"}${fmt(a.sats)}</b></div>`).join("")
    : `<div class="empty">No activity yet.</div>`;
  $("#updated").textContent = "Last checked " + new Date().toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
}
function flagSpend(l, spendId) {
  modal(`<h3>Question this expense</h3><p class="muted small">Your flag is public on this levy. Be fair and specific.</p>
    <label>Your name<input id="fn" maxlength="40" value="${esc(store.get("me:" + D.levyTag(l), ""))}"></label>
    <label>What's the concern?<textarea id="fr" rows="3" maxlength="140" placeholder="e.g. Receipt doesn't match the amount"></textarea></label>
    <button class="btn" id="fok">Post flag</button>`);
  $("#fok").onclick = async () => {
    const name = $("#fn").value.trim(), reason = $("#fr").value.trim();
    if (!name || !reason) return toast("Add your name and the concern", true);
    try { await Promise.any(pool.publish(D.DEFAULT_RELAYS, finalizeEvent(D.flagTemplate(l, spendId, name, reason), hexToBytes(l.sk)))); }
    catch { return toast("Couldn't post. Check your data and retry.", true); }
    closeModal(); toast("Flag posted"); setTimeout(() => refresh(l), 1200);
  };
}

// ---------- paying ----------
let timer = null;
async function startPay(l, name) {
  if (!name) return toast("Choose your name first", true);
  const mode = D.modeOf(l);
  if (lastBoard?.people.some((p) => p.state === "paid" && p.name.toLowerCase() === name.toLowerCase())) {
    if (!confirm(`${name} already shows as paid. Pay again anyway? Extra payments only count once.`)) return;
  }
  store.set("me:" + D.levyTag(l), name);
  const box = $("#inv"); box.innerHTML = `<p class="status"><i class="dot"></i>Getting a payment code from ${esc(l.payee)}…</p>`;
  $("#getinv").disabled = true;
  let inv;
  try { inv = await D.requestInvoice(l.payee, l.amount, `${l.title}: ${name}`, fetch, mode); } catch (e) { box.innerHTML = ""; $("#getinv").disabled = false; return toast(e.message, true); }
  $("#getinv").disabled = false; $("#getinv").textContent = "Get a new code";
  const p = { name, ...inv, at: Date.now() };
  store.set("pending:" + D.levyTag(l), p);
  renderInvoice(l, p);
  watchPayment(l, p);
}
async function renderInvoice(l, p) {
  const box = $("#inv"); if (!box) return;
  const mode = D.modeOf(l), w = wallet();
  const canNwc = w && mode !== "testnet";
  const qr = await QRCode.toDataURL("lightning:" + p.pr, { margin: 1, width: 240 });
  box.innerHTML = `<div class="invoice"><p class="kicker">${chip(mode)} Invoice for ${esc(p.name)} · ${fmt(l.amount)} sats</p>
    <img src="${qr}" alt="Lightning payment QR code for ${fmt(l.amount)} sats"><p class="muted small">Scan with ${mode === "testnet" ? "a signet" : "any"} Lightning wallet, or:</p>
    <a class="btn dark" href="lightning:${p.pr}">Open my wallet app</a>
    <button class="btn ghost" data-copy="${p.pr}">Copy payment code</button>
    ${canNwc ? `<button class="btn ghost" id="nwcpay">Pay with connected wallet${w.test ? " (test)" : ""}</button>` : mode === "testnet" ? "" : `<a class="muted small" href="#/wallet">Connect a wallet for one-tap pay</a>`}
    <p id="pstate" class="status" aria-live="polite"><i class="dot"></i>Waiting for payment…</p><p class="muted tiny" id="exp"></p></div>`;
  clearInterval(timer);
  const tick = () => {
    const left = p.expiresAt - Date.now(), e = $("#exp"); if (!e) return clearInterval(timer);
    if (left <= 0) { clearInterval(timer); setState("expired"); return; }
    const m = Math.floor(left / 60000), h = Math.floor(m / 60);
    e.textContent = `Code expires in ${h ? h + "h " : ""}${m % 60}m`;
  };
  tick(); timer = setInterval(tick, 15000);
  if (canNwc) $("#nwcpay").onclick = async () => {
    const b = $("#nwcpay"); b.disabled = true; b.textContent = "Paying…";
    const c = new NWCClient({ nostrWalletConnectUrl: w.url });
    try { await c.payInvoice({ invoice: p.pr }); setState("verifying"); } catch (e) { toast("Wallet said: " + (e.message || e), true); b.disabled = false; b.textContent = "Pay with connected wallet"; } finally { c.close(); }
  };
}
function setState(st, extra) {
  const ps = $("#pstate"); if (!ps) return;
  const T = {
    waiting: `<i class="dot"></i>Waiting for payment…`,
    verifying: `<i class="dot blue"></i>Payment seen. Verifying with the wallet provider…`,
    expired: `⌛ This code expired. Tap <b>Get a new code</b>.`,
    failed: `⚠ ${esc(extra || "Payment check failed")}`,
    offline: `<i class="dot"></i>Can't reach the provider. Still watching, nothing is marked paid until it's verified.`,
  };
  ps.className = "status " + st; ps.innerHTML = T[st];
  if (st === "expired") $("#nwcpay")?.remove();
}

async function watchPayment(l, p) {
  const tag = D.levyTag(l);
  for (let i = 0; i < 400; i++) {
    if (Date.now() > p.expiresAt + 60000) { store.del("pending:" + tag); setState("expired"); return; }
    const r = await D.checkReceipt(l, p);
    if (r.ok) {
      setState("verifying");
      const ev = finalizeEvent(D.receiptTemplate(l, p.name, p.pr, p.verify), hexToBytes(l.sk));
      try { await Promise.any(pool.publish(D.DEFAULT_RELAYS, ev)); } catch { setState("offline"); toast("Paid, but couldn't post the receipt. Reopen the link to retry.", true); return; }
      store.del("pending:" + tag); clearInterval(timer);
      $("#nwcpay")?.remove(); $("#exp")?.remove();
      const ps = $("#pstate"); if (ps) ps.outerHTML = `<div class="done"><span>🎉</span>Paid and verified.<br>Thank you, ${esc(p.name)}!<small>ref ${esc(r.paymentHash.slice(0, 10))}</small></div>`;
      toast("Payment confirmed");
      return refresh(l);
    }
    if (r.retry) setState("offline");
    else if (!r.pending) { setState("failed", "Payment check failed: " + r.why); store.del("pending:" + tag); return; }
    else if ($("#pstate")?.classList.contains("offline")) setState("waiting");
    await new Promise((res) => setTimeout(res, 3000));
    if (!document.body.contains($("#pay"))) return; // left the page; resumes on next visit
  }
}
function resumePending(l) {
  const p = store.get("pending:" + D.levyTag(l));
  if (!p) return;
  if (!p.expiresAt || Date.now() > p.expiresAt) { store.del("pending:" + D.levyTag(l)); return; }
  renderInvoice(l, p).then(() => watchPayment(l, p));
}

// ---------- rep tools ----------
function repTools() {
  return `<section class="rep"><h2>🛠️ Rep tools</h2>
    <p class="muted small">Post what you spend. If you pay the vendor by Lightning, paste their invoice and the app proves the payment. Without proof, it shows as <b>Reported</b>.</p>
    <form id="sf">
      <label>What for<input name="note" required maxlength="120" placeholder="e.g. Printing exam handouts"></label>
      <div class="two"><label>Amount (sats)<input name="sats" type="number" inputmode="numeric" min="1" step="1" required></label>
      <label>Category<select name="category">${D.CATEGORIES.map((c) => `<option>${c}</option>`).join("")}</select></label></div>
      <label>Paid to (vendor) <span class="opt">(optional)</span><input name="vendor" maxlength="60" placeholder="e.g. Campus Print Hub"></label>
      <label>Vendor's Lightning invoice (optional)<textarea name="pr" rows="2" placeholder="lnbc…"></textarea></label>
      <label class="check"><input type="checkbox" name="pay"> Pay this invoice now from my connected wallet</label>
      <label>Or paste the payment preimage (optional)<input name="preimage" maxlength="64" placeholder="64 characters from your wallet"></label>
      <button class="btn">Post spending</button>
    </form>
    <button class="btn ghost small" id="csv">Download paid list (CSV)</button>
    <button class="btn ghost small" id="backup">Show rep code</button></section>`;
}
function wireRep(l, repSk) {
  const f = $("#sf");
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const sats = Number(f.sats.value); if (!Number.isInteger(sats) || sats < 1) return toast("Amount must be a whole number of sats", true);
    if (!f.note.value.trim()) return toast("Say what the money was for", true);
    let pr = f.pr.value.trim() || null; let preimage = f.preimage.value.trim() || null;
    if (f.pay.checked) {
      const w = wallet(); if (!w) return toast("Connect a wallet first", true);
      if (!pr) return toast("Paste the vendor's invoice to pay it", true);
      const c = new NWCClient({ nostrWalletConnectUrl: w.url });
      try { preimage = (await c.payInvoice({ invoice: pr })).preimage; } catch (e) { return toast("Payment failed: " + (e.message || e), true); } finally { c.close(); }
    }
    const t = D.spendTemplate(l, { note: f.note.value, sats, pr, preimage, category: f.category.value, vendor: f.vendor.value });
    const chk = D.checkSpend({ ...JSON.parse(t.content), mode: D.modeOf(l) });
    if (chk.proof === "mismatch") return toast("Proof problem: " + chk.why, true);
    try { await Promise.any(pool.publish(D.DEFAULT_RELAYS, finalizeEvent(t, hexToBytes(repSk)))); } catch { return toast("Couldn't post. Check your data and retry.", true); }
    f.reset(); toast(chk.proof === "proven" ? "Posted as a verified payment ⚡" : "Posted as reported (no proof)"); setTimeout(() => refresh(l), 1200);
  };
  $("#csv").onclick = async () => {
    const b = await D.buildBoard(l, await fetchEvents(l));
    if (!confirm("The CSV has every student's name and payment status. Only share it with your class. Download?")) return;
    const rows = [["name", "status", "paid_at", "reference", "mode"], ...b.people.map((p) => [p.name, p.state, p.at ? new Date(p.at * 1000).toISOString() : "", p.ref || "", D.modeOf(l)])];
    const blob = new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/^[=+\-@]/, "'$&").replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "paid-list.csv"; a.click();
  };
  $("#backup").onclick = () => repBackup(l);
}
function importRep(l, code) {
  modal(`<h3>Enter rep code</h3><input id="rc" maxlength="64" placeholder="64-character rep code"><button class="btn" id="rcok">Unlock rep tools</button>`);
  $("#rcok").onclick = () => {
    const v = $("#rc").value.trim().toLowerCase();
    try { if (D.repPubkeyOf(v) !== l.rep) throw 0; } catch { return toast("That code isn't this levy's rep code", true); }
    store.set("rep:" + D.levyTag(l), v); remember(code, l.title, true); closeModal(); board(code);
  };
}

// ---------- wallet ----------
function walletPage() {
  const w = wallet();
  app.innerHTML = `<section class="levy"><p class="kicker">One-tap pay</p><h1>Your wallet</h1>
    <p class="muted">Connect a Lightning wallet with Nostr Wallet Connect (NWC) for one-tap pay. The connection stays on this phone only and is never put in a link or sent to us. Give it a small spending budget.</p>
    ${w ? `<p><b>Connected:</b> ${esc(w.label)}</p><p id="bal" class="muted">Checking balance…</p><button class="btn ghost" id="rm">Disconnect</button>` :
    `<label>NWC connection<textarea id="nwc" rows="3" placeholder="nostr+walletconnect://…"></textarea></label><button class="btn" id="save">Connect</button>
     <button class="btn ghost" id="test">Get a test wallet (fake sats)</button>`}</section>`;
  if (w) {
    const c = new NWCClient({ nostrWalletConnectUrl: w.url });
    c.getBalance().then((b) => ($("#bal").textContent = `Balance: ${fmt(Math.floor(b.balance / 1000))} sats`)).catch(() => ($("#bal").textContent = "Couldn't read balance")).finally(() => c.close());
    $("#rm").onclick = () => { store.del("nwc"); walletPage(); };
  } else {
    $("#save").onclick = () => {
      const v = $("#nwc").value.trim();
      if (!v.startsWith("nostr+walletconnect://")) return toast("That isn't an NWC connection", true);
      store.set("nwc", { url: v, label: "My wallet" }); walletPage();
    };
    $("#test").onclick = async () => { try { const t = await D.faucetWallet(10000); store.set("nwc", { url: t.nwc, label: "Test wallet (10,000 test sats)", test: true }); walletPage(); } catch (e) { toast(e.message, true); } };
  }
}

// ---------- small helpers ----------
function avatar(name) {
  const n = String(name || "?").trim(); let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const ini = n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return `<i class="av" style="--c:hsl(${h % 360} 45% 42%)">${esc(ini)}</i>`;
}
function modal(html) { closeModal(); const m = document.createElement("div"); m.id = "modal"; m.innerHTML = `<div class="sheet">${html}<button class="btn ghost" id="mclose">Close</button></div>`; document.body.append(m); $("#mclose").onclick = closeModal; }
function closeModal() { $("#modal")?.remove(); }
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-copy]"); if (!t) return;
  try { await navigator.clipboard.writeText(t.dataset.copy); toast("Copied"); } catch { toast("Couldn't copy. Long-press to copy instead.", true); }
});
route();
