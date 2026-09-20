import * as React from 'react';
import { cn } from '../../lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn('flex h-9 w-full rounded-md border border-white/[.09] bg-black px-2.5 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-white/60 focus:ring-2 focus:ring-white/10 disabled:cursor-not-allowed disabled:opacity-50', className)}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
