-- משפט יומי: לוגיקת השליחה היומית
-- מריצים פעם אחת בעורך ה-SQL של Supabase, אחרי schema.sql.
-- אפשר להריץ שוב בבטחה: הפונקציות מוחלפות והאילוץ נבנה מחדש.
--
-- הרעיון: כל ההחלטות (האם שולחים היום, באיזו שעה, איזה משפט) מתקבלות כאן, במסד.
-- מי שמפעיל את הפונקציות (Make בשלב א, שרת בשלב ב) רק שולח את ההודעה ומדווח חזרה.

-- שני מצבי ביניים חדשים לשליחה: planned (נקבעה שעה) ו-sending (נמסר לשליחה).
alter table public.sends drop constraint if exists sends_status_check;
alter table public.sends add constraint sends_status_check
  check (status in ('planned', 'sending', 'sent', 'skipped', 'failed'));

-- ---------- next_send ----------
-- נקראת פעם בשעה לכל משתמש. מחזירה תמיד אובייקט JSON:
--   {"send": false, "reason": "..."}                         אין מה לשלוח עכשיו
--   {"send": true, "send_id": "...", "phone": "...", "message": "..."}   לשלוח עכשיו
create or replace function public.next_send(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s          public.settings%rowtype;
  v_send     public.sends%rowtype;
  v_sentence public.sentences%rowtype;
  v_now      timestamptz := now();
  v_local    timestamp;
  v_date     date;
  v_hour     int;
  v_dow      int;
  v_reason   text;
  v_from     int;
begin
  select * into s from public.settings where user_id = p_user;
  if not found then
    return jsonb_build_object('send', false, 'reason', 'no_settings');
  end if;
  if not s.is_active then
    return jsonb_build_object('send', false, 'reason', 'inactive');
  end if;
  if s.recipient_phone is null or s.recipient_phone = '' then
    return jsonb_build_object('send', false, 'reason', 'no_recipient');
  end if;

  v_local := v_now at time zone s.timezone;
  v_date  := v_local::date;
  v_hour  := extract(hour from v_local)::int;
  v_dow   := extract(dow from v_local)::int;      -- 0 = ראשון ... 6 = שבת

  select * into v_send from public.sends where user_id = p_user and send_date = v_date;

  -- הקריאה הראשונה של היום: מחליטים אם שולחים ומגרילים שעה.
  if not found then
    if not (v_dow = any (s.send_days)) then
      v_reason := 'day_off';
    elsif s.skip_date = v_date then
      v_reason := 'skipped_by_user';
    elsif s.block_shabbat and v_dow = 6 then
      v_reason := 'shabbat';
    elsif exists (
      select 1 from public.blocked_dates b
      where b.user_id = p_user
        and b.blocked_date = v_date
        and not b.send_anyway
        and (b.source = 'manual'
             or (b.source = 'holiday' and s.block_holidays)
             or (b.source = 'holiday_eve' and s.block_holiday_eves))
    ) then
      v_reason := 'blocked_date';
    elsif v_hour >= s.window_end_hour then
      v_reason := 'window_passed';
    end if;

    if v_reason is not null then
      insert into public.sends (user_id, send_date, status, skip_reason)
      values (p_user, v_date, 'skipped', v_reason);
      return jsonb_build_object('send', false, 'reason', v_reason);
    end if;

    -- שעה אקראית בין תחילת החלון (או השעה הנוכחית, אם כבר מאוחר יותר) לסופו.
    v_from := greatest(s.window_start_hour, v_hour);
    insert into public.sends (user_id, send_date, status, planned_hour)
    values (p_user, v_date, 'planned',
            v_from + floor(random() * (s.window_end_hour - v_from))::int)
    returning * into v_send;
  end if;

  if v_send.status <> 'planned' then
    return jsonb_build_object('send', false, 'reason', 'already_' || v_send.status);
  end if;

  -- המשתמש לחץ "דילוג על היום" אחרי שכבר נקבעה שעה.
  if s.skip_date = v_date then
    update public.sends set status = 'skipped', skip_reason = 'skipped_by_user' where id = v_send.id;
    return jsonb_build_object('send', false, 'reason', 'skipped_by_user');
  end if;

  if v_hour < v_send.planned_hour then
    return jsonb_build_object('send', false, 'reason', 'not_yet', 'planned_hour', v_send.planned_hour);
  end if;

  -- בוחרים משפט: פעיל, מקטגוריה שהמשתמש הפעיל, לא ארוטי (לארוטיקה יהיה חלון נפרד),
  -- ושלא נשלח ב-90 הימים האחרונים. משפטים שטרם נשלחו קודמים, ומעליהם ציון גבוה.
  select se.* into v_sentence
  from public.sentences se
  join public.categories c on c.id = se.category_id
  join public.user_categories uc
    on uc.category_id = se.category_id and uc.user_id = p_user and uc.enabled
  where se.user_id = p_user
    and se.status = 'active'
    and not c.is_adult
    and (se.last_sent_at is null or se.last_sent_at < v_now - interval '90 days')
  order by (se.last_sent_at is null) desc, se.score desc, random()
  limit 1;

  if not found then
    update public.sends set status = 'failed', skip_reason = 'no_sentence' where id = v_send.id;
    return jsonb_build_object('send', false, 'reason', 'no_sentence');
  end if;

  update public.sends set status = 'sending', sentence_id = v_sentence.id where id = v_send.id;
  update public.sentences set last_sent_at = v_now where id = v_sentence.id;

  return jsonb_build_object(
    'send', true,
    'send_id', v_send.id,
    'phone', s.recipient_phone,
    'message', v_sentence.text,
    'planned_hour', v_send.planned_hour
  );
end;
$$;

-- ---------- confirm_send ----------
-- נקראת אחרי שההודעה נמסרה לוואטסאפ, עם מזהה ההודעה שחזר.
create or replace function public.confirm_send(p_send uuid, p_wa_message_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sends
     set status = 'sent', sent_at = now(), wa_message_id = p_wa_message_id
   where id = p_send and status = 'sending';
  return jsonb_build_object('ok', found);
end;
$$;

-- רק מפתח השירות רשאי להפעיל את הפונקציות. משתמשים רגילים ואורחים לא.
revoke all on function public.next_send(uuid) from public, anon, authenticated;
revoke all on function public.confirm_send(uuid, text) from public, anon, authenticated;
grant execute on function public.next_send(uuid) to service_role;
grant execute on function public.confirm_send(uuid, text) to service_role;
