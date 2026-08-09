#!/usr/bin/env node
// scripts/provision-stripe-prices.mjs (sow-185): create the tier Stripe prices from house/membership-tiers.yml
// via the API, idempotently, so nobody hand-creates them in the dashboard. It reuses the repo's no-SDK Stripe
// REST client (clients/stripe.mjs) and reads the amounts + env-var names from the SINGLE source of truth
// (house/membership-tiers.yml, the same file the site + the gate read), so a price can never disagree with what
// is advertised.
//
// SETUP-ONLY, and it needs a key with Products + Prices WRITE scope. The runtime STRIPE_SECRET_KEY is a
// restricted key scoped to create-customer + checkout (least privilege) and CANNOT create prices, on purpose.
// Provide a write-scoped key ONLY for the run (never store it in wrangler.toml or a secret):
//   - mint a restricted key in the Stripe dashboard scoped to Products + Prices write, test and live, OR
//   - run `stripe login` and pass the CLI's key, OR the account's full sk_test_/sk_live_ key.
//
// The key's MODE is the account mode: a test key creates TEST prices (-> wrangler [vars]); a live key creates
// LIVE prices (-> wrangler [env.production]). Dry run by default; --apply to create; --write to also patch
// wrangler.toml. A live --apply additionally requires --yes-live, because live prices are money-facing.
//
//   STRIPE_PROVISION_KEY=sk_test_... node scripts/provision-stripe-prices.mjs                 # DRY RUN (plan)
//   STRIPE_PROVISION_KEY=sk_test_... node scripts/provision-stripe-prices.mjs --apply          # create in TEST
//   STRIPE_PROVISION_KEY=sk_test_... node scripts/provision-stripe-prices.mjs --apply --write   # + wrangler [vars]
//   STRIPE_PROVISION_KEY=sk_live_... node scripts/provision-stripe-prices.mjs --apply --yes-live --write  # LIVE

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { createStripeClient } from '../clients/stripe.mjs';
import { parseTierDisplay } from '../membership/tiers-display.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The prices we WANT, derived from the tier display data. Skips the free tier and any period with amount 0 or
 *  no env var. unitAmount is in cents. Product per tier ("GBTI <label>"). */
export function desiredPricesFromTiers(tiers) {
  const out = [];
  for (const t of tiers) {
    for (const [period, interval] of [['monthly', 'month'], ['annual', 'year']]) {
      const dollars = period === 'monthly' ? t.priceMonthly : t.priceAnnual;
      const envName = t.priceEnv?.[period];
      if (!(dollars > 0) || !envName) continue;
      out.push({ envName, tierKey: t.key, productName: `GBTI ${t.label}`, unitAmount: Math.round(dollars * 100), interval, period });
    }
  }
  return out;
}

/** An existing ACTIVE recurring price matching a spec exactly (amount + interval + currency), or null. Stripe
 *  prices are immutable, so a match is REUSED not recreated, which is what makes a re-run idempotent. */
export function matchPrice(prices, spec, currency = 'usd') {
  return prices.find((p) => p.active !== false && p.unit_amount === spec.unitAmount && p.currency === currency && p.recurring?.interval === spec.interval) || null;
}

/** test|live from the key prefix (sk_test_/rk_test_ -> test), or null on an unrecognized shape (fail closed). */
export function modeFromKey(key) {
  const m = /^(sk|rk|rak)_(test|live)_/.exec(String(key || ''));
  return m ? m[2] : null;
}

/** The wrangler.toml section a mode's price vars belong in. Wrangler nests per-environment vars under
 *  [env.<name>.vars], NOT [env.<name>], so live -> [env.production.vars]; the default/dev env is top-level [vars]. */
export function sectionForMode(mode) {
  return mode === 'live' ? '[env.production.vars]' : '[vars]';
}

/** Insert/replace `NAME = "value"` lines inside a named TOML section ([vars] or [env.production]), leaving the
 *  rest of the file otherwise untouched. PURE + unit-tested: editing near the existing live-price line must not
 *  corrupt it. Throws if the section is absent. */
