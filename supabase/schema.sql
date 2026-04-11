create table if not exists building_profile (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  building_type text not null,
  square_feet integer not null,
  year_built integer not null,
  floors integer not null default 1,
  operating_hours integer not null default 40,
  hvac_type text not null,
  lighting_type text not null,
  has_renovations boolean not null default false,
  occupancy integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_run (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references building_profile(id) on delete cascade,
  status text not null,
  stage text not null,
  progress integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  error_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists uploaded_document (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audit_run(id) on delete cascade,
  filename text not null,
  mime_type text not null,
  storage_path text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists utility_reading_raw (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audit_run(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists utility_reading_normalized (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audit_run(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists weather_monthly_features (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audit_run(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists peer_cluster_assignment (
  audit_id uuid primary key references audit_run(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists diagnostic_hypothesis (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audit_run(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists ecm_recommendation (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audit_run(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists financial_projection (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audit_run(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists audit_report (
  audit_id uuid primary key references audit_run(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
