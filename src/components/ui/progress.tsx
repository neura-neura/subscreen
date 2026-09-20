import { cn } from '../../lib/utils';

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/[.08]', className)}>
      <div className="h-full bg-amber-400 transition-all duration-300" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
