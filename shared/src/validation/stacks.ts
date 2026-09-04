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

export const updateStackSchema = z.object({
    displayName: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    composeContent: z.string().min(1).optional(),
    envContent: z.string().optional(),
});

export const stackParamsSchema = z.object({
    id: stackIdSchema,
});

export const stackServiceParamsSchema = stackParamsSchema.extend({
    serviceName: z.string().min(1),
});

// The Docker tag grammar: a leading letter, digit, or underscore, followed
// by up to 127 more characters drawn from letters, digits, underscore,
// period and hyphen. This is the security control that keeps an
// attacker-supplied string from being interpolated into a YAML document —
// no whitespace, no quotes, no YAML metacharacters can pass this pattern.
export const dockerTagSchema = z
    .string()
    .regex(
        /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/,
        "Must be a valid Docker tag: letters, digits, underscore, period and hyphen, starting with a letter, digit, or underscore",
    );

export const upgradeServiceParamsSchema = stackServiceParamsSchema;

export const upgradeServiceSchema = z.object({
    targetTag: dockerTagSchema,
});

export type StackParams = z.infer<typeof stackParamsSchema>;
export type StackServiceParams = z.infer<typeof stackServiceParamsSchema>;
export type CreateStackInput = z.infer<typeof createStackSchema>;
export type UpdateStackInput = z.infer<typeof updateStackSchema>;
export type UpgradeServiceParams = z.infer<typeof upgradeServiceParamsSchema>;
export type UpgradeServiceInput = z.infer<typeof upgradeServiceSchema>;
