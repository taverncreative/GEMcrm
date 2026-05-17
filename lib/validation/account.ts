import { z } from "zod";

/**
 * Password change.
 *
 * Minimum length 8 — Supabase enforces this server-side too (the default
 * is 6, but most Supabase projects bump it to 8+). We validate here as
 * well to give the user a faster, friendlier error message.
 *
 * `confirmPassword` is matched against `newPassword` with `.refine`
 * so the error binds to that field specifically.
 */
export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from current password",
    path: ["newPassword"],
  });

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

/**
 * Invite new user.
 *
 * Email required + valid; display name optional (becomes
 * `user_metadata.full_name` on the Supabase user record).
 */
export const InviteUserSchema = z.object({
  email: z.string().email("Enter a valid email"),
  fullName: z.string().optional().default(""),
});

export type InviteUserInput = z.infer<typeof InviteUserSchema>;
