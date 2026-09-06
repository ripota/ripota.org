/** Wire local, immediately available organizer panels as an accessible tab set. */
export function setupAdminTabs(
  tablist: HTMLElement,
  buttons: HTMLButtonElement[],
  panels: HTMLElement[],
  onChange?: (name: string) => void,
): (name: string, notify?: boolean) => void {
  tablist.setAttribute("role", "tablist");
  buttons.forEach((button, index) => {
    const panel = panels[index];
    if (!panel) return;
    button.id ||= `${panel.id}-tab`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panel.id);
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
    panel.tabIndex = 0;
  });

  function activate(name: string, notify = true): void {
    const index = buttons.findIndex((button) => button.dataset.adminWorkspace === name || button.dataset.adminOpsTab === name);
    if (index < 0) return;
    buttons.forEach((button, buttonIndex) => {
      const active = index === buttonIndex;
      button.dataset.active = String(active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      if (panels[buttonIndex]) panels[buttonIndex].hidden = !active;
    });
    if (notify) onChange?.(name);
  }

  function select(button: HTMLButtonElement, focus = false): void {
    const name = button.dataset.adminWorkspace ?? button.dataset.adminOpsTab;
    if (!name) return;
    activate(name);
    if (focus) {
      button.focus({ preventScroll: true });
      button.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  tablist.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
    if (button && buttons.includes(button)) select(button);
  });
  tablist.addEventListener("keydown", (event) => {
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const next = event.key === "ArrowRight" ? (index + 1) % buttons.length
      : event.key === "ArrowLeft" ? (index + buttons.length - 1) % buttons.length
        : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    select(buttons[next], true);
  });
  return activate;
}
