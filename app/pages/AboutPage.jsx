import {useRef} from 'react';
import {Link} from 'react-router';
import SiteHeader from '~/components/ProductShelf/SiteHeader';
import FooterV3 from '~/components/Footer/FooterV3';
import AnimatedTitle from '~/components/AnimatedTitle/AnimatedTitle';
import PdpMarquee from '~/components/PDP/PdpMarquee';
import AboutBento from '~/components/About/AboutBento';
import ArchetypesSection from '~/components/About/ArchetypesSection';
import {usePdpMotion} from '~/hooks/usePdpMotion';
import {ABOUT_MARQUEE_ITEMS} from '~/data/about';
import indiaOutline from '~/assets/India_outline.svg';
import aboutHeroVideo from '~/assets/ranbir/hero-vid-v4-BQXzfmRG.mp4';
import aboutOriginImage from '~/assets/about_us/New-bathroom-5.png';
import '~/components/PDP/ProductPage.css';
import '~/components/About/About.css';

export default function AboutPage() {
  const pageRef = useRef(null);
  // Same GSAP marquee driver as PDP — CSS animation is disabled under .pdp-page.
  usePdpMotion(pageRef, {enabled: true});

  return (
    <div ref={pageRef} className="about-page pdp-page">
      <SiteHeader />

      <main>
        {/* 1 — Hero */}
        <section className="about-hero" aria-label="About Us">
          <video
            className="about-hero__video"
            src={aboutHeroVideo}
            preload="auto"
            autoPlay
            muted
            loop
            playsInline
            aria-hidden="true"
          />
          <div className="about-hero__overlay" aria-hidden="true" />
          <div className="about-inner about-hero__content">
            <p className="about-eyebrow">About Us</p>
            <AnimatedTitle
              as="h1"
              className="about-hero__title"
              blurSweep
              lines={[
                "We didn't build",
                'a body wash.',
                'We built five people.',
              ]}
            />
            <p className="about-hero__sub">
              Flux Theory started with a question nobody in the men&apos;s
              grooming aisle was asking: not{' '}
              <em>what does your skin need</em>, but{' '}
              <em>who are you today?</em>
            </p>
          </div>
        </section>

        {/* 2 — Ticker */}
        <PdpMarquee items={ABOUT_MARQUEE_ITEMS} />

        {/* 3 — Built On Belief. Backed By Proof. */}
        <AboutBento />

        {/* 4 — Archetypes (from The Brand) */}
        <ArchetypesSection />

        {/* 5 — Origin */}
        <section className="about-section about-origin" aria-label="The Origin">
          <div className="about-inner">
            <div className="about-origin__grid">
              <div className="about-origin__media">
                <img
                  src={aboutOriginImage}
                  alt="Five Flux Theory bottles on a lit bathroom shelf"
                  className="about-origin__image"
                  draggable={false}
                />
              </div>
              <div className="about-origin__copy">
                <p className="about-eyebrow">The Origin</p>
                <h2 className="about-display about-h-section">
                  One shelf.
                  <br />
                  Five versions of you.
                </h2>
                <div className="about-origin__spacer" />
                <p className="about-body">
                  Most men own one body wash. It sits in the shower for three
                  months and does the same thing every single day, regardless of
                  who&apos;s using it or what kind of day they&apos;ve had.
                </p>
                <p className="about-body">That never made sense to us.</p>
                <p className="about-body">
                  The person who walks into a 6am training session isn&apos;t the
                  same person heading out on a Friday night. The person who&apos;s
                  been in back-to-back meetings needs something different from
                  the one who&apos;s been in the sun since morning. Same skin.
                  Completely different day.
                </p>
                <p className="about-origin__pull">
                  So we stopped formulating for skin types,
                  <br />
                  and started formulating for states of mind.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 5 — Made in India */}
        <section
          className="about-section about-made"
          aria-label="Made in India"
        >
          <div className="about-inner">
            <div className="about-made__grid">
              <div className="about-made__visual">
                <div className="about-made__map-wrap">
                  <img
                    src={indiaOutline}
                    alt=""
                    className="about-made__map"
                    width={667}
                    height={777}
                    draggable={false}
                  />
                </div>
              </div>
              <div className="about-made__copy">
                <p className="about-eyebrow">Made in India</p>
                <h2 className="about-display about-h-section">
                  Built for Indian skin,
                  <br />
                  Indian weather,
                  <br />
                  Indian days.
                </h2>
                <div className="about-made__copy-spacer" />
                <p className="about-body">
                  Humidity that doesn&apos;t quit. Sun that finds you through a
                  car window. Pollution that settles into your skin before noon.
                  Most grooming formulas are developed for climates that look
                  nothing like ours, then imported and marketed as premium.
                </p>
                <p className="about-body">
                  We formulate here, for here. Every product is developed and
                  manufactured in India — tested against the conditions you
                  actually live in, not the ones on a lab report from somewhere
                  else.
                </p>
                <ul className="about-made__list">
                  <li>
                    <span>Formulated</span> India
                  </li>
                  <li>
                    <span>Manufactured</span> India
                  </li>
                  <li>
                    <span>Tested</span> Dermatologically, every batch
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section
          id="about-closing"
          className="about-closing"
          aria-label="Shop the range"
        >
          <div className="about-inner">
            <h2 className="about-closing__title">
              So — who do you
              <br />
              want to be today?
            </h2>
            <p className="about-closing__sub">
              Five formulas. One shelf. Pick the version of you that&apos;s
              showing up.
            </p>
            <Link to="/shop" className="about-btn">
              Shop All
            </Link>
          </div>
        </section>
      </main>

      <FooterV3 />
    </div>
  );
}
