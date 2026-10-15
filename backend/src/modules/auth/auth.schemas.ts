import { z } from 'zod';

export const loginBody = z
  .object({
    username: z.string().trim().min(1, 'Username is required.').max(64),
    password: z.string().min(1, 'Password is required.').max(200),
  })
  .strict();

export type LoginBody = z.infer<typeof loginBody>;
