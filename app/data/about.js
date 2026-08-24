export const ABOUT_MARQUEE_ITEMS = [
  'BUILT AROUND ONE IDEA',
  'FIVE PERSONAS',
  'CLINICALLY BACKED',
  'MADE IN INDIA',
  'NO COMPROMISES',
];

/**
 * Combined “Built On Belief. Backed By Proof.” bento — replaces the old
 * Beliefs 4-card grid and Backed-by-Science stats section.
 */
export const ABOUT_BENTO = {
  title: 'Built On Belief.\nBacked By Proof.',
  image: {
    caption: 'Five Formulas. One Belief.',
    alt: 'Flux Theory product lifestyle',
  },
  freeFrom: {
    value: '0',
    label:
      'Sulphates, parabens, formaldehyde, EDTA, silicones. Across every single formula.',
  },
  clinical: {
    icon: 'flask',
    title: 'Clinically Informed, Not Clinically Cold',
    body: 'Every formula is built on real actives at real concentrations. We show you the numbers because the numbers are the point.',
    cta: {label: 'Read More', href: '#about-closing'},
  },
  beliefs: {
    heading: 'What We Believe',
    items: [
      {
        icon: 'user',
        title: 'Identity Over Ingredients',
        body: 'We start with the person, not the ingredient list.',
      },
      {
        icon: 'drop',
        title: 'A Shower Is Not a Chore',
        body: 'Function is the floor, not the ceiling.',
      },
      {
        icon: 'shield',
        title: "Free From What Doesn't Belong",
        body: 'A formulation constraint we work within, not a marketing line.',
      },
    ],
  },
  formulas: {
    value: '5',
    label: 'Formulas. Five states of mind.',
  },
};
