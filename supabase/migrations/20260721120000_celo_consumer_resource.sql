begin;

alter table public.oauth_authorizations
  drop constraint if exists oauth_authorizations_resource_check;

delete from public.oauth_authorizations
where resource = 'https://wallet.agentpay.site/mcp';

update public.service_sessions
set revoked_at = coalesce(revoked_at, now())
where audience = 'https://wallet.agentpay.site/mcp'
  and revoked_at is null;

alter table public.oauth_authorizations
  add constraint oauth_authorizations_resource_check
  check (resource = 'https://wallet.agentpay.site/celo/mcp');

notify pgrst, 'reload schema';

commit;
