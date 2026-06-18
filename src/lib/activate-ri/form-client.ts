export type ValidationControl =
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLButtonElement
  | HTMLTextAreaElement;

export type StopErrorKey = "park" | "plannedDate" | "timeBlock" | "bands" | "modes";

export type StopSetupOptions = {
  root?: Document | Element;
  validatePark?: boolean;
  setupErrorDescriptions?: boolean;
};

export function uppercaseFormValue(value: FormDataEntryValue | null): FormDataEntryValue | null {
  return typeof value === "string" ? value.toUpperCase() : value;
}

export function setupCallsignFields(root: Document | Element = document): void {
  root.querySelectorAll<HTMLInputElement>(".callsign-input").forEach((field) => {
    const uppercaseValue = () => {
      field.value = field.value.toUpperCase();
    };

    field.addEventListener("input", uppercaseValue);
    field.addEventListener("change", uppercaseValue);
    uppercaseValue();
  });
}

export async function populateClubDatalist(id: string): Promise<void> {
  const datalist = document.getElementById(id);
  if (!datalist) {
    return;
  }

  try {
    const response = await fetch("/api/activate-ri-2026/public/clubs", {
      headers: { accept: "application/json" },
    });
    const body = await response.json() as { clubs?: unknown };
    const clubs = Array.isArray(body.clubs)
      ? body.clubs.filter((club): club is string => typeof club === "string")
      : [];

    datalist.replaceChildren(
      ...clubs.map((club) => {
        const option = document.createElement("option");
        option.value = club;
        return option;
      }),
    );
  } catch {
    datalist.replaceChildren();
  }
}

export function setupDocumentPopupDismissal(): void {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    document.querySelectorAll<HTMLElement>("[data-park-combobox]").forEach((combo) => {
      if (!combo.contains(target)) {
        setParkPopupOpen(combo, false);
      }
    });

    document.querySelectorAll<HTMLElement>("[data-multi-select]").forEach((multiSelect) => {
      if (!multiSelect.contains(target)) {
        setMultiSelectOpen(multiSelect, false);
      }
    });
  });
}

export function setupStopCards(options: StopSetupOptions = {}): void {
  const root = options.root ?? document;
  const stops = Array.from(root.querySelectorAll<HTMLElement>("[data-stop-card]"));

  stops.forEach((stop, index) => {
    stop.querySelector("[data-stop-title]")?.replaceChildren(`Activation stop ${index + 1}`);

    if (options.setupErrorDescriptions) {
      setupStopErrorDescriptions(stop, index);
    }

    const removeButton = stop.querySelector<HTMLButtonElement>("[data-remove-stop]");
    if (removeButton) {
      removeButton.hidden = stops.length === 1;
      removeButton.onclick = () => {
        stop.remove();
        setupStopCards(options);
      };
    }

    setupParkCombobox(stop, options.validatePark ?? false);
    setupStopRequiredCleanup(stop);
    setupMultiSelects(stop);
  });
}

function setupParkCombobox(stop: HTMLElement, validatePark: boolean): void {
  const parkInput = stop.querySelector<HTMLInputElement>("[data-park-input]");
  const parkReference = stop.querySelector<HTMLInputElement>("[data-park-reference]");
  const parkCombobox = stop.querySelector<HTMLElement>("[data-park-combobox]");

  if (!parkInput || !parkReference || !parkCombobox) {
    return;
  }

  const syncParkReference = () => {
    parkReference.value = selectedParkReference(parkInput.value.trim(), parkCombobox);
    if (validatePark) {
      parkInput.setCustomValidity(
        parkReference.value ? "" : "Choose a park from the suggestions.",
      );
      if (parkReference.value) {
        clearFieldError(parkInput, stopErrorElement(stop, "park"));
      }
    }
    filterParkOptions(parkCombobox, parkInput.value);
  };

  parkInput.onfocus = () => {
    filterParkOptions(parkCombobox, parkInput.value);
    setParkPopupOpen(parkCombobox, true);
  };
  parkInput.oninput = syncParkReference;
  parkInput.onchange = syncParkReference;
  syncParkReference();

  parkCombobox.querySelectorAll<HTMLElement>("[data-park-option]").forEach((option) => {
    option.onclick = () => {
      parkInput.value = option.dataset.label ?? "";
      parkReference.value = option.dataset.reference ?? "";
      if (validatePark) {
        clearFieldError(parkInput, stopErrorElement(stop, "park"));
      }
      setParkPopupOpen(parkCombobox, false);
    };
  });
}

