type InlineStyle = { value: string; priority: string };

/** Native dialogs handle focus trapping; keep the underlying gallery stationary too. */
export function setupMediaDialogs(dialogs: HTMLDialogElement[]): {
  open(dialog: HTMLDialogElement, trigger: HTMLElement | null, focus?: HTMLElement | null): void;
} {
  const triggers = new Map<HTMLDialogElement, HTMLElement | null>();
  let restoreScroll: (() => void) | null = null;

  for (const dialog of dialogs) {
    dialog.addEventListener("close", () => {
      // A close event is queued. If the same dialog has already reopened, its
      // current trigger and scroll lock belong to the new opening.
      if (dialog.open) return;
      const trigger = triggers.get(dialog);
      triggers.delete(dialog);
      const remaining = dialogs.filter((item) => item.open);
      if (remaining.length === 0) {
        restoreScroll?.();
        restoreScroll = null;
      }
      // Closing a confirmation returns to its parent dialog. Closing a parent
      // underneath another modal must not move focus out of the active modal.
      if (trigger?.isConnected && !trigger.closest("dialog:not([open])") &&
          (remaining.length === 0 || remaining.some((item) => item.contains(trigger)))) {
        trigger.focus({ preventScroll: true });
      }
    });
  }

  return {
    open(dialog, trigger, focus) {
      if (!dialog.open) {
        restoreScroll ??= lockPageScroll();
        triggers.set(dialog, trigger);
        try {
          dialog.showModal();
        } catch (error) {
          triggers.delete(dialog);
          if (!dialogs.some((item) => item.open)) {
            restoreScroll?.();
            restoreScroll = null;
          }
          throw error;
        }
      }
      focus?.focus({ preventScroll: true });
    },
  };
}

function lockPageScroll(): () => void {
  const body = document.body;
  const html = document.documentElement;
  const left = window.scrollX;
  const top = window.scrollY;
  const scrollbar = Math.max(0, window.innerWidth - html.clientWidth);
  const padding = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
  const bodyProperties = ["position", "top", "left", "width", "overflow", "box-sizing", "padding-right"];
  const bodyStyles = captureStyles(body.style, bodyProperties);
  const htmlStyles = captureStyles(html.style, ["overflow", "scroll-behavior"]);

  // Fixing the body also prevents background touch scrolling on mobile Safari.
  html.style.setProperty("overflow", "hidden");
  body.style.setProperty("position", "fixed");
  body.style.setProperty("top", `${-top}px`);
  body.style.setProperty("left", `${-left}px`);
  body.style.setProperty("width", "100%");
  body.style.setProperty("box-sizing", "border-box");
  body.style.setProperty("overflow", "hidden");
  if (scrollbar) body.style.setProperty("padding-right", `${padding + scrollbar}px`);

  return () => {
    restoreStyles(body.style, bodyStyles);
    restoreStyles(html.style, htmlStyles);
    // Avoid the site's smooth scrolling when putting the gallery back beneath
    // the exact tile that opened the dialog.
    html.style.setProperty("scroll-behavior", "auto", "important");
    window.scrollTo(left, top);
    restoreStyles(html.style, new Map([["scroll-behavior", htmlStyles.get("scroll-behavior")!]]));
  };
}

function captureStyles(style: CSSStyleDeclaration, properties: string[]): Map<string, InlineStyle> {
  return new Map(properties.map((property) => [property, {
    value: style.getPropertyValue(property), priority: style.getPropertyPriority(property),
  }]));
}

function restoreStyles(style: CSSStyleDeclaration, styles: Map<string, InlineStyle>): void {
  for (const [property, { value, priority }] of styles) {
    if (value) style.setProperty(property, value, priority);
    else style.removeProperty(property);
  }
}
