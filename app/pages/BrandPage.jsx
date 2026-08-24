import {useRef} from 'react';
import SiteHeader from '~/components/ProductShelf/SiteHeader';
import Footer from '~/components/Footer/Footer';
import AnimatedTitle from '~/components/AnimatedTitle/AnimatedTitle';
import BrandShiftLockup from '~/components/Brand/BrandShiftLockup';
import {
  BRAND_CLOSING,
  BRAND_DUALITY,
  BRAND_HERO,
  BRAND_PHILOSOPHY,
} from '~/data/brand';
import aboutHeroVideo from '~/assets/ranbir/hero-vid-v4-BQXzfmRG.mp4';
import '~/components/PDP/ProductPage.css';
import '~/components/Brand/Brand.css';

export default function BrandPage() {
  const pageRef = useRef(null);
  const heroRef = useRef(null);
  const philosophyRef = useRef(null);
  const closeRef = useRef(null);

  return (
    <div ref={pageRef} className="brand-page pdp-page">
      <SiteHeader />

      <main>
        {/* 1 — Hero */}
        <section
          ref={heroRef}
          className="brand-hero"
          aria-label="Flux Theory brand"
        >
          <video
            className="brand-hero__video"
            src={aboutHeroVideo}
            preload="auto"
            autoPlay
            muted
            loop
            playsInline
            aria-hidden="true"
          />
          <div className="brand-hero__overlay" aria-hidden="true" />
          <div className="brand-inner brand-hero__content">
            <BrandShiftLockup className="brand-hero__lockup" />
            <AnimatedTitle
              as="p"
              className="brand-hero__tagline"
              blurSweep
              lines={BRAND_HERO.taglineLines}
              scrollTrigger={{trigger: heroRef, start: 'top 70%'}}
            />
          </div>
        </section>

        {/* 2 — Philosophy */}
        <section
          ref={philosophyRef}
          className="brand-section brand-philosophy"
          aria-label="Philosophy"
        >
          <div className="brand-inner brand-philosophy__grid">
            {/* Final silhouette/portrait asset TBD — brand photo library. */}
            <div
              className="brand-placeholder brand-placeholder--portrait"
              role="img"
              aria-label="Placeholder for brand portrait photography"
            >
              <span className="brand-placeholder__label">Image mood · silhouette</span>
            </div>
            <div className="brand-philosophy__copy">
              <p className="brand-eyebrow">{BRAND_PHILOSOPHY.eyebrow}</p>
              <AnimatedTitle
                as="h2"
                className="brand-display brand-h-section brand-philosophy__title"
                blurSweep
                lines={BRAND_PHILOSOPHY.titleLines}
                scrollTrigger={{trigger: philosophyRef, start: 'top 75%'}}
              />
              {BRAND_PHILOSOPHY.paragraphs.map((text) => (
                <p key={text.slice(0, 32)} className="brand-body">
                  {text}
                </p>
              ))}
            </div>
          </div>
        </section>

        {/* 3 — Industrial Chic (Archetypes lives on About Us below the bento) */}
        <section className="brand-section brand-duality" aria-label="Industrial Chic">
          <div className="brand-inner">
            <p className="brand-eyebrow">{BRAND_DUALITY.eyebrow}</p>
            <div className="brand-duality__block brand-duality__block--industrial">
              <div className="brand-duality__copy">
                <h2 className="brand-display brand-h-section">
                  {BRAND_DUALITY.industrial.title}
                </h2>
                <p className="brand-body">{BRAND_DUALITY.industrial.body}</p>
              </div>
              {/* Final metal-texture asset TBD — brand photo library. */}
              <div
                className="brand-placeholder brand-placeholder--metal"
                role="img"
                aria-label="Placeholder for industrial metal texture"
              >
                <span className="brand-placeholder__label">Metal texture</span>
              </div>
            </div>
          </div>
        </section>

        {/* 4 — Closing */}
        <section
          ref={closeRef}
          className="brand-closing"
          aria-label="Embrace your flux"
        >
          <div className="brand-inner brand-closing__content">
            <AnimatedTitle
              as="h2"
              className="brand-closing__title"
              blurSweep
              lines={BRAND_CLOSING.lines}
              scrollTrigger={{trigger: closeRef, start: 'top 75%'}}
            />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
