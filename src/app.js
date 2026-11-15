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

// ---------- router ----------
window.addEventListener("hashchange", route);
function route() {
  const tb = document.getElementById("test"); if (tb) tb.style.display = wallet()?.test ? "block" : "none";
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
    <h1>Collect class dues by Lightning.<br>Everyone sees who paid.</h1>
    <p>No collector's notebook, no "I paid, check your alert." Each payment is checked with the payee's own wallet, and every naira spent can be shown with proof.</p>
    <a class="btn" href="#/new">Create a levy</a>
    <button class="btn ghost" id="demo">Try the demo (test sats)</button>
  </section>
  ${mine.length ? `<section><h2>Your levies</h2>${mine.map((m) => `<a class="row" href="#/l/${esc(m.code)}"><b>${esc(m.title)}</b><span>${m.rep ? "You're the rep" : "Member"}</span></a>`).join("")}</section>` : ""}
  <section class="how"><h2>How it works</h2><ol>
    <li>The class rep creates a levy: amount, due date, their Lightning address, the class list.</li>
    <li>They share one link on the class WhatsApp group.</li>
    <li>Each student picks their name and pays straight to the rep's wallet. The app posts a receipt to Nostr.</li>
    <li>Anyone with the link sees who paid, how much came in, and where it went.</li></ol></section>`;
  $("#demo").onclick = demo;
}

async function demo() {
  const b = $("#demo"); b.disabled = true; b.textContent = "Making test wallets…";
  try {
    const [payee, me] = [await D.faucetWallet(0), await D.faucetWallet(10000)];
    store.set("nwc", { url: me.nwc, label: "Demo test wallet (10,000 test sats)", test: true });
    const repSk = D.newKey(generateSecretKey);
    const l = { title: "Demo: LIS 400L class dues", amount: 500, due: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10), payee: payee.ln,
      roster: ["Bisi Adeyemi", "Tunde Okafor", "Aisha Bello", "Chidi Nwosu", "Kemi Alade"], sk: D.newKey(generateSecretKey), rep: D.repPubkeyOf(repSk) };
    const code = D.encodeLevy(l);
    store.set("rep:" + D.levyTag(l), repSk);
    remember(code, l.title, true);
    location.hash = "/l/" + code;
    toast("Demo ready. You're the rep and have 10,000 test sats.");
  } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = "Try the demo (test sats)"; }
}
function remember(code, title, rep) {
  const mine = store.get("mine", []).filter((m) => m.code !== code);
  mine.unshift({ code, title, rep: !!rep }); store.set("mine", mine.slice(0, 20));
}

// ---------- create ----------
function createForm() {
  app.innerHTML = `<section><h2>New levy</h2>
  <form id="f">
    <label>What is it for?<input name="title" required maxlength="80" placeholder="e.g. 400L departmental dues 2026/27"></label>
    <label>Amount per student (sats)<input name="amount" type="number" min="1" max="1000000" required value="1000"><small id="ngn"></small></label>
    <label>Due date<input name="due" type="date" required></label>
    <label>Your Lightning address (where money goes)<input name="payee" required placeholder="you@getalby.com" autocomplete="off"><small>Must support payment checks (LUD-21). Alby addresses do. No wallet yet? <a href="#" id="testaddr">Use a test address</a> (fake sats).</small></label>
    <label>Class list, one name per line<textarea name="roster" rows="7" placeholder="Bisi Adeyemi&#10;Tunde Okafor"></textarea><small>Names only. Don't add phone numbers or matric numbers: the paid list is public to anyone with the link.</small></label>
    <button class="btn">Create and get link</button>
  </form></section>`;
  const f = $("#f"), ngn = $("#ngn");
  const upd = async () => { const v = await nairaOf(+f.amount.value || 0); ngn.textContent = v ? `≈ ₦${fmt(v)} at today's rate` : ""; };
  f.amount.oninput = upd; upd();
  $("#testaddr").onclick = async (ev) => {
    ev.preventDefault(); const a = ev.target; a.textContent = "Making a test wallet…";
    try {
      const [payee, me] = [await D.faucetWallet(0), await D.faucetWallet(10000)];
      f.payee.value = payee.ln;
      store.set("nwc", { url: me.nwc, label: "Test wallet (10,000 test sats)", test: true }); document.getElementById("test").style.display = "block";
      toast("Test address filled in. You also got a test wallet with 10,000 fake sats to pay with.");
    } catch (e) { toast(e.message, true); }
    a.textContent = "Use a test address";
  };
  f.due.value = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const repSk = D.newKey(generateSecretKey);
    const l = { title: f.title.value, amount: +f.amount.value, due: f.due.value, payee: f.payee.value.trim().toLowerCase(),
      roster: f.roster.value.split("\n").map((s) => s.trim()).filter(Boolean), sk: D.newKey(generateSecretKey), rep: D.repPubkeyOf(repSk) };
    let code;
    try { code = D.encodeLevy(l); } catch (e) { return toast(e.message, true); }
    try { await D.requestInvoice(l.payee, l.amount, "OpenLevy address check"); }
    catch (e) { return toast("Payee address problem: " + e.message, true); }
    store.set("rep:" + D.levyTag(l), repSk);
    remember(code, l.title, true);
    location.hash = "/l/" + code;
    setTimeout(() => repBackup(l, code), 300);
  };
}

