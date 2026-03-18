alter table if exists factures
  add column if not exists image_url text,
  add column if not exists image_public_id text;

alter table if exists paiements_mobile
  add column if not exists image_url text,
  add column if not exists image_public_id text,
  add column if not exists operateur text;
