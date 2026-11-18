import type { EmotionCardPresentation } from '../../types/chapter.ts';

export function MimoraBrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect width="40" height="40" rx="12" fill="#E8F4F1" />
      <path
        d="M11.5 23.5C11.5 16.596 16.5 11 22.8 11C25.9 11 28.5 12.6 29.8 14.9C27.2 15.1 24.4 16.9 22.8 20.1C21.2 23.3 18.2 26.8 14.2 27.6C12.5 26.8 11.5 25.3 11.5 23.5Z"
        fill="#1A6F6B"
      />
      <circle cx="25.5" cy="24.5" r="5.5" fill="#DF856F" />
      <circle cx="15.5" cy="14" r="3" fill="#B2A3DC" />
    </svg>
  );
}

export function WelcomeGardenIllustration() {
  return (
    <svg
      viewBox="0 0 360 220"
      fill="none"
      aria-hidden="true"
      className="w-full max-w-[340px] h-auto"
    >
      <rect width="360" height="220" rx="28" fill="#FAF6ED" />
      {/* Gentle sunbeam & soft clouds */}
      <circle cx="292" cy="54" r="24" fill="#F8E19C" />
      <path
        d="M58 64C58 55.716 64.716 49 73 49C76.2 49 79.1 50 81.5 51.7C84.2 45.9 90.1 42 97 42C106.4 42 114 49.6 114 59C114 59.5 114 60 113.9 60.5C118.4 61.8 121.8 66 121.8 71C121.8 77.1 116.9 82 110.8 82H68C62.5 82 58 77.5 58 72V64Z"
        fill="#FFFFFF"
      />
      {/* Rolling calm meadow hills */}
      <path
        d="M0 156C56 130 124 132 184 154C244 176 306 168 360 144V220H0V156Z"
        fill="#D6EDE6"
      />
      <path
        d="M0 176C72 162 146 164 214 182C268 196 318 192 360 178V220H0V176Z"
        fill="#BCE0D5"
      />
      {/* Open illustrated story cushion & calm lantern */}
      <rect x="116" y="108" width="128" height="74" rx="16" fill="#FFFFFF" stroke="#C5DFD8" strokeWidth="2" />
      <path d="M180 112V178" stroke="#DFD9CE" strokeWidth="2" strokeLinecap="round" />
      <rect x="132" y="124" width="34" height="10" rx="5" fill="#F8E19C" />
      <rect x="132" y="142" width="34" height="6" rx="3" fill="#E8F4F1" />
      <rect x="132" y="154" width="26" height="6" rx="3" fill="#E8F4F1" />
      <circle cx="212" cy="140" r="14" fill="#FCE5DC" />
      <path d="M204 146C207.5 141 215.5 141 219 146" stroke="#B84F3B" strokeWidth="2.5" strokeLinecap="round" />
      {/* Friendly stepped stepping stones */}
      <ellipse cx="64" cy="192" rx="20" ry="9" fill="#F1EEF9" />
      <ellipse cx="300" cy="194" rx="22" ry="9" fill="#FDF0EB" />
    </svg>
  );
}

/**
 * Non-prescriptive emotion visuals representing inner energy/sensations through natural forms
 * (sunbeams, water ripples, gentle breeze, cozy clouds) rather than fixed facial templates.
 */
export function EmotionVisual({
  motif,
}: {
  motif: EmotionCardPresentation['motifs'];
}) {
  return (
    <svg viewBox="0 0 96 72" fill="none" aria-hidden="true" className="w-24 h-18 shrink-0">
      {motif === 'sunbeam' && (
        <>
          <rect width="96" height="72" rx="16" fill="#FDF6DE" />
          <circle cx="48" cy="36" r="16" fill="#F3CA62" />
          <path d="M48 12V16M48 56V60M24 36H28M68 36H72M31 19L34 22M62 50L65 53M65 19L62 22M34 50L31 53" stroke="#C98D1D" strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}
      {motif === 'ripple' && (
        <>
          <rect width="96" height="72" rx="16" fill="#E8F4F1" />
          <circle cx="48" cy="36" r="22" stroke="#9ACFC4" strokeWidth="2.5" />
          <circle cx="48" cy="36" r="14" stroke="#53A89C" strokeWidth="2.5" />
          <circle cx="48" cy="36" r="6" fill="#1A6F6B" />
        </>
      )}
      {motif === 'breeze' && (
        <>
          <rect width="96" height="72" rx="16" fill="#F1EEF9" />
          <path d="M18 28H64C69 28 72 24.5 72 21C72 17.5 69 14.5 65 14.5C61.5 14.5 59 17 59 19.5" stroke="#6E5FA8" strokeWidth="3" strokeLinecap="round" />
          <path d="M22 40H74" stroke="#9385C7" strokeWidth="3" strokeLinecap="round" />
          <path d="M28 52H56C60.5 52 63.5 55 63.5 58.5C63.5 61.5 60.5 64 57 64" stroke="#6E5FA8" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {motif === 'cloud' && (
        <>
          <rect width="96" height="72" rx="16" fill="#F3EFE8" />
          <path
            d="M25 46C20 46 16 42 16 37C16 32.3 19.6 28.5 24.2 28C26 21.6 31.8 17 38.8 17C46.5 17 52.8 22.6 53.9 30C55.1 29.4 56.5 29 58 29C63.5 29 68 33.5 68 39C68 42.8 64.9 46 61 46H25Z"
            fill="#CBD5D8"
          />
          <path d="M36 53V57M48 53V59M60 53V57" stroke="#6D8690" strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}
      {motif === 'spark' && (
        <>
          <rect width="96" height="72" rx="16" fill="#FDF0EB" />
          <path
            d="M48 16L53.5 30.5L68 36L53.5 41.5L48 56L42.5 41.5L28 36L42.5 30.5L48 16Z"
            fill="#DF856F"
          />
          <circle cx="72" cy="20" r="3.5" fill="#F3CA62" />
        </>
      )}
      {motif === 'shelter' && (
        <>
          <rect width="96" height="72" rx="16" fill="#E8F4F1" />
          <path d="M22 44C22 29.6 33.6 18 48 18C62.4 18 74 29.6 74 44" stroke="#1A6F6B" strokeWidth="3.5" strokeLinecap="round" />
          <rect x="30" y="42" width="36" height="14" rx="7" fill="#B2A3DC" />
        </>
      )}
    </svg>
  );
}

export function StoryBookIllustration() {
  return (
    <svg viewBox="0 0 160 110" fill="none" aria-hidden="true" className="w-36 h-24 shrink-0">
      <rect width="160" height="110" rx="20" fill="#F1EEF9" />
      <rect x="24" y="22" width="112" height="66" rx="12" fill="#FFFFFF" stroke="#D3CBE9" strokeWidth="2" />
      <path d="M80 24V86" stroke="#D3CBE9" strokeWidth="2" />
      <circle cx="52" cy="48" r="12" fill="#E8F4F1" />
      <path d="M46 48C48.5 44.5 55.5 44.5 58 48" stroke="#1A6F6B" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="92" y="38" width="32" height="8" rx="4" fill="#FDF0EB" />
      <rect x="92" y="54" width="28" height="6" rx="3" fill="#E8F4F1" />
      <rect x="92" y="66" width="22" height="6" rx="3" fill="#E8F4F1" />
    </svg>
  );
}
