import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
// import bgVideoDesktop from "../../assets/home/product-bg-desktop.mp4";
import bgVideoDesktop from "../../assets/ranbir/bg-v3-hero.mp4";
import bgImageMobile from "../../assets/home/product-bg-mb.webp";
import { prefersReducedMotion } from "../../hooks/useSpotlight";
import { useIsDesktop } from "../../hooks/useIsDesktop";
import { useScrollLock } from "../../hooks/useScrollLock";
import AnimatedTitle from "../AnimatedTitle/AnimatedTitle";
import ProductFormPopup from "../Shop/ProductFormPopup";
import "../Shop/Shop.css";
import ProductV3Card from "./ProductV3Card";

gsap.registerPlugin(ScrollTrigger);

/**
 * ProductV3 — Figma nodes 2810-2976 (stacked rest state) and 2810-2496
 * (spread final state), used by HomeV3Page between the carousel and
 * VideoHeroV3.
 *
 * `products` is fetched server-side from Shopify (see the `loader` in
 * app/lib/homeRoute.jsx → fetchHomeProductCards in app/lib/storefrontCatalog.js)
 * — the same toListingCard() view-model the PLP grid uses, in Figma node
 * 2810-2496's left-to-right order (the-sport/the-lover/the-sage/the-rebel/
 * the-dreamer).
 *
 * A single-viewport section that sits in normal scroll flow — no
 * ScrollTrigger pin/scrub, same as VideoHeroV3. The five cards start
 * fanned into one stack at the row's center (matching 2810-2976, which only
 * ever shows the top card) and animate out to their grid slots (2810-2496)
 * once the section scrolls into view, playing exactly once.
 */
export default function ProductV3({ products = [] }) {
  const sectionRef = useRef(null);
  const cardRefs = useRef([]);
  cardRefs.current = [];
  const isDesktop = useIsDesktop();
  const centerIndex = (products.length - 1) / 2;
  // Same "+" -> quick-add popup flow as the PLP grid (ProductCard.jsx /
  // ShopPage.jsx) — these products have real size variants, so Add to Cart
  // needs a size pick, not a single default-variant add.
  const [activeProduct, setActiveProduct] = useState(null);
  useScrollLock(Boolean(activeProduct));

  const registerCard = (el) => {
    if (el) cardRefs.current.push(el);
  };

  useEffect(() => {
    const cards = cardRefs.current;
    if (!cards.length) return undefined;

    // Grid-only cards can outgrow one screen on narrow viewports where they
    // wrap to 2–3 columns — the stack→spread reveal reads fine on desktop's
    // single row, but on mobile the stacked pose would sit cards on top of
    // each other across what's actually a multi-row grid, so mobile just
    // shows the grid slots directly, same as reduced motion.
    if (prefersReducedMotion() || !isDesktop) {
      gsap.set(cards, { clearProps: "all" });
      return undefined;
    }

    let played = false;

    // Re-measured (not just computed once) so a resize before the reveal
    // plays doesn't leave cards stacked at a stale, now-wrong center point.
    const applyStackPose = () => {
      const centerCard = cards[Math.round(centerIndex)];
      const centerRect = centerCard.getBoundingClientRect();
      const centerX = centerRect.left + centerRect.width / 2;
      const centerY = centerRect.top + centerRect.height / 2;

      cards.forEach((card, i) => {
        const rect = card.getBoundingClientRect();
        const isCenter = i === Math.round(centerIndex);
        const isPeek = i === Math.round(centerIndex) + 1;
        gsap.set(card, {
          x: centerX - (rect.left + rect.width / 2),
          y: centerY - (rect.top + rect.height / 2),
          rotate: (i - centerIndex) * 6,
          scale: 0.86,
          opacity: isCenter || isPeek ? 1 : 0,
          zIndex: 10 - Math.abs(i - centerIndex),
        });
      });
    };

    applyStackPose();

    const onResize = () => {
      if (!played) applyStackPose();
    };
    window.addEventListener("resize", onResize);

    const st = ScrollTrigger.create({
      trigger: sectionRef.current,
      start: "top 70%",
      once: true,
      onEnter: () => {
        played = true;
        gsap.to(cards, {
          x: 0,
          y: 0,
          rotate: 0,
          scale: 1,
          opacity: 1,
          zIndex: 1,
          duration: 1.1,
          delay: 1,
          ease: "power3.out",
          stagger: 0.08,
        });
      },
    });

    return () => {
      window.removeEventListener("resize", onResize);
      st.kill();
      gsap.killTweensOf(cards);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative z-[21] min-h-dvh w-full overflow-hidden bg-[#0d1b24] lg:h-dvh"
    >
      {isDesktop ? (
        <video
          className="absolute inset-0 h-full w-full object-cover object-center"
          src={bgVideoDesktop}
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
        />
      ) : (
        <img
          src={bgImageMobile}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
      )}
      <div className="absolute inset-0 bg-black/45" aria-hidden="true" />

      {/* Grid-only cards can outgrow one screen on narrow viewports where
          they wrap to 2–3 columns — `min-h-dvh` + normal flow (instead of a
          fixed `h-dvh`) lets the section grow to fit them instead of
          clipping, while `lg:h-dvh` keeps it a true single screen on desktop
          where all 5 fit in one row, matching Figma. */}
      {/* Deliberately `relative` with NO z-index: a z-index would make this a
          stacking context, which isolates the title's mix-blend-mode so it
          composites against this (transparent) box instead of the background
          image and dim overlay behind it. As positioned elements with
          `z-index: auto` paint in DOM order, coming last still keeps this
          above both overlays. */}
      <div className="app-container relative flex min-h-dvh flex-col items-center justify-center gap-8 md:gap-[6vh] py-[115px] md:py-28 lg:h-full lg:py-0">
        <div className="mix-blend-overlay md:mix-blend-soft-light">
          <AnimatedTitle
            as="h2"
            className="select-none text-center [font-family:var(--font-title)] text-[clamp(2rem,13vw,58px)] font-semibold uppercase leading-none tracking-[-2.6px] text-white  mix-blend-overlay lg:text-[clamp(2rem,5vw,4rem)] lg:tracking-tighter lg:opacity-100 lg:mix-blend-normal"
            lines={["Who Do You Want", "To Be Today?"]}
            scrollTrigger={{ trigger: sectionRef, start: "top 70%" }}
            blurSweep
          />
        </div>

        <div className="grid w-full max-w-[1400px] grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 lg:gap-6">
          {products.map((product, index) => {
            if (!product) return null;
            return (
              <ProductV3Card
                key={product.id ?? index}
                product={product}
                ref={registerCard}
                onQuickAdd={setActiveProduct}
                quickAddOpen={activeProduct?.listId === product.listId}
              />
            );
          })}
        </div>
      </div>

      {activeProduct && (
        <ProductFormPopup
          product={activeProduct}
          onClose={() => setActiveProduct(null)}
        />
      )}
    </section>
  );
}
