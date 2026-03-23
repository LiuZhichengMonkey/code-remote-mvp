import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const COLORS = {
  bg: '#000000',
  card: '#1F1F1F',
  accent: '#3B82F6', // Neon Blue
  text: '#FFFFFF',
  textMuted: '#999999',
};
