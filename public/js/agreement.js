export const AGREEMENT_VERSION = "2026-09-12.2";
export const AGREEMENT_STORAGE_KEY = "oraenView:agreement";

export function hasAcceptedAgreement() {
  try {
    const record = JSON.parse(localStorage.getItem(AGREEMENT_STORAGE_KEY));
    return record?.version === AGREEMENT_VERSION && record.accepted === true
      && typeof record.acceptedAt === "string" && Number.isFinite(Date.parse(record.acceptedAt));
  } catch {
    return false;
  }
}

export function showAgreement({ review = false } = {}) {
  const dialog = document.querySelector("#usageAgreement");
  const checkbox = document.querySelector("#agreementCheckbox");
  const accept = document.querySelector("#acceptAgreement");
  const decline = document.querySelector("#declineAgreement");
  const close = document.querySelector("#closeAgreement");
  const status = document.querySelector("#agreementStatus");
  const previousFocus = document.activeElement;
  checkbox.checked = false;
  accept.disabled = true;
  status.textContent = "";
  document.querySelector("#agreementConsent").hidden = review;
  accept.hidden = review;
  decline.hidden = review;
  close.hidden = !review;
  document.querySelector("#agreementVersion").textContent = AGREEMENT_VERSION;
  document.body.classList.add("agreement-open");
  if (dialog.open) dialog.close();
  dialog.showModal();
  document.querySelector("#agreementText").scrollTop = 0;
  document.querySelector("#agreementTitle").focus();

  return new Promise((resolve) => {
    function finish(result) {
      checkbox.removeEventListener("change", onChange);
      accept.removeEventListener("click", onAccept);
      decline.removeEventListener("click", onDecline);
      close.removeEventListener("click", onClose);
      dialog.removeEventListener("cancel", onCancel);
      dialog.close();
      document.body.classList.remove("agreement-open");
      if (review) previousFocus?.focus();
      resolve(result);
    }
    function onChange() { accept.disabled = !checkbox.checked; }
    function onAccept() {
      if (!checkbox.checked || review) return;
      let persisted = true;
      try {
        localStorage.setItem(AGREEMENT_STORAGE_KEY, JSON.stringify({
          version: AGREEMENT_VERSION, accepted: true, acceptedAt: new Date().toISOString(),
        }));
      } catch { persisted = false; }
      finish({ persisted });
    }
    function onDecline() {
      checkbox.checked = false;
      accept.disabled = true;
      status.textContent = "你尚未同意使用协议，网站不会开始训练或测试。可以关闭此页面；如果改变主意，请阅读并勾选后再继续。";
    }
    function onClose() { if (review) finish({ persisted: true }); }
    function onCancel(event) {
      event.preventDefault();
      if (review) onClose();
    }
    checkbox.addEventListener("change", onChange);
    accept.addEventListener("click", onAccept);
    decline.addEventListener("click", onDecline);
    close.addEventListener("click", onClose);
    dialog.addEventListener("cancel", onCancel);
  });
}

export async function requireAgreement() {
  if (hasAcceptedAgreement()) {
    document.querySelector("#usageAgreement").close();
    return { persisted: true };
  }
  return showAgreement();
}
