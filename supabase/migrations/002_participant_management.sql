-- Apply AFTER 001_ion.sql. One-time, additive, transactional migration.
-- No meetings, contracts, scores or historical memberships are deleted.
BEGIN;
ALTER TABLE public.campaign_participants
  ADD COLUMN active boolean NOT NULL DEFAULT true,
  ADD COLUMN removed_at timestamptz,
  ADD COLUMN removed_by uuid REFERENCES public.profiles(id),
  ADD CONSTRAINT participant_removal_consistent CHECK (
    (active AND removed_at IS NULL AND removed_by IS NULL) OR
    (NOT active AND removed_at IS NOT NULL AND removed_by IS NOT NULL)
  );

-- Retain all unrelated operations, but make their entry point private.
ALTER FUNCTION public.admin_operation(text,jsonb) RENAME TO admin_operation_v1;
REVOKE EXECUTE ON FUNCTION public.admin_operation_v1(text,jsonb) FROM PUBLIC,anon,authenticated;

create or replace function public.dashboard(p_campaign uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; begin
 if actor_role() is null then raise exception 'Conta inativa ou sem perfil'; end if;
 with personal as (
 select p.id,p.name,t.name as team,p.active,coalesce(sum(s.points),0)::int as points,count(s.id) filter(where s.held)::int as held,count(s.id) filter(where s.qualified)::int as qualified,count(s.id) filter(where s.contracted)::int as contracts
 from campaign_participants cp join profiles p on p.id=cp.profile_id join teams t on t.id=cp.team_id left join opportunity_scores s on s.sdr_id=p.id and s.campaign_id=cp.campaign_id where cp.campaign_id=p_campaign and cp.active group by p.id,t.name
 ), ranked as (select *,rank() over(order by points desc,contracts desc,qualified desc,held desc) as position from personal), team_scores as (
 select t.id,t.name,count(distinct cp.profile_id)::int as participants,coalesce(sum(s.points),0)::int as points,count(s.id) filter(where s.held)::int as held from teams t join campaign_participants cp on cp.team_id=t.id and cp.campaign_id=p_campaign and cp.active left join opportunity_scores s on s.sdr_id=cp.profile_id and s.campaign_id=cp.campaign_id group by t.id
 ) select jsonb_build_object('individual',coalesce((select jsonb_agg(r order by r.position,r.name) from ranked r),'[]'::jsonb),'teams',coalesce((select jsonb_agg(t order by t.points desc,t.name) from team_scores t),'[]'::jsonb),'held',(select count(*) from opportunity_scores where campaign_id=p_campaign and held),'qualified',(select count(*) from opportunity_scores where campaign_id=p_campaign and qualified),'contracts',(select count(*) from opportunity_scores where campaign_id=p_campaign and contracted),'active_sdrs',(select count(*) from personal where active)) into result;
 return result; end $$;

create or replace function public.create_meeting(data jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare cp campaign_participants; ca campaigns; op opportunities; oid uuid; mid uuid; phone_value text; begin
 if actor_role() is distinct from 'sdr' then raise exception 'Apenas SDRs podem cadastrar reuniões'; end if;
 select * into ca from campaigns where id=(data->>'campaign_id')::uuid for update;
 if ca.state<>'active' or now()<ca.starts_at or now()>=ca.ends_at then raise exception 'A campanha não está no período ativo'; end if;
 select * into cp from campaign_participants where campaign_id=ca.id and profile_id=auth.uid() and active;
 if cp.profile_id is null then raise exception 'Você não participa desta campanha'; end if;
 if not exists(select 1 from profiles where id=(data->>'closer_id')::uuid and role='closer' and active) then raise exception 'Closer inválido'; end if;
 if (data->>'scheduled_at')::timestamptz<ca.starts_at or (data->>'scheduled_at')::timestamptz>=ca.ends_at then raise exception 'Reunião fora do período da campanha'; end if;
 phone_value:=regexp_replace(data->>'phone','[^0-9]','','g');
 -- Serializes campaign writes, preventing concurrent duplicate creation races.
 if nullif(data->>'opportunity_id','') is not null then
 select * into op from opportunities where id=(data->>'opportunity_id')::uuid and sdr_id=auth.uid() and campaign_id=ca.id;
 if op.id is null then raise exception 'Oportunidade inválida'; end if; oid:=op.id;
 else
 if exists(select 1 from opportunities where campaign_id=ca.id and phone=phone_value) then raise exception 'Possível duplicidade: selecione a oportunidade existente ou peça revisão administrativa'; end if;
 insert into opportunities(campaign_id,sdr_id,team_id,company,contact,phone,city,niche) values(ca.id,auth.uid(),cp.team_id,trim(data->>'company'),trim(data->>'contact'),phone_value,trim(data->>'city'),trim(data->>'niche')) returning id into oid;
 end if;
 insert into meetings(opportunity_id,closer_id,scheduled_at,notes) values(oid,(data->>'closer_id')::uuid,(data->>'scheduled_at')::timestamptz,coalesce(data->>'notes','')) returning id into mid;
 return mid; end $$;


CREATE FUNCTION public.admin_operation(operation text,data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  ca campaigns;
  current_profile profiles;
  membership campaign_participants;
  pid uuid;
  requested_team uuid;
  requested_role text;
  requested_active boolean;
BEGIN
  PERFORM require_admin();
  PERFORM pg_advisory_xact_lock(70013);
  -- Recheck after waiting: another admin may have changed this actor's role.
  PERFORM require_admin();
  PERFORM set_config('ion.reason',coalesce(data->>'reason',''),true);

  IF operation='participant' THEN
    SELECT * INTO ca FROM campaigns WHERE id=(data->>'campaign_id')::uuid FOR UPDATE;
    IF ca.id IS NULL THEN RAISE EXCEPTION 'Campanha não encontrada'; END IF;
    IF ca.state='finalized' THEN RAISE EXCEPTION 'Campanha finalizada'; END IF;
    pid:=(data->>'profile_id')::uuid;
    SELECT * INTO membership FROM campaign_participants WHERE campaign_id=ca.id AND profile_id=pid FOR UPDATE;

    -- Removal precedes SDR eligibility/team-freeze checks; any current member can be removed.
    IF data->>'remove'='true' THEN
      IF data->>'confirm' IS DISTINCT FROM 'true' OR length(trim(coalesce(data->>'reason','')))<8 THEN
        RAISE EXCEPTION 'Confirme a remoção e informe uma justificativa de ao menos 8 caracteres';
      END IF;
      IF membership.profile_id IS NULL OR NOT membership.active THEN RAISE EXCEPTION 'Participante não está vinculado à campanha'; END IF;
      UPDATE campaign_participants SET active=false,removed_at=now(),removed_by=auth.uid()
        WHERE campaign_id=ca.id AND profile_id=pid;
      RETURN;
    END IF;

    IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=pid AND role='sdr' AND active) THEN RAISE EXCEPTION 'Apenas SDRs ativos podem participar da campanha'; END IF;
    requested_team:=(data->>'team_id')::uuid;
    IF NOT EXISTS(SELECT 1 FROM teams WHERE id=requested_team) THEN RAISE EXCEPTION 'Selecione um time válido'; END IF;
    -- Re-entry is permitted, but does not redistribute historical opportunities between teams.
    IF EXISTS(SELECT 1 FROM opportunities WHERE sdr_id=pid AND campaign_id=ca.id AND team_id<>requested_team) THEN
      RAISE EXCEPTION 'Este SDR possui histórico em outro time. Selecione seu time original nesta campanha';
    END IF;
    IF (SELECT count(*) FROM campaign_participants WHERE campaign_id=ca.id AND team_id=requested_team AND active AND profile_id<>pid)>=5 THEN
      RAISE EXCEPTION 'O time já possui cinco integrantes';
    END IF;
    INSERT INTO campaign_participants(campaign_id,profile_id,team_id,active,removed_at,removed_by)
      VALUES(ca.id,pid,requested_team,true,NULL,NULL)
      ON CONFLICT(campaign_id,profile_id) DO UPDATE SET team_id=excluded.team_id,active=true,removed_at=NULL,removed_by=NULL;
    RETURN;
  ELSIF operation='profile' THEN
    pid:=(data->>'id')::uuid;
    requested_role:=data->>'role';
    requested_active:=(data->>'active')::boolean;
    -- Lock campaigns before profiles, consistently with registration/removal operations.
    PERFORM c.id FROM campaigns c JOIN campaign_participants cp ON cp.campaign_id=c.id
      WHERE cp.profile_id=pid AND cp.active AND c.state<>'finalized' ORDER BY c.id FOR UPDATE OF c;
    SELECT * INTO current_profile FROM profiles WHERE id=pid FOR UPDATE;
    IF pid=auth.uid() AND (requested_role<>'admin' OR NOT requested_active) THEN
      RAISE EXCEPTION 'Você não pode remover seu próprio acesso administrativo';
    END IF;
    IF current_profile.id IS NOT NULL AND requested_role IS DISTINCT FROM current_profile.role THEN
      IF data->>'confirm' IS DISTINCT FROM 'true' OR length(trim(coalesce(data->>'reason','')))<8 THEN
        RAISE EXCEPTION 'Confirme a alteração de perfil e informe uma justificativa de ao menos 8 caracteres';
      END IF;
    END IF;
    IF data->>'remove_from_campaign'='true' THEN
      IF data->>'confirm' IS DISTINCT FROM 'true' OR length(trim(coalesce(data->>'reason','')))<8 THEN
        RAISE EXCEPTION 'Confirme a remoção e alteração de perfil e informe uma justificativa de ao menos 8 caracteres';
      END IF;
      UPDATE campaign_participants cp SET active=false,removed_at=now(),removed_by=auth.uid()
        FROM campaigns c WHERE c.id=cp.campaign_id AND c.state<>'finalized' AND cp.profile_id=pid AND cp.active;
    END IF;
    IF requested_role<>'sdr' AND EXISTS(
      SELECT 1 FROM campaign_participants cp JOIN campaigns c ON c.id=cp.campaign_id
      WHERE cp.profile_id=pid AND cp.active AND c.state<>'finalized'
    ) THEN
      RAISE EXCEPTION 'Selecione remover da campanha e confirme as duas ações antes de alterar o perfil';
    END IF;
    -- Removal and role update commit together; a constraint failure rolls both back.
    INSERT INTO profiles(id,name,role,active) VALUES(pid,trim(data->>'name'),requested_role,requested_active)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role,active=excluded.active;
    RETURN;
  END IF;
  PERFORM admin_operation_v1(operation,data);
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_operation(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_operation(text,jsonb) TO authenticated;

-- Notify existing sanitized Realtime feed on membership and permission changes.
CREATE FUNCTION public.notify_participant_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO competition_updates(campaign_id,updated_at) VALUES(coalesce(NEW.campaign_id,OLD.campaign_id),clock_timestamp())
    ON CONFLICT(campaign_id) DO UPDATE SET updated_at=excluded.updated_at;
  RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER participant_refresh AFTER INSERT OR UPDATE OR DELETE ON public.campaign_participants
  FOR EACH ROW EXECUTE FUNCTION public.notify_participant_change();
CREATE FUNCTION public.notify_profile_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO competition_updates(campaign_id,updated_at)
    SELECT campaign_id,clock_timestamp() FROM campaign_participants WHERE profile_id=NEW.id
    ON CONFLICT(campaign_id) DO UPDATE SET updated_at=excluded.updated_at;
  RETURN NEW;
END $$;
CREATE TRIGGER profile_refresh AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.notify_profile_change();
REVOKE EXECUTE ON FUNCTION public.notify_participant_change(),public.notify_profile_change() FROM PUBLIC,anon,authenticated;
COMMIT;
