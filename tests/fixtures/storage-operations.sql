-- Model the official operation-aware helper. Real operation names are verified against Storage.
create function storage.allow_any_operation(expected_operations text[]) returns boolean language sql stable as $$select coalesce(regexp_replace(current_setting('storage.operation',true),'^storage\.','')=any(expected_operations),false)$$;
