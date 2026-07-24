CREATE TABLE "advisor_notes" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "advisor_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_advisor_notes_user_sort" ON "advisor_notes"("user_id", "sort_order");

ALTER TABLE "advisor_notes"
  ADD CONSTRAINT "advisor_notes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
