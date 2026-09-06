/** Keep keyboard focus and open evidence panels when refreshed data replaces a list. */
export function replaceLiveContent(container: HTMLElement, children: Node[]): void {
  const focused = document.activeElement instanceof HTMLElement && container.contains(document.activeElement)
    ? document.activeElement.dataset.liveKey : undefined;
  const disclosures = new Map(Array.from(container.querySelectorAll<HTMLDetailsElement>("details[data-live-key]"))
    .map((details) => [details.dataset.liveKey, details.open]));

  container.replaceChildren(...children);

  for (const details of container.querySelectorAll<HTMLDetailsElement>("details[data-live-key]")) {
    const wasOpen = disclosures.get(details.dataset.liveKey);
    if (wasOpen !== undefined) details.open = wasOpen;
  }
  if (focused) {
    Array.from(container.querySelectorAll<HTMLElement>("[data-live-key]"))
      .find((element) => element.dataset.liveKey === focused)?.focus({ preventScroll: true });
  }
}
