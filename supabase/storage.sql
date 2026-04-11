insert into storage.buckets (id, name, public)
values ('audit-documents', 'audit-documents', true)
on conflict (id) do nothing;

drop policy if exists "audit_documents_public_read" on storage.objects;
create policy "audit_documents_public_read"
on storage.objects
for select
to public
using (bucket_id = 'audit-documents');

drop policy if exists "audit_documents_anon_insert" on storage.objects;
create policy "audit_documents_anon_insert"
on storage.objects
for insert
to anon
with check (bucket_id = 'audit-documents');

drop policy if exists "audit_documents_anon_update" on storage.objects;
create policy "audit_documents_anon_update"
on storage.objects
for update
to anon
using (bucket_id = 'audit-documents')
with check (bucket_id = 'audit-documents');
