import { z } from 'zod';
import type { GasKind } from '../db';

export const DiveSchema = z
  .object({
    date: z.string().min(1, 'Date is required'),
    site: z.string().min(1, 'Site is required'),
    location: z.string().min(1, 'Location is required'),
    depthMeters: z.number().positive('Depth must be greater than 0').max(100, 'Depth is too deep'),
    bottomTimeMin: z
      .number()
      .positive('Bottom time must be greater than 0')
      .max(600, 'Bottom time is too long'),
    gas: z.enum(['AIR', 'EAN32']),
    startBar: z.number().positive('Start pressure must be greater than 0'),
    endBar: z.number().nonnegative('End pressure cannot be negative'),
    cylinderLiters: z
      .number()
      .positive('Cylinder size must be greater than 0')
      .max(200, 'Cylinder size looks too large')
      .optional(),
    notes: z.string().optional(),
  })
  .refine((val) => val.endBar < val.startBar, {
    path: ['endBar'],
    message: 'End pressure must be less than start pressure',
  });

export type Dive = z.infer<typeof DiveSchema>;

export interface DiveFormInput {
  date: string;
  site: string;
  location: string;
  depth: string;
  time: string;
  gas: GasKind;
  startBar: string;
  endBar: string;
  cylinderLiters: string;
  notes: string;
}

export function validateDiveForm(
  input: DiveFormInput,
): { success: true; data: Dive } | { success: false; errors: Record<string, string> } {
  const parsed = DiveSchema.safeParse({
    date: input.date.trim(),
    site: input.site.trim(),
    location: input.location.trim(),
    depthMeters: input.depth ? Number(input.depth) : Number.NaN,
    bottomTimeMin: input.time ? Number(input.time) : Number.NaN,
    gas: input.gas,
    startBar: input.startBar ? Number(input.startBar) : Number.NaN,
    endBar: input.endBar ? Number(input.endBar) : Number.NaN,
    cylinderLiters: input.cylinderLiters ? Number(input.cylinderLiters) : undefined,
    notes: input.notes.trim() || undefined,
  });

  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && !errors[field]) {
        errors[field] = issue.message;
      }
    }
    return { success: false, errors };
  }

  return { success: true, data: parsed.data };
}
