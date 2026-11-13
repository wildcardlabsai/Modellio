-- MODELLIO cloud projects (optional backend).
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.

create table if not exists public.projects (
  id           text primary key,
  owner        uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name         text not null,
  created_at   bigint not null,
  updated_at   bigint not null,
  object_count integer not null default 0,
  thumbnail    text
);

create index if not exists projects_owner_updated on public.projects (owner, updated_at desc);

-- Row-level security: people only ever see and change their own projects.
alter table public.projects enable row level security;

create policy "projects: owner can read"   on public.projects for select using (owner = auth.uid());
create policy "projects: owner can insert" on public.projects for insert with check (owner = auth.uid());
create policy "projects: owner can update" on public.projects for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy "projects: owner can delete" on public.projects for delete using (owner = auth.uid());

-- Project files (.modellio JSON incl. meshes) live in a private bucket at <owner>/<project id>.modellio
insert into storage.buckets (id, name, public) values ('projects', 'projects', false) on conflict (id) do nothing;

create policy "project files: owner can read"   on storage.objects for select using (bucket_id = 'projects' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "project files: owner can write"  on storage.objects for insert with check (bucket_id = 'projects' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "project files: owner can update" on storage.objects for update using (bucket_id = 'projects' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "project files: owner can delete" on storage.objects for delete using (bucket_id = 'projects' and (storage.foldername(name))[1] = auth.uid()::text);
