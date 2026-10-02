import { z } from "zod";

export const ITEM_KINDS = [
  "medication",
  "lab_test",
  "referral",
  "follow_up_visit",
  "self_care",
  "warning_sign",
] as const;

export const CareItemSchema = z.object({
  kind: z.enum(ITEM_KINDS),
  title: z.string().min(1).max(160),
  plain_language: z.string().min(1).max(600),
  why: z.string().max(400).default(""),
  when: z.string().max(160).default(""),
  source_quote: z.string().min(1).max(600),
  needs_clarification: z.boolean().default(false),
  question_for_clinic: z.string().max(300).default(""),
});

export const ExtractionSchema = z.object({
  source_text: z.string().default(""),
  items: z.array(CareItemSchema).max(40),
  questions_for_doctor: z.array(z.string().max(300)).max(15).default([]),
  not_in_document: z.array(z.string().max(300)).max(15).default([]),
});

export type CareItem = z.infer<typeof CareItemSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;

export type VerifiedItem = CareItem & {
  id: string;
  grounded: boolean;
  span: { start: number; end: number } | null;
};

export type CarePlanResponse = {
  source_text: string;
  source_kind: "text" | "image";
  items: VerifiedItem[];
  refused: VerifiedItem[];
  questions_for_doctor: string[];
  not_in_document: string[];
  has_warning_signs: boolean;
  model: string;
  stats: { extracted: number; grounded: number; refused: number; ms: number };
};

export const READING_LEVELS = ["simple", "standard", "detailed"] as const;
export const LANGUAGES = ["English", "Spanish", "Vietnamese", "Korean", "Chinese", "Amharic", "French"] as const;

export const RequestSchema = z
  .object({
    text: z.string().max(20000).optional(),
    image_base64: z.string().max(8_000_000).optional(),
    image_media_type: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]).optional(),
    reading_level: z.enum(READING_LEVELS).default("simple"),
    language: z.enum(LANGUAGES).default("English"),
  })
  .refine((r) => (r.text && r.text.trim().length > 20) || r.image_base64, {
    message: "Provide the after-visit summary as text (at least a few lines) or as a photo.",
  });

export type ExtractRequest = z.infer<typeof RequestSchema>;
