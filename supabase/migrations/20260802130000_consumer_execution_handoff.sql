-- Keep consumer review/execution orchestration separate from x402 fee
-- settlement while preserving the same durable lifecycle and outbox.

begin;

alter table public.paid_execution_lifecycles
  add column if not exists execution_source text not null default 'x402';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'paid_execution_lifecycles_execution_source_check') then
    alter table public.paid_execution_lifecycles
      add constraint paid_execution_lifecycles_execution_source_check
      check (execution_source in ('x402', 'consumer_handoff'));
  end if;

  alter table public.paid_execution_lifecycles
    drop constraint if exists paid_execution_lifecycles_fee_status_check;
  alter table public.paid_execution_lifecycles
    add constraint paid_execution_lifecycles_fee_status_check
    check (fee_status in ('NOT_REQUIRED', 'ACCEPTED', 'SETTLING', 'SETTLED', 'SETTLEMENT_UNKNOWN', 'SETTLEMENT_REJECTED', 'MANUAL_REVIEW'));

  if not exists (select 1 from pg_constraint where conname = 'paid_execution_lifecycles_execution_source_fee_check') then
    alter table public.paid_execution_lifecycles
      add constraint paid_execution_lifecycles_execution_source_fee_check
      check (
        (
          execution_source = 'consumer_handoff'
          and fee_status = 'NOT_REQUIRED'
          and fee_network is null
          and fee_asset is null
          and fee_amount is null
          and fee_pay_to is null
        )
        or
        (
          execution_source = 'x402'
          and fee_status <> 'NOT_REQUIRED'
          and (
            (fee_network is null and fee_asset is null and fee_amount is null and fee_pay_to is null)
            or
            (fee_network is not null and fee_asset is not null and fee_amount is not null and fee_pay_to is not null)
          )
        )
      );
  end if;
end;
$$;

create index if not exists paid_execution_lifecycles_execution_source_idx
  on public.paid_execution_lifecycles (tenant_id, execution_source, updated_at desc);

notify pgrst, 'reload schema';

commit;