function setupStopRequiredCleanup(stop: HTMLElement): void {
  const plannedDate = stop.querySelector("[data-planned-date]") as HTMLSelectElement | null;
  const timeBlock = stop.querySelector("[data-time-block]") as HTMLSelectElement | null;

  plannedDate?.addEventListener("change", () => {
    if (plannedDate.value) {
      clearFieldError(plannedDate, stopErrorElement(stop, "plannedDate"));
    }
  });

  timeBlock?.addEventListener("change", () => {
    if (timeBlock.value) {
      clearFieldError(timeBlock, stopErrorElement(stop, "timeBlock"));
    }
  });
}

function setupMultiSelects(stop: HTMLElement): void {
  stop.querySelectorAll<HTMLElement>("[data-multi-select]").forEach((multiSelect) => {
    const toggle = multiSelect.querySelector<HTMLButtonElement>("[data-multi-toggle]");
    if (toggle) {
      toggle.onclick = () => {
        setMultiSelectOpen(multiSelect, toggle.getAttribute("aria-expanded") !== "true");
      };
    }

    multiSelect.querySelectorAll<HTMLInputElement>("[data-multi-option]").forEach((option) => {
      option.onchange = () => {
        updateMultiSelectLabel(multiSelect);
        if (selectedValues(multiSelect).length > 0) {
          clearFieldError(
            toggle,
            stopErrorElement(stop, multiSelect.hasAttribute("data-bands") ? "bands" : "modes"),
          );
        }
      };
    });
    updateMultiSelectLabel(multiSelect);
  });
}

export function appendBlankStop(stopsContainer: HTMLElement | null): HTMLElement | null {
  const firstStop = stopsContainer?.querySelector<HTMLElement>("[data-stop-card]");
  if (!firstStop || !stopsContainer) {
    return null;
  }

  const nextStop = firstStop.cloneNode(true) as HTMLElement;
  clearStopCard(nextStop);
  stopsContainer.appendChild(nextStop);
  return nextStop;
}

export function clearStopCard(stop: HTMLElement): void {
  stop.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type='checkbox']), textarea").forEach((field) => {
    field.value = "";
  });
  stop.querySelectorAll<HTMLInputElement>("input[type='checkbox']").forEach((field) => {
    field.checked = false;
  });
  (Array.from(stop.querySelectorAll("select")) as HTMLSelectElement[]).forEach((field) => {
    field.selectedIndex = 0;
  });
  stop.querySelectorAll<HTMLElement>("[data-park-results], [data-multi-menu]").forEach((popup) => {
    popup.hidden = true;
  });
  stop.querySelectorAll<HTMLElement>("[data-multi-select]").forEach(updateMultiSelectLabel);
  stop.querySelectorAll("[aria-invalid]").forEach((field) => {
    clearFieldError(field as ValidationControl, fieldErrorElement(field));
  });
  stop.querySelectorAll<HTMLElement>("[data-field-error]").forEach((error) => {
    error.replaceChildren();
  });
}

export function firstEmptyStopCard(root: Document | Element = document): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-stop-card]"))
    .find((stop) => !stop.querySelector<HTMLInputElement>("[data-park-reference]")?.value) ?? null;
}

export function parkReferenceAlreadySelected(reference: string, root: Document | Element = document): boolean {
  return Array.from(root.querySelectorAll<HTMLInputElement>("[data-park-reference]"))
    .some((field) => field.value.toUpperCase() === reference);
}

export function selectParkReference(stop: HTMLElement, reference: string): boolean {
  if (!reference) {
    return false;
  }

  const parkInput = stop.querySelector<HTMLInputElement>("[data-park-input]");
  const parkReference = stop.querySelector<HTMLInputElement>("[data-park-reference]");
  const option = Array.from(stop.querySelectorAll<HTMLElement>("[data-park-option]"))
    .find((candidate) => candidate.dataset.reference === reference);

  if (!parkInput || !parkReference || !option) {
    return false;
  }

  parkInput.value = option.dataset.label ?? reference;
  parkReference.value = reference;
  parkInput.setCustomValidity("");
  return true;
}

export function selectedParkReference(value: string, combobox: HTMLElement): string {
  const normalizedValue = value.toLowerCase();
  const selectedOption = Array.from(combobox.querySelectorAll<HTMLElement>("[data-park-option]"))
    .find((option) => (
      option.dataset.reference?.toLowerCase() === normalizedValue ||
      option.dataset.label?.toLowerCase() === normalizedValue
    ));

  return selectedOption?.dataset.reference ?? "";
}

