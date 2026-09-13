// Use device signals rather than window width: a narrow PC window is still a PC.
export function isMobileDevice(device = navigator) {
  if (device.userAgentData?.mobile === true) return true;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(device.userAgent || "")) return true;
  // iPadOS can identify itself as a Mac when requesting desktop websites.
  return /Mac/i.test(device.platform || "") && device.maxTouchPoints > 1;
}
