alter table if exists factures
  add column if not exists image_url text,
  add column if not exists image_public_id text;

alter table if exists paiements_mobile
  add column if not exists image_url text,
  add column if not exists image_public_id text,
  add column if not exists operateur text;

create table if not exists emballages_mouvements (
  id uuid primary key default gen_random_uuid(),
  structure text not null,
  reference_facture text,
  emballages_pleins integer not null default 0,
  emballages_vides integer not null default 0,
  colis integer not null default 0,
  date_mouvement date not null default current_date,
  source text default 'manuel',
  note text,
  created_at timestamptz default now()
);
