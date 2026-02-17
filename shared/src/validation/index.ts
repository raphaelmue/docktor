import {z} from "zod";

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

export const loginSchema = z.object({
    email: z.email("Please enter a valid email address"),
    password: z.string().min(1, "Password is required"),
});

export const signupSchema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.email("Please enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
});

export const updateStackSchema = z.object({
    displayName: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    composeContent: z.string().min(1).optional(),
    envContent: z.string().optional(),
});

export type CreateStackInput = z.infer<typeof createStackSchema>;
export type UpdateStackInput = z.infer<typeof updateStackSchema>;
export type UpdateSettingInput = z.infer<typeof updateSettingSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
