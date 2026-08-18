import galleryFront from '../assets/pdp/gallery-front.png'
import galleryBack from '../assets/pdp/gallery-back.png'
import galleryLifestyle from '../assets/pdp/gallery-lifestyle.png'
import galleryHuman from '../assets/pdp/gallery-human.png'
import detailBottle from '../assets/pdp/detail-bottle.png'
import lifestyleBanner from '../assets/pdp/lifestyle-banner.png'
import lifestyleBottle from '../assets/pdp/lifestyle-bottle.png'
import howtoMedia from '../assets/pdp/howto-media.png'
import benefit01 from '../assets/pdp/benefit-01.png'
import benefit02 from '../assets/pdp/benefit-02.png'
import benefit03 from '../assets/pdp/benefit-03.png'
import benefit04 from '../assets/pdp/benefit-04.png'
import marqueeMark from '../assets/pdp/marquee-ft.svg'
import dreamerCutout from '../assets/products/dreamer.png'
import { getProductById, products } from './products'

/** PDP content keyed by product id — Figma node 1205:1646 (The Dreamer). */
export const pdpCatalog = {
  'the-dreamer': {
    id: 'the-dreamer',
    slug: 'the-dreamer',
    name: 'The Dreamer',
    focusTitle: 'THE DREAMER',
    breadcrumb: ['Home', 'Best Sellers', 'The Dreamer Bodywash'],
    shortDescription:
      'Every shower has a ritual. Every lather leaves a trace of something bold. Be the bodywash they remember. Every shower has a ritual. Every lather leaves a trace of something bold. Be the bodywash they remember.',
    price: 299.99,
    currency: '₹',
    sizes: ['300ml', '500ml'],
    defaultSize: '300ml',
    gallery: [
      { id: 'front', src: galleryFront, alt: 'The Dreamer bottle — front' },
      { id: 'human', src: galleryHuman, alt: 'The Dreamer — in use' },
      { id: 'lifestyle', src: galleryLifestyle, alt: 'The Dreamer lifestyle' },
      { id: 'back', src: galleryBack, alt: 'The Dreamer bottle — back label' },
    ],
    descriptionTitle: 'Description',
    description:
      'The Dreamer transforms your daily shower into a moment of escape, cleansing deeply while awakening imagination with a refreshing fragrance that leaves your skin energized, your mind calm, and your confidence ready to dream bigger.',
    detailBottle: detailBottle,
    stickyThumb: dreamerCutout,
    accordion: [
      {
        id: 'product-details',
        title: 'Product details',
        defaultOpen: true,
        intro:
          'Crafted with a clinically informed symbiotic blend, this formula supports the gut-skin connection to promote clearer, healthier-looking skin from within.',
        bullets: [
          '300ml or 500ml supply',
          'Advanced synbiotic + antioxidant complex',
          'Supports hair volume and skin clarity',
          'Designed for daily use',
          'Non-GMO, gluten-free formula',
          'No artifical colors or preservatives',
        ],
      },
      {
        id: 'why-love',
        title: 'Why You’ll Love It',
        body: 'A refreshing fragrance that leaves skin energized, mind calm, and confidence ready to dream bigger — without stripping moisture.',
      },
      {
        id: 'suitable-for',
        title: 'Suitable For',
        body: 'All skin types. Ideal for daily use and anyone seeking a calming, hydrating cleanse.',
      },
      {
        id: 'state-of-mind',
        title: 'THE DREAMER STATE OF MIND',
        body: 'Visionary. Imaginative. Exact. Built for the mind that designs before it speaks.',
      },
      {
        id: 'fragrance',
        title: 'Fragrance Notes',
        body: 'Cool depth with a visionary finish — fresh top notes that settle into a lasting dreamlike trail.',
      },
    ],
    marquee: {
      mark: marqueeMark,
      items: ['Detan', 'Odour defence', 'hydrating', 'brightening'],
    },
    lifestyle: {
      banner: lifestyleBanner,
      bottle: lifestyleBottle,
      title: 'The One Who Sees Beyond',
      blurb:
        'Every breakthrough begins as a thought. Every possibility starts with imagination.',
    },
    stats: {
      eyebrow: 'BACKED BY SCIENCE',
      title: 'FORMULATED TO REALLY WORK',
      cards: [
        {
          value: '86%',
          text: 'Crafted with a clinically informed symbiotic blend.',
        },
        {
          value: 'fcra',
          text: 'This formula supports the gut-skin connection',
        },
        {
          value: 'raa',
          text: 'Promote clearer, healthier-looking skin from within.',
        },
        {
          value: '75%',
          text: 'Crafted with a clinically informed symbiotic blend.',
        },
      ],
      footnote:
        'Crafted with a clinically informed symbiotic blend, this formula supports the gut-skin connection to promote clearer, healthier-looking skin from within.',
    },
    howTo: {
      eyebrow: 'how to use',
      title:
        'Turn Every Shower Into A Dreamlike Ritual Of Relaxation And Renewal',
      image: howtoMedia,
      imageAlt: 'Model in motion against a terracotta backdrop',
      steps: [
        {
          title: 'Step 01 : Wet Your Skin',
          body: 'Allow warm water to relax your body and prepare your skin for a gentle, nourishing cleanse.',
        },
        {
          title: 'Step 02 : Lather & Cleanse',
          body: 'Massage across damp skin until a rich, luxurious lather forms effortlessly.',
        },
        {
          title: 'Step 03 : Rinse & Drift Away',
          body: 'Rinse completely, leaving skin refreshed with a soothing, lasting dreamlike fragrance.',
        },
      ],
    },
    benefits: {
      title: ['one daily wash,', 'visible glow over time'],
      cards: [
        {
          id: '01',
          title: 'Clean Formulation',
          body: 'Skin-friendly ingredients for everyday cleansing.',
          image: benefit01,
        },
        {
          id: '02',
          title: 'Rich Creamy Lather',
          body: 'Dense foam that cleanses deeply without stripping moisture.',
          image: benefit02,
        },
        {
          id: '03',
          title: 'Deep Hydration',
          body: 'Locks in moisture for skin that feels soft and refreshed.',
          image: benefit03,
        },
        {
          id: '04',
          title: 'Daily Ritual',
          body: 'Turn every shower into a calming moment of self-care.',
          image: benefit04,
        },
      ],
    },
  },
}

export function getPdpBySlug(slug) {
  return Object.values(pdpCatalog).find((p) => p.slug === slug) ?? null
}

export function getPdpByProductId(id) {
  return pdpCatalog[id] ?? null
}

export function getShelfProductForPdp(slug) {
  const pdp = getPdpBySlug(slug)
  if (!pdp) return null
  return getProductById(pdp.id)
}

/** Similar products strip — reuse shelf catalog cutouts. */
export function getSimilarProducts(excludeId) {
  return products
    .filter((p) => p.id !== excludeId)
    .map((p) => {
      const pdp = getPdpByProductId(p.id)
      return {
        id: p.id,
        name: p.name.replace(
          /\w\S*/g,
          (word) => word.charAt(0) + word.slice(1).toLowerCase(),
        ),
        price: p.price,
        currency: p.currency ?? '₹',
        image: p.image,
        href: pdp ? `/products/${pdp.slug}` : null,
        sizes: pdp?.sizes ?? ['300ml', '500ml'],
        defaultSize: pdp?.defaultSize ?? '300ml',
      }
    })
}
