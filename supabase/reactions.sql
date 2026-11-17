-- אבן דרך 5: קליטת תגובות הנמען. ניתן להרצה חוזרת.
-- ההיגיון במסד; מי שקורא לו (Vercel, ובעתיד שרת אחר) רק מעביר את האירוע.

create or replace function public.record_reaction(
  p_wa_message_id text,   -- מזהה ההודעה שאליה הגיבו (null = הודעה חדשה בלי ציטוט)
  p_chat_phone    text,   -- מספר הצ'אט, ספרות בלבד
  p_emoji         text    -- אימוג'י כשזו תגובה, אחרת null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_send uuid;
  v_phone text := regexp_replace(coalesce(p_chat_phone,''), '\D', '', 'g');
begin
  -- 1. לפי מזהה ההודעה (תגובה או ציטוט)
  if p_wa_message_id is not null then
    select id into v_send from sends where wa_message_id = p_wa_message_id limit 1;
  end if;

  -- 2. גיבוי: הודעה חדשה מהנמען עד 24 שעות אחרי השליחה האחרונה אליו
  if v_send is null and p_emoji is null and v_phone <> '' then
    select s.id into v_send
      from sends s join settings st on st.user_id = s.user_id
     where s.status = 'sent'
       and s.sent_at > now() - interval '24 hours'
       and regexp_replace(coalesce(st.recipient_phone,''), '\D', '', 'g') = v_phone
     order by s.sent_at desc limit 1;
  end if;

  if v_send is null then
    return jsonb_build_object('matched', false);
  end if;

  update sends
     set recipient_reaction = coalesce(p_emoji, recipient_reaction),
         recipient_replied  = recipient_replied or p_emoji is null
   where id = v_send;

  return jsonb_build_object('matched', true, 'send_id', v_send);
end $$;

revoke all on function public.record_reaction(text, text, text) from public, anon, authenticated;
grant execute on function public.record_reaction(text, text, text) to service_role;
