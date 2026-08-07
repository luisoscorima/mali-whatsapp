-- AlterTable
ALTER TABLE "flow_nodes" ADD COLUMN "media_url" VARCHAR(1024);
ALTER TABLE "flow_nodes" ADD COLUMN "media_mime" VARCHAR(128);
ALTER TABLE "flow_nodes" ADD COLUMN "media_filename" VARCHAR(255);
