-- Persist the complete Celo x402 seller terms and append one immutable audit
-- event when the facilitator settlement becomes durable.

begin;

alter table public.paid_execution_lifecycles
  add column if not exists fee_network text,
  add column if not exists fee_asset text,
  add column if not exists fee_amount text,
  add column if not exists fee_pay_to text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'paid_execution_lifecycles_fee_terms_presence_check') then
    alter table public.paid_execution_lifecycles
      add constraint paid_execution_lifecycles_fee_terms_presence_check check (
        (fee_network is null and fee_asset is null and fee_amount is null and fee_pay_to is null)
        or
        (fee_network is not null and fee_asset is not null and fee_amount is not null and fee_pay_to is not null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'paid_execution_lifecycles_fee_network_check') then
    alter table public.paid_execution_lifecycles
      add constraint paid_execution_lifecycles_fee_network_check
      check (fee_network is null or fee_network in ('eip155:42220', 'eip155:11142220'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'paid_execution_lifecycles_fee_asset_check') then
    alter table public.paid_execution_lifecycles
      add constraint paid_execution_lifecycles_fee_asset_check
      check (fee_asset is null or fee_asset ~ '^0x[0-9a-fA-F]{40}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'paid_execution_lifecycles_fee_amount_check') then
    alter table public.paid_execution_lifecycles
      add constraint paid_execution_lifecycles_fee_amount_check
      check (fee_amount is null or fee_amount ~ '^[1-9][0-9]*$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'paid_execution_lifecycles_fee_pay_to_check') then
    alter table public.paid_execution_lifecycles
      add constraint paid_execution_lifecycles_fee_pay_to_check
      check (fee_pay_to is null or fee_pay_to ~ '^0x[0-9a-fA-F]{40}$');
  end if;
end;
$$;

create unique index if not exists payment_events_x402_fee_settled_idx
  on public.payment_events (tenant_id, payment_intent_id, event_type)
  where event_type = 'X402_FEE_SETTLED';

create or replace function public.record_paid_execution_settlement_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.fee_status = 'SETTLED' and old.fee_status is distinct from 'SETTLED' then
    if new.fee_network is null or new.fee_asset is null or new.fee_amount is null or new.fee_pay_to is null then
      raise exception 'Settled x402 lifecycle requires complete fee terms.';
    end if;

    insert into public.payment_events (
      tenant_id,
      payment_intent_id,
      event_type,
      message,
      metadata
    ) values (
      new.tenant_id,
      new.payment_intent_id,
      'X402_FEE_SETTLED',
      'Celo x402 seller fee settled.',
      jsonb_build_object(
        'lifecycleId', new.id,
        'payer', new.payer,
        'payTo', new.fee_pay_to,
        'amount', new.fee_amount,
        'asset', new.fee_asset,
        'network', new.fee_network,
        'transactionHash', new.settlement_tx_hash
      )
    ) on conflict do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.record_paid_execution_settlement_event() from public, anon, authenticated;

drop trigger if exists paid_execution_x402_settlement_event on public.paid_execution_lifecycles;
create trigger paid_execution_x402_settlement_event
after update of fee_status on public.paid_execution_lifecycles
for each row
execute function public.record_paid_execution_settlement_event();

notify pgrst, 'reload schema';

commit;
