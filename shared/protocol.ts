import { z } from 'zod'
export const MAX_TEXT = 100_000
export const DocumentSchema = z
  .object({
    id: z.string().default('document'),
    name: z.string(),
    text: z.string().max(MAX_TEXT),
    revision: z.string(),
  })
  .strict()
export type DocumentSnapshot = z.infer<typeof DocumentSchema>
export const SaveSchema = z
  .object({
    id: z.string().default('document'),
    text: z.string().max(MAX_TEXT),
    revision: z.string(),
  })
  .strict()
export const RewriteSchema = z
  .object({
    id: z.string().uuid(),
    text: z.string().min(1).max(20_000),
    instruction: z.string().min(1).max(2_000),
  })
  .strict()
export type RewriteRequest = z.infer<typeof RewriteSchema>
export const ProposalSchema = z
  .object({ replacement: z.string().min(1).max(30_000), reason: z.string().max(1_000) })
  .strict()
export type Proposal = z.infer<typeof ProposalSchema>
export const HealthSchema = z
  .object({
    name: z.literal('foolscap-companion'),
    provider: z.enum(['codex', 'fixture']),
    file: z.string(),
  })
  .strict()

export const FilesSchema = z.array(z.object({ id: z.string(), name: z.string() }).strict())