export function patchWranglerVars(tomlText, sectionHeader, vars) {
  const lines = tomlText.split('\n');
  const start = lines.findIndex((l) => l.trim() === sectionHeader);
  if (start < 0) throw new Error(`section ${sectionHeader} not found in wrangler.toml`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { if (/^\s*\[/.test(lines[i])) { end = i; break; } }
  const out = lines.slice();
  const toAppend = [];
  for (const [name, value] of Object.entries(vars)) {
    const line = `${name} = "${value}"`;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // the var name is a literal, not a pattern
    let replaced = false;
    for (let i = start + 1; i < end; i++) {
      if (new RegExp(`^\\s*${esc}\\s*=`).test(out[i])) { out[i] = line; replaced = true; break; }
    }
    if (!replaced) toAppend.push({ line, at: end });
  }
  // Insert new lines just before the section's trailing blank line(s) / next header, so they stay in-section.
  if (toAppend.length) {
    let insertAt = end;
    while (insertAt > start + 1 && out[insertAt - 1].trim() === '') insertAt--;
    out.splice(insertAt, 0, ...toAppend.map((a) => a.line));
  }
  return out.join('\n');
}

/** Idempotent provision: ensure a product per tier and a price per (tier, period). Injected stripe client, so it
 *  is testable with a fake. Returns { mapping: {envName: id|null}, actions: [...] }. Mutates only when apply. */
export async function provision({ stripe, desired, apply = false }) {
  const actions = [];
  const mapping = {};
  const byProduct = new Map();
  for (const d of desired) { if (!byProduct.has(d.productName)) byProduct.set(d.productName, []); byProduct.get(d.productName).push(d); }

  for (const [productName, specs] of byProduct) {
    let product = null;
    for await (const p of stripe.listProducts()) { if (p.name === productName && p.active !== false) { product = p; break; } }
    if (!product) {
      if (apply) { product = await stripe.createProduct({ name: productName }); actions.push({ kind: 'create-product', name: productName, id: product.id }); }
      else { actions.push({ kind: 'would-create-product', name: productName }); product = { id: null }; }
    } else {
      actions.push({ kind: 'reuse-product', name: productName, id: product.id });
    }

    const existing = [];
    if (product.id) { for await (const pr of stripe.listPrices({ product: product.id })) existing.push(pr); }
    for (const spec of specs) {
      const hit = matchPrice(existing, spec);
      if (hit) { mapping[spec.envName] = hit.id; actions.push({ kind: 'reuse-price', env: spec.envName, id: hit.id, amount: spec.unitAmount, interval: spec.interval }); continue; }
      if (apply && product.id) {
        const created = await stripe.createPrice({ product: product.id, unitAmount: spec.unitAmount, interval: spec.interval, nickname: `${productName} ${spec.period}` });
        mapping[spec.envName] = created.id;
        actions.push({ kind: 'create-price', env: spec.envName, id: created.id, amount: spec.unitAmount, interval: spec.interval });
      } else {
        mapping[spec.envName] = null;
        actions.push({ kind: 'would-create-price', env: spec.envName, amount: spec.unitAmount, interval: spec.interval });
      }
    }
  }
  return { mapping, actions };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const write = args.has('--write');
  const yesLive = args.has('--yes-live');
  const key = process.env.STRIPE_PROVISION_KEY || process.env.STRIPE_SECRET_KEY || '';

  if (!key) {
    console.error('No Stripe key. Set STRIPE_PROVISION_KEY to a Products+Prices-write key (test or live).');
    console.error('The runtime STRIPE_SECRET_KEY is restricted to customer+checkout and cannot create prices.');
    process.exit(2);
  }
  const mode = modeFromKey(key);
  if (!mode) { console.error('Unrecognized key prefix; expected sk_test_/rk_test_/sk_live_/rk_live_.'); process.exit(2); }
  if (mode === 'live' && apply && !yesLive) {
    console.error('Refusing to create LIVE prices without --yes-live. Review the dry-run plan first, then re-run with --yes-live.');
    process.exit(2);
  }

  const raw = yaml.load(fs.readFileSync(path.join(ROOT, 'house/membership-tiers.yml'), 'utf8'));
  const tiers = parseTierDisplay(raw);
  const desired = desiredPricesFromTiers(tiers);

  const stripe = createStripeClient({ apiKey: key });
  const { mapping, actions } = await provision({ stripe, desired, apply });

  console.log(`\nStripe price provisioning (${mode} mode, ${apply ? 'APPLY' : 'DRY RUN'}):\n`);
  for (const a of actions) console.log('  ' + JSON.stringify(a));
  console.log('\nEnv var mapping:');
  for (const [env, id] of Object.entries(mapping)) console.log(`  ${env} = ${id ?? '(would create)'}`);

  const allResolved = Object.keys(mapping).length > 0 && Object.values(mapping).every(Boolean);
  if (write) {
    if (!apply) { console.error('\n--write needs --apply (nothing to write in a dry run).'); process.exit(2); }
    if (!allResolved) { console.error('\nNot writing wrangler.toml: some ids did not resolve.'); process.exit(1); }
    const section = sectionForMode(mode);
    const file = path.join(ROOT, 'workers/signup/wrangler.toml');
    fs.writeFileSync(file, patchWranglerVars(fs.readFileSync(file, 'utf8'), section, mapping));
    console.log(`\nWrote ${Object.keys(mapping).length} vars into wrangler.toml ${section}. Review the diff, then: npm run deploy:worker`);
  } else if (apply && allResolved) {
    console.log(`\nNext: add these to workers/signup/wrangler.toml (${mode === 'live' ? '[env.production]' : '[vars]'}) or re-run with --write, then npm run deploy:worker.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e?.message || e); process.exit(1); });
}
