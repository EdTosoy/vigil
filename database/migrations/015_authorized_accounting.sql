-- Independently authorized synthetic capture expectations. No payment initiation.
RESET ROLE;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['flow_payment_authorizer','flow_payment_executor'] LOOP
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',r);
  END IF;
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=r AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
   OR EXISTS(SELECT FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=r))
  THEN RAISE EXCEPTION 'Unsafe payment capability'; END IF;
 END LOOP;
END $$;
CREATE SCHEMA payments AUTHORIZATION flow_ledger_owner;
REVOKE ALL ON SCHEMA payments FROM PUBLIC;
SET LOCAL ROLE flow_ledger_owner;

CREATE TABLE payments.policy(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 book_id uuid NOT NULL REFERENCES ledger.book ON DELETE RESTRICT,
 currency text NOT NULL REFERENCES ledger.currency_definition ON DELETE RESTRICT,
 policy_version text NOT NULL CHECK(length(policy_version) BETWEEN 1 AND 512 AND btrim(policy_version)=policy_version),
 receivable_account_id uuid NOT NULL, payable_account_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CHECK(receivable_account_id<>payable_account_id),
 UNIQUE(book_id,currency,policy_version), UNIQUE(book_id,id,currency),
 FOREIGN KEY(book_id,receivable_account_id,currency) REFERENCES ledger.ledger_account(book_id,id,currency) ON DELETE RESTRICT,
 FOREIGN KEY(book_id,payable_account_id,currency) REFERENCES ledger.ledger_account(book_id,id,currency) ON DELETE RESTRICT
);
CREATE TABLE payments.principal_binding(
 principal name PRIMARY KEY, book_id uuid NOT NULL REFERENCES ledger.book ON DELETE RESTRICT,
 capability text NOT NULL CHECK(capability IN ('authorizer','executor')),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TABLE payments.authorization(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), book_id uuid NOT NULL REFERENCES ledger.book ON DELETE RESTRICT,
 command_key text NOT NULL, business_key text NOT NULL, kind text NOT NULL CHECK(kind IN ('CAPTURE','REVERSAL')),
 policy_id uuid NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>0), currency text NOT NULL,
 effective_at timestamptz NOT NULL CHECK(isfinite(effective_at)), actor_id text NOT NULL, reason text NOT NULL,
 original_capture_id uuid,
 command_payload jsonb NOT NULL CHECK(jsonb_typeof(command_payload)='object'),
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'), authorizer_principal name NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), creation_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),
 CHECK((kind='CAPTURE')=(original_capture_id IS NULL)),
 UNIQUE(book_id,command_key), UNIQUE(book_id,kind,business_key), UNIQUE(book_id,id),
 FOREIGN KEY(book_id,policy_id,currency) REFERENCES payments.policy(book_id,id,currency) ON DELETE RESTRICT
);
CREATE TABLE payments.execution(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), book_id uuid NOT NULL REFERENCES ledger.book ON DELETE RESTRICT,
 authorization_id uuid NOT NULL UNIQUE, kind text NOT NULL CHECK(kind IN ('CAPTURE','REVERSAL')),
 business_key text NOT NULL, original_capture_id uuid UNIQUE, journal_id uuid NOT NULL UNIQUE,
 executor_principal name NOT NULL, created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 creation_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),
 CHECK((kind='CAPTURE')=(original_capture_id IS NULL)), UNIQUE(book_id,id), UNIQUE(book_id,kind,business_key),
 FOREIGN KEY(book_id,authorization_id) REFERENCES payments.authorization(book_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(book_id,journal_id) REFERENCES ledger.ledger_transaction(book_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(book_id,original_capture_id) REFERENCES payments.execution(book_id,id) ON DELETE RESTRICT
);
ALTER TABLE payments.authorization ADD FOREIGN KEY(book_id,original_capture_id) REFERENCES payments.execution(book_id,id) ON DELETE RESTRICT;

CREATE FUNCTION payments.safe_principal(who name,cap text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT cap IN ('authorizer','executor') AND r.rolcanlogin
  AND NOT(r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
  AND pg_has_role(who,CASE cap WHEN 'authorizer' THEN 'flow_payment_authorizer' ELSE 'flow_payment_executor' END,'USAGE')
  AND NOT EXISTS(SELECT FROM pg_roles m WHERE m.rolname NOT IN(who,CASE cap WHEN 'authorizer' THEN 'flow_payment_authorizer' ELSE 'flow_payment_executor' END)
    AND pg_has_role(who,m.oid,'MEMBER'))
  AND NOT EXISTS(SELECT FROM pg_namespace n WHERE n.nspname NOT IN('payments','public','information_schema') AND n.nspname NOT LIKE 'pg_%'
    AND has_schema_privilege(who,n.oid,'USAGE'))
  AND NOT has_schema_privilege(who,'payments','CREATE')
 FROM pg_roles r WHERE r.rolname=who
$$;
CREATE FUNCTION payments.require_capability(bk uuid,cap text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF payments.safe_principal(session_user,cap) IS DISTINCT FROM true
 OR NOT EXISTS(SELECT FROM payments.principal_binding WHERE principal=session_user AND book_id=bk AND capability=cap)
 OR NOT EXISTS(SELECT FROM ledger.book WHERE id=bk AND environment='synthetic')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Payment capability or synthetic book binding denied'; END IF;
END $$;

CREATE FUNCTION payments.guard_policy() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM ledger.book WHERE id=NEW.book_id AND environment='synthetic')
 OR NOT EXISTS(SELECT FROM ledger.ledger_account WHERE id=NEW.receivable_account_id AND book_id=NEW.book_id AND currency=NEW.currency AND state='open' AND classification='asset' AND normal_side='debit')
 OR NOT EXISTS(SELECT FROM ledger.ledger_account WHERE id=NEW.payable_account_id AND book_id=NEW.book_id AND currency=NEW.currency AND state='open' AND classification='liability' AND normal_side='credit')
 THEN RAISE EXCEPTION USING ERRCODE='P1502',MESSAGE='Synthetic accounting policy requires scoped receivable asset and payable liability'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER policy_scope BEFORE INSERT ON payments.policy FOR EACH ROW EXECUTE FUNCTION payments.guard_policy();
-- Provisioning routines remain SECURITY INVOKER with owner-only execution.
CREATE FUNCTION payments.configure_policy(p jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE existing payments.policy%ROWTYPE; bk uuid; code text; version text; receivable uuid; payable uuid;
BEGIN
 PERFORM ledger.check_keys(p,ARRAY['bookId','currency','policyVersion','receivableAccountId','payableAccountId']);
 bk:=ledger.require_text(p,'bookId')::uuid; code:=ledger.require_text(p,'currency'); version:=ledger.require_text(p,'policyVersion');
 receivable:=ledger.require_text(p,'receivableAccountId')::uuid; payable:=ledger.require_text(p,'payableAccountId')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('payments/policy/'||bk||'/'||code||'/'||version,0));
 SELECT * INTO existing FROM payments.policy WHERE book_id=bk AND currency=code AND policy_version=version;
 IF FOUND THEN
  IF existing.receivable_account_id<>receivable OR existing.payable_account_id<>payable THEN
   RAISE EXCEPTION USING ERRCODE='P1501',MESSAGE='Accounting policy version reused with conflicting accounts'; END IF;
  RETURN existing.id;
 END IF;
 INSERT INTO payments.policy(book_id,currency,policy_version,receivable_account_id,payable_account_id)
 VALUES(bk,code,version,receivable,payable) RETURNING * INTO existing;
 RETURN existing.id;
END $$;
CREATE FUNCTION payments.bind_principal(login name,bk uuid,cap text) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior payments.principal_binding%ROWTYPE;
BEGIN
 IF payments.safe_principal(login,cap) IS DISTINCT FROM true OR NOT EXISTS(SELECT FROM ledger.book WHERE id=bk AND environment='synthetic')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Unsafe payment principal or synthetic scope'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('payments/principal/'||login,0));
 SELECT * INTO prior FROM payments.principal_binding WHERE principal=login;
 IF FOUND THEN
  IF prior.book_id<>bk OR prior.capability<>cap THEN RAISE EXCEPTION USING ERRCODE='P1501',MESSAGE='Payment principal binding is immutable'; END IF;
  RETURN;
 END IF;
 INSERT INTO payments.principal_binding(principal,book_id,capability) VALUES(login,bk,cap);
END $$;

CREATE FUNCTION payments.command_payload(p jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE bk uuid; policy uuid; original uuid; value text; effective timestamptz;
BEGIN
 PERFORM ledger.check_keys(p,ARRAY['bookId','commandKey','businessKey','kind','policyId','amountMinor','currency','effectiveAt','actorId','reason','originalCaptureId']);
 bk:=ledger.require_text(p,'bookId')::uuid; policy:=ledger.require_text(p,'policyId')::uuid;
 PERFORM ledger.require_text(p,'commandKey'); PERFORM ledger.require_text(p,'businessKey');
 PERFORM ledger.require_text(p,'actorId'); PERFORM ledger.require_text(p,'reason'); PERFORM ledger.require_text(p,'currency');
 value:=ledger.require_text(p,'amountMinor');
 IF length(value)>19 OR value !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Positive canonical minor-unit amount required'; END IF;
 PERFORM value::bigint;
 value:=ledger.require_text(p,'effectiveAt');
 IF value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Canonical UTC milliseconds required'; END IF;
 effective:=value::timestamptz;
 IF to_char(effective AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>value THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid accounting effective time'; END IF;
 IF ledger.require_text(p,'kind')='CAPTURE' THEN
  IF p->'originalCaptureId' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='P1502',MESSAGE='Capture cannot reference an original capture'; END IF;
 ELSIF p->>'kind'='REVERSAL' THEN original:=ledger.require_text(p,'originalCaptureId')::uuid;
 ELSE RAISE EXCEPTION USING ERRCODE='P1502',MESSAGE='Unsupported accounting command kind'; END IF;
 RETURN p||jsonb_build_object('bookId',bk,'policyId',policy,'originalCaptureId',original);
END $$;
CREATE FUNCTION payments.guard_authorization() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE p jsonb; prior payments.authorization%ROWTYPE;
BEGIN
 PERFORM payments.require_capability(NEW.book_id,'authorizer');
 p:=payments.command_payload(NEW.command_payload);
 IF p<>NEW.command_payload OR NEW.request_hash<>ledger.fingerprint(p)
 OR NEW.authorizer_principal<>session_user OR NEW.creation_transaction<>pg_current_xact_id() OR NEW.created_at<>transaction_timestamp()
 OR p->>'bookId'<>NEW.book_id::text OR p->>'policyId'<>NEW.policy_id::text OR p->>'commandKey'<>NEW.command_key
 OR p->>'businessKey'<>NEW.business_key OR p->>'kind'<>NEW.kind OR p->>'amountMinor'<>NEW.amount_minor::text
 OR p->>'currency'<>NEW.currency OR (p->>'effectiveAt')::timestamptz<>NEW.effective_at OR p->>'actorId'<>NEW.actor_id
 OR p->>'reason'<>NEW.reason OR (p->>'originalCaptureId')::uuid IS DISTINCT FROM NEW.original_capture_id
 OR NOT EXISTS(SELECT FROM payments.policy WHERE id=NEW.policy_id AND book_id=NEW.book_id AND currency=NEW.currency)
 THEN RAISE EXCEPTION USING ERRCODE='P1502',MESSAGE='Authorization fields or scoped policy invalid'; END IF;
 IF NEW.kind='REVERSAL' THEN
  SELECT a.* INTO prior FROM payments.execution e JOIN payments.authorization a ON a.id=e.authorization_id
   WHERE e.id=NEW.original_capture_id AND e.book_id=NEW.book_id AND e.kind='CAPTURE';
  IF NOT FOUND OR prior.policy_id<>NEW.policy_id OR prior.amount_minor<>NEW.amount_minor OR prior.currency<>NEW.currency OR NEW.effective_at<prior.effective_at
  THEN RAISE EXCEPTION USING ERRCODE='P1502',MESSAGE='Only a full matching capture reversal is authorized'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER authorization_scope BEFORE INSERT ON payments.authorization FOR EACH ROW EXECUTE FUNCTION payments.guard_authorization();

-- Extend the established typed companion model without rewriting historical rows.
ALTER TABLE audit.audit_event ADD COLUMN payment_authorization_id uuid UNIQUE REFERENCES payments.authorization ON DELETE RESTRICT,
 ADD COLUMN payment_execution_id uuid UNIQUE REFERENCES payments.execution ON DELETE RESTRICT;
ALTER TABLE outbox.outbox_event ADD COLUMN payment_authorization_id uuid UNIQUE REFERENCES payments.authorization ON DELETE RESTRICT,
 ADD COLUMN payment_execution_id uuid UNIQUE REFERENCES payments.execution ON DELETE RESTRICT;
DO $$ DECLARE t text; c record; branch text; BEGIN
 FOREACH t IN ARRAY ARRAY['audit.audit_event','outbox.outbox_event'] LOOP
  branch:=CASE WHEN t='audit.audit_event' THEN $b$num_nonnulls(payment_authorization_id,payment_execution_id)=1 AND command_key IS NULL AND reversal_of IS NULL AND previous_state='absent' AND ((payment_authorization_id IS NOT NULL AND action='payments.authorized' AND new_state='authorized') OR (payment_execution_id IS NOT NULL AND action IN ('payments.recorded','payments.reversed') AND new_state='posted'))$b$
   ELSE $b$num_nonnulls(payment_authorization_id,payment_execution_id)=1 AND command_key IS NULL AND normalizer_version IS NULL AND aggregate_version=1 AND schema_version=1 AND payload @> jsonb_build_object('bookId',book_id) AND ((payment_authorization_id IS NOT NULL AND event_type='payments.authorized' AND payload=jsonb_build_object('bookId',book_id,'authorizationId',payment_authorization_id)) OR (payment_execution_id IS NOT NULL AND event_type IN ('payments.recorded','payments.reversed') AND payload @> jsonb_build_object('executionId',payment_execution_id)))$b$ END;
  FOR c IN SELECT conname,pg_get_expr(conbin,conrelid) AS expr FROM pg_constraint WHERE conrelid=t::regclass AND contype='c'
   AND (pg_get_expr(conbin,conrelid) LIKE '%num_nonnulls%' OR pg_get_expr(conbin,conrelid) ~ '(action|previous_state|new_state|payload|event_type)') LOOP
   EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',t,c.conname);
   EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK ((payment_authorization_id IS NULL AND payment_execution_id IS NULL AND (%s)) OR (%s))',t,c.conname,c.expr,branch);
  END LOOP;
 END LOOP;
END $$;
ALTER TABLE audit.audit_event ADD CHECK(num_nonnulls(payment_authorization_id,payment_execution_id)=0 OR num_nonnulls(account_id,journal_id,batch_id,revision_id,processor_evaluation_id,bank_evaluation_id,reconciliation_decision_id,exception_event_id,control_run_id)=0),
 ADD FOREIGN KEY(book_id,payment_authorization_id) REFERENCES payments.authorization(book_id,id),
 ADD FOREIGN KEY(book_id,payment_execution_id) REFERENCES payments.execution(book_id,id);
ALTER TABLE outbox.outbox_event ADD CHECK(num_nonnulls(payment_authorization_id,payment_execution_id)=0 OR num_nonnulls(account_id,journal_id,batch_id,processor_derivation_id,bank_derivation_id,reconciliation_decision_id,reconciliation_run_id,exception_event_id,control_run_id)=0),
 ADD FOREIGN KEY(book_id,payment_authorization_id) REFERENCES payments.authorization(book_id,id),
 ADD FOREIGN KEY(book_id,payment_execution_id) REFERENCES payments.execution(book_id,id);
INSERT INTO worker.contract VALUES('payments.authorized',1,1,NULL,NULL),('payments.recorded',1,1,NULL,NULL),('payments.reversed',1,1,NULL,NULL);

CREATE FUNCTION payments.authorize(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE data jsonb; a payments.authorization%ROWTYPE; version text; bk uuid;
BEGIN
 data:=payments.command_payload(p); bk:=(data->>'bookId')::uuid;
 PERFORM payments.require_capability(bk,'authorizer');
 PERFORM pg_advisory_xact_lock(hashtextextended('payments/command/'||bk||'/'||(data->>'commandKey'),0));
 PERFORM pg_advisory_xact_lock(hashtextextended('payments/business/'||bk||'/'||(data->>'kind')||'/'||(data->>'businessKey'),0));
 SELECT * INTO a FROM payments.authorization WHERE book_id=bk AND (command_key=data->>'commandKey' OR (kind=data->>'kind' AND business_key=data->>'businessKey')) ORDER BY id LIMIT 1;
 IF FOUND THEN
  IF a.command_payload<>data OR a.request_hash<>ledger.fingerprint(data) OR a.authorizer_principal<>session_user
  THEN RAISE EXCEPTION USING ERRCODE='P1501',MESSAGE='Accounting authorization identity conflicts'; END IF;
  RETURN jsonb_build_object('id',a.id,'replayed',true);
 END IF;
 INSERT INTO payments.authorization(book_id,command_key,business_key,kind,policy_id,amount_minor,currency,effective_at,actor_id,reason,original_capture_id,command_payload,request_hash,authorizer_principal)
 VALUES(bk,data->>'commandKey',data->>'businessKey',data->>'kind',(data->>'policyId')::uuid,(data->>'amountMinor')::bigint,data->>'currency',(data->>'effectiveAt')::timestamptz,data->>'actorId',data->>'reason',(data->>'originalCaptureId')::uuid,data,ledger.fingerprint(data),session_user) RETURNING * INTO a;
 SELECT policy_version INTO STRICT version FROM payments.policy WHERE id=a.policy_id;
 INSERT INTO audit.audit_event(book_id,payment_authorization_id,action,actor_id,previous_state,new_state,reason,policy_version)
 VALUES(bk,a.id,'payments.authorized',a.actor_id,'absent','authorized',a.reason,version);
 INSERT INTO outbox.outbox_event(book_id,payment_authorization_id,event_type,aggregate_version,schema_version,payload)
 VALUES(bk,a.id,'payments.authorized',1,1,jsonb_build_object('bookId',bk,'authorizationId',a.id));
 RETURN jsonb_build_object('id',a.id,'replayed',false);
END $$;

CREATE FUNCTION payments.guard_execution() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE a payments.authorization%ROWTYPE; p payments.policy%ROWTYPE; j ledger.ledger_transaction%ROWTYPE; original uuid;
BEGIN
 PERFORM payments.require_capability(NEW.book_id,'executor');
 SELECT * INTO STRICT a FROM payments.authorization WHERE id=NEW.authorization_id AND book_id=NEW.book_id;
 IF a.authorizer_principal=session_user THEN RAISE EXCEPTION USING ERRCODE='P1503',MESSAGE='Executor must be independent from authorizer'; END IF;
 SELECT * INTO STRICT p FROM payments.policy WHERE id=a.policy_id;
 SELECT * INTO STRICT j FROM ledger.ledger_transaction WHERE id=NEW.journal_id AND book_id=NEW.book_id;
 IF NEW.executor_principal<>session_user OR NEW.creation_transaction<>pg_current_xact_id() OR NEW.created_at<>transaction_timestamp()
 OR NEW.kind<>a.kind OR NEW.business_key<>a.business_key OR NEW.original_capture_id IS DISTINCT FROM a.original_capture_id
 OR j.command_key<>'payment:'||a.id OR j.currency<>a.currency OR j.effective_at<>a.effective_at OR j.policy_version<>p.policy_version OR j.actor_id<>a.actor_id OR j.reason<>a.reason OR j.state<>'posted'
 THEN RAISE EXCEPTION USING ERRCODE='P1502',MESSAGE='Execution must bind the exact approved command and journal'; END IF;
 IF a.kind='CAPTURE' THEN
  IF j.effect_namespace<>'payments.capture' OR j.business_effect_key<>a.business_key OR j.reversal_of IS NOT NULL
   OR (SELECT count(*) FROM ledger.ledger_entry WHERE journal_id=j.id)<>2
   OR NOT EXISTS(SELECT FROM ledger.ledger_entry WHERE journal_id=j.id AND account_id=p.receivable_account_id AND side='debit' AND amount_minor=a.amount_minor)
   OR NOT EXISTS(SELECT FROM ledger.ledger_entry WHERE journal_id=j.id AND account_id=p.payable_account_id AND side='credit' AND amount_minor=a.amount_minor)
  THEN RAISE EXCEPTION USING ERRCODE='P1502',MESSAGE='Capture journal does not implement the fixed accounting template'; END IF;
 ELSE
  SELECT journal_id INTO STRICT original FROM payments.execution WHERE id=a.original_capture_id AND kind='CAPTURE' AND book_id=a.book_id;
  IF j.reversal_of IS DISTINCT FROM original THEN RAISE EXCEPTION USING ERRCODE='P1502',MESSAGE='Reversal journal must invert the approved original capture'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER execution_scope BEFORE INSERT ON payments.execution FOR EACH ROW EXECUTE FUNCTION payments.guard_execution();
CREATE FUNCTION payments.execute(aid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a payments.authorization%ROWTYPE; p payments.policy%ROWTYPE; e payments.execution%ROWTYPE; result jsonb; payload jsonb; original uuid; event text;
BEGIN
 SELECT * INTO a FROM payments.authorization WHERE id=aid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1502',MESSAGE='Accounting authorization not found'; END IF;
 PERFORM payments.require_capability(a.book_id,'executor');
 IF a.authorizer_principal=session_user THEN RAISE EXCEPTION USING ERRCODE='P1503',MESSAGE='Executor must be independent from authorizer'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('payments/effect/'||a.book_id||'/'||a.kind||'/'||coalesce(a.original_capture_id::text,a.business_key),0));
 SELECT * INTO e FROM payments.execution WHERE authorization_id=aid;
 IF FOUND THEN RETURN jsonb_build_object('id',e.id,'journalId',e.journal_id,'replayed',true); END IF;
 IF a.kind='REVERSAL' AND EXISTS(SELECT FROM payments.execution WHERE original_capture_id=a.original_capture_id)
 THEN RAISE EXCEPTION USING ERRCODE='P1501',MESSAGE='Capture already has an authorized full reversal'; END IF;
 SELECT * INTO STRICT p FROM payments.policy WHERE id=a.policy_id;
 payload:=jsonb_build_object('bookId',a.book_id,'commandKey','payment:'||a.id,'actorId',a.actor_id,'reason',a.reason,'effectiveAt',a.command_payload->>'effectiveAt','policyVersion',p.policy_version);
 IF a.kind='CAPTURE' THEN
  result:=ledger.post_journal(payload||jsonb_build_object('effectNamespace','payments.capture','businessEffectKey',a.business_key,'currency',a.currency,'entries',jsonb_build_array(
   jsonb_build_object('accountId',p.receivable_account_id,'side','debit','amountMinor',a.amount_minor::text),
   jsonb_build_object('accountId',p.payable_account_id,'side','credit','amountMinor',a.amount_minor::text))));
  event:='payments.recorded';
 ELSE
  SELECT journal_id INTO STRICT original FROM payments.execution WHERE id=a.original_capture_id AND book_id=a.book_id AND kind='CAPTURE';
  result:=ledger.reverse_journal(payload||jsonb_build_object('originalJournalId',original)); event:='payments.reversed';
 END IF;
 INSERT INTO payments.execution(book_id,authorization_id,kind,business_key,original_capture_id,journal_id,executor_principal)
 VALUES(a.book_id,a.id,a.kind,a.business_key,a.original_capture_id,(result->>'id')::uuid,session_user) RETURNING * INTO e;
 INSERT INTO audit.audit_event(book_id,payment_execution_id,action,actor_id,previous_state,new_state,reason,policy_version)
 VALUES(a.book_id,e.id,event,a.actor_id,'absent','posted',a.reason,p.policy_version);
 INSERT INTO outbox.outbox_event(book_id,payment_execution_id,event_type,aggregate_version,schema_version,payload)
 VALUES(a.book_id,e.id,event,1,1,jsonb_build_object('bookId',a.book_id,'executionId',e.id,'authorizationId',a.id,'journalId',e.journal_id));
 RETURN jsonb_build_object('id',e.id,'journalId',e.journal_id,'replayed',false);
END $$;

CREATE FUNCTION payments.validate_companions() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE a payments.authorization%ROWTYPE; e payments.execution%ROWTYPE; target uuid; expected text; version text;
BEGIN
 IF TG_TABLE_NAME='authorization' THEN a:=NEW; target:=a.id; expected:='payments.authorized';
 ELSE e:=NEW; SELECT * INTO STRICT a FROM payments.authorization WHERE id=e.authorization_id; target:=e.id; expected:=CASE WHEN e.kind='CAPTURE' THEN 'payments.recorded' ELSE 'payments.reversed' END;
 END IF;
 SELECT policy_version INTO STRICT version FROM payments.policy WHERE id=a.policy_id;
 IF NOT EXISTS(SELECT FROM audit.audit_event ev WHERE ev.book_id=a.book_id AND ev.action=expected AND ev.actor_id=a.actor_id AND ev.reason=a.reason AND ev.policy_version=version
   AND ev.database_principal=CASE WHEN e.id IS NULL THEN a.authorizer_principal ELSE e.executor_principal END
   AND CASE WHEN e.id IS NULL THEN ev.payment_authorization_id=target ELSE ev.payment_execution_id=target END)
 OR NOT EXISTS(SELECT FROM outbox.outbox_event ev WHERE ev.book_id=a.book_id AND ev.event_type=expected
   AND CASE WHEN e.id IS NULL THEN ev.payment_authorization_id=target AND ev.payload=jsonb_build_object('bookId',a.book_id,'authorizationId',a.id)
    ELSE ev.payment_execution_id=target AND ev.payload=jsonb_build_object('bookId',a.book_id,'executionId',e.id,'authorizationId',a.id,'journalId',e.journal_id) END)
 THEN RAISE EXCEPTION USING ERRCODE='P1504',MESSAGE='Accounting decision requires exact atomic audit and outbox companions'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER authorization_companions AFTER INSERT ON payments.authorization DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payments.validate_companions();
CREATE CONSTRAINT TRIGGER execution_companions AFTER INSERT ON payments.execution DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payments.validate_companions();
-- Prevent generic ledger capabilities from bypassing payment authorization.
CREATE FUNCTION payments.validate_journal_link() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF (NEW.effect_namespace ~ '^payments([.]|$)' OR EXISTS(SELECT FROM payments.execution WHERE journal_id=NEW.reversal_of AND kind='CAPTURE'))
  AND NOT EXISTS(SELECT FROM payments.execution WHERE journal_id=NEW.id)
 THEN RAISE EXCEPTION USING ERRCODE='P1504',MESSAGE='Payment journal requires an authorized execution receipt'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER payment_journal_authority AFTER INSERT ON ledger.ledger_transaction DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payments.validate_journal_link();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['policy','principal_binding','authorization','execution'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON payments.%I FOR EACH ROW EXECUTE FUNCTION ledger.reject_mutation()',t);
  EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON payments.%I FOR EACH STATEMENT EXECUTE FUNCTION ledger.reject_mutation()',t);
 END LOOP;
END $$;

-- Additive structural audit of the new boundary; prior sweep predicates are retained.
DO $$ DECLARE d text; marker text:=' SELECT ''DUPLICATE_FINANCIAL_EFFECT'',min(j.id::text)'; extra text; BEGIN
 d:=pg_get_functiondef('integrity.sweep(uuid,uuid[])'::regprocedure);
 extra:=$q$ SELECT 'PAYMENT_AUTHORIZATION_COMPANIONS',a.id::text
  FROM payments.authorization a LEFT JOIN payments.policy p ON p.id=a.policy_id
  WHERE a.book_id=bk AND (
   p.id IS NULL OR p.book_id<>a.book_id OR p.currency<>a.currency
   OR a.request_hash IS DISTINCT FROM ledger.fingerprint(a.command_payload)
   OR a.command_payload IS DISTINCT FROM jsonb_build_object(
    'bookId',a.book_id,'commandKey',a.command_key,'businessKey',a.business_key,'kind',a.kind,
    'policyId',a.policy_id,'amountMinor',a.amount_minor::text,'currency',a.currency,
    'effectiveAt',to_char(a.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'actorId',a.actor_id,'reason',a.reason,'originalCaptureId',a.original_capture_id)
   OR (a.kind='REVERSAL' AND NOT EXISTS(
    SELECT FROM payments.execution original JOIN payments.authorization approved ON approved.id=original.authorization_id
    WHERE original.id=a.original_capture_id AND original.book_id=a.book_id AND original.kind='CAPTURE'
     AND approved.policy_id=a.policy_id AND approved.amount_minor=a.amount_minor
     AND approved.currency=a.currency AND approved.effective_at<=a.effective_at))
   OR NOT EXISTS(SELECT FROM audit.audit_event ev WHERE ev.payment_authorization_id=a.id AND ev.book_id=bk
    AND ev.action='payments.authorized' AND ev.actor_id=a.actor_id AND ev.reason=a.reason
    AND ev.policy_version=p.policy_version AND ev.database_principal=a.authorizer_principal
    AND ev.previous_state='absent' AND ev.new_state='authorized' AND ev.command_key IS NULL)
   OR NOT EXISTS(SELECT FROM outbox.outbox_event ev WHERE ev.payment_authorization_id=a.id AND ev.book_id=bk
    AND ev.event_type='payments.authorized' AND ev.schema_version=1 AND ev.aggregate_version=1
    AND ev.payload=jsonb_build_object('bookId',a.book_id,'authorizationId',a.id)))
  UNION ALL
  SELECT 'PAYMENT_EXECUTION_AUTHORITY',e.id::text
  FROM payments.execution e LEFT JOIN payments.authorization a ON a.id=e.authorization_id
   LEFT JOIN payments.policy p ON p.id=a.policy_id LEFT JOIN ledger.ledger_transaction j ON j.id=e.journal_id
   LEFT JOIN payments.execution original ON original.id=e.original_capture_id
  WHERE e.book_id=bk AND (
   a.id IS NULL OR p.id IS NULL OR j.id IS NULL OR a.book_id<>bk OR j.book_id<>bk
   OR e.kind<>a.kind OR e.business_key<>a.business_key OR e.original_capture_id IS DISTINCT FROM a.original_capture_id
   OR a.authorizer_principal=e.executor_principal OR j.command_key<>'payment:'||a.id
   OR j.currency<>a.currency OR j.effective_at<>a.effective_at OR j.policy_version<>p.policy_version
   OR j.actor_id<>a.actor_id OR j.reason<>a.reason OR j.state<>'posted'
   OR (e.kind='CAPTURE' AND (
    j.effect_namespace<>'payments.capture' OR j.business_effect_key<>a.business_key OR j.reversal_of IS NOT NULL
    OR (SELECT count(*) FROM ledger.ledger_entry WHERE journal_id=j.id)<>2
    OR NOT EXISTS(SELECT FROM ledger.ledger_entry WHERE journal_id=j.id AND account_id=p.receivable_account_id AND side='debit' AND amount_minor=a.amount_minor)
    OR NOT EXISTS(SELECT FROM ledger.ledger_entry WHERE journal_id=j.id AND account_id=p.payable_account_id AND side='credit' AND amount_minor=a.amount_minor)))
   OR (e.kind='REVERSAL' AND (
    original.id IS NULL OR original.kind<>'CAPTURE' OR original.book_id<>bk
    OR j.reversal_of IS DISTINCT FROM original.journal_id OR j.effect_namespace<>'ledger.reversal'
    OR j.business_effect_key IS DISTINCT FROM original.journal_id::text
    OR EXISTS(
     (SELECT account_id,currency,side,amount_minor FROM ledger.ledger_entry WHERE journal_id=j.id
      EXCEPT ALL SELECT account_id,currency,CASE side WHEN 'debit' THEN 'credit' ELSE 'debit' END,amount_minor FROM ledger.ledger_entry WHERE journal_id=original.journal_id)
     UNION ALL
     (SELECT account_id,currency,CASE side WHEN 'debit' THEN 'credit' ELSE 'debit' END,amount_minor FROM ledger.ledger_entry WHERE journal_id=original.journal_id
      EXCEPT ALL SELECT account_id,currency,side,amount_minor FROM ledger.ledger_entry WHERE journal_id=j.id))))
   OR NOT EXISTS(SELECT FROM audit.audit_event ev WHERE ev.payment_execution_id=e.id AND ev.book_id=bk
    AND ev.action=CASE WHEN e.kind='CAPTURE' THEN 'payments.recorded' ELSE 'payments.reversed' END
    AND ev.actor_id=a.actor_id AND ev.reason=a.reason AND ev.policy_version=p.policy_version
    AND ev.database_principal=e.executor_principal AND ev.previous_state='absent' AND ev.new_state='posted' AND ev.command_key IS NULL)
   OR NOT EXISTS(SELECT FROM outbox.outbox_event ev WHERE ev.payment_execution_id=e.id AND ev.book_id=bk
    AND ev.event_type=CASE WHEN e.kind='CAPTURE' THEN 'payments.recorded' ELSE 'payments.reversed' END
    AND ev.schema_version=1 AND ev.aggregate_version=1
    AND ev.payload=jsonb_build_object('bookId',a.book_id,'executionId',e.id,'authorizationId',a.id,'journalId',e.journal_id)))
  UNION ALL
  SELECT 'PAYMENT_JOURNAL_AUTHORITY',j.id::text FROM ledger.ledger_transaction j WHERE j.book_id=bk AND (j.effect_namespace ~ '^payments([.]|$)' OR EXISTS(SELECT FROM payments.execution WHERE journal_id=j.reversal_of AND kind='CAPTURE')) AND NOT EXISTS(SELECT FROM payments.execution WHERE journal_id=j.id)
  UNION ALL
$q$;
 IF strpos(d,marker)=0 THEN RAISE EXCEPTION 'Missing reviewed integrity extension point'; END IF;
 EXECUTE replace(d,marker,extra||marker);
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA payments FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA payments FROM PUBLIC;
GRANT USAGE ON SCHEMA payments TO flow_payment_authorizer,flow_payment_executor;
GRANT EXECUTE ON FUNCTION payments.authorize(jsonb) TO flow_payment_authorizer;
GRANT EXECUTE ON FUNCTION payments.execute(uuid) TO flow_payment_executor;
RESET ROLE;
