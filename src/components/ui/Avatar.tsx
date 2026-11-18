export type AvatarTone = 'mint' | 'peach' | 'lavender' | 'butter';

const AVATAR_TONES: Record<AvatarTone, string> = {
  mint: 'bg-[var(--mimora-surface-mint)] text-[var(--mimora-primary)] border-[#c3dfd8]',
  peach: 'bg-[var(--mimora-surface-peach)] text-[var(--mimora-accent)] border-[#ecc9be]',
  lavender: 'bg-[var(--mimora-surface-lavender)] text-[var(--mimora-secondary)] border-[#d3cbe9]',
  butter: 'bg-[var(--mimora-surface-butter)] text-[var(--mimora-warning)] border-[#eadba9]',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return 'M';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function Avatar({
  name,
  tone = 'mint',
  size = 'md',
}: {
  name: string;
  tone?: AvatarTone;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClass =
    size === 'sm'
      ? 'h-8 w-8 text-xs'
      : size === 'lg'
        ? 'h-12 w-12 text-base'
        : 'h-10 w-10 text-sm';

  return (
    <span
      aria-hidden="true"
      className={[
        'inline-flex items-center justify-center rounded-full border font-semibold shrink-0 select-none',
        sizeClass,
        AVATAR_TONES[tone],
      ].join(' ')}
    >
      {getInitials(name)}
    </span>
  );
}
