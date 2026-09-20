import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

export function stripExtension(name: string) {
  return name.replace(/\.[^.]+$/, '');
}
