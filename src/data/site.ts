export type ExternalLink = {
  label: string;
  href: string;
  description: string;
};

export type CallToAction = ExternalLink & {
  variant: "primary" | "secondary";
};

export type PathCardContent = {
  heading: string;
  eyebrow: string;
  body: string;
  action: ExternalLink;
};

export const siteIdentity = {
  name: "Rhode Island POTA",
  shortName: "RI POTA",
  url: "https://ripota.org",
  tagline: "A local field guide for Rhode Island Parks on the Air.",
  isOfficialPotaSite: false,
  disclaimer:
    "Rhode Island POTA is a community-run site and is not an official Parks on the Air property. Official POTA resources remain the source of truth for rules, references, accounts, spots, and logs.",
} as const;

export const heroImage = {
  src: "/assets/coastal-field-journal-hero.jpg",
  alt: "A quiet rocky Rhode Island-style shoreline with coastal shrubs, calm water, and a small lighthouse marker in soft morning light.",
  source:
    "Generated project asset for ripota.org; replace with a user-owned Rhode Island field photo when available.",
} as const;

export const primaryCallsToAction: CallToAction[] = [
  {
    label: "Join the RI POTA community",
    href: "https://groups.io/g/RI-POTA",
    description: "Coordinate activations and local conversation with Rhode Island operators.",
    variant: "primary",
  },
  {
    label: "Start with official POTA",
    href: "https://docs.pota.app/",
    description: "Read the official program documentation before your first activation.",
    variant: "secondary",
  },
];

export const pathCards: PathCardContent[] = [
  {
    eyebrow: "Already active in RI?",
    heading: "Coordinate with nearby operators",
    body: "Use the local community list to compare plans, share field notes, and keep Rhode Island activations visible without replacing official POTA tools.",
    action: {
      label: "Open RI POTA Groups.io",
      href: "https://groups.io/g/RI-POTA",
      description: "Visit the Rhode Island POTA Groups.io community.",
    },
  },
  {
    eyebrow: "New to POTA?",
    heading: "Start with the official rules",
    body: "Parks on the Air is approachable, but official documentation is the right first stop for accounts, logging, spotting, references, and awards.",
    action: {
      label: "Read POTA docs",
      href: "https://docs.pota.app/",
      description: "Visit official Parks on the Air documentation.",
    },
  },
];

export const resourceLinks: ExternalLink[] = [
  {
    label: "Search official POTA references",
    href: "https://pota.app/#/map",
    description: "Use the official POTA map and search tools for current park references.",
  },
  {
    label: "Open POTA app",
    href: "https://pota.app/",
    description: "Go to the official POTA application for accounts, spots, and logs.",
  },
];

export const officialLinks: ExternalLink[] = [
  {
    label: "POTA documentation",
    href: "https://docs.pota.app/",
    description: "Official program documentation and operating guidance.",
  },
  {
    label: "POTA app",
    href: "https://pota.app/",
    description: "Official accounts, spots, logs, awards, and map tools.",
  },
  {
    label: "Rules and resources",
    href: "https://docs.pota.app/docs/rules.html",
    description: "Official rules and program requirements.",
  },
  {
    label: "RI POTA Groups.io",
    href: "https://groups.io/g/RI-POTA",
    description: "Local Rhode Island community discussion and coordination.",
  },
];
