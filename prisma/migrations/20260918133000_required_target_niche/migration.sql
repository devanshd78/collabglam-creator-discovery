-- Add a first-class required niche to campaign briefs.
-- Existing rows are backfilled from their campaign title (or brand name) so this migration is safe
-- on databases that already contain briefs; admins can refine those historical niches later.
ALTER TABLE "BrandBrief" ADD COLUMN "targetNiche" TEXT;

UPDATE "BrandBrief"
SET "targetNiche" = CASE
  WHEN BTRIM("title") <> '' THEN "title"
  ELSE "brandName"
END
WHERE "targetNiche" IS NULL OR BTRIM("targetNiche") = '';

ALTER TABLE "BrandBrief" ALTER COLUMN "targetNiche" SET NOT NULL;
