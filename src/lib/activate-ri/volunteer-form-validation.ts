type TopLevelRequiredField =
  | "submitterCallsign"
  | "submitterName"
  | "submitterEmail";

type StopRequiredField =
  | "park"
  | "plannedDate"
  | "timeBlock"
  | "bands"
  | "modes";

export type VolunteerRequiredField =
  | TopLevelRequiredField
  | `stop.${number}.${StopRequiredField}`;

const topLevelLabels: Record<TopLevelRequiredField, string> = {
  submitterCallsign: "Callsign",
  submitterName: "Name",
  submitterEmail: "Email",
};

const topLevelMessages: Record<TopLevelRequiredField, string> = {
  submitterCallsign: "Enter your callsign.",
  submitterName: "Enter your name.",
  submitterEmail: "Enter your email address.",
};

const stopLabels: Record<StopRequiredField, string> = {
  park: "park",
  plannedDate: "date",
  timeBlock: "time block",
  bands: "bands",
  modes: "modes",
};

const stopMessages: Record<StopRequiredField, string> = {
  park: "Choose a park from the suggestions.",
  plannedDate: "Choose a date",
  timeBlock: "Choose a time block",
  bands: "Choose at least one band",
  modes: "Choose at least one mode",
};

export function formatVolunteerMissingFieldSummary(fields: VolunteerRequiredField[]): string {
  return formatFieldSummary("Please complete these required fields", fields);
}

export function formatVolunteerProblemFieldSummary(fields: VolunteerRequiredField[]): string {
  return formatFieldSummary("Please fix these fields", fields);
}

function formatFieldSummary(prefix: string, fields: VolunteerRequiredField[]): string {
  const uniqueLabels = Array.from(new Set(fields.map(volunteerRequiredFieldLabel)));

  if (uniqueLabels.length === 0) {
    return "";
  }

  return `${prefix}: ${uniqueLabels.join(", ")}.`;
}

export function volunteerRequiredFieldLabel(field: VolunteerRequiredField): string {
  if (isTopLevelRequiredField(field)) {
    return topLevelLabels[field];
  }

  const stopField = parseStopRequiredField(field);

  return `Activation stop ${stopField.index + 1} ${stopLabels[stopField.name]}`;
}

export function volunteerRequiredFieldMessage(field: VolunteerRequiredField): string {
  if (isTopLevelRequiredField(field)) {
    return topLevelMessages[field];
  }

  const stopField = parseStopRequiredField(field);
  const message = stopMessages[stopField.name];

  if (stopField.name === "park") {
    return message;
  }

  return `${message} for activation stop ${stopField.index + 1}.`;
}

function isTopLevelRequiredField(field: VolunteerRequiredField): field is TopLevelRequiredField {
  return field in topLevelLabels;
}

function parseStopRequiredField(field: VolunteerRequiredField): {
  index: number;
  name: StopRequiredField;
} {
  const match = /^stop\.(\d+)\.(park|plannedDate|timeBlock|bands|modes)$/.exec(field);

  if (!match) {
    throw new Error(`Unknown volunteer form field: ${field}`);
  }

  return {
    index: Number(match[1]),
    name: match[2] as StopRequiredField,
  };
}
