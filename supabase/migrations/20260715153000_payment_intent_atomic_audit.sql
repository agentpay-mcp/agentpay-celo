begin;

create or replace function public.record_payment_intent_state_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_type text;
  v_message text;
  v_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'PAYMENT_CREATED';
    v_message := 'Payment intent created.';
    v_metadata := jsonb_build_object(
      'status', new.status,
      'amountOut', new.amount_out,
      'destinationChainId', new.destination_chain_id,
      'destinationTokenSymbol', new.destination_token_symbol,
      'recipientAddress', new.recipient_address
    );
  elsif new.status is not distinct from old.status then
    return new;
  elsif new.status = 'APPROVED' then
    v_event_type := 'PAYMENT_APPROVED';
    v_message := 'Exact approval phrase accepted.';
    v_metadata := jsonb_build_object('approvedAt', new.approved_at);
  elsif new.status = 'EXECUTING' then
    v_event_type := 'PAYMENT_EXECUTING';
    v_message := 'Payment execution started.';
    v_metadata := jsonb_build_object(
      'sourceTxHash', new.source_tx_hash,
      'approvedAt', new.approved_at
    );
  elsif new.status = 'FAILED' then
    v_event_type := 'PAYMENT_FAILED';
    v_message := coalesce(new.error_message, 'Payment failed.');
    v_metadata := jsonb_build_object('errorCode', new.error_code);
  elsif new.status = 'EXPIRED' then
    v_event_type := 'PAYMENT_EXPIRED';
    v_message := coalesce(new.error_message, 'Payment approval deadline expired.');
    v_metadata := jsonb_build_object('errorCode', new.error_code);
  elsif new.status = 'COMPLETED' then
    v_event_type := 'PAYMENT_COMPLETED';
    v_message := 'Payment completed.';
    v_metadata := jsonb_build_object(
      'destinationTxHash', new.destination_tx_hash,
      'completedAt', new.completed_at
    );
  else
    return new;
  end if;

  insert into public.payment_events (
    tenant_id,
    payment_intent_id,
    event_type,
    message,
    metadata
  ) values (
    new.tenant_id,
    new.id,
    v_event_type,
    v_message,
    jsonb_strip_nulls(v_metadata)
  );

  return new;
end;
$$;

revoke all on function public.record_payment_intent_state_event() from public, anon, authenticated;

drop trigger if exists payment_intent_state_event on public.payment_intents;
create trigger payment_intent_state_event
after insert or update of status on public.payment_intents
for each row
execute function public.record_payment_intent_state_event();

notify pgrst, 'reload schema';

commit;
