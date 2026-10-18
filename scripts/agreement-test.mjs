import test from "node:test";
import assert from "node:assert/strict";
import { AGREEMENT_VERSION, AGREEMENT_STORAGE_KEY, hasAcceptedAgreement, requireAgreement, showAgreement } from "../public/js/agreement.js";

function harness({ record = null, blocked = false } = {}) {
  class Element extends EventTarget {
    open = false;
    checked = false;
    hidden = false;
    disabled = false;
    textContent = "";
    focus() { document.activeElement = this; }
    close() { this.open = false; }
    showModal() { this.open = true; }
    fire(type) { return this.dispatchEvent(new Event(type, { cancelable: true })); }
  }
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const values = new Map([[AGREEMENT_STORAGE_KEY, record]]);
  globalThis.localStorage = {
    getItem(key) { if (blocked) throw new Error("Storage blocked"); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error("Storage blocked"); values.set(key, value); },
  };
  globalThis.document = {
    querySelector: get,
    activeElement: new Element(),
    body: { classList: { add() {}, remove() {} } },
  };
  get("#usageAgreement").open = true;
  return { get, values };
}

test("only explicit, dated acceptance of the current version skips the gate", async () => {
  for (const record of [null, "broken", "{}", JSON.stringify({ version: "old", accepted: true, acceptedAt: new Date().toISOString() }), JSON.stringify({ version: AGREEMENT_VERSION, accepted: false }), JSON.stringify({ version: AGREEMENT_VERSION, accepted: true, acceptedAt: "invalid" })]) {
    harness({ record });
    assert.equal(hasAcceptedAgreement(), false);
  }
  const { get } = harness({ record: JSON.stringify({ version: AGREEMENT_VERSION, accepted: true, acceptedAt: new Date().toISOString() }) });
  assert.deepEqual(await requireAgreement(), { persisted: true });
  assert.equal(get("#usageAgreement").open, false);
});

test("acceptance expires at seven days and confirming renews it", async () => {
  const originalNow = Date.now;
  const now = Date.parse("2026-10-14T12:00:00Z");
  const week = 7 * 24 * 60 * 60 * 1000;
  Date.now = () => now;
  try {
    for (const [age, expected] of [[0,true],[week-1,true],[week,false],[week+1,false],[-1,false]]) {
      harness({ record: JSON.stringify({ version: AGREEMENT_VERSION, accepted: true, acceptedAt: new Date(now-age).toISOString() }) });
      assert.equal(hasAcceptedAgreement(), expected, `age ${age}`);
    }
  } finally { Date.now = originalNow; }
  const { get } = harness({ record: JSON.stringify({ version: AGREEMENT_VERSION, accepted: true, acceptedAt: new Date(Date.now()-week).toISOString() }) });
  const pending = requireAgreement();
  assert.equal(get("#usageAgreement").open, true);
  get("#agreementCheckbox").checked = true;
  get("#acceptAgreement").fire("click");
  await pending;
  assert.equal(hasAcceptedAgreement(), true);
});

test("unchecked acceptance, decline and Escape keep first-time users behind the gate", async () => {
  const { get, values } = harness();
  let entered = false;
  const pending = requireAgreement().then((result) => { entered = true; return result; });
  assert.equal(get("#acceptAgreement").disabled, true);
  get("#acceptAgreement").fire("click");
  assert.equal(get("#usageAgreement").fire("cancel"), false);
  get("#agreementCheckbox").checked = true;
  get("#agreementCheckbox").fire("change");
  get("#declineAgreement").fire("click");
  await Promise.resolve();
  assert.equal(entered, false);
  assert.equal(get("#usageAgreement").open, true);
  assert.equal(get("#agreementCheckbox").checked, false);
  assert.equal(values.get(AGREEMENT_STORAGE_KEY), null);
  get("#agreementCheckbox").checked = true;
  get("#agreementCheckbox").fire("change");
  assert.equal(get("#acceptAgreement").disabled, false);
  get("#acceptAgreement").fire("click");
  assert.deepEqual(await pending, { persisted: true });
  assert.equal(hasAcceptedAgreement(), true);
  assert.equal(get("#usageAgreement").open, false);
});

test("unavailable browser storage still permits an explicitly accepted visit", async () => {
  const { get } = harness({ blocked: true });
  const pending = requireAgreement();
  get("#agreementCheckbox").checked = true;
  get("#acceptAgreement").fire("click");
  assert.deepEqual(await pending, { persisted: false });
  assert.equal(hasAcceptedAgreement(), false);
});

test("review can close with Escape without changing acceptance and restores focus", async () => {
  const { get, values } = harness({ record: "existing record" });
  const trigger = document.activeElement;
  const pending = showAgreement({ review: true });
  assert.equal(get("#agreementConsent").hidden, true);
  assert.equal(get("#closeAgreement").hidden, false);
  get("#usageAgreement").fire("cancel");
  await pending;
  assert.equal(values.get(AGREEMENT_STORAGE_KEY), "existing record");
  assert.equal(document.activeElement, trigger);
});
