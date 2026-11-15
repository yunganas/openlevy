// OpenLevy core: pure logic shared by the web app and the tests.
// Trust model: nothing posted to Nostr is believed on its own. Every payment is
// re-checked with the payee's own Lightning provider (LUD-21) and its preimage.
import { Invoice } from "@getalby/lightning-tools";
import { getPublicKey } from "nostr-tools/pure";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";

export const KIND = 30078; // NIP-78 app data (addressable)
export const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const LN_ADDR = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

// ---------- levy link ----------
const b64u = {
  enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))),
};
export const MODES = ["demo", "testnet", "live"];
export const MODE_LABEL = { demo: "DEMO", testnet: "TESTNET", live: "LIVE" };
export const modeOf = (l) => l.mode || (/^nwc\d+@getalby\.com$/i.test(l.payee || "") ? "demo" : "live");
// Bitcoin network an invoice belongs to, from its BOLT11 prefix.
export function netOf(pr) {
  const p = String(pr || "").toLowerCase();
  if (p.startsWith("lnbcrt")) return "regtest";
  if (p.startsWith("lntbs")) return "signet";
  if (p.startsWith("lntb")) return "testnet";
  if (p.startsWith("lnbc")) return "mainnet";
  return "unknown";
}
export const netOk = (mode, pr) => (mode === "testnet" ? ["signet", "testnet"] : ["mainnet"]).includes(netOf(pr));
const clean = (s, n) => String(s ?? "").replace(/[<>]/g, "").trim().slice(0, n);

export function validateLevy(l) {
  const e = [];
  if (!l || typeof l !== "object") return ["Levy is empty"];
  if (clean(l.title, 80).length < 3) e.push("Title must be 3 to 80 characters");
  if (!Number.isInteger(l.amount) || l.amount < 1 || l.amount > 1_000_000) e.push("Amount must be 1 to 1,000,000 sats");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.due || "")) e.push("Due date must be YYYY-MM-DD");
  if (!LN_ADDR.test(l.payee || "")) e.push("Payee must be a Lightning address like name@wallet.com");
  if (!Array.isArray(l.roster) || l.roster.length > 300) e.push("Class list can have at most 300 names");
  else {
    const seen = new Set();
    l.roster.forEach((n, i) => {
      const k = clean(n, 40).toLowerCase();
      if (!k) e.push(`Name ${i + 1} is empty`);
      if (seen.has(k)) e.push(`"${n}" is listed twice`);
      seen.add(k);
    });
  }
  if (l.mode != null && !MODES.includes(l.mode)) e.push("Unknown mode");
  if (l.desc != null && String(l.desc).length > 80) e.push("Class label is too long");
  if (!/^[0-9a-f]{64}$/.test(l.sk || "")) e.push("Levy key missing");
  if (!/^[0-9a-f]{64}$/.test(l.rep || "")) e.push("Rep key missing");
  return e;
}

export function encodeLevy(l) {
  const e = validateLevy(l);
  if (e.length) throw new Error(e.join("; "));
  const { title, amount, due, payee, roster, sk, rep } = l;
  const o = { v: 1, title: clean(title, 80), amount, due, payee: payee.toLowerCase(), roster: roster.map((n) => clean(n, 40)), sk, rep, mode: modeOf(l) };
  if (l.desc) o.desc = clean(l.desc, 80);
  return b64u.enc(JSON.stringify(o));
}

export function decodeLevy(s) {
  let l;
  try { l = JSON.parse(b64u.dec(s)); } catch { throw new Error("This levy link is broken"); }
  if (l.v !== 1) throw new Error("Unknown link version");
  const e = validateLevy(l);
  if (e.length) throw new Error(e.join("; "));
  return l;
}

export const levyPubkey = (l) => getPublicKey(hexToBytes(l.sk));
export const levyTag = (l) => "openlevy-" + levyPubkey(l).slice(0, 16);
export const newKey = (rand) => bytesToHex(rand(32));
export const repPubkeyOf = (repSkHex) => getPublicKey(hexToBytes(repSkHex));

// ---------- payment receipts (posted by the payer's device, signed with the levy key) ----------
export function receiptTemplate(l, name, pr, verify) {
  const hash = new Invoice({ pr }).paymentHash;
  return {
    kind: KIND, created_at: Math.floor(Date.now() / 1000),
    tags: [["d", `${levyTag(l)}:pay:${hash}`], ["t", levyTag(l)], ["type", "pay"]],
    content: JSON.stringify({ name: clean(name, 40), pr, verify }),
  };
}

