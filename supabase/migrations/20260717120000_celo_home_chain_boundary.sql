begin;

-- Celo-only home-chain boundary for the standalone AgentPay deployment.
-- This migration intentionally fails if a reused database contains legacy
-- X Layer rows; Celo production and staging must use isolated Supabase projects.

alter table public.setup_intents
  alter column home_chain_id set default 42220,
  drop constraint if exists setup_intents_home_chain_id_check,
  add constraint setup_intents_home_chain_id_check
    check (home_chain_id in (42220, 11142220));

alter table public.agent_wallets
  alter column home_chain_id set default 42220,
  drop constraint if exists agent_wallets_home_chain_id_check,
  add constraint agent_wallets_home_chain_id_check
    check (home_chain_id in (42220, 11142220));

alter table public.auth_challenges
  drop constraint if exists auth_challenges_chain_id_check,
  add constraint auth_challenges_chain_id_check
    check (chain_id in (42220, 11142220));

alter table public.service_sessions
  drop constraint if exists service_sessions_home_chain_id_check,
  add constraint service_sessions_home_chain_id_check
    check (home_chain_id in (42220, 11142220));

alter table public.payment_review_handoffs
  drop constraint if exists payment_review_handoffs_source_chain_id_check,
  add constraint payment_review_handoffs_source_chain_id_check
    check (source_chain_id in (42220, 11142220));

alter table public.invoice_execution_outbox
  drop constraint if exists invoice_execution_outbox_chain_id_check,
  add constraint invoice_execution_outbox_chain_id_check
    check (chain_id in (42220, 11142220));

alter table public.payment_intents
  drop constraint if exists payment_intents_source_chain_id_check,
  add constraint payment_intents_source_chain_id_check
    check (source_chain_id in (42220, 11142220)),
  drop constraint if exists payment_intents_source_token_symbol_check,
  add constraint payment_intents_source_token_symbol_check
    check (source_token_symbol in ('USDC', 'USDT', 'USDm')),
  drop constraint if exists payment_intents_destination_token_symbol_check,
  add constraint payment_intents_destination_token_symbol_check
    check (destination_token_symbol in ('USDT0', 'USDC', 'USDT', 'USDm'));

alter table public.runtime_environment_identity
  drop constraint if exists runtime_environment_identity_chain_id_check,
  drop constraint if exists runtime_environment_identity_caip2_check,
  drop constraint if exists runtime_environment_identity_eip712_chain_id_check,
  drop constraint if exists runtime_environment_identity_x402_network_check;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.runtime_environment_identity'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%chain_id = 196%'
  loop
    execute format(
      'alter table public.runtime_environment_identity drop constraint %I',
      constraint_name
    );
  end loop;
end;
$$;

alter table public.runtime_environment_identity
  add constraint runtime_environment_identity_chain_id_check
    check (chain_id in (42220, 11142220)),
  add constraint runtime_environment_identity_caip2_check
    check (caip2 in ('eip155:42220', 'eip155:11142220')),
  add constraint runtime_environment_identity_eip712_chain_id_check
    check (eip712_chain_id in (42220, 11142220)),
  add constraint runtime_environment_identity_x402_network_check
    check (x402_network in ('eip155:42220', 'eip155:11142220')),
  add constraint runtime_environment_identity_chain_caip2_check
    check ((chain_id = 42220 and caip2 = 'eip155:42220')
      or (chain_id = 11142220 and caip2 = 'eip155:11142220'));

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.oauth_authorizations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%home_chain_id%196%1952%'
  loop
    execute format(
      'alter table public.oauth_authorizations drop constraint %I',
      constraint_name
    );
  end loop;
end;
$$;

alter table public.oauth_authorizations
  add constraint oauth_authorizations_state_check
  check (
    (code_digest is null
      and code_issued_at is null
      and code_expires_at is null
      and consumed_at is null
      and tenant_id is null
      and owner_address is null
      and account_address is null
      and home_chain_id is null
      and environment is null
      and authentication_epoch is null)
    or
    (code_digest ~ '^[0-9a-f]{64}$'
      and code_issued_at is not null
      and code_expires_at is not null
      and tenant_id is not null
      and owner_address ~ '^0x[0-9a-fA-F]{40}$'
      and account_address ~ '^0x[0-9a-fA-F]{40}$'
      and home_chain_id in (42220, 11142220)
      and environment in ('staging', 'production')
      and authentication_epoch >= 0
      and code_expires_at > code_issued_at
      and (consumed_at is null or consumed_at >= code_issued_at))
  );

notify pgrst, 'reload schema';

commit;
