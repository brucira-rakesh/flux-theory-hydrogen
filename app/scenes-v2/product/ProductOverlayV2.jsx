import { useNavigate } from 'react-router-dom';
import { getProductById } from '../../data/products';
import { getPdpByProductId } from '../../data/pdp';
import { NODE_PRODUCT_ID_MAP } from './constants';
import ProductDetailsV2 from '../../components/ProductShelf/ProductDetailsV2';
import AnimatedDescription from '../../components/AnimatedDescription/AnimatedDescription';
import {oxygenPublicUrl} from '~/lib/oxygenPublicUrl';

// Falls back to this if `nodeName` is ever missing/unrecognized (e.g. before
// the first reveal), so the card always has something valid to render.
const FALLBACK_PRODUCT_ID = 'the-sport';

// The DOM half of the bottle reveal: fades in/out alongside the flight
// itself (driven by `revealed`, which useBottleReveal raises/lowers from
// inside the Canvas — see SceneV2's productRevealed state for the route it
// takes to get here). `nodeName` is the clicked glTF node (see
// NODE_PRODUCT_ID_MAP), resolved to the matching products.js entry so this
// shows the bottle that was actually clicked, not a fixed placeholder.
//
// Lives OUTSIDE the <Canvas>, as a sibling of it inside `.scene-v2`, because
// it's ordinary DOM/React — same placement SceneCaption already uses. Only
// the details card takes pointer events; everything else stays
// click-through so that clicking anywhere else still reaches the canvas and
// sends the bottle back (see useBottleReveal's own click handler).
export default function ProductOverlayV2({ revealed, nodeName }) {
  const navigate = useNavigate();
  const OVERLAY_PRODUCT =
    getProductById(NODE_PRODUCT_ID_MAP[nodeName]) ??
    getProductById(FALLBACK_PRODUCT_ID);

  const handleBuy = (product) => {
    const pdp = getPdpByProductId(product.id);
    if (pdp) {
      navigate(`/products/${pdp.slug}`);
      return;
    }
    console.info('[Flux Theory] Buy Now:', product.id);
  };

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-10 flex h-full flex-col justify-end transition-opacity duration-500 ease-out md:block ${
        revealed ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden={!revealed}
    >
      {/* <img
        src={oxygenPublicUrl("/images/product_text.svg")}
        alt={OVERLAY_PRODUCT?.focusTitle ?? ''}
        draggable={false}
        className="pointer-events-none absolute left-1/2 top-[8%] w-[min(85%,380px)] -translate-x-1/2 select-none"
      /> */}

      <h3
        className={`[font-family:var(--font-title)] text-[clamp(2.25rem,11vw,3.25rem)] font-semibold leading-none tracking-[-0.05em] uppercase md:text-[clamp(2.25rem,4.5vw,3.5rem)] lg:text-[clamp(2.5rem,5vw,4.5rem)] absolute left-1/2 top-[8%] w-[min(85%,380px)] -translate-x-1/2 select-none text-white text-center transition-opacity duration-500 ease-out delay-300 ${
          revealed ? 'opacity-90' : 'opacity-0'
        }`}
      >
        {OVERLAY_PRODUCT?.focusTitle}
      </h3>

      <div className="pointer-events-none absolute bottom-[6%] left-1/2 w-[min(90%,360px)] -translate-x-1/2 text-center text-white [font-family:var(--font-body)] text-sm font-medium leading-[1.45] md:bottom-[8%]">
        {OVERLAY_PRODUCT?.quote ? (
          <AnimatedDescription
            className="m-0 text-center text-inherit"
            replayKey={
              revealed ? OVERLAY_PRODUCT.id : `${OVERLAY_PRODUCT.id}-hidden`
            }
            delay={0.15}
          >
            {OVERLAY_PRODUCT.quote}
          </AnimatedDescription>
        ) : null}
      </div>

      <div className="pointer-events-auto">
        <ProductDetailsV2 product={OVERLAY_PRODUCT} onBuy={handleBuy} />
      </div>
    </div>
  );
}