// ---------- spending entries (posted by the rep, signed with the rep's own key) ----------
// proof is optional: the vendor's Lightning invoice plus the preimage our wallet got
// back when paying it. A preimage that hashes to the invoice's payment hash proves it was paid.
export const CATEGORIES = ["Printing", "Transport", "Food", "Materials", "Venue", "Gift", "Other"];
export function spendTemplate(l, { note, sats, pr, preimage, category, vendor }) {
  const id = Math.random().toString(36).slice(2, 10);
  return {
    kind: KIND, created_at: Math.floor(Date.now() / 1000),
    tags: [["d", `${levyTag(l)}:spend:${id}`], ["t", levyTag(l)], ["type", "spend"]],
    content: JSON.stringify({ note: clean(note, 120), sats, pr: pr || null, preimage: preimage || null,
      category: CATEGORIES.includes(category) ? category : "Other", vendor: clean(vendor, 60) || null }),
  };
}

// ---------- flags: anyone with the link can question a spend (signed with the levy key) ----------
export function flagTemplate(l, spendId, name, reason) {
  return {
    kind: KIND, created_at: Math.floor(Date.now() / 1000),
    tags: [["d", `${levyTag(l)}:flag:${spendId}:${clean(name, 40).toLowerCase()}`], ["t", levyTag(l)], ["type", "flag"]],
    content: JSON.stringify({ spend: String(spendId).slice(0, 16), name: clean(name, 40), reason: clean(reason, 140) }),
  };
}

export async function checkReceipt(l, rc, fetchFn = fetch) {
  const domain = l.payee.split("@")[1];
  let u;
  try { u = new URL(rc.verify); } catch { return { ok: false, why: "bad verify link" }; }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== domain) return { ok: false, why: "verify link not on the payee's provider" };
  let inv;
  try { inv = new Invoice({ pr: rc.pr }); } catch { return { ok: false, why: "bad invoice" }; }
  if (inv.satoshi !== l.amount) return { ok: false, why: "wrong amount" };
  if (!netOk(modeOf(l), rc.pr)) return { ok: false, why: "wrong network" };
  let v;
  try { v = await fetchFn(rc.verify).then((r) => r.json()); } catch { return { ok: false, why: "provider unreachable", retry: true }; }
  if (v.status !== "OK") return { ok: false, why: "provider error", retry: true };
  if (v.pr && v.pr !== rc.pr) return { ok: false, why: "invoice mismatch" };
  if (!v.settled) return { ok: false, why: "not paid yet", pending: true };
  if (!v.preimage || !inv.validatePreimage(v.preimage)) return { ok: false, why: "preimage check failed" };
  return { ok: true, paymentHash: inv.paymentHash };
}

export function checkSpend(sp) {
  if (!sp.pr) return { proof: "claimed" };
  try {
    if (sp.mode && !netOk(sp.mode, sp.pr)) return { proof: "mismatch", why: "invoice is on the wrong network" };
    const inv = new Invoice({ pr: sp.pr });
    if (inv.satoshi !== sp.sats) return { proof: "mismatch", why: "invoice amount differs" };
    if (sp.preimage && inv.validatePreimage(sp.preimage)) return { proof: "proven", paymentHash: inv.paymentHash };
    return { proof: "mismatch", why: "preimage does not match invoice" };
  } catch { return { proof: "mismatch", why: "bad invoice" }; }
}

