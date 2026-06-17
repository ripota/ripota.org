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

export type FooterLinkGroup = {
  label: string;
  links: ExternalLink[];
  variant: "site" | "official-pota";
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
  src: "/assets/rhode-island-coast-hero.jpg",
  alt: "A rocky Rhode Island shoreline looking toward the ocean with a lighthouse and coastal buildings in the distance.",
  source: "User-owned Rhode Island coastal field photo, cropped and stripped of metadata for ripota.org.",
} as const;

export const defaultShareImage = {
  src: "/assets/ripota-share-card.png",
  alt: "A Rhode Island shoreline photo with the RI POTA logo and Rhode Island POTA title overlaid.",
  width: 1600,
  height: 900,
  type: "image/png",
} as const;

export const primaryCallsToAction: CallToAction[] = [
  {
    label: "Activate All RI 2026",
    href: "/activate-ri-2026/",
    description: "Open the Activate All RI 2026 project page.",
    variant: "primary",
  },
  {
    label: "Join the RI POTA community",
    href: "https://groups.io/g/RI-POTA",
    description: "Coordinate activations and local conversation with Rhode Island operators.",
    variant: "secondary",
  },
  {
    label: "Start with official POTA",
    href: "https://docs.pota.app/",
    description: "Read the official program documentation before your first activation.",
    variant: "secondary",
  },
];

export const siteFeedbackLink = {
  label: "Suggest a site improvement",
  href: "https://github.com/ripota/ripota.org/issues/new?template=site-suggestion.yml",
  description: "Suggest a correction, broken-link fix, or local-resource improvement for ripota.org.",
} satisfies ExternalLink;

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
  {
    eyebrow: "Planning locally?",
    heading: "Share access notes and rove ideas",
    body: "RI POTA helps local activators and hunters compare access notes, coordinate roves, and keep Rhode Island activity visible while official POTA systems handle rules, awards, spots, and logs.",
    action: {
      label: "Join local coordination",
      href: "https://groups.io/g/RI-POTA",
      description: "Coordinate Rhode Island POTA activity with the local Groups.io community.",
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

export const resourceIntro =
  "Browse the current Parks on the Air references associated with Rhode Island, including parks, refuges, forests, management areas, and multi-state references that include RI. Use the map to get oriented, then open POTA for the latest reference details before activating.";

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

export const footerLinkGroups: FooterLinkGroup[] = [
  {
    label: "RI POTA",
    variant: "site",
    links: [
      {
        label: "Assets",
        href: "/assets/",
        description: "Download Rhode Island POTA community logo assets.",
      },
      siteFeedbackLink,
      ...officialLinks.filter((link) => link.href === "https://groups.io/g/RI-POTA"),
    ],
  },
  {
    label: "Official POTA resources",
    variant: "official-pota",
    links: officialLinks.filter((link) => link.href !== "https://groups.io/g/RI-POTA"),
  },
];
