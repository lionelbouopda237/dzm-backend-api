create table if not exists rapprochements_factures_paiements (
  id uuid primary key default gen_random_uuid(),
  paiement_id uuid not null references paiements_mobile(id) on delete cascade,
  facture_id uuid not null references factures(id) on delete cascade,
  montant_impute numeric default 0,
  score numeric default 100,
  source text default 'manuel',
  created_at timestamptz default now()
);

create unique index if not exists ux_rapprochement_paiement on rapprochements_factures_paiements (paiement_id);

create table if not exists ristournes_paiements (
  id uuid primary key default gen_random_uuid(),
  structure text not null,
  reference_facture text,
  montant_theorique numeric default 0,
  montant_recu numeric default 0,
  date_paiement date,
  mode_paiement text,
  commentaire text,
  created_at timestamptz default now()
);

create unique index if not exists ux_ristourne_facture on ristournes_paiements (reference_facture);