// ---------- the board ----------
export async function buildBoard(l, events, fetchFn = fetch) {
  const repPk = l.rep;
  const pays = [], spends = [], flags = [];
  for (const e of [...events].sort((a, b) => a.created_at - b.created_at)) {
    const type = (e.tags.find((t) => t[0] === "type") || [])[1];
    let c; try { c = JSON.parse(e.content); } catch { continue; }
    if (type === "pay" && e.pubkey === levyPubkey(l)) pays.push({ ...c, at: e.created_at });
    const dtag = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
    if (type === "spend" && e.pubkey === repPk && Number.isInteger(c.sats) && c.sats > 0) spends.push({ ...c, id: dtag.split(":spend:")[1] || e.id.slice(0, 8), at: e.created_at });
    if (type === "flag" && e.pubkey === levyPubkey(l) && c.spend && c.name) flags.push({ ...c, at: e.created_at });
  }
  const used = new Set(), paidBy = new Map(), pending = new Set();
  for (const rc of pays) {
    const key = clean(rc.name, 40).toLowerCase();
    if (!key || paidBy.has(key)) continue;
    const r = await checkReceipt(l, rc, fetchFn);
    if (r.ok && !used.has(r.paymentHash)) { used.add(r.paymentHash); paidBy.set(key, { name: clean(rc.name, 40), at: rc.at, hash: r.paymentHash }); }
    else if (r.pending) pending.add(key);
  }
  const rosterKeys = l.roster.map((n) => n.toLowerCase());
  const people = l.roster.map((n) => { const p = paidBy.get(n.toLowerCase()); return { name: n, state: p ? "paid" : pending.has(n.toLowerCase()) ? "pending" : "unpaid", at: p?.at, ref: p?.hash.slice(0, 10) }; });
  for (const [k, p] of paidBy) if (!rosterKeys.includes(k)) people.push({ name: p.name, state: "paid", at: p.at, ref: p.hash.slice(0, 10), extra: true });
  const mode = modeOf(l);
  const flagsBy = new Map();
  for (const f of flags) { const m = flagsBy.get(f.spend) || new Map(); if (!m.has(f.name.toLowerCase())) m.set(f.name.toLowerCase(), f); flagsBy.set(f.spend, m); }
  const spent = spends.map((s) => ({ ...s, ...checkSpend({ ...s, mode }), flags: [...(flagsBy.get(s.id)?.values() || [])] }));
  const collected = paidBy.size * l.amount;
  const out = spent.reduce((a, s) => a + s.sats, 0);
  const outProven = spent.filter((s) => s.proof === "proven").reduce((a, s) => a + s.sats, 0);
  const expected = l.roster.length * l.amount;
  const activity = [
    ...[...paidBy.values()].map((p) => ({ type: "pay", at: p.at, name: p.name, sats: l.amount, ref: p.hash.slice(0, 10) })),
    ...spent.map((s) => ({ type: "spend", at: s.at, name: s.note, sats: s.sats, proof: s.proof })),
  ].sort((a, b) => b.at - a.at);
  return { people, paidCount: paidBy.size, collected, spent, out, outProven, balance: collected - out, expected,
    outstanding: l.roster.filter((n) => !paidBy.has(n.toLowerCase())).length, activity, mode };
}

// ---------- invoices from a Lightning address (LUD-16 + LUD-21) ----------
export async function requestInvoice(lnAddress, sats, comment, fetchFn = fetch, mode = null) {
  const [user, domain] = lnAddress.split("@");
  if (!user || !domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error("That doesn't look like a Lightning address (name@domain).");
  let res;
  try { res = await fetchFn(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`); }
  catch { throw new Error(`Couldn't reach ${domain}. An email address is not a Lightning address. Use one from a Lightning wallet, such as Alby, or tap "Use a test address".`); }
  if (res.status === 404) throw new Error(`${lnAddress} doesn't exist on ${domain}. Check the spelling.`);
  const meta = await res.json().catch(() => ({}));
  if (meta.tag !== "payRequest") throw new Error("Not a Lightning address");
  const msat = sats * 1000;
  if (msat < meta.minSendable || msat > meta.maxSendable) throw new Error("Amount outside what this address accepts");
  const cb = new URL(meta.callback);
  if (cb.hostname.toLowerCase() !== domain.toLowerCase()) throw new Error("Callback on a different domain");
  cb.searchParams.set("amount", String(msat));
  if (comment && meta.commentAllowed) cb.searchParams.set("comment", comment.slice(0, meta.commentAllowed));
  const r = await fetchFn(cb.toString()).then((r) => r.json());
  if (r.status === "ERROR" || !r.pr) throw new Error(r.reason || "No invoice returned");
  const inv = new Invoice({ pr: r.pr });
  if (inv.satoshi !== sats) throw new Error("Provider returned the wrong amount");
  if (mode && !netOk(mode, r.pr)) throw new Error(mode === "testnet"
    ? `This address gives ${netOf(r.pr)} invoices, not testnet. Use a signet Lightning address, such as one from Blink's test server.`
    : `This address gives ${netOf(r.pr)} invoices. ${MODE_LABEL[mode]} levies need a mainnet-format address.`);
  if (!r.verify) throw new Error("This payee's wallet can't confirm payments (no LUD-21). Use a Lightning address that supports it, such as Alby.");
  return { pr: r.pr, verify: r.verify, paymentHash: inv.paymentHash, expiresAt: inv.expiryDate ? +inv.expiryDate : Date.now() + 3600e3, net: netOf(r.pr) };
}

export async function faucetWallet(balance, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const t = (await (await fetch(`https://faucet.nwc.dev?balance=${balance}`, { method: "POST" })).text()).trim();
      const m = t.match(/lud16=([^&\s]+)/);
      if (t.startsWith("nostr+walletconnect://") && m) return { nwc: t, ln: decodeURIComponent(m[1]) };
    } catch {}
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error("Test wallet faucet is busy. Try again in a minute.");
}
