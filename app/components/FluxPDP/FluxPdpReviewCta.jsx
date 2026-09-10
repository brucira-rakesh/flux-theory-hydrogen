import {useCallback, useState} from 'react';
import FluxPdpReviewEmpty from '~/components/FluxPDP/FluxPdpReviewEmpty';
import FluxPdpReviewModal from '~/components/FluxPDP/FluxPdpReviewModal';
import FluxPdpReviewWall from '~/components/FluxPDP/FluxPdpReviewWall';

/**
 * Reviews section — State 1 (empty CTA) vs State 2 (reviews wall).
 * Driven by loader data from Judge.me (server-side only).
 * Owns the shared write-a-review modal for both states.
 *
 * @param {{
 *   reviews?: {
 *     hasReviews: boolean,
 *     summary: {rating: string, body: string, trust: string, avatars?: string[]},
 *     cards: Array<{
 *       id: string,
 *       order: Array<'reviewer' | 'photo' | 'quote'>,
 *       reviewer: {name: string, rating: number, avatar?: string | null},
 *       quote?: string | null,
 *       photo?: string | null,
 *     }>,
 *   } | null,
 * }} props
 */
export default function FluxPdpReviewCta({reviews = null}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [initialRating, setInitialRating] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  const openReview = useCallback((rating = null) => {
    setSuccessMessage('');
    setInitialRating(
      Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    );
    setModalOpen(true);
  }, []);

  const closeReview = useCallback(() => {
    setModalOpen(false);
    setInitialRating(null);
  }, []);

  const handleSuccess = useCallback(() => {
    setModalOpen(false);
    setInitialRating(null);
    setSuccessMessage('Thanks! Your review will appear once approved.');
  }, []);

  const hasWall = Boolean(reviews?.hasReviews && reviews.cards?.length);

  return (
    <div className="flux-pdp-review-cta">
      {successMessage ? (
        <p className="flux-pdp-review-cta__success" role="status">
          {successMessage}
        </p>
      ) : null}

      {hasWall ? (
        <FluxPdpReviewWall
          summary={reviews.summary}
          cards={reviews.cards}
          onWriteReview={() => openReview()}
        />
      ) : (
        <FluxPdpReviewEmpty
          onWriteReview={() => openReview()}
          onStarClick={(rating) => openReview(rating)}
        />
      )}

      <FluxPdpReviewModal
        open={modalOpen}
        initialRating={initialRating}
        onClose={closeReview}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
