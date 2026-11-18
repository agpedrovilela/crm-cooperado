-- CRM do Cooperado: estrutura do banco no Supabase
-- Cole tudo no SQL Editor do Supabase e clique em Run. Pode rodar de novo sem problema.

-- 1. Tabela única de documentos (cada registro do app é um JSON)
create table if not exists public.docs (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  col        text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, col, id)
);
create index if not exists docs_user_col on public.docs (user_id, col);

-- 2. Segurança: cada usuário só enxerga e altera os próprios registros
alter table public.docs enable row level security;
drop policy if exists docs_select on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;
create policy docs_select on public.docs for select to authenticated using (user_id = (select auth.uid()));
create policy docs_insert on public.docs for insert to authenticated with check (user_id = (select auth.uid()));
create policy docs_update on public.docs for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy docs_delete on public.docs for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.docs from anon;
grant select, insert, update, delete on public.docs to authenticated;

-- 3. Atualização parcial: junta o JSON novo no antigo (objetos se juntam, listas são trocadas)
create or replace function public.jsonb_merge_deep(a jsonb, b jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare k text; v jsonb; r jsonb;
begin
  if a is null or b is null or jsonb_typeof(a) <> 'object' or jsonb_typeof(b) <> 'object' then
    return b;
  end if;
  r := a;
  for k, v in select * from jsonb_each(b) loop
    if jsonb_typeof(r -> k) = 'object' and jsonb_typeof(v) = 'object' then
      r := jsonb_set(r, array[k], public.jsonb_merge_deep(r -> k, v));
    else
      r := jsonb_set(r, array[k], v);
    end if;
  end loop;
  return r;
end $$;

create or replace function public.doc_merge(p_col text, p_id text, p_patch jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  update public.docs
     set data = public.jsonb_merge_deep(data, p_patch), updated_at = now()
   where user_id = auth.uid() and col = p_col and id = p_id;
  return found;
end $$;
revoke execute on function public.doc_merge(text, text, jsonb) from public, anon;
grant execute on function public.doc_merge(text, text, jsonb) to authenticated;

-- 4. Tempo real: o notebook vê na hora o que foi salvo no celular
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null;
end $$;

-- 5. Fotos: pasta privada, cada usuário só acessa a própria subpasta
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

drop policy if exists fotos_select on storage.objects;
drop policy if exists fotos_insert on storage.objects;
drop policy if exists fotos_update on storage.objects;
drop policy if exists fotos_delete on storage.objects;
create policy fotos_select on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy fotos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy fotos_update on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy fotos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
