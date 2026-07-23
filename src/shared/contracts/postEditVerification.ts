import { z } from "zod";

export const PostEditVerificationResultSchema = z
  .object({
    passed: z.boolean(),
    signals: z
      .array(
        z
          .object({
            signal: z.string().max(200),
            passed: z.boolean(),
            details: z.string().max(2000),
          })
          .strict(),
      )
      .max(100),
    verdict: z.enum(["satisfied", "needs_revision", "failed"]),
  })
  .strict();
export type PostEditVerificationResult = z.infer<typeof PostEditVerificationResultSchema>;
