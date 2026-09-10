import {useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {useFetcher} from 'react-router';
import {useSmoothScrollLock} from '~/components/SmoothScroll/SmoothScroll';
import starEmpty from '~/assets/pdp/reviews/star-empty.svg';
import starFilled from '~/assets/pdp/reviews/star-filled.svg';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PHOTOS = 4;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

/**
 * @typedef {{
 *   id: string,
 *   previewUrl: string,
 *   status: 'uploading' | 'ready' | 'error',
 *   cdnUrl?: string,
 *   error?: string,
 * }} ReviewPhotoItem
 */

/**
 * Review write modal — Address Add/Edit pattern:
 * centered desktop overlay, bottom sheet ≤640px.
 *
 * Photos: local preview immediately; each file uploads independently via
 * Admin Files API. Failed uploads never block review submit.
 *
 * @param {{
 *   open: boolean,
 *   initialRating?: number | null,
 *   onClose: () => void,
 *   onSuccess: () => void,
 * }} props
 */
export default function FluxPdpReviewModal({
  open,
  initialRating = null,
  onClose,
  onSuccess,
}) {
  const titleId = useId();
  const closeRef = useRef(null);
  const fileInputRef = useRef(null);
  const photosRef = useRef(/** @type {ReviewPhotoItem[]} */ ([]));
  const fetcher = useFetcher();
  const busy = fetcher.state !== 'idle';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState(/** @type {ReviewPhotoItem[]} */ ([]));
  const [clientError, setClientError] = useState('');
  const [listenForResult, setListenForResult] = useState(false);

  photosRef.current = photos;

  useSmoothScrollLock('flux-pdp-review-modal', open);

  // Pre-fill rating when opened; ignore stale fetcher errors from prior attempts.
  useEffect(() => {
    if (!open) return;
    setClientError('');
    setListenForResult(false);
    const next =
      Number.isInteger(initialRating) &&
      initialRating >= 1 &&
      initialRating <= 5
        ? initialRating
        : 0;
    setRating(next);
    setHoverRating(0);
  }, [open, initialRating]);

  // Escape only — scroll lock is owned solely by useSmoothScrollLock so every
  // close path (X, backdrop, Escape, submit) releases through one mechanism.
  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, busy]);

  useEffect(() => {
    if (!listenForResult || fetcher.state !== 'idle' || !fetcher.data) return;
    if (fetcher.data.ok) {
      for (const photo of photosRef.current) {
        URL.revokeObjectURL(photo.previewUrl);
      }
      setName('');
      setEmail('');
      setRating(0);
      setTitle('');
      setBody('');
      setPhotos([]);
      setClientError('');
      setListenForResult(false);
      onSuccess();
      return;
    }
    if (fetcher.data.error) {
      setClientError(String(fetcher.data.error));
    }
  }, [listenForResult, fetcher.state, fetcher.data, onSuccess]);

  useEffect(() => {
    return () => {
      for (const photo of photosRef.current) {
        URL.revokeObjectURL(photo.previewUrl);
      }
    };
  }, []);

  if (!open || typeof document === 'undefined') return null;

  const errorMessage = clientError;
  const readyUrls = photos
    .filter((photo) => photo.status === 'ready' && photo.cdnUrl)
    .map((photo) => photo.cdnUrl);

  function validate() {
    if (!name.trim()) return 'Please enter your name.';
    if (!email.trim() || !EMAIL_RE.test(email.trim())) {
      return 'Please enter a valid email address.';
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return 'Please select a star rating.';
    }
    if (!body.trim()) return 'Please write your review.';
    return '';
  }

  /**
   * @param {SubmitEvent} event
   */
  function handleSubmit(event) {
    const message = validate();
    if (message) {
      event.preventDefault();
      setClientError(message);
      setListenForResult(false);
    } else {
      setClientError('');
      setListenForResult(true);
    }
  }

  /**
   * @param {import('react').ChangeEvent<HTMLInputElement>} event
   */
  function handlePhotoPick(event) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;

    const remaining = MAX_PHOTOS - photosRef.current.length;
    if (remaining <= 0) return;

    const nextFiles = files.slice(0, remaining);
    /** @type {ReviewPhotoItem[]} */
    const created = nextFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading',
    }));

    setPhotos((prev) => [...prev, ...created]);

    created.forEach((item, index) => {
      void uploadOnePhoto(item.id, nextFiles[index]);
    });
  }

  /**
   * @param {string} id
   * @param {File} file
   */
  async function uploadOnePhoto(id, file) {
    try {
      const formData = new FormData();
      formData.append('photo', file);

      const response = await fetch('/api/review-photo', {
        method: 'POST',
        body: formData,
        headers: {Accept: 'application/json'},
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || !payload?.url) {
        const message =
          (typeof payload?.error === 'string' && payload.error) ||
          'Upload failed.';
        setPhotos((prev) =>
          prev.map((photo) =>
            photo.id === id
              ? {...photo, status: 'error', error: message}
              : photo,
          ),
        );
        return;
      }

      setPhotos((prev) =>
        prev.map((photo) =>
          photo.id === id
            ? {...photo, status: 'ready', cdnUrl: String(payload.url)}
            : photo,
        ),
      );
    } catch {
      setPhotos((prev) =>
        prev.map((photo) =>
          photo.id === id
            ? {...photo, status: 'error', error: 'Upload failed.'}
            : photo,
        ),
      );
    }
  }

  /**
   * @param {string} id
   */
  function removePhoto(id) {
    setPhotos((prev) => {
      const target = prev.find((photo) => photo.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((photo) => photo.id !== id);
    });
  }

  const displayRating = hoverRating || rating;

  return createPortal(
    <div className="flux-pdp-review-modal" role="presentation">
      <button
        type="button"
        className="flux-pdp-review-modal__backdrop"
        aria-label="Close review form"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        className="flux-pdp-review-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-lenis-prevent
        data-lenis-prevent-wheel
        data-lenis-prevent-touch
      >
        <div className="flux-pdp-review-modal__head">
          <h3 id={titleId}>Write a review</h3>
          <button
            ref={closeRef}
            type="button"
            className="flux-pdp-review-modal__close"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <fetcher.Form
          method="post"
          className="flux-pdp-review-modal__form"
          onSubmit={handleSubmit}
        >
          <div
            className="flux-pdp-review-modal__fields"
            data-lenis-prevent
            data-lenis-prevent-wheel
            data-lenis-prevent-touch
          >
            <input type="hidden" name="intent" value="judgeme-review" />
            <input type="hidden" name="rating" value={rating || ''} />
            {readyUrls.map((url) => (
              <input key={url} type="hidden" name="picture_urls" value={url} />
            ))}

            <label className="flux-pdp-review-modal__field">
              <span>Your name</span>
              <input
                type="text"
                name="name"
                autoComplete="name"
                required
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>

            <label className="flux-pdp-review-modal__field">
              <span>Email</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <fieldset className="flux-pdp-review-modal__rating">
              <legend>Rating</legend>
              <div
                className="flux-pdp-review-modal__stars"
                onMouseLeave={() => setHoverRating(0)}
              >
                {Array.from({length: 5}, (_, index) => {
                  const value = index + 1;
                  const filled = value <= displayRating;
                  return (
                    <button
                      key={value}
                      type="button"
                      className={`flux-pdp-review-modal__star${filled ? ' is-filled' : ''}`}
                      aria-label={`${value} star${value === 1 ? '' : 's'}`}
                      aria-pressed={rating === value}
                      disabled={busy}
                      onMouseEnter={() => setHoverRating(value)}
                      onFocus={() => setHoverRating(value)}
                      onBlur={() => setHoverRating(0)}
                      onClick={() => {
                        setRating(value);
                        setClientError('');
                      }}
                    >
                      <img
                        src={filled ? starFilled : starEmpty}
                        alt=""
                        width={32}
                        height={32}
                        draggable={false}
                      />
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label className="flux-pdp-review-modal__field">
              <span>
                Title <em>(optional)</em>
              </span>
              <input
                type="text"
                name="title"
                value={title}
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            <label className="flux-pdp-review-modal__field">
              <span>Your review</span>
              <textarea
                name="body"
                rows={5}
                required
                value={body}
                disabled={busy}
                onChange={(event) => setBody(event.target.value)}
              />
            </label>

            <div className="flux-pdp-review-modal__photos">
              <div className="flux-pdp-review-modal__photos-head">
                <span>
                  Photos <em>(optional)</em>
                </span>
                {photos.length < MAX_PHOTOS ? (
                  <button
                    type="button"
                    className="flux-pdp-review-modal__photos-add"
                    disabled={busy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Add photos
                  </button>
                ) : null}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                multiple
                hidden
                disabled={busy}
                onChange={handlePhotoPick}
              />
              {photos.length ? (
                <ul className="flux-pdp-review-modal__photo-list">
                  {photos.map((photo) => (
                    <li
                      key={photo.id}
                      className={`flux-pdp-review-modal__photo flux-pdp-review-modal__photo--${photo.status}`}
                    >
                      <img src={photo.previewUrl} alt="" draggable={false} />
                      {photo.status === 'uploading' ? (
                        <span className="flux-pdp-review-modal__photo-status">
                          Uploading…
                        </span>
                      ) : null}
                      {photo.status === 'error' ? (
                        <span
                          className="flux-pdp-review-modal__photo-status"
                          role="alert"
                        >
                          {photo.error || 'Failed'}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="flux-pdp-review-modal__photo-remove"
                        aria-label="Remove photo"
                        disabled={busy}
                        onClick={() => removePhoto(photo.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flux-pdp-review-modal__photos-hint">
                  Up to {MAX_PHOTOS} images. Failed uploads won&apos;t block
                  your review.
                </p>
              )}
            </div>

            {errorMessage ? (
              <p className="flux-pdp-review-modal__error" role="alert">
                {errorMessage}
              </p>
            ) : null}
          </div>

          <div className="flux-pdp-review-modal__actions">
            <button
              type="submit"
              className="flux-pdp-review-modal__submit"
              disabled={busy}
            >
              {busy ? 'Submitting…' : 'Submit review'}
            </button>
            <button
              type="button"
              className="flux-pdp-review-modal__cancel"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>,
    document.body,
  );
}
