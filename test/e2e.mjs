// End-to-end on test wallets: NWC Faucet (fake sats, no real money) + public Nostr relays.
import assert from "node:assert/strict";
import { NWCClient } from "@getalby/sdk";
import { SimplePool, useWebSocketImplementation } from "nostr-tools/pool";
import WS from "ws"; useWebSocketImplementation(WS);
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { hexToBytes } from "nostr-tools/utils";
import * as D from "../src/core.js";

let n = 0; const ok = (m) => { n++; console.log("  ok -", m); };
const [payee, bisi, tunde] = [await D.faucetWallet(0), await D.faucetWallet(5000), await D.faucetWallet(5000)];
const repSk = D.newKey(generateSecretKey);
const l = { title: "LIS 400L class dues", amount: 1000, due: "2026-12-01", payee: payee.ln,
  roster: ["Bisi Ade", "Tunde Ola", "Ada Eze"], sk: D.newKey(generateSecretKey), rep: D.repPubkeyOf(repSk) };
const link = D.encodeLevy(l);
assert.deepEqual(D.decodeLevy(link).roster, l.roster); ok("levy link round-trips");
assert.ok(!link.includes("walletconnect") && !link.includes(repSk)); ok("link holds no wallet secret and no rep secret");
assert.throws(() => D.encodeLevy({ ...l, payee: "not-an-address" })); ok("rejects bad payee");
assert.throws(() => D.encodeLevy({ ...l, roster: ["A", "a"] })); ok("rejects duplicate names");

const pool = new SimplePool(); const R = D.DEFAULT_RELAYS; const sk = hexToBytes(l.sk);
const posted = [];
for (const [who, w] of [["Bisi Ade", bisi], ["Tunde Ola", tunde]]) {
  const inv = await D.requestInvoice(l.payee, l.amount, `${l.title}: ${who}`);
  const c = new NWCClient({ nostrWalletConnectUrl: w.nwc }); await c.payInvoice({ invoice: inv.pr }); c.close();
  const ev = finalizeEvent(D.receiptTemplate(l, who, inv.pr, inv.verify), sk);
  await Promise.any(pool.publish(R, ev)); posted.push(ev);
}
ok("2 students paid by Lightning (NWC) and posted receipts to Nostr");

// rep pays a vendor 700 sats and posts a proven spend, plus one claimed spend with no proof
const vendor = await D.faucetWallet(0);
const pc = new NWCClient({ nostrWalletConnectUrl: payee.nwc });
const vinv = await D.requestInvoice(vendor.ln, 700, "printing handouts");
const paid = await pc.payInvoice({ invoice: vinv.pr }); pc.close();
const rk = hexToBytes(repSk);
await Promise.any(pool.publish(R, finalizeEvent(D.spendTemplate(l, { note: "Printing handouts", sats: 700, pr: vinv.pr, preimage: paid.preimage }), rk)));
await Promise.any(pool.publish(R, finalizeEvent(D.spendTemplate(l, { note: "Cash for chairs", sats: 200 }), rk)));
ok("rep posted a proven spend (700) and a claimed spend (200)");

// attacks: an outsider (not the rep) posts a spend; a receipt with a foreign verify URL; a reused payment under another name
const fakeSpend = finalizeEvent(D.spendTemplate(l, { note: "fake", sats: 999 }), generateSecretKey());
const foreign = finalizeEvent(D.receiptTemplate(l, "Ada Eze", JSON.parse(posted[0].content).pr, "https://evil.example/v"), sk);
const reuse = finalizeEvent({ ...D.receiptTemplate(l, "Ada Eze", JSON.parse(posted[0].content).pr, JSON.parse(posted[0].content).verify), tags: [["d", "x"], ["t", D.levyTag(l)], ["type", "pay"]] }, sk);

await new Promise((r) => setTimeout(r, 2000));
const evs = await pool.querySync(R, { kinds: [D.KIND], "#t": [D.levyTag(l)] });
ok(`read ${evs.length} events back from relays`);
const b = await D.buildBoard(l, [...evs, fakeSpend, foreign, reuse]);
assert.deepEqual(b.people.map((p) => p.state), ["paid", "paid", "unpaid"]); ok("board: Bisi paid, Tunde paid, Ada unpaid (fake receipts ignored)");
assert.equal(b.collected, 2000); assert.equal(b.out, 900); assert.equal(b.outProven, 700); assert.equal(b.balance, 1100); ok("collected 2000, spent 900 (700 proven), balance 1100");
assert.equal(b.spent.length, 2); ok("outsider's spend ignored");
pool.close(R);
console.log(`\n${n} checks passed`); process.exit(0);
