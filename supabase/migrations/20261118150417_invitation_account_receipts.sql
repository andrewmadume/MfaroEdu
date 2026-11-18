begin;
-- Only the already-authorized invitation-manager list exposes this receipt.
-- It links an accepted email invitation to the account UUID needed by directory
-- profile assignment, without granting broader Auth-directory access.
do $$ declare definition text;begin
 select pg_get_functiondef('private.school_tools(uuid,jsonb)'::regprocedure) into definition;
 if position('id,email,role_id,expires_at,revoked,accepted_by is not null as accepted' in definition)=0 then raise exception 'Review invitation list authorization before applying the receipt migration';end if;
 definition=replace(definition,'id,email,role_id,expires_at,revoked,accepted_by is not null as accepted','id,email,role_id,expires_at,revoked,accepted_by,accepted_by is not null as accepted');
 execute definition;
end $$;
commit;