export function filterParkOptions(combobox: HTMLElement, value: string): void {
  const terms = value.toLowerCase().split(/\s+/).filter(Boolean);
  let visibleCount = 0;

  combobox.querySelectorAll<HTMLElement>("[data-park-option]").forEach((option) => {
    const search = option.dataset.search ?? "";
    const isVisible = terms.every((term) => search.includes(term));
    option.hidden = !isVisible;
    if (isVisible) {
      visibleCount += 1;
    }
  });

  const empty = combobox.querySelector<HTMLElement>("[data-park-empty]");
  if (empty) {
    empty.hidden = visibleCount > 0;
  }
}

export function selectedValues(root: HTMLElement | null): string[] {
  return Array.from(root?.querySelectorAll<HTMLInputElement>("[data-multi-option]:checked") ?? [])
    .map((option) => option.value);
}

export function setSelectedValues(root: HTMLElement | null, values: string[]): void {
  const selected = new Set(values);
  root?.querySelectorAll<HTMLInputElement>("[data-multi-option]").forEach((option) => {
    option.checked = selected.has(option.value);
  });
  if (root) {
    updateMultiSelectLabel(root);
  }
}

export function setParkPopupOpen(combobox: HTMLElement, isOpen: boolean): void {
  combobox.querySelector<HTMLElement>("[data-park-results]")?.toggleAttribute("hidden", !isOpen);
  combobox.querySelector<HTMLInputElement>("[data-park-input]")?.setAttribute("aria-expanded", String(isOpen));
}

export function setMultiSelectOpen(multiSelect: HTMLElement, isOpen: boolean): void {
  multiSelect.querySelector<HTMLElement>("[data-multi-menu]")?.toggleAttribute("hidden", !isOpen);
  multiSelect.querySelector<HTMLButtonElement>("[data-multi-toggle]")?.setAttribute("aria-expanded", String(isOpen));
}

export function updateMultiSelectLabel(multiSelect: HTMLElement): void {
  const toggle = multiSelect.querySelector<HTMLButtonElement>("[data-multi-toggle]");
  const values = selectedValues(multiSelect);

  if (!toggle) {
    return;
  }

  toggle.textContent = values.length > 0 ? values.join(", ") : multiSelect.hasAttribute("data-bands") ? "Choose bands" : "Choose modes";
}

export function resetTurnstile(): void {
  const turnstile = (
    globalThis as {
      turnstile?: {
        reset?: () => void;
      };
    }
  ).turnstile;

  turnstile?.reset?.();
}

export function setupStopErrorDescriptions(stop: HTMLElement, index: number): void {
  (["park", "plannedDate", "timeBlock", "bands", "modes"] as StopErrorKey[]).forEach((key) => {
    const errorElement = stopErrorElement(stop, key);
    if (!errorElement) {
      return;
    }

    errorElement.id = `activate-ri-stop-${index + 1}-${key}-error`;

    const control = stopControl(stop, key);
    if (control) {
      appendDescribedBy(control, errorElement.id);
    }
  });
}

export function stopControl(stop: HTMLElement, key: StopErrorKey): ValidationControl | null {
  if (key === "park") {
    return stop.querySelector<HTMLInputElement>("[data-park-input]");
  }

  if (key === "plannedDate") {
    return stop.querySelector("[data-planned-date]") as HTMLSelectElement | null;
  }

  if (key === "timeBlock") {
    return stop.querySelector("[data-time-block]") as HTMLSelectElement | null;
  }

  const multiSelect = stop.querySelector<HTMLElement>(
    key === "bands" ? "[data-bands]" : "[data-modes]",
  );

  return multiSelect?.querySelector<HTMLButtonElement>("[data-multi-toggle]") ?? null;
}

export function stopErrorElement(stop: HTMLElement, key: StopErrorKey): HTMLElement | null {
  return stop.querySelector<HTMLElement>(`[data-field-error][data-error-for="${key}"]`);
}

export function fieldErrorElement(control: Element | null): HTMLElement | null {
  const describedBy = control?.getAttribute("aria-describedby") ?? "";

  return describedBy
    .split(/\s+/)
    .map((id) => document.getElementById(id))
    .find((element): element is HTMLElement => element?.hasAttribute("data-field-error") ?? false) ?? null;
}

export function clearFieldError(control: ValidationControl | null, errorElement: HTMLElement | null): void {
  control?.removeAttribute("aria-invalid");
  setControlValidity(control, "");
  errorElement?.replaceChildren();
}

export function setControlValidity(control: ValidationControl | null, message: string): void {
  control?.setCustomValidity(message);
}

export function reportControlValidity(control: ValidationControl | null): void {
  control?.reportValidity();
}

export function appendDescribedBy(control: ValidationControl, id: string): void {
  const ids = new Set(
    (control.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter(Boolean),
  );
  ids.add(id);
  control.setAttribute("aria-describedby", Array.from(ids).join(" "));
}
