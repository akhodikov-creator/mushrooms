-- ============================================================
--  ГРИБНИК — таблица общей доски рекордов
--  Выполнить один раз в Supabase: SQL Editor → New query → Run
-- ============================================================

create table if not exists gribnik_scores (
  id            bigserial primary key,
  nick          text    not null check (char_length(nick) between 1 and 20),
  score         integer not null check (score >= 0 and score <= 2000000),
  mushrooms     integer not null default 0 check (mushrooms >= 0 and mushrooms <= 100000),
  oles          integer not null default 0 check (oles >= 0 and oles <= 100000),
  kills         integer not null default 0 check (kills >= 0 and kills <= 100000),
  died          boolean not null default false,
  best_mushroom text    default '' check (char_length(best_mushroom) <= 40),
  created_at    timestamptz not null default now()
);

alter table gribnik_scores enable row level security;

-- доску видят все
drop policy if exists "gribnik read" on gribnik_scores;
create policy "gribnik read" on gribnik_scores
  for select using (true);

-- любой может добавить СВОЙ результат
drop policy if exists "gribnik insert" on gribnik_scores;
create policy "gribnik insert" on gribnik_scores
  for insert with check (true);

-- менять и удалять чужие записи нельзя: политик update/delete нет вовсе,
-- поэтому RLS запрещает их по умолчанию

create index if not exists gribnik_scores_score_idx on gribnik_scores (score desc);
