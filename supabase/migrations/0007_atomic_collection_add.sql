-- Adding a card twice was a read-modify-write, so two taps racing each other
-- lost an increment. It also meant the same card could end up on two rows if
-- the read missed the first insert.
--
-- Uniqueness is on (user_id, card_id, condition) rather than (user_id,
-- card_id), because owning the same card in Near Mint and in Lightly Played is
-- two real holdings at two real prices -- Tier 1 MVP item 9. NULLS NOT
-- DISTINCT so the common case of no condition set still collapses to one row
-- rather than one per save.

create unique index if not exists collections_user_card_condition_idx
  on collections (user_id, card_id, condition) nulls not distinct;

-- security invoker, so row-level security applies exactly as it does to a
-- direct insert. This function must never become a way around it.
create or replace function add_card_to_collection(
  p_card_id   bigint,
  p_quantity  integer,
  p_name      text,
  p_set_name  text,
  p_number    text,
  p_condition text default null
) returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare v_id bigint;
begin
  insert into public.collections
    (user_id, card_id, quantity, card_name, card_set_name, card_number, condition)
  values
    ((select auth.uid()), p_card_id, greatest(coalesce(p_quantity, 1), 1),
     p_name, p_set_name, p_number, p_condition)
  on conflict (user_id, card_id, condition) do update
    set quantity = public.collections.quantity + excluded.quantity
  returning id into v_id;
  return v_id;
end
$$;
