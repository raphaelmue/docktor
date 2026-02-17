import { z } from "zod";

export const stackIdSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/,
    "Must be lowercase alphanumeric with hyphens, not starting or ending with a hyphen",
  );

export const createStackSchema = z.object({
  displayName: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  composeContent: z.string().min(1),
  envContent: z.string().optional(),
});

export const updateSettingSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  encrypted: z.boolean().optional(),
});

export type CreateStackInput = z.infer<typeof createStackSchema>;
export type UpdateSettingInput = z.infer<typeof updateSettingSchema>;
