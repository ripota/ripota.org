export function formatRadioDetails(frequency: string, mode: string): string {
  const trimmedFrequency = frequency.trim();
  const normalizedFrequency = /^\d+\.\d+$/.test(trimmedFrequency)
    ? trimmedFrequency.replace(/0+$/, "").replace(/\.$/, "")
    : trimmedFrequency;
  const parts = [normalizedFrequency ? `${normalizedFrequency} kHz` : "", mode]
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Not provided";
}
