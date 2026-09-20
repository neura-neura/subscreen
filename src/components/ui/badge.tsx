import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wide', {
  variants: {
    variant: {
      default: 'border-white/20 bg-white/10 text-white',
      muted: 'border-white/[.09] bg-white/[.04] text-zinc-400',
      success: 'border-white/20 bg-white/10 text-white',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Badge({ className, variant, ...props }: HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