function repBackup(l, code) {
  const sk = store.get("rep:" + D.levyTag(l));
  modal(`<h3>Save your rep code</h3><p>This code lets you post spending on this levy. It stays on this phone only. Keep a copy somewhere safe, and don't share it.</p>
    <textarea readonly rows="3">${esc(sk)}</textarea><button class="btn" data-copy="${esc(sk)}">Copy rep code</button>`);
}

// ---------- board ----------
let live = null;
async function board(code) {
  let l;
  try { l = D.decodeLevy(code); } catch (e) { app.innerHTML = `<section><h2>Link problem</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Home</a></section>`; return; }
  const tag = D.levyTag(l);
  const repSk = store.get("rep:" + tag);
  if (!store.get("mine", []).some((m) => m.code === code)) remember(code, l.title, !!repSk);
  const me = store.get("me:" + tag, "");
  const ngn = await nairaOf(l.amount);
  app.innerHTML = `
  <section class="levy">
    <p class="kicker">${repSk ? "You're the rep" : "Levy"} · due ${esc(l.due)}</p>
    <h1>${esc(l.title)}</h1>
    <p class="amt">${fmt(l.amount)} sats${ngn ? ` <span>≈ ₦${fmt(ngn)}</span>` : ""}</p>
    <p class="muted">Pays to ${esc(l.payee)}</p>
    <div class="share"><button class="btn small" data-copy="${esc(linkFor(code))}">Copy link</button>
    <a class="btn small ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Pay ${l.title} (${fmt(l.amount)} sats) here: ${linkFor(code)}`)}">Share on WhatsApp</a></div>
  </section>
  <section class="stats" id="stats"><div><b>…</b><span>paid</span></div><div><b>…</b><span>collected</span></div><div><b>…</b><span>spent</span></div><div><b>…</b><span>balance</span></div></section>
  <section id="pay"><h2>Pay your dues</h2>
    <label>Your name<select id="who"><option value="">Choose your name</option>${l.roster.map((n) => `<option ${n === me ? "selected" : ""}>${esc(n)}</option>`).join("")}<option value="__other">My name isn't listed</option></select></label>
    <input id="other" class="hide" maxlength="40" placeholder="Type your full name">
    <button class="btn" id="getinv">Get payment code</button>
    <div id="inv"></div>
  </section>
  <section><h2>Who has paid</h2><div id="people" class="people"><p class="muted">Checking payments…</p></div></section>
  <section><h2>Where the money went</h2><div id="spends"><p class="muted">Loading…</p></div></section>
  ${repSk ? repTools() : `<section class="muted small">Are you the rep on a new phone? <a href="#" id="importrep">Enter your rep code</a></section>`}
  <section class="muted small">Receipts live on public Nostr relays. Each one is re-checked with the payee's wallet provider and the payment's preimage before it counts.</section>`;

  const who = $("#who"), other = $("#other");
  who.onchange = () => other.classList.toggle("hide", who.value !== "__other");
  $("#getinv").onclick = () => startPay(l, who.value === "__other" ? other.value.trim() : who.value);
  if (repSk) wireRep(l, repSk); else $("#importrep").onclick = (e) => { e.preventDefault(); importRep(l, code); };
  resumePending(l);
  await refresh(l);
  if (live) live.close();
  live = pool.subscribeMany(D.DEFAULT_RELAYS, { kinds: [D.KIND], "#t": [tag], since: Math.floor(Date.now() / 1000) }, { onevent: () => setTimeout(() => refresh(l), 800) });
}

async function fetchEvents(l) {
  return pool.querySync(D.DEFAULT_RELAYS, { kinds: [D.KIND], "#t": [D.levyTag(l)], limit: 1000 }, { maxWait: 4000 });
}
async function refresh(l) {
  let b;
  try { b = await D.buildBoard(l, await fetchEvents(l)); } catch (e) { return toast("Couldn't load receipts: " + e.message, true); }
  if (!$("#stats")) return;
  const total = l.roster.length || b.paidCount;
  $("#stats").innerHTML = `<div><b>${b.paidCount}/${total}</b><span>paid</span></div><div><b>${fmt(b.collected)}</b><span>sats in</span></div><div><b>${fmt(b.out)}</b><span>sats spent</span></div><div><b>${fmt(b.balance)}</b><span>sats left</span></div>`;
  $("#people").innerHTML = b.people.length ? b.people.map((p) => `<div class="person ${p.state}"><span>${esc(p.name)}${p.extra ? " <i>(not on list)</i>" : ""}</span><em>${p.state === "paid" ? "✓ Paid" : p.state === "pending" ? "Waiting" : "Not yet"}</em></div>`).join("") : `<p class="muted">No class list. Paid names will show here.</p>`;
  $("#spends").innerHTML = b.spent.length ? b.spent.map((s) => `<div class="spend"><div><b>${esc(s.note)}</b><small>${new Date(s.at * 1000).toLocaleDateString("en-NG")}</small></div><div><b>${fmt(s.sats)} sats</b><span class="badge ${s.proof}">${s.proof === "proven" ? "⚡ Proven" : s.proof === "claimed" ? "Claimed, no proof" : "Proof doesn't match"}</span></div></div>`).join("") : `<p class="muted">Nothing spent yet.</p>`;
}

// ---------- paying ----------
async function startPay(l, name) {
  if (!name) return toast("Choose your name first", true);
  store.set("me:" + D.levyTag(l), name);
  const box = $("#inv"); box.innerHTML = `<p class="muted">Getting a payment code from ${esc(l.payee)}…</p>`;
  let inv;
  try { inv = await D.requestInvoice(l.payee, l.amount, `${l.title}: ${name}`); } catch (e) { box.innerHTML = ""; return toast(e.message, true); }
  store.set("pending:" + D.levyTag(l), { name, ...inv, at: Date.now() });
  const qr = await QRCode.toDataURL("lightning:" + inv.pr, { margin: 1, width: 240 });
  const w = wallet();
  box.innerHTML = `<div class="invoice"><img src="${qr}" alt="Lightning payment QR code"><p class="muted">Scan with any Lightning wallet, or:</p>
    <a class="btn" href="lightning:${inv.pr}">Open my wallet app</a>
    <button class="btn ghost" data-copy="${inv.pr}">Copy payment code</button>
    ${w ? `<button class="btn ghost" id="nwcpay">Pay with connected wallet${w.test ? " (test)" : ""}</button>` : `<a class="muted small" href="#/wallet">Connect a wallet for one-tap pay</a>`}
    <p id="pstate" class="muted">Waiting for payment…</p></div>`;
  if (w) $("#nwcpay").onclick = async () => {
    const b = $("#nwcpay"); b.disabled = true; b.textContent = "Paying…";
    const c = new NWCClient({ nostrWalletConnectUrl: w.url });
    try { await c.payInvoice({ invoice: inv.pr }); } catch (e) { toast("Wallet said: " + (e.message || e), true); b.disabled = false; b.textContent = "Pay with connected wallet"; } finally { c.close(); }
  };
  watchPayment(l, store.get("pending:" + D.levyTag(l)));
}

async function watchPayment(l, p) {
  const tag = D.levyTag(l);
  for (let i = 0; i < 100; i++) {
    const r = await D.checkReceipt(l, p);
    if (r.ok) {
      const ev = finalizeEvent(D.receiptTemplate(l, p.name, p.pr, p.verify), hexToBytes(l.sk));
      try { await Promise.any(pool.publish(D.DEFAULT_RELAYS, ev)); } catch { toast("Paid, but couldn't post the receipt. Reopen the link to retry.", true); return; }
      store.del("pending:" + tag);
      $("#nwcpay")?.remove();
      const ps = $("#pstate"); if (ps) ps.innerHTML = `<b class="ok">✓ Paid and recorded. Thank you, ${esc(p.name)}.</b>`;
      toast("Payment confirmed");
      return refresh(l);
    }
    if (!r.pending && !r.retry) { toast("Payment check failed: " + r.why, true); store.del("pending:" + tag); return; }
    await new Promise((res) => setTimeout(res, 3000));
    if (!document.body.contains($("#pay"))) return; // left the page; resumes on next visit
  }
}
function resumePending(l) {
  const p = store.get("pending:" + D.levyTag(l));
  if (p && Date.now() - p.at < 24 * 3600e3) watchPayment(l, p);
}

// ---------- rep tools ----------
function repTools() {
  return `<section class="rep"><h2>Rep tools</h2>
    <p class="muted small">Post what you spend. If you pay the vendor by Lightning, paste their invoice and the app proves the payment.</p>
    <form id="sf">
      <label>What for<input name="note" required maxlength="120" placeholder="e.g. Printing exam handouts"></label>
      <label>Amount (sats)<input name="sats" type="number" min="1" required></label>
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
    const sats = +f.sats.value; let pr = f.pr.value.trim() || null; let preimage = f.preimage.value.trim() || null;
    if (f.pay.checked) {
      const w = wallet(); if (!w) return toast("Connect a wallet first", true);
      if (!pr) return toast("Paste the vendor's invoice to pay it", true);
      const c = new NWCClient({ nostrWalletConnectUrl: w.url });
      try { preimage = (await c.payInvoice({ invoice: pr })).preimage; } catch (e) { return toast("Payment failed: " + (e.message || e), true); } finally { c.close(); }
    }
    const t = D.spendTemplate(l, { note: f.note.value, sats, pr, preimage });
    const chk = D.checkSpend(JSON.parse(t.content));
    if (chk.proof === "mismatch") return toast("Proof problem: " + chk.why, true);
    try { await Promise.any(pool.publish(D.DEFAULT_RELAYS, finalizeEvent(t, hexToBytes(repSk)))); } catch { return toast("Couldn't post. Check your data and retry.", true); }
    f.reset(); toast(chk.proof === "proven" ? "Posted with proof ⚡" : "Posted (no proof attached)"); setTimeout(() => refresh(l), 1200);
  };
  $("#csv").onclick = async () => {
    const b = await D.buildBoard(l, await fetchEvents(l));
    const rows = [["name", "status", "paid_at"], ...b.people.map((p) => [p.name, p.state, p.at ? new Date(p.at * 1000).toISOString() : ""])];
    const blob = new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
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
  app.innerHTML = `<section><h2>Your wallet</h2>
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
function modal(html) { closeModal(); const m = document.createElement("div"); m.id = "modal"; m.innerHTML = `<div class="sheet">${html}<button class="btn ghost" id="mclose">Close</button></div>`; document.body.append(m); $("#mclose").onclick = closeModal; }
function closeModal() { $("#modal")?.remove(); }
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-copy]"); if (!t) return;
  try { await navigator.clipboard.writeText(t.dataset.copy); toast("Copied"); } catch { toast("Couldn't copy. Long-press to copy instead.", true); }
});
route();
